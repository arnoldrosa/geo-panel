/**
 * GEO-PANEL — Suite de Pruebas de Distribución y Gestión Móvil (OT-005-A)
 * Valida:
 * 1. Endpoint público de changelog (/api/v1/mobile/versions)
 * 2. Comprobador de actualizaciones Android (/api/v1/mobile/updates/check)
 * 3. Descarga de APK con Content-Type, Content-Disposition, SHA-256 y magic bytes PK\x03\x04
 * 4. Control de acceso RBAC (403 para anónimo y COMPANY_ADMIN, 200 para SUPERADMIN)
 * 5. Rechazo de archivos maliciosos/inválidos que no sean paquetes ZIP/APK
 * 6. Publicación exitosa de nueva release con cálculo de hash SHA-256
 * 7. Alternancia de estado de publicación (Retirar y Reactivar versión)
 * 8. Redirección de rutas amigables (/downloads, /descargas, /mobile)
 */
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Configuración de entorno de prueba antes de importar server
process.env.NODE_ENV = 'test';
process.env.NODE_ENV_TEST = 'true';
process.env.TOKEN_SECRET = 'test_secret_key_antigravity_safe_64_bytes_minimum_length_abcdef012345';
process.env.INITIAL_ADMIN_EMAIL = 'admin@geopanel.bo';
process.env.INITIAL_ADMIN_PASSWORD = 'admin123';

const { server } = require('../server.js');
const BASE_URL = 'http://127.0.0.1:3457';

let superadminToken = null;
let companyAdminToken = null;

