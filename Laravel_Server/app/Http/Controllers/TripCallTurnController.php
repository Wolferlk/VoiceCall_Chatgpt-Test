<?php

namespace App\Http\Controllers;

use App\Models\TripPlan;
use App\Services\TripCallService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Throwable;

class TripCallTurnController extends Controller
{
    public function __invoke(Request $request, TripCallService $tripCallService): JsonResponse
    {
        $validated = $request->validate([
            'plan_id' => ['required', 'string', 'exists:trip_plans,plan_id'],
            'audio' => ['required', 'file', 'max:25600'],
        ]);

        $plan = TripPlan::query()->where('plan_id', $validated['plan_id'])->firstOrFail();
        $history = is_array($plan->conversation_history) ? $plan->conversation_history : [];

        try {
            $transcript = $tripCallService->transcribeAudio($request->file('audio'));
            $reply = $tripCallService->generateTripReply($transcript, $history);
            $speech = $tripCallService->synthesizeSpeech($reply);

            $history[] = ['role' => 'user', 'content' => $transcript];
            $history[] = ['role' => 'assistant', 'content' => $reply];

            $plan->forceFill([
                'conversation_history' => $history,
            ])->save();

            return response()->json([
                'plan_id' => $plan->plan_id,
                'transcript' => $transcript,
                'reply' => $reply,
                'audio_base64' => base64_encode($speech['body']),
                'audio_mime_type' => $speech['mime_type'],
                'conversation' => $history,
            ]);
        } catch (Throwable $throwable) {
            $status = $throwable->getCode();

            return response()->json([
                'message' => $throwable->getMessage() !== '' ? $throwable->getMessage() : 'Trip call turn failed.',
            ], is_int($status) && $status >= 400 && $status < 600 ? $status : 500);
        }
    }
}
