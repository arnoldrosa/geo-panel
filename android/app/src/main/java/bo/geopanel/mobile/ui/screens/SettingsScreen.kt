package bo.geopanel.mobile.ui.screens

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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

@Composable
fun SettingsScreen(isCompact: Boolean) {
    var serverUrl by remember { mutableStateOf("https://tusrb5tle2w9helgfmthkpdf.187.127.33.214.sslip.io") }
    var deviceToken by remember { mutableStateOf("tok-demo-scz-01") }
    var uniqueId by remember { mutableStateOf("DEMO-SCZ-01") }
    var intervalSec by remember { mutableFloatStateOf(10f) }
    var distanceMeters by remember { mutableFloatStateOf(25f) }
    var isCheckingUpdates by remember { mutableStateOf(false) }
    var updateStatusText by remember { mutableStateOf("Versión instalada: v1.0.0 (Build 1)") }

    val scrollState = rememberScrollState()

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp)
            .verticalScroll(scrollState),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        Text(
            text = "Configuración del Dispositivo",
            style = MaterialTheme.typography.titleLarge,
            fontWeight = FontWeight.Bold
        )

        // Tarjeta de vinculación con GEO-PANEL
        Card(
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(16.dp),
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
        ) {
            Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(
                    text = "🔑 Credenciales de Transmisión",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold
                )

                OutlinedTextField(
                    value = uniqueId,
                    onValueChange = { uniqueId = it },
                    label = { Text("Identificador Único (IMEI / Placa / ID)") },
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp)
                )

                OutlinedTextField(
                    value = deviceToken,
                    onValueChange = { deviceToken = it },
                    label = { Text("Token Secreto del Dispositivo (X-Device-Token)") },
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp)
                )

                OutlinedTextField(
                    value = serverUrl,
                    onValueChange = { serverUrl = it },
                    label = { Text("URL del Servidor GEO-PANEL") },
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp)
                )
            }
        }

        // Frecuencia y sensores
        Card(
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(16.dp),
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
        ) {
            Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(
                    text = "⏱️ Frecuencia de Rastreo",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold
                )

                Text(text = "Intervalo de tiempo: ${intervalSec.toInt()} segundos")
                Slider(
                    value = intervalSec,
                    onValueChange = { intervalSec = it },
                    valueRange = 5f..60f,
                    steps = 10
                )

                Text(text = "Filtro de desplazamiento: ${distanceMeters.toInt()} metros")
                Slider(
                    value = distanceMeters,
                    onValueChange = { distanceMeters = it },
                    valueRange = 5f..100f,
                    steps = 18
                )
            }
        }

        // Comprobación de actualizaciones (Requisito 3)
        Card(
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(16.dp),
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
        ) {
            Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(
                    text = "📦 Actualizaciones del Sistema",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold
                )

                Text(text = updateStatusText, style = MaterialTheme.typography.bodySmall)

                OutlinedButton(
                    onClick = {
                        isCheckingUpdates = true
                        updateStatusText = "Consultando servidor GEO-PANEL..."
                        // Consulta a /api/v1/mobile/updates/check
                    },
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp)
                ) {
                    Icon(Icons.Default.Refresh, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(8.dp))
                    Text("Buscar Actualizaciones")
                }
            }
        }
    }
}
