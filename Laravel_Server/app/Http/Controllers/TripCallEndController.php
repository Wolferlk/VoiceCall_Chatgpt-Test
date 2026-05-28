<?php

namespace App\Http\Controllers;

use App\Models\TripPlan;
use App\Services\TripCallService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Throwable;

class TripCallEndController extends Controller
{
    public function __invoke(Request $request, TripCallService $tripCallService): JsonResponse
    {
        $validated = $request->validate([
            'plan_id' => ['required', 'string', 'exists:trip_plans,plan_id'],
        ]);

        $plan = TripPlan::query()->where('plan_id', $validated['plan_id'])->firstOrFail();
        $history = is_array($plan->conversation_history) ? $plan->conversation_history : [];

        try {
            $summary = $tripCallService->summarizeTripPlan($history);
            $closingMessage = $tripCallService->buildClosingMessage($plan->plan_id);
            $closingAudio = $tripCallService->synthesizeSpeech($closingMessage);

            $plan->forceFill([
                'status' => 'completed',
                'latest_summary' => $summary,
                'final_summary' => $summary,
                'ended_at' => now(),
            ])->save();

            return response()->json([
                'plan_id' => $plan->plan_id,
                'status' => $plan->status,
                'summary' => $summary,
                'closing_message' => $closingMessage,
                'audio_base64' => base64_encode($closingAudio['body']),
                'audio_mime_type' => $closingAudio['mime_type'],
            ]);
        } catch (Throwable $throwable) {
            $status = $throwable->getCode();

            return response()->json([
                'message' => $throwable->getMessage() !== '' ? $throwable->getMessage() : 'Trip call could not be completed.',
            ], is_int($status) && $status >= 400 && $status < 600 ? $status : 500);
        }
    }
}
