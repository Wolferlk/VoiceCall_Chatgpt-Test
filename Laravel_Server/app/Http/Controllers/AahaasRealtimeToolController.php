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
            'tool'                  => ['required', 'string', 'in:fetch_travel_package,send_whatsapp_quotation'],
            // fetch_travel_package
            'customer_voice_prompt' => ['nullable', 'string', 'max:1000'],
            'action'                => ['nullable', 'string', 'max:50'],
            'session_id'            => ['nullable', 'string', 'max:100'],
            // send_whatsapp_quotation
            'customer_name'         => ['nullable', 'string', 'max:200'],
            'phone_number'          => ['nullable', 'string', 'max:30'],
            'package_summary'       => ['nullable', 'string', 'max:3000'],
        ]);

        return match ($validated['tool']) {
            'fetch_travel_package'    => $this->handleFetchTravelPackage($validated),
            'send_whatsapp_quotation' => $this->handleSendWhatsApp($validated),
            default                   => response()->json(['message' => 'Unknown tool.'], 400),
        };
    }

    // ── Package fetch ─────────────────────────────────────────────────────────

    private function handleFetchTravelPackage(array $args): JsonResponse
    {
        $prompt    = trim((string) ($args['customer_voice_prompt'] ?? ''));
        $action    = trim((string) ($args['action']    ?? ''));
        $sessionId = trim((string) ($args['session_id'] ?? ''));

        if ($prompt === '') {
            return response()->json([
                'success' => false,
                'result'  => 'No customer prompt was provided.',
            ]);
        }

        $payload = ['prompt' => $prompt];

        // Reuse the session from a previous turn so the API keeps cart state
        if ($sessionId !== '') {
            $payload['session_id'] = $sessionId;
        }

        // Pass the action only when it is a known value (skips classifier → faster + deterministic)
        $validActions = array_merge(self::SLOW_ACTIONS, self::FAST_ACTIONS);
        if ($action !== '' && in_array($action, $validActions, true)) {
            $payload['action'] = $action;
        }

        $suggestUrl = trim((string) env(
            'TRAVEL_PACKAGE_SUGGEST_URL',
            'https://travel-parser-live.aahaas.com/v1/voice/suggest'
        ));

        Log::info('AahaasRealtimeTool: calling suggest API', [
            'action'     => $action,
            'session_id' => $sessionId ?: '(new)',
            'prompt'     => mb_substr($prompt, 0, 120),
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
