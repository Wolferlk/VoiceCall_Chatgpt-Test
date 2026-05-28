<?php

namespace App\Services;

use Illuminate\Http\Client\Response;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Http;
use RuntimeException;

class ReceptionCallService
{
    private const DEFAULT_PACKAGE_SUGGEST_URL = 'https://travel-parser-live.aahaas.com/v1/voice/suggest';
    private const TRAVEL_SERVICE_CATEGORIES = [
        'AI Travel Planning',
        'Flight Booking',
        'Hotel Reservations',
        'Tours and Activities',
        'Transportation Services',
        'Group Travel Planning',
    ];

    public function transcribeAudio(UploadedFile $audio): string
    {
        $openAiApiKey = $this->requiredConfigValue('OPENAI_API_KEY');
        $model = env('OPENAI_TRANSCRIPTION_MODEL', 'gpt-4o-mini-transcribe');
        $stream = fopen($audio->getRealPath(), 'r');

        if (! $stream) {
            throw new RuntimeException('Unable to read the uploaded audio file.');
        }

        $response = Http::withToken($openAiApiKey)
            ->timeout(120)
            ->attach(
                'file',
                $stream,
                $audio->getClientOriginalName() ?: 'service-call-audio.webm',
                ['Content-Type' => $audio->getMimeType() ?: 'application/octet-stream']
            )
            ->post('https://api.openai.com/v1/audio/transcriptions', [
                'model' => $model,
                'response_format' => 'json',
            ]);

        $this->throwIfFailed($response, 'OpenAI transcription failed.');

        $transcript = trim((string) $response->json('text'));

        // Empty transcription means silence or background noise — treat as silent turn
        if ($transcript === '') {
            return '__silent__';
        }

        return $transcript;
    }

    public function buildGreeting(string $callId): string
    {
        $baseGreeting = trim((string) env(
            'OPENAI_RECEPTION_CALL_GREETING',
            "Welcome to Aahaas. Thank you for calling Aahaas, Sri Lanka's AI-powered travel and lifestyle platform. My name is Aahaas AI Assistant, and I'm here to help you with travel planning, hotel bookings, flights, tours, lifestyle experiences, transportation, shopping, and customer support services. Before we begin, may I collect a few details to better assist you?"
        ));

        return "{$baseGreeting} Your call ID is {$callId}. Let's start with your full name.";
    }

    public function buildHoldMessage(): string
    {
        return trim((string) env(
            'OPENAI_RECEPTION_HOLD_MESSAGE',
            'Please wait. I saved your answer.'
        ));
    }

    public function buildClosingMessage(): string
    {
        return trim((string) env(
            'OPENAI_RECEPTION_CLOSING_MESSAGE',
            'Thank you. We saved your request. Our team will contact you soon.'
        ));
    }

    public function generateTurn(array $history = [], array $customerProfile = [], array $serviceCategories = []): array
    {
        $developerPrompt = trim((string) env(
            'OPENAI_RECEPTION_SYSTEM_PROMPT',
            "You are Aahaas AI Assistant, a warm receptionist for Aahaas. Conduct a voice call naturally and ask questions one by one only. Collect customer information first: full name, contact number, email address, and current living country. Then identify the requested service category from this list: AI Travel Planning, Flight Booking, Hotel Reservations, Tours and Activities, Transportation Services, Group Travel Planning, Restaurant and Dining Offers, Shopping and Travel Essentials, Lifestyle Experiences, Booking Management, Customer Support, Other Services. If the request is travel-related, ask about destination country, cities, date range, stay length, traveler count, flights, hotels, transport, travel type, budget, and preferences one at a time only when missing. If the request is booking support, ask for booking ID and issue type. If it is lifestyle, ask the experience type and location. If the user says go back, politely revisit the previous unanswered area. Keep replies concise for voice. When enough travel details exist to request a package suggestion, set needs_travel_package true and write a short travel_package_prompt that can be sent directly to a package API. If the customer accepts a shown package, set package_confirmation_status to accepted. If the customer rejects a shown package or wants changes, set package_confirmation_status to rejected and ask for the new requirements. When the customer confirms everything is complete or says they do not need more help, set should_end true. Always return strict JSON with keys: reply, customer_profile, service_categories, should_end, ended_reason, live_summary, needs_travel_package, travel_package_prompt, package_confirmation_status."
        ));

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
                'content' => $developerPrompt,
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

        return [
            'reply' => trim((string) ($decoded['reply'] ?? '')),
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

    public function buildFinalReport(array $history = [], array $customerProfile = [], array $serviceCategories = []): array
    {
        $developerPrompt = trim((string) env(
            'OPENAI_RECEPTION_REPORT_PROMPT',
            'Create a final structured customer call report for Aahaas. Return strict JSON with keys: summary, products_needed, service_categories, customer_profile, follow_up_actions. Summarize what the customer wants, which products or services they need, and what team should follow up.'
        ));

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
                'content' => $developerPrompt,
            ],
            [
                'role' => 'user',
                'content' => json_encode([
                    'customer_profile' => $customerProfile,
                    'service_categories' => $serviceCategories,
                    'conversation' => $conversationLines,
                ], JSON_UNESCAPED_SLASHES),
            ],
        ];

        $raw = $this->sendResponsesRequest($payload);
        $decoded = $this->decodeJsonObject($raw);

        return [
            'summary' => trim((string) ($decoded['summary'] ?? '')),
            'products_needed' => array_values(array_filter(
                is_array($decoded['products_needed'] ?? null) ? $decoded['products_needed'] : [],
                fn ($value) => is_string($value) && trim($value) !== ''
            )),
            'service_categories' => array_values(array_filter(
                is_array($decoded['service_categories'] ?? null) ? $decoded['service_categories'] : [],
                fn ($value) => is_string($value) && trim($value) !== ''
            )),
            'customer_profile' => is_array($decoded['customer_profile'] ?? null) ? $decoded['customer_profile'] : [],
            'follow_up_actions' => array_values(array_filter(
                is_array($decoded['follow_up_actions'] ?? null) ? $decoded['follow_up_actions'] : [],
                fn ($value) => is_string($value) && trim($value) !== ''
            )),
        ];
    }

