<?php

namespace App\Http\Controllers;

use App\Models\ServiceCall;
use App\Services\AahaasAssistentV01Service;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Throwable;

class AahaasAssistentV01PackageStatusController extends Controller
{
    public function __invoke(Request $request, AahaasAssistentV01Service $service): JsonResponse
    {
        set_time_limit(300);

        $validated = $request->validate([
            'call_id'     => ['required', 'string', 'exists:service_calls,call_id'],
            'voice_name'  => ['nullable', 'string'],
            'voice_speed' => ['nullable', 'numeric', 'min:0.25', 'max:4.0'],
        ]);

        $voiceName  = trim((string) ($validated['voice_name'] ?? 'coral')) ?: 'coral';
        $voiceSpeed = (float) ($validated['voice_speed'] ?? 1.0);
        $service->setVoiceConfig($voiceName, $voiceSpeed);

        $call              = ServiceCall::query()->where('call_id', $validated['call_id'])->firstOrFail();
        $history           = is_array($call->conversation_history) ? $call->conversation_history : [];
        $customerProfile   = is_array($call->customer_profile) ? $call->customer_profile : [];
        $serviceCategories = is_array($call->service_categories) ? $call->service_categories : [];
        $status            = trim((string) ($customerProfile['package_lookup_status'] ?? ''));

        try {
            if (in_array($status, ['failed', 'api_unavailable'], true)) {
                $reply  = $service->buildPackageFailureCallbackReply();
                $speech = $service->synthesizeSpeech($reply);
                $history[] = ['role' => 'assistant', 'content' => $reply];
                $customerProfile['package_lookup_status'] = 'api_unavailable';
                $customerProfile['package_state']         = 'api_unavailable';

                $call->forceFill([
                    'conversation_history' => $history,
                    'customer_profile'     => $customerProfile,
                ])->save();

                return response()->json([
                    'call_id'               => $call->call_id,
                    'package_lookup_status' => 'api_unavailable',
                    'ready'                 => false,
                    'failed'                => true,
                    'package_lookup_error'  => $customerProfile['package_lookup_error'] ?? 'The Aahaas package service is not available right now.',
                    'reply'                 => $reply,
                    'audio_base64'          => base64_encode($speech['body']),
                    'audio_mime_type'       => $speech['mime_type'],
                    'conversation'          => $history,
                    'customer_profile'      => $customerProfile,
                    'service_categories'    => $serviceCategories,
                    'should_end'            => false,
                    'ended_reason'          => '',
                ]);
            }

            if (
                $status === 'ready'
                && isset($customerProfile['suggested_package'])
                && $service->hasRequiredContactDetails($customerProfile)
                && $service->hasEnoughTravelRequirements($customerProfile)
            ) {
                $reply  = $service->formatPackageOfferReply($customerProfile['suggested_package']);
                $speech = $service->synthesizeSpeech($reply);
                $history[] = ['role' => 'assistant', 'content' => $reply];
                $customerProfile['package_lookup_status'] = 'presented';
                $customerProfile['package_state']         = 'offered';

                $call->forceFill([
                    'conversation_history' => $history,
                    'customer_profile'     => $customerProfile,
                ])->save();

                return response()->json([
                    'call_id'               => $call->call_id,
                    'package_lookup_status' => 'presented',
                    'ready'                 => true,
                    'failed'                => false,
                    'package_lookup_error'  => '',
                    'reply'                 => $reply,
                    'audio_base64'          => base64_encode($speech['body']),
                    'audio_mime_type'       => $speech['mime_type'],
                    'conversation'          => $history,
                    'customer_profile'      => $customerProfile,
                    'service_categories'    => $serviceCategories,
                    'should_end'            => false,
                    'ended_reason'          => '',
                ]);
            }

            return response()->json([
                'call_id'               => $call->call_id,
                'package_lookup_status' => $status,
                'ready'                 => false,
                'failed'                => false,
                'package_lookup_error'  => $customerProfile['package_lookup_error'] ?? '',
                'should_end'            => false,
                'ended_reason'          => '',
            ]);
        } catch (Throwable $throwable) {
            $responseStatus = $throwable->getCode();

            return response()->json([
                'message' => $throwable->getMessage() !== '' ? $throwable->getMessage() : 'Package status check failed.',
            ], is_int($responseStatus) && $responseStatus >= 400 && $responseStatus < 600 ? $responseStatus : 500);
        }
    }
}
