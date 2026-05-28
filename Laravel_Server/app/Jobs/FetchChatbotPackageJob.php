<?php

namespace App\Jobs;

use App\Models\ServiceCall;
use App\Services\ChatbotService;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Log;

class FetchChatbotPackageJob implements ShouldQueue
{
    use Queueable;

    public int $timeout = 120;
    public int $tries   = 2;

    public function __construct(
        private readonly string $sessionId,
        private readonly string $packagePrompt,
    ) {}

    public function handle(ChatbotService $service): void
    {
        try {
            $package = $service->fetchPackage($this->packagePrompt);

            $call = ServiceCall::query()->where('call_id', $this->sessionId)->first();
            if (! $call) return;

            $profile = is_array($call->customer_profile) ? $call->customer_profile : [];
            $profile['suggested_package']    = $package;
            $profile['package_fetch_status'] = 'ready';
            $profile['package_state']        = 'ready';
            unset($profile['package_fetch_error']);

            $call->forceFill(['customer_profile' => $profile])->save();

            Log::info('FetchChatbotPackageJob: package fetched', ['session_id' => $this->sessionId]);
        } catch (\Throwable $e) {
            Log::error('FetchChatbotPackageJob: failed', [
                'session_id' => $this->sessionId,
                'error'      => $e->getMessage(),
            ]);

            $call = ServiceCall::query()->where('call_id', $this->sessionId)->first();
            if ($call) {
                $profile = is_array($call->customer_profile) ? $call->customer_profile : [];
                $profile['package_fetch_status'] = 'failed';
                $profile['package_fetch_error']  = $e->getMessage();
                $profile['package_state']        = 'failed';
                $call->forceFill(['customer_profile' => $profile])->save();
            }
        }
    }
}
