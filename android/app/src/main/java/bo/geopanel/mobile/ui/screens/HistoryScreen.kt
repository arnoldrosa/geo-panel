package bo.geopanel.mobile.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

data class TelemetryPacketItem(
    val id: String,
    val time: String,
    val speed: String,
    val coordinates: String,
    val isDelivered: Boolean
)

@Composable
fun HistoryScreen(isCompact: Boolean) {
    val samplePackets = listOf(
        TelemetryPacketItem("PKT-104", "13:24:10", "42 km/h", "-17.7833, -63.1821", true),
        TelemetryPacketItem("PKT-103", "13:24:00", "45 km/h", "-17.7820, -63.1810", true),
        TelemetryPacketItem("PKT-102", "13:23:50", "38 km/h", "-17.7805, -63.1798", true),
        TelemetryPacketItem("PKT-101", "13:23:40", "0 km/h (Detenido)", "-17.7790, -63.1785", true)
    )

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Text(
            text = "Historial de Transmisiones",
            style = MaterialTheme.typography.titleLarge,
            fontWeight = FontWeight.Bold
        )

        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            items(samplePackets) { packet ->
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(14.dp),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(14.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column {
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                Icon(
                                    imageVector = Icons.Default.CheckCircle,
                                    contentDescription = null,
                                    tint = Color(0xFF10B981),
                                    modifier = Modifier.size(16.dp)
                                )
                                Text(text = packet.id, fontWeight = FontWeight.Bold)
                            }
                            Spacer(Modifier.height(4.dp))
                            Text(text = packet.coordinates, style = MaterialTheme.typography.bodySmall, color = Color.Gray)
                        }

                        Column(horizontalAlignment = Alignment.End) {
                            Text(text = packet.time, fontWeight = FontWeight.SemiBold)
                            Text(text = packet.speed, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary)
                        }
                    }
                }
            }
        }
    }
}
