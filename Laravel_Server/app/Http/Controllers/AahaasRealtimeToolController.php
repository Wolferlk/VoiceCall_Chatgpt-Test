<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * Handles synchronous tool calls from the Realtime voice session.
 * The client calls this endpoint when OpenAI triggers a function call,
 * executes the action, then returns the result to the DataChannel.
 */
class AahaasRealtimeToolController extends Controller
{
    public function __invoke(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'tool'              => ['required', 'string', 'in:fetch_travel_package'],
            'destination'       => ['nullable', 'string', 'max:200'],
            'travelers'         => ['nullable', 'integer', 'min:1', 'max:100'],
            'nights'            => ['nullable', 'integer', 'min:1', 'max:365'],
            'hotel_stars'       => ['nullable', 'integer', 'min:1', 'max:5'],
            'start_date'        => ['nullable', 'string', 'max:100'],
            'purpose'           => ['nullable', 'string', 'max:200'],
            'special_requests'  => ['nullable', 'string', 'max:500'],
        ]);

        return match ($validated['tool']) {
            'fetch_travel_package' => $this->handleFetchTravelPackage($validated),
            default                => response()->json(['message' => 'Unknown tool.'], 400),
        };
    }

    private function handleFetchTravelPackage(array $args): JsonResponse
    {
        $destination     = trim((string) ($args['destination']     ?? ''));
        $travelers       = (int)    ($args['travelers']    ?? 2);
        $nights          = (int)    ($args['nights']       ?? 3);
        $hotelStars      = (int)    ($args['hotel_stars']  ?? 3);
        $startDate       = trim((string) ($args['start_date']     ?? 'next week'));
        $purpose         = trim((string) ($args['purpose']        ?? ''));
        $specialRequests = trim((string) ($args['special_requests'] ?? ''));

        if ($destination === '') {
            return response()->json([
                'success' => false,
                'result'  => 'Destination is required to search for a package.',
            ]);
        }

        $prompt = $this->buildPackagePrompt(
            $destination, $travelers, $nights, $hotelStars, $startDate, $purpose, $specialRequests
        );

        $suggestUrl = trim((string) env(
            'TRAVEL_PACKAGE_SUGGEST_URL',
            'https://travel-parser-live.aahaas.com/v1/voice/suggest'
        ));

        try {
            $response = Http::timeout(90)
                ->asJson()
                ->post($suggestUrl, ['prompt' => $prompt]);

            if (! $response->successful()) {
                Log::warning('AahaasRealtimeTool: Package API failed', [
                    'status' => $response->status(),
                    'body'   => substr($response->body(), 0, 300),
                ]);

                return response()->json([
                    'success' => false,
                    'result'  => 'The package service is temporarily unavailable. Let the caller know we will follow up via WhatsApp.',
                ]);
            }

            $payload = $response->json();

            if (! is_array($payload)) {
                return response()->json([
                    'success' => false,
                    'result'  => 'Package service returned an unexpected response.',
                ]);
            }

            $voiceText = $this->extractVoiceText($payload);

            Log::info('AahaasRealtimeTool: Package fetched', ['destination' => $destination]);

            return response()->json([
                'success'    => true,
                'voice_text' => $voiceText,
                'raw'        => $payload,
            ]);
        } catch (\Throwable $e) {
            Log::error('AahaasRealtimeTool: Exception during package fetch', ['message' => $e->getMessage()]);

            return response()->json([
                'success' => false,
                'result'  => 'Could not reach the package service right now. We will follow up via WhatsApp.',
            ]);
        }
    }

    private function buildPackagePrompt(
        string $destination,
        int    $travelers,
        int    $nights,
        int    $hotelStars,
        string $startDate,
        string $purpose,
        string $specialRequests
    ): string {
        $parts = [
            "Travel package request: {$travelers} traveler(s) to {$destination}.",
            "{$nights} nights, {$hotelStars}-star hotel, starting {$startDate}.",
        ];

        if ($purpose !== '') {
            $parts[] = "Purpose: {$purpose}.";
        }

        if ($specialRequests !== '') {
            $parts[] = "Special requests: {$specialRequests}.";
        }

        return implode(' ', $parts);
    }

    private function extractVoiceText(array $payload): string
    {
        $candidates = [
            $payload['voice_text']   ?? null,
            $payload['summary']      ?? null,
            $payload['description']  ?? null,
            $payload['reply']        ?? null,
            $payload['message']      ?? null,
        ];

        foreach ($candidates as $candidate) {
            $text = trim((string) $candidate);
            if ($text !== '') {
                return $text;
            }
        }

        // Try nested structures
        foreach (['package', 'result', 'data'] as $key) {
            $sub = $payload[$key] ?? null;
            if (is_string($sub) && trim($sub) !== '') {
                return trim($sub);
            }
            if (is_array($sub)) {
                foreach (['voice_text', 'summary', 'description'] as $subKey) {
                    $text = trim((string) ($sub[$subKey] ?? ''));
                    if ($text !== '') {
                        return $text;
                    }
                }
            }
        }

        return 'A package has been prepared. We will send the details via WhatsApp shortly.';
    }
}
