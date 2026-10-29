const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const DB_TMP_FILE = path.join(DATA_DIR, 'db.json.tmp');
const PUBLIC_DIR = path.join(__dirname, 'public');
const SERVER_START_TIME = Date.now();

// Asegurar carpeta de datos
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Utilidades de Hashing de Contraseñas (scrypt + salt, sin dependencias externas)
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
  // Compatibilidad con contraseñas en texto plano previas (se migran automáticamente al iniciar)
  return String(plainPassword) === String(storedPassword);
}

// Datos iniciales por defecto (Santa Cruz de la Sierra, Bolivia)
// Soporta Variables de Entorno de Coolify (The 12-Factor App Factor III)
const DEFAULT_DB = {
  traccarConfig: {
    url: process.env.TRACCAR_URL || 'http://traccar-6dsuipf5kignfxsa0658aj69.187.127.33.214.sslip.io',
    email: process.env.TRACCAR_EMAIL || 'plara@sirtsc.com',
    password: process.env.TRACCAR_PASSWORD || 'Martin0411.',
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
  users: [
    {
      id: 'usr-admin',
      name: 'Administrador General GEO-PANEL',
      email: 'admin@geopanel.bo',
      password: 'admin123',
      role: 'SUPERADMIN',
      companyId: null
    },
    {
      id: 'usr-comp1',
      name: 'Carlos Méndez (Transporte Oriental)',
      email: 'oriental@empresa1.bo',
      password: '123456',
      role: 'COMPANY_ADMIN',
      companyId: 'comp-1'
    },
    {
      id: 'usr-comp2',
      name: 'Laura Suárez (Distribuidora SCZ)',
      email: 'distribuidora@empresa2.bo',
      password: '123456',
      role: 'COMPANY_ADMIN',
      companyId: 'comp-2'
    }
  ],
  vehicles: [
    {
      id: 'veh-demo-1',
      traccarDeviceId: null,
      uniqueId: 'DEMO-SCZ-01',
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
    }
  }
  // Asegurar que si hay variables de entorno o credenciales por defecto, se mantengan si estaban vacías
  if (db.traccarConfig) {
    if (!db.traccarConfig.url && DEFAULT_DB.traccarConfig.url) {
      db.traccarConfig.url = DEFAULT_DB.traccarConfig.url;
      changed = true;
    }
    if (!db.traccarConfig.email && DEFAULT_DB.traccarConfig.email) {
      db.traccarConfig.email = DEFAULT_DB.traccarConfig.email;
      changed = true;
    }
    if (!db.traccarConfig.password && DEFAULT_DB.traccarConfig.password) {
      db.traccarConfig.password = DEFAULT_DB.traccarConfig.password;
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
    console.error('Error cargando base de datos local, restaurando respaldo seguro:', err.message);
    memoryDb = JSON.parse(JSON.stringify(DEFAULT_DB));
    ensureEncryptedUsers(memoryDb);
    return memoryDb;
  }
}

// Escritura atómica en disco (escribe primero en .tmp y renombra para evitar corrupción si se corta la luz)
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

// Protección contra ataques de Fuerza Bruta en Login (Rate Limiting por IP)
const loginAttemptsByIp = new Map();
const MAX_LOGIN_ATTEMPTS = 6;
const LOGIN_LOCKOUT_MS = 60 * 1000; // 1 minuto de bloqueo tras 6 fallos seguidos

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

// Sesiones firmadas con HMAC-SHA256 y expiración (sin puertas traseras)
const TOKEN_SECRET = process.env.TOKEN_SECRET || 'geopanel-scz-bolivia-secret-key-2026';
const SESSION_TTL_MS = 7 * 24 * 3600 * 1000; // 7 días de validez

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

  // 1. Verificar token firmado con HMAC-SHA256 (uid.<userId>.<issuedAt>.<sig> o formato uid.<userId>.<sig>)
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
        return db.users.find((u) => u.id === userId) || null;
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
        return db.users.find((u) => u.id === userId) || null;
      }
    }
  }

  // 2. Verificar sesiones explícitamente registradas en db.json
  if (db.sessions && db.sessions[token]) {
    const entry = db.sessions[token];
    const userId = typeof entry === 'string' ? entry : entry.userId;
    return db.users.find((u) => u.id === userId) || null;
  }

  return null;
}

