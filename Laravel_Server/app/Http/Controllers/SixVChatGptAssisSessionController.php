<?php

namespace App\Http\Controllers;

use App\Models\ServiceCall;
use App\Services\FiveVChatGptAssisService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Throwable;

class FiveVChatGptAssisSessionController extends Controller
{
    public function __invoke(Request $request, FiveVChatGptAssisService $service): JsonResponse
    {
        try {
            $validated = $request->validate([
                'voice' => ['nullable', 'string'],
                'speech_speed' => ['nullable', 'numeric'],
            ]);

            $customerProfile = $service->initializeCustomerProfile(
                $validated['voice'] ?? null,
                isset($validated['speech_speed']) ? (float) $validated['speech_speed'] : null
            );
            $call = ServiceCall::create([
                'call_id' => 'CALL-' . strtoupper(Str::random(10)),
                'status' => 'active',
                'customer_profile' => $customerProfile,
                'service_categories' => [],
                'conversation_history' => [],
                'started_at' => now(),
            ]);

            $greeting = $service->buildGreeting($call->call_id);
            $holdMessage = $service->buildHoldMessage();
            $greetingAudio = $service->synthesizeSpeechForProfile($greeting, $customerProfile);
            $holdAudio = $service->synthesizeSpeechForProfile($holdMessage, $customerProfile);

            $call->forceFill([
                'conversation_history' => [
                    ['role' => 'assistant', 'content' => $greeting],
                ],
            ])->save();

            return response()->json([
                'call_id' => $call->call_id,
                'status' => $call->status,
                'greeting' => $greeting,
                'voice_label' => $service->getVoiceLabel($customerProfile),
                'greeting_audio_base64' => base64_encode($greetingAudio['body']),
                'greeting_audio_mime_type' => $greetingAudio['mime_type'],
                'hold_message' => $holdMessage,
                'hold_audio_base64' => base64_encode($holdAudio['body']),
                'hold_audio_mime_type' => $holdAudio['mime_type'],
            ]);
        } catch (Throwable $throwable) {
            $status = $throwable->getCode();

            return response()->json([
                'message' => $throwable->getMessage() !== '' ? $throwable->getMessage() : '5v ChatGPT ASSIS session could not start.',
            ], is_int($status) && $status >= 400 && $status < 600 ? $status : 500);
        }
    }
}
