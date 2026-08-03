// FuelTech Master — API REST
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const { db: defaultDb, statsDb: defaultStatsDb } = require('./db');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const PROD = process.env.NODE_ENV === 'production';

/* URL base pública para canonical, sitemap y Open Graph.
   Configurable sin tocar código: BASE_URL=https://tudominio.com
   Cámbiala cuando conectes tu dominio propio. */
const BASE_URL = (process.env.BASE_URL || 'https://fueltech-master.onrender.com').replace(/\/+$/, '');

/* Modelo de IA configurable. OJO: 'gemini-3.5-flash' NO es un id válido de Google
   y hacía que el chat respondiera 502. Default a un modelo real y estable. */
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-flash';

/* Google Analytics 4. Configurable; vacío = desactivado (y no se toca la CSP). */
const GA_ID = process.env.GA_MEASUREMENT_ID || 'G-MXGS03FKB0';

/* Google AdSense. Formato: ca-pub-0000000000000000 (lo da el panel de AdSense).
   Vacío = desactivado: no se inyecta el script, no se abre la CSP y /ads.txt responde 404.
   Con valor: se carga adsbygoogle.js en todas las páginas y se publica ads.txt, que es
   como Google verifica el sitio y como se declara al editor autorizado. */
const ADSENSE_CLIENT = (process.env.ADSENSE_CLIENT || '').trim();

/* Panel de administración: protegido con contraseña por variable de entorno.
   Si ADMIN_PASSWORD no está definida, el panel queda DESACTIVADO (seguro por defecto). */
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const ADMIN_SECRET = ADMIN_PASSWORD
  ? crypto.createHash('sha256').update('ftadmin|' + ADMIN_PASSWORD).digest()
  : null;
