package com.zbot.wa.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request

@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
fun PairScreen(onBack: () -> Unit) {
    var phone by remember { mutableStateOf("") }
    var pairCode by remember { mutableStateOf<String?>(null) }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Pair WhatsApp") },
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
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(
                "Enter your phone number",
                style = MaterialTheme.typography.headlineMedium,
                color = MaterialTheme.colorScheme.onBackground,
                fontWeight = FontWeight.SemiBold,
            )
            Spacer(Modifier.height(8.dp))
            Text(
                "We'll generate a pairing code. Open WhatsApp on your phone, go to Settings → Linked Devices → Link with phone number, and enter the code.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(32.dp))

            OutlinedTextField(
                value = phone,
                onValueChange = { phone = it.filter { c -> c.isDigit() || c == '+' } },
                label = { Text("Phone Number") },
                placeholder = { Text("923001234567") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(12.dp),
                keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(
                    keyboardType = KeyboardType.Phone
                ),
            )

            Spacer(Modifier.height(16.dp))

            Button(
                onClick = {
                    if (phone.length < 10) {
                        error = "Enter a valid phone number (10-15 digits)"
                        return@Button
                    }
                    loading = true
                    error = null
                    pairCode = null
                    scope.launch {
                        try {
                            val cleaned = phone.replace(Regex("[^0-9]"), "")
                            val client = OkHttpClient()
                            // v2.1.6 FIX (L20): use 127.0.0.1 explicitly (was localhost — IPv6 risk)
                            val req = Request.Builder()
                                .url("http://127.0.0.1:3001/pair?phone=$cleaned")
                                .build()
                            val resp = withContext(Dispatchers.IO) { client.newCall(req).execute() }
                            val body = resp.body!!.string()
                            val json = org.json.JSONObject(body)
                            if (resp.isSuccessful) {
                                val code = json.optString("code")
                                // v2.1.6 FIX (C7): parenthesize if-expr to fix string concat precedence
                                if (code == "Already connected") {
                                    val connPhone = json.optString("phone", "")
                                    error = "Bot is already connected" +
                                        (if (connPhone.isNotEmpty()) " as +$connPhone" else "") +
                                        ". Use Disconnect first to pair a different number."
                                } else {
                                    pairCode = code
                                }
                            } else {
                                val err = json.optString("error", "Failed to get pairing code")
                                // v2.1.6: friendlier message for "pairing in progress"
                                error = if (err.contains("already in progress", ignoreCase = true)) {
                                    "A pairing attempt is already in progress. Please wait 30 seconds for it to expire, or enter the previous code in WhatsApp."
                                } else {
                                    err
                                }
                            }
                        } catch (e: Exception) {
                            error = e.message ?: "Network error"
                        } finally {
                            loading = false
                        }
                    }
                },
                enabled = !loading && phone.isNotEmpty(),
                modifier = Modifier
                    .fillMaxWidth()
                    .height(56.dp),
                shape = RoundedCornerShape(12.dp),
            ) {
                if (loading) {
                    CircularProgressIndicator(
                        color = MaterialTheme.colorScheme.onPrimary,
                        modifier = Modifier.size(24.dp),
                        strokeWidth = 2.dp,
                    )
                } else {
                    Text("Get Pairing Code")
                }
            }

            error?.let {
                Spacer(Modifier.height(16.dp))
                Card(
                    colors = CardDefaults.cardColors(
                        containerColor = MaterialTheme.colorScheme.error.copy(alpha = 0.1f)
                    ),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(
                        it,
                        modifier = Modifier.padding(16.dp),
                        color = MaterialTheme.colorScheme.error,
                    )
                }
            }

            pairCode?.let { code ->
                Spacer(Modifier.height(32.dp))
                Card(
                    colors = CardDefaults.cardColors(
                        containerColor = MaterialTheme.colorScheme.surface
                    ),
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(16.dp),
                ) {
                    Column(
                        modifier = Modifier.padding(24.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Text(
                            "Your Pairing Code",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Spacer(Modifier.height(12.dp))
                        Text(
                            code,
                            style = MaterialTheme.typography.displayLarge,
                            color = MaterialTheme.colorScheme.primary,
                            fontWeight = FontWeight.Bold,
                        )
                        Spacer(Modifier.height(16.dp))
                        Text(
                            "Open WhatsApp → Settings → Linked Devices → Link with phone number → Enter this code",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(horizontal = 8.dp),
                        )
                    }
                }
            }
        }
    }
}
