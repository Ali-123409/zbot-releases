package com.zbot.wa.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject

@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(onBack: () -> Unit) {
    var config by remember { mutableStateOf<JSONObject?>(null) }
    var loading by remember { mutableStateOf(true) }
    val scope = rememberCoroutineScope()

    // Load config
    LaunchedEffect(Unit) {
        try {
            val client = OkHttpClient()
            val req = Request.Builder().url("http://localhost:3001/get-config").build()
            val resp = withContext(Dispatchers.IO) { client.newCall(req).execute() }
            if (resp.isSuccessful) {
                config = JSONObject(resp.body!!.string())
            }
        } catch (e: Exception) {
            // ignore
        } finally {
            loading = false
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Settings") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "Back")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.background
                ),
            )
        }
    ) { padding ->
        if (loading) {
            Box(Modifier.fillMaxSize().padding(padding), contentAlignment = androidx.compose.ui.Alignment.Center) {
                CircularProgressIndicator()
            }
        } else {
            val cfg = config
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding)
                    .padding(16.dp),
            ) {
                if (cfg == null) {
                    Text("Could not load config. Bot not running?")
                } else {
                    ToggleRow(cfg, "Anti-Delete", "antiDelete", scope)
                    ToggleRow(cfg, "Anti-Edit", "antiEdit", scope)
                    ToggleRow(cfg, "Auto Status Seen", "autoStatusSeen", scope)
                    ToggleRow(cfg, "Anti-View-Once", "antiViewOnce", scope)
                    ToggleRow(cfg, "Anti-Call", "antiCall", scope)
                    ToggleRow(cfg, "Always Online", "alwaysOnline", scope)
                    ToggleRow(cfg, "Auto-Reacts", "autoReacts", scope)
                    ToggleRow(cfg, "Auto-Reply", "autoReply", scope)
                }
            }
        }
    }
}

@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
private fun ToggleRow(
    cfg: JSONObject,
    label: String,
    key: String,
    scope: kotlinx.coroutines.CoroutineScope,
) {
    var checked by remember { mutableStateOf(cfg.optBoolean(key, false)) }
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 8.dp),
        verticalAlignment = androidx.compose.ui.Alignment.CenterVertically,
    ) {
        Text(
            label,
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurface,
            modifier = Modifier.weight(1f),
        )
        Switch(
            checked = checked,
            onCheckedChange = { newValue ->
                checked = newValue
                cfg.put(key, newValue)
                scope.launch {
                    withContext(Dispatchers.IO) {
                        val payload = JSONObject().apply { put(key, newValue) }
                        val body = payload.toString()
                            .toRequestBody("application/json".toMediaType())
                        val client = OkHttpClient()
                        val req = Request.Builder()
                            .url("http://localhost:3001/set-config")
                            .post(body)
                            .build()
                        client.newCall(req).execute()
                    }
                }
            },
        )
    }
    HorizontalDivider(color = MaterialTheme.colorScheme.outline)
}
