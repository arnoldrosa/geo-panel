package bo.geopanel.mobile.service

import android.app.*
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.location.Location
import android.os.*
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import bo.geopanel.mobile.GeoPanelApplication
import bo.geopanel.mobile.R
import bo.geopanel.mobile.data.local.entity.PositionEntity
import bo.geopanel.mobile.data.repository.TelemetryRepository
import com.google.android.gms.location.*
import kotlinx.coroutines.*
import java.time.Instant
import java.util.UUID

class TrackingForegroundService : Service() {

    private val serviceScope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private lateinit var fusedLocationClient: FusedLocationProviderClient
    private lateinit var locationCallback: LocationCallback
    private lateinit var repository: TelemetryRepository
    private var wakeLock: PowerManager.WakeLock? = null

    companion object {
        const val CHANNEL_ID = "geopanel_tracking_channel"
        const val NOTIFICATION_ID = 1001
        const val ACTION_START = "bo.geopanel.mobile.action.START"
        const val ACTION_STOP = "bo.geopanel.mobile.action.STOP"
    }

    override fun onCreate() {
        super.onCreate()
        val app = applicationContext as GeoPanelApplication
        repository = TelemetryRepository(app.database.positionDao())
        fusedLocationClient = LocationServices.getFusedLocationProviderClient(this)
        createNotificationChannel()

        val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "GeoPanel::TrackingWakeLock").apply {
            setReferenceCounted(false)
        }

        locationCallback = object : LocationCallback() {
            override fun onLocationResult(result: LocationResult) {
                result.lastLocation?.let { location ->
                    onNewLocationCaptured(location)
                }
            }
        }

        // Iniciar bucle de sincronización de cola offline cada 20 segundos
        startOfflineQueueSyncWorker()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopTracking()
            return START_NOT_STICKY
        }

        val app = applicationContext as GeoPanelApplication
        app.prefs.edit().putBoolean(GeoPanelApplication.KEY_IS_TRACKING, true).apply()

        val notification = buildNotification(
            getString(R.string.tracking_active),
            "Transmitiendo telemetría vehicular en segundo plano..."
        )

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ServiceCompat.startForeground(this, NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }

        startLocationUpdates()
        return START_STICKY
    }

    private fun startLocationUpdates() {
        val app = applicationContext as GeoPanelApplication
        val intervalSec = app.prefs.getInt(GeoPanelApplication.KEY_INTERVAL_SEC, 10).toLong()
        val intervalMs = (intervalSec.coerceIn(5, 120)) * 1000L

        val request = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, intervalMs)
            .setMinUpdateIntervalMillis(intervalMs / 2)
            .setMinUpdateDistanceMeters(10f)
            .build()

        try {
            fusedLocationClient.requestLocationUpdates(request, locationCallback, Looper.getMainLooper())
        } catch (_: SecurityException) {
            stopTracking()
        }
    }

    private fun onNewLocationCaptured(loc: Location) {
        serviceScope.launch {
            // WakeLock temporal de 15s para garantizar persistencia y transmisión sin drenar batería
            wakeLock?.acquire(15000L)
            try {
                val app = applicationContext as GeoPanelApplication
                val uniqueId = app.prefs.getString(GeoPanelApplication.KEY_UNIQUE_ID, "") ?: ""
                val token = app.prefs.getString(GeoPanelApplication.KEY_DEVICE_TOKEN, "") ?: ""
                val serverUrl = app.prefs.getString(
                    GeoPanelApplication.KEY_SERVER_URL,
                    "https://tusrb5tle2w9helgfmthkpdf.187.127.33.214.sslip.io"
                ) ?: ""

                if (uniqueId.isBlank() || token.isBlank()) return@launch

                val batteryLevel = getBatteryLevel()
                val fixTimeIso = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    Instant.ofEpochMilli(loc.time).toString()
                } else {
                    "${loc.time}"
                }

                val entity = PositionEntity(
                    packetId = UUID.randomUUID().toString(),
                    uniqueId = uniqueId,
                    latitude = loc.latitude,
                    longitude = loc.longitude,
                    speedKmh = loc.speed * 3.6,
                    course = loc.bearing.toDouble(),
                    accuracy = loc.accuracy.toDouble(),
                    batteryLevel = batteryLevel,
                    fixTime = fixTimeIso,
                    isSynced = false
                )

                // 1. Persistencia segura local inmediata en Room SQLite
                val localId = repository.recordLocalPosition(entity)
                val savedEntity = entity.copy(id = localId)

                // 2. Transmisión segura por HTTPS
                repository.transmitPosition(serverUrl, token, savedEntity)
            } finally {
                if (wakeLock?.isHeld == true) {
                    wakeLock?.release()
                }
            }
        }
    }

    private fun startOfflineQueueSyncWorker() {
        serviceScope.launch {
            while (isActive) {
                delay(20000L) // Revisar cada 20 segundos
                val app = applicationContext as GeoPanelApplication
                val token = app.prefs.getString(GeoPanelApplication.KEY_DEVICE_TOKEN, "") ?: ""
                val serverUrl = app.prefs.getString(GeoPanelApplication.KEY_SERVER_URL, "") ?: ""

                if (token.isNotBlank() && serverUrl.isNotBlank()) {
                    repository.drainOfflineQueue(serverUrl, token)
                }
            }
        }
    }

    private fun getBatteryLevel(): Int {
        val batteryStatus: Intent? = registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        val level: Int = batteryStatus?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
        val scale: Int = batteryStatus?.getIntExtra(BatteryManager.EXTRA_SCALE, -1) ?: -1
        return if (level >= 0 && scale > 0) (level * 100) / scale else 100
    }

    private fun stopTracking() {
        val app = applicationContext as GeoPanelApplication
        app.prefs.edit().putBoolean(GeoPanelApplication.KEY_IS_TRACKING, false).apply()
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                getString(R.string.notification_channel_name),
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = getString(R.string.notification_channel_desc)
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
}
