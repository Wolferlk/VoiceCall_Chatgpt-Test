<?php

namespace App\Http\Controllers;

use App\Models\ServiceCall;
use App\Services\FourVChatGptAssisService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Throwable;

class FourVChatGptAssisPackageStatusController extends Controller
{
    public function __invoke(Request $request, FourVChatGptAssisService $service): JsonResponse
    {
        $validated = $request->validate([
            'call_id' => ['required', 'string', 'exists:service_calls,call_id'],
        ]);

        $call = ServiceCall::query()->where('call_id', $validated['call_id'])->firstOrFail();
        $history = is_array($call->conversation_history) ? $call->conversation_history : [];
        $customerProfile = is_array($call->customer_profile) ? $call->customer_profile : [];
        $serviceCategories = is_array($call->service_categories) ? $call->service_categories : [];
        $status = trim((string) ($customerProfile['package_lookup_status'] ?? ''));

        try {
            if (in_array($status, ['failed', 'api_unavailable'], true)) {
                $reply = $service->buildPackageFailureCallbackReply();
                $speech = $service->synthesizeSpeechForProfile($reply, $customerProfile);
                $history[] = ['role' => 'assistant', 'content' => $reply];
                $customerProfile['package_lookup_status'] = 'api_unavailable';
                $customerProfile['package_state'] = 'api_unavailable';

                $call->forceFill([
                    'conversation_history' => $history,
                    'customer_profile' => $customerProfile,
                ])->save();

                return response()->json([
                    'call_id' => $call->call_id,
                    'voice_label' => $service->getVoiceLabel($customerProfile),
                    'package_lookup_status' => 'api_unavailable',
                    'ready' => false,
                    'failed' => true,
                    'package_lookup_error' => $customerProfile['package_lookup_error'] ?? 'The Aahaas package service is not available right now.',
                    'reply' => $reply,
                    'audio_base64' => base64_encode($speech['body']),
                    'audio_mime_type' => $speech['mime_type'],
                    'conversation' => $history,
                    'customer_profile' => $customerProfile,
                    'service_categories' => $serviceCategories,
                    'should_end' => false,
                    'ended_reason' => '',
                ]);
            }

            if (
                $status === 'ready'
                && isset($customerProfile['suggested_package'])
            ) {
                $reply = $service->formatPackageOfferReply($customerProfile['suggested_package']);
                $speech = $service->synthesizeSpeechForProfile($reply, $customerProfile);
                $history[] = ['role' => 'assistant', 'content' => $reply];
                $customerProfile['package_lookup_status'] = 'presented';
                $customerProfile['package_state'] = 'offered';

                $call->forceFill([
                    'conversation_history' => $history,
                    'customer_profile' => $customerProfile,
                ])->save();

                return response()->json([
                    'call_id' => $call->call_id,
                    'voice_label' => $service->getVoiceLabel($customerProfile),
                    'package_lookup_status' => 'presented',
                    'ready' => true,
                    'failed' => false,
                    'package_lookup_error' => '',
                    'reply' => $reply,
                    'audio_base64' => base64_encode($speech['body']),
                    'audio_mime_type' => $speech['mime_type'],
                    'conversation' => $history,
                    'customer_profile' => $customerProfile,
                    'service_categories' => $serviceCategories,
                    'should_end' => false,
                    'ended_reason' => '',
                ]);
            }

            return response()->json([
                'call_id' => $call->call_id,
                'voice_label' => $service->getVoiceLabel($customerProfile),
                'package_lookup_status' => $status,
                'ready' => false,
                'failed' => false,
                'package_lookup_error' => $customerProfile['package_lookup_error'] ?? '',
                'should_end' => false,
                'ended_reason' => '',
            ]);
        } catch (Throwable $throwable) {
            $responseStatus = $throwable->getCode();

            return response()->json([
                'message' => $throwable->getMessage() !== '' ? $throwable->getMessage() : 'Package status check failed.',
            ], is_int($responseStatus) && $responseStatus >= 400 && $responseStatus < 600 ? $responseStatus : 500);
        }
    }
}
