<?php

namespace App\Http\Controllers;

use App\Services\VoiceAgentService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Throwable;

class TextToSpeechController extends Controller
{
    public function __invoke(Request $request, VoiceAgentService $voiceAgent): Response|JsonResponse
    {
        $validated = $request->validate([
            'text' => ['required', 'string'],
        ]);
        $text = trim($validated['text']);

        if ($text === '') {
            return response()->json([
                'message' => 'Text is required for speech synthesis.',
            ], 422);
        }

        try {
            $speech = $voiceAgent->synthesizeSpeech($text);
        } catch (Throwable $throwable) {
            $status = $throwable->getCode();

            return response()->json([
                'message' => $throwable->getMessage() !== '' ? $throwable->getMessage() : 'Speech generation failed.',
            ], is_int($status) && $status >= 400 && $status < 600 ? $status : 500);
        }

        return response($speech['body'], 200, [
            'Content-Type' => $speech['mime_type'],
            'Content-Length' => strlen($speech['body']),
        ]);
    }
}
