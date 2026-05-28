<?php

namespace App\Http\Controllers;

use App\Models\ServiceCall;
use App\Services\FourVChatGptAssisService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Throwable;

class FourVChatGptAssisPackagePrefetchController extends Controller
{
    public function __invoke(Request $request, FourVChatGptAssisService $service): JsonResponse
    {
        $validated = $request->validate([
            'call_id' => ['required', 'string', 'exists:service_calls,call_id'],
        ]);

        $call = ServiceCall::query()->where('call_id', $validated['call_id'])->firstOrFail();
        $customerProfile = is_array($call->customer_profile) ? $call->customer_profile : [];
        $serviceCategories = is_array($call->service_categories) ? $call->service_categories : [];

        try {
            $storedPrompt = trim((string) ($customerProfile['travel_package_prompt'] ?? ''));

            if (! $service->isTravelRelated($serviceCategories) && $storedPrompt === '') {
                return response()->json([
                    'call_id' => $call->call_id,
                    'package_lookup_status' => $customerProfile['package_lookup_status'] ?? '',
                    'started' => false,
                ]);
            }

            $prompt = $service->buildEarlyPackagePrompt($customerProfile, '', $serviceCategories);

            if ($prompt === '') {
                return response()->json([
                    'call_id' => $call->call_id,
                    'package_lookup_status' => $customerProfile['package_lookup_status'] ?? '',
                    'started' => false,
                ]);
            }

            $customerProfile['package_lookup_status'] = 'pending';
            $customerProfile['travel_package_prompt'] = $prompt;
            $call->forceFill([
                'customer_profile' => $customerProfile,
            ])->save();

            try {
                $suggestion = $service->suggestTravelPackage($prompt);
                $customerProfile['suggested_package'] = $suggestion;
                $customerProfile['package_lookup_status'] = 'ready';
                $customerProfile['package_state'] = $customerProfile['package_state'] ?? 'pending';
                unset($customerProfile['package_lookup_error'], $customerProfile['package_lookup_error_detail']);
            } catch (Throwable $throwable) {
                $customerProfile['package_lookup_status'] = 'failed';
                $customerProfile['package_state'] = 'api_unavailable';
                $customerProfile['package_lookup_error'] = $service->summarizePackageLookupError($throwable);
                $customerProfile['package_lookup_error_detail'] = mb_substr($throwable->getMessage(), 0, 500);
            }

            $call->forceFill([
                'customer_profile' => $customerProfile,
            ])->save();

            return response()->json([
                'call_id' => $call->call_id,
                'package_lookup_status' => $customerProfile['package_lookup_status'] ?? '',
                'package_lookup_error' => $customerProfile['package_lookup_error'] ?? '',
                'started' => true,
            ]);
        } catch (Throwable $throwable) {
            $status = $throwable->getCode();

            return response()->json([
                'message' => $throwable->getMessage() !== '' ? $throwable->getMessage() : 'Package prefetch failed.',
            ], is_int($status) && $status >= 400 && $status < 600 ? $status : 500);
        }
    }
}
