<?php

namespace App\Http\Controllers;

use App\Models\ServiceCall;
use App\Services\ReceptionCallService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Throwable;

class ReceptionCallEndController extends Controller
{
    public function __invoke(Request $request, ReceptionCallService $service): JsonResponse
    {
        $validated = $request->validate([
            'call_id' => ['required', 'string', 'exists:service_calls,call_id'],
            'ended_reason' => ['nullable', 'string'],
        ]);

        $call = ServiceCall::query()->where('call_id', $validated['call_id'])->firstOrFail();
        $history = is_array($call->conversation_history) ? $call->conversation_history : [];
        $customerProfile = is_array($call->customer_profile) ? $call->customer_profile : [];
        $serviceCategories = is_array($call->service_categories) ? $call->service_categories : [];

        try {
            $report = $service->buildFinalReport($history, $customerProfile, $serviceCategories);
            $closingMessage = $service->buildClosingMessage();
            $closingAudio = $service->synthesizeSpeech($closingMessage);

            $call->forceFill([
                'status' => 'completed',
                'final_report' => json_encode($report, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES),
                'latest_report' => $report['summary'] ?? $call->latest_report,
                'ended_at' => now(),
                'ended_reason' => trim((string) ($validated['ended_reason'] ?? 'completed')),
                'customer_profile' => $report['customer_profile'] ?: $customerProfile,
                'service_categories' => $report['service_categories'] ?: $serviceCategories,
            ])->save();

            return response()->json([
                'call_id' => $call->call_id,
                'status' => $call->status,
                'report' => $report,
                'closing_message' => $closingMessage,
                'audio_base64' => base64_encode($closingAudio['body']),
                'audio_mime_type' => $closingAudio['mime_type'],
            ]);
        } catch (Throwable $throwable) {
            $status = $throwable->getCode();

            return response()->json([
                'message' => $throwable->getMessage() !== '' ? $throwable->getMessage() : 'Reception call could not be completed.',
            ], is_int($status) && $status >= 400 && $status < 600 ? $status : 500);
        }
    }
}
