<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class ServiceCall extends Model
{
    protected $fillable = [
        'call_id',
        'status',
        'customer_profile',
        'service_categories',
        'conversation_history',
        'latest_report',
        'final_report',
        'started_at',
        'ended_at',
        'ended_reason',
    ];

    protected $casts = [
        'customer_profile' => 'array',
        'service_categories' => 'array',
        'conversation_history' => 'array',
        'started_at' => 'datetime',
        'ended_at' => 'datetime',
    ];
}
