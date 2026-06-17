package com.zbot.wa

import android.app.*
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Log
import androidx.core.app.NotificationCompat
import com.zbot.wa.ui.MainActivity
import java.io.File

/**
 * Zbot — BotService (Foreground Service)
 *
 * Responsibilities:
 *   1. Acquire wake locks (CPU + WiFi) to keep Node.js alive
 *   2. Decrypt bot.bundle.enc → bot.bundle.js (one-time per boot)
 *   3. Copy native libs (libnode.so etc.) to filesDir/node-libs/
 *   4. Launch Node.js: libnode.so --max-old-space-size=128 bot.bundle.js
 *   5. Pipe stdout/stderr to logcat
 *   6. Auto-restart with exponential backoff on crash
 *   7. Keep-alive via onTaskRemoved + AlarmManager
 *
 * One socket per APK (mirrors FTGM's architecture).
 */
class BotService : Service() {

    companion object {
        private const val TAG = "ZbotBotService"
        private const val NOTIF_ID = 1001
        private const val CHANNEL_RUNNING = "zbot_running"
        private const val CHANNEL_STOPPED = "zbot_stopped"

        const val ACTION_START = "com.zbot.wa.START"
        const val ACTION_STOP = "com.zbot.wa.STOP"

        @Volatile
        var isRunning: Boolean = false
            private set
    }

