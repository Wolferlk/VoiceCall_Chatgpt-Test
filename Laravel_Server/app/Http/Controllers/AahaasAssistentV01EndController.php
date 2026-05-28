<?php

namespace App\Http\Controllers;

use App\Jobs\SendWhatsAppQuotationJob;
use App\Models\ServiceCall;
use App\Services\AahaasAssistentV01Service;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Throwable;

class AahaasAssistentV01EndController extends Controller
{
    public function __invoke(Request $request, AahaasAssistentV01Service $service): JsonResponse
    {
        set_time_limit(300);

        $validated = $request->validate([
            'call_id'      => ['required', 'string', 'exists:service_calls,call_id'],
            'ended_reason' => ['nullable', 'string'],
            'voice_name'   => ['nullable', 'string'],
            'voice_speed'  => ['nullable', 'numeric', 'min:0.25', 'max:4.0'],
        ]);

        $voiceName  = trim((string) ($validated['voice_name'] ?? 'coral')) ?: 'coral';
        $voiceSpeed = (float) ($validated['voice_speed'] ?? 1.0);
        $service->setVoiceConfig($voiceName, $voiceSpeed);

        $call              = ServiceCall::query()->where('call_id', $validated['call_id'])->firstOrFail();
        $history           = is_array($call->conversation_history) ? $call->conversation_history : [];
        $customerProfile   = is_array($call->customer_profile) ? $call->customer_profile : [];
        $serviceCategories = is_array($call->service_categories) ? $call->service_categories : [];

        try {
            $report      = $service->buildFinalReport($history, $customerProfile, $serviceCategories);
            $endedReason = trim((string) ($validated['ended_reason'] ?? 'completed'));

            $closingMessage = $endedReason === 'package_api_unavailable'
                ? $service->buildPackageFailureCallbackReply()
                : $service->buildClosingMessage();
            $closingAudio = $service->synthesizeSpeech($closingMessage);

            $finalProfile = array_filter(
                array_merge($customerProfile, $report['customer_profile'] ?: []),
                fn ($v) => $v !== null && $v !== ''
            );
            $finalCategories = array_values(array_unique(array_merge(
                $serviceCategories,
                $report['service_categories'] ?: []
            )));

            // Dispatch WhatsApp quotation as a background job so it doesn't block the response
            $quotationQueued = false;
            if ($service->hasQuotationContacts($finalProfile)) {
                SendWhatsAppQuotationJob::dispatch(
                    $call->call_id,
                    $finalProfile,
                    $report,
                    $finalCategories
                )->onQueue('aahaas-wa');
                $quotationQueued = true;
            }

            $call->forceFill([
                'status'             => 'completed',
                'final_report'       => json_encode($report, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES),
                'latest_report'      => $report['summary'] ?? $call->latest_report,
                'ended_at'           => now(),
                'ended_reason'       => $endedReason,
                'customer_profile'   => $finalProfile,
                'service_categories' => $finalCategories,
            ])->save();

            return response()->json([
                'call_id'           => $call->call_id,
                'status'            => $call->status,
                'report'            => $report,
                'closing_message'   => $closingMessage,
                'audio_base64'      => base64_encode($closingAudio['body']),
                'audio_mime_type'   => $closingAudio['mime_type'],
                'quotation_queued'  => $quotationQueued,
            ]);
        } catch (Throwable $throwable) {
            $status = $throwable->getCode();

            return response()->json([
                'message' => $throwable->getMessage() !== '' ? $throwable->getMessage() : 'Aahaas Assistent V01 call could not be completed.',
            ], is_int($status) && $status >= 400 && $status < 600 ? $status : 500);
        }
    }
}
