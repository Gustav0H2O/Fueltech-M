/* FuelTech Master — Micro Apps (dashboard del taller)
   Cargado ANTES de app.js. Expone window.FT_MICRO con todas las micro apps.
   Patrón: mismas globales que app.js (React, htm, Icon/MarkIcon via window). */
(function () {
  const { useState, useEffect, useRef } = React;
  const html = htm.bind(React.createElement);

  /* ---------- helpers ---------- */
  const ls = {
    get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (e) { return d; } },
    set(k, v) { localStorage.setItem(k, JSON.stringify(v)); },
  };
  const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
  const now = () => new Date().toLocaleString('es', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  /* Icono: usa el MarkIcon de app.js si existe, si no, emoji fallback */
  const Ic = ({ n, s = 16, c }) => {
    if (window.FT_APP && window.FT_APP.MarkIcon) return html`<${window.FT_APP.MarkIcon} name=${n} size=${s} />`;
    return null;
  };

  /* ---------- shell de micro app (header con volver) ---------- */
  const MicroShell = ({ title, icon, onBack, children }) => html`
    <div class="micro-shell panel">
      <div class="micro-shell-head">
        <button type="button" class="micro-back" onClick=${onBack} aria-label="Volver al inicio"><${Ic} n="ChevronLeft" s=${16} /></button>
        <${Ic} n=${icon} s=${18} />
        <h2>${title}</h2>
      </div>
      <div class="micro-shell-body">${children}</div>
    </div>`;

  /* ---------- datos estáticos ---------- */
  const DTCS = [
    ['P0100', 'Falla circuito sensor MAF', 'Sensor de flujo de aire sucio o sin señal; verificar conector, tierra y limpieza.'],
    ['P0101', 'MAF fuera de rango', 'Sensor MAF sucio, fuga de aire tras el sensor o restricción de admisión.'],
    ['P0106', 'Sensor MAP fuera de rango', 'Manguera de vacío rota/tapada, sensor MAP fallando o restricción de vacío.'],
    ['P0113', 'Sensor IAT voltaje alto', 'Conector IAT abierto, sensor desconectado o cable cortado.'],
    ['P0117', 'Sensor ECT voltaje bajo', 'Sensor de temperatura corto a tierra; causa mezcla rica y consumo alto.'],
    ['P0118', 'Sensor ECT voltaje alto', 'Sensor de temperatura abierto; la ECU cree que el motor está frío.'],
    ['P0120', 'Sensor TPS señal', 'Sensor de posición del acelerador fallando o mal calibrado.'],
    ['P0128', 'Termostato / no alcanza temperatura', 'Termostato pegado abierto o sensor ECT con lectura baja.'],
    ['P0130', 'Sensor O2 (banco 1) circuito', 'Sensor de oxígeno sucio, viejo o con calentador dañado.'],
    ['P0134', 'Sensor O2 sin actividad', 'Sensor de oxígeno sin señal: cableado, calentador o sensor muerto.'],
    ['P0171', 'Mezcla pobre (banco 1)', 'Fuga de vacío, MAF sucio, presión de combustible baja o inyector tapado.'],
    ['P0172', 'Mezcla rica (banco 1)', 'Regulador con presión alta, sensor O2 leyendo mal, inyector con fuga.'],
    ['P0174', 'Mezcla pobre (banco 2)', 'Igual que P0171 pero en el banco 2 (motores V6/V8).'],
    ['P0200', 'Falla circuito inyector', 'Cableado de inyectores, conector o inyector en corto/abierto.'],
    ['P0300', 'Fallos de encendido múltiples', 'Bujías, cables, bobinas, inyector o compresión: revisar por cilindro.'],
    ['P0301', 'Fallo encendido cilindro 1', 'Bujía/cable del cilindro 1, bobina o inyector del cilindro 1.'],
    ['P0302', 'Fallo encendido cilindro 2', 'Revisar bujía, cable, bobina e inyector del cilindro 2.'],
    ['P0303', 'Fallo encendido cilindro 3', 'Revisar bujía, cable, bobina e inyector del cilindro 3.'],
    ['P0304', 'Fallo encendido cilindro 4', 'Revisar bujía, cable, bobina e inyector del cilindro 4.'],
    ['P0325', 'Sensor de detonación (knock)', 'Sensor de detonación o su cableado; el motor pierde avance.'],
    ['P0335', 'Sensor de posición del cigüeñal', 'Sensor CKP fallando o mal ajustado; sin señal no hay chispa.'],
    ['P0340', 'Sensor de posición del árbol de levas', 'Sensor CMP fallando; la ECU pierde la sincronización de inyección.'],
    ['P0401', 'EGR flujo insuficiente', 'Válvula EGR tapada con carbón, manguera de vacío o sensor de posición.'],
    ['P0420', 'Catalizador eficiencia baja (banco 1)', 'Catalizador gastado o sensor O2 tras catalizador lento.'],
    ['P0440', 'Sistema EVAP falla', 'Tapa de gasolina floja, fuga en sistema de vapores o válvula de purga.'],
    ['P0442', 'Fuga pequeña EVAP', 'Tapa de gasolina, mangueras de vapor o canister con fuga pequeña.'],
    ['P0455', 'Fuga grande EVAP', 'Tapa de gasolina abierta, manguera desconectada o canister roto.'],
    ['P0500', 'Sensor de velocidad del vehículo', 'Sensor VSS o cableado; el velocímetro deja de marcar.'],
    ['P0505', 'Control de ralentí (IAC)', 'Válvula IAC sucia o fallando; ralentí inestable o se apaga.'],
    ['P0507', 'Ralentí alto', 'Fuga de vacío, IAC con falla o cuerpo del acelerador sucio.'],
    ['P0562', 'Voltaje de sistema bajo', 'Alternador débil, batería descargada o tierra mala.'],
    ['P0563', 'Voltaje de sistema alto', 'Regulador del alternador en falla (sobrecarga).'],
    ['P0606', 'Falla interna ECU', 'Computadora con falla interna: revisar tierras, luego sustituir.'],
    ['P0700', 'Falla transmisión (TCU)', 'La transmisión reporta falla; escanear módulo de transmisión.'],
    ['P1101', 'MAF fuera de rango (GM)', 'Sensor MAF con señal errática; limpiar o sustituir.'],
  ];

  const TORQUES = [
    ['Rueda (auto)', '88–108 Nm', '65–80 lb-ft', 'Cruzar en estrella, 2 pasadas'],
    ['Rueda (camioneta/SUV)', '108–140 Nm', '80–103 lb-ft', 'Verificar manual; llantas de aleación menos'],
    ['Bujía (culata aluminio)', '20–25 Nm', '15–18 lb-ft', 'Nunca en caliente'],
    ['Bujía (culata hierro)', '25–30 Nm', '18–22 lb-ft', 'Con bujía fría'],
    ['Tapa módulo de gasolina', '2–3 Nm', '15–22 lb-in', 'Solo apriete manual con anillo cam-lock'],
    ['Tornillos tapa de tanque', '4–6 Nm', '3–4.5 lb-ft', 'No forzar; empaque nuevo'],
    ['Tornillo de drenaje aceite', '25–35 Nm', '18–26 lb-ft', 'Con arandela nueva'],
    ['Filtro de aceite', 'mano + 3/4 vuelta', '—', 'Lubricar empaque antes'],
    ['Tornillo de rueda (aleación)', '90–110 Nm', '66–81 lb-ft', 'Reapretar a los 100 km'],
    ['Pinza de freno', '30–40 Nm', '22–30 lb-ft', 'Con fijador medio si lo indica el manual'],
  ];

  const SPARKS = [
    ['Motor 1.0–1.6L (4 cil, NA)', '0.9–1.1 mm', '0.035–0.043 in', 'Cobre o platino según especificación'],
    ['Motor 1.8–2.4L (4 cil)', '1.0–1.1 mm', '0.040–0.043 in', 'Verificar gap con galga'],
    ['Motor V6 3.0–3.6L', '1.0–1.3 mm', '0.040–0.051 in', 'Iridio: no ajustar gap'],
    ['Motor V8 (GM Vortec)', '1.0–1.1 mm', '0.040–0.043 in', 'Platino/iridio de serie'],
    ['Motor 1.6L (VW)', '0.8–1.0 mm', '0.031–0.039 in', 'Culata aluminio: apriete bajo'],
    ['Motores turbo', '0.7–0.9 mm', '0.028–0.035 in', 'Gap menor para evitar detonación'],
    ['Motores GDI', '0.9–1.1 mm', '0.035–0.043 in', 'Iridio de serie; no limpiar con arena'],
  ];

  const TIMING = [
    ['GM 2.2L (4 cil)', 'Marca en polea del cigüeñal y tapa; sin marca en 2.2L MPI (sensor)'],
    ['GM 3.1/3.4L V6', 'Marca en la polea; usar pin de fijación del cigüeñal'],
    ['Ford 1.6/1.8L Zetec', 'Bujías de sincronización en cigüeñal y levas'],
    ['Ford 2.3L (Ranger)', 'Marca de tiempo en polea y tapa; distribuidor con retardo'],
    ['VW 1.8L (8v)', 'Marca en polea y tapa; ajuste con lámpara de tiempo'],
    ['VW 1.6L (16v)', 'Sincronización por sensor; verificar tensión de la banda'],
    ['Toyota 1.5L/1.6L', 'Marcas en polea y tapas; banda con tensión especificada'],
    ['Toyota 2.4L (2RZ)', 'Marca en polea y tapa de distribución'],
    ['Honda D15/D16', 'Marcas en polea y tapa; banda a 12–14 mm de tensión'],
    ['Honda K20/K24', 'Cadena; verificar tensores hidráulicos y guías'],
    ['Nissan 1.6L GA16', 'Marca en polea y tapa de distribución'],
    ['Nissan 2.0L SR20', 'Marcas en poleas; cadena con tensor automático'],
    ['Hyundai 1.6L (Alpha)', 'Marca en polea y tapa; banda de tiempo'],
    ['Kia 1.6/2.0L', 'Marcas en poleas y tapa; banda o cadena según año'],
  ];

  const VIN_YEARS = { A: '2010', B: '2011', C: '2012', D: '2013', E: '2014', F: '2015', G: '2016', H: '2017', J: '2018', K: '2019', L: '2020', M: '2021', N: '2022', P: '2023', R: '2024', S: '2025', T: '2026', V: '2027', W: '2028', X: '2029', Y: '2030', '1': '2001', '2': '2002', '3': '2003', '4': '2004', '5': '2005', '6': '2006', '7': '2007', '8': '2008', '9': '2009' };

  const ZONES = ['Centro', 'Norte', 'Sur', 'Este', 'Oeste', 'Zona Industrial'];

  /* ================================================================
     HOME — dashboard con fondo de motor
     ================================================================ */
  const Home = ({ onOpen }) => {
    const [q, setQ] = useState('');
    const apps = [
      // Consulta rápida
      { id: 'search', t: 'Catálogo de Combustible', d: 'Presión, módulos y pilas por vehículo', i: 'Fuel', g: 'consulta', act: () => onOpen('search') },
      { id: 'dtc', t: 'Buscador DTC', d: 'Códigos de falla OBD-II con causa', i: 'Ecu', g: 'consulta', act: () => onOpen('dtc') },
      { id: 'torque', t: 'Torques de Apriete', d: 'Valores por componente', i: 'Wrench', g: 'consulta', act: () => onOpen('torque') },
      { id: 'spark', t: 'Bujías y Calibración', d: 'Gap por tipo de motor', i: 'Zap', g: 'consulta', act: () => onOpen('spark') },
      { id: 'cross', t: 'Cross-Reference', d: 'Pilas compatibles y alternativas', i: 'Compare', g: 'consulta', act: () => onOpen('cross') },
      { id: 'convert', t: 'Conversor de Unidades', d: 'PSI↔Bar, Nm↔lb-ft, mm↔in', i: 'Repeat', g: 'consulta', act: () => onOpen('convert') },
      { id: 'vin', t: 'Decodificador VIN', d: 'Chasis: año y fabricante', i: 'ScanSearch', g: 'consulta', act: () => onOpen('vin') },
      // Diagnóstico
      { id: 'diag', t: 'Diagnóstico por Síntomas', d: 'Causas y pruebas rápidas', i: 'Stethoscope', g: 'diag', act: () => onOpen('diag') },
      { id: 'calc', t: 'Calculadoras Técnicas', d: 'Caudal, presión y eléctrico', i: 'Gauge', g: 'diag', act: () => onOpen('calc') },
      { id: 'aid', t: 'Identificador con IA', d: 'Describe la pieza y te la identifico', i: 'Assistant', g: 'diag', act: () => onOpen('aid') },
      { id: 'pressure', t: 'Registro de Presión', d: 'Historial PSI/Bar por vehículo', i: 'Pump', g: 'diag', act: () => onOpen('pressure') },
      { id: 'regulator', t: 'Prueba de Regulador', d: 'Pasos para validar regulador', i: 'Gauge', g: 'diag', act: () => onOpen('regulator') },
      // Taller
      { id: 'orders', t: 'Órdenes de Trabajo', d: 'Pendiente, en proceso, listo', i: 'ClipboardCheck', g: 'taller', act: () => onOpen('orders') },
      { id: 'inventory', t: 'Inventario / Stock', d: 'Control con alertas de mínimo', i: 'Box', g: 'taller', act: () => onOpen('inventory') },
      { id: 'clients', t: 'Clientes', d: 'Expedientes y vehículos', i: 'Car', g: 'taller', act: () => onOpen('clients') },
      { id: 'notes', t: 'Notas del Mecánico', d: 'Notas rápidas por vehículo', i: 'BookOpen', g: 'taller', act: () => onOpen('notes') },
      { id: 'cash', t: 'Cierre de Caja', d: 'Ingresos y egresos del día', i: 'Calculator', g: 'taller', act: () => onOpen('cash') },
      // Comunidad y mercado
      { id: 'forum', t: 'Foro Técnico', d: 'Preguntas y respuestas', i: 'MessagesSquare', g: 'comunidad', act: () => onOpen('forum') },
      { id: 'connect', t: 'Conectar Cliente ↔ Mecánico', d: 'Asistencia cerca de tu zona', i: 'MapPin', g: 'comunidad', act: () => onOpen('connect') },
      { id: 'market', t: 'Mercado de Autos', d: 'Comprar y vender vehículos', i: 'Car', g: 'comunidad', act: () => onOpen('market') },
      // Aprendizaje
      { id: 'guides', t: 'Guías de Diagnóstico', d: 'Artículos técnicos paso a paso', i: 'BookOpen', g: 'aprende', act: () => onOpen('guides') },
      { id: 'glossary', t: 'Glosario Técnico', d: 'Términos del taller', i: 'BookOpen', g: 'aprende', act: () => onOpen('glossary') },
      { id: 'timing', t: 'Sincronización / Kit de Tiempo', d: 'Marcas por motor', i: 'History', g: 'aprende', act: () => onOpen('timing') },
    ];
    const groups = [
      ['consulta', 'Consulta Rápida'],
      ['diag', 'Diagnóstico'],
      ['taller', 'Taller e Inventario'],
      ['comunidad', 'Comunidad y Mercado'],
      ['aprende', 'Aprendizaje'],
    ];
    const filtered = apps.filter(a => !q || (a.t + ' ' + a.d).toLowerCase().includes(q.toLowerCase()));

    return html`
      <div class="home">
        <header class="home-header">
          <img class="logo-lockup on-dark" src="/brand/logo-dark.png" width="760" height="205" alt="FuelTech Master" />
          <img class="logo-lockup on-light" src="/brand/logo-light.png" width="760" height="193" alt="" />
          <p class="home-tagline">El taller en tu bolsillo — herramientas, diagnóstico y gestión</p>
          <div class="home-search">
            <input type="search" class="styled-input" placeholder="Buscar app, herramienta, DTC, término…" value=${q} onChange=${e => setQ(e.target.value)} />
            ${q && html`<button type="button" class="home-search-clear" onClick=${() => setQ('')} aria-label="Limpiar">✕</button>`}
          </div>
        </header>
        <div class="home-groups">
          ${q ? html`<section class="home-group"><div class="home-group-grid">${filtered.map(a => card(a))}</div>${filtered.length === 0 && html`<div class="empty">Sin resultados para “${q}”</div>`}</section>`
            : groups.map(([gid, glabel]) => html`
              <section class="home-group" key=${gid}>
                <h2 class="home-group-title">${glabel}</h2>
                <div class="home-group-grid">${apps.filter(a => a.g === gid).map(a => card(a))}</div>
              </section>`)}
        </div>
        <footer class="home-footer">FuelTech Master · Herramientas para el mecánico profesional</footer>
      </div>`;

    function card(a) {
      return html`<button type="button" class="micro-card" onClick=${a.act} key=${a.id}>
        <span class="micro-card-icon"><${Ic} n=${a.i} s=${22} /></span>
        <span class="micro-card-title">${a.t}</span>
        <span class="micro-card-desc">${a.d}</span>
      </button>`;
    }
  };

  /* ================================================================
     MICRO APPS — datos y componentes
     ================================================================ */

  /* ---- 2. Buscador DTC ---- */
  const DtcApp = ({ onBack }) => {
    const [q, setQ] = useState('');
    const rows = DTCS.filter(([c, n]) => !q || c.toLowerCase().includes(q.toLowerCase()) || n.toLowerCase().includes(q.toLowerCase()));
    return html`<${MicroShell} title="Buscador DTC (OBD-II)" icon="Ecu" onBack=${onBack}>
      <input type="search" class="styled-input" placeholder="Buscar código o nombre (P0300, inyector, MAF…)…" value=${q} onChange=${e => setQ(e.target.value)} style=${{ maxWidth: '420px', marginBottom: '14px' }} />
      <div class="dtc-list">
        ${rows.map(([c, n, s]) => html`<div class="dtc-item" key=${c}>
          <div class="dtc-code">${c}</div>
          <div class="dtc-body"><strong>${n}</strong><span>${s}</span></div>
        </div>`)}
        ${rows.length === 0 && html`<div class="empty">Sin códigos para “${q}”</div>`}
      </div>
    </${MicroShell}>`;
  };

  /* ---- 3. Torques ---- */
  const TorqueApp = ({ onBack }) => html`<${MicroShell} title="Torques de Apriete" icon="Wrench" onBack=${onBack}>
    <table class="mic-tbl">
      <thead><tr><th>Componente</th><th>Nm</th><th>lb-ft</th><th>Nota</th></tr></thead>
      <tbody>${TORQUES.map((r, i) => html`<tr key=${i}><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td><td class="muted">${r[3]}</td></tr>`)}</tbody>
    </table>
    <div class="alert blue" style=${{ marginTop: '12px' }}><span>Referencia general: confirma siempre con el manual de servicio del fabricante.</span></div>
  </${MicroShell}>`;

  /* ---- 4. Bujías ---- */
  const SparkApp = ({ onBack }) => html`<${MicroShell} title="Bujías y Calibración" icon="Zap" onBack=${onBack}>
    <table class="mic-tbl">
      <thead><tr><th>Motor</th><th>Gap mm</th><th>Gap in</th><th>Nota</th></tr></thead>
      <tbody>${SPARKS.map((r, i) => html`<tr key=${i}><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td><td class="muted">${r[3]}</td></tr>`)}</tbody>
    </table>
    <div class="alert blue" style=${{ marginTop: '12px' }}><span>Usa galga y no ajustes gap en bujías de iridio. Verifica el manual del motor.</span></div>
  </${MicroShell}>`;

  /* ---- 5. Cross-reference de pilas ---- */
  const CrossApp = ({ onBack }) => {
    const [pumps, setPumps] = useState([]);
    const [sel, setSel] = useState('');
    useEffect(() => { fetch('/api/pumps').then(r => r.json()).then(setPumps).catch(() => {}); }, []);
    const p = pumps.find(x => x.id === Number(sel));
    return html`<${MicroShell} title="Cross-Reference de Pilas" icon="Compare" onBack=${onBack}>
      <label class="muted" style=${{ display: 'block', fontSize: '10px', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '5px' }}>Pila de referencia</label>
      <select class="styled-input" value=${sel} onChange=${e => setSel(e.target.value)} style=${{ maxWidth: '420px' }}>
        <option value="">Elige una pila…</option>
        ${pumps.map(x => html`<option key=${x.id} value=${x.id}>${x.code} — ${x.manufacturer} (${x.max_psi_direct} PSI)</option>`)}
      </select>
      ${p && html`<div class="cross-card" style=${{ marginTop: '16px' }}>
        <h3>${p.code} · ${p.manufacturer}</h3>
        <dl class="kv">
          <dt>Presión máx</dt><dd class="psi">${p.max_psi_direct} PSI (${p.max_bar_direct} bar)</dd>
          <dt>Consumo</dt><dd>${p.amperage_a} A @ ${p.voltage_v} V · ${p.flow_lph_free || '—'} LPH</dd>
          <dt>Estilo</dt><dd>${p.pump_style}</dd>
          <dt>Entrada</dt><dd>${p.inlet_desc}</dd>
          <dt>Salida</dt><dd>${p.outlet_desc}</dd>
          <dt>Polaridad</dt><dd>${p.polarity_desc}</dd>
        </dl>
        <div class="alert blue" style=${{ marginTop: '12px' }}><span>Busca el código en la refaccionaria o por internet. Verifica medidas y conector contra la pieza original.</span></div>
      </div>`}
    </${MicroShell}>`;
  };

  /* ---- 6. Conversor ---- */
  const ConverterApp = ({ onBack }) => {
    const [mode, setMode] = useState('psi');
    const [v, setV] = useState('');
    const conv = {
      psi: [v => v * 0.0689476, 'bar', v => v * 6.89476, 'kPa'],
      bar: [v => v * 14.5038, 'PSI', v => v * 100, 'kPa'],
      nm: [v => v * 0.73756, 'lb-ft', v => v * 0.10197, 'kgf·m'],
      lph: [v => v * 0.264172, 'GPH', v => v * 16.6667, 'cc/min'],
      mm: [v => v / 25.4, 'in', v => v / 10, 'cm'],
      liter: [v => v * 0.264172, 'gal', v => v / 3.785, 'gal (US)'],
    };
    const [a, b] = conv[mode];
    const n = parseFloat(v);
    return html`<${MicroShell} title="Conversor de Unidades" icon="Repeat" onBack=${onBack}>
      <div class="conv-modes">
        ${[['psi', 'Presión'], ['nm', 'Torque'], ['lph', 'Caudal'], ['mm', 'Longitud'], ['liter', 'Volumen']].map(([m, l]) => html`<button type="button" class=${'conv-mode' + (mode === m ? ' active' : '')} onClick=${() => setMode(m)} key=${m}>${l}</button>`)}
      </div>
      <div class="conv-body">
        <div><label class="muted" style=${{ display: 'block', fontSize: '10px', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '5px' }}>Entrada</label>
          <input type="number" class="styled-input" value=${v} onChange=${e => setV(e.target.value)} placeholder="0" /></div>
        ${n !== 0 && !isNaN(n) && html`
          <div class="conv-out"><strong>${a(n).toFixed(2)}</strong> <span>${a && a.length > 1 ? 'unidades' : ''}</span></div>
          <div class="conv-out2">= ${b(n).toFixed(2)} ${mode === 'psi' ? 'kPa' : mode === 'bar' ? 'kPa' : mode === 'nm' ? 'kgf·m' : mode === 'lph' ? 'cc/min' : mode === 'mm' ? 'cm' : 'gal'}</div>`}
      </div>
    </${MicroShell}>`;
  };

  /* ---- 7. VIN ---- */
  const VinApp = ({ onBack }) => {
    const [vin, setVin] = useState('');
    const v = vin.toUpperCase().trim();
    const valid = /^[A-HJ-NPR-Z0-9]{17}$/.test(v);
    const year = v.length >= 10 ? (VIN_YEARS[v[9]] || '—') : '—';
    const wmi = v.slice(0, 3);
    const wmiBrand = {
      '1GC': 'Chevrolet (EE. UU.)', '2GC': 'Chevrolet (Canadá)', '3GC': 'Chevrolet (México)',
      '1FT': 'Ford (EE. UU.)', '3FT': 'Ford (México)', '1HG': 'Honda (EE. UU.)',
      '2HG': 'Honda (Canadá)', '3HG': 'Honda (México)', '1NX': 'Toyota (EE. UU.)',
      '4T1': 'Toyota (EE. UU.)', '2T1': 'Toyota (Canadá)', '1VW': 'Volkswagen (EE. UU.)',
      '3VW': 'Volkswagen (México)', '1J4': 'Jeep (EE. UU.)', '1N4': 'Nissan (EE. UU.)',
      '3N1': 'Nissan (México)', 'KNA': 'Kia (Corea)', 'KMH': 'Hyundai (Corea)',
      'WAU': 'Audi', 'WDB': 'Mercedes-Benz', 'WBX': 'BMW', 'YV1': 'Volvo', 'LGW': 'Great Wall',
    };
    return html`<${MicroShell} title="Decodificador VIN" icon="ScanSearch" onBack=${onBack}>
      <input type="text" class="styled-input" placeholder="17 caracteres (ej. 3VW...)" value=${vin} onChange=${e => setVin(e.target.value.toUpperCase())} maxLength="17" style=${{ maxWidth: '340px', fontVariantNumeric: 'tabular-nums', letterSpacing: '2px' }} />
      ${v.length > 0 && !valid && html`<div class="alert" style=${{ marginTop: '10px' }}><span>El VIN debe tener 17 caracteres (sin I, O, Q).</span></div>`}
      ${valid && html`<div class="vin-card" style=${{ marginTop: '14px' }}>
        <div class="vin-line"><span>Fabricante (WMI)</span><strong>${wmiBrand[wmi] || wmi + ' (no en tabla local)'}</strong></div>
        <div class="vin-line"><span>Año del modelo (pos. 10)</span><strong>${year}${year === '—' ? '' : ' (letra ' + v[9] + ')'}</strong></div>
        <div class="vin-line"><span>País (pos. 1)</span><strong>${wmi[0] === '1' ? 'EE. UU.' : wmi[0] === '2' ? 'Canadá' : wmi[0] === '3' ? 'México' : wmi[0] === 'K' ? 'Corea' : wmi[0] === 'W' ? 'Alemania' : '—'}</strong></div>
        <div class="alert blue" style=${{ marginTop: '10px' }}><span>Tabla de años 2001–2030. La posición 10 usa letras/cifras que saltan (I, O, Q, U, Z y 0 no se usan).</span></div>
      </div>`}
    </${MicroShell}>`;
  };

  /* ---- 11. Registro de presión ---- */
  const PressureApp = ({ onBack }) => {
    const KEY = 'ft_pressure_log';
    const [rows, setRows] = useState(() => ls.get(KEY, []));
    const [psi, setPsi] = useState('');
    const [veh, setVeh] = useState('');
    const add = () => {
      const n = parseFloat(psi);
      if (isNaN(n) || n <= 0) return;
      const next = [{ psi: n, bar: +(n * 0.0689476).toFixed(2), veh: veh.trim() || 'General', ts: Date.now() }, ...rows].slice(0, 50);
      setRows(next); ls.set(KEY, next); setPsi(''); setVeh('');
    };
    const avg = rows.length ? rows.reduce((a, r) => a + r.psi, 0) / rows.length : 0;
    return html`<${MicroShell} title="Registro de Presión de Combustible" icon="Pump" onBack=${onBack}>
      <div class="pres-form">
        <input type="number" class="styled-input" placeholder="Presión (PSI)" value=${psi} onChange=${e => setPsi(e.target.value)} />
        <input type="text" class="styled-input" placeholder="Vehículo (opcional)" value=${veh} onChange=${e => setVeh(e.target.value)} />
        <button type="button" class="tool-add-btn" onClick=${add} disabled=${!psi}>Registrar</button>
      </div>
      ${rows.length > 0 && html`<div class="pres-stats"><span>Promedio: <strong>${avg.toFixed(1)} PSI</strong> (${(avg * 0.0689476).toFixed(1)} bar)</span><span>${rows.length} registros</span></div>`}
      <div class="pres-list">
        ${rows.map((r, i) => html`<div class="pres-item" key=${i}>
          <span class="pres-psi">${r.psi} PSI <em>(${r.bar} bar)</em></span>
          <span class="pres-veh">${r.veh}</span>
          <span class="pres-ts">${new Date(r.ts).toLocaleString('es')}</span>
        </div>`)}
        ${rows.length === 0 && html`<div class="empty">Aún sin registros. Mide la presión en el riel y anótala aquí.</div>`}
      </div>
    </${MicroShell}>`;
  };

  /* ---- 12. Prueba de regulador ---- */
  const RegulatorApp = ({ onBack }) => {
    const [step, setStep] = useState(0);
    const [answers, setAnswers] = useState([]);
    const steps = [
      { q: 'Con la llave en ON (motor apagado), ¿la presión sube al valor de la ficha?', ok: 'Sí', bad: 'No' },
      { q: 'Al quitar la manguera de vacío del regulador, ¿la presión sube unos 8–10 PSI?', ok: 'Sí', bad: 'No' },
      { q: '¿Hay gasolina en la manguera de vacío del regulador?', ok: 'No', bad: 'Sí (diafragma roto)' },
      { q: 'Prueba de retención: al apagar, ¿la presión se mantiene 5 min sin caer más de 5 PSI?', ok: 'Sí', bad: 'No (fuga/check)' },
    ];
    const ans = (a) => { const na = [...answers, a]; setAnswers(na); if (step < steps.length - 1) setStep(step + 1); };
    const reset = () => { setStep(0); setAnswers([]); };
    const done = answers.length === steps.length;
    const verdict = done
      ? (answers.every(a => a === 'ok') ? 'Regulador y sistema en buen estado.' : 'Hay una falla: revisa el paso marcado en rojo. Sigue el orden del diagnóstico.')
      : null;
    return html`<${MicroShell} title="Prueba de Regulador de Presión" icon="Gauge" onBack=${onBack}>
      ${!done && html`<div class="reg-step">
        <div class="reg-prog"><div style=${{ width: (step / steps.length) * 100 + '%' }}></div></div>
        <p class="reg-q">${steps[step].q}</p>
        <div class="reg-ans">
          <button type="button" class="tool-add-btn" onClick=${() => ans('ok')}>${steps[step].ok}</button>
          <button type="button" class="reg-btn-no" onClick=${() => ans('bad')}>${steps[step].bad}</button>
        </div>
      </div>`}
      ${done && html`<div class="reg-verdict ${answers.every(a => a === 'ok') ? 'ok' : 'bad'}">
        <strong>${verdict}</strong>
        <div class="reg-answers">${steps.map((s, i) => html`<div class=${'reg-a ' + (answers[i] === 'ok' ? 'ok' : 'bad')} key=${i}>${i + 1}. ${s.q} — <em>${answers[i] === 'ok' ? s.ok : s.bad}</em></div>`)}</div>
        <button type="button" class="link-btn" onClick=${reset}>Repetir prueba</button>
      </div>`}
    </${MicroShell}>`;
  };

  /* ================================================================
     HELPERS DE CRUD (localStorage) para taller/comunidad
     ================================================================ */
  function useStore(key, seed) {
    const [d, setD] = useState(() => ls.get(key, seed));
    const upd = (fn) => { setD(prev => { const nx = fn(prev); ls.set(key, nx); return nx; }); };
    return [d, upd];
  }

  /* ---- 13. Órdenes de trabajo ---- */
  const OrdersApp = ({ onBack }) => {
    const [orders, setOrders] = useStore('ft_orders', []);
    const [show, setShow] = useState(false);
    const [f, setF] = useState({ client: '', veh: '', desc: '', status: 'Pendiente' });
    const save = () => { if (!f.client.trim() || !f.desc.trim()) return; setOrders(p => [{ ...f, id: uid(), ts: Date.now(), client: f.client.trim(), veh: f.veh.trim(), desc: f.desc.trim() }, ...p]); setF({ client: '', veh: '', desc: '', status: 'Pendiente' }); setShow(false); };
    const setStatus = (id, st) => setOrders(p => p.map(o => o.id === id ? { ...o, status: st } : o));
    const del = (id) => setOrders(p => p.filter(o => o.id !== id));
    const counts = { Pendiente: orders.filter(o => o.status === 'Pendiente').length, 'En proceso': orders.filter(o => o.status === 'En proceso').length, Listo: orders.filter(o => o.status === 'Listo').length };
    return html`<${MicroShell} title="Órdenes de Trabajo" icon="ClipboardCheck" onBack=${onBack}>
      <div class="order-stats">${[['Pendiente', 'var(--amber)'], ['En proceso', 'var(--accent)'], ['Listo', 'var(--text)']].map(([s, c]) => html`<span style=${{ color: c }}>${s}: <strong>${counts[s]}</strong></span>`)}</div>
      <button type="button" class="tool-add-btn" style=${{ margin: '12px 0' }} onClick=${() => setShow(!show)}>${show ? 'Cancelar' : '+ Nueva orden'}</button>
      ${show && html`<div class="order-form panel" style=${{ padding: '14px', marginBottom: '12px' }}>
        <div class="grid2"><input type="text" class="styled-input" placeholder="Cliente" value=${f.client} onChange=${e => setF({ ...f, client: e.target.value })} />
        <input type="text" class="styled-input" placeholder="Vehículo / placa" value=${f.veh} onChange=${e => setF({ ...f, veh: e.target.value })} /></div>
        <textarea class="styled-input" style=${{ marginTop: '8px' }} rows="3" placeholder="Descripción del trabajo" value=${f.desc} onChange=${e => setF({ ...f, desc: e.target.value })}></textarea>
        <select class="styled-input" style=${{ marginTop: '8px' }} value=${f.status} onChange=${e => setF({ ...f, status: e.target.value })}>
          <option>Pendiente</option><option>En proceso</option><option>Listo</option>
        </select>
        <button type="button" class="tool-add-btn" style=${{ marginTop: '10px' }} onClick=${save} disabled=${!f.client.trim() || !f.desc.trim()}>Guardar orden</button>
      </div>`}
      <div class="order-list">
        ${orders.map(o => html`<div class="order-item" key=${o.id}>
          <div class="order-head">
            <strong>${o.client}</strong> ${o.veh && html`<span class="muted">· ${o.veh}</span>`}
            <span class="order-date">${new Date(o.ts).toLocaleString('es', { day: '2-digit', month: 'short' })}</span>
          </div>
          <p class="order-desc">${o.desc}</p>
          <div class="order-foot">
            <select class="order-status st-${o.status.toLowerCase().replace(' ', '-')}" value=${o.status} onChange=${e => setStatus(o.id, e.target.value)}>
              <option>Pendiente</option><option>En proceso</option><option>Listo</option>
            </select>
            <button type="button" class="link-btn" onClick=${() => del(o.id)}>eliminar</button>
          </div>
        </div>`)}
        ${orders.length === 0 && html`<div class="empty">Sin órdenes. Crea la primera.</div>`}
      </div>
    </${MicroShell}>`;
  };

  /* ---- 14. Inventario ---- */
  const InventoryApp = ({ onBack }) => {
    const [items, setItems] = useStore('ft_inventory', []);
    const [f, setF] = useState({ name: '', qty: '', min: '' });
    const save = () => { if (!f.name.trim()) return; setItems(p => [...p, { id: uid(), name: f.name.trim(), qty: parseInt(f.qty) || 0, min: parseInt(f.min) || 0 }]); setF({ name: '', qty: '', min: '' }); };
    const setQty = (id, q) => setItems(p => p.map(i => i.id === id ? { ...i, qty: Math.max(0, parseInt(q) || 0) } : i));
    const del = (id) => setItems(p => p.filter(i => i.id !== id));
    const low = items.filter(i => i.qty <= i.min);
    return html`<${MicroShell} title="Inventario / Stock" icon="Box" onBack=${onBack}>
      ${low.length > 0 && html`<div class="alert" style=${{ marginBottom: '12px' }}><strong style=${{ color: 'var(--amber)' }}>${low.length} pieza(s) bajo mínimo:</strong> ${low.map(i => i.name).join(', ')}</div>`}
      <div class="inv-form">
        <input type="text" class="styled-input" placeholder="Pieza (ej. Bomba BOSCH 69100)" value=${f.name} onChange=${e => setF({ ...f, name: e.target.value })} />
        <input type="number" class="styled-input" placeholder="Cant." value=${f.qty} onChange=${e => setF({ ...f, qty: e.target.value })} />
        <input type="number" class="styled-input" placeholder="Mín." value=${f.min} onChange=${e => setF({ ...f, min: e.target.value })} />
        <button type="button" class="tool-add-btn" onClick=${save} disabled=${!f.name.trim()}>Agregar</button>
      </div>
      <div class="inv-list">
        ${items.map(i => html`<div class="inv-item ${i.qty <= i.min ? 'low' : ''}" key=${i.id}>
          <span class="inv-name">${i.name}</span>
          <span class="inv-qty"><button type="button" class="inv-btn" onClick=${() => setQty(i.id, i.qty - 1)}>−</button><strong class=${i.qty <= i.min ? 'low' : ''}>${i.qty}</strong><button type="button" class="inv-btn" onClick=${() => setQty(i.id, i.qty + 1)}>+</button></span>
          <span class="muted">mín ${i.min}</span>
          <button type="button" class="link-btn" onClick=${() => del(i.id)}>✕</button>
        </div>`)}
        ${items.length === 0 && html`<div class="empty">Inventario vacío. Agrega piezas.</div>`}
      </div>
    </${MicroShell}>`;
  };

  /* ---- 15. Clientes ---- */
  const ClientsApp = ({ onBack }) => {
    const [clients, setClients] = useStore('ft_clients', []);
    const [f, setF] = useState({ name: '', phone: '', veh: '', plate: '' });
    const save = () => { if (!f.name.trim()) return; setClients(p => [...p, { id: uid(), name: f.name.trim(), phone: f.phone.trim(), veh: f.veh.trim(), plate: f.plate.trim().toUpperCase() }]); setF({ name: '', phone: '', veh: '', plate: '' }); };
    const del = (id) => setClients(p => p.filter(c => c.id !== id));
    return html`<${MicroShell} title="Clientes" icon="Car" onBack=${onBack}>
      <div class="cli-form grid2">
        <input type="text" class="styled-input" placeholder="Nombre" value=${f.name} onChange=${e => setF({ ...f, name: e.target.value })} />
        <input type="text" class="styled-input" placeholder="Teléfono" value=${f.phone} onChange=${e => setF({ ...f, phone: e.target.value })} />
        <input type="text" class="styled-input" placeholder="Vehículo" value=${f.veh} onChange=${e => setF({ ...f, veh: e.target.value })} />
        <input type="text" class="styled-input" placeholder="Placa" value=${f.plate} onChange=${e => setF({ ...f, plate: e.target.value })} />
      </div>
      <button type="button" class="tool-add-btn" style=${{ margin: '10px 0 14px' }} onClick=${save} disabled=${!f.name.trim()}>Agregar cliente</button>
      <div class="cli-list">
        ${clients.map(c => html`<div class="cli-item" key=${c.id}>
          <div class="cli-head"><strong>${c.name}</strong> ${c.phone && html`<a href=${'tel:' + c.phone} class="link-btn">${c.phone}</a>`}<button type="button" class="link-btn" onClick=${() => del(c.id)}>✕</button></div>
          <div class="muted">${[c.veh, c.plate].filter(Boolean).join(' · ') || 'Sin vehículo registrado'}</div>
        </div>`)}
        ${clients.length === 0 && html`<div class="empty">Sin clientes registrados.</div>`}
      </div>
    </${MicroShell}>`;
  };

  /* ---- 16. Notas del mecánico ---- */
  const NotesApp = ({ onBack }) => {
    const [notes, setNotes] = useStore('ft_notes', []);
    const [t, setT] = useState('');
    const [veh, setVeh] = useState('');
    const add = () => { if (!t.trim()) return; setNotes(p => [{ id: uid(), t: t.trim(), veh: veh.trim(), ts: Date.now() }, ...p]); setT(''); setVeh(''); };
    const del = (id) => setNotes(p => p.filter(n => n.id !== id));
    return html`<${MicroShell} title="Notas del Mecánico" icon="BookOpen" onBack=${onBack}>
      <div class="note-form">
        <input type="text" class="styled-input" placeholder="Vehículo (opcional)" value=${veh} onChange=${e => setVeh(e.target.value)} style=${{ maxWidth: '220px' }} />
        <input type="text" class="styled-input" placeholder="Nota rápida…" value=${t} onChange=${e => setT(e.target.value)} onKeyDown=${e => { if (e.key === 'Enter') add(); }} />
        <button type="button" class="tool-add-btn" onClick=${add} disabled=${!t.trim()}>Guardar</button>
      </div>
      <div class="note-list">
        ${notes.map(n => html`<div class="note-item" key=${n.id}><div class="note-veh">${n.veh || 'General'} <button type="button" class="link-btn" onClick=${() => del(n.id)}>✕</button></div><p>${n.t}</p><span class="muted">${new Date(n.ts).toLocaleString('es')}</span></div>`)}
        ${notes.length === 0 && html`<div class="empty">Sin notas.</div>`}
      </div>
    </${MicroShell}>`;
  };

  /* ---- 17. Cierre de caja ---- */
  const CashApp = ({ onBack }) => {
    const KEY = 'ft_cash';
    const [moves, setMoves] = useStore(KEY, []);
    const [f, setF] = useState({ concept: '', amount: '', type: 'ingreso' });
    const save = () => { const a = parseFloat(f.amount); if (!f.concept.trim() || isNaN(a)) return; setMoves(p => [...p, { id: uid(), concept: f.concept.trim(), amount: Math.abs(a), type: f.type, ts: Date.now() }]); setF({ concept: '', amount: '', type: 'ingreso' }); };
    const del = (id) => setMoves(p => p.filter(m => m.id !== id));
    const total = moves.reduce((s, m) => s + (m.type === 'ingreso' ? m.amount : -m.amount), 0);
    const today = moves.filter(m => new Date(m.ts).toDateString() === new Date().toDateString()).reduce((s, m) => s + (m.type === 'ingreso' ? m.amount : -m.amount), 0);
    return html`<${MicroShell} title="Cierre de Caja" icon="Calculator" onBack=${onBack}>
      <div class="cash-totals">
        <div class="cash-today"><span>Hoy</span><strong>$${today.toFixed(2)}</strong></div>
        <div class="cash-all"><span>Total acumulado</span><strong>$${total.toFixed(2)}</strong></div>
      </div>
      <div class="cash-form">
        <input type="text" class="styled-input" placeholder="Concepto" value=${f.concept} onChange=${e => setF({ ...f, concept: e.target.value })} />
        <input type="number" class="styled-input" placeholder="Monto" value=${f.amount} onChange=${e => setF({ ...f, amount: e.target.value })} />
        <select class="styled-input" value=${f.type} onChange=${e => setF({ ...f, type: e.target.value })}>
          <option value="ingreso">Ingreso</option><option value="egreso">Egreso</option>
        </select>
        <button type="button" class="tool-add-btn" onClick=${save} disabled=${!f.concept.trim() || !f.amount}>Registrar</button>
      </div>
      <div class="cash-list">
        ${moves.slice().reverse().map(m => html`<div class="cash-item" key=${m.id}>
          <span class=${'cash-type ' + m.type}>${m.type === 'ingreso' ? '+' : '−'}</span>
          <span class="cash-concept">${m.concept}</span>
          <span class=${'cash-amount ' + m.type}>$${m.amount.toFixed(2)}</span>
          <button type="button" class="link-btn" onClick=${() => del(m.id)}>✕</button>
        </div>`)}
        ${moves.length === 0 && html`<div class="empty">Sin movimientos.</div>`}
      </div>
    </${MicroShell}>`;
  };

  /* ---- 18. Foro ---- */
  const ForumApp = ({ onBack }) => {
    const [threads, setThreads] = useStore('ft_forum', []);
    const [t, setT] = useState('');
    const [author, setAuthor] = useState(() => localStorage.getItem('ftm_author_name') || 'Anónimo');
    const [openId, setOpenId] = useState(null);
    const [reply, setReply] = useState('');
    const addThread = () => { if (!t.trim()) return; setThreads(p => [{ id: uid(), t: t.trim(), a: author, ts: Date.now(), posts: [] }, ...p]); setT(''); };
    const addReply = (id) => { if (!reply.trim()) return; setThreads(p => p.map(th => th.id === id ? { ...th, posts: [...th.posts, { a: author, t: reply.trim(), ts: Date.now() }] } : th)); setReply(''); };
    return html`<${MicroShell} title="Foro Técnico" icon="MessagesSquare" onBack=${onBack}>
      <input type="text" class="styled-input" placeholder="Tu nombre" value=${author} onChange=${e => setAuthor(e.target.value)} style=${{ maxWidth: '200px', marginBottom: '10px' }} />
      <div class="forum-new">
        <input type="text" class="styled-input" placeholder="Nuevo tema: ¿Cómo se cambia el módulo de un Jetta?" value=${t} onChange=${e => setT(e.target.value)} onKeyDown=${e => { if (e.key === 'Enter') addThread(); }} />
        <button type="button" class="tool-add-btn" onClick=${addThread} disabled=${!t.trim()}>Publicar</button>
      </div>
      <div class="forum-list">
        ${threads.map(th => html`<div class="forum-thread" key=${th.id}>
          <button type="button" class="forum-thread-head" onClick=${() => setOpenId(openId === th.id ? null : th.id)}>
            <strong>${th.t}</strong>
            <span class="muted">${th.a} · ${new Date(th.ts).toLocaleDateString('es')} · ${th.posts.length} respuestas</span>
          </button>
          ${openId === th.id && html`<div class="forum-posts">
            ${th.posts.map((p, i) => html`<div class="forum-post" key=${i}><strong>${p.a}</strong><p>${p.t}</p><span class="muted">${new Date(p.ts).toLocaleString('es')}</span></div>`)}
            <div class="forum-reply"><input type="text" class="styled-input" placeholder="Responder…" value=${reply} onChange=${e => setReply(e.target.value)} onKeyDown=${e => { if (e.key === 'Enter') addReply(th.id); }} /><button type="button" class="tool-add-btn" onClick=${() => addReply(th.id)} disabled=${!reply.trim()}>Responder</button></div>
          </div>`}
        </div>`)}
        ${threads.length === 0 && html`<div class="empty">Sin temas. ¡Crea el primero!</div>`}
      </div>
    </${MicroShell}>`;
  };

  /* ---- 19. Conectar cliente ↔ mecánico ---- */
  const ConnectApp = ({ onBack }) => {
    const [me, setMe] = useStore('ft_me', { name: '', role: 'mecanico', zone: '' });
    const [people, setPeople] = useStore('ft_people', [
      { id: 'p1', name: 'Carlos Méndez', role: 'mecanico', zone: 'Centro', spec: 'Inyección y bombas', phone: '0414-555-0101' },
      { id: 'p2', name: 'Tienda Repuestos El Tigre', role: 'tienda', zone: 'Centro', spec: 'Refacciones en general', phone: '0283-555-0102' },
      { id: 'p3', name: 'María López', role: 'cliente', zone: 'Norte', spec: 'Busca mecánico para Jetta 2008', phone: '0416-555-0103' },
      { id: 'p4', name: 'Taller Don José', role: 'mecanico', zone: 'Sur', spec: 'Motor y transmisión', phone: '0283-555-0104' },
    ]);
    const save = () => { if (!me.name.trim() || !me.zone) return; setMe(me); setPeople(p => p.some(x => x.id === 'me') ? p.map(x => x.id === 'me' ? { id: 'me', name: me.name.trim(), role: me.role, zone: me.zone, spec: me.spec || '', phone: me.phone || '' } : x) : [{ id: 'me', name: me.name.trim(), role: me.role, zone: me.zone, spec: me.spec || '', phone: me.phone || '' }, ...p]); };
    const near = people.filter(p => p.id !== 'me' && p.zone === me.zone);
    const others = people.filter(p => p.id !== 'me' && p.zone !== me.zone);
    return html`<${MicroShell} title="Conectar Cliente ↔ Mecánico" icon="MapPin" onBack=${onBack}>
      <div class="conn-me panel" style=${{ padding: '14px', marginBottom: '14px' }}>
        <h3 style=${{ fontSize: '12px', color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '8px' }}>Tu perfil</h3>
        <div class="conn-form grid2">
          <input type="text" class="styled-input" placeholder="Nombre / taller" value=${me.name} onChange=${e => setMe({ ...me, name: e.target.value })} />
          <select class="styled-input" value=${me.role} onChange=${e => setMe({ ...me, role: e.target.value })}>
            <option value="mecanico">Mecánico</option><option value="cliente">Cliente</option><option value="tienda">Refaccionaria</option>
          </select>
          <select class="styled-input" value=${me.zone} onChange=${e => setMe({ ...me, zone: e.target.value })}>
            <option value="">Zona…</option>${ZONES.map(z => html`<option key=${z} value=${z}>${z}</option>`)}
          </select>
          <input type="text" class="styled-input" placeholder="Especialidad / necesidad" value=${me.spec || ''} onChange=${e => setMe({ ...me, spec: e.target.value })} />
        </div>
        <button type="button" class="tool-add-btn" style=${{ marginTop: '10px' }} onClick=${save} disabled=${!me.name.trim() || !me.zone}>Guardar perfil</button>
      </div>
      ${me.zone && html`<div class="conn-near">
        <h3 class="conn-title">En tu zona (${me.zone})</h3>
        ${near.map(p => html`<div class="conn-item" key=${p.id}><strong>${p.name}</strong><span class="muted">${p.role === 'mecanico' ? '🔧 Mecánico' : p.role === 'tienda' ? '🏪 Refaccionaria' : '🚗 Cliente'} · ${p.spec || ''}</span>${p.phone && html`<a class="link-btn" href=${'tel:' + p.phone}>Llamar</a>`}</div>`)}
        ${near.length === 0 && html`<div class="empty" style=${{ padding: '18px' }}>Aún no hay perfiles en tu zona. Comparte la app para conectar.</div>`}
      </div>`}
      <div class="conn-all">
        <h3 class="conn-title">Otros perfiles</h3>
        ${others.map(p => html`<div class="conn-item" key=${p.id}><strong>${p.name}</strong><span class="muted">${p.role === 'mecanico' ? '🔧' : p.role === 'tienda' ? '🏪' : '🚗'} ${p.role} · Zona ${p.zone} · ${p.spec || ''}</span></div>`)}
      </div>
    </${MicroShell}>`;
  };

  /* ---- 20. Mercado de autos ---- */
  const MarketApp = ({ onBack }) => {
    const [listings, setListings] = useStore('ft_market', []);
    const [show, setShow] = useState(false);
    const [f, setF] = useState({ title: '', price: '', km: '', year: '', desc: '' });
    const save = () => { if (!f.title.trim()) return; setListings(p => [{ id: uid(), title: f.title.trim(), price: f.price || '', km: f.km || '', year: f.year || '', desc: f.desc.trim(), ts: Date.now() }, ...p]); setF({ title: '', price: '', km: '', year: '', desc: '' }); setShow(false); };
    const del = (id) => setListings(p => p.filter(l => l.id !== id));
    const share = (l) => { const msg = `${l.title} — $${l.price} · ${l.year} · ${l.km} km. Visto en FuelTech Market`; if (navigator.share) navigator.share({ title: l.title, text: msg }).catch(() => {}); else { navigator.clipboard.writeText(msg).then(() => toast('Enlace copiado')); } };
    return html`<${MicroShell} title="Mercado de Autos" icon="Car" onBack=${onBack}>
      <button type="button" class="tool-add-btn" style=${{ marginBottom: '12px' }} onClick=${() => setShow(!show)}>${show ? 'Cancelar' : '+ Publicar vehículo'}</button>
      ${show && html`<div class="panel" style=${{ padding: '14px', marginBottom: '12px' }}>
        <div class="grid2"><input type="text" class="styled-input" placeholder="Título (ej. Jetta 2008 1.6)" value=${f.title} onChange=${e => setF({ ...f, title: e.target.value })} />
        <input type="number" class="styled-input" placeholder="Precio $" value=${f.price} onChange=${e => setF({ ...f, price: e.target.value })} /></div>
        <div class="grid2" style=${{ marginTop: '8px' }}><input type="number" class="styled-input" placeholder="Km" value=${f.km} onChange=${e => setF({ ...f, km: e.target.value })} />
        <input type="number" class="styled-input" placeholder="Año" value=${f.year} onChange=${e => setF({ ...f, year: e.target.value })} /></div>
        <textarea class="styled-input" style=${{ marginTop: '8px' }} rows="3" placeholder="Descripción" value=${f.desc} onChange=${e => setF({ ...f, desc: e.target.value })}></textarea>
        <button type="button" class="tool-add-btn" style=${{ marginTop: '10px' }} onClick=${save} disabled=${!f.title.trim()}>Publicar</button>
      </div>`}
      <div class="market-grid">
        ${listings.map(l => html`<div class="market-card" key=${l.id}>
          <div class="market-body">
            <h3>${l.title}</h3>
            <div class="market-price">$${l.price}</div>
            <div class="muted">${[l.year, l.km ? l.km + ' km' : ''].filter(Boolean).join(' · ')}</div>
            ${l.desc && html`<p class="market-desc">${l.desc}</p>`}
          </div>
          <div class="market-foot">
            <button type="button" class="link-btn" onClick=${() => share(l)}>Compartir</button>
            <button type="button" class="link-btn" onClick=${() => del(l.id)}>quitar</button>
          </div>
        </div>`)}
        ${listings.length === 0 && html`<div class="empty">Sin publicaciones. ¡Publica tu primer vehículo!</div>`}
      </div>
    </${MicroShell}>`;
  };

  /* ---- 23. Sincronización ---- */
  const TimingApp = ({ onBack }) => html`<${MicroShell} title="Sincronización / Kit de Tiempo" icon="History" onBack=${onBack}>
    <table class="mic-tbl">
      <thead><tr><th>Motor</th><th>Marca de sincronización</th></tr></thead>
      <tbody>${TIMING.map((r, i) => html`<tr key=${i}><td>${r[0]}</td><td class="muted">${r[1]}</td></tr>`)}</tbody>
    </table>
    <div class="alert blue" style=${{ marginTop: '12px' }}><span>Referencia: la marca exacta y el método varían por año y mercado. Usa el manual de servicio.</span></div>
  </${MicroShell}>`;

  window.FT_MICRO = {
    Home, DtcApp, TorqueApp, SparkApp, CrossApp, ConverterApp, VinApp,
    PressureApp, RegulatorApp, OrdersApp, InventoryApp, ClientsApp, NotesApp, CashApp,
    ForumApp, ConnectApp, MarketApp, TimingApp,
  };
})();
