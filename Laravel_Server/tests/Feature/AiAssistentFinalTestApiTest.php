<?php

namespace Tests\Feature;

use App\Models\ServiceCall;
use App\Services\AiAssistentFinalTestService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Tests\TestCase;

class AiAssistentFinalTestApiTest extends TestCase
{
    use RefreshDatabase;

    public function test_final_test_turn_recovers_from_transcription_failure(): void
    {
        $call = ServiceCall::create([
            'call_id' => 'CALL-AIFTFAIL',
            'status' => 'active',
            'customer_profile' => ['package_state' => 'not_started'],
            'service_categories' => [],
            'conversation_history' => [],
            'started_at' => now(),
        ]);

        $this->mock(AiAssistentFinalTestService::class, function ($mock): void {
            $mock->shouldReceive('transcribeAudio')
                ->once()
                ->andThrow(new \RuntimeException('OpenAI transcription failed.'));
            $mock->shouldReceive('buildTranscriptionRecoveryReply')
                ->once()
                ->andReturn('I did not catch that clearly. Please say it again in your own words, and I will continue from there.');
            $mock->shouldReceive('synthesizeSpeech')
                ->once()
                ->with('I did not catch that clearly. Please say it again in your own words, and I will continue from there.')
                ->andReturn([
                    'body' => 'retry-audio',
                    'mime_type' => 'audio/mpeg',
                ]);
        });

        $response = $this->post('/api/ai-assistent-final-test/turn', [
            'call_id' => $call->call_id,
            'audio' => UploadedFile::fake()->create('final-test-call.webm', 64, 'audio/webm'),
        ]);

        $response->assertOk()
            ->assertJsonPath('should_end', false)
            ->assertJsonPath('reply', 'I did not catch that clearly. Please say it again in your own words, and I will continue from there.');
    }

    public function test_package_status_returns_callback_message_when_aahaas_api_failed(): void
    {
        $call = ServiceCall::create([
            'call_id' => 'CALL-AIFTPKG1',
            'status' => 'active',
            'customer_profile' => [
                'package_state' => 'api_unavailable',
                'package_lookup_status' => 'failed',
                'package_lookup_error' => 'The Aahaas package service is temporarily unavailable.',
            ],
            'service_categories' => ['Sri Lanka Tour Planning'],
            'conversation_history' => [],
            'started_at' => now(),
        ]);

        $this->mock(AiAssistentFinalTestService::class, function ($mock): void {
            $mock->shouldReceive('buildPackageFailureCallbackReply')
                ->once()
                ->andReturn('Sorry, our agents are busy searching packages right now. We will let you know later, and our team can call you to discuss the details.');
            $mock->shouldReceive('synthesizeSpeech')
                ->once()
                ->with('Sorry, our agents are busy searching packages right now. We will let you know later, and our team can call you to discuss the details.')
                ->andReturn([
                    'body' => 'callback-audio',
                    'mime_type' => 'audio/mpeg',
                ]);
        });

        $response = $this->post('/api/ai-assistent-final-test/package-status', [
            'call_id' => $call->call_id,
        ]);

        $response->assertOk()
            ->assertJsonPath('failed', true)
            ->assertJsonPath('should_end', false)
            ->assertJsonPath('ended_reason', '')
            ->assertJsonPath('package_lookup_error', 'The Aahaas package service is temporarily unavailable.');
    }

    public function test_package_prefetch_saves_safe_error_message_without_crashing(): void
    {
        $call = ServiceCall::create([
            'call_id' => 'CALL-AIFTPKG2',
            'status' => 'active',
            'customer_profile' => [
                'package_state' => 'pending',
            ],
            'service_categories' => ['Sri Lanka Tour Planning'],
            'conversation_history' => [],
            'started_at' => now(),
        ]);

        $this->mock(AiAssistentFinalTestService::class, function ($mock): void {
            $mock->shouldReceive('isTravelRelated')
                ->once()
                ->andReturn(true);
            $mock->shouldReceive('buildEarlyPackagePrompt')
                ->once()
                ->andReturn('Customer wants Sri Lanka travel help.');
            $mock->shouldReceive('suggestTravelPackage')
                ->once()
                ->andThrow(new \RuntimeException('cURL error 28: Operation timed out'));
            $mock->shouldReceive('summarizePackageLookupError')
                ->once()
                ->andReturn('The Aahaas package service could not be reached.');
        });

        $response = $this->post('/api/ai-assistent-final-test/package-prefetch', [
            'call_id' => $call->call_id,
        ]);

        $response->assertOk()
            ->assertJsonPath('started', true)
            ->assertJsonPath('package_lookup_status', 'failed')
            ->assertJsonPath('package_lookup_error', 'The Aahaas package service could not be reached.');
    }
}
