<?php

namespace App\Http\Controllers;

use App\Models\ServiceCall;
use App\Models\TripPlan;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class RecordsListController extends Controller
{
    public function __invoke(Request $request): JsonResponse
    {
        $type = trim((string) $request->query('type', 'all'));
        $search = trim((string) $request->query('search', ''));
        $records = [];

        if ($type === 'all' || $type === 'service_calls') {
            $serviceCalls = ServiceCall::query()
                ->where('call_id', 'not like', 'CHAT-%')
                ->when($search !== '', function ($query) use ($search): void {
                    $query->where('call_id', 'like', "%{$search}%")
                        ->orWhere('status', 'like', "%{$search}%")
                        ->orWhere('latest_report', 'like', "%{$search}%")
                        ->orWhere('final_report', 'like', "%{$search}%");
                })
                ->latest('created_at')
                ->limit(100)
                ->get()
                ->map(fn (ServiceCall $call): array => [
                    'record_type' => 'service_call',
                    'id' => $call->id,
                    'public_id' => $call->call_id,
                    'status' => $call->status,
                    'summary' => $call->latest_report ?: 'No summary yet.',
                    'categories' => $call->service_categories ?: [],
                    'started_at' => optional($call->started_at)?->toIso8601String(),
                    'ended_at' => optional($call->ended_at)?->toIso8601String(),
                    'created_at' => optional($call->created_at)?->toIso8601String(),
                ])
                ->all();

            $records = array_merge($records, $serviceCalls);
        }

        if ($type === 'all' || $type === 'chatbot_sessions') {
            $chatbotSessions = ServiceCall::query()
                ->where('call_id', 'like', 'CHAT-%')
                ->when($search !== '', function ($query) use ($search): void {
                    $query->where('call_id', 'like', "%{$search}%")
                        ->orWhere('status', 'like', "%{$search}%")
                        ->orWhere('latest_report', 'like', "%{$search}%");
                })
                ->latest('created_at')
                ->limit(100)
                ->get()
                ->map(fn (ServiceCall $call): array => [
                    'record_type' => 'chatbot_session',
                    'id' => $call->id,
                    'public_id' => $call->call_id,
                    'status' => $call->status,
                    'summary' => $call->latest_report ?: 'No summary yet.',
                    'categories' => $call->service_categories ?: [],
                    'started_at' => optional($call->started_at)?->toIso8601String(),
                    'ended_at' => optional($call->ended_at)?->toIso8601String(),
                    'created_at' => optional($call->created_at)?->toIso8601String(),
                ])
                ->all();

            $records = array_merge($records, $chatbotSessions);
        }

        if ($type === 'all' || $type === 'trip_plans') {
            $tripPlans = TripPlan::query()
                ->when($search !== '', function ($query) use ($search): void {
                    $query->where('plan_id', 'like', "%{$search}%")
                        ->orWhere('status', 'like', "%{$search}%")
                        ->orWhere('latest_summary', 'like', "%{$search}%")
                        ->orWhere('final_summary', 'like', "%{$search}%");
                })
                ->latest('created_at')
                ->limit(100)
                ->get()
                ->map(fn (TripPlan $plan): array => [
                    'record_type' => 'trip_plan',
                    'id' => $plan->id,
                    'public_id' => $plan->plan_id,
                    'status' => $plan->status,
                    'summary' => $plan->latest_summary ?: 'No summary yet.',
                    'categories' => [],
                    'started_at' => optional($plan->started_at)?->toIso8601String(),
                    'ended_at' => optional($plan->ended_at)?->toIso8601String(),
                    'created_at' => optional($plan->created_at)?->toIso8601String(),
                ])
                ->all();

            $records = array_merge($records, $tripPlans);
        }

        usort($records, function (array $left, array $right): int {
            return strcmp($right['created_at'] ?? '', $left['created_at'] ?? '');
        });

        return response()->json([
            'records' => $records,
        ]);
    }
}
