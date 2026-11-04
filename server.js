const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let telemetryRepository = null;
try {
  telemetryRepository = require('./db/telemetry-repository.js');
} catch (_) {}

let releaseManager = null;
try {
  releaseManager = require('./db/releases.js');
} catch (_) {}

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = process.env.DB_FILE || process.env.DB_PATH || path.join(DATA_DIR, 'db.json');
const DB_TMP_FILE = DB_FILE + '.tmp';
const PUBLIC_DIR = path.join(__dirname, 'public');
const SERVER_START_TIME = Date.now();

// Asegurar carpeta de datos
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// ====================================================================
// 1. SISTEMA RBAC (Roles y Permisos Granulares - Tarea 4)
// ====================================================================
const ROLES = {
  SUPERADMIN: 'SUPERADMIN',
  COMPANY_ADMIN: 'COMPANY_ADMIN',
  OPERATOR: 'OPERATOR',
  MOBILE_USER: 'MOBILE_USER'
};

const PERMISSIONS = {
  COMPANY_CREATE: 'company:create',
  COMPANY_READ: 'company:read',
  COMPANY_UPDATE: 'company:update',
  COMPANY_DELETE: 'company:delete',
  USER_CREATE: 'user:create',
  USER_READ: 'user:read',
  USER_UPDATE: 'user:update',
  USER_DELETE: 'user:delete',
  DEVICE_CREATE: 'device:create',
  DEVICE_READ: 'device:read',
  DEVICE_UPDATE: 'device:update',
  DEVICE_DELETE: 'device:delete',
  FLEET_LIVE: 'fleet:live',
  FLEET_HISTORY: 'fleet:history',
  TELEMETRY_CONFIG: 'telemetry:config',
  TELEMETRY_TRANSMIT: 'telemetry:transmit',
  REPORT_READ: 'report:read',
  QR_GENERATE: 'qr:generate',
  MOBILE_MANAGE: 'mobile:manage'
};

const ROLE_PERMISSIONS = {
  [ROLES.SUPERADMIN]: ['*'],
  [ROLES.COMPANY_ADMIN]: [
    PERMISSIONS.COMPANY_READ,
    PERMISSIONS.USER_CREATE,
    PERMISSIONS.USER_READ,
    PERMISSIONS.USER_UPDATE,
    PERMISSIONS.DEVICE_CREATE,
    PERMISSIONS.DEVICE_READ,
    PERMISSIONS.DEVICE_UPDATE,
    PERMISSIONS.DEVICE_DELETE,
    PERMISSIONS.FLEET_LIVE,
    PERMISSIONS.FLEET_HISTORY,
    PERMISSIONS.REPORT_READ,
    PERMISSIONS.QR_GENERATE
  ],
  [ROLES.OPERATOR]: [
    PERMISSIONS.COMPANY_READ,
    PERMISSIONS.DEVICE_READ,
    PERMISSIONS.FLEET_LIVE,
    PERMISSIONS.FLEET_HISTORY,
    PERMISSIONS.REPORT_READ
  ],
  [ROLES.MOBILE_USER]: [
    PERMISSIONS.TELEMETRY_TRANSMIT
  ]
};

function hasPermission(user, permission) {
  if (!user || !user.role) return false;
  if (user.role === ROLES.SUPERADMIN) return true;
  const userPerms = ROLE_PERMISSIONS[user.role] || [];
  return userPerms.includes(permission) || userPerms.includes('*');
}

// ====================================================================
// 2. SEGURIDAD Y HASHING (Scrypt + HMAC-SHA256 - Tarea 1)
// ====================================================================
function hashPassword(plainPassword) {
  if (!plainPassword) return '';
  if (String(plainPassword).startsWith('scrypt$')) return plainPassword;
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(plainPassword), salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(plainPassword, storedPassword) {
  if (!plainPassword || !storedPassword) return false;
  if (String(storedPassword).startsWith('scrypt$')) {
    const parts = String(storedPassword).split('$');
    if (parts.length !== 3) return false;
    const [, salt, originalHash] = parts;
    const derived = crypto.scryptSync(String(plainPassword), salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(originalHash, 'hex'), Buffer.from(derived, 'hex'));
  }
  // Migración transparente de texto plano previo si existiera
  return String(plainPassword) === String(storedPassword);
}

// Secreto de sesión: en producción y staging exige clave obligatoria
function resolveTokenSecret() {
  const secret = process.env.TOKEN_SECRET;
  const isProd = process.env.NODE_ENV === 'production' || process.env.APP_ENV === 'staging' || process.env.APP_ENV === 'production';
  const DEV_FALLBACK = 'geopanel-dev-secret-key-scz-2026';

  if (isProd) {
    if (!secret || secret === DEV_FALLBACK) {
      console.error('❌ ERROR FATAL DE CONFIGURACIÓN (SRE/OWASP):');
      console.error('   En entorno de producción o staging (NODE_ENV=production / APP_ENV=staging) la variable TOKEN_SECRET es OBLIGATORIA');
      console.error('   y no puede utilizar la clave predeterminada de desarrollo.');
      if (process.env.NODE_ENV_TEST !== 'true') {
        process.exit(1);
      }
      throw new Error('TOKEN_SECRET obligatorio en producción y staging');
    }
    return secret;
  }
  return secret || DEV_FALLBACK;
}

const TOKEN_SECRET = resolveTokenSecret();

function hashDeviceToken(token) {
  if (!token) return '';
  return crypto.createHash('sha256').update(String(token).trim()).digest('hex');
}

function verifyDeviceToken(providedToken, storedTokenOrHash) {
  if (!providedToken || !storedTokenOrHash) return false;
  const clean = String(providedToken).trim();
  const providedHash = crypto.createHash('sha256').update(clean).digest('hex');

  // Si storedTokenOrHash es un hash SHA-256 (64 hex chars)
  if (storedTokenOrHash.length === 64 && /^[0-9a-f]{64}$/i.test(storedTokenOrHash)) {
    return crypto.timingSafeEqual(Buffer.from(providedHash, 'hex'), Buffer.from(storedTokenOrHash.toLowerCase(), 'hex'));
  }
  // Fallback para compatibilidad con tokens en texto plano previos
  if (clean === storedTokenOrHash) {
    return true;
  }
  return false;
}

const SESSION_TTL_MS = 7 * 24 * 3600 * 1000; // 7 días

function createAuthToken(userId, db) {
  const issuedAt = Date.now();
  const payload = `${userId}.${issuedAt}`;
  const sig = crypto.createHmac('sha256', TOKEN_SECRET).update(payload).digest('hex');
  const token = `uid.${payload}.${sig}`;
  if (db) {
    db.sessions = db.sessions || {};
    db.sessions[token] = { userId, issuedAt };
    saveDb(db);
  }
  return token;
}

function getAuthUser(req, db) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.replace('Bearer ', '').trim();
  if (!token) return null;

  if (token.startsWith('uid.')) {
    const parts = token.split('.');
    if (parts.length === 4) {
      const [, userId, issuedAtStr, sig] = parts;
      const issuedAt = Number(issuedAtStr);
      if (!issuedAt || Date.now() - issuedAt > SESSION_TTL_MS) return null;
      const expectedSig = crypto
        .createHmac('sha256', TOKEN_SECRET)
        .update(`${userId}.${issuedAtStr}`)
        .digest('hex');
      if (
        sig.length === expectedSig.length &&
        crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))
      ) {
        return db.users.find((u) => u.id === userId && u.isActive !== false) || null;
      }
    } else if (parts.length === 3) {
      const [, userId, sig] = parts;
      const expectedSig = crypto
        .createHmac('sha256', TOKEN_SECRET)
        .update(String(userId))
        .digest('hex');
      if (
        sig.length === expectedSig.length &&
        crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))
      ) {
        return db.users.find((u) => u.id === userId && u.isActive !== false) || null;
      }
    }
  }

  if (db.sessions && db.sessions[token]) {
    const entry = db.sessions[token];
    const userId = typeof entry === 'string' ? entry : entry.userId;
    return db.users.find((u) => u.id === userId && u.isActive !== false) || null;
  }

  return null;
}

// Protección Anti-Fuerza Bruta en Login (Rate Limiting en Memoria)
const loginAttemptsByIp = new Map();
const MAX_LOGIN_ATTEMPTS = 6;
const LOGIN_LOCKOUT_MS = 60 * 1000;

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return String(forwarded).split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

function checkLoginRateLimit(ip) {
  const record = loginAttemptsByIp.get(ip);
  if (!record) return { allowed: true };
  if (Date.now() - record.lastAttempt > LOGIN_LOCKOUT_MS) {
    loginAttemptsByIp.delete(ip);
    return { allowed: true };
  }
  if (record.count >= MAX_LOGIN_ATTEMPTS) {
    const waitSec = Math.ceil((LOGIN_LOCKOUT_MS - (Date.now() - record.lastAttempt)) / 1000);
    return { allowed: false, waitSec };
  }
  return { allowed: true };
}

function recordFailedLogin(ip) {
  const record = loginAttemptsByIp.get(ip) || { count: 0, lastAttempt: 0 };
  record.count += 1;
  record.lastAttempt = Date.now();
  loginAttemptsByIp.set(ip, record);
}

function clearFailedLogin(ip) {
  loginAttemptsByIp.delete(ip);
}

