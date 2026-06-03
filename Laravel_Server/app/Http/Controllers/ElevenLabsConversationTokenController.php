<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Http;

class ElevenLabsConversationTokenController extends Controller
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

        if (empty($apiKey)) {
            return response()->json(['error' => 'ELEVENLABS_API_KEY is not configured.'], 400);
        }

        $response = Http::withHeaders(['xi-api-key' => $apiKey])
            ->timeout(15)
            ->get('https://api.elevenlabs.io/v1/convai/conversation/token', [
                'agent_id' => $agentId,
                'environment' => env('ELEVENLABS_ENVIRONMENT', 'production'),
            ]);

        if ($response->ok()) {
            return response()->json(['conversation_token' => $response->json('token')]);
        }

        return response()->json(
            ['error' => 'ElevenLabs: ' . $response->body()],
            502
        );
    }
}
