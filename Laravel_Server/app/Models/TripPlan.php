<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class TripPlan extends Model
{
    protected $fillable = [
        'plan_id',
        'status',
        'conversation_history',
        'latest_summary',
        'final_summary',
        'started_at',
        'ended_at',
    ];

    protected $casts = [
        'conversation_history' => 'array',
        'started_at' => 'datetime',
        'ended_at' => 'datetime',
    ];
}
