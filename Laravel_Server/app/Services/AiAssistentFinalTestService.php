<?php

namespace App\Services;

use Throwable;

class AiAssistentFinalTestService extends ElevenLabsReceptionCallService
{
    private const FINAL_TEST_TRAVEL_CATEGORIES = [
        'Hotel Booking',
        'Flight Booking',
        'Sri Lanka Tour Planning',
        'Transportation',
        'Activities and Experiences',
    ];

    public function buildGreeting(string $callId): string
    {
        $variants = [
            "Good day, Aahaas! How may I assist you today?",
            "Hello and welcome to Aahaas! How can I help you today?",
            "Good day! You've reached Aahaas. How may I assist you?",
        ];
        return $variants[array_rand($variants)];
    }

    public function buildHoldMessage(): string
    {
        $variants = [
            
            "Let me look into that for you. Please hold on briefly.",
            "We're finding the best match for your request. Just a moment, please.",
        ];
        return $variants[array_rand($variants)];
    }

    public function buildClosingMessage(): string
    {
        $variants = [
            "Thank you for calling Aahaas. Our team will be in touch with you shortly via WhatsApp.",
            "Thanks for reaching out to Aahaas. We'll send you the details via WhatsApp soon.",
            "Thank you for contacting Aahaas. We look forward to making your experience amazing!",
        ];
        return $variants[array_rand($variants)];
    }

    public function buildPackageWaitMessage(): string
    {
        $variants = [
            "We're putting together the best options for you. Please hold for just a moment.",
            "Our team is preparing your package details now. Just a brief hold, please.",
            "Finding the perfect match for your request — please hold on a moment.",
        ];
        return $variants[array_rand($variants)];
    }

    public function buildPackageFailureCallbackReply(): string
    {
        $variants = [
            "Our package team is handling a high volume right now. We'll prepare your options and share them via WhatsApp shortly.",
            "It looks like our package service is busy at the moment. We'll follow up with you via WhatsApp with the best options.",
            "Our team will put together your package details and reach out via WhatsApp very soon.",
        ];
        return $variants[array_rand($variants)];
    }

    public function buildPackageDetailsPendingReply(): string
    {
        $variants = [
            "Our team is putting together the best options for you right now — we'll share all the details via WhatsApp shortly. In the meantime, let me confirm a couple more things with you.",
            "The package details are being prepared as we speak — you'll have them via WhatsApp very soon. Just a couple more questions while we finalize that.",
            "We're working on the best match for your request. Our team will send everything via WhatsApp shortly — let me just confirm one more detail with you.",
        ];
        return $variants[array_rand($variants)];
    }

    public function summarizePackageLookupError(Throwable|string|null $error): string
    {
        $message = $error instanceof \Throwable ? $error->getMessage() : (string) $error;
        $message = trim($message);

        if ($message === '') {
            return 'The Aahaas package service did not return a valid response.';
        }

        if (stripos($message, 'cURL error') !== false) {
            return 'The Aahaas package service could not be reached.';
        }

        if (stripos($message, 'timeout') !== false) {
            return 'The Aahaas package service took too long to respond.';
        }

        if (stripos($message, '401') !== false || stripos($message, '403') !== false) {
            return 'The Aahaas package service rejected the request.';
        }

        if (stripos($message, '500') !== false || stripos($message, '502') !== false || stripos($message, '503') !== false) {
            return 'The Aahaas package service is temporarily unavailable.';
        }

        return mb_substr($message, 0, 220);
    }

    public function extractPackageDisplayText(array $suggestion): string
    {
        $summary = trim((string) (
            $suggestion['voice_text']
            ?? $suggestion['reply']
            ?? $suggestion['summary']
            ?? $suggestion['message']
            ?? ''
        ));

        if ($summary !== '') {
            return $summary;
        }

        return 'Aahaas returned package data, but no short spoken summary was available.';
    }

    public function formatPackageOfferReply(array $suggestion): string
    {
        $voiceText = $this->extractPackageDisplayText($suggestion);

        return trim("{$voiceText} Please tell me if this package is okay for you. If you want, you can also ask me about the package details.");
    }

