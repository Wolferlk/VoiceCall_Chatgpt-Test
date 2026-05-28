<?php

namespace App\Http\Controllers;

use Symfony\Component\HttpFoundation\BinaryFileResponse;

class FourVChatGptAssisHoldMusicController extends Controller
{
    public function __invoke(): BinaryFileResponse
    {
        $path = storage_path('Audio/Hold Music  Service Center Music   Phone Background Music  Ambient Piano.mp3');

        abort_unless(is_file($path), 404, 'Hold music file not found.');

        return response()->file($path, [
            'Content-Type' => 'audio/mpeg',
            'Cache-Control' => 'public, max-age=86400',
            'Accept-Ranges' => 'bytes',
        ]);
    }
}
