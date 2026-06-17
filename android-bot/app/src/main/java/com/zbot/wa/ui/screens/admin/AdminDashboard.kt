package com.zbot.wa.ui.screens.admin

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.zbot.wa.data.AuthManager
import com.zbot.wa.data.BotRepository
import com.zbot.wa.data.NumberRecord
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import javax.inject.Inject

@HiltViewModel
class AdminDashboardViewModel @Inject constructor(
    val repository: BotRepository,
    val authManager: AuthManager,
) : ViewModel() {

    private val _stats = MutableStateFlow(DashboardStats())
    val stats = _stats.asStateFlow()

    fun loadStats() {
        viewModelScope.launch {
            try {
                val numbers = withContext(Dispatchers.IO) { repository.listNumbers() }
                val scammers = withContext(Dispatchers.IO) { repository.listScammers() }
                val commands = withContext(Dispatchers.IO) { repository.listRecentCommands(20) }
                _stats.value = DashboardStats(
                    totalNumbers = numbers.size,
                    onlineNumbers = numbers.count { it.status == "online" },
                    pendingApproval = numbers.count { !it.approved },
                    totalScammers = scammers.size,
                    activeScammers = scammers.count { it.status == "active" },
                    totalCommands = commands.size,
                    pendingCommands = commands.count { it.status == "pending" },
                )
            } catch (e: Exception) {
                // ignore — stats will show 0s
            }
        }
    }

    fun logout() {
        authManager.logout()
    }
}

data class DashboardStats(
    val totalNumbers: Int = 0,
    val onlineNumbers: Int = 0,
    val pendingApproval: Int = 0,
    val totalScammers: Int = 0,
    val activeScammers: Int = 0,
    val totalCommands: Int = 0,
    val pendingCommands: Int = 0,
)

@Composable
fun AdminDashboard(
    onNumbers: () -> Unit,
    onBroadcast: () -> Unit,
    onReport: () -> Unit,
    onScammers: () -> Unit,
    onHistory: () -> Unit,
    onLogout: () -> Unit,
    viewModel: AdminDashboardViewModel = hiltViewModel(),
) {
    LaunchedEffect(Unit) { viewModel.loadStats() }
    val stats by viewModel.stats.collectAsState()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Admin Dashboard", fontWeight = FontWeight.Bold) },
                actions = {
                    IconButton(onClick = {
                        viewModel.logout()
                        onLogout()
                    }) {
                        Icon(Icons.AutoMirrored.Filled.Logout, contentDescription = "Logout")
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
                .padding(16.dp)
        ) {
            // Stats grid
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                StatCard(
                    title = "Numbers",
                    value = stats.totalNumbers.toString(),
                    subtitle = "${stats.onlineNumbers} online",
                    modifier = Modifier.weight(1f),
                )
                StatCard(
                    title = "Pending",
                    value = stats.pendingApproval.toString(),
                    subtitle = "awaiting approval",
                    modifier = Modifier.weight(1f),
                )
            }
            Spacer(Modifier.height(8.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                StatCard(
                    title = "Scammers",
                    value = stats.totalScammers.toString(),
                    subtitle = "${stats.activeScammers} active",
                    modifier = Modifier.weight(1f),
                )
                StatCard(
                    title = "Commands",
                    value = stats.totalCommands.toString(),
                    subtitle = "${stats.pendingCommands} pending",
                    modifier = Modifier.weight(1f),
                )
            }

            Spacer(Modifier.height(24.dp))

            // Action cards
            ActionCard(
                icon = Icons.Default.PhoneAndroid,
                title = "Numbers",
                subtitle = "Approve / revoke connected phones",
                onClick = onNumbers,
            )
            ActionCard(
                icon = Icons.Default.Send,
                title = "Broadcast",
                subtitle = "Send message from all numbers",
                onClick = onBroadcast,
            )
            ActionCard(
                icon = Icons.Default.Report,
                title = "Report Scammer",
                subtitle = "Report a scammer from all numbers",
                onClick = onReport,
            )
            ActionCard(
                icon = Icons.Default.Block,
                title = "Scammer Database",
                subtitle = "View / clear reported scammers",
                onClick = onScammers,
            )
            ActionCard(
                icon = Icons.Default.History,
                title = "Command History",
                subtitle = "View past commands + results",
                onClick = onHistory,
            )
        }
    }
}

@Composable
private fun StatCard(title: String, value: String, subtitle: String, modifier: Modifier = Modifier) {
    Card(
        modifier = modifier,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        shape = RoundedCornerShape(16.dp),
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(title, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(
                value,
                style = MaterialTheme.typography.headlineMedium,
                color = MaterialTheme.colorScheme.onBackground,
                fontWeight = FontWeight.Bold,
            )
            Text(subtitle, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun ActionCard(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    title: String,
    subtitle: String,
    onClick: () -> Unit,
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        shape = RoundedCornerShape(16.dp),
        onClick = onClick,
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(icon, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(32.dp))
            Spacer(Modifier.width(16.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(title, style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onSurface)
                Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Icon(Icons.Default.ChevronRight, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
