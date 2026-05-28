<?php

namespace App\Http\Controllers;

use App\Models\ServiceCall;
use App\Services\FiveVChatGptAssisService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Throwable;

class FiveVChatGptAssisTurnController extends Controller
{
    public function __invoke(Request $request, FiveVChatGptAssisService $service): JsonResponse
    {
        $validated = $request->validate([
            'call_id' => ['required', 'string', 'exists:service_calls,call_id'],
            'audio' => ['nullable', 'file', 'max:25600', 'required_without:transcript'],
            'transcript' => ['nullable', 'string', 'required_without:audio'],
        ]);

        $call = ServiceCall::query()->where('call_id', $validated['call_id'])->firstOrFail();
        $history = is_array($call->conversation_history) ? $call->conversation_history : [];
        $customerProfile = is_array($call->customer_profile) ? $call->customer_profile : [];
        $serviceCategories = is_array($call->service_categories) ? $call->service_categories : [];

        try {
            $transcript = trim((string) ($validated['transcript'] ?? ''));

            if ($transcript === '') {
                try {
                    $transcript = trim($service->transcribeAudio($request->file('audio')));
                } catch (Throwable $transcriptionError) {
                    $retryReply = $service->buildTranscriptionRecoveryReply();
                    $speech = $service->synthesizeSpeechForProfile($retryReply, $customerProfile);
                    $recoveryHistory = $history;
                    $recoveryHistory[] = ['role' => 'assistant', 'content' => $retryReply];

                    $call->forceFill([
                        'conversation_history' => $recoveryHistory,
                    ])->save();

                    return response()->json([
                        'call_id' => $call->call_id,
                        'transcript' => '',
                        'reply' => $retryReply,
                        'voice_label' => $service->getVoiceLabel($customerProfile),
                        'audio_base64' => base64_encode($speech['body']),
                        'audio_mime_type' => $speech['mime_type'],
                        'conversation' => $recoveryHistory,
                        'customer_profile' => $customerProfile,
                        'service_categories' => $serviceCategories,
                        'live_summary' => is_string($call->latest_report) ? $call->latest_report : '',
                        'should_end' => false,
                        'ended_reason' => '',
                    ]);
                }
            }

            if ($transcript === '__silent__' || mb_strlen($transcript) < 2) {
                $nudges = [
                    "Are you still with me? Please go ahead when you're ready.",
                    'Take your time. What would you like help with?',
                    "No rush. Please tell me a little more when you're ready.",
                ];
                $nudge = $nudges[array_rand($nudges)];
                $speech = $service->synthesizeSpeechForProfile($nudge, $customerProfile);

                return response()->json([
                    'call_id' => $call->call_id,
                    'transcript' => '',
                    'reply' => $nudge,
                    'voice_label' => $service->getVoiceLabel($customerProfile),
                    'audio_base64' => base64_encode($speech['body']),
                    'audio_mime_type' => $speech['mime_type'],
                    'conversation' => $history,
                    'customer_profile' => $customerProfile,
                    'service_categories' => $serviceCategories,
                    'live_summary' => is_string($call->latest_report) ? $call->latest_report : '',
                    'should_end' => false,
                    'ended_reason' => '',
                ]);
            }

            $history[] = ['role' => 'user', 'content' => $transcript];

            $turn = $service->generateTurn($history, $customerProfile, $serviceCategories);
            $mergedProfile = array_filter(array_merge($customerProfile, $turn['customer_profile']), fn ($value) => $value !== null && $value !== '');
            $mergedCategories = array_values(array_unique(array_merge($serviceCategories, $turn['service_categories'])));
            $reply = $turn['reply'];
            $packageState = trim((string) ($turn['package_confirmation_status'] ?? ''));
            $packageFeedback = $service->detectPackageFeedback($transcript);
            $packageHistory = is_array($mergedProfile['package_history'] ?? null) ? $mergedProfile['package_history'] : [];
            $packageLookupStatus = trim((string) ($mergedProfile['package_lookup_status'] ?? ''));
            $shouldForceEarlyPackageLookup = $service->looksLikeSearchableRequest($transcript);
            $isFirstMeaningfulRequest = count(array_filter($history, fn ($message) => ($message['role'] ?? null) === 'user')) === 1;

            if ($packageState !== '') {
                $mergedProfile['package_state'] = $packageState;
            }

            if (($mergedProfile['package_state'] ?? '') === 'offered' && $packageFeedback === 'accepted') {
                $mergedProfile['package_state'] = 'accepted';
                $packageHistory = $this->markLatestPackageHistoryStatus($packageHistory, 'accepted');
                $mergedProfile['package_history'] = $packageHistory;
                $turn['should_end'] = false;
                $turn['ended_reason'] = '';
            } elseif (($mergedProfile['package_state'] ?? '') === 'offered' && $packageFeedback === 'rejected') {
                $mergedProfile['package_state'] = 'rejected';
                $packageHistory = $this->markLatestPackageHistoryStatus($packageHistory, 'rejected');
                $mergedProfile['package_history'] = $packageHistory;
                unset($mergedProfile['suggested_package'], $mergedProfile['travel_package_prompt']);
                $turn['should_end'] = false;
                $turn['ended_reason'] = '';
            } elseif ($service->isTravelRelated($mergedCategories)) {
                if (in_array($packageLookupStatus, ['failed', 'api_unavailable'], true)) {
                    $reply = $service->buildPackageFailureCallbackReply();
                    $mergedProfile['package_state'] = 'api_unavailable';
                    $mergedProfile['package_lookup_status'] = 'api_unavailable';
                    $turn['should_end'] = false;
                    $turn['ended_reason'] = '';
                } elseif (
                    $packageLookupStatus === 'ready'
                    && isset($mergedProfile['suggested_package'])
                    && ($mergedProfile['package_state'] ?? '') !== 'offered'
                ) {
                    $packageReply = $service->formatPackageOfferReply($mergedProfile['suggested_package']);
                    $reply = $packageReply;
                    $mergedProfile['package_state'] = 'offered';
                    $mergedProfile['package_lookup_status'] = 'presented';
                    $mergedProfile['package_history'] = $this->appendPackageHistory($packageHistory, [
                        'status' => 'offered',
                        'prompt' => $mergedProfile['travel_package_prompt'] ?? '',
                        'suggestion' => $mergedProfile['suggested_package'],
                        'created_at' => now()->toIso8601String(),
                    ]);
                    $turn['should_end'] = false;
                    $turn['ended_reason'] = '';
                } else {
                    $packagePrompt = $service->buildEarlyPackagePrompt($mergedProfile, $transcript, $mergedCategories);

                    if (
                        $packagePrompt !== ''
                        && $packageLookupStatus === ''
                        && ($shouldForceEarlyPackageLookup || $service->isTravelRelated($mergedCategories))
                    ) {
                        $mergedProfile['travel_package_prompt'] = $isFirstMeaningfulRequest
                            ? trim($transcript)
                            : $packagePrompt;
                        $mergedProfile['package_lookup_status'] = 'queued';
                        $mergedProfile['package_state'] = $mergedProfile['package_state'] ?? 'pending';
                        $reply = $service->buildHoldMessage();
                    }

                    $detailKeywords = ['detail', 'include', "what's in", 'whats in', 'price', 'cost', 'how much', 'tell me more', 'what does', 'itinerary', 'activities', 'flight', 'hotel', 'accommodation', 'package'];
                    $transcriptLower = strtolower($transcript);
                    $asksForDetail = array_filter($detailKeywords, fn ($keyword) => str_contains($transcriptLower, $keyword));

                    if (
                        ! isset($mergedProfile['suggested_package'])
                        && $packageLookupStatus !== ''
                        && ! empty($asksForDetail)
                    ) {
                        $reply = $service->buildPackageDetailsPendingReply();
                        $turn['should_end'] = false;
                        $turn['ended_reason'] = '';
                    }

                    if ($service->shouldWaitForPackage($mergedProfile, $mergedCategories)) {
                        $reply = $service->buildPackageWaitMessage();
                        $mergedProfile['package_lookup_status'] = 'pending';
                        $turn['should_end'] = false;
                        $turn['ended_reason'] = '';
                    }
                }
            }

            $reply = trim((string) $reply);

            if ($reply === '') {
                $reply = 'Please tell me a little more so I can help you properly.';
                $turn['should_end'] = false;
                $turn['ended_reason'] = '';
            }

            $speech = $service->synthesizeSpeechForProfile($reply, $mergedProfile);
            $history[] = ['role' => 'assistant', 'content' => $reply];

            $call->forceFill([
                'customer_profile' => $mergedProfile,
                'service_categories' => $mergedCategories,
                'conversation_history' => $history,
                'latest_report' => $turn['live_summary'],
                'status' => $turn['should_end'] ? 'completed' : 'active',
                'ended_at' => $turn['should_end'] ? now() : $call->ended_at,
                'ended_reason' => $turn['should_end'] ? ($turn['ended_reason'] !== '' ? $turn['ended_reason'] : 'completed_by_assistant') : $call->ended_reason,
            ])->save();

            return response()->json([
                'call_id' => $call->call_id,
                'transcript' => $transcript,
                'reply' => $reply,
                'voice_label' => $service->getVoiceLabel($mergedProfile),
                'audio_base64' => base64_encode($speech['body']),
                'audio_mime_type' => $speech['mime_type'],
                'conversation' => $history,
                'customer_profile' => $mergedProfile,
                'service_categories' => $mergedCategories,
                'live_summary' => $turn['live_summary'],
                'should_end' => $turn['should_end'],
                'ended_reason' => $turn['ended_reason'],
                'package_lookup_status' => $mergedProfile['package_lookup_status'] ?? '',
                'package_lookup_error' => $mergedProfile['package_lookup_error'] ?? '',
                'wait_for_package' => $service->shouldWaitForPackage($mergedProfile, $mergedCategories),
            ]);
        } catch (Throwable $throwable) {
            $status = $throwable->getCode();

            return response()->json([
                'message' => $throwable->getMessage() !== '' ? $throwable->getMessage() : '5v ChatGPT ASSIS call turn failed.',
            ], is_int($status) && $status >= 400 && $status < 600 ? $status : 500);
        }
    }

    private function appendPackageHistory(array $packageHistory, array $entry): array
    {
        $packageHistory[] = $entry;

        return array_slice($packageHistory, -10);
    }

    private function markLatestPackageHistoryStatus(array $packageHistory, string $status): array
    {
        $lastIndex = array_key_last($packageHistory);

        if ($lastIndex === null) {
            return $packageHistory;
        }

        $packageHistory[$lastIndex]['status'] = $status;
        $packageHistory[$lastIndex]['updated_at'] = now()->toIso8601String();

        return $packageHistory;
    }
}