    public function synthesizeSpeech(string $text, ?string $instructions = null): array
    {
        $text = trim($text);

        if ($text === '') {
            throw new RuntimeException('Text is required for speech synthesis.');
        }

        $openAiApiKey = $this->requiredConfigValue('OPENAI_API_KEY');
        $voiceModel = env('OPENAI_VOICE_MODEL', 'gpt-4o-mini-tts');
        $voiceName = env('OPENAI_RECEPTION_VOICE_NAME', env('OPENAI_VOICE_NAME', 'coral'));
        $voiceInstructions = $instructions ?: env(
            'OPENAI_RECEPTION_VOICE_INSTRUCTIONS',
            'Speak like a polished premium call-center receptionist: warm, upbeat, clear, and reassuring.'
        );

        $response = Http::withToken($openAiApiKey)
            ->timeout(120)
            ->withHeaders([
                'Accept' => 'audio/mpeg',
                'Content-Type' => 'application/json',
            ])
            ->asJson()
            ->post('https://api.openai.com/v1/audio/speech', [
                'model' => $voiceModel,
                'voice' => $voiceName,
                'input' => $text,
                'instructions' => $voiceInstructions,
                'response_format' => 'mp3',
            ]);

        $this->throwIfFailed($response, 'OpenAI speech generation failed.');

        return [
            'body' => $response->body(),
            'mime_type' => $response->header('Content-Type', 'audio/mpeg'),
        ];
    }

    public function suggestTravelPackage(string $prompt): array
    {
        $prompt = trim($prompt);

        if ($prompt === '') {
            throw new RuntimeException('A travel package prompt is required.');
        }

        $response = Http::timeout(120)
            ->asJson()
            ->post(env('TRAVEL_PACKAGE_SUGGEST_URL', self::DEFAULT_PACKAGE_SUGGEST_URL), [
                'prompt' => $prompt,
            ]);

        $this->throwIfFailed($response, 'Travel package suggestion failed.');

        $payload = $response->json();

        if (! is_array($payload)) {
            throw new RuntimeException('Travel package service returned an invalid response.');
        }

        return $payload;
    }

    public function formatPackageOfferReply(array $suggestion): string
    {
        $summary = trim((string) (
            $suggestion['voice_text']
            ?? $suggestion['reply']
            ?? $suggestion['summary']
            ?? $suggestion['message']
            ?? ''
        ));

        if ($summary === '') {
            $summary = $this->extractPackageSummaryFromNestedPayload($suggestion);
        }

        if ($summary === '') {
            $summary = 'I found a travel package suggestion based on your request.';
        }

        return trim("Here is a package suggestion for you: {$summary} Please tell me if this package is okay for you. If not, tell me what requirements you want to change.");
    }

    public function buildPackageApiUnavailableReply(): string
    {
        return 'Our package service is busy right now. We have saved your request, and one of our agents will contact you soon.';
    }

