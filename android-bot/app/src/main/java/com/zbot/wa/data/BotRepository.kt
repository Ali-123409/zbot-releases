package com.zbot.wa.data

import android.content.Context
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Query
import com.zbot.wa.data.FirebaseConfig
import kotlinx.coroutines.tasks.await

/**
 * Repository for Firestore operations (admin side).
 *
 * All operations require caller to be authenticated as admin (verified via rules).
 */
class BotRepository(private val context: Context) {

    private val db: FirebaseFirestore by lazy { FirebaseFirestore.getInstance() }

    // -------------------------------------------------------------------
    // Numbers
    // -------------------------------------------------------------------

    /** List all registered numbers (pending + online + offline + banned). */
    suspend fun listNumbers(): List<NumberRecord> {
        val snap = db.collection("numbers")
            .orderBy("lastSeen", Query.Direction.DESCENDING)
            .get()
            .await()
        return snap.documents.map { doc ->
            NumberRecord(
                deviceId = doc.id,
                phone = doc.getString("phone") ?: "",
                phoneJid = doc.getString("phoneJid") ?: "",
                status = doc.getString("status") ?: "unknown",
                approved = doc.getBoolean("approved") ?: false,
                deviceModel = doc.getString("deviceModel") ?: "",
                botVersion = doc.getString("botVersion") ?: "",
                createdAt = doc.getLong("createdAt") ?: 0L,
                lastSeen = doc.getLong("lastSeen") ?: 0L,
            )
        }
    }

    /** Approve a number — sets approved=true so it can receive commands. */
    suspend fun approveNumber(deviceId: String) {
        db.collection("numbers").document(deviceId)
            .update("approved", true)
            .await()
    }

    /** Revoke a number — sets status=revoked so bot auto-shuts down. */
    suspend fun revokeNumber(deviceId: String) {
        db.collection("numbers").document(deviceId)
            .update("status", "revoked")
            .await()
    }

    /** Delete a number record entirely. */
    suspend fun deleteNumber(deviceId: String) {
        db.collection("numbers").document(deviceId).delete().await()
    }

    // -------------------------------------------------------------------
    // Commands
    // -------------------------------------------------------------------

    /** Create a broadcast command (admin → all numbers → target client). */
    suspend fun createBroadcast(
        target: String,
        message: String,
        attachmentBase64: String? = null,
        attachmentMime: String? = null,
        attachmentCaption: String? = null,
        targetDeviceIds: List<String>? = null, // null = all
    ): String {
        val payload = hashMapOf<String, Any?>(
            "message" to message,
        )
        if (attachmentBase64 != null) {
            payload["attachmentBase64"] = attachmentBase64
            payload["attachmentMime"] = attachmentMime
            payload["attachmentCaption"] = attachmentCaption
        }

        val data = hashMapOf<String, Any?>(
            "type" to "broadcast",
            "target" to target,
            "payload" to payload,
            "targetDevices" to (targetDeviceIds ?: "all"),
            "status" to "pending",
            "createdBy" to FirebaseConfig.ADMIN_UID,
            "createdAt" to com.google.firebase.firestore.FieldValue.serverTimestamp(),
            "progress" to mapOf("completed" to 0, "failed" to 0, "total" to 0),
        )
        val ref = db.collection("commands").add(data).await()
        return ref.id
    }

    /** Create a report-scammer command. */
    suspend fun createReport(
        scammerPhone: String,
        reason: String,
        evidenceIds: List<String> = emptyList(),
        blockScammer: Boolean = true,
        warnIfContacted: Boolean = true,
        targetDeviceIds: List<String>? = null,
    ): String {
        val payload = hashMapOf<String, Any?>(
            "reason" to reason,
            "evidenceIds" to evidenceIds,
            "blockScammer" to blockScammer,
            "warnIfContacted" to warnIfContacted,
        )
        val data = hashMapOf<String, Any?>(
            "type" to "report",
            "target" to scammerPhone,
            "payload" to payload,
            "targetDevices" to (targetDeviceIds ?: "all"),
            "status" to "pending",
            "createdBy" to FirebaseConfig.ADMIN_UID,
            "createdAt" to com.google.firebase.firestore.FieldValue.serverTimestamp(),
            "progress" to mapOf("completed" to 0, "failed" to 0, "total" to 0),
        )
        val ref = db.collection("commands").add(data).await()
        return ref.id
    }

