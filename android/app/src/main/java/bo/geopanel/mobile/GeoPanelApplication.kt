package bo.geopanel.mobile

import android.app.Application
import android.content.Context
import android.content.SharedPreferences
import bo.geopanel.mobile.data.local.AppDatabase

class GeoPanelApplication : Application() {

    companion object {
        lateinit var instance: GeoPanelApplication
            private set
        
        const val PREFS_NAME = "geopanel_settings"
        const val KEY_UNIQUE_ID = "unique_id"
        const val KEY_DEVICE_TOKEN = "device_token"
        const val KEY_SERVER_URL = "server_url"
        const val KEY_INTERVAL_SEC = "interval_sec"
        const val KEY_IS_TRACKING = "is_tracking"
        const val KEY_COMPANY_NAME = "company_name"
    }

    val database: AppDatabase by lazy {
        AppDatabase.getDatabase(this)
    }

    val prefs: SharedPreferences by lazy {
        getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    }

    override fun onCreate() {
        super.onCreate()
        instance = this
    }
}
