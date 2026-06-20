# ProGuard rules for Zbot release build (v2.1.5 — aggressive R8)

# Enable R8 full mode (set in gradle.properties)
# This aggressively removes unused classes including unused Firebase features

# Keep BuildConfig (we use it for AES passphrase, PIN)
-keep class com.zbot.wa.BuildConfig { *; }

# Keep Hilt generated code
-keep class **_HiltComponents$* { *; }
-keep class **_HiltModules$* { *; }
-keep,allowobfuscation @dagger.hilt.android.lifecycle.HiltViewModel class *

# Kotlin metadata
-keep class kotlin.Metadata { *; }

# Coroutines
-keepnames class kotlinx.coroutines.internal.MainDispatcherFactory {}
-keepnames class kotlinx.coroutines.CoroutineExceptionHandler {}

# Firebase — keep only Auth + Firestore + RTDB entry points (REST-based admin)
# Removed broad keep rule so R8 can strip unused Firebase features
-keep class com.google.firebase.auth.** { *; }
-keep class com.google.firebase.firestore.** { *; }
-keep class com.google.firebase.database.** { *; }
-keep class com.google.firebase.FirebaseApp { *; }
-keep class com.google.firebase.FirebaseOptions { *; }
-dontwarn com.google.firebase.**

# OkHttp
-dontwarn okhttp3.**
-dontwarn okio.**

# Compose
-dontwarn androidx.compose.**

# Native lib loading (libnode.so via dlopen)
-keep class com.zbot.wa.BotService { *; }
-keep class com.zbot.wa.Crypto { *; }

# Strip verbose + debug logging in release (keep info — BotService pipes Node stdout via Log.i)
-assumenosideeffects class android.util.Log {
    public static *** v(...);
    public static *** d(...);
}