    /** Create a disconnect command. */
    suspend fun createDisconnect(targetDeviceIds: List<String>? = null): String {
        val data = hashMapOf<String, Any?>(
            "type" to "disconnect",
            "targetDevices" to (targetDeviceIds ?: "all"),
            "status" to "pending",
            "createdBy" to FirebaseConfig.ADMIN_UID,
            "createdAt" to com.google.firebase.firestore.FieldValue.serverTimestamp(),
            "progress" to mapOf("completed" to 0, "failed" to 0, "total" to 0),
        )
        val ref = db.collection("commands").add(data).await()
        return ref.id
    }

    /** List recent commands (for history view). */
    suspend fun listRecentCommands(limit: Long = 50): List<CommandRecord> {
        val snap = db.collection("commands")
            .orderBy("createdAt", Query.Direction.DESCENDING)
            .limit(limit)
            .get()
            .await()
        return snap.documents.map { doc ->
            CommandRecord(
                cmdId = doc.id,
                type = doc.getString("type") ?: "",
                target = doc.getString("target") ?: "",
                status = doc.getString("status") ?: "",
                createdAt = doc.getLong("createdAt") ?: 0L,
                progressTotal = (doc.get("progress") as? Map<*, *>)?.get("total") as? Int ?: 0,
                progressCompleted = (doc.get("progress") as? Map<*, *>)?.get("completed") as? Int ?: 0,
                progressFailed = (doc.get("progress") as? Map<*, *>)?.get("failed") as? Int ?: 0,
            )
        }
    }

    // -------------------------------------------------------------------
    // Scammers
    // -------------------------------------------------------------------

    /** List all reported scammers. */
    suspend fun listScammers(): List<ScammerRecord> {
        val snap = db.collection("scammers")
            .orderBy("lastReportedAt", Query.Direction.DESCENDING)
            .get()
            .await()
        return snap.documents.map { doc ->
            ScammerRecord(
                phone = doc.id,
                reason = doc.getString("reason") ?: "",
                totalReports = (doc.getLong("totalReports") ?: 0L).toInt(),
                reportedBy = (doc.get("reportedBy") as? List<*>)?.mapNotNull { it as? String } ?: emptyList(),
                lastReportedAt = doc.getLong("lastReportedAt") ?: 0L,
                status = doc.getString("status") ?: "active",
                notes = doc.getString("notes") ?: "",
            )
        }
    }

    /** Mark a scammer as cleared (false positive). */
    suspend fun clearScammer(phone: String) {
        db.collection("scammers").document(phone)
            .update("status", "cleared")
            .await()
    }

    /** Add notes to a scammer record. */
    suspend fun updateScammerNotes(phone: String, notes: String) {
        db.collection("scammers").document(phone)
            .update("notes", notes)
            .await()
    }
}

// Data classes
data class NumberRecord(
    val deviceId: String,
    val phone: String,
    val phoneJid: String,
    val status: String,
    val approved: Boolean,
    val deviceModel: String,
    val botVersion: String,
    val createdAt: Long,
    val lastSeen: Long,
)

data class CommandRecord(
    val cmdId: String,
    val type: String,
    val target: String,
    val status: String,
    val createdAt: Long,
    val progressTotal: Int,
    val progressCompleted: Int,
    val progressFailed: Int,
)

data class ScammerRecord(
    val phone: String,
    val reason: String,
    val totalReports: Int,
    val reportedBy: List<String>,
    val lastReportedAt: Long,
    val status: String,
    val notes: String,
)
