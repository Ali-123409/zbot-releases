package com.zbot.wa

import android.util.Base64
import com.zbot.wa.BuildConfig
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.SecretKey
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec

/**
 * Zbot — AES-256-GCM Decryptor (Kotlin side)
 *
 * File format (matches bot/encrypt.ts):
 *   [salt:32B][iv:12B][ciphertext:N B][authTag:16B]
 *
 * Key derivation: PBKDF2WithHmacSHA256, 100k iterations, 32-byte key.
 *
 * Passphrase comes from BuildConfig.BUNDLE_PASSPHRASE — set in app/build.gradle.kts.
 * Must match the passphrase in bot/encrypt.ts.
 */
object Crypto {

    private const val SALT_LENGTH = 32
    private const val IV_LENGTH = 12
    private const val AUTH_TAG_LENGTH = 16  // bytes
    private const val PBKDF2_ITERATIONS = 100_000
    private const val KEY_LENGTH_BITS = 256

    /**
     * Decrypt the bot bundle.
     *
     * @param encrypted Raw bytes of bot.bundle.enc
     * @return Plaintext bytes (the bundled JavaScript)
     */
    fun decryptBundle(encrypted: ByteArray): ByteArray {
        require(encrypted.size > SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH) {
            "Encrypted bundle too small: ${encrypted.size} bytes"
        }

        // Split: salt | iv | ciphertext+authTag
        val salt = encrypted.copyOfRange(0, SALT_LENGTH)
        val iv = encrypted.copyOfRange(SALT_LENGTH, SALT_LENGTH + IV_LENGTH)
        val ciphertextWithTag = encrypted.copyOfRange(SALT_LENGTH + IV_LENGTH, encrypted.size)
        // GCM auth tag is appended to ciphertext in Java's AES/GCM/NoPadding
        // (last 16 bytes of ciphertextWithTag)

        // Derive key
        val key = deriveKey(BuildConfig.BUNDLE_PASSPHRASE, salt)

        // Decrypt
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        val spec = GCMParameterSpec(AUTH_TAG_LENGTH * 8, iv)
        cipher.init(Cipher.DECRYPT_MODE, key, spec)

        return cipher.doFinal(ciphertextWithTag)
    }

    /**
     * Derive AES key from passphrase + salt using PBKDF2WithHmacSHA256.
     */
    private fun deriveKey(passphrase: String, salt: ByteArray): SecretKey {
        val factory = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
        val spec = PBEKeySpec(passphrase.toCharArray(), salt, PBKDF2_ITERATIONS, KEY_LENGTH_BITS)
        val raw = factory.generateSecret(spec).encoded
        return SecretKeySpec(raw, "AES")
    }
}
