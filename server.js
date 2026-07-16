// FuelTech Master — API REST
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const Database = require('better-sqlite3');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const PROD = process.env.NODE_ENV === 'production';

/* URL base pública para canonical, sitemap y Open Graph.
   Configurable sin tocar código: BASE_URL=https://tudominio.com
   Cámbiala cuando conectes tu dominio propio. */
const BASE_URL = (process.env.BASE_URL || 'https://fueltech-master.onrender.com').replace(/\/+$/, '');

/* Modelo de IA configurable. OJO: 'gemini-3.5-flash' NO es un id válido de Google
   y hacía que el chat respondiera 502. Default a un modelo real y estable. */
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-flash';

/* ---------- Saneo estricto de parámetros ----------
   better-sqlite3 lanza si se le pasa NaN como parámetro → un query malicioso
   como ?limit=abc tiraba un 500. Todo entero externo pasa por aquí. */
const toInt = (v, min, max) => {
  const n = Number.parseInt(v, 10);
  return Number.isSafeInteger(n) ? Math.min(Math.max(n, min), max) : null;
};

const psiToBar = (psi) => psi == null ? null : +(psi * 0.0689476).toFixed(2);

/* Crea y configura la aplicación Express.
   Recibe instancias de Database (better-sqlite3) para fueltech y stats.
   Esto permite tests con bases en memoria sin tocar los archivos reales. */
