/**
 * GEO-PANEL — Repositorio Telemático y Motor de Posiciones (PostgreSQL + PostGIS)
 * Gestiona inserción atómica e idempotente de coordenadas, deduplicación a nivel
 * de base de datos, consultas cronológicas, paginación y aislamiento multi-tenant.
 */
const { query, withTransaction, isConnected } = require('./pg');

class TelemetryRepository {
  /**
   * Registra una posición GPS de forma durable e idempotente en PostgreSQL
   * @param {Object} posData - Datos telemáticos validados
   * @returns {Promise<Object>} Resultado con estado de inserción o duplicidad
   */
  async recordTelemetry(posData) {
    const {
      uniqueId,
      latitude,
      longitude,
      speedKmh = 0,
      course = 0,
      accuracy = 5.0,
      batteryLevel = null,
      isCharging = false,
      ignition = false,
      packetId = null,
      deviceTime,
      fixTime,
      speedAnomaly = null,
      timestampStatus = 'valid',
      streetAddress = null,
      attributes = {}
    } = posData;

    // 1. Obtener dispositivo y empresa asociada
    const devRes = await query(
      `SELECT id, company_id, last_update, is_disabled, expiration_time 
       FROM devices WHERE unique_id = $1`,
      [uniqueId]
    );

    if (devRes.rowCount === 0) {
      const err = new Error(`Dispositivo con identificador '${uniqueId}' no encontrado`);
      err.statusCode = 404;
      throw err;
    }

    const dev = devRes.rows[0];

    if (dev.is_disabled) {
      const err = new Error('Dispositivo suspendido administrativamente');
      err.statusCode = 403;
      throw err;
    }

    if (dev.expiration_time && new Date(dev.expiration_time).getTime() < Date.now()) {
      const err = new Error('Suscripción telemática vencida para este dispositivo');
      err.statusCode = 403;
      throw err;
    }

    const deviceId = dev.id;
    const companyId = dev.company_id;
    const speedKnots = +(speedKmh / 1.852).toFixed(2);
    const dTime = new Date(deviceTime || fixTime || Date.now()).toISOString();
    const fTime = new Date(fixTime || deviceTime || Date.now()).toISOString();

    // 2. Inserción idempotente en la tabla particionada positions
    // ON CONFLICT (device_id, fix_time) DO NOTHING previene duplicados físicos
    const insertSql = `
      INSERT INTO positions (
        device_id, company_id, packet_id, device_time, fix_time, server_time,
        geom, latitude, longitude, speed_kmh, speed_knots, course, accuracy,
        battery_level, is_charging, ignition, street_address, speed_anomaly,
        timestamp_status, attributes
      ) VALUES (
        $1, $2, $3, $4, $5, CURRENT_TIMESTAMP,
        ST_SetSRID(ST_MakePoint($7, $6), 4326), $6, $7, $8, $9, $10, $11,
        $12, $13, $14, $15, $16, $17, $18
      )
      ON CONFLICT (device_id, fix_time) DO NOTHING
      RETURNING id, fix_time;
    `;

    const insertParams = [
      deviceId,
      companyId,
      packetId || null,
      dTime,
      fTime,
      latitude,
      longitude,
      speedKmh,
      speedKnots,
      course,
      accuracy,
      batteryLevel,
      !!isCharging,
      !!ignition,
      streetAddress,
      speedAnomaly,
      timestampStatus,
      JSON.stringify(attributes)
    ];

    const result = await query(insertSql, insertParams);

    // Si xmax != 0 o no devolvió fila, la posición ya existía (duplicado idempotente)
    const wasInserted = result.rowCount > 0;

    if (!wasInserted) {
      return {
        ok: true,
        duplicate: true,
        deviceId,
        fixTime: fTime,
        message: 'Posición ya existente en PostgreSQL (idempotencia confirmada)'
      };
    }

    // 3. Regla de paquetes fuera de orden (FASE 6):
    // Solo actualizar el 'last_update' del dispositivo si la posición es más reciente
    // que la última registrada. Paquetes históricos tardíos NO degradan la posición en vivo.
    const isNewest = !dev.last_update || new Date(fTime) >= new Date(dev.last_update);

    if (isNewest) {
      await query(
        `UPDATE devices 
         SET last_update = $1, updated_at = CURRENT_TIMESTAMP 
         WHERE id = $2`,
        [fTime, deviceId]
      );
    }

    return {
      ok: true,
      duplicate: false,
      deviceId,
      fixTime: fTime,
      isNewest,
      speedAnomaly,
      timestampStatus
    };
  }

