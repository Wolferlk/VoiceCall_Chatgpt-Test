<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use RuntimeException;

class ElevenLabsReceptionCallService extends ReceptionCallService
{
    public function buildTranscriptionRecoveryReply(): string
    {
        return 'I could not catch that clearly, but I am still here with you. Please say that again when you are ready.';
    }

    public function buildGreeting(string $callId): string
    {
        return trim((string) env(
            'AAHAAS_CALL_GREETING',
            "Hello! Welcome to Aahaas. I'm your AI assistant. How can I help you today?"
        ));
    }

    public function generateTurn(array $history = [], array $customerProfile = [], array $serviceCategories = []): array
    {
        $developerPrompt = trim((string) env('AAHAAS_CALL_SYSTEM_PROMPT', $this->defaultSystemPrompt()));

        $conversationLines = [];

        foreach ($history as $message) {
            $role    = $message['role'] ?? null;
            $content = trim((string) ($message['content'] ?? ''));

            if (! in_array($role, ['user', 'assistant'], true) || $content === '') {
                continue;
            }

            $conversationLines[] = strtoupper($role) . ': ' . $content;
        }

        $payload = [
            [
                'role'    => 'developer',
                'content' => $developerPrompt,
            ],
            [
                'role'    => 'user',
                'content' => json_encode([
                    'known_customer_profile'  => $customerProfile,
                    'known_service_categories' => $serviceCategories,
                    'known_package_state'      => $customerProfile['package_state'] ?? null,
                    'known_package_offer'      => $customerProfile['suggested_package'] ?? null,
                    'conversation'             => $conversationLines,
                ], JSON_UNESCAPED_SLASHES),
            ],
        ];

        $raw     = $this->sendResponsesRequest($payload);
        $decoded = $this->decodeJsonObject($raw);
        $reply   = trim((string) ($decoded['reply'] ?? ''));

        if ($reply === '') {
            $reply = 'I am here with you. Please continue.';
        }

        return [
            'reply'                       => $reply,
            'customer_profile'            => is_array($decoded['customer_profile'] ?? null) ? $decoded['customer_profile'] : [],
            'service_categories'          => array_values(array_filter(
                is_array($decoded['service_categories'] ?? null) ? $decoded['service_categories'] : [],
                fn ($v) => is_string($v) && trim($v) !== ''
            )),
            'should_end'                  => (bool) ($decoded['should_end'] ?? false),
            'ended_reason'                => trim((string) ($decoded['ended_reason'] ?? '')),
            'live_summary'                => trim((string) ($decoded['live_summary'] ?? '')),
            'needs_travel_package'        => (bool) ($decoded['needs_travel_package'] ?? false),
            'travel_package_prompt'       => trim((string) ($decoded['travel_package_prompt'] ?? '')),
            'package_confirmation_status' => trim((string) ($decoded['package_confirmation_status'] ?? '')),
        ];
    }

    public function synthesizeSpeech(string $text, ?string $instructions = null): array
    {
        $text = trim($text);

        if ($text === '') {
            throw new RuntimeException('Text is required for speech synthesis.');
        }

        $apiKey  = $this->requiredConfigValue('ELEVENLABS_API_KEY');
        $voiceId = env('ELEVENLABS_VOICE_ID', 'JBFqnCBsd6RMkjVDRZzb');
        $modelId = env('ELEVENLABS_MODEL_ID', 'eleven_multilingual_v2');

        $response = Http::withHeaders([
            'xi-api-key'   => $apiKey,
            'Accept'       => 'audio/mpeg',
            'Content-Type' => 'application/json',
        ])
            ->timeout(60)
            ->asJson()
            ->post("https://api.elevenlabs.io/v1/text-to-speech/{$voiceId}?output_format=mp3_44100_128", [
                'text'           => $text,
                'model_id'       => $modelId,
                'voice_settings' => [
                    'stability'         => 0.35,  // Lower = more expressive, varied delivery
                    'similarity_boost'  => 0.80,  // Stay close to the voice character
                    'style'             => 0.50,  // v3: enables style/emotion range
                    'use_speaker_boost' => true,  // Cleaner, more present audio
                ],
            ]);

        $this->throwIfFailed($response, 'ElevenLabs speech synthesis failed.');

        return [
            'body'      => $response->body(),
            'mime_type' => $response->header('Content-Type', 'audio/mpeg'),
        ];
    }