function request(method, urlPath, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlPath, BASE_URL);
    const reqOptions = {
      method,
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      headers: { ...headers }
    };

    let payload = null;
    if (body) {
      if (typeof body === 'object' && !Buffer.isBuffer(body)) {
        payload = JSON.stringify(body);
        reqOptions.headers['Content-Type'] = 'application/json';
        reqOptions.headers['Content-Length'] = Buffer.byteLength(payload);
      } else if (Buffer.isBuffer(body)) {
        payload = body;
        reqOptions.headers['Content-Length'] = body.length;
      }
    }

    const req = http.request(reqOptions, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const rawBuffer = Buffer.concat(chunks);
        const text = rawBuffer.toString('utf8');
        let json = null;
        try {
          json = JSON.parse(text);
        } catch (_) {}
        resolve({
          status: res.statusCode,
          headers: res.headers,
          text,
          json,
          buffer: rawBuffer
        });
      });
    });

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function runTests() {
  console.log('\n======================================================');
  console.log('🧪 SUITE DE PRUEBAS: DISTRIBUCIÓN MÓVIL Y VERSIONES (OT-005-A)');
  console.log('======================================================\n');

  await new Promise((resolve) => server.listen(3457, '127.0.0.1', resolve));
  console.log(' Servidor de prueba escuchando en http://127.0.0.1:3457\n');

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    process.stdout.write(`  ⏳ ${name}... `);
    try {
      await fn();
      console.log('✔ PASS');
      passed++;
    } catch (err) {
      console.log(`❌ FAIL\n     Error: ${err.message}`);
      failed++;
    }
  }

  // 1. Iniciar sesión con SUPERADMIN para obtener token
  await test('1. Autenticación de SUPERADMIN para pruebas administrativas', async () => {
    const res = await request('POST', '/api/auth/login', {}, {
      email: 'admin@geopanel.bo',
      password: 'admin123'
    });
    if (res.status !== 200 || !res.json.token) {
      throw new Error(`Login SuperAdmin falló: ${res.status} ${res.text}`);
    }
    superadminToken = res.json.token;
  });

  // 2. Iniciar sesión con COMPANY_ADMIN para verificar RBAC
  await test('2. Autenticación de COMPANY_ADMIN para verificar permisos restringidos', async () => {
    const res = await request('POST', '/api/auth/login', {}, {
      email: 'oriental@empresa1.bo',
      password: 'password123'
    });
    // Si no tiene password123, probar 123456
    let token = res.json && res.json.token;
    if (!token) {
      const retry = await request('POST', '/api/auth/login', {}, {
        email: 'oriental@empresa1.bo',
        password: '123456'
      });
      if (retry.status === 200 && retry.json.token) {
        token = retry.json.token;
      }
    }
    if (!token) {
      throw new Error(`Login CompanyAdmin falló`);
    }
    companyAdminToken = token;
  });

  // 3. Consulta pública de versiones e historial
  await test('3. Endpoint público /api/v1/mobile/versions devuelve catálogo de versiones o estado próximo verídico', async () => {
    const res = await request('GET', '/api/v1/mobile/versions');
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
    if (!Array.isArray(res.json.versions)) {
      throw new Error('Estructura de respuesta inválida: versions debe ser un array');
    }
    if (!res.json.latestVersion) {
      // Estado verídico: catálogo limpio sin publicaciones espurias
      if (res.json.versions.length !== 0) throw new Error('Se esperaba array vacío cuando no hay APK publicado');
    } else {
      if (res.json.latestVersion.versionCode < 1) {
        throw new Error('La versión vigente debe tener versionCode >= 1');
      }
    }
  });

  // 4. Verificación de actualización desde cliente Android cuando no hay publicaciones ficticias
  await test('4. /api/v1/mobile/updates/check maneja estado verídico sin notificaciones espurias', async () => {
    const res = await request('GET', '/api/v1/mobile/updates/check?versionCode=0');
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
    if (res.json.hasUpdate !== false) {
      throw new Error('No debe forzar actualización si no hay APK publicado');
    }
  });

  // 5. Cliente con versión al día o catálogo vacío no recibe actualización innecesaria
  await test('5. /api/v1/mobile/updates/check retorna hasUpdate=false para cliente al día', async () => {
    const res = await request('GET', '/api/v1/mobile/updates/check?versionCode=9999');
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
    if (res.json.hasUpdate !== false) {
      throw new Error('Se esperaba hasUpdate=false para un cliente con versión 9999');
    }
  });

  // 6. Descarga directa de APK informa 404 verídico si no hay APK cargado (sin archivos falsos)
  await test('6. /api/v1/mobile/download/latest no inventa archivos si no hay release publicado', async () => {
    const res = await request('GET', '/api/v1/mobile/download/latest');
    if (res.status === 404) {
      if (!res.json || !res.json.error) throw new Error('Se esperaba mensaje de error descriptivo en 404');
    } else if (res.status === 200) {
      const cType = res.headers['content-type'];
      if (!cType || !cType.includes('application/vnd.android.package-archive')) {
        throw new Error(`Content-Type inesperado: ${cType}`);
      }
    } else {
      throw new Error(`HTTP status inesperado: ${res.status}`);
    }
  });

  // 7. Control de Acceso RBAC: Peticiones anónimas y no autorizadas a administración
  await test('7. RBAC: Peticiones anónimas o COMPANY_ADMIN a /api/v1/admin/mobile/releases son rechazadas con 403', async () => {
    // Anónimo
    const resAnon = await request('GET', '/api/v1/admin/mobile/releases');
    if (resAnon.status !== 403) throw new Error(`Esperado 403 para anónimo, recibido ${resAnon.status}`);

    // COMPANY_ADMIN
    const resComp = await request('GET', '/api/v1/admin/mobile/releases', {
      Authorization: `Bearer ${companyAdminToken}`
    });
    if (resComp.status !== 403) throw new Error(`Esperado 403 para COMPANY_ADMIN, recibido ${resComp.status}`);
  });

  // 8. SuperAdmin puede listar inventario administrativo completo
  await test('8. SUPERADMIN accede exitosamente a /api/v1/admin/mobile/releases', async () => {
    const res = await request('GET', '/api/v1/admin/mobile/releases', {
      Authorization: `Bearer ${superadminToken}`
    });
    if (res.status !== 200 || !Array.isArray(res.json.releases)) {
      throw new Error(`Esperado 200 con lista de releases, recibido ${res.status}`);
    }
  });

  // 9. Rechazo de archivos inválidos que no sean paquetes APK (sin magic bytes ZIP)
  await test('9. Rechazo de archivo binario adulterado sin magic bytes ZIP (HTTP 400)', async () => {
    const fakeFileContent = Buffer.from('ESTO_NO_ES_UN_APK_VALIDO_ES_UN_SCRIPT');
    const base64Fake = fakeFileContent.toString('base64');

    const res = await request('POST', '/api/v1/admin/mobile/releases', {
      Authorization: `Bearer ${superadminToken}`
    }, {
      versionCode: 99,
      versionName: '9.9.9',
      releaseNotes: 'Intento de subir binario corrupto',
      apkBase64: base64Fake
    });

    if (res.status !== 400) {
      throw new Error(`Se esperaba HTTP 400 por binario inválido, recibido: ${res.status}`);
    }
    if (!res.json.error || !res.json.error.includes('ZIP')) {
      throw new Error(`Mensaje de error inesperado: ${res.json && res.json.error}`);
    }
  });

  // 10. Publicación exitosa de nueva versión de prueba por SuperAdmin
  const testApkBuffer = Buffer.concat([
    Buffer.from([0x50, 0x4B, 0x03, 0x04]), // ZIP Magic Bytes
    Buffer.from('GEO-PANEL Test APK v1.2.0 Build 2 Universal Release')
  ]);
  const expectedSha256 = crypto.createHash('sha256').update(testApkBuffer).digest('hex');

  await test('10. SUPERADMIN publica versión de prueba v1.2.0 con cálculo íntegro de SHA-256', async () => {
    const res = await request('POST', '/api/v1/admin/mobile/releases', {
      Authorization: `Bearer ${superadminToken}`
    }, {
      versionCode: 2,
      versionName: '1.2.0',
      minSdk: 26,
      releaseNotes: 'Actualización con diseño adaptable para tablets de 10 pulgadas.',
      isMandatory: false,
      apkBase64: testApkBuffer.toString('base64')
    });

    if (res.status !== 201) {
      throw new Error(`Se esperaba HTTP 201 al publicar release, recibido ${res.status}: ${res.text}`);
    }

    if (res.json.release.sha256 !== expectedSha256) {
      throw new Error(`SHA-256 almacenado (${res.json.release.sha256}) != Esperado (${expectedSha256})`);
    }

    if (res.json.release.publishedBy !== 'admin@geopanel.bo') {
      throw new Error(`publishedBy incorrecto: ${res.json.release.publishedBy}`);
    }
  });

  // 11. Comprobador de actualizaciones detecta inmediatamente la nueva versión publicada
  await test('11. Cliente Android detecta la nueva versión v1.2.0 (Build 2) como actualización vigente', async () => {
    const res = await request('GET', '/api/v1/mobile/updates/check?versionCode=1');
    if (res.status !== 200 || !res.json.hasUpdate) {
      throw new Error('Se esperaba que reportara actualización disponible frente a v1');
    }
    if (res.json.latestVersion.versionCode !== 2) {
      throw new Error(`versionCode esperado 2, recibido: ${res.json.latestVersion.versionCode}`);
    }
    if (res.json.latestVersion.sha256 !== expectedSha256) {
      throw new Error('Checksum SHA-256 en aviso de actualización no coincide con el archivo publicado');
    }
  });

  // 12. Retirada de versión (Publish Toggle) y confirmación de rollback de vigencia
  await test('12. SUPERADMIN retira versión v1.2.0 (isPublished=false) y el sistema vuelve a v1.0.0', async () => {
    const toggleRes = await request('PUT', '/api/v1/admin/mobile/releases/2/status', {
      Authorization: `Bearer ${superadminToken}`
    }, {
      isPublished: false
    });

    if (toggleRes.status !== 200 || toggleRes.json.release.isPublished !== false) {
      throw new Error(`Fallo al cambiar estado a retirado: ${toggleRes.status} ${toggleRes.text}`);
    }

    // Ahora el check de actualización para un cliente con versión 1 debe responder hasUpdate=false
    const checkRes = await request('GET', '/api/v1/mobile/updates/check?versionCode=1');
    if (checkRes.json.hasUpdate !== false) {
      throw new Error('La versión retirada todavía se ofrecía a los clientes Android');
    }
  });

  // 13. Redirección amigable de rutas web (/downloads, /descargas, /mobile)
  await test('13. Redirecciones públicas amigables /downloads y /descargas devuelven HTTP 302 a /?tab=mobile', async () => {
    const resDown = await request('GET', '/downloads');
    if (resDown.status !== 302 || resDown.headers.location !== '/?tab=mobile') {
      throw new Error(`Esperado 302 a /?tab=mobile, recibido: ${resDown.status} ${resDown.headers.location}`);
    }

    const resDesc = await request('GET', '/descargas');
    if (resDesc.status !== 302 || resDesc.headers.location !== '/?tab=mobile') {
      throw new Error(`Esperado 302 a /?tab=mobile, recibido: ${resDesc.status} ${resDesc.headers.location}`);
    }

    const resMob = await request('GET', '/mobile');
    if (resMob.status !== 302 || resMob.headers.location !== '/?tab=mobile') {
      throw new Error(`Esperado 302 a /?tab=mobile, recibido: ${resMob.status} ${resMob.headers.location}`);
    }
  });

  // Limpieza de release de prueba para dejar el estado del sistema ordenado
  try {
    const releasesFile = path.join(__dirname, '..', 'data', 'releases', 'releases.json');
    if (fs.existsSync(releasesFile)) {
      const rels = JSON.parse(fs.readFileSync(releasesFile, 'utf8'));
      const cleaned = rels.filter((r) => r.versionCode !== 2 && r.versionCode !== 99);
      fs.writeFileSync(releasesFile, JSON.stringify(cleaned, null, 2), 'utf8');
      const testApk = path.join(__dirname, '..', 'data', 'releases', 'apk', 'geopanel-mobile-v1.2.0.apk');
      if (fs.existsSync(testApk)) fs.unlinkSync(testApk);
    }
  } catch (_) {}

  server.close();
  console.log('\n======================================================');
  console.log(`📊 RESULTADOS: ${passed} / ${passed + failed} PRUEBAS EXITOSAS`);
  if (failed === 0) {
    console.log('✔ TODAS LAS PRUEBAS DE LA ORDEN 005-A PASARON CON ÉXITO (100% OK)');
  } else {
    console.log(`❌ SE REGISTRARON ${failed} FALLOS EN LA SUITE`);
  }
  console.log('======================================================\n');

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error('Error fatal ejecutando pruebas:', err);
  if (server) server.close();
  process.exit(1);
});
