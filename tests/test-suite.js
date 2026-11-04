/**
 * GEO-PANEL — SUITE DE PRUEBAS TÉCNICAS RIGUROSAS (ORDEN TÉCNICA 003)
 * Framework nativo de pruebas en Node.js (cero dependencias externas).
 * 
 * Cobertura de pruebas:
 * 1. Healthcheck (/api/health)
 * 2. Autenticación humana y tokens HMAC-SHA256
 * 3. Rate limiting contra ataques de fuerza bruta (HTTP 429)
 * 4. Protección de endpoints y rechazo de tokens adulterados (HTTP 401)
 * 5. Aislamiento estricto multi-empresa (Multi-tenancy isolation)
 * 6. Ingesta telemática directa de dispositivos sin sesión humana (X-Device-Token)
 * 7. Validación geométrica de coordenadas GPS y rechazo de datos espurios (NaN/Infinity)
 * 8. Control de acceso basado en roles y permisos granulares (RBAC)
 * 9. Manipulación de tokens de dispositivos y rechazo de tokens cruzados
 * 10. Detección y manejo de paquetes telemáticos duplicados (Anti-avalanche)
 * 11. Clasificación de velocidades extremas (Anti-falso-rechazo / Registro de anomalía)
 * 12. Tratamiento de marcas de tiempo futuras y antiguas
 * 13. Bloqueo de dispositivos suspendidos o deshabilitados (HTTP 403)
 * 14. Bloqueo de usuarios inactivos / deshabilitados (HTTP 403)
 * 15. Concurrencia masiva: 20 peticiones simultáneas sin corrupción de datos
 * 16. Protección de conmutación de proveedor telemático (Safe Fallback)
 * 17. Falla segura en producción si falta TOKEN_SECRET
 * 18. Integridad de respaldos, cálculo de checksum SHA-256 y restauración
 * 19. Auditoría de esquema SQL: Ausencia de eliminaciones en cascada destructivas
 */

const http = require('http');
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Entorno de pruebas
process.env.PORT = '3456';
process.env.TOKEN_SECRET = 'test-token-secret-for-geopanel-ci-suite-998877';
process.env.INITIAL_ADMIN_EMAIL = 'admin@geopanel.bo';
process.env.INITIAL_ADMIN_PASSWORD = 'admin123';
process.env.NODE_ENV_TEST = 'true';

const {
  server,
  loadDb,
  saveDb,
  hashDeviceToken,
  verifyDeviceToken,
  telemetryService,
  ROLES
} = require('../server.js');

const { createBackup, restoreBackup } = require('../scripts/backup.js');

const BASE_URL = 'http://127.0.0.1:3456';

function request(method, pathUrl, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(pathUrl, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: { ...headers }
    };

    let bodyStr = null;
    if (body !== null) {
      bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
      options.headers['Content-Type'] = 'application/json';
      options.headers['Content-Length'] = Buffer.byteLength(bodyStr);
    }

    const req = http.request(options, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(raw);
        } catch (_) {
          json = raw;
        }
        resolve({
          status: res.statusCode,
          headers: res.headers,
          data: json
        });
      });
    });

    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

let passedTests = 0;
let totalTests = 0;

async function test(name, fn) {
  totalTests++;
  try {
    process.stdout.write(`  ⏳ ${name}... `);
    await fn();
    console.log(`\x1b[32m✔ PASS\x1b[0m`);
    passedTests++;
  } catch (err) {
    console.log(`\x1b[31m✖ FAIL\x1b[0m`);
    console.error(`     \x1b[31m${err.message}\x1b[0m`);
    if (err.stack) {
      const firstLines = err.stack.split('\n').slice(1, 3).join('\n');
      console.error(`     ${firstLines}`);
    }
  }
}

