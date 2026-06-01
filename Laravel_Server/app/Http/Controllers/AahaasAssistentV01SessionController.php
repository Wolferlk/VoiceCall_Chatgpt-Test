<?php

namespace App\Http\Controllers;

use App\Models\ServiceCall;
use App\Services\AahaasAssistentV01Service;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Throwable;

class AahaasAssistentV01SessionController extends Controller
{
    public function __invoke(Request $request, AahaasAssistentV01Service $service): JsonResponse
    {
        set_time_limit(300);

        $validated = $request->validate([
            'voice_name'  => ['nullable', 'string'],
            'voice_speed' => ['nullable', 'numeric', 'min:0.25', 'max:4.0'],
        ]);

        $voiceName  = trim((string) ($validated['voice_name'] ?? 'coral')) ?: 'coral';
        $voiceSpeed = (float) ($validated['voice_speed'] ?? 1.0);

        try {
            $service->setVoiceConfig($voiceName, $voiceSpeed);
            $country = $this->resolveCurrentLivingCountry($request);

            $call = ServiceCall::create([
                'call_id' => 'V01-' . strtoupper(Str::random(10)),
                'status'  => 'active',
                'customer_profile' => [
                    'package_state'          => 'not_started',
                    'traveler_count'         => '2',
                    'hotel_star_preference'  => '3-star',
                    'number_of_days'         => '3',
                    'stay_length'            => '3 nights',
                    'travel_start_date'      => 'next week',
                    'activities'             => 'any',
                    'travel_purpose'         => 'any',
                    'current_living_country' => $country,
                ],
                'service_categories'   => [],
                'conversation_history' => [],
                'started_at'           => now(),
            ]);

            // Single TTS call at session start — hold music is tone-based on the frontend
            $greeting      = $service->buildGreeting($call->call_id);
            $greetingAudio = $service->synthesizeSpeech($greeting);

            $call->forceFill([
                'conversation_history' => [
                    ['role' => 'assistant', 'content' => $greeting],
                ],
            ])->save();

            return response()->json([
                'call_id'                  => $call->call_id,
                'status'                   => $call->status,
                'greeting'                 => $greeting,
                'greeting_audio_base64'    => base64_encode($greetingAudio['body']),
                'greeting_audio_mime_type' => $greetingAudio['mime_type'],
                'voice_name'               => $voiceName,
                'voice_speed'              => $voiceSpeed,
            ]);
        } catch (Throwable $throwable) {
            $status = $throwable->getCode();

            return response()->json([
                'message' => $throwable->getMessage() !== '' ? $throwable->getMessage() : 'Aahaas Assistent V01 session could not be started.',
            ], is_int($status) && $status >= 400 && $status < 600 ? $status : 500);
        }
    }

    private function resolveCurrentLivingCountry(Request $request): string
    {
        $headers = [
            'CF-IPCountry',
            'X-App-Country-Code',
            'X-Geo-Country-Code',
            'X-Country-Code',
            'X-App-Country',
            'X-Geo-Country',
            'X-Country',
        ];

        foreach ($headers as $header) {
            $value = trim((string) $request->header($header, ''));

            if ($value === '' || strtoupper($value) === 'XX') {
                continue;
            }

            $value = strtolower($value);

            return match ($value) {
                'lk' => 'sri lanka',
                'in' => 'india',
                'us' => 'united states',
                'gb', 'uk' => 'united kingdom',
                'ae' => 'united arab emirates',
                'sg' => 'singapore',
                'my' => 'malaysia',
                'au' => 'australia',
                'ca' => 'canada',
                'de' => 'germany',
                'fr' => 'france',
                default => $value,
            };
        }

        return 'sri lanka';
    }
}
