package bo.geopanel.mobile.ui.screens

import android.os.Build
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import bo.geopanel.mobile.GeoPanelApplication
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun PairingScreen(onPairingSuccess: () -> Unit) {
    val app = GeoPanelApplication.instance
    val defaultUrl = "https://staging-geo.187.127.33.214.sslip.io"
    var serverUrl by remember {
        mutableStateOf(
            app.prefs.getString(
                GeoPanelApplication.KEY_SERVER_URL,
                defaultUrl
            ) ?: defaultUrl
        )
    }
    var pairingCode by remember { mutableStateOf("") }
    var isLoading by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var successMessage by remember { mutableStateOf<String?>(null) }

    val scope = rememberCoroutineScope()
    val scrollState = rememberScrollState()
    val keyboardController = LocalSoftwareKeyboardController.current
    val focusManager = LocalFocusManager.current
    val clipboardManager = LocalClipboardManager.current
    val density = LocalDensity.current

    // BringIntoViewRequesters para mantener visibles los campos de texto durante la apertura del teclado
    val otpRequester = remember { BringIntoViewRequester() }
    val urlRequester = remember { BringIntoViewRequester() }
    val buttonRequester = remember { BringIntoViewRequester() }

    // Rastrear campo enfocado activamente
    var focusedField by remember { mutableStateOf<String?>(null) }

    // Detección reactiva de la altura y visibilidad del teclado mediante WindowInsets.ime
    val imeBottom = WindowInsets.ime.getBottom(density)
    val isImeVisible = imeBottom > 0

    LaunchedEffect(isImeVisible) {
        if (isImeVisible) {
            delay(150)
            when (focusedField) {
                "otp" -> otpRequester.bringIntoView()
                "url" -> urlRequester.bringIntoView()
            }
        }
    }

    Surface(
        modifier = Modifier.fillMaxSize(),
        color = MaterialTheme.colorScheme.background
    ) {
        Scaffold(
            contentWindowInsets = WindowInsets.safeDrawing.only(
                WindowInsetsSides.Horizontal + WindowInsetsSides.Top
            ),
            containerColor = MaterialTheme.colorScheme.background
        ) { innerPadding ->
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(innerPadding)
                    .consumeWindowInsets(innerPadding)
                    .imePadding(),
                contentAlignment = Alignment.Center
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .widthIn(max = 520.dp)
                        .verticalScroll(scrollState)
                        .padding(horizontal = 24.dp, vertical = 16.dp)
                        .navigationBarsPadding(),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(16.dp)
                ) {
                    Text(
                        text = "🛰️ GEO-PANEL Mobile",
                        style = MaterialTheme.typography.headlineMedium,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.primary,
                        textAlign = TextAlign.Center
                    )
                    Text(
                        text = "Vinculación Segura de Dispositivo",
                        style = MaterialTheme.typography.titleMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        textAlign = TextAlign.Center
                    )

                    Spacer(modifier = Modifier.height(8.dp))

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
                                text = "Introduce el código OTP de 6 dígitos generado desde el panel web de GEO-PANEL y confirma la URL del servidor.",
                                style = MaterialTheme.typography.bodyMedium,
                                textAlign = TextAlign.Center,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )

                            // 1. Campo OTP
                            OutlinedTextField(
                                value = pairingCode,
                                onValueChange = {
                                    if (it.length <= 10) pairingCode = it.trim().uppercase()
                                    errorMessage = null
                                },
                                label = { Text("Código de Vinculación (OTP)") },
                                placeholder = { Text("Ej. GP-257778") },
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .bringIntoViewRequester(otpRequester)
                                    .onFocusChanged { state ->
                                        if (state.isFocused) {
                                            focusedField = "otp"
                                            scope.launch {
                                                delay(200)
                                                otpRequester.bringIntoView()
                                            }
                                        }
                                    },
                                shape = RoundedCornerShape(12.dp),
                                singleLine = true,
                                keyboardOptions = KeyboardOptions(
                                    keyboardType = KeyboardType.Ascii,
                                    capitalization = KeyboardCapitalization.Characters,
                                    autoCorrectEnabled = false,
                                    imeAction = ImeAction.Next
                                ),
                                keyboardActions = KeyboardActions(
                                    onNext = {
                                        focusManager.moveFocus(FocusDirection.Down)
                                    }
                                )
                            )

                            // 2. Campo URL del Servidor con teclado Web (Uri), validación HTTPS y limpieza
                            val isHttps = serverUrl.startsWith("https://", ignoreCase = true)
                            val isHttp = serverUrl.startsWith("http://", ignoreCase = true)

                            OutlinedTextField(
                                value = serverUrl,
                                onValueChange = {
                                    serverUrl = it.trim()
                                    errorMessage = null
                                },
                                label = { Text("URL del Servidor GEO-PANEL") },
                                placeholder = { Text("https://staging-geo.187.127.33.214.sslip.io") },
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .bringIntoViewRequester(urlRequester)
                                    .onFocusChanged { state ->
                                        if (state.isFocused) {
                                            focusedField = "url"
                                            scope.launch {
                                                delay(200)
                                                urlRequester.bringIntoView()
                                            }
                                        }
                                    },
                                shape = RoundedCornerShape(12.dp),
                                singleLine = true,
                                keyboardOptions = KeyboardOptions(
                                    keyboardType = KeyboardType.Uri,
                                    capitalization = KeyboardCapitalization.None,
                                    autoCorrectEnabled = false,
                                    imeAction = ImeAction.Done
                                ),
                                keyboardActions = KeyboardActions(
                                    onDone = {
                                        keyboardController?.hide()
                                        focusManager.clearFocus()
                                    }
                                ),
                                leadingIcon = {
                                    Icon(
                                        imageVector = if (isHttps) Icons.Default.Lock else Icons.Default.Warning,
                                        contentDescription = "Protocolo de red",
                                        tint = if (isHttps) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error
                                    )
                                },
                                trailingIcon = {
                                    if (serverUrl.isNotEmpty()) {
                                        IconButton(onClick = { serverUrl = "" }) {
                                            Icon(
                                                imageVector = Icons.Default.Clear,
                                                contentDescription = "Limpiar URL"
                                            )
                                        }
                                    }
                                },
                                supportingText = {
                                    when {
                                        serverUrl.isBlank() -> {
                                            Text(
                                                "⚠️ Ingresa la URL o IP del servidor GEO-PANEL",
                                                color = MaterialTheme.colorScheme.error,
                                                fontSize = 11.sp
                                            )
                                        }
                                        isHttps -> {
                                            Text(
                                                "🔒 Conexión cifrada TLS/HTTPS validada",
                                                color = MaterialTheme.colorScheme.primary,
                                                fontSize = 11.sp
                                            )
                                        }
                                        isHttp -> {
                                            Text(
                                                "⚠️ Advertencia: HTTP sin cifrado. Se recomienda HTTPS.",
                                                color = MaterialTheme.colorScheme.error,
                                                fontSize = 11.sp
                                            )
                                        }
                                        else -> {
                                            Text(
                                                "ℹ️ Se antepondrá automáticamente https://$serverUrl",
                                                color = MaterialTheme.colorScheme.outline,
                                                fontSize = 11.sp
                                            )
                                        }
                                    }
                                }
                            )

                            // Atajos rápidos para agilizar edición en pantalla táctil
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.spacedBy(8.dp)
                            ) {
                                FilterChip(
                                    selected = serverUrl.contains("staging-geo"),
                                    onClick = {
                                        serverUrl = "https://staging-geo.187.127.33.214.sslip.io"
                                    },
                                    label = { Text("Staging (SSL)", fontSize = 12.sp) }
                                )

                                FilterChip(
                                    selected = false,
                                    onClick = {
                                        val clipboardText = clipboardManager.getText()?.text
                                        if (!clipboardText.isNullOrBlank()) {
                                            serverUrl = clipboardText.trim()
                                        }
                                    },
                                    label = { Text("📋 Pegar", fontSize = 12.sp) }
                                )
                            }

                            // Mensajes de error visibles con soporte de scroll
                            errorMessage?.let {
                                Card(
                                    colors = CardDefaults.cardColors(
                                        containerColor = MaterialTheme.colorScheme.errorContainer
                                    ),
                                    shape = RoundedCornerShape(10.dp)
                                ) {
                                    Row(
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .padding(12.dp),
                                        verticalAlignment = Alignment.CenterVertically
                                    ) {
                                        Icon(
                                            imageVector = Icons.Default.Warning,
                                            contentDescription = "Error",
                                            tint = MaterialTheme.colorScheme.error
                                        )
                                        Spacer(modifier = Modifier.width(8.dp))
                                        Text(
                                            text = it,
                                            color = MaterialTheme.colorScheme.onErrorContainer,
                                            style = MaterialTheme.typography.bodySmall
                                        )
                                    }
                                }
                            }

                            successMessage?.let {
                                Text(
                                    text = "✅ $it",
                                    color = MaterialTheme.colorScheme.primary,
                                    style = MaterialTheme.typography.bodySmall,
                                    fontWeight = FontWeight.Bold
                                )
                            }

                            // Botón de vinculación alcanzable mediante desplazamiento vertical
                            Button(
                                onClick = {
                                    keyboardController?.hide()
                                    focusManager.clearFocus()

                                    if (pairingCode.isBlank()) {
                                        errorMessage = "Ingresa el código de vinculación OTP"
                                        return@Button
                                    }
                                    if (serverUrl.isBlank()) {
                                        errorMessage = "Ingresa la URL del servidor GEO-PANEL"
                                        return@Button
                                    }

                                    val normalizedUrl = normalizeUrl(serverUrl)
                                    isLoading = true
                                    errorMessage = null
                                    scope.launch {
                                        buttonRequester.bringIntoView()
                                        val result = performPairing(normalizedUrl, pairingCode)
                                        isLoading = false
                                        if (result.isSuccess) {
                                            val data = result.getOrThrow()
                                            app.prefs.edit()
                                                .putString(GeoPanelApplication.KEY_SERVER_URL, normalizedUrl)
                                                .putString(GeoPanelApplication.KEY_UNIQUE_ID, data.uniqueId)
                                                .putString(GeoPanelApplication.KEY_DEVICE_TOKEN, data.deviceToken)
                                                .putString(GeoPanelApplication.KEY_COMPANY_NAME, data.companyName)
                                                .apply()

                                            successMessage = "Dispositivo vinculado con éxito a ${data.companyName}"
                                            delay(1000)
                                            onPairingSuccess()
                                        } else {
                                            errorMessage = result.exceptionOrNull()?.message ?: "Error de vinculación"
                                        }
                                    }
                                },
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .height(52.dp)
                                    .bringIntoViewRequester(buttonRequester),
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
        }
    }
}