    public function detectPackageFeedback(string $transcript): string
    {
        $normalized = strtolower(trim($transcript));

        if ($normalized === '') {
            return 'unknown';
        }

        $rejectedPhrases = [
            'not okay',
            'not ok',
            'change it',
            'need to change',
            'not good',
            'another option',
            'other option',
            'different option',
            'different package',
            'reject',
            'not this one',
            'something else',
        ];

        foreach ($rejectedPhrases as $phrase) {
            if (str_contains($normalized, $phrase)) {
                return 'rejected';
            }
        }

        $acceptedPhrases = [
            'okay',
            'ok',
            'this is fine',
            'that is fine',
            'looks good',
            'sounds good',
            'yes, continue',
            'yes continue',
            'yes book it',
            'go ahead',
            'proceed',
            'accepted',
            'i like this',
        ];

        foreach ($acceptedPhrases as $phrase) {
            if (str_contains($normalized, $phrase)) {
                return 'accepted';
            }
        }

        return 'unknown';
    }

    public function isTravelRelated(array $serviceCategories): bool
    {
        foreach ($serviceCategories as $category) {
            if (in_array((string) $category, self::TRAVEL_SERVICE_CATEGORIES, true)) {
                return true;
            }
        }

        return false;
    }

    public function hasEnoughTravelRequirements(array $customerProfile): bool
    {
        $destination = trim((string) ($customerProfile['destination_country'] ?? $customerProfile['country_to_visit'] ?? ''));
        $places = $customerProfile['destination_places'] ?? $customerProfile['cities_or_places'] ?? null;
        $dateRange = trim((string) ($customerProfile['travel_date_range'] ?? $customerProfile['planned_travel_date_range'] ?? ''));
        $travelers = trim((string) ($customerProfile['traveler_count'] ?? $customerProfile['number_of_travelers'] ?? ''));
        $stayLength = trim((string) ($customerProfile['stay_length'] ?? $customerProfile['number_of_days'] ?? ''));

        $hasPlaces = is_array($places) ? count(array_filter($places)) > 0 : trim((string) $places) !== '';

        return $destination !== '' && $hasPlaces && $dateRange !== '' && $travelers !== '' && $stayLength !== '';
    }

    public function buildPackagePromptFromProfile(array $customerProfile): string
    {
        $duration = trim((string) ($customerProfile['stay_length'] ?? $customerProfile['number_of_days'] ?? 'trip length not specified'));
        $country = trim((string) ($customerProfile['destination_country'] ?? $customerProfile['country_to_visit'] ?? 'destination not specified'));
        $travelers = trim((string) ($customerProfile['traveler_count'] ?? $customerProfile['number_of_travelers'] ?? 'traveler count not specified'));
        $travelType = trim((string) ($customerProfile['travel_type'] ?? 'travel type not specified'));
        $places = $customerProfile['destination_places'] ?? $customerProfile['cities_or_places'] ?? [];
        $preferences = trim((string) ($customerProfile['special_requests'] ?? $customerProfile['preferences'] ?? ''));
        $budget = trim((string) ($customerProfile['budget'] ?? $customerProfile['estimated_budget'] ?? ''));

        $placesText = is_array($places) ? implode(', ', array_filter(array_map('strval', $places))) : trim((string) $places);
        $parts = [
            "\"{$duration}\" in \"{$country}\" trip",
            "for \"{$travelers}\" travelers",
            "planning a \"{$travelType}\"",
        ];

        if ($placesText !== '') {
            $parts[] = "visiting \"{$placesText}\"";
        }

        if ($preferences !== '') {
            $parts[] = "interested in \"{$preferences}\"";
        }

        if ($budget !== '') {
            $parts[] = "with a budget of \"{$budget}\"";
        }

        return implode(', ', $parts) . '.';
    }

    protected function sendResponsesRequest(array $input): string
    {
        $openAiApiKey = $this->requiredConfigValue('OPENAI_API_KEY');
        $model = env('OPENAI_CHAT_MODEL', 'gpt-4.1-mini');

        // Map Responses API roles to Chat Completions roles (developer → system)
        // Also ensure the system message contains the word "json" — required by OpenAI when using json_object response_format.
        $messages = array_map(function (array $msg): array {
            $role    = $msg['role'] === 'developer' ? 'system' : $msg['role'];
            $content = $msg['content'];

            if ($role === 'system' && stripos($content, 'json') === false) {
                $content .= ' Always return your response as valid JSON.';
            }

            return ['role' => $role, 'content' => $content];
        }, $input);

        $response = Http::withToken($openAiApiKey)
            ->timeout(120)
            ->asJson()
            ->post('https://api.openai.com/v1/chat/completions', [
                'model'           => $model,
                'messages'        => $messages,
                'response_format' => ['type' => 'json_object'],
            ]);

        if ($response->failed()) {
            $body = $response->json('error.message') ?: $response->body();
            throw new RuntimeException(
                'OpenAI response generation failed: ' . (is_string($body) ? substr($body, 0, 400) : 'unknown error'),
                $response->status() ?: 500
            );
        }

        $reply = trim((string) $response->json('choices.0.message.content'));

        if ($reply === '') {
            throw new RuntimeException('OpenAI returned an empty reply.');
        }

        return $reply;
    }

