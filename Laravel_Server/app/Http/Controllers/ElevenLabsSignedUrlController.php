<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Http;

class ElevenLabsSignedUrlController extends Controller
{
    public function __invoke(): JsonResponse
    {
        $apiKey  = env('ELEVENLABS_API_KEY', '');
        $agentId = env('ELEVENLABS_AGENT_ID', '');

        if (empty($agentId)) {
            return response()->json(
                ['error' => 'ELEVENLABS_AGENT_ID is not configured on the server.'],
                400
            );
        }

        $response = Http::withHeaders(['xi-api-key' => $apiKey])
            ->timeout(15)
            ->post('https://api.elevenlabs.io/v1/convai/conversation/get_signed_url', [
                'agent_id' => $agentId,
            ]);

        if (! $response->ok()) {
            return response()->json(
                ['error' => 'ElevenLabs returned an error: ' . $response->body()],
                502
            );
        }

        return response()->json(['signed_url' => $response->json('signed_url')]);
    }
}
