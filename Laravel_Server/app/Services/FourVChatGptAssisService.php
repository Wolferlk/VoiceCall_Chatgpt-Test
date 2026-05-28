<?php

namespace App\Services;

use Illuminate\Http\Client\Response;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Http;
use RuntimeException;

class FourVChatGptAssisService extends AiAssistentFinalTestService
{
    private const SUPPORTED_VOICES = [
        'alloy',
        'echo',
        'fable',
        'onyx',
        'nova',
        'shimmer',
        'coral',
        'verse',
        'ballad',
        'ash',
        'sage',
        'marin',
        'cedar',
    ];

    private const VOICE_ALIASES = [
        'sol' => 'marin',
        'cove' => 'cedar',
    ];

    public function initializeCustomerProfile(?string $selectedVoice = null, ?float $speechSpeed = null): array
    {
        $selection = $this->resolveVoiceSelection($selectedVoice);

        return [
            'package_state' => 'not_started',
            'assistant_voice_id' => $selection['voice_id'],
            'assistant_voice_label' => $selection['voice_label'],
            'assistant_speech_speed' => $this->normalizeSpeechSpeed($speechSpeed),
        ];
    }

    public function getSupportedVoices(): array
    {
        return self::SUPPORTED_VOICES;
    }

    public function buildGreeting(string $callId): string
    {
        return $this->generateVoiceLine(
            'greeting',
            [],
            [
                'call_id' => $callId,
                'goal' => 'Open the call briefly, optionally allow the customer to share their name, and ask what they want in one short spoken line.',
            ],
            'Hello, welcome to Aahaas. Tell me what you want, and I will search the best matching product for you.'
        );
    }

    public function buildSilenceNudge(): string
    {
        return $this->generateVoiceLine(
            'silence_nudge',
            [],
            [
                'goal' => 'Ask the caller to continue after silence or unclear audio in one short natural line.',
            ],
            'Please go ahead whenever you are ready.'
        );
    }

    public function buildGenericContinueReply(): string
    {
        return $this->generateVoiceLine(
            'generic_continue',
            [],
            [
                'goal' => 'Ask for a little more detail in one short natural line when the assistant needs to continue the call.',
            ],
            'Please tell me a little more so I can help you properly.'
        );
    }

    public function buildHoldMessage(): string
    {
        return $this->generateVoiceLine(
            'hold_message',
            [],
            [
                'goal' => 'Tell the customer briefly that Aahaas API product search is running now. Do not read back default values or a full assumed summary before the API result is ready.',
            ],
            'I am searching the best Aahaas product for you now. Please hold for a moment.'
        );
    }

    public function buildClosingMessage(): string
    {
        return $this->generateVoiceLine(
            'closing_message',
            [],
            [
                'goal' => 'Close the call warmly after booking confirmation and confirmed contact details.',
            ],
            'Thank you for calling Aahaas. We will send your booking details shortly.'
        );
    }

    public function buildPackageFailureCallbackReply(): string
    {
        return $this->generateVoiceLine(
            'package_failure',
            [],
            [
                'goal' => 'Tell the customer briefly that the Aahaas API is busy, that their request is saved, and that the team will contact them with the best option.',
            ],
            'Our Aahaas package service is busy right now, but I have your request and our team will contact you with the best option shortly.'
        );
    }

    public function buildPackageDetailsPendingReply(): string
    {
        return $this->generateVoiceLine(
            'package_pending',
            [],
            [
                'goal' => 'Tell the customer briefly that Aahaas API results are still loading and that you do not want to guess product details.',
            ],
            'I am still waiting for the Aahaas package result, so I do not want to guess the package details. Please hold while I check it.'
        );
    }

    public function looksLikeSearchableRequest(string $text): bool
    {
        $normalized = strtolower(trim($text));

        if ($normalized === '' || mb_strlen($normalized) < 4) {
            return false;
        }

        return true;
    }

