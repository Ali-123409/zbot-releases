package com.zbot.wa.ui.screens.admin

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Report
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.zbot.wa.data.BotRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import javax.inject.Inject

@HiltViewModel
class ReportScammerViewModel @Inject constructor(
    val repository: BotRepository,
) : ViewModel() {

    fun report(
        scammerPhone: String, reason: String,
        onSuccess: (String) -> Unit, onError: (String) -> Unit,
    ) {
        viewModelScope.launch {
            try {
                val cmdId = withContext(Dispatchers.IO) {
                    repository.createReport(scammerPhone, reason)
                }
                onSuccess(cmdId)
            } catch (e: Exception) {
                onError(e.message ?: "Failed to create report")
            }
        }
    }
}

private val REASONS = listOf("fraud", "impersonation", "spam", "other")

@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
fun ReportScammerScreen(
    onBack: () -> Unit,
    viewModel: ReportScammerViewModel = hiltViewModel(),
) {
    var phone by remember { mutableStateOf("") }
    var reason by remember { mutableStateOf(REASONS[0]) }
    var expanded by remember { mutableStateOf(false) }
    var loading by remember { mutableStateOf(false) }
    var result by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Report Scammer") },
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
                .padding(16.dp),
        ) {
            Text(
                "Report a scammer from ALL your bot numbers",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(16.dp))

            OutlinedTextField(
                value = phone,
                onValueChange = { phone = it.filter { c -> c.isDigit() || c == '+' } },
                label = { Text("Scammer phone number") },
                placeholder = { Text("923009998887") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(12.dp),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
            )
            Spacer(Modifier.height(12.dp))

            Box {
                OutlinedButton(
                    onClick = { expanded = true },
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp),
                ) {
                    Text("Reason: $reason")
                }
                DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
                    REASONS.forEach { r ->
                        DropdownMenuItem(
                            text = { Text(r) },
                            onClick = { reason = r; expanded = false },
                        )
                    }
                }
            }

            Spacer(Modifier.height(24.dp))

            Card(
                colors = CardDefaults.cardColors(
                    containerColor = MaterialTheme.colorScheme.surface
                ),
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(12.dp),
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Text("What will happen:", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                    Spacer(Modifier.height(8.dp))
                    Text("• Each of your numbers will report the scammer to WhatsApp")
                    Text("• Each number will block the scammer")
                    Text("• Scammer added to your watchlist DB")
                    Text("• Random 30-90s delay between reports (anti-pattern)")
                    Text("• 1 report per scammer per number (ever)")
                }
            }

            Spacer(Modifier.height(16.dp))

            Button(
                onClick = {
                    if (phone.length < 10) {
                        error = "Enter valid scammer phone"
                        return@Button
                    }
                    loading = true
                    error = null
                    result = null
                    viewModel.report(phone, reason,
                        onSuccess = { cmdId ->
                            loading = false
                            result = "Report dispatched! Command ID: $cmdId"
                            phone = ""
                        },
                        onError = { msg ->
                            loading = false
                            error = msg
                        },
                    )
                },
                enabled = !loading,
                modifier = Modifier.fillMaxWidth().height(56.dp),
                shape = RoundedCornerShape(12.dp),
                colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error),
            ) {
                if (loading) {
                    CircularProgressIndicator(
                        color = MaterialTheme.colorScheme.onPrimary,
                        modifier = Modifier.size(24.dp),
                        strokeWidth = 2.dp,
                    )
                } else {
                    Icon(Icons.Default.Report, contentDescription = null)
                    Spacer(Modifier.width(8.dp))
                    Text("Report via All Numbers")
                }
            }

            result?.let {
                Spacer(Modifier.height(16.dp))
                Card(
                    colors = CardDefaults.cardColors(
                        containerColor = MaterialTheme.colorScheme.primary.copy(alpha = 0.1f)
                    ),
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp),
                ) {
                    Text(it, modifier = Modifier.padding(16.dp), color = MaterialTheme.colorScheme.primary)
                }
            }
            error?.let {
                Spacer(Modifier.height(16.dp))
                Card(
                    colors = CardDefaults.cardColors(
                        containerColor = MaterialTheme.colorScheme.error.copy(alpha = 0.1f)
                    ),
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp),
                ) {
                    Text(it, modifier = Modifier.padding(16.dp), color = MaterialTheme.colorScheme.error)
                }
            }
        }
    }
}
