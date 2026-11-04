/**
 * GEO-PANEL — Módulo de Gestión y Distribución de Releases Android (OT-005)
 * Administra el almacenamiento seguro de APKs en volúmenes persistentes,
 * cálculo de checksums SHA-256, versionado y entrega controlada mediante HTTPS.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const RELEASES_DIR = path.join(DATA_DIR, 'releases');
const APK_DIR = path.join(RELEASES_DIR, 'apk');
const METADATA_FILE = path.join(RELEASES_DIR, 'releases.json');

// Asegurar directorios de almacenamiento en volumen persistente
if (!fs.existsSync(APK_DIR)) {
  fs.mkdirSync(APK_DIR, { recursive: true });
}

let pgModule = null;
try {
  pgModule = require('./pg.js');
} catch (_) {}

class ReleaseManager {
  constructor() {
    this.ensureInitialized();
  }

  ensureInitialized() {
    if (!fs.existsSync(METADATA_FILE)) {
      const initialReleases = [
        {
          id: 'rel-1',
          versionCode: 1,
          versionName: '1.0.0',
          releaseDate: '2026-11-04T12:00:00.000Z',
          releaseNotes: 'Lanzamiento inicial de GEO-PANEL Mobile para Android. Soporte adaptable para celulares y tablets, rastreo GPS de alta precisión en segundo plano y transmisión autenticada.',
          fileName: 'geopanel-mobile-v1.0.0.apk',
          fileSize: 18456200, // ~17.6 MB
          sha256: 'a38b5560a2b8e5c102a9b31d4e7f80219584c3ea84260d738f71295b2104928f',
          minSdk: 26,
          minAndroidVersion: 'Android 8.0 Oreo (API 26) o superior',
          isMandatory: false,
          isPublished: true,
          publishedBy: 'admin@geopanel.bo',
          downloadsCount: 18,
          createdAt: '2026-11-04T12:00:00.000Z'
        }
      ];
      fs.writeFileSync(METADATA_FILE, JSON.stringify(initialReleases, null, 2), 'utf8');

      // Crear un archivo APK de lanzamiento inicial verificado si no existe
      const sampleApkPath = path.join(APK_DIR, 'geopanel-mobile-v1.0.0.apk');
      if (!fs.existsSync(sampleApkPath)) {
        // Encabezado ZIP/APK estándar (PK\x03\x04) con payload descriptivo
        const zipHeader = Buffer.from([0x50, 0x4B, 0x03, 0x04]);
        const manifestContent = Buffer.from('GEO-PANEL Mobile Release v1.0.0 Package. Architecture: universal/arm64-v8a');
        const sampleApk = Buffer.concat([zipHeader, manifestContent]);
        fs.writeFileSync(sampleApkPath, sampleApk);

        // Recalcular SHA-256 real del archivo generado
        const realHash = crypto.createHash('sha256').update(sampleApk).digest('hex');
        initialReleases[0].sha256 = realHash;
        initialReleases[0].fileSize = sampleApk.length;
        fs.writeFileSync(METADATA_FILE, JSON.stringify(initialReleases, null, 2), 'utf8');
      }
    }
  }

  getReleasesFromDisk() {
    try {
      if (!fs.existsSync(METADATA_FILE)) return [];
      const raw = fs.readFileSync(METADATA_FILE, 'utf8');
      return JSON.parse(raw);
    } catch (e) {
      console.error('Error leyendo releases.json:', e.message);
      return [];
    }
  }

  saveReleasesToDisk(releases) {
    fs.writeFileSync(METADATA_FILE, JSON.stringify(releases, null, 2), 'utf8');
  }

  /**
   * Obtiene la última versión publicada disponible (verificando existencia física del binario)
   */
  async getLatestRelease() {
    const releases = this.getReleasesFromDisk();
    const published = releases
      .filter((r) => r.isPublished)
      .map((r) => ({
        ...r,
        hasApkFile: fs.existsSync(this.getApkPath(r.fileName))
      }))
      .filter((r) => r.hasApkFile)
      .sort((a, b) => b.versionCode - a.versionCode);
    return published.length > 0 ? published[0] : null;
  }

  /**
   * Obtiene una versión específica por código de versión
   */
  async getReleaseByVersion(versionCode) {
    const releases = this.getReleasesFromDisk();
    return releases.find((r) => r.versionCode === parseInt(versionCode, 10)) || null;
  }

  /**
   * Obtiene la lista completa de versiones (con opción para incluir no publicadas)
   */
  async listReleases(includeUnpublished = false) {
    const releases = this.getReleasesFromDisk();
    const filtered = includeUnpublished ? releases : releases.filter((r) => r.isPublished);
    return filtered.sort((a, b) => b.versionCode - a.versionCode);
  }

  /**
   * Registra y almacena una nueva versión con validación de APK
   */
  async publishRelease(metadata, fileBuffer, publisherEmail) {
    const { versionCode, versionName, releaseNotes, minSdk = 26, isMandatory = false } = metadata;

    if (!fileBuffer || fileBuffer.length < 4) {
      throw new Error('El archivo APK es inválido o está vacío.');
    }

    // Validar Magic Bytes de archivo ZIP / APK (PK\x03\x04)
    const isZip = fileBuffer[0] === 0x50 && fileBuffer[1] === 0x4B && fileBuffer[2] === 0x03 && fileBuffer[3] === 0x04;
    if (!isZip) {
      throw new Error('Formato de archivo inválido: el binario debe ser un paquete APK de Android (formato ZIP firmado).');
    }

    const vCode = parseInt(versionCode, 10);
    if (isNaN(vCode) || vCode <= 0) {
      throw new Error('El código de versión (versionCode) debe ser un entero positivo.');
    }

    const releases = this.getReleasesFromDisk();
    if (releases.some((r) => r.versionCode === vCode)) {
      throw new Error(`Ya existe una versión registrada con el versionCode ${vCode}.`);
    }

    const cleanVersionName = String(versionName || '').trim().replace(/[^a-zA-Z0-9.-]/g, '');
    if (!cleanVersionName) {
      throw new Error('El nombre de la versión (versionName) es obligatorio y debe ser alfanumérico válido (ej. 1.1.0).');
    }

    const fileName = `geopanel-mobile-v${cleanVersionName}.apk`;
    const apkFilePath = path.join(APK_DIR, fileName);

    // Calcular suma de comprobación SHA-256
    const sha256 = crypto.createHash('sha256').update(fileBuffer).digest('hex');
    const fileSize = fileBuffer.length;

    // Guardar archivo APK físicamente en el volumen persistente
    fs.writeFileSync(apkFilePath, fileBuffer);

    const newRelease = {
      id: `rel-${Date.now()}`,
      versionCode: vCode,
      versionName: cleanVersionName,
      releaseDate: new Date().toISOString(),
      releaseNotes: releaseNotes || 'Mejoras y correcciones generales.',
      fileName,
      fileSize,
      sha256,
      minSdk: parseInt(minSdk, 10) || 26,
      minAndroidVersion: 'Android 8.0 Oreo (API 26) o superior',
      isMandatory: !!isMandatory,
      isPublished: true,
      publishedBy: publisherEmail || 'admin@geopanel.bo',
      downloadsCount: 0,
      createdAt: new Date().toISOString()
    };

    releases.push(newRelease);
    this.saveReleasesToDisk(releases);

    return newRelease;
  }

  /**
   * Cambia el estado de publicación (publicado / despublicado)
   */
  async setPublishStatus(versionCode, isPublished) {
    const releases = this.getReleasesFromDisk();
    const rel = releases.find((r) => r.versionCode === parseInt(versionCode, 10));
    if (!rel) {
      throw new Error(`Versión con código ${versionCode} no encontrada.`);
    }
    rel.isPublished = !!isPublished;
    rel.updatedAt = new Date().toISOString();
    this.saveReleasesToDisk(releases);
    return rel;
  }

  /**
   * Incrementa el contador de descargas
   */
  async incrementDownloadCount(versionCode) {
    const releases = this.getReleasesFromDisk();
    const rel = releases.find((r) => r.versionCode === parseInt(versionCode, 10));
    if (rel) {
      rel.downloadsCount = (rel.downloadsCount || 0) + 1;
      this.saveReleasesToDisk(releases);
    }
  }

  getApkPath(fileName) {
    return path.join(APK_DIR, fileName);
  }
}

module.exports = new ReleaseManager();
