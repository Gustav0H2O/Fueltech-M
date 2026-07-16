/* FuelTech Master — Dashboard (React 18 + htm + Three.js) */
const { useState, useEffect, useRef } = React;
const html = htm.bind(React.createElement);

const api = (url) => fetch(url).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); });

/* Icono Lucide montado como SVG (espera a que window.lucide esté listo).
   Sin aria-label => decorativo (aria-hidden); con aria-label => icono con significado propio. */
function Icon({ name, size = 16, className = '', spin = false, label }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current || !window.lucide || !window.lucide[name]) return;
    ref.current.innerHTML = '';
    const attrs = { width: size, height: size };
    if (label) { attrs.role = 'img'; attrs['aria-label'] = label; }
    else attrs['aria-hidden'] = 'true';
    const svg = window.lucide.createElement(window.lucide[name], attrs);
    ref.current.appendChild(svg);
  }, [name, size, label]);
  return html`<span class=${'icon' + (spin ? ' spin' : '') + (className ? ' ' + className : '')} ref=${ref}></span>`;
}

/* Monta un visor 3D de three3d.js dentro de un div (espera a que FT3D esté listo) */
function use3D(builder, deps) {
  const ref = useRef(null);
  useEffect(() => {
    let disposed = false, cleanup = null;
    const mount = () => {
      if (disposed || !ref.current || !window.FT3D) return;
      try { cleanup = builder(ref.current, window.FT3D); }
      catch (e) { ref.current.innerHTML = '<div class="empty">Tu navegador no soporta WebGL</div>'; }
    };
    if (window.FT3D) mount();
    else window.addEventListener('ft3d-ready', mount, { once: true });
    return () => { disposed = true; if (cleanup) cleanup(); };
  }, deps);
  return ref;
}

const ZONE_SHORT = {
  rear_seat: 'BAJO ASIENTO TRASERO', trunk_access: 'REGISTRO EN CAJUELA',
  tank_drop: 'DENTRO DEL TANQUE', frame_rail: 'BOMBA EXTERNA',
};

/* Cada ensamble es distinto en la realidad — el título de la ficha lo refleja */
const ASSEMBLY_LABEL = {
  external:          'Bomba externa (no lleva módulo en tanque)',
  hanger_tbi:        'Colgante TBI (porta-pila, no regula)',
  hanger_return:     'Colgante (regulador en riel)',
  module_returnless: 'Módulo integrado sin retorno',
  vortec:            'Módulo Vortec (regulador en unidad CSFI)',
  gdi_low:           'Módulo GDI de baja presión',
};

/* ---------- Visores 3D ---------- */
function Car3D({ zone, psiText, body }) {
  const ref = use3D((el, FT3D) => FT3D.car(el, { zone, psiText, zoneLabel: ZONE_SHORT[zone], body }), [zone, psiText, body]);
  return html`<div class="v3d" ref=${ref}></div>`;
}
function Module3D({ kind }) {
  const ref = use3D((el, FT3D) => FT3D.module(el, { kind }), [kind]);
  return html`<div class="v3d" ref=${ref}></div>`;
}
function Pump3D({ psi, style, code }) {
  const ref = use3D((el, FT3D) => FT3D.pump(el, { psi, style, code }), [psi, code]);
  return html`<div class="v3d" ref=${ref}></div>`;
}