    public function formatPackageOfferReply(array $suggestion): string
    {
        return $this->generateVoiceLine(
            'package_summary',
            [],
            [
                'goal' => 'Read a complete but concise booking or product summary using only the Aahaas API package details and the current default values, then ask whether anything needs to change.',
                'package_offer' => $suggestion,
            ],
            parent::formatPackageOfferReply($suggestion)
        );
    }

    public function buildFinalReport(array $history = [], array $customerProfile = [], array $serviceCategories = []): array
    {
        return parent::buildFinalReport(
            $history,
            $this->applyDefaultTravelAssumptions($customerProfile, $serviceCategories),
            $serviceCategories
        );
    }

    public function generateTurn(array $history = [], array $customerProfile = [], array $serviceCategories = []): array
    {
        $customerProfile = $this->applyDefaultTravelAssumptions($customerProfile, $serviceCategories);
        $conversationLines = [];

        foreach ($history as $message) {
            $role = $message['role'] ?? null;
            $content = trim((string) ($message['content'] ?? ''));

            if (! in_array($role, ['user', 'assistant'], true) || $content === '') {
                continue;
            }

            $conversationLines[] = strtoupper($role) . ': ' . $content;
        }

        $payload = [
            [
                'role' => 'developer',
                'content' => $this->chatGpt3vSystemPrompt(),
            ],
            [
                'role' => 'user',
                'content' => json_encode([
                    'known_customer_profile' => $customerProfile,
                    'known_service_categories' => $serviceCategories,
                    'known_package_state' => $customerProfile['package_state'] ?? null,
                    'known_package_offer' => $customerProfile['suggested_package'] ?? null,
                    'conversation' => $conversationLines,
                ], JSON_UNESCAPED_SLASHES),
            ],
        ];

        $raw = $this->sendResponsesRequest($payload);
        $decoded = $this->decodeJsonObject($raw);
        $reply = trim((string) ($decoded['reply'] ?? ''));

        if ($reply === '') {
            $reply = $this->buildGenericContinueReply();
        }

        return [
            'reply' => $reply,
            'customer_profile' => is_array($decoded['customer_profile'] ?? null) ? $decoded['customer_profile'] : [],
            'service_categories' => array_values(array_filter(
                is_array($decoded['service_categories'] ?? null) ? $decoded['service_categories'] : [],
                fn ($value) => is_string($value) && trim($value) !== ''
            )),
            'should_end' => (bool) ($decoded['should_end'] ?? false),
            'ended_reason' => trim((string) ($decoded['ended_reason'] ?? '')),
            'live_summary' => trim((string) ($decoded['live_summary'] ?? '')),
            'needs_travel_package' => (bool) ($decoded['needs_travel_package'] ?? false),
            'travel_package_prompt' => trim((string) ($decoded['travel_package_prompt'] ?? '')),
            'package_confirmation_status' => trim((string) ($decoded['package_confirmation_status'] ?? '')),
        ];
    }

    public function buildEarlyPackagePrompt(array $customerProfile, string $transcript, array $serviceCategories): string
    {
        return parent::buildEarlyPackagePrompt(
            $this->applyDefaultTravelAssumptions($customerProfile, $serviceCategories),
            $transcript,
            $serviceCategories
        );
    }

    public function shouldWaitForPackage(array $customerProfile, array $serviceCategories): bool
    {
        $customerProfile = $this->applyDefaultTravelAssumptions($customerProfile, $serviceCategories);
        $lookupStatus = trim((string) ($customerProfile['package_lookup_status'] ?? ''));
        $storedPrompt = trim((string) ($customerProfile['travel_package_prompt'] ?? ''));

        return ($this->isTravelRelated($serviceCategories) || $storedPrompt !== '')
            && in_array($lookupStatus, ['queued', 'pending'], true)
            && $storedPrompt !== '';
    }

