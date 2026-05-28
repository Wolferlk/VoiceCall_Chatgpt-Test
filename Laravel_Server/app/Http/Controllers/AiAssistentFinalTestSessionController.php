<?php

namespace App\Http\Controllers;

use App\Models\ServiceCall;
use App\Services\AiAssistentFinalTestService;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Str;
use Throwable;

class AiAssistentFinalTestSessionController extends Controller
{
    public function __invoke(AiAssistentFinalTestService $service): JsonResponse
    {
        try {
            $call = ServiceCall::create([
                'call_id' => 'CALL-' . strtoupper(Str::random(10)),
                'status' => 'active',
                'customer_profile' => ['package_state' => 'not_started'],
                'service_categories' => [],
                'conversation_history' => [],
                'started_at' => now(),
            ]);

            $greeting = $service->buildGreeting($call->call_id);
            $holdMessage = $service->buildHoldMessage();
            $greetingAudio = $service->synthesizeSpeech($greeting);
            $holdAudio = $service->synthesizeSpeech($holdMessage);

            $call->forceFill([
                'conversation_history' => [
                    ['role' => 'assistant', 'content' => $greeting],
                ],
            ])->save();

            return response()->json([
                'call_id' => $call->call_id,
                'status' => $call->status,
                'greeting' => $greeting,
                'greeting_audio_base64' => base64_encode($greetingAudio['body']),
                'greeting_audio_mime_type' => $greetingAudio['mime_type'],
                'hold_message' => $holdMessage,
                'hold_audio_base64' => base64_encode($holdAudio['body']),
                'hold_audio_mime_type' => $holdAudio['mime_type'],
            ]);
        } catch (Throwable $throwable) {
            $status = $throwable->getCode();

            return response()->json([
                'message' => $throwable->getMessage() !== '' ? $throwable->getMessage() : 'AI ASSISTENT FINAL TEST session could not be started.',
            ], is_int($status) && $status >= 400 && $status < 600 ? $status : 500);
        }
    }
}
