# ProGuard rules for Zbot release build

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

# Firebase (uses reflection)
-keep class com.google.firebase.** { *; }
-keep class com.google.android.gms.** { *; }
-dontwarn com.google.firebase.**

# OkHttp
-dontwarn okhttp3.**
-dontwarn okio.**

# Compose (already obfuscated by AAPT, just dontwarn)
-dontwarn androidx.compose.**

# Native lib loading (libnode.so via dlopen)
-keep class com.zbot.wa.BotService { *; }
-keep class com.zbot.wa.Crypto { *; }
