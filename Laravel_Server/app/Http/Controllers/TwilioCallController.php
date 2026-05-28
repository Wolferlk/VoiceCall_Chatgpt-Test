<?php

/**
 * TwilioCallController
 *
 * Bridges real phone calls (via Twilio) to the exact same
 * AahaasAssistentV01Service / ServiceCall flow used by the browser component.
 *
 * Call flow
 * ─────────
 * 1. Twilio dials → POST /api/twilio/inbound
 *    Create session, generate greeting, return TwiML: <Play greeting> <Record>
 *
 * 2. Caller speaks → Twilio POSTs recording to /api/twilio/turn?call_id=V01-XXX
 *    Download MP3, transcribe (Whisper), run GPT turn, synthesise reply.
 *    Return TwiML: <Play reply> <Record>  (or <Hangup> when done)
 *
 * 3. If package wait detected → return <Play hold_msg> <Redirect /package-wait/ID>
 *    /api/twilio/package-wait/{callId} loops every 5 s until package ready.
 *
 * 4. Call ends → final report generated, WhatsApp quotation dispatched.
 *
 * Required .env keys
 * ──────────────────
 * APP_URL               https://your-server.com  (publicly reachable — use ngrok in dev)
 * TWILIO_ACCOUNT_SID    ACxxxx
 * TWILIO_AUTH_TOKEN     xxxxxx
 * TWILIO_PHONE_NUMBER   +94xxxxxxxxx
 * TWILIO_HOLD_MUSIC_URL (optional) public MP3 URL for hold music
 * OPENAI_API_KEY, OPENAI_VOICE_MODEL, OPENAI_TRANSCRIPTION_MODEL  (already set)
 */

namespace App\Http\Controllers;

use App\Jobs\FetchTwilioPackageJob;
use App\Jobs\SendWhatsAppQuotationJob;
use App\Models\ServiceCall;
use App\Services\AahaasAssistentV01Service;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Throwable;

class TwilioCallController extends Controller
{
    // ── Call config ──────────────────────────────────────────────────────────
    private const VOICE_NAME        = 'coral';
    private const VOICE_SPEED       = 1.0;
    private const MAX_RECORD_SECS   = 25;   // max length of one caller recording
    private const SILENCE_TIMEOUT   = 3;    // secs of silence before recording stops

