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
  // Icono de categoría: usa la iconografía de marca; si no está, lucide; si no, emoji
  const CatIc = ({ n, s = 18 }) => {
    const M = window.FT_APP?.MARK_ICONS;
    if (M && M[n]) return html`<${window.FT_APP.MarkIcon} name=${n} size=${s} />`;
    return html`<span class="icon" style=${{ width: s, height: s }}></span>`;
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
     HOME — menú superior con iconos + página explicativa
     ================================================================ */
  const Home = ({ onOpen, user, onLogout }) => {
    const [q, setQ] = useState('');
    const [tab, setTab] = useState('inicio');
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
      { id: 'quickdiag', t: 'Diagnóstico Rápido de PSI', d: 'Medida → BIEN/MAL con causas', i: 'Gauge', g: 'diag', act: () => onOpen('quickdiag') },
      { id: 'diag', t: 'Diagnóstico por Síntomas', d: 'Causas y pruebas rápidas', i: 'Stethoscope', g: 'diag', act: () => onOpen('diag') },
      { id: 'calc', t: 'Calculadoras Técnicas', d: 'Caudal, presión y eléctrico', i: 'Gauge', g: 'diag', act: () => onOpen('calc') },
      { id: 'aid', t: 'Identificador con IA', d: 'Describe la pieza y te la identifico', i: 'Assistant', g: 'diag', act: () => onOpen('aid') },
      { id: 'pressure', t: 'Registro de Presión', d: 'Historial PSI/Bar por vehículo', i: 'Pump', g: 'diag', act: () => onOpen('pressure') },
      { id: 'regulator', t: 'Prueba de Regulador', d: 'Pasos para validar regulador', i: 'Gauge', g: 'diag', act: () => onOpen('regulator') },
      // Taller (requiere cuenta)
      { id: 'orders', t: 'Órdenes de Trabajo', d: 'Servicios, garantías y promociones', i: 'ClipboardCheck', g: 'taller', act: () => onOpen('orders'), need: true },
      { id: 'inventory', t: 'Inventario / Stock', d: 'Control con alertas de mínimo', i: 'Box', g: 'taller', act: () => onOpen('inventory'), need: true },
      { id: 'clients', t: 'Clientes', d: 'Expedientes y vehículos', i: 'Car', g: 'taller', act: () => onOpen('clients'), need: true },
      { id: 'documents', t: 'Notas de Entrega / Presupuestos', d: 'Genera e imprime documentos', i: 'FileText', g: 'taller', act: () => onOpen('documents'), need: true },
      { id: 'notes', t: 'Notas del Mecánico', d: 'Notas rápidas por vehículo', i: 'BookOpen', g: 'taller', act: () => onOpen('notes'), need: true },
      { id: 'cash', t: 'Cierre de Caja', d: 'Ingresos y egresos del día', i: 'Calculator', g: 'taller', act: () => onOpen('cash'), need: true },
      // Comunidad y mercado
      { id: 'forum', t: 'Foro Técnico', d: 'Preguntas y respuestas', i: 'MessagesSquare', g: 'comunidad', act: () => onOpen('forum') },
      { id: 'connect', t: 'Conectar Cliente ↔ Mecánico', d: 'Asistencia cerca de tu zona', i: 'MapPin', g: 'comunidad', act: () => onOpen('connect') },
      { id: 'market', t: 'Mercado de Autos', d: 'Comprar y vender vehículos', i: 'Car', g: 'comunidad', act: () => onOpen('market') },
      // Aprendizaje
      { id: 'guides', t: 'Guías de Diagnóstico', d: 'Artículos técnicos paso a paso', i: 'BookOpen', g: 'aprende', act: () => onOpen('guides') },
      { id: 'glossary', t: 'Glosario Técnico', d: 'Términos del taller', i: 'BookOpen', g: 'aprende', act: () => onOpen('glossary') },
      { id: 'timing', t: 'Sincronización / Kit de Tiempo', d: 'Marcas por motor', i: 'History', g: 'aprende', act: () => onOpen('timing') },
    ];
    // Categorías del menú superior: icono + nombre corto
    const nav = [
      ['inicio', 'Inicio', 'Search'],
      ['consulta', 'Consulta', 'Fuel'],
      ['diag', 'Diagnóstico', 'Stethoscope'],
      ['taller', 'Taller', 'Wrench'],
      ['comunidad', 'Comunidad', 'MapPin'],
      ['aprende', 'Aprender', 'BookOpen'],
    ];
    const groupInfo = {
      consulta: { t: 'Consulta Rápida', d: 'Datos técnicos al instante: presión de riel (PSI/Bar), códigos OBD-II, torques, bujías, cross-reference de pilas, conversor de unidades y decodificador VIN. Sin cuenta.' },
      diag: { t: 'Diagnóstico', d: 'Veredicto rápido de PSI comparando tu medición contra la especificación, prueba de regulador, calculadoras técnicas, registro de presión e identificador con IA.' },
      taller: { t: 'Taller y Gestión', d: 'Inventario, órdenes de trabajo con evidencia, cartera de clientes, notas de entrega y presupuestos, notas del mecánico y cierre de caja. Requiere tu cuenta.' },
      comunidad: { t: 'Comunidad y Mercado', d: 'Conecta clientes y mecánicos por ubicación y oferta, foro técnico y mercado de autos.' },
      aprende: { t: 'Aprendizaje', d: 'Guías paso a paso, glosario técnico y marcas de sincronización para el taller.' },
    };
    const lock = (a) => a.need && !user;
    const filtered = apps.filter(a => !q || (a.t + ' ' + a.d).toLowerCase().includes(q.toLowerCase()));
    const appsOf = (g) => apps.filter(a => a.g === g);
    const card = (a) => html`<button type="button" class="micro-card micro-card-app" onClick=${a.act} key=${a.id}>
        <span class="micro-card-icon"><${Ic} n=${a.i} s=${24} /></span>
        <span class="micro-card-title">${a.t}${lock(a) ? html` <em style=${{ fontSize: '9px', color: 'var(--amber)', fontStyle: 'normal' }}>🔒</em>` : ''}</span>
        <span class="micro-card-desc">${a.d}</span>
      </button>`;

    return html`
      <div class="home">
        <nav class="home-nav">
          <div class="home-nav-logo">
            <img class="on-dark" src="/brand/mark-dark.png" width="34" height="34" alt="" />
            <img class="on-light" src="/brand/mark-light.png" width="34" height="34" alt="" />
            <strong>FuelTech</strong>
          </div>
          <div class="home-nav-links">
            ${nav.map(([id, label, icon]) => html`<button type="button" class=${'home-nav-link' + (tab === id ? ' active' : '')} onClick=${() => { setTab(id); setQ(''); }} key=${id}>
              <span class="home-nav-ic"><${CatIc} n=${icon} s=${17} /></span>${label}
            </button>`)}
          </div>
          <div class="home-nav-user">
            ${user ? html`<span class="muted" style=${{ fontSize: '11px' }}>${user.name} <button type="button" class="link-btn" onClick=${onLogout}>salir</button></span>`
              : html`<span class="muted" style=${{ fontSize: '11px' }}>sin sesión</span>`}
          </div>
        </nav>

        <div class="home-body">
          ${tab === 'inicio' ? html`
            <header class="home-hero">
              <img class="logo-lockup on-dark" src="/brand/logo-dark.png" width="760" height="205" alt="FuelTech Master" />
              <img class="logo-lockup on-light" src="/brand/logo-light.png" width="760" height="193" alt="" />
              <p class="home-tagline">El taller en tu bolsillo — herramientas, diagnóstico y gestión</p>
              <div class="home-search">
                <input type="search" class="styled-input" placeholder="Buscar app, herramienta, DTC, término…" value=${q} onChange=${e => { setQ(e.target.value); if (e.target.value) setTab(null); }} />
                ${q && html`<button type="button" class="home-search-clear" onClick=${() => setQ('')} aria-label="Limpiar">✕</button>`}
              </div>
              <div class="home-cta">
                ${user ? html`<button type="button" class="tool-add-btn" onClick=${() => setTab('taller')}>Ir a mi taller →</button>`
                  : html`<button type="button" class="tool-add-btn" onClick=${() => setTab('consulta')}>Explorar herramientas</button>`}
              </div>
            </header>

            <div class="home-explain">
              <section class="home-about panel">
                <h2 class="home-about-title">¿Qué es FuelTech Master?</h2>
                <p>Es una plataforma para mecánicos y talleres de Latinoamérica que une en un solo lugar la <strong>consulta técnica</strong>, el <strong>diagnóstico</strong> y la <strong>gestión del negocio</strong>. Busca la presión de riel, el módulo y la pila de gasolina de más de 140 vehículos, diagnostica fallas comparando tus mediciones contra la especificación, y administra inventario, clientes y órdenes de trabajo desde el taller o el celular.</p>
              </section>

              <section class="home-cards">
                <div class="home-card-item panel">
                  <span class="home-card-ic"><${CatIc} n="Fuel" s=${26} /></span>
                  <h3>Consulta técnica</h3>
                  <p>Presión de riel en PSI y bar, ubicación del módulo, pilas OEM y alternativas, DTC, torques, bujías y más — por marca y modelo.</p>
                </div>
                <div class="home-card-item panel">
                  <span class="home-card-ic"><${CatIc} n="Gauge" s=${26} /></span>
                  <h3>Diagnóstico</h3>
                  <p>Mide la presión en la flauta, compárala contra la spec del vehículo y obtén un veredicto BIEN/MAL con las causas probables.</p>
                </div>
                <div class="home-card-item panel">
                  <span class="home-card-ic"><${CatIc} n="Wrench" s=${26} /></span>
                  <h3>Gestión del taller</h3>
                  <p>Inventario con alertas, órdenes de trabajo con evidencia, clientes, notas de entrega y presupuestos imprimibles. Todo con tu cuenta.</p>
                </div>
                <div class="home-card-item panel">
                  <span class="home-card-ic"><${CatIc} n="MapPin" s=${26} /></span>
                  <h3>Comunidad</h3>
                  <p>Conecta clientes y mecánicos por ubicación y oferta, participa en el foro técnico y publica en el mercado de autos.</p>
                </div>
              </section>

              <section class="home-audience panel">
                <h2 class="home-about-title">¿Para quién es?</h2>
                <div class="home-aud-grid">
                  <div><strong>🔧 Mecánicos</strong><span>Consultan specs al instante, diagnostican con veredicto y gestionan su taller con cuenta propia.</span></div>
                  <div><strong>🏪 Refaccionarias</strong><span>Buscan compatibilidades de pilas y módulos, y se conectan con mecánicos de su zona.</span></div>
                  <div><strong>🚗 Conductores</strong><span>Entienden qué le pasa a su auto y encuentran mecánicos cerca por lo que ofrecen.</span></div>
                  <div><strong>🎓 Aprendices</strong><span>Estudian guías, glosario y marcas de sincronización a su ritmo.</span></div>
                </div>
              </section>
            </div>
          ` : html`
            ${q ? html`<section class="home-group"><div class="home-group-grid">${filtered.map(a => card(a))}</div>${filtered.length === 0 && html`<div class="empty">Sin resultados para “${q}”</div>`}</section>`
              : html`
                <header class="home-cat-head">
                  <h1 class="home-cat-title">${groupInfo[tab].t}</h1>
                  <p class="home-cat-desc">${groupInfo[tab].d}</p>
                </header>
                <div class="home-group-grid home-apps-grid">${appsOf(tab).map(a => card(a))}</div>
              `}
          `}
        </div>
        <footer class="home-footer">FuelTech Master · Herramientas para el mecánico profesional</footer>
      </div>`;
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
    const [rows, api] = useApi('/api/diagnostics');
    const [psi, setPsi] = useState('');
    const [veh, setVeh] = useState('');
    const add = async () => {
      const n = parseFloat(psi);
      if (isNaN(n) || n <= 0) return;
      try {
        await apiFetch('/api/diagnostics', { method: 'POST', body: JSON.stringify({ measured_psi: n, brand: '', model: veh.trim() || null, verdict: 'OK' }) });
        setPsi(''); setVeh(''); api.load();
      } catch (e) { alert(e.message); }
    };
    const avg = rows.length ? rows.reduce((a, r) => a + Number(r.measured_psi), 0) / rows.length : 0;
    return html`<${MicroShell} title="Registro de Presión de Combustible" icon="Pump" onBack=${onBack}>
      <div class="alert blue" style=${{ marginBottom: '10px' }}><span>Para un diagnóstico completo con veredicto BIEN/MAL usa el <strong>Diagnóstico Rápido de PSI</strong> desde el menú.</span></div>
      <div class="pres-form">
        <input type="number" class="styled-input" placeholder="Presión (PSI)" value=${psi} onChange=${e => setPsi(e.target.value)} />
        <input type="text" class="styled-input" placeholder="Vehículo (opcional)" value=${veh} onChange=${e => setVeh(e.target.value)} />
        <button type="button" class="tool-add-btn" onClick=${add} disabled=${!psi}>Registrar</button>
      </div>
      ${rows.length > 0 && html`<div class="pres-stats"><span>Promedio: <strong>${avg.toFixed(1)} PSI</strong> (${(avg * 0.0689476).toFixed(1)} bar)</span><span>${rows.length} registros</span></div>`}
      <div class="pres-list">
        ${rows.map(r => html`<div class="pres-item" key=${r.id}>
          <span class="pres-psi">${r.measured_psi} PSI <em>(${(Number(r.measured_psi) * 0.0689476).toFixed(2)} bar)</em></span>
          <span class="pres-veh">${r.model || r.brand || 'General'}</span>
          <span class="pres-ts">${new Date(r.created_at).toLocaleString('es')}</span>
        </div>`)}
        ${rows.length === 0 && !api.loading && html`<div class="empty">Aún sin registros. Mide la presión en el riel y anótala aquí.</div>`}
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

  /* ================================================================
     API backend (datos de negocio persistentes)
     ================================================================ */
  const apiFetch = async (path, opts = {}) => {
    const res = await fetch(path, {
      credentials: 'same-origin',
      headers: opts.body ? { 'Content-Type': 'application/json' } : {},
      ...opts
    });
    const ct = res.headers.get('content-type') || '';
    const body = ct.includes('json') ? await res.json() : await res.text();
    if (!res.ok) throw new Error(body?.error || body || `Error ${res.status}`);
    return body;
  };

  // Hook para listar del backend y refrescar
  const useApi = (path, seed = []) => {
    const [data, setData] = useState(seed);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState('');
    const load = () => {
      apiFetch(path).then(setData).catch(e => setErr(e.message)).finally(() => setLoading(false));
    };
    useEffect(() => { load(); /* eslint-disable-next-line */ }, [path]);
    return [data, { load, setData, loading, err }];
  };

  const downloadBlob = (filename, text, mime = 'text/csv;charset=utf-8') => {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  /* ---- 13. Órdenes de trabajo ---- */
  const ORDER_TYPES = [['reparacion', 'Reparación'], ['servicio', 'Servicio'], ['garantia', 'Garantía'], ['promocion', 'Promoción'], ['otro', 'Otro']];
  const ORDER_STATUS = ['Pendiente', 'En proceso', 'Listo', 'Entregado', 'Cancelado'];
  const OrdersApp = ({ onBack }) => {
    const [orders, api] = useApi('/api/orders');
    const [clients, clientsApi] = useApi('/api/clients');
    const [inventory, invApi] = useApi('/api/inventory');
    const [openId, setOpenId] = useState(null);
    const [show, setShow] = useState(false);
    const [f, setF] = useState({ client_id: '', vehicle_id: '', type: 'reparacion', title: '', descr: '' });
    const [newItem, setNewItem] = useState({ item_id: '', descr: '', qty: '1', unit_price: '' });
    const save = async () => {
      if (!f.title.trim()) return;
      try {
        await apiFetch('/api/orders', { method: 'POST', body: JSON.stringify(f) });
        setF({ client_id: '', vehicle_id: '', type: 'reparacion', title: '', descr: '' }); setShow(false);
        api.load(); clientsApi.load();
      } catch (e) { alert(e.message); }
    };
    const setStatus = async (id, st) => {
      try { await apiFetch(`/api/orders/${id}/status`, { method: 'POST', body: JSON.stringify({ status: st }) }); api.load(); } catch (e) { alert(e.message); }
    };
    const del = async (id) => {
      if (!confirm('¿Eliminar esta orden?')) return;
      try { await apiFetch(`/api/orders/${id}`, { method: 'DELETE' }); api.load(); } catch (e) { alert(e.message); }
    };
    const addItem = async (oid) => {
      if (!newItem.descr.trim() || !newItem.qty) return;
      const inv = inventory.find(i => i.id === Number(newItem.item_id));
      try {
        await apiFetch(`/api/orders/${oid}/items`, { method: 'POST', body: JSON.stringify({ ...newItem, unit_price: newItem.unit_price || inv?.unit_price || 0 }) });
        setNewItem({ item_id: '', descr: '', qty: '1', unit_price: '' }); api.load(); invApi.load();
      } catch (e) { alert(e.message); }
    };
    const delItem = async (oid, iid) => {
      try { await apiFetch(`/api/orders/${oid}/items/${iid}`, { method: 'DELETE' }); api.load(); invApi.load(); } catch (e) { alert(e.message); }
    };
    const makeDoc = async (oid, kind) => {
      const order = orders.find(o => o.id === oid);
      if (!order) return;
      try {
        const detail = await apiFetch(`/api/orders/${oid}`);
        const res = await apiFetch('/api/documents', { method: 'POST', body: JSON.stringify({ kind, client_id: order.client_id, order_id: oid, items: detail.items.map(i => ({ descr: i.descr, qty: i.qty, unit_price: i.unit_price })) }) });
        window.open(`/api/documents/${res.id}/print`, '_blank');
      } catch (e) { alert(e.message); }
    };
    const counts = { Pendiente: orders.filter(o => o.status === 'Pendiente').length, 'En proceso': orders.filter(o => o.status === 'En proceso').length, Listo: orders.filter(o => o.status === 'Listo').length };
    const clientOpts = (sel) => html`<select class="styled-input" value=${sel} onChange=${e => { const cid = e.target.value; setF({ ...f, client_id: cid, vehicle_id: '' }); }}>
      <option value="">Cliente…</option>${clients.map(c => html`<option key=${c.id} value=${c.id}>${c.name}</option>`)}
    </select>`;
    return html`<${MicroShell} title="Órdenes de Trabajo" icon="ClipboardCheck" onBack=${onBack}>
      <div class="order-stats">${[['Pendiente', 'var(--amber)'], ['En proceso', 'var(--accent)'], ['Listo', 'var(--text)']].map(([s, c]) => html`<span style=${{ color: c }}>${s}: <strong>${counts[s]}</strong></span>`)}</div>
      ${api.err && html`<div class="alert"><span>${api.err}</span></div>`}
      <button type="button" class="tool-add-btn" style=${{ margin: '12px 0' }} onClick=${() => setShow(!show)}>${show ? 'Cancelar' : '+ Nueva orden'}</button>
      ${show && html`<div class="order-form panel" style=${{ padding: '14px', marginBottom: '12px' }}>
        <div class="grid2">
          ${clientOpts(f.client_id)}
          <select class="styled-input" value=${f.type} onChange=${e => setF({ ...f, type: e.target.value })}>
            ${ORDER_TYPES.map(([v, l]) => html`<option key=${v} value=${v}>${l}</option>`)}
          </select>
        </div>
        ${f.client_id && html`<div style=${{ marginTop: '8px' }}>${(() => { const vehs = clients.find(c => c.id === Number(f.client_id))?.vehicles || []; return html`<select class="styled-input" value=${f.vehicle_id} onChange=${e => setF({ ...f, vehicle_id: e.target.value })}>
          <option value="">Vehículo (opcional)…</option>${vehs.map(v => html`<option key=${v.id} value=${v.id}>${v.brand || ''} ${v.model || ''} ${v.plate ? '· ' + v.plate : ''}</option>`)}
        </select>`; })()}</div>`}
        <input type="text" class="styled-input" style=${{ marginTop: '8px' }} placeholder="Título del trabajo (ej. Cambio de bomba)" value=${f.title} onChange=${e => setF({ ...f, title: e.target.value })} />
        <textarea class="styled-input" style=${{ marginTop: '8px' }} rows="3" placeholder="Descripción" value=${f.descr} onChange=${e => setF({ ...f, descr: e.target.value })}></textarea>
        <button type="button" class="tool-add-btn" style=${{ marginTop: '10px' }} onClick=${save} disabled=${!f.title.trim()}>Guardar orden</button>
      </div>`}
      <div class="order-list">
        ${orders.map(o => html`<div class="order-item" key=${o.id}>
          <div class="order-head">
            <button type="button" class="link-btn" style=${{ font: '700 13px var(--font)', color: 'var(--text)' }} onClick=${() => setOpenId(openId === o.id ? null : o.id)}>${o.title}</button>
            ${o.client_name && html`<span class="muted">· ${o.client_name}</span>`}
            <span class="order-date">${new Date(o.created_at).toLocaleDateString('es')}</span>
          </div>
          <div class="order-desc" style=${{ fontSize: '12px', color: 'var(--text-alt)' }}>${[o.type, o.vehicle_model].filter(Boolean).join(' · ') || o.type}</div>
          ${openId === o.id && html`<div style=${{ marginTop: '10px', borderTop: '1px solid var(--border)', paddingTop: '10px' }}>
            ${o.descr && html`<p class="order-desc">${o.descr}</p>`}
            <div class="order-items" style=${{ display: 'flex', flexDirection: 'column', gap: '6px', margin: '8px 0' }}>
              ${o.items?.map(i => html`<div key=${i.id} class="order-item-line" style=${{ display: 'flex', justifyContent: 'space-between', gap: '8px', fontSize: '12px' }}>
                <span>${i.descr} × ${i.qty}</span><span>$${Number(i.line_total).toFixed(2)} <button type="button" class="link-btn" onClick=${() => delItem(o.id, i.id)}>✕</button></span>
              </div>`)}
            </div>
            <div class="grid2" style=${{ gap: '6px' }}>
              <select class="styled-input" value=${newItem.item_id} onChange=${e => { const inv = inventory.find(x => x.id === Number(e.target.value)); setNewItem({ ...newItem, item_id: e.target.value, descr: inv?.name || '', unit_price: inv?.unit_price || '' }); }}>
                <option value="">Pieza del inventario…</option>${inventory.map(i => html`<option key=${i.id} value=${i.id}>${i.name} (stock ${i.qty})</option>`)}
              </select>
              <input type="number" class="styled-input" placeholder="Cant." value=${newItem.qty} onChange=${e => setNewItem({ ...newItem, qty: e.target.value })} />
            </div>
            <div style=${{ marginTop: '6px' }}>
              <input type="text" class="styled-input" placeholder="Descripción del item" value=${newItem.descr} onChange=${e => setNewItem({ ...newItem, descr: e.target.value })} />
            </div>
            <button type="button" class="tool-add-btn" style=${{ marginTop: '6px' }} onClick=${() => addItem(o.id)} disabled=${!newItem.descr.trim()}>Agregar item</button>
            <div style=${{ marginTop: '8px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button type="button" class="tool-add-btn" onClick=${() => makeDoc(o.id, 'entrega')}>📦 Nota de entrega</button>
              <button type="button" class="tool-add-btn" onClick=${() => makeDoc(o.id, 'presupuesto')}>🧾 Presupuesto</button>
            </div>
          </div>`}
          <div class="order-foot">
            <select class="order-status st-${o.status.toLowerCase().replace(' ', '-')}" value=${o.status} onChange=${e => setStatus(o.id, e.target.value)}>
              ${ORDER_STATUS.map(s => html`<option key=${s}>${s}</option>`)}
            </select>
            <button type="button" class="link-btn" onClick=${() => del(o.id)}>eliminar</button>
          </div>
        </div>`)}
        ${orders.length === 0 && !api.loading && html`<div class="empty">Sin órdenes. Crea la primera.</div>`}
      </div>
    </${MicroShell}>`;
  };

  /* ---- 14. Inventario ---- */
  const InventoryApp = ({ onBack }) => {
    const [items, api] = useApi('/api/inventory');
    const [moves, movesApi] = useApi('/api/inventory/moves');
    const [f, setF] = useState({ name: '', sku: '', category: '', qty: '', min: '', price: '', notes: '' });
    const [editing, setEditing] = useState(null);
    const [moveFor, setMoveFor] = useState(null);
    const [move, setMove] = useState({ delta: '', kind: 'entrada', note: '' });
    const reset = () => { setF({ name: '', sku: '', category: '', qty: '', min: '', price: '', notes: '' }); setEditing(null); };
    const save = async () => {
      if (!f.name.trim()) return;
      const payload = { ...f, qty: f.qty || 0, min_qty: f.min, unit_price: f.price };
      try {
        if (editing) await apiFetch(`/api/inventory/${editing}`, { method: 'PUT', body: JSON.stringify(payload) });
        else await apiFetch('/api/inventory', { method: 'POST', body: JSON.stringify(payload) });
        reset(); api.load();
      } catch (e) { alert(e.message); }
    };
    const edit = (i) => { setEditing(i.id); setF({ name: i.name, sku: i.sku || '', category: i.category || '', qty: i.qty, min: i.min_qty, price: i.unit_price, notes: i.notes || '' }); };
    const del = async (id) => {
      if (!confirm('¿Eliminar esta pieza del inventario?')) return;
      try { await apiFetch(`/api/inventory/${id}`, { method: 'DELETE' }); api.load(); movesApi.load(); } catch (e) { alert(e.message); }
    };
    const applyMove = async () => {
      const d = parseFloat(move.delta);
      if (isNaN(d) || d === 0) return;
      const delta = move.kind === 'salida' ? -Math.abs(d) : Math.abs(d);
      try {
        await apiFetch(`/api/inventory/${moveFor}/moves`, { method: 'POST', body: JSON.stringify({ delta, kind: move.kind, note: move.note }) });
        setMove({ delta: '', kind: 'entrada', note: '' }); setMoveFor(null); api.load(); movesApi.load();
      } catch (e) { alert(e.message); }
    };
    const exportCsv = async () => {
      try { const csv = await apiFetch('/api/inventory/export?format=csv'); downloadBlob('inventario.csv', csv); } catch (e) { alert(e.message); }
    };
    const low = items.filter(i => i.qty <= i.min_qty);
    return html`<${MicroShell} title="Inventario / Stock" icon="Box" onBack=${onBack}>
      ${low.length > 0 && html`<div class="alert" style=${{ marginBottom: '12px' }}><strong style=${{ color: 'var(--amber)' }}>${low.length} pieza(s) bajo mínimo:</strong> ${low.map(i => i.name).join(', ')}</div>`}
      ${api.err && html`<div class="alert"><span>${api.err}</span></div>`}
      <div class="inv-form" style=${{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '8px' }}>
        <input type="text" class="styled-input" placeholder="Pieza (ej. Bomba BOSCH 69100)" value=${f.name} onChange=${e => setF({ ...f, name: e.target.value })} />
        <input type="text" class="styled-input" placeholder="SKU / ref." value=${f.sku} onChange=${e => setF({ ...f, sku: e.target.value })} />
        <input type="text" class="styled-input" placeholder="Categoría" value=${f.category} onChange=${e => setF({ ...f, category: e.target.value })} />
        ${!editing && html`<input type="number" class="styled-input" placeholder="Cant. inicial" value=${f.qty} onChange=${e => setF({ ...f, qty: e.target.value })} />`}
        <input type="number" class="styled-input" placeholder="Mín." value=${f.min} onChange=${e => setF({ ...f, min: e.target.value })} />
        <input type="number" class="styled-input" placeholder="Precio $" value=${f.price} onChange=${e => setF({ ...f, price: e.target.value })} />
        <input type="text" class="styled-input" placeholder="Notas" value=${f.notes} onChange=${e => setF({ ...f, notes: e.target.value })} />
        <button type="button" class="tool-add-btn" onClick=${save} disabled=${!f.name.trim()}>${editing ? 'Guardar cambios' : 'Agregar'}</button>
        ${editing && html`<button type="button" class="link-btn" onClick=${reset}>cancelar edición</button>`}
      </div>
      <div style=${{ display: 'flex', gap: '8px', margin: '10px 0' }}>
        <button type="button" class="link-btn" onClick=${exportCsv}>⬇ Exportar CSV</button>
      </div>
      <div class="inv-list">
        ${items.map(i => html`<div class="inv-item ${i.qty <= i.min_qty ? 'low' : ''}" key=${i.id}>
          <span class="inv-name">${i.name}${i.category ? html`<em class="muted" style=${{ display: 'block', fontSize: '10px' }}>${i.category}</em>` : ''}</span>
          <span class="inv-qty"><button type="button" class="inv-btn" onClick=${async () => { try { await apiFetch(`/api/inventory/${i.id}/moves`, { method: 'POST', body: JSON.stringify({ delta: -1, kind: 'salida' }) }); api.load(); movesApi.load(); } catch (e) { alert(e.message); } }}>−</button><strong class=${i.qty <= i.min_qty ? 'low' : ''}>${i.qty}</strong><button type="button" class="inv-btn" onClick=${async () => { try { await apiFetch(`/api/inventory/${i.id}/moves`, { method: 'POST', body: JSON.stringify({ delta: 1, kind: 'entrada' }) }); api.load(); movesApi.load(); } catch (e) { alert(e.message); } }}>+</button></span>
          <span class="muted">mín ${i.min_qty}${i.unit_price ? ' · $' + i.unit_price : ''}</span>
          <button type="button" class="link-btn" onClick=${() => edit(i)}>editar</button>
          <button type="button" class="link-btn" onClick=${() => del(i.id)}>✕</button>
          <button type="button" class="link-btn" onClick=${() => { setMoveFor(i.id); setMove({ delta: '', kind: 'entrada', note: '' }); }}>ajustar</button>
        </div>`)}
        ${items.length === 0 && !api.loading && html`<div class="empty">Inventario vacío. Agrega piezas.</div>`}
      </div>
      ${moveFor && html`<div class="panel" style=${{ padding: '14px', marginTop: '12px' }}>
        <h3 style=${{ fontSize: '12px', color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '8px' }}>Movimiento de inventario</h3>
        <div class="grid2">
          <select class="styled-input" value=${move.kind} onChange=${e => setMove({ ...move, kind: e.target.value })}>
            <option value="entrada">Entrada (+)</option><option value="salida">Salida (−)</option><option value="ajuste">Ajuste</option>
          </select>
          <input type="number" class="styled-input" placeholder="Cantidad" value=${move.delta} onChange=${e => setMove({ ...move, delta: e.target.value })} />
        </div>
        <input type="text" class="styled-input" style=${{ marginTop: '8px' }} placeholder="Motivo (opcional)" value=${move.note} onChange=${e => setMove({ ...move, note: e.target.value })} />
        <button type="button" class="tool-add-btn" style=${{ marginTop: '10px' }} onClick=${applyMove} disabled=${!move.delta}>Registrar movimiento</button>
        <button type="button" class="link-btn" onClick=${() => setMoveFor(null)}>cancelar</button>
      </div>`}
      ${moves.length > 0 && html`<details style=${{ marginTop: '14px' }}><summary class="muted" style=${{ cursor: 'pointer', fontSize: '12px' }}>Historial de movimientos (${moves.length})</summary>
        <div class="pres-list" style=${{ marginTop: '8px' }}>
          ${moves.slice(0, 100).map(m => html`<div class="pres-item" key=${m.id}>
            <span class=${'pres-psi ' + (m.delta > 0 ? '' : 'low')}>${m.delta > 0 ? '+' : ''}${m.delta}</span>
            <span class="pres-veh">${m.item_name} · ${m.kind}</span>
            <span class="pres-ts">${new Date(m.created_at).toLocaleString('es')}${m.note ? ' · ' + m.note : ''}</span>
          </div>`)}
        </div>
      </details>`}
    </${MicroShell}>`;
  };

  /* ---- 15. Clientes ---- */
  const ClientsApp = ({ onBack }) => {
    const [clients, api] = useApi('/api/clients');
    const [f, setF] = useState({ name: '', phone: '', email: '', address: '', city: '', notes: '' });
    const [editing, setEditing] = useState(null);
    const [openId, setOpenId] = useState(null);
    const [vehicles, setVehicles] = useState({});
    const [vf, setVf] = useState({ brand: '', model: '', year: '', plate: '' });
    const reset = () => { setF({ name: '', phone: '', email: '', address: '', city: '', notes: '' }); setEditing(null); };
    const save = async () => {
      if (!f.name.trim()) return;
      try {
        if (editing) await apiFetch(`/api/clients/${editing}`, { method: 'PUT', body: JSON.stringify(f) });
        else await apiFetch('/api/clients', { method: 'POST', body: JSON.stringify(f) });
        reset(); api.load();
      } catch (e) { alert(e.message); }
    };
    const edit = (c) => { setEditing(c.id); setF({ name: c.name, phone: c.phone || '', email: c.email || '', address: c.address || '', city: c.city || '', notes: c.notes || '' }); };
    const del = async (id) => {
      if (!confirm('¿Eliminar este cliente?')) return;
      try { await apiFetch(`/api/clients/${id}`, { method: 'DELETE' }); api.load(); } catch (e) { alert(e.message); }
    };
    const toggle = async (c) => {
      setOpenId(openId === c.id ? null : c.id);
      if (openId !== c.id) {
        try { const rows = await apiFetch(`/api/clients/${c.id}/vehicles`); setVehicles(v => ({ ...v, [c.id]: rows })); } catch (e) { alert(e.message); }
      }
    };
    const addVehicle = async (cid) => {
      if (!vf.brand.trim() && !vf.model.trim()) return;
      try {
        await apiFetch(`/api/clients/${cid}/vehicles`, { method: 'POST', body: JSON.stringify(vf) });
        setVf({ brand: '', model: '', year: '', plate: '' });
        setVehicles(v => ({ ...v, [cid]: v[cid] ? [...v[cid]] : [] }));
        const rows = await apiFetch(`/api/clients/${cid}/vehicles`);
        setVehicles(v => ({ ...v, [cid]: rows }));
      } catch (e) { alert(e.message); }
    };
    const delVehicle = async (cid, vid) => {
      try {
        await apiFetch(`/api/clients/vehicles/${vid}`, { method: 'DELETE' });
        setVehicles(v => ({ ...v, [cid]: (v[cid] || []).filter(x => x.id !== vid) }));
      } catch (e) { alert(e.message); }
    };
    return html`<${MicroShell} title="Clientes" icon="Car" onBack=${onBack}>
      ${api.err && html`<div class="alert"><span>${api.err}</span></div>`}
      <div class="cli-form" style=${{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '8px' }}>
        <input type="text" class="styled-input" placeholder="Nombre" value=${f.name} onChange=${e => setF({ ...f, name: e.target.value })} />
        <input type="text" class="styled-input" placeholder="Teléfono" value=${f.phone} onChange=${e => setF({ ...f, phone: e.target.value })} />
        <input type="text" class="styled-input" placeholder="Correo" value=${f.email} onChange=${e => setF({ ...f, email: e.target.value })} />
        <input type="text" class="styled-input" placeholder="Dirección" value=${f.address} onChange=${e => setF({ ...f, address: e.target.value })} />
        <input type="text" class="styled-input" placeholder="Ciudad" value=${f.city} onChange=${e => setF({ ...f, city: e.target.value })} />
        <input type="text" class="styled-input" placeholder="Notas" value=${f.notes} onChange=${e => setF({ ...f, notes: e.target.value })} />
      </div>
      <div style=${{ display: 'flex', gap: '10px', margin: '10px 0 14px', alignItems: 'center' }}>
        <button type="button" class="tool-add-btn" onClick=${save} disabled=${!f.name.trim()}>${editing ? 'Guardar cambios' : 'Agregar cliente'}</button>
        ${editing && html`<button type="button" class="link-btn" onClick=${reset}>cancelar</button>`}
      </div>
      <div class="cli-list">
        ${clients.map(c => html`<div class="cli-item" key=${c.id}>
          <button type="button" class="link-btn" style=${{ font: '700 13px var(--font)', color: 'var(--text)' }} onClick=${() => toggle(c)}>${c.name}</button>
          ${c.phone && html`<a href=${'tel:' + c.phone} class="link-btn">${c.phone}</a>`}
          ${c.city && html`<span class="muted">· ${c.city}</span>`}
          <button type="button" class="link-btn" onClick=${() => edit(c)}>editar</button>
          <button type="button" class="link-btn" onClick=${() => del(c.id)}>✕</button>
          ${openId === c.id && html`<div style=${{ marginTop: '10px', borderTop: '1px solid var(--border)', paddingTop: '10px', width: '100%' }}>
            <strong class="muted" style=${{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '1px' }}>Vehículos</strong>
            ${(vehicles[c.id] || []).map(v => html`<div key=${v.id} class="order-item-line" style=${{ display: 'flex', justifyContent: 'space-between', gap: '8px', fontSize: '12px', margin: '4px 0' }}>
              <span>${[v.brand, v.model, v.year, v.plate].filter(Boolean).join(' · ')}</span>
              <button type="button" class="link-btn" onClick=${() => delVehicle(c.id, v.id)}>✕</button>
            </div>`)}
            ${(vehicles[c.id] || []).length === 0 && html`<div class="muted" style=${{ fontSize: '11px' }}>Sin vehículos registrados</div>`}
            <div class="grid2" style=${{ marginTop: '8px', gap: '6px' }}>
              <input type="text" class="styled-input" placeholder="Marca" value=${vf.brand} onChange=${e => setVf({ ...vf, brand: e.target.value })} />
              <input type="text" class="styled-input" placeholder="Modelo" value=${vf.model} onChange=${e => setVf({ ...vf, model: e.target.value })} />
              <input type="number" class="styled-input" placeholder="Año" value=${vf.year} onChange=${e => setVf({ ...vf, year: e.target.value })} />
              <input type="text" class="styled-input" placeholder="Placa" value=${vf.plate} onChange=${e => setVf({ ...vf, plate: e.target.value })} />
            </div>
            <button type="button" class="tool-add-btn" style=${{ marginTop: '8px' }} onClick=${() => addVehicle(c.id)} disabled=${!vf.brand.trim() && !vf.model.trim()}>Agregar vehículo</button>
            <div class="muted" style=${{ marginTop: '8px', fontSize: '11px' }}>${c.email ? '· ' + c.email : ''} ${c.address ? '· ' + c.address : ''} ${c.notes ? '· ' + c.notes : ''}</div>
          </div>`}
        </div>`)}
        ${clients.length === 0 && !api.loading && html`<div class="empty">Sin clientes registrados.</div>`}
      </div>
    </${MicroShell}>`;
  };

  /* ---- 16. Notas del mecánico ---- */
  const NotesApp = ({ onBack }) => {
    const [notes, api] = useApi('/api/notes');
    const [t, setT] = useState('');
    const [veh, setVeh] = useState('');
    const add = async () => {
      if (!t.trim()) return;
      try { await apiFetch('/api/notes', { method: 'POST', body: JSON.stringify({ text: t.trim(), vehicle_ref: veh.trim() }) }); setT(''); setVeh(''); api.load(); } catch (e) { alert(e.message); }
    };
    const del = async (id) => {
      try { await apiFetch(`/api/notes/${id}`, { method: 'DELETE' }); api.load(); } catch (e) { alert(e.message); }
    };
    return html`<${MicroShell} title="Notas del Mecánico" icon="BookOpen" onBack=${onBack}>
      <div class="note-form">
        <input type="text" class="styled-input" placeholder="Vehículo (opcional)" value=${veh} onChange=${e => setVeh(e.target.value)} style=${{ maxWidth: '220px' }} />
        <input type="text" class="styled-input" placeholder="Nota rápida…" value=${t} onChange=${e => setT(e.target.value)} onKeyDown=${e => { if (e.key === 'Enter') add(); }} />
        <button type="button" class="tool-add-btn" onClick=${add} disabled=${!t.trim()}>Guardar</button>
      </div>
      <div class="note-list">
        ${notes.map(n => html`<div class="note-item" key=${n.id}><div class="note-veh">${n.vehicle_ref || 'General'} <button type="button" class="link-btn" onClick=${() => del(n.id)}>✕</button></div><p>${n.text}</p><span class="muted">${new Date(n.created_at).toLocaleString('es')}</span></div>`)}
        ${notes.length === 0 && !api.loading && html`<div class="empty">Sin notas.</div>`}
      </div>
    </${MicroShell}>`;
  };

  /* ---- 17. Cierre de caja ---- */
  const CashApp = ({ onBack }) => {
    const [moves, api] = useApi('/api/cash');
    const [f, setF] = useState({ concept: '', amount: '', type: 'ingreso' });
    const save = async () => {
      const a = parseFloat(f.amount);
      if (!f.concept.trim() || isNaN(a)) return;
      try { await apiFetch('/api/cash', { method: 'POST', body: JSON.stringify({ concept: f.concept.trim(), amount: Math.abs(a), type: f.type }) }); setF({ concept: '', amount: '', type: 'ingreso' }); api.load(); } catch (e) { alert(e.message); }
    };
    const del = async (id) => {
      try { await apiFetch(`/api/cash/${id}`, { method: 'DELETE' }); api.load(); } catch (e) { alert(e.message); }
    };
    const total = moves.reduce((s, m) => s + (m.type === 'ingreso' ? m.amount : -m.amount), 0);
    const today = moves.filter(m => new Date(m.created_at).toDateString() === new Date().toDateString()).reduce((s, m) => s + (m.type === 'ingreso' ? m.amount : -m.amount), 0);
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
        ${moves.map(m => html`<div class="cash-item" key=${m.id}>
          <span class=${'cash-type ' + m.type}>${m.type === 'ingreso' ? '+' : '−'}</span>
          <span class="cash-concept">${m.concept}</span>
          <span class=${'cash-amount ' + m.type}>$${Number(m.amount).toFixed(2)}</span>
          <button type="button" class="link-btn" onClick=${() => del(m.id)}>✕</button>
        </div>`)}
        ${moves.length === 0 && !api.loading && html`<div class="empty">Sin movimientos.</div>`}
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
    const [me, setMe] = useState({ name: '', role: 'mecanico', email: '', phone: '', city: '', zone: '', address: '', lat: '', lng: '', offers: '', needs: '' });
    const [saved, setSaved] = useState(false);
    const [matches, setMatches] = useState([]);
    const [matched, setMatched] = useState(false);
    const [locBusy, setLocBusy] = useState(false);
    const [locMsg, setLocMsg] = useState('');
    useEffect(() => { apiFetch('/api/connect/profiles').catch(() => {}); }, []);
    const save = async () => {
      if (!me.name.trim() || !me.city.trim()) { alert('Nombre y ciudad son obligatorios'); return; }
      try {
        await apiFetch('/api/connect/profiles', { method: 'POST', body: JSON.stringify(me) });
        setSaved(true);
        await doMatch();
      } catch (e) { alert(e.message); }
    };
    const doMatch = async () => {
      try {
        const qs = new URLSearchParams({ city: me.city, zone: me.zone || '', offers: me.offers || '', needs: me.needs || '' });
        if (me.lat) qs.set('lat', me.lat);
        if (me.lng) qs.set('lng', me.lng);
        const res = await apiFetch('/api/connect/match?' + qs.toString());
        setMatches(res); setMatched(true);
      } catch (e) { alert(e.message); }
    };
    const useGps = () => {
      if (!navigator.geolocation) { setLocMsg('Tu navegador no soporta GPS'); return; }
      setLocBusy(true); setLocMsg('Obteniendo ubicación…');
      navigator.geolocation.getCurrentPosition(async (pos) => {
        try {
          const { latitude: lat, longitude: lng } = pos.coords;
          await apiFetch('/api/connect/locate', { method: 'POST', body: JSON.stringify({ lat, lng }) });
          setMe(m => ({ ...m, lat: String(lat), lng: String(lng) }));
          setLocMsg('Ubicación GPS capturada ✓');
        } catch (e) { setLocMsg(e.message); }
        setLocBusy(false);
      }, (err) => { setLocBusy(false); setLocMsg('No se pudo obtener el GPS (' + err.message + ')'); }, { timeout: 10000 });
    };
    const roleLabel = (r) => r === 'mecanico' ? '🔧 Mecánico' : r === 'tienda' ? '🏪 Refaccionaria' : '🚗 Cliente';
    return html`<${MicroShell} title="Conectar Cliente ↔ Mecánico" icon="MapPin" onBack=${onBack}>
      <div class="alert blue" style=${{ marginBottom: '12px' }}><span>Completa tu perfil con tu ubicación y lo que ofreces/buscas. Te mostramos perfiles compatibles por cercanía y similitud.</span></div>
      <div class="conn-me panel" style=${{ padding: '14px', marginBottom: '14px' }}>
        <h3 style=${{ fontSize: '12px', color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '8px' }}>Tu perfil</h3>
        <div class="conn-form grid2">
          <input type="text" class="styled-input" placeholder="Nombre / taller *" value=${me.name} onChange=${e => setMe({ ...me, name: e.target.value })} />
          <select class="styled-input" value=${me.role} onChange=${e => setMe({ ...me, role: e.target.value })}>
            <option value="mecanico">Mecánico</option><option value="cliente">Cliente</option><option value="tienda">Refaccionaria</option>
          </select>
          <input type="email" class="styled-input" placeholder="Correo" value=${me.email} onChange=${e => setMe({ ...me, email: e.target.value })} />
          <input type="tel" class="styled-input" placeholder="Teléfono" value=${me.phone} onChange=${e => setMe({ ...me, phone: e.target.value })} />
          <input type="text" class="styled-input" placeholder="Ciudad *" value=${me.city} onChange=${e => setMe({ ...me, city: e.target.value })} />
          <input type="text" class="styled-input" placeholder="Zona / colonia" value=${me.zone} onChange=${e => setMe({ ...me, zone: e.target.value })} />
          <input type="text" class="styled-input" style=${{ gridColumn: '1 / -1' }} placeholder="Dirección (opcional)" value=${me.address} onChange=${e => setMe({ ...me, address: e.target.value })} />
        </div>
        <div class="grid2" style=${{ marginTop: '8px' }}>
          <input type="text" class="styled-input" placeholder="¿Qué ofreces? (ej. inyección, bombas, frenos)" value=${me.offers} onChange=${e => setMe({ ...me, offers: e.target.value })} />
          <input type="text" class="styled-input" placeholder="¿Qué pides que te ofrezcan? (ej. refacciones, servicios)" value=${me.needs} onChange=${e => setMe({ ...me, needs: e.target.value })} />
        </div>
        <div style=${{ display: 'flex', gap: '8px', marginTop: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="button" class="tool-add-btn" onClick=${save} disabled=${!me.name.trim() || !me.city.trim()}>Guardar perfil</button>
          <button type="button" class="tool-add-btn" onClick=${useGps} disabled=${locBusy}>${locBusy ? '…' : '📍 Usar mi ubicación (GPS)'}</button>
          ${me.lat && me.lng && html`<span class="muted" style=${{ fontSize: '11px' }}>lat ${me.lat}, lng ${me.lng}</span>`}
        </div>
        ${locMsg && html`<div class="muted" style=${{ marginTop: '6px', fontSize: '11px' }}>${locMsg}</div>`}
        ${saved && html`<div class="alert blue" style=${{ marginTop: '10px' }}><span>Perfil guardado. Estos son tus contactos sugeridos:</span></div>`}
      </div>
      ${matched && html`<div class="conn-near">
        <h3 class="conn-title">Contactos sugeridos (cercanos + compatibles)</h3>
        ${matches.filter(p => p.email !== me.email).map(p => html`<div class="conn-item" key=${p.id}>
          <strong>${p.name}</strong>
          <span class="muted">${roleLabel(p.role)} · ${p.city}${p.zone ? ', ' + p.zone : ''}${p.distance_km != null ? ' · a ' + p.distance_km + ' km' : ''}</span>
          ${p.match_score > 0 && html`<span class="match-badge">★ ${p.match_score} coincidencias</span>`}
          <span class="muted" style=${{ fontSize: '11px' }}>${p.offers ? 'Ofrece: ' + p.offers : ''}${p.needs ? ' · Busca: ' + p.needs : ''}</span>
          ${p.phone && html`<a class="link-btn" href=${'tel:' + p.phone}>Llamar</a>`}
        </div>`)}
        ${matches.length === 0 && html`<div class="empty" style=${{ padding: '18px' }}>Aún no hay perfiles compatibles en tu zona. Comparte la app para conectar.</div>`}
      </div>`}
    </${MicroShell}>`;
  };

  /* ---- 19b. Diagnóstico rápido de PSI ---- */
  const QuickDiagApp = ({ onBack }) => {
    const [q, setQ] = useState('');
    const [results, setResults] = useState([]);
    const [sel, setSel] = useState('');
    const [psi, setPsi] = useState('');
    const [verdict, setVerdict] = useState(null);
    const [saved, setSaved] = useState(false);
    const search = async (ev) => {
      const term = (ev?.target?.value || q).trim();
      setQ(term);
      if (term.length < 2) { setResults([]); return; }
      try {
        const rows = await apiFetch(`/api/vehicles?model=${encodeURIComponent(term)}&limit=8`);
        setResults(Array.isArray(rows) ? rows : (rows?.rows || []));
      } catch (e) { /* silencioso */ }
    };
    const run = async () => {
      const v = results.find(x => x.id === Number(sel));
      const measured = parseFloat(psi);
      if (!sel || isNaN(measured) || measured <= 0) return;
      const specMin = v ? Number(v.rail_pressure_psi_min) : null;
      const specMax = v ? Number(v.rail_pressure_psi_max) : null;
      let vd, reasons = [];
      if (specMin == null || specMax == null) {
        vd = 'NO_SPEC';
        reasons = ['Este vehículo no tiene especificación en el catálogo. Verifica el manual de servicio y compara el valor manualmente.'];
      } else if (measured >= specMin && measured <= specMax) {
        vd = 'OK';
        reasons = [`La presión medida (${measured} PSI) está dentro del rango especificado (${specMin}–${specMax} PSI).`, 'El regulador, la bomba y la línea de retorno trabajan correctamente.', 'Puedes continuar con la siguiente prueba del sistema.'];
      } else if (measured < specMin) {
        vd = 'LOW';
        reasons = [`La presión medida (${measured} PSI) está por DEBAJO del mínimo (${specMin} PSI).`, 'Causas probables: cedazo o filtro de combustible tapado, bomba (pila) débil o gastada, regulador abriéndose antes de tiempo, fuga en línea de combustible o regulador, voltaje bajo en el conector de la bomba.'];
      } else {
        vd = 'HIGH';
        reasons = [`La presión medida (${measured} PSI) está POR ENCIMA del máximo (${specMax} PSI).`, 'Causas probables: regulador pegado cerrado, línea de retorno obstruida o doblada, manguera de vacío del regulador sin conexión (referencia errónea).'];
      }
      setVerdict({ vd, reasons, v, measured });
      setSaved(false);
    };
    const saveRun = async () => {
      if (!verdict) return;
      try {
        await apiFetch('/api/diagnostics', { method: 'POST', body: JSON.stringify({
          vehicle_id: verdict.v?.id || null, brand: verdict.v?.brand || null,
          model: verdict.v?.model || null, year: null,
          measured_psi: verdict.measured, spec_min: verdict.v?.rail_pressure_psi_min ?? null,
          spec_max: verdict.v?.rail_pressure_psi_max ?? null, verdict: verdict.vd,
          reasons: verdict.reasons, notes: ''
        }) });
        setSaved(true);
      } catch (e) { alert(e.message); }
    };
    return html`<${MicroShell} title="Diagnóstico Rápido de PSI" icon="Gauge" onBack=${onBack}>
      <div class="alert blue" style=${{ marginBottom: '12px' }}><span>Mide la presión de combustible en la flauta (riel) con la llave en ON, motor apagado. Coloca el vehículo y el valor medido para obtener el veredicto.</span></div>
      <label class="muted" style=${{ display: 'block', fontSize: '10px', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '5px' }}>1. Busca tu vehículo</label>
      <input type="search" class="styled-input" placeholder="Marca / modelo (ej. Corolla, Jetta, Tsuru…)" value=${q} onChange=${search} style=${{ maxWidth: '480px' }} />
      ${results.length > 0 && html`<div class="diag-veh" style=${{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '8px' }}>
        ${results.map(v => html`<label key=${v.id} class="diag-opt" style=${{ display: 'flex', gap: '8px', alignItems: 'center', padding: '8px', border: '1px solid var(--border)', borderRadius: '4px', cursor: 'pointer', fontSize: '13px' }}>
          <input type="radio" name="diag-veh" value=${v.id} checked=${sel === String(v.id)} onChange=${() => setSel(String(v.id))} />
          <span>${v.brand} ${v.model} (${v.year_from}–${v.year_to})</span>
          <span class="muted" style=${{ marginLeft: 'auto' }}>spec ${v.rail_pressure_psi_min}–${v.rail_pressure_psi_max} PSI</span>
        </label>`)}
      </div>`}
      <label class="muted" style=${{ display: 'block', fontSize: '10px', letterSpacing: '1px', textTransform: 'uppercase', margin: '14px 0 5px' }}>2. Presión medida (PSI)</label>
      <div style=${{ display: 'flex', gap: '8px', alignItems: 'center' }}>
        <input type="number" class="styled-input" placeholder="ej. 38" value=${psi} onChange=${e => setPsi(e.target.value)} style=${{ maxWidth: '160px' }} />
        <button type="button" class="tool-add-btn" onClick=${run} disabled=${!sel || !psi}>Diagnosticar</button>
      </div>
      ${verdict && html`<div class="reg-verdict ${verdict.vd === 'OK' ? 'ok' : 'bad'}" style=${{ marginTop: '16px' }}>
        <strong>${verdict.vd === 'OK' ? '✅ SISTEMA EN BUEN ESTADO' : verdict.vd === 'LOW' ? '⚠️ PRESIÓN BAJA (MAL)' : verdict.vd === 'HIGH' ? '⚠️ PRESIÓN ALTA (MAL)' : 'ℹ️ SIN ESPECIFICACIÓN'}</strong>
        <div class="reg-answers">
          ${verdict.reasons.map((r, i) => html`<div class="reg-a" key=${i}>• ${r}</div>`)}
        </div>
        <button type="button" class="tool-add-btn" style=${{ marginTop: '8px' }} onClick=${saveRun} disabled=${saved}>${saved ? 'Guardado ✓' : 'Guardar en historial'}</button>
      </div>`}
    </${MicroShell}>`;
  };

  /* ---- 19c. Documentos: notas de entrega y presupuestos ---- */
  const DocumentsApp = ({ onBack }) => {
    const [docs, api] = useApi('/api/documents');
    const [clients, clientsApi] = useApi('/api/clients');
    const [inventory, invApi] = useApi('/api/inventory');
    const [show, setShow] = useState(false);
    const [f, setF] = useState({ kind: 'entrega', client_id: '', items: [{ descr: '', qty: '1', unit_price: '' }] });
    const setItem = (i, k, v) => setF({ ...f, items: f.items.map((it, idx) => idx === i ? { ...it, [k]: v } : it) });
    const addItem = () => setF({ ...f, items: [...f.items, { descr: '', qty: '1', unit_price: '' }] });
    const rmItem = (i) => setF({ ...f, items: f.items.filter((_, idx) => idx !== i) });
    const pickInv = (i, id) => { const inv = inventory.find(x => x.id === Number(id)); setItem(i, 'descr', inv?.name || ''); setItem(i, 'unit_price', inv?.unit_price || ''); };
    const create = async () => {
      const items = f.items.filter(i => i.descr.trim() && Number(i.qty) > 0).map(i => ({ descr: i.descr.trim(), qty: Number(i.qty), unit_price: Number(i.unit_price) || 0 }));
      if (!items.length) { alert('Agrega al menos un item'); return; }
      try {
        const res = await apiFetch('/api/documents', { method: 'POST', body: JSON.stringify({ kind: f.kind, client_id: f.client_id || null, items }) });
        setShow(false); setF({ kind: 'entrega', client_id: '', items: [{ descr: '', qty: '1', unit_price: '' }] }); api.load();
        window.open(`/api/documents/${res.id}/print`, '_blank');
      } catch (e) { alert(e.message); }
    };
    const setStatus = async (id, st) => {
      try { await apiFetch(`/api/documents/${id}/status`, { method: 'PUT', body: JSON.stringify({ status: st }) }); api.load(); } catch (e) { alert(e.message); }
    };
    const del = async (id) => {
      if (!confirm('¿Eliminar este documento?')) return;
      try { await apiFetch(`/api/documents/${id}`, { method: 'DELETE' }); api.load(); } catch (e) { alert(e.message); }
    };
    const exportCsv = async () => {
      try { const csv = await apiFetch('/api/documents/export?format=csv'); downloadBlob('documentos.csv', csv); } catch (e) { alert(e.message); }
    };
    return html`<${MicroShell} title="Notas de Entrega y Presupuestos" icon="FileText" onBack=${onBack}>
      ${api.err && html`<div class="alert"><span>${api.err}</span></div>`}
      <div style=${{ display: 'flex', gap: '8px', marginBottom: '12px', alignItems: 'center' }}>
        <button type="button" class="tool-add-btn" onClick=${() => setShow(!show)}>${show ? 'Cancelar' : '+ Nuevo documento'}</button>
        <button type="button" class="link-btn" onClick=${exportCsv}>⬇ Exportar CSV</button>
      </div>
      ${show && html`<div class="panel" style=${{ padding: '14px', marginBottom: '12px' }}>
        <div class="grid2">
          <select class="styled-input" value=${f.kind} onChange=${e => setF({ ...f, kind: e.target.value })}>
            <option value="entrega">📦 Nota de entrega</option><option value="presupuesto">🧾 Presupuesto</option>
          </select>
          <select class="styled-input" value=${f.client_id} onChange=${e => setF({ ...f, client_id: e.target.value })}>
            <option value="">Cliente (opcional)…</option>${clients.map(c => html`<option key=${c.id} value=${c.id}>${c.name}</option>`)}
          </select>
        </div>
        <div style=${{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          ${f.items.map((it, i) => html`<div key=${i} class="grid2" style=${{ gap: '6px' }}>
            <div style=${{ display: 'flex', gap: '6px' }}>
              <select class="styled-input" style=${{ maxWidth: '160px' }} value="" onChange=${e => pickInv(i, e.target.value)}>
                <option value="">Inventario…</option>${inventory.map(x => html`<option key=${x.id} value=${x.id}>${x.name}</option>`)}
              </select>
              <input type="text" class="styled-input" placeholder="Descripción" value=${it.descr} onChange=${e => setItem(i, 'descr', e.target.value)} />
            </div>
            <div style=${{ display: 'flex', gap: '6px' }}>
              <input type="number" class="styled-input" style=${{ maxWidth: '70px' }} placeholder="Cant." value=${it.qty} onChange=${e => setItem(i, 'qty', e.target.value)} />
              <input type="number" class="styled-input" style=${{ maxWidth: '100px' }} placeholder="Precio" value=${it.unit_price} onChange=${e => setItem(i, 'unit_price', e.target.value)} />
              <button type="button" class="link-btn" onClick=${() => rmItem(i)}>✕</button>
            </div>
          </div>`)}
        </div>
        <div style=${{ display: 'flex', gap: '8px', marginTop: '10px', alignItems: 'center' }}>
          <button type="button" class="link-btn" onClick=${addItem}>+ Agregar item</button>
          <button type="button" class="tool-add-btn" onClick=${create} disabled=${!f.items.some(i => i.descr.trim())}>Crear y abrir</button>
        </div>
      </div>`}
      <div class="doc-list" style=${{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        ${docs.map(d => html`<div class="order-item" key=${d.id}>
          <div class="order-head">
            <strong>${d.kind === 'entrega' ? '📦' : '🧾'} ${d.number}</strong>
            ${d.client_name && html`<span class="muted">· ${d.client_name}</span>`}
            <span class="order-date">${new Date(d.created_at).toLocaleDateString('es')}</span>
          </div>
          <div class="order-desc">${d.status} · Total $${Number(d.total || 0).toFixed(2)}</div>
          <div class="order-foot">
            <select class="order-status" value=${d.status} onChange=${e => setStatus(d.id, e.target.value)}>
              <option>borrador</option><option>emitido</option><option>aprobado</option><option>rechazado</option><option>entregado</option>
            </select>
            <button type="button" class="link-btn" onClick=${() => window.open(`/api/documents/${d.id}/print`, '_blank')}>🖨 Imprimir</button>
            <button type="button" class="link-btn" onClick=${() => del(d.id)}>eliminar</button>
          </div>
        </div>`)}
        ${docs.length === 0 && !api.loading && html`<div class="empty">Sin documentos. Crea una nota de entrega o presupuesto.</div>`}
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
    ForumApp, ConnectApp, QuickDiagApp, DocumentsApp, MarketApp, TimingApp,
  };
})();
