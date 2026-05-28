<?php

namespace Tests\Feature;

use App\Models\TripPlan;
use App\Services\TripCallService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Tests\TestCase;

class TripCallApiTest extends TestCase
{
    use RefreshDatabase;

    public function test_trip_call_session_creates_plan_and_returns_audio_payloads(): void
    {
        $this->mock(TripCallService::class, function ($mock): void {
            $mock->shouldReceive('buildGreetingMessage')
                ->once()
                ->andReturn('Welcome to Aahaas.');
            $mock->shouldReceive('buildHoldMessage')
                ->once()
                ->andReturn('Please stay on the call.');
            $mock->shouldReceive('synthesizeSpeech')
                ->once()
                ->with('Welcome to Aahaas.')
                ->andReturn([
                    'body' => 'greeting-audio',
                    'mime_type' => 'audio/mpeg',
                ]);
            $mock->shouldReceive('synthesizeSpeech')
                ->once()
                ->with(
                    'Please stay on the call.',
                    'Speak calmly and reassuringly like a travel support agent while the caller waits.'
                )
                ->andReturn([
                    'body' => 'hold-audio',
                    'mime_type' => 'audio/mpeg',
                ]);
        });

        $response = $this->postJson('/api/trip-call/session');

        $response->assertOk()
            ->assertJsonPath('status', 'active')
            ->assertJsonPath('greeting', 'Welcome to Aahaas.')
            ->assertJsonPath('hold_message', 'Please stay on the call.')
            ->assertJsonPath('greeting_audio_base64', base64_encode('greeting-audio'))
            ->assertJsonPath('hold_audio_base64', base64_encode('hold-audio'));

        $this->assertDatabaseCount('trip_plans', 1);
        $this->assertDatabaseHas('trip_plans', [
            'status' => 'active',
        ]);
    }

    public function test_trip_call_turn_requires_audio_and_plan_id(): void
    {
        $response = $this->withHeader('Accept', 'application/json')->post('/api/trip-call/turn', []);

        $response->assertStatus(422);
    }

    public function test_trip_call_turn_updates_conversation_and_returns_audio_payload(): void
    {
        $plan = TripPlan::create([
            'plan_id' => 'plan_123',
            'status' => 'active',
            'conversation_history' => [],
            'started_at' => now(),
        ]);

        $this->mock(TripCallService::class, function ($mock): void {
            $mock->shouldReceive('transcribeAudio')
                ->once()
                ->andReturn('I want a beach trip in July.');
            $mock->shouldReceive('generateTripReply')
                ->once()
                ->with('I want a beach trip in July.', [])
                ->andReturn('Great choice. What budget and how many travelers should I plan for?');
            $mock->shouldReceive('synthesizeSpeech')
                ->once()
                ->with('Great choice. What budget and how many travelers should I plan for?')
                ->andReturn([
                    'body' => 'reply-audio',
                    'mime_type' => 'audio/mpeg',
                ]);
        });

        $response = $this->post('/api/trip-call/turn', [
            'plan_id' => $plan->plan_id,
            'audio' => UploadedFile::fake()->create('trip-call.webm', 64, 'audio/webm'),
        ]);

        $response->assertOk()
            ->assertJsonPath('plan_id', 'plan_123')
            ->assertJsonPath('transcript', 'I want a beach trip in July.')
            ->assertJsonPath('reply', 'Great choice. What budget and how many travelers should I plan for?')
            ->assertJsonPath('audio_base64', base64_encode('reply-audio'));

        $updatedPlan = $plan->fresh();

        $this->assertSame([
            ['role' => 'user', 'content' => 'I want a beach trip in July.'],
            ['role' => 'assistant', 'content' => 'Great choice. What budget and how many travelers should I plan for?'],
        ], $updatedPlan->conversation_history);
    }

    public function test_trip_call_end_saves_summary_and_returns_closing_audio(): void
    {
        $plan = TripPlan::create([
            'plan_id' => 'plan_456',
            'status' => 'active',
            'conversation_history' => [
                ['role' => 'user', 'content' => 'Plan a three day Kandy trip.'],
                ['role' => 'assistant', 'content' => 'Sure, what is your hotel budget?'],
            ],
            'started_at' => now(),
        ]);

        $this->mock(TripCallService::class, function ($mock): void {
            $mock->shouldReceive('summarizeTripPlan')
                ->once()
                ->andReturn('Trip summary saved.');
            $mock->shouldReceive('buildClosingMessage')
                ->once()
                ->with('plan_456')
                ->andReturn('Your trip plan has been saved.');
            $mock->shouldReceive('synthesizeSpeech')
                ->once()
                ->with('Your trip plan has been saved.')
                ->andReturn([
                    'body' => 'closing-audio',
                    'mime_type' => 'audio/mpeg',
                ]);
        });

        $response = $this->postJson('/api/trip-call/end', [
            'plan_id' => $plan->plan_id,
        ]);

        $response->assertOk()
            ->assertJsonPath('plan_id', 'plan_456')
            ->assertJsonPath('status', 'completed')
            ->assertJsonPath('summary', 'Trip summary saved.')
            ->assertJsonPath('audio_base64', base64_encode('closing-audio'));

        $plan->refresh();

        $this->assertSame('completed', $plan->status);
        $this->assertSame('Trip summary saved.', $plan->final_summary);
        $this->assertNotNull($plan->ended_at);
    }
}
