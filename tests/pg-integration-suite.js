/**
 * GEO-PANEL — SUITE DE PRUEBAS DE INTEGRACIÓN REAL CON POSTGRESQL + POSTGIS (OT-004)
 * Ejecuta pruebas reales contra PostgreSQL 16 y PostGIS (cero mocks).
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { Client } = require('pg');

const { query, checkHealth, closePool, withTransaction } = require('../db/pg.js');
const telemetryRepo = require('../db/telemetry-repository.js');
const { generateSqlInserts } = require('../scripts/migrate-to-pg.js');
const { createBackup } = require('../scripts/backup.js');

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

async function runPgIntegrationSuite() {
  console.log('\n======================================================');
  console.log('🐘 INICIANDO PRUEBAS DE INTEGRACIÓN REAL POSTGRESQL (OT-004)');
  console.log('======================================================\n');

  try {
    // 1. Conectividad y PostGIS
    await test('1. Conexión a PostgreSQL 16 y verificación de extensión PostGIS', async () => {
      const health = await checkHealth();
      assert.strictEqual(health.available, true, 'PostgreSQL debe responder al healthcheck');
      assert(health.version.includes('PostgreSQL 16'), 'Debe ser PostgreSQL 16');

      const postgisRes = await query('SELECT PostGIS_Version()');
      assert(postgisRes.rows[0].postgis_version, 'PostGIS debe estar habilitado');
    });

    // 2. Creación y estructura del esquema particionado
    await test('2. Validación de esquema DDL, claves foráneas y particiones mensuales', async () => {
      const schemaSql = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'schema.sql'), 'utf8');
      await query(schemaSql);

      // Comprobar que las particiones existen
      const partitions = await query(`
        SELECT relname FROM pg_class 
        WHERE relname LIKE 'positions_y%' OR relname = 'positions_default'
        ORDER BY relname;
      `);
      assert(partitions.rowCount >= 6, 'Debe haber al menos 6 particiones mensuales creadas');

      // Comprobar que positions tiene ON DELETE RESTRICT
      const fkeys = await query(`
        SELECT confdeltype FROM pg_constraint WHERE conname LIKE '%positions%device_id%' OR conrelid = 'positions'::regclass;
      `);
      for (const row of fkeys.rows) {
        // confdeltype 'r' = RESTRICT, 'c' = CASCADE
        assert.notStrictEqual(row.confdeltype, 'c', 'NO debe existir eliminación en cascada (CASCADE)');
      }
    });

    // 3. Ejecución de migración de datos idempotente
    await test('3. Migración de datos desde JSON hacia PostgreSQL con relaciones foráneas', async () => {
      const { outputFile } = generateSqlInserts();
      const migrationSql = fs.readFileSync(outputFile, 'utf8');
      await query(migrationSql);

      const compRes = await query('SELECT count(*) FROM companies');
      const usrRes = await query('SELECT count(*) FROM users');
      const devRes = await query('SELECT count(*) FROM devices');

      assert(parseInt(compRes.rows[0].count, 10) >= 2, 'Deben existir al menos 2 empresas');
      assert(parseInt(usrRes.rows[0].count, 10) >= 3, 'Deben existir al menos 3 usuarios');
      assert(parseInt(devRes.rows[0].count, 10) >= 6, 'Deben existir al menos 6 dispositivos');
    });

    // 4. Inserción de posición telemática con PostGIS Point
    let testDeviceId = '';
    const nowIso = new Date().toISOString();

    await test('4. Inserción de telemetría GPS con geometría PostGIS Point(lon, lat)', async () => {
      const res = await telemetryRepo.recordTelemetry({
        uniqueId: 'DEMO-SCZ-01',
        latitude: -17.783344,
        longitude: -63.182155,
        speedKmh: 48.5,
        course: 135.0,
        accuracy: 3.2,
        batteryLevel: 94,
        isCharging: true,
        ignition: true,
        packetId: 'pkt-real-test-001',
        fixTime: nowIso,
        streetAddress: 'Av. Monseñor Rivero, Santa Cruz'
      });

      assert.strictEqual(res.ok, true);
      assert.strictEqual(res.duplicate, false);
      assert.strictEqual(res.isNewest, true);
      testDeviceId = res.deviceId;

      // Verificar en base de datos la geometría PostGIS
      const row = await query(
        'SELECT ST_AsText(geom) as geom_text, latitude, longitude, speed_kmh FROM positions WHERE device_id = $1 AND fix_time = $2',
        [res.deviceId, nowIso]
      );
      assert.strictEqual(row.rowCount, 1);
      assert.strictEqual(row.rows[0].geom_text, 'POINT(-63.182155 -17.783344)');
      assert.strictEqual(row.rows[0].speed_kmh, 48.5);
    });

    // 5. Deduplicación e idempotencia a nivel de base de datos
    await test('5. Idempotencia: Reenvío del mismo paquete GPS retorna duplicate: true sin duplicar filas', async () => {
      const resDup = await telemetryRepo.recordTelemetry({
        uniqueId: 'DEMO-SCZ-01',
        latitude: -17.783344,
        longitude: -63.182155,
        speedKmh: 48.5,
        packetId: 'pkt-real-test-001',
        fixTime: nowIso
      });

      assert.strictEqual(resDup.ok, true);
      assert.strictEqual(resDup.duplicate, true, 'Debe detectar duplicado');

      // Validar que en PostgreSQL sigue existiendo exactamente 1 fila para esa clave (device_id, fix_time)
      const countRes = await query(
        'SELECT count(*) FROM positions WHERE device_id = $1 AND fix_time = $2',
        [testDeviceId, nowIso]
      );
      assert.strictEqual(parseInt(countRes.rows[0].count, 10), 1, 'Debe haber exactamente 1 fila');
    });

    // 6. Regla de paquetes fuera de orden (FASE 6)
    await test('6. Paquetes fuera de orden: Posición histórica antigua no degrada last_update en vivo', async () => {
      // Capturar last_update actual
      const devBefore = await query('SELECT last_update FROM devices WHERE id = $1', [testDeviceId]);
      const currentLastUpdate = new Date(devBefore.rows[0].last_update).getTime();

      // Enviar paquete con fecha de 3 horas antes
      const olderTime = new Date(Date.now() - 3 * 3600 * 1000).toISOString();
      const resOlder = await telemetryRepo.recordTelemetry({
        uniqueId: 'DEMO-SCZ-01',
        latitude: -17.790000,
        longitude: -63.190000,
        speedKmh: 10.0,
        packetId: 'pkt-older-001',
        fixTime: olderTime
      });

      assert.strictEqual(resOlder.ok, true);
      assert.strictEqual(resOlder.isNewest, false, 'No debe considerarse el paquete más nuevo');

      // Verificar que el dispositivo conserva su last_update más reciente
      const devAfter = await query('SELECT last_update FROM devices WHERE id = $1', [testDeviceId]);
      const afterLastUpdate = new Date(devAfter.rows[0].last_update).getTime();
      assert.strictEqual(afterLastUpdate, currentLastUpdate, 'last_update no debe haber retrocedido');
    });

    // 7. Consulta histórica cronológica con paginación
    await test('7. Consulta histórica: Resultados ordenados por fix_time ASC con límite y offset', async () => {
      const fromDate = new Date(Date.now() - 24 * 3600 * 1000);
      const toDate = new Date(Date.now() + 3600 * 1000);

      const history = await telemetryRepo.getDeviceHistory({
        deviceId: testDeviceId,
        fromDate,
        toDate,
        limit: 10,
        offset: 0
      });

      assert(Array.isArray(history), 'Debe devolver un arreglo');
      assert(history.length >= 2, 'Debe haber al menos 2 posiciones');

      // Verificar orden ascendente
      const time0 = new Date(history[0].fix_time).getTime();
      const time1 = new Date(history[1].fix_time).getTime();
      assert(time0 <= time1, 'Las posiciones deben estar ordenadas cronológicamente (ASC)');
    });

    // 8. Aislamiento estricto multi-empresa en consultas
    await test('8. Multi-Tenancy: Consulta histórica con companyId de otra empresa retorna vacío', async () => {
      // Obtener companyId diferente
      const otherCompany = await query('SELECT id FROM companies WHERE legacy_id != $1 LIMIT 1', ['comp-1']);
      assert(otherCompany.rowCount > 0);
      const foreignCompanyId = otherCompany.rows[0].id;

      const fromDate = new Date(Date.now() - 24 * 3600 * 1000);
      const toDate = new Date(Date.now() + 3600 * 1000);

      const historyCrossTenant = await telemetryRepo.getDeviceHistory({
        deviceId: testDeviceId,
        fromDate,
        toDate,
        companyId: foreignCompanyId
      });

      assert.strictEqual(historyCrossTenant.length, 0, 'No debe retornar posiciones de otra empresa');
    });

    // 9. Dispositivo suspendido
    await test('9. Estado de dispositivo: Dispositivo suspendido es rechazado con error 403', async () => {
      // Deshabilitar temporalmente DEMO-SCZ-03
      await query('UPDATE devices SET is_disabled = true WHERE unique_id = $1', ['DEMO-SCZ-03']);

      let threw = false;
      try {
        await telemetryRepo.recordTelemetry({
          uniqueId: 'DEMO-SCZ-03',
          latitude: -17.78,
          longitude: -63.18
        });
      } catch (err) {
        threw = true;
        assert.strictEqual(err.statusCode, 403);
      }
      assert.strictEqual(threw, true, 'Debe rechazar dispositivo suspendido');

      // Restaurar estado
      await query('UPDATE devices SET is_disabled = false WHERE unique_id = $1', ['DEMO-SCZ-03']);
    });

    // 10. Concurrencia masiva real en PostgreSQL (25 peticiones concurrentes)
    await test('10. Concurrencia SRE: 25 inserciones simultáneas procesadas sin fallas en PostgreSQL', async () => {
      const promises = [];
      const baseTime = Date.now();
      const batchId = `b${baseTime}`;

      for (let i = 0; i < 25; i++) {
        promises.push(
          telemetryRepo.recordTelemetry({
            uniqueId: 'DEMO-SCZ-02',
            latitude: -17.7800 + (i * 0.0002),
            longitude: -63.1800 + (i * 0.0002),
            speedKmh: 25.0 + i,
            packetId: `pkt-${batchId}-${i}`,
            fixTime: new Date(baseTime + i * 2000).toISOString()
          })
        );
      }

      const results = await Promise.all(promises);
      for (const r of results) {
        assert.strictEqual(r.ok, true);
        assert.strictEqual(r.duplicate, false);
      }

      // Validar que se guardaron las 25 filas de este lote concurrente
      const countRes = await query(
        `SELECT count(*) FROM positions p 
         JOIN devices d ON p.device_id = d.id 
         WHERE d.unique_id = 'DEMO-SCZ-02' AND p.packet_id LIKE $1`,
        [`pkt-${batchId}-%`]
      );
      assert.strictEqual(parseInt(countRes.rows[0].count, 10), 25, 'Deben existir las 25 filas');
    });

    // 11. Transacciones ACID
    await test('11. Transaccionalidad: withTransaction revierte cambios correctamente ante error', async () => {
      let threw = false;
      try {
        await withTransaction(async (client) => {
          await client.query("UPDATE devices SET name = 'Nombre Temporal' WHERE unique_id = 'DEMO-SCZ-01'");
          throw new Error('Falla intencional para verificar ROLLBACK');
        });
      } catch (e) {
        threw = true;
      }
      assert.strictEqual(threw, true);

      // Verificar que el nombre NO cambió
      const checkDev = await query("SELECT name FROM devices WHERE unique_id = 'DEMO-SCZ-01'");
      assert.notStrictEqual(checkDev.rows[0].name, 'Nombre Temporal', 'El cambio debió revertirse con ROLLBACK');
    });

    // 12. Consulta de últimas posiciones de flota
    await test('12. Consulta en vivo: getLatestPositions retorna la posición más reciente por vehículo', async () => {
      const liveFleet = await telemetryRepo.getLatestPositions();
      assert(Array.isArray(liveFleet), 'Debe devolver un arreglo');
      assert(liveFleet.length >= 3, 'Debe devolver vehículos con su última telemetría');

      const dev1 = liveFleet.find(d => d.unique_id === 'DEMO-SCZ-01');
      assert(dev1, 'DEMO-SCZ-01 debe estar presente');
      assert(dev1.latitude && dev1.longitude, 'Debe incluir coordenadas');
      assert(dev1.company_name, 'Debe incluir el nombre de la empresa');
    });

  } finally {
    await closePool();
  }

  console.log('\n======================================================');
  console.log(`📊 RESULTADOS DE INTEGRACIÓN POSTGRESQL: ${passedTests} / ${totalTests} PRUEBAS EXITOSAS`);
  if (passedTests === totalTests) {
    console.log('\x1b[32m✔ TODAS LAS PRUEBAS REALES DE POSTGRESQL PASARON (100% OK)\x1b[0m');
    console.log('======================================================\n');
    process.exit(0);
  } else {
    console.log('\x1b[31m✖ HUBO PRUEBAS QUE FALLARON\x1b[0m');
    console.log('======================================================\n');
    process.exit(1);
  }
}

runPgIntegrationSuite().catch((err) => {
  console.error('Error fatal ejecutando suite de integración PostgreSQL:', err);
  process.exit(1);
});
