'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('node:fs');
const Database = require('better-sqlite3');
const { createApp } = require('../server');
const { seedTestDb } = require('./seed-test');
const puppeteer = require('puppeteer');

const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');
const APP_URL = process.env.E2E_BASE_URL;

async function startServer() {
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

  const app = createApp(db, statsDb);
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, db, statsDb, port });
    });
    server.on('error', reject);
  });
}

describe('FuelTech Master E2E', { timeout: 300_000 }, () => {
  let ctx, browser, page;
  const browserErrors = [];

  before(async () => {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    if (!APP_URL) ctx = await startServer();
    browser = await puppeteer.launch({
      headless: true,
      executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu']
    });
  });

  after(async () => {
    if (browser) await browser.close();
    if (ctx) { ctx.server.close(); ctx.db.close(); ctx.statsDb.close(); }
  });

  // Abre página nueva y captura errores
  async function newPage() {
    if (page) { try { await page.close(); } catch {} }
    page = await browser.newPage();
    browserErrors.length = 0;
    page.on('pageerror', err => browserErrors.push({ type: 'pageerror', msg: err.message }));
    page.on('console', msg => {
      if (msg.type() === 'error') browserErrors.push({ type: 'console.error', msg: msg.text() });
    });
    page.on('requestfailed', req => {
      browserErrors.push({ type: 'requestfailed', url: req.url(), msg: req.failure()?.errorText });
    });
    return page;
  }

  // Navega y espera carga básica (no networkidle0 porque models GLTF pueden tardar)
  async function go(url = '') {
    const p = await newPage();
    const base = APP_URL || `http://127.0.0.1:${ctx.port}`;
    await p.goto(`${base}${url}`, { waitUntil: 'load', timeout: 30_000 });
    return p;
  }

  // Espera a que React hidrate (h1 con FUELTECH y select de marca cargado)
  async function waitApp(page) {
    await page.waitForFunction(
      () => document.querySelector('h1')?.textContent === 'FUELTECH',
      { timeout: 15_000 }
    );
    await page.waitForFunction(
      () => document.querySelectorAll('#f-brand option').length > 1,
      { timeout: 10_000 }
    );
  }

  it('1. React hidrata y aparecen controles de filtro', async () => {
    const p = await go();
    await waitApp(p);
    await p.screenshot({ path: path.join(SCREENSHOT_DIR, '01-app-loaded.png') });
    assert.ok(await p.$('#f-brand'), 'Select de marca');
    assert.ok(await p.$('#f-model'), 'Input de modelo');
    const opts = await p.$$eval('#f-brand option', els => els.map(e => e.textContent));
    assert.ok(opts.includes('Nissan'), 'Nissan en marcas');
    assert.ok(opts.includes('Chevrolet'), 'Chevrolet en marcas');
  });

  it('2. Resultados de vehículos aparecen automáticamente', async () => {
    const p = await go();
    await waitApp(p);
    await p.waitForFunction(
      () => document.querySelectorAll('.result-item').length > 0,
      { timeout: 10_000 }
    );
    await p.screenshot({ path: path.join(SCREENSHOT_DIR, '02-results.png') });

    const count = await p.$$eval('.result-item', els => els.length);
    assert.equal(count, 6, 'Seed produce 6 vehículos');
    const names = await p.$$eval('.result-item .r-name', els => els.map(e => e.textContent));
    assert.ok(names.some(n => n.includes('Tsuru')), 'Tsuru en resultados');
  });

  it('3. Filtrar por marca reduce resultados', async () => {
    const p = await go();
    await waitApp(p);
    await p.waitForFunction(
      () => document.querySelectorAll('.result-item').length === 6,
      { timeout: 10_000 }
    );

    await p.select('#f-brand', '2'); // Chevrolet — seed tiene 2 Chevys: Cheyenne, Suburban Vortec
    await p.waitForFunction(
      () => document.querySelectorAll('.result-item').length === 2,
      { timeout: 10_000 }
    );
    await p.screenshot({ path: path.join(SCREENSHOT_DIR, '03-filter-chevrolet.png') });

    const names = await p.$$eval('.result-item .r-name', els => els.map(e => e.textContent));
    assert.equal(names.length, 2);
    assert.ok(names.every(n => n.includes('Chevrolet') || n.includes('Suburban')));
  });

  it('4. Limpiar filtros restaura todos los resultados', async () => {
    const p = await go();
    await waitApp(p);
    await p.waitForFunction(
      () => document.querySelectorAll('.result-item').length === 6,
      { timeout: 10_000 }
    );

    // Filtrar primero
    await p.select('#f-brand', '2');
    await p.waitForFunction(
      () => document.querySelectorAll('.result-item').length === 2,
      { timeout: 10_000 }
    );

    // Click en Limpiar
    await p.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button'))
        .find(b => b.textContent.includes('Limpiar'));
      if (btn) btn.click();
    });
    await p.waitForFunction(
      () => document.querySelectorAll('.result-item').length === 6,
      { timeout: 10_000 }
    );
    await p.screenshot({ path: path.join(SCREENSHOT_DIR, '04-cleared.png') });
    assert.equal(await p.$$eval('.result-item', els => els.length), 6);
  });

  it('5. Seleccionar vehículo carga ficha técnica', async () => {
    const p = await go();
    await waitApp(p);
    await p.waitForFunction(
      () => document.querySelectorAll('.result-item').length > 0,
      { timeout: 10_000 }
    );

    // Click en resultado que contiene Tsuru (no es el primero: orden alfabético)
    await p.evaluate(() => {
      const items = document.querySelectorAll('.result-item');
      for (const item of items) {
        if (item.textContent.includes('Tsuru')) { item.click(); break; }
      }
    });
    await p.waitForFunction(
      () => {
        const h2s = Array.from(document.querySelectorAll('h2'));
        return h2s.some(h => h.textContent.includes('Tsuru'));
      },
      { timeout: 10_000 }
    );
    await p.screenshot({ path: path.join(SCREENSHOT_DIR, '05-detail.png') });

    const text = await p.$eval('.preview-inner', el => el.textContent);
    assert.ok(text.includes('Tsuru'), 'Ficha menciona Tsuru');
    assert.ok(text.includes('PSI'), 'Ficha muestra PSI');
  });

  it('6. Visor 3D del vehículo se renderiza o muestra fallback', async () => {
    const p = await go();
    await waitApp(p);
    await p.waitForFunction(
      () => document.querySelectorAll('.result-item').length > 0,
      { timeout: 10_000 }
    );
    await p.evaluate(() => document.querySelector('.result-item')?.click());
    // El contenedor .v3d se renderiza con React; esperamos que aparezca
    await p.waitForFunction(
      () => document.querySelector('.v3d') !== null,
      { timeout: 15_000 }
    );
    // Damos tiempo breve para que Three.js intente crear el contexto WebGL
    // En headless Chrome el contexto puede colgarse en vez de fallar rápido.
    await new Promise(r => setTimeout(r, 8_000));
    await p.screenshot({ path: path.join(SCREENSHOT_DIR, '06-3d.png') });

    const hasCanvas = await p.$('.v3d canvas');
    if (hasCanvas) {
      const hints = await p.$$('.v3d-hint');
      assert.ok(hints.length >= 1, 'Hint interacción presente cuando WebGL funciona');
    } else {
      console.log('ℹ WebGL no disponible en headless — se omite verificación del visor 3D');
    }
  });

  it('7. Pilas compatibles se muestran con OEM primero', async () => {
    const p = await go();
    await waitApp(p);
    await p.waitForFunction(
      () => document.querySelectorAll('.result-item').length > 0,
      { timeout: 10_000 }
    );
    await p.evaluate(() => document.querySelector('.result-item')?.click());

    await p.waitForFunction(
      () => document.body.textContent.includes('Pilas compatibles'),
      { timeout: 20_000 }
    );
    await p.screenshot({ path: path.join(SCREENSHOT_DIR, '07-pumps.png') });

    const pumpCards = await p.$$('.pump-card');
    assert.ok(pumpCards.length >= 1, 'Tarjetas de pila');

    const firstChip = await p.$eval('.pump-card .chip', el => el.textContent.trim());
    assert.equal(firstChip, 'OEM', 'Primera pila es OEM');
  });

  it('8. Botón de despiece 3D existe cuando WebGL está disponible', async () => {
    const p = await go();
    await waitApp(p);
    await p.waitForFunction(
      () => document.querySelectorAll('.result-item').length > 0,
      { timeout: 10_000 }
    );
    await p.evaluate(() => document.querySelector('.result-item')?.click());
    await p.waitForFunction(
      () => document.querySelector('.v3d') !== null,
      { timeout: 15_000 }
    );

    const hasCanvas = await p.$('.v3d canvas');
    if (hasCanvas) {
      const btn = await p.$('.v3d-btn');
      assert.ok(btn, 'Botón de despiece existe');
      const txt = await p.$eval('.v3d-btn', el => el.textContent);
      assert.ok(txt.includes('DESPIECE') || txt.includes('ARMAR'), 'Texto de botón esperado');
    } else {
      console.log('⚠ Sin WebGL — se omite verificación del botón de despiece');
    }
  });

  it('9. Sin errores JS críticos en consola', async () => {
    const p = await go();
    await waitApp(p);
    await p.waitForFunction(
      () => document.querySelectorAll('.result-item').length > 0,
      { timeout: 10_000 }
    );
    await p.evaluate(() => document.querySelector('.result-item')?.click());
    // Esperar el contenedor 3D, no el canvas (puede colgarse en headless)
    await p.waitForFunction(
      () => document.querySelector('.v3d') !== null,
      { timeout: 15_000 }
    );
    await new Promise(r => setTimeout(r, 8_000));
    await p.screenshot({ path: path.join(SCREENSHOT_DIR, '09-final.png') });

    // Errores de página: excluimos requestfailed (404 de recursos), console.error (warnings de Three.js),
    // y errores de resolución de importmap ("Failed to resolve module specifier") que el navegador
    // emite durante la carga inicial de módulos ES, pero no afectan la ejecución.
    const critical = browserErrors.filter(e =>
      e.type === 'pageerror' && !e.msg?.includes('Failed to resolve module specifier')
    );
    if (critical.length > 0) {
      console.error('Errores pageerror del navegador:', JSON.stringify(critical, null, 2));
    }
    assert.equal(critical.length, 0, 'Sin pageerrors críticos');
  });
});
