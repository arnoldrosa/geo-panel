package bo.geopanel.mobile.data.repository

import bo.geopanel.mobile.data.local.dao.PositionDao
import bo.geopanel.mobile.data.local.entity.PositionEntity
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

class TelemetryRepository(private val dao: PositionDao) {

    private val client = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(10, TimeUnit.SECONDS)
        .build()

    private val jsonMediaType = "application/json; charset=utf-8".toMediaType()

    /**
     * Guarda una nueva coordenada capturada en la base de datos Room local
     */
    suspend fun recordLocalPosition(position: PositionEntity): Long = withContext(Dispatchers.IO) {
        dao.insertPosition(position)
    }

    /**
     * Transmite una posición al servidor GEO-PANEL.
     * Si el servidor responde HTTP 200 OK, elimina la posición de la cola SQLite.
     * Si no hay conexión o el servidor responde 5xx, se conserva para sincronización diferida.
     */
    suspend fun transmitPosition(
        serverUrl: String,
        token: String,
        pos: PositionEntity
    ): Boolean = withContext(Dispatchers.IO) {
        val endpoint = serverUrl.trimEnd('/') + "/api/v1/telemetry/report"

        val json = JSONObject().apply {
            put("uniqueId", pos.uniqueId)
            put("latitude", pos.latitude)
            put("longitude", pos.longitude)
            put("speedKmh", pos.speedKmh)
            put("course", pos.course)
            put("accuracy", pos.accuracy)
            put("batteryLevel", pos.batteryLevel)
            put("packetId", pos.packetId)
            put("fixTime", pos.fixTime)
        }

        val request = Request.Builder()
            .url(endpoint)
            .addHeader("X-Device-Token", token)
            .post(json.toString().toRequestBody(jsonMediaType))
            .build()

        try {
            client.newCall(request).execute().use { response ->
                if (response.isSuccessful) {
                    // Confirmación real del servidor: eliminamos de la cola persistente
                    dao.deletePosition(pos.id)
                    return@withContext true
                }
            }
        } catch (_: Exception) {
            // Error de red / sin señal: se preserva en SQLite
        }
        false
    }

    /**
     * Vacía la cola offline enviando paquetes acumulados en orden cronológico
     */
    suspend fun drainOfflineQueue(serverUrl: String, token: String): Int = withContext(Dispatchers.IO) {
        val pending = dao.getPendingPositions(limit = 30)
        var syncedCount = 0

        for (item in pending) {
            val success = transmitPosition(serverUrl, token, item)
            if (success) {
                syncedCount++
            } else {
                // Si falla un envío por corte de red, detenemos el drenaje temporalmente
                break
            }
        }
        syncedCount
    }

    fun getPendingCountFlow() = dao.getPendingCountFlow()
    fun getRecentPositionsFlow() = dao.getRecentPositionsFlow()
}
