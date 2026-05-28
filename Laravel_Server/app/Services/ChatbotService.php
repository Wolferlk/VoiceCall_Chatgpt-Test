<?php

namespace App\Services;

use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use RuntimeException;

class ChatbotService
{
    private string $voiceName  = 'coral';
    private float  $voiceSpeed = 1.0;

    private const SYSTEM_PROMPT = <<<'PROMPT'
You are the Aahaas AI travel assistant — a professional, warm, and helpful chatbot for Aahaas Travel Sri Lanka.

YOUR FLOW:

STEP 1 — GREET AND UNDERSTAND
Greet the customer and ask what they are looking for. Understand their travel needs.

STEP 2 — GATHER REQUIREMENTS
Through natural conversation, collect:
- Destination / tour type (e.g. Sigiriya, Ella, beach, cultural tour)
- Travel start date or approximate timeframe
- Duration (number of days/nights)
- Number of travelers
- Hotel preference (star rating: 3-star, 4-star, 5-star)
- Activities of interest
- Special requirements or budget

When you have: destination + duration + traveler count (minimum), set trigger_package_fetch: true and write a very detailed package_prompt. Set trigger_package_fetch: true exactly ONCE per package.

STEP 3 — WHILE PACKAGE IS FETCHING
Continue chatting naturally. If asked about the package, say it is being prepared right now.
Do NOT set trigger_package_fetch: true again while the package is being fetched (status: fetching).

STEP 4 — PRESENT THE PACKAGE
When a package is provided in the system context, present it enthusiastically:
- Package name, total price, duration
- Included accommodation details
- Included activities and experiences
- Transport and transfers
- Why it suits the customer perfectly
Ask if they would like any changes.

STEP 5 — REFINE THE PACKAGE
If the customer wants changes (more days, better hotel, different activities, different price), update the package_prompt and set trigger_package_fetch: true to re-fetch an improved package.
If they are happy with it, ask for booking confirmation.

STEP 6 — CONFIRM BOOKING
When the customer confirms the booking, set booking_confirmed: true.
Then collect:
1. "What is your full name?" → store as full_name
2. "What is your WhatsApp number?" → store as contact_number (digits only, no dashes/spaces/+)
Default current_living_country to "sri lanka" unless they mention a different country.

STEP 7 — END
Once both full_name and contact_number are in customer_profile, set should_end: true.
Say: "Wonderful! Our team will send your full quotation via WhatsApp shortly. Thank you for choosing Aahaas Travel — we look forward to making your journey unforgettable!"

IMPORTANT RULES:
- Keep customer_profile updated throughout the conversation
- contact_number: digits only (strip all spaces, dashes, +, brackets)
- Only set trigger_package_fetch: true when you have enough travel details
- service_categories: select from ["Sri Lanka Tour Planning", "Hotel Booking", "Flight Booking", "Transportation", "Activities and Experiences"]
- live_summary: update every turn with a 1-2 sentence summary of what was discussed

RESPONSE FORMAT (valid JSON only, no markdown wrapping):
{
  "reply": "Your conversational message to the customer",
  "customer_profile": {
    "full_name": "",
    "contact_number": "",
    "current_living_country": "sri lanka",
    "traveler_count": "",
    "travel_start_date": "",
    "number_of_days": "",
    "hotel_star_preference": "",
    "activities": "",
    "travel_purpose": "",
    "package_state": "not_started"
  },
  "service_categories": [],
  "live_summary": "One to two sentence summary of this conversation so far",
  "trigger_package_fetch": false,
  "package_prompt": "",
  "booking_confirmed": false,
  "should_end": false
}
PROMPT;

    public function setVoiceConfig(string $name, float $speed): void
    {
        $this->voiceName  = $name ?: 'coral';
        $this->voiceSpeed = max(0.25, min(4.0, $speed));
    }

    private function openAiKey(): string
    {
        $key = trim((string) env('OPENAI_API_KEY', ''));
        if ($key === '') {
            throw new RuntimeException('OPENAI_API_KEY is not configured.');
        }
        return $key;
    }

