<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class AahaasRealtimeToolController extends Controller
{
    // Action types that rebuild the plan (take 20-40 s — hold music should play)
    private const SLOW_ACTIONS = ['new_request', 'add_hotel', 'add_product', 'change'];

    // Action types that answer instantly from stored state
    private const FAST_ACTIONS = ['price_query', 'confirm'];

    public function __invoke(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'tool'                  => ['required', 'string', 'in:fetch_travel_package,send_whatsapp_quotation,search_products'],
            // fetch_travel_package
            'customer_voice_prompt' => ['nullable', 'string', 'max:1000'],
            'action'                => ['nullable', 'string', 'max:50'],
            'session_id'            => ['nullable', 'string', 'max:100'],
            // Structured slots the realtime model extracted for this turn. Optional.
            // Validated only as an array on purpose — per-field sanitising/clamping is
            // done in composeCanonicalPrompt so a single malformed slot can never 422
            // the whole turn (a failed package fetch mid-call is worse than a dropped slot).
            'details'               => ['nullable', 'array'],
            // Explicit product picks chosen from a search_products result (add-by-id).
            'product_ids'           => ['nullable', 'array', 'max:20'],
            'product_ids.*'         => ['integer'],
            // search_products
            'query'                 => ['nullable', 'string', 'max:200'],
            'type'                  => ['nullable', 'string', 'max:40'],
            'city'                  => ['nullable', 'string', 'max:120'],
            // send_whatsapp_quotation
            'customer_name'         => ['nullable', 'string', 'max:200'],
            'phone_number'          => ['nullable', 'string', 'max:30'],
            'package_summary'       => ['nullable', 'string', 'max:3000'],
        ]);

        return match ($validated['tool']) {
            'fetch_travel_package'    => $this->handleFetchTravelPackage($validated),
            'send_whatsapp_quotation' => $this->handleSendWhatsApp($validated),
            'search_products'         => $this->handleSearchProducts($validated),
            default                   => response()->json(['message' => 'Unknown tool.'], 400),
        };
    }

    // ── Package fetch ─────────────────────────────────────────────────────────

    private function handleFetchTravelPackage(array $args): JsonResponse
    {
        $prompt     = trim((string) ($args['customer_voice_prompt'] ?? ''));
        $action     = trim((string) ($args['action']    ?? ''));
        $sessionId  = trim((string) ($args['session_id'] ?? ''));
        $details    = is_array($args['details'] ?? null) ? $args['details'] : [];
        // Explicit product picks (add-by-id) — keep positive ints only.
        $productIds = array_values(array_filter(
            array_map('intval', is_array($args['product_ids'] ?? null) ? $args['product_ids'] : []),
            static fn ($id) => $id > 0,
        ));

        // A pick-only add may carry no spoken prompt — synthesise a minimal one so
        // downstream prompt-composition still has text to work with.
        if ($prompt === '' && $productIds !== []) {
            $prompt = 'add the selected option';
        }

        if ($prompt === '') {
            return response()->json([
                'success' => false,
                'result'  => 'No customer prompt was provided.',
            ]);
        }

        // The suggest API only accepts a free-text `prompt`. Rather than ship the raw
        // utterance and hope the parser guesses right (lossy on "change" turns), we
        // fold the model's structured slots into one explicit, deterministic prompt.
        $finalPrompt = $this->composeCanonicalPrompt($prompt, $details);

        $payload = ['prompt' => $finalPrompt];

        // Reuse the session from a previous turn so the API keeps cart state
        if ($sessionId !== '') {
            $payload['session_id'] = $sessionId;
        }

        // Pass the action only when it is a known value (skips classifier → faster + deterministic)
        $validActions = array_merge(self::SLOW_ACTIONS, self::FAST_ACTIONS);
        if ($action !== '' && in_array($action, $validActions, true)) {
            $payload['action'] = $action;
        }

        // Forward explicit product picks so the suggest API adds exactly those.
        if ($productIds !== []) {
            $payload['product_ids'] = $productIds;
        }

        $suggestUrl = trim((string) env(
            'TRAVEL_PACKAGE_SUGGEST_URL',
            'https://travel-parser-live.aahaas.com/v1/voice/suggest'
        ));

        Log::info('AahaasRealtimeTool: calling suggest API', [
            'action'     => $action,
            'session_id' => $sessionId ?: '(new)',
            'prompt'     => mb_substr($finalPrompt, 0, 200),
            'details'    => $details ?: '(none)',
        ]);

        try {
            $response = Http::timeout(90)->asJson()->post($suggestUrl, $payload);

            if (! $response->successful()) {
                Log::warning('AahaasRealtimeTool: suggest API failed', [
                    'status' => $response->status(),
                    'body'   => mb_substr($response->body(), 0, 300),
                ]);
                return response()->json([
                    'success' => false,
                    'result'  => 'The package service is temporarily unavailable. We will follow up via WhatsApp.',
                ]);
            }

            $data = $response->json();

            if (! is_array($data)) {
                return response()->json([
                    'success' => false,
                    'result'  => 'Unexpected response from package service.',
                ]);
            }

            Log::info('AahaasRealtimeTool: suggest OK', [
                'intent'     => $data['intent'] ?? '',
                'session_id' => $data['session_id'] ?? '',
                'total'      => $data['pricing']['grand_total'] ?? null,
            ]);

            // Build a rich AI-readable output so the AI can reference pricing and options
            $aiOutput = $this->buildAiOutput($data);

            return response()->json([
                'success'            => true,
                // Key fields — returned to the client to drive the UI and next turn
                'session_id'         => $data['session_id']  ?? '',
                'intent'             => $data['intent']       ?? '',
                'voice_text'         => $data['voice_text']   ?? '',
                'destination'        => $data['destination']  ?? '',
                'currency'           => $data['currency']     ?? 'USD',
                'hotel'              => $data['hotel']        ?? null,
                'products'           => $data['products']     ?? [],
                'pricing'            => $data['pricing']      ?? null,
                'additional_options' => $data['additional_options'] ?? [],
                'meta'               => $data['meta']         ?? [],
                // This is what the AI receives back inside the conversation context
                'ai_output'          => $aiOutput,
            ]);
        } catch (\Throwable $e) {
            Log::error('AahaasRealtimeTool: suggest exception', ['message' => $e->getMessage()]);
            return response()->json([
                'success' => false,
                'result'  => 'Package service unreachable. We will follow up via WhatsApp.',
            ]);
        }
    }

    // ── Product / transfer search (read-only catalogue lookup) ────────────────

    private function handleSearchProducts(array $args): JsonResponse
    {
        $query     = trim((string) ($args['query'] ?? ''));
        $type      = trim((string) ($args['type']  ?? 'any'));
        $city      = trim((string) ($args['city']  ?? ''));
        $sessionId = trim((string) ($args['session_id'] ?? ''));

        $payload = ['type' => $type !== '' ? $type : 'any'];
        if ($query !== '')     $payload['query']      = $query;
        if ($city !== '')      $payload['city']       = $city;
        if ($sessionId !== '') $payload['session_id'] = $sessionId;

        $searchUrl = trim((string) env(
            'TRAVEL_PACKAGE_SEARCH_URL',
            'https://travel-parser-live.aahaas.com/v1/voice/search'
        ));

        Log::info('AahaasRealtimeTool: calling search API', [
            'type'       => $type,
            'query'      => mb_substr($query, 0, 80),
            'city'       => $city,
            'session_id' => $sessionId ?: '(none)',
        ]);

        try {
            $response = Http::timeout(30)->asJson()->post($searchUrl, $payload);

            if (! $response->successful()) {
                return response()->json([
                    'success'   => false,
                    'results'   => [],
                    'ai_output' => 'The product search is temporarily unavailable. Apologise briefly and offer to follow up via WhatsApp — do NOT say we do not offer it.',
                ]);
            }

            $data    = $response->json();
            $results = is_array($data['results'] ?? null) ? $data['results'] : [];

            return response()->json([
                'success'   => true,
                'results'   => $results,
                'ai_output' => $this->buildSearchAiOutput($results),
            ]);
        } catch (\Throwable $e) {
            Log::error('AahaasRealtimeTool: search exception', ['message' => $e->getMessage()]);
            return response()->json([
                'success'   => false,
                'results'   => [],
                'ai_output' => 'The product search did not respond. Apologise briefly and offer to follow up — do NOT tell the customer to arrange their own.',
            ]);
        }
    }

    /**
     * Text block the AI receives after a search — real options with ids so it can
     * read a couple aloud and then add the chosen one via product_ids.
     */
    private function buildSearchAiOutput(array $results): string
    {
        if ($results === []) {
            return 'No matching products came back. Tell the customer you will confirm availability with the team and follow up — do NOT say we do not offer it or that they should arrange their own.';
        }

        $lines = ['Found these REAL options. Read one or two aloud with the approximate price. To add one, call fetch_travel_package with action=add_product and product_ids=[that id]:'];
        foreach (array_slice($results, 0, 6) as $r) {
            $id    = $r['id']   ?? '?';
            $name  = $r['name'] ?? 'Option';
            $cur   = $r['currency'] ?? '';
            $price = isset($r['indicative_price']) ? number_format((float) $r['indicative_price'], 2) : null;
            $line  = "  - id {$id}: {$name}";
            if ($price !== null) $line .= " (~{$cur} {$price})";
            $lines[] = $line;
        }

        return implode("\n", $lines);
    }

    /**
     * Fold the customer's raw words + the model's structured slots into a single
     * explicit prompt for the suggest API. The API only reads free text, so we make
     * that text unambiguous instead of relying on it to re-parse loose speech —
     * critical for "change"/"add" turns where a missed word changes the cart.
     *
     * The raw utterance is always preserved (parser keeps full context); the
     * structured lines just remove ambiguity.
     */
    private function composeCanonicalPrompt(string $prompt, array $details): string
    {
        $lines = [];

        // Scalar slot → trimmed, length-capped string ('' if not a usable scalar).
        $str = static function ($v, int $max = 200): string {
            if (! is_scalar($v)) {
                return '';
            }
            return mb_substr(trim((string) $v), 0, $max);
        };
        // Clamp an integer-ish slot into [min, max]; 0 means "not provided / ignore".
        $int = static function ($v, int $min, int $max): int {
            if (! is_numeric($v)) {
                return 0;
            }
            $n = (int) $v;
            return ($n < $min || $n > $max) ? 0 : $n;
        };
        // Array slot → up to 10 trimmed, capped, non-empty strings.
        $list = static function ($v) use ($str): array {
            if (! is_array($v)) {
                return [];
            }
            $out = [];
            foreach (array_slice($v, 0, 10) as $item) {
                if (($s = $str($item)) !== '') {
                    $out[] = $s;
                }
            }
            return $out;
        };

        if (($v = $str($details['destination'] ?? null)) !== '') $lines[] = "Destination: {$v}.";
        if (($n = $int($details['nights']      ?? null, 1, 60)) > 0) $lines[] = "Stay: {$n} nights.";
        if (($n = $int($details['travelers']   ?? null, 1, 50)) > 0) $lines[] = "Travelers: {$n}.";
        if (($n = $int($details['star_rating'] ?? null, 1, 7))  > 0) $lines[] = "Hotel category: {$n}-star.";
        if (($v = $str($details['hotel_name']  ?? null)) !== '') $lines[] = "Hotel: {$v}.";

        if (($a = $list($details['add_items']    ?? null)) !== []) $lines[] = "Add: "    . implode(', ', $a) . ".";
        if (($a = $list($details['remove_items'] ?? null)) !== []) $lines[] = "Remove: " . implode(', ', $a) . ".";

        if (($v = $str($details['date_or_month'] ?? null)) !== '') $lines[] = "When: {$v}.";
        if (($v = $str($details['budget']        ?? null)) !== '') $lines[] = "Budget: {$v}.";
        if (($v = $str($details['notes']         ?? null, 500)) !== '') $lines[] = "Notes: {$v}.";

        if ($lines === []) {
            return $prompt;   // nothing structured this turn — send the raw words
        }

        return "Customer said: \"{$prompt}\"\n\nStructured request:\n" . implode("\n", $lines);
    }

    /**
     * Build a concise text block the AI receives as the tool result.
     * It can then reference exact prices and options in its spoken reply.
     */
    private function buildAiOutput(array $data): string
    {
        $parts   = [];
        $cur     = $data['currency'] ?? 'USD';
        $intent  = $data['intent'] ?? '';

        // 0. Empty result: the suggest API returns 200 with success:true and no
        //    products when it can't build a package. Tell the AI explicitly so it
        //    apologises instead of speaking a near-blank tool result.
        $hasContent = ! empty($data['products'])
            || ! empty($data['hotel'])
            || isset($data['pricing']['grand_total']);
        if (! $hasContent) {
            $apology = trim((string) ($data['voice_text'] ?? ''));
            return ($apology !== '' ? "SPEAK THIS: {$apology}\n" : '')
                . 'No package was found for this request. Apologise briefly, do NOT invent options, and offer to follow up via WhatsApp.';
        }

        // 1. The TTS-ready line (speak this)
        $voiceText = trim((string) ($data['voice_text'] ?? ''));
        if ($voiceText !== '') {
            $parts[] = "SPEAK THIS: {$voiceText}";
        }

        // 2. Exact pricing
        $pricing = $data['pricing'] ?? null;
        if (is_array($pricing) && isset($pricing['grand_total'])) {
            $src    = $pricing['source'] === 'cart' ? 'EXACT' : 'estimate';
            $total  = number_format((float) $pricing['grand_total'], 2);
            $pcur   = $pricing['currency'] ?? $cur;
            $parts[] = "Grand total ({$src}): {$pcur} {$total}";

            if (isset($pricing['hotels_total']) && $pricing['hotels_total'] > 0) {
                $parts[] = "  Hotel: {$pcur} " . number_format((float) $pricing['hotels_total'], 2);
            }
            if (isset($pricing['activities_total']) && $pricing['activities_total'] > 0) {
                $parts[] = "  Activities: {$pcur} " . number_format((float) $pricing['activities_total'], 2);
            }
        }

        // 3. Included itinerary items
        $products = $data['products'] ?? [];
        if (! empty($products)) {
            $parts[] = "Included in package:";
            foreach (array_slice($products, 0, 5) as $p) {
                $name  = $p['name']  ?? 'Item';
                $type  = $p['type']  ?? '';
                $total = isset($p['total_amount']) ? number_format((float) $p['total_amount'], 2) : null;
                $line  = "  - {$name} ({$type})";
                if ($total !== null) $line .= " — {$cur} {$total}";
                $parts[] = $line;
            }
        }

        // 4. Additional options to upsell
        $options = $data['additional_options'] ?? [];
        if (! empty($options)) {
            $parts[] = "Could also offer (not yet added):";
            foreach (array_slice($options, 0, 4) as $o) {
                $name  = $o['name'] ?? 'Option';
                $price = isset($o['indicative_price']) ? number_format((float) $o['indicative_price'], 2) : null;
                $oCur  = $o['currency'] ?? $cur;
                $line  = "  + {$name}";
                if ($price !== null) $line .= " (~{$oCur} {$price}/approx)";
                $parts[] = $line;
            }
        }

        // 5. Intent context
        if ($intent !== '') {
            $parts[] = "Action taken: {$intent}";
        }

        return implode("\n", $parts);
    }

    // ── WhatsApp quotation ────────────────────────────────────────────────────

    private function handleSendWhatsApp(array $args): JsonResponse
    {
        $customerName   = trim((string) ($args['customer_name']   ?? ''));
        $phoneNumber    = trim((string) ($args['phone_number']    ?? ''));
        $packageSummary = trim((string) ($args['package_summary'] ?? ''));

        if ($phoneNumber === '' || $customerName === '') {
            return response()->json(['success' => false, 'result' => 'Name and phone number are required.']);
        }

        $firstName   = explode(' ', $customerName)[0];
        $whatsappUrl = trim((string) env('AAHAAS_WHATSAPP_SEND_URL', 'https://travel-parser-live.aahaas.com/v1/voice/send-whatsapp'));

        try {
            $response = Http::timeout(90)->asJson()->post($whatsappUrl, [
                'prompt'       => $packageSummary,
                'waId'         => $phoneNumber,
                'customerName' => $firstName,
            ]);

            if ($response->ok()) {
                Log::info('AahaasRealtimeTool: WhatsApp sent', ['wa_id' => $phoneNumber, 'name' => $customerName]);
                return response()->json([
                    'success' => true,
                    'result'  => "WhatsApp quotation sent to {$customerName}. The call can now end.",
                ]);
            }

            Log::warning('AahaasRealtimeTool: WhatsApp failed', [
                'status' => $response->status(),
                'body'   => mb_substr($response->body(), 0, 200),
            ]);
            return response()->json([
                'success' => false,
                'result'  => 'Could not send WhatsApp right now. Our team will follow up shortly.',
            ]);
        } catch (\Throwable $e) {
            Log::error('AahaasRealtimeTool: WhatsApp exception', ['message' => $e->getMessage()]);
            return response()->json([
                'success' => false,
                'result'  => 'WhatsApp sending failed. We will follow up manually.',
            ]);
        }
    }
}