/* ---------- Tarjeta de pila (detalle de vehículo) ---------- */
function PumpCard({ pump }) {
  return html`
    <div class="pump-card">
      <h4>${pump.code} · ${pump.manufacturer}
        <span class=${pump.is_oem ? 'chip oem' : 'chip alt'}>
          ${pump.is_oem && html`<${Icon} name="BadgeCheck" size=${11} />`}
          ${pump.is_oem ? 'OEM' : pump.fitment.toUpperCase()}
        </span>
      </h4>
      <${Pump3D} psi=${pump.max_psi_direct} style=${pump.pump_style} code=${pump.code} />
      <dl class="kv">
        <dt>Presión máx. directa</dt><dd class="psi">${pump.max_psi_direct} PSI (${pump.max_bar_direct} bar)</dd>
        <dt>Consumo</dt><dd>${pump.amperage_a} A @ ${pump.voltage_v} V · ${pump.flow_lph_free || '—'} LPH libre</dd>
        <dt>Polaridad</dt><dd>${pump.polarity_desc}</dd>
        <dt>Entrada</dt><dd>${pump.inlet_desc}</dd>
        <dt>Salida</dt><dd>${pump.outlet_desc}</dd>
      </dl>
      ${pump.fitment_notes && html`<div class="alert"><${Icon} name="AlertTriangle" size=${14} />${pump.fitment_notes}</div>`}
    </div>`;
}

