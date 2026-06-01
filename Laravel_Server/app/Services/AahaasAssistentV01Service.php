<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use RuntimeException;

class AahaasAssistentV01Service extends AiAssistentFinalTestService
{
    private const RECENT_CONVERSATION_LIMIT = 8;

    private string $voiceName = 'coral';
    private float $voiceSpeed = 1.0;

    public function setVoiceConfig(string $voiceName, float $voiceSpeed): void
    {
        $this->voiceName = $voiceName ?: 'coral';
        $this->voiceSpeed = max(0.25, min(4.0, $voiceSpeed ?: 1.0));
    }

    public function synthesizeSpeech(string $text, ?string $instructions = null): array
    {
        $text = trim($text);

        if ($text === '') {
            throw new RuntimeException('Text is required for speech synthesis.');
        }

        $openAiApiKey = $this->requiredConfigValue('OPENAI_API_KEY');
        $voiceModel   = env('OPENAI_VOICE_MODEL', 'gpt-4o-mini-tts');
        $voiceInstructions = $instructions ?: env(
            'OPENAI_RECEPTION_VOICE_INSTRUCTIONS',
            'Speak like a polished premium call-center receptionist: warm, upbeat, clear, and reassuring.'
        );

        $payload = [
            'model'        => $voiceModel,
            'voice'        => $this->voiceName,
            'input'        => $text,
            'instructions' => $voiceInstructions,
            'response_format' => 'mp3',
        ];

        if (abs($this->voiceSpeed - 1.0) > 0.001) {
            $payload['speed'] = $this->voiceSpeed;
        }

        $response = Http::withToken($openAiApiKey)
            ->timeout(120)
            ->withHeaders(['Accept' => 'audio/mpeg', 'Content-Type' => 'application/json'])
            ->asJson()
            ->post('https://api.openai.com/v1/audio/speech', $payload);

        $this->throwIfFailed($response, 'OpenAI speech generation failed.');

        return [
            'body'      => $response->body(),
            'mime_type' => $response->header('Content-Type', 'audio/mpeg'),
        ];
    }

    public function buildGreeting(string $callId): string
    {
        $variants = [
            "Good day, welcome to Aahaas. How can I help you today?",
            "Hello, this is Aahaas. What can I help you with today?",
            "Good day, you've reached Aahaas. How can I help?",
        ];

        return $variants[array_rand($variants)];
    }

    public function buildPackageWaitMessage(): string
    {
        $variants = [
            "I'm checking the best options now. Just a moment.",
            "I'm putting the package together now. Please hold briefly.",
            "I've got your request. One quick moment while I check the options.",
        ];

        return $variants[array_rand($variants)];
    }

    public function buildPackageFailureCallbackReply(): string
    {
        $variants = [
            "The package service is busy right now, but we've saved your request and will follow up soon.",
            "I'm sorry, the package service is having trouble just now. We'll contact you shortly.",
            "Our package service is busy at the moment, so we've kept your request safe for follow-up.",
        ];

        return $variants[array_rand($variants)];
    }

    public function buildPackageDetailsPendingReply(): string
    {
        $variants = [
            "The package is still loading, but I can keep going with a couple of quick details.",
            "I'm still waiting on the package data, so let's keep the call moving with one more detail.",
            "The package is on its way, and I can keep the conversation moving meanwhile.",
        ];

        return $variants[array_rand($variants)];
    }

    public function buildClosingMessage(): string
    {
        $variants = [
            "Thanks for calling Aahaas. We'll send the details via WhatsApp shortly.",
            "Thank you for calling Aahaas. We'll follow up with your quotation soon.",
            "Thanks for reaching out to Aahaas. Our team will be in touch shortly.",
        ];

        return $variants[array_rand($variants)];
    }

