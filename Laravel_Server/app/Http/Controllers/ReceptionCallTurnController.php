<?php

namespace App\Http\Controllers;

use App\Models\ServiceCall;
use App\Services\ReceptionCallService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use RuntimeException;
use Throwable;

class ReceptionCallTurnController extends Controller
{
    public function __invoke(Request $request, ReceptionCallService $service): JsonResponse
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
                $transcript = $service->transcribeAudio($request->file('audio'));
            }

            $history[] = ['role' => 'user', 'content' => $transcript];

            $turn = $service->generateTurn($history, $customerProfile, $serviceCategories);
            $mergedProfile = array_filter(array_merge($customerProfile, $turn['customer_profile']), fn ($value) => $value !== null && $value !== '');
            $mergedCategories = array_values(array_unique(array_merge($serviceCategories, $turn['service_categories'])));
            $reply = $turn['reply'];
            $packageState = trim((string) ($turn['package_confirmation_status'] ?? ''));
            $packageFeedback = $service->detectPackageFeedback($transcript);

            if ($packageState !== '') {
                $mergedProfile['package_state'] = $packageState;
            }

            if (($mergedProfile['package_state'] ?? '') === 'offered' && $packageFeedback === 'accepted') {
                $mergedProfile['package_state'] = 'accepted';
                $reply = 'Thank you. I am glad the package works for you. We will complete the booking request and our team will contact you shortly.';
                $turn['should_end'] = true;
                $turn['ended_reason'] = 'package_accepted';
            } elseif (($mergedProfile['package_state'] ?? '') === 'offered' && $packageFeedback === 'rejected') {
                $mergedProfile['package_state'] = 'rejected';
                unset($mergedProfile['suggested_package'], $mergedProfile['travel_package_prompt']);
                $reply = 'No problem. Please tell me what you need to change in the package, and I will prepare another option for you.';
                $turn['should_end'] = false;
                $turn['ended_reason'] = '';
            } elseif (
                $service->isTravelRelated($mergedCategories)
                && $service->hasEnoughTravelRequirements($mergedProfile)
                && (
                    in_array(($mergedProfile['package_state'] ?? 'not_started'), ['not_started', 'rejected', 'pending'], true)
                    || (($turn['should_end'] ?? false) && ($mergedProfile['package_state'] ?? '') !== 'accepted')
                )
            ) {
                try {
                    $packagePrompt = $service->buildPackagePromptFromProfile($mergedProfile);
                    $packageSuggestion = $service->suggestTravelPackage($packagePrompt);
                    $packageReply = $service->formatPackageOfferReply($packageSuggestion);
                    $reply = trim($reply !== '' ? "{$reply} {$packageReply}" : $packageReply);
                    $mergedProfile['package_state'] = 'offered';
                    $mergedProfile['travel_package_prompt'] = $packagePrompt;
                    $mergedProfile['suggested_package'] = $packageSuggestion;
                    $turn['should_end'] = false;
                    $turn['ended_reason'] = '';
                } catch (RuntimeException $exception) {
                    $reply = $service->buildPackageApiUnavailableReply();
                    $mergedProfile['package_state'] = 'api_unavailable';
                    $turn['should_end'] = true;
                    $turn['ended_reason'] = 'package_api_unavailable';
                }
            }

            $speech = $service->synthesizeSpeech($reply);

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
                'audio_base64' => base64_encode($speech['body']),
                'audio_mime_type' => $speech['mime_type'],
                'conversation' => $history,
                'customer_profile' => $mergedProfile,
                'service_categories' => $mergedCategories,
                'live_summary' => $turn['live_summary'],
                'should_end' => $turn['should_end'],
                'ended_reason' => $turn['ended_reason'],
            ]);
        } catch (Throwable $throwable) {
            $status = $throwable->getCode();

            return response()->json([
                'message' => $throwable->getMessage() !== '' ? $throwable->getMessage() : 'Reception call turn failed.',
            ], is_int($status) && $status >= 400 && $status < 600 ? $status : 500);
        }
    }
}