/* ---------- Detalle del vehículo (vista en vivo, siempre junto al buscador) ---------- */
function VehicleDetail({ id }) {
  const [v, setV] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    // el error se limpia al cambiar de vehículo, y una respuesta vieja no pisa a la nueva
    let alive = true;
    setV(null); setErr(null);
    api(`/api/vehicles/${id}`).then(d => alive && setV(d)).catch(e => alive && setErr(e));
    return () => { alive = false; };
  }, [id]);
  if (err) return html`<div class="empty" aria-live="polite">ERROR CARGANDO EL VEHÍCULO — INTENTA DE NUEVO</div>`;
  if (!v) return html`<div class="empty" aria-live="polite">CARGANDO FICHA TÉCNICA…</div>`;

  const psiText = `${v.rail_pressure.psi_min}–${v.rail_pressure.psi_max}`;
  const multiModule = v.modules.length > 1;

  // Compartir la ficha = distribución gratis (cada envío por WhatsApp trae usuarios nuevos)
  const shareUrl = `${location.origin}/vehiculo/${v.slug || ''}`;
  const shareMsg = `${v.brand} ${v.model} — ${psiText} PSI. Ficha técnica en FuelTech Master:`;
  const shareWhatsApp = () => window.open(`https://wa.me/?text=${encodeURIComponent(shareMsg + ' ' + shareUrl)}`, '_blank', 'noopener');
  const shareNative = async () => {
    try {
      if (navigator.share) await navigator.share({ title: 'FuelTech Master', text: shareMsg, url: shareUrl });
      else { await navigator.clipboard.writeText(shareUrl); }
    } catch (e) { /* cancelado por el usuario */ }
  };
  const shareBtn = {
    display: 'inline-flex', alignItems: 'center', gap: '7px', font: '700 11px var(--font)',
    letterSpacing: '1px', textTransform: 'uppercase', background: 'transparent', color: 'var(--red)',
    border: '1px solid var(--red-dim)', borderRadius: '2px', padding: '9px 14px', cursor: 'pointer'
  };

  return html`
    <div>
      <div class="panel">
        <div class="vh-head">
          <h2>${v.brand} ${v.model}</h2>
          <span class=${'badge ' + v.injection.code}>${v.injection.name}</span>
          ${!v.data_verified && html`<span class="badge unverified"><${Icon} name="AlertTriangle" size=${11} /> NO VERIFICADO</span>`}
          <span class="muted">${v.years} · ${v.engine}</span>
        </div>
        <p class="muted" style=${{ marginTop: '6px' }}>${v.injection.description}</p>
        <div class="bignum">${psiText} PSI
          <small> (${v.rail_pressure.bar_min}–${v.rail_pressure.bar_max} bar) en flauta / riel de inyectores</small>
        </div>
        ${v.notes && html`<div class="alert"><${Icon} name="AlertTriangle" size=${14} />${v.notes}</div>`}
        <div style=${{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '14px' }}>
          <button type="button" onClick=${shareWhatsApp} style=${shareBtn} title="Compartir esta ficha por WhatsApp"><${Icon} name="Share2" size=${14} /> Compartir</button>
          <button type="button" onClick=${shareNative} style=${shareBtn} title="Copiar enlace de esta ficha"><${Icon} name="Link2" size=${14} /> Copiar enlace</button>
          <button type="button" onClick=${() => window.print()} style=${shareBtn} title="Imprimir o guardar como PDF"><${Icon} name="Printer" size=${14} /> Imprimir / PDF</button>
        </div>
      </div>

      ${v.modules.map((m, i) => html`
        <div key=${m.id}>
          ${multiModule && html`<p class="kv-sub mt" style=${{ marginTop: '16px' }}>Módulo ${i + 1} de ${v.modules.length} — ${ZONE_SHORT[m.location.zone] || m.code}</p>`}
          <div class="grid2 mt">
            <div class="panel">
              <h2>Ubicación del módulo</h2>
              <!-- primero el dato que decide el trabajo: ¿hay que bajar el tanque o no? -->
              ${m.location.requires_tank_removal
                ? html`<span class="tank-flag drop"><${Icon} name="ArrowDownToLine" size=${13} /> Requiere bajar el tanque</span>`
                : html`<span class="tank-flag nodrop"><${Icon} name="CheckCircle2" size=${13} /> Sin bajar tanque</span>`}
              <${Car3D} zone=${m.location.zone} psiText=${psiText} body=${v.body_type} />
              <p style=${{ marginTop: '12px' }}>${m.location.text}</p>
              ${m.location.access_notes && html`<div class="alert blue"><${Icon} name="Info" size=${14} />${m.location.access_notes}</div>`}
            </div>

            <div class="panel">
              <h2>${ASSEMBLY_LABEL[m.assembly_type] || 'Módulo'} · ${m.code}</h2>
              <${Module3D} kind=${m.diagram_key} />
              <dl class="kv">
                <dt class="kv-sub">Funcional</dt>
                <dt>${m.assembly_type === 'hanger_tbi' || m.assembly_type === 'hanger_return' || m.assembly_type === 'external'
                  ? 'Presión de trabajo' : 'Presión regulada'}</dt>
                <dd class="psi">${m.specs.regulated_psi} PSI (${m.specs.regulated_bar} bar)</dd>
                <dt>Flujo</dt><dd>${m.specs.flow_lph} LPH</dd>
                <dt class="kv-sub">Mecánico</dt>
                <dt>Regulador</dt><dd>${m.specs.regulator_type}</dd>
                <dt>Flotador</dt><dd>${m.specs.float_type}</dd>
                <dt>Cedazo / filtro</dt><dd>${m.specs.strainer_ref}</dd>
                <dt>Conector</dt><dd>${m.specs.connector_desc}</dd>
                ${m.specs.lines_desc && html`<dt>Líneas</dt><dd>${m.specs.lines_desc}</dd>`}
                ${m.specs.mount_desc && html`<dt>Sujeción</dt><dd>${m.specs.mount_desc}</dd>`}
              </dl>
            </div>
          </div>

          <div class="panel mt">
            <h2>Pilas compatibles — ${m.compatible_pumps.length}</h2>
            <div class="grid2">
              ${[...m.compatible_pumps].sort((a, b) => (b.is_oem ? 1 : 0) - (a.is_oem ? 1 : 0))
                .map(p => html`<${PumpCard} key=${p.id} pump=${p} />`)}
            </div>
          </div>
        </div>`)}
    </div>`;
}

/* ---------- Isotipo FT (marca propia, sin logos de terceros) ---------- */
const LogoSVG = () => html`
  <svg class="logo-ft" viewBox="0 0 70 46" xmlns="http://www.w3.org/2000/svg">
    <g transform="skewX(-8)">
      <text x="2" y="34" font-family="Montserrat, system-ui, -apple-system, sans-serif" font-weight="800" font-size="36" fill="var(--text)" letter-spacing="-2">F</text>
      <text x="27" y="34" font-family="Montserrat, system-ui, -apple-system, sans-serif" font-weight="800" font-size="36" fill="var(--red)" letter-spacing="-2">T</text>
      <polygon points="2,39 48,39 44,45 -2,45" fill="var(--red)"/>
    </g>
  </svg>`;

