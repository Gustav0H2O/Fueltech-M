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

-- ================================================================
-- Tablas de negocio (multi-tenant por taller) — espejo de schema.sql
-- ================================================================

CREATE TABLE IF NOT EXISTS workshops (
  id         SERIAL PRIMARY KEY,
  email      TEXT NOT NULL UNIQUE,
  pass_hash  TEXT NOT NULL,
  name       TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  workshop_id INTEGER NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  expires_at  TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS inventory_items (
  id          SERIAL PRIMARY KEY,
  workshop_id INTEGER NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  sku         TEXT,
  category    TEXT,
  qty         REAL NOT NULL DEFAULT 0,
  min_qty     REAL NOT NULL DEFAULT 0,
  unit_price  REAL NOT NULL DEFAULT 0,
  notes       TEXT,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_inv_ws ON inventory_items(workshop_id);

CREATE TABLE IF NOT EXISTS inventory_moves (
  id          SERIAL PRIMARY KEY,
  workshop_id INTEGER NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  item_id     INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  delta       REAL NOT NULL,
  kind        TEXT NOT NULL,
  order_id    INTEGER,
  note        TEXT,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_moves_ws ON inventory_moves(workshop_id, item_id);

CREATE TABLE IF NOT EXISTS clients (
  id          SERIAL PRIMARY KEY,
  workshop_id INTEGER NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  phone       TEXT,
  email       TEXT,
  address     TEXT,
  city        TEXT,
  notes       TEXT,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_clients_ws ON clients(workshop_id);

CREATE TABLE IF NOT EXISTS client_vehicles (
  id          SERIAL PRIMARY KEY,
  workshop_id INTEGER NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  client_id   INTEGER REFERENCES clients(id) ON DELETE CASCADE,
  brand       TEXT,
  model       TEXT,
  year        INTEGER,
  plate       TEXT,
  vin         TEXT,
  notes       TEXT
);
CREATE INDEX IF NOT EXISTS idx_cv_ws ON client_vehicles(workshop_id, client_id);

CREATE TABLE IF NOT EXISTS work_orders (
  id          SERIAL PRIMARY KEY,
  workshop_id INTEGER NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  client_id   INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  vehicle_id  INTEGER REFERENCES client_vehicles(id) ON DELETE SET NULL,
  type        TEXT NOT NULL DEFAULT 'reparacion',
  title       TEXT NOT NULL,
  descr       TEXT,
  status      TEXT NOT NULL DEFAULT 'Pendiente',
  total       REAL NOT NULL DEFAULT 0,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  closed_at   TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_orders_ws ON work_orders(workshop_id, status);

CREATE TABLE IF NOT EXISTS work_order_items (
  id          SERIAL PRIMARY KEY,
  workshop_id INTEGER NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  order_id    INTEGER NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  item_id     INTEGER REFERENCES inventory_items(id) ON DELETE SET NULL,
  descr       TEXT NOT NULL,
  qty         REAL NOT NULL DEFAULT 1,
  unit_price  REAL NOT NULL DEFAULT 0,
  line_total  REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_woi_order ON work_order_items(order_id);

CREATE TABLE IF NOT EXISTS work_order_photos (
  id          SERIAL PRIMARY KEY,
  workshop_id INTEGER NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  order_id    INTEGER NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  photo       TEXT NOT NULL,
  caption     TEXT,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_wop_order ON work_order_photos(order_id);

CREATE TABLE IF NOT EXISTS documents (
  id          SERIAL PRIMARY KEY,
  workshop_id INTEGER NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  number      TEXT NOT NULL,
  client_id   INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  order_id    INTEGER REFERENCES work_orders(id) ON DELETE SET NULL,
  status      TEXT NOT NULL DEFAULT 'borrador',
  total       REAL NOT NULL DEFAULT 0,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_docs_ws ON documents(workshop_id);

CREATE TABLE IF NOT EXISTS document_items (
  id          SERIAL PRIMARY KEY,
  workshop_id INTEGER NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  item_id     INTEGER REFERENCES inventory_items(id) ON DELETE SET NULL,
  descr       TEXT NOT NULL,
  qty         REAL NOT NULL DEFAULT 1,
  unit_price  REAL NOT NULL DEFAULT 0,
  line_total  REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_di_doc ON document_items(document_id);

CREATE TABLE IF NOT EXISTS connect_profiles (
  id          SERIAL PRIMARY KEY,
  email       TEXT NOT NULL UNIQUE,
  role        TEXT NOT NULL,
  name        TEXT NOT NULL,
  phone       TEXT,
  city        TEXT NOT NULL,
  zone        TEXT,
  address     TEXT,
  lat         REAL,
  lng         REAL,
  offers      TEXT,
  needs       TEXT,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_conn_city ON connect_profiles(city, zone);

CREATE TABLE IF NOT EXISTS diagnostics (
  id          SERIAL PRIMARY KEY,
  workshop_id INTEGER NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  vehicle_id  INTEGER REFERENCES vehicles(id) ON DELETE SET NULL,
  brand       TEXT,
  model       TEXT,
  year        INTEGER,
  measured_psi REAL NOT NULL,
  spec_min    REAL,
  spec_max    REAL,
  verdict     TEXT NOT NULL,
  reasons     TEXT,
  notes       TEXT,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_diag_ws ON diagnostics(workshop_id);

CREATE TABLE IF NOT EXISTS workshop_notes (
  id          SERIAL PRIMARY KEY,
  workshop_id INTEGER NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  text        TEXT NOT NULL,
  vehicle_ref TEXT,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_notes_ws ON workshop_notes(workshop_id);

CREATE TABLE IF NOT EXISTS cash_moves (
  id          SERIAL PRIMARY KEY,
  workshop_id INTEGER NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  concept     TEXT NOT NULL,
  amount      REAL NOT NULL,
  type        TEXT NOT NULL,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_cash_ws ON cash_moves(workshop_id);
