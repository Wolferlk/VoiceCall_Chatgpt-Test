<?php

namespace App\Http\Controllers;

use App\Models\ServiceCall;
use App\Services\ChatbotService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Throwable;

class ChatbotSessionController extends Controller
{
    public function __invoke(Request $request, ChatbotService $service): JsonResponse
    {
        set_time_limit(300);

        $validated = $request->validate([
            'voice_name'  => ['nullable', 'string'],
            'voice_speed' => ['nullable', 'numeric', 'min:0.25', 'max:4.0'],
        ]);

        $voiceName  = trim((string) ($validated['voice_name']  ?? 'coral')) ?: 'coral';
        $voiceSpeed = (float) ($validated['voice_speed'] ?? 1.0);
        $service->setVoiceConfig($voiceName, $voiceSpeed);

        try {
            $greeting = "Hello! Welcome to Aahaas Travel. I'm your AI travel assistant. How can I help you today? Are you looking to plan a trip, book accommodation, or explore our travel packages?";

            $call = ServiceCall::create([
                'call_id'              => 'CHAT-' . strtoupper(Str::random(8)),
                'status'               => 'active',
                'customer_profile'     => [
                    'current_living_country' => 'sri lanka',
                    'package_state'          => 'not_started',
                    'package_fetch_status'   => '',
                ],
                'service_categories'   => ['Chatbot Session'],
                'conversation_history' => [
                    ['role' => 'assistant', 'content' => $greeting],
                ],
                'latest_report'        => '',
                'started_at'           => now(),
            ]);

            $greetingAudio = $service->synthesizeSpeech($greeting);

            return response()->json([
                'session_id'               => $call->call_id,
                'greeting'                 => $greeting,
                'greeting_audio_base64'    => base64_encode($greetingAudio['body']),
                'greeting_audio_mime_type' => $greetingAudio['mime_type'],
                'customer_profile'         => $call->customer_profile,
                'voice_name'               => $voiceName,
                'voice_speed'              => $voiceSpeed,
            ]);
        } catch (Throwable $e) {
            $code = $e->getCode();
            return response()->json(
                ['message' => $e->getMessage() ?: 'Could not start chatbot session.'],
                is_int($code) && $code >= 400 && $code < 600 ? $code : 500
            );
        }
    }
}
