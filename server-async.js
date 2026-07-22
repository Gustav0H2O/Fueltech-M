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

/* Google Analytics 4. Configurable; vacío = desactivado (y no se toca la CSP). */
const GA_ID = process.env.GA_MEASUREMENT_ID || 'G-MXGS03FKB0';

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
          (req, res) => `'nonce-${res.locals.cspNonce}'`,
          ...(GA_ID ? ['https://www.googletagmanager.com'] : [])
        ],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:', ...(GA_ID ? ['https://www.googletagmanager.com', 'https://*.google-analytics.com'] : [])],
        connectSrc: ["'self'", ...(GA_ID ? ['https://www.googletagmanager.com', 'https://*.google-analytics.com', 'https://*.analytics.google.com'] : [])],
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
      html = html.replace(/<!--ROOT-CONTENT-START-->[\s\S]*?<!--ROOT-CONTENT-END-->/,
        `<!--ROOT-CONTENT-START-->${rootContent}<!--ROOT-CONTENT-END-->`);
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
    PRIMARY KEY (day, q)) WITHOUT ROWID`);
  const bumpMissing = statsDb.prepare(`INSERT INTO missing_searches (day, q, count) VALUES (?, ?, 1)
    ON CONFLICT(day, q) DO UPDATE SET count = count + 1`);

  const vehicleForPage = db.prepare(`
    SELECT v.id, b.name AS brand, v.model, v.year_from, v.year_to, v.engine,
           it.name AS injection_name, v.rail_pressure_psi_min, v.rail_pressure_psi_max, v.notes
    FROM vehicles v JOIN brands b ON b.id = v.brand_id
    JOIN injection_types it ON it.id = v.injection_type_id WHERE v.id = ?`);

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

    // Enlaces internos a otros modelos de la misma marca: más páginas por sesión y mejor rastreo (SEO)
    const related = db.prepare(`SELECT v.id, b.name AS brand, v.model, v.year_from, v.year_to
      FROM vehicles v JOIN brands b ON b.id = v.brand_id
      WHERE v.brand_id = (SELECT brand_id FROM vehicles WHERE id = ?) AND v.id != ?
      ORDER BY v.model, v.year_from LIMIT 8`).all(v.id, v.id);
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
    const rows = db.prepare(`SELECT v.id, b.name AS brand, v.model, v.year_from, v.year_to
      FROM vehicles v JOIN brands b ON b.id = v.brand_id`).all();
    const locs = [`${BASE_URL}/`, `${BASE_URL}/vehiculos`, `${BASE_URL}/guias`,
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
  app.get('/api/vehicles/:id', async (req, res) => {
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
  app.get('/api/modules', catalogLimiter, async (req, res) => {
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

  app.get('/api/modules/:id', async (req, res) => {
    const m = db.prepare(`SELECT * FROM fuel_modules WHERE id = ?`).get(toInt(req.params.id, 1, 1e9));
    if (!m) return res.status(404).json({ error: 'Módulo no encontrado' });
    res.json({ ...m, regulated_bar: psiToBar(m.regulated_psi) });
  });

  // --- Catálogo de pilas ---
  let pumpsCache = null;
  app.get('/api/pumps', catalogLimiter, async (req, res) => {
    if (!pumpsCache) {
      pumpsCache = db.prepare(`SELECT * FROM fuel_pumps ORDER BY manufacturer, code`).all()
        .map(p => ({ ...p, max_bar_direct: psiToBar(p.max_psi_direct) }));
    }
    res.set('Cache-Control', 'public, max-age=300');
    res.json(pumpsCache);
  });

  app.get('/api/pumps/:id', async (req, res) => {
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
      brands: db.prepare('SELECT id, name FROM brands ORDER BY name').all(),
      injection_types: db.prepare('SELECT id, code, name FROM injection_types ORDER BY id').all(),
      pumps: db.prepare('SELECT id, code, manufacturer FROM fuel_pumps ORDER BY manufacturer, code').all(),
      enums: { body_types: BODY_TYPES, zones: ZONES, assembly: ASSEMBLY },
      counts: {
        vehicles: db.prepare('SELECT COUNT(*) c FROM vehicles').get().c,
        brands: db.prepare('SELECT COUNT(*) c FROM brands').get().c,
        pumps: db.prepare('SELECT COUNT(*) c FROM fuel_pumps').get().c,
        unverified: db.prepare('SELECT COUNT(*) c FROM vehicles WHERE data_verified = 0').get().c
      }
    });
  });

  app.get('/api/admin/vehicles', requireAdmin, async (req, res) => {
    const q = str(req.query.q, 60);
    const rows = db.prepare(`
      SELECT v.id, b.name AS brand, v.model, v.year_from, v.year_to, v.engine, v.data_verified
      FROM vehicles v JOIN brands b ON b.id = v.brand_id
      ${q ? "WHERE v.model LIKE @q OR b.name LIKE @q" : ''}
      ORDER BY b.name, v.model, v.year_from LIMIT 1000
    `).all(q ? { q: `%${q.replace(/[%_\\]/g, '\\$&')}%` } : {});
    res.set('Cache-Control', 'no-store').json(rows.map(r => ({ ...r, data_verified: !!r.data_verified })));
  });

  app.get('/api/admin/vehicles/:id', requireAdmin, async (req, res) => {
    const id = toInt(req.params.id, 1, 1e9);
    const vehicle = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(id);
    if (!vehicle) return res.status(404).json({ error: 'No encontrado' });
    const link = db.prepare('SELECT * FROM vehicle_modules WHERE vehicle_id = ?').get(id);
    const module = link ? db.prepare('SELECT * FROM fuel_modules WHERE id = ?').get(link.module_id) : null;
    const pumps = link ? db.prepare('SELECT pump_id, is_oem, fitment FROM module_pumps WHERE module_id = ?').all(link.module_id) : [];
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

  const insModule = () => db.prepare(`INSERT INTO fuel_modules
    (code,name,assembly_type,regulated_psi,flow_lph,regulator_type,float_type,strainer_ref,connector_desc,lines_desc,mount_desc,diagram_key)
    VALUES (@code,@name,@assembly_type,@regulated_psi,@flow_lph,@regulator_type,@float_type,@strainer_ref,@connector_desc,@lines_desc,@mount_desc,@diagram_key)`);

  const createVehicle = db.transaction((d) => {
    const module_id = insModule().run(d.module).lastInsertRowid;
    const vehicle_id = db.prepare(`INSERT INTO vehicles
      (brand_id,model,year_from,year_to,engine,body_type,injection_type_id,rail_pressure_psi_min,rail_pressure_psi_max,notes,data_verified)
      VALUES (@brand_id,@model,@year_from,@year_to,@engine,@body_type,@injection_type_id,@rail_pressure_psi_min,@rail_pressure_psi_max,@notes,@data_verified)`).run(d.vehicle).lastInsertRowid;
    db.prepare(`INSERT INTO vehicle_modules (vehicle_id,module_id,location_text,location_zone,requires_tank_removal,access_notes)
      VALUES (?,?,?,?,?,?)`).run(vehicle_id, module_id, d.link.location_text, d.link.location_zone, d.link.requires_tank_removal, d.link.access_notes);
    const insPump = db.prepare('INSERT OR IGNORE INTO module_pumps (module_id,pump_id,is_oem,fitment) VALUES (?,?,?,?)');
    for (const p of d.pumps) insPump.run(module_id, p.pump_id, p.is_oem, p.fitment);
    return vehicle_id;
  });

  const updateVehicle = db.transaction((id, d) => {
    db.prepare(`UPDATE vehicles SET brand_id=@brand_id,model=@model,year_from=@year_from,year_to=@year_to,engine=@engine,body_type=@body_type,injection_type_id=@injection_type_id,rail_pressure_psi_min=@rail_pressure_psi_min,rail_pressure_psi_max=@rail_pressure_psi_max,notes=@notes,data_verified=@data_verified WHERE id=@id`).run({ ...d.vehicle, id });
    let link = db.prepare('SELECT module_id FROM vehicle_modules WHERE vehicle_id = ?').get(id);
    let module_id = link?.module_id;
    if (module_id) {
      db.prepare(`UPDATE fuel_modules SET code=@code,name=@name,assembly_type=@assembly_type,regulated_psi=@regulated_psi,flow_lph=@flow_lph,regulator_type=@regulator_type,float_type=@float_type,strainer_ref=@strainer_ref,connector_desc=@connector_desc,lines_desc=@lines_desc,mount_desc=@mount_desc,diagram_key=@diagram_key WHERE id=@id`).run({ ...d.module, id: module_id });
      db.prepare('UPDATE vehicle_modules SET location_text=?,location_zone=?,requires_tank_removal=?,access_notes=? WHERE vehicle_id=?').run(d.link.location_text, d.link.location_zone, d.link.requires_tank_removal, d.link.access_notes, id);
    } else {
      module_id = insModule().run(d.module).lastInsertRowid;
      db.prepare('INSERT INTO vehicle_modules (vehicle_id,module_id,location_text,location_zone,requires_tank_removal,access_notes) VALUES (?,?,?,?,?,?)').run(id, module_id, d.link.location_text, d.link.location_zone, d.link.requires_tank_removal, d.link.access_notes);
    }
    db.prepare('DELETE FROM module_pumps WHERE module_id = ?').run(module_id);
    const insPump = db.prepare('INSERT OR IGNORE INTO module_pumps (module_id,pump_id,is_oem,fitment) VALUES (?,?,?,?)');
    for (const p of d.pumps) insPump.run(module_id, p.pump_id, p.is_oem, p.fitment);
  });

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
    if (!db.prepare('SELECT 1 FROM vehicles WHERE id = ?').get(id)) return res.status(404).json({ error: 'No encontrado' });
    try {
      const d = buildPayload(req.body);
      updateVehicle(id, d);
      metaCache = null; pumpsCache = null;
      res.json({ id });
    } catch (e) { res.status(400).json({ error: e.message || 'Datos inválidos' }); }
  });

  app.delete('/api/admin/vehicles/:id', requireAdmin, async (req, res) => {
    const id = toInt(req.params.id, 1, 1e9);
    const link = db.prepare('SELECT module_id FROM vehicle_modules WHERE vehicle_id = ?').get(id);
    const del = db.transaction(() => {
      db.prepare('DELETE FROM vehicles WHERE id = ?').run(id); // vehicle_modules cae por ON DELETE CASCADE
      if (link?.module_id) {
        const used = db.prepare('SELECT COUNT(*) c FROM vehicle_modules WHERE module_id = ?').get(link.module_id).c;
        if (used === 0) {
          db.prepare('DELETE FROM module_pumps WHERE module_id = ?').run(link.module_id);
          db.prepare('DELETE FROM fuel_modules WHERE id = ?').run(link.module_id);
        }
      }
    });
    del();
    metaCache = null;
    res.json({ ok: true });
  });

  app.post('/api/admin/vehicles/:id/verify', requireAdmin, async (req, res) => {
    const id = toInt(req.params.id, 1, 1e9);
    const info = db.prepare('UPDATE vehicles SET data_verified = ? WHERE id = ?').run(req.body?.data_verified ? 1 : 0, id);
    if (!info.changes) return res.status(404).json({ error: 'No encontrado' });
    res.json({ ok: true });
  });

  app.post('/api/admin/brands', requireAdmin, async (req, res) => {
    const name = str(req.body?.name, 60);
    if (!name) return res.status(400).json({ error: 'Nombre requerido' });
    const existing = db.prepare('SELECT id, name FROM brands WHERE name = ?').get(name);
    if (existing) return res.json(existing);
    const info = db.prepare('INSERT INTO brands (name) VALUES (?)').run(name);
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
      const info = db.prepare(`INSERT INTO fuel_pumps (code,manufacturer,pump_style,max_psi_direct,amperage_a,voltage_v,flow_lph_free,inlet_desc,outlet_desc,polarity_desc,diagram_key)
        VALUES (@code,@manufacturer,@pump_style,@max_psi_direct,@amperage_a,@voltage_v,@flow_lph_free,@inlet_desc,@outlet_desc,@polarity_desc,@diagram_key)`).run(pump);
      pumpsCache = null;
      res.json({ id: info.lastInsertRowid });
    } catch (e) { res.status(400).json({ error: 'Código de pila duplicado o inválido' }); }
  });

  app.get('/api/admin/missing', requireAdmin, async (req, res) => {
    const rows = statsDb.prepare('SELECT q, SUM(count) veces FROM missing_searches GROUP BY q ORDER BY veces DESC, q LIMIT 100').all();
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
