<?php

namespace Tests\Unit;

use App\Services\ReceptionCallService;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class ReceptionCallServiceTest extends TestCase
{
    public function test_suggest_travel_package_returns_payload_from_api(): void
    {
        Http::fake([
            'https://travel-parser-live.aahaas.com/v1/voice/suggest' => Http::response([
                'summary' => '5-day Sri Lanka family trip with culture and beach stays.',
            ], 200),
        ]);

        $service = new ReceptionCallService();

        $payload = $service->suggestTravelPackage('"5-day" in "Sri Lanka" trip with "my family"');

        $this->assertSame('5-day Sri Lanka family trip with culture and beach stays.', $payload['summary']);
    }

    public function test_format_package_offer_reply_uses_summary_text(): void
    {
        $service = new ReceptionCallService();

        $reply = $service->formatPackageOfferReply([
            'summary' => 'A 5-day Sri Lanka journey with beach and cultural stops.',
        ]);

        $this->assertStringContainsString('A 5-day Sri Lanka journey with beach and cultural stops.', $reply);
        $this->assertStringContainsString('package is okay', $reply);
    }

    public function test_format_package_offer_reply_prefers_voice_text_when_available(): void
    {
        $service = new ReceptionCallService();

        $reply = $service->formatPackageOfferReply([
            'voice_text' => 'We have a family package in Sri Lanka with Kandy and Sigiriya highlights.',
            'summary' => 'Fallback summary',
        ]);

        $this->assertStringContainsString('We have a family package in Sri Lanka with Kandy and Sigiriya highlights.', $reply);
        $this->assertStringNotContainsString('Fallback summary', $reply);
    }

    public function test_detect_package_feedback_recognizes_acceptance_and_rejection(): void
    {
        $service = new ReceptionCallService();

        $this->assertSame('accepted', $service->detectPackageFeedback('Yes, this package looks good. Proceed.'));
        $this->assertSame('rejected', $service->detectPackageFeedback('Not okay. Please give me another option.'));
        $this->assertSame('unknown', $service->detectPackageFeedback('Can you repeat that?'));
    }
}
