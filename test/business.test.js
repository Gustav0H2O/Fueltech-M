'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { createApp } = require('../server-pg');
const { DBAdapter } = require('../db');
const { seedTestDb } = require('./seed-test');

/* Helper: servidor en puerto aleatorio con bases en memoria */
async function withServer(db, statsDb) {
  const app = await createApp(new DBAdapter(db, 'local'), new DBAdapter(statsDb, 'local'));
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port });
    });
    server.on('error', reject);
  });
}

/* Cliente HTTP que mantiene cookies (sesión) */
function makeClient(port) {
  const jar = new Map();
  return {
    async req(path, opts = {}) {
      const headers = { accept: 'application/json', ...(opts.body ? { 'content-type': 'application/json' } : {}), ...(opts.headers || {}) };
      if (jar.has('ftm_session')) headers.cookie = `ftm_session=${jar.get('ftm_session')}`;
      const res = await fetch(`http://127.0.0.1:${port}${path}`, { ...opts, headers, redirect: 'manual' });
      const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
      for (const c of setCookies) {
        const m = c.match(/^ftm_session=([^;]+)/);
        if (m) jar.set('ftm_session', m[1]);
      }
      const ct = res.headers.get('content-type') || '';
      const body = ct.includes('json') ? await res.json() : await res.text();
      return { status: res.status, body };
    },
    get(p) { return this.req(p); },
    post(p, body) { return this.req(p, { method: 'POST', body: JSON.stringify(body) }); },
    put(p, body) { return this.req(p, { method: 'PUT', body: JSON.stringify(body) }); },
    del(p) { return this.req(p, { method: 'DELETE' }); },
  };
}

describe('Business API (cuentas de taller)', () => {
  let ctx, c1, c2;

  before(async () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    seedTestDb(db);
    const statsDb = new Database(':memory:');
    statsDb.pragma('foreign_keys = ON');
    statsDb.exec(`CREATE TABLE IF NOT EXISTS visit_days (
      day TEXT NOT NULL, visitor_hash TEXT NOT NULL, PRIMARY KEY (day, visitor_hash)
    ) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;`);
    ctx = await withServer(db, statsDb);
    c1 = makeClient(ctx.port);
    c2 = makeClient(ctx.port);
  });

  after(() => ctx.server.close());

  it('registra un taller y crea sesión', async () => {
    const r = await c1.post('/api/auth/register', { email: 'a@taller.com', password: 'password123', name: 'Taller A' });
    assert.equal(r.status, 201);
    assert.equal(r.body.name, 'Taller A');
  });

  it('rechaza correo duplicado', async () => {
    const r = await c1.post('/api/auth/register', { email: 'a@taller.com', password: 'password123', name: 'Duplicado' });
    assert.equal(r.status, 409);
  });

  it('rechaza login con contraseña incorrecta', async () => {
    const r = await c2.post('/api/auth/login', { email: 'a@taller.com', password: 'incorrecta' });
    assert.equal(r.status, 401);
  });

  it('login correcto funciona', async () => {
    const r = await c1.post('/api/auth/login', { email: 'a@taller.com', password: 'password123' });
    assert.equal(r.status, 200);
    assert.equal(r.body.email, 'a@taller.com');
  });

  it('/api/auth/me devuelve el taller', async () => {
    const r = await c1.get('/api/auth/me');
    assert.equal(r.status, 200);
    assert.equal(r.body.name, 'Taller A');
  });

  it('rutas de negocio requieren sesión (401 sin cookie)', async () => {
    const raw = await fetch(`http://127.0.0.1:${ctx.port}/api/inventory`);
    assert.equal(raw.status, 401);
  });

  it('multi-tenant: cada taller solo ve sus datos', async () => {
    await c2.post('/api/auth/register', { email: 'b@taller.com', password: 'password123', name: 'Taller B' });
    await c1.post('/api/inventory', { name: 'Bomba A', qty: 5, min_qty: 1, unit_price: 10 });
    await c2.post('/api/inventory', { name: 'Filtro B', qty: 3, min_qty: 1, unit_price: 5 });
    const a = await c1.get('/api/inventory');
    const b = await c2.get('/api/inventory');
    assert.deepEqual(a.body.map(i => i.name), ['Bomba A']);
    assert.deepEqual(b.body.map(i => i.name), ['Filtro B']);
  });
});

