<?php

namespace Tests\Feature;

use App\Jobs\SendWhatsAppQuotationJob;
use App\Models\ServiceCall;
use App\Services\AahaasAssistentV01Service;
use App\Services\ElevenLabsReceptionCallService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
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

    public function test_aahaas_assistent_v01_send_quotation_accepts_whatsapp_number_alias(): void
    {
        Queue::fake();

        $call = ServiceCall::create([
            'call_id' => 'CALL-V01WA1',
            'status' => 'completed',
            'customer_profile' => [
                'full_name' => 'Sasindu Diluranga',
                'whatsapp_number' => '+94 77 823 1121',
                'current_living_country' => 'sri lanka',
            ],
            'service_categories' => ['Sri Lanka Tour Planning'],
            'conversation_history' => [],
            'latest_report' => 'Customer wants a Sri Lanka trip.',
            'started_at' => now(),
            'ended_at' => now(),
            'ended_reason' => 'completed',
        ]);

        $response = $this->postJson('/api/aahaas-assistent-v01/send-quotation', [
            'call_id' => $call->call_id,
        ]);

        $response->assertOk()
            ->assertJsonPath('queued', true);

        Queue::assertPushed(SendWhatsAppQuotationJob::class, function (SendWhatsAppQuotationJob $job): bool {
            $payload = (new \ReflectionClass($job))->getProperty('customerProfile');
            $payload->setAccessible(true);

            $customerProfile = $payload->getValue($job);

            return ($customerProfile['contact_number'] ?? '') === '94778231121';
        });
    }

    public function test_aahaas_assistent_v01_send_quotation_prefixes_indian_numbers_with_91(): void
    {
        Http::fake([
            'https://travel-parser-live.aahaas.com/v1/voice/send-whatsapp' => Http::response([], 200),
        ]);

        $service = app(AahaasAssistentV01Service::class);

        $result = $service->sendQuotation(
            'CALL-V01IN1',
            [
                'full_name' => 'Test User',
                'contact_number' => '0778231121',
                'current_living_country' => 'india',
            ],
            ['summary' => 'Customer wants a quote.'],
            ['Sri Lanka Tour Planning']
        );

        $this->assertTrue($result['api_sent']);
        $this->assertSame('91778231121', $result['wa_id']);

        Http::assertSent(function ($request): bool {
            $data = $request->data();

            return ($data['waId'] ?? '') === '91778231121';
        });
    }

    public function test_aahaas_assistent_v01_session_uses_country_from_ip_header(): void
    {
        $this->mock(AahaasAssistentV01Service::class, function ($mock): void {
            $mock->shouldReceive('setVoiceConfig')->once();
            $mock->shouldReceive('buildGreeting')->once()->andReturn('Hello from Aahaas.');
            $mock->shouldReceive('synthesizeSpeech')->once()->andReturn([
                'body' => 'greeting-audio',
                'mime_type' => 'audio/mpeg',
            ]);
        });

        $response = $this->withHeaders(['CF-IPCountry' => 'IN'])
            ->postJson('/api/aahaas-assistent-v01/session', [
                'voice_name' => 'coral',
                'voice_speed' => 1,
            ]);

        $response->assertOk();

        $callId = $response->json('call_id');
        $call = ServiceCall::query()->where('call_id', $callId)->firstOrFail();

        $this->assertSame('india', $call->customer_profile['current_living_country'] ?? '');
    }
}
