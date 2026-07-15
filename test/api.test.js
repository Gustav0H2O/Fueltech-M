'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { createApp } = require('../server');
const { seedTestDb } = require('./seed-test');

/* ---------- Helper: arrancar servidor en puerto aleatorio ---------- */
async function withServer(db, statsDb) {
  const app = createApp(db, statsDb);
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, port });
    });
    server.on('error', reject);
  });
}

/* ---------- Helper: fetch con parseo JSON ---------- */
async function api(port, path, opts = {}) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    headers: { 'accept': 'application/json', ...opts.headers },
    ...opts
  });
  const body = res.headers.get('content-type')?.includes('json')
    ? await res.json()
    : await res.text();
  return { status: res.status, headers: res.headers, body };
}

/* ---------- Suite principal ---------- */
describe('FuelTech Master API', () => {
  /** @type {{ server: http.Server, port: number }} */
  let ctx;

  before(async () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    seedTestDb(db);

    const statsDb = new Database(':memory:');
    statsDb.pragma('foreign_keys = ON');
    statsDb.exec(`CREATE TABLE IF NOT EXISTS visit_days (
      day TEXT NOT NULL, visitor_hash TEXT NOT NULL,
      PRIMARY KEY (day, visitor_hash)
    ) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;`);

    ctx = await withServer(db, statsDb);
    // Guardamos referencias para cerrar después
    ctx.db = db;
    ctx.statsDb = statsDb;
  });

  after(() => {
    ctx.server.close();
    ctx.db.close();
    ctx.statsDb.close();
  });

  /* ===================== /healthz ===================== */
  describe('GET /healthz', () => {
    it('devuelve 200 con { ok: true }', async () => {
      const { status, body } = await api(ctx.port, '/healthz');
      assert.equal(status, 200);
      assert.deepEqual(body, { ok: true });
    });
  });

  /* ===================== /api/meta ===================== */
  describe('GET /api/meta', () => {
    it('devuelve 200 con marcas, tipos, rango de años y total', async () => {
      const { status, body } = await api(ctx.port, '/api/meta');
      assert.equal(status, 200);
      assert.ok(Array.isArray(body.brands));
      assert.ok(body.brands.length >= 3);
      assert.ok(body.brands[0].id && body.brands[0].name);
      assert.ok(Array.isArray(body.injection_types));
      assert.ok(body.injection_types.length >= 4);
      assert.ok(body.year_range.min && body.year_range.max);
      assert.ok(typeof body.total_vehicles === 'number');
      assert.equal(body.total_vehicles, 6);
    });
  });

  /* ===================== /api/vehicles ===================== */
  describe('GET /api/vehicles', () => {
    it('devuelve todos los vehículos sin filtros', async () => {
      const { status, body } = await api(ctx.port, '/api/vehicles');
      assert.equal(status, 200);
      assert.ok(Array.isArray(body));
      assert.equal(body.length, 6);
    });

    it('filtra por brand_id', async () => {
      const { status, body } = await api(ctx.port, '/api/vehicles?brand_id=1');
      assert.equal(status, 200);
      assert.ok(body.every(v => v.brand === 'Nissan'));
      assert.equal(body.length, 2);
    });

    it('filtra por modelo (búsqueda LIKE)', async () => {
      const { status, body } = await api(ctx.port, '/api/vehicles?model=Tsuru');
      assert.equal(status, 200);
      assert.equal(body.length, 1);
      assert.equal(body[0].model, 'Tsuru III');
    });

    it('filtra por año', async () => {
      const { status, body } = await api(ctx.port, '/api/vehicles?year=2005');
      assert.equal(status, 200);
      // años: Tsuru 92-17, Sentra 01-06, Cheyenne 88-95, Vocho 93-03, Vortec 96-99, Jetta 16-21
      // 2005: Tsuru, Sentra
      assert.ok(body.length >= 2);
    });

    it('filtra por injection_type_id', async () => {
      const { status, body } = await api(ctx.port, '/api/vehicles?injection_type_id=2');
      assert.equal(status, 200);
      assert.ok(body.every(v => v.injection_code === 'TBI'));
    });

    it('ordena por psi_desc', async () => {
      const { status, body } = await api(ctx.port, '/api/vehicles?order_by=psi_desc');
      assert.equal(status, 200);
      for (let i = 1; i < body.length; i++) {
        assert.ok(body[i - 1].rail_pressure_psi_max >= body[i].rail_pressure_psi_max);
      }
    });

    it('ordena por year_desc', async () => {
      const { status, body } = await api(ctx.port, '/api/vehicles?order_by=year_desc');
      assert.equal(status, 200);
      for (let i = 1; i < body.length; i++) {
        assert.ok(body[i - 1].year_from >= body[i].year_from);
      }
    });

    it('respeta limit y offset', async () => {
      const { body: all } = await api(ctx.port, '/api/vehicles');
      const { status, body } = await api(ctx.port, '/api/vehicles?limit=2&offset=1');
      assert.equal(status, 200);
      assert.equal(body.length, 2);
      assert.equal(body[0].id, all[1].id);
    });

    it('incluye rail_pressure_bar_min / max', async () => {
      const { body } = await api(ctx.port, '/api/vehicles');
      const v = body[0];
      assert.ok(typeof v.rail_pressure_bar_min === 'number');
      assert.ok(typeof v.rail_pressure_bar_max === 'number');
    });

    it('incluye data_verified como booleano', async () => {
      const { body } = await api(ctx.port, '/api/vehicles');
      const unverified = body.find(v => v.id === 5);
      assert.equal(unverified.data_verified, false);
      const verified = body.find(v => v.id === 1);
      assert.equal(verified.data_verified, true);
    });

    it('sin resultados: devuelve array vacío si no hay match', async () => {
      const { status, body } = await api(ctx.port, '/api/vehicles?model=ZZZIMPOSIBLE');
      assert.equal(status, 200);
      assert.ok(Array.isArray(body));
      assert.equal(body.length, 0);
    });
  });

  /* ===================== /api/vehicles/:id ===================== */
  describe('GET /api/vehicles/:id', () => {
    it('devuelve ficha completa con módulos y pilas', async () => {
      const { status, body } = await api(ctx.port, '/api/vehicles/1');
      assert.equal(status, 200);
      assert.equal(body.id, 1);
      assert.equal(body.brand, 'Nissan');
      assert.equal(body.model, 'Tsuru III');
      assert.ok(body.injection);
      assert.equal(body.injection.code, 'MFI');
      assert.ok(body.rail_pressure.psi_min && body.rail_pressure.psi_max);
      assert.ok(body.rail_pressure.bar_min && body.rail_pressure.bar_max);
      assert.ok(Array.isArray(body.modules));
      assert.equal(body.modules.length, 1);

      const mod = body.modules[0];
      assert.ok(mod.id);
      assert.ok(mod.code);
      assert.ok(mod.location);
      assert.ok(mod.specs);
      assert.equal(mod.location.zone, 'rear_seat');
      assert.ok(Array.isArray(mod.compatible_pumps));
      assert.equal(mod.compatible_pumps.length, 2);
      assert.ok(typeof mod.compatible_pumps[0].is_oem === 'boolean');
      // OEM primero en la lista
      assert.equal(mod.compatible_pumps[0].is_oem, true);
    });

    it('404 para vehículo inexistente', async () => {
      const { status, body } = await api(ctx.port, '/api/vehicles/9999');
      assert.equal(status, 404);
      assert.equal(body.error, 'Vehículo no encontrado');
    });

    it('404 para ID inválido (string no numérico)', async () => {
      const { status, body } = await api(ctx.port, '/api/vehicles/xxx');
      assert.equal(status, 404);
      assert.equal(body.error, 'Vehículo no encontrado');
    });

    it('vehículo con data_verified = 0 muestra el flag', async () => {
      const { body } = await api(ctx.port, '/api/vehicles/5');
      assert.equal(body.data_verified, false);
      assert.ok(body.notes?.includes('ESTIMADO'));
    });

    it('vehículo con bomba externa (frame_rail) no tiene tank_removal', async () => {
      const { body } = await api(ctx.port, '/api/vehicles/4');
      assert.equal(body.modules[0].location.zone, 'frame_rail');
      assert.equal(body.modules[0].location.requires_tank_removal, false);
    });

    it('vehículo con requires_tank_removal = 1 (tank_drop)', async () => {
      const { body } = await api(ctx.port, '/api/vehicles/3');
      assert.equal(body.modules[0].location.zone, 'tank_drop');
      assert.equal(body.modules[0].location.requires_tank_removal, true);
    });

    it('vehículo GDI regresa assembly_type = gdi_low', async () => {
      const { body } = await api(ctx.port, '/api/vehicles/6');
      assert.equal(body.modules[0].assembly_type, 'gdi_low');
    });
  });

  /* ===================== /api/modules ===================== */
  describe('GET /api/modules', () => {
    it('devuelve lista paginada de módulos', async () => {
      const { status, body } = await api(ctx.port, '/api/modules');
      assert.equal(status, 200);
      assert.ok(Array.isArray(body));
      assert.equal(body.length, 6);
      assert.ok(body[0].id && body[0].code && body[0].name);
    });

    it('incluye regulated_bar', async () => {
      const { body } = await api(ctx.port, '/api/modules');
      assert.ok(typeof body[0].regulated_bar === 'number');
    });

    it('respeta limit y offset', async () => {
      const { body } = await api(ctx.port, '/api/modules?limit=2&offset=2');
      assert.equal(body.length, 2);
    });
  });

  describe('GET /api/modules/:id', () => {
    it('devuelve módulo por ID', async () => {
      const { status, body } = await api(ctx.port, '/api/modules/1');
      assert.equal(status, 200);
      assert.equal(body.id, 1);
      assert.equal(body.code, 'FTM-NIS-001');
    });

    it('404 si no existe', async () => {
      const { status, body } = await api(ctx.port, '/api/modules/9999');
      assert.equal(status, 404);
      assert.equal(body.error, 'Módulo no encontrado');
    });
  });

  /* ===================== /api/pumps ===================== */
  describe('GET /api/pumps', () => {
    it('devuelve lista de pilas con max_bar_direct', async () => {
      const { status, body } = await api(ctx.port, '/api/pumps');
      assert.equal(status, 200);
      assert.ok(Array.isArray(body));
      assert.equal(body.length, 3);
      assert.ok(body[0].max_bar_direct);
      assert.ok(typeof body[0].max_bar_direct === 'number');
    });
  });

  describe('GET /api/pumps/:id', () => {
    it('devuelve pila por ID', async () => {
      const { status, body } = await api(ctx.port, '/api/pumps/1');
      assert.equal(status, 200);
      assert.equal(body.id, 1);
      assert.equal(body.code, 'BOSCH 69100');
      assert.ok(body.max_bar_direct);
    });

    it('404 si no existe', async () => {
      const { status, body } = await api(ctx.port, '/api/pumps/9999');
      assert.equal(status, 404);
      assert.equal(body.error, 'Pila no encontrada');
    });
  });

  /* ===================== /api/visit ===================== */
  describe('POST /api/visit', () => {
    it('devuelve conteo de visitas', async () => {
      const { status, body } = await api(ctx.port, '/api/visit', { method: 'POST' });
      assert.equal(status, 200);
      assert.ok(typeof body.total === 'number');
      assert.ok(typeof body.today === 'number');
    });
  });

  /* ===================== 404 en /api ===================== */
  describe('Rutas inexistentes', () => {
    it('devuelve 404 para /api/xyz', async () => {
      const { status, body } = await api(ctx.port, '/api/xyz');
      assert.equal(status, 404);
      assert.equal(body.error, 'No encontrado');
    });

    it('devuelve 404 para /api/vehicles/abc/extra', async () => {
      const { status, body } = await api(ctx.port, '/api/vehicles/1/extra');
      assert.equal(status, 404);
    });
  });

  /* ===================== Esquemas de respuesta ===================== */
  describe('Validación de esquemas', () => {
    it('vehículos tienen todos los campos requeridos', async () => {
      const { body } = await api(ctx.port, '/api/vehicles');
      for (const v of body) {
        assert.ok(v.id, 'id');
        assert.ok(v.brand, 'brand');
        assert.ok(v.model, 'model');
        assert.ok(v.year_from, 'year_from');
        assert.ok(v.year_to, 'year_to');
        assert.ok(v.engine, 'engine');
        assert.ok(v.injection_code, 'injection_code');
        assert.ok(typeof v.rail_pressure_psi_min === 'number', 'psi_min');
        assert.ok(typeof v.rail_pressure_psi_max === 'number', 'psi_max');
        assert.ok(typeof v.rail_pressure_bar_min === 'number', 'bar_min');
        assert.ok(typeof v.rail_pressure_bar_max === 'number', 'bar_max');
      }
    });

    it('ficha de vehículo tiene estructura anidada completa', async () => {
      const { body } = await api(ctx.port, '/api/vehicles/1');
      // Campos raíz
      assert.ok(body.id && body.brand && body.model);
      assert.ok(body.injection?.code && body.injection?.name);
      assert.ok(body.rail_pressure?.psi_min);
      assert.ok(body.rail_pressure?.bar_min);
      // Módulos
      for (const m of body.modules) {
        assert.ok(m.id && m.code);
        assert.ok(m.location?.zone && m.location?.text);
        assert.ok(m.specs?.regulated_psi && m.specs?.regulated_bar);
        assert.ok(Array.isArray(m.compatible_pumps));
        for (const p of m.compatible_pumps) {
          assert.ok(p.id && p.code && p.manufacturer);
          assert.ok(typeof p.is_oem === 'boolean');
          assert.ok(typeof p.max_bar_direct === 'number');
        }
      }
    });
  });

  /* ===================== Headers de seguridad ===================== */
  describe('Headers de seguridad', () => {
    it('incluye Content-Security-Policy', async () => {
      const { headers } = await api(ctx.port, '/healthz');
      assert.ok(headers.has('content-security-policy'));
    });

    it('incluye Strict-Transport-Security', async () => {
      const { headers } = await api(ctx.port, '/healthz');
      assert.ok(headers.has('strict-transport-security'));
    });

    it('incluye Permissions-Policy', async () => {
      const { headers } = await api(ctx.port, '/healthz');
      assert.ok(headers.has('permissions-policy'));
    });

    it('no expone x-powered-by', async () => {
      const { headers } = await api(ctx.port, '/healthz');
      assert.equal(headers.has('x-powered-by'), false);
    });
  });

  /* ===================== Cache-Control ===================== */
  describe('Cache-Control', () => {
    it('/api/vehicles/:id usa no-store', async () => {
      const { headers } = await api(ctx.port, '/api/vehicles/1');
      assert.equal(headers.get('cache-control'), 'no-store');
    });

    it('/api/visit usa no-store', async () => {
      const { headers } = await api(ctx.port, '/api/visit', { method: 'POST' });
      assert.equal(headers.get('cache-control'), 'no-store');
    });
  });
});

