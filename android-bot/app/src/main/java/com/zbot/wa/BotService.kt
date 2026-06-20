package com.zbot.wa

import android.app.*
import android.content.Context
import android.content.Intent
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
 * Launches Node.js (libnode.so) with the decrypted bot bundle.
 *
 * DEBUGGING:
 *   - All Node.js stdout/stderr is piped to logcat with tag "ZbotBotService"
 *   - Logs are also stored in filesDir/bot-logs.txt (last 1000 lines)
 *   - HTTP endpoint /logs returns the recent log lines for in-app viewing
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

        @Volatile
        var lastError: String? = null
            private set

        /** Recent log lines for in-app debugging (max 1000 lines, ring buffer). */
        private val logBuffer = java.util.concurrent.ConcurrentLinkedDeque<String>()

        fun getRecentLogs(): String {
            return logBuffer.toList().takeLast(500).joinToString("\n")
        }

        fun addLog(line: String) {
            logBuffer.addLast(line)
            while (logBuffer.size > 1000) {
                logBuffer.pollFirst()
            }
        }
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
        addLog("[${System.currentTimeMillis()}] BotService created")
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                addLog("[${System.currentTimeMillis()}] STOP action received")
                stopBot()
                return START_NOT_STICKY
            }
            else -> {
                startForeground(NOTIF_ID, buildNotification("Starting..."))
                startBot()
            }
        }
        return START_STICKY
    }

    /**
     * Acquire PARTIAL_WAKE_LOCK + WIFI_LOCK.
     */
    private fun acquireWakeLocks() {
        try {
            val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Zbot::CPU").apply {
                setReferenceCounted(false)
                acquire()
            }
            val wifi = getSystemService(Context.WIFI_SERVICE) as android.net.wifi.WifiManager
            wifiLock = wifi.createWifiLock(
                android.net.wifi.WifiManager.WIFI_MODE_FULL_HIGH_PERF, "Zbot::WiFi"
            ).apply {
                setReferenceCounted(false)
                acquire()
            }
            addLog("[${System.currentTimeMillis()}] Wake locks acquired")
        } catch (e: Exception) {
            addLog("[${System.currentTimeMillis()}] ERROR acquiring wake locks: ${e.message}")
        }
    }

    private fun releaseWakeLocks() {
        try { wakeLock?.let { if (it.isHeld) it.release() } } catch (e: Exception) {}
        try { wifiLock?.let { if (it.isHeld) it.release() } } catch (e: Exception) {}
        wakeLock = null
        wifiLock = null
    }

    /**
     * Start the bot — decrypts bundle, copies libs, launches Node.js.
     * Logs every step for debugging.
     */
    private fun startBot() {
        if (isRunning) {
            addLog("[${System.currentTimeMillis()}] startBot called but already running — skipping")
            return
        }
        isRunning = true
        lastError = null

        Thread({
            try {
                val nativeLibDir = applicationInfo.nativeLibraryDir
                val filesDir = filesDir
                addLog("[${System.currentTimeMillis()}] === Starting bot ===")
                addLog("[${System.currentTimeMillis()}] nativeLibDir: $nativeLibDir")
                addLog("[${System.currentTimeMillis()}] filesDir: ${filesDir.absolutePath}")

                val nodeBinary = File(nativeLibDir, "libnode.so")
                addLog("[${System.currentTimeMillis()}] libnode.so path: ${nodeBinary.absolutePath}")
                addLog("[${System.currentTimeMillis()}] libnode.so exists: ${nodeBinary.exists()}")
                addLog("[${System.currentTimeMillis()}] libnode.so size: ${if (nodeBinary.exists()) nodeBinary.length() else 0}")

                if (!nodeBinary.exists()) {
                    val msg = "libnode.so NOT FOUND in $nativeLibDir"
                    addLog("[${System.currentTimeMillis()}] FATAL: $msg")
                    Log.e(TAG, msg)
                    lastError = msg
                    updateNotification("Error: Node binary missing")
                    isRunning = false
                    return@Thread
                }

                // Make sure libnode.so is executable
                if (!nodeBinary.canExecute()) {
                    addLog("[${System.currentTimeMillis()}] libnode.so not executable, setting...")
                    nodeBinary.setExecutable(true, true)
                }
                if (!nodeBinary.canExecute()) {
                    val msg = "libnode.so exists but cannot be made executable"
                    addLog("[${System.currentTimeMillis()}] FATAL: $msg")
                    lastError = msg
                    updateNotification("Error: Node binary not executable")
                    isRunning = false
                    return@Thread
                }
                addLog("[${System.currentTimeMillis()}] libnode.so executable: ${nodeBinary.canExecute()}")

                // 1. Copy bot.bundle.enc from assets to filesDir (always overwrite to ensure fresh)
                val encFile = File(filesDir, "bot.bundle.enc")
                addLog("[${System.currentTimeMillis()}] Copying bot.bundle.enc from assets...")
                try {
                    assets.open("bot.bundle.enc").use { input ->
                        encFile.outputStream().use { output -> input.copyTo(output) }
                    }
                    addLog("[${System.currentTimeMillis()}] bot.bundle.enc copied: ${encFile.length()} bytes")
                } catch (e: Exception) {
                    val msg = "Failed to copy bot.bundle.enc from assets: ${e.message}"
                    addLog("[${System.currentTimeMillis()}] FATAL: $msg")
                    Log.e(TAG, msg, e)
                    lastError = msg
                    updateNotification("Error: Bundle missing")
                    isRunning = false
                    return@Thread
                }

                // 2. Decrypt bundle
                val bundleJs = File(filesDir, "bot.bundle.js")
                addLog("[${System.currentTimeMillis()}] Decrypting bundle...")
                try {
                    val encrypted = encFile.readBytes()
                    addLog("[${System.currentTimeMillis()}] Encrypted bytes: ${encrypted.size}")
                    val plaintext = Crypto.decryptBundle(encrypted)
                    bundleJs.writeBytes(plaintext)
                    addLog("[${System.currentTimeMillis()}] ✅ Bundle decrypted: ${plaintext.size} bytes → ${bundleJs.absolutePath}")
                } catch (e: Exception) {
                    val msg = "Bundle decrypt failed: ${e.message}"
                    addLog("[${System.currentTimeMillis()}] FATAL: $msg")
                    Log.e(TAG, msg, e)
                    lastError = msg
                    updateNotification("Error: Bundle decrypt failed")
                    isRunning = false
                    return@Thread
                }

                // 3. Create data dir for bot (session, etc.)
                val dataDir = File(filesDir, "bot-data").apply { mkdirs() }
                addLog("[${System.currentTimeMillis()}] dataDir: ${dataDir.absolutePath}")

                // 4. Create node-libs dir + copy versioned .so files
                val nodeLibsDir = File(filesDir, "node-libs").apply { mkdirs() }
                copyVersionedLibs(nativeLibDir, nodeLibsDir)
                addLog("[${System.currentTimeMillis()}] node-libs dir: ${nodeLibsDir.absolutePath}")

                // 5. Build environment for Node.js
                // Match FTGM essentials + add our app-specific vars (used in commands)
                val env = mutableMapOf<String, String>()
                env["HOME"] = filesDir.absolutePath
                env["BOT_DATA_DIR"] = dataDir.absolutePath
                env["BOT_PORT"] = "3001"
                env["NODE_ENV"] = "production"
                env["TMPDIR"] = cacheDir.absolutePath
                env["LD_LIBRARY_PATH"] = "${nodeLibsDir.absolutePath}:${nativeLibDir}:/system/lib64:/vendor/lib64"
                // App-specific vars (used by .alive, .menu, .sticker, .vv commands)
                env["BOT_VERSION"] = BuildConfig.VERSION_NAME
                env["BOT_NAME"] = "Zbot"
                env["BOT_PREFIX"] = "."
                env["BOT_OWNER"] = "Admin"
                env["BOT_DEVICE_MODEL"] = "${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL} (Android ${android.os.Build.VERSION.RELEASE})"

                addLog("[${System.currentTimeMillis()}] Environment:")
                env.forEach { (k, v) -> addLog("  $k=$v") }

                // 6. Launch Node.js
                // v2.1.4: bumped from 128MB to 256MB — Baileys + Firebase SDK needs more headroom
                val cmd = listOf(
                    nodeBinary.absolutePath,
                    "--max-old-space-size=256",
                    bundleJs.absolutePath
                )
                addLog("[${System.currentTimeMillis()}] Launching: ${cmd.joinToString(" ")}")

                val pb = ProcessBuilder(cmd).apply {
                    directory(filesDir)
                    redirectErrorStream(false)
                    environment().putAll(env)
                }

                nodeProcess = pb.start()
                addLog("[${System.currentTimeMillis()}] ✅ Node.js process started (PID: ${nodeProcess?.toString()})")
                updateNotification("Bot running")

                // Pipe stdout to logcat + log buffer
                Thread({
                    try {
                        nodeProcess?.inputStream?.bufferedReader()?.useLines { lines ->
                            lines.forEach {
                                Log.i(TAG, "[node] $it")
                                addLog("[node-out] $it")
                            }
                        }
                    } catch (e: Exception) {
                        addLog("[${System.currentTimeMillis()}] stdout reader error: ${e.message}")
                    }
                }, "node-stdout").start()

                // Pipe stderr to logcat + log buffer
                Thread({
                    try {
                        nodeProcess?.errorStream?.bufferedReader()?.useLines { lines ->
                            lines.forEach {
                                Log.e(TAG, "[node] $it")
                                addLog("[node-err] $it")
                            }
                        }
                    } catch (e: Exception) {
                        addLog("[${System.currentTimeMillis()}] stderr reader error: ${e.message}")
                    }
                }, "node-stderr").start()

                // Wait for process to exit
                val exitCode = nodeProcess?.waitFor() ?: -1
                addLog("[${System.currentTimeMillis()}] Node exited with code $exitCode")

                isRunning = false

                if (exitCode == 0) {
                    updateNotification("Bot stopped")
                } else {
                    // Restart with exponential backoff
                    restartCount++
                    if (restartCount <= 5) {
                        val delayMs = (3_000L * (1L shl restartCount)).coerceAtMost(60_000L)
                        addLog("[${System.currentTimeMillis()}] Restarting in ${delayMs}ms (attempt $restartCount)")
                        Thread.sleep(delayMs)
                        startBot()
                    } else {
                        lastError = "Max restart attempts reached (exit code $exitCode)"
                        updateNotification("Bot failed — tap to restart")
                    }
                }
            } catch (e: Exception) {
                val msg = "startBot crashed: ${e.message}"
                addLog("[${System.currentTimeMillis()}] FATAL: $msg")
                Log.e(TAG, msg, e)
                lastError = msg
                isRunning = false
                updateNotification("Error: ${e.message}")
            }
        }, "BotRunner").start()
    }

    /**
     * Stop the bot gracefully.
     */
    private fun stopBot() {
        addLog("[${System.currentTimeMillis()}] Stopping bot...")
        try { nodeProcess?.destroy() } catch (e: Exception) {}
        nodeProcess = null
        isRunning = false
        releaseWakeLocks()
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    /**
     * Copy versioned native libs (libssl.so.3, libcrypto.so.3, etc.)
     * from APK's lib dir to filesDir/node-libs/.
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
                targetFile.setExecutable(true, false)
            } catch (e: Exception) {
                addLog("[${System.currentTimeMillis()}] Failed to copy $source → $target: ${e.message}")
            }
        }
    }

    private fun updateNotification(text: String) {
        try {
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.notify(NOTIF_ID, buildNotification(text))
        } catch (e: Exception) {
            // ignore
        }
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
            applicationContext, 1, stopIntent,
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
            CHANNEL_RUNNING, "Bot Running", NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "Shows while Zbot is actively running"
            setShowBadge(false)
            setSound(null, null)
        })

        nm.createNotificationChannel(NotificationChannel(
            CHANNEL_STOPPED, "Bot Status", NotificationManager.IMPORTANCE_DEFAULT
        ).apply {
            description = "Persistent notification to restart the bot"
        })
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        // Restart if user swipes the app away
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
        addLog("[${System.currentTimeMillis()}] BotService destroyed")
    }
}
