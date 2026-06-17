package com.zbot.wa.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable

private val DarkColorScheme = darkColorScheme(
    primary = ZbotPrimary,
    onPrimary = ZbotOnPrimary,
    background = ZbotBackground,
    onBackground = ZbotOnSurface,
    surface = ZbotSurface,
    onSurface = ZbotOnSurface,
    surfaceVariant = ZbotSurfaceVariant,
    onSurfaceVariant = ZbotOnSurfaceVariant,
    error = ZbotError,
    onError = ZbotOnPrimary,
    outline = ZbotOutline,
)

private val LightColorScheme = lightColorScheme(
    primary = ZbotPrimaryDark,
    onPrimary = ZbotOnPrimary,
    background = ZbotBackground,
    onBackground = ZbotOnSurface,
    surface = ZbotSurface,
    onSurface = ZbotOnSurface,
)

@Composable
fun ZbotTheme(
    darkTheme: Boolean = true,  // Always dark — that's the design
    content: @Composable () -> Unit,
) {
    val colors = if (darkTheme) DarkColorScheme else LightColorScheme
    MaterialTheme(
        colorScheme = colors,
        typography = Typography,
        content = content,
    )
}
