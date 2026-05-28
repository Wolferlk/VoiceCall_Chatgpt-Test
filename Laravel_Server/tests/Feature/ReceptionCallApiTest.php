<?php

namespace Tests\Feature;

use App\Models\ServiceCall;
use App\Services\ReceptionCallService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Tests\TestCase;

class ReceptionCallApiTest extends TestCase
{
    use RefreshDatabase;

    public function test_reception_call_session_creates_call_and_returns_audio_payloads(): void
    {
        $this->mock(ReceptionCallService::class, function ($mock): void {
            $mock->shouldReceive('buildGreeting')
                ->once()
                ->andReturn('Welcome to Aahaas. Let us begin.');
            $mock->shouldReceive('buildHoldMessage')
                ->once()
                ->andReturn('Please stay on the line.');
            $mock->shouldReceive('synthesizeSpeech')
                ->once()
                ->with('Welcome to Aahaas. Let us begin.')
                ->andReturn([
                    'body' => 'greeting-audio',
                    'mime_type' => 'audio/mpeg',
                ]);
            $mock->shouldReceive('synthesizeSpeech')
                ->once()
                ->with('Please stay on the line.', 'Speak calmly and elegantly like a premium receptionist during hold music.')
                ->andReturn([
                    'body' => 'hold-audio',
                    'mime_type' => 'audio/mpeg',
                ]);
        });

        $response = $this->postJson('/api/reception-call/session');

        $response->assertOk()
            ->assertJsonPath('status', 'active')
            ->assertJsonPath('greeting', 'Welcome to Aahaas. Let us begin.')
            ->assertJsonPath('hold_message', 'Please stay on the line.')
            ->assertJsonPath('greeting_audio_base64', base64_encode('greeting-audio'))
            ->assertJsonPath('hold_audio_base64', base64_encode('hold-audio'));

        $this->assertDatabaseCount('service_calls', 1);
    }

    public function test_reception_call_turn_requires_audio_and_call_id(): void
    {
        $response = $this->withHeader('Accept', 'application/json')->post('/api/reception-call/turn', []);

        $response->assertStatus(422);
    }

    public function test_reception_call_turn_updates_customer_data_and_categories(): void
    {
        $call = ServiceCall::create([
            'call_id' => 'CALL-ABC123',
            'status' => 'active',
            'customer_profile' => [],
            'service_categories' => [],
            'conversation_history' => [],
            'started_at' => now(),
        ]);

        $this->mock(ReceptionCallService::class, function ($mock): void {
            $mock->shouldReceive('transcribeAudio')
                ->once()
                ->andReturn('My name is John and I need a hotel in Colombo.');
            $mock->shouldReceive('generateTurn')
                ->once()
                ->andReturn([
                    'reply' => 'Thank you John. May I have your contact number?',
                    'customer_profile' => [
                        'full_name' => 'John',
                    ],
                    'service_categories' => ['Hotel Reservations'],
                    'should_end' => false,
                    'ended_reason' => '',
                    'live_summary' => 'Customer wants a hotel reservation in Colombo.',
                    'needs_travel_package' => false,
                    'travel_package_prompt' => '',
                    'package_confirmation_status' => '',
                ]);
            $mock->shouldReceive('detectPackageFeedback')
                ->once()
                ->andReturn('unknown');
            $mock->shouldReceive('isTravelRelated')
                ->once()
                ->andReturn(false);
            $mock->shouldReceive('synthesizeSpeech')
                ->once()
                ->with('Thank you John. May I have your contact number?')
                ->andReturn([
                    'body' => 'reply-audio',
                    'mime_type' => 'audio/mpeg',
                ]);
        });

        $response = $this->post('/api/reception-call/turn', [
            'call_id' => $call->call_id,
            'audio' => UploadedFile::fake()->create('reception-call.webm', 64, 'audio/webm'),
        ]);

        $response->assertOk()
            ->assertJsonPath('call_id', 'CALL-ABC123')
            ->assertJsonPath('transcript', 'My name is John and I need a hotel in Colombo.')
            ->assertJsonPath('reply', 'Thank you John. May I have your contact number?')
            ->assertJsonPath('service_categories.0', 'Hotel Reservations')
            ->assertJsonPath('customer_profile.full_name', 'John');

        $call->refresh();

        $this->assertSame(['full_name' => 'John'], $call->customer_profile);
        $this->assertSame(['Hotel Reservations'], $call->service_categories);
    }

