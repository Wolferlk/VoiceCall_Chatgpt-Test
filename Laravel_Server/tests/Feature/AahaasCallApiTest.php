<?php

namespace Tests\Feature;

use App\Models\ServiceCall;
use App\Services\ElevenLabsReceptionCallService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Tests\TestCase;

class AahaasCallApiTest extends TestCase
{
    use RefreshDatabase;

    public function test_aahaas_call_turn_recovers_from_transcription_failure(): void
    {
        $call = ServiceCall::create([
            'call_id' => 'CALL-AHFAIL1',
            'status' => 'active',
            'customer_profile' => ['package_state' => 'not_started'],
            'service_categories' => [],
            'conversation_history' => [],
            'started_at' => now(),
        ]);

        $this->mock(ElevenLabsReceptionCallService::class, function ($mock): void {
            $mock->shouldReceive('transcribeAudio')
                ->once()
                ->andThrow(new \RuntimeException('OpenAI transcription failed.'));
            $mock->shouldReceive('buildTranscriptionRecoveryReply')
                ->once()
                ->andReturn('I could not catch that clearly, but I am still here with you. Please say that again when you are ready.');
            $mock->shouldReceive('synthesizeSpeech')
                ->once()
                ->with('I could not catch that clearly, but I am still here with you. Please say that again when you are ready.')
                ->andReturn([
                    'body' => 'retry-audio',
                    'mime_type' => 'audio/mpeg',
                ]);
        });

        $response = $this->post('/api/aahaas-call/turn', [
            'call_id' => $call->call_id,
            'audio' => UploadedFile::fake()->create('aahaas-call.webm', 64, 'audio/webm'),
        ]);

        $response->assertOk()
            ->assertJsonPath('should_end', false)
            ->assertJsonPath('reply', 'I could not catch that clearly, but I am still here with you. Please say that again when you are ready.');
    }

    public function test_aahaas_call_turn_can_store_early_package_and_continue_conversation(): void
    {
        $call = ServiceCall::create([
            'call_id' => 'CALL-AHEARLY1',
            'status' => 'active',
            'customer_profile' => ['package_state' => 'not_started'],
            'service_categories' => [],
            'conversation_history' => [],
            'started_at' => now(),
        ]);

        $this->mock(ElevenLabsReceptionCallService::class, function ($mock): void {
            $mock->shouldReceive('transcribeAudio')
                ->once()
                ->andReturn('I need a Sri Lanka family trip.');
            $mock->shouldReceive('generateTurn')
                ->once()
                ->andReturn([
                    'reply' => 'Of course. May I have your full name first?',
                    'customer_profile' => [
                        'travel_type' => 'Family Trip',
                    ],
                    'service_categories' => ['AI Travel Planning'],
                    'should_end' => false,
                    'ended_reason' => '',
                    'live_summary' => 'Customer wants a Sri Lanka family trip.',
                    'needs_travel_package' => false,
                    'travel_package_prompt' => '',
                    'package_confirmation_status' => '',
                ]);
            $mock->shouldReceive('detectPackageFeedback')
                ->once()
                ->andReturn('unknown');
            $mock->shouldReceive('isTravelRelated')
                ->once()
                ->andReturn(true);
            $mock->shouldReceive('hasEnoughTravelRequirements')
                ->once()
                ->andReturn(false);
            $mock->shouldReceive('suggestTravelPackage')
                ->once()
                ->with('I need a Sri Lanka family trip.')
                ->andReturn([
                    'voice_text' => 'We have a family Sri Lanka idea ready for you.',
                ]);
            $mock->shouldReceive('synthesizeSpeech')
                ->once()
                ->with('Of course. May I have your full name first? I found an early package idea from Aahaas, and I can read it after I collect a few more details.')
                ->andReturn([
                    'body' => 'early-audio',
                    'mime_type' => 'audio/mpeg',
                ]);
        });

        $response = $this->post('/api/aahaas-call/turn', [
            'call_id' => $call->call_id,
            'audio' => UploadedFile::fake()->create('aahaas-call.webm', 64, 'audio/webm'),
        ]);

        $response->assertOk()
            ->assertJsonPath('should_end', false)
            ->assertJsonPath('customer_profile.package_state', 'pending')
            ->assertJsonPath('service_categories.0', 'AI Travel Planning');
    }
}