const signAdminToken = (ttlMs = 8 * 3600e3) => {
  const exp = Date.now() + ttlMs;
  const sig = crypto.createHmac('sha256', ADMIN_SECRET).update(String(exp)).digest('base64url');
  return `${exp}.${sig}`;
};
const verifyAdminToken = (token) => {
  if (!ADMIN_SECRET || typeof token !== 'string' || !token.includes('.')) return false;
  const [exp, sig] = token.split('.');
  if (!/^\d+$/.test(exp) || Number(exp) < Date.now()) return false;
  const expected = crypto.createHmac('sha256', ADMIN_SECRET).update(exp).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

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
async function createApp(dbOverride, statsOverride) {
  // Los tests inyectan adaptadores sobre bases en memoria; en producción se usan
  // las conexiones reales del módulo ./db (SQLite local o PostgreSQL según DATABASE_URL).
  const db = dbOverride || defaultDb;
  const statsDb = statsOverride || defaultStatsDb;

  const visitSalt = process.env.VISIT_SALT || crypto.randomBytes(32).toString('hex');
  // OJO: `await x.get(...)?.value` lee .value sobre la PROMESA (siempre undefined).
  // Hay que esperar la fila primero — si no, el contador de visitas queda clavado en 0.
  const getTotal = async () => +((await statsDb.get(`SELECT value FROM meta WHERE key = 'total_visits'`))?.value || 0);
  const bumpTotal = { run: async () => statsDb.run(`
    INSERT INTO meta (key, value) VALUES ('total_visits', '1')
    ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)`) };

  const app = express();
  app.disable('x-powered-by');

  // Nonce por petición: permite <script> inline en las páginas renderizadas por el
  // servidor (JSON-LD para SEO) sin abrir la CSP con 'unsafe-inline'.
  app.use((req, res, next) => {
    res.locals.cspNonce = crypto.randomBytes(16).toString('base64');
    next();
  });

  let dbDump = [];
  try {
    dbDump = await db.all(`SELECT b.name as brand, v.model, v.year_from, v.year_to, v.engine, v.rail_pressure_psi_min, v.rail_pressure_psi_max FROM vehicles v JOIN brands b on v.brand_id=b.id`, );
  } catch (err) {
    console.error('❌ Error al obtener dbDump inicial (¿Base de datos vacía o sin inicializar?):', err.message);
  }
  const globalDBContext = 'Base de Datos (Vehículos soportados): ' + dbDump.map(r => `${r.brand} ${r.model} ${r.year_from}-${r.year_to} ${r.engine} PSI:${r.rail_pressure_psi_min}-${r.rail_pressure_psi_max}`).join('; ');
  // trust proxy ajustable para tests
  app.set('trust proxy', process.env.TRUST_PROXY !== '0' ? 1 : 0);

  /* Orígenes que necesita AdSense. Sin esto la CSP bloquea el script y los iframes de
     los anuncios: el sitio se ve "sin anuncios" y la revisión de AdSense falla. */
  const ADS_SCRIPT = ['https://pagead2.googlesyndication.com', 'https://partner.googleadservices.com',
    'https://tpc.googlesyndication.com', 'https://www.googletagservices.com', 'https://adservice.google.com'];
  const ADS_FRAME = ['https://googleads.g.doubleclick.net', 'https://tpc.googlesyndication.com',
    'https://www.google.com', 'https://pagead2.googlesyndication.com'];
  const ADS_IMG = ['https://pagead2.googlesyndication.com', 'https://googleads.g.doubleclick.net',
    'https://tpc.googlesyndication.com', 'https://www.google.com', 'https://*.gstatic.com'];
  const ADS_CONNECT = ['https://pagead2.googlesyndication.com', 'https://googleads.g.doubleclick.net',
    'https://adservice.google.com', 'https://ep1.adtrafficquality.google', 'https://ep2.adtrafficquality.google'];
  const ads = (list) => (ADSENSE_CLIENT ? list : []);

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "'sha256-F9dVDQv5gEOHF0o9y7tZzMIBD0kCrcE0up8c/8KomQE='",
          "'sha256-7GhNN277uMGXe9dIUeIQSUgq8nBXJUEdmoyu+v0yd9c='",
          (req, res) => `'nonce-${res.locals.cspNonce}'`,
          ...(GA_ID ? ['https://www.googletagmanager.com'] : []),
          // AdSense inyecta scripts propios en tiempo de ejecución y no admite nonce en ellos.
          ...ads([...ADS_SCRIPT, "'unsafe-inline'"])
        ],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:', ...(GA_ID ? ['https://www.googletagmanager.com', 'https://*.google-analytics.com'] : []), ...ads(ADS_IMG)],
        connectSrc: ["'self'", ...(GA_ID ? ['https://www.googletagmanager.com', 'https://*.google-analytics.com', 'https://*.analytics.google.com'] : []), ...ads(ADS_CONNECT)],
        frameSrc: ["'self'", ...ads(ADS_FRAME)],
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
  app.post('/api/visit', visitLimiter, async (req, res) => {
    const day = new Date().toISOString().slice(0, 10);
    const hash = crypto.createHash('sha512')
      .update(`${visitSalt}|${day}|${req.ip}`)
      .digest('base64url').slice(0, 48);
    const inserted = (await statsDb.run(`INSERT OR IGNORE INTO visit_days (day, visitor_hash) VALUES (?, ?)`, [day, hash])).changes;
    if (inserted) await bumpTotal.run();
    const today = (await statsDb.get(`SELECT COUNT(*) c FROM visit_days WHERE day = ?`, [day]))?.c || 0;
    res.set('Cache-Control', 'no-store');
    res.json({ total: await getTotal(), today });
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

  // Imágenes OG disponibles (generadas por `npm run og`). Se leen una vez al arrancar.
  let OG_FILES = new Set();
  try { OG_FILES = new Set(fs.readdirSync(path.join(__dirname, 'public', 'og'))); } catch (e) { /* aún no hay imágenes OG */ }
  const DEFAULT_OG = OG_FILES.has('default.png') ? '/og/default.png' : null;
  const ogForVehicle = (id) => (OG_FILES.has(id + '.png') ? '/og/' + id + '.png' : null);

  // Inyecta metadatos/contenido en la plantilla index.html sin romper la CSP.
  function renderShell({ title, description, canonicalPath = '/', rootContent = '', jsonLd = null, vehicleId = null, nonce = '', ogImage = null }) {
    const canonical = BASE_URL + canonicalPath;
    const img = ogImage || DEFAULT_OG;
    let html = INDEX_HTML
      .replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(title)}</title>`)
      .replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${esc(description)}">`)
      // canonical + hreflang LATAM (una sola versión en español para toda la región)
      .replace(/<link rel="canonical"[^>]*>/, `<link rel="canonical" href="${esc(canonical)}"><link rel="alternate" hreflang="es" href="${esc(canonical)}"><link rel="alternate" hreflang="x-default" href="${esc(canonical)}">`)
      .replace(/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${esc(title)}">`)
      .replace(/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${esc(description)}">`)
      .replace(/<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${esc(canonical)}">`)
      .replace(/<meta name="twitter:title" content="[^"]*">/, `<meta name="twitter:title" content="${esc(title)}">`)
      .replace(/<meta name="twitter:description" content="[^"]*">/, `<meta name="twitter:description" content="${esc(description)}">`);
    if (img) {
      const absImg = esc(BASE_URL + img);
      html = html
        .replace(/<meta name="twitter:card" content="[^"]*">/, `<meta name="twitter:card" content="summary_large_image">`)
        .replace('</head>', `<meta property="og:image" content="${absImg}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta name="twitter:image" content="${absImg}"></head>`);
    }
    if (jsonLd) {
      html = html.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/,
        `<script type="application/ld+json"${nonce ? ` nonce="${nonce}"` : ''}>${JSON.stringify(jsonLd)}</script>`);
    }
    if (vehicleId != null) html = html.replace('<div id="root">', `<div id="root" data-vehicle="${vehicleId}">`);
    if (rootContent) {
      // El pie legal va en TODAS las páginas renderizadas en servidor: AdSense exige que
      // privacidad y contacto se alcancen desde cualquier punto del sitio.
      html = html.replace(/<!--ROOT-CONTENT-START-->[\s\S]*?<!--ROOT-CONTENT-END-->/,
        `<!--ROOT-CONTENT-START-->${rootContent}${legalFooter()}<!--ROOT-CONTENT-END-->`);
    }
    if (ADSENSE_CLIENT) {
      html = html.replace('</head>',
        `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(ADSENSE_CLIENT)}" crossorigin="anonymous"></script></head>`);
    }
    if (GA_ID) {
      const ga = `<script async src="https://www.googletagmanager.com/gtag/js?id=${GA_ID}"></script>` +
        `<script${nonce ? ` nonce="${nonce}"` : ''}>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${GA_ID}');</script>`;
      html = html.replace('</head>', ga + '</head>');
    }
    return html;
  }

  // Registro de búsquedas SIN resultado → hoja de ruta de datos guiada por demanda real.
  statsDb.exec(`CREATE TABLE IF NOT EXISTS missing_searches (
    day TEXT NOT NULL, q TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (day, q))`);
  const bumpMissing = { run: async (p1, p2) => statsDb.run(`INSERT INTO missing_searches (day, q, count) VALUES (?, ?, 1)
    ON CONFLICT(day, q) DO UPDATE SET count = count + 1`, [p1, p2]) };

  const vehicleForPage = { get: async (id) => db.get(`
    SELECT v.id, b.name AS brand, v.model, v.year_from, v.year_to, v.engine,
           it.name AS injection_name, v.rail_pressure_psi_min, v.rail_pressure_psi_max, v.notes
    FROM vehicles v JOIN brands b ON b.id = v.brand_id
    JOIN injection_types it ON it.id = v.injection_type_id WHERE v.id = ?`, [id]) };

  app.get('/', async (req, res) => {
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

  app.get('/vehiculo/:slug', async (req, res, next) => {
    const id = toInt(String(req.params.slug).split('-').pop(), 1, 1e9);
    if (id === null) return next();
    const v = await vehicleForPage.get(id);
    if (!v) return next();
    const canonicalSlug = vehicleSlug(v);
    if (req.params.slug !== canonicalSlug) return res.redirect(301, `/vehiculo/${canonicalSlug}`);

    const psi = `${v.rail_pressure_psi_min}–${v.rail_pressure_psi_max}`;
    const bar = `${psiToBar(v.rail_pressure_psi_min)}–${psiToBar(v.rail_pressure_psi_max)}`;
    const name = `${v.brand} ${v.model} ${v.year_from}-${v.year_to}`;
    const title = `Presión de combustible ${name}: ${psi} PSI | FuelTech Master`;
    const description = `${v.brand} ${v.model} (${v.year_from}-${v.year_to}, ${v.engine}, inyección ${v.injection_name}): presión de riel ${psi} PSI (${bar} bar), ubicación del módulo y pilas de gasolina compatibles OEM y alternativas.`;

    const mods = await db.all(`SELECT m.code, m.name, m.regulated_psi, m.flow_lph, vm.location_text
      FROM vehicle_modules vm JOIN fuel_modules m ON m.id = vm.module_id WHERE vm.vehicle_id = ?`, v.id);
    const pumps = await db.all(`SELECT DISTINCT p.code, p.manufacturer FROM vehicle_modules vm
      JOIN module_pumps mp ON mp.module_id = vm.module_id JOIN fuel_pumps p ON p.id = mp.pump_id
      WHERE vm.vehicle_id = ?`, v.id);

    const modHtml = mods.map(m => `<li><strong>${esc(m.code)}</strong> — ${esc(m.name)}. Presión regulada ${m.regulated_psi} PSI, flujo ${m.flow_lph} LPH. Ubicación: ${esc(m.location_text)}.</li>`).join('');
    const pumpHtml = pumps.map(p => `<li>${esc(p.code)} · ${esc(p.manufacturer)}</li>`).join('');

    // Enlaces internos a otros modelos de la misma marca: más páginas por sesión y mejor rastreo (SEO)
    const related = await db.all(`SELECT v.id, b.name AS brand, v.model, v.year_from, v.year_to
      FROM vehicles v JOIN brands b ON b.id = v.brand_id
      WHERE v.brand_id = (SELECT brand_id FROM vehicles WHERE id = ?) AND v.id != ?
      ORDER BY v.model, v.year_from LIMIT 8`, v.id, v.id);
    const relHtml = related.length
      ? `<h2 style="font-size:16px;color:#E53935;margin-top:24px">Otros ${esc(v.brand)}</h2><ul>${related.map(r => `<li><a href="/vehiculo/${vehicleSlug(r)}" style="color:#B7BFC9">${esc(r.brand)} ${esc(r.model)} ${r.year_from}-${r.year_to}</a></li>`).join('')}</ul>`
      : '';

    const rootContent = `<main style="max-width:760px;margin:0 auto;padding:40px 22px;color:#E5E7EB;font-family:Montserrat,system-ui,sans-serif;line-height:1.6">
      <p style="font:700 11px/1 sans-serif;letter-spacing:2px;text-transform:uppercase;color:#979EA7">FuelTech Master · Ficha técnica</p>
      <h1 style="font-size:26px;margin:10px 0 4px">${esc(name)} — Presión de combustible</h1>
      <p style="color:#B7BFC9">${esc(v.engine)} · Inyección ${esc(v.injection_name)}</p>
      <p style="font-size:30px;font-weight:800;margin:16px 0">${esc(psi)} PSI <span style="font-size:14px;font-weight:400;color:#979EA7">(${esc(bar)} bar) en riel / flauta de inyectores</span></p>
      ${modHtml ? `<h2 style="font-size:16px;color:#E53935;margin-top:24px">Módulo de combustible</h2><ul>${modHtml}</ul>` : ''}
      ${pumpHtml ? `<h2 style="font-size:16px;color:#E53935;margin-top:24px">Pilas (bombas) de gasolina compatibles</h2><ul>${pumpHtml}</ul>` : ''}
      ${v.notes ? `<p style="color:#B7BFC9;margin-top:16px">${esc(v.notes)}</p>` : ''}
      ${relHtml}
      <p style="margin-top:28px"><a href="/vehiculo/${canonicalSlug}" style="color:#E53935;font-weight:700">Abrir herramienta interactiva (visor 3D, chat y más) →</a></p>
      <p style="margin-top:8px"><a href="/vehiculos" style="color:#979EA7">Ver todos los vehículos</a> · <a href="/guias" style="color:#979EA7">Guías de diagnóstico</a></p>
    </main>`;

    const faq = [{ q: `¿Qué presión de combustible necesita un ${name}?`,
      a: `La presión de riel del ${name} (${v.engine}, inyección ${v.injection_name}) es de ${psi} PSI (${bar} bar).` }];
    if (mods[0]) faq.push({ q: `¿Dónde está el módulo de gasolina del ${name}?`, a: mods[0].location_text });
    if (pumps.length) faq.push({ q: `¿Qué pilas de gasolina sirven para un ${name}?`, a: `Compatibles: ${pumps.map(p => p.code).join(', ')}.` });

    res.set('Cache-Control', 'public, max-age=600');
    res.type('html').send(renderShell({
      title, description, canonicalPath: `/vehiculo/${canonicalSlug}`, rootContent, vehicleId: v.id, nonce: res.locals.cspNonce,
      ogImage: ogForVehicle(v.id),
      jsonLd: { '@context': 'https://schema.org', '@type': 'FAQPage', inLanguage: 'es',
        mainEntity: faq.map(f => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) }
    }));
  });

  app.get('/vehiculos', async (req, res) => {
    const rows = await db.all(`SELECT v.id, b.name AS brand, v.model, v.year_from, v.year_to, v.rail_pressure_psi_max
      FROM vehicles v JOIN brands b ON b.id = v.brand_id ORDER BY b.name, v.model, v.year_from`);
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

  /* ---------- Páginas institucionales y legales ----------
     Requisito duro de Google AdSense: todo sitio con anuncios debe tener política de
     privacidad accesible (con divulgación de cookies de terceros y publicidad), datos
     de contacto e identidad del editor. Se sirven renderizadas en servidor para que el
     revisor de AdSense y Googlebot las vean sin ejecutar JavaScript. */
  const CONTACT_EMAIL = process.env.CONTACT_EMAIL || 'newpersonal98@gmail.com';
  const SITE_OWNER = process.env.SITE_OWNER || 'FuelTech Master';
  const LEGAL_UPDATED = '2 de agosto de 2026';

  const h2 = (t) => `<h2 style="font-size:17px;color:#E53935;margin-top:26px;margin-bottom:8px">${t}</h2>`;
  const p = (t) => `<p style="color:#B7BFC9;margin-bottom:10px">${t}</p>`;
  const ul = (items) => `<ul style="color:#B7BFC9;padding-left:20px;margin-bottom:10px;line-height:1.7">${items.map(i => `<li>${i}</li>`).join('')}</ul>`;

  const PAGES = [
    {
      slug: 'acerca-de',
      label: 'Acerca de',
      title: 'Acerca de FuelTech Master — quiénes somos y cómo verificamos los datos',
      description: 'Quién está detrás de FuelTech Master, por qué existe este catálogo técnico de presión de combustible y cómo se obtienen y verifican los datos publicados.',
      h1: 'Acerca de FuelTech Master',
      html: `${p('FuelTech Master es un catálogo técnico independiente de consulta gratuita, enfocado en el sistema de combustible de vehículos que circulan en Latinoamérica: presión de riel (PSI/Bar), ubicación y especificación de módulos de gasolina, y equivalencias de pilas (bombas) OEM y alternativas.')}
        ${h2('Por qué existe')}
        ${p('En el taller, encontrar la presión de riel correcta de un modelo concreto suele significar buscar entre manuales de servicio dispersos, foros y catálogos de refaccionaria que no siempre coinciden. Este proyecto reúne esa información en fichas consultables desde el celular, junto al valor de referencia y los números de parte compatibles, para que el diagnóstico parta de un dato y no de una suposición.')}
        ${h2('Quién lo publica')}
        ${p(`El sitio es desarrollado y mantenido de forma independiente por ${esc(SITE_OWNER)}. No pertenece a ningún fabricante de vehículos ni de autopartes, y no está afiliado, patrocinado ni respaldado por las marcas mencionadas: sus nombres y números de parte se citan únicamente con fines de identificación e intercambiabilidad técnica.`)}
        ${h2('De dónde salen los datos')}
        ${ul([
          'Manuales de servicio y boletines técnicos del fabricante.',
          'Catálogos y fichas de especificación de fabricantes de bombas y módulos de combustible.',
          'Mediciones y correcciones aportadas por mecánicos que usan la plataforma, revisadas antes de publicarse.'
        ])}
        ${p('Cada ficha indica el rango de presión esperado, no un valor absoluto: la lectura real varía con el estado del vehículo, la altitud y las condiciones de la prueba. Las fichas se revisan y corrigen de forma continua; si detectas un dato equivocado, <a href="/contacto" style="color:#E53935">escríbenos</a> y lo verificamos.')}
        ${h2('Cómo se sostiene el sitio')}
        ${p('La consulta es gratuita. El sitio se financia con publicidad de terceros, que se muestra claramente separada del contenido técnico. Los anuncios no influyen en los datos publicados ni en las recomendaciones de diagnóstico. Puedes ver el detalle del tratamiento de datos en la <a href="/privacidad" style="color:#E53935">política de privacidad</a>.')}`
    },
    {
      slug: 'contacto',
      label: 'Contacto',
      title: 'Contacto | FuelTech Master',
      description: 'Escríbenos para reportar un dato incorrecto, solicitar que agreguemos un vehículo al catálogo, consultas de publicidad o ejercer tus derechos de privacidad.',
      h1: 'Contacto',
      html: `${p('Este es un proyecto atendido por una persona, no por un equipo de soporte: respondemos en cuanto podemos, normalmente dentro de unos días hábiles.')}
        ${h2('Correo electrónico')}
        ${p(`<a href="mailto:${esc(CONTACT_EMAIL)}" style="color:#E53935;font-weight:700;font-size:16px">${esc(CONTACT_EMAIL)}</a>`)}
        ${h2('Escríbenos si quieres')}
        ${ul([
          '<strong>Reportar un dato incorrecto.</strong> Indica marca, modelo, año y motor, y el valor que mediste. Es la forma más útil de ayudar al resto de mecánicos.',
          '<strong>Pedir que agreguemos un vehículo.</strong> Si buscaste un modelo y no estaba, dinos cuál.',
          '<strong>Consultas de publicidad</strong> o colaboración.',
          '<strong>Privacidad.</strong> Solicitudes de acceso, corrección o eliminación de datos, según la <a href="/privacidad" style="color:#E53935">política de privacidad</a>.',
          '<strong>Contenido de terceros.</strong> Reclamos sobre comentarios publicados por usuarios o sobre derechos de autor.'
        ])}
        ${h2('Antes de escribir')}
        ${p('Si tu duda es de diagnóstico, revisa primero las <a href="/guia/como-medir-la-presion-de-combustible" style="color:#E53935">guías técnicas</a>: cubren cómo medir la presión, qué significa una lectura baja y cómo distinguir una bomba muerta de un problema eléctrico. No realizamos diagnósticos a distancia de vehículos concretos.')}`
    },
    {
      slug: 'privacidad',
      label: 'Privacidad',
      title: 'Política de privacidad y cookies | FuelTech Master',
      description: 'Qué datos recopila FuelTech Master, qué cookies usamos, cómo trabajan los anuncios de Google y terceros, y cómo puedes controlar o eliminar tu información.',
      h1: 'Política de privacidad y cookies',
      html: `${p(`<em style="color:#979EA7">Última actualización: ${LEGAL_UPDATED}</em>`)}
        ${p(`Esta política explica qué datos trata FuelTech Master (“el sitio”), operado por ${esc(SITE_OWNER)}, cuando visitas ${esc(BASE_URL)}. Para cualquier consulta sobre este documento, escribe a <a href="mailto:${esc(CONTACT_EMAIL)}" style="color:#E53935">${esc(CONTACT_EMAIL)}</a>.`)}

        ${h2('1. Qué datos recopilamos')}
        ${ul([
          '<strong>Datos de uso anónimos.</strong> Para contar visitantes únicos por día generamos un identificador irreversible a partir de tu dirección IP combinada con un valor secreto que rota. No almacenamos tu dirección IP ni podemos reconstruirla a partir de ese identificador. Respetamos la señal Do-Not-Track de tu navegador: si está activada, no registramos la visita.',
          '<strong>Búsquedas sin resultado.</strong> Si buscas un vehículo que no está en el catálogo, guardamos el texto de la búsqueda (sin asociarlo a ti) para saber qué modelos agregar.',
          '<strong>Preguntas al asistente de IA.</strong> El texto que escribes en el chat se envía a la API de Google (Gemini) para generar la respuesta. No lo vinculamos a tu identidad. No escribas datos personales, placas, números de cliente ni información confidencial en el chat.',
          '<strong>Comentarios.</strong> Si publicas un comentario en una ficha, se almacena junto con el nombre que elijas mostrar. Es contenido público: no incluyas datos personales.',
          '<strong>Preferencias locales.</strong> Tu “garage” de vehículos guardados y la aceptación de este aviso se guardan en el almacenamiento local de tu navegador, en tu dispositivo. No viajan a nuestros servidores y puedes borrarlos limpiando los datos del sitio.'
        ])}
        ${p('No solicitamos ni almacenamos nombre, dirección, teléfono ni datos de pago. El sitio no requiere registro de usuario.')}

        ${h2('2. Cookies y tecnologías similares')}
        ${p('Usamos cookies y almacenamiento local propios para el funcionamiento del sitio y para recordar tus preferencias. Además, terceros pueden colocar cookies en tu navegador, como se detalla a continuación.')}
        ${ul([
          '<strong>Cookies necesarias.</strong> Mantienen el funcionamiento básico y recuerdan que aceptaste este aviso.',
          '<strong>Cookies analíticas.</strong> Usamos Google Analytics 4 para entender de forma agregada qué páginas se consultan más. La información se procesa de forma anónima.',
          '<strong>Cookies publicitarias.</strong> Usadas por Google y sus socios para mostrar y medir anuncios, según se explica en la sección 3.'
        ])}
        ${p('Puedes bloquear o eliminar cookies desde la configuración de tu navegador. Si las bloqueas, el sitio seguirá funcionando, aunque algunas preferencias no se recordarán.')}

        ${h2('3. Publicidad de terceros (Google AdSense)')}
        ${ul([
          'Proveedores externos, incluido Google, utilizan cookies para publicar anuncios basados en visitas anteriores del usuario a este u otros sitios web.',
          'El uso por parte de Google de cookies publicitarias le permite a él y a sus socios publicar anuncios basados en tus visitas a este y otros sitios.',
          `Puedes inhabilitar la publicidad personalizada en la <a href="https://www.google.com/settings/ads" rel="noopener nofollow" target="_blank" style="color:#E53935">Configuración de anuncios de Google</a>. También puedes desactivar el uso de cookies de otros proveedores en <a href="https://www.aboutads.info/choices/" rel="noopener nofollow" target="_blank" style="color:#E53935">aboutads.info</a> o <a href="https://www.youronlinechoices.com/" rel="noopener nofollow" target="_blank" style="color:#E53935">youronlinechoices.com</a>.`,
          'Los terceros que muestran anuncios en este sitio pueden recopilar tu dirección IP, identificadores de dispositivo y datos de navegación conforme a sus propias políticas. Consulta cómo <a href="https://policies.google.com/technologies/partner-sites" rel="noopener nofollow" target="_blank" style="color:#E53935">Google utiliza la información de los sitios que usan sus servicios</a>.'
        ])}
        ${p('Si te encuentras en el Espacio Económico Europeo, Reino Unido o Suiza, los anuncios personalizados y las cookies no esenciales solo se activan si das tu consentimiento mediante el aviso que aparece al entrar, y puedes retirarlo en cualquier momento borrando los datos del sitio en tu navegador.')}

        ${h2('4. Con quién compartimos datos')}
        ${p('No vendemos ni cedemos tus datos. Los proveedores que procesan información por cuenta nuestra son: Google (Analytics, AdSense y la API de Gemini para el chat) y nuestro proveedor de alojamiento, que registra peticiones para seguridad y operación del servicio. Podemos divulgar información si la ley lo exige.')}

        ${h2('5. Cuánto tiempo conservamos los datos')}
        ${p('Los conteos de visita agregados y las búsquedas sin resultado se conservan mientras sean útiles para mejorar el catálogo. Los comentarios permanecen publicados hasta que se solicite su eliminación o los retiremos por incumplir las normas de uso.')}

        ${h2('6. Tus derechos')}
        ${p(`Puedes solicitar acceso, corrección o eliminación de la información que te concierna, así como la retirada de un comentario, escribiendo a <a href="mailto:${esc(CONTACT_EMAIL)}" style="color:#E53935">${esc(CONTACT_EMAIL)}</a>. Ten en cuenta que gran parte de los datos que tratamos son anónimos y puede que no seamos capaces de vincularlos a ti.`)}

        ${h2('7. Menores de edad')}
        ${p('El sitio está dirigido a profesionales y aficionados a la mecánica automotriz. No está dirigido a menores de 13 años y no recopilamos conscientemente información de ellos.')}

        ${h2('8. Cambios en esta política')}
        ${p('Si modificamos esta política, actualizaremos la fecha del encabezado. Los cambios sustanciales se anunciarán en el propio sitio.')}`
    },
    {
      slug: 'terminos',
      label: 'Términos y aviso técnico',
      title: 'Términos de uso y aviso técnico | FuelTech Master',
      description: 'Condiciones de uso de FuelTech Master, límites de responsabilidad sobre los datos técnicos publicados, normas para comentarios y propiedad intelectual.',
      h1: 'Términos de uso y aviso técnico',
      html: `${p(`<em style="color:#979EA7">Última actualización: ${LEGAL_UPDATED}</em>`)}
        ${p('Al usar FuelTech Master aceptas estas condiciones. Si no estás de acuerdo con ellas, no utilices el sitio.')}

        ${h2('1. Aviso técnico importante')}
        ${p('La información publicada —presión de riel, flujos, amperajes, ubicaciones y números de parte— es de carácter <strong>orientativo y de referencia</strong>. No sustituye al manual de servicio del fabricante, a las especificaciones del proveedor de la refacción ni al criterio de un técnico calificado.')}
        ${ul([
          'Verifica siempre los valores contra el manual de servicio del vehículo antes de intervenir o reemplazar componentes.',
          'Trabajar con el sistema de combustible implica riesgo de incendio y lesiones: alivia la presión, desconecta la batería y trabaja en área ventilada.',
          'Las equivalencias de refacciones son sugerencias de compatibilidad; confirma la aplicación con el catálogo del fabricante antes de comprar o instalar.'
        ])}
        ${p('No asumimos responsabilidad por daños a vehículos, pérdidas económicas o lesiones derivadas del uso de esta información. La usas bajo tu propio criterio y responsabilidad.')}

        ${h2('2. Servicio “tal cual”')}
        ${p('El sitio se ofrece sin garantías de exactitud, disponibilidad o continuidad. Nos esforzamos por mantener los datos correctos y actualizados, pero pueden contener errores u omisiones. Podemos modificar, suspender o retirar cualquier parte del servicio en cualquier momento.')}

        ${h2('3. Asistente de inteligencia artificial')}
        ${p('El chat genera respuestas de forma automática y puede equivocarse o producir información incompleta. Trátalo como una ayuda de orientación, nunca como un dictamen técnico. Verifica siempre sus respuestas contra la ficha del vehículo y el manual de servicio.')}

        ${h2('4. Comentarios de usuarios')}
        ${p('Los comentarios reflejan la opinión de quien los publica, no la nuestra. Al publicar, garantizas que el contenido es tuyo y nos concedes permiso para mostrarlo en el sitio. Está prohibido publicar:')}
        ${ul([
          'Datos personales propios o de terceros.',
          'Spam, publicidad no solicitada o enlaces de afiliación.',
          'Contenido ofensivo, ilegal, o que infrinja derechos de terceros.'
        ])}
        ${p(`Moderamos y podemos eliminar cualquier comentario sin previo aviso. Para reportar uno, escribe a <a href="mailto:${esc(CONTACT_EMAIL)}" style="color:#E53935">${esc(CONTACT_EMAIL)}</a>.`)}

        ${h2('5. Propiedad intelectual y marcas')}
        ${p('El diseño, los textos y la organización del catálogo son propiedad de sus autores. Puedes consultar y compartir enlaces libremente; no está permitida la reproducción masiva ni el raspado automatizado del contenido. Las marcas de vehículos y de autopartes citadas pertenecen a sus respectivos titulares y se mencionan solo con fines de identificación técnica; el sitio no está afiliado a ellas.')}

        ${h2('6. Publicidad')}
        ${p('El sitio muestra anuncios de terceros para sostener su operación. No controlamos el contenido de esos anuncios ni respaldamos los productos anunciados, y no somos responsables de las transacciones que realices con los anunciantes. El tratamiento de datos publicitarios se describe en la <a href="/privacidad" style="color:#E53935">política de privacidad</a>.')}

        ${h2('7. Enlaces externos')}
        ${p('Podemos enlazar a sitios de terceros por conveniencia. No controlamos su contenido ni sus prácticas de privacidad.')}`
    }
  ];

  // Pie legal común: AdSense exige que privacidad y contacto sean accesibles desde cualquier página.
  const LEGAL_LINKS = [
    ['/acerca-de', 'Acerca de'], ['/contacto', 'Contacto'],
    ['/privacidad', 'Privacidad y cookies'], ['/terminos', 'Términos y aviso técnico']
  ];
  const legalFooter = () => `<footer style="max-width:820px;margin:36px auto 0;padding:20px 22px 40px;border-top:1px solid rgba(74,85,98,.35);color:#979EA7;font:400 12px/1.9 Montserrat,system-ui,sans-serif">
      <p style="margin-bottom:6px">${LEGAL_LINKS.map(([href, label]) => `<a href="${href}" style="color:#979EA7">${label}</a>`).join(' · ')}</p>
      <p>Datos técnicos de referencia: verifica siempre contra el manual de servicio del fabricante antes de intervenir el vehículo.</p>
      <p style="margin-top:6px">© 2025–2026 ${esc(SITE_OWNER)}.</p>
    </footer>`;

  app.get('/:slug(acerca-de|contacto|privacidad|terminos)', async (req, res, next) => {
    const pg = PAGES.find(x => x.slug === req.params.slug);
    if (!pg) return next();
    res.set('Cache-Control', 'public, max-age=3600');
    res.type('html').send(renderShell({
      title: pg.title, description: pg.description, canonicalPath: '/' + pg.slug, nonce: res.locals.cspNonce,
      rootContent: `<main style="max-width:820px;margin:0 auto;padding:40px 22px 0;color:#E5E7EB;font-family:Montserrat,system-ui,sans-serif;line-height:1.7">
        <p style="font:700 11px/1 sans-serif;letter-spacing:2px;text-transform:uppercase;color:#979EA7"><a href="/" style="color:#979EA7;text-decoration:none">FuelTech Master</a></p>
        <h1 style="font-size:26px;margin:10px 0 18px">${pg.h1}</h1>
        ${pg.html}
      </main>`
    }));
  });

  /* ---------- Guías de contenido (SEO por intención de búsqueda) ----------
     Atacan lo que los mecánicos googlean todo el día: "síntomas bomba de gasolina",
     "cómo medir presión de combustible", "presión baja causas". Cada guía enlaza al catálogo. */
  const GUIDES = [
    {
      slug: 'sintomas-bomba-de-gasolina-fallando',
      label: 'Síntomas de bomba fallando',
      title: '7 síntomas de una bomba de gasolina fallando (y cómo confirmarlo) | FuelTech Master',
      description: 'Aprende a reconocer una bomba (pila) de gasolina que se está muriendo: arranque difícil en caliente, jaloneo, pérdida de potencia, zumbido del tanque y más. Guía para mecánicos.',
      h1: '7 síntomas de una bomba de gasolina fallando',
      html: `<p style="color:#B7BFC9">Una bomba (pila) de gasolina desgastada rara vez muere de golpe: primero da avisos. Reconocerlos a tiempo evita dejar tirado al cliente y apunta el diagnóstico hacia la presión de combustible.</p>
        <h2 style="font-size:17px;color:#E53935;margin-top:22px">Los 7 síntomas más comunes</h2>
        <ol style="padding-left:20px">
          <li><strong>Arranque difícil en caliente.</strong> Con el motor caliente tarda en encender: la bomba ya no sostiene presión residual.</li>
          <li><strong>Jaloneo y pérdida de potencia en subidas o al acelerar a fondo.</strong> El motor pide más flujo del que la bomba puede dar.</li>
          <li><strong>Tirones a velocidad de crucero constante.</strong> La presión cae de forma intermitente.</li>
          <li><strong>Zumbido o ruido agudo desde el tanque.</strong> Una bomba forzada (o con cedazo tapado) trabaja más ruidosa.</li>
          <li><strong>El motor no arranca.</strong> Sin presión de combustible no hay pulverización en los inyectores.</li>
          <li><strong>Apagones intermitentes</strong> en ralentí o en marcha, con reencendido posterior.</li>
          <li><strong>Mayor consumo o marcha irregular</strong> por presión fuera de especificación.</li>
        </ol>
        <h2 style="font-size:17px;color:#E53935;margin-top:22px">Cómo confirmarlo (no adivines)</h2>
        <p style="color:#B7BFC9">Todos estos síntomas también los provoca un filtro tapado, un regulador defectuoso o una caída de voltaje en el circuito. La única forma de confirmar es <a href="/guia/como-medir-la-presion-de-combustible" style="color:#E53935">medir la presión de combustible</a> y compararla con la <a href="/vehiculos" style="color:#E53935">especificación de tu vehículo</a>. Consulta siempre el manual de servicio antes de reemplazar.</p>`,
      faq: [
        { q: '¿Cuáles son los síntomas de una bomba de gasolina fallando?', a: 'Arranque difícil en caliente, jaloneo y pérdida de potencia al acelerar, tirones a velocidad constante, zumbido desde el tanque, apagones intermitentes y, en el peor caso, que el motor no arranque.' },
        { q: '¿Cómo sé si es la bomba o el filtro?', a: 'Los síntomas son iguales; hay que medir la presión de combustible con manómetro y compararla contra la especificación del vehículo. Un filtro/cedazo tapado también baja la presión.' }
      ]
    },
    {
      slug: 'como-medir-la-presion-de-combustible',
      label: 'Cómo medir la presión',
      title: 'Cómo medir la presión de combustible paso a paso (con manómetro) | FuelTech Master',
      description: 'Guía práctica para medir la presión de riel/combustible con manómetro: alivio de presión, conexión, lectura con llave ON, en ralentí y prueba de retención. Valores esperados por vehículo.',
      h1: 'Cómo medir la presión de combustible (paso a paso)',
      html: `<p style="color:#B7BFC9">Medir la presión es lo que separa el diagnóstico de la adivinanza. Necesitas un <strong>manómetro de combustible</strong> con los adaptadores adecuados y tomar precauciones: la gasolina está a presión.</p>
        <h2 style="font-size:17px;color:#E53935;margin-top:22px">Paso a paso</h2>
        <ol style="padding-left:20px">
          <li><strong>Alivia la presión</strong> del sistema antes de abrir nada (fusible de la bomba y arrancar hasta que se apague, o válvula Schrader si existe).</li>
          <li><strong>Conecta el manómetro</strong> en el puerto de prueba (Schrader) del riel, o en línea con adaptador en T si no hay puerto.</li>
          <li><strong>Llave en ON (sin arrancar):</strong> la bomba presuriza 2–3 segundos. Anota la lectura pico.</li>
          <li><strong>Arranca y lee en ralentí:</strong> compara con la especificación. En sistemas con retorno, al desconectar el vacío del regulador la presión debe subir.</li>
          <li><strong>Prueba de retención:</strong> apaga y observa cuánto tarda en caer. Una caída rápida indica bomba, check, regulador o inyector con fuga.</li>
        </ol>
        <h2 style="font-size:17px;color:#E53935;margin-top:22px">¿Qué presión debe tener?</h2>
        <p style="color:#B7BFC9">Depende del vehículo y del tipo de inyección (TBI, MFI, Vortec, GDI). Busca el valor exacto de tu auto en el <a href="/vehiculos" style="color:#E53935">catálogo</a>. Si estás por debajo del rango, revisa <a href="/guia/presion-de-combustible-baja" style="color:#E53935">las causas de presión baja</a>.</p>`,
      faq: [
        { q: '¿Dónde se conecta el manómetro de presión de combustible?', a: 'En el puerto de prueba (válvula Schrader) del riel de inyectores si existe, o en línea con un adaptador en T. Antes hay que aliviar la presión del sistema.' },
        { q: '¿Qué presión de combustible es normal?', a: 'Varía por vehículo y tipo de inyección. Consulta el valor exacto de tu modelo en el catálogo de FuelTech Master y compáralo con tu lectura.' }
      ]
    },
    {
      slug: 'presion-de-combustible-baja',
      label: 'Presión baja: causas',
      title: 'Presión de combustible baja: causas y cómo diagnosticarla | FuelTech Master',
      description: 'Presión de riel por debajo de especificación: bomba desgastada, cedazo/filtro tapado, regulador, caída de voltaje en el circuito, líneas obstruidas o fugas. Cómo diagnosticar cada causa.',
      h1: 'Presión de combustible baja: causas y diagnóstico',
      html: `<p style="color:#B7BFC9">Mediste y estás por debajo del rango. Antes de condenar la bomba, descarta en orden estas causas — varias son más baratas y comunes.</p>
        <h2 style="font-size:17px;color:#E53935;margin-top:22px">Causas más frecuentes</h2>
        <ul style="padding-left:20px">
          <li><strong>Cedazo o filtro de combustible tapado.</strong> Restringe el flujo; es lo primero y más barato a revisar.</li>
          <li><strong>Bomba (pila) desgastada.</strong> Ya no alcanza la presión ni el flujo; se confirma con prueba de flujo y presión muerta (deadhead).</li>
          <li><strong>Regulador de presión defectuoso.</strong> Fuga o no mantiene el valor; en sistemas con retorno se prueba con el vacío.</li>
          <li><strong>Caída de voltaje en el circuito de la bomba.</strong> Un cable/relé/conector con resistencia hace que la bomba gire lento y dé menos presión. Mide voltaje en el conector con la bomba trabajando.</li>
          <li><strong>Líneas obstruidas o aplastadas / fuga.</strong> Restricción o pérdida en el camino al riel.</li>
        </ul>
        <h2 style="font-size:17px;color:#E53935;margin-top:22px">El orden correcto</h2>
        <p style="color:#B7BFC9">Mide voltaje en la bomba antes de cambiarla: muchas bombas "malas" en realidad reciben voltaje bajo. Luego descarta cedazo/filtro y regulador. Compara siempre contra la <a href="/vehiculos" style="color:#E53935">especificación de tu vehículo</a> y consulta el manual de servicio.</p>`,
      faq: [
        { q: '¿Por qué la presión de combustible está baja?', a: 'Las causas más comunes son: cedazo/filtro tapado, bomba desgastada, regulador defectuoso, caída de voltaje en el circuito de la bomba, y líneas obstruidas o con fuga.' },
        { q: '¿Cómo saber si es la bomba o un problema eléctrico?', a: 'Mide el voltaje en el conector de la bomba mientras trabaja. Si el voltaje es bajo, el problema es del circuito (cable, relé, conector), no de la bomba.' }
      ]
    },
    {
      slug: 'presion-de-combustible-alta',
      label: 'Presión alta: causas',
      title: 'Presión de combustible alta: causas, síntomas y diagnóstico | FuelTech Master',
      description: 'Presión de riel por encima de especificación: retorno obstruido, regulador trabado, vacío desconectado o bomba sin control. Síntomas de mezcla rica y cómo diagnosticar cada causa.',
      h1: 'Presión de combustible alta: causas y diagnóstico',
      html: `<p style="color:#B7BFC9">Se habla mucho de presión baja y casi nada de presión alta, pero es igual de dañina: con exceso de presión los inyectores entregan más combustible del que la computadora calcula, y el motor trabaja rico sin que aparezca una falla evidente al principio.</p>
        <h2 style="font-size:17px;color:#E53935;margin-top:22px">Cómo se manifiesta</h2>
        <ul style="padding-left:20px">
          <li><strong>Consumo elevado</strong> sin causa aparente y olor a gasolina en el escape.</li>
          <li><strong>Humo negro</strong> y códigos de mezcla rica (P0172 / P0175) o de banda de combustible negativa.</li>
          <li><strong>Marcha irregular en frío</strong>, tirones y, con el tiempo, bujías carbonizadas y catalizador dañado.</li>
          <li><strong>Arranque difícil en caliente</strong> por exceso de combustible en el múltiple.</li>
        </ul>
        <h2 style="font-size:17px;color:#E53935;margin-top:22px">Causas más frecuentes</h2>
        <ul style="padding-left:20px">
          <li><strong>Línea de retorno obstruida o aplastada.</strong> En sistemas con retorno, si el combustible no puede volver al tanque la presión sube. Es la causa número uno.</li>
          <li><strong>Regulador de presión trabado en cerrado.</strong> No permite el desahogo; se confirma comparando la lectura con y sin vacío.</li>
          <li><strong>Manguera de vacío del regulador desconectada, rota o tapada.</strong> Sin la señal de vacío el regulador mantiene la presión más alta de lo debido en ralentí. Es una revisión de treinta segundos y se pasa por alto constantemente.</li>
          <li><strong>Filtro instalado al revés</strong> o de aplicación incorrecta, restringiendo el retorno.</li>
          <li><strong>Módulo o bomba de repuesto con regulación distinta a la original.</strong> Muy común al montar una pila genérica: entrega más presión de la que el sistema espera.</li>
        </ul>
        <h2 style="font-size:17px;color:#E53935;margin-top:22px">El orden de diagnóstico</h2>
        <p style="color:#B7BFC9">Con el manómetro conectado y el motor en ralentí, desconecta la manguera de vacío del regulador: la presión debe subir unos 5–10 PSI. Si no cambia nada, el regulador o su señal de vacío están en falla. Después pincha o desconecta con cuidado la línea de retorno para ver si la presión reacciona; si no baja, la restricción está en el retorno. Contrasta siempre la lectura con el <a href="/vehiculos" style="color:#E53935">valor de tu vehículo</a>: “alta” significa por encima del rango de ese modelo, no de un número general.</p>
        <p style="color:#B7BFC9">En motores de <a href="/guia/inyeccion-gdi-vs-mfi-presion" style="color:#E53935">inyección directa (GDI)</a> el diagnóstico es distinto: la presión la controla la ECU y una lectura alta suele ser un problema de sensor o de mando, no mecánico.</p>`,
      faq: [
        { q: '¿Qué pasa si la presión de combustible es muy alta?', a: 'Los inyectores entregan más combustible del calculado y el motor trabaja rico: aumenta el consumo, aparece humo negro, códigos P0172/P0175, bujías carbonizadas y a la larga se daña el catalizador.' },
        { q: '¿Por qué sube la presión de combustible?', a: 'Las causas más comunes son línea de retorno obstruida, regulador de presión trabado en cerrado, manguera de vacío del regulador desconectada o rota, filtro mal instalado y bombas o módulos de repuesto con regulación distinta a la original.' }
      ]
    },
    {
      slug: 'regulador-de-presion-de-combustible',
      label: 'Regulador: cómo probarlo',
      title: 'Regulador de presión de combustible: cómo funciona y cómo probarlo | FuelTech Master',
      description: 'Qué hace el regulador de presión, diferencias entre sistemas con y sin retorno, y tres pruebas para saber si está fallando antes de cambiarlo.',
      h1: 'Regulador de presión de combustible: cómo probarlo',
      html: `<p style="color:#B7BFC9">El regulador es el componente que decide a qué presión llega el combustible a los inyectores. La bomba siempre empuja de más; el regulador desahoga el sobrante para mantener el valor correcto. Cuando falla, la presión se va por arriba o por abajo y el diagnóstico se confunde fácilmente con una bomba muerta.</p>
        <h2 style="font-size:17px;color:#E53935;margin-top:22px">Con retorno y sin retorno</h2>
        <ul style="padding-left:20px">
          <li><strong>Con retorno (sistemas más antiguos).</strong> El regulador va en el riel y devuelve el sobrante al tanque por una segunda línea. Suele tener una manguera de vacío del múltiple: al acelerar cae el vacío y la presión sube, compensando la carga del motor.</li>
          <li><strong>Sin retorno (returnless, la mayoría de los modernos).</strong> El regulador está dentro del módulo, en el tanque. No hay línea de retorno ni manguera de vacío, y la presión se mantiene constante. Aquí el regulador casi nunca se vende suelto: viene integrado en el módulo.</li>
        </ul>
        <p style="color:#B7BFC9">Saber cuál tiene el vehículo cambia por completo la prueba. Consulta la ficha de tu modelo en el <a href="/vehiculos" style="color:#E53935">catálogo</a> antes de buscar un regulador que quizá no exista por separado.</p>
        <h2 style="font-size:17px;color:#E53935;margin-top:22px">Tres pruebas concretas</h2>
        <ol style="padding-left:20px">
          <li><strong>Prueba de vacío (solo con retorno).</strong> Con el motor en ralentí y el manómetro conectado, desconecta la manguera de vacío del regulador. La presión debe subir de inmediato unos 5–10 PSI. Si no se mueve, el regulador está trabado o el diafragma está roto.</li>
          <li><strong>Prueba de gasolina en la manguera de vacío.</strong> Quita la manguera y mírala por dentro. Si tiene combustible o huele a gasolina, el diafragma del regulador está perforado y está mandando combustible al múltiple: cámbialo.</li>
          <li><strong>Prueba de retención.</strong> Apaga el motor y observa el manómetro. Una caída rápida indica fuga por el regulador, por la válvula check de la bomba o por un inyector. Pinza la línea de retorno: si la presión ahora se sostiene, el que fuga es el regulador.</li>
        </ol>
        <h2 style="font-size:17px;color:#E53935;margin-top:22px">Antes de cambiarlo</h2>
        <p style="color:#B7BFC9">Un regulador defectuoso y un <a href="/guia/presion-de-combustible-baja" style="color:#E53935">cedazo tapado</a> dan lecturas parecidas. Descarta primero filtro y <a href="/guia/voltaje-circuito-bomba-de-gasolina" style="color:#E53935">voltaje en el circuito de la bomba</a>, que son más baratos de revisar, y compara siempre contra la especificación del fabricante.</p>`,
      faq: [
        { q: '¿Cómo saber si el regulador de presión de combustible está malo?', a: 'Desconecta su manguera de vacío con el motor en ralentí: la presión debe subir 5–10 PSI. Si no cambia, o si encuentras gasolina dentro de la manguera de vacío, el regulador está fallando.' },
        { q: '¿Dónde está el regulador de presión de combustible?', a: 'En sistemas con retorno va en el riel de inyectores, con una manguera de vacío conectada. En sistemas sin retorno está integrado dentro del módulo, en el tanque, y normalmente se reemplaza junto con el módulo completo.' }
      ]
    },
    {
      slug: 'voltaje-circuito-bomba-de-gasolina',
      label: 'Voltaje de la bomba',
      title: 'Voltaje y caída de tensión en el circuito de la bomba de gasolina | FuelTech Master',
      description: 'Cómo medir voltaje y caída de tensión en el circuito de la bomba de combustible, por qué una bomba buena entrega poca presión y cómo revisar relé, tierra y conectores.',
      h1: 'Voltaje en el circuito de la bomba: la prueba que evita cambios innecesarios',
      html: `<p style="color:#B7BFC9">Muchas bombas devueltas como “defectuosas” estaban perfectamente bien: recibían 9 voltios en lugar de 12. Una bomba alimentada con voltaje bajo gira lento, entrega menos presión y menos flujo, y da exactamente los mismos síntomas que una bomba desgastada. Esta prueba toma cinco minutos y evita tirar el dinero.</p>
        <h2 style="font-size:17px;color:#E53935;margin-top:22px">Medir voltaje en el conector</h2>
        <p style="color:#B7BFC9">Con el multímetro en voltaje DC, mide entre el positivo y la tierra del conector de la bomba <strong>mientras la bomba está trabajando</strong> (llave en ON los primeros segundos, o con el motor encendido). Una medición con la bomba apagada no sirve de nada: el problema aparece solo bajo carga.</p>
        <ul style="padding-left:20px">
          <li><strong>Menos de 0.5 V de diferencia</strong> respecto al voltaje de batería: circuito sano.</li>
          <li><strong>Entre 0.5 y 1 V de diferencia:</strong> hay resistencia, conviene revisar conectores y tierra.</li>
          <li><strong>Más de 1 V de diferencia:</strong> falla clara en el circuito. No cambies la bomba todavía.</li>
        </ul>
        <h2 style="font-size:17px;color:#E53935;margin-top:22px">Prueba de caída de tensión</h2>
        <p style="color:#B7BFC9">Es la forma correcta de localizar dónde se pierde el voltaje. Con el circuito energizado y la bomba trabajando, pon las puntas del multímetro en los dos extremos del tramo que sospechas (por ejemplo, positivo de batería y positivo del conector de la bomba). Lo que marque el multímetro es lo que ese tramo se está “comiendo”. Repite del lado de tierra: entre el negativo de batería y el pin de tierra de la bomba no deberías tener más de 0.2 V.</p>
        <h2 style="font-size:17px;color:#E53935;margin-top:22px">Dónde suele estar la falla</h2>
        <ul style="padding-left:20px">
          <li><strong>Conector de la bomba quemado o con los pines flojos.</strong> Es el sospechoso más común, sobre todo si el vehículo ya tuvo un cambio de bomba antes.</li>
          <li><strong>Relé de la bomba con contactos picados.</strong> Prueba puenteando o sustituyendo por un relé idéntico del mismo vehículo.</li>
          <li><strong>Tierra oxidada o mal apretada</strong> en el chasis o en el propio módulo.</li>
          <li><strong>Empalmes anteriores mal hechos</strong>, cinta en lugar de soldadura, o cable de calibre menor al original.</li>
          <li><strong>Fusible con corrosión</strong> en el portafusible, que mide continuidad pero cae bajo carga.</li>
        </ul>
        <h2 style="font-size:17px;color:#E53935;margin-top:22px">La secuencia que funciona</h2>
        <p style="color:#B7BFC9">Mide <a href="/guia/como-medir-la-presion-de-combustible" style="color:#E53935">presión de combustible</a> primero. Si está baja, mide voltaje en la bomba antes de desarmar el tanque. Si el voltaje es correcto y la presión sigue baja, entonces sí revisa <a href="/guia/presion-de-combustible-baja" style="color:#E53935">cedazo, filtro y regulador</a>, y por último la bomba. Cambiar una bomba en un circuito con caída de tensión solo repite la falla: la bomba nueva también trabajará forzada y durará menos.</p>`,
      faq: [
        { q: '¿Cuánto voltaje debe llegar a la bomba de gasolina?', a: 'Prácticamente el mismo que el de la batería. Con la bomba trabajando, la diferencia entre el voltaje de batería y el que llega al conector no debe superar 0.5 V; más de 1 V indica una falla en el circuito.' },
        { q: '¿Por qué una bomba nueva sigue dando presión baja?', a: 'Casi siempre por caída de tensión en el circuito: conector quemado, relé con contactos picados, tierra oxidada o un empalme mal hecho. La bomba gira lento y entrega menos presión aunque esté nueva.' }
      ]
    },
    {
      slug: 'inyeccion-gdi-vs-mfi-presion',
      label: 'GDI vs MFI',
      title: 'GDI vs MFI: por qué la presión de combustible no se mide igual | FuelTech Master',
      description: 'Diferencias entre inyección directa (GDI) e inyección a puerto (MFI/TBI): presiones de trabajo, bomba de baja y de alta, y qué precauciones tomar al diagnosticar cada sistema.',
      h1: 'GDI vs MFI: por qué la presión no se mide igual',
      html: `<p style="color:#B7BFC9">Conectar un manómetro convencional a un motor de inyección directa es un error que se paga caro. Los sistemas GDI trabajan con presiones cientos de veces mayores y con un circuito completamente distinto. Antes de tocar nada, hay que saber qué sistema tienes enfrente.</p>
        <h2 style="font-size:17px;color:#E53935;margin-top:22px">Inyección a puerto: TBI y MFI</h2>
        <p style="color:#B7BFC9">El inyector rocía en el múltiple de admisión, antes de la válvula. Una sola bomba eléctrica en el tanque genera toda la presión del sistema, que se mantiene en un rango bajo y constante: por lo general entre 30 y 60 PSI según el modelo, y menos aún en los TBI antiguos. Es el sistema para el que sirve el manómetro clásico con adaptadores, y el que cubren la mayoría de las fichas del catálogo.</p>
        <h2 style="font-size:17px;color:#E53935;margin-top:22px">Inyección directa: GDI</h2>
        <p style="color:#B7BFC9">El inyector rocía dentro de la cámara de combustión, contra la presión de compresión, así que necesita muchísima más fuerza. El circuito tiene <strong>dos etapas</strong>:</p>
        <ul style="padding-left:20px">
          <li><strong>Baja presión.</strong> La bomba eléctrica del tanque —la pila que sí puedes reemplazar— alimenta a la bomba de alta con un valor moderado, típicamente entre 50 y 90 PSI.</li>
          <li><strong>Alta presión.</strong> Una bomba mecánica accionada por el árbol de levas eleva la presión a valores que van de 500 a más de 2 500 PSI, controlados electrónicamente por la ECU según la carga.</li>
        </ul>
        <p style="color:#B7BFC9">La etapa de alta <strong>no se mide con manómetro convencional</strong>: se lee con escáner, en el PID de presión de riel, comparando el valor deseado contra el valor real. Abrir esa parte del circuito con el motor caliente es peligroso.</p>
        <h2 style="font-size:17px;color:#E53935;margin-top:22px">Qué significa esto al diagnosticar</h2>
        <ul style="padding-left:20px">
          <li>En GDI, un arranque difícil o una pérdida de potencia puede venir de la bomba del tanque (baja) o de la bomba de alta. Empieza midiendo la baja, que es accesible y barata.</li>
          <li>Si la baja está en especificación y el escáner muestra que la presión real no alcanza la deseada, el problema está en la bomba de alta, su válvula de control o el lóbulo del árbol de levas que la acciona.</li>
          <li>Las pilas de repuesto para GDI deben cumplir el valor de baja presión exacto: una pila genérica de menor entrega deja sin alimentación a la bomba de alta y provoca fallas intermitentes difíciles de rastrear.</li>
          <li>Nunca uses el rango de un motor MFI como referencia para uno GDI, ni al revés. En el <a href="/vehiculos" style="color:#E53935">catálogo</a> cada ficha indica el tipo de inyección junto al valor de presión, precisamente por esto.</li>
        </ul>`,
      faq: [
        { q: '¿Cuál es la diferencia entre GDI y MFI?', a: 'En MFI el inyector rocía en el múltiple de admisión y una sola bomba del tanque genera toda la presión (30–60 PSI típicos). En GDI el inyector rocía dentro de la cámara y hay dos etapas: una bomba eléctrica de baja en el tanque y una bomba mecánica de alta accionada por el árbol de levas que llega a cientos o miles de PSI.' },
        { q: '¿Se puede medir la presión de un motor GDI con manómetro?', a: 'Solo la etapa de baja presión. La etapa de alta se lee con escáner en el PID de presión de riel, comparando el valor deseado contra el real; abrirla con manómetro convencional es peligroso.' }
      ]
    },
    {
      slug: 'como-cambiar-la-pila-de-gasolina',
      label: 'Cambiar la pila paso a paso',
      title: 'Cómo cambiar la pila (bomba) de gasolina paso a paso | FuelTech Master',
      description: 'Procedimiento seguro para reemplazar una pila o módulo de gasolina: alivio de presión, acceso al tanque, cambio del cedazo, precauciones eléctricas y verificación final.',
      h1: 'Cómo cambiar la pila de gasolina paso a paso',
      html: `<p style="color:#B7BFC9">Antes de empezar: confirma con el manómetro que la bomba es realmente la culpable. Una <a href="/guia/presion-de-combustible-baja" style="color:#E53935">presión baja</a> también la provoca un cedazo tapado, un regulador en falla o una <a href="/guia/voltaje-circuito-bomba-de-gasolina" style="color:#E53935">caída de voltaje</a>, y todas son más baratas de resolver.</p>
        <h2 style="font-size:17px;color:#E53935;margin-top:22px">Seguridad primero</h2>
        <ul style="padding-left:20px">
          <li>Trabaja en área ventilada, sin llamas, chispas ni herramientas eléctricas cerca del tanque abierto.</li>
          <li>Ten un extintor a la mano. No es una formalidad.</li>
          <li>Alivia la presión del sistema antes de desconectar cualquier línea: quita el fusible o el relé de la bomba y deja que el motor se apague solo.</li>
          <li>Desconecta el negativo de la batería antes de manipular el conector del módulo.</li>
          <li>Trabaja con el tanque lo más vacío posible: pesa menos y hay menos vapor.</li>
        </ul>
        <h2 style="font-size:17px;color:#E53935;margin-top:22px">El procedimiento</h2>
        <ol style="padding-left:20px">
          <li><strong>Localiza el acceso.</strong> Muchos vehículos tienen una tapa de registro bajo el asiento trasero o en el piso de la cajuela; otros obligan a bajar el tanque. La ficha de tu modelo en el <a href="/vehiculos" style="color:#E53935">catálogo</a> indica la ubicación del módulo.</li>
          <li><strong>Limpia alrededor de la tapa</strong> antes de abrirla. La tierra que cae dentro del tanque termina en el cedazo nuevo.</li>
          <li><strong>Desconecta el conector eléctrico y las líneas</strong> de alimentación y retorno. Marca cuál es cuál si no están codificadas.</li>
          <li><strong>Retira el anillo de seguridad</strong> con la herramienta adecuada o golpes suaves y controlados. Saca el módulo con cuidado: el brazo del flotador se dobla con nada.</li>
          <li><strong>Compara la pieza nueva contra la vieja</strong> antes de instalar: altura del módulo, posición de las salidas, tipo de conector y polaridad. Una pila correcta en especificación pero con conector distinto no sirve.</li>
          <li><strong>Cambia el cedazo (filtro previo) siempre.</strong> Es barato y es la causa de que la bomba nueva se esfuerce y muera antes de tiempo.</li>
          <li><strong>Sustituye el empaque o junta del módulo.</strong> Reutilizar el viejo es la fuente habitual de olor a gasolina después del trabajo.</li>
          <li><strong>Monta, conecta y purga.</strong> Antes de arrancar, da varias veces llave a ON durante tres segundos para que la bomba llene el riel.</li>
        </ol>
        <h2 style="font-size:17px;color:#E53935;margin-top:22px">Verificación final</h2>
        <p style="color:#B7BFC9">Conecta el manómetro y confirma que la presión coincide con la especificación de tu vehículo, tanto con llave en ON como en ralentí. Haz una <a href="/guia/como-medir-la-presion-de-combustible" style="color:#E53935">prueba de retención</a> al apagar y revisa que no haya fugas en la tapa del módulo antes de devolver el vehículo. Consulta el manual de servicio del fabricante para pares de apriete y particularidades del modelo.</p>`,
      faq: [
        { q: '¿Hay que cambiar el cedazo al cambiar la bomba de gasolina?', a: 'Sí, siempre. El cedazo tapado hace que la bomba nueva trabaje forzada, entregue menos presión y dure mucho menos. Es una pieza barata y es parte del trabajo bien hecho.' },
        { q: '¿Cómo se alivia la presión antes de cambiar la bomba?', a: 'Quita el fusible o el relé de la bomba de combustible y arranca el motor hasta que se apague solo. Después desconecta el negativo de la batería antes de manipular el conector del módulo.' }
      ]
    },
    {
      slug: 'que-pila-de-gasolina-le-queda-a-mi-carro',
      label: 'Elegir la pila correcta',
      title: 'Qué pila de gasolina le queda a mi carro: cómo elegir la correcta | FuelTech Master',
      description: 'Cómo elegir una pila o bomba de gasolina compatible: presión, flujo LPH, amperaje, medidas físicas, conector y polaridad. Qué mirar antes de comprar una alternativa genérica.',
      h1: 'Qué pila de gasolina le queda a mi carro',
      html: `<p style="color:#B7BFC9">“¿Esta le queda?” es la pregunta que más se escucha en el mostrador de una refaccionaria. La respuesta corta: no basta con que entre. Una pila compatible tiene que coincidir en cinco cosas, y si falla una sola, el trabajo se devuelve.</p>
        <h2 style="font-size:17px;color:#E53935;margin-top:22px">Los cinco criterios</h2>
        <ol style="padding-left:20px">
          <li><strong>Presión de trabajo.</strong> La pila debe sostener el rango que pide el vehículo con margen. Una bomba de 45 PSI en un sistema que exige 58 PSI da síntomas de falla desde el primer día.</li>
          <li><strong>Flujo (LPH).</strong> Litros por hora. Un motor más grande o con mayor demanda necesita más caudal aunque la presión sea la misma. Quedarse corto se nota solo bajo carga: en subida o a alta velocidad.</li>
          <li><strong>Amperaje.</strong> Una pila que consume más de lo que el circuito original fue diseñado para entregar calienta el conector y termina quemándolo. Compara el consumo contra el del original.</li>
          <li><strong>Medidas físicas y montaje.</strong> Diámetro, largo del cuerpo, posición de entrada y salida, y altura total dentro del módulo. Una pila más larga no deja cerrar la tapa; una más corta deja el pickup lejos del fondo y el motor se queda sin combustible con el tanque a un cuarto.</li>
          <li><strong>Conector y polaridad.</strong> Invertir la polaridad daña la bomba de inmediato. Si el conector no es el mismo, hay que confirmar cuál pin es positivo antes de improvisar un adaptador.</li>
        </ol>
        <h2 style="font-size:17px;color:#E53935;margin-top:22px">Original, módulo completo o pila suelta</h2>
        <p style="color:#B7BFC9">Cambiar solo la pila dentro del módulo es más barato y suele ser suficiente. Pero si el módulo tiene el regulador integrado en falla, la carcasa fisurada, el flotador dañado o el conector quemado, el módulo completo sale mejor a la larga. En sistemas <strong>sin retorno</strong>, donde el regulador vive dentro del módulo, muchas veces no hay alternativa.</p>
        <h2 style="font-size:17px;color:#E53935;margin-top:22px">Sobre las equivalencias</h2>
        <p style="color:#B7BFC9">En la ficha de cada vehículo del <a href="/vehiculos" style="color:#E53935">catálogo</a> encontrarás el número de parte original y las alternativas compatibles con su presión, flujo y amperaje. Úsalas como punto de partida y confirma la aplicación con el catálogo del fabricante antes de comprar: los proveedores actualizan aplicaciones y a veces un mismo modelo cambió de bomba a mitad de año de producción.</p>
        <p style="color:#B7BFC9">Y una advertencia práctica: “universal” no significa compatible. Una pila universal puede dar la presión correcta y aun así fallar por medidas, conector o amperaje.</p>`,
      faq: [
        { q: '¿Cómo sé qué bomba de gasolina le queda a mi carro?', a: 'Debe coincidir en presión de trabajo, flujo (LPH), amperaje, medidas físicas de montaje y conector con polaridad correcta. Que entre físicamente no significa que sea compatible.' },
        { q: '¿Es mejor cambiar solo la pila o el módulo completo?', a: 'Cambiar solo la pila es más barato y suele bastar. Conviene el módulo completo si el regulador integrado falla, la carcasa está fisurada, el flotador está dañado o el conector quemado; en sistemas sin retorno a menudo es la única opción.' }
      ]
    }
  ];
  const guideBody = (g) => `<main style="max-width:760px;margin:0 auto;padding:40px 22px;color:#E5E7EB;font-family:Montserrat,system-ui,sans-serif;line-height:1.7">
      <p style="font:700 11px/1 sans-serif;letter-spacing:2px;text-transform:uppercase;color:#979EA7">FuelTech Master · Guía técnica</p>
      <h1 style="font-size:26px;margin:10px 0 16px">${g.h1}</h1>
      ${g.html}
      <p style="margin-top:28px"><a href="/vehiculos" style="color:#E53935;font-weight:700">Busca la presión exacta de tu vehículo →</a></p>
      <p style="margin-top:10px;color:#979EA7">Más guías: ${GUIDES.map(x => `<a href="/guia/${x.slug}" style="color:#979EA7">${x.label}</a>`).join(' · ')}</p>
    </main>`;

  app.get('/guias', async (req, res) => {
    const items = GUIDES.map(g => `<li><a href="/guia/${g.slug}" style="color:#E5E7EB;text-decoration:none">${g.h1}</a></li>`).join('');
    res.set('Cache-Control', 'public, max-age=3600');
    res.type('html').send(renderShell({
      title: 'Guías de diagnóstico del sistema de combustible | FuelTech Master',
      description: 'Guías prácticas para mecánicos: síntomas de una bomba de gasolina fallando, cómo medir la presión de combustible y causas de presión baja.',
      canonicalPath: '/guias', nonce: res.locals.cspNonce,
      rootContent: `<main style="max-width:760px;margin:0 auto;padding:40px 22px;color:#E5E7EB;font-family:Montserrat,system-ui,sans-serif"><h1 style="font-size:24px">Guías de diagnóstico</h1><ul style="line-height:2.2;margin-top:12px;padding-left:18px">${items}</ul></main>`
    }));
  });

  app.get('/guia/:slug', async (req, res, next) => {
    const g = GUIDES.find(x => x.slug === req.params.slug);
    if (!g) return next();
    res.set('Cache-Control', 'public, max-age=3600');
    res.type('html').send(renderShell({
      title: g.title, description: g.description, canonicalPath: '/guia/' + g.slug, nonce: res.locals.cspNonce, rootContent: guideBody(g),
      jsonLd: { '@context': 'https://schema.org', '@type': 'FAQPage', inLanguage: 'es',
        mainEntity: g.faq.map(f => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) }
    }));
  });

  app.get('/sitemap.xml', async (req, res) => {
    const rows = await db.all(`SELECT v.id, b.name AS brand, v.model, v.year_from, v.year_to
      FROM vehicles v JOIN brands b ON b.id = v.brand_id`);
    const locs = [`${BASE_URL}/`, `${BASE_URL}/vehiculos`, `${BASE_URL}/guias`,
      ...PAGES.map(pg => `${BASE_URL}/${pg.slug}`),
      ...GUIDES.map(g => `${BASE_URL}/guia/${g.slug}`),
      ...rows.map(v => `${BASE_URL}/vehiculo/${vehicleSlug(v)}`)];
    res.type('application/xml').set('Cache-Control', 'public, max-age=3600').send(
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
      locs.map(u => `  <url><loc>${esc(u)}</loc></url>`).join('\n') + `\n</urlset>\n`);
  });

  app.get('/robots.txt', async (req, res) => {
    res.type('text/plain').set('Cache-Control', 'public, max-age=3600').send(
      `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /admin\n\nSitemap: ${BASE_URL}/sitemap.xml\n`);
  });

  /* ads.txt — declara ante los compradores de publicidad quién puede vender este
     inventario. Google marca la cuenta como "ads.txt no encontrado" si falta. */
  app.get('/ads.txt', (req, res, next) => {
    if (!ADSENSE_CLIENT) return next();
    res.type('text/plain').set('Cache-Control', 'public, max-age=3600')
      .send(`google.com, ${ADSENSE_CLIENT.replace(/^ca-/, '')}, DIRECT, f08c47fec0942fa0\n`);
  });

  // Panel de administración (protegido por contraseña en el API; ver /api/admin/*)
  app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

  app.use(express.static(path.join(__dirname, 'public'), {
    maxAge: PROD ? '1d' : 0,
    setHeaders: (res, filePath) => {
      if (/\.(glb|png|jpg|webp)$/.test(filePath)) res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
    }
  }));

  // --- Catálogos para filtros ---
  let metaCache = null;
  app.get('/api/meta', catalogLimiter, async (req, res) => {
    if (!metaCache) {
      metaCache = {
        brands: await db.all(`SELECT id, name FROM brands ORDER BY name`, ),
        injection_types: await db.all(`SELECT id, code, name, description FROM injection_types ORDER BY id`, ),
        year_range: await db.get(`SELECT MIN(year_from) min, MAX(year_to) max FROM vehicles`, ),
        total_vehicles: (await db.get(`SELECT COUNT(*) c FROM vehicles`))?.c || 0
      };
    }
    res.set('Cache-Control', 'public, max-age=300');
    res.json(metaCache);
  });

  // --- Buscador ---
  const MAX_PAGE_SIZE = 200;
  app.get('/api/vehicles', async (req, res) => {
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

    const rows = await db.all(`
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
    `, params);

    // Si una búsqueda por modelo no devuelve nada, la registramos: es la mejor
    // señal de qué vehículos agregar al catálogo (demanda real insatisfecha).
    if (rows.length === 0 && typeof model === 'string' && model.trim()) {
      try { await bumpMissing.run(new Date().toISOString().slice(0, 10), model.trim().slice(0, 60).toLowerCase()); }
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
  app.get('/api/vehicles/:id', async (req, res) => {
    const id = toInt(req.params.id, 1, 1e9);
    if (id === null) return res.status(404).json({ error: 'Vehículo no encontrado' });
    const v = await db.get(`
      SELECT v.*, b.name AS brand, it.code AS injection_code, it.name AS injection_name, it.description AS injection_desc
      FROM vehicles v
      JOIN brands b ON b.id = v.brand_id
      JOIN injection_types it ON it.id = v.injection_type_id
      WHERE v.id = ?
    `, id);
    if (!v) return res.status(404).json({ error: 'Vehículo no encontrado' });

    const modules = await db.all(`
      SELECT vm.location_text, vm.location_zone, vm.requires_tank_removal, vm.access_notes,
             m.id, m.code, m.name, m.assembly_type, m.regulated_psi, m.flow_lph, m.regulator_type,
             m.float_type, m.strainer_ref, m.connector_desc, m.lines_desc, m.mount_desc, m.diagram_key
      FROM vehicle_modules vm
      JOIN fuel_modules m ON m.id = vm.module_id
      WHERE vm.vehicle_id = ?
    `, v.id);



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
      modules: await Promise.all(modules.map(async m => ({
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
        compatible_pumps: (await db.all(`SELECT p.*, mp.fitment, mp.is_oem, mp.notes AS fitment_notes FROM module_pumps mp JOIN fuel_pumps p ON p.id = mp.pump_id WHERE mp.module_id = ? ORDER BY mp.is_oem DESC`, m.id)).map(p => ({
          id: p.id, code: p.code, manufacturer: p.manufacturer, pump_style: p.pump_style,
          max_psi_direct: p.max_psi_direct, max_bar_direct: psiToBar(p.max_psi_direct),
          amperage_a: p.amperage_a, voltage_v: p.voltage_v, flow_lph_free: p.flow_lph_free,
          inlet_desc: p.inlet_desc, outlet_desc: p.outlet_desc, polarity_desc: p.polarity_desc,
          diagram_key: p.diagram_key,
          fitment: p.fitment, is_oem: !!p.is_oem, fitment_notes: p.fitment_notes
        }))
      })))
    });
  });

  // --- Comentarios de vehículos ---
  app.get('/api/vehicles/:id/comments', async (req, res) => {
    const vehicle_id = toInt(req.params.id, 1, 1e9);
    if (vehicle_id === null) return res.status(404).json({ error: 'Vehículo no válido' });
    const rows = await db.all(`
      SELECT id, parent_id, author_name, content, created_at
      FROM vehicle_comments
      WHERE vehicle_id = ?
      ORDER BY created_at ASC
    `, [vehicle_id]);
    res.json(rows);
  });

  app.post('/api/vehicles/:id/comments', async (req, res) => {
    const vehicle_id = toInt(req.params.id, 1, 1e9);
    if (vehicle_id === null) return res.status(404).json({ error: 'Vehículo no válido' });
    const { author_name, content, parent_id } = req.body;
    
    if (!author_name || !content || typeof author_name !== 'string' || typeof content !== 'string') {
      return res.status(400).json({ error: 'Nombre y mensaje son requeridos' });
    }
    const name = author_name.trim().slice(0, 50);
    const msg = content.trim().slice(0, 1000);
    if (!name || !msg) return res.status(400).json({ error: 'Nombre y mensaje son requeridos' });

    let pId = toInt(parent_id, 1, 1e9);
    if (pId !== null) {
      const parent = await db.get('SELECT id FROM vehicle_comments WHERE id = ? AND vehicle_id = ?', [pId, vehicle_id]);
      if (!parent) pId = null;
    }

    try {
      const id = await db.insertReturningId(`
        INSERT INTO vehicle_comments (vehicle_id, parent_id, author_name, content)
        VALUES (?, ?, ?, ?)
      `, [vehicle_id, pId, name, msg]);
      
      const newComment = await db.get(`SELECT id, parent_id, author_name, content, created_at FROM vehicle_comments WHERE id = ?`, [id]);
      res.json(newComment);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Error al guardar comentario' });
    }
  });

  // --- Catálogo de módulos ---
  app.get('/api/modules', catalogLimiter, async (req, res) => {
    const limit = toInt(req.query.limit, 1, MAX_PAGE_SIZE) ?? MAX_PAGE_SIZE;
    const offset = toInt(req.query.offset, 0, 10000) ?? 0;
    const rows = await db.all(`
      SELECT m.id, m.code, m.name, m.assembly_type, m.regulated_psi, m.flow_lph, m.regulator_type, m.diagram_key,
             v.id AS vehicle_id, b.name AS brand, v.model, v.year_from, v.year_to
      FROM fuel_modules m
      JOIN vehicle_modules vm ON vm.module_id = m.id
      JOIN vehicles v ON v.id = vm.vehicle_id
      JOIN brands b ON b.id = v.brand_id
      ORDER BY b.name, v.model, v.year_from
      LIMIT @limit OFFSET @offset
    `, { limit, offset });
    res.json(rows.map(r => ({ ...r, regulated_bar: psiToBar(r.regulated_psi) })));
  });

  app.get('/api/modules/:id', async (req, res) => {
    const m = await db.get(`SELECT * FROM fuel_modules WHERE id = ?`, toInt(req.params.id, 1, 1e9));
    if (!m) return res.status(404).json({ error: 'Módulo no encontrado' });
    res.json({ ...m, regulated_bar: psiToBar(m.regulated_psi) });
  });

  // --- Catálogo de pilas ---
  let pumpsCache = null;
  app.get('/api/pumps', catalogLimiter, async (req, res) => {
    if (!pumpsCache) {
      // .map() va sobre la fila resuelta, no sobre la promesa: sin los paréntesis
      // esto lanzaba TypeError dentro del handler async y la petición quedaba colgada.
      pumpsCache = (await db.all(`SELECT * FROM fuel_pumps ORDER BY manufacturer, code`))
        .map(p => ({ ...p, max_bar_direct: psiToBar(p.max_psi_direct) }));
    }
    res.set('Cache-Control', 'public, max-age=300');
    res.json(pumpsCache);
  });

  app.get('/api/pumps/:id', async (req, res) => {
    const p = await db.get(`SELECT * FROM fuel_pumps WHERE id = ?`, toInt(req.params.id, 1, 1e9));
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
    )
  `);
  const getChatCount = { get: async (day, device_id) => statsDb.get(`SELECT count FROM chat_limits WHERE day = ? AND device_id = ?`, [day, device_id]) };
  const bumpChatCount = { run: async (day, device_id) => statsDb.run(`
    INSERT INTO chat_limits (day, device_id, count) VALUES (?, ?, 1)
    ON CONFLICT(day, device_id) DO UPDATE SET count = count + 1
  `, [day, device_id]) };

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
      if (((await getChatCount.get(day, ipCapKey))?.count || 0) >= IP_DAILY_CEILING) {
        return res.json({
          response: '', remaining: 0, limitReached: true,
          message: 'Se alcanzó el límite diario de consultas desde esta red. Vuelve mañana o explora el catálogo directamente.'
        });
      }
      const row = await getChatCount.get(day, actualDeviceId);
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
          const v = await db.get(`SELECT v.model, b.name AS brand, v.year_from, v.year_to, v.engine, it.name AS injection, v.rail_pressure_psi_min, v.rail_pressure_psi_max FROM vehicles v JOIN brands b ON b.id = v.brand_id JOIN injection_types it ON it.id = v.injection_type_id WHERE v.id = ?`, vId);
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

      await bumpChatCount.run(day, actualDeviceId);
      await bumpChatCount.run(day, ipCapKey);

      res.json({ response, remaining: remaining > 0 ? remaining - 1 : 0 });
    } catch (err) {
      console.error('Gemini API error:', err.message || err);
      res.status(502).json({ error: 'Error al comunicar con la IA. Intenta de nuevo.' });
    }
  });

  /* ---------- Panel de administración (carga de datos sin editar seed.js) ----------
     Autenticación: contraseña (ADMIN_PASSWORD) → token HMAC firmado con expiración.
     Si ADMIN_PASSWORD no está definida, todo el panel responde 503 (desactivado). */
  const BODY_TYPES = ['sedan', 'hatchback', 'pickup', 'suv', 'van'];
  const ZONES = ['rear_seat', 'tank_drop', 'trunk_access', 'frame_rail'];
  const ASSEMBLY = ['external', 'hanger_tbi', 'hanger_return', 'module_returnless', 'vortec', 'gdi_low'];
  const str = (x, max = 500) => (typeof x === 'string' ? x.trim().slice(0, max) : '');
  const num = (x) => (Number.isFinite(Number(x)) && x !== '' && x !== null ? Number(x) : null);

  const adminLimiter = rateLimit({ windowMs: 60_000, limit: 40, standardHeaders: true, legacyHeaders: false });
  const requireAdmin = (req, res, next) => {
    if (!ADMIN_PASSWORD) return res.status(503).json({ error: 'Panel no configurado. Define la variable ADMIN_PASSWORD.' });
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!verifyAdminToken(token)) return res.status(401).json({ error: 'No autorizado' });
    next();
  };

  app.post('/api/admin/login', adminLimiter, async (req, res) => {
    if (!ADMIN_PASSWORD) return res.status(503).json({ error: 'Panel no configurado. Define la variable ADMIN_PASSWORD.' });
    const pass = typeof req.body?.password === 'string' ? req.body.password : '';
    const a = Buffer.from(pass), b = Buffer.from(ADMIN_PASSWORD);
    const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
    if (!ok) return res.status(401).json({ error: 'Contraseña incorrecta' });
    res.set('Cache-Control', 'no-store').json({ token: signAdminToken() });
  });

  app.get('/api/admin/bootstrap', requireAdmin, async (req, res) => {
    res.set('Cache-Control', 'no-store').json({
      brands: await db.all('SELECT id, name FROM brands ORDER BY name', ),
      injection_types: await db.all('SELECT id, code, name FROM injection_types ORDER BY id', ),
      pumps: await db.all('SELECT id, code, manufacturer FROM fuel_pumps ORDER BY manufacturer, code', ),
      enums: { body_types: BODY_TYPES, zones: ZONES, assembly: ASSEMBLY },
      counts: {
        vehicles: (await db.get('SELECT COUNT(*) c FROM vehicles'))?.c || 0,
        brands: (await db.get('SELECT COUNT(*) c FROM brands'))?.c || 0,
        pumps: (await db.get('SELECT COUNT(*) c FROM fuel_pumps'))?.c || 0,
        unverified: (await db.get('SELECT COUNT(*) c FROM vehicles WHERE data_verified = 0'))?.c || 0
      }
    });
  });

  app.get('/api/admin/vehicles', requireAdmin, async (req, res) => {
    const q = str(req.query.q, 60);
    const rows = await db.all(`
      SELECT v.id, b.name AS brand, v.model, v.year_from, v.year_to, v.engine, v.data_verified
      FROM vehicles v JOIN brands b ON b.id = v.brand_id
      ${q ? "WHERE v.model LIKE @q OR b.name LIKE @q" : ''}
      ORDER BY b.name, v.model, v.year_from LIMIT 1000
    `, q ? { q: `%${q.replace(/[%_\\]/g, '\\$&')}%` } : {});
    res.set('Cache-Control', 'no-store').json(rows.map(r => ({ ...r, data_verified: !!r.data_verified })));
  });

  app.get('/api/admin/vehicles/:id', requireAdmin, async (req, res) => {
    const id = toInt(req.params.id, 1, 1e9);
    const vehicle = await db.get('SELECT * FROM vehicles WHERE id = ?', id);
    if (!vehicle) return res.status(404).json({ error: 'No encontrado' });
    const link = await db.get('SELECT * FROM vehicle_modules WHERE vehicle_id = ?', id);
    const module = link ? await db.get('SELECT * FROM fuel_modules WHERE id = ?', link.module_id) : null;
    const pumps = link ? await db.all('SELECT pump_id, is_oem, fitment FROM module_pumps WHERE module_id = ?', link.module_id) : [];
    res.set('Cache-Control', 'no-store').json({ vehicle, link, module, pumps });
  });

  function buildPayload(body) {
    const b = body || {};
    const brand_id = toInt(b.brand_id, 1, 1e9);
    const injection_type_id = toInt(b.injection_type_id, 1, 1e9);
    const year_from = toInt(b.year_from, 1900, 2100);
    const year_to = toInt(b.year_to, 1900, 2100);
    const model = str(b.model, 80), engine = str(b.engine, 80);
    const psimin = num(b.rail_pressure_psi_min), psimax = num(b.rail_pressure_psi_max);
    if (!brand_id) throw new Error('Marca requerida');
    if (!injection_type_id) throw new Error('Tipo de inyección requerido');
    if (!model) throw new Error('Modelo requerido');
    if (!engine) throw new Error('Motor requerido');
    if (year_from === null || year_to === null || year_to < year_from) throw new Error('Rango de años inválido');
    if (psimin === null || psimax === null || psimax < psimin) throw new Error('Presiones de riel inválidas');
    const m = b.module || {};
    const module = {
      code: str(m.code, 60), name: str(m.name, 120),
      assembly_type: ASSEMBLY.includes(m.assembly_type) ? m.assembly_type : 'module_returnless',
      regulated_psi: num(m.regulated_psi), flow_lph: num(m.flow_lph),
      regulator_type: str(m.regulator_type, 120) || null, float_type: str(m.float_type, 120) || null,
      strainer_ref: str(m.strainer_ref, 120) || null, connector_desc: str(m.connector_desc, 160) || null,
      lines_desc: str(m.lines_desc, 160) || null, mount_desc: str(m.mount_desc, 160) || null,
      diagram_key: str(m.diagram_key, 60) || 'module_generic'
    };
    if (!module.code) throw new Error('Código del módulo requerido');
    if (!module.name) throw new Error('Nombre del módulo requerido');
    if (module.regulated_psi === null) throw new Error('Presión regulada del módulo requerida');
    if (module.flow_lph === null) throw new Error('Flujo del módulo requerido');
    const l = b.link || {};
    const link = {
      location_text: str(l.location_text, 300),
      location_zone: ZONES.includes(l.location_zone) ? l.location_zone : 'tank_drop',
      requires_tank_removal: l.requires_tank_removal ? 1 : 0,
      access_notes: str(l.access_notes, 300) || null
    };
    if (!link.location_text) throw new Error('Ubicación del módulo requerida');
    const pumps = Array.isArray(b.pumps)
      ? b.pumps.map(p => ({ pump_id: toInt(p.pump_id, 1, 1e9), is_oem: p.is_oem ? 1 : 0, fitment: str(p.fitment, 40) || 'directa' })).filter(p => p.pump_id)
      : [];
    return {
      vehicle: { brand_id, model, year_from, year_to, engine, body_type: BODY_TYPES.includes(b.body_type) ? b.body_type : 'sedan', injection_type_id, rail_pressure_psi_min: psimin, rail_pressure_psi_max: psimax, notes: str(b.notes, 500) || null, data_verified: b.data_verified ? 1 : 0 },
      module, link, pumps
    };
  }

  const insModule = async (d) => db.insertReturningId(`INSERT INTO fuel_modules
    (code,name,assembly_type,regulated_psi,flow_lph,regulator_type,float_type,strainer_ref,connector_desc,lines_desc,mount_desc,diagram_key)
    VALUES (@code,@name,@assembly_type,@regulated_psi,@flow_lph,@regulator_type,@float_type,@strainer_ref,@connector_desc,@lines_desc,@mount_desc,@diagram_key)`, d);

  const createVehicle = async (d) => { await db.exec('BEGIN'); try {
    const module_id = await insModule(d.module);
    const vehicle_id = await db.insertReturningId(`INSERT INTO vehicles
      (brand_id,model,year_from,year_to,engine,body_type,injection_type_id,rail_pressure_psi_min,rail_pressure_psi_max,notes,data_verified)
      VALUES (@brand_id,@model,@year_from,@year_to,@engine,@body_type,@injection_type_id,@rail_pressure_psi_min,@rail_pressure_psi_max,@notes,@data_verified)`, d.vehicle);
    await db.run(`INSERT INTO vehicle_modules (vehicle_id,module_id,location_text,location_zone,requires_tank_removal,access_notes)
      VALUES (?,?,?,?,?,?)`, [vehicle_id, module_id, d.link.location_text, d.link.location_zone, d.link.requires_tank_removal, d.link.access_notes]);
    const insPump = { run: async (m, p, i, f) => db.run('INSERT OR IGNORE INTO module_pumps (module_id,pump_id,is_oem,fitment) VALUES (?,?,?,?)', [m, p, i, f]) };
    for (const p of d.pumps) await insPump.run(module_id, p.pump_id, p.is_oem, p.fitment);
    await db.exec('COMMIT'); return vehicle_id; } catch(e) { await db.exec('ROLLBACK'); throw e; } };

  const updateVehicle = async (id, d) => { await db.exec('BEGIN'); try {
    await db.run(`UPDATE vehicles SET brand_id=@brand_id,model=@model,year_from=@year_from,year_to=@year_to,engine=@engine,body_type=@body_type,injection_type_id=@injection_type_id,rail_pressure_psi_min=@rail_pressure_psi_min,rail_pressure_psi_max=@rail_pressure_psi_max,notes=@notes,data_verified=@data_verified WHERE id=@id`, { ...d.vehicle, id });
    let link = await db.get('SELECT module_id FROM vehicle_modules WHERE vehicle_id = ?', [id]);
    let module_id = link?.module_id;
    if (module_id) {
      await db.run(`UPDATE fuel_modules SET code=@code,name=@name,assembly_type=@assembly_type,regulated_psi=@regulated_psi,flow_lph=@flow_lph,regulator_type=@regulator_type,float_type=@float_type,strainer_ref=@strainer_ref,connector_desc=@connector_desc,lines_desc=@lines_desc,mount_desc=@mount_desc,diagram_key=@diagram_key WHERE id=@id`, { ...d.module, id: module_id });
      await db.run('UPDATE vehicle_modules SET location_text=?,location_zone=?,requires_tank_removal=?,access_notes=? WHERE vehicle_id=?', [d.link.location_text, d.link.location_zone, d.link.requires_tank_removal, d.link.access_notes, id]);
    } else {
      module_id = await insModule(d.module);
      await db.run('INSERT INTO vehicle_modules (vehicle_id,module_id,location_text,location_zone,requires_tank_removal,access_notes) VALUES (?,?,?,?,?,?)', [id, module_id, d.link.location_text, d.link.location_zone, d.link.requires_tank_removal, d.link.access_notes]);
    }
    await db.run('DELETE FROM module_pumps WHERE module_id = ?', [module_id]);
    const insPump = { run: async (m, p, i, f) => db.run('INSERT OR IGNORE INTO module_pumps (module_id,pump_id,is_oem,fitment) VALUES (?,?,?,?)', [m, p, i, f]) };
    for (const p of d.pumps) await insPump.run(module_id, p.pump_id, p.is_oem, p.fitment);
    await db.exec('COMMIT'); } catch(e) { await db.exec('ROLLBACK'); throw e; } };

  app.post('/api/admin/vehicles', requireAdmin, async (req, res) => {
    try {
      const d = buildPayload(req.body);
      const id = createVehicle(d);
      metaCache = null; pumpsCache = null;
      res.json({ id });
    } catch (e) { res.status(400).json({ error: e.message || 'Datos inválidos (¿código de módulo duplicado?)' }); }
  });

  app.put('/api/admin/vehicles/:id', requireAdmin, async (req, res) => {
    const id = toInt(req.params.id, 1, 1e9);
    if (!await db.get('SELECT 1 FROM vehicles WHERE id = ?', id)) return res.status(404).json({ error: 'No encontrado' });
    try {
      const d = buildPayload(req.body);
      updateVehicle(id, d);
      metaCache = null; pumpsCache = null;
      res.json({ id });
    } catch (e) { res.status(400).json({ error: e.message || 'Datos inválidos' }); }
  });

  app.delete('/api/admin/vehicles/:id', requireAdmin, async (req, res) => {
    const id = toInt(req.params.id, 1, 1e9);
    const link = await db.get('SELECT module_id FROM vehicle_modules WHERE vehicle_id = ?', id);
    await db.exec('BEGIN'); try {
      await db.run('DELETE FROM vehicles WHERE id = ?', id); // vehicle_modules cae por ON DELETE CASCADE
      if (link?.module_id) {
        const used = (await db.get('SELECT COUNT(*) c FROM vehicle_modules WHERE module_id = ?', [link.module_id]))?.c;
        if (used === 0) {
          await db.run('DELETE FROM module_pumps WHERE module_id = ?', [link.module_id]);
          await db.run('DELETE FROM fuel_modules WHERE id = ?', [link.module_id]);
        }
      }
      await db.exec('COMMIT'); } catch(e) { await db.exec('ROLLBACK'); throw e; }
    
    metaCache = null;
    res.json({ ok: true });
  });

  app.post('/api/admin/vehicles/:id/verify', requireAdmin, async (req, res) => {
    const id = toInt(req.params.id, 1, 1e9);
    const info = await db.run('UPDATE vehicles SET data_verified = ? WHERE id = ?', req.body?.data_verified ? 1 : 0, id);
    if (!info.changes) return res.status(404).json({ error: 'No encontrado' });
    res.json({ ok: true });
  });

  app.post('/api/admin/brands', requireAdmin, async (req, res) => {
    const name = str(req.body?.name, 60);
    if (!name) return res.status(400).json({ error: 'Nombre requerido' });
    const existing = await db.get('SELECT id, name FROM brands WHERE name = ?', name);
    if (existing) return res.json(existing);
    const info = await db.run('INSERT INTO brands (name) VALUES (?)', name);
    metaCache = null;
    res.json({ id: info.lastInsertRowid, name });
  });

  app.post('/api/admin/pumps', requireAdmin, async (req, res) => {
    const b = req.body || {};
    const pump = {
      code: str(b.code, 60), manufacturer: str(b.manufacturer, 60), pump_style: str(b.pump_style, 40) || 'turbina',
      max_psi_direct: num(b.max_psi_direct), amperage_a: num(b.amperage_a), voltage_v: num(b.voltage_v) || 12,
      flow_lph_free: num(b.flow_lph_free), inlet_desc: str(b.inlet_desc, 120) || null, outlet_desc: str(b.outlet_desc, 120) || null,
      polarity_desc: str(b.polarity_desc, 120) || null, diagram_key: str(b.diagram_key, 60) || 'pump_generic'
    };
    if (!pump.code || !pump.manufacturer) return res.status(400).json({ error: 'Código y fabricante requeridos' });
    if (pump.max_psi_direct === null || pump.amperage_a === null) return res.status(400).json({ error: 'Presión máx. y amperaje requeridos' });
    try {
      const info = await db.run(`INSERT INTO fuel_pumps (code,manufacturer,pump_style,max_psi_direct,amperage_a,voltage_v,flow_lph_free,inlet_desc,outlet_desc,polarity_desc,diagram_key)
        VALUES (@code,@manufacturer,@pump_style,@max_psi_direct,@amperage_a,@voltage_v,@flow_lph_free,@inlet_desc,@outlet_desc,@polarity_desc,@diagram_key)`, [pump]);
      pumpsCache = null;
      res.json({ id: info.lastInsertRowid });
    } catch (e) { res.status(400).json({ error: 'Código de pila duplicado o inválido' }); }
  });

  app.get('/api/admin/missing', requireAdmin, async (req, res) => {
    const rows = await statsDb.all('SELECT q, SUM(count) veces FROM missing_searches GROUP BY q ORDER BY veces DESC, q LIMIT 100', );
    res.set('Cache-Control', 'no-store').json(rows);
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
  (async () => {
    try {
      const statsDb = defaultStatsDb;
      await statsDb.exec(`
        CREATE TABLE IF NOT EXISTS visit_days (
          day          TEXT NOT NULL,
          visitor_hash TEXT NOT NULL,
          PRIMARY KEY (day, visitor_hash)
        );
        CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS chat_limits (
          day TEXT NOT NULL,
          device_id TEXT NOT NULL,
          count INTEGER NOT NULL,
          PRIMARY KEY (day, device_id)
        );
        CREATE TABLE IF NOT EXISTS missing_searches (
          day TEXT NOT NULL,
          q TEXT NOT NULL,
          count INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (day, q)
        );
      `);
      await statsDb.run(`DELETE FROM visit_days WHERE day < date('now', '-90 days')`);
      
      const app = await createApp();
      const PORT = process.env.PORT || 3000;
      const server = app.listen(PORT, () => console.log(`FuelTech Master corriendo en http://localhost:${PORT}`));

      process.on('SIGTERM', () => { server.close(() => { process.exit(0); }); });
    } catch (err) {
      console.error('❌ Error fatal al arrancar el servidor:', err);
      process.exit(1);
    }
  })();
}

module.exports = { createApp, toInt, psiToBar };
