package com.zbot.wa.data

/**
 * Hardcoded Firebase client config (matches bot/src/firebase/config.ts).
 * These are public values — security comes from Firestore/RTDB rules.
 *
 * Note: storageBucket is included for completeness but we don't use Firebase Storage.
 */
object FirebaseConfig {
    const val API_KEY = "AIzaSyBktNHjRK5_RI4trEZastvKR7dDPHv0O3Y"
    const val AUTH_DOMAIN = "zbot-e39f8.firebaseapp.com"
    const val DATABASE_URL = "https://zbot-e39f8-default-rtdb.asia-southeast1.firebasedatabase.app"
    const val PROJECT_ID = "zbot-e39f8"
    const val STORAGE_BUCKET = "zbot-e39f8.firebasestorage.app"
    const val MESSAGING_SENDER_ID = "569996077528"
    const val APP_ID = "1:569996077528:web:4173b9701e77304dfaeaad"

    /** Admin UID — whitelisted in Firestore rules */
    const val ADMIN_UID = "mBJdBiyAQ1Xsy301Ndu5teFnjUr1"

    /** Admin email (for display + login hint) */
    const val ADMIN_EMAIL = "accu9095@gmail.com"
}