    private function defaultSystemPrompt(): string
    {
        return <<<'PROMPT'
You are Aahaas AI, a warm and natural voice assistant for Aahaas — Sri Lanka's AI-powered travel and lifestyle platform.

VOICE STYLE (your reply text is spoken by ElevenLabs v3 — write for the ear, not the eye):
- Sound like a real, warm person on a phone call — never robotic or scripted.
- Vary every acknowledgment naturally. Use words like "Got it", "Sure", "Of course", "Absolutely", "Perfect", "I see", "That makes sense", "Sounds good", "Nice", "Alright", "Great" — never repeat the same one back-to-back.
- NEVER say any of the following — they are robotic and unnatural: "I've noted that", "I have saved your answer", "I will note that down", "I'll save that", "I have recorded that", "I am here with you", "Please continue", "Feel free to share", "I'm listening", "Thank you for sharing", "Thank you for that information", "Thank you for providing". After the caller gives you any info, react naturally like a real person — echo back what they said briefly, then ask the next question.
- NEVER start two consecutive replies with "Thank you". Use it at most once every 4 turns.
- Every reply MUST end with a specific, clear question that moves the conversation forward. Never leave the customer wondering what to say next.
- Keep each reply to one or two short spoken sentences. No bullet points, no lists, no brackets.
- Use natural spoken language: contractions ("I'll", "you're", "that's"), conversational rhythm.

CALL FLOW:
1. Open by asking what brings them to Aahaas today — let them explain freely first.
2. Once you understand their need, acknowledge it briefly and start collecting details one question at a time.
3. Collect contact details naturally woven into the conversation: full name → contact number → email → country.
4. Ask service-specific follow-up questions one at a time (destination, dates, travelers, budget, etc.) — pick the most important missing detail each turn.
5. Before ending, read back a short summary and ask if everything sounds right.
6. End the call only after the customer confirms all is good.

IMPORTANT — ALWAYS MOVE FORWARD:
- After every customer reply, pick the single most important missing piece of information and ask about it.
- If the customer already gave you something (e.g. their name), skip it and ask for the next missing detail.
- Never ask for information the customer already provided.
- Never say you will "note it down" or "save it" — just acknowledge and ask the next question.

DATA TO CAPTURE (populate customer_profile with every known value):
full_name, contact_number, email_address, current_living_country, and all service-specific details
(destination, travel dates, stay length, traveler count, budget, flight/hotel preference, booking_id, issue type, etc.)

SERVICE CATEGORIES: AI Travel Planning, Flight Booking, Hotel Reservations, Tours and Activities, Transportation Services, Group Travel Planning, Restaurant and Dining Offers, Shopping and Travel Essentials, Lifestyle Experiences, Booking Management, Customer Support, Other Services.

PACKAGE LOGIC:
- If the customer's first main request is travel-related, you may prepare an early travel_package_prompt from the current need even before every detail is collected.
- Continue the conversation naturally after that by collecting the remaining missing details one by one.
- When a company package recommendation is available, present it naturally and ask whether it is okay.
- If the customer accepts, confirm that the request will be completed and our team will contact them.
- If the customer rejects it, ask what should change, then prepare another option.
- Politely request contact number and email if not already collected and if the customer is comfortable sharing them.

ENDING: Set should_end true only after the customer confirms all details are correct and has nothing to add.

Always return strict JSON with exactly these keys: reply, customer_profile, service_categories, should_end, ended_reason, live_summary, needs_travel_package, travel_package_prompt, package_confirmation_status.
PROMPT;
    }
}
