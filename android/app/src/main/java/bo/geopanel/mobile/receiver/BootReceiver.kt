package bo.geopanel.mobile.receiver

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import bo.geopanel.mobile.GeoPanelApplication
import bo.geopanel.mobile.service.TrackingForegroundService

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED) {
            val app = context.applicationContext as GeoPanelApplication
            val wasTracking = app.prefs.getBoolean(GeoPanelApplication.KEY_IS_TRACKING, false)
            val hasToken = !app.prefs.getString(GeoPanelApplication.KEY_DEVICE_TOKEN, "").isNullOrBlank()

            if (wasTracking && hasToken) {
                val serviceIntent = Intent(context, TrackingForegroundService::class.java)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(serviceIntent)
                } else {
                    context.startService(serviceIntent)
                }
            }
        }
    }
}
