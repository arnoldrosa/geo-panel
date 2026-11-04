/**
 * GEO-PANEL — Migrador de JSON hacia PostgreSQL
 * Transfiere empresas, usuarios y vehículos conservando identificadores
 */
const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, '..', 'data', 'db.json');

function generateSqlInserts() {
  if (!fs.existsSync(DB_FILE)) {
    console.error('❌ db.json no encontrado');
    return;
  }
  const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  let sql = '-- Migración generada automáticamente desde db.json\nBEGIN;\n\n';

  // 1. Empresas
  if (Array.isArray(db.companies)) {
    for (const c of db.companies) {
      sql += `INSERT INTO companies (name, tax_id, phone, city, plan, status, created_at)
VALUES (${escapeSql(c.name)}, ${escapeSql(c.nit)}, ${escapeSql(c.phone)}, ${escapeSql(c.city || 'Santa Cruz de la Sierra')}, ${escapeSql(c.plan)}, ${escapeSql(c.status || 'active')}, ${escapeSql(c.createdAt || new Date().toISOString())})
ON CONFLICT DO NOTHING;\n`;
    }
  }

  // 2. Usuarios
  if (Array.isArray(db.users)) {
    for (const u of db.users) {
      sql += `INSERT INTO users (name, email, password_hash, role, created_at)
VALUES (${escapeSql(u.name)}, ${escapeSql(u.email)}, ${escapeSql(u.password)}, ${escapeSql(u.role)}, CURRENT_TIMESTAMP)
ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash;\n`;
    }
  }

  // 3. Vehículos
  if (Array.isArray(db.vehicles)) {
    for (const v of db.vehicles) {
      sql += `INSERT INTO devices (unique_id, name, plate, driver_name, device_type, phone, traccar_device_id, is_disabled, is_demo, created_at)
SELECT ${escapeSql(v.uniqueId)}, ${escapeSql(v.name)}, ${escapeSql(v.plate)}, ${escapeSql(v.driver)}, ${escapeSql(v.type || 'person')}, ${escapeSql(v.phone)}, ${v.traccarDeviceId || 'NULL'}, ${!!v.disabled}, ${!!v.isDemo}, CURRENT_TIMESTAMP
ON CONFLICT (unique_id) DO UPDATE SET name = EXCLUDED.name;\n`;
    }
  }

  sql += '\nCOMMIT;\n';
  const outPath = path.join(__dirname, 'migration_data.sql');
  fs.writeFileSync(outPath, sql, 'utf8');
  console.log(`✅ SQL de migración generado exitosamente en: ${outPath}`);
}

function escapeSql(val) {
  if (val === null || val === undefined) return 'NULL';
  return `'${String(val).replace(/'/g, "''")}'`;
}

if (require.main === module) {
  generateSqlInserts();
}

module.exports = { generateSqlInserts };
