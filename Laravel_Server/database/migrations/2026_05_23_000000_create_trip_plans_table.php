<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('trip_plans', function (Blueprint $table): void {
            $table->id();
            $table->string('plan_id')->unique();
            $table->string('status')->default('active');
            $table->json('conversation_history')->nullable();
            $table->longText('latest_summary')->nullable();
            $table->longText('final_summary')->nullable();
            $table->timestamp('started_at')->nullable();
            $table->timestamp('ended_at')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('trip_plans');
    }
};