  /**
   * Consulta el historial ordenado cronológicamente con paginación y filtro de empresa
   */
  async getDeviceHistory(options) {
    const {
      deviceId,
      fromDate,
      toDate,
      companyId = null,
      limit = 500,
      offset = 0
    } = options;

    let sql = `
      SELECT 
        p.device_id,
        p.packet_id,
        p.device_time,
        p.fix_time,
        p.server_time,
        p.latitude,
        p.longitude,
        p.speed_kmh,
        p.speed_knots,
        p.course,
        p.accuracy,
        p.battery_level,
        p.is_charging,
        p.ignition,
        p.street_address,
        p.speed_anomaly,
        p.timestamp_status,
        d.name as device_name,
        d.unique_id
      FROM positions p
      JOIN devices d ON p.device_id = d.id
      WHERE p.device_id = $1
        AND p.fix_time >= $2
        AND p.fix_time <= $3
    `;

    const params = [deviceId, fromDate.toISOString(), toDate.toISOString()];

    // Aislamiento Multi-Tenant obligatorio
    if (companyId) {
      params.push(companyId);
      sql += ` AND p.company_id = $${params.length}`;
    }

    sql += ` ORDER BY p.fix_time ASC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(Math.min(limit, 2000), Math.max(0, offset));

    const res = await query(sql, params);
    return res.rows;
  }

  /**
   * Obtiene la última posición registrada de los dispositivos con filtro por empresa
   */
  async getLatestPositions(companyId = null) {
    let sql = `
      SELECT DISTINCT ON (d.id)
        d.id as device_id,
        d.unique_id,
        d.name,
        d.plate,
        d.driver_name,
        d.device_type,
        d.company_id,
        c.name as company_name,
        d.last_update,
        p.latitude,
        p.longitude,
        p.speed_kmh,
        p.speed_knots,
        p.course,
        p.battery_level,
        p.accuracy,
        p.street_address,
        p.fix_time,
        p.speed_anomaly,
        p.timestamp_status
      FROM devices d
      LEFT JOIN companies c ON d.company_id = c.id
      LEFT JOIN positions p ON p.device_id = d.id AND p.fix_time = d.last_update
      WHERE d.is_disabled = false
    `;

    const params = [];
    if (companyId && companyId !== 'ALL') {
      params.push(companyId);
      sql += ` AND d.company_id = $1`;
    }

    sql += ` ORDER BY d.id, p.fix_time DESC NULLS LAST`;

    const res = await query(sql, params);
    return res.rows;
  }
  /**
   * Sincroniza una empresa en PostgreSQL para aislamiento multi-tenant
   */
  async syncCompany(comp) {
    try {
      await query(
        `INSERT INTO companies (legacy_id, name, tax_id, phone, city, plan, status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (legacy_id) DO UPDATE SET 
           name = EXCLUDED.name, 
           tax_id = EXCLUDED.tax_id, 
           phone = EXCLUDED.phone, 
           plan = EXCLUDED.plan, 
           status = EXCLUDED.status,
           updated_at = CURRENT_TIMESTAMP`,
        [comp.id, comp.name, comp.nit || null, comp.phone || null, comp.city || 'Santa Cruz de la Sierra', comp.plan || 'Plan PyME', comp.status || 'active', comp.createdAt || new Date().toISOString()]
      );
    } catch (err) {
      console.warn('Aviso sincronizando empresa en PostgreSQL:', err.message);
    }
  }

  /**
   * Sincroniza un dispositivo / vehículo en PostgreSQL
   */
  async syncDevice(v) {
    try {
      const crypto = require('crypto');
      const tokenHash = v.deviceTokenHash || (v.deviceToken ? crypto.createHash('sha256').update(String(v.deviceToken).trim()).digest('hex') : null);
      await query(
        `INSERT INTO devices (company_id, unique_id, name, plate, driver_name, device_type, phone, traccar_device_id, device_token_hash, is_disabled, is_demo, expiration_time, created_at)
         VALUES (
           COALESCE((SELECT id FROM companies WHERE legacy_id = $1), (SELECT id FROM companies LIMIT 1)),
           $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, CURRENT_TIMESTAMP
         )
         ON CONFLICT (unique_id) DO UPDATE SET 
           name = EXCLUDED.name,
           plate = EXCLUDED.plate,
           driver_name = EXCLUDED.driver_name,
           device_token_hash = COALESCE(EXCLUDED.device_token_hash, devices.device_token_hash),
           is_disabled = EXCLUDED.is_disabled,
           updated_at = CURRENT_TIMESTAMP`,
        [v.companyId, v.uniqueId, v.name, v.plate || null, v.driver || null, v.type || 'person', v.phone || null, (v.traccarDeviceId && Number.isInteger(Number(v.traccarDeviceId))) ? Number(v.traccarDeviceId) : null, tokenHash, !!v.disabled, !!v.isDemo, v.expirationTime ? new Date(v.expirationTime).toISOString() : null]
      );
    } catch (err) {
      console.warn('Aviso sincronizando dispositivo en PostgreSQL:', err.message);
    }
  }

  /**
   * Actualiza el hash del token de dispositivo tras vinculación o revocación
   */
  async updateDeviceTokenHash(uniqueId, tokenHash) {
    try {
      await query(
        `UPDATE devices SET device_token_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE unique_id = $2`,
        [tokenHash, uniqueId]
      );
    } catch (err) {
      console.warn('Aviso actualizando token hash en PostgreSQL:', err.message);
    }
  }
}

module.exports = new TelemetryRepository();
