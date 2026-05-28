<?php

namespace Tests\Feature;

use App\Models\ServiceCall;
use App\Models\TripPlan;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class RecordsApiTest extends TestCase
{
    use RefreshDatabase;

    public function test_records_endpoint_lists_service_calls_and_trip_plans(): void
    {
        ServiceCall::create([
            'call_id' => 'CALL-AAA111',
            'status' => 'completed',
            'customer_profile' => ['full_name' => 'Jane'],
            'service_categories' => ['Flight Booking'],
            'conversation_history' => [],
            'latest_report' => 'Flight booking request.',
            'started_at' => now(),
        ]);

        TripPlan::create([
            'plan_id' => 'PLAN-XYZ999',
            'status' => 'completed',
            'conversation_history' => [],
            'latest_summary' => 'Trip plan for Bali.',
            'started_at' => now(),
        ]);

        $response = $this->getJson('/api/records');

        $response->assertOk()
            ->assertJsonCount(2, 'records');
    }

    public function test_record_show_returns_service_call_detail(): void
    {
        ServiceCall::create([
            'call_id' => 'CALL-SHOW1',
            'status' => 'completed',
            'customer_profile' => ['full_name' => 'John'],
            'service_categories' => ['Hotel Reservations'],
            'conversation_history' => [['role' => 'user', 'content' => 'Need a hotel.']],
            'latest_report' => 'Hotel request.',
            'final_report' => json_encode([
                'summary' => 'Customer needs a hotel.',
                'products_needed' => ['Hotels'],
            ]),
            'started_at' => now(),
        ]);

        $response = $this->getJson('/api/records/service_call/CALL-SHOW1');

        $response->assertOk()
            ->assertJsonPath('record.public_id', 'CALL-SHOW1')
            ->assertJsonPath('record.customer_profile.full_name', 'John')
            ->assertJsonPath('record.final_report.summary', 'Customer needs a hotel.');
    }

    public function test_record_download_returns_json_file(): void
    {
        TripPlan::create([
            'plan_id' => 'PLAN-DL1',
            'status' => 'completed',
            'conversation_history' => [['role' => 'assistant', 'content' => 'Saved plan']],
            'latest_summary' => 'Beach holiday.',
            'final_summary' => 'Final beach holiday summary.',
            'started_at' => now(),
        ]);

        $response = $this->get('/api/records/trip_plan/PLAN-DL1/download');

        $response->assertOk();
        $response->assertHeader('content-type', 'application/json');
        $this->assertStringContainsString('trip-plan-PLAN-DL1.json', $response->headers->get('content-disposition', ''));
    }
}
