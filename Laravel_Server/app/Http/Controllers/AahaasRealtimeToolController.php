<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class AahaasRealtimeToolController extends Controller
{
    public function __invoke(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'tool'             => ['required', 'string', 'in:fetch_travel_package,send_whatsapp_quotation'],
            // fetch_travel_package fields
            'destination'      => ['nullable', 'string', 'max:200'],
            'travelers'        => ['nullable', 'integer', 'min:1', 'max:100'],
            'nights'           => ['nullable', 'integer', 'min:1', 'max:365'],
            'hotel_stars'      => ['nullable', 'integer', 'min:1', 'max:5'],
            'start_date'       => ['nullable', 'string', 'max:100'],
            'purpose'          => ['nullable', 'string', 'max:200'],
            'special_requests' => ['nullable', 'string', 'max:500'],
            // send_whatsapp_quotation fields
            'customer_name'    => ['nullable', 'string', 'max:200'],
            'phone_number'     => ['nullable', 'string', 'max:30'],
            'package_summary'  => ['nullable', 'string', 'max:3000'],
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
        $destination     = trim((string) ($args['destination']     ?? ''));
        $travelers       = (int) ($args['travelers']    ?? 2);
        $nights          = (int) ($args['nights']       ?? 3);
        $hotelStars      = (int) ($args['hotel_stars']  ?? 3);
        $startDate       = trim((string) ($args['start_date']     ?? 'next week'));
        $purpose         = trim((string) ($args['purpose']        ?? ''));
        $specialRequests = trim((string) ($args['special_requests'] ?? ''));

        if ($destination === '') {
            return response()->json(['success' => false, 'result' => 'Destination is required.']);
        }

        $prompt = $this->buildPackagePrompt($destination, $travelers, $nights, $hotelStars, $startDate, $purpose, $specialRequests);

        $suggestUrl = trim((string) env('TRAVEL_PACKAGE_SUGGEST_URL', 'https://travel-parser-live.aahaas.com/v1/voice/suggest'));

        try {
            $response = Http::timeout(90)->asJson()->post($suggestUrl, ['prompt' => $prompt]);

            if (! $response->successful()) {
                Log::warning('AahaasRealtimeTool: Package API failed', ['status' => $response->status()]);
                return response()->json(['success' => false, 'result' => 'Package service unavailable. We will follow up via WhatsApp.']);
            }

            $payload = $response->json();

            if (! is_array($payload)) {
                return response()->json(['success' => false, 'result' => 'Unexpected response from package service.']);
            }

            $voiceText = $this->extractVoiceText($payload);

            Log::info('AahaasRealtimeTool: Package fetched', ['destination' => $destination]);

            return response()->json(['success' => true, 'voice_text' => $voiceText, 'raw' => $payload]);
        } catch (\Throwable $e) {
            Log::error('AahaasRealtimeTool: Package exception', ['message' => $e->getMessage()]);
            return response()->json(['success' => false, 'result' => 'Package service unreachable. We will follow up via WhatsApp.']);
        }
    }

    private function buildPackagePrompt(
        string $destination, int $travelers, int $nights, int $hotelStars,
        string $startDate, string $purpose, string $specialRequests
    ): string {
        $parts = [
            "Travel package request: {$travelers} traveler(s) to {$destination}.",
            "{$nights} nights, {$hotelStars}-star hotel, starting {$startDate}.",
        ];
        if ($purpose !== '')          $parts[] = "Purpose: {$purpose}.";
        if ($specialRequests !== '')  $parts[] = "Special requests: {$specialRequests}.";
        return implode(' ', $parts);
    }

    private function extractVoiceText(array $payload): string
    {
        foreach (['voice_text', 'summary', 'description', 'reply', 'message'] as $key) {
            $text = trim((string) ($payload[$key] ?? ''));
            if ($text !== '') return $text;
        }
        foreach (['package', 'result', 'data'] as $key) {
            $sub = $payload[$key] ?? null;
            if (is_string($sub) && trim($sub) !== '') return trim($sub);
            if (is_array($sub)) {
                foreach (['voice_text', 'summary', 'description'] as $sk) {
                    $t = trim((string) ($sub[$sk] ?? ''));
                    if ($t !== '') return $t;
                }
            }
        }
        return 'A package has been prepared. We will send the details via WhatsApp shortly.';
    }

    // ── WhatsApp quotation ────────────────────────────────────────────────────

    private function handleSendWhatsApp(array $args): JsonResponse
    {
        $customerName   = trim((string) ($args['customer_name']   ?? ''));
        $phoneNumber    = trim((string) ($args['phone_number']    ?? ''));  // already normalised by client
        $packageSummary = trim((string) ($args['package_summary'] ?? ''));

        if ($phoneNumber === '' || $customerName === '') {
            return response()->json(['success' => false, 'result' => 'Name and phone number are required.']);
        }

        // Use just first name for the greeting
        $firstName = explode(' ', $customerName)[0];

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

            Log::warning('AahaasRealtimeTool: WhatsApp failed', ['status' => $response->status(), 'body' => substr($response->body(), 0, 200)]);
            return response()->json(['success' => false, 'result' => 'Could not send WhatsApp right now. Our team will follow up shortly.']);
        } catch (\Throwable $e) {
            Log::error('AahaasRealtimeTool: WhatsApp exception', ['message' => $e->getMessage()]);
            return response()->json(['success' => false, 'result' => 'WhatsApp sending failed. We will follow up manually.']);
        }
    }
}
