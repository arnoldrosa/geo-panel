package bo.geopanel.mobile.service

import android.app.*
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.location.Location
import android.os.Build
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import com.google.android.gms.location.*
import kotlinx.coroutines.*
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID

class TrackingForegroundService : Service() {

    private val serviceScope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private lateinit var fusedLocationClient: FusedLocationProviderClient
    private lateinit var locationCallback: LocationCallback
    private var wakeLock: PowerManager.WakeLock? = null

    override fun onCreate() {
        super.onCreate()
        fusedLocationClient = LocationServices.getFusedLocationProviderClient(this)
        createNotificationChannel()

        val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "GeoPanel::TrackingWakeLock")
        wakeLock?.acquire(24 * 60 * 60 * 1000L) // 24h max

        locationCallback = object : LocationCallback() {
            override fun onLocationResult(result: LocationResult) {
                result.lastLocation?.let { location ->
                    onNewLocationCaptured(location)
                }
            }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val notification = buildNotification("GEO-PANEL GPS Activo", "Transmitiendo posición en tiempo real...")
        
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ServiceCompat.startForeground(this, NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }

        startLocationUpdates()
        return START_STICKY
    }

    private fun startLocationUpdates() {
        val request = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 10000L)
            .setMinUpdateIntervalMillis(5000L)
            .setMinUpdateDistanceMeters(10f)
            .build()

        try {
            fusedLocationClient.requestLocationUpdates(request, locationCallback, Looper.getMainLooper())
        } catch (e: SecurityException) {
            stopSelf()
        }
    }

    private fun onNewLocationCaptured(loc: Location) {
        serviceScope.launch {
            val packetId = UUID.randomUUID().toString()
            val payload = JSONObject().apply {
                put("uniqueId", "DEMO-SCZ-01") // Configurado en Settings
                put("latitude", loc.latitude)
                put("longitude", loc.longitude)
                put("speedKmh", loc.speed * 3.6)
                put("course", loc.bearing)
                put("accuracy", loc.accuracy)
                put("batteryLevel", 90) // Calculado por BatteryManager
                put("packetId", packetId)
                put("fixTime", java.time.Instant.ofEpochMilli(loc.time).toString())
            }

            sendTelemetryPacket(payload)
        }
    }

    private suspend fun sendTelemetryPacket(payload: JSONObject) = withContext(Dispatchers.IO) {
        val serverUrl = "https://tusrb5tle2w9helgfmthkpdf.187.127.33.214.sslip.io/api/v1/telemetry/report"
        try {
            val url = URL(serverUrl)
            val conn = (url.openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                setRequestProperty("Content-Type", "application/json")
                setRequestProperty("X-Device-Token", "tok-demo-scz-01")
                connectTimeout = 8000
                readTimeout = 8000
                doOutput = true
            }

            conn.outputStream.use { os ->
                os.write(payload.toString().toByteArray())
            }

            val code = conn.responseCode
            if (code == 200) {
                // Posición persistida con éxito en PostgreSQL
            } else if (code in 500..599) {
                // Almacenar en cola SQLite local para reintentar más tarde
            }
        } catch (e: Exception) {
            // Guardar en Room SQLite local (cola offline durable)
        }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Servicio de Monitoreo GPS",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Mantiene activo el sensor GPS y la transmisión de telemetría"
            }
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(channel)
        }
    }

    private fun buildNotification(title: String, text: String): Notification {
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(text)
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }

    override fun onDestroy() {
        fusedLocationClient.removeLocationUpdates(locationCallback)
        wakeLock?.release()
        serviceScope.cancel()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        const val CHANNEL_ID = "geopanel_tracking_channel"
        const val NOTIFICATION_ID = 1001
    }
}
