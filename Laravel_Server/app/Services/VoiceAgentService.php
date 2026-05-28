<?php

namespace App\Services;

use Illuminate\Http\Client\Response;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Http;
use RuntimeException;

class VoiceAgentService
{
    public function synthesizeSpeech(string $text): array
    {
        $text = trim($text);

        if ($text === '') {
            throw new RuntimeException('Text is required for speech synthesis.');
        }

        $elevenLabsApiKey = $this->requiredConfigValue('ELEVENLABS_API_KEY');
        $voiceId = env('ELEVENLABS_VOICE_ID', 'JBFqnCBsd6RMkjVDRZzb');
        $modelId = env('ELEVENLABS_MODEL_ID', 'eleven_multilingual_v2');

        $response = Http::withHeaders([
            'xi-api-key' => $elevenLabsApiKey,
            'Accept' => 'audio/mpeg',
            'Content-Type' => 'application/json',
        ])
            ->timeout(60)
            ->asJson()
            ->post("https://api.elevenlabs.io/v1/text-to-speech/{$voiceId}?output_format=mp3_44100_128", [
                'text' => $text,
                'model_id' => $modelId,
            ]);

        $this->throwIfFailed($response, 'ElevenLabs request failed.');

        return [
            'body' => $response->body(),
            'mime_type' => $response->header('Content-Type', 'audio/mpeg'),
        ];
    }

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
                $audio->getClientOriginalName() ?: 'call-audio.webm',
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

    public function generateReply(string $transcript, array $history = [], ?string $developerPrompt = null): string
    {
        $openAiApiKey = $this->requiredConfigValue('OPENAI_API_KEY');
        $model = env('OPENAI_CHAT_MODEL', 'gpt-4.1-mini');
        $developerPrompt = $developerPrompt ?: env(
            'OPENAI_CALL_SYSTEM_PROMPT',
            'You are a helpful AI phone assistant. Reply naturally, briefly, and conversationally. Keep answers concise enough to sound good when spoken aloud.'
        );

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