describe('Business API (inventario, órdenes, documentos)', () => {
  let ctx, c;
  let itemId, orderId, clientId;

  before(async () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    seedTestDb(db);
    const statsDb = new Database(':memory:');
    statsDb.pragma('foreign_keys = ON');
    statsDb.exec(`CREATE TABLE IF NOT EXISTS visit_days (
      day TEXT NOT NULL, visitor_hash TEXT NOT NULL, PRIMARY KEY (day, visitor_hash)
    ) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;`);
    ctx = await withServer(db, statsDb);
    c = makeClient(ctx.port);
    await c.post('/api/auth/register', { email: 't@taller.com', password: 'password123', name: 'Taller' });
  });

  after(() => ctx.server.close());

  it('crea item de inventario', async () => {
    const r = await c.post('/api/inventory', { name: 'Bomba BOSCH 69100', qty: 10, min_qty: 2, unit_price: 85.5 });
    assert.equal(r.status, 201);
    itemId = r.body.id;
  });

  it('registra salida de inventario', async () => {
    const r = await c.post(`/api/inventory/${itemId}/moves`, { delta: -3, kind: 'salida', note: 'Venta' });
    assert.equal(r.status, 200);
    assert.equal(r.body.qty, 7);
  });

  it('crea cliente con vehículo', async () => {
    const rc = await c.post('/api/clients', { name: 'Juan Pérez', phone: '555', city: 'Lima' });
    clientId = rc.body.id;
    const rv = await c.post(`/api/clients/${clientId}/vehicles`, { brand: 'Toyota', model: 'Corolla', year: 2010, plate: 'ABC-123' });
    assert.equal(rv.status, 201);
    const list = await c.get(`/api/clients/${clientId}/vehicles`);
    assert.equal(list.body.length, 1);
  });

  it('crea orden de tipo garantía', async () => {
    const r = await c.post('/api/orders', { title: 'Cambio de bomba', type: 'garantia', client_id: clientId });
    assert.equal(r.status, 201);
    orderId = r.body.id;
  });

  it('agregar item a la orden descuenta stock', async () => {
    const r = await c.post(`/api/orders/${orderId}/items`, { item_id: itemId, descr: 'Bomba BOSCH', qty: 2, unit_price: 85.5 });
    assert.equal(r.status, 201);
    const inv = await c.get('/api/inventory');
    assert.equal(inv.body.find(i => i.id === itemId).qty, 5); // 10 - 3 salida - 2 orden
  });

  it('genera nota de entrega con correlativo', async () => {
    const r = await c.post('/api/documents', { kind: 'entrega', client_id: clientId, items: [{ descr: 'Bomba', qty: 1, unit_price: 85.5 }] });
    assert.equal(r.status, 201);
    assert.match(r.body.number, /^NE-\d{4}$/);
  });

  it('la vista imprimible devuelve HTML', async () => {
    const r = await c.post('/api/documents', { kind: 'presupuesto', client_id: clientId, items: [{ descr: 'Filtro', qty: 2, unit_price: 15 }] });
    const print = await c.get(`/api/documents/${r.body.id}/print`);
    assert.equal(print.status, 200);
    assert.ok(print.body.includes('PRESUPUESTO'));
  });

  it('exporta inventario CSV', async () => {
    const res = await fetch(`http://127.0.0.1:${ctx.port}/api/inventory/export?format=csv`);
    // requiere auth
    assert.equal(res.status, 401);
  });

  it('guarda diagnóstico de PSI', async () => {
    const r = await c.post('/api/diagnostics', { vehicle_id: 1, brand: 'Nissan', model: 'Tsuru', measured_psi: 35, spec_min: 36, spec_max: 43, verdict: 'LOW', reasons: ['Presión baja'] });
    assert.equal(r.status, 201);
    const list = await c.get('/api/diagnostics');
    assert.equal(list.body.length, 1);
    assert.equal(list.body[0].verdict, 'LOW');
  });
});

describe('Connect API (matching cliente ↔ mecánico)', () => {
  let ctx;

  before(async () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    seedTestDb(db);
    const statsDb = new Database(':memory:');
    statsDb.pragma('foreign_keys = ON');
    statsDb.exec(`CREATE TABLE IF NOT EXISTS visit_days (
      day TEXT NOT NULL, visitor_hash TEXT NOT NULL, PRIMARY KEY (day, visitor_hash)
    ) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;`);
    ctx = await withServer(db, statsDb);
  });

  after(() => ctx.server.close());

  it('crea perfiles y matchea por similitud de ofrezco/busco', async () => {
    const c = makeClient(ctx.port);
    await c.post('/api/connect/profiles', { email: 'mec@x.com', role: 'mecanico', name: 'Mec X', city: 'Lima', zone: 'Centro', offers: 'inyeccion bombas', needs: '' });
    await c.post('/api/connect/profiles', { email: 'cli@x.com', role: 'cliente', name: 'Cliente Y', city: 'Lima', zone: 'Centro', offers: '', needs: 'inyeccion bombas' });
    const r = await c.get('/api/connect/match?city=Lima&zone=Centro&offers=inyeccion%20bombas&needs=');
    assert.equal(r.status, 200);
    // El cliente que busca "inyeccion bombas" debe aparecer con match_score > 0
    const match = r.body.find(p => p.email === 'cli@x.com');
    assert.ok(match && match.match_score > 0);
  });

  it('valida que ciudad sea obligatoria en el perfil', async () => {
    const c = makeClient(ctx.port);
    const r = await c.post('/api/connect/profiles', { email: 'x@x.com', role: 'mecanico', name: 'Sin Ciudad' });
    assert.equal(r.status, 400);
  });
});