data class PairResult(
    val uniqueId: String,
    val deviceToken: String,
    val companyName: String
)

private fun normalizeUrl(raw: String): String {
    val trimmed = raw.trim().trimEnd('/')
    return when {
        trimmed.startsWith("http://", ignoreCase = true) || trimmed.startsWith("https://", ignoreCase = true) -> trimmed
        else -> "https://$trimmed"
    }
}

private suspend fun performPairing(serverUrl: String, code: String): Result<PairResult> = withContext(Dispatchers.IO) {
    try {
        val client = OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(10, TimeUnit.SECONDS)
            .build()

        val normalizedUrl = normalizeUrl(serverUrl)
        val endpoint = "$normalizedUrl/api/v1/devices/pair"
        val payload = JSONObject().apply {
            put("code", code)
            put("deviceModel", "${Build.MANUFACTURER} ${Build.MODEL}")
            put("appVersion", "1.0.1")
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
                "Fallo de seguridad SSL/TLS: El certificado del servidor es inválido. Se requiere HTTPS válido en Traefik/Coolify."
            e is java.net.ConnectException ->
                "No se pudo conectar al servidor: ${e.message}"
            else ->
                "Fallo de conexión: ${e.message}"
        }
        Result.failure(Exception(detailedMsg))
    }
}
