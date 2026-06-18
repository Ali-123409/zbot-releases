package com.zbot.wa.ui.screens

import android.content.Intent
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.zbot.wa.BotService
import com.zbot.wa.data.FirebaseConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject

@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
fun StatusScreen(
    onPairClick: () -> Unit,
    onSettingsClick: () -> Unit,
    onCommandsClick: () -> Unit,
    onAboutClick: () -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var status by remember { mutableStateOf("Loading...") }
    var connected by remember { mutableStateOf(false) }
    var phone by remember { mutableStateOf("") }
    var approved by remember { mutableStateOf(false) }
    var showLogs by remember { mutableStateOf(false) }
    var logsContent by remember { mutableStateOf("") }
    var logsLoading by remember { mutableStateOf(false) }

    // Poll bot status every 3 seconds
    LaunchedEffect(Unit) {
        while (true) {
            try {
                val client = OkHttpClient()
                val req = Request.Builder().url("http://localhost:3001/status").build()
                val resp = withContext(Dispatchers.IO) { client.newCall(req).execute() }
                if (resp.isSuccessful) {
                    val json = JSONObject(resp.body!!.string())
                    status = json.optString("status", "Unknown")
                    connected = json.optBoolean("connected", false)
                    phone = json.optString("phone", "")
                    approved = json.optBoolean("approved", false)
                } else {
                    status = if (BotService.isRunning) "Bot starting..." else "Bot not running"
                    connected = false
                }
            } catch (e: Exception) {
                status = if (BotService.isRunning) "Bot starting..." else "Tap Start to launch"
                connected = false
            }
            kotlinx.coroutines.delay(3000)
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Zbot", fontWeight = FontWeight.Bold) },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.background
                ),
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(padding)
                .padding(16.dp)
        ) {
            // Status card
            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                shape = RoundedCornerShape(16.dp),
            ) {
                Column(modifier = Modifier.padding(20.dp)) {
                    Text(
                        text = "Bot Status",
                        style = MaterialTheme.typography.titleMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Spacer(Modifier.height(8.dp))
                    Text(
                        text = status,
                        style = MaterialTheme.typography.headlineMedium,
                        color = if (connected) MaterialTheme.colorScheme.onSurface
                                else MaterialTheme.colorScheme.onSurfaceVariant,
                        fontWeight = FontWeight.SemiBold,
                    )
                    if (connected && phone.isNotEmpty()) {
                        Spacer(Modifier.height(4.dp))
                        Text(
                            text = if (approved) "✅ Approved by admin"
                                   else "⏳ Pending admin approval",
                            style = MaterialTheme.typography.bodyMedium,
                            color = if (approved) MaterialTheme.colorScheme.primary
                                    else MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }

            Spacer(Modifier.height(16.dp))

            // Action buttons
            if (!connected) {
                Button(
                    onClick = onPairClick,
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(56.dp),
                    shape = RoundedCornerShape(12.dp),
                ) {
                    Icon(Icons.Default.Link, contentDescription = null)
                    Spacer(Modifier.width(8.dp))
                    Text("Pair WhatsApp Number")
                }
                Spacer(Modifier.height(8.dp))
            } else {
                Button(
                    onClick = {
                        scope.launch {
                            withContext(Dispatchers.IO) {
                                val client = OkHttpClient()
                                val req = Request.Builder()
                                    .url("http://localhost:3001/disconnect")
                                    .build()
                                client.newCall(req).execute()
                            }
                        }
                    },
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(56.dp),
                    shape = RoundedCornerShape(12.dp),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = MaterialTheme.colorScheme.error
                    ),
                ) {
                    Icon(Icons.Default.LinkOff, contentDescription = null)
                    Spacer(Modifier.width(8.dp))
                    Text("Disconnect")
                }
                Spacer(Modifier.height(8.dp))
            }

            // Start bot button (if not running)
            if (!BotService.isRunning) {
                Button(
                    onClick = {
                        val intent = android.content.Intent(context, BotService::class.java).apply {
                            action = BotService.ACTION_START
                        }
                        androidx.core.content.ContextCompat.startForegroundService(context, intent)
                    },
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(56.dp),
                    shape = RoundedCornerShape(12.dp),
                ) {
                    Icon(Icons.Default.PlayArrow, contentDescription = null)
                    Spacer(Modifier.width(8.dp))
                    Text("Start Bot")
                }
                Spacer(Modifier.height(8.dp))
                // View Logs button (debug)
                OutlinedButton(
                    onClick = {
                        logsLoading = true
                        showLogs = true
                        // First show Kotlin-side logs
                        logsContent = "=== Kotlin BotService logs ===\n${BotService.getRecentLogs()}\n\n=== Node.js bot logs (fetching...) ===\n"
                        scope.launch {
                            try {
                                val client = OkHttpClient()
                                val req = Request.Builder().url("http://localhost:3001/logs").build()
                                val resp = withContext(Dispatchers.IO) { client.newCall(req).execute() }
                                if (resp.isSuccessful) {
                                    val json = JSONObject(resp.body!!.string())
                                    val logs = json.getJSONArray("logs")
                                    val sb = StringBuilder()
                                    for (i in 0 until logs.length()) {
                                        sb.append(logs.getString(i)).append('\n')
                                    }
                                    logsContent = "=== Kotlin BotService logs ===\n${BotService.getRecentLogs()}\n\n=== Node.js bot logs ===\n$sb"
                                } else {
                                    logsContent = "=== Kotlin BotService logs ===\n${BotService.getRecentLogs()}\n\n=== Node.js HTTP /logs failed: ${resp.code} ==="
                                }
                            } catch (e: Exception) {
                                logsContent = "=== Kotlin BotService logs ===\n${BotService.getRecentLogs()}\n\n=== Node.js HTTP /logs unreachable: ${e.message} ===\n(Bot may have crashed before HTTP server started)"
                            } finally {
                                logsLoading = false
                            }
                        }
                    },
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(48.dp),
                    shape = RoundedCornerShape(12.dp),
                ) {
                    Icon(Icons.Default.BugReport, contentDescription = null)
                    Spacer(Modifier.width(8.dp))
                    Text("View Logs (Debug)")
                }
                Spacer(Modifier.height(16.dp))
            } else {
                // Bot is running — also show logs button
                OutlinedButton(
                    onClick = {
                        logsLoading = true
                        showLogs = true
                        logsContent = "=== Kotlin BotService logs ===\n${BotService.getRecentLogs()}\n\n=== Node.js bot logs (fetching...) ===\n"
                        scope.launch {
                            try {
                                val client = OkHttpClient()
                                val req = Request.Builder().url("http://localhost:3001/logs").build()
                                val resp = withContext(Dispatchers.IO) { client.newCall(req).execute() }
                                if (resp.isSuccessful) {
                                    val json = JSONObject(resp.body!!.string())
                                    val logs = json.getJSONArray("logs")
                                    val sb = StringBuilder()
                                    for (i in 0 until logs.length()) {
                                        sb.append(logs.getString(i)).append('\n')
                                    }
                                    logsContent = "=== Kotlin BotService logs ===\n${BotService.getRecentLogs()}\n\n=== Node.js bot logs ===\n$sb"
                                } else {
                                    logsContent = "=== Kotlin BotService logs ===\n${BotService.getRecentLogs()}\n\n=== Node.js HTTP /logs failed: ${resp.code} ==="
                                }
                            } catch (e: Exception) {
                                logsContent = "=== Kotlin BotService logs ===\n${BotService.getRecentLogs()}\n\n=== Node.js HTTP /logs unreachable: ${e.message} ==="
                            } finally {
                                logsLoading = false
                            }
                        }
                    },
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(48.dp),
                    shape = RoundedCornerShape(12.dp),
                ) {
                    Icon(Icons.Default.BugReport, contentDescription = null)
                    Spacer(Modifier.width(8.dp))
                    Text("View Logs (Debug)")
                }
                Spacer(Modifier.height(16.dp))
            }

            // Menu items
            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                shape = RoundedCornerShape(16.dp),
            ) {
                Column {
                    MenuItem(
                        icon = Icons.Default.List,
                        title = "Commands",
                        subtitle = "View all available commands",
                        onClick = onCommandsClick,
                    )
                    Divider(color = MaterialTheme.colorScheme.outline)
                    MenuItem(
                        icon = Icons.Default.Settings,
                        title = "Settings",
                        subtitle = "Bot configuration",
                        onClick = onSettingsClick,
                    )
                    Divider(color = MaterialTheme.colorScheme.outline)
                    MenuItem(
                        icon = Icons.Default.Info,
                        title = "About",
                        subtitle = "App info",
                        onClick = onAboutClick,
                    )
                }
            }
        }
    }

    // Logs dialog with Copy + Share buttons
    if (showLogs) {
        val clipboardManager = androidx.compose.ui.platform.LocalClipboardManager.current
        val context = androidx.compose.ui.platform.LocalContext.current
        var copied by remember { mutableStateOf(false) }

        AlertDialog(
            onDismissRequest = { showLogs = false },
            title = { Text("Bot Logs (${logsContent.length} chars)") },
            text = {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .verticalScroll(rememberScrollState())
                ) {
                    if (logsLoading) {
                        CircularProgressIndicator(modifier = Modifier.size(24.dp))
                        Spacer(Modifier.height(8.dp))
                    }
                    if (copied) {
                        Text(
                            text = "✅ Logs copied to clipboard!",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.padding(bottom = 8.dp),
                        )
                    }
                    Text(
                        text = logsContent,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                }
            },
            confirmButton = {
                Row {
                    // Copy to clipboard
                    TextButton(
                        onClick = {
                            clipboardManager.setText(androidx.compose.ui.text.AnnotatedString(logsContent))
                            copied = true
                        }
                    ) {
                        Icon(Icons.Default.ContentCopy, contentDescription = null, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(4.dp))
                        Text("Copy")
                    }
                    // Share via other apps (WhatsApp, email, etc.)
                    TextButton(
                        onClick = {
                            val sendIntent = Intent(Intent.ACTION_SEND).apply {
                                type = "text/plain"
                                putExtra(Intent.EXTRA_SUBJECT, "Zbot Debug Logs")
                                putExtra(Intent.EXTRA_TEXT, logsContent)
                            }
                            context.startActivity(Intent.createChooser(sendIntent, "Share logs via..."))
                        }
                    ) {
                        Icon(Icons.Default.Share, contentDescription = null, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(4.dp))
                        Text("Share")
                    }
                    // Close
                    TextButton(onClick = { showLogs = false }) { Text("Close") }
                }
            },
        )
    }
}

@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
private fun MenuItem(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    title: String,
    subtitle: String,
    onClick: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable { onClick() }
            .padding(16.dp)
            .height(48.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
        Spacer(Modifier.width(16.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurface)
            Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Icon(Icons.Default.ChevronRight, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
