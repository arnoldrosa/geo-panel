/**
 * GEO-PANEL — Capa de Acceso a Datos PostgreSQL + PostGIS (Producción y Dev)
 * Implementa Pool de conexiones controlado, consultas parametrizadas,
 * transacciones ACID, tiempos de espera y reconexión resiliente (SRE).
 */
const { Pool } = require('pg');

const isProduction = process.env.NODE_ENV === 'production';

// Configuración mediante variables de entorno con valores seguros
const poolConfig = {
  connectionString: process.env.DATABASE_URL || undefined,
  host: process.env.PGHOST || '127.0.0.1',
  port: parseInt(process.env.PGPORT || (isProduction ? '5432' : '5433'), 10),
  database: process.env.PGDATABASE || (isProduction ? 'geopanel' : 'geopanel_dev'),
  user: process.env.PGUSER || (isProduction ? 'geopanel_user' : 'geopanel_dev_user'),
  password: process.env.PGPASSWORD || (isProduction ? undefined : 'dev_secret_pg_scz_9988'),
  max: parseInt(process.env.PG_POOL_MAX || '15', 10), // Máximo de conexiones concurrentes
  idleTimeoutMillis: parseInt(process.env.PG_IDLE_TIMEOUT || '30000', 10), // 30 segundos
  connectionTimeoutMillis: parseInt(process.env.PG_CONNECT_TIMEOUT || '5000', 10), // 5 segundos
  statement_timeout: 10000 // 10 segundos para prevenir consultas lentas bloqueantes
};

// Si no hay configuración de base de datos en producción y no se ha definido conexión,
// se permite operar en modo contingencia (JSON fallback) hasta que se conecte
let pool = null;
let isConnected = false;

function getPool() {
  if (!pool) {
    pool = new Pool(poolConfig);

    pool.on('error', (err) => {
      console.error('⚠️ Error inesperado en el pool inactivo de PostgreSQL:', err.message);
      isConnected = false;
    });

    pool.on('connect', () => {
      isConnected = true;
    });
  }
  return pool;
}

/**
 * Ejecuta una consulta parametrizada con tiempo de ejecución y métricas
 */
async function query(text, params = []) {
  const start = Date.now();
  const client = getPool();
  try {
    const res = await client.query(text, params);
    isConnected = true;
    const duration = Date.now() - start;
    if (process.env.DEBUG_SQL === 'true') {
      console.log(`[SQL ${duration}ms] ${text.replace(/\s+/g, ' ').slice(0, 100)} (filas: ${res.rowCount})`);
    }
    return res;
  } catch (err) {
    const duration = Date.now() - start;
    console.error(`❌ [SQL Error ${duration}ms]: ${err.message}`);
    throw err;
  }
}

/**
 * Ejecuta una serie de operaciones dentro de una transacción segura (BEGIN / COMMIT / ROLLBACK)
 */
async function withTransaction(callback) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Verifica la disponibilidad activa de la base de datos (Healthcheck)
 */
async function checkHealth() {
  try {
    const start = Date.now();
    const res = await query('SELECT 1 as alive, version() as version');
    const latencyMs = Date.now() - start;
    isConnected = true;
    return {
      available: true,
      latencyMs,
      version: res.rows[0].version
    };
  } catch (err) {
    isConnected = false;
    return {
      available: false,
      error: err.message
    };
  }
}

/**
 * Cierre controlado del pool de conexiones para graceful shutdown
 */
async function closePool() {
  if (pool) {
    try {
      await pool.end();
      isConnected = false;
      console.log('✅ Pool de conexiones de PostgreSQL cerrado limpiamente.');
    } catch (err) {
      console.error('Error cerrando pool de PostgreSQL:', err.message);
    }
  }
}

module.exports = {
  getPool,
  query,
  withTransaction,
  checkHealth,
  closePool,
  isConnected: () => isConnected,
  get connected() { return isConnected; }
};

// Auto-sondear salud de PostgreSQL en inicialización silenciosamente
checkHealth().catch(() => {});
