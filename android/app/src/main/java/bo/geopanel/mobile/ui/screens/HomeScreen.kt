package bo.geopanel.mobile.ui.screens

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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
fun HomeScreen(isCompact: Boolean) {
    var isTracking by remember { mutableStateOf(false) }
    var speed by remember { mutableFloatStateOf(0.0f) }
    var batteryLevel by remember { mutableIntStateOf(92) }
    var accuracy by remember { mutableFloatStateOf(3.5f) }
    var packetsSent by remember { mutableIntStateOf(142) }
    var packetsPending by remember { mutableIntStateOf(0) }
    var hasUpdate by remember { mutableStateOf(false) }

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
                    text = if (isTracking) "🟢 Transmitiendo coordenadas" else "⚪ Rastreador en pausa",
                    style = MaterialTheme.typography.bodyMedium,
                    color = if (isTracking) MaterialTheme.colorScheme.primary else Color.Gray
                )
            }

            // Indicador de batería y precisión
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier
                    .background(
                        MaterialTheme.colorScheme.surfaceVariant,
                        RoundedCornerShape(12.dp)
                    )
                    .padding(horizontal = 10.dp, vertical = 6.dp)
            ) {
                Icon(
                    imageVector = Icons.Default.Favorite,
                    contentDescription = "Batería",
                    tint = if (batteryLevel > 20) Color(0xFF10B981) else Color(0xFFEF4444),
                    modifier = Modifier.size(16.dp)
                )
                Text(
                    text = "$batteryLevel%",
                    style = MaterialTheme.typography.labelMedium,
                    fontWeight = FontWeight.Bold
                )
            }
        }

        // Banner informativo de actualización voluntaria (Requisito 3)
        if (hasUpdate) {
            Card(
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer),
                shape = RoundedCornerShape(16.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                Row(
                    modifier = Modifier.padding(14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = "🚀 Nueva versión disponible (v1.1.0)",
                            style = MaterialTheme.typography.titleSmall,
                            fontWeight = FontWeight.Bold
                        )
                        Text(
                            text = "Mejoras de rendimiento y optimización de batería en segundo plano.",
                            style = MaterialTheme.typography.bodySmall
                        )
                    }
                    Button(
                        onClick = { /* Descargar actualización voluntaria */ },
                        shape = RoundedCornerShape(8.dp)
                    ) {
                        Text("Actualizar")
                    }
                }
            }
        }

        // Panel de velocímetro y estado principal
        Card(
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(20.dp),
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                Text(
                    text = "${speed.toInt()}",
                    fontSize = if (isCompact) 64.sp else 80.sp,
                    fontWeight = FontWeight.ExtraBold,
                    color = MaterialTheme.colorScheme.primary
                )
                Text(
                    text = "KM / HORA",
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )

                HorizontalDivider(modifier = Modifier.padding(vertical = 8.dp))

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceAround
                ) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(text = "Precisión GPS", style = MaterialTheme.typography.bodySmall)
                        Text(text = "±${accuracy}m", fontWeight = FontWeight.Bold)
                    }
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(text = "Paquetes Enviados", style = MaterialTheme.typography.bodySmall)
                        Text(text = "$packetsSent", fontWeight = FontWeight.Bold)
                    }
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(text = "Cola Offline", style = MaterialTheme.typography.bodySmall)
                        Text(
                            text = "$packetsPending",
                            fontWeight = FontWeight.Bold,
                            color = if (packetsPending > 0) Color(0xFFF59E0B) else MaterialTheme.colorScheme.onSurface
                        )
                    }
                }
            }
        }

        // Botón principal de Inicio / Detención de Transmisión (Mínimo 48dp táctil accesible)
        Button(
            onClick = { isTracking = !isTracking },
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