    // ─────────────────────────────────────────────────────────────────────────
    // INBOUND  POST /api/twilio/inbound
    // Called by Twilio the moment someone dials the number.
    // ─────────────────────────────────────────────────────────────────────────
    public function inbound(Request $request, AahaasAssistentV01Service $service): Response
    {
        set_time_limit(300);
        Log::info('[Twilio] Inbound call', [
            'From'    => $request->input('From'),
            'CallSid' => $request->input('CallSid'),
        ]);

        try {
            $service->setVoiceConfig(self::VOICE_NAME, self::VOICE_SPEED);

            $call = ServiceCall::create([
                'call_id' => 'V01-' . strtoupper(Str::random(10)),
                'status'  => 'active',
                'customer_profile' => [
                    'package_state'          => 'not_started',
                    'traveler_count'         => '2',
                    'hotel_star_preference'  => '3-star',
                    'number_of_days'         => '3',
                    'stay_length'            => '3 nights',
                    'travel_start_date'      => 'next week',
                    'activities'             => 'any',
                    'travel_purpose'         => 'any',
                    'current_living_country' => 'sri lanka',
                    'caller_phone'           => $request->input('From', ''),
                    'twilio_call_sid'        => $request->input('CallSid', ''),
                    'channel'                => 'phone',
                ],
                'service_categories'   => [],
                'conversation_history' => [],
                'started_at'           => now(),
            ]);

            $greeting      = $service->buildGreeting($call->call_id);
            $greetingAudio = $service->synthesizeSpeech($greeting);

            $call->forceFill([
                'conversation_history' => [['role' => 'assistant', 'content' => $greeting]],
            ])->save();

            $this->storeAudio($call->call_id, 'greeting', $greetingAudio['body']);

            $base     = $this->appBase();
            $audioUrl = "{$base}/api/twilio/audio/{$call->call_id}/greeting";
            $turnUrl  = "{$base}/api/twilio/turn?call_id=" . urlencode($call->call_id);

            Log::info('[Twilio] Session created', ['call_id' => $call->call_id]);

            return $this->xml($this->recordTwiML($audioUrl, $turnUrl));
        } catch (Throwable $e) {
            Log::error('[Twilio] Inbound error: ' . $e->getMessage());
            return $this->fallbackTwiML($service);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TURN  POST /api/twilio/turn?call_id=V01-XXX
    // Called by Twilio after it finishes recording the caller's speech.
    // ─────────────────────────────────────────────────────────────────────────
    public function turn(Request $request, AahaasAssistentV01Service $service): Response
    {
        set_time_limit(300);

        $callId = trim((string) $request->query('call_id', ''));
        Log::info('[Twilio] Turn', [
            'call_id'  => $callId,
            'duration' => $request->input('RecordingDuration'),
            'url'      => $request->input('RecordingUrl'),
        ]);

        if ($callId === '') {
            return $this->fallbackTwiML($service);
        }

        $call = ServiceCall::query()->where('call_id', $callId)->first();
        if (! $call || $call->status !== 'active') {
            return $this->xml('<Response><Hangup/></Response>');
        }

        try {
            $service->setVoiceConfig(self::VOICE_NAME, self::VOICE_SPEED);

            $history           = is_array($call->conversation_history) ? $call->conversation_history : [];
            $customerProfile   = is_array($call->customer_profile)     ? $call->customer_profile     : [];
            $serviceCategories = is_array($call->service_categories)   ? $call->service_categories   : [];
            $turnIndex         = count($history);

            // ── 1. Transcribe recording ───────────────────────────────────────
            $transcript    = '';
            $recordingUrl  = trim((string) $request->input('RecordingUrl', ''));

            if ($recordingUrl !== '') {
                try {
                    $transcript = $this->downloadAndTranscribe($recordingUrl, $service);
                } catch (Throwable $te) {
                    Log::warning('[Twilio] Transcription failed: ' . $te->getMessage());
                    return $this->recoveryTurn($call, $history, $turnIndex, $callId, $service);
                }
            }

            // ── 2. Handle silence ─────────────────────────────────────────────
            if ($transcript === '' || $transcript === '__silent__' || mb_strlen($transcript) < 2) {
                return $this->nudgeTurn($call, $history, $turnIndex, $callId, $service);
            }

            // ── 3. Run AI turn (same logic as AahaasAssistentV01TurnController) ──
            $history[] = ['role' => 'user', 'content' => $transcript];

            $turn             = $service->generateTurn($history, $customerProfile, $serviceCategories);
            $mergedProfile    = array_filter(
                array_merge($customerProfile, $turn['customer_profile']),
                fn ($v) => $v !== null && $v !== ''
            );
            $mergedCategories = array_values(array_unique(
                array_merge($serviceCategories, $turn['service_categories'])
            ));
            $reply            = $turn['reply'];
            $packageFeedback  = $service->detectPackageFeedback($transcript);
            $packageHistory   = is_array($mergedProfile['package_history'] ?? null) ? $mergedProfile['package_history'] : [];
            $packageStatus    = trim((string) ($mergedProfile['package_lookup_status'] ?? ''));
            $waitForPackage   = false;

            if (($turn['package_confirmation_status'] ?? '') !== '') {
                $mergedProfile['package_state'] = $turn['package_confirmation_status'];
            }

            // ── 4. Package state machine ──────────────────────────────────────
            if (($mergedProfile['package_state'] ?? '') === 'offered' && $packageFeedback === 'accepted') {
                $mergedProfile['package_state']   = 'accepted';
                $packageHistory                   = $this->markLatestPackage($packageHistory, 'accepted');
                $mergedProfile['package_history'] = $packageHistory;
                $turn['should_end']               = false;

            } elseif (($mergedProfile['package_state'] ?? '') === 'offered' && $packageFeedback === 'rejected') {
                $mergedProfile['package_state']   = 'rejected';
                $packageHistory                   = $this->markLatestPackage($packageHistory, 'rejected');
                $mergedProfile['package_history'] = $packageHistory;
                unset($mergedProfile['suggested_package'], $mergedProfile['travel_package_prompt']);
                $turn['should_end'] = false;

            } elseif ($service->isTravelRelated($mergedCategories)) {

                if (in_array($packageStatus, ['failed', 'api_unavailable'], true)) {
                    $reply                                  = $service->buildPackageFailureCallbackReply();
                    $mergedProfile['package_state']         = 'api_unavailable';
                    $mergedProfile['package_lookup_status'] = 'api_unavailable';
                    $turn['should_end']                     = false;

                } elseif (
                    $packageStatus === 'ready'
                    && isset($mergedProfile['suggested_package'])
                    && ($mergedProfile['package_state'] ?? '') !== 'offered'
                    && $service->hasEnoughTravelRequirements($mergedProfile)
                    && $service->hasRequiredContactDetails($mergedProfile)
                ) {
                    $pkgReply = $service->formatPackageOfferReply($mergedProfile['suggested_package']);
                    $reply    = trim($reply !== '' ? "{$reply} {$pkgReply}" : $pkgReply);
                    $mergedProfile['package_state']         = 'offered';
                    $mergedProfile['package_lookup_status'] = 'presented';
                    $mergedProfile['package_history']       = $this->appendPackage($packageHistory, [
                        'status'     => 'offered',
                        'prompt'     => $mergedProfile['travel_package_prompt'] ?? '',
                        'suggestion' => $mergedProfile['suggested_package'],
                        'created_at' => now()->toIso8601String(),
                    ]);
                    $turn['should_end'] = false;

                } else {
                    $pkgPrompt = $service->buildEarlyPackagePrompt($mergedProfile, $transcript, $mergedCategories);
                    if ($pkgPrompt !== '' && $packageStatus === '') {
                        $mergedProfile['travel_package_prompt'] = $pkgPrompt;
                        $mergedProfile['package_lookup_status'] = 'queued';
                        $mergedProfile['package_state']         = $mergedProfile['package_state'] ?? 'pending';
                    }
                    if ($service->shouldWaitForPackage($mergedProfile, $mergedCategories)) {
                        $reply                                  = $service->buildPackageWaitMessage();
                        $mergedProfile['package_lookup_status'] = 'pending';
                        $turn['should_end']                     = false;
                        $waitForPackage                         = true;
                    }
                }
            }

            $reply = trim((string) $reply) ?: 'Please tell me a little more so I can help you.';

            // ── 5. Synthesize reply ───────────────────────────────────────────
            $replyAudio = $service->synthesizeSpeech($reply);
            $history[]  = ['role' => 'assistant', 'content' => $reply];
            $audioKey   = "turn-{$turnIndex}";
            $this->storeAudio($callId, $audioKey, $replyAudio['body']);

            // ── 6. Package-wait: dispatch async fetch and play hold loop ──────
            if ($waitForPackage && ($mergedProfile['travel_package_prompt'] ?? '') !== '') {
                $mergedProfile['package_lookup_status'] = 'pending';
                $call->forceFill([
                    'customer_profile'     => $mergedProfile,
                    'service_categories'   => $mergedCategories,
                    'conversation_history' => $history,
                    'latest_report'        => $turn['live_summary'] ?? '',
                ])->save();

                FetchTwilioPackageJob::dispatch($callId)->onQueue('aahaas-wa');

                $base    = $this->appBase();
                $playUrl = "{$base}/api/twilio/audio/{$callId}/{$audioKey}";
                $waitUrl = "{$base}/api/twilio/package-wait/{$callId}";

                return $this->xml(<<<XML
<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Play>{$playUrl}</Play>
  <Redirect method="GET">{$waitUrl}</Redirect>
</Response>
XML);
            }

            // ── 7. Persist state ──────────────────────────────────────────────
            $shouldEnd = (bool) ($turn['should_end'] ?? false);
            $call->forceFill([
                'customer_profile'     => $mergedProfile,
                'service_categories'   => $mergedCategories,
                'conversation_history' => $history,
                'latest_report'        => $turn['live_summary'] ?? '',
                'status'               => $shouldEnd ? 'completed' : 'active',
                'ended_at'             => $shouldEnd ? now() : $call->ended_at,
                'ended_reason'         => $shouldEnd ? (($turn['ended_reason'] ?? '') ?: 'completed_by_assistant') : $call->ended_reason,
            ])->save();

            $base     = $this->appBase();
            $audioUrl = "{$base}/api/twilio/audio/{$callId}/{$audioKey}";
            $turnUrl  = "{$base}/api/twilio/turn?call_id=" . urlencode($callId);

            // ── 8. End of call ────────────────────────────────────────────────
            if ($shouldEnd) {
                $this->runFinalJobs($call, $mergedProfile, $service, $history, $mergedCategories);
                return $this->xml(<<<XML
<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Play>{$audioUrl}</Play>
  <Hangup/>
</Response>
XML);
            }

            return $this->xml($this->recordTwiML($audioUrl, $turnUrl));

        } catch (Throwable $e) {
            Log::error('[Twilio] Turn error: ' . $e->getMessage(), [
                'call_id' => $callId,
                'trace'   => substr($e->getTraceAsString(), 0, 600),
            ]);
            return $this->fallbackTwiML($service);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PACKAGE-WAIT  GET /api/twilio/package-wait/{callId}
    // Loops every ~5 s until package lookup finishes.
    // ─────────────────────────────────────────────────────────────────────────
    public function packageWait(string $callId, AahaasAssistentV01Service $service): Response
    {
        $call = ServiceCall::query()->where('call_id', $callId)->first();
        if (! $call) {
            return $this->xml('<Response><Hangup/></Response>');
        }

        $base       = $this->appBase();
        $profile    = is_array($call->customer_profile)     ? $call->customer_profile     : [];
        $categories = is_array($call->service_categories)   ? $call->service_categories   : [];
        $history    = is_array($call->conversation_history) ? $call->conversation_history : [];
        $status     = trim((string) ($profile['package_lookup_status'] ?? ''));

        try {
            $service->setVoiceConfig(self::VOICE_NAME, self::VOICE_SPEED);
            $turnIndex = count($history);
            $turnUrl   = "{$base}/api/twilio/turn?call_id=" . urlencode($callId);

            // ── Package failed ────────────────────────────────────────────────
            if (in_array($status, ['failed', 'api_unavailable'], true)) {
                $msg   = $service->buildPackageFailureCallbackReply();
                $audio = $service->synthesizeSpeech($msg);
                $key   = "pkg-fail-{$turnIndex}";
                $this->storeAudio($callId, $key, $audio['body']);
                $history[]                              = ['role' => 'assistant', 'content' => $msg];
                $profile['package_state']               = 'api_unavailable';
                $profile['package_lookup_status']       = 'api_unavailable';
                $call->forceFill(['customer_profile' => $profile, 'conversation_history' => $history])->save();

                $audioUrl = "{$base}/api/twilio/audio/{$callId}/{$key}";
                return $this->xml($this->recordTwiML($audioUrl, $turnUrl));
            }

            // ── Package ready — offer it ──────────────────────────────────────
            if (
                $status === 'ready'
                && isset($profile['suggested_package'])
                && $service->hasEnoughTravelRequirements($profile)
                && $service->hasRequiredContactDetails($profile)
            ) {
                $msg   = $service->formatPackageOfferReply($profile['suggested_package']);
                $audio = $service->synthesizeSpeech($msg);
                $key   = "pkg-offer-{$turnIndex}";
                $this->storeAudio($callId, $key, $audio['body']);
                $history[]                              = ['role' => 'assistant', 'content' => $msg];
                $profile['package_state']               = 'offered';
                $profile['package_lookup_status']       = 'presented';
                $call->forceFill(['customer_profile' => $profile, 'conversation_history' => $history])->save();

                $audioUrl = "{$base}/api/twilio/audio/{$callId}/{$key}";
                return $this->xml($this->recordTwiML($audioUrl, $turnUrl));
            }

            // ── Still fetching — loop ─────────────────────────────────────────
            $holdUrl = "{$base}/api/twilio/hold-music";
            $waitUrl = "{$base}/api/twilio/package-wait/{$callId}";
            return $this->xml(<<<XML
<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Play loop="1">{$holdUrl}</Play>
  <Redirect method="GET">{$waitUrl}</Redirect>
</Response>
XML);
        } catch (Throwable $e) {
            Log::error('[Twilio] PackageWait error: ' . $e->getMessage(), ['call_id' => $callId]);
            return $this->fallbackTwiML($service);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SERVE AUDIO  GET /api/twilio/audio/{callId}/{key}
    // Returns the stored MP3 so Twilio can play it on the call.
    // ─────────────────────────────────────────────────────────────────────────
    public function serveAudio(string $callId, string $key): Response
    {
        $safeId   = preg_replace('/[^A-Za-z0-9\-]/', '', $callId);
        $safeKey  = preg_replace('/[^A-Za-z0-9\-]/', '', $key);
        $path     = storage_path("app/twilio-audio/{$safeId}/{$safeKey}.mp3");

        if (! file_exists($path)) {
            abort(404, 'Audio not found');
        }

        return response()->file($path, [
            'Content-Type'  => 'audio/mpeg',
            'Cache-Control' => 'no-cache, no-store',
        ]);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // HOLD MUSIC  GET /api/twilio/hold-music
    // ─────────────────────────────────────────────────────────────────────────
    public function holdMusic(): Response
    {
        $url = (string) env('TWILIO_HOLD_MUSIC_URL', 'https://demo.twilio.com/docs/classic.mp3');
        return response()->redirectTo($url, 302);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // STATUS CALLBACK  POST /api/twilio/status
    // Twilio reports final call status (completed / no-answer / failed etc.)
    // ─────────────────────────────────────────────────────────────────────────
    public function callStatus(Request $request): Response
    {
        $sid    = $request->input('CallSid', '');
        $status = $request->input('CallStatus', '');
        Log::info('[Twilio] Status callback', ['sid' => $sid, 'status' => $status]);

        if (in_array($status, ['completed', 'busy', 'no-answer', 'canceled', 'failed'], true)) {
            ServiceCall::query()
                ->whereJsonContains('customer_profile->twilio_call_sid', $sid)
                ->where('status', 'active')
                ->update([
                    'status'       => 'completed',
                    'ended_at'     => now(),
                    'ended_reason' => "twilio_{$status}",
                ]);
        }

        return $this->xml('<Response/>');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PRIVATE HELPERS
    // ─────────────────────────────────────────────────────────────────────────

    private function downloadAndTranscribe(string $recordingUrl, AahaasAssistentV01Service $service): string
    {
        $sid   = (string) env('TWILIO_ACCOUNT_SID', '');
        $token = (string) env('TWILIO_AUTH_TOKEN', '');

        $mp3Url  = rtrim($recordingUrl, '/') . '.mp3';
        $dlResp  = Http::withBasicAuth($sid, $token)->timeout(30)->get($mp3Url);

        if (! $dlResp->successful()) {
            throw new \RuntimeException("Recording download failed — HTTP {$dlResp->status()}");
        }

        $tempPath = tempnam(sys_get_temp_dir(), 'twilio_') . '.mp3';
        file_put_contents($tempPath, $dlResp->body());

        try {
            $file       = new \Illuminate\Http\UploadedFile($tempPath, 'recording.mp3', 'audio/mpeg', null, true);
            $transcript = $service->transcribeAudio($file);
        } finally {
            @unlink($tempPath);
        }

        return trim((string) $transcript);
    }

    private function storeAudio(string $callId, string $key, string $bytes): void
    {
        $id  = preg_replace('/[^A-Za-z0-9\-]/', '', $callId);
        $k   = preg_replace('/[^A-Za-z0-9\-]/', '', $key);
        $dir = storage_path("app/twilio-audio/{$id}");
        if (! is_dir($dir)) {
            mkdir($dir, 0755, true);
        }
        file_put_contents("{$dir}/{$k}.mp3", $bytes);
    }

    private function recoveryTurn(
        ServiceCall $call, array $history, int $turnIndex,
        string $callId, AahaasAssistentV01Service $service
    ): Response {
        $msg   = $service->buildTranscriptionRecoveryReply();
        $audio = $service->synthesizeSpeech($msg);
        $key   = "turn-{$turnIndex}-recovery";
        $this->storeAudio($callId, $key, $audio['body']);
        $history[] = ['role' => 'assistant', 'content' => $msg];
        $call->forceFill(['conversation_history' => $history])->save();
        $base = $this->appBase();
        return $this->xml($this->recordTwiML(
            "{$base}/api/twilio/audio/{$callId}/{$key}",
            "{$base}/api/twilio/turn?call_id=" . urlencode($callId)
        ));
    }

    private function nudgeTurn(
        ServiceCall $call, array $history, int $turnIndex,
        string $callId, AahaasAssistentV01Service $service
    ): Response {
        $nudges = [
            "Are you still with me? Please go ahead when you're ready.",
            "Take your time. What would you like help with today?",
            "No rush at all. Please tell me a little more when you're ready.",
        ];
        $msg   = $nudges[array_rand($nudges)];
        $audio = $service->synthesizeSpeech($msg);
        $key   = "turn-{$turnIndex}-nudge";
        $this->storeAudio($callId, $key, $audio['body']);
        $base = $this->appBase();
        return $this->xml($this->recordTwiML(
            "{$base}/api/twilio/audio/{$callId}/{$key}",
            "{$base}/api/twilio/turn?call_id=" . urlencode($callId)
        ));
    }

    private function runFinalJobs(
        ServiceCall $call, array $profile,
        AahaasAssistentV01Service $service,
        array $history, array $categories
    ): void {
        try {
            $report          = $service->buildFinalReport($history, $profile, $categories);
            $finalProfile    = array_filter(array_merge($profile, $report['customer_profile'] ?? []), fn ($v) => $v !== null && $v !== '');
            $finalCategories = array_values(array_unique(array_merge($categories, $report['service_categories'] ?? [])));

            $call->forceFill([
                'final_report'       => json_encode($report, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES),
                'latest_report'      => $report['summary'] ?? $call->latest_report,
                'customer_profile'   => $finalProfile,
                'service_categories' => $finalCategories,
            ])->save();

            if ($service->hasQuotationContacts($finalProfile)) {
                SendWhatsAppQuotationJob::dispatch($call->call_id, $finalProfile, $report, $finalCategories)
                    ->onQueue('aahaas-wa');
            }
        } catch (Throwable $e) {
            Log::error('[Twilio] Final jobs error: ' . $e->getMessage());
        }
    }

    private function recordTwiML(string $audioUrl, string $turnUrl): string
    {
        $max     = self::MAX_RECORD_SECS;
        $silence = self::RECORD_SILENCE_TIMEOUT;
        return <<<XML
<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Play>{$audioUrl}</Play>
  <Record
    action="{$turnUrl}"
    method="POST"
    maxLength="{$max}"
    timeout="{$silence}"
    playBeep="false"
  />
</Response>
XML;
    }

    private function fallbackTwiML(AahaasAssistentV01Service $service): Response
    {
        try {
            $msg   = "I'm sorry, we've encountered a technical issue. Please call back shortly and we'll be happy to assist you.";
            $audio = $service->synthesizeSpeech($msg);
            $key   = 'error-' . time();
            $dir   = storage_path('app/twilio-audio/errors');
            if (! is_dir($dir)) mkdir($dir, 0755, true);
            file_put_contents("{$dir}/{$key}.mp3", $audio['body']);
            $url = $this->appBase() . "/api/twilio/audio/errors/{$key}";
            return $this->xml(<<<XML
<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Play>{$url}</Play>
  <Hangup/>
</Response>
XML);
        } catch (Throwable) {
            return $this->xml(<<<XML
<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">Sorry, we are experiencing technical difficulties. Please call back shortly.</Say>
  <Hangup/>
</Response>
XML);
        }
    }

    private function xml(string $body): Response
    {
        return response($body, 200, ['Content-Type' => 'text/xml; charset=utf-8']);
    }

    private function appBase(): string
    {
        return rtrim((string) env('APP_URL', 'http://localhost:8000'), '/');
    }

    private function appendPackage(array $history, array $entry): array
    {
        $history[] = $entry;
        return array_slice($history, -10);
    }

    private function markLatestPackage(array $history, string $status): array
    {
        $last = array_key_last($history);
        if ($last !== null) {
            $history[$last]['status']     = $status;
            $history[$last]['updated_at'] = now()->toIso8601String();
        }
        return $history;
    }
}
