package bo.geopanel.mobile.ui.screens

import android.os.Build
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import bo.geopanel.mobile.GeoPanelApplication
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

@Composable
fun PairingScreen(onPairingSuccess: () -> Unit) {
    val app = GeoPanelApplication.instance
    var serverUrl by remember {
        mutableStateOf(
            app.prefs.getString(
                GeoPanelApplication.KEY_SERVER_URL,
                "https://tusrb5tle2w9helgfmthkpdf.187.127.33.214.sslip.io"
            ) ?: ""
        )
    }
    var pairingCode by remember { mutableStateOf("") }
    var isLoading by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var successMessage by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    val scrollState = rememberScrollState()

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp)
            .verticalScroll(scrollState),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Text(
            text = "🛰️ GEO-PANEL Mobile",
            style = MaterialTheme.typography.headlineMedium,
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.primary
        )
        Text(
            text = "Vinculación Segura de Dispositivo",
            style = MaterialTheme.typography.titleMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )

        Spacer(modifier = Modifier.height(24.dp))

        Card(
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(20.dp),
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)
        ) {
            Column(
                modifier = Modifier.padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                Text(
                    text = "Introduce el código de vinculación temporal de 6 dígitos generado desde el panel web de GEO-PANEL.",
                    style = MaterialTheme.typography.bodyMedium,
                    textAlign = TextAlign.Center,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )

                OutlinedTextField(
                    value = pairingCode,
                    onValueChange = { if (it.length <= 10) pairingCode = it.trim().uppercase() },
                    label = { Text("Código de Vinculación (OTP)") },
                    placeholder = { Text("Ej. GP-948123") },
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp),
                    singleLine = true
                )

                OutlinedTextField(
                    value = serverUrl,
                    onValueChange = { serverUrl = it.trim() },
                    label = { Text("URL del Servidor GEO-PANEL") },
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp),
                    singleLine = true
                )

                errorMessage?.let {
                    Text(
                        text = "❌ $it",
                        color = MaterialTheme.colorScheme.error,
                        style = MaterialTheme.typography.bodySmall
                    )
                }

                successMessage?.let {
                    Text(
                        text = "✅ $it",
                        color = MaterialTheme.colorScheme.primary,
                        style = MaterialTheme.typography.bodySmall
                    )
                }

                Button(
                    onClick = {
                        if (pairingCode.isBlank()) {
                            errorMessage = "Ingresa el código de vinculación"
                            return@Button
                        }
                        isLoading = true
                        errorMessage = null
                        scope.launch {
                            val result = performPairing(serverUrl, pairingCode)
                            isLoading = false
                            if (result.isSuccess) {
                                val data = result.getOrThrow()
                                app.prefs.edit()
                                    .putString(GeoPanelApplication.KEY_SERVER_URL, serverUrl)
                                    .putString(GeoPanelApplication.KEY_UNIQUE_ID, data.uniqueId)
                                    .putString(GeoPanelApplication.KEY_DEVICE_TOKEN, data.deviceToken)
                                    .putString(GeoPanelApplication.KEY_COMPANY_NAME, data.companyName)
                                    .apply()

                                successMessage = "Dispositivo vinculado con éxito a ${data.companyName}"
                                kotlinx.coroutines.delay(1000)
                                onPairingSuccess()
                            } else {
                                errorMessage = result.exceptionOrNull()?.message ?: "Error de vinculación"
                            }
                        }
                    },
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(52.dp),
                    shape = RoundedCornerShape(14.dp),
                    enabled = !isLoading
                ) {
                    if (isLoading) {
                        CircularProgressIndicator(modifier = Modifier.size(24.dp), color = MaterialTheme.colorScheme.onPrimary)
                    } else {
                        Text("Vincular con Servidor", fontWeight = FontWeight.Bold)
                    }
                }
            }
        }
    }
}

data class PairResult(
    val uniqueId: String,
    val deviceToken: String,
    val companyName: String
)

private suspend fun performPairing(serverUrl: String, code: String): Result<PairResult> = withContext(Dispatchers.IO) {
    try {
        val client = OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(10, TimeUnit.SECONDS)
            .build()

        val normalizedUrl = when {
            serverUrl.startsWith("http://", ignoreCase = true) || serverUrl.startsWith("https://", ignoreCase = true) -> serverUrl.trimEnd('/')
            else -> "https://" + serverUrl.trimEnd('/')
        }

        val endpoint = "$normalizedUrl/api/v1/devices/pair"
        val payload = JSONObject().apply {
            put("code", code)
            put("deviceModel", "${Build.MANUFACTURER} ${Build.MODEL}")
            put("appVersion", "1.0.0")
        }

        val request = Request.Builder()
            .url(endpoint)
            .post(payload.toString().toRequestBody("application/json".toMediaType()))
            .build()

        client.newCall(request).execute().use { response ->
            val body = response.body?.string() ?: ""
            if (response.isSuccessful) {
                val json = JSONObject(body)
                val uniqueId = json.getString("uniqueId")
                val deviceToken = json.getString("deviceToken")
                val companyName = json.optString("companyName", "GEO-PANEL Flota")
                Result.success(PairResult(uniqueId, deviceToken, companyName))
            } else {
                val errorMsg = try {
                    JSONObject(body).optString("error", "Código no válido o expirado (${response.code})")
                } catch (_: Exception) {
                    "Error HTTP ${response.code}"
                }
                Result.failure(Exception(errorMsg))
            }
        }
    } catch (e: Exception) {
        val detailedMsg = when {
            e is javax.net.ssl.SSLHandshakeException || e.cause is java.security.cert.CertPathValidatorException ->
                "Fallo de seguridad SSL/TLS: El certificado del servidor es autofirmado o inválido (CertPathValidatorException). Se requiere HTTPS válido en Traefik/Coolify."
            e is java.net.ConnectException ->
                "No se pudo conectar al servidor: ${e.message}"
            else ->
                "Fallo de conexión: ${e.message}"
        }
        Result.failure(Exception(detailedMsg))
    }
}
