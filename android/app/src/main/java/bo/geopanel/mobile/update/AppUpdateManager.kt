package bo.geopanel.mobile.update

import android.content.Context
import android.content.Intent
import androidx.core.content.FileProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

data class UpdateInfo(
    val hasUpdate: Boolean,
    val versionCode: Int,
    val versionName: String,
    val releaseNotes: String,
    val downloadUrl: String,
    val sha256: String,
    val isMandatory: Boolean
)

class AppUpdateManager(private val context: Context) {

    /**
     * Consulta el endpoint seguro de GEO-PANEL para verificar nuevas versiones
     */
    suspend fun checkForUpdates(currentVersionCode: Int): UpdateInfo = withContext(Dispatchers.IO) {
        val checkUrl = "https://tusrb5tle2w9helgfmthkpdf.187.127.33.214.sslip.io/api/v1/mobile/updates/check?versionCode=$currentVersionCode"
        val url = URL(checkUrl)
        val conn = (url.openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = 6000
            readTimeout = 6000
        }

        if (conn.responseCode == 200) {
            val body = conn.inputStream.bufferedReader().use { it.readText() }
            val json = JSONObject(body)
            val hasUpdate = json.optBoolean("hasUpdate", false)

            if (hasUpdate && json.has("latestVersion")) {
                val latest = json.getJSONObject("latestVersion")
                return@withContext UpdateInfo(
                    hasUpdate = true,
                    versionCode = latest.getInt("versionCode"),
                    versionName = latest.getString("versionName"),
                    releaseNotes = latest.optString("releaseNotes", "Mejoras generales"),
                    downloadUrl = latest.getString("downloadUrl"),
                    sha256 = latest.getString("sha256"),
                    isMandatory = latest.optBoolean("isMandatory", false)
                )
            }
        }

        UpdateInfo(false, currentVersionCode, "", "", "", "", false)
    }

    /**
     * Descarga el APK con verificación estricta de hash SHA-256 e inicia el instalador del sistema
     */
    suspend fun downloadAndInstallApk(updateInfo: UpdateInfo, onProgress: (Int) -> Unit): Boolean = withContext(Dispatchers.IO) {
        val destinationDir = File(context.filesDir, "updates").apply { mkdirs() }
        val apkFile = File(destinationDir, "geopanel-v${updateInfo.versionName}.apk")

        try {
            val url = URL(updateInfo.downloadUrl)
            val conn = (url.openConnection() as HttpURLConnection).apply {
                connectTimeout = 10000
                readTimeout = 20000
            }

            val totalBytes = conn.contentLength
            var downloadedBytes = 0

            conn.inputStream.use { input ->
                FileOutputStream(apkFile).use { output ->
                    val buffer = ByteArray(8192)
                    var bytesRead: Int
                    while (input.read(buffer).also { bytesRead = it } != -1) {
                        output.write(buffer, 0, bytesRead)
                        downloadedBytes += bytesRead
                        if (totalBytes > 0) {
                            onProgress((downloadedBytes * 100L / totalBytes).toInt())
                        }
                    }
                }
            }

            // Verificación criptográfica SHA-256 antes de instalar (Requisito 3)
            val calculatedSha256 = calculateSha256(apkFile)
            if (!calculatedSha256.equals(updateInfo.sha256, ignoreCase = true)) {
                apkFile.delete()
                throw SecurityException("Fallo de integridad: Checksum SHA-256 no coincide.")
            }

            // Abrir instalador oficial de Android
            promptSystemInstall(apkFile)
            return@withContext true
        } catch (e: Exception) {
            apkFile.delete()
            return@withContext false
        }
    }

    private fun promptSystemInstall(apkFile: File) {
        val contentUri = FileProvider.getUriForFile(
            context,
            "${context.packageName}.fileprovider",
            apkFile
        )

        val installIntent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(contentUri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }

        context.startActivity(installIntent)
    }

    private fun calculateSha256(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { fis ->
            val buffer = ByteArray(8192)
            var read: Int
            while (fis.read(buffer).also { read = it } != -1) {
                digest.update(buffer, 0, read)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }
}
