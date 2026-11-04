/**
 * GEO-PANEL — Script de Respaldo Seguro y Recuperación de Datos
 * Genera copias de seguridad fechadas con suma de verificación SHA-256
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const BACKUP_DIR = path.join(__dirname, '..', 'backups');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function createBackup() {
  ensureDir(BACKUP_DIR);
  if (!fs.existsSync(DB_FILE)) {
    console.error('❌ Error: Archivo de base de datos no encontrado en:', DB_FILE);
    process.exit(1);
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFileName = `geopanel-backup-${timestamp}.json`;
  const backupPath = path.join(BACKUP_DIR, backupFileName);

  const content = fs.readFileSync(DB_FILE, 'utf8');
  const checksum = crypto.createHash('sha256').update(content).digest('hex');

  fs.writeFileSync(backupPath, content, 'utf8');

  // Metadata de auditoría
  const meta = {
    originalFile: DB_FILE,
    backupFile: backupFileName,
    bytes: content.length,
    sha256: checksum,
    createdAt: new Date().toISOString()
  };
  fs.writeFileSync(path.join(BACKUP_DIR, `meta-${timestamp}.json`), JSON.stringify(meta, null, 2), 'utf8');

  console.log('✅ Respaldo de GEO-PANEL completado exitosamente:');
  console.log(`   📁 Archivo: ${backupPath}`);
  console.log(`   🔒 SHA-256: ${checksum}`);
  console.log(`   📦 Tamaño: ${(content.length / 1024).toFixed(2)} KB`);
  return { backupPath, checksum };
}

function restoreBackup(backupPath) {
  if (!fs.existsSync(backupPath)) {
    console.error('❌ Error: El archivo de respaldo no existe:', backupPath);
    process.exit(1);
  }

  ensureDir(DATA_DIR);
  const content = fs.readFileSync(backupPath, 'utf8');
  
  // Validar JSON sintácticamente antes de sobreescribir
  try {
    JSON.parse(content);
  } catch (e) {
    console.error('❌ Error: El archivo de respaldo contiene JSON corrupto:', e.message);
    process.exit(1);
  }

  // Escribir de forma atómica
  const tmpFile = path.join(DATA_DIR, 'db.json.tmp');
  fs.writeFileSync(tmpFile, content, 'utf8');
  fs.renameSync(tmpFile, DB_FILE);

  console.log('✅ Restauración completada exitosamente desde:', backupPath);
}

// Ejecución directa por CLI
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args[0] === '--restore' && args[1]) {
    restoreBackup(args[1]);
  } else {
    createBackup();
  }
}

module.exports = { createBackup, restoreBackup };
