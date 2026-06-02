<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class ErrorReport extends Model
{
    protected $fillable = [
        'report_id',
        'title',
        'details',
        'severity',
        'session_id',
        'country',
        'current_error',
        'phase',
        'latest_transcript',
        'package_status',
        'conversation',
        'terminal_log',
        'packages',
        'quotation_status',
        'export_file_name',
    ];

    protected $casts = [
        'conversation' => 'array',
        'terminal_log' => 'array',
        'packages' => 'array',
    ];
}
