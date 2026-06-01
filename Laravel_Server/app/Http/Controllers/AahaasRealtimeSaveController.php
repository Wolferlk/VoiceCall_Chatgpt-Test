<?php

namespace App\Http\Controllers;

use App\Models\ServiceCall;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

class AahaasRealtimeSaveController extends Controller
{
    public function __invoke(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'conversation'        => ['nullable', 'array'],
            'packages'            => ['nullable', 'array'],
            'customer_name'       => ['nullable', 'string', 'max:200'],
            'customer_phone'      => ['nullable', 'string', 'max:30'],
            'country'             => ['nullable', 'string', 'max:100'],
            'voice_session_id'    => ['nullable', 'string', 'max:100'],
            'confirmed_package'   => ['nullable', 'string'],
            'total_amount'        => ['nullable', 'numeric'],
            'currency'            => ['nullable', 'string', 'max:10'],
            'quotation_sent'      => ['nullable', 'boolean'],
            'call_duration_ms'    => ['nullable', 'integer'],
            'ended_reason'        => ['nullable', 'string', 'max:100'],
            'started_at'          => ['nullable', 'string'],
        ]);

        $callId = 'RTV2-' . strtoupper(Str::random(10));

        $customerProfile = [
            'full_name'             => $validated['customer_name']    ?? '',
            'contact_number'        => $validated['customer_phone']   ?? '',
            'current_living_country'=> strtolower($validated['country'] ?? 'sri lanka'),
            'voice_session_id'      => $validated['voice_session_id'] ?? '',
            'confirmed_package'     => $validated['confirmed_package'] ?? '',
            'grand_total'           => $validated['total_amount']     ?? null,
            'currency'              => $validated['currency']         ?? '',
            'quotation_sent'        => $validated['quotation_sent']   ?? false,
            'call_source'           => 'realtime_v02',
        ];

        // Build a final report JSON string summarising the session
        $lastPkg    = ! empty($validated['packages']) ? end($validated['packages']) : null;
        $finalReport = json_encode([
            'customer'         => $customerProfile,
            'packages_fetched' => count($validated['packages'] ?? []),
            'last_package'     => $lastPkg,
            'quotation_sent'   => $validated['quotation_sent'] ?? false,
            'call_duration_ms' => $validated['call_duration_ms'] ?? 0,
        ], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);

        try {
            $call = ServiceCall::create([
                'call_id'              => $callId,
                'status'               => 'completed',
                'customer_profile'     => $customerProfile,
                'service_categories'   => ['Travel Package'],
                'conversation_history' => $validated['conversation'] ?? [],
                'final_report'         => $finalReport,
                'latest_report'        => $validated['confirmed_package'] ?? '',
                'started_at'           => $validated['started_at'] ?? now(),
                'ended_at'             => now(),
                'ended_reason'         => $validated['ended_reason'] ?? 'completed',
            ]);

            Log::info('AahaasRealtimeSave: session recorded', [
                'call_id'   => $callId,
                'name'      => $customerProfile['full_name'],
                'phone'     => $customerProfile['contact_number'],
                'wa_sent'   => $customerProfile['quotation_sent'],
            ]);

            return response()->json([
                'success' => true,
                'call_id' => $callId,
            ]);
        } catch (\Throwable $e) {
            Log::error('AahaasRealtimeSave: DB error', ['message' => $e->getMessage()]);
            return response()->json([
                'success' => false,
                'message' => 'Could not save session: ' . $e->getMessage(),
            ], 500);
        }
    }
}