    public function generateTurn(array $history = [], array $customerProfile = [], array $serviceCategories = []): array
    {
        $conversationLines = $this->buildRecentConversationLines($history);

        $payload = [
            [
                'role' => 'developer',
                'content' => $this->defaultSystemPrompt(),
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
            $reply = 'Please tell me a little more so I can help you properly.';
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

    private function buildRecentConversationLines(array $history): array
    {
        $conversationLines = [];

        foreach (array_slice($history, -self::RECENT_CONVERSATION_LIMIT) as $message) {
            $role = $message['role'] ?? null;
            $content = trim((string) ($message['content'] ?? ''));

            if (! in_array($role, ['user', 'assistant'], true) || $content === '') {
                continue;
            }

            $conversationLines[] = strtoupper($role) . ': ' . $content;
        }

        return $conversationLines;
    }

    /**
     * Send the quotation via WhatsApp API and email.
     * Returns: api_sent (bool), email_sent (bool), wa_id (string), error (string|null)
     */
    public function sendQuotation(
        string $callId,
        array  $customerProfile,
        array  $report,
        array  $serviceCategories
    ): array {
        $result = ['api_sent' => false, 'email_sent' => false, 'wa_id' => '', 'error' => null];

        $fullName  = trim((string) ($customerProfile['full_name'] ?? ''));
        $firstName = explode(' ', $fullName)[0];
        $rawPhone  = trim((string) ($customerProfile['contact_number'] ?? ''));
        $country   = trim((string) ($customerProfile['current_living_country'] ?? ''));

        $waId = $this->normalisePhoneForWhatsApp($rawPhone, $country);
        $result['wa_id'] = $waId;

        $prompt = $this->buildWhatsAppPrompt($customerProfile, $report, $serviceCategories);

        $whatsappUrl = trim((string) env(
            'AAHAAS_WHATSAPP_SEND_URL',
            'https://travel-parser-live.aahaas.com/v1/voice/send-whatsapp'
        ));

        if ($waId !== '') {
            try {
                $response = Http::timeout(90)->asJson()->post($whatsappUrl, [
                    'prompt'       => $prompt,
                    'waId'         => $waId,
                    'customerName' => $firstName,
                ]);

                $result['api_sent'] = $response->ok();

                if (! $response->ok()) {
                    $result['error'] = 'WhatsApp API returned HTTP ' . $response->status() . ': ' . substr($response->body(), 0, 300);
                    Log::warning('AahaasAssistentV01: WhatsApp API failed', [
                        'status' => $response->status(),
                        'body'   => substr($response->body(), 0, 500),
                        'wa_id'  => $waId,
                    ]);
                } else {
                    Log::info('AahaasAssistentV01: WhatsApp quotation sent', ['wa_id' => $waId, 'call_id' => $callId]);
                }
            } catch (\Throwable $e) {
                $result['error'] = $e->getMessage();
                Log::error('AahaasAssistentV01: WhatsApp API exception', ['message' => $e->getMessage()]);
            }
        } else {
            $result['error'] = 'Could not determine a valid WhatsApp number from "' . $rawPhone . '" (country: "' . $country . '")';
            Log::warning('AahaasAssistentV01: waId is empty', ['raw_phone' => $rawPhone, 'country' => $country]);
        }

        return $result;
    }

    public function hasQuotationContacts(array $customerProfile): bool
    {
        return trim((string) ($customerProfile['full_name'] ?? ''))              !== ''
            && trim((string) ($customerProfile['current_living_country'] ?? '')) !== ''
            && trim((string) ($customerProfile['contact_number'] ?? ''))         !== '';
    }

    // ── Phone normalisation ───────────────────────────────────────────────────

    /**
     * Convert any phone format to a WhatsApp ID (digits only, correct country code).
     * Examples:
     *   "0772897856"    + "Sri Lanka" → "94772897856"
     *   "+94 77 289 7856"             → "94772897856"
     *   "0044 7911 123456"            → "447911123456"
     *   "94772897856"                 → "94772897856" (already correct)
     */
    private function normalisePhoneForWhatsApp(string $phone, string $country): string
    {
        // Strip everything except digits and leading +
        $phone = preg_replace('/[^\d+]/', '', $phone);

        // Remove leading +
        if (str_starts_with($phone, '+')) {
            $phone = substr($phone, 1);
        }

        // Remove leading 00 (international dialling prefix)
        if (str_starts_with($phone, '00')) {
            $phone = substr($phone, 2);
        }

        // If the number still starts with 0, it's a local number → prepend country code
        if (str_starts_with($phone, '0')) {
            $code = $this->countryDialCode($country);
            if ($code !== '') {
                $phone = $code . substr($phone, 1);
            }
        }

        // Validate: must be 7–15 digits
        if (! preg_match('/^\d{7,15}$/', $phone)) {
            return '';
        }

        return $phone;
    }

    /**
     * Returns the dial code (no +) for a country name string.
     * Matches case-insensitively on full name, common abbreviations, and major cities.
     */
    private function countryDialCode(string $country): string
    {
        $c = strtolower(trim($country));

        $map = [
            // South Asia
            'sri lanka'             => '94',
            'lk'                    => '94',
            'india'                 => '91',
            'in'                    => '91',
            'pakistan'              => '92',
            'pk'                    => '92',
            'bangladesh'            => '880',
            'bd'                    => '880',
            'nepal'                 => '977',
            'np'                    => '977',
            'maldives'              => '960',
            'mv'                    => '960',
            // Southeast Asia
            'singapore'             => '65',
            'sg'                    => '65',
            'malaysia'              => '60',
            'my'                    => '60',
            'thailand'              => '66',
            'th'                    => '66',
            'vietnam'               => '84',
            'vn'                    => '84',
            'indonesia'             => '62',
            'id'                    => '62',
            'bali'                  => '62',
            'philippines'           => '63',
            'ph'                    => '63',
            'cambodia'              => '855',
            'kh'                    => '855',
            // East Asia
            'china'                 => '86',
            'cn'                    => '86',
            'japan'                 => '81',
            'jp'                    => '81',
            'south korea'           => '82',
            'korea'                 => '82',
            'kr'                    => '82',
            // Middle East
            'united arab emirates'  => '971',
            'uae'                   => '971',
            'dubai'                 => '971',
            'abu dhabi'             => '971',
            'ae'                    => '971',
            'saudi arabia'          => '966',
            'sa'                    => '966',
            'qatar'                 => '974',
            'qa'                    => '974',
            'kuwait'                => '965',
            'kw'                    => '965',
            'bahrain'               => '973',
            'bh'                    => '973',
            'oman'                  => '968',
            'om'                    => '968',
            // Europe
            'united kingdom'        => '44',
            'uk'                    => '44',
            'england'               => '44',
            'scotland'              => '44',
            'wales'                 => '44',
            'gb'                    => '44',
            'germany'               => '49',
            'de'                    => '49',
            'france'                => '33',
            'fr'                    => '33',
            'italy'                 => '39',
            'it'                    => '39',
            'spain'                 => '34',
            'es'                    => '34',
            'netherlands'           => '31',
            'nl'                    => '31',
            'switzerland'           => '41',
            'ch'                    => '41',
            'sweden'                => '46',
            'se'                    => '46',
            'norway'                => '47',
            'no'                    => '47',
            'denmark'               => '45',
            'dk'                    => '45',
            'belgium'               => '32',
            'be'                    => '32',
            'austria'               => '43',
            'at'                    => '43',
            'poland'                => '48',
            'pl'                    => '48',
            'russia'                => '7',
            'ru'                    => '7',
            // Oceania
            'australia'             => '61',
            'au'                    => '61',
            'new zealand'           => '64',
            'nz'                    => '64',
            // Americas
            'united states'         => '1',
            'usa'                   => '1',
            'us'                    => '1',
            'canada'                => '1',
            'ca'                    => '1',
            'brazil'                => '55',
            'br'                    => '55',
            'mexico'                => '52',
            'mx'                    => '52',
            // Africa
            'south africa'          => '27',
            'za'                    => '27',
            'kenya'                 => '254',
            'ke'                    => '254',
            'nigeria'               => '234',
            'ng'                    => '234',
        ];

        return $map[$c] ?? '';
    }

    // ── WhatsApp prompt builder ───────────────────────────────────────────────

    /**
     * Build a rich natural-language prompt for the WhatsApp API from all booking data.
     */
    private function buildWhatsAppPrompt(array $customerProfile, array $report, array $serviceCategories): string
    {
        $parts = [];

        // 1. Report summary (AI-generated full-sentence description)
        $summary = trim((string) ($report['summary'] ?? ''));
        if ($summary !== '') {
            $parts[] = $summary;
        }

        // 2. Package voice text / description
        $package = $customerProfile['suggested_package'] ?? null;
        if ($package !== null) {
            $voiceText = '';
            if (is_string($package)) {
                $voiceText = trim($package);
            } elseif (is_array($package)) {
                $voiceText = trim((string) (
                    $package['voice_text']
                    ?? $package['summary']
                    ?? $package['description']
                    ?? $package['reply']
                    ?? $package['message']
                    ?? ''
                ));

                // If still empty, try a nested structure
                if ($voiceText === '') {
                    foreach (['package', 'result', 'data'] as $key) {
                        $sub = $package[$key] ?? null;
                        if (is_string($sub) && trim($sub) !== '') {
                            $voiceText = trim($sub);
                            break;
                        }
                    }
                }
            }

            if ($voiceText !== '' && $voiceText !== $summary) {
                $parts[] = $voiceText;
            }
        }

        // 3. Explicit booking parameters
        $pax      = trim((string) ($customerProfile['traveler_count']        ?? '2'));
        $hotel    = trim((string) ($customerProfile['hotel_star_preference']  ?? '3-star'));
        $nights   = trim((string) ($customerProfile['number_of_days']         ?? '3'));
        $start    = trim((string) ($customerProfile['travel_start_date']      ?? 'next week'));
        $dest     = trim((string) ($customerProfile['destination_country']    ?? $customerProfile['country_to_visit'] ?? ''));
        $purpose  = trim((string) ($customerProfile['travel_purpose']         ?? ''));

        $booking = "Booking details: {$pax} PAX, {$hotel} hotel, {$nights} nights starting {$start}";
        if ($dest !== '') $booking .= ", destination: {$dest}";
        if ($purpose !== '' && $purpose !== 'any') $booking .= ", purpose: {$purpose}";
        $booking .= '.';
        $parts[] = $booking;

        // 4. Services
        if (! empty($serviceCategories)) {
            $parts[] = 'Services required: ' . implode(', ', $serviceCategories) . '.';
        }

        // 5. Products / follow-ups
        $products = array_filter($report['products_needed'] ?? []);
        if (! empty($products)) {
            $parts[] = 'Products needed: ' . implode(', ', $products) . '.';
        }

        $followUp = array_filter($report['follow_up_actions'] ?? []);
        if (! empty($followUp)) {
            $parts[] = 'Follow-up: ' . implode('. ', $followUp) . '.';
        }

        return implode(' ', array_filter($parts));
    }

    protected function defaultSystemPrompt(): string
    {
        return <<<'PROMPT'
You are Aahaas AI, a warm live-call receptionist for Aahaas. Sound natural, quick, and human on the phone. Never sound scripted or robotic.

GOAL:
- Keep replies to 1-2 short spoken sentences.
- Move the conversation forward in one turn.
- Ask only one clear question at a time.
- Never stall unless a package is actually loading.

DEFAULTS:
- Travel defaults are already assumed.
- Do not ask about travelers, hotel star, duration, or start date unless the caller changes them.
- Only ask for missing details that are truly needed.

PACKAGE RULES:
- If travel intent is clear, set needs_travel_package: true right away.
- Build travel_package_prompt from the caller's words plus the silent defaults.
- When a package is ready, present it in one short spoken paragraph and ask if it works.
- If the caller wants changes, acknowledge quickly and ask for the new detail.

CONTACT RULES:
- Only collect full name and WhatsApp number after the package is confirmed.
- Do not ask for email.
- Keep current_living_country as sri lanka unless the caller says otherwise.

VOICE STYLE:
- Use short, natural phrases like "Sure", "Of course", "Got it", "Perfect", "Absolutely".
- Use contractions.
- Avoid lines like "please continue", "I have recorded that", or "thank you for providing that information".

OUTPUT:
- Always return strict JSON with exactly these keys:
reply, customer_profile, service_categories, should_end, ended_reason, live_summary, needs_travel_package, travel_package_prompt, package_confirmation_status

SERVICE CATEGORIES ALLOWED:
Hotel Booking, Flight Booking, Sri Lanka Tour Planning, Transportation, Activities and Experiences, Restaurant and Dining, Other Services
PROMPT;
    }
}