// ====================================================================
// 3. ESTRUCTURA Y PERSISTENCIA DE DATOS (Tarea 1 y Tarea 6)
// ====================================================================
// Datos limpios sin secretos quemados en el código fuente
const DEFAULT_DB = {
  traccarConfig: {
    url: process.env.TRACCAR_URL || '',
    email: process.env.TRACCAR_EMAIL || '',
    password: process.env.TRACCAR_PASSWORD || '',
    connected: false,
    lastSync: null,
    lastError: null,
    serverInfo: null
  },
  companies: [
    {
      id: 'comp-1',
      name: 'Transporte Oriental SRL',
      nit: '1028493021',
      phone: '+591 770-12345',
      city: 'Santa Cruz de la Sierra',
      plan: 'Plan PyME (Hasta 10 GPS)',
      status: 'active',
      createdAt: '2026-10-27T10:00:00Z'
    },
    {
      id: 'comp-2',
      name: 'Distribuidora Santa Cruz Ltda.',
      nit: '3491820194',
      phone: '+591 760-98765',
      city: 'Santa Cruz de la Sierra',
      plan: 'Plan Flota (Hasta 15 GPS)',
      status: 'active',
      createdAt: '2026-10-27T10:05:00Z'
    }
  ],
  users: process.env.NODE_ENV === 'production'
    ? [
        {
          id: 'usr-admin',
          name: 'Administrador General GEO-PANEL',
          email: process.env.INITIAL_ADMIN_EMAIL || 'admin@geopanel.bo',
          password: process.env.INITIAL_ADMIN_PASSWORD
            ? hashPassword(process.env.INITIAL_ADMIN_PASSWORD)
            : hashPassword(crypto.randomBytes(24).toString('hex')),
          role: ROLES.SUPERADMIN,
          companyId: null,
          isActive: true
        }
      ]
    : [
        {
          id: 'usr-admin',
          name: 'Administrador General GEO-PANEL',
          email: process.env.INITIAL_ADMIN_EMAIL || 'admin@geopanel.bo',
          password: hashPassword(process.env.INITIAL_ADMIN_PASSWORD || 'admin123'),
          role: ROLES.SUPERADMIN,
          companyId: null,
          isActive: true
        },
        {
          id: 'usr-comp1',
          name: 'Carlos Méndez (Transporte Oriental)',
          email: 'oriental@empresa1.bo',
          password: hashPassword('123456'),
          role: ROLES.COMPANY_ADMIN,
          companyId: 'comp-1',
          isActive: true
        },
        {
          id: 'usr-comp2',
          name: 'Laura Suárez (Distribuidora SCZ)',
          email: 'distribuidora@empresa2.bo',
          password: hashPassword('123456'),
          role: ROLES.COMPANY_ADMIN,
          companyId: 'comp-2',
          isActive: true
        }
      ],
  vehicles: [
    {
      id: 'veh-demo-1',
      traccarDeviceId: null,
      uniqueId: 'DEMO-SCZ-01',
      deviceToken: 'tok-demo-01',
      name: 'Camión Reparto #01 (Hilux)',
      plate: '4582-TKR',
      driver: 'Juan Pérez',
      companyId: 'comp-1',
      type: 'truck',
      isDemo: true,
      lastPosition: {
        latitude: -17.7833,
        longitude: -63.1821,
        speedKmh: 38.5,
        course: 120,
        status: 'online',
        ignition: true,
        batteryLevel: 92,
        accuracy: 4.8,
        address: 'Av. Cristo Redentor y 2do Anillo, Santa Cruz',
        fixTime: new Date().toISOString()
      }
    },
    {
      id: 'veh-demo-2',
      traccarDeviceId: null,
      uniqueId: 'DEMO-SCZ-02',
      deviceToken: 'tok-demo-02',
      name: 'Furgón Logística #04',
      plate: '5120-BNA',
      driver: 'Miguel Rojas',
      companyId: 'comp-1',
      type: 'van',
      isDemo: true,
      lastPosition: {
        latitude: -17.7685,
        longitude: -63.1950,
        speedKmh: 0,
        course: 0,
        status: 'online',
        ignition: false,
        batteryLevel: 85,
        accuracy: 5.0,
        address: 'Zona Equipetrol Norte, Santa Cruz',
        fixTime: new Date().toISOString()
      }
    },
    {
      id: 'veh-demo-3',
      traccarDeviceId: null,
      uniqueId: 'DEMO-SCZ-03',
      deviceToken: 'tok-demo-03',
      name: 'Camioneta Ventas #01',
      plate: '3891-SCZ',
      driver: 'Roberto Flores',
      companyId: 'comp-2',
      type: 'car',
      isDemo: true,
      lastPosition: {
        latitude: -17.7962,
        longitude: -63.1614,
        speedKmh: 52.0,
        course: 245,
        status: 'online',
        ignition: true,
        batteryLevel: 78,
        accuracy: 4.2,
        address: 'Av. Virgen de Cotoca (3er Anillo), Santa Cruz',
        fixTime: new Date().toISOString()
      }
    }
  ]
};

let memoryDb = null;

function ensureEncryptedUsers(db) {
  let changed = false;
  if (Array.isArray(db.users)) {
    for (const u of db.users) {
      if (u.password && !String(u.password).startsWith('scrypt$')) {
        u.password = hashPassword(u.password);
        changed = true;
      }
      if (u.isActive === undefined) {
        u.isActive = true;
        changed = true;
      }
    }
  }
  if (Array.isArray(db.vehicles)) {
    for (const v of db.vehicles) {
      if (!v.deviceTokenHash) {
        const rawToken = v.deviceToken || `tok-${String(v.uniqueId || v.id).toLowerCase()}`;
        v.deviceTokenHash = hashDeviceToken(rawToken);
        v.deviceToken = rawToken; // Conservar token de desarrollo si existe
        changed = true;
      }
    }
  }
  // Inyectar variables de entorno de Traccar si están disponibles y el json está vacío
  if (db.traccarConfig) {
    if (process.env.TRACCAR_URL && !db.traccarConfig.url) {
      db.traccarConfig.url = process.env.TRACCAR_URL;
      changed = true;
    }
    if (process.env.TRACCAR_EMAIL && !db.traccarConfig.email) {
      db.traccarConfig.email = process.env.TRACCAR_EMAIL;
      changed = true;
    }
    if (process.env.TRACCAR_PASSWORD && !db.traccarConfig.password) {
      db.traccarConfig.password = process.env.TRACCAR_PASSWORD;
      changed = true;
    }
  }
  return changed;
}

function loadDb() {
  if (memoryDb) return memoryDb;
  try {
    if (!fs.existsSync(DB_FILE)) {
      memoryDb = JSON.parse(JSON.stringify(DEFAULT_DB));
      ensureEncryptedUsers(memoryDb);
      saveDb(memoryDb);
      return memoryDb;
    }
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    memoryDb = JSON.parse(raw);
    if (ensureEncryptedUsers(memoryDb)) {
      saveDb(memoryDb);
    }
    return memoryDb;
  } catch (err) {
    console.error('Error cargando base de datos local:', err.message);
    memoryDb = JSON.parse(JSON.stringify(DEFAULT_DB));
    ensureEncryptedUsers(memoryDb);
    return memoryDb;
  }
}

function saveDb(db) {
  memoryDb = db;
  try {
    const payload = JSON.stringify(db, null, 2);
    fs.writeFileSync(DB_TMP_FILE, payload, 'utf8');
    fs.renameSync(DB_TMP_FILE, DB_FILE);
  } catch (err) {
    console.error('Error guardando base de datos de forma atómica:', err.message);
  }
}

// ====================================================================
// 4. CAPA DE ABSTRACCIÓN DE TELEMETRÍA (Tarea 5)
// ====================================================================
/**
 * Interfaz base para desacoplar el origen de datos GPS
 */
class BaseTelemetryProvider {
  async getDevices(config) { throw new Error('Not implemented'); }
  async getPositions(config) { throw new Error('Not implemented'); }
  async getHistory(config, deviceId, fromDate, toDate) { throw new Error('Not implemented'); }
  async createDevice(config, payload) { throw new Error('Not implemented'); }
  async updateDevice(config, deviceId, payload) { throw new Error('Not implemented'); }
  async deleteDevice(config, deviceId) { throw new Error('Not implemented'); }
}

class TraccarTelemetryProvider extends BaseTelemetryProvider {
  async fetchTraccar(traccarConfig, endpoint, options = {}) {
    const baseUrl = (traccarConfig.url || '').replace(/\/+$/, '');
    if (!baseUrl || !traccarConfig.email || !traccarConfig.password) {
      throw new Error('Credenciales de Traccar incompletas');
    }
    const auth = Buffer.from(`${traccarConfig.email}:${traccarConfig.password}`).toString('base64');
    const url = `${baseUrl}${endpoint}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    try {
      const res = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          Authorization: `Basic ${auth}`,
          ...(options.headers || {})
        }
      });

      if (res.status === 401) {
        throw new Error('Usuario o contraseña de Traccar incorrectos (HTTP 401)');
      }
      if (res.status === 204) {
        return { ok: true };
      }
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(`Error de Traccar (HTTP ${res.status}): ${txt.slice(0, 120)}`);
      }
      const text = await res.text();
      return text ? JSON.parse(text) : {};
    } finally {
      clearTimeout(timeout);
    }
  }

  async getDevices(config) {
    return await this.fetchTraccar(config, '/api/devices');
  }

  async getPositions(config) {
    return await this.fetchTraccar(config, '/api/positions');
  }

  async getHistory(config, deviceId, fromDate, toDate) {
    const query = `?deviceId=${deviceId}&from=${encodeURIComponent(
      fromDate.toISOString()
    )}&to=${encodeURIComponent(toDate.toISOString())}`;
    return await this.fetchTraccar(config, `/api/positions${query}`);
  }

  async createDevice(config, payload) {
    return await this.fetchTraccar(config, '/api/devices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  }

  async updateDevice(config, deviceId, payload) {
    return await this.fetchTraccar(config, `/api/devices/${deviceId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, id: deviceId })
    });
  }

  async deleteDevice(config, deviceId) {
    return await this.fetchTraccar(config, `/api/devices/${deviceId}`, {
      method: 'DELETE'
    });
  }
}

