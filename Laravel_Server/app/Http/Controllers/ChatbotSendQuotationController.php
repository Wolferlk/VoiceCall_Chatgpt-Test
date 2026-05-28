<?php

namespace App\Http\Controllers;

use App\Models\ServiceCall;
use App\Services\ChatbotService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Throwable;

class ChatbotSendQuotationController extends Controller
{
    public function __invoke(Request $request, ChatbotService $service): JsonResponse
    {
        set_time_limit(300);

        $validated = $request->validate([
            'session_id' => ['required', 'string', 'exists:service_calls,call_id'],
        ]);

        $call            = ServiceCall::query()->where('call_id', $validated['session_id'])->firstOrFail();
        $customerProfile = is_array($call->customer_profile) ? $call->customer_profile : [];
        $package         = $customerProfile['suggested_package'] ?? null;

        try {
            if (! $service->hasContactInfo($customerProfile)) {
                return response()->json([
                    'session_id' => $call->call_id,
                    'sent'       => false,
                    'message'    => 'Contact details incomplete (need full name and WhatsApp number).',
                ], 422);
            }

            $result = $service->sendWhatsApp($call->call_id, $customerProfile, $package);

            return response()->json([
                'session_id' => $call->call_id,
                'sent'       => $result['sent'],
                'wa_id'      => $result['wa_id']   ?? '',
                'message'    => $result['sent']
                    ? 'WhatsApp quotation sent successfully.'
                    : ('Send failed: ' . ($result['error'] ?? 'Unknown error')),
            ]);
        } catch (Throwable $e) {
            $code = $e->getCode();
            return response()->json(
                ['message' => $e->getMessage() ?: 'Could not send quotation.'],
                is_int($code) && $code >= 400 && $code < 600 ? $code : 500
            );
        }
    }
}