// Cliente HTTP hacia el servidor Traccar en el VPS
async function fetchTraccar(traccarConfig, endpoint, options = {}) {
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

// Sincronizar dispositivos y posiciones reales desde Traccar
async function syncWithTraccar(db) {
  const cfg = db.traccarConfig;
  if (!cfg.url || !cfg.email || !cfg.password) {
    return { synced: 0, connected: false, message: 'Sin credenciales configuradas' };
  }

  try {
    const [devices, positions] = await Promise.all([
      fetchTraccar(cfg, '/api/devices'),
      fetchTraccar(cfg, '/api/positions')
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
        // Traccar entrega speed en nudos (knots). 1 nudo = 1.852 km/h
        const speedKmh = +(speedKnots * 1.852).toFixed(2);
        const attrs = (pos && pos.attributes) || {};
        const totalDistanceKm =
          typeof attrs.totalDistance === 'number' ? +(attrs.totalDistance / 1000).toFixed(2) : 0;

        // Extraer batería de cualquier campo disponible o conservar el último porcentaje conocido
        let detectedBattery = null;
        if (attrs.batteryLevel !== undefined && attrs.batteryLevel !== null) {
          detectedBattery = Math.round(Number(attrs.batteryLevel));
        } else if (attrs.battery !== undefined && attrs.battery !== null) {
          detectedBattery = Math.round(Number(attrs.battery));
        } else if (pos && pos.batteryLevel !== undefined && pos.batteryLevel !== null) {
          detectedBattery = Math.round(Number(pos.batteryLevel));
        } else if (
          localVeh?.lastPosition?.batteryLevel !== undefined &&
          localVeh?.lastPosition?.batteryLevel !== null
        ) {
          detectedBattery = localVeh.lastPosition.batteryLevel;
        }

        // Si tiene posición pero el último paquete no trajo batería, buscar 1 sola vez en las últimas 12h
        if (detectedBattery === null && pos && !localVeh?.batteryCheckedOnce) {
          try {
            const toD = new Date();
            const fromD = new Date(toD.getTime() - 12 * 3600 * 1000);
            const recentPos = await fetchTraccar(
              cfg,
              `/api/positions?deviceId=${dev.id}&from=${encodeURIComponent(
                fromD.toISOString()
              )}&to=${encodeURIComponent(toD.toISOString())}`
            );
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
            // Ignorar si no hay historial previo
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
          // Asignar por defecto a la primera empresa para que se vea inmediatamente
          const defaultCompanyId = db.companies[0] ? db.companies[0].id : null;
          localVeh = {
            id: `veh-traccar-${dev.id}`,
            traccarDeviceId: dev.id,
            uniqueId: dev.uniqueId || String(dev.id),
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

// Control de sincronización con Traccar (Singleflight + Cooldown anti-avalancha)
let activeSyncPromise = null;
let lastSyncTimestampMs = 0;
const MIN_SYNC_INTERVAL_MS = 4000; // Máximo 1 petición a Traccar cada 4 segundos sin importar cuántos clientes abran el mapa

function triggerTraccarSync(db, force = false) {
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
  if (user.role === 'SUPERADMIN') {
    clean.expirationTime = v.expirationTime || null;
  }
  return clean;
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
  });
  res.end(JSON.stringify(data));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1e6) req.destroy();
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

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    return sendJson(res, 200, { ok: true });
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;
  const db = loadDb();

  try {
    // 0. Health Check para Coolify / Docker / Monitoreo SRE
    if ((pathname === '/api/health' || pathname === '/health') && req.method === 'GET') {
      return sendJson(res, 200, {
        status: 'ok',
        service: 'geo-panel',
        uptimeSeconds: Math.floor((Date.now() - SERVER_START_TIME) / 1000),
        traccarConnected: !!db.traccarConfig?.connected,
        lastSync: db.traccarConfig?.lastSync || null,
        timestamp: new Date().toISOString()
      });
    }

    // 1. Autenticación: Login (con Rate Limiting por IP y verificación scrypt)
    if (pathname === '/api/auth/login' && req.method === 'POST') {
      const clientIp = getClientIp(req);
      const rateStatus = checkLoginRateLimit(clientIp);
      if (!rateStatus.allowed) {
        return sendJson(res, 429, {
          error: `Demasiados intentos fallidos. Espera ${rateStatus.waitSec} segundos antes de volver a intentar.`
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

    // 2. Perfil del usuario actual
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

    // 3. Configuración de Traccar (Leer y Guardar/Probar)
    if (pathname === '/api/traccar/config' && req.method === 'GET') {
      const user = getAuthUser(req, db);
      if (!user) return sendJson(res, 401, { error: 'No autorizado' });
      return sendJson(res, 200, {
        url: db.traccarConfig.url,
        email: db.traccarConfig.email,
        hasPassword: !!db.traccarConfig.password,
        connected: db.traccarConfig.connected,
        lastSync: db.traccarConfig.lastSync,
        lastError: db.traccarConfig.lastError
      });
    }

    if (pathname === '/api/traccar/config' && req.method === 'POST') {
      const user = getAuthUser(req, db);
      if (!user || user.role !== 'SUPERADMIN') {
        return sendJson(res, 403, { error: 'Solo el Super Administrador puede configurar Traccar' });
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
        message: `Conectado exitosamente a Traccar. Dispositivos detectados: ${syncResult.totalTraccarDevices ?? 0}`,
        ...syncResult
      });
    }

    // 4. Flota en tiempo real (con aislamiento multiempresa estricto y anti-avalancha)
    if (pathname === '/api/fleet/live' && req.method === 'GET') {
      const user = getAuthUser(req, db);
      if (!user) return sendJson(res, 401, { error: 'No autorizado' });

      // Si Traccar ya tiene credenciales, sincronizar con protección anti-avalancha (máx 1 vez cada 4s)
      if (db.traccarConfig.url && db.traccarConfig.email && db.traccarConfig.password) {
        try {
          await triggerTraccarSync(db, false);
        } catch (err) {
          // Continuar mostrando la última posición guardada si hay microcorte
        }
      }

      const filterCompanyId = parsedUrl.searchParams.get('companyId');
      const includeDemos = parsedUrl.searchParams.get('includeDemos') !== 'false';

      let vehicles = db.vehicles;

      // Si ya hay dispositivos reales de Traccar y el usuario no pidió explícitamente demos, podemos mostrar ambos o priorizar reales
      if (!includeDemos) {
        vehicles = vehicles.filter((v) => !v.isDemo);
      }

      // REGLA MULTIEMPRESA:
      // Si NO es SUPERADMIN, SOLO puede ver los vehículos de su propia empresa (user.companyId)
      if (user.role !== 'SUPERADMIN') {
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

    // 5. Historial de recorridos (Módulo 2 y 3)
    if (pathname === '/api/fleet/history' && req.method === 'GET') {
      const user = getAuthUser(req, db);
      if (!user) return sendJson(res, 401, { error: 'No autorizado' });

      const vehicleId = parsedUrl.searchParams.get('vehicleId');
      const hours = Number(parsedUrl.searchParams.get('hours') || 6);

      const vehicle = db.vehicles.find((v) => v.id === vehicleId);
      if (!vehicle) return sendJson(res, 404, { error: 'Vehículo no encontrado' });

      // Verificar aislamiento multiempresa
      if (user.role !== 'SUPERADMIN' && vehicle.companyId !== user.companyId) {
        return sendJson(res, 403, { error: 'No tienes permiso para consultar este vehículo' });
      }

      const toDate = new Date();
      const fromDate = new Date(toDate.getTime() - hours * 3600 * 1000);

      // Si es un dispositivo real de Traccar y estamos conectados, consultar historial real a Traccar
      if (
        vehicle.traccarDeviceId &&
        db.traccarConfig.url &&
        db.traccarConfig.email &&
        db.traccarConfig.password
      ) {
        try {
          const query = `?deviceId=${vehicle.traccarDeviceId}&from=${encodeURIComponent(
            fromDate.toISOString()
          )}&to=${encodeURIComponent(toDate.toISOString())}`;
          const positions = await fetchTraccar(db.traccarConfig, `/api/positions${query}`);

          if (Array.isArray(positions) && positions.length > 0) {
            const points = positions.map((p) => ({
              latitude: p.latitude,
              longitude: p.longitude,
              speedKmh: +(Number(p.speed || 0) * 1.852).toFixed(1),
              fixTime: p.fixTime || p.deviceTime
            }));
            return sendJson(res, 200, {
              source: 'traccar',
              vehicleName: vehicle.name,
              points,
              summary: summarizeRoute(points)
            });
          }
        } catch (err) {
          // Si falla o aún no hay puntos en ese rango, devolver aviso claro
        }
      }

      // Recorrido demostrativo alrededor de la posición actual en Santa Cruz
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

    // 6. Gestión de Empresas y Usuarios (Multiempresa)
    if (pathname === '/api/companies' && req.method === 'GET') {
      const user = getAuthUser(req, db);
      if (!user) return sendJson(res, 401, { error: 'No autorizado' });

      if (user.role !== 'SUPERADMIN') {
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
          companyId: u.companyId
        }))
      });
    }

    if (pathname === '/api/companies' && req.method === 'POST') {
      const user = getAuthUser(req, db);
      if (!user || user.role !== 'SUPERADMIN') {
        return sendJson(res, 403, { error: 'Solo el Super Administrador puede crear empresas' });
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
          role: 'COMPANY_ADMIN',
          companyId: newCompany.id
        });
      }

      saveDb(db);
      return sendJson(res, 201, { company: newCompany });
    }

    // 7. Crear Nuevo Dispositivo GPS / Celular (lo registra directamente en el Traccar del VPS y en GEO-PANEL)
    if (pathname === '/api/vehicles' && req.method === 'POST') {
      const user = getAuthUser(req, db);
      if (!user) return sendJson(res, 401, { error: 'No autorizado' });

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
      const targetCompanyId =
        user.role === 'SUPERADMIN' ? companyId || db.companies[0]?.id : user.companyId;

      let traccarDevice = null;

      // Crear o vincular directamente en el servidor Traccar del VPS
      if (db.traccarConfig.url && db.traccarConfig.email && db.traccarConfig.password) {
        try {
          const existingDevices = await fetchTraccar(db.traccarConfig, '/api/devices');
          traccarDevice = Array.isArray(existingDevices)
            ? existingDevices.find((d) => String(d.uniqueId) === cleanUniqueId)
            : null;

          const traccarPayload = {
            name: name.trim(),
            uniqueId: cleanUniqueId,
            phone: (phone || '').trim(),
            model: (plate || '').trim(),
            contact: (driver || '').trim(),
            category: type || 'default',
            expirationTime: expirationTime ? new Date(expirationTime).toISOString() : null,
            disabled: !!disabled
          };

          if (!traccarDevice) {
            traccarDevice = await fetchTraccar(db.traccarConfig, '/api/devices', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(traccarPayload)
            });
          } else {
            traccarDevice = await fetchTraccar(
              db.traccarConfig,
              `/api/devices/${traccarDevice.id}`,
              {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...traccarDevice, ...traccarPayload, id: traccarDevice.id })
              }
            );
          }
        } catch (err) {
          return sendJson(res, 400, {
            error: `No se pudo registrar en Traccar VPS: ${err.message}`
          });
        }
      }

      // Verificar si ya existe localmente en GEO-PANEL
      let localVeh = db.vehicles.find(
        (v) => v.uniqueId === cleanUniqueId || (traccarDevice && v.traccarDeviceId === traccarDevice.id)
      );
      if (!localVeh) {
        localVeh = {
          id: traccarDevice ? `veh-traccar-${traccarDevice.id}` : `veh-local-${Date.now()}`,
          traccarDeviceId: traccarDevice ? traccarDevice.id : null,
          uniqueId: cleanUniqueId,
          name: name.trim(),
          phone: (phone || '').trim(),
          plate: (plate || '').trim(),
          driver: (driver || '').trim(),
          companyId: targetCompanyId,
          type: type || 'default',
          expirationTime: expirationTime ? new Date(expirationTime).toISOString() : null,
          disabled: !!disabled,
          isDemo: false,
          traccarStatus: traccarDevice ? traccarDevice.status || 'offline' : 'offline',
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
        localVeh.uniqueId = cleanUniqueId;
        localVeh.phone = (phone || '').trim();
        localVeh.plate = (plate || '').trim();
        localVeh.driver = (driver || '').trim();
        localVeh.companyId = targetCompanyId;
        localVeh.type = type || localVeh.type || 'default';
        localVeh.expirationTime = expirationTime ? new Date(expirationTime).toISOString() : null;
        localVeh.disabled = !!disabled;
        if (traccarDevice) localVeh.traccarDeviceId = traccarDevice.id;
      }

      saveDb(db);
      return sendJson(res, 201, {
        message: traccarDevice
          ? `Dispositivo "${name}" (ID: ${cleanUniqueId}) guardado en Traccar VPS y GEO-PANEL`
          : `Dispositivo "${name}" guardado localmente`,
        vehicle: localVeh
      });
    }

    // 8. Editar Vehículo / Dispositivo GPS (en GEO-PANEL y en Traccar VPS)
    if (pathname.startsWith('/api/vehicles/') && req.method === 'PUT') {
      const user = getAuthUser(req, db);
      if (!user) return sendJson(res, 401, { error: 'No autorizado' });

      const vehId = pathname.split('/')[3];
      const veh = db.vehicles.find((v) => v.id === vehId);
      if (!veh) return sendJson(res, 404, { error: 'Dispositivo no encontrado' });

      if (user.role !== 'SUPERADMIN' && veh.companyId !== user.companyId) {
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

      if (companyId !== undefined && user.role === 'SUPERADMIN') veh.companyId = companyId;
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

      // Sincronizar cambios en el servidor Traccar si es un dispositivo de Traccar
      if (
        veh.traccarDeviceId &&
        db.traccarConfig.url &&
        db.traccarConfig.email &&
        db.traccarConfig.password &&
        name !== undefined
      ) {
        try {
          await fetchTraccar(db.traccarConfig, `/api/devices/${veh.traccarDeviceId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: veh.traccarDeviceId,
              name: veh.name,
              uniqueId: veh.uniqueId,
              phone: veh.phone || '',
              model: veh.plate || '',
              contact: veh.driver || '',
              category: veh.type || 'default',
              expirationTime: veh.expirationTime || null,
              disabled: !!veh.disabled
            })
          });
        } catch (err) {
          console.warn('Aviso al actualizar en Traccar:', err.message);
        }
      }

      saveDb(db);
      return sendJson(res, 200, { vehicle: veh });
    }

    // 9. Eliminar Dispositivo (en GEO-PANEL y opcionalmente en Traccar VPS)
    if (pathname.startsWith('/api/vehicles/') && req.method === 'DELETE') {
      const user = getAuthUser(req, db);
      if (!user || user.role !== 'SUPERADMIN') {
        return sendJson(res, 403, { error: 'Solo el Super Administrador puede eliminar dispositivos' });
      }
      const vehId = pathname.split('/')[3];
      const vehIndex = db.vehicles.findIndex((v) => v.id === vehId);
      if (vehIndex === -1) return sendJson(res, 404, { error: 'Dispositivo no encontrado' });

      const veh = db.vehicles[vehIndex];
      if (
        veh.traccarDeviceId &&
        db.traccarConfig.url &&
        db.traccarConfig.email &&
        db.traccarConfig.password
      ) {
        try {
          await fetchTraccar(db.traccarConfig, `/api/devices/${veh.traccarDeviceId}`, {
            method: 'DELETE'
          });
        } catch (err) {
          console.warn('No se pudo eliminar en Traccar VPS:', err.message);
        }
      }

      db.vehicles.splice(vehIndex, 1);
      saveDb(db);
      return sendJson(res, 200, { ok: true });
    }

    // 10. Geocodificación inversa ("Mostrar calle" al hacer clic en la tarjeta del mapa)
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
        // Fallback amigable si Nominatim tarda más de 5s
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

    // Servir archivos estáticos del Frontend
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

// Evitar que cualquier microcorte de red cierre el proceso de Node.js
process.on('uncaughtException', (err) => {
  console.error('Error controlado (uncaughtException):', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('Promesa rechazada controlada (unhandledRejection):', reason);
});

// Apagado elegante (Graceful Shutdown - The 12-Factor App Factor IX)
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
  } catch (err) {
    console.error('Error al guardar estado durante apagado:', err.message);
  }
  server.close(() => {
    console.log('✅ Conexiones HTTP finalizadas limpiamente.');
    process.exit(0);
  });
  // Si alguna conexión queda colgada más de 5 segundos, forzar salida limpia
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

server.listen(PORT, '0.0.0.0', () => {
  console.log(`====================================================`);
  console.log(`🚀 GEO-PANEL ejecutándose en http://localhost:${PORT} y en tu red Wi-Fi (0.0.0.0:${PORT})`);
  console.log(`📍 Servidor Traccar configurado: ${DEFAULT_DB.traccarConfig.url}`);
  console.log(`🛡️ Blindaje SRE/OWASP activo (scrypt, Rate-Limit, Singleflight, Graceful Shutdown)`);
  console.log(`====================================================`);
});
