package bo.geopanel.mobile.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.material3.windowsizeclass.WindowSizeClass
import androidx.compose.material3.windowsizeclass.WindowWidthSizeClass
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import bo.geopanel.mobile.ui.screens.HistoryScreen
import bo.geopanel.mobile.ui.screens.HomeScreen
import bo.geopanel.mobile.ui.screens.SettingsScreen

enum class Screen(val title: String, val icon: ImageVector) {
    HOME("Monitoreo", Icons.Default.LocationOn),
    HISTORY("Historial", Icons.Default.DateRange),
    SETTINGS("Ajustes", Icons.Default.Settings)
}

/**
 * Componente Adaptable Multidispositivo (Material 3 Adaptive)
 * Selecciona automáticamente entre distribución compacta para móviles
 * y distribución amplia con NavigationRail / Dos Paneles para tablets y pantallas plegables.
 */
@Composable
fun GeoPanelAdaptiveApp(windowSizeClass: WindowSizeClass) {
    var currentScreen by remember { mutableStateOf(Screen.HOME) }
    val isExpanded = windowSizeClass.widthSizeClass == WindowWidthSizeClass.Expanded
    val isMedium = windowSizeClass.widthSizeClass == WindowWidthSizeClass.Medium

    Surface(
        modifier = Modifier.fillMaxSize(),
        color = MaterialTheme.colorScheme.background
    ) {
        if (isExpanded || isMedium) {
            // =========================================================
            // DISTRIBUCIÓN TABLET / FOLDABLE / PANTALLA GRANDE (Requisito 1)
            // =========================================================
            Row(
                modifier = Modifier
                    .fillMaxSize()
                    .safeDrawingPadding()
            ) {
                // Barra de navegación lateral fija (NavigationRail)
                NavigationRail(
                    modifier = Modifier.width(88.dp),
                    containerColor = MaterialTheme.colorScheme.surface
                ) {
                    Spacer(Modifier.height(16.dp))
                    Text(
                        text = "GEO",
                        style = MaterialTheme.typography.titleMedium,
                        color = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.padding(bottom = 24.dp)
                    )

                    Screen.entries.forEach { screen ->
                        NavigationRailItem(
                            selected = currentScreen == screen,
                            onClick = { currentScreen = screen },
                            icon = { Icon(screen.icon, contentDescription = screen.title) },
                            label = { Text(screen.title) }
                        )
                    }
                }

                VerticalDivider(color = MaterialTheme.colorScheme.outlineVariant)

                // Área principal de contenido en dos paneles para Tablet
                Box(modifier = Modifier.weight(1f).fillMaxHeight()) {
                    if (isExpanded && currentScreen == Screen.HOME) {
                        // Modo Dos Paneles para Monitoreo en Tablet
                        Row(modifier = Modifier.fillMaxSize().padding(16.dp)) {
                            // Panel Izquierdo: Tarjetas de Telemetría, Batería y Control
                            Box(modifier = Modifier.weight(0.45f).fillMaxHeight()) {
                                HomeScreen(isCompact = false)
                            }
                            Spacer(Modifier.width(16.dp))
                            // Panel Derecho: Visualización de Mapa Ampliado e Historial en Tiempo Real
                            Box(modifier = Modifier.weight(0.55f).fillMaxHeight()) {
                                HistoryScreen(isCompact = false)
                            }
                        }
                    } else {
                        // Vista individual para pantallas medianas o pestañas de configuración
                        when (currentScreen) {
                            Screen.HOME -> HomeScreen(isCompact = false)
                            Screen.HISTORY -> HistoryScreen(isCompact = false)
                            Screen.SETTINGS -> SettingsScreen(isCompact = false)
                        }
                    }
                }
            }
        } else {
            // =========================================================
            // DISTRIBUCIÓN COMPACTA PARA CELULARES (Android Mobile)
            // =========================================================
            Scaffold(
                modifier = Modifier.safeDrawingPadding(),
                bottomBar = {
                    NavigationBar(
                        containerColor = MaterialTheme.colorScheme.surface,
                        tonalElevation = 4.dp
                    ) {
                        Screen.entries.forEach { screen ->
                            NavigationBarItem(
                                selected = currentScreen == screen,
                                onClick = { currentScreen = screen },
                                icon = { Icon(screen.icon, contentDescription = screen.title) },
                                label = { Text(screen.title) }
                            )
                        }
                    }
                }
            ) { paddingValues ->
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(paddingValues)
                ) {
                    when (currentScreen) {
                        Screen.HOME -> HomeScreen(isCompact = true)
                        Screen.HISTORY -> HistoryScreen(isCompact = true)
                        Screen.SETTINGS -> SettingsScreen(isCompact = true)
                    }
                }
            }
        }
    }
}
