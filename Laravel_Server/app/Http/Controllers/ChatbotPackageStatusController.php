<?php

namespace App\Http\Controllers;

use App\Models\ServiceCall;
use Illuminate\Http\JsonResponse;

class ChatbotPackageStatusController extends Controller
{
    public function __invoke(string $sessionId): JsonResponse
    {
        $call = ServiceCall::query()->where('call_id', $sessionId)->first();

        if (! $call) {
            return response()->json(['message' => 'Session not found.'], 404);
        }

        $profile = is_array($call->customer_profile) ? $call->customer_profile : [];
        $status  = $profile['package_fetch_status'] ?? '';
        $package = $status === 'ready' ? ($profile['suggested_package'] ?? null) : null;

        return response()->json([
            'session_id'           => $sessionId,
            'package_fetch_status' => $status,
            'package'              => $package,
            'error'                => $profile['package_fetch_error'] ?? null,
        ]);
    }
}
