-- ====================================================================
-- GEO-PANEL — ESQUEMA RELACIONAL POSTGRESQL + POSTGIS (PRODUCCIÓN & DEV)
-- Arquitectura SaaS Multi-Tenant independiente de Traccar
-- Optimizado para PostgreSQL 16 y PostGIS 3.4
-- ====================================================================

-- 0. Habilitar extensiones geoespaciales y criptográficas
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS postgis;

-- 1. Tabla de Empresas (Tenants)
CREATE TABLE IF NOT EXISTS companies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    legacy_id VARCHAR(50) UNIQUE, -- Mapeo para migraciones históricas ('comp-1')
    name VARCHAR(150) NOT NULL,
    tax_id VARCHAR(50), -- NIT / RUT
    phone VARCHAR(50),
    city VARCHAR(100) DEFAULT 'Santa Cruz de la Sierra',
    plan VARCHAR(80) NOT NULL DEFAULT 'Plan PyME (Hasta 10 GPS)',
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'trial')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 2. Tabla de Usuarios (RBAC Granular)
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID REFERENCES companies(id) ON DELETE RESTRICT,
    name VARCHAR(120) NOT NULL,
    email VARCHAR(150) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(30) NOT NULL CHECK (role IN ('SUPERADMIN', 'COMPANY_ADMIN', 'OPERATOR', 'MOBILE_USER')),
    phone VARCHAR(50),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 3. Tabla de Dispositivos / Vehículos
CREATE TABLE IF NOT EXISTS devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    unique_id VARCHAR(100) UNIQUE NOT NULL, -- IMEI, Serial o Android ID
    name VARCHAR(100) NOT NULL,
    plate VARCHAR(30),
    driver_name VARCHAR(100),
    device_type VARCHAR(30) NOT NULL DEFAULT 'person' CHECK (device_type IN ('person', 'car', 'truck', 'van', 'motorcycle', 'default')),
    phone VARCHAR(50),
    traccar_device_id INT, -- Mapeo temporal mientras coexista con Traccar
    device_token_hash VARCHAR(255), -- Hash SHA-256 para ingesta telemática directa
    is_disabled BOOLEAN NOT NULL DEFAULT false,
    is_demo BOOLEAN NOT NULL DEFAULT false,
    expiration_time TIMESTAMPTZ,
    last_position_id BIGINT,
    last_update TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 4. Tabla Particionada de Posiciones y Telemetría GPS
-- NOTA: Particionada por rango mensual sobre fix_time.
-- La clave primaria compuesta (device_id, fix_time) garantiza idempotencia a nivel de base de datos.
CREATE TABLE IF NOT EXISTS positions (
    id BIGSERIAL,
    device_id UUID NOT NULL REFERENCES devices(id) ON DELETE RESTRICT,
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    packet_id VARCHAR(100), -- Identificador único de transmisión generado por la App Android
    device_time TIMESTAMPTZ NOT NULL, -- Hora exacta de captura del satélite/GPS del móvil
    fix_time TIMESTAMPTZ NOT NULL, -- Marca de tiempo efectiva para orden cronológico y particionamiento
    server_time TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, -- Hora de recepción en el servidor
    geom GEOMETRY(Point, 4326) NOT NULL,
    latitude DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90 AND 90),
    longitude DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
    speed_kmh REAL NOT NULL DEFAULT 0.0 CHECK (speed_kmh >= 0),
    speed_knots REAL NOT NULL DEFAULT 0.0,
    course REAL NOT NULL DEFAULT 0.0 CHECK (course BETWEEN 0 AND 360),
    accuracy REAL CHECK (accuracy >= 0),
    battery_level SMALLINT CHECK (battery_level BETWEEN 0 AND 100),
    is_charging BOOLEAN,
    ignition BOOLEAN,
    total_distance_km DOUBLE PRECISION DEFAULT 0.0,
    street_address TEXT,
    speed_anomaly VARCHAR(50), -- Clasificación: 'excessive_speed_or_gps_jump', etc.
    timestamp_status VARCHAR(50) DEFAULT 'valid', -- 'valid', 'future_clamped_to_server_time', 'historical_outdated_data'
    attributes JSONB DEFAULT '{}'::jsonb,
    PRIMARY KEY (device_id, fix_time)
) PARTITION BY RANGE (fix_time);

-- 5. Particiones Mensuales
CREATE TABLE IF NOT EXISTS positions_y2026m10 PARTITION OF positions
    FOR VALUES FROM ('2026-10-01 00:00:00+00') TO ('2026-11-01 00:00:00+00');

CREATE TABLE IF NOT EXISTS positions_y2026m11 PARTITION OF positions
    FOR VALUES FROM ('2026-11-01 00:00:00+00') TO ('2026-12-01 00:00:00+00');

CREATE TABLE IF NOT EXISTS positions_y2026m12 PARTITION OF positions
    FOR VALUES FROM ('2026-12-01 00:00:00+00') TO ('2027-01-01 00:00:00+00');

CREATE TABLE IF NOT EXISTS positions_y2027m01 PARTITION OF positions
    FOR VALUES FROM ('2027-01-01 00:00:00+00') TO ('2027-02-01 00:00:00+00');

CREATE TABLE IF NOT EXISTS positions_y2027m02 PARTITION OF positions
    FOR VALUES FROM ('2027-02-01 00:00:00+00') TO ('2027-03-01 00:00:00+00');

CREATE TABLE IF NOT EXISTS positions_y2027m03 PARTITION OF positions
    FOR VALUES FROM ('2027-03-01 00:00:00+00') TO ('2027-04-01 00:00:00+00');

-- Partición por defecto (Captura cualquier fecha fuera de los rangos anteriores sin abortar inserciones)
CREATE TABLE IF NOT EXISTS positions_default PARTITION OF positions DEFAULT;

-- 6. Índices Estratégicos de Alto Rendimiento
CREATE INDEX IF NOT EXISTS idx_users_company ON users(company_id);
CREATE INDEX IF NOT EXISTS idx_devices_company ON devices(company_id);
CREATE INDEX IF NOT EXISTS idx_devices_unique_id ON devices(unique_id);
CREATE INDEX IF NOT EXISTS idx_positions_device_time ON positions(device_id, fix_time DESC);
CREATE INDEX IF NOT EXISTS idx_positions_company_time ON positions(company_id, fix_time DESC);
CREATE INDEX IF NOT EXISTS idx_positions_geom ON positions USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_positions_packet_id ON positions(packet_id) WHERE packet_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_positions_server_time ON positions(server_time DESC);