    public function processMessage(
        array   $history,
        string  $userMessage,
        array   $customerProfile,
        array   $serviceCategories,
        ?array  $suggestedPackage   = null,
        string  $packageFetchStatus = '',
    ): array {
        $messages = [['role' => 'system', 'content' => self::SYSTEM_PROMPT]];

        foreach ($history as $msg) {
            if (isset($msg['role'], $msg['content'])) {
                $messages[] = ['role' => $msg['role'], 'content' => $msg['content']];
            }
        }

        // Inject package context
        $contextNote = '';
        if ($suggestedPackage && $packageFetchStatus === 'ready') {
            $pkgJson     = is_string($suggestedPackage)
                ? $suggestedPackage
                : json_encode($suggestedPackage, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
            $contextNote = "\n\n[SYSTEM CONTEXT: The travel package has been successfully fetched. Present this package now.\nPackage data:\n{$pkgJson}]";
        } elseif ($packageFetchStatus === 'fetching') {
            $contextNote = "\n\n[SYSTEM CONTEXT: A package is being fetched in background. Do NOT set trigger_package_fetch again. Continue chatting.]";
        } elseif ($packageFetchStatus === 'failed') {
            $contextNote = "\n\n[SYSTEM CONTEXT: Package fetch failed. Tell the customer our team will prepare options manually and send via WhatsApp.]";
        }

        $messages[] = ['role' => 'user', 'content' => $userMessage . $contextNote];

        $response = Http::withToken($this->openAiKey())
            ->timeout(60)
            ->post('https://api.openai.com/v1/chat/completions', [
                'model'           => 'gpt-4o',
                'messages'        => $messages,
                'max_tokens'      => 700,
                'response_format' => ['type' => 'json_object'],
            ]);

        if (! $response->ok()) {
            Log::error('ChatbotService: OpenAI error', ['status' => $response->status()]);
            throw new RuntimeException('AI service error: ' . $response->status());
        }

        $content = $response->json('choices.0.message.content', '{}');
        $parsed  = json_decode($content, true) ?: [];

        $mergedProfile    = array_filter(
            array_merge($customerProfile, $parsed['customer_profile'] ?? []),
            fn ($v) => $v !== null && $v !== ''
        );
        $mergedCategories = array_values(array_unique(array_merge(
            $serviceCategories,
            $parsed['service_categories'] ?? []
        )));

        return [
            'reply'                 => $parsed['reply']            ?? 'I apologize, please try again.',
            'customer_profile'      => $mergedProfile,
            'service_categories'    => $mergedCategories,
            'live_summary'          => $parsed['live_summary']     ?? '',
            'trigger_package_fetch' => (bool) ($parsed['trigger_package_fetch'] ?? false),
            'package_prompt'        => $parsed['package_prompt']   ?? '',
            'booking_confirmed'     => (bool) ($parsed['booking_confirmed']    ?? false),
            'should_end'            => (bool) ($parsed['should_end']           ?? false),
        ];
    }

    public function transcribeAudio(UploadedFile $file): string
    {
        $response = Http::withToken($this->openAiKey())
            ->timeout(60)
            ->attach('file', file_get_contents($file->getPathname()), $file->getClientOriginalName() ?: 'audio.webm')
            ->post('https://api.openai.com/v1/audio/transcriptions', ['model' => 'whisper-1']);

        if (! $response->ok()) {
            throw new RuntimeException('Audio transcription failed: ' . $response->status());
        }

        return $response->json('text', '');
    }

    public function analyzeImage(UploadedFile $file, string $context = ''): string
    {
        $imageData = base64_encode(file_get_contents($file->getPathname()));
        $mimeType  = $file->getMimeType() ?: 'image/jpeg';

        $prompt = $context !== ''
            ? $context
            : 'Analyze this image in the context of travel planning for Aahaas Travel Sri Lanka. If it shows a destination, describe it and suggest suitable packages. If it contains text (brochure, itinerary, booking confirmation), extract all relevant text. Be concise and helpful.';

        $response = Http::withToken($this->openAiKey())
            ->timeout(60)
            ->post('https://api.openai.com/v1/chat/completions', [
                'model'      => 'gpt-4o',
                'max_tokens' => 500,
                'messages'   => [[
                    'role'    => 'user',
                    'content' => [
                        ['type' => 'text',      'text'      => $prompt],
                        ['type' => 'image_url', 'image_url' => ['url' => "data:{$mimeType};base64,{$imageData}", 'detail' => 'low']],
                    ],
                ]],
            ]);

        if (! $response->ok()) {
            throw new RuntimeException('Image analysis failed: ' . $response->status());
        }

        return $response->json('choices.0.message.content', 'Could not analyze the image.');
    }

    public function synthesizeSpeech(string $text): array
    {
        $text = trim(mb_substr(strip_tags($text), 0, 4096));
        if ($text === '') {
            throw new RuntimeException('Empty text for speech synthesis.');
        }

        $payload = [
            'model'           => env('OPENAI_VOICE_MODEL', 'gpt-4o-mini-tts'),
            'voice'           => $this->voiceName,
            'input'           => $text,
            'response_format' => 'mp3',
            'instructions'    => env('OPENAI_RECEPTION_VOICE_INSTRUCTIONS', 'Speak like a polished premium travel concierge: warm, clear, and professional.'),
        ];

        if (abs($this->voiceSpeed - 1.0) > 0.001) {
            $payload['speed'] = $this->voiceSpeed;
        }

        $response = Http::withToken($this->openAiKey())
            ->timeout(120)
            ->withHeaders(['Accept' => 'audio/mpeg', 'Content-Type' => 'application/json'])
            ->asJson()
            ->post('https://api.openai.com/v1/audio/speech', $payload);

        if (! $response->ok()) {
            throw new RuntimeException('Speech synthesis failed: ' . $response->status());
        }

        return ['body' => $response->body(), 'mime_type' => 'audio/mpeg'];
    }

    public function fetchPackage(string $prompt): array
    {
        $url = trim((string) env('TRAVEL_PACKAGE_SUGGEST_URL', 'https://travel-parser-live.aahaas.com/v1/voice/suggest'));

        $response = Http::timeout(90)->asJson()->post($url, ['prompt' => $prompt]);

        if (! $response->ok()) {
            throw new RuntimeException('Package API returned HTTP ' . $response->status());
        }

        return $response->json() ?: [];
    }

    public function sendWhatsApp(string $sessionId, array $customerProfile, ?array $package): array
    {
        $url      = trim((string) env('AAHAAS_WHATSAPP_SEND_URL', 'https://travel-parser-live.aahaas.com/v1/voice/send-whatsapp'));
        $name     = trim((string) ($customerProfile['full_name']       ?? 'Customer'));
        $rawPhone = trim((string) ($customerProfile['contact_number']  ?? ''));
        $country  = trim((string) ($customerProfile['current_living_country'] ?? 'sri lanka'));
        $waId     = $this->normalizePhone($rawPhone, $country);

        if ($waId === '') {
            return ['sent' => false, 'error' => 'Invalid WhatsApp number: "' . $rawPhone . '"'];
        }

        $firstName = explode(' ', $name)[0];
        $pkgText   = $package
            ? json_encode($package, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)
            : 'Custom travel package as discussed with our AI assistant.';

        $prompt = "Dear {$name},\n\nThank you for choosing Aahaas Travel!\n\nHere is your personalized travel package quotation:\n\n{$pkgText}\n\nTo confirm your booking or ask any questions, please reply to this message.\n\nBest regards,\nAahaas Travel Team";

        try {
            $response = Http::timeout(90)->asJson()->post($url, [
                'prompt'       => $prompt,
                'waId'         => $waId,
                'customerName' => $firstName,
            ]);

            if ($response->ok()) {
                Log::info('ChatbotService: WhatsApp sent', ['session_id' => $sessionId, 'wa_id' => $waId]);
                return ['sent' => true, 'wa_id' => $waId];
            }

            Log::warning('ChatbotService: WhatsApp failed', ['status' => $response->status()]);
            return ['sent' => false, 'wa_id' => $waId, 'error' => 'WhatsApp API returned HTTP ' . $response->status()];
        } catch (\Throwable $e) {
            Log::error('ChatbotService: WhatsApp exception', ['error' => $e->getMessage()]);
            return ['sent' => false, 'wa_id' => $waId, 'error' => $e->getMessage()];
        }
    }

    public function hasContactInfo(array $profile): bool
    {
        return trim((string) ($profile['full_name']      ?? '')) !== ''
            && trim((string) ($profile['contact_number'] ?? '')) !== '';
    }

    public function normalizePhone(string $phone, string $country = 'sri lanka'): string
    {
        $phone = preg_replace('/[^\d+]/', '', $phone);
        if (str_starts_with($phone, '+'))  $phone = substr($phone, 1);
        if (str_starts_with($phone, '00')) $phone = substr($phone, 2);
        if (str_starts_with($phone, '0')) {
            $code = $this->countryCode($country);
            if ($code !== '') $phone = $code . substr($phone, 1);
        }
        return preg_match('/^\d{7,15}$/', $phone) ? $phone : '';
    }

    private function countryCode(string $country): string
    {
        $map = [
            'sri lanka' => '94', 'lk' => '94',
            'india'     => '91', 'in' => '91',
            'pakistan'  => '92', 'pk' => '92',
            'bangladesh'=> '880', 'maldives' => '960',
            'nepal'     => '977', 'singapore' => '65',
            'malaysia'  => '60',  'thailand'  => '66',
            'indonesia' => '62',  'uae'       => '971',
            'united arab emirates' => '971', 'dubai' => '971',
            'saudi arabia' => '966', 'qatar' => '974',
            'uk'        => '44',  'united kingdom' => '44',
            'usa'       => '1',   'united states'  => '1',
            'canada'    => '1',   'australia' => '61',
            'germany'   => '49',  'france'    => '33',
            'italy'     => '39',  'spain'     => '34',
            'russia'    => '7',   'china'     => '86',
            'japan'     => '81',  'south korea' => '82',
        ];
        return $map[strtolower(trim($country))] ?? '';
    }
}
