package com.zbot.wa

import android.content.Context
import android.content.Intent
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters

/**
 * Periodic worker that ensures BotService is alive.
 * Runs every 15 minutes (WorkManager minimum interval).
 *
 * If bot was user-stopped, doesn't restart (checks shared pref).
 */
class KeepAliveWorker(
    context: Context,
    workerParams: WorkerParameters
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
        val intent = Intent(applicationContext, BotService::class.java).apply {
            action = BotService.ACTION_START
        }
        androidx.core.content.ContextCompat.startForegroundService(applicationContext, intent)

        return Result.success()
    }
}