class NativeGpsEngineProvider extends BaseTelemetryProvider {
  // Motor nativo GEO-PANEL: Lee de la persistencia de GEO-PANEL
  async getDevices(config) {
    const db = loadDb();
    const now = Date.now();
    return (db.vehicles || []).map((v) => {
      const lastUp = v.lastUpdate ? new Date(v.lastUpdate).getTime() : 0;
      const isOnline = lastUp && (now - lastUp < 10 * 60 * 1000);
      return {
        id: v.id,
        name: v.name,
        uniqueId: v.uniqueId,
        status: isOnline ? 'online' : 'offline',
        lastUpdate: v.lastUpdate || null,
        phone: v.phone || null,
        category: v.type || 'default',
        disabled: !!v.disabled
      };
    });
  }

  async getPositions(config) {
    const db = loadDb();
    return (db.vehicles || [])
      .filter((v) => v.lastPosition && v.lastPosition.latitude && v.lastPosition.longitude)
      .map((v) => ({
        id: v.id,
        deviceId: v.id,
        protocol: 'geopanel-native',
        serverTime: v.lastUpdate,
        deviceTime: v.lastPosition.fixTime,
        fixTime: v.lastPosition.fixTime,
        valid: true,
        latitude: v.lastPosition.latitude,
        longitude: v.lastPosition.longitude,
        speed: v.lastPosition.speedKnots || 0,
        course: v.lastPosition.course || 0,
        address: v.lastPosition.address || null,
        attributes: {
          batteryLevel: v.lastPosition.batteryLevel,
          speedKmh: v.lastPosition.speedKmh,
          totalDistanceKm: v.lastPosition.totalDistanceKm
        }
      }));
  }

  async getHistory(config, deviceId, fromDate, toDate) {
    const db = loadDb();
    const veh = (db.vehicles || []).find((v) => v.id === deviceId || String(v.uniqueId) === String(deviceId));
    if (!veh || !veh.lastPosition) return [];
    return [{
      deviceId: veh.id,
      fixTime: veh.lastPosition.fixTime,
      latitude: veh.lastPosition.latitude,
      longitude: veh.lastPosition.longitude,
      speed: veh.lastPosition.speedKnots || 0,
      course: veh.lastPosition.course || 0,
      attributes: {
        speedKmh: veh.lastPosition.speedKmh,
        batteryLevel: veh.lastPosition.batteryLevel
      }
    }];
  }

  async createDevice(config, payload) {
    const db = loadDb();
    const id = `veh-${Date.now()}`;
    const newDev = { id, ...payload, isDemo: false, createdAt: new Date().toISOString() };
    db.vehicles = db.vehicles || [];
    db.vehicles.push(newDev);
    saveDb(db);
    return newDev;
  }

  async updateDevice(config, deviceId, payload) {
    const db = loadDb();
    const idx = (db.vehicles || []).findIndex((v) => v.id === deviceId);
    if (idx !== -1) {
      db.vehicles[idx] = { ...db.vehicles[idx], ...payload, id: deviceId };
      saveDb(db);
      return db.vehicles[idx];
    }
    return { id: deviceId, ...payload };
  }

  async deleteDevice(config, deviceId) {
    const db = loadDb();
    db.vehicles = (db.vehicles || []).filter((v) => v.id !== deviceId);
    saveDb(db);
    return { ok: true };
  }
}

const telemetryService = {
  activeProvider: new TraccarTelemetryProvider(),
  nativeProvider: new NativeGpsEngineProvider(),
  get provider() {
    if (process.env.TELEMETRY_PROVIDER === 'native') {
      if (process.env.ALLOW_EXPERIMENTAL_NATIVE_ENGINE === 'true') {
        return this.nativeProvider;
      }
      console.warn('⚠️ AVISO: Proveedor nativo solicitado pero ALLOW_EXPERIMENTAL_NATIVE_ENGINE no está activo.');
      console.warn('   Manteniendo Traccar como proveedor protegido para evitar pérdida de posiciones.');
      return this.activeProvider;
    }
    return this.activeProvider;
  }
};

// Sincronización asíncrona con Cooldown anti-avalancha (Singleflight)
let activeSyncPromise = null;
let lastSyncTimestampMs = 0;
const MIN_SYNC_INTERVAL_MS = 4000;

async function syncWithTraccar(db) {
  const cfg = db.traccarConfig;
  if (!cfg.url || !cfg.email || !cfg.password) {
    return { synced: 0, connected: false, message: 'Sin credenciales configuradas' };
  }

  try {
    const [devices, positions] = await Promise.all([
      telemetryService.provider.getDevices(cfg),
      telemetryService.provider.getPositions(cfg)
    ]);

    const posByDeviceId = new Map();
    if (Array.isArray(positions)) {
      for (const p of positions) {
        posByDeviceId.set(p.deviceId, p);
      }
    }

    let added = 0;
    let updated = 0;

    if (Array.isArray(devices)) {
      for (const dev of devices) {
        let localVeh = db.vehicles.find(
          (v) => v.traccarDeviceId === dev.id || v.uniqueId === dev.uniqueId
        );

        const pos = posByDeviceId.get(dev.id);
        const speedKnots = pos && typeof pos.speed === 'number' ? +pos.speed.toFixed(2) : 0;
        const speedKmh = +(speedKnots * 1.852).toFixed(2);
        const attrs = (pos && pos.attributes) || {};
        const totalDistanceKm =
          typeof attrs.totalDistance === 'number' ? +(attrs.totalDistance / 1000).toFixed(2) : 0;

        let detectedBattery = null;
        if (attrs.batteryLevel !== undefined && attrs.batteryLevel !== null) {
          detectedBattery = Math.round(Number(attrs.batteryLevel));
        } else if (attrs.battery !== undefined && attrs.battery !== null) {
          detectedBattery = Math.round(Number(attrs.battery));
        } else if (pos && pos.batteryLevel !== undefined && pos.batteryLevel !== null) {
          detectedBattery = Math.round(Number(pos.batteryLevel));
        } else if (localVeh?.lastPosition?.batteryLevel !== undefined && localVeh?.lastPosition?.batteryLevel !== null) {
          detectedBattery = localVeh.lastPosition.batteryLevel;
        }

        // Búsqueda histórica de batería sólo si aún no fue verificada y el dispositivo tiene posición
        if (detectedBattery === null && pos && !localVeh?.batteryCheckedOnce) {
          try {
            const toD = new Date();
            const fromD = new Date(toD.getTime() - 12 * 3600 * 1000);
            const recentPos = await telemetryService.provider.getHistory(cfg, dev.id, fromD, toD);
            if (Array.isArray(recentPos)) {
              for (let i = recentPos.length - 1; i >= 0; i--) {
                const rpAttr = recentPos[i]?.attributes || {};
                if (rpAttr.batteryLevel !== undefined && rpAttr.batteryLevel !== null) {
                  detectedBattery = Math.round(Number(rpAttr.batteryLevel));
                  break;
                }
                if (rpAttr.battery !== undefined && rpAttr.battery !== null) {
                  detectedBattery = Math.round(Number(rpAttr.battery));
                  break;
                }
              }
            }
          } catch (e) {
            // Ignorar error de historial secundario
          }
          if (localVeh) localVeh.batteryCheckedOnce = true;
        }

        const effectiveStatus = dev.status === 'online' ? 'online' : dev.status || 'offline';

        const mappedPosition = pos
          ? {
              latitude: pos.latitude,
              longitude: pos.longitude,
              speedKmh,
              speedKnots,
              totalDistanceKm,
              course: pos.course || 0,
              status: effectiveStatus,
              ignition: attrs.ignition !== undefined ? !!attrs.ignition : speedKmh > 1,
              batteryLevel: detectedBattery,
              accuracy: pos.accuracy ? +pos.accuracy.toFixed(1) : 5.0,
              address: pos.address || localVeh?.lastPosition?.streetName || null,
              streetName: pos.address || localVeh?.lastPosition?.streetName || null,
              fixTime: pos.fixTime || pos.deviceTime || dev.lastUpdate || new Date().toISOString()
            }
          : localVeh?.lastPosition || {
              latitude: -17.7833,
              longitude: -63.1821,
              speedKmh: 0,
              speedKnots: 0,
              totalDistanceKm: 0,
              course: 0,
              status: effectiveStatus,
              ignition: false,
              batteryLevel: null,
              accuracy: null,
              address: null,
              streetName: null,
              fixTime: dev.lastUpdate || new Date().toISOString()
            };

        if (!localVeh) {
          const defaultCompanyId = db.companies[0] ? db.companies[0].id : null;
          localVeh = {
            id: `veh-traccar-${dev.id}`,
            traccarDeviceId: dev.id,
            uniqueId: dev.uniqueId || String(dev.id),
            deviceToken: `tok-${dev.uniqueId || dev.id}`,
            name: dev.name || `Dispositivo GPS #${dev.id}`,
            phone: dev.phone || '',
            plate: dev.model || '',
            driver: dev.contact || '',
            companyId: defaultCompanyId,
            type: dev.category || 'default',
            expirationTime: dev.expirationTime || null,
            disabled: !!dev.disabled,
            isDemo: false,
            traccarStatus: dev.status || 'unknown',
            lastUpdate: dev.lastUpdate || mappedPosition.fixTime,
            lastPosition: mappedPosition
          };
          db.vehicles.unshift(localVeh);
          added++;
        } else {
          localVeh.traccarDeviceId = dev.id;
          localVeh.uniqueId = dev.uniqueId || localVeh.uniqueId;
          localVeh.traccarStatus = dev.status || 'unknown';
          localVeh.lastUpdate = dev.lastUpdate || mappedPosition.fixTime;
          localVeh.isDemo = false;
          localVeh.name = dev.name || localVeh.name;
          localVeh.phone = dev.phone || localVeh.phone || '';
          localVeh.plate = dev.model || localVeh.plate || '';
          localVeh.driver = dev.contact || localVeh.driver || '';
          localVeh.type = dev.category || localVeh.type || 'default';
          localVeh.expirationTime = dev.expirationTime || localVeh.expirationTime || null;
          localVeh.disabled = dev.disabled !== undefined ? !!dev.disabled : !!localVeh.disabled;
          localVeh.lastPosition = {
            ...mappedPosition,
            status: dev.status || mappedPosition.status
          };
          updated++;
        }
      }
    }

    cfg.connected = true;
    cfg.lastSync = new Date().toISOString();
    cfg.lastError = null;
    saveDb(db);

    return {
      connected: true,
      totalTraccarDevices: Array.isArray(devices) ? devices.length : 0,
      added,
      updated,
      lastSync: cfg.lastSync
    };
  } catch (err) {
    cfg.connected = false;
    cfg.lastError = err.message;
    saveDb(db);
    throw err;
  }
}