    public function hasEnoughTravelRequirements(array $customerProfile): bool
    {
        return parent::hasEnoughTravelRequirements($this->applyDefaultTravelAssumptions($customerProfile, [
            'Hotel Booking',
            'Flight Booking',
            'Sri Lanka Tour Planning',
            'Transportation',
            'Activities and Experiences',
        ]));
    }

    public function synthesizeSpeechForProfile(string $text, array $customerProfile = [], ?string $instructions = null): array
    {
        $text = trim($text);

        if ($text === '') {
            throw new RuntimeException('Text is required for speech synthesis.');
        }

        $openAiApiKey = $this->requiredConfigValue('OPENAI_API_KEY');
        $voiceModel = env('OPENAI_VOICE_MODEL', 'gpt-4o-mini-tts');
        $voiceInstructions = $instructions ?: env(
            'OPENAI_RECEPTION_VOICE_INSTRUCTIONS',
            'Speak like a warm Aahaas travel receptionist on a live phone call. Keep the delivery clear, natural, upbeat, and fast. Use short spoken phrasing.'
        );
        $speechSpeed = $this->normalizeSpeechSpeed($customerProfile['assistant_speech_speed'] ?? null);

        $voiceId = $this->normalizeVoiceSelection((string) ($customerProfile['assistant_voice_id'] ?? ''));
        $response = Http::withToken($openAiApiKey)
            ->timeout(120)
            ->withHeaders([
                'Accept' => 'audio/mpeg',
                'Content-Type' => 'application/json',
            ])
            ->asJson()
            ->post('https://api.openai.com/v1/audio/speech', [
                'model' => $voiceModel,
                'voice' => $voiceId,
                'input' => $text,
                'instructions' => $voiceInstructions,
                'response_format' => 'wav',
                'speed' => $speechSpeed,
            ]);

        if ($response->failed()) {
            $status = $response->status() ?: 500;
            $message = $this->extractVoiceErrorMessage($response);
            throw new RuntimeException($message !== '' ? $message : 'OpenAI speech generation failed.', $status);
        }

        return [
            'body' => $response->body(),
            'mime_type' => $response->header('Content-Type', 'audio/wav'),
            'voice' => $voiceId,
            'voice_label' => $voiceId,
        ];
    }

    public function getVoiceLabel(array $customerProfile = []): string
    {
        $storedLabel = trim((string) ($customerProfile['assistant_voice_label'] ?? ''));

        if ($storedLabel !== '') {
            return $storedLabel;
        }

        return $this->resolveVoiceSelection((string) ($customerProfile['assistant_voice_id'] ?? ''))['voice_label'];
    }

