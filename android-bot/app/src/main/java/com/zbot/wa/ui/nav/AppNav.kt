package com.zbot.wa.ui.nav

import androidx.compose.runtime.Composable
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.zbot.wa.ui.screens.AboutScreen
import com.zbot.wa.ui.screens.CommandsScreen
import com.zbot.wa.ui.screens.PairScreen
import com.zbot.wa.ui.screens.SettingsScreen
import com.zbot.wa.ui.screens.SplashScreen
import com.zbot.wa.ui.screens.StatusScreen
import com.zbot.wa.ui.screens.admin.AdminLoginScreen
import com.zbot.wa.ui.screens.admin.AdminDashboard
import com.zbot.wa.ui.screens.admin.BroadcastScreen
import com.zbot.wa.ui.screens.admin.CommandHistoryScreen
import com.zbot.wa.ui.screens.admin.NumbersScreen
import com.zbot.wa.ui.screens.admin.ReportScammerScreen
import com.zbot.wa.ui.screens.admin.ScammerListScreen

object Routes {
    const val SPLASH = "splash"
    const val PAIR = "pair"
    const val STATUS = "status"
    const val SETTINGS = "settings"
    const val COMMANDS = "commands"
    const val ABOUT = "about"

    // Admin (hidden — accessible only via 7-tap + PIN)
    const val ADMIN_LOGIN = "admin_login"
    const val ADMIN_DASH = "admin_dash"
    const val ADMIN_NUMBERS = "admin_numbers"
    const val ADMIN_BROADCAST = "admin_broadcast"
    const val ADMIN_REPORT = "admin_report"
    const val ADMIN_SCAMMERS = "admin_scammers"
    const val ADMIN_HISTORY = "admin_history"
}

@Composable
fun AppNav() {
    val nav = rememberNavController()
    NavHost(navController = nav, startDestination = Routes.SPLASH) {
        composable(Routes.SPLASH) { SplashScreen(onContinue = { nav.navigate(Routes.STATUS) }) }
        composable(Routes.STATUS) {
            StatusScreen(
                onPairClick = { nav.navigate(Routes.PAIR) },
                onSettingsClick = { nav.navigate(Routes.SETTINGS) },
                onCommandsClick = { nav.navigate(Routes.COMMANDS) },
                onAboutClick = { nav.navigate(Routes.ABOUT) },
            )
        }
        composable(Routes.PAIR) { PairScreen(onBack = { nav.popBackStack() }) }
        composable(Routes.SETTINGS) { SettingsScreen(onBack = { nav.popBackStack() }) }
        composable(Routes.COMMANDS) { CommandsScreen(onBack = { nav.popBackStack() }) }
        composable(Routes.ABOUT) {
            AboutScreen(
                onBack = { nav.popBackStack() },
                onAdminUnlock = { nav.navigate(Routes.ADMIN_LOGIN) },
            )
        }

        // Admin routes
        composable(Routes.ADMIN_LOGIN) {
            AdminLoginScreen(
                onSuccess = { nav.navigate(Routes.ADMIN_DASH) { popUpTo(Routes.STATUS) } },
                onBack = { nav.popBackStack() },
            )
        }
        composable(Routes.ADMIN_DASH) {
            AdminDashboard(
                onNumbers = { nav.navigate(Routes.ADMIN_NUMBERS) },
                onBroadcast = { nav.navigate(Routes.ADMIN_BROADCAST) },
                onReport = { nav.navigate(Routes.ADMIN_REPORT) },
                onScammers = { nav.navigate(Routes.ADMIN_SCAMMERS) },
                onHistory = { nav.navigate(Routes.ADMIN_HISTORY) },
                onLogout = { nav.popBackStackTo(Routes.STATUS) },
            )
        }
        composable(Routes.ADMIN_NUMBERS) { NumbersScreen(onBack = { nav.popBackStack() }) }
        composable(Routes.ADMIN_BROADCAST) { BroadcastScreen(onBack = { nav.popBackStack() }) }
        composable(Routes.ADMIN_REPORT) { ReportScammerScreen(onBack = { nav.popBackStack() }) }
        composable(Routes.ADMIN_SCAMMERS) { ScammerListScreen(onBack = { nav.popBackStack() }) }
        composable(Routes.ADMIN_HISTORY) { CommandHistoryScreen(onBack = { nav.popBackStack() }) }
    }
}

private fun androidx.navigation.NavController.popBackStackTo(route: String) {
    popBackStack(route, inclusive = false)
}
