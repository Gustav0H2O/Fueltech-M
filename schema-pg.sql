-- FuelTech Master — Esquema relacional (PostgreSQL)
-- Cadena de datos: Vehículo -> Tipo de inyección -> Módulo -> Pila -> Presiones (PSI/Bar)

CREATE TABLE IF NOT EXISTS injection_types (
  id          SERIAL PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,      -- MFI, TBI, VORTEC_CSFI, GDI...
  name        TEXT NOT NULL,
  description TEXT
);

CREATE TABLE IF NOT EXISTS brands (
  id   SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS vehicles (
  id                SERIAL PRIMARY KEY,
  brand_id          INTEGER NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  model             TEXT NOT NULL,
  year_from         INTEGER NOT NULL,
  year_to           INTEGER NOT NULL,
  engine            TEXT NOT NULL,       -- ej. "1.6L L4 16v"
  body_type         TEXT NOT NULL DEFAULT 'sedan',  -- sedan | hatchback | pickup | suv | van (modelo 3D)
  injection_type_id INTEGER NOT NULL REFERENCES injection_types(id) ON DELETE CASCADE,
  rail_pressure_psi_min REAL NOT NULL,   -- presión en flauta/riel (llave ON)
  rail_pressure_psi_max REAL NOT NULL,
  notes             TEXT,
  data_verified     INTEGER NOT NULL DEFAULT 1  -- 0 = specs estimadas por clase, pendientes de verificar contra manual
);

-- Módulo (ensamble completo: carcasa, regulador, flotador, cedazo, conectores)
CREATE TABLE IF NOT EXISTS fuel_modules (
  id                   SERIAL PRIMARY KEY,
  code                 TEXT NOT NULL UNIQUE,   -- código de catálogo
  name                 TEXT NOT NULL,
  assembly_type        TEXT NOT NULL DEFAULT 'module_returnless',
  regulated_psi        REAL NOT NULL,          -- presión de salida ya regulada
  flow_lph             REAL NOT NULL,          -- flujo en litros/hora
  regulator_type       TEXT,                   -- "Integrado al módulo" / "En riel"
  float_type           TEXT,                   -- tipo de flotador / sensor de nivel
  strainer_ref         TEXT,                   -- referencia del cedazo (pre-filtro)
  connector_desc       TEXT,                   -- conector eléctrico
  lines_desc           TEXT,                   -- líneas de combustible (alimentación/retorno/venteo)
  mount_desc           TEXT,                   -- sujeción al tanque (anillo cam-lock, rosca, tornillos)
  diagram_key          TEXT NOT NULL DEFAULT 'module_generic'  -- clave del visor 3D a renderizar
);

-- Pila (bomba en bruto, sin regulador)
CREATE TABLE IF NOT EXISTS fuel_pumps (
  id               SERIAL PRIMARY KEY,
  code             TEXT NOT NULL UNIQUE,   -- ej. BOSCH 69100, WALBRO GSS342
  manufacturer     TEXT NOT NULL,
  pump_style       TEXT NOT NULL,          -- turbina, gerotor, rodillos
  max_psi_direct   REAL NOT NULL,          -- presión máxima directa (deadhead, sin regulador)
  amperage_a       REAL NOT NULL,          -- consumo a presión de trabajo
  voltage_v        REAL NOT NULL DEFAULT 12,
  flow_lph_free    REAL,                   -- flujo libre
  inlet_desc       TEXT,                   -- entrada (cedazo)
  outlet_desc      TEXT,                   -- salida (manguera/check)
  polarity_desc    TEXT,                   -- identificación de polos + y -
  diagram_key      TEXT NOT NULL DEFAULT 'pump_generic'
);

-- Qué módulo usa cada vehículo, dónde está y cómo se accede
CREATE TABLE IF NOT EXISTS vehicle_modules (
  id                    SERIAL PRIMARY KEY,
  vehicle_id            INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  module_id             INTEGER NOT NULL REFERENCES fuel_modules(id) ON DELETE CASCADE,
  location_text         TEXT NOT NULL,     -- descripción detallada de ubicación
  location_zone         TEXT NOT NULL,     -- clave para el diagrama: rear_seat | tank_drop | trunk_access | frame_rail
  requires_tank_removal INTEGER NOT NULL DEFAULT 0,
  access_notes          TEXT,              -- herramientas, precauciones
  UNIQUE (vehicle_id, module_id)
);

-- Compatibilidad módulo <-> pilas de repuesto (OEM y alternativas)
CREATE TABLE IF NOT EXISTS module_pumps (
  id            SERIAL PRIMARY KEY,
  module_id     INTEGER NOT NULL REFERENCES fuel_modules(id) ON DELETE CASCADE,
  pump_id       INTEGER NOT NULL REFERENCES fuel_pumps(id) ON DELETE CASCADE,
  fitment       TEXT NOT NULL DEFAULT 'directa',  -- directa | con adaptación
  is_oem        INTEGER NOT NULL DEFAULT 0,
  notes         TEXT,
  UNIQUE (module_id, pump_id)
);

CREATE INDEX IF NOT EXISTS idx_vehicles_brand ON vehicles(brand_id);
CREATE INDEX IF NOT EXISTS idx_vehicles_inj   ON vehicles(injection_type_id);
CREATE INDEX IF NOT EXISTS idx_vm_vehicle     ON vehicle_modules(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_mp_module      ON module_pumps(module_id);

CREATE TABLE IF NOT EXISTS vehicle_comments (
  id SERIAL PRIMARY KEY,
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  parent_id INTEGER REFERENCES vehicle_comments(id) ON DELETE CASCADE,
  author_name TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_vc_vehicle ON vehicle_comments(vehicle_id);