    private function chatGpt3vSystemPrompt(): string
    {
        return <<<'PROMPT'
You are Aahaas AI, a warm and natural phone receptionist for Aahaas.

CALL STYLE:
- Sound natural, calm, and helpful.
- Keep replies short for voice playback: one or two brief sentences.
- Ask exactly one clear follow-up question each turn.
- Do not say robotic phrases like "I noted that down" or "I recorded that."
- Keep every spoken reply low-latency and concise.

DEFAULT TRAVEL ASSUMPTIONS:
- If the caller wants a hotel or travel booking but does not clearly specify traveler count, assume 2 travelers.
- If hotel class is not clearly given, assume a 3-star hotel.
- If duration is not clearly given, assume 3 days.
- If start timing is not clearly given, assume the trip starts 7 days from today.
- If activities are not clearly given, assume standard sightseeing suitable for the destination.
- Use these defaults silently without asking extra questions about them, unless the caller later asks to change them.

FLOW:
1. Start with one simple opening only. Do not begin with many questions.
2. If the customer tells you what they want, use that request immediately to check the Aahaas API for the best matching package or product.
3. If the customer shares a name, store it and use it naturally. If they do not share a name, do not push for it.
4. Do not ask unnecessary preference questions like relaxed sightseeing, active plan, or similar extra discovery questions. Just search the best fit first.
5. If the request is travel-related, use these starting defaults silently unless the customer changes them: country Sri Lanka, travelers 2 couple, duration 3 days, hotel class 3-star, activities any, purpose any, date plan from next week.
6. Do NOT say a full assumed sentence like destination plus travelers plus days plus hotel class before the Aahaas API result is ready.
7. The customer's first real request must be treated as the direct product-search prompt for the Aahaas API.
8. While the Aahaas API takes time to reply, you may continue a light conversation, but do not ask unnecessary questions. Do not ask new travel preference questions while waiting. You may only confirm the customer name if they volunteered it or give one short hold-style update.
9. Present package or product options naturally only when known_package_offer is available from the Aahaas API.
10. Before asking for contact details, read a full summary of the package or product with the current defaults and any customer changes.
11. Ask one simple question only: does anything need to change.
12. If the customer wants changes, update only the parts they asked to change, then read the full summary again.
13. If the customer confirms the summary is okay, ask for contact details in this order: WhatsApp and email.
14. After the customer gives contact details, read them back and confirm they are correct.
15. End the call only after the customer confirms the booking and the confirmed contact details.
16. If known_package_offer is missing or the Aahaas API is unavailable, never invent package names, hotels, prices, room types, itineraries, or product details. Simply say the Aahaas service is busy, keep the customer request as given, and say the Aahaas team will contact them with the best option.

PACKAGE SAFETY:
- Only package details from known_package_offer may be spoken as a real package recommendation.
- Never guess or fabricate package content.
- If the package system is still loading, say you are waiting for the Aahaas package result and keep the conversation light.
- If the package system fails, apologize briefly and say the Aahaas team will contact the customer with the best available option.

CONTACT TIMING:
- Do not ask for contact details at the beginning of trip planning.
- Ask for WhatsApp and email only after the package or travel summary is confirmed or when the package API is unavailable and the team needs to follow up.
- Do not ask for traveler count, duration, hotel class, or start date if the customer did not explicitly mention them and the defaults are sufficient.
- If the customer gives their name naturally, use it. If not, continue without making it a blocker.

Always return strict JSON with exactly these keys: reply, customer_profile, service_categories, should_end, ended_reason, live_summary, needs_travel_package, travel_package_prompt, package_confirmation_status.
PROMPT;
    }

    private function applyDefaultTravelAssumptions(array $customerProfile, array $serviceCategories): array
    {
        if (! $this->isTravelRelated($serviceCategories)) {
            return $customerProfile;
        }

        $assumptions = is_array($customerProfile['default_assumptions_applied'] ?? null)
            ? $customerProfile['default_assumptions_applied']
            : [];

        if (trim((string) ($customerProfile['traveler_count'] ?? $customerProfile['number_of_travelers'] ?? '')) === '') {
            $customerProfile['traveler_count'] = '2 (Couple)';
            $customerProfile['number_of_travelers'] = '2 (Couple)';
            $assumptions[] = 'traveler_count_default_2';
        }

        if (trim((string) ($customerProfile['stay_length'] ?? $customerProfile['number_of_days'] ?? '')) === '') {
            $customerProfile['stay_length'] = '3 days';
            $customerProfile['number_of_days'] = '3 days';
            $assumptions[] = 'duration_default_3_days';
        }

        if (trim((string) ($customerProfile['hotel_rating_preference'] ?? $customerProfile['hotel_category'] ?? '')) === '') {
            $customerProfile['hotel_rating_preference'] = '3-star hotel';
            $customerProfile['hotel_category'] = '3-star hotel';
            $assumptions[] = 'hotel_rating_default_3_star';
        }

        if (trim((string) ($customerProfile['activities_preference'] ?? $customerProfile['activity_preference'] ?? '')) === '') {
            $customerProfile['activities_preference'] = 'Any activities';
            $customerProfile['activity_preference'] = 'Any activities';
            $assumptions[] = 'activities_default_any';
        }

        if (trim((string) ($customerProfile['travel_purpose'] ?? $customerProfile['purpose_of_trip'] ?? '')) === '') {
            $customerProfile['travel_purpose'] = 'Any purpose';
            $customerProfile['purpose_of_trip'] = 'Any purpose';
            $assumptions[] = 'purpose_default_any';
        }

        if (trim((string) ($customerProfile['destination_country'] ?? $customerProfile['country_to_visit'] ?? '')) === '') {
            $customerProfile['destination_country'] = 'Sri Lanka';
            $customerProfile['country_to_visit'] = 'Sri Lanka';
            $assumptions[] = 'country_default_sri_lanka';
        }

        if (trim((string) ($customerProfile['travel_date_range'] ?? $customerProfile['planned_travel_date_range'] ?? '')) === '') {
            $startDate = Carbon::now()->addDays(7)->startOfDay();
            $endDate = $startDate->copy()->addDays(3);
            $dateRange = sprintf(
                'Starting on %s for 3 days, ending on %s',
                $startDate->toFormattedDateString(),
                $endDate->toFormattedDateString()
            );
            $customerProfile['travel_date_range'] = $dateRange;
            $customerProfile['planned_travel_date_range'] = $dateRange;
            $customerProfile['start_date_preference'] = $startDate->toDateString();
            $assumptions[] = 'start_date_default_plus_7_days';
        }

        $customerProfile['default_assumptions_applied'] = array_values(array_unique($assumptions));

        return $customerProfile;
    }

