<?php

namespace Tests\Unit;

use App\Services\VoiceAgentService;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class VoiceAgentServiceTest extends TestCase
{
    public function test_generate_reply_reads_assistant_text_from_output_content(): void
    {
        putenv('OPENAI_API_KEY=test-openai-key');
        $_ENV['OPENAI_API_KEY'] = 'test-openai-key';
        $_SERVER['OPENAI_API_KEY'] = 'test-openai-key';

        Http::fake([
            'https://api.openai.com/v1/responses' => Http::response([
                'id' => 'resp_123',
                'output' => [
                    [
                        'id' => 'msg_123',
                        'type' => 'message',
                        'role' => 'assistant',
                        'content' => [
                            [
                                'type' => 'output_text',
                                'text' => 'Hello from the parsed output array.',
                            ],
                        ],
                    ],
                ],
            ], 200),
        ]);

        $service = new VoiceAgentService();

        $reply = $service->generateReply('Hello');

        $this->assertSame('Hello from the parsed output array.', $reply);
    }
}