    protected function decodeJsonObject(string $raw): array
    {
        $raw = trim($raw);

        // Strip markdown code fences: ```json ... ``` or ``` ... ```
        $clean = preg_replace('/^```(?:json)?\s*/i', '', $raw) ?? $raw;
        $clean = trim(preg_replace('/\s*```\s*$/m', '', $clean) ?? $clean);

        // Try direct parse on the cleaned string first
        $decoded = json_decode($clean, true);
        if (is_array($decoded)) {
            return $decoded;
        }

        // Try direct parse on the original (in case stripping went wrong)
        $decoded = json_decode($raw, true);
        if (is_array($decoded)) {
            return $decoded;
        }

        // Extract the first balanced { ... } block
        $start = strpos($clean, '{');
        if ($start !== false) {
            $depth  = 0;
            $length = strlen($clean);
            for ($i = $start; $i < $length; $i++) {
                if ($clean[$i] === '{') {
                    $depth++;
                } elseif ($clean[$i] === '}') {
                    $depth--;
                    if ($depth === 0) {
                        $candidate = substr($clean, $start, $i - $start + 1);
                        $decoded   = json_decode($candidate, true);
                        if (is_array($decoded)) {
                            return $decoded;
                        }
                        break;
                    }
                }
            }
        }

        throw new RuntimeException(
            'OpenAI returned invalid JSON. First 300 chars: ' . substr($raw, 0, 300)
        );
    }

    protected function requiredConfigValue(string $key): string
    {
        $value = env($key);

        if (! is_string($value) || trim($value) === '') {
            throw new RuntimeException("{$key} is missing in Laravel_Server/.env.");
        }

        if (str_contains($value, 'your_') || str_contains($value, '_here')) {
            throw new RuntimeException("{$key} in Laravel_Server/.env is still a placeholder value.");
        }

        return trim($value);
    }

    protected function extractReplyText(Response $response): string
    {
        $directText = trim((string) $response->json('output_text'));

        if ($directText !== '') {
            return $directText;
        }

        $output = $response->json('output');

        if (! is_array($output)) {
            return '';
        }

        $segments = [];

        foreach ($output as $item) {
            if (! is_array($item) || ($item['role'] ?? null) !== 'assistant') {
                continue;
            }

            $content = $item['content'] ?? null;

            if (! is_array($content)) {
                continue;
            }

            foreach ($content as $part) {
                if (! is_array($part)) {
                    continue;
                }

                $text = trim((string) ($part['text'] ?? ''));

                if ($text !== '') {
                    $segments[] = $text;
                }
            }
        }

        return trim(implode("\n", $segments));
    }

    protected function extractPackageSummaryFromNestedPayload(array $payload): string
    {
        foreach (['package', 'result', 'data'] as $key) {
            $value = $payload[$key] ?? null;

            if (is_string($value) && trim($value) !== '') {
                return trim($value);
            }

            if (is_array($value)) {
                $summary = trim((string) ($value['summary'] ?? $value['reply'] ?? $value['message'] ?? ''));

                if ($summary !== '') {
                    return $summary;
                }

                $name = trim((string) ($value['name'] ?? $value['title'] ?? ''));
                $details = trim((string) ($value['description'] ?? $value['details'] ?? ''));

                if ($name !== '' && $details !== '') {
                    return "{$name}. {$details}";
                }

                if ($name !== '') {
                    return $name;
                }
            }
        }

        if (isset($payload['packages']) && is_array($payload['packages']) && $payload['packages'] !== []) {
            $firstPackage = $payload['packages'][0];

            if (is_array($firstPackage)) {
                $name = trim((string) ($firstPackage['name'] ?? $firstPackage['title'] ?? ''));
                $details = trim((string) ($firstPackage['description'] ?? $firstPackage['summary'] ?? ''));

                if ($name !== '' && $details !== '') {
                    return "{$name}. {$details}";
                }

                if ($name !== '') {
                    return $name;
                }
            }
        }

        return '';
    }

    protected function throwIfFailed(Response $response, string $message): void
    {
        if (! $response->failed()) {
            return;
        }

        $details = $response->json() ?: $response->body();

        throw new RuntimeException(
            is_string($details) && $details !== ''
                ? "{$message} {$details}"
                : $message,
            $response->status() ?: 500
        );
    }
}
