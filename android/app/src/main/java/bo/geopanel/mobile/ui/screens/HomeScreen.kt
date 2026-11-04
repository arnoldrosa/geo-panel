package bo.geopanel.mobile.ui.screens

import android.content.Intent
import android.os.Build
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import bo.geopanel.mobile.GeoPanelApplication
import bo.geopanel.mobile.service.TrackingForegroundService

@Composable
fun HomeScreen(isCompact: Boolean) {
    val context = LocalContext.current
    val app = context.applicationContext as GeoPanelApplication

    var isTracking by remember {
        mutableStateOf(app.prefs.getBoolean(GeoPanelApplication.KEY_IS_TRACKING, false))
    }
    val uniqueId = remember {
        app.prefs.getString(GeoPanelApplication.KEY_UNIQUE_ID, "No configurado") ?: "No configurado"
    }

    val pendingCount by app.database.positionDao().getPendingCountFlow().collectAsState(initial = 0)

    val scrollState = rememberScrollState()

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp)
            .verticalScroll(scrollState),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        // Cabecera de estado
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column {
                Text(
                    text = "GEO-PANEL Mobile",
                    style = MaterialTheme.typography.headlineSmall,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onSurface
                )
                Text(
                    text = if (isTracking) "🟢 Transmitiendo coordenadas ($uniqueId)" else "⚪ Rastreador en pausa ($uniqueId)",
                    style = MaterialTheme.typography.bodyMedium,
                    color = if (isTracking) MaterialTheme.colorScheme.primary else Color.Gray
                )
            }
        }

        // Velocímetro digital con tarjeta de estado
        Card(
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(24.dp),
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center
            ) {
                Text(
                    text = "VELOCIDAD GPS",
                    style = MaterialTheme.typography.labelMedium,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Spacer(Modifier.height(8.dp))
                Row(verticalAlignment = Alignment.Bottom) {
                    Text(
                        text = if (isTracking) "0.0" else "--",
                        fontSize = if (isCompact) 48.sp else 64.sp,
                        fontWeight = FontWeight.Black,
                        color = MaterialTheme.colorScheme.primary
                    )
                    Spacer(Modifier.width(8.dp))
                    Text(
                        text = "km/h",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(bottom = 8.dp)
                    )
                }

                HorizontalDivider(modifier = Modifier.padding(vertical = 16.dp))

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceAround
                ) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(text = "Modo GPS", style = MaterialTheme.typography.bodySmall)
                        Text(text = "Alta Fidelidad", fontWeight = FontWeight.Bold)
                    }
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(text = "Cola Offline Room", style = MaterialTheme.typography.bodySmall)
                        Text(
                            text = "$pendingCount pendientes",
                            fontWeight = FontWeight.Bold,
                            color = if (pendingCount > 0) Color(0xFFF59E0B) else MaterialTheme.colorScheme.primary
                        )
                    }
                }
            }
        }

        // Botón principal de Inicio / Detención de Transmisión (Mínimo 56dp táctil accesible)
        Button(
            onClick = {
                if (isTracking) {
                    val stopIntent = Intent(context, TrackingForegroundService::class.java).apply {
                        action = TrackingForegroundService.ACTION_STOP
                    }
                    context.startService(stopIntent)
                    isTracking = false
                } else {
                    val startIntent = Intent(context, TrackingForegroundService::class.java).apply {
                        action = TrackingForegroundService.ACTION_START
                    }
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        context.startForegroundService(startIntent)
                    } else {
                        context.startService(startIntent)
                    }
                    isTracking = true
                }
            },
            modifier = Modifier
                .fillMaxWidth()
                .height(56.dp),
            shape = RoundedCornerShape(16.dp),
            colors = ButtonDefaults.buttonColors(
                containerColor = if (isTracking) Color(0xFFEF4444) else MaterialTheme.colorScheme.primary
            )
        ) {
            Icon(
                imageVector = if (isTracking) Icons.Default.Close else Icons.Default.PlayArrow,
                contentDescription = null,
                modifier = Modifier.size(24.dp)
            )
            Spacer(Modifier.width(8.dp))
            Text(
                text = if (isTracking) "DETENER TRANSMISIÓN GPS" else "INICIAR MONITOREO GPS",
                fontSize = 16.sp,
                fontWeight = FontWeight.Bold
            )
        }
    }
}
