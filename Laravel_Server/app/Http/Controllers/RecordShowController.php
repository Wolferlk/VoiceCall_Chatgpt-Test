<?php

namespace App\Http\Controllers;

use App\Models\ServiceCall;
use App\Models\TripPlan;
use Illuminate\Http\JsonResponse;

class RecordShowController extends Controller
{
    public function __invoke(string $recordType, string $publicId): JsonResponse
    {
        if ($recordType === 'service_call' || $recordType === 'chatbot_session') {
            $call = ServiceCall::query()->where('call_id', $publicId)->firstOrFail();

            return response()->json([
                'record_type' => 'service_call',
                'record' => [
                    'id' => $call->id,
                    'public_id' => $call->call_id,
                    'status' => $call->status,
                    'customer_profile' => $call->customer_profile ?: [],
                    'service_categories' => $call->service_categories ?: [],
                    'conversation_history' => $call->conversation_history ?: [],
                    'latest_report' => $call->latest_report,
                    'final_report' => $this->decodeIfJson($call->final_report),
                    'started_at' => optional($call->started_at)?->toIso8601String(),
                    'ended_at' => optional($call->ended_at)?->toIso8601String(),
                    'ended_reason' => $call->ended_reason,
                    'created_at' => optional($call->created_at)?->toIso8601String(),
                ],
            ]);
        }

        if ($recordType === 'trip_plan') {
            $plan = TripPlan::query()->where('plan_id', $publicId)->firstOrFail();

            return response()->json([
                'record_type' => 'trip_plan',
                'record' => [
                    'id' => $plan->id,
                    'public_id' => $plan->plan_id,
                    'status' => $plan->status,
                    'conversation_history' => $plan->conversation_history ?: [],
                    'latest_summary' => $plan->latest_summary,
                    'final_summary' => $plan->final_summary,
                    'started_at' => optional($plan->started_at)?->toIso8601String(),
                    'ended_at' => optional($plan->ended_at)?->toIso8601String(),
                    'created_at' => optional($plan->created_at)?->toIso8601String(),
                ],
            ]);
        }

        abort(404);
    }

    private function decodeIfJson(?string $value): mixed
    {
        if (! is_string($value) || trim($value) === '') {
            return $value;
        }

        $decoded = json_decode($value, true);

        return json_last_error() === JSON_ERROR_NONE ? $decoded : $value;
    }
}
