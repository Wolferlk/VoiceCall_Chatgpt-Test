<?php

namespace App\Services;

use Illuminate\Http\Client\Response;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Http;
use RuntimeException;

class TripCallService
{
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
                $audio->getClientOriginalName() ?: 'trip-call-audio.webm',
                ['Content-Type' => $audio->getMimeType() ?: 'application/octet-stream']
            )
            ->post('https://api.openai.com/v1/audio/transcriptions', [
                'model' => $model,
                'response_format' => 'json',
            ]);

        $this->throwIfFailed($response, 'OpenAI transcription failed.');

        $transcript = trim((string) $response->json('text'));

        if ($transcript === '') {
            throw new RuntimeException('OpenAI returned an empty transcription.');
        }

        return $transcript;
    }

    public function generateTripReply(string $transcript, array $history = []): string
    {
        $prompt = env(
            'OPENAI_TRIP_CALL_SYSTEM_PROMPT',
            'You are Aahaas, a warm and capable travel planning voice agent. Help the caller plan trips step by step. Ask focused follow-up questions when details are missing, suggest practical travel ideas, keep replies concise enough for voice playback, and naturally ask whether the caller wants any changes before ending the call.'
        );

        return $this->generateTextReply($transcript, $history, $prompt);
    }

    public function summarizeTripPlan(array $history = []): string
    {
        $prompt = env(
            'OPENAI_TRIP_SUMMARY_SYSTEM_PROMPT',
            'Summarize this completed travel planning call as a final trip plan. Include destination, dates if known, travelers, budget, transport, lodging, activities, and special requests. If some details are missing, clearly mark them as pending. Keep it readable and useful for saving in a database record.'
        );

        $input = [
            [
                'role' => 'developer',
                'content' => $prompt,
            ],
        ];

        foreach ($history as $message) {
            $role = $message['role'] ?? null;
            $content = trim((string) ($message['content'] ?? ''));

            if (! in_array($role, ['user', 'assistant'], true) || $content === '') {
                continue;
            }

            $input[] = [
                'role' => $role,
                'content' => $content,
            ];
        }

        $input[] = [
            'role' => 'user',
            'content' => 'Create the final saved trip summary now.',
        ];

        return $this->sendResponsesRequest($input);
    }

    public function buildGreetingMessage(): string
    {
        return trim((string) env(
            'OPENAI_TRIP_CALL_GREETING',
            'Hello, this is Aahaas travel planning support. Tell me about the trip you want, and I will help you plan it step by step.'
        ));
    }

    public function buildHoldMessage(): string
    {
        return trim((string) env(
            'OPENAI_TRIP_CALL_HOLD_MESSAGE',
            'We are planning your trip according to your requirements. We need a short time to analyze your travel plan, so please stay on the call. Aahaas is your travel partner for making the most of your valuable free time.'
        ));
    }

    public function buildClosingMessage(string $planId): string
    {
        return "Your trip plan has been saved successfully. Your plan ID is {$planId}. If you need any changes later, you can continue from this plan. Thank you for calling Aahaas.";
    }

    public function synthesizeSpeech(string $text, ?string $instructions = null): array
    {
        $text = trim($text);

        if ($text === '') {
            throw new RuntimeException('Text is required for speech synthesis.');
        }

        $openAiApiKey = $this->requiredConfigValue('OPENAI_API_KEY');
        $voiceModel = env('OPENAI_VOICE_MODEL', 'gpt-4o-mini-tts');
        $voiceName = env('OPENAI_VOICE_NAME', 'coral');
        $voiceInstructions = $instructions ?: env(
            'OPENAI_VOICE_INSTRUCTIONS',
            'Speak clearly, warmly, and naturally like a polished travel call agent.'
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

    private function generateTextReply(string $transcript, array $history, string $developerPrompt): string
    {
        $transcript = trim($transcript);

        if ($transcript === '') {
            throw new RuntimeException('Transcript is required to generate a reply.');
        }

        $input = [
            [
                'role' => 'developer',
                'content' => $developerPrompt,
            ],
        ];

        foreach ($history as $message) {
            $role = $message['role'] ?? null;
            $content = trim((string) ($message['content'] ?? ''));

            if (! in_array($role, ['user', 'assistant'], true) || $content === '') {
                continue;
            }

            $input[] = [
                'role' => $role,
                'content' => $content,
            ];
        }

        $input[] = [
            'role' => 'user',
            'content' => $transcript,
        ];

        return $this->sendResponsesRequest($input);
    }

    private function sendResponsesRequest(array $input): string
    {
        $openAiApiKey = $this->requiredConfigValue('OPENAI_API_KEY');
        $model = env('OPENAI_CHAT_MODEL', 'gpt-4.1-mini');

        $response = Http::withToken($openAiApiKey)
            ->timeout(120)
            ->asJson()
            ->post('https://api.openai.com/v1/responses', [
                'model' => $model,
                'input' => $input,
            ]);

        $this->throwIfFailed($response, 'OpenAI response generation failed.');

        $reply = $this->extractReplyText($response);

        if ($reply === '') {
            throw new RuntimeException('OpenAI returned an empty reply.');
        }

        return $reply;
    }

    private function requiredConfigValue(string $key): string
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

    private function extractReplyText(Response $response): string
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

    private function throwIfFailed(Response $response, string $message): void
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
