<?php

namespace App\Http\Controllers;

use App\Models\ErrorReport;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Str;

class AahaasRealtimeErrorDatasetController extends Controller
{
    private const DATA_DIR = 'app/aahaas-realtime/error-datasets';
    private const LOCAL_DOWNLOAD_DIR = 'TestErrorDetails';

    public function __invoke(Request $request, ?string $fileName = null): JsonResponse
    {
        if ($request->isMethod('get')) {
            return $this->showFile($fileName);
        }

        return $this->storeFile($request);
    }

    public function index(): JsonResponse
    {
        $reports = ErrorReport::query()
            ->latest('created_at')
            ->limit(200)
            ->get()
            ->map(fn (ErrorReport $report): array => [
                'report_id' => $report->report_id,
                'title' => $report->title,
                'severity' => $report->severity,
                'details' => $report->details,
                'session_id' => $report->session_id,
                'country' => $report->country,
                'current_error' => $report->current_error,
                'phase' => $report->phase,
                'latest_transcript' => $report->latest_transcript,
                'package_status' => $report->package_status,
                'conversation' => $report->conversation ?? [],
                'terminal_log' => $report->terminal_log ?? [],
                'packages' => $report->packages ?? [],
                'quotation_status' => $report->quotation_status,
                'export_file_name' => $report->export_file_name,
                'created_at' => optional($report->created_at)?->toIso8601String(),
            ])
            ->all();

        return response()->json([
            'success' => true,
            'reports' => $reports,
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        return $this->storeFile($request);
    }

    public function export(): JsonResponse
    {
        $reports = ErrorReport::query()->oldest('created_at')->get();
        $dir = storage_path(self::DATA_DIR);
        if (! File::exists($dir)) {
            File::makeDirectory($dir, 0755, true);
        }

        $files = [];
        foreach ($reports as $index => $report) {
            $fileName = sprintf('errortest%d.json', $index + 1);
            $payload = $this->buildFilePayload($report, $fileName);
            File::put($dir . DIRECTORY_SEPARATOR . $fileName, json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
            $report->update(['export_file_name' => $fileName]);
            $files[] = [
                'file_name' => $fileName,
                'view_url' => url('/api/aahaas-realtime/error-dataset/' . $fileName),
            ];
        }

        return response()->json([
            'success' => true,
            'files' => $files,
            'count' => count($files),
        ]);
    }

    public function downloadAll(): JsonResponse
    {
        $reports = ErrorReport::query()->oldest('created_at')->get();
        $payload = [
            'file_name' => 'error-reports.json',
            'saved_at' => now()->toIso8601String(),
            'count' => $reports->count(),
            'reports' => $reports->map(fn (ErrorReport $report): array => $this->buildFilePayload($report, $report->export_file_name ?: 'error-report.json'))->values()->all(),
        ];

        $dir = base_path(self::LOCAL_DOWNLOAD_DIR);
        if (! File::exists($dir)) {
            File::makeDirectory($dir, 0755, true);
        }

        $fileName = 'error-reports.json';
        $filePath = $dir . DIRECTORY_SEPARATOR . $fileName;
        File::put($filePath, json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));

        return response()->json([
            'success' => true,
            'file_name' => $fileName,
            'saved_path' => $filePath,
            'count' => $reports->count(),
            'payload' => $payload,
        ]);
    }

    public function destroyAll(): JsonResponse
    {
        $count = ErrorReport::query()->count();
        ErrorReport::query()->delete();

        $dir = storage_path(self::DATA_DIR);
        if (File::exists($dir)) {
            File::deleteDirectory($dir);
        }

        return response()->json([
            'success' => true,
            'deleted' => $count,
        ]);
    }

    private function storeFile(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'title'             => ['required', 'string', 'max:200'],
            'details'           => ['required', 'string', 'max:5000'],
            'severity'          => ['nullable', 'string', 'max:20'],
            'session_id'        => ['nullable', 'string', 'max:120'],
            'country'           => ['nullable', 'string', 'max:120'],
            'current_error'     => ['nullable', 'string', 'max:3000'],
            'phase'             => ['nullable', 'string', 'max:120'],
            'latest_transcript' => ['nullable', 'string', 'max:3000'],
            'package_status'    => ['nullable', 'string', 'max:120'],
            'conversation'      => ['nullable', 'array'],
            'terminal_log'      => ['nullable', 'array'],
            'packages'          => ['nullable', 'array'],
            'quotation_status'  => ['nullable', 'string', 'max:50'],
        ]);

        $report = ErrorReport::create([
            'report_id'         => 'ERR-' . strtoupper(Str::random(10)),
            'title'             => $validated['title'],
            'details'           => $validated['details'],
            'severity'          => $validated['severity'] ?? 'medium',
            'session_id'        => $validated['session_id'] ?? '',
            'country'           => $validated['country'] ?? '',
            'current_error'     => $validated['current_error'] ?? '',
            'phase'             => $validated['phase'] ?? '',
            'latest_transcript' => $validated['latest_transcript'] ?? '',
            'package_status'    => $validated['package_status'] ?? '',
            'conversation'      => $validated['conversation'] ?? [],
            'terminal_log'      => $validated['terminal_log'] ?? [],
            'packages'          => $validated['packages'] ?? [],
            'quotation_status'  => $validated['quotation_status'] ?? '',
        ]);

        return response()->json([
            'success' => true,
            'report' => [
                'report_id' => $report->report_id,
                'title' => $report->title,
                'severity' => $report->severity,
                'details' => $report->details,
                'session_id' => $report->session_id,
                'country' => $report->country,
                'current_error' => $report->current_error,
                'phase' => $report->phase,
                'latest_transcript' => $report->latest_transcript,
                'package_status' => $report->package_status,
                'conversation' => $report->conversation ?? [],
                'terminal_log' => $report->terminal_log ?? [],
                'packages' => $report->packages ?? [],
                'quotation_status' => $report->quotation_status,
                'created_at' => optional($report->created_at)?->toIso8601String(),
            ],
        ]);
    }

    private function showFile(?string $fileName): JsonResponse
    {
        $safeFile = basename((string) $fileName);
        if ($safeFile === '' || ! preg_match('/^(error-file-\d+|errortest\d+)\.json$/', $safeFile)) {
            return response()->json(['message' => 'Invalid error dataset file name.'], 400);
        }

        $path = storage_path(self::DATA_DIR . DIRECTORY_SEPARATOR . $safeFile);
        if (! File::exists($path)) {
            return response()->json(['message' => 'Error dataset not found.'], 404);
        }

        $json = File::get($path);
        $decoded = json_decode($json, true);

        return response()->json(
            is_array($decoded) ? $decoded : ['raw' => $json],
            200,
            [],
            JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE
        );
    }

    private function buildFilePayload(ErrorReport $report, string $fileName): array
    {
        return [
            'file_name' => $fileName,
            'saved_at' => now()->toIso8601String(),
            'report_id' => $report->report_id,
            'title' => $report->title,
            'details' => $report->details,
            'severity' => $report->severity,
            'session_id' => $report->session_id,
            'country' => $report->country,
            'current_error' => $report->current_error,
            'phase' => $report->phase,
            'latest_transcript' => $report->latest_transcript,
            'package_status' => $report->package_status,
            'conversation' => $report->conversation ?? [],
            'terminal_log' => $report->terminal_log ?? [],
            'packages' => $report->packages ?? [],
            'quotation_status' => $report->quotation_status,
        ];
    }
}