    private var nodeProcess: Process? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private var wifiLock: android.net.wifi.WifiManager.WifiLock? = null
    private var restartCount = 0

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannels()
        acquireWakeLocks()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                stopBot()
                return START_NOT_STICKY
            }
            else -> {
                startForeground(NOTIF_ID, buildNotification("Starting..."))
                startBot()
            }
        }
        return START_STICKY  // restart if killed
    }

    /**
     * Acquire PARTIAL_WAKE_LOCK + WIFI_LOCK to keep Node running.
     */
    private fun acquireWakeLocks() {
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Zbot::CPU").apply {
            setReferenceCounted(false)
            acquire()
        }
        val wifi = getSystemService(Context.WIFI_SERVICE) as android.net.wifi.WifiManager
        wifiLock = wifi.createWifiLock(android.net.wifi.WifiManager.WIFI_MODE_FULL_HIGH_PERF, "Zbot::WiFi").apply {
            setReferenceCounted(false)
            acquire()
        }
        Log.i(TAG, "Wake locks acquired")
    }

    /**
     * Release wake locks (on shutdown).
     */
    private fun releaseWakeLocks() {
        wakeLock?.let { if (it.isHeld) it.release() }
        wifiLock?.let { if (it.isHeld) it.release() }
        wakeLock = null
        wifiLock = null
    }

    /**
     * Start the bot: decrypt bundle, copy libs, launch Node.js.
     */
    private fun startBot() {
        if (isRunning) return
        isRunning = true

        Thread({
            try {
                val nativeLibDir = applicationInfo.nativeLibraryDir
                val filesDir = filesDir
                val nodeBinary = File(nativeLibDir, "libnode.so")

                if (!nodeBinary.exists() || !nodeBinary.canExecute()) {
                    Log.e(TAG, "libnode.so not found in $nativeLibDir")
                    updateNotification("Error: Node binary missing")
                    return@Thread
                }

                // 1. Decrypt bundle to filesDir/bot.bundle.js (if not already)
                val bundleJs = File(filesDir, "bot.bundle.js")
                if (!bundleJs.exists() || bundleJs.length() < 1000) {
                    Log.i(TAG, "Decrypting bot.bundle.enc...")
                    val encFile = File(filesDir, "bot.bundle.enc")
                    if (!encFile.exists()) {
                        // Copy from assets
                        assets.open("bot.bundle.enc").use { input ->
                            encFile.outputStream().use { output -> input.copyTo(output) }
                        }
                    }
                    val encrypted = encFile.readBytes()
                    val plaintext = Crypto.decryptBundle(encrypted)
                    bundleJs.writeBytes(plaintext)
                    Log.i(TAG, "Bundle decrypted: ${plaintext.size} bytes")
                }

                // 2. Create data dir for bot (session, etc.)
                val dataDir = File(filesDir, "bot-data").apply { mkdirs() }

                // 3. Create node-libs dir + copy versioned .so files
                val nodeLibsDir = File(filesDir, "node-libs").apply { mkdirs() }
                copyVersionedLibs(nativeLibDir, nodeLibsDir)

                // 4. Launch Node.js
                val pb = ProcessBuilder(
                    nodeBinary.absolutePath,
                    "--max-old-space-size=128",
                    bundleJs.absolutePath
                ).apply {
                    directory(filesDir)
                    redirectErrorStream(false)
                    environment()["HOME"] = filesDir.absolutePath
                    environment()["BOT_DATA_DIR"] = dataDir.absolutePath
                    environment()["BOT_PORT"] = "3001"
                    environment()["BOT_VERSION"] = BuildConfig.VERSION_NAME
                    environment()["BOT_NAME"] = "Zbot"
                    environment()["BOT_PREFIX"] = "."
                    environment()["BOT_OWNER"] = "Admin"
                    environment()["BOT_DEVICE_MODEL"] = "${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL} (Android ${android.os.Build.VERSION.RELEASE})"
                    environment()["NODE_ENV"] = "production"
                    environment()["TMPDIR"] = cacheDir.absolutePath
                    environment()["LD_LIBRARY_PATH"] = "${nodeLibsDir.absolutePath}:${nativeLibDir}:/system/lib64:/vendor/lib64"
                }

                Log.i(TAG, "Starting Node.js: ${nodeBinary.absolutePath} ${bundleJs.absolutePath}")
                nodeProcess = pb.start()

                // Pipe stdout/stderr to logcat
                Thread({
                    nodeProcess?.inputStream?.bufferedReader()?.useLines { lines ->
                        lines.forEach { Log.i(TAG, "[node] $it") }
                    }
                }, "node-stdout").start()
                Thread({
                    nodeProcess?.errorStream?.bufferedReader()?.useLines { lines ->
                        lines.forEach { Log.e(TAG, "[node] $it") }
                    }
                }, "node-stderr").start()

                // Wait for process to exit
                val exitCode = nodeProcess?.waitFor() ?: -1
                Log.w(TAG, "Node exited with code $exitCode")

                isRunning = false

                if (exitCode == 0) {
                    updateNotification("Bot stopped")
                } else {
                    // Restart with exponential backoff
                    restartCount++
                    if (restartCount <= 5) {
                        val delayMs = (3_000L * (1L shl restartCount)).coerceAtMost(60_000L)
                        Log.i(TAG, "Restarting in ${delayMs}ms (attempt $restartCount)")
                        Thread.sleep(delayMs)
                        startBot()
                    } else {
                        updateNotification("Bot failed — tap to restart")
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "startBot failed", e)
                isRunning = false
                updateNotification("Error: ${e.message}")
            }
        }, "BotRunner").start()
    }

    /**
     * Stop the bot gracefully.
     */
    private fun stopBot() {
        Log.i(TAG, "Stopping bot...")
        nodeProcess?.destroy()
        nodeProcess = null
        isRunning = false
        releaseWakeLocks()
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    /**
     * Copy versioned native libs (libssl.so.3, libcrypto.so.3, libicui18n.so.78, etc.)
     * from APK's lib dir to filesDir/node-libs/.
     *
     * Pattern (mirrors FTGM's approach):
     *   libssl_v3.so      → libssl.so.3
     *   libcrypto_v3.so   → libcrypto.so.3
     *   libicuuc_v78.so   → libicuuc.so.78
     *   etc.
     */
    private fun copyVersionedLibs(nativeLibDir: String, targetDir: File) {
        val mappings = listOf(
            "libz_v1.so" to "libz.so.1",
            "libcrypto_v3.so" to "libcrypto.so.3",
            "libssl_v3.so" to "libssl.so.3",
            "libicui18n_v78.so" to "libicui18n.so.78",
            "libicuuc_v78.so" to "libicuuc.so.78",
            "libicudata_v78.so" to "libicudata.so.78",
            "libffi.so" to "libffi.so",
            "libcares.so" to "libcares.so",
            "libsqlite3.so" to "libsqlite3.so",
            "libc++_shared.so" to "libc++_shared.so",
            "libicudata.so" to "libicudata.so",
            "libicui18n.so" to "libicui18n.so",
            "libicuuc.so" to "libicuuc.so",
            "libz.so" to "libz.so",
            "libcrypto.so" to "libcrypto.so",
            "libssl.so" to "libssl.so"
        )
        for ((source, target) in mappings) {
            val srcFile = File(nativeLibDir, source)
            val targetFile = File(targetDir, target)
            if (targetFile.exists() && targetFile.length() > 0) continue
            if (!srcFile.exists()) continue
            try {
                srcFile.copyTo(targetFile, overwrite = true)
                targetFile.setReadable(true, false)
            } catch (e: Exception) {
                Log.w(TAG, "Failed to copy $source → $target: ${e.message}")
            }
        }
    }

    private fun updateNotification(text: String) {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.notify(NOTIF_ID, buildNotification(text))
    }

    private fun buildNotification(text: String): Notification {
        val intent = Intent(applicationContext, MainActivity::class.java)
        intent.flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        val pi = PendingIntent.getActivity(
            applicationContext, 0, intent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        val stopIntent = Intent(applicationContext, BotService::class.java).apply { action = ACTION_STOP }
        val stopPi = PendingIntent.getService(
            this, 1, stopIntent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        return NotificationCompat.Builder(this, CHANNEL_RUNNING)
            .setContentTitle("Zbot")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.stat_notify_chat)
            .setContentIntent(pi)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .addAction(android.R.drawable.ic_media_pause, "Stop", stopPi)
            .build()
    }

    private fun createNotificationChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        nm.createNotificationChannel(NotificationChannel(
            CHANNEL_RUNNING,
            "Bot Running",
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "Shows while Zbot is actively running"
            setShowBadge(false)
            setSound(null, null)
        })

        nm.createNotificationChannel(NotificationChannel(
            CHANNEL_STOPPED,
            "Bot Status",
            NotificationManager.IMPORTANCE_DEFAULT
        ).apply {
            description = "Persistent notification to restart the bot"
        })
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        // Restart if user swipes the app away (bot keeps running)
        val restartIntent = Intent(this, BotService::class.java).apply {
            action = ACTION_START
            setPackage(packageName)
        }
        val pi = PendingIntent.getService(
            this, 1, restartIntent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        val alarm = getSystemService(Context.ALARM_SERVICE) as AlarmManager
        alarm.setExactAndAllowWhileIdle(
            AlarmManager.ELAPSED_REALTIME,
            android.os.SystemClock.elapsedRealtime() + 1000,
            pi
        )
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() {
        super.onDestroy()
        releaseWakeLocks()
    }
}
