package com.zbot.wa.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Bolt
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.zbot.wa.BuildConfig
import com.zbot.wa.data.AdminPrefs
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class AboutViewModel @Inject constructor(
    val adminPrefs: AdminPrefs,
) : ViewModel() {

    fun handleVersionTap(onUnlock: () -> Unit) {
        val now = System.currentTimeMillis()
        val lastTap = adminPrefs.getLastTapTimestamp()
        var count = adminPrefs.getTapCount()

        // Reset count if last tap was >5s ago
        if (now - lastTap > 5000) {
            count = 0
        }

        count++
        adminPrefs.setTapCount(count)
        adminPrefs.setLastTapTimestamp(now)

        if (count >= 7) {
            adminPrefs.resetTapCount()
            onUnlock()
        }
    }
}

@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
fun AboutScreen(
    onBack: () -> Unit,
    onAdminUnlock: () -> Unit,
    viewModel: AboutViewModel = hiltViewModel(),
) {
    var showPinDialog by remember { mutableStateOf(false) }
    var pinInput by remember { mutableStateOf("") }
    var pinError by remember { mutableStateOf<String?>(null) }
    var pinAttempts by remember { mutableStateOf(0) }
    var lockoutUntil by remember { mutableStateOf(0L) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("About") },
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
            Spacer(Modifier.height(32.dp))

            // App icon
            Surface(
                shape = RoundedCornerShape(24.dp),
                color = MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(96.dp),
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(
                        Icons.Default.Bolt,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.onPrimary,
                        modifier = Modifier.size(56.dp),
                    )
                }
            }

            Spacer(Modifier.height(16.dp))
            Text(
                "Zbot",
                style = MaterialTheme.typography.headlineMedium,
                color = MaterialTheme.colorScheme.onBackground,
                fontWeight = FontWeight.Bold,
            )
            // 7-tap unlock target
            val interactionSource = remember { MutableInteractionSource() }
            Text(
                "Version ${BuildConfig.VERSION_NAME}",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.clickable(
                    interactionSource = interactionSource,
                    indication = null,
                ) {
                    val now = System.currentTimeMillis()
                    if (now < lockoutUntil) {
                        val remaining = (lockoutUntil - now) / 1000
                        pinError = "Locked. Wait ${remaining}s"
                        return@clickable
                    }
                    viewModel.handleVersionTap {
                        showPinDialog = true
                        pinInput = ""
                        pinError = null
                    }
                },
            )
            Spacer(Modifier.height(8.dp))
            Text(
                "Private multi-device WhatsApp bot",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            Spacer(Modifier.height(48.dp))

            // Info card
            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                shape = RoundedCornerShape(16.dp),
            ) {
                Column(modifier = Modifier.padding(20.dp)) {
                    InfoRow("App Version", BuildConfig.VERSION_NAME)
                    InfoRow("Build", BuildConfig.VERSION_CODE.toString())
                    InfoRow("Min Android", "8.0 (Oreo)")
                    InfoRow("Bot Runtime", "Node.js (libnode.so)")
                    InfoRow("Encryption", "AES-256-GCM")
                    InfoRow("Backend", "Firebase (Firestore + RTDB)")
                }
            }
        }
    }

    // PIN dialog
    if (showPinDialog) {
        AlertDialog(
            onDismissRequest = {
                showPinDialog = false
                pinInput = ""
                pinError = null
            },
            title = { Text("Admin Access") },
            text = {
                Column {
                    Text(
                        "Enter admin PIN",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Spacer(Modifier.height(12.dp))
                    OutlinedTextField(
                        value = pinInput,
                        onValueChange = { pinInput = it.filter { c -> c.isDigit() }.take(4) },
                        label = { Text("PIN") },
                        singleLine = true,
                        visualTransformation = PasswordVisualTransformation(),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                        modifier = Modifier.fillMaxWidth(),
                    )
                    pinError?.let {
                        Spacer(Modifier.height(8.dp))
                        Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                    }
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        if (pinInput == BuildConfig.ADMIN_PANEL_PIN) {
                            showPinDialog = false
                            pinInput = ""
                            pinError = null
                            pinAttempts = 0
                            onAdminUnlock()
                        } else {
                            pinAttempts++
                            val remaining = 3 - pinAttempts
                            if (remaining > 0) {
                                pinError = "Wrong PIN. $remaining attempts left."
                            } else {
                                pinError = "Too many attempts. Locked for 30 seconds."
                                lockoutUntil = System.currentTimeMillis() + 30_000
                                pinAttempts = 0
                                viewModel.viewModelScope.launch {
                                    delay(2000)
                                    showPinDialog = false
                                    pinInput = ""
                                }
                            }
                        }
                    },
                ) { Text("Unlock") }
            },
            dismissButton = {
                TextButton(onClick = {
                    showPinDialog = false
                    pinInput = ""
                    pinError = null
                }) { Text("Cancel") }
            },
        )
    }
}

@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
private fun InfoRow(label: String, value: String) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 6.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(
            label,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(
            value,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurface,
            fontWeight = FontWeight.Medium,
        )
    }
}