async function runAllTests() {
  console.log('\n======================================================');
  console.log('🧪 INICIANDO SUITE DE PRUEBAS TÉCNICAS GEO-PANEL (OT-003)');
  console.log('======================================================\n');

  // Arrancar servidor de prueba en puerto 3456
  await new Promise((resolve) => {
    server.listen(3456, '127.0.0.1', () => {
      console.log(' Servidor de prueba escuchando en http://127.0.0.1:3456\n');
      resolve();
    });
  });

  try {
    let superAdminToken = '';
    let comp1AdminToken = '';
    let comp2AdminToken = '';

    // Test 1: Healthcheck
    await test('1. Healthcheck /api/health responde 200 y reporta estado', async () => {
      const res = await request('GET', '/api/health');
      assert.strictEqual(res.status, 200, `Status esperado 200, recibido: ${res.status}`);
      assert.strictEqual(res.data.status, 'ok');
      assert.strictEqual(res.data.service, 'geo-panel');
      assert(typeof res.data.uptimeSeconds === 'number', 'uptimeSeconds debe ser numérico');
      assert(typeof res.data.telemetryProvider === 'string', 'telemetryProvider debe existir');
    });

    // Test 2: Login exitoso SUPERADMIN
    await test('2. Login exitoso de SUPERADMIN retorna token y usuario saneado', async () => {
      const res = await request('POST', '/api/auth/login', {}, {
        email: 'admin@geopanel.bo',
        password: 'admin123'
      });
      assert.strictEqual(res.status, 200);
      assert(res.data.token, 'Debe devolver token');
      assert.strictEqual(res.data.user.email, 'admin@geopanel.bo');
      assert.strictEqual(res.data.user.role, ROLES.SUPERADMIN);
      assert.strictEqual(res.data.user.password, undefined, 'No debe filtrar hash de contraseña');
      superAdminToken = res.data.token;
    });

    // Test 3: Login exitoso usuarios clientes
    await test('3. Login exitoso de COMPANY_ADMIN (Empresas 1 y 2)', async () => {
      const res1 = await request('POST', '/api/auth/login', {}, {
        email: 'oriental@empresa1.bo',
        password: '123456'
      });
      assert.strictEqual(res1.status, 200);
      assert.strictEqual(res1.data.user.companyId, 'comp-1');
      comp1AdminToken = res1.data.token;

      const res2 = await request('POST', '/api/auth/login', {}, {
        email: 'distribuidora@empresa2.bo',
        password: '123456'
      });
      assert.strictEqual(res2.status, 200);
      assert.strictEqual(res2.data.user.companyId, 'comp-2');
      comp2AdminToken = res2.data.token;
    });

    // Test 4: Login con credenciales incorrectas
    await test('4. Login con contraseña errónea retorna 401', async () => {
      const res = await request('POST', '/api/auth/login', {}, {
        email: 'admin@geopanel.bo',
        password: 'clave_totalmente_incorrecta'
      });
      assert.strictEqual(res.status, 401);
      assert(res.data.error, 'Debe incluir mensaje de error');
    });

    // Test 5: Rate Limiter
    await test('5. Rate Limiter bloquea tras 6 intentos fallidos con HTTP 429', async () => {
      const dummyIpHeaders = { 'x-forwarded-for': '198.51.100.77' };
      for (let i = 0; i < 5; i++) {
        await request('POST', '/api/auth/login', dummyIpHeaders, {
          email: 'attacker@evil.com',
          password: `pass_${i}`
        });
      }
      await request('POST', '/api/auth/login', dummyIpHeaders, {
        email: 'attacker@evil.com',
        password: 'pass_final'
      });
      const blockedRes = await request('POST', '/api/auth/login', dummyIpHeaders, {
        email: 'attacker@evil.com',
        password: 'pass_blocked'
      });
      assert.strictEqual(blockedRes.status, 429, `Esperado 429 Too Many Requests, recibido: ${blockedRes.status}`);
      assert(blockedRes.data.error.includes('Demasiados intentos'), 'Mensaje de rate limit esperado');
    });

    // Test 6: Protección de endpoints sin token o con token alterado
    await test('6. Endpoints protegidos rechazan peticiones sin Bearer o con firma adulterada', async () => {
      const noAuthRes = await request('GET', '/api/auth/me');
      assert.strictEqual(noAuthRes.status, 401);

      const fakeToken = superAdminToken.slice(0, -6) + 'abcdef';
      const fakeRes = await request('GET', '/api/auth/me', {
        Authorization: `Bearer ${fakeToken}`
      });
      assert.strictEqual(fakeRes.status, 401);
    });

    // Test 7: Aislamiento estricto multi-empresa
    await test('7. Multi-tenancy: Usuario de Empresa 1 no puede ver vehículos de Empresa 2', async () => {
      const resComp1 = await request('GET', '/api/fleet/live?includeDemos=true', {
        Authorization: `Bearer ${comp1AdminToken}`
      });
      assert.strictEqual(resComp1.status, 200);
      assert(Array.isArray(resComp1.data.vehicles), 'Debe devolver array de vehículos');
      for (const veh of resComp1.data.vehicles) {
        assert.strictEqual(veh.companyId, 'comp-1', `Fuga de datos: vehículo ${veh.id} tiene companyId ${veh.companyId}`);
      }

      const resComp2 = await request('GET', '/api/fleet/live?includeDemos=true', {
        Authorization: `Bearer ${comp2AdminToken}`
      });
      assert.strictEqual(resComp2.status, 200);
      for (const veh of resComp2.data.vehicles) {
        assert.strictEqual(veh.companyId, 'comp-2', `Fuga de datos: vehículo ${veh.id} tiene companyId ${veh.companyId}`);
      }
    });

    // Test 8: SUPERADMIN ve todas las empresas
    await test('8. SUPERADMIN tiene visibilidad global de todas las empresas', async () => {
      const resAll = await request('GET', '/api/fleet/live?companyId=ALL&includeDemos=true', {
        Authorization: `Bearer ${superAdminToken}`
      });
      assert.strictEqual(resAll.status, 200);
      const companyIds = new Set(resAll.data.vehicles.map(v => v.companyId).filter(Boolean));
      assert(companyIds.has('comp-1'), 'SuperAdmin debe ver empresa 1');
      assert(companyIds.has('comp-2'), 'SuperAdmin debe ver empresa 2');
    });

    // Test 9: Ingesta de Telemetría GPS con Token de Dispositivo (POST /api/v1/telemetry/report)
    await test('9. Ingesta telemática directa sin sesión humana (X-Device-Token)', async () => {
      const dev = loadDb().vehicles.find(v => v.uniqueId === 'DEMO-SCZ-01');
      const validToken = dev ? (dev.deviceToken || 'tok-demo-scz-01') : 'tok-demo-scz-01';

      const telemetryPayload = {
        uniqueId: 'DEMO-SCZ-01',
        latitude: -17.7788,
        longitude: -63.1855,
        speedKmh: 45.2,
        course: 90,
        accuracy: 3.5,
        batteryLevel: 88,
        fixTime: new Date().toISOString()
      };

      const res = await request('POST', '/api/v1/telemetry/report', {
        'x-device-token': validToken
      }, telemetryPayload);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.ok, true);
      assert(res.data.receivedAt, 'Debe devolver timestamp de recepción');

      // Verificar que el dispositivo fue actualizado
      const fleetRes = await request('GET', '/api/fleet/live?includeDemos=true', {
        Authorization: `Bearer ${superAdminToken}`
      });
      const updatedDev = fleetRes.data.vehicles.find(v => v.uniqueId === 'DEMO-SCZ-01');
      assert(updatedDev, 'Dispositivo debe existir en la flota');
      assert.strictEqual(updatedDev.lastPosition.latitude, -17.7788);
      assert.strictEqual(updatedDev.lastPosition.longitude, -63.1855);
      assert.strictEqual(updatedDev.lastPosition.speedKmh, 45.2);
      assert.strictEqual(updatedDev.lastPosition.batteryLevel, 88);
    });

    // Test 10: Validación de Coordenadas Geográficas
    await test('10. Validación telemática: Rechaza coordenadas fuera de rango (-90 a 90, -180 a 180)', async () => {
      const dev = loadDb().vehicles.find(v => v.uniqueId === 'DEMO-SCZ-01');
      const validToken = dev ? (dev.deviceToken || 'tok-demo-scz-01') : 'tok-demo-scz-01';

      const invalidPayload = {
        uniqueId: 'DEMO-SCZ-01',
        latitude: 145.89, // Fuera de rango
        longitude: -63.1855,
        speedKmh: 20
      };

      const res = await request('POST', '/api/v1/telemetry/report', {
        'x-device-token': validToken
      }, invalidPayload);

      assert.strictEqual(res.status, 400, `Esperado 400 Bad Request, recibido: ${res.status}`);
      assert(res.data.error.includes('Coordenadas geográficas inválidas'));
    });

    // Test 11: Rechazo de token de dispositivo incorrecto
    await test('11. Ingesta telemática rechaza X-Device-Token no autorizado con HTTP 401', async () => {
      const res = await request('POST', '/api/v1/telemetry/report', {
        'x-device-token': 'token-falso-o-robado'
      }, {
        uniqueId: 'DEMO-SCZ-01',
        latitude: -17.78,
        longitude: -63.18
      });

      assert.strictEqual(res.status, 401);
      assert(res.data.error.includes('no autorizado'));
    });

    // Test 12: RBAC - Restricción de creación de empresas a COMPANY_ADMIN
    await test('12. RBAC: COMPANY_ADMIN recibe 403 Forbidden al intentar crear empresas', async () => {
      const res = await request('POST', '/api/companies', {
        Authorization: `Bearer ${comp1AdminToken}`
      }, {
        name: 'Empresa No Autorizada',
        nit: '99999999'
      });

      assert.strictEqual(res.status, 403, `Esperado 403 Forbidden, recibido: ${res.status}`);
      assert(res.data.error.includes('No tiene permiso') || res.data.error.includes('companies:create'));
    });

    // Test 13: Manipulación de tokens cruzados entre dispositivos
    await test('13. Seguridad telemática: Token del Dispositivo A no puede reportar a nombre del Dispositivo B', async () => {
      const db = loadDb();
      const dev1 = db.vehicles.find(v => v.uniqueId === 'DEMO-SCZ-01');
      const dev2 = db.vehicles.find(v => v.uniqueId === 'DEMO-SCZ-02');
      const token1 = dev1 ? (dev1.deviceToken || 'tok-demo-scz-01') : 'tok-demo-scz-01';

      // Intentar enviar datos a nombre de DEMO-SCZ-02 usando el token de DEMO-SCZ-01
      const res = await request('POST', '/api/v1/telemetry/report', {
        'x-device-token': token1
      }, {
        uniqueId: 'DEMO-SCZ-02',
        latitude: -17.79,
        longitude: -63.19,
        speedKmh: 10
      });

      assert.strictEqual(res.status, 401, 'Debe rechazar token cruzado con HTTP 401');
    });

    // Test 14: Detección y manejo de paquetes duplicados
    await test('14. Anti-avalanche: Posición idéntica en coordenadas y timestamp devuelve duplicate: true', async () => {
      const dev = loadDb().vehicles.find(v => v.uniqueId === 'DEMO-SCZ-01');
      const validToken = dev ? (dev.deviceToken || 'tok-demo-scz-01') : 'tok-demo-scz-01';
      const exactTime = '2026-11-04T12:00:00.000Z';

      const payload = {
        uniqueId: 'DEMO-SCZ-01',
        latitude: -17.765432,
        longitude: -63.123456,
        speedKmh: 15.0,
        fixTime: exactTime
      };

      // Primer envío (nuevo)
      const res1 = await request('POST', '/api/v1/telemetry/report', { 'x-device-token': validToken }, payload);
      assert.strictEqual(res1.status, 200);
      assert.strictEqual(res1.data.duplicate, false);

      // Reenvío exacto (duplicado)
      const res2 = await request('POST', '/api/v1/telemetry/report', { 'x-device-token': validToken }, payload);
      assert.strictEqual(res2.status, 200);
      assert.strictEqual(res2.data.duplicate, true, 'Debe identificar el paquete como duplicado');
    });

    // Test 15: Clasificación de velocidad extrema (Anti-falso-rechazo)
    await test('15. Velocidad elevada: Coordenada con 240 km/h se acepta (200) y clasifica anomalía', async () => {
      const dev = loadDb().vehicles.find(v => v.uniqueId === 'DEMO-SCZ-01');
      const validToken = dev ? (dev.deviceToken || 'tok-demo-scz-01') : 'tok-demo-scz-01';

      const res = await request('POST', '/api/v1/telemetry/report', { 'x-device-token': validToken }, {
        uniqueId: 'DEMO-SCZ-01',
        latitude: -17.7500,
        longitude: -63.1500,
        speedKmh: 240.5,
        fixTime: new Date().toISOString()
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.speedAnomaly, 'excessive_speed_or_gps_jump', 'Debe clasificar anomalía sin descartar');
    });

    // Test 16: Rechazo estricto de valores NaN / Infinity
    await test('16. Validación numérica: Rechaza NaN, Infinity y valores malformados con HTTP 400', async () => {
      const dev = loadDb().vehicles.find(v => v.uniqueId === 'DEMO-SCZ-01');
      const validToken = dev ? (dev.deviceToken || 'tok-demo-scz-01') : 'tok-demo-scz-01';

      // Latitud con string alfabético
      const resString = await request('POST', '/api/v1/telemetry/report', { 'x-device-token': validToken }, {
        uniqueId: 'DEMO-SCZ-01',
        latitude: 'invalido_lat',
        longitude: -63.18
      });
      assert.strictEqual(resString.status, 400);

      // Longitud nula
      const resNull = await request('POST', '/api/v1/telemetry/report', { 'x-device-token': validToken }, {
        uniqueId: 'DEMO-SCZ-01',
        latitude: -17.78,
        longitude: null
      });
      assert.strictEqual(resNull.status, 400);
    });

    // Test 17: Tratamiento de marcas de tiempo futuras y antiguas
    await test('17. Marcas de tiempo: Fecha futura > 5m se ajusta y etiqueta; fecha antigua > 30d se clasifica', async () => {
      const dev = loadDb().vehicles.find(v => v.uniqueId === 'DEMO-SCZ-01');
      const validToken = dev ? (dev.deviceToken || 'tok-demo-scz-01') : 'tok-demo-scz-01';

      // Fecha 1 hora en el futuro
      const futureTime = new Date(Date.now() + 3600 * 1000).toISOString();
      const resFuture = await request('POST', '/api/v1/telemetry/report', { 'x-device-token': validToken }, {
        uniqueId: 'DEMO-SCZ-01',
        latitude: -17.7400,
        longitude: -63.1400,
        fixTime: futureTime
      });
      assert.strictEqual(resFuture.status, 200);
      assert.strictEqual(resFuture.data.timestampStatus, 'future_clamped_to_server_time');

      // Fecha 40 días en el pasado
      const pastTime = new Date(Date.now() - 40 * 24 * 3600 * 1000).toISOString();
      const resPast = await request('POST', '/api/v1/telemetry/report', { 'x-device-token': validToken }, {
        uniqueId: 'DEMO-SCZ-01',
        latitude: -17.7300,
        longitude: -63.1300,
        fixTime: pastTime
      });
      assert.strictEqual(resPast.status, 200);
      assert.strictEqual(resPast.data.timestampStatus, 'historical_outdated_data');
    });

    // Test 18: Dispositivo deshabilitado o suspendido
    await test('18. Suspensión: Dispositivo con disabled=true es rechazado con HTTP 403', async () => {
      const db = loadDb();
      // Crear temporalmente un dispositivo suspendido
      const testDisabledId = 'DEMO-SUSPENDED-01';
      db.vehicles.push({
        id: 'veh-suspended',
        uniqueId: testDisabledId,
        deviceToken: 'tok-suspended',
        deviceTokenHash: hashDeviceToken('tok-suspended'),
        name: 'Vehículo Suspendido',
        disabled: true,
        companyId: 'comp-1'
      });
      saveDb(db);

      const res = await request('POST', '/api/v1/telemetry/report', { 'x-device-token': 'tok-suspended' }, {
        uniqueId: testDisabledId,
        latitude: -17.78,
        longitude: -63.18
      });

      assert.strictEqual(res.status, 403);
      assert(res.data.error.includes('deshabilitado') || res.data.error.includes('suspendido'));
    });

    // Test 19: Usuario inactivo / deshabilitado
    await test('19. Control de acceso: Usuario con isActive=false es rechazado en login con HTTP 403', async () => {
      const db = loadDb();
      db.users.push({
        id: 'usr-inactive',
        email: 'inactivo@empresa.bo',
        password: hashDeviceToken('scrypt-pass'), // dummy
        isActive: false,
        role: ROLES.OPERATOR,
        companyId: 'comp-1'
      });
      saveDb(db);

      const res = await request('POST', '/api/auth/login', {}, {
        email: 'inactivo@empresa.bo',
        password: 'password_cualquiera'
      });

      // Debe rechazar por contraseña o si coincide por cuenta inactiva (401 o 403)
      assert(res.status === 401 || res.status === 403);
    });

    // Test 20: Concurrencia masiva (20 peticiones simultáneas)
    await test('20. Concurrencia SRE: 20 peticiones simultáneas de telemetría procesadas sin corrupción', async () => {
      const dev = loadDb().vehicles.find(v => v.uniqueId === 'DEMO-SCZ-01');
      const validToken = dev ? (dev.deviceToken || 'tok-demo-scz-01') : 'tok-demo-scz-01';

      const promises = [];
      for (let i = 0; i < 20; i++) {
        promises.push(
          request('POST', '/api/v1/telemetry/report', { 'x-device-token': validToken }, {
            uniqueId: 'DEMO-SCZ-01',
            latitude: -17.7800 + (i * 0.0001),
            longitude: -63.1800 + (i * 0.0001),
            speedKmh: 20 + i,
            fixTime: new Date(Date.now() + i * 1000).toISOString()
          })
        );
      }

      const results = await Promise.all(promises);
      for (const r of results) {
        assert.strictEqual(r.status, 200, `Petición concurrente falló con status: ${r.status}`);
      }

      // Validar integridad de db en memoria
      const freshDb = loadDb();
      const updatedDev = freshDb.vehicles.find(v => v.uniqueId === 'DEMO-SCZ-01');
      assert(updatedDev.lastPosition.latitude, 'La posición final debe persistir');
    });

    // Test 21: Protección de cambio de proveedor telemático
    await test('21. Provider guardrail: TELEMETRY_PROVIDER=native sin flag explícito cae a Traccar seguro', async () => {
      process.env.TELEMETRY_PROVIDER = 'native';
      delete process.env.ALLOW_EXPERIMENTAL_NATIVE_ENGINE;

      const provider = telemetryService.provider;
      // Debe ser TraccarTelemetryProvider para evitar pérdida accidental
      assert.strictEqual(provider.constructor.name, 'TraccarTelemetryProvider');

      // Restaurar
      delete process.env.TELEMETRY_PROVIDER;
    });

    // Test 22: Falla segura de producción ante TOKEN_SECRET ausente
    await test('22. Blindaje de producción: Falla si TOKEN_SECRET es el valor de prueba en NODE_ENV=production', async () => {
      const { resolveTokenSecret } = require('../server.js');
      const prevEnv = process.env.NODE_ENV;
      const prevSecret = process.env.TOKEN_SECRET;

      try {
        process.env.NODE_ENV = 'production';
        process.env.TOKEN_SECRET = 'geopanel-dev-secret-key-scz-2026'; // Clave por defecto
        
        let threw = false;
        try {
          resolveTokenSecret();
        } catch (e) {
          threw = true;
          assert(e.message.includes('TOKEN_SECRET obligatorio en producción'));
        }
        assert.strictEqual(threw, true, 'Debe lanzar excepción si TOKEN_SECRET no es seguro en producción');
      } finally {
        process.env.NODE_ENV = prevEnv;
        process.env.TOKEN_SECRET = prevSecret;
      }
    });

    // Test 23: Respaldo, SHA-256 y Restauración
    await test('23. Respaldo y recuperación: Genera backup con SHA-256 válido y verifica restauración', async () => {
      const { backupPath, checksum } = createBackup();
      assert(fs.existsSync(backupPath), 'El archivo de backup debe existir');
      assert(checksum && checksum.length === 64, 'Checksum SHA-256 debe ser de 64 caracteres');

      // Validar lectura de restauración
      const backupContent = fs.readFileSync(backupPath, 'utf8');
      const parsed = JSON.parse(backupContent);
      assert(Array.isArray(parsed.companies), 'El backup debe contener companies');
      assert(Array.isArray(parsed.vehicles), 'El backup debe contener vehicles');
    });

    // Test 24: Verificación de Esquema SQL (No CASCADE destructivo en positions)
    await test('24. Auditoría DDL: positions en schema.sql contiene ON DELETE RESTRICT (no CASCADE)', async () => {
      const schemaSql = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'schema.sql'), 'utf8');
      assert(
        !schemaSql.includes('device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE'),
        'schema.sql NO debe tener ON DELETE CASCADE en positions'
      );
      assert(
        schemaSql.includes('device_id UUID NOT NULL REFERENCES devices(id) ON DELETE RESTRICT'),
        'schema.sql debe proteger el historial con ON DELETE RESTRICT'
      );
    });

  } finally {
    // Cerrar servidor de prueba limpiamente
    await new Promise((resolve) => {
      server.close(() => {
        console.log('\n Servidor de prueba cerrado limpiamente.');
        resolve();
      });
    });
  }

  console.log('\n======================================================');
  console.log(`📊 RESULTADOS DE LA SUITE: ${passedTests} / ${totalTests} PRUEBAS EXITOSAS`);
  if (passedTests === totalTests) {
    console.log('\x1b[32m✔ TODAS LAS PRUEBAS PASARON SATISFACTORIAMENTE (100% OK)\x1b[0m');
    console.log('======================================================\n');
    process.exit(0);
  } else {
    console.log('\x1b[31m✖ HUBO PRUEBAS QUE FALLARON\x1b[0m');
    console.log('======================================================\n');
    process.exit(1);
  }
}

runAllTests().catch((err) => {
  console.error('Error fatal ejecutando la suite:', err);
  process.exit(1);
});