    private function extractVoiceErrorMessage(Response $response): string
    {
        $details = $response->json('error.message');

        if (is_string($details) && trim($details) !== '') {
            return trim($details);
        }

        $body = $response->body();

        return is_string($body) ? trim($body) : '';
    }

    private function normalizeVoiceSelection(?string $selectedVoice): string
    {
        return $this->resolveVoiceSelection($selectedVoice)['voice_id'];
    }

    private function resolveVoiceSelection(?string $selectedVoice): array
    {
        $voice = strtolower(trim((string) $selectedVoice));

        if (isset(self::VOICE_ALIASES[$voice])) {
            return [
                'voice_id' => self::VOICE_ALIASES[$voice],
                'voice_label' => ucfirst($voice),
            ];
        }

        if (in_array($voice, self::SUPPORTED_VOICES, true)) {
            return [
                'voice_id' => $voice,
                'voice_label' => ucfirst($voice),
            ];
        }

        $randomAlias = (string) array_rand(self::VOICE_ALIASES);

        return [
            'voice_id' => self::VOICE_ALIASES[$randomAlias],
            'voice_label' => ucfirst($randomAlias),
        ];
    }

    private function normalizeSpeechSpeed(mixed $speed): float
    {
        $normalized = is_numeric($speed) ? (float) $speed : 1.0;

        if ($normalized < 0.25) {
            return 0.25;
        }

        if ($normalized > 2.0) {
            return 2.0;
        }

        return round($normalized, 2);
    }

    private function generateVoiceLine(string $kind, array $customerProfile = [], array $context = [], string $fallback = ''): string
    {
        $payload = [
            [
                'role' => 'developer',
                'content' => 'Return valid JSON with exactly one key: reply. Generate one short, natural Aahaas phone-agent line. Keep it brief, warm, and suitable for spoken audio. Do not use bullets.',
            ],
            [
                'role' => 'user',
                'content' => json_encode([
                    'kind' => $kind,
                    'customer_profile' => $customerProfile,
                    'context' => $context,
                ], JSON_UNESCAPED_SLASHES),
            ],
        ];

        try {
            $raw = $this->sendResponsesRequest($payload);
            $decoded = $this->decodeJsonObject($raw);
            $reply = trim((string) ($decoded['reply'] ?? ''));

            if ($reply !== '') {
                return $reply;
            }
        } catch (\Throwable) {
            // Fall through to the provided fallback if generation fails.
        }

        return $fallback;
    }
}
