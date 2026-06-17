package com.zbot.wa.data

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseUser
import kotlinx.coroutines.tasks.await

/**
 * Manages admin Firebase Authentication (email/password) + secure credential storage.
 *
 * Uses EncryptedSharedPreferences to persist admin email across app launches
 * (NOT the password — that's re-entered each session for security).
 */
class AuthManager(private val context: Context) {

    private val auth: FirebaseAuth by lazy { FirebaseAuth.getInstance() }

    private val masterKey: MasterKey by lazy {
        MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
    }

    private val securePrefs by lazy {
        EncryptedSharedPreferences.create(
            context,
            "zbot_admin_auth",
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    }

    /**
     * Check if user is currently logged in as admin.
     */
    fun currentUser(): FirebaseUser? = auth.currentUser

    /**
     * Check if current user has admin UID.
     */
    fun isAdmin(): Boolean = auth.currentUser?.uid == FirebaseConfig.ADMIN_UID

    /**
     * Login admin with email + password.
     * Returns FirebaseUser on success, throws on failure.
     */
    suspend fun login(email: String, password: String): FirebaseUser {
        val result = auth.signInWithEmailAndPassword(email, password).await()
        val user = result.user ?: throw IllegalStateException("Login returned no user")

        // Verify this is the admin UID
        if (user.uid != FirebaseConfig.ADMIN_UID) {
            auth.signOut()
            throw SecurityException("This account is not authorized as admin")
        }

        // Persist email (not password — re-entered each session)
        securePrefs.edit().putString("admin_email", email).apply()
        return user
    }

    /**
     * Logout admin.
     */
    fun logout() {
        auth.signOut()
    }

    /**
     * Get saved admin email (for login form pre-fill).
     */
    fun getSavedEmail(): String? = securePrefs.getString("admin_email", null)

    /**
     * Save admin session token (for auto-resume after app restart within session timeout).
     * Optional — Firebase Auth already persists across app launches.
     */
    fun saveSessionTimestamp(ts: Long) {
        securePrefs.edit().putLong("session_ts", ts).apply()
    }

    fun getSessionTimestamp(): Long = securePrefs.getLong("session_ts", 0)
}
