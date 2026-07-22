// Semilla de datos mínima para tests (bases en memoria)
'use strict';

const Database = require('better-sqlite3');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS injection_types (
  id          INTEGER PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,
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
  engine            TEXT NOT NULL,
  body_type         TEXT NOT NULL DEFAULT 'sedan',
  injection_type_id INTEGER NOT NULL REFERENCES injection_types(id),
  rail_pressure_psi_min REAL NOT NULL,
  rail_pressure_psi_max REAL NOT NULL,
  notes             TEXT,
  data_verified     INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS fuel_modules (
  id                   INTEGER PRIMARY KEY,
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
  id               INTEGER PRIMARY KEY,
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
  id                    INTEGER PRIMARY KEY,
  vehicle_id            INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  module_id             INTEGER NOT NULL REFERENCES fuel_modules(id),
  location_text         TEXT NOT NULL,
  location_zone         TEXT NOT NULL,
  requires_tank_removal INTEGER NOT NULL DEFAULT 0,
  access_notes          TEXT,
  UNIQUE (vehicle_id, module_id)
);
CREATE TABLE IF NOT EXISTS module_pumps (
  id            INTEGER PRIMARY KEY,
  module_id     INTEGER NOT NULL REFERENCES fuel_modules(id) ON DELETE CASCADE,
  pump_id       INTEGER NOT NULL REFERENCES fuel_pumps(id),
  fitment       TEXT NOT NULL DEFAULT 'directa',
  is_oem        INTEGER NOT NULL DEFAULT 0,
  notes         TEXT,
  UNIQUE (module_id, pump_id)
);
CREATE TABLE IF NOT EXISTS vehicle_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  parent_id INTEGER REFERENCES vehicle_comments(id) ON DELETE CASCADE,
  author_name TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_vc_vehicle ON vehicle_comments(vehicle_id);
`;

function seedTestDb(db) {
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);

  // Tipos de inyección
  db.prepare(`INSERT INTO injection_types (id, code, name, description) VALUES (1, 'MFI', 'Full Injection', 'Multipunto')`).run();
  db.prepare(`INSERT INTO injection_types (id, code, name, description) VALUES (2, 'TBI', 'TBI', 'Mono-punto')`).run();
  db.prepare(`INSERT INTO injection_types (id, code, name, description) VALUES (3, 'VORTEC_CSFI', 'Vortec', 'CSFI')`).run();
  db.prepare(`INSERT INTO injection_types (id, code, name, description) VALUES (4, 'GDI', 'GDI', 'Directa')`).run();

  // Marcas
  db.prepare(`INSERT INTO brands (id, name) VALUES (1, 'Nissan')`).run();
  db.prepare(`INSERT INTO brands (id, name) VALUES (2, 'Chevrolet')`).run();
  db.prepare(`INSERT INTO brands (id, name) VALUES (3, 'Volkswagen')`).run();

  // Vehículos
  db.prepare(`INSERT INTO vehicles (id, brand_id, model, year_from, year_to, engine, body_type, injection_type_id, rail_pressure_psi_min, rail_pressure_psi_max, notes, data_verified)
    VALUES (1, 1, 'Tsuru III', 1992, 2017, '1.6L L4 (GA16DE)', 'sedan', 1, 36, 43, NULL, 1)`).run();
  db.prepare(`INSERT INTO vehicles (id, brand_id, model, year_from, year_to, engine, body_type, injection_type_id, rail_pressure_psi_min, rail_pressure_psi_max, notes, data_verified)
    VALUES (2, 1, 'Sentra B15', 2001, 2006, '1.8L L4 (QG18DE)', 'sedan', 1, 47, 51, NULL, 1)`).run();
  db.prepare(`INSERT INTO vehicles (id, brand_id, model, year_from, year_to, engine, body_type, injection_type_id, rail_pressure_psi_min, rail_pressure_psi_max, notes, data_verified)
    VALUES (3, 2, 'Cheyenne', 1988, 1995, '5.7L V8 (350 TBI)', 'pickup', 2, 9, 13, 'TBI test note', 1)`).run();
  db.prepare(`INSERT INTO vehicles (id, brand_id, model, year_from, year_to, engine, body_type, injection_type_id, rail_pressure_psi_min, rail_pressure_psi_max, notes, data_verified)
    VALUES (4, 3, 'Sedán (Vocho)', 1993, 2003, '1.6L B4', 'sedan', 1, 32, 38, 'Bomba externa', 1)`).run();
  db.prepare(`INSERT INTO vehicles (id, brand_id, model, year_from, year_to, engine, body_type, injection_type_id, rail_pressure_psi_min, rail_pressure_psi_max, notes, data_verified)
    VALUES (5, 2, 'Suburban Vortec', 1996, 1999, '5.7L V8 Vortec', 'suv', 3, 60, 66, '⚠ ESTIMADO — Vortec crítico, verificar contra manual', 0)`).run();
  db.prepare(`INSERT INTO vehicles (id, brand_id, model, year_from, year_to, engine, body_type, injection_type_id, rail_pressure_psi_min, rail_pressure_psi_max, notes, data_verified)
    VALUES (6, 3, 'Jetta TSI', 2016, 2021, '1.4L TSI', 'sedan', 4, 58, 87, 'GDI baja', 0)`).run();

  // Módulos
  db.prepare(`INSERT INTO fuel_modules (id, code, name, assembly_type, regulated_psi, flow_lph, regulator_type, float_type, strainer_ref, connector_desc, lines_desc, mount_desc, diagram_key)
    VALUES (1, 'FTM-NIS-001', 'Módulo Tsuru', 'module_returnless', 60, 95, 'Integrado', 'Brazo cerámico', 'Cedazo tela', 'Conector 4 vías', 'Una línea', 'Anillo plástico', 'module_intank_returnless')`).run();
  db.prepare(`INSERT INTO fuel_modules (id, code, name, assembly_type, regulated_psi, flow_lph, regulator_type, float_type, strainer_ref, connector_desc, lines_desc, mount_desc, diagram_key)
    VALUES (2, 'FTM-NIS-002', 'Módulo Sentra', 'module_returnless', 60, 110, 'Integrado', 'Brazo cerámico', 'Cedazo tela', 'Conector 4 vías', 'Una línea', 'Anillo plástico', 'module_intank_returnless')`).run();
  db.prepare(`INSERT INTO fuel_modules (id, code, name, assembly_type, regulated_psi, flow_lph, regulator_type, float_type, strainer_ref, connector_desc, lines_desc, mount_desc, diagram_key)
    VALUES (3, 'FTM-CHE-003', 'Colgante Cheyenne TBI', 'hanger_tbi', 13, 90, 'En cuerpo TBI', 'Resistencia alambre', 'Cedazo cónico', 'Conector GM ovalado', 'Alimentación + retorno', 'Anillo metálico', 'module_hanger')`).run();
  db.prepare(`INSERT INTO fuel_modules (id, code, name, assembly_type, regulated_psi, flow_lph, regulator_type, float_type, strainer_ref, connector_desc, lines_desc, mount_desc, diagram_key)
    VALUES (4, 'FTM-VW-004', 'Bomba externa Vocho', 'external', 38, 95, 'En riel', 'Aforador independiente', 'Filtro en línea', '2 terminales', 'Manguera abrazadera', 'Abrazadera chasis', 'module_external')`).run();
  db.prepare(`INSERT INTO fuel_modules (id, code, name, assembly_type, regulated_psi, flow_lph, regulator_type, float_type, strainer_ref, connector_desc, lines_desc, mount_desc, diagram_key)
    VALUES (5, 'FTM-CHE-005', 'Módulo Vortec', 'vortec', 66, 140, 'En unidad CSFI', 'Brazo cerámico', 'Cedazo tela + externo', 'Conector GM', 'Alimentación + retorno metálico', 'Anillo metálico cam-lock', 'module_intank_return')`).run();
  db.prepare(`INSERT INTO fuel_modules (id, code, name, assembly_type, regulated_psi, flow_lph, regulator_type, float_type, strainer_ref, connector_desc, lines_desc, mount_desc, diagram_key)
    VALUES (6, 'FTM-VW-006', 'Módulo GDI Jetta', 'gdi_low', 87, 125, 'Integrado baja', 'Brazo cerámico', 'Cedazo + jet-pump', 'Conector VAG', 'Una línea quick-connect', 'Anillo plástico', 'module_gdi')`).run();

  // Pilas
  db.prepare(`INSERT INTO fuel_pumps (id, code, manufacturer, pump_style, max_psi_direct, amperage_a, voltage_v, flow_lph_free, inlet_desc, outlet_desc, polarity_desc, diagram_key)
    VALUES (1, 'BOSCH 69100', 'Bosch', 'Turbina', 98, 5.5, 12, 120, 'Entrada inferior', 'Salida superior 8mm', '(+) plano grande', 'pump_generic')`).run();
  db.prepare(`INSERT INTO fuel_pumps (id, code, manufacturer, pump_style, max_psi_direct, amperage_a, voltage_v, flow_lph_free, inlet_desc, outlet_desc, polarity_desc, diagram_key)
    VALUES (2, 'AIRTEX E3210', 'Airtex', 'Rodillos', 65, 4.0, 12, 95, 'Entrada lateral', 'Salida 3/8\"', '(+) terminal gris', 'pump_lowpressure')`).run();
  db.prepare(`INSERT INTO fuel_pumps (id, code, manufacturer, pump_style, max_psi_direct, amperage_a, voltage_v, flow_lph_free, inlet_desc, outlet_desc, polarity_desc, diagram_key)
    VALUES (3, 'WALBRO GSS342', 'Walbro', 'Turbina', 120, 10.0, 12, 255, 'Entrada inferior 11mm', 'Salida superior 10mm', '(+) M4 rojo', 'pump_highpressure')`).run();

  // vehicle_modules
  db.prepare(`INSERT INTO vehicle_modules (vehicle_id, module_id, location_text, location_zone, requires_tank_removal, access_notes) VALUES (1, 1, 'Bajo asiento trasero', 'rear_seat', 0, 'Desconectar batería')`).run();
  db.prepare(`INSERT INTO vehicle_modules (vehicle_id, module_id, location_text, location_zone, requires_tank_removal, access_notes) VALUES (2, 2, 'Bajo asiento trasero', 'rear_seat', 0, 'Desconectar batería')`).run();
  db.prepare(`INSERT INTO vehicle_modules (vehicle_id, module_id, location_text, location_zone, requires_tank_removal, access_notes) VALUES (3, 3, 'Dentro del tanque, sin registro', 'tank_drop', 1, 'Vaciar tanque')`).run();
  db.prepare(`INSERT INTO vehicle_modules (vehicle_id, module_id, location_text, location_zone, requires_tank_removal, access_notes) VALUES (4, 4, 'Bomba externa sobre chasis', 'frame_rail', 0, 'Aliviar presión')`).run();
  db.prepare(`INSERT INTO vehicle_modules (vehicle_id, module_id, location_text, location_zone, requires_tank_removal, access_notes) VALUES (5, 5, 'Dentro del tanque', 'tank_drop', 1, 'Vaciar tanque')`).run();
  db.prepare(`INSERT INTO vehicle_modules (vehicle_id, module_id, location_text, location_zone, requires_tank_removal, access_notes) VALUES (6, 6, 'Bajo asiento trasero', 'rear_seat', 0, 'Desconectar batería')`).run();

  // module_pumps
  db.prepare(`INSERT INTO module_pumps (module_id, pump_id, fitment, is_oem, notes) VALUES (1, 1, 'directa', 1, 'OEM Tsuru')`).run();
  db.prepare(`INSERT INTO module_pumps (module_id, pump_id, fitment, is_oem, notes) VALUES (1, 2, 'con adaptación', 0, 'Alternativa baja presión')`).run();
  db.prepare(`INSERT INTO module_pumps (module_id, pump_id, fitment, is_oem, notes) VALUES (2, 1, 'directa', 1, 'OEM Sentra')`).run();
  db.prepare(`INSERT INTO module_pumps (module_id, pump_id, fitment, is_oem, notes) VALUES (3, 2, 'directa', 1, 'OEM Cheyenne TBI')`).run();
  db.prepare(`INSERT INTO module_pumps (module_id, pump_id, fitment, is_oem, notes) VALUES (4, 2, 'directa', 1, 'OEM Vocho')`).run();
  db.prepare(`INSERT INTO module_pumps (module_id, pump_id, fitment, is_oem, notes) VALUES (5, 1, 'con adaptación', 0, 'Alternativa Vortec')`).run();
  db.prepare(`INSERT INTO module_pumps (module_id, pump_id, fitment, is_oem, notes) VALUES (6, 1, 'directa', 1, 'OEM GDI baja')`).run();
  db.prepare(`INSERT INTO module_pumps (module_id, pump_id, fitment, is_oem, notes) VALUES (6, 3, 'con adaptación', 0, 'Alto flujo GDI')`).run();
}

module.exports = { seedTestDb };
