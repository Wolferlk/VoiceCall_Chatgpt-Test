<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;

class ApiProxyController extends Controller
{
    public function __invoke(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'url'     => ['required', 'string', 'url'],
            'method'  => ['required', 'string', 'in:GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS'],
            'headers' => ['sometimes', 'array'],
            'body'    => ['sometimes', 'nullable', 'string'],
            'timeout' => ['sometimes', 'integer', 'min:1', 'max:300'],
        ]);

        $targetUrl = $validated['url'];
        $method    = strtolower($validated['method']);
        $headers   = $validated['headers'] ?? [];
        $rawBody   = $validated['body']    ?? null;
        $timeout   = $validated['timeout'] ?? 30;

        $t0 = microtime(true);

        try {
            $pending = Http::timeout($timeout)
                ->withHeaders($headers)
                ->withoutVerifying(); // allow self-signed certs in test contexts

            if ($rawBody !== null && $rawBody !== '') {
                $pending = $pending->withBody($rawBody, $headers['Content-Type'] ?? $headers['content-type'] ?? 'application/json');
            }

            $response = $pending->{$method}($targetUrl);

            $elapsed = (int) round((microtime(true) - $t0) * 1000);

            return response()->json([
                'status'      => $response->status(),
                'status_text' => $this->statusText($response->status()),
                'headers'     => $response->headers(),
                'body'        => $response->body(),
                'time_ms'     => $elapsed,
                'size_bytes'  => strlen($response->body()),
            ]);
        } catch (\Illuminate\Http\Client\ConnectionException $e) {
            $elapsed = (int) round((microtime(true) - $t0) * 1000);
            return response()->json([
                'error'   => 'Connection failed: ' . $e->getMessage(),
                'time_ms' => $elapsed,
            ], 502);
        } catch (\Exception $e) {
            $elapsed = (int) round((microtime(true) - $t0) * 1000);
            return response()->json([
                'error'   => $e->getMessage(),
                'time_ms' => $elapsed,
            ], 500);
        }
    }

    private function statusText(int $code): string
    {
        return match ($code) {
            200 => 'OK', 201 => 'Created', 204 => 'No Content',
            301 => 'Moved Permanently', 302 => 'Found', 304 => 'Not Modified',
            400 => 'Bad Request', 401 => 'Unauthorized', 403 => 'Forbidden',
            404 => 'Not Found', 405 => 'Method Not Allowed', 408 => 'Request Timeout',
            409 => 'Conflict', 422 => 'Unprocessable Entity', 429 => 'Too Many Requests',
            500 => 'Internal Server Error', 502 => 'Bad Gateway', 503 => 'Service Unavailable',
            504 => 'Gateway Timeout',
            default => 'Unknown',
        };
    }
}
