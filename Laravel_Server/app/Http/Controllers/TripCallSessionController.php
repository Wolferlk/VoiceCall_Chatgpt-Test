<?php

namespace App\Http\Controllers;

use App\Models\TripPlan;
use App\Services\TripCallService;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Str;
use Throwable;

class TripCallSessionController extends Controller
{
    public function __invoke(TripCallService $tripCallService): JsonResponse
    {
        try {
            $plan = TripPlan::create([
                'plan_id' => (string) Str::uuid(),
                'status' => 'active',
                'conversation_history' => [],
                'started_at' => now(),
            ]);

            $greeting = $tripCallService->buildGreetingMessage();
            $holdMessage = $tripCallService->buildHoldMessage();
            $greetingAudio = $tripCallService->synthesizeSpeech($greeting);
            $holdAudio = $tripCallService->synthesizeSpeech(
                $holdMessage,
                'Speak calmly and reassuringly like a travel support agent while the caller waits.'
            );

            return response()->json([
                'plan_id' => $plan->plan_id,
                'status' => $plan->status,
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
                'message' => $throwable->getMessage() !== '' ? $throwable->getMessage() : 'Trip call session could not be started.',
            ], is_int($status) && $status >= 400 && $status < 600 ? $status : 500);
        }
    }
}
