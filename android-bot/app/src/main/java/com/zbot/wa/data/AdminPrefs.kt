package com.zbot.wa.data

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * Encrypted preferences for admin state.
 *
 * Stores:
 *   - 7-tap unlock counter (resets after 5 seconds)
 *   - PIN attempt counter (lockout after 3 wrong attempts)
 *   - Admin session state (logged in / logged out)
 */
class AdminPrefs(context: Context) {

    private val masterKey = MasterKey.Builder(context)
        .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
        .build()

    private val prefs = EncryptedSharedPreferences.create(
        context,
        "zbot_admin_prefs",
        masterKey,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    // -----------------------------------------------------------------
    // 7-tap unlock counter
    // -----------------------------------------------------------------

    fun getTapCount(): Int = prefs.getInt("tap_count", 0)
    fun setTapCount(count: Int) = prefs.edit().putInt("tap_count", count).apply()
    fun resetTapCount() = prefs.edit().putInt("tap_count", 0).apply()

    fun getLastTapTimestamp(): Long = prefs.getLong("last_tap_ts", 0)
    fun setLastTapTimestamp(ts: Long) = prefs.edit().putLong("last_tap_ts", ts).apply()

    // -----------------------------------------------------------------
    // PIN attempts
    // -----------------------------------------------------------------

    fun getPinAttempts(): Int = prefs.getInt("pin_attempts", 0)
    fun setPinAttempts(count: Int) = prefs.edit().putInt("pin_attempts", count).apply()

    fun getPinLockoutUntil(): Long = prefs.getLong("pin_lockout_until", 0)
    fun setPinLockoutUntil(ts: Long) = prefs.edit().putLong("pin_lockout_until", ts).apply()

    fun resetPinAttempts() = prefs.edit().apply {
        putInt("pin_attempts", 0)
        putLong("pin_lockout_until", 0)
    }.apply()

    // -----------------------------------------------------------------
    // Admin session
    // -----------------------------------------------------------------

    fun isAdminUnlocked(): Boolean = prefs.getBoolean("admin_unlocked", false)
    fun setAdminUnlocked(value: Boolean) = prefs.edit().putBoolean("admin_unlocked", value).apply()

    fun getLastActivityTimestamp(): Long = prefs.getLong("last_activity_ts", 0)
    fun setLastActivityTimestamp(ts: Long) = prefs.edit().putLong("last_activity_ts", ts).apply()

    /** Check if admin session has timed out (5 minutes inactivity). */
    fun isSessionValid(): Boolean {
        val last = getLastActivityTimestamp()
        if (last == 0L) return false
        val fiveMinutesMs = 5 * 60 * 1000L
        return System.currentTimeMillis() - last < fiveMinutesMs
    }

    fun touchSession() {
        setLastActivityTimestamp(System.currentTimeMillis())
    }

    fun clearSession() {
        prefs.edit().apply {
            putBoolean("admin_unlocked", false)
            putLong("last_activity_ts", 0)
        }.apply()
    }
}
