<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('service_calls', function (Blueprint $table): void {
            $table->id();
            $table->string('call_id')->unique();
            $table->string('status')->default('active');
            $table->json('customer_profile')->nullable();
            $table->json('service_categories')->nullable();
            $table->json('conversation_history')->nullable();
            $table->longText('latest_report')->nullable();
            $table->longText('final_report')->nullable();
            $table->timestamp('started_at')->nullable();
            $table->timestamp('ended_at')->nullable();
            $table->string('ended_reason')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('service_calls');
    }
};
