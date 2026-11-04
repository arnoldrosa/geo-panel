-- ====================================================================
-- GEO-PANEL — ESQUEMA RELACIONAL POSTGRESQL + POSTGIS (PRODUCCIÓN)
-- Diseñado para independencia de Traccar y escalabilidad SaaS Multiempresa
-- ====================================================================

-- Habilitar extensión geoespacial
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS postgis;

-- 1. Tabla de Empresas (Tenants)
CREATE TABLE IF NOT EXISTS companies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
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
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    unique_id VARCHAR(100) UNIQUE NOT NULL, -- IMEI, Serial o Android ID
    name VARCHAR(100) NOT NULL,
    plate VARCHAR(30),
    driver_name VARCHAR(100),
    device_type VARCHAR(30) NOT NULL DEFAULT 'person' CHECK (device_type IN ('person', 'car', 'truck', 'van', 'motorcycle', 'default')),
    phone VARCHAR(50),
    traccar_device_id INT, -- Mapeo temporal mientras coexista con Traccar
    device_token_hash VARCHAR(255), -- Token criptográfico para transmisión GPS directa
    is_disabled BOOLEAN NOT NULL DEFAULT false,
    is_demo BOOLEAN NOT NULL DEFAULT false,
    expiration_time TIMESTAMPTZ,
    last_position_id BIGINT,
    last_update TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 4. Tabla de Posiciones y Telemetría
CREATE TABLE IF NOT EXISTS positions (
    id BIGSERIAL,
    device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    fix_time TIMESTAMPTZ NOT NULL,
    server_time TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    geom GEOMETRY(Point, 4326) NOT NULL,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    speed_kmh REAL NOT NULL DEFAULT 0.0,
    speed_knots REAL NOT NULL DEFAULT 0.0,
    course REAL NOT NULL DEFAULT 0.0,
    accuracy REAL,
    battery_level SMALLINT CHECK (battery_level BETWEEN 0 AND 100),
    is_charging BOOLEAN,
    ignition BOOLEAN,
    total_distance_km DOUBLE PRECISION DEFAULT 0.0,
    street_address TEXT,
    attributes JSONB,
    PRIMARY KEY (id, fix_time)
) PARTITION BY RANGE (fix_time);

-- Índices estratégicos
CREATE INDEX IF NOT EXISTS idx_users_company ON users(company_id);
CREATE INDEX IF NOT EXISTS idx_devices_company ON devices(company_id);
CREATE INDEX IF NOT EXISTS idx_devices_unique_id ON devices(unique_id);
CREATE INDEX IF NOT EXISTS idx_positions_device_time ON positions(device_id, fix_time DESC);
CREATE INDEX IF NOT EXISTS idx_positions_geom ON positions USING GIST (geom);
