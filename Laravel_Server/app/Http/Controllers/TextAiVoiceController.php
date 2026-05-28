<?php

namespace App\Http\Controllers;

use App\Services\VoiceAgentService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Throwable;

class TextAiVoiceController extends Controller
{
    public function __invoke(Request $request, VoiceAgentService $voiceAgent): JsonResponse
    {
        $validated = $request->validate([
            'text' => ['required', 'string'],
            'history' => ['nullable', 'array'],
        ]);

        $text = trim($validated['text']);

        if ($text === '') {
            return response()->json([
                'message' => 'Text is required for AI voice chat.',
            ], 422);
        }

        try {
            $reply = $voiceAgent->generateReply(
                $text,
                $validated['history'] ?? [],
                env(
                    'OPENAI_TEXT_VOICE_SYSTEM_PROMPT',
                    'You are a helpful AI voice assistant. Reply naturally, clearly, and briefly so the answer sounds smooth when spoken aloud.'
                )
            );
            $speech = $voiceAgent->synthesizeSpeech($reply);

            return response()->json([
                'text' => $text,
                'reply' => $reply,
                'audio_base64' => base64_encode($speech['body']),
                'audio_mime_type' => $speech['mime_type'],
            ]);
        } catch (Throwable $throwable) {
            $status = $throwable->getCode();

            return response()->json([
                'message' => $throwable->getMessage() !== '' ? $throwable->getMessage() : 'AI text voice request failed.',
            ], is_int($status) && $status >= 400 && $status < 600 ? $status : 500);
        }
    }
}
