package com.zbot.wa

import android.content.Context
import android.content.Intent
import androidx.hilt.work.HiltWorker
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject

/**
 * Periodic worker that ensures BotService is alive.
 * Runs every 15 minutes (WorkManager minimum interval).
 *
 * v2.1.6 FIX (C6): now annotated as @HiltWorker so HiltWorkerFactory can construct it.
 * Reads user_stopped flag — set by BotService.stopBot() so the worker respects user intent.
 */
@HiltWorker
class KeepAliveWorker @AssistedInject constructor(
    @Assisted context: Context,
    @Assisted workerParams: WorkerParameters
) : CoroutineWorker(context, workerParams) {

    override suspend fun doWork(): Result {
        // Check if user explicitly stopped
        val prefs = applicationContext.getSharedPreferences("zbot_prefs", Context.MODE_PRIVATE)
        if (prefs.getBoolean("user_stopped", false)) {
            return Result.success()
        }

        // If bot is running, do nothing
        if (BotService.isRunning) {
            return Result.success()
        }

        // Otherwise restart
        try {
            val intent = Intent(applicationContext, BotService::class.java).apply {
                action = BotService.ACTION_START
            }
            androidx.core.content.ContextCompat.startForegroundService(applicationContext, intent)
        } catch (e: Exception) {
            // SecurityException on Android 12+ if app is in background — ignore
            return Result.retry()
        }

        return Result.success()
    }
}