/* Lee filtros y vehículo seleccionado desde la URL para que una búsqueda o ficha sea compartible/marcable */
function readURLState() {
  const p = new URLSearchParams(location.search);
  // En las páginas SEO (/vehiculo/slug) el servidor inyecta data-vehicle en #root,
  // así la app arranca directo en ese vehículo aunque no haya ?v= en la URL.
  const rootEl = document.getElementById('root');
  const dataV = rootEl && rootEl.dataset ? rootEl.dataset.vehicle : '';
  return {
    filters: {
      brand_id: p.get('brand_id') || '',
      model: p.get('model') || '',
      year: p.get('year') || '',
      injection_type_id: p.get('injection_type_id') || '',
      order_by: p.get('order_by') || ''
    },
    selected: p.get('v') ? Number(p.get('v')) : (dataV ? Number(dataV) : null),
  };
}

/* ---------- Chatbot flotante con IA ---------- */

// Genera un identificador único de dispositivo que persiste en localStorage
function getDeviceId() {
  let id = localStorage.getItem('ft_device_id');
  if (!id) {
    const arr = new Uint8Array(16);
    crypto.getRandomValues(arr);
    id = Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
    localStorage.setItem('ft_device_id', id);
  }
  return id;
}
const DEVICE_ID = getDeviceId();

