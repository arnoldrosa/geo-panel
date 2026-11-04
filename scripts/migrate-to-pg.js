/**
 * GEO-PANEL — Migrador Idempotente de JSON hacia PostgreSQL
 * Transfiere empresas, usuarios y vehículos conservando identificadores
 * y relaciones de claves foráneas seguras sin dependencias externas.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DB_FILE = path.join(__dirname, '..', 'data', 'db.json');

function hashToken(tok) {
  if (!tok) return 'NULL';
  const h = crypto.createHash('sha256').update(String(tok).trim()).digest('hex');
  return `'${h}'`;
}

function generateSqlInserts(sourceFile = DB_FILE, outputFile = path.join(__dirname, 'migration_data.sql')) {
  if (!fs.existsSync(sourceFile)) {
    throw new Error(`Archivo origen no encontrado en: ${sourceFile}`);
  }
  const db = JSON.parse(fs.readFileSync(sourceFile, 'utf8'));
  let sql = '-- GEO-PANEL: Script de migración idempotente generado automáticamente\n';
  sql += '-- IMPORTANTE: No borra datos históricos ni utiliza cascadas destructivas.\n';
  sql += 'BEGIN;\n\n';

  // 1. Empresas
  if (Array.isArray(db.companies)) {
    sql += '-- 1. Inserción de Empresas (Tenants)\n';
    for (const c of db.companies) {
      sql += `INSERT INTO companies (legacy_id, name, tax_id, phone, city, plan, status, created_at)
VALUES (${escapeSql(c.id)}, ${escapeSql(c.name)}, ${escapeSql(c.nit)}, ${escapeSql(c.phone)}, ${escapeSql(c.city || 'Santa Cruz de la Sierra')}, ${escapeSql(c.plan)}, ${escapeSql(c.status || 'active')}, ${escapeSql(c.createdAt || new Date().toISOString())})
ON CONFLICT (legacy_id) DO UPDATE SET 
  name = EXCLUDED.name, 
  tax_id = EXCLUDED.tax_id, 
  phone = EXCLUDED.phone, 
  plan = EXCLUDED.plan, 
  status = EXCLUDED.status,
  updated_at = CURRENT_TIMESTAMP;\n`;
    }
    sql += '\n';
  }

  // 2. Usuarios
  if (Array.isArray(db.users)) {
    sql += '-- 2. Inserción de Usuarios con Vinculación a Empresa\n';
    for (const u of db.users) {
      const companyLookup = u.companyId
        ? `(SELECT id FROM companies WHERE legacy_id = ${escapeSql(u.companyId)})`
        : 'NULL';
      const userName = u.name || (u.email ? u.email.split('@')[0] : 'Usuario');

      sql += `INSERT INTO users (company_id, name, email, password_hash, role, phone, is_active, created_at)
VALUES (${companyLookup}, ${escapeSql(userName)}, ${escapeSql(u.email)}, ${escapeSql(u.password)}, ${escapeSql(u.role || 'OPERATOR')}, ${escapeSql(u.phone)}, ${u.isActive !== false}, CURRENT_TIMESTAMP)
ON CONFLICT (email) DO UPDATE SET 
  name = EXCLUDED.name,
  password_hash = EXCLUDED.password_hash, 
  role = EXCLUDED.role,
  is_active = EXCLUDED.is_active,
  updated_at = CURRENT_TIMESTAMP;\n`;
    }
    sql += '\n';
  }

  // 3. Vehículos / Dispositivos
  if (Array.isArray(db.vehicles)) {
    sql += '-- 3. Inserción de Dispositivos / Vehículos con Hash de Token\n';
    for (const v of db.vehicles) {
      const companyLookup = v.companyId
        ? `(SELECT id FROM companies WHERE legacy_id = ${escapeSql(v.companyId)})`
        : `(SELECT id FROM companies LIMIT 1)`;

      const tokenHash = v.deviceTokenHash ? `'${v.deviceTokenHash}'` : hashToken(v.deviceToken || `tok-${v.uniqueId.toLowerCase()}`);

      sql += `INSERT INTO devices (company_id, unique_id, name, plate, driver_name, device_type, phone, traccar_device_id, device_token_hash, is_disabled, is_demo, expiration_time, created_at)
VALUES (${companyLookup}, ${escapeSql(v.uniqueId)}, ${escapeSql(v.name)}, ${escapeSql(v.plate)}, ${escapeSql(v.driver)}, ${escapeSql(v.type || 'person')}, ${escapeSql(v.phone)}, ${v.traccarDeviceId || 'NULL'}, ${tokenHash}, ${!!v.disabled}, ${!!v.isDemo}, ${escapeSql(v.expirationTime)}, CURRENT_TIMESTAMP)
ON CONFLICT (unique_id) DO UPDATE SET 
  name = EXCLUDED.name,
  plate = EXCLUDED.plate,
  driver_name = EXCLUDED.driver_name,
  device_token_hash = COALESCE(EXCLUDED.device_token_hash, devices.device_token_hash),
  is_disabled = EXCLUDED.is_disabled,
  updated_at = CURRENT_TIMESTAMP;\n`;
    }
    sql += '\n';
  }

  sql += 'COMMIT;\n';
  fs.writeFileSync(outputFile, sql, 'utf8');
  console.log(`✅ SQL de migración generado exitosamente en: ${outputFile}`);
  return { outputFile, sql };
}

function escapeSql(val) {
  if (val === null || val === undefined || val === '') return 'NULL';
  return `'${String(val).replace(/'/g, "''")}'`;
}

if (require.main === module) {
  generateSqlInserts();
}

module.exports = { generateSqlInserts, escapeSql };
