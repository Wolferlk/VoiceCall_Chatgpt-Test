<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('error_reports', function (Blueprint $table): void {
            $table->id();
            $table->string('report_id')->unique();
            $table->string('title');
            $table->longText('details');
            $table->string('severity', 20)->default('medium');
            $table->string('session_id')->nullable();
            $table->string('country', 120)->nullable();
            $table->longText('current_error')->nullable();
            $table->string('phase', 120)->nullable();
            $table->longText('latest_transcript')->nullable();
            $table->string('package_status', 120)->nullable();
            $table->json('conversation')->nullable();
            $table->json('terminal_log')->nullable();
            $table->json('packages')->nullable();
            $table->string('quotation_status', 50)->nullable();
            $table->string('export_file_name')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('error_reports');
    }
};
