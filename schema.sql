-- FuelTech Master — Esquema relacional (SQLite)
-- Cadena de datos: Vehículo -> Tipo de inyección -> Módulo -> Pila -> Presiones (PSI/Bar)

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS injection_types (
  id          INTEGER PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,      -- MFI, TBI, VORTEC_CSFI, GDI...
  name        TEXT NOT NULL,
  description TEXT
);

CREATE TABLE IF NOT EXISTS brands (
  id   INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS vehicles (
  id                INTEGER PRIMARY KEY,
  brand_id          INTEGER NOT NULL REFERENCES brands(id),
  model             TEXT NOT NULL,
  year_from         INTEGER NOT NULL,
  year_to           INTEGER NOT NULL,
  engine            TEXT NOT NULL,       -- ej. "1.6L L4 16v"
  body_type         TEXT NOT NULL DEFAULT 'sedan',  -- sedan | hatchback | pickup | suv | van (modelo 3D)
  injection_type_id INTEGER NOT NULL REFERENCES injection_types(id),
  rail_pressure_psi_min REAL NOT NULL,   -- presión en flauta/riel (llave ON)
  rail_pressure_psi_max REAL NOT NULL,
  notes             TEXT,
  data_verified     INTEGER NOT NULL DEFAULT 1  -- 0 = specs estimadas por clase, pendientes de verificar contra manual
);

-- Módulo (ensamble completo: carcasa, regulador, flotador, cedazo, conectores)
CREATE TABLE IF NOT EXISTS fuel_modules (
  id                   INTEGER PRIMARY KEY,
  code                 TEXT NOT NULL UNIQUE,   -- código de catálogo
  name                 TEXT NOT NULL,
  -- assembly_type: tipo real de ensamble
  --   external          bomba externa sobre chasis (no hay módulo en tanque)
  --   hanger_tbi        colgante porta-pila TBI (no regula; el regulador vive en el cuerpo TBI)
  --   hanger_return     colgante/módulo sin regulador (regulador en riel, con retorno)
  --   module_returnless módulo integrado con regulador y filtro en el vaso (sin retorno)
  --   vortec            módulo GM Vortec (regulador en la unidad CSFI del pleno, con retorno)
  --   gdi_low           módulo de baja GDI con jet-pump y regulador integrado
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
  id               INTEGER PRIMARY KEY,
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
  id                    INTEGER PRIMARY KEY,
  vehicle_id            INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  module_id             INTEGER NOT NULL REFERENCES fuel_modules(id),
  location_text         TEXT NOT NULL,     -- descripción detallada de ubicación
  location_zone         TEXT NOT NULL,     -- clave para el diagrama: rear_seat | tank_drop | trunk_access | frame_rail
  requires_tank_removal INTEGER NOT NULL DEFAULT 0,
  access_notes          TEXT,              -- herramientas, precauciones
  UNIQUE (vehicle_id, module_id)
);

-- Compatibilidad módulo <-> pilas de repuesto (OEM y alternativas)
CREATE TABLE IF NOT EXISTS module_pumps (
  id            INTEGER PRIMARY KEY,
  module_id     INTEGER NOT NULL REFERENCES fuel_modules(id) ON DELETE CASCADE,
  pump_id       INTEGER NOT NULL REFERENCES fuel_pumps(id),
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
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  parent_id INTEGER REFERENCES vehicle_comments(id) ON DELETE CASCADE,
  author_name TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_vc_vehicle ON vehicle_comments(vehicle_id);

-- ================================================================
-- Tablas de negocio (multi-tenant por taller)
-- ================================================================

-- Cuentas de mecánicos (workshops)
CREATE TABLE IF NOT EXISTS workshops (
  id         INTEGER PRIMARY KEY,
  email      TEXT NOT NULL UNIQUE,
  pass_hash  TEXT NOT NULL,          -- scrypt (node:crypto), sal embebida
  name       TEXT NOT NULL,          -- nombre del taller / dueño
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Sesiones (token HMAC-signed, httpOnly cookie o Bearer)
CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,     -- sha256 del token
  workshop_id INTEGER NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  expires_at  DATETIME NOT NULL
);

-- Inventario
CREATE TABLE IF NOT EXISTS inventory_items (
  id          INTEGER PRIMARY KEY,
  workshop_id INTEGER NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  sku         TEXT,
  category    TEXT,
  qty         REAL NOT NULL DEFAULT 0,
  min_qty     REAL NOT NULL DEFAULT 0,
  unit_price  REAL NOT NULL DEFAULT 0,
  notes       TEXT,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_inv_ws ON inventory_items(workshop_id);

-- Movimientos de inventario (entradas/salidas/ajustes/consumo por orden)
CREATE TABLE IF NOT EXISTS inventory_moves (
  id         INTEGER PRIMARY KEY,
  workshop_id INTEGER NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  item_id    INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  delta      REAL NOT NULL,          -- + entrada, − salida/consumo
  kind       TEXT NOT NULL,          -- entrada | salida | ajuste | orden
  order_id   INTEGER,                -- FK opcional a work_orders
  note       TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_moves_ws ON inventory_moves(workshop_id, item_id);

-- Clientes (cartera)
CREATE TABLE IF NOT EXISTS clients (
  id          INTEGER PRIMARY KEY,
  workshop_id INTEGER NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  phone       TEXT,
  email       TEXT,
  address     TEXT,
  city        TEXT,
  notes       TEXT,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_clients_ws ON clients(workshop_id);

-- Vehículos de clientes (para órdenes y seguimiento)
CREATE TABLE IF NOT EXISTS client_vehicles (
  id          INTEGER PRIMARY KEY,
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

-- Órdenes de trabajo / servicios (con tipo para garantías, promociones, auditoría)
CREATE TABLE IF NOT EXISTS work_orders (
  id          INTEGER PRIMARY KEY,
  workshop_id INTEGER NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  client_id   INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  vehicle_id  INTEGER REFERENCES client_vehicles(id) ON DELETE SET NULL,
  type        TEXT NOT NULL DEFAULT 'reparacion',  -- reparacion|servicio|garantia|promocion|otro
  title       TEXT NOT NULL,
  descr       TEXT,
  status      TEXT NOT NULL DEFAULT 'Pendiente',   -- Pendiente|En proceso|Listo|Entregado|Cancelado
  total       REAL NOT NULL DEFAULT 0,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  closed_at   DATETIME
);
CREATE INDEX IF NOT EXISTS idx_orders_ws ON work_orders(workshop_id, status);

-- Piezas/items de la orden (vincula inventario; al guardar descuenta stock)
CREATE TABLE IF NOT EXISTS work_order_items (
  id          INTEGER PRIMARY KEY,
  workshop_id INTEGER NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  order_id    INTEGER NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  item_id     INTEGER REFERENCES inventory_items(id) ON DELETE SET NULL,
  descr       TEXT NOT NULL,
  qty         REAL NOT NULL DEFAULT 1,
  unit_price  REAL NOT NULL DEFAULT 0,
  line_total  REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_woi_order ON work_order_items(order_id);

-- Evidencia (fotos) por orden
CREATE TABLE IF NOT EXISTS work_order_photos (
  id          INTEGER PRIMARY KEY,
  workshop_id INTEGER NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  order_id    INTEGER NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  photo       TEXT NOT NULL,          -- data URL base64 (JPEG ~200KB)
  caption     TEXT,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_wop_order ON work_order_photos(order_id);

-- Notas de entrega y presupuestos (con items)
CREATE TABLE IF NOT EXISTS documents (
  id          INTEGER PRIMARY KEY,
  workshop_id INTEGER NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,          -- entrega | presupuesto
  number      TEXT NOT NULL,          -- correlativo por taller (ej. NE-0001 / P-0001)
  client_id   INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  order_id    INTEGER REFERENCES work_orders(id) ON DELETE SET NULL,
  status      TEXT NOT NULL DEFAULT 'borrador',  -- borrador|emitido|aprobado|rechazado|entregado
  total       REAL NOT NULL DEFAULT 0,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_docs_ws ON documents(workshop_id);

CREATE TABLE IF NOT EXISTS document_items (
  id          INTEGER PRIMARY KEY,
  workshop_id INTEGER NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  item_id     INTEGER REFERENCES inventory_items(id) ON DELETE SET NULL,
  descr       TEXT NOT NULL,
  qty         REAL NOT NULL DEFAULT 1,
  unit_price  REAL NOT NULL DEFAULT 0,
  line_total  REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_di_doc ON document_items(document_id);

-- Perfiles de conexión cliente ↔ mecánico (ubicación + ofrezco/busco)
CREATE TABLE IF NOT EXISTS connect_profiles (
  id          INTEGER PRIMARY KEY,
  email       TEXT NOT NULL UNIQUE,
  role        TEXT NOT NULL,          -- mecanico | cliente | tienda
  name        TEXT NOT NULL,
  phone       TEXT,
  city        TEXT NOT NULL,
  zone        TEXT,
  address     TEXT,
  lat         REAL,                   -- opcional (GPS)
  lng         REAL,
  offers      TEXT,                   -- "qué ofreces"
  needs       TEXT,                   -- "qué pides que te ofrezcan"
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_conn_city ON connect_profiles(city, zone);

-- Diagnóstico rápido de PSI (historial de corridas)
CREATE TABLE IF NOT EXISTS diagnostics (
  id          INTEGER PRIMARY KEY,
  workshop_id INTEGER NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  vehicle_id  INTEGER REFERENCES vehicles(id) ON DELETE SET NULL,
  brand       TEXT,
  model       TEXT,
  year        INTEGER,
  measured_psi REAL NOT NULL,
  spec_min    REAL,
  spec_max    REAL,
  verdict     TEXT NOT NULL,          -- OK | LOW | HIGH | NO_SPEC
  reasons     TEXT,                   -- JSON array de explicaciones
  notes       TEXT,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_diag_ws ON diagnostics(workshop_id);

-- Notas del mecánico (por taller)
CREATE TABLE IF NOT EXISTS workshop_notes (
  id          INTEGER PRIMARY KEY,
  workshop_id INTEGER NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  text        TEXT NOT NULL,
  vehicle_ref TEXT,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_notes_ws ON workshop_notes(workshop_id);

-- Movimientos de caja (ingresos/egresos)
CREATE TABLE IF NOT EXISTS cash_moves (
  id          INTEGER PRIMARY KEY,
  workshop_id INTEGER NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  concept     TEXT NOT NULL,
  amount      REAL NOT NULL,
  type        TEXT NOT NULL,          -- ingreso | egreso
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_cash_ws ON cash_moves(workshop_id);