/* ===================== Tests de toInt ===================== */
describe('toInt (función utilitaria)', () => {
  const { toInt } = require('../server');

  it('parsea enteros válidos', () => {
    assert.equal(toInt('42', 0, 100), 42);
    assert.equal(toInt('1', 1, 1e9), 1);
  });

  it('clampa al rango', () => {
    assert.equal(toInt('9999999', 0, 10000), 10000);
    assert.equal(toInt('-5', 0, 100), 0);
  });

  it('devuelve null para NaN, undefined o strings no numéricos', () => {
    assert.equal(toInt('abc', 0, 100), null);
    assert.equal(toInt('', 0, 100), null);
    assert.equal(toInt(undefined, 0, 100), null);
  });

  it('devuelve null para números no seguros (overflow)', () => {
    assert.equal(toInt('99999999999999999', 0, 1e9), null);
  });
});

/* ===================== Tests de psiToBar ===================== */
describe('psiToBar (función utilitaria)', () => {
  const { psiToBar } = require('../server');

  it('convierte PSI a bar correctamente', () => {
    assert.equal(psiToBar(0), 0);
    assert.equal(psiToBar(14.5038), 1);    // ~1 bar
    assert.equal(psiToBar(100), 6.89);     // 100 * 0.0689476 ≈ 6.89
  });

  it('devuelve null para null/undefined', () => {
    assert.equal(psiToBar(null), null);
    assert.equal(psiToBar(undefined), null);
  });
});