function ChatBot({ vehicleId }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [noKey, setNoKey] = useState(false);
  const [remaining, setRemaining] = useState(null);
  const [limitReached, setLimitReached] = useState(false);
  const chatRef = useRef(null);
  const inputRef = useRef(null);

  // auto-scroll al último mensaje
  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [messages]);

  // enfocar input al abrir
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 300);
  }, [open]);

  const send = async (textOverride) => {
    const text = (textOverride || input).trim();
    if (!text || loading || limitReached) return;
    setInput('');
    setNoKey(false);

    const userMsg = { role: 'user', content: text };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          deviceId: DEVICE_ID,
          history: messages.slice(-4),
          vehicleId
        })
      });
      const data = await res.json();

      if (data.limitReached) {
        setLimitReached(true);
        setRemaining(0);
        setMessages(prev => [...prev, { role: 'assistant', content: '⚠️ ' + data.message }]);
      } else if (data.noKey) {
        setNoKey(true);
        setMessages(prev => [...prev, { role: 'assistant', content: '⚠️ Chat no disponible en este momento.' }]);
      } else if (data.error) {
        setMessages(prev => [...prev, { role: 'assistant', content: '⚠️ ' + data.error }]);
      } else {
        setRemaining(data.remaining);
        if (data.response) {
          setMessages(prev => [...prev, { role: 'assistant', content: data.response }]);
        }
        if (data.remaining <= 0) setLimitReached(true);
      }
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: '⚠️ Error de conexión. Verifica tu conexión a internet.' }]);
    }
    setLoading(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };

  return html`
    <${React.Fragment}>
      <!-- Botón flotante -->
      <button type="button" class="chat-fab" onClick=${() => setOpen(!open)}
              aria-label=${open ? 'Cerrar chat' : 'Abrir chat de IA'}>
        <${Icon} name=${open ? 'X' : 'Bot'} size=${22} />
      </button>

      <!-- Panel de chat -->
      ${open && html`
        <div class="chat-panel" role="dialog" aria-label="Chat de asistencia automotriz">
          <div class="chat-head">
            <${Icon} name="Bot" size=${18} label="Asistente IA" />
            <span>Asistente Técnico</span>
            ${remaining !== null && html`<span class="chat-remaining">${remaining}/3</span>`}
            <button type="button" class="chat-close" onClick=${() => setOpen(false)} aria-label="Cerrar">
              <${Icon} name="X" size=${16} />
            </button>
          </div>
          <div class="chat-body" ref=${chatRef}>
            ${limitReached && html`
              <div class="chat-limit-bar">
                <${Icon} name="AlertTriangle" size=${13} />
                Límite de 3 consultas alcanzado por hoy. Vuelve mañana.
              </div>
            `}
            ${messages.length === 0 && !limitReached && html`
              <div class="chat-empty">
                <${Icon} name="Bot" size=${28} />
                <p>Pregúntame sobre especificaciones técnicas de combustible</p>
                <div class="chat-suggestions">
                  <button type="button" onClick=${() => send('¿Qué PSI necesita un Tsuru III?')}>¿PSI del Tsuru?</button>
                  <button type="button" onClick=${() => send('¿Cómo identificar una pila OEM?')}>¿Pila OEM?</button>
                  <button type="button" onClick=${() => send('¿Dónde está el módulo de gasolina del Jetta?')}>Ubicación módulo Jetta</button>
                  <button type="button" onClick=${() => send('¿Qué presión debe tener un sistema Vortec?')}>Presión Vortec</button>
                </div>
                ${noKey && html`<p class="chat-warn">⚠️ Chat no disponible</p>`}
              </div>
            `}
            ${messages.map((m, i) => html`
              <div key=${i} class=${'chat-msg ' + (m.role === 'user' ? 'user' : 'bot')}>
                ${m.role === 'bot' && html`<div class="chat-avatar"><${Icon} name="Bot" size=${14} /></div>`}
                <div class="chat-bubble">${m.content}</div>
              </div>
            `)}
            ${loading && html`
              <div class="chat-msg bot">
                <div class="chat-avatar"><${Icon} name="Bot" size=${14} /></div>
                <div class="chat-bubble thinking">
                  <span class="dot-pulse"></span>
                </div>
              </div>
            `}
          </div>
          <div class="chat-foot">
            <input ref=${inputRef} type="text" class="chat-input"
                   placeholder=${limitReached ? 'Límite alcanzado' : 'Pregunta sobre presión, módulos, pilas…'}
                   value=${input} onChange=${(e) => setInput(e.target.value)}
                   onKeyDown=${handleKeyDown} maxLength=${500}
                   disabled=${loading || limitReached} />
            <button type="button" class="chat-send" onClick=${() => send()}
                    disabled=${!input.trim() || loading || limitReached}
                    aria-label="Enviar mensaje">
              <${Icon} name="Send" size=${16} />
            </button>
          </div>
        </div>
      `}
    </${React.Fragment}>`;
}

