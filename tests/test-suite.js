/**
 * GEO-PANEL — SUITE DE PRUEBAS AUTOMATIZADAS (ORDEN TÉCNICA 002)
 * Framework nativo de pruebas en Node.js (cero dependencias externas).
 * 
 * Cobertura de pruebas:
 * 1. Healthcheck (/api/health)
 * 2. Autenticación humana y tokens HMAC-SHA256
 * 3. Rate limiting contra ataques de fuerza bruta (HTTP 429)
 * 4. Protección de endpoints y rechazo de tokens inválidos (HTTP 401)
 * 5. Aislamiento estricto multi-empresa (Multi-tenancy isolation)
 * 6. Ingesta telemática directa de dispositivos sin sesión humana (X-Device-Token)
 * 7. Validación geométrica de coordenadas GPS y rechazo de datos espurios
 * 8. Control de acceso basado en roles y permisos granulares (RBAC)
 */

const http = require('http');
const assert = require('assert');
const path = require('path');

// Asegurar entorno de pruebas
process.env.PORT = '3456';
process.env.TOKEN_SECRET = 'test-token-secret-for-geopanel-ci-suite-998877';
process.env.INITIAL_ADMIN_EMAIL = 'admin@geopanel.bo';
process.env.INITIAL_ADMIN_PASSWORD = 'admin123';

const { server, loadDb, saveDb, ROLES } = require('../server.js');

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
  console.log('🧪 INICIANDO SUITE DE PRUEBAS TÉCNICAS GEO-PANEL (OT-002)');
  console.log('======================================================\n');

  // Arrancar servidor
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

    // Test 2: Login válido SUPERADMIN
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
      // Realizar 5 intentos fallidos
      for (let i = 0; i < 5; i++) {
        await request('POST', '/api/auth/login', dummyIpHeaders, {
          email: 'attacker@evil.com',
          password: `pass_${i}`
        });
      }
      // El 6to intento fallido activa el umbral
      await request('POST', '/api/auth/login', dummyIpHeaders, {
        email: 'attacker@evil.com',
        password: 'pass_final'
      });

      // El 7mo intento debe ser rechazado inmediatamente con 429
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
      // Todos los vehículos devueltos deben ser de comp-1
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
      const validToken = dev ? dev.deviceToken : 'tok-demo-scz-01';

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

    // Test 10: Validación de Coordenadas Geográficas (Anti-Spoofing / Anti-Corrupción)
    await test('10. Validación telemática: Rechaza coordenadas fuera de rango (-90 a 90, -180 a 180)', async () => {
      const invalidPayload = {
        uniqueId: 'DEMO-SCZ-01',
        latitude: 145.89, // Latitud imposible
        longitude: -63.1855,
        speedKmh: 20
      };

      const res = await request('POST', '/api/v1/telemetry/report', {
        'x-device-token': 'tok-demo-01'
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

    // Test 12: RBAC - Restricción de acciones privilegiadas a COMPANY_ADMIN
    await test('12. RBAC: COMPANY_ADMIN recibe 403 Forbidden al intentar crear empresas', async () => {
      const res = await request('POST', '/api/companies', {
        Authorization: `Bearer ${comp1AdminToken}`
      }, {
        name: 'Empresa Ilícita',
        nit: '99999999'
      });

      assert.strictEqual(res.status, 403, `Esperado 403 Forbidden, recibido: ${res.status}`);
      assert(res.data.error.includes('No tiene permiso') || res.data.error.includes('companies:create'));
    });

  } finally {
    // Cerrar servidor de prueba
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
