package com.zbot.wa

import android.app.Application
import androidx.hilt.work.HiltWorkerFactory
import androidx.work.Configuration
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import dagger.hilt.android.HiltAndroidApp
import java.util.concurrent.TimeUnit
import javax.inject.Inject

/**
 * Zbot Application class.
 * Initializes Hilt DI + WorkManager + schedules KeepAliveWorker.
 *
 * v2.1.6 FIX (C6): schedule KeepAliveWorker every 15 minutes so BotService
 * gets restarted if killed by the OS.
 */
@HiltAndroidApp
class ZbotApp : Application(), Configuration.Provider {

    @Inject
    lateinit var workerFactory: HiltWorkerFactory

    override val workManagerConfiguration: Configuration
        get() = Configuration.Builder()
            .setWorkerFactory(workerFactory)
            .setMinimumLoggingLevel(android.util.Log.INFO)
            .build()

    override fun onCreate() {
        super.onCreate()
        // Hilt auto-initializes via @HiltAndroidApp

        // v2.1.6 FIX (C6): schedule KeepAliveWorker
        scheduleKeepAlive()
    }

    private fun scheduleKeepAlive() {
        try {
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build()
            val request = PeriodicWorkRequestBuilder<KeepAliveWorker>(
                15, TimeUnit.MINUTES
            )
                .setConstraints(constraints)
                .build()
            WorkManager.getInstance(this).enqueueUniquePeriodicWork(
                "zbot-keepalive",
                ExistingPeriodicWorkPolicy.KEEP,
                request,
            )
        } catch (e: Exception) {
            android.util.Log.w("ZbotApp", "KeepAlive schedule failed: ${e.message}")
        }
    }
}
