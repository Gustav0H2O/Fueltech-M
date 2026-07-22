CREATE TABLE IF NOT EXISTS injection_types (
  id          SERIAL PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  description TEXT
);

CREATE TABLE IF NOT EXISTS brands (
  id   SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS vehicles (
  id                SERIAL PRIMARY KEY,
  brand_id          INTEGER NOT NULL REFERENCES brands(id),
  model             TEXT NOT NULL,
  year_from         INTEGER NOT NULL,
  year_to           INTEGER NOT NULL,
  engine            TEXT NOT NULL,
  body_type         TEXT NOT NULL DEFAULT 'sedan',
  injection_type_id INTEGER NOT NULL REFERENCES injection_types(id),
  rail_pressure_psi_min REAL NOT NULL,
  rail_pressure_psi_max REAL NOT NULL,
  notes             TEXT,
  data_verified     INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS fuel_modules (
  id                   SERIAL PRIMARY KEY,
  code                 TEXT NOT NULL UNIQUE,
  name                 TEXT NOT NULL,
  assembly_type        TEXT NOT NULL DEFAULT 'module_returnless',
  regulated_psi        REAL NOT NULL,
  flow_lph             REAL NOT NULL,
  regulator_type       TEXT,
  float_type           TEXT,
  strainer_ref         TEXT,
  connector_desc       TEXT,
  lines_desc           TEXT,
  mount_desc           TEXT,
  diagram_key          TEXT NOT NULL DEFAULT 'module_generic'
);

CREATE TABLE IF NOT EXISTS fuel_pumps (
  id               SERIAL PRIMARY KEY,
  code             TEXT NOT NULL UNIQUE,
  manufacturer     TEXT NOT NULL,
  pump_style       TEXT NOT NULL,
  max_psi_direct   REAL NOT NULL,
  amperage_a       REAL NOT NULL,
  voltage_v        REAL NOT NULL DEFAULT 12,
  flow_lph_free    REAL,
  inlet_desc       TEXT,
  outlet_desc      TEXT,
  polarity_desc    TEXT,
  diagram_key      TEXT NOT NULL DEFAULT 'pump_generic'
);

CREATE TABLE IF NOT EXISTS vehicle_modules (
  id                    SERIAL PRIMARY KEY,
  vehicle_id            INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  module_id             INTEGER NOT NULL REFERENCES fuel_modules(id),
  location_text         TEXT NOT NULL,
  location_zone         TEXT NOT NULL,
  requires_tank_removal INTEGER NOT NULL DEFAULT 0,
  access_notes          TEXT,
  UNIQUE (vehicle_id, module_id)
);

CREATE TABLE IF NOT EXISTS module_pumps (
  id            SERIAL PRIMARY KEY,
  module_id     INTEGER NOT NULL REFERENCES fuel_modules(id) ON DELETE CASCADE,
  pump_id       INTEGER NOT NULL REFERENCES fuel_pumps(id),
  fitment       TEXT NOT NULL DEFAULT 'directa',
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

CREATE TABLE IF NOT EXISTS visit_days (
  day          TEXT NOT NULL,
  visitor_hash TEXT NOT NULL,
  PRIMARY KEY (day, visitor_hash)
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_limits (
  day TEXT NOT NULL,
  device_id TEXT NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (day, device_id)
);

CREATE TABLE IF NOT EXISTS missing_searches (
  day TEXT NOT NULL,
  q TEXT NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (day, q)
);
