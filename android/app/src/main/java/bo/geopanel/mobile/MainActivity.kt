package bo.geopanel.mobile

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.material3.windowsizeclass.ExperimentalMaterial3WindowSizeClassApi
import androidx.compose.material3.windowsizeclass.calculateWindowSizeClass
import androidx.compose.ui.graphics.Color
import bo.geopanel.mobile.ui.GeoPanelAdaptiveApp

class MainActivity : ComponentActivity() {

    @OptIn(ExperimentalMaterial3WindowSizeClassApi::class)
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Habilitar diseño Edge-to-Edge para respetar Insets y áreas seguras del sistema
        enableEdgeToEdge()

        setContent {
            val windowSizeClass = calculateWindowSizeClass(this)
            val isDark = isSystemInDarkTheme()

            val colorScheme = if (isDark) {
                darkColorScheme(
                    primary = Color(0xFF10B981), // Emerald 500
                    onPrimary = Color.White,
                    secondary = Color(0xFF0284C7), // Sky 600
                    background = Color(0xFF0F172A), // Slate 900
                    surface = Color(0xFF1E293B), // Slate 800
                    onSurface = Color(0xFFF8FAFC)
                )
            } else {
                lightColorScheme(
                    primary = Color(0xFF059669),
                    onPrimary = Color.White,
                    secondary = Color(0xFF0284C7),
                    background = Color(0xFFF8FAFC),
                    surface = Color.White,
                    onSurface = Color(0xFF0F172A)
                )
            }

            MaterialTheme(colorScheme = colorScheme) {
                GeoPanelAdaptiveApp(windowSizeClass = windowSizeClass)
            }
        }
    }
}
