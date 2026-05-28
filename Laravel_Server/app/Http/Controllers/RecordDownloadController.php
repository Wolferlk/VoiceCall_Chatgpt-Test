<?php

namespace App\Http\Controllers;

use App\Models\ServiceCall;
use App\Models\TripPlan;
use Symfony\Component\HttpFoundation\StreamedResponse;

class RecordDownloadController extends Controller
{
    public function __invoke(string $recordType, string $publicId): StreamedResponse
    {
        if ($recordType === 'service_call') {
            $call = ServiceCall::query()->where('call_id', $publicId)->firstOrFail();
            $payload = [
                'record_type' => 'service_call',
                'call_id' => $call->call_id,
                'status' => $call->status,
                'customer_profile' => $call->customer_profile,
                'service_categories' => $call->service_categories,
                'conversation_history' => $call->conversation_history,
                'latest_report' => $call->latest_report,
                'final_report' => $this->decodeIfJson($call->final_report),
                'started_at' => optional($call->started_at)?->toIso8601String(),
                'ended_at' => optional($call->ended_at)?->toIso8601String(),
                'ended_reason' => $call->ended_reason,
                'created_at' => optional($call->created_at)?->toIso8601String(),
            ];

            return $this->jsonDownload("service-call-{$call->call_id}.json", $payload);
        }

        if ($recordType === 'trip_plan') {
            $plan = TripPlan::query()->where('plan_id', $publicId)->firstOrFail();
            $payload = [
                'record_type' => 'trip_plan',
                'plan_id' => $plan->plan_id,
                'status' => $plan->status,
                'conversation_history' => $plan->conversation_history,
                'latest_summary' => $plan->latest_summary,
                'final_summary' => $plan->final_summary,
                'started_at' => optional($plan->started_at)?->toIso8601String(),
                'ended_at' => optional($plan->ended_at)?->toIso8601String(),
                'created_at' => optional($plan->created_at)?->toIso8601String(),
            ];

            return $this->jsonDownload("trip-plan-{$plan->plan_id}.json", $payload);
        }

        abort(404);
    }

    private function jsonDownload(string $filename, array $payload): StreamedResponse
    {
        return response()->streamDownload(function () use ($payload): void {
            echo json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
        }, $filename, [
            'Content-Type' => 'application/json',
        ]);
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
