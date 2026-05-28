<?php

namespace App\Jobs;

use App\Models\ServiceCall;
use App\Services\AahaasAssistentV01Service;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;
use Throwable;

class FetchTwilioPackageJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $timeout = 120;
    public int $tries   = 2;

    public function __construct(public readonly string $callId) {}

    public function handle(AahaasAssistentV01Service $service): void
    {
        $call = ServiceCall::query()->where('call_id', $this->callId)->first();
        if (! $call) {
            return;
        }

        $profile = is_array($call->customer_profile) ? $call->customer_profile : [];
        $prompt  = trim((string) ($profile['travel_package_prompt'] ?? ''));

        if ($prompt === '') {
            Log::warning('[FetchTwilioPackageJob] No prompt for ' . $this->callId);
            return;
        }

        try {
            $package                              = $service->suggestTravelPackage($prompt);
            $profile['suggested_package']         = $package;
            $profile['package_lookup_status']     = 'ready';
            $profile['package_state']             = $profile['package_state'] ?? 'pending';
            unset($profile['package_lookup_error'], $profile['package_lookup_error_detail']);
            Log::info('[FetchTwilioPackageJob] Package ready for ' . $this->callId);
        } catch (Throwable $e) {
            $profile['package_lookup_status']        = 'failed';
            $profile['package_state']                = 'api_unavailable';
            $profile['package_lookup_error']         = $service->summarizePackageLookupError($e);
            $profile['package_lookup_error_detail']  = mb_substr($e->getMessage(), 0, 500);
            Log::error('[FetchTwilioPackageJob] Failed for ' . $this->callId . ': ' . $e->getMessage());
        }

        $call->forceFill(['customer_profile' => $profile])->save();
    }
}
