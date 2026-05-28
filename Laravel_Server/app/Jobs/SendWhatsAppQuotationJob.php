<?php

namespace App\Jobs;

use App\Services\AahaasAssistentV01Service;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Log;

class SendWhatsAppQuotationJob implements ShouldQueue
{
    use Queueable;

    public int $timeout = 120;
    public int $tries   = 2;

    public function __construct(
        private readonly string $callId,
        private readonly array  $customerProfile,
        private readonly array  $report,
        private readonly array  $serviceCategories,
    ) {}

    public function handle(AahaasAssistentV01Service $service): void
    {
        $result = $service->sendQuotation(
            $this->callId,
            $this->customerProfile,
            $this->report,
            $this->serviceCategories,
        );

        if ($result['api_sent']) {
            Log::info('SendWhatsAppQuotationJob: sent', ['call_id' => $this->callId, 'wa_id' => $result['wa_id']]);
        } else {
            Log::warning('SendWhatsAppQuotationJob: failed', ['call_id' => $this->callId, 'error' => $result['error']]);
        }
    }
}