function createApp(db, statsDb) {
  const visitSalt = process.env.VISIT_SALT || crypto.randomBytes(32).toString('hex');
  const getTotal = () => +(statsDb.prepare(`SELECT value FROM meta WHERE key = 'total_visits'`).get()?.value || 0);
  const bumpTotal = statsDb.prepare(`
    INSERT INTO meta (key, value) VALUES ('total_visits', '1')
    ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)`);

  const app = express();
  app.disable('x-powered-by');

  // Nonce por petición: permite <script> inline en las páginas renderizadas por el
  // servidor (JSON-LD para SEO) sin abrir la CSP con 'unsafe-inline'.
  app.use((req, res, next) => {
    res.locals.cspNonce = crypto.randomBytes(16).toString('base64');
    next();
  });

  const dbDump = db.prepare(`SELECT b.name as brand, v.model, v.year_from, v.year_to, v.engine, v.rail_pressure_psi_min, v.rail_pressure_psi_max FROM vehicles v JOIN brands b on v.brand_id=b.id`).all();
  const globalDBContext = 'Base de Datos (Vehículos soportados): ' + dbDump.map(r => `${r.brand} ${r.model} ${r.year_from}-${r.year_to} ${r.engine} PSI:${r.rail_pressure_psi_min}-${r.rail_pressure_psi_max}`).join('; ');
  // trust proxy ajustable para tests
  app.set('trust proxy', process.env.TRUST_PROXY !== '0' ? 1 : 0);

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "'sha256-F9dVDQv5gEOHF0o9y7tZzMIBD0kCrcE0up8c/8KomQE='",
          "'sha256-7GhNN277uMGXe9dIUeIQSUgq8nBXJUEdmoyu+v0yd9c='",
          (req, res) => `'nonce-${res.locals.cspNonce}'`
        ],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        workerSrc: ["'self'", 'blob:'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        upgradeInsecureRequests: PROD ? [] : null
      }
    },
    strictTransportSecurity: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true
    },
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
  }));
  app.use((req, res, next) => {
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()');
    next();
  });
  app.use(compression());
  app.use(morgan(PROD ? ':method :url :status :res[content-length] - :response-time ms' : 'dev'));
  app.use(express.json({ limit: '20kb' }));

  // Rate limit solo en /api
  app.use('/api', rateLimit({
    windowMs: 60_000,
    limit: 120,
    standardHeaders: true,
    legacyHeaders: false
  }));

  const catalogLimiter = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: true, legacyHeaders: false });

  app.get('/healthz', (req, res) => res.json({ ok: true }));


  /* ---------- Contador de visitantes ---------- */
  const visitLimiter = rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: true, legacyHeaders: false });
  app.post('/api/visit', visitLimiter, (req, res) => {
    const day = new Date().toISOString().slice(0, 10);
    const hash = crypto.createHash('sha512')
      .update(`${visitSalt}|${day}|${req.ip}`)
      .digest('base64url').slice(0, 48);
    const inserted = statsDb.prepare(`INSERT OR IGNORE INTO visit_days (day, visitor_hash) VALUES (?, ?)`)
      .run(day, hash).changes;
    if (inserted) bumpTotal.run();
    const today = statsDb.prepare(`SELECT COUNT(*) c FROM visit_days WHERE day = ?`).get(day).c;
    res.set('Cache-Control', 'no-store');
    res.json({ total: getTotal(), today });
  });

  /* ---------- SEO: páginas renderizadas en servidor + sitemap ----------
     La app es un SPA; sin esto Google solo ve UNA url. Aquí generamos una url
     indexable por vehículo con <title>, meta, canonical, Open Graph, datos
     estructurados (JSON-LD) y contenido rastreable — todo sin build step. */
  const INDEX_HTML = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const slugify = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const vehicleSlug = (v) => `${slugify(v.brand)}-${slugify(v.model)}-${v.year_from}-${v.year_to}-${v.id}`;

  const HOME_TITLE = 'FuelTech Master — Presión de riel (PSI/Bar), módulos y pilas de gasolina';
  const HOME_DESC = 'Consulta técnica gratis para mecánicos de Latinoamérica: presión de riel (PSI/Bar), ubicación del módulo y pilas (bombas) de gasolina compatibles OEM y alternativas. Diagnóstico del sistema de combustible al instante.';

  // Inyecta metadatos/contenido en la plantilla index.html sin romper la CSP.
  function renderShell({ title, description, canonicalPath = '/', rootContent = '', jsonLd = null, vehicleId = null, nonce = '' }) {
    const canonical = BASE_URL + canonicalPath;
    let html = INDEX_HTML
      .replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(title)}</title>`)
      .replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${esc(description)}">`)
      .replace(/<link rel="canonical"[^>]*>/, `<link rel="canonical" href="${esc(canonical)}">`)
      .replace(/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${esc(title)}">`)
      .replace(/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${esc(description)}">`)
      .replace(/<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${esc(canonical)}">`)
      .replace(/<meta name="twitter:title" content="[^"]*">/, `<meta name="twitter:title" content="${esc(title)}">`)
      .replace(/<meta name="twitter:description" content="[^"]*">/, `<meta name="twitter:description" content="${esc(description)}">`);
    if (jsonLd) {
      html = html.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/,
        `<script type="application/ld+json"${nonce ? ` nonce="${nonce}"` : ''}>${JSON.stringify(jsonLd)}</script>`);
    }
    if (vehicleId != null) html = html.replace('<div id="root">', `<div id="root" data-vehicle="${vehicleId}">`);
    if (rootContent) {
      html = html.replace(/<!--ROOT-CONTENT-START-->[\s\S]*?<!--ROOT-CONTENT-END-->/,
        `<!--ROOT-CONTENT-START-->${rootContent}<!--ROOT-CONTENT-END-->`);
    }
    return html;
  }

  // Registro de búsquedas SIN resultado → hoja de ruta de datos guiada por demanda real.
  statsDb.exec(`CREATE TABLE IF NOT EXISTS missing_searches (
    day TEXT NOT NULL, q TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (day, q)) WITHOUT ROWID`);
  const bumpMissing = statsDb.prepare(`INSERT INTO missing_searches (day, q, count) VALUES (?, ?, 1)
    ON CONFLICT(day, q) DO UPDATE SET count = count + 1`);

  const vehicleForPage = db.prepare(`
    SELECT v.id, b.name AS brand, v.model, v.year_from, v.year_to, v.engine,
           it.name AS injection_name, v.rail_pressure_psi_min, v.rail_pressure_psi_max, v.notes
    FROM vehicles v JOIN brands b ON b.id = v.brand_id
    JOIN injection_types it ON it.id = v.injection_type_id WHERE v.id = ?`);

  app.get('/', (req, res) => {
    res.set('Cache-Control', 'public, max-age=300');
    res.type('html').send(renderShell({
      title: HOME_TITLE, description: HOME_DESC, canonicalPath: '/', nonce: res.locals.cspNonce,
      jsonLd: {
        '@context': 'https://schema.org', '@type': 'WebApplication', name: 'FuelTech Master',
        applicationCategory: 'AutomotiveApplication', operatingSystem: 'Web', inLanguage: 'es',
        description: HOME_DESC, url: BASE_URL + '/',
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' }
      }
    }));
  });

  app.get('/vehiculo/:slug', (req, res, next) => {
    const id = toInt(String(req.params.slug).split('-').pop(), 1, 1e9);
    if (id === null) return next();
    const v = vehicleForPage.get(id);
    if (!v) return next();
    const canonicalSlug = vehicleSlug(v);
    if (req.params.slug !== canonicalSlug) return res.redirect(301, `/vehiculo/${canonicalSlug}`);

    const psi = `${v.rail_pressure_psi_min}–${v.rail_pressure_psi_max}`;
    const bar = `${psiToBar(v.rail_pressure_psi_min)}–${psiToBar(v.rail_pressure_psi_max)}`;
    const name = `${v.brand} ${v.model} ${v.year_from}-${v.year_to}`;
    const title = `Presión de combustible ${name}: ${psi} PSI | FuelTech Master`;
    const description = `${v.brand} ${v.model} (${v.year_from}-${v.year_to}, ${v.engine}, inyección ${v.injection_name}): presión de riel ${psi} PSI (${bar} bar), ubicación del módulo y pilas de gasolina compatibles OEM y alternativas.`;

    const mods = db.prepare(`SELECT m.code, m.name, m.regulated_psi, m.flow_lph, vm.location_text
      FROM vehicle_modules vm JOIN fuel_modules m ON m.id = vm.module_id WHERE vm.vehicle_id = ?`).all(v.id);
    const pumps = db.prepare(`SELECT DISTINCT p.code, p.manufacturer FROM vehicle_modules vm
      JOIN module_pumps mp ON mp.module_id = vm.module_id JOIN fuel_pumps p ON p.id = mp.pump_id
      WHERE vm.vehicle_id = ?`).all(v.id);

    const modHtml = mods.map(m => `<li><strong>${esc(m.code)}</strong> — ${esc(m.name)}. Presión regulada ${m.regulated_psi} PSI, flujo ${m.flow_lph} LPH. Ubicación: ${esc(m.location_text)}.</li>`).join('');
    const pumpHtml = pumps.map(p => `<li>${esc(p.code)} · ${esc(p.manufacturer)}</li>`).join('');

    const rootContent = `<main style="max-width:760px;margin:0 auto;padding:40px 22px;color:#E5E7EB;font-family:Montserrat,system-ui,sans-serif;line-height:1.6">
      <p style="font:700 11px/1 sans-serif;letter-spacing:2px;text-transform:uppercase;color:#979EA7">FuelTech Master · Ficha técnica</p>
      <h1 style="font-size:26px;margin:10px 0 4px">${esc(name)} — Presión de combustible</h1>
      <p style="color:#B7BFC9">${esc(v.engine)} · Inyección ${esc(v.injection_name)}</p>
      <p style="font-size:30px;font-weight:800;margin:16px 0">${esc(psi)} PSI <span style="font-size:14px;font-weight:400;color:#979EA7">(${esc(bar)} bar) en riel / flauta de inyectores</span></p>
      ${modHtml ? `<h2 style="font-size:16px;color:#E53935;margin-top:24px">Módulo de combustible</h2><ul>${modHtml}</ul>` : ''}
      ${pumpHtml ? `<h2 style="font-size:16px;color:#E53935;margin-top:24px">Pilas (bombas) de gasolina compatibles</h2><ul>${pumpHtml}</ul>` : ''}
      ${v.notes ? `<p style="color:#B7BFC9;margin-top:16px">${esc(v.notes)}</p>` : ''}
      <p style="margin-top:28px"><a href="/vehiculo/${canonicalSlug}" style="color:#E53935;font-weight:700">Abrir herramienta interactiva (visor 3D, chat y más) →</a></p>
      <p style="margin-top:8px"><a href="/vehiculos" style="color:#979EA7">Ver todos los vehículos del catálogo</a></p>
    </main>`;

    const faq = [{ q: `¿Qué presión de combustible necesita un ${name}?`,
      a: `La presión de riel del ${name} (${v.engine}, inyección ${v.injection_name}) es de ${psi} PSI (${bar} bar).` }];
    if (mods[0]) faq.push({ q: `¿Dónde está el módulo de gasolina del ${name}?`, a: mods[0].location_text });
    if (pumps.length) faq.push({ q: `¿Qué pilas de gasolina sirven para un ${name}?`, a: `Compatibles: ${pumps.map(p => p.code).join(', ')}.` });

    res.set('Cache-Control', 'public, max-age=600');
    res.type('html').send(renderShell({
      title, description, canonicalPath: `/vehiculo/${canonicalSlug}`, rootContent, vehicleId: v.id, nonce: res.locals.cspNonce,
      jsonLd: { '@context': 'https://schema.org', '@type': 'FAQPage', inLanguage: 'es',
        mainEntity: faq.map(f => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) }
    }));
  });

  app.get('/vehiculos', (req, res) => {
    const rows = db.prepare(`SELECT v.id, b.name AS brand, v.model, v.year_from, v.year_to, v.rail_pressure_psi_max
      FROM vehicles v JOIN brands b ON b.id = v.brand_id ORDER BY b.name, v.model, v.year_from`).all();
    const items = rows.map(v => `<li><a href="/vehiculo/${vehicleSlug(v)}" style="color:#E5E7EB;text-decoration:none">${esc(v.brand)} ${esc(v.model)} ${v.year_from}-${v.year_to} — ${v.rail_pressure_psi_max} PSI</a></li>`).join('');
    const rootContent = `<main style="max-width:820px;margin:0 auto;padding:40px 22px;color:#E5E7EB;font-family:Montserrat,system-ui,sans-serif">
      <h1 style="font-size:24px">Catálogo de presión de combustible por vehículo</h1>
      <p style="color:#B7BFC9">Presión de riel, módulo y pilas de gasolina compatibles para ${rows.length} vehículos de Latinoamérica.</p>
      <ul style="columns:2;column-gap:28px;margin-top:16px;line-height:2;padding-left:18px">${items}</ul>
    </main>`;
    res.set('Cache-Control', 'public, max-age=600');
    res.type('html').send(renderShell({
      title: 'Catálogo de vehículos — Presión de combustible | FuelTech Master',
      description: 'Lista completa de vehículos con su presión de riel (PSI/Bar), módulo y pilas de gasolina compatibles OEM y alternativas.',
      canonicalPath: '/vehiculos', rootContent, nonce: res.locals.cspNonce
    }));
  });

  app.get('/sitemap.xml', (req, res) => {
    const rows = db.prepare(`SELECT v.id, b.name AS brand, v.model, v.year_from, v.year_to
      FROM vehicles v JOIN brands b ON b.id = v.brand_id`).all();
    const locs = [`${BASE_URL}/`, `${BASE_URL}/vehiculos`, ...rows.map(v => `${BASE_URL}/vehiculo/${vehicleSlug(v)}`)];
    res.type('application/xml').set('Cache-Control', 'public, max-age=3600').send(
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
      locs.map(u => `  <url><loc>${esc(u)}</loc></url>`).join('\n') + `\n</urlset>\n`);
  });

  app.get('/robots.txt', (req, res) => {
    res.type('text/plain').set('Cache-Control', 'public, max-age=3600').send(
      `User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${BASE_URL}/sitemap.xml\n`);
  });

  app.use(express.static(path.join(__dirname, 'public'), {
    maxAge: PROD ? '1d' : 0,
    setHeaders: (res, filePath) => {
      if (/\.(glb|png|jpg|webp)$/.test(filePath)) res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
    }
  }));

  // --- Catálogos para filtros ---
  let metaCache = null;
  app.get('/api/meta', catalogLimiter, (req, res) => {
    if (!metaCache) {
      metaCache = {
        brands: db.prepare(`SELECT id, name FROM brands ORDER BY name`).all(),
        injection_types: db.prepare(`SELECT id, code, name, description FROM injection_types ORDER BY id`).all(),
        year_range: db.prepare(`SELECT MIN(year_from) min, MAX(year_to) max FROM vehicles`).get(),
        total_vehicles: db.prepare(`SELECT COUNT(*) c FROM vehicles`).get().c
      };
    }
    res.set('Cache-Control', 'public, max-age=300');
    res.json(metaCache);
  });

  // --- Buscador ---
  const MAX_PAGE_SIZE = 200;
  app.get('/api/vehicles', (req, res) => {
    const { brand_id, model, year, injection_type_id } = req.query;
    const where = [];
    const params = {};
    const brandId = toInt(brand_id, 1, 1e9);
    const yearN = toInt(year, 1900, 2100);
    const injId = toInt(injection_type_id, 1, 1e9);
    if (brandId !== null) { where.push('v.brand_id = @brand_id');            params.brand_id = brandId; }
    if (typeof model === 'string' && model.trim()) {
      where.push('v.model LIKE @model ESCAPE \'\\\'');
      params.model = `%${model.trim().slice(0, 60).replace(/[%_\\]/g, '\\$&')}%`;
    }
    if (yearN !== null)   { where.push('@year BETWEEN v.year_from AND v.year_to'); params.year = yearN; }
    if (injId !== null)   { where.push('v.injection_type_id = @inj');        params.inj = injId; }

    params.limit = toInt(req.query.limit, 1, MAX_PAGE_SIZE) ?? MAX_PAGE_SIZE;
    params.offset = toInt(req.query.offset, 0, 10000) ?? 0;

    const rows = db.prepare(`
      SELECT v.id, b.name AS brand, v.model, v.year_from, v.year_to, v.engine, v.body_type,
             it.code AS injection_code, it.name AS injection_name,
             v.rail_pressure_psi_min, v.rail_pressure_psi_max, v.data_verified,
             fm.code AS module_code,
             (SELECT GROUP_CONCAT(fp.code, ' / ') FROM module_pumps mp
                JOIN fuel_pumps fp ON fp.id = mp.pump_id WHERE mp.module_id = fm.id) AS pump_codes
      FROM vehicles v
      JOIN brands b ON b.id = v.brand_id
      JOIN injection_types it ON it.id = v.injection_type_id
      LEFT JOIN vehicle_modules vm ON vm.vehicle_id = v.id
      LEFT JOIN fuel_modules fm ON fm.id = vm.module_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ${req.query.order_by === 'psi_desc' ? 'ORDER BY v.rail_pressure_psi_max DESC, b.name, v.model' :
        req.query.order_by === 'year_desc' ? 'ORDER BY v.year_from DESC, b.name, v.model' :
        'ORDER BY b.name, v.model, v.year_from'}
      LIMIT @limit OFFSET @offset
    `).all(params);

    // Si una búsqueda por modelo no devuelve nada, la registramos: es la mejor
    // señal de qué vehículos agregar al catálogo (demanda real insatisfecha).
    if (rows.length === 0 && typeof model === 'string' && model.trim()) {
      try { bumpMissing.run(new Date().toISOString().slice(0, 10), model.trim().slice(0, 60).toLowerCase()); }
      catch (e) { /* no crítico */ }
    }

    res.json(rows.map(r => ({
      ...r,
      data_verified: !!r.data_verified,
      rail_pressure_bar_min: psiToBar(r.rail_pressure_psi_min),
      rail_pressure_bar_max: psiToBar(r.rail_pressure_psi_max)
    })));
  });

  // --- Ficha completa anidada ---
  app.get('/api/vehicles/:id', (req, res) => {
    const id = toInt(req.params.id, 1, 1e9);
    if (id === null) return res.status(404).json({ error: 'Vehículo no encontrado' });
    const v = db.prepare(`
      SELECT v.*, b.name AS brand, it.code AS injection_code, it.name AS injection_name, it.description AS injection_desc
      FROM vehicles v
      JOIN brands b ON b.id = v.brand_id
      JOIN injection_types it ON it.id = v.injection_type_id
      WHERE v.id = ?
    `).get(id);
    if (!v) return res.status(404).json({ error: 'Vehículo no encontrado' });

    const modules = db.prepare(`
      SELECT vm.location_text, vm.location_zone, vm.requires_tank_removal, vm.access_notes,
             m.id, m.code, m.name, m.assembly_type, m.regulated_psi, m.flow_lph, m.regulator_type,
             m.float_type, m.strainer_ref, m.connector_desc, m.lines_desc, m.mount_desc, m.diagram_key
      FROM vehicle_modules vm
      JOIN fuel_modules m ON m.id = vm.module_id
      WHERE vm.vehicle_id = ?
    `).all(v.id);

    const pumpsStmt = db.prepare(`
      SELECT p.*, mp.fitment, mp.is_oem, mp.notes AS fitment_notes
      FROM module_pumps mp
      JOIN fuel_pumps p ON p.id = mp.pump_id
      WHERE mp.module_id = ?
      ORDER BY mp.is_oem DESC
    `);

    res.set('Cache-Control', 'no-store');
    res.json({
      id: v.id,
      slug: vehicleSlug(v),
      brand: v.brand,
      model: v.model,
      years: `${v.year_from}–${v.year_to}`,
      engine: v.engine,
      body_type: v.body_type,
      injection: { code: v.injection_code, name: v.injection_name, description: v.injection_desc },
      rail_pressure: {
        psi_min: v.rail_pressure_psi_min, psi_max: v.rail_pressure_psi_max,
        bar_min: psiToBar(v.rail_pressure_psi_min), bar_max: psiToBar(v.rail_pressure_psi_max)
      },
      notes: v.notes,
      data_verified: !!v.data_verified,
      modules: modules.map(m => ({
        id: m.id, code: m.code, name: m.name, assembly_type: m.assembly_type,
        location: {
          text: m.location_text, zone: m.location_zone,
          requires_tank_removal: !!m.requires_tank_removal, access_notes: m.access_notes
        },
        specs: {
          regulated_psi: m.regulated_psi, regulated_bar: psiToBar(m.regulated_psi),
          flow_lph: m.flow_lph, regulator_type: m.regulator_type,
          float_type: m.float_type, strainer_ref: m.strainer_ref, connector_desc: m.connector_desc,
          lines_desc: m.lines_desc, mount_desc: m.mount_desc
        },
        diagram_key: m.diagram_key,
        compatible_pumps: pumpsStmt.all(m.id).map(p => ({
          id: p.id, code: p.code, manufacturer: p.manufacturer, pump_style: p.pump_style,
          max_psi_direct: p.max_psi_direct, max_bar_direct: psiToBar(p.max_psi_direct),
          amperage_a: p.amperage_a, voltage_v: p.voltage_v, flow_lph_free: p.flow_lph_free,
          inlet_desc: p.inlet_desc, outlet_desc: p.outlet_desc, polarity_desc: p.polarity_desc,
          diagram_key: p.diagram_key,
          fitment: p.fitment, is_oem: !!p.is_oem, fitment_notes: p.fitment_notes
        }))
      }))
    });
  });

  // --- Catálogo de módulos ---
  app.get('/api/modules', catalogLimiter, (req, res) => {
    const limit = toInt(req.query.limit, 1, MAX_PAGE_SIZE) ?? MAX_PAGE_SIZE;
    const offset = toInt(req.query.offset, 0, 10000) ?? 0;
    const rows = db.prepare(`
      SELECT m.id, m.code, m.name, m.assembly_type, m.regulated_psi, m.flow_lph, m.regulator_type, m.diagram_key,
             v.id AS vehicle_id, b.name AS brand, v.model, v.year_from, v.year_to
      FROM fuel_modules m
      JOIN vehicle_modules vm ON vm.module_id = m.id
      JOIN vehicles v ON v.id = vm.vehicle_id
      JOIN brands b ON b.id = v.brand_id
      ORDER BY b.name, v.model, v.year_from
      LIMIT @limit OFFSET @offset
    `).all({ limit, offset });
    res.json(rows.map(r => ({ ...r, regulated_bar: psiToBar(r.regulated_psi) })));
  });

  app.get('/api/modules/:id', (req, res) => {
    const m = db.prepare(`SELECT * FROM fuel_modules WHERE id = ?`).get(toInt(req.params.id, 1, 1e9));
    if (!m) return res.status(404).json({ error: 'Módulo no encontrado' });
    res.json({ ...m, regulated_bar: psiToBar(m.regulated_psi) });
  });

  // --- Catálogo de pilas ---
  let pumpsCache = null;
  app.get('/api/pumps', catalogLimiter, (req, res) => {
    if (!pumpsCache) {
      pumpsCache = db.prepare(`SELECT * FROM fuel_pumps ORDER BY manufacturer, code`).all()
        .map(p => ({ ...p, max_bar_direct: psiToBar(p.max_psi_direct) }));
    }
    res.set('Cache-Control', 'public, max-age=300');
    res.json(pumpsCache);
  });

  app.get('/api/pumps/:id', (req, res) => {
    const p = db.prepare(`SELECT * FROM fuel_pumps WHERE id = ?`).get(toInt(req.params.id, 1, 1e9));
    if (!p) return res.status(404).json({ error: 'Pila no encontrada' });
    res.json({ ...p, max_bar_direct: psiToBar(p.max_psi_direct) });
  });

  /* ---------- Chatbot con Gemini API ---------- */
  const CHAT_DAILY_LIMIT = 3;

  // Asegurar tabla de límites por dispositivo
  statsDb.exec(`
    CREATE TABLE IF NOT EXISTS chat_limits (
      day        TEXT NOT NULL,
      device_id  TEXT NOT NULL,
      count      INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (day, device_id)
    ) WITHOUT ROWID
  `);
  const getChatCount = statsDb.prepare(`SELECT count FROM chat_limits WHERE day = ? AND device_id = ?`);
  const bumpChatCount = statsDb.prepare(`
    INSERT INTO chat_limits (day, device_id, count) VALUES (?, ?, 1)
    ON CONFLICT(day, device_id) DO UPDATE SET count = count + 1
  `);

  const chatLimiter = rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: true, legacyHeaders: false });
  const genAI = process.env.GEMINI_API_KEY
    ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
    : null;

  app.post('/api/chat', chatLimiter, async (req, res) => {
    if (!genAI) {
      return res.status(503).json({ error: 'API de IA no configurada', noKey: true });
    }

    // Validar parámetros
    const { message, history, vehicleId, deviceId } = req.body;

    // Validar mensaje
    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({ error: 'Mensaje vacío' });
    }
    const cleanMsg = message.trim().slice(0, 500);

    try {
      const day = new Date().toISOString().slice(0, 10);
      // Límite por DISPOSITIVO (así un taller con varios celulares detrás del mismo
      // router no comparte un solo cupo), con un techo por IP como red de seguridad
      // contra deviceId falsificados.
      const ipHash = crypto.createHash('sha256').update(req.ip).digest('hex');
      const validDevice = typeof deviceId === 'string' && /^[a-f0-9]{16,64}$/.test(deviceId);
      const actualDeviceId = validDevice ? `d:${deviceId}` : `ip:${ipHash}`;
      const ipCapKey = `ipcap:${ipHash}`;
      const IP_DAILY_CEILING = 30;
      if ((getChatCount.get(day, ipCapKey)?.count || 0) >= IP_DAILY_CEILING) {
        return res.json({
          response: '', remaining: 0, limitReached: true,
          message: 'Se alcanzó el límite diario de consultas desde esta red. Vuelve mañana o explora el catálogo directamente.'
        });
      }
      const row = getChatCount.get(day, actualDeviceId);
      const used = row ? row.count : 0;
      const remaining = Math.max(0, CHAT_DAILY_LIMIT - used);

      if (used >= CHAT_DAILY_LIMIT) {
        return res.json({
          response: '',
          remaining: 0,
          limitReached: true,
          message: 'Has alcanzado el límite de 3 consultas por día. Vuelve mañana o explora el catálogo directamente.'
        });
      }

      let dbContext = '';
      if (vehicleId) {
        const vId = toInt(vehicleId, 1, 1e9);
        if (vId) {
          const v = db.prepare(`SELECT v.model, b.name AS brand, v.year_from, v.year_to, v.engine, it.name AS injection, v.rail_pressure_psi_min, v.rail_pressure_psi_max FROM vehicles v JOIN brands b ON b.id = v.brand_id JOIN injection_types it ON it.id = v.injection_type_id WHERE v.id = ?`).get(vId);
          if (v) {
            dbContext = `\nContexto actual del usuario (vehículo seleccionado en la app): ${v.brand} ${v.model} (${v.year_from}-${v.year_to}), Motor ${v.engine}, Inyección ${v.injection}. Presión de riel: ${v.rail_pressure_psi_min}-${v.rail_pressure_psi_max} PSI. Si el usuario pregunta por "este vehículo" o "este carro", se refiere a este.`;
          }
        }
      }

      const sysPrompt = `Eres un asistente de FuelTech Master, un catálogo técnico de módulos y bombas de gasolina.
SOLO respondes preguntas sobre:
- Presión de riel (PSI/Bar) de vehículos (inyección MFI, TBI, Vortec, GDI)
- Ubicación de módulos de combustible
- Tipos de bomba y módulo
- Diagnóstico básico de sistema de combustible
- Seguridad al trabajar con gasolina

NUNCA respondas temas fuera de esto. Si te preguntan algo no relacionado, di: "Solo puedo ayudarte con información técnica de sistemas de combustible."

Responde en español. No des consejos de reparación sin incluir "consulta el manual de servicio".

${globalDBContext}

${dbContext}`;

      const model = genAI.getGenerativeModel({
        model: GEMINI_MODEL,
        systemInstruction: sysPrompt,
        generationConfig: { maxOutputTokens: 1000, temperature: 0.3 }
      });

      const chat = model.startChat({
        history: (history || []).slice(-4).map(m => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content.slice(0, 300) }]
        }))
      });

      const result = await chat.sendMessage(cleanMsg);
      const response = result.response.text().slice(0, 3000);

      bumpChatCount.run(day, actualDeviceId);
      bumpChatCount.run(day, ipCapKey);

      res.json({ response, remaining: remaining > 0 ? remaining - 1 : 0 });
    } catch (err) {
      console.error('Gemini API error:', err.message || err);
      res.status(502).json({ error: 'Error al comunicar con la IA. Intenta de nuevo.' });
    }
  });

  app.use('/api', (req, res) => res.status(404).json({ error: 'No encontrado' }));

  app.use((err, req, res, next) => {
    console.error('Error interno:', err.message || err);
    res.status(500).json({ error: 'Error interno' });
  });

  return app;
}

/* ---------- Arranque en producción / desarrollo ---------- */
if (require.main === module) {
  // Abrir db y statsDb correctamente
  const db = new Database(path.join(__dirname, 'fueltech.db'), { readonly: false });
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');

  const statsDb = new Database(path.join(__dirname, 'stats.db'));
  statsDb.pragma('journal_mode = WAL');
  statsDb.pragma('wal_autocheckpoint = 200');
  statsDb.exec(`
    CREATE TABLE IF NOT EXISTS visit_days (
      day          TEXT NOT NULL,
      visitor_hash TEXT NOT NULL,
      PRIMARY KEY (day, visitor_hash)
    ) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
  `);
  statsDb.prepare(`DELETE FROM visit_days WHERE day < date('now', '-90 days')`).run();

  const app = createApp(db, statsDb);
  const PORT = process.env.PORT || 3000;
  const server = app.listen(PORT, () => console.log(`FuelTech Master corriendo en http://localhost:${PORT}`));

  process.on('SIGTERM', () => { server.close(() => { db.close(); statsDb.close(); process.exit(0); }); });
}

module.exports = { createApp, toInt, psiToBar };