    public function test_reception_call_turn_accepts_typed_transcript_for_testing(): void
    {
        $call = ServiceCall::create([
            'call_id' => 'CALL-TEXT123',
            'status' => 'active',
            'customer_profile' => [],
            'service_categories' => [],
            'conversation_history' => [],
            'started_at' => now(),
        ]);

        $this->mock(ReceptionCallService::class, function ($mock): void {
            $mock->shouldNotReceive('transcribeAudio');
            $mock->shouldReceive('generateTurn')
                ->once()
                ->andReturn([
                    'reply' => 'Thank you. What is your email address?',
                    'customer_profile' => ['full_name' => 'Nimal'],
                    'service_categories' => ['Customer Support'],
                    'should_end' => false,
                    'ended_reason' => '',
                    'live_summary' => 'Customer shared a full name.',
                    'needs_travel_package' => false,
                    'travel_package_prompt' => '',
                    'package_confirmation_status' => '',
                ]);
            $mock->shouldReceive('detectPackageFeedback')
                ->once()
                ->andReturn('unknown');
            $mock->shouldReceive('isTravelRelated')
                ->once()
                ->andReturn(false);
            $mock->shouldReceive('synthesizeSpeech')
                ->once()
                ->with('Thank you. What is your email address?')
                ->andReturn([
                    'body' => 'reply-audio',
                    'mime_type' => 'audio/mpeg',
                ]);
        });

        $response = $this->postJson('/api/reception-call/turn', [
            'call_id' => $call->call_id,
            'transcript' => 'My name is Nimal.',
        ]);

        $response->assertOk()
            ->assertJsonPath('transcript', 'My name is Nimal.')
            ->assertJsonPath('customer_profile.full_name', 'Nimal');
    }

    public function test_reception_call_turn_can_offer_suggested_package(): void
    {
        $call = ServiceCall::create([
            'call_id' => 'CALL-PACK123',
            'status' => 'active',
            'customer_profile' => [],
            'service_categories' => ['AI Travel Planning'],
            'conversation_history' => [],
            'started_at' => now(),
        ]);

        $this->mock(ReceptionCallService::class, function ($mock): void {
            $mock->shouldReceive('transcribeAudio')
                ->once()
                ->andReturn('I want a family Sri Lanka tour.');
            $mock->shouldReceive('generateTurn')
                ->once()
                ->andReturn([
                    'reply' => 'I have enough information to prepare a package.',
                    'customer_profile' => [
                        'travel_type' => 'Family Trip',
                        'destination_country' => 'Sri Lanka',
                        'destination_places' => ['Colombo', 'Galle'],
                        'travel_date_range' => '2026-07-01 to 2026-07-05',
                        'traveler_count' => '4',
                        'stay_length' => '5-day',
                        'preferences' => 'cultural sites and beach activities',
                    ],
                    'service_categories' => ['AI Travel Planning'],
                    'should_end' => false,
                    'ended_reason' => '',
                    'live_summary' => 'Travel request captured.',
                    'needs_travel_package' => false,
                    'travel_package_prompt' => '',
                    'package_confirmation_status' => 'pending',
                ]);
            $mock->shouldReceive('detectPackageFeedback')
                ->once()
                ->andReturn('unknown');
            $mock->shouldReceive('isTravelRelated')
                ->once()
                ->andReturn(true);
            $mock->shouldReceive('hasEnoughTravelRequirements')
                ->once()
                ->andReturn(true);
            $mock->shouldReceive('buildPackagePromptFromProfile')
                ->once()
                ->andReturn('"5-day" in "Sri Lanka" trip, for "4" travelers, planning a "Family Trip", visiting "Colombo, Galle", interested in "cultural sites and beach activities".');
            $mock->shouldReceive('suggestTravelPackage')
                ->once()
                ->with('"5-day" in "Sri Lanka" trip, for "4" travelers, planning a "Family Trip", visiting "Colombo, Galle", interested in "cultural sites and beach activities".')
                ->andReturn([
                    'summary' => 'A 5-day Sri Lanka family trip with culture and beach stops.',
                ]);
            $mock->shouldReceive('formatPackageOfferReply')
                ->once()
                ->andReturn('Here is a package suggestion for you: A 5-day Sri Lanka family trip. Please tell me if this package is okay for you.');
            $mock->shouldReceive('synthesizeSpeech')
                ->once()
                ->with('I have enough information to prepare a package. Here is a package suggestion for you: A 5-day Sri Lanka family trip. Please tell me if this package is okay for you.')
                ->andReturn([
                    'body' => 'package-audio',
                    'mime_type' => 'audio/mpeg',
                ]);
        });

        $response = $this->post('/api/reception-call/turn', [
            'call_id' => $call->call_id,
            'audio' => UploadedFile::fake()->create('reception-call.webm', 64, 'audio/webm'),
        ]);

        $response->assertOk()
            ->assertJsonPath('customer_profile.package_state', 'offered')
            ->assertJsonPath('service_categories.0', 'AI Travel Planning');
    }

