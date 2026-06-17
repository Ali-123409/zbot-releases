package com.zbot.wa.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.zbot.wa.BuildConfig

data class CommandItem(
    val name: String,
    val aliases: String,
    val description: String,
    val category: String,
)

val COMMANDS = listOf(
    CommandItem("menu", "help, commands, list", "Show all available commands", "general"),
    CommandItem("ping", "-", "Check bot latency", "general"),
    CommandItem("alive", "-", "Show bot status", "general"),
    CommandItem("getjid", "channeljid, jid", "Get the current chat's JID", "general"),
    CommandItem("vv", "ok", "Reveal view-once media silently", "utility"),
    CommandItem("sticker", "s, stiker", "Convert image/video to sticker", "media"),
    CommandItem("tovoice", "toogg, ptt", "Convert replied audio to voice note", "media"),
    CommandItem("dp", "getdp, pp, pfp", "Download profile picture of a user", "media"),
    CommandItem("save", "statussave, dl", "Save a status message", "media"),
    CommandItem("tiktok", "tt, ttdl", "Download TikTok video", "downloader"),
    CommandItem("instagram", "ig, insta, reel", "Download Instagram post/reel", "downloader"),
    CommandItem("facebook", "fb, fbdl", "Download Facebook video", "downloader"),
    CommandItem("youtube", "yt, ytdl, play, song, yts", "Download YouTube video/audio", "downloader"),
    CommandItem("simdata", "sim, carrier, cnic, owner", "Look up SIM registration data (PK)", "lookup"),
    CommandItem("truecaller", "tc, callerid, whois", "Look up caller ID info", "lookup"),
    CommandItem("antidelete", "antidel", "Toggle restore of deleted messages", "privacy"),
    CommandItem("antiedit", "-", "Toggle restore of edited messages", "privacy"),
    CommandItem("autoseen", "autostatus, statusview", "Toggle auto-view of statuses", "privacy"),
    CommandItem("autostatusreact", "statusreact, asr", "Toggle auto-react to statuses", "privacy"),
    CommandItem("anticall", "-", "Toggle auto-reject of incoming calls", "privacy"),
    CommandItem("alwaysonline", "online", "Toggle always-online presence", "privacy"),
    CommandItem("mode", "public, private", "Toggle public/private mode", "privacy"),
    CommandItem("autoreact", "autoreacts", "Toggle auto-react to all messages", "privacy"),
    CommandItem("autoreply", "ar", "Keyword-based auto-reply (add/list/del)", "privacy"),
    CommandItem("block", "unblock", "Block/unblock a user", "admin"),
    CommandItem("setpp", "setpfp, setdp", "Set bot's profile picture", "admin"),
    CommandItem("kickall", "removeall", "Kick everyone from group", "admin"),
    CommandItem("antitagall", "antitag", "Toggle anti-tag-all", "admin"),
    CommandItem("antilink", "-", "Toggle anti-link", "admin"),
    CommandItem("welcome", "setwelcome", "Set welcome message (per group)", "admin"),
    CommandItem("goodbye", "setgoodbye, bye", "Set goodbye message (per group)", "admin"),
)

@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
fun CommandsScreen(onBack: () -> Unit) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Commands") },
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
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(horizontal = 16.dp),
            contentPadding = PaddingValues(vertical = 16.dp),
        ) {
            items(COMMANDS) { cmd ->
                Card(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 4.dp),
                    colors = CardDefaults.cardColors(
                        containerColor = MaterialTheme.colorScheme.surface
                    ),
                    shape = RoundedCornerShape(12.dp),
                ) {
                    Column(modifier = Modifier.padding(16.dp)) {
                        Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                            Text(
                                ".${cmd.name}",
                                style = MaterialTheme.typography.titleMedium,
                                color = MaterialTheme.colorScheme.primary,
                                fontWeight = FontWeight.SemiBold,
                            )
                            Spacer(Modifier.width(8.dp))
                            AssistChip(
                                onClick = {},
                                label = { Text(cmd.category, style = MaterialTheme.typography.labelSmall) },
                            )
                        }
                        if (cmd.aliases != "-") {
                            Text(
                                "Aliases: ${cmd.aliases}",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        Text(
                            cmd.description,
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurface,
                        )
                    }
                }
            }
        }
    }
}