    public function buildTranscriptionRecoveryReply(): string
    {
        $payload = [
            [
                'role' => 'developer',
                'content' => 'Return valid JSON with exactly one key: reply. Generate one short, natural Aahaas phone-agent sentence for when the caller audio was unclear. It should politely ask the caller to repeat, sound human, and stay under 20 words.',
            ],
            [
                'role' => 'user',
                'content' => json_encode([
                    'situation' => 'The latest caller audio could not be transcribed clearly.',
                    'goal' => 'Ask the caller to repeat naturally without sounding robotic.',
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
            // Fall through to the emergency fallback below only if generation fails.
        }

        return trim((string) env(
            'AAHAAS_TRANSCRIPTION_RECOVERY_FALLBACK',
            'Sorry, the line was unclear. Could you please say that once more?'
        ));
    }

    public function generateTurn(array $history = [], array $customerProfile = [], array $serviceCategories = []): array
    {
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

    public function isTravelRelated(array $serviceCategories): bool
    {
        foreach ($serviceCategories as $category) {
            if (in_array((string) $category, self::FINAL_TEST_TRAVEL_CATEGORIES, true)) {
                return true;
            }
        }

        return false;
    }

    public function hasRequiredContactDetails(array $customerProfile): bool
    {
        return trim((string) ($customerProfile['full_name'] ?? '')) !== ''
            && trim((string) ($customerProfile['contact_number'] ?? '')) !== ''
            && trim((string) ($customerProfile['email_address'] ?? '')) !== ''
            && trim((string) ($customerProfile['current_living_country'] ?? '')) !== '';
    }

    public function buildEarlyPackagePrompt(array $customerProfile, string $transcript, array $serviceCategories): string
    {
        $savedPrompt = trim((string) ($customerProfile['travel_package_prompt'] ?? ''));

        if ($savedPrompt !== '') {
            return $savedPrompt;
        }

        if ($this->hasEnoughTravelRequirements($customerProfile)) {
            return $this->buildPackagePromptFromProfile($customerProfile);
        }

        $categoryText = implode(', ', array_filter(array_map('strval', $serviceCategories)));
        $base = trim($transcript);

        if ($base === '') {
            $base = 'Customer wants travel help from Aahaas.';
        }

        if ($categoryText !== '') {
            return trim("Category: {$categoryText}. Request: {$base}");
        }

        return $base;
    }

    public function shouldWaitForPackage(array $customerProfile, array $serviceCategories): bool
    {
        $lookupStatus = trim((string) ($customerProfile['package_lookup_status'] ?? ''));

        return $this->isTravelRelated($serviceCategories)
            && in_array($lookupStatus, ['queued', 'pending'], true)
            && $this->hasRequiredContactDetails($customerProfile)
            && $this->hasEnoughTravelRequirements($customerProfile);
    }

    private function defaultSystemPrompt(): string
    {
        return <<<'PROMPT'
You are Aahaas AI, a warm and natural voice receptionist for Aahaas — Sri Lanka's AI-powered travel and lifestyle platform. The caller hears your words through ElevenLabs. Everything you say must sound like a real, friendly Aahaas team member on a phone call — never robotic, never scripted.

VOICE STYLE:
- Vary every acknowledgment naturally: "Sure!", "Of course", "Absolutely", "Perfect", "Got it", "Great", "Sounds good", "Alright", "Nice", "I see". Never use the same one twice in a row.
- NEVER say: "I've noted that", "I have saved your answer", "I'll note that down", "I have recorded that", "I am here with you", "Please continue", "Feel free to share", "Thank you for sharing", "Thank you for providing that information".
- Keep each reply to one or two short spoken sentences. No bullet points, no lists, no brackets.
- Always end with exactly one clear, specific question. Never leave the caller wondering what to say next.
- Use contractions naturally: "I'll", "you're", "that's", "we've", "we'll", "I'd".

AAHAAS COMPANY KNOWLEDGE — use these facts when answering general questions:
- Tour packages available to: Singapore, Malaysia, Thailand, Vietnam, Bali, Dubai, and full Sri Lanka tours.
- Hotel stays, flight tickets, and airport transfers can be included in or added to any package.
- Buffet dining options at top Colombo hotels including Cinnamon Grand, Cinnamon Red, Sofia Colombo, and more.
- Services: tour packages (with or without flights), hotel bookings, flight tickets, customized travel packages, airport transfers, Sri Lanka day tours, activity bookings, buffet reservations.
- Standard process: collect requirements → prepare quotation → share details via WhatsApp → confirm booking through the Aahaas app.

WHEN CALLER ASKS GENERAL QUESTIONS — give a warm, brief overview before narrowing:
- "What tour packages do you have?" → "We have packages to Singapore, Malaysia, Thailand, and Vietnam — and full Sri Lanka tour options too. Which destination were you thinking of?"
- "What buffets do you have?" → "We have great buffet options at hotels like Cinnamon Grand, Cinnamon Red, and Sofia Colombo, among others. Could you tell me how many guests and your preferred date?"
- "What flights do you have?" → "We arrange flights to various destinations including Singapore, Malaysia, Thailand, Vietnam, and more. Which destination are you flying to?"
- Always give a brief overview first, then ask the most important narrowing question.

CALL FLOW (model this on Aahaas real conversations):
1. Open warm: "Good morning/afternoon, Aahaas! How may I assist you today?" — let the caller explain freely.
2. Acknowledge their need briefly. If they asked a general question, give a short overview before collecting specifics.
3. Collect details one question at a time in a natural order: destination/need → dates → duration → passenger count → preferences → name → contact number.
4. Before closing: "We'll prepare the details and share them with you shortly via WhatsApp."
5. End naturally with a short recap and confirmation.

CONTACT DETAILS — collect naturally, one at a time, when not yet known:
full_name → contact_number → email_address → current_living_country

SERVICE-SPECIFIC QUESTIONS (ask the most important missing one each turn):
- Hotel Booking: city/area, check-in date, check-out date, guest count, star preference (3/4/5-star), budget per night.
- Flight Booking: departure city, destination, travel date, one-way or round-trip, passenger count, cabin class.
- Sri Lanka Tour Planning: trip duration, travel style (beach/wildlife/ancient/luxury), cities to visit, group type, budget.
- Customized Package: destination, dates, number of nights, passenger count and child ages if any, hotel star preference (3/4/5-star), meal plan (breakfast only / half board / full board), specific activities or sights like Universal Studios or Night Safari.
- Transportation: airport pickup needed, vehicle type (car/van/bus), passenger count, pickup point, destination, number of days.
- Activities & Experiences: activity type, vibe preference (adventure/cultural/relaxation), city/area, guest count, preferred date.
- Restaurant & Dining / Buffet: preferred hotel or restaurant, date, number of guests, dietary preferences if any.

PACKAGE LOGIC:
- When known_package_offer is available: answer ALL caller questions about the package directly from the package data — prices, hotels, flights, inclusions, activities. Never say "I don't have the details." Use the actual data.
- When presenting a package: describe it naturally from the package data, then ask "Does that sound good to you?"
- If the caller accepts: confirm warmly that the team will follow up, mention sharing details via WhatsApp, ask if there is anything else before closing.
- If the caller rejects: ask warmly what they would like changed, listen, and continue.
- When known_package_offer is NOT yet available and caller asks for specific details: tell them the team is preparing the best options and will share everything via WhatsApp shortly, then continue collecting any remaining details.

ENDING:
- Summarize the request naturally in one or two sentences.
- Ask "Does that all sound correct?" or "Is that everything you need for now?"
- After the caller confirms, say "Our team will prepare the details and share them with you via WhatsApp shortly."
- Set should_end true only after full confirmation.

OUTPUT: Always return strict JSON with exactly these keys:
reply, customer_profile, service_categories, should_end, ended_reason, live_summary, needs_travel_package, travel_package_prompt, package_confirmation_status

SERVICE CATEGORIES ALLOWED:
Hotel Booking, Flight Booking, Sri Lanka Tour Planning, Transportation, Activities and Experiences, Restaurant and Dining, Other Services
PROMPT;
    }
}
