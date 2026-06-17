package com.zbot.wa.ui.screens.admin

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.zbot.wa.data.BotRepository
import com.zbot.wa.data.ScammerRecord
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import javax.inject.Inject

@HiltViewModel
class ScammerListViewModel @Inject constructor(
    val repository: BotRepository,
) : ViewModel() {
    private val _scammers = MutableStateFlow<List<ScammerRecord>>(emptyList())
    val scammers = _scammers.asStateFlow()
    private val _loading = MutableStateFlow(true)
    val loading = _loading.asStateFlow()

    fun load() {
        viewModelScope.launch {
            _loading.value = true
            try {
                _scammers.value = withContext(Dispatchers.IO) { repository.listScammers() }
            } catch (e: Exception) { /* ignore */ }
            finally { _loading.value = false }
        }
    }

    fun clear(phone: String) {
        viewModelScope.launch {
            try {
                withContext(Dispatchers.IO) { repository.clearScammer(phone) }
                load()
            } catch (e: Exception) { /* ignore */ }
        }
    }
}

@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
fun ScammerListScreen(
    onBack: () -> Unit,
    viewModel: ScammerListViewModel = hiltViewModel(),
) {
    LaunchedEffect(Unit) { viewModel.load() }
    val scammers by viewModel.scammers.collectAsState()
    val loading by viewModel.loading.collectAsState()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Scammers (${scammers.size})") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "Back")
                    }
                },
                actions = {
                    IconButton(onClick = { viewModel.load() }) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "Refresh")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.background
                ),
            )
        }
    ) { padding ->
        when {
            loading -> Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }
            scammers.isEmpty() -> Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                Text("No scammers reported yet", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            else -> LazyColumn(
                modifier = Modifier.fillMaxSize().padding(padding).padding(horizontal = 16.dp),
                contentPadding = PaddingValues(vertical = 16.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                items(scammers) { scammer -> ScammerCard(scammer, viewModel) }
            }
        }
    }
}

@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
private fun ScammerCard(scammer: ScammerRecord, viewModel: ScammerListViewModel) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        shape = RoundedCornerShape(12.dp),
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    scammer.phone,
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.onSurface,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.weight(1f),
                )
                if (scammer.status == "active") {
                    AssistChip(
                        onClick = {},
                        label = { Text("ACTIVE", style = MaterialTheme.typography.labelSmall) },
                        colors = AssistChipDefaults.assistChipColors(
                            containerColor = MaterialTheme.colorScheme.error.copy(alpha = 0.2f),
                            labelColor = MaterialTheme.colorScheme.error,
                        ),
                    )
                } else {
                    AssistChip(
                        onClick = {},
                        label = { Text("CLEARED", style = MaterialTheme.typography.labelSmall) },
                    )
                }
            }
            Spacer(Modifier.height(4.dp))
            Text("Reason: ${scammer.reason}  •  Reports: ${scammer.totalReports}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (scammer.notes.isNotBlank()) {
                Text("Notes: ${scammer.notes}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (scammer.status == "active") {
                Spacer(Modifier.height(8.dp))
                OutlinedButton(
                    onClick = { viewModel.clear(scammer.phone) },
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("Mark as cleared (false positive)") }
            }
        }
    }
}
