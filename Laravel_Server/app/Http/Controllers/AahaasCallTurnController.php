<?php

namespace App\Http\Controllers;

use App\Models\ServiceCall;
use App\Services\ElevenLabsReceptionCallService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use RuntimeException;
use Throwable;

class AahaasCallTurnController extends Controller
{
    public function __invoke(Request $request, ElevenLabsReceptionCallService $service): JsonResponse
    {
        $validated = $request->validate([
            'call_id'    => ['required', 'string', 'exists:service_calls,call_id'],
            'audio'      => ['nullable', 'file', 'max:25600', 'required_without:transcript'],
            'transcript' => ['nullable', 'string', 'required_without:audio'],
        ]);

        $call             = ServiceCall::query()->where('call_id', $validated['call_id'])->firstOrFail();
        $history          = is_array($call->conversation_history) ? $call->conversation_history : [];
        $customerProfile  = is_array($call->customer_profile) ? $call->customer_profile : [];
        $serviceCategories = is_array($call->service_categories) ? $call->service_categories : [];

        try {
            $transcript = trim((string) ($validated['transcript'] ?? ''));

            if ($transcript === '') {
                try {
                    $transcript = $service->transcribeAudio($request->file('audio'));
                    $transcript = trim($transcript);
                } catch (Throwable $transcriptionError) {
                    $retryReply = $service->buildTranscriptionRecoveryReply();
                    $speech = $service->synthesizeSpeech($retryReply);
                    $recoveryHistory = $history;
                    $recoveryHistory[] = ['role' => 'assistant', 'content' => $retryReply];

                    $call->forceFill([
                        'conversation_history' => $recoveryHistory,
                    ])->save();

                    return response()->json([
                        'call_id'            => $call->call_id,
                        'transcript'         => '',
                        'reply'              => $retryReply,
                        'audio_base64'       => base64_encode($speech['body']),
                        'audio_mime_type'    => $speech['mime_type'],
                        'conversation'       => $recoveryHistory,
                        'customer_profile'   => $customerProfile,
                        'service_categories' => $serviceCategories,
                        'live_summary'       => is_string($call->latest_report) ? $call->latest_report : '',
                        'should_end'         => false,
                        'ended_reason'       => '',
                    ]);
                }
            }

            // Silence or empty capture — return a natural nudge without calling ChatGPT
            if ($transcript === '__silent__' || mb_strlen($transcript) < 2) {
                $nudges = [
                    "Are you still there? Take your time, I'm listening.",
                    "No rush at all. Whenever you're ready, please go ahead.",
                    "I'm still here. Feel free to continue whenever you like.",
                    "Take all the time you need. I'm listening.",
                    "Whenever you're ready, please go ahead.",
                    "I'm here. No rush at all.",
                ];
                $nudge  = $nudges[array_rand($nudges)];
                $speech = $service->synthesizeSpeech($nudge);

                return response()->json([
                    'call_id'            => $call->call_id,
                    'transcript'         => '',
                    'reply'              => $nudge,
                    'audio_base64'       => base64_encode($speech['body']),
                    'audio_mime_type'    => $speech['mime_type'],
                    'conversation'       => $history,
                    'customer_profile'   => $customerProfile,
                    'service_categories' => $serviceCategories,
                    'live_summary'       => is_string($call->latest_report) ? $call->latest_report : '',
                    'should_end'         => false,
                    'ended_reason'       => '',
                ]);
            }

            $history[] = ['role' => 'user', 'content' => $transcript];

            $turn              = $service->generateTurn($history, $customerProfile, $serviceCategories);
            $mergedProfile     = array_filter(array_merge($customerProfile, $turn['customer_profile']), fn ($v) => $v !== null && $v !== '');
            $mergedCategories  = array_values(array_unique(array_merge($serviceCategories, $turn['service_categories'])));
            $reply             = $turn['reply'];
            $packageState      = trim((string) ($turn['package_confirmation_status'] ?? ''));
            $packageFeedback   = $service->detectPackageFeedback($transcript);
            $packageHistory    = is_array($mergedProfile['package_history'] ?? null) ? $mergedProfile['package_history'] : [];

            if ($packageState !== '') {
                $mergedProfile['package_state'] = $packageState;
            }

            if (($mergedProfile['package_state'] ?? '') === 'offered' && $packageFeedback === 'accepted') {
                $mergedProfile['package_state'] = 'accepted';
                $packageHistory = $this->markLatestPackageHistoryStatus($packageHistory, 'accepted');
                $mergedProfile['package_history'] = $packageHistory;
                $reply = 'Thank you. I am glad the package works for you. We will complete the booking request and our team will contact you shortly.';
                $turn['should_end']   = true;
                $turn['ended_reason'] = 'package_accepted';
            } elseif (($mergedProfile['package_state'] ?? '') === 'offered' && $packageFeedback === 'rejected') {
                $mergedProfile['package_state'] = 'rejected';
                $packageHistory = $this->markLatestPackageHistoryStatus($packageHistory, 'rejected');
                $mergedProfile['package_history'] = $packageHistory;
                unset($mergedProfile['suggested_package'], $mergedProfile['travel_package_prompt']);
                $reply = 'No problem. Please tell me what you need to change in the package, and I will prepare another option for you.';
                $turn['should_end']   = false;
                $turn['ended_reason'] = '';
            } elseif ($service->isTravelRelated($mergedCategories)) {
                try {
                    $canOfferFullPackage = $service->hasEnoughTravelRequirements($mergedProfile);
                    $existingPackageState = $mergedProfile['package_state'] ?? 'not_started';
                    $shouldOfferPackage =
                        in_array($existingPackageState, ['not_started', 'rejected', 'pending'], true)
                        || (($turn['should_end'] ?? false) && $existingPackageState !== 'accepted');

                    if ($shouldOfferPackage) {
                        $packagePrompt = $canOfferFullPackage
                            ? $service->buildPackagePromptFromProfile($mergedProfile)
                            : trim($transcript);

                        if ($packagePrompt !== '') {
                            $packageSuggestion = $service->suggestTravelPackage($packagePrompt);

                            if ($canOfferFullPackage) {
                                $packageReply = $service->formatPackageOfferReply($packageSuggestion);
                                $reply = trim($reply !== '' ? "{$reply} {$packageReply}" : $packageReply);
                                $mergedProfile['package_state'] = 'offered';
                            } else {
                                $reply = trim($reply !== ''
                                    ? "{$reply} I found an early package idea from Aahaas, and I can read it after I collect a few more details."
                                    : 'I found an early package idea from Aahaas, and I can read it after I collect a few more details.'
                                );
                                $mergedProfile['package_state'] = 'pending';
                            }

                            $mergedProfile['travel_package_prompt'] = $packagePrompt;
                            $mergedProfile['suggested_package'] = $packageSuggestion;
                            $mergedProfile['package_history'] = $this->appendPackageHistory($packageHistory, [
                                'status' => $mergedProfile['package_state'],
                                'prompt' => $packagePrompt,
                                'suggestion' => $packageSuggestion,
                                'created_at' => now()->toIso8601String(),
                            ]);
                            $turn['should_end'] = false;
                            $turn['ended_reason'] = '';
                        }
                    }
                } catch (RuntimeException $exception) {
                    $reply = $service->buildPackageApiUnavailableReply();
                    $mergedProfile['package_state'] = 'api_unavailable';
                    $mergedProfile['package_history'] = $this->appendPackageHistory($packageHistory, [
                        'status' => 'api_unavailable',
                        'prompt' => $mergedProfile['travel_package_prompt'] ?? trim($transcript),
                        'suggestion' => [
                            'message' => $exception->getMessage(),
                        ],
                        'created_at' => now()->toIso8601String(),
                    ]);
                    $turn['should_end']   = true;
                    $turn['ended_reason'] = 'package_api_unavailable';
                }
            }

            if ($this->isExplicitContactDecline($transcript)) {
                $mergedProfile['contact_permission'] = 'declined';
            } elseif ($this->looksLikeContactConsent($transcript) && $this->isLikelyContactQuestion($lastAssistantMessage = $this->lastAssistantMessage($history))) {
                $mergedProfile['contact_permission'] = 'granted';
                $mergedProfile['contact_permission_context'] = $lastAssistantMessage;
            }

            $reply = trim((string) $reply);

            if ($reply === '') {
                $reply = 'I am still here. Please continue.';
                $turn['should_end'] = false;
                $turn['ended_reason'] = '';
            }

            $speech = $service->synthesizeSpeech($reply);

            $history[] = ['role' => 'assistant', 'content' => $reply];

            $call->forceFill([
                'customer_profile'     => $mergedProfile,
                'service_categories'   => $mergedCategories,
                'conversation_history' => $history,
                'latest_report'        => $turn['live_summary'],
                'status'               => $turn['should_end'] ? 'completed' : 'active',
                'ended_at'             => $turn['should_end'] ? now() : $call->ended_at,
                'ended_reason'         => $turn['should_end'] ? ($turn['ended_reason'] !== '' ? $turn['ended_reason'] : 'completed_by_assistant') : $call->ended_reason,
            ])->save();

            return response()->json([
                'call_id'           => $call->call_id,
                'transcript'        => $transcript,
                'reply'             => $reply,
                'audio_base64'      => base64_encode($speech['body']),
                'audio_mime_type'   => $speech['mime_type'],
                'conversation'      => $history,
                'customer_profile'  => $mergedProfile,
                'service_categories' => $mergedCategories,
                'live_summary'      => $turn['live_summary'],
                'should_end'        => $turn['should_end'],
                'ended_reason'      => $turn['ended_reason'],
            ]);
        } catch (Throwable $throwable) {
            $status = $throwable->getCode();

            return response()->json([
                'message' => $throwable->getMessage() !== '' ? $throwable->getMessage() : 'Aahaas call turn failed.',
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

    private function lastAssistantMessage(array $history): string
    {
        for ($index = count($history) - 1; $index >= 0; $index--) {
            if (($history[$index]['role'] ?? null) === 'assistant') {
                return trim((string) ($history[$index]['content'] ?? ''));
            }
        }

        return '';
    }

    private function isLikelyContactQuestion(string $assistantMessage): bool
    {
        $normalized = strtolower($assistantMessage);

        return str_contains($normalized, 'contact number')
            || str_contains($normalized, 'phone number')
            || str_contains($normalized, 'email')
            || str_contains($normalized, 'comfortable sharing');
    }

    private function looksLikeContactConsent(string $transcript): bool
    {
        $normalized = strtolower(trim($transcript));

        return in_array($normalized, ['yes', 'yes okay', 'okay', 'ok', 'sure', 'of course'], true);
    }

    private function isExplicitContactDecline(string $transcript): bool
    {
        $normalized = strtolower(trim($transcript));

        return str_contains($normalized, 'do not contact')
            || str_contains($normalized, "don't contact")
            || str_contains($normalized, 'no email')
            || str_contains($normalized, 'no phone')
            || str_contains($normalized, 'not comfortable');
    }
}
