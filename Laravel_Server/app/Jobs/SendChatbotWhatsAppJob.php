<?php

namespace App\Jobs;

use App\Services\ChatbotService;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Log;

class SendChatbotWhatsAppJob implements ShouldQueue
{
    use Queueable;

    public int $timeout = 120;
    public int $tries   = 2;

    public function __construct(
        private readonly string $sessionId,
        private readonly array  $customerProfile,
        private readonly ?array $package,
    ) {}

    public function handle(ChatbotService $service): void
    {
        $result = $service->sendWhatsApp($this->sessionId, $this->customerProfile, $this->package);

        if ($result['sent']) {
            Log::info('SendChatbotWhatsAppJob: sent', ['session_id' => $this->sessionId, 'wa_id' => $result['wa_id']]);
        } else {
            Log::warning('SendChatbotWhatsAppJob: failed', ['session_id' => $this->sessionId, 'error' => $result['error'] ?? '']);
        }
    }
}