/* ---------- App: panel de búsqueda lateral + ficha en vivo ---------- */
function App() {
  const initialURL = useRef(readURLState()).current;
  const [meta, setMeta] = useState(null);
  const [metaErr, setMetaErr] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const abortCtrlRef = useRef(null);
  
  // ── Estado del buscador (FALTABA: sin esto la app no funciona) ──
  const [filters, setFilters] = useState(initialURL.filters);
  const [results, setResults] = useState(null);
  const [searchErr, setSearchErr] = useState(false);
  const [selected, setSelected] = useState(initialURL.selected);
  const seqRef = useRef(0);
  const listRef = useRef(null);
  const modelInputRef = useRef(null);
  const pendingURLSelectedRef = useRef(initialURL.selected);
  const scrollList = (dir) => () => listRef.current?.scrollBy({ left: dir * 400, behavior: 'smooth' });
  
  // Consentimiento de privacidad
  const [showPrivacy, setShowPrivacy] = useState(false);
  useEffect(() => { if (!localStorage.getItem('ft_privacy_ok')) setShowPrivacy(true); }, []);
  const acceptPrivacy = () => { localStorage.setItem('ft_privacy_ok', '1'); setShowPrivacy(false); };

  function search() {
    if (abortCtrlRef.current) abortCtrlRef.current.abort();
    abortCtrlRef.current = new AbortController();
    const signal = abortCtrlRef.current.signal;
    const seq = ++seqRef.current;
    
    setIsSearching(true);
    const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString();
    return fetch(`/api/vehicles?${qs}`, { signal })
      .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(rows => { if (seq === seqRef.current) { setResults(rows); setSearchErr(false); setIsSearching(false); } })
      .catch((e) => { 
        if (e.name === 'AbortError') return;
        if (seq === seqRef.current) { setResults([]); setSearchErr(true); setIsSearching(false); } 
      });
  }

  useEffect(() => { api('/api/meta').then(setMeta).catch(() => setMetaErr(true)); }, []);

  // registra la visita (1 vez por visitante por día; el servidor deduplica sin guardar IPs)
  // respeta Do-Not-Track
  useEffect(() => {
    if (navigator.doNotTrack === '1') return;
    fetch('/api/visit', { method: 'POST' }).catch(() => {});
  }, []);

  // búsqueda en vivo: cada cambio de filtro relanza la búsqueda (debounce corto)
  useEffect(() => {
    const t = setTimeout(search, 400);
    return () => clearTimeout(t);
  }, [filters]);

  // el panel derecho sigue automáticamente al primer resultado de cada nueva búsqueda,
  // salvo que el vehículo ya seleccionado siga estando en la lista o venga marcado en la URL (?v=)
  useEffect(() => {
    if (!results) return;
    if (results.length === 0) { setSelected(null); return; }
    setSelected(sel => {
      if (sel && results.some(r => r.id === sel)) return sel;
      const fromURL = pendingURLSelectedRef.current;
      pendingURLSelectedRef.current = null;
      if (fromURL && results.some(r => r.id === fromURL)) return fromURL;
      return results[0].id;
    });
  }, [results]);

  // mantiene la búsqueda/ficha actual reflejada en la URL para poder compartirla o recargar sin perderla.
  // En la PRIMERA carga no reescribimos la URL: así se conserva el enlace bonito /vehiculo/... con el
  // que llegó el usuario (importante para SEO y para compartir).
  const urlSyncedOnce = useRef(false);
  useEffect(() => {
    if (!urlSyncedOnce.current) { urlSyncedOnce.current = true; return; }
    const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v));
    if (selected) qs.set('v', selected);
    const next = qs.toString();
    // desde una página /vehiculo/... la app pasa a usar URLs de sesión con base "/"
    const base = location.pathname.startsWith('/vehiculo') ? '/' : location.pathname;
    const url = next ? `${base}?${next}` : base;
    if (url !== location.pathname + location.search) {
      history.pushState(null, '', url);
    }
  }, [filters, selected]);

  // Soporte para botón atrás del navegador
  useEffect(() => {
    const onPopState = () => {
      const state = readURLState();
      setFilters(state.filters);
      setSelected(state.selected);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const set = (k) => (e) => setFilters(f => ({ ...f, [k]: e.target.value }));
  const clearFilters = () => setFilters({ brand_id: '', model: '', year: '', injection_type_id: '', order_by: '' });

  // Manejador del correo para evitar raspado de bots
  const handleEmailClick = (e) => {
    e.preventDefault();
    window.location.href = 'mailto:' + 'newpersonal98' + '@' + 'gmail.com';
  };

  // atajos de teclado para uso frecuente en taller: "/" enfoca la búsqueda, Escape la limpia
  useEffect(() => {
    const onKeyDown = (e) => {
      const typing = ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName);
      if (e.key === '/' && !typing) { e.preventDefault(); modelInputRef.current?.focus(); }
      else if (e.key === 'Escape' && typing) { document.activeElement.blur(); clearFilters(); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return html`
    <div class="app-shell">
      <!-- Panel de filtros: siempre fijo al lado -->
      <aside class="search-pane">
        <div class="logo-block">
          <${LogoSVG} />
          <div class="brand-text">
            <h1 class="title">FUEL<span>TECH</span></h1>
            <div class="subtitle">MASTER</div>
          </div>
        </div>

        <div class="panel">
          <h2>Filtros de búsqueda</h2>
          <div class="filters">
            <div><label htmlFor="f-brand"><${Icon} name="Tag" size=${13} /> Marca</label>
              <select id="f-brand" name="brand" autocomplete="off" title="Filtra por marca del vehículo" value=${filters.brand_id} onChange=${set('brand_id')}>
                <option value="">Todas</option>
                ${meta?.brands.map(b => html`<option key=${b.id} value=${b.id}>${b.name}</option>`)}
              </select></div>
            <div><label htmlFor="f-model"><${Icon} name="Car" size=${13} /> Modelo</label>
              <input id="f-model" name="model" autocomplete="off" placeholder="Tsuru, Jetta…" maxLength="60" title="Buscar por modelo, ej. Tsuru, Silverado, Jetta (atajo: /)"
                     ref=${modelInputRef} value=${filters.model} onChange=${set('model')} /></div>
            <div><label htmlFor="f-year"><${Icon} name="Calendar" size=${13} /> Año</label>
              <input id="f-year" name="year" autocomplete="off" type="number" inputMode="numeric"
                     min=${meta?.year_range.min} max=${meta?.year_range.max}
                     placeholder=${meta ? `${meta.year_range.min}–${meta.year_range.max}` : ''}
                     title=${meta ? `Año del modelo, entre ${meta.year_range.min} y ${meta.year_range.max}` : 'Año del modelo'}
                     value=${filters.year} onChange=${set('year')} /></div>
            <div><label htmlFor="f-inj"><${Icon} name="Droplet" size=${13} /> Tipo de Inyección</label>
              <select id="f-inj" name="injection_type" autocomplete="off" title="Filtra por tipo de sistema de inyección de combustible" value=${filters.injection_type_id} onChange=${set('injection_type_id')}>
                <option value="">Todas</option>
                ${meta?.injection_types.map(t => html`<option key=${t.id} value=${t.id}>${t.name}</option>`)}
              </select></div>
            <div><label htmlFor="f-ord"><${Icon} name="ArrowUpDown" size=${13} /> Ordenar por</label>
              <select id="f-ord" name="order_by" autocomplete="off" title="Orden de los resultados" value=${filters.order_by} onChange=${set('order_by')}>
                <option value="">Marca, Modelo, Año</option>
                <option value="psi_desc">Presión (Mayor a Menor)</option>
                <option value="year_desc">Año (Más reciente)</option>
              </select></div>
            <button type="button" title="Limpiar filtros (Esc)" onClick=${clearFilters}>Limpiar filtros</button>
          </div>
          ${metaErr && html`<div class="alert"><${Icon} name="AlertTriangle" size=${14} /> Error al cargar catálogos. Verifica tu conexión.</div>`}
        </div>

        <div class="app-footer">
          <div class="footer-brand">FUEL<span>TECH</span> MASTER</div>
          <div class="footer-desc">Catálogo técnico de módulos y pilas de gasolina</div>
          <div class="footer-copy">© 2025–2026 FuelTech Master. Todos los derechos reservados.</div>
          <div class="dev-contact">
            <${Icon} name="Mail" size=${13} />
            <a href="#" onClick=${handleEmailClick} title="Enviar correo a newpersonal98@gmail.com">¿Quieres un desarrollo similar? Contáctame: <b>newpersonal98@gmail.com</b></a>
          </div>
        </div>
      </aside>

      <!-- Resultados + ficha técnica: misma pantalla, sin navegar -->
      <div class="content-pane" id="main-content">
        <div class="results-strip">
          <div class="rs-head">
            <h2>Vehículos encontrados</h2>
            <div class="result-count" aria-live="polite">
              ${isSearching ? html`<span style=${{color: 'var(--red)', marginRight: '6px'}}><${Icon} name="Loader2" size=${12} spin=${true} /></span>` : ''}
              ${results ? html`<b>${results.length}</b> resultado(s)` : 'Cargando vehículos…'}
              ${results?.some(r => !r.data_verified) &&
                html`<span class="legend-est" title="Dato estimado por clase de sistema, aún sin confirmar contra el manual de servicio del vehículo">${' · '}<em class="r-est">EST.</em> = sin verificar</span>`}
              ${(filters.brand_id || filters.model || filters.year || filters.injection_type_id) &&
                html`<span> · <button type="button" class="link-btn" onClick=${clearFilters}>limpiar filtros</button></span>`}
            </div>
          </div>
          <div class="result-row">
            ${results?.length > 0 && html`<button type="button" class="rl-nav prev" aria-label="Desplazar a la izquierda" onClick=${scrollList(-1)}><${Icon} name="ChevronLeft" size=${20} /></button>`}
            <div class="result-list" ref=${listRef} role="listbox" aria-label="Vehículos encontrados">
              ${results?.map(r => html`
                <button key=${r.id} type="button" role="option" aria-selected=${selected === r.id}
                        class=${'result-item' + (selected === r.id ? ' active' : '')} onClick=${() => setSelected(r.id)}>
                  <div class="r-name">${r.brand} ${r.model}</div>
                  <div class="r-meta">
                    <span>${r.year_from}–${r.year_to} · ${r.injection_code.replace('_CSFI', '')}</span>
                    <span class="r-psi">${r.rail_pressure_psi_max} PSI
                      ${!r.data_verified && html`<em class="r-est" title="Specs estimadas, sin verificar contra manual">EST.</em>`}
                    </span>
                  </div>
                </button>`)}
              ${results?.length === 0 && html`<div class="empty-state" aria-live="polite">
                ${searchErr
                  ? html`<${Icon} name="WifiOff" size=${22} /><p>ERROR DE CONEXIÓN — REINTENTA EN UNOS SEGUNDOS</p>`
                  : html`
                    <${Icon} name="SearchX" size=${22} />
                    <p>No se encontraron vehículos con estos filtros.</p>
                    <p class="hint">Intenta ampliar tu búsqueda: quita la marca, el año o el tipo de inyección.</p>
                    <button type="button" onClick=${clearFilters}><${Icon} name="FilterX" size=${14} /> Limpiar filtros</button>`}
              </div>`}
            </div>
            ${results?.length > 0 && html`<button type="button" class="rl-nav next" aria-label="Desplazar a la derecha" onClick=${scrollList(1)}><${Icon} name="ChevronRight" size=${20} /></button>`}
          </div>
        </div>

        <div class="preview-inner">
          ${selected
            ? html`<${VehicleDetail} id=${selected} />`
            : html`<div class="empty">SELECCIONA UN VEHÍCULO PARA VER SU FICHA TÉCNICA</div>`}
        </div>
      </div>
      <${ChatBot} vehicleId=${selected} />
      ${showPrivacy && html`<div class="panel" style=${{ position: 'fixed', bottom: '20px', right: '20px', zIndex: 100, maxWidth: '320px', padding: '16px' }}>
        <h3 style=${{fontSize: '13px', color: 'var(--text)', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px'}}>
          <${Icon} name="ShieldCheck" size=${16} color="var(--red)" /> Privacidad y Cookies
        </h3>
        <p style=${{fontSize: '11.5px', color: 'var(--muted)', marginBottom: '14px', lineHeight: 1.4}}>
          Utilizamos almacenamiento local para recordar tus preferencias y estadísticas anónimas (respetamos Do-Not-Track). Al continuar navegando, aceptas nuestra política.
        </p>
        <button type="button" onClick=${acceptPrivacy} style=${{background: 'var(--red)', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: '4px', cursor: 'pointer', fontSize: '11.5px', fontWeight: 600, width: '100%'}}>Entendido</button>
      </div>`}
    </div>`;
}

ReactDOM.createRoot(document.getElementById('root')).render(html`<${App} />`);

// PWA: registra el service worker (offline + instalable). Estrategia network-first,
// sin riesgo de servir versiones viejas del código.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
