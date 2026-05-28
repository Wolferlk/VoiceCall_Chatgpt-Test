<?php

namespace App\Http\Controllers;

use App\Services\VoiceAgentService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Throwable;

class AiCallController extends Controller
{
    public function __invoke(Request $request, VoiceAgentService $voiceAgent): JsonResponse
    {
        $validated = $request->validate([
            'audio' => ['required', 'file', 'max:25600'],
            'history' => ['nullable', 'string'],
        ]);

        $history = $this->decodeHistory($validated['history'] ?? null);

        try {
            $transcript = $voiceAgent->transcribeAudio($request->file('audio'));
            $reply = $voiceAgent->generateReply($transcript, $history);
            $speech = $voiceAgent->synthesizeSpeech($reply);

            return response()->json([
                'transcript' => $transcript,
                'reply' => $reply,
                'audio_base64' => base64_encode($speech['body']),
                'audio_mime_type' => $speech['mime_type'],
            ]);
        } catch (Throwable $throwable) {
            $status = $throwable->getCode();

            return response()->json([
                'message' => $throwable->getMessage() !== '' ? $throwable->getMessage() : 'AI call request failed.',
            ], is_int($status) && $status >= 400 && $status < 600 ? $status : 500);
        }
    }

    private function decodeHistory(?string $history): array
    {
        if (! is_string($history) || trim($history) === '') {
            return [];
        }

        $decoded = json_decode($history, true);

        return is_array($decoded) ? $decoded : [];
    }
}