function triggerTraccarSync(db, force = false) {
  if (process.env.TRACCAR_ENABLED === 'false') {
    return Promise.resolve({ synced: 0, connected: false, message: 'Traccar deshabilitado por configuración (TRACCAR_ENABLED=false)' });
  }
  const cfg = db.traccarConfig;
  if (!cfg || !cfg.url || !cfg.email || !cfg.password) {
    return Promise.resolve({ synced: 0, connected: false, message: 'Sin credenciales configuradas' });
  }
  const now = Date.now();
  if (!force && now - lastSyncTimestampMs < MIN_SYNC_INTERVAL_MS && cfg.connected) {
    return Promise.resolve({
      connected: cfg.connected,
      lastSync: cfg.lastSync,
      cached: true
    });
  }
  if (activeSyncPromise) {
    return activeSyncPromise;
  }
  activeSyncPromise = syncWithTraccar(db).finally(() => {
    lastSyncTimestampMs = Date.now();
    activeSyncPromise = null;
  });
  return activeSyncPromise;
}

function sanitizeVehicleForUser(v, user, companies) {
  const comp = companies.find((c) => c.id === v.companyId);
  const clean = {
    id: v.id,
    traccarDeviceId: v.traccarDeviceId,
    uniqueId: v.uniqueId,
    name: v.name,
    phone: v.phone || '',
    plate: v.plate || '',
    driver: v.driver || '',
    companyId: v.companyId,
    companyName: comp ? comp.name : 'Sin empresa asignada',
    type: v.type || 'default',
    disabled: !!v.disabled,
    isDemo: !!v.isDemo,
    traccarStatus: v.traccarStatus || 'offline',
    lastUpdate: v.lastUpdate || null,
    lastPosition: v.lastPosition || null
  };
  if (user.role === ROLES.SUPERADMIN) {
    clean.expirationTime = v.expirationTime || null;
    clean.deviceToken = v.deviceToken || null;
  }
  return clean;
}

// ====================================================================
// 5. RESPUESTAS HTTP Y PARSEO
// ====================================================================
function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Device-Token',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
  });
  res.end(JSON.stringify(data));
}

function parseBody(req, maxBytes = 60 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > maxBytes) {
        req.destroy(new Error(`Payload excede el límite máximo de ${Math.round(maxBytes / (1024 * 1024))}MB`));
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        reject(new Error('JSON inválido'));
      }
    });
    req.on('error', reject);
  });
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

