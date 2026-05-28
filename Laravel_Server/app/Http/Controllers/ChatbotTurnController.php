<?php

namespace App\Http\Controllers;

use App\Jobs\FetchChatbotPackageJob;
use App\Jobs\SendChatbotWhatsAppJob;
use App\Models\ServiceCall;
use App\Services\ChatbotService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Throwable;

class ChatbotTurnController extends Controller
{
    public function __invoke(Request $request, ChatbotService $service): JsonResponse
    {
        set_time_limit(300);

        $validated = $request->validate([
            'session_id'   => ['required', 'string', 'exists:service_calls,call_id'],
            'message'      => ['nullable', 'string', 'max:4000'],
            'audio'        => ['nullable', 'file', 'max:25600'],
            'image'        => ['nullable', 'file', 'max:10240', 'mimes:jpg,jpeg,png,gif,webp'],
            'image_prompt' => ['nullable', 'string', 'max:500'],
            'voice_name'   => ['nullable', 'string'],
            'voice_speed'  => ['nullable', 'numeric', 'min:0.25', 'max:4.0'],
        ]);

        $voiceName  = trim((string) ($validated['voice_name']  ?? 'coral')) ?: 'coral';
        $voiceSpeed = (float) ($validated['voice_speed'] ?? 1.0);
        $service->setVoiceConfig($voiceName, $voiceSpeed);

        $call              = ServiceCall::query()->where('call_id', $validated['session_id'])->firstOrFail();
        $history           = is_array($call->conversation_history) ? $call->conversation_history : [];
        $customerProfile   = is_array($call->customer_profile)     ? $call->customer_profile     : [];
        $serviceCategories = is_array($call->service_categories)   ? $call->service_categories   : [];

        $packageFetchStatus = trim((string) ($customerProfile['package_fetch_status'] ?? ''));
        $suggestedPackage   = $customerProfile['suggested_package'] ?? null;

        try {
            $userMessage = '';
            $inputType   = 'text';
            $transcript  = '';
            $imageDesc   = '';

            // ── Determine input source ────────────────────────────────────────
            if ($request->hasFile('image')) {
                $imageContext = trim((string) ($validated['image_prompt'] ?? ''));
                $imageDesc    = $service->analyzeImage($request->file('image'), $imageContext);
                $textPart     = trim((string) ($validated['message'] ?? ''));
                $userMessage  = $textPart !== ''
                    ? "{$textPart}\n\n[Attached image analysis: {$imageDesc}]"
                    : "I have shared an image. Here is what it shows: {$imageDesc}";
                $inputType    = 'image';
            } elseif ($request->hasFile('audio')) {
                $transcript  = $service->transcribeAudio($request->file('audio'));
                $userMessage = $transcript;
                $inputType   = 'audio';
            } else {
                $userMessage = trim((string) ($validated['message'] ?? ''));
            }

            if ($userMessage === '') {
                return response()->json(['message' => 'No message content provided.'], 422);
            }

            // ── Process through AI ────────────────────────────────────────────
            $turn = $service->processMessage(
                $history,
                $userMessage,
                $customerProfile,
                $serviceCategories,
                ($packageFetchStatus === 'ready') ? $suggestedPackage : null,
                $packageFetchStatus,
            );

            $reply            = $turn['reply'];
            $mergedProfile    = array_filter($turn['customer_profile'], fn ($v) => $v !== null && $v !== '');
            $mergedCategories = $turn['service_categories'];

            // ── Package fetch trigger ─────────────────────────────────────────
            if ($turn['trigger_package_fetch']
                && $turn['package_prompt'] !== ''
                && ! in_array($packageFetchStatus, ['fetching'], true)
            ) {
                $mergedProfile['travel_package_prompt'] = $turn['package_prompt'];
                $mergedProfile['package_fetch_status']  = 'fetching';
                $mergedProfile['package_state']         = 'fetching';
                unset($mergedProfile['suggested_package']);

                FetchChatbotPackageJob::dispatch($call->call_id, $turn['package_prompt'])
                    ->onQueue('aahaas-wa');
            }

            // ── Package ready → mark as presented ────────────────────────────
            if ($packageFetchStatus === 'ready'
                && $suggestedPackage
                && ($mergedProfile['package_state'] ?? '') !== 'presented'
            ) {
                $mergedProfile['package_state']        = 'presented';
                $mergedProfile['package_fetch_status'] = 'presented';
            }

            // ── Synthesize speech ─────────────────────────────────────────────
            $speech = $service->synthesizeSpeech($reply);

            // ── Update history ────────────────────────────────────────────────
            $history[] = ['role' => 'user',      'content' => $userMessage, 'input_type' => $inputType];
            $history[] = ['role' => 'assistant',  'content' => $reply];

            // ── Auto-send WhatsApp when session ends ──────────────────────────
            $quotationQueued = false;
            if ($turn['should_end'] && $service->hasContactInfo($mergedProfile)) {
                SendChatbotWhatsAppJob::dispatch(
                    $call->call_id,
                    $mergedProfile,
                    $mergedProfile['suggested_package'] ?? null
                )->onQueue('aahaas-wa');
                $quotationQueued = true;
            }

            $call->forceFill([
                'conversation_history' => $history,
                'customer_profile'     => $mergedProfile,
                'service_categories'   => $mergedCategories,
                'latest_report'        => $turn['live_summary'],
                'status'               => $turn['should_end'] ? 'completed' : 'active',
                'ended_at'             => $turn['should_end'] ? now() : $call->ended_at,
                'ended_reason'         => $turn['should_end'] ? 'chatbot_completed' : $call->ended_reason,
            ])->save();

            return response()->json([
                'session_id'           => $call->call_id,
                'reply'                => $reply,
                'audio_base64'         => base64_encode($speech['body']),
                'audio_mime_type'      => $speech['mime_type'],
                'transcript'           => $transcript,
                'image_description'    => $imageDesc,
                'input_type'           => $inputType,
                'conversation'         => $history,
                'customer_profile'     => $mergedProfile,
                'service_categories'   => $mergedCategories,
                'live_summary'         => $turn['live_summary'],
                'booking_confirmed'    => $turn['booking_confirmed'],
                'should_end'           => $turn['should_end'],
                'quotation_queued'     => $quotationQueued,
                'package_fetch_status' => $mergedProfile['package_fetch_status'] ?? '',
            ]);
        } catch (Throwable $e) {
            $code = $e->getCode();
            return response()->json(
                ['message' => $e->getMessage() ?: 'Chatbot turn failed.'],
                is_int($code) && $code >= 400 && $code < 600 ? $code : 500
            );
        }
    }
}
