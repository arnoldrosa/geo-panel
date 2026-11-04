package bo.geopanel.mobile.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import bo.geopanel.mobile.GeoPanelApplication

@Composable
fun SettingsScreen(isCompact: Boolean) {
    val context = LocalContext.current
    val app = context.applicationContext as GeoPanelApplication

    var serverUrl by remember {
        mutableStateOf(app.prefs.getString(GeoPanelApplication.KEY_SERVER_URL, "") ?: "")
    }
    var uniqueId by remember {
        mutableStateOf(app.prefs.getString(GeoPanelApplication.KEY_UNIQUE_ID, "") ?: "")
    }
    val deviceToken = remember {
        app.prefs.getString(GeoPanelApplication.KEY_DEVICE_TOKEN, "") ?: ""
    }
    val companyName = remember {
        app.prefs.getString(GeoPanelApplication.KEY_COMPANY_NAME, "GEO-PANEL Flota") ?: "GEO-PANEL Flota"
    }

    var intervalSec by remember {
        mutableFloatStateOf(app.prefs.getInt(GeoPanelApplication.KEY_INTERVAL_SEC, 10).toFloat())
    }

    var saveToast by remember { mutableStateOf<String?>(null) }
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

        // Tarjeta de vinculación activa con GEO-PANEL
        Card(
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(16.dp),
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)
        ) {
            Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(
                    text = "🔑 Credencial de Vinculación Activa",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold
                )

                Text(
                    text = "Empresa asignada: $companyName",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.primary
                )

                OutlinedTextField(
                    value = uniqueId,
                    onValueChange = { uniqueId = it },
                    label = { Text("Identificador de Vehículo / Conductor") },
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp)
                )

                OutlinedTextField(
                    value = if (deviceToken.length > 8) "${deviceToken.take(8)}..." else deviceToken,
                    onValueChange = {},
                    label = { Text("Token Criptográfico Revocable (X-Device-Token)") },
                    enabled = false,
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

        // Frecuencia y calibración de sensores
        Card(
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(16.dp),
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)
        ) {
            Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(
                    text = "⏱️ Frecuencia de Telemetría",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold
                )

                Text(
                    text = "Intervalo de reporte GPS: ${intervalSec.toInt()} segundos",
                    style = MaterialTheme.typography.bodyMedium
                )
                Slider(
                    value = intervalSec,
                    onValueChange = { intervalSec = it },
                    valueRange = 5f..60f,
                    steps = 10
                )
                Text(
                    text = "Valores más cortos mejoran la precisión en curvas; valores mayores optimizan la batería.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }

        saveToast?.let {
            Text(text = it, color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.bodySmall)
        }

        Button(
            onClick = {
                app.prefs.edit()
                    .putString(GeoPanelApplication.KEY_SERVER_URL, serverUrl.trim())
                    .putString(GeoPanelApplication.KEY_UNIQUE_ID, uniqueId.trim())
                    .putInt(GeoPanelApplication.KEY_INTERVAL_SEC, intervalSec.toInt())
                    .apply()
                saveToast = "✅ Ajustes guardados correctamente"
            },
            modifier = Modifier.fillMaxWidth().height(50.dp),
            shape = RoundedCornerShape(12.dp)
        ) {
            Text("Guardar Cambios", fontWeight = FontWeight.Bold)
        }

        OutlinedButton(
            onClick = {
                app.prefs.edit().remove(GeoPanelApplication.KEY_DEVICE_TOKEN).apply()
                saveToast = "Credencial eliminada. Reinicia para volver a vincular."
            },
            colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error),
            modifier = Modifier.fillMaxWidth().height(48.dp),
            shape = RoundedCornerShape(12.dp)
        ) {
            Text("Desvincular Dispositivo de este Celular", fontWeight = FontWeight.SemiBold)
        }
    }
}