// ====================================================================
// 6. ENRUTADOR PRINCIPAL HTTP
// ====================================================================
const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    return sendJson(res, 200, { ok: true });
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;
  const db = loadDb();

  try {
    // 0. HEALTH CHECK (Coolify / Docker SRE)
    if ((pathname === '/api/health' || pathname === '/health') && req.method === 'GET') {
      const isTraccarEnabled = process.env.TRACCAR_ENABLED !== 'false';
      return sendJson(res, 200, {
        status: 'ok',
        service: 'geo-panel',
        environment: process.env.APP_ENV || (process.env.NODE_ENV === 'production' ? 'production' : 'development'),
        uptimeSeconds: Math.floor((Date.now() - SERVER_START_TIME) / 1000),
        traccarEnabled: isTraccarEnabled,
        traccarConnected: isTraccarEnabled && !!db.traccarConfig?.connected,
        telemetryProvider: process.env.TELEMETRY_PROVIDER || 'traccar',
        lastSync: db.traccarConfig?.lastSync || null,
        timestamp: new Date().toISOString()
      });
    }

    // 1. INGESTA GPS DIRECTA (Orden 002 & 003 - Motor Telemático Blindado)
    if ((pathname === '/api/v1/telemetry/report' || pathname === '/api/telemetry') && req.method === 'POST') {
      const rawToken = (
        req.headers['x-device-token'] ||
        (req.headers['authorization'] || '').replace('Bearer ', '') ||
        parsedUrl.searchParams.get('token') ||
        ''
      ).trim();

      if (!rawToken) {
        return sendJson(res, 401, { error: 'Token de autenticación de dispositivo requerido (cabecera X-Device-Token)' });
      }

      let payload;
      try {
        payload = await parseBody(req);
      } catch (err) {
        return sendJson(res, 400, { error: 'Cuerpo de petición malformado o JSON inválido' });
      }

      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return sendJson(res, 400, { error: 'Cuerpo de la petición debe ser un objeto JSON válido' });
      }

      const { uniqueId, latitude, longitude, speedKmh, course, accuracy, batteryLevel, fixTime } = payload;

      if (!uniqueId || typeof uniqueId !== 'string' || !uniqueId.trim()) {
        return sendJson(res, 400, { error: 'uniqueId es obligatorio y debe ser una cadena válida' });
      }

      const cleanUniqueId = uniqueId.trim();
      let dev = db.vehicles.find((v) => String(v.uniqueId) === cleanUniqueId);
      if (!dev) {
        return sendJson(res, 404, { error: 'Dispositivo no encontrado en GEO-PANEL' });
      }

      // Verificación estricta de token con SHA-256 / timingSafeEqual
      const storedToken = dev.deviceTokenHash || dev.deviceToken;
      if (!storedToken || !verifyDeviceToken(rawToken, storedToken)) {
        return sendJson(res, 401, { error: 'Token de dispositivo no autorizado' });
      }

      // Aislamiento y control de estado del dispositivo
      if (dev.disabled === true || dev.isDisabled === true) {
        return sendJson(res, 403, { error: 'Dispositivo deshabilitado o suspendido administrativamente' });
      }

      if (dev.expirationTime && new Date(dev.expirationTime).getTime() < Date.now()) {
        return sendJson(res, 403, { error: 'Suscripción de monitoreo expirada para este dispositivo' });
      }

      // Validación estricta de coordenadas geográficas
      if (
        latitude === null ||
        latitude === undefined ||
        latitude === '' ||
        longitude === null ||
        longitude === undefined ||
        longitude === '' ||
        typeof latitude === 'boolean' ||
        typeof longitude === 'boolean'
      ) {
        return sendJson(res, 400, { error: 'Latitud y longitud numéricas son obligatorias' });
      }

      const lat = Number(latitude);
      const lon = Number(longitude);
      if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lon) ||
        lat < -90 ||
        lat > 90 ||
        lon < -180 ||
        lon > 180
      ) {
        return sendJson(res, 400, { error: 'Coordenadas geográficas inválidas (latitud entre -90 y 90, longitud entre -180 y 180)' });
      }

      // Telemetría: velocidad, rumbo, precisión, batería
      const rawSpeed = Number(speedKmh);
      const speed = Number.isFinite(rawSpeed) && rawSpeed >= 0 ? +rawSpeed.toFixed(2) : 0;
      // Clasificación de anomalía de velocidad (no rechazar automáticamente)
      const speedAnomaly = speed > 200 ? 'excessive_speed_or_gps_jump' : null;

      const rawCourse = Number(course);
      const crs = Number.isFinite(rawCourse) && rawCourse >= 0 && rawCourse <= 360 ? +rawCourse.toFixed(1) : 0;

      const rawAccuracy = Number(accuracy);
      const acc = Number.isFinite(rawAccuracy) && rawAccuracy >= 0 ? +rawAccuracy.toFixed(1) : 5.0;

      const rawBattery = Number(batteryLevel);
      const bat = Number.isFinite(rawBattery) && rawBattery >= 0 && rawBattery <= 100
        ? Math.round(rawBattery)
        : (dev.lastPosition?.batteryLevel ?? null);

      // Tratamiento de marcas de tiempo (futuras y antiguas)
      const nowMs = Date.now();
      const nowIso = new Date(nowMs).toISOString();
      let effectiveFixTime = nowIso;
      let timestampStatus = 'valid';

      if (fixTime) {
        const fixDate = new Date(fixTime);
        if (!isNaN(fixDate.getTime())) {
          if (fixDate.getTime() > nowMs + 5 * 60 * 1000) {
            timestampStatus = 'future_clamped_to_server_time';
            effectiveFixTime = nowIso;
          } else if (fixDate.getTime() < nowMs - 30 * 24 * 3600 * 1000) {
            timestampStatus = 'historical_outdated_data';
            effectiveFixTime = fixDate.toISOString();
          } else {
            effectiveFixTime = fixDate.toISOString();
          }
        }
      }

      // Detección de paquetes duplicados (Anti-avalanche)
      if (dev.lastPosition) {
        const isSameLat = Math.abs(lat - dev.lastPosition.latitude) < 0.000001;
        const isSameLon = Math.abs(lon - dev.lastPosition.longitude) < 0.000001;
        const isSameTime = dev.lastPosition.fixTime === effectiveFixTime;
        if (isSameLat && isSameLon && isSameTime) {
          return sendJson(res, 200, {
            ok: true,
            duplicate: true,
            receivedAt: nowIso,
            message: 'Posición idéntica recibida (descartada sin duplicar)'
          });
        }
      }

      // Calcular distancia incremental si se mueve
      let totalDistance = dev.lastPosition?.totalDistanceKm || 0;
      if (dev.lastPosition?.latitude && dev.lastPosition?.longitude) {
        const deltaKm = haversineKm(
          dev.lastPosition.latitude,
          dev.lastPosition.longitude,
          lat,
          lon
        );
        if (deltaKm > 0.01 && deltaKm < 50) {
          totalDistance = +(totalDistance + deltaKm).toFixed(2);
        }
      }

      dev.lastPosition = {
        latitude: lat,
        longitude: lon,
        speedKmh: speed,
        speedKnots: +(speed / 1.852).toFixed(2),
        totalDistanceKm: totalDistance,
        course: crs,
        status: 'online',
        ignition: speed > 1,
        batteryLevel: bat,
        accuracy: acc,
        address: dev.lastPosition?.address || null,
        streetName: dev.lastPosition?.streetName || null,
        fixTime: effectiveFixTime,
        speedAnomaly,
        timestampStatus
      };
      dev.lastUpdate = nowIso;
      dev.traccarStatus = 'online';

      // Persistencia durable en PostgreSQL (FASE 4)
      if (telemetryRepository) {
        try {
          const pgRes = await telemetryRepository.recordTelemetry({
            uniqueId: cleanUniqueId,
            latitude: lat,
            longitude: lon,
            speedKmh: speed,
            course: crs,
            accuracy: acc,
            batteryLevel: bat,
            fixTime: effectiveFixTime,
            deviceTime: fixTime || effectiveFixTime,
            packetId: payload.packetId || null,
            speedAnomaly,
            timestampStatus
          });

          if (pgRes && pgRes.duplicate) {
            return sendJson(res, 200, {
              ok: true,
              duplicate: true,
              receivedAt: nowIso,
              message: 'Posición idéntica recibida (descartada sin duplicar en PostgreSQL)'
            });
          }
        } catch (pgErr) {
          if (pgErr.statusCode === 403 || pgErr.statusCode === 404) {
            return sendJson(res, pgErr.statusCode, { error: pgErr.message });
          }
          if (process.env.STRICT_PG_TELEMETRY === 'true') {
            return sendJson(res, 503, {
              ok: false,
              retryable: true,
              error: 'Motor de base de datos no disponible temporalmente. Reintente más tarde.'
            });
          }
        }
      }

      saveDb(db);
      return sendJson(res, 200, {
        ok: true,
        duplicate: false,
        receivedAt: nowIso,
        speedAnomaly,
        timestampStatus
      });
    }

    // 2. AUTENTICACIÓN HUMANA: LOGIN
    if (pathname === '/api/auth/login' && req.method === 'POST') {
      const clientIp = getClientIp(req);
      const rateStatus = checkLoginRateLimit(clientIp);
      if (!rateStatus.allowed) {
        return sendJson(res, 429, {
          error: `Demasiados intentos fallidos. Espera ${rateStatus.waitSec} segundos antes de reintentar.`
        });
      }

      const { email, password } = await parseBody(req);
      const user = db.users.find(
        (u) =>
          u.email.toLowerCase() === String(email || '').toLowerCase().trim() &&
          verifyPassword(password, u.password)
      );

      if (!user) {
        recordFailedLogin(clientIp);
        return sendJson(res, 401, { error: 'Correo o contraseña incorrectos' });
      }

      if (user.isActive === false) {
        return sendJson(res, 403, { error: 'Esta cuenta de usuario ha sido desactivada' });
      }

      clearFailedLogin(clientIp);
      const token = createAuthToken(user.id, db);
      const company = db.companies.find((c) => c.id === user.companyId) || null;

      return sendJson(res, 200, {
        token,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          companyId: user.companyId,
          companyName: company ? company.name : 'Administración Central GEO-PANEL'
        }
      });
    }

    // 3. PERFIL DEL USUARIO AUTENTICADO
    if (pathname === '/api/auth/me' && req.method === 'GET') {
      const user = getAuthUser(req, db);
      if (!user) return sendJson(res, 401, { error: 'Sesión expirada o no autorizada' });
      const company = db.companies.find((c) => c.id === user.companyId) || null;
      return sendJson(res, 200, {
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          companyId: user.companyId,
          companyName: company ? company.name : 'Administración Central GEO-PANEL'
        }
      });
    }

    // ====================================================================
    // MÓDULO DE DISTRIBUCIÓN Y ACTUALIZACIONES DE GEO-PANEL MOBILE (OT-005)
    // ====================================================================

    // Ruta de acceso amigable y directo al Centro de Descargas
    if ((pathname === '/downloads' || pathname === '/descargas' || pathname === '/mobile') && req.method === 'GET') {
      res.writeHead(302, { Location: '/?tab=mobile' });
      return res.end();
    }

    // 3.1 Comprobar actualizaciones desde la aplicación Android (Requisito 3)
    if (pathname === '/api/v1/mobile/updates/check' && req.method === 'GET') {
      if (!releaseManager) {
        return sendJson(res, 503, { error: 'Módulo de releases no disponible' });
      }

      const clientVersionCode = parseInt(parsedUrl.searchParams.get('versionCode') || '0', 10);
      const latest = await releaseManager.getLatestRelease();

      if (!latest) {
        return sendJson(res, 200, {
          hasUpdate: false,
          currentVersionCode: clientVersionCode,
          message: 'No hay versiones publicadas disponibles en este momento.'
        });
      }

      const hasUpdate = latest.versionCode > clientVersionCode;
      const host = req.headers.host || 'localhost:3000';
      const protocol = req.headers['x-forwarded-proto'] || 'http';
      const baseUrl = `${protocol}://${host}`;

      return sendJson(res, 200, {
        hasUpdate,
        currentVersionCode: clientVersionCode,
        latestVersion: hasUpdate
          ? {
              versionCode: latest.versionCode,
              versionName: latest.versionName,
              releaseDate: latest.releaseDate,
              releaseNotes: latest.releaseNotes,
              fileSize: latest.fileSize,
              sha256: latest.sha256,
              minSdk: latest.minSdk,
              minAndroidVersion: latest.minAndroidVersion,
              isMandatory: latest.isMandatory,
              downloadUrl: `${baseUrl}/api/v1/mobile/download/${latest.versionCode}`
            }
          : null
      });
    }

    // 3.2 Descarga directa de APK de GEO-PANEL Mobile (Requisito 2 & 4)
    if (pathname.startsWith('/api/v1/mobile/download') && req.method === 'GET') {
      if (!releaseManager) {
        return sendJson(res, 503, { error: 'Módulo de descargas no disponible' });
      }

      const parts = pathname.split('/').filter(Boolean);
      // partes: ['api', 'v1', 'mobile', 'download', 'latest' o '1']
      const versionTarget = parts[4] || 'latest';

      const release = versionTarget === 'latest'
        ? await releaseManager.getLatestRelease()
        : await releaseManager.getReleaseByVersion(versionTarget);

      if (!release || !release.isPublished) {
        return sendJson(res, 404, { error: 'Versión de aplicación no encontrada o no publicada' });
      }

      const filePath = releaseManager.getApkPath(release.fileName);
      if (!fs.existsSync(filePath)) {
        return sendJson(res, 404, {
          error: 'El archivo APK no se encuentra en el volumen persistente del servidor.'
        });
      }

      await releaseManager.incrementDownloadCount(release.versionCode);
      const stat = fs.statSync(filePath);

      res.writeHead(200, {
        'Content-Type': 'application/vnd.android.package-archive',
        'Content-Disposition': `attachment; filename="${release.fileName}"`,
        'Content-Length': stat.size,
        'X-Checksum-Sha256': release.sha256,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'public, max-age=3600'
      });

      return fs.createReadStream(filePath).pipe(res);
    }

    // 3.3 Listado público de versiones e historial de cambios
    if (pathname === '/api/v1/mobile/versions' && req.method === 'GET') {
      if (!releaseManager) {
        return sendJson(res, 503, { error: 'Módulo de releases no disponible' });
      }
      const releases = await releaseManager.listReleases(false);
      const latest = await releaseManager.getLatestRelease();
      return sendJson(res, 200, {
        latestVersion: latest,
        versions: releases
      });
    }

    // 3.4 Administración de Releases: Listado completo (Solo SUPERADMIN - Requisito 5)
    if (pathname === '/api/v1/admin/mobile/releases' && req.method === 'GET') {
      const user = getAuthUser(req, db);
      if (!user || user.role !== ROLES.SUPERADMIN) {
        return sendJson(res, 403, { error: 'Acceso restringido a administradores' });
      }

      if (!releaseManager) {
        return sendJson(res, 503, { error: 'Módulo de releases no disponible' });
      }

      const releases = await releaseManager.listReleases(true);
      return sendJson(res, 200, { releases });
    }

    // 3.5 Administración de Releases: Publicar nuevo APK (Solo SUPERADMIN - Requisito 5)
    if (pathname === '/api/v1/admin/mobile/releases' && req.method === 'POST') {
      const user = getAuthUser(req, db);
      if (!user || user.role !== ROLES.SUPERADMIN) {
        return sendJson(res, 403, { error: 'Acceso restringido a administradores' });
      }

      if (!releaseManager) {
        return sendJson(res, 503, { error: 'Módulo de releases no disponible' });
      }

      const body = await parseBody(req);
      const { versionCode, versionName, releaseNotes, minSdk, isMandatory, apkBase64 } = body;

      if (!apkBase64) {
        return sendJson(res, 400, { error: 'El archivo APK en formato base64 es obligatorio' });
      }

      try {
        const fileBuffer = Buffer.from(apkBase64, 'base64');
        const release = await releaseManager.publishRelease(
          { versionCode, versionName, releaseNotes, minSdk, isMandatory },
          fileBuffer,
          user.email
        );

        return sendJson(res, 201, {
          ok: true,
          message: `Versión v${release.versionName} registrada y publicada con éxito.`,
          release
        });
      } catch (err) {
        return sendJson(res, 400, { error: err.message });
      }
    }

    // 3.6 Administración de Releases: Cambiar estado de publicación (Solo SUPERADMIN)
    if (pathname.startsWith('/api/v1/admin/mobile/releases/') && pathname.endsWith('/status') && req.method === 'PUT') {
      const user = getAuthUser(req, db);
      if (!user || user.role !== ROLES.SUPERADMIN) {
        return sendJson(res, 403, { error: 'Acceso restringido a administradores' });
      }

      if (!releaseManager) {
        return sendJson(res, 503, { error: 'Módulo de releases no disponible' });
      }

      const parts = pathname.split('/').filter(Boolean);
      // partes: ['api', 'v1', 'admin', 'mobile', 'releases', '1', 'status']
      const targetVersionCode = parts[5];
      const body = await parseBody(req);
      const { isPublished } = body;

      try {
        const updated = await releaseManager.setPublishStatus(targetVersionCode, isPublished);
        return sendJson(res, 200, {
          ok: true,
          message: `Estado de versión ${updated.versionName} actualizado a: ${isPublished ? 'Publicado' : 'Retirado'}`,
          release: updated
        });
      } catch (err) {
        return sendJson(res, 400, { error: err.message });
      }
    }

    // 4. CONFIGURACIÓN DEL PROVEEDOR TELEMETRÍA (Solo SUPERADMIN)
    if (pathname === '/api/traccar/config' && req.method === 'GET') {
      const user = getAuthUser(req, db);
      if (!user) return sendJson(res, 401, { error: 'No autorizado' });
      if (!hasPermission(user, PERMISSIONS.TELEMETRY_CONFIG)) {
        return sendJson(res, 403, { error: 'Acceso restringido a administradores' });
      }
      return sendJson(res, 200, {
        url: db.traccarConfig.url,
        email: db.traccarConfig.email,
        hasPassword: !!db.traccarConfig.password,
        connected: db.traccarConfig.connected,
        lastSync: db.traccarConfig.lastSync,
        lastError: db.traccarConfig.lastError,
        provider: process.env.TELEMETRY_PROVIDER || 'traccar'
      });
    }

    if (pathname === '/api/traccar/config' && req.method === 'POST') {
      const user = getAuthUser(req, db);
      if (!user || !hasPermission(user, PERMISSIONS.TELEMETRY_CONFIG)) {
        return sendJson(res, 403, { error: 'Solo el Super Administrador puede configurar el motor GPS' });
      }
      const { url, email, password, hideDemos } = await parseBody(req);
      if (url) db.traccarConfig.url = url.trim().replace(/\/+$/, '');
      if (email !== undefined) db.traccarConfig.email = email.trim();
      if (password) db.traccarConfig.password = password;

      if (hideDemos) {
        db.vehicles = db.vehicles.filter((v) => !v.isDemo);
      }

      saveDb(db);
      const syncResult = await triggerTraccarSync(db, true);
      return sendJson(res, 200, {
        message: `Conectado exitosamente al proveedor de telemetría. Dispositivos detectados: ${syncResult.totalTraccarDevices ?? 0}`,
        ...syncResult
      });
    }

    // 5. FLOTA EN TIEMPO REAL (Con aislamiento multiempresa RBAC)
    if (pathname === '/api/fleet/live' && req.method === 'GET') {
      const user = getAuthUser(req, db);
      if (!user) return sendJson(res, 401, { error: 'No autorizado' });
      if (!hasPermission(user, PERMISSIONS.FLEET_LIVE)) {
        return sendJson(res, 403, { error: 'Sin permiso para consultar flota' });
      }

      // Sincronizar en segundo plano respetando el cooldown y TRACCAR_ENABLED
      if (process.env.TRACCAR_ENABLED !== 'false' && db.traccarConfig.url && db.traccarConfig.email && db.traccarConfig.password) {
        try {
          await triggerTraccarSync(db, false);
        } catch (err) {
          // Conservar última posición si hay corte temporal
        }
      }

      const filterCompanyId = parsedUrl.searchParams.get('companyId');
      const includeDemos = parsedUrl.searchParams.get('includeDemos') !== 'false';

      let vehicles = db.vehicles;
      if (!includeDemos) {
        vehicles = vehicles.filter((v) => !v.isDemo);
      }

      // REGLA DE AISLAMIENTO MULTIEMPRESA:
      if (user.role !== ROLES.SUPERADMIN) {
        vehicles = vehicles.filter((v) => v.companyId === user.companyId);
      } else if (filterCompanyId && filterCompanyId !== 'ALL') {
        vehicles = vehicles.filter((v) => v.companyId === filterCompanyId);
      }

      const enriched = vehicles.map((v) => sanitizeVehicleForUser(v, user, db.companies));

      return sendJson(res, 200, {
        traccarConnected: db.traccarConfig.connected,
        lastSync: db.traccarConfig.lastSync,
        lastError: db.traccarConfig.lastError,
        vehicles: enriched
      });
    }

    // 6. HISTORIAL DE RECORRIDOS (Validado por empresa)
    if (pathname === '/api/fleet/history' && req.method === 'GET') {
      const user = getAuthUser(req, db);
      if (!user) return sendJson(res, 401, { error: 'No autorizado' });
      if (!hasPermission(user, PERMISSIONS.FLEET_HISTORY)) {
        return sendJson(res, 403, { error: 'Sin permiso para consultar historial' });
      }

      const vehicleId = parsedUrl.searchParams.get('vehicleId');
      const hours = Number(parsedUrl.searchParams.get('hours') || 6);

      const vehicle = db.vehicles.find((v) => v.id === vehicleId);
      if (!vehicle) return sendJson(res, 404, { error: 'Vehículo no encontrado' });

      // Verificación estricta de empresa
      if (user.role !== ROLES.SUPERADMIN && vehicle.companyId !== user.companyId) {
        return sendJson(res, 403, { error: 'No tienes permiso para consultar este vehículo' });
      }

      const toDate = new Date();
      const fromDate = new Date(toDate.getTime() - hours * 3600 * 1000);

      // 1. Consultar historial persistido en PostgreSQL (FASE 5)
      if (telemetryRepository) {
        try {
          const pgPositions = await telemetryRepository.getDeviceHistory({
            deviceId: vehicle.id,
            fromDate,
            toDate,
            companyId: user.role !== ROLES.SUPERADMIN ? user.companyId : null
          });

          if (Array.isArray(pgPositions) && pgPositions.length > 0) {
            const points = pgPositions.map((p) => ({
              latitude: p.latitude,
              longitude: p.longitude,
              speedKmh: p.speed_kmh,
              fixTime: p.fix_time,
              course: p.course,
              batteryLevel: p.battery_level
            }));
            return sendJson(res, 200, {
              source: 'geopanel_postgresql',
              vehicleName: vehicle.name,
              points,
              summary: summarizeRoute(points)
            });
          }
        } catch (_) {}
      }

      // Si tiene TraccarDeviceId, consultar a través del adapter
      if (
        vehicle.traccarDeviceId &&
        db.traccarConfig.url &&
        db.traccarConfig.email &&
        db.traccarConfig.password
      ) {
        try {
          const positions = await telemetryService.provider.getHistory(
            db.traccarConfig,
            vehicle.traccarDeviceId,
            fromDate,
            toDate
          );

          if (Array.isArray(positions) && positions.length > 0) {
            const points = positions.map((p) => ({
              latitude: p.latitude,
              longitude: p.longitude,
              speedKmh: +(Number(p.speed || 0) * 1.852).toFixed(1),
              fixTime: p.fixTime || p.deviceTime
            }));
            return sendJson(res, 200, {
              source: 'telemetry_engine',
              vehicleName: vehicle.name,
              points,
              summary: summarizeRoute(points)
            });
          }
        } catch (err) {
          // Continuar con fallback si Traccar falla
        }
      }

      // Recorrido demostrativo en Santa Cruz para vehículos demo
      const baseLat = vehicle.lastPosition?.latitude || -17.7833;
      const baseLng = vehicle.lastPosition?.longitude || -63.1821;
      const demoPoints = [
        { latitude: baseLat - 0.018, longitude: baseLng - 0.022, speedKmh: 0, fixTime: new Date(Date.now() - 7200000).toISOString() },
        { latitude: baseLat - 0.014, longitude: baseLng - 0.016, speedKmh: 34.2, fixTime: new Date(Date.now() - 5800000).toISOString() },
        { latitude: baseLat - 0.009, longitude: baseLng - 0.011, speedKmh: 45.8, fixTime: new Date(Date.now() - 4200000).toISOString() },
        { latitude: baseLat - 0.005, longitude: baseLng - 0.004, speedKmh: 0, fixTime: new Date(Date.now() - 2800000).toISOString() },
        { latitude: baseLat - 0.002, longitude: baseLng - 0.002, speedKmh: 29.5, fixTime: new Date(Date.now() - 1200000).toISOString() },
        { latitude: baseLat, longitude: baseLng, speedKmh: vehicle.lastPosition?.speedKmh || 18.0, fixTime: new Date().toISOString() }
      ];

      return sendJson(res, 200, {
        source: 'demo',
        vehicleName: vehicle.name,
        points: demoPoints,
        summary: summarizeRoute(demoPoints)
      });
    }

    // 7. GESTIÓN DE EMPRESAS Y USUARIOS
    if (pathname === '/api/companies' && req.method === 'GET') {
      const user = getAuthUser(req, db);
      if (!user) return sendJson(res, 401, { error: 'No autorizado' });
      if (!hasPermission(user, PERMISSIONS.COMPANY_READ)) {
        return sendJson(res, 403, { error: 'Sin permiso para consultar empresas' });
      }

      if (user.role !== ROLES.SUPERADMIN) {
        const own = db.companies.filter((c) => c.id === user.companyId);
        return sendJson(res, 200, { companies: own });
      }

      const companiesWithCounts = db.companies.map((c) => ({
        ...c,
        vehicleCount: db.vehicles.filter((v) => v.companyId === c.id).length,
        userCount: db.users.filter((u) => u.companyId === c.id).length
      }));
      return sendJson(res, 200, {
        companies: companiesWithCounts,
        users: db.users.map((u) => ({
          id: u.id,
          name: u.name,
          email: u.email,
          role: u.role,
          companyId: u.companyId,
          isActive: u.isActive !== false
        }))
      });
    }

    if (pathname === '/api/companies' && req.method === 'POST') {
      const user = getAuthUser(req, db);
      if (!user || !hasPermission(user, PERMISSIONS.COMPANY_CREATE)) {
        return sendJson(res, 403, { error: 'Acceso denegado: No tiene permiso para crear empresas (companies:create)' });
      }
      const { name, nit, phone, plan, adminName, adminEmail, adminPassword } = await parseBody(req);
      if (!name) return sendJson(res, 400, { error: 'El nombre de la empresa es obligatorio' });

      const newCompany = {
        id: `comp-${Date.now()}`,
        name: name.trim(),
        nit: (nit || 'S/N').trim(),
        phone: (phone || '').trim(),
        city: 'Santa Cruz de la Sierra',
        plan: plan || 'Plan PyME (Hasta 10 GPS)',
        status: 'active',
        createdAt: new Date().toISOString()
      };
      db.companies.push(newCompany);

      if (adminEmail && adminPassword) {
        db.users.push({
          id: `usr-${Date.now()}`,
          name: (adminName || `Admin ${name}`).trim(),
          email: adminEmail.trim().toLowerCase(),
          password: hashPassword(adminPassword),
          role: ROLES.COMPANY_ADMIN,
          companyId: newCompany.id,
          isActive: true
        });
      }

      saveDb(db);
      if (telemetryRepository) {
        try { await telemetryRepository.syncCompany(newCompany); } catch (_) {}
      }
      return sendJson(res, 201, { company: newCompany });
    }

    // 8. CREAR NUEVO DISPOSITIVO
    if (pathname === '/api/vehicles' && req.method === 'POST') {
      const user = getAuthUser(req, db);
      if (!user) return sendJson(res, 401, { error: 'No autorizado' });
      if (!hasPermission(user, PERMISSIONS.DEVICE_CREATE)) {
        return sendJson(res, 403, { error: 'Sin permiso para registrar dispositivos' });
      }

      const {
        name,
        uniqueId,
        companyId,
        phone,
        plate,
        driver,
        type,
        expirationTime,
        disabled
      } = await parseBody(req);

      if (!name || !uniqueId) {
        return sendJson(res, 400, { error: 'El nombre y el Identificador único son obligatorios' });
      }

      const cleanUniqueId = String(uniqueId).trim();
      const targetCompanyId = user.role === ROLES.SUPERADMIN ? (companyId || db.companies[0]?.id) : user.companyId;

      let traccarDevice = null;
      if (db.traccarConfig.url && db.traccarConfig.email && db.traccarConfig.password) {
        try {
          const payload = {
            name: name.trim(),
            uniqueId: cleanUniqueId,
            phone: (phone || '').trim(),
            model: (plate || '').trim(),
            contact: (driver || '').trim(),
            category: type || 'default',
            expirationTime: expirationTime ? new Date(expirationTime).toISOString() : null,
            disabled: !!disabled
          };
          traccarDevice = await telemetryService.provider.createDevice(db.traccarConfig, payload);
        } catch (err) {
          // Continuar guardando localmente si el proveedor remoto arroja advertencia
          console.warn('Aviso en proveedor de telemetría:', err.message);
        }
      }

      let localVeh = db.vehicles.find((v) => v.uniqueId === cleanUniqueId);
      if (!localVeh) {
        localVeh = {
          id: traccarDevice ? `veh-traccar-${traccarDevice.id}` : `veh-local-${Date.now()}`,
          traccarDeviceId: traccarDevice ? traccarDevice.id : null,
          uniqueId: cleanUniqueId,
          deviceToken: `tok-${cleanUniqueId}`,
          name: name.trim(),
          phone: (phone || '').trim(),
          plate: (plate || '').trim(),
          driver: (driver || '').trim(),
          companyId: targetCompanyId,
          type: type || 'default',
          expirationTime: expirationTime ? new Date(expirationTime).toISOString() : null,
          disabled: !!disabled,
          isDemo: false,
          traccarStatus: 'offline',
          lastUpdate: null,
          lastPosition: {
            latitude: -17.7833,
            longitude: -63.1821,
            speedKmh: 0,
            speedKnots: 0,
            totalDistanceKm: 0,
            course: 0,
            status: 'offline',
            ignition: false,
            batteryLevel: null,
            accuracy: null,
            address: null,
            streetName: null,
            fixTime: new Date().toISOString()
          }
        };
        db.vehicles.unshift(localVeh);
      } else {
        localVeh.name = name.trim();
        localVeh.phone = (phone || '').trim();
        localVeh.plate = (plate || '').trim();
        localVeh.driver = (driver || '').trim();
        localVeh.companyId = targetCompanyId;
        localVeh.type = type || localVeh.type;
        localVeh.expirationTime = expirationTime ? new Date(expirationTime).toISOString() : null;
        localVeh.disabled = !!disabled;
      }

      saveDb(db);
      if (telemetryRepository) {
        try { await telemetryRepository.syncDevice(localVeh); } catch (_) {}
      }
      return sendJson(res, 201, {
        message: `Dispositivo "${name}" registrado correctamente.`,
        vehicle: localVeh
      });
    }

    // 9. EDITAR DISPOSITIVO
    if (pathname.startsWith('/api/vehicles/') && req.method === 'PUT') {
      const user = getAuthUser(req, db);
      if (!user) return sendJson(res, 401, { error: 'No autorizado' });
      if (!hasPermission(user, PERMISSIONS.DEVICE_UPDATE)) {
        return sendJson(res, 403, { error: 'Sin permiso para editar dispositivos' });
      }

      const vehId = pathname.split('/')[3];
      const veh = db.vehicles.find((v) => v.id === vehId);
      if (!veh) return sendJson(res, 404, { error: 'Dispositivo no encontrado' });

      if (user.role !== ROLES.SUPERADMIN && veh.companyId !== user.companyId) {
        return sendJson(res, 403, { error: 'No tienes permiso para editar este dispositivo' });
      }

      const {
        companyId,
        name,
        uniqueId,
        phone,
        plate,
        driver,
        type,
        expirationTime,
        disabled
      } = await parseBody(req);

      if (companyId !== undefined && user.role === ROLES.SUPERADMIN) veh.companyId = companyId;
      if (name !== undefined) veh.name = name.trim();
      if (uniqueId !== undefined) veh.uniqueId = String(uniqueId).trim();
      if (phone !== undefined) veh.phone = phone.trim();
      if (plate !== undefined) veh.plate = plate.trim();
      if (driver !== undefined) veh.driver = driver.trim();
      if (type !== undefined) veh.type = type;
      if (expirationTime !== undefined) {
        veh.expirationTime = expirationTime ? new Date(expirationTime).toISOString() : null;
      }
      if (disabled !== undefined) veh.disabled = !!disabled;

      // Sincronizar actualización con proveedor si corresponde
      if (veh.traccarDeviceId && db.traccarConfig.url && db.traccarConfig.email && db.traccarConfig.password) {
        try {
          await telemetryService.provider.updateDevice(db.traccarConfig, veh.traccarDeviceId, {
            name: veh.name,
            uniqueId: veh.uniqueId,
            phone: veh.phone || '',
            model: veh.plate || '',
            contact: veh.driver || '',
            category: veh.type || 'default',
            expirationTime: veh.expirationTime || null,
            disabled: !!veh.disabled
          });
        } catch (err) {
          console.warn('Aviso en proveedor de telemetría:', err.message);
        }
      }

      saveDb(db);
      if (telemetryRepository) {
        telemetryRepository.syncDevice(veh).catch(() => {});
      }
      return sendJson(res, 200, { vehicle: veh });
    }

    // 10. ELIMINAR DISPOSITIVO
    if (pathname.startsWith('/api/vehicles/') && req.method === 'DELETE') {
      const user = getAuthUser(req, db);
      if (!user) return sendJson(res, 401, { error: 'No autorizado' });
      if (!hasPermission(user, PERMISSIONS.DEVICE_DELETE)) {
        return sendJson(res, 403, { error: 'Sin permiso para eliminar dispositivos' });
      }

      const vehId = pathname.split('/')[3];
      const vehIndex = db.vehicles.findIndex((v) => v.id === vehId);
      if (vehIndex === -1) return sendJson(res, 404, { error: 'Dispositivo no encontrado' });

      const veh = db.vehicles[vehIndex];
      if (user.role !== ROLES.SUPERADMIN && veh.companyId !== user.companyId) {
        return sendJson(res, 403, { error: 'No tienes permiso para eliminar este dispositivo' });
      }

      if (veh.traccarDeviceId && db.traccarConfig.url && db.traccarConfig.email && db.traccarConfig.password) {
        try {
          await telemetryService.provider.deleteDevice(db.traccarConfig, veh.traccarDeviceId);
        } catch (err) {
          console.warn('Aviso al eliminar en proveedor:', err.message);
        }
      }

      db.vehicles.splice(vehIndex, 1);
      saveDb(db);
      return sendJson(res, 200, { ok: true });
    }

    // ====================================================================
    // VINCULACIÓN SEGURA MEDIANTE QR / OTP Y REVOCACIÓN DE TOKEN (OT-006)
    // ====================================================================

    // 10.1 GENERAR CÓDIGO QR / OTP TEMPORAL DE VINCULACIÓN (Solo ADMIN / SUPERADMIN)
    if ((pathname.endsWith('/pairing-code') && req.method === 'POST') &&
        (pathname.startsWith('/api/vehicles/') || pathname.startsWith('/api/v1/devices/'))) {
      const user = getAuthUser(req, db);
      if (!user) return sendJson(res, 401, { error: 'No autorizado' });

      const parts = pathname.split('/').filter(Boolean);
      const devId = parts[parts.length - 2];
      const dev = db.vehicles.find((v) => v.id === devId || v.uniqueId === devId);
      if (!dev) return sendJson(res, 404, { error: 'Dispositivo no encontrado' });

      if (user.role !== ROLES.SUPERADMIN && dev.companyId !== user.companyId) {
        return sendJson(res, 403, { error: 'Sin permiso para gestionar este dispositivo' });
      }

      const pairingCode = `GP-${Math.floor(100000 + Math.random() * 900000)}`;
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

      dev.pairingCode = pairingCode;
      dev.pairingExpiresAt = expiresAt;
      saveDb(db);

      const host = req.headers.host || 'localhost:3000';
      const proto = req.headers['x-forwarded-proto'] || 'http';
      const serverUrl = `${proto}://${host}`;

      const qrPayload = JSON.stringify({
        type: 'geopanel_pair',
        v: 1,
        serverUrl,
        code: pairingCode,
        uniqueId: dev.uniqueId
      });

      return sendJson(res, 200, {
        ok: true,
        code: pairingCode,
        expiresAt,
        expiresInSeconds: 600,
        serverUrl,
        qrPayload
      });
    }

    // 10.2 VINCULACIÓN MÓVIL MEDIANTE CÓDIGO OTP (Público desde app Android)
    if ((pathname === '/api/v1/devices/pair' || pathname === '/api/devices/pair') && req.method === 'POST') {
      const body = await parseBody(req);
      const { code, deviceModel, appVersion } = body;

      if (!code || typeof code !== 'string') {
        return sendJson(res, 400, { error: 'El código de vinculación es requerido' });
      }

      const cleanCode = code.trim().toUpperCase();
      const dev = db.vehicles.find((v) => v.pairingCode && v.pairingCode.toUpperCase() === cleanCode);

      if (!dev) {
        return sendJson(res, 404, { error: 'Código de vinculación inválido o no encontrado' });
      }

      if (new Date(dev.pairingExpiresAt).getTime() < Date.now()) {
        dev.pairingCode = null;
        dev.pairingExpiresAt = null;
        saveDb(db);
        return sendJson(res, 400, { error: 'El código de vinculación ha expirado. Solicita uno nuevo en el panel de administración.' });
      }

      const rawToken = 'tok-' + crypto.randomBytes(20).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

      dev.deviceToken = rawToken;
      dev.deviceTokenHash = tokenHash;
      dev.pairingCode = null;
      dev.pairingExpiresAt = null;
      dev.pairedAt = new Date().toISOString();
      dev.pairedModel = deviceModel || 'Android Device';
      dev.appVersion = appVersion || '1.0.0';

      saveDb(db);

      if (telemetryRepository) {
        try { await telemetryRepository.updateDeviceTokenHash(dev.uniqueId, tokenHash); } catch (_) {}
      }

      const company = db.companies.find((c) => c.id === dev.companyId);
      const host = req.headers.host || 'localhost:3000';
      const proto = req.headers['x-forwarded-proto'] || 'http';

      return sendJson(res, 200, {
        ok: true,
        uniqueId: dev.uniqueId,
        deviceToken: rawToken,
        companyName: company ? company.name : 'GEO-PANEL Flota',
        serverUrl: `${proto}://${host}`
      });
    }

    // 10.3 REVOCAR CREDENCIAL DE DISPOSITIVO (Solo ADMIN / SUPERADMIN)
    if ((pathname.endsWith('/revoke-token') && req.method === 'POST') &&
        (pathname.startsWith('/api/vehicles/') || pathname.startsWith('/api/v1/devices/'))) {
      const user = getAuthUser(req, db);
      if (!user) return sendJson(res, 401, { error: 'No autorizado' });

      const parts = pathname.split('/').filter(Boolean);
      const devId = parts[parts.length - 2];
      const dev = db.vehicles.find((v) => v.id === devId || v.uniqueId === devId);
      if (!dev) return sendJson(res, 404, { error: 'Dispositivo no encontrado' });

      if (user.role !== ROLES.SUPERADMIN && dev.companyId !== user.companyId) {
        return sendJson(res, 403, { error: 'Sin permiso para revocar este dispositivo' });
      }

      dev.deviceToken = null;
      dev.deviceTokenHash = null;
      dev.revokedAt = new Date().toISOString();
      saveDb(db);

      if (telemetryRepository) {
        try { await telemetryRepository.updateDeviceTokenHash(dev.uniqueId, null); } catch (_) {}
      }

      return sendJson(res, 200, {
        ok: true,
        message: `Credencial del dispositivo "${dev.name}" revocada exitosamente. Ya no podrá transmitir coordenadas.`
      });
    }

    // 11. GEOCODIFICACIÓN INVERSA
    if (pathname === '/api/geocode' && req.method === 'GET') {
      const user = getAuthUser(req, db);
      if (!user) return sendJson(res, 401, { error: 'No autorizado' });

      const lat = parsedUrl.searchParams.get('lat');
      const lng = parsedUrl.searchParams.get('lng');
      const vehicleId = parsedUrl.searchParams.get('vehicleId');
      if (!lat || !lng) return sendJson(res, 400, { error: 'Faltan coordenadas' });

      let street = `${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}`;
      const geoController = new AbortController();
      const geoTimeout = setTimeout(() => geoController.abort(), 5000);
      try {
        const nomRes = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(
            lat
          )}&lon=${encodeURIComponent(lng)}&accept-language=es`,
          {
            signal: geoController.signal,
            headers: { 'User-Agent': 'GEO-PANEL-Bolivia/1.0' }
          }
        );
        if (nomRes.ok) {
          const nomData = await nomRes.json();
          if (nomData && nomData.display_name) {
            const parts = nomData.display_name.split(',').slice(0, 3);
            street = parts.join(',').trim();
          }
        }
      } catch (err) {
        // Fallback
      } finally {
        clearTimeout(geoTimeout);
      }

      if (vehicleId) {
        const veh = db.vehicles.find((v) => v.id === vehicleId);
        if (veh && veh.lastPosition) {
          veh.lastPosition.streetName = street;
          veh.lastPosition.address = street;
          saveDb(db);
        }
      }

      return sendJson(res, 200, { street });
    }

    // 12. SERVIR ARCHIVOS ESTÁTICOS DE LA SPA
    let filePath = pathname === '/' ? path.join(PUBLIC_DIR, 'index.html') : path.join(PUBLIC_DIR, pathname);
    if (!filePath.startsWith(PUBLIC_DIR)) {
      res.writeHead(403);
      return res.end('Forbidden');
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
      return fs.createReadStream(filePath).pipe(res);
    }

    // Fallback SPA
    const indexHtml = path.join(PUBLIC_DIR, 'index.html');
    if (fs.existsSync(indexHtml)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return fs.createReadStream(indexHtml).pipe(res);
    }

    res.writeHead(404);
    res.end('Not Found');
  } catch (err) {
    console.error('Error en API GEO-PANEL:', err);
    return sendJson(res, 500, { error: err.message || 'Error interno del servidor' });
  }
});

// ====================================================================
// 7. FUNCIONES AUXILIARES DE RUTA Y DISTANCIA
// ====================================================================
function summarizeRoute(points) {
  if (!points || points.length < 2) {
    return { distanceKm: 0, maxSpeedKmh: 0, stopsCount: 0, pointsCount: points ? points.length : 0 };
  }
  let distKm = 0;
  let maxSpeed = 0;
  let stops = 0;

  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (p.speedKmh > maxSpeed) maxSpeed = p.speedKmh;
    if (p.speedKmh < 1) stops++;
    if (i > 0) {
      distKm += haversineKm(points[i - 1].latitude, points[i - 1].longitude, p.latitude, p.longitude);
    }
  }
  return {
    distanceKm: +distKm.toFixed(2),
    maxSpeedKmh: +maxSpeed.toFixed(1),
    stopsCount: stops,
    pointsCount: points.length
  };
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ====================================================================
// 8. PROTECCIÓN DEL PROCESO Y APAGADO ELEGANTE (SRE)
// ====================================================================
process.on('uncaughtException', (err) => {
  console.error('Error controlado (uncaughtException):', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('Promesa rechazada controlada (unhandledRejection):', reason);
});

let isShuttingDown = false;
function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`\n🛑 Señal ${signal} recibida. Cerrando GEO-PANEL de forma segura...`);
  try {
    if (memoryDb) {
      saveDb(memoryDb);
      console.log('💾 Estado guardado atómicamente en disco.');
    }
    const { closePool } = require('./db/pg.js');
    closePool().catch(() => {});
  } catch (err) {
    console.error('Error guardando estado durante apagado:', err.message);
  }
  server.close(() => {
    console.log('✅ Conexiones HTTP finalizadas limpiamente.');
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Iniciar servidor si se ejecuta directamente
if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`====================================================`);
    console.log(`🚀 GEO-PANEL ejecutándose en http://localhost:${PORT} y en red Wi-Fi (0.0.0.0:${PORT})`);
    console.log(`📍 Proveedor de telemetría: ${process.env.TELEMETRY_PROVIDER || 'traccar'}`);
    console.log(`🛡️ Blindaje SRE/OWASP activo (scrypt, RBAC, Rate-Limit, Singleflight, Graceful Shutdown)`);
    console.log(`====================================================`);
  });
}

module.exports = {
  server,
  loadDb,
  saveDb,
  hashPassword,
  verifyPassword,
  hashDeviceToken,
  verifyDeviceToken,
  resolveTokenSecret,
  telemetryService,
  ROLES,
  PERMISSIONS,
  hasPermission
};
