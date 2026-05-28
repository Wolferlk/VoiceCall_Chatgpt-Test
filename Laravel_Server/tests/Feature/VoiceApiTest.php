<?php

namespace Tests\Feature;

use App\Services\VoiceAgentService;
use Illuminate\Http\UploadedFile;
use Tests\TestCase;

class VoiceApiTest extends TestCase
{
    public function test_health_reports_openai_and_elevenlabs_flags(): void
    {
        $response = $this->getJson('/api/health');

        $response->assertOk()->assertJsonStructure([
            'status',
            'elevenlabsConfigured',
            'openaiConfigured',
        ]);
    }

    public function test_tts_requires_text(): void
    {
        $response = $this->postJson('/api/tts', [
            'text' => '',
        ]);

        $response->assertStatus(422);
    }

    public function test_ai_call_requires_audio(): void
    {
        $response = $this->withHeader('Accept', 'application/json')->post('/api/ai-call', [
            'history' => json_encode([]),
        ]);

        $response->assertStatus(422);
    }

    public function test_ai_call_returns_transcript_reply_and_audio_payload(): void
    {
        $this->mock(VoiceAgentService::class, function ($mock): void {
            $mock->shouldReceive('transcribeAudio')
                ->once()
                ->andReturn('Hello assistant');
            $mock->shouldReceive('generateReply')
                ->once()
                ->with('Hello assistant', [])
                ->andReturn('Hello human');
            $mock->shouldReceive('synthesizeSpeech')
                ->once()
                ->with('Hello human')
                ->andReturn([
                    'body' => 'fake-mp3-audio',
                    'mime_type' => 'audio/mpeg',
                ]);
        });

        $response = $this->post('/api/ai-call', [
            'audio' => UploadedFile::fake()->create('call.webm', 64, 'audio/webm'),
            'history' => json_encode([]),
        ]);

        $response->assertOk()->assertJson([
            'transcript' => 'Hello assistant',
            'reply' => 'Hello human',
            'audio_base64' => base64_encode('fake-mp3-audio'),
            'audio_mime_type' => 'audio/mpeg',
        ]);
    }

    public function test_text_ai_voice_requires_text(): void
    {
        $response = $this->postJson('/api/text-ai-voice', [
            'text' => '',
        ]);

        $response->assertStatus(422);
    }

    public function test_text_ai_voice_returns_reply_and_audio_payload(): void
    {
        $this->mock(VoiceAgentService::class, function ($mock): void {
            $mock->shouldReceive('generateReply')
                ->once()
                ->with('Explain Laravel simply', [], \Mockery::type('string'))
                ->andReturn('Laravel is a PHP framework for building web apps.');
            $mock->shouldReceive('synthesizeSpeech')
                ->once()
                ->with('Laravel is a PHP framework for building web apps.')
                ->andReturn([
                    'body' => 'fake-voice-audio',
                    'mime_type' => 'audio/mpeg',
                ]);
        });

        $response = $this->postJson('/api/text-ai-voice', [
            'text' => 'Explain Laravel simply',
            'history' => [],
        ]);

        $response->assertOk()->assertJson([
            'text' => 'Explain Laravel simply',
            'reply' => 'Laravel is a PHP framework for building web apps.',
            'audio_base64' => base64_encode('fake-voice-audio'),
            'audio_mime_type' => 'audio/mpeg',
        ]);
    }
}
