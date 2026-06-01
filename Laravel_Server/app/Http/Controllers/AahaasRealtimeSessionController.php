<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

/**
 * Proxies the WebRTC SDP handshake between the browser and OpenAI Realtime.
 *
 * The client POSTs its raw SDP offer as text/plain (no JSON wrapper).
 * We forward it to OpenAI with the real API key and return the SDP answer.
 * This avoids any JSON serialisation issues with multi-line SDP strings.
 */
class AahaasRealtimeSessionController extends Controller
{
    private const REALTIME_MODEL = 'gpt-realtime-2';

    public function __invoke(Request $request): JsonResponse
    {
        $openAiApiKey = env('OPENAI_API_KEY', '');

        if ($openAiApiKey === '') {
            return response()->json(['message' => 'OpenAI API key is not configured.'], 500);
        }

        // Read the raw SDP body — no JSON parsing, no risk of control-char corruption.
        $sdpOffer = $request->getContent();
        $voice    = $request->query('voice', env('OPENAI_VOICE_NAME', 'coral'));

        Log::debug('AahaasRealtime: received SDP', [
            'bytes'    => strlen($sdpOffer),
            'has_crlf' => strpos($sdpOffer, "\r\n") !== false,
            'preview'  => substr($sdpOffer, 0, 60),
        ]);

        if (trim($sdpOffer) === '') {
            Log::error('AahaasRealtime: empty SDP offer received');
            return response()->json(['message' => 'SDP offer body is empty.'], 400);
        }

        // Ensure CRLF line endings (RFC 4566).
        // Only convert if the SDP uses bare LF — browsers already produce CRLF,
        // and the chained str_replace approach doubles every existing CRLF pair.
        if (strpos($sdpOffer, "\r\n") === false) {
            $sdpOffer = str_replace("\n", "\r\n", $sdpOffer);
        }

        $endpoint = 'https://api.openai.com/v1/realtime?model=' . self::REALTIME_MODEL;

        // Use raw cURL for exact control — avoids Guzzle/Laravel Http client
        // body-encoding conflicts with non-JSON content types.
        $ch = curl_init($endpoint);
        curl_setopt_array($ch, [
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => $sdpOffer,
            CURLOPT_HTTPHEADER     => [
                'Authorization: Bearer ' . $openAiApiKey,
                'Content-Type: application/sdp',
                'Content-Length: ' . strlen($sdpOffer),
            ],
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 30,
            CURLOPT_SSL_VERIFYPEER => true,
        ]);

        $responseBody = (string) curl_exec($ch);
        $httpCode     = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlError    = curl_error($ch);

        if ($curlError !== '') {
            Log::error('AahaasRealtime: cURL error', ['error' => $curlError]);
            return response()->json(['message' => 'Could not reach OpenAI Realtime.'], 500);
        }

        if ($httpCode < 200 || $httpCode >= 300) {
            Log::error('AahaasRealtime: SDP exchange failed', [
                'status' => $httpCode,
                'body'   => substr($responseBody, 0, 500),
            ]);
            return response()->json([
                'message' => 'OpenAI Realtime SDP exchange failed: ' . substr($responseBody, 0, 300),
            ], 500);
        }

        Log::info('AahaasRealtime: SDP exchange OK', ['model' => self::REALTIME_MODEL]);

        return response()->json(['sdp' => $responseBody]);
    }
}