    public function test_reception_call_turn_uses_package_offer_before_ending_travel_call(): void
    {
        $call = ServiceCall::create([
            'call_id' => 'CALL-ENDPKG1',
            'status' => 'active',
            'customer_profile' => [
                'destination_country' => 'Sri Lanka',
                'destination_places' => ['Kandy', 'Sigiriya'],
                'travel_date_range' => '2026-08-01 to 2026-08-05',
                'traveler_count' => '4',
                'stay_length' => '5-day',
                'travel_type' => 'Family Trip',
            ],
            'service_categories' => ['AI Travel Planning'],
            'conversation_history' => [],
            'started_at' => now(),
        ]);

        $this->mock(ReceptionCallService::class, function ($mock): void {
            $mock->shouldReceive('transcribeAudio')
                ->once()
                ->andReturn('That is all I need.');
            $mock->shouldReceive('generateTurn')
                ->once()
                ->andReturn([
                    'reply' => 'Thank you for the details.',
                    'customer_profile' => [],
                    'service_categories' => ['AI Travel Planning'],
                    'should_end' => true,
                    'ended_reason' => 'customer_ready_to_finish',
                    'live_summary' => 'Travel details collected.',
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
                ->andReturn(true);
            $mock->shouldReceive('buildPackagePromptFromProfile')
                ->once()
                ->andReturn('"5-day" in "Sri Lanka" trip with "my family"');
            $mock->shouldReceive('suggestTravelPackage')
                ->once()
                ->andReturn([
                    'voice_text' => 'We recommend a family Sri Lanka package with Kandy and Sigiriya experiences.',
                ]);
            $mock->shouldReceive('formatPackageOfferReply')
                ->once()
                ->andReturn('We recommend a family Sri Lanka package with Kandy and Sigiriya experiences. Is this package okay for you?');
            $mock->shouldReceive('synthesizeSpeech')
                ->once()
                ->with('Thank you for the details. We recommend a family Sri Lanka package with Kandy and Sigiriya experiences. Is this package okay for you?')
                ->andReturn([
                    'body' => 'package-audio',
                    'mime_type' => 'audio/mpeg',
                ]);
        });

        $response = $this->post('/api/reception-call/turn', [
            'call_id' => $call->call_id,
            'audio' => UploadedFile::fake()->create('reception-call.webm', 64, 'audio/webm'),
        ]);

        $response->assertOk()
            ->assertJsonPath('should_end', false)
            ->assertJsonPath('customer_profile.package_state', 'offered');
    }

    public function test_reception_call_turn_falls_back_when_package_api_is_unavailable(): void
    {
        $call = ServiceCall::create([
            'call_id' => 'CALL-PKGFAIL1',
            'status' => 'active',
            'customer_profile' => [
                'destination_country' => 'Sri Lanka',
                'destination_places' => ['Kandy'],
                'travel_date_range' => '2026-08-01 to 2026-08-05',
                'traveler_count' => '2',
                'stay_length' => '5-day',
                'travel_type' => 'Family Trip',
            ],
            'service_categories' => ['AI Travel Planning'],
            'conversation_history' => [],
            'started_at' => now(),
        ]);

        $this->mock(ReceptionCallService::class, function ($mock): void {
            $mock->shouldReceive('transcribeAudio')
                ->once()
                ->andReturn('Please finish the call.');
            $mock->shouldReceive('generateTurn')
                ->once()
                ->andReturn([
                    'reply' => 'Thank you.',
                    'customer_profile' => [],
                    'service_categories' => ['AI Travel Planning'],
                    'should_end' => true,
                    'ended_reason' => 'customer_ready_to_finish',
                    'live_summary' => 'Travel details collected.',
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
                ->andReturn(true);
            $mock->shouldReceive('buildPackagePromptFromProfile')
                ->once()
                ->andReturn('"5-day" in "Sri Lanka" trip');
            $mock->shouldReceive('suggestTravelPackage')
                ->once()
                ->andThrow(new \RuntimeException('Package API busy'));
            $mock->shouldReceive('buildPackageApiUnavailableReply')
                ->once()
                ->andReturn('Our package service is busy right now. We have saved your request, and one of our agents will contact you soon.');
            $mock->shouldReceive('synthesizeSpeech')
                ->once()
                ->with('Our package service is busy right now. We have saved your request, and one of our agents will contact you soon.')
                ->andReturn([
                    'body' => 'fallback-audio',
                    'mime_type' => 'audio/mpeg',
                ]);
        });

        $response = $this->post('/api/reception-call/turn', [
            'call_id' => $call->call_id,
            'audio' => UploadedFile::fake()->create('reception-call.webm', 64, 'audio/webm'),
        ]);

        $response->assertOk()
            ->assertJsonPath('should_end', true)
            ->assertJsonPath('ended_reason', 'package_api_unavailable')
            ->assertJsonPath('customer_profile.package_state', 'api_unavailable');
    }

    public function test_reception_call_end_saves_final_report(): void
    {
        $call = ServiceCall::create([
            'call_id' => 'CALL-END123',
            'status' => 'active',
            'customer_profile' => ['full_name' => 'Jane'],
            'service_categories' => ['Flight Booking'],
            'conversation_history' => [
                ['role' => 'user', 'content' => 'I need flights to Dubai.'],
                ['role' => 'assistant', 'content' => 'What dates are you planning?'],
            ],
            'started_at' => now(),
        ]);

        $this->mock(ReceptionCallService::class, function ($mock): void {
            $mock->shouldReceive('buildFinalReport')
                ->once()
                ->andReturn([
                    'summary' => 'Customer needs a Dubai flight quote.',
                    'products_needed' => ['Flight tickets'],
                    'service_categories' => ['Flight Booking'],
                    'customer_profile' => ['full_name' => 'Jane'],
                    'follow_up_actions' => ['Send flight options'],
                ]);
            $mock->shouldReceive('buildClosingMessage')
                ->once()
                ->andReturn('Thank you for calling Aahaas.');
            $mock->shouldReceive('synthesizeSpeech')
                ->once()
                ->with('Thank you for calling Aahaas.')
                ->andReturn([
                    'body' => 'closing-audio',
                    'mime_type' => 'audio/mpeg',
                ]);
        });

        $response = $this->postJson('/api/reception-call/end', [
            'call_id' => $call->call_id,
            'ended_reason' => 'customer_confirmed_complete',
        ]);

        $response->assertOk()
            ->assertJsonPath('call_id', 'CALL-END123')
            ->assertJsonPath('status', 'completed')
            ->assertJsonPath('report.summary', 'Customer needs a Dubai flight quote.')
            ->assertJsonPath('audio_base64', base64_encode('closing-audio'));

        $call->refresh();

        $this->assertSame('completed', $call->status);
        $this->assertSame('customer_confirmed_complete', $call->ended_reason);
        $this->assertNotNull($call->final_report);
    }
}
