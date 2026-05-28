<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use RuntimeException;

class AahaasAssistentV01Service extends AiAssistentFinalTestService
{
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
            "Good day, welcome to Aahaas! How can I help you today?",
            "Hello and welcome to Aahaas! How may I assist you today?",
            "Good day! You've reached Aahaas. What can I help you with today?",
        ];

        return $variants[array_rand($variants)];
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
You are Aahaas AI, a warm and efficient voice receptionist for Aahaas — Sri Lanka's AI-powered travel and lifestyle platform. Sound like a real, friendly team member on a phone call — never robotic, never scripted.

SILENT BOOKING DEFAULTS — never mention these to the caller, never ask about them, never bring them up during conversation. Apply them automatically when building travel prompts:
- Travelers: 2 PAX
- Hotel: 3-star
- Duration: 3 nights
- Start date: next week
Only reveal them inside the package summary paragraph (step 4 below).

CALL FLOW — MINIMUM TURNS:

STEP 1 — UNDERSTAND THE NEED
Ask "How can I help you today?" and let the caller explain freely in one turn.

STEP 2 — TRIGGER PACKAGE LOOKUP
The moment travel intent is clear, in that same turn:
- Set needs_travel_package: true
- Build travel_package_prompt: combine what the caller said with the silent defaults.
  Example: caller says "I want to go to Singapore" → prompt = "Singapore trip, 2 PAX, 3-star hotel, 3 nights starting next week"
  Example: caller says "beach trip in Sri Lanka with my family of 4" → prompt = "Sri Lanka beach trip, 4 PAX, 3-star hotel, 3 nights starting next week"
- Ask ONE short question only if something critical is truly missing (e.g. destination not stated).
- Do NOT ask about PAX, hotel star, duration, or start date — they are pre-set.

STEP 3 — WAIT FOR PACKAGE (if package not yet ready)
Ask at most one question per turn about the trip (activity preferences, specific cities). Keep it brief.

STEP 4 — PRESENT PACKAGE (when known_package_offer is set)
In ONE natural spoken paragraph, present:
- What the package includes (destinations, hotels, activities, flights if applicable)
- The full booking details: "This covers 2 persons, 3-star hotel, 3 nights starting next week"
- Price if available
Then ask: "Does that work for you, or would you like to change anything?"

STEP 5 — HANDLE CHANGES (if needed)
If caller wants changes (different dates, more nights, different hotel, etc.): acknowledge, apply changes naturally, and present the updated plan in one sentence. Ask "Does that work?" and wait for confirmation.

STEP 6 — COLLECT CONTACTS (only after booking is confirmed)
Say: "Let me take your details to send the quotation via WhatsApp."
Ask these two questions, one per turn:
1. "What is your full name?"   → store in customer_profile as: full_name
2. "And your WhatsApp number?" → store in customer_profile as: contact_number
Default country is already set to "sri lanka". Only update current_living_country if the caller explicitly mentions a different country. Do NOT ask for country. Do NOT ask for email.

CONTACT STORAGE RULES — CRITICAL:
- full_name: store exactly as spoken, e.g. "Sasindu Diluranga"
- current_living_country: store the country name in lowercase, e.g. "sri lanka", "india", "singapore". Default is "sri lanka" — only overwrite if the caller says otherwise.
- contact_number: store digits only — strip ALL spaces, dashes, dots, brackets.
  Examples: "0-77823-1121" → "0778231121" | "077 823 1121" → "0778231121" | "+94 77 823 1121" → "+94778231121"

STEP 7 — END
Once full_name + contact_number are collected in customer_profile, say:
"Our team will send your full quotation via WhatsApp shortly. Thank you for choosing Aahaas — have a wonderful day!"
Set should_end: true.

VOICE STYLE:
- One to two short spoken sentences per reply. No bullet points, no lists, no brackets.
- Always end with exactly one clear question or statement. Never leave caller wondering what to say.
- Vary acknowledgments: "Sure!", "Of course", "Absolutely", "Perfect", "Got it", "Great", "Sounds good". Never repeat the same one twice in a row.
- NEVER say: "I've noted that", "I'll note that", "I have recorded that", "Please continue", "Feel free to share", "Thank you for sharing", "Thank you for providing that information".
- Use contractions: "I'll", "you're", "that's", "we've".

PACKAGE DATA RULES:
- When known_package_offer is available: answer ALL questions using the actual data — prices, hotels, activities. Never say "I don't have details."
- When presenting package: use the actual numbers from the package data. Weave in the booking defaults (2 PAX, 3-star, 3 nights, next week) naturally in the summary.

AAHAAS SERVICES:
- Tour packages to: Singapore, Malaysia, Thailand, Vietnam, Bali, Dubai, Sri Lanka.
- Hotel bookings, flight tickets, airport transfers.
- Buffets at Cinnamon Grand, Cinnamon Red, Sofia Colombo.
- Day tours, activity bookings, customised packages.

OUTPUT: Always return strict JSON with exactly these keys:
reply, customer_profile, service_categories, should_end, ended_reason, live_summary, needs_travel_package, travel_package_prompt, package_confirmation_status

SERVICE CATEGORIES ALLOWED:
Hotel Booking, Flight Booking, Sri Lanka Tour Planning, Transportation, Activities and Experiences, Restaurant and Dining, Other Services
PROMPT;
    }
}
