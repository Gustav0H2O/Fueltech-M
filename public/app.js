/* FuelTech Master — Dashboard (React 18 + htm + Three.js) */
const { useState, useEffect, useRef } = React;
const html = htm.bind(React.createElement);

const api = (url) => fetch(url).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); });

/* Evento a Google Analytics (si está cargado). Silencioso si no. */
const track = (name, params) => { try { if (window.gtag) window.gtag('event', name, params || {}); } catch (e) {} };

/* Mi Garage: favoritos locales (sin cuenta). Persisten en el navegador del mecánico. */
const GARAGE_KEY = 'ft_garage';
const getGarage = () => { try { return JSON.parse(localStorage.getItem(GARAGE_KEY) || '[]'); } catch (e) { return []; } };
const saveGarage = (arr) => { localStorage.setItem(GARAGE_KEY, JSON.stringify(arr.slice(0, 50))); window.dispatchEvent(new Event('ft-garage-change')); };
const toggleGarage = (veh) => {
  const g = getGarage();
  const i = g.findIndex(x => x.id === veh.id);
  if (i >= 0) g.splice(i, 1); else g.unshift(veh);
  saveGarage(g);
  track(i >= 0 ? 'garage_quitar' : 'garage_guardar', {});
};
function useGarage() {
  const [g, setG] = useState(getGarage);
  useEffect(() => {
    const h = () => setG(getGarage());
    window.addEventListener('ft-garage-change', h);
    window.addEventListener('storage', h);
    return () => { window.removeEventListener('ft-garage-change', h); window.removeEventListener('storage', h); };
  }, []);
  return g;
}

/* ---------- Tema (auto / claro / oscuro) ----------
   El script inline del <head> ya aplicó la preferencia antes del primer pintado;
   aquí solo se lee y se cambia. 'auto' se guarda quitando el atributo para que
   vuelva a mandar el media query del CSS y siga a los cambios del sistema. */
const THEME_KEY = 'ft_theme';
const getTheme = () => { try { return localStorage.getItem(THEME_KEY) || 'auto'; } catch (e) { return 'auto'; } };
const applyTheme = (t) => {
  const el = document.documentElement;
  if (t === 'auto') el.removeAttribute('data-theme');
  else el.setAttribute('data-theme', t);
  try { localStorage.setItem(THEME_KEY, t); } catch (e) { /* modo privado */ }
  // La barra del navegador/PWA no lee variables CSS: hay que darle el color ya resuelto.
  const dark = t === 'dark' || (t === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelectorAll('meta[name="theme-color"]').forEach(m => m.remove());
  const meta = document.createElement('meta');
  meta.name = 'theme-color';
  meta.content = dark ? '#0F1113' : '#F4F5F2';
  document.head.appendChild(meta);
  window.dispatchEvent(new Event('ft-theme-change'));
};

function ThemeSwitch() {
  const [theme, setTheme] = useState(getTheme);
  const pick = (t) => { applyTheme(t); setTheme(t); track('tema_cambiar', { tema: t }); };
  const opt = (id, icon, label) => html`
    <button type="button" onClick=${() => pick(id)} aria-pressed=${theme === id} title=${'Tema ' + label}>
      <${Icon} name=${icon} size=${13} /> <span>${label}</span>
    </button>`;
  return html`
    <div class="theme-switch" role="group" aria-label="Tema de la interfaz">
      ${opt('auto', 'Monitor', 'Auto')}
      ${opt('light', 'Sun', 'Claro')}
      ${opt('dark', 'Moon', 'Oscuro')}
    </div>`;
}

/* ---------- Avisos efímeros ----------
   Copiar el enlace o guardar en el garage no cambiaba nada visible; sin acuse
   el mecánico repite el gesto sin saber si funcionó. Se emiten con un evento
   para poder avisar desde cualquier componente sin pasar props por toda la app. */
const toast = (text) => window.dispatchEvent(new CustomEvent('ft-toast', { detail: text }));

function ToastStack() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    let n = 0;
    const onToast = (e) => {
      const id = ++n;
      setItems(list => [...list, { id, text: e.detail }]);
      setTimeout(() => setItems(list => list.filter(t => t.id !== id)), 2600);
    };
    window.addEventListener('ft-toast', onToast);
    return () => window.removeEventListener('ft-toast', onToast);
  }, []);
  if (!items.length) return null;
  // aria-live: el lector de pantalla anuncia el acuse sin robar el foco
  return html`
    <div class="toast-stack" role="status" aria-live="polite">
      ${items.map(t => html`<div key=${t.id} class="toast"><${Icon} name="CheckCircle2" size=${15} />${t.text}</div>`)}
    </div>`;
}

/* Icono Lucide montado como SVG (espera a que window.lucide esté listo).
   Sin aria-label => decorativo (aria-hidden); con aria-label => icono con significado propio.
   color se aplica al trazo vía CSS (currentColor por defecto) para que funcione
   igual en claro y oscuro; strokeWidth pasa al SVG. */
function Icon({ name, size = 16, className = '', spin = false, label, color, strokeWidth = 2 }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current || !window.lucide || !window.lucide[name]) return;
    ref.current.innerHTML = '';
    const attrs = { width: size, height: size, 'stroke-width': strokeWidth };
    if (label) { attrs.role = 'img'; attrs['aria-label'] = label; }
    else attrs['aria-hidden'] = 'true';
    const svg = window.lucide.createElement(window.lucide[name], attrs);
    if (color) svg.style.color = color;
    ref.current.appendChild(svg);
  }, [name, size, label, color, strokeWidth]);
  return html`<span class=${'icon' + (spin ? ' spin' : '') + (className ? ' ' + className : '')} ref=${ref} style=${color ? { color } : null}></span>`;
}

/* ---------- Iconos de marca ----------
   Set propio en el lenguaje de la iconografía FuelTech (trazo medio, esquinas
   redondeadas, detalles en lima). Lucide es monocromo; para los iconos más
   visibles de la interfaz usamos estos SVG bicolor (gris + acento lima). */
const MARK_ICONS = {
  Search: (s, c) => html`<svg width=${s} height=${s} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7" stroke=${c} opacity=".55"/><path d="m21 21-4.3-4.3" stroke=${c} opacity=".55"/><circle cx="11" cy="11" r="2.6" fill=${c} stroke="none"/></svg>`,
  Fuel: (s, c) => html`<svg width=${s} height=${s} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20V6a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v14" stroke=${c} opacity=".55"/><path d="M14 10h3a2 2 0 0 1 2 2v4a1.5 1.5 0 0 0 3 0V9l-3-3" stroke=${c} opacity=".55"/><path d="M5 20h10" stroke=${c} opacity=".55"/><path d="M12 5.5 9.5 9h5L12 12.5" stroke=${c} fill="none"/></svg>`,
  Gauge: (s, c) => html`<svg width=${s} height=${s} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 14 15.5 9" stroke=${c}/><circle cx="12" cy="14" r="7" stroke=${c} opacity=".55"/><path d="M12 3a9 9 0 0 1 9 9" stroke=${c} opacity=".55"/><path d="M3.6 9.5A9 9 0 0 1 12 3" stroke=${c} opacity=".55"/></svg>`,
  Pump: (s, c) => html`<svg width=${s} height=${s} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="7" y="3" width="10" height="18" rx="2" stroke=${c} opacity=".55"/><path d="M12 8v3" stroke=${c}/><circle cx="12" cy="14.5" r="1.6" fill=${c} stroke="none"/></svg>`,
  Injector: (s, c) => html`<svg width=${s} height=${s} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3v8l-2 3v7h16v-7l-2-3V3" stroke=${c} opacity=".55"/><path d="M9 21v-4h6v4" stroke=${c} opacity=".55"/><path d="M9.5 7.5h5" stroke=${c}/><path d="M10.5 11h3" stroke=${c}/></svg>`,
  Filter: (s, c) => html`<svg width=${s} height=${s} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="3" stroke=${c} opacity=".55"/><path d="M9 7.5h6" stroke=${c}/><path d="M9 12h6" stroke=${c}/><path d="M9 16.5h3" stroke=${c}/></svg>`,
  Sensor: (s, c) => html`<svg width=${s} height=${s} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2" stroke=${c} opacity=".55"/><rect x="10" y="10" width="4" height="4" fill=${c} stroke="none"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" stroke=${c} opacity=".55"/></svg>`,
  Ecu: (s, c) => html`<svg width=${s} height=${s} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="5" width="16" height="14" rx="2" stroke=${c} opacity=".55"/><path d="M8 9h2M8 12h2M14 9h2M14 12h2" stroke=${c}/><path d="M9.5 15.5h5" stroke=${c}/></svg>`,
  History: (s, c) => html`<svg width=${s} height=${s} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8" stroke=${c} opacity=".55"/><path d="M12 8v4l2.5 1.5" stroke=${c}/><path d="M3.5 4.5 6 7M20.5 4.5 18 7" stroke=${c} opacity=".55"/></svg>`,
  Compare: (s, c) => html`<svg width=${s} height=${s} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v18" stroke=${c} opacity=".55"/><path d="M7 7H4l4-4 4 4H9" stroke=${c} opacity=".55"/><path d="M17 17h3l-4 4-4-4h3" stroke=${c} opacity=".55"/><path d="M7 12h3M17 12h-3" stroke=${c}/></svg>`,
  View3D: (s, c) => html`<svg width=${s} height=${s} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2 3 7v10l9 5 9-5V7Z" stroke=${c} opacity=".55"/><path d="M12 22V12M3 7l9 5 9-5" stroke=${c} opacity=".55"/><path d="M9 5l9 5" stroke=${c}/></svg>`,
  Assistant: (s, c) => html`<svg width=${s} height=${s} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.5 3a7 7 0 0 0 0 14c.6 0 1.2-.1 1.8-.2L14 19v-2.5c2.9-1.2 5-4 5-7.5a7 7 0 0 0-9.5-6Z" stroke=${c} opacity=".55"/><path d="M9 9h.01M13 9h.01M9 12.5c1.5 1.2 3.5 1.2 5 0" stroke=${c}/></svg>`,
  Favorite: (s, c) => html`<svg width=${s} height=${s} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 3 2.7 5.6 6.1.8-4.5 4.3 1.1 6-5.4-2.9-5.4 2.9 1.1-6L3.2 9.4l6.1-.8Z" stroke=${c} opacity=".55"/><path d="m12 7 .9 1.9 2 .3-1.5 1.4.4 2-1.8-1-1.8 1 .4-2L9.1 9.2l2-.3Z" fill=${c} stroke="none"/></svg>`,
  Settings: (s, c) => html`<svg width=${s} height=${s} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3" stroke=${c}/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5h.1a1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" stroke=${c} opacity=".55"/></svg>`,
  Droplets: (s, c) => html`<svg width=${s} height=${s} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 16.3c0-3 3-7 3-7s3 4 3 7a3 3 0 0 1-6 0Z" stroke=${c} opacity=".55"/><path d="M12 5.5c1.6-2 3.5-3.5 5-3.5" stroke=${c}/><path d="M17 8.5c1-1.3 2-2 3-2" stroke=${c}/></svg>`,
  Zap: (s, c) => html`<svg width=${s} height=${s} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 2 4 14h6l-1 8 9-12h-6Z" stroke=${c} opacity=".55"/><path d="M13 9h4" stroke=${c}/></svg>`,
  Stethoscope: (s, c) => html`<svg width=${s} height=${s} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 3v5a5 5 0 0 0 10 0V3" stroke=${c} opacity=".55"/><path d="M10 13v3a5 5 0 0 0 10 0v-1" stroke=${c} opacity=".55"/><circle cx="20" cy="16" r="2" stroke=${c}/><path d="M10 3v2M5 3v2" stroke=${c} opacity=".55"/></svg>`,
  Calendar: (s, c) => html`<svg width=${s} height=${s} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" stroke=${c} opacity=".55"/><path d="M8 3v4M16 3v4M3 10h18" stroke=${c} opacity=".55"/><path d="M12 14l1.5 1.5L12 17" stroke=${c}/></svg>`,
  Car: (s, c) => html`<svg width=${s} height=${s} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 11 6.5 6.5A2 2 0 0 1 8.4 5h7.2a2 2 0 0 1 1.9 1.5L19 11" stroke=${c} opacity=".55"/><rect x="3" y="11" width="18" height="6" rx="2" stroke=${c} opacity=".55"/><path d="M6 14h.01M18 14h.01" stroke=${c}/></svg>`,
  Tag: (s, c) => html`<svg width=${s} height=${s} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2H4a2 2 0 0 0-2 2v8l10 10 10-10Z" stroke=${c} opacity=".55"/><circle cx="7.5" cy="7.5" r="1.5" fill=${c} stroke="none"/></svg>`,
  ArrowUpDown: (s, c) => html`<svg width=${s} height=${s} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m7 3-4 4h3v10h2V7h3Z" stroke=${c} opacity=".55"/><path d="m17 21 4-4h-3V7h-2v10h-3Z" stroke=${c} opacity=".55"/></svg>`,
  Wrench: (s, c) => html`<svg width=${s} height=${s} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 0 0 5.4-5.4L15 11l-2-2Z" stroke=${c} opacity=".55"/><path d="M15.5 4.5 17 6" stroke=${c}/></svg>`,
  BookOpen: (s, c) => html`<svg width=${s} height=${s} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 6c-1.5-1.3-3.5-2-6-2H3v14h3c2.5 0 4.5.7 6 2 1.5-1.3 3.5-2 6-2h3V4h-3c-2.5 0-4.5.7-6 2Z" stroke=${c} opacity=".55"/><path d="M12 6v14" stroke=${c}/></svg>`,
  Check: (s, c) => html`<svg width=${s} height=${s} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m4 12.5 5 5L20 6.5" stroke=${c} opacity=".55"/></svg>`,
  Plus: (s, c) => html`<svg width=${s} height=${s} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke=${c} opacity=".55"/></svg>`,
  ClipboardCheck: (s, c) => html`<svg width=${s} height=${s} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="4" width="14" height="17" rx="2" stroke=${c} opacity=".55"/><path d="M9 4V3h6v1" stroke=${c} opacity=".55"/><path d="m8.5 13 2.5 2.5 4.5-5" stroke=${c}/></svg>`,
  Thermometer: (s, c) => html`<svg width=${s} height=${s} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 14.8V4a2 2 0 0 0-4 0v10.8a4 4 0 1 0 4 0Z" stroke=${c} opacity=".55"/><path d="M12 17.5v-5" stroke=${c}/></svg>`,
};
/* Icono de marca: bicolor (gris + lima). El acento usa var(--accent) que en modo
   claro se oscurece a oliva (contraste) y el gris hereda currentColor. */
function MarkIcon({ name, size = 16, className = '' }) {
  const icon = MARK_ICONS[name];
  if (!icon) return null;
  const c = 'var(--accent)';
  return html`<span class=${'icon mark-icon' + (className ? ' ' + className : '')}>${icon(size, c)}</span>`;
}
// Expuesto para que microapps.js (dashboard) pueda reutilizar la iconografía de marca.
window.FT_APP = window.FT_APP || {};
window.FT_APP.MarkIcon = MarkIcon;

/* ================================================================
   HERRAMIENTAS DEL TALLER — funciones prácticas para el mecánico
   ================================================================ */

/* ---- Árbol de diagnóstico por síntomas ----
   El mecánico elige el síntoma y la herramienta le sugiere causas probables
   ordenadas por frecuencia y la prueba más rápida para confirmar cada una. */
const DIAG_TREE = {
  'no-arranca': {
    label: 'No arranca / se ahoga', icon: 'Zap',
    steps: [
      { causa: 'Falta presión de combustible (bomba muerta o filtro tapado)', prueba: 'Gira la llave a ON y escucha la bomba 2s. Mide presión en el riel: debe estar en el rango de la ficha del vehículo.' },
      { causa: 'Fusible o relé de la bomba quemado', prueba: 'Revisa el fusible de la bomba y el relé. Puentea el relé: si la bomba gira, el problema es el circuito de control.' },
      { causa: 'Sin chispa (módulo de encendido o sensor)', prueba: 'Prueba chispa con bujía nueva. Si no hay, revisa el módulo de encendido y el sensor de posición del cigüeñal.' },
      { causa: 'Inyector sin pulso (ECU en modo seguro)', prueba: 'Con lámpara de inyección (noid light) comprueba pulso en un inyector. Sin pulso: revisa señal del sensor de posición y tierras de la ECU.' },
      { causa: 'Baja compresión en cilindros', prueba: 'Prueba de compresión: debe estar sobre 100 PSI y pareja entre cilindros.' },
    ]
  },
  'falta-potencia': {
    label: 'Falta potencia / jalonea', icon: 'Gauge',
    steps: [
      { causa: 'Filtro de gasolina tapado → presión cae bajo carga', prueba: 'Mide presión con el vehículo en movimiento o al acelerar a fondo: si cae más de 5 PSI, cambia el filtro.' },
      { causa: 'Bomba gastada (no entrega flujo suficiente)', prueba: 'Mide el flujo de retorno o el amperaje: una bomba gastada consume menos de lo normal (ver calculadora eléctrica).' },
      { causa: 'Cedazo del módulo obstruido', prueba: 'Síntoma clásico: arranca bien en frío, falla en caliente o con el tanque bajo. Inspecciona el cedazo al desarmar el módulo.' },
      { causa: 'Regulador de presión con diafragma roto', prueba: 'Revisa si hay gasolina en la manguera de vacío del regulador. Si la hay, el diafragma está roto.' },
      { causa: 'Sensor MAF o MAP sucio', prueba: 'Limpia el sensor con limpiador específico. Un sensor sucio provoca mezcla pobre y jaloneo.' },
    ]
  },
  'ruido-bomba': {
    label: 'Bomba hace ruido', icon: 'Pump',
    steps: [
      { causa: 'Nivel bajo de gasolina (la bomba se lubrica con el combustible)', prueba: 'Rellena el tanque. Si el ruido desaparece, era falta de combustible y la bomba está sufriendo.' },
      { causa: 'Cedazo tapado → cavitación', prueba: 'La bomba "zumba" fuerte: el cedazo obstruido le impide succionar. Inspecciónalo al desarmar.' },
      { causa: 'Bomba con rodamientos gastados', prueba: 'Si el ruido persiste con el tanque lleno y el cedazo limpio, la bomba está por fallar: cámbiala preventivamente.' },
      { causa: 'Sujeción floja del módulo (vibra)', prueba: 'Revisa el anillo de retención y las gomas del módulo: un módulo suelto transmite ruido al chasis.' },
    ]
  },
  'fuga-gasolina': {
    label: 'Huele a gasolina / fuga', icon: 'Injector',
    steps: [
      { causa: 'Línea de retorno o conexión del módulo con fuga', prueba: 'Con el motor encendido, inspecciona conexiones y abrazaderas. Limpia y revisa con el vehículo elevado.' },
      { causa: 'Tapa del módulo mal sellada', prueba: 'Revisa el sello (O-ring) de la tapa del módulo: si está cortado o deformado, cámbialo. No reutilices sellos viejos.' },
      { causa: 'Inyector con fuga interna (drena presión)', prueba: 'Prueba de retención: la presión no debe caer más de 5 PSI en 5 minutos. Si cae, hay fuga en inyector o válvula check.' },
      { causa: 'Manguera de vacío del regulador con gasolina', prueba: 'Si huele a gasolina por el múltiple, revisa el regulador: diafragma roto deja pasar combustible al vacío.' },
      { causa: 'Tanque con fuga en costura o tapón', prueba: 'Inspecciona el tanque con el vehículo elevado, sobre todo en zonas de corrosión.' },
    ]
  },
  'falla-en-caliente': {
    label: 'Falla en caliente / no arranca en caliente', icon: 'Thermometer',
    steps: [
      { causa: 'Bomba con desgaste térmico (pierde presión al calentar)', prueba: 'Mide presión en frío y en caliente: si cae más de 8 PSI en caliente, la bomba está por fallar.' },
      { causa: 'Válvula check interna del módulo drenando', prueba: 'Prueba de retención en caliente: la presión no debe caer rápido al apagar.' },
      { causa: 'Sensor de temperatura (CTS) con lectura errónea', prueba: 'El CTS le dice a la ECU que el motor está frío → mezcla rica. Compara su lectura con un multímetro/escáner.' },
      { causa: 'Módulo de encendido con falla térmica', prueba: 'Cuando falle, rocíale aire frío (o agua) al módulo: si arranca, es falla térmica del módulo.' },
      { causa: 'Vapor lock en líneas de combustible', prueba: 'Más común en carburados o con líneas cerca del escape. Revisa el ruteo de líneas y el aislamiento térmico.' },
    ]
  },
  'consumo-alto': {
    label: 'Consumo alto de gasolina', icon: 'Droplets',
    steps: [
      { causa: 'Regulador con presión alta (mezcla rica)', prueba: 'Mide la presión en ralentí y compara con la especificación. Presión alta = mezcla rica = consumo alto.' },
      { causa: 'Sensor de oxígeno (O2) gastado', prueba: 'Un O2 lento o muerto hace que la ECU inyecte de más. Escanea el voltaje del sensor: debe oscilar rápido entre 0.1 y 0.9V.' },
      { causa: 'Sensor de temperatura (CTS) leyendo frío', prueba: 'Mezcla rica constante. Verifica con escáner la temperatura del motor vs. la real.' },
      { causa: 'Filtro de aire tapado', prueba: 'Revisa el filtro: un filtro saturado empobrece/ensucia la mezcla y sube el consumo.' },
      { causa: 'Freno de estacionamiento arrastrando o llantas bajas', prueba: 'Descarta lo mecánico antes de acusar al sistema de combustible.' },
    ]
  },
};

/* ---- Checklist de instalación de bomba/módulo ----
   Pasos ordenados que el mecánico puede ir marcando; persiste por vehículo. */
const INSTALL_CHECKLIST = [
  'Aliviar presión: quitar fusible/relé de la bomba y arrancar hasta que se apague.',
  'Desconectar el negativo de la batería.',
  'Localizar el módulo según la ficha (zona y si requiere bajar tanque).',
  'Limpiar la zona de trabajo y el borde del tanque antes de abrir.',
  'Retirar el anillo de retención o tornillos; marcar la orientación de la tapa.',
  'Extraer el módulo con cuidado (el flotador se daña fácil).',
  'Desconectar el conector eléctrico y las líneas; tapar la boca del tanque.',
  'Comparar la pila nueva contra la vieja: medidas, conector y polaridad.',
  'Reemplazar el cedazo (pre-filtro) SIEMPRE al cambiar la bomba.',
  'Instalar la pila nueva en el módulo; revisar el sello (O-ring) de la tapa.',
  'Reinsertar el módulo respetando la orientación; no forzar.',
  'Colocar el anillo de retención con su sello; apretar a su posición.',
  'Reconectar líneas y conector; conectar la batería.',
  'Primer encendido: llave en ON 2s (deja cebar la bomba), luego arrancar.',
  'Verificar presión en el riel contra la especificación de la ficha.',
  'Revisar fugas en conexiones y la tapa; probar arranque en caliente.',
];

/* ---- Glosario técnico ---- */
const GLOSSARY = [
  { t: 'PSI', d: 'Libras por pulgada cuadrada. Unidad de presión usada en sistemas de combustible (1 bar ≈ 14.5 PSI).' },
  { t: 'Bar', d: 'Unidad métrica de presión. 1 bar ≈ 14.5 PSI. Común en manuales europeos y latinos.' },
  { t: 'LPH', d: 'Litros por hora. Mide el flujo (caudal) que la bomba entrega. A mayor demanda del motor, más LPH necesita.' },
  { t: 'Riel / Flauta', d: 'Tubo que distribuye combustible a los inyectores. Ahí se mide la presión de trabajo.' },
  { t: 'Módulo de gasolina', d: 'Ensamble completo dentro del tanque: bomba, regulador (a veces), flotador, cedazo y conector.' },
  { t: 'Pila de gasolina', d: 'La bomba en bruto (el corazón del módulo). Se vende suelta o dentro del módulo.' },
  { t: 'Regulador de presión', d: 'Mantiene la presión del riel constante aliviando el exceso de retorno. Puede estar en el riel, en el módulo o en el cuerpo TBI.' },
  { t: 'Cedazo', d: 'Pre-filtro de tela en la succión de la bomba. Se tapa con suciedad y mata bombas: cámbialo siempre.' },
  { t: 'Returnless (sin retorno)', d: 'Sistema donde el regulador vive dentro del módulo y no hay línea de retorno al tanque.' },
  { t: 'TBI', d: 'Inyección en el cuerpo del acelerador (Throttle Body Injection). El regulador suele estar en el cuerpo.' },
  { t: 'MFI', d: 'Inyección multipunto: un inyector por cilindro, en el múltiple de admisión.' },
  { t: 'GDI', d: 'Inyección directa: el combustible va directo a la cámara. Requiere alta presión y módulos especiales.' },
  { t: 'Vortec / CSFI', d: 'Sistema GM con inyectores en el pleno (Central Sequential Fuel Injection). El regulador está en la unidad CSFI.' },
  { t: 'Cavitación', d: 'La bomba succiona aire/vapor por succión restringida (cedazo tapado o tanque bajo). Suena como "grava" y destruye la bomba.' },
  { t: 'Vapor lock', d: 'Burbujas de vapor en la línea que cortan el flujo. Más común con líneas calientes o baja presión.' },
  { t: 'Check / Válvula antirretorno', d: 'Evita que la presión del riel regrese al tanque al apagar. Su falla causa arranques lentos en caliente.' },
  { t: 'Amperaje', d: 'Consumo eléctrico de la bomba. Más de 20A indica motor atascado o corto; menos de 2A, circuito abierto.' },
  { t: 'Flotador / Aforador', d: 'Sensor de nivel del tanque: un brazo con potenciómetro dentro del módulo.' },
  { t: 'O-ring / Sello', d: 'Empaque de la tapa del módulo. Si se daña, hay olor a gasolina y posibles fugas.' },
  { t: 'Jet-pump (GDI)', d: 'Pequeño venturi que llena el vaso del módulo en sistemas GDI de baja presión.' },
];

/* ---- Registro de trabajos (por vehículo) ---- */
const JOBS_KEY = 'ft_jobs';
const getJobs = () => { try { return JSON.parse(localStorage.getItem(JOBS_KEY) || '{}'); } catch (e) { return {}; } };
const saveJobs = (jobs) => localStorage.setItem(JOBS_KEY, JSON.stringify(jobs));

/* ---- Componente: Herramientas ---- */
function Tools({ selectedId, meta }) {
  const [tab, setTab] = useState('diag');
  const [diag, setDiag] = useState(null);
  const [checklist, setChecklist] = useState(() => {
    const k = `ft_check_${selectedId || 'gral'}`;
    try {
      const saved = JSON.parse(localStorage.getItem(k) || '[]');
      // si lo guardado no coincide con el checklist actual, se rellena con false
      if (Array.isArray(saved) && saved.length === INSTALL_CHECKLIST.length) return saved;
      return INSTALL_CHECKLIST.map(() => false);
    } catch (e) { return INSTALL_CHECKLIST.map(() => false); }
  });
  const [gloss, setGloss] = useState('');
  const [jobs, setJobs] = useState(getJobs);
  const [jobText, setJobText] = useState('');
  const [jobsFor, setJobsFor] = useState(selectedId || '');
  const [compareA, setCompareA] = useState('');
  const [compareB, setCompareB] = useState('');
  const [pumps, setPumps] = useState([]);
  const [vehicles, setVehicles] = useState([]);

  useEffect(() => { api('/api/pumps').then(setPumps).catch(() => {}); }, []);
  useEffect(() => { api('/api/vehicles').then(setVehicles).catch(() => {}); }, []);

  const tabBtn = (id, icon, text) => html`
    <button type="button" class="tool-tab" data-active=${tab === id} onClick=${() => setTab(id)}>
      <${MarkIcon} name=${icon} size=${15} /> ${text}
    </button>`;

  /* ---- Diagnóstico ---- */
  const runDiag = (key) => { setDiag(DIAG_TREE[key]); track('herramienta_diagnostico', { sintoma: key }); };
  const diagResult = diag && html`
    <div class="tool-diag">
      <div class="tool-diag-head">
        <${MarkIcon} name="Stethoscope" size=${16} />
        <strong>${diag.label}</strong>
        <button type="button" class="link-btn" onClick=${() => setDiag(null)}>← elegir otro síntoma</button>
      </div>
      ${diag.steps.map((s, i) => html`
        <div class="tool-diag-step" key=${i}>
          <div class="tool-diag-num">${i + 1}</div>
          <div>
            <div class="tool-diag-causa">${s.causa}</div>
            <div class="tool-diag-prueba">${s.prueba}</div>
          </div>
        </div>`)}
      <div class="alert blue" style=${{ marginTop: '12px' }}>
        <${Icon} name="Info" size=${14} />
        <span>Ordenado por frecuencia en taller. Siempre confirma con el manual de servicio del fabricante.</span>
      </div>
    </div>`;

  /* ---- Checklist ---- */
  const toggleCheck = (i) => {
    const k = `ft_check_${selectedId || 'gral'}`;
    const next = [...checklist];
    next[i] = !next[i];
    setChecklist(next);
    localStorage.setItem(k, JSON.stringify(next));
  };
  const resetCheck = () => { const k = `ft_check_${selectedId || 'gral'}`; const fresh = INSTALL_CHECKLIST.map(() => false); setChecklist(fresh); localStorage.setItem(k, JSON.stringify(fresh)); };
  const doneCount = checklist.filter(Boolean).length;

  /* ---- Comparador ---- */
  const cmp = (id) => pumps.find(p => p.id === Number(id));
  const cmpRow = (label, a, b) => html`
    <div class="cmp-row"><span class="cmp-lbl">${label}</span><span class="cmp-a">${a ?? '—'}</span><span class="cmp-b">${b ?? '—'}</span></div>`;
  const both = compareA && compareB && cmp(compareA) && cmp(compareB);
  const cmpBadge = (a, b) => a == null || b == null ? '' : (Math.abs(a - b) < 0.5 ? html`<span class="cmp-ok">✓</span>` : html`<span class="cmp-warn">≠</span>`);

  /* ---- Registro ---- */
  const jobsList = jobs[jobsFor] || [];
  const addJob = () => {
    const t = jobText.trim();
    if (!t) return;
    const next = { ...jobs, [jobsFor]: [...(jobs[jobsFor] || []), { t, ts: Date.now() }] };
    setJobs(next); saveJobs(next); setJobText(''); toast('Trabajo registrado');
  };
  const rmJob = (i) => {
    const next = { ...jobs, [jobsFor]: (jobs[jobsFor] || []).filter((_, j) => j !== i) };
    setJobs(next); saveJobs(next);
  };

  return html`
    <div class="tools-wrap">
      <div class="panel" style=${{ padding: 0, overflow: 'hidden' }}>
        <div style=${{ padding: '20px 24px 0' }}>
          <div class="vh-head">
            <h2><${MarkIcon} name="Wrench" size=${20} /> Herramientas del Taller</h2>
          </div>
          <p class="muted mt" style=${{ marginBottom: '18px' }}>Diagnóstico por síntomas, checklist de instalación, comparador de pilas, glosario y registro de trabajos.</p>
        </div>
        <div class="tool-tabs">
          ${tabBtn('diag', 'Stethoscope', 'Diagnóstico')}
          ${tabBtn('check', 'ClipboardCheck', 'Checklist')}
          ${tabBtn('compare', 'Compare', 'Comparar Pilas')}
          ${tabBtn('gloss', 'BookOpen', 'Glosario')}
          ${tabBtn('jobs', 'History', 'Trabajos')}
        </div>
        <div style=${{ padding: '22px 24px 26px' }}>
          ${tab === 'diag' && html`
            <div>
              <p class="muted" style=${{ marginBottom: '12px', fontSize: '12.5px' }}>Elige el síntoma y obtén las causas más probables con la prueba para confirmar cada una.</p>
              <div class="tool-diag-grid">
                ${Object.entries(DIAG_TREE).map(([k, v]) => html`
                  <button type="button" class="tool-diag-btn" onClick=${() => runDiag(k)}>
                    <${MarkIcon} name=${v.icon} size=${18} />
                    <span>${v.label}</span>
                  </button>`)}
              </div>
              ${diagResult}
            </div>`}

          ${tab === 'check' && html`
            <div>
              <div class="tool-check-head">
                <strong>Instalación de bomba / módulo</strong>
                <span class="result-count">${doneCount}/${checklist.length}</span>
              </div>
              <div class="tool-progress"><div style=${{ width: (checklist.length ? doneCount / checklist.length * 100 : 0) + '%' }}></div></div>
              <div class="tool-check-list">
                ${checklist.map((c, i) => html`
                  <label class="tool-check-item" data-checked=${!!c}>
                    <input type="checkbox" checked=${!!c} onChange=${() => toggleCheck(i)} />
                    <span class="tool-check-box"><${Icon} name="Check" size=${12} /></span>
                    <span>${INSTALL_CHECKLIST[i]}</span>
                  </label>`)}
              </div>
              <button type="button" class="link-btn" onClick=${resetCheck} style=${{ marginTop: '12px' }}>Reiniciar checklist</button>
            </div>`}

          ${tab === 'compare' && html`
            <div>
              <div class="cmp-selects">
                <div><label class="muted" style=${{ display: 'block', fontSize: '10px', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '5px' }}>Pila A</label>
                  <select class="styled-input" value=${compareA} onChange=${e => setCompareA(e.target.value)}>
                    <option value="">Elige una pila…</option>
                    ${pumps.map(p => html`<option key=${p.id} value=${p.id}>${p.code} — ${p.manufacturer}</option>`)}
                  </select></div>
                <div><label class="muted" style=${{ display: 'block', fontSize: '10px', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '5px' }}>Pila B</label>
                  <select class="styled-input" value=${compareB} onChange=${e => setCompareB(e.target.value)}>
                    <option value="">Elige una pila…</option>
                    ${pumps.map(p => html`<option key=${p.id} value=${p.id}>${p.code} — ${p.manufacturer}</option>`)}
                  </select></div>
              </div>
              ${both && html`
                <div class="cmp-table">
                  <div class="cmp-head"><span></span><span class="cmp-a">${cmp(compareA).code}</span><span class="cmp-b">${cmp(compareB).code}</span></div>
                  ${cmpRow('Fabricante', cmp(compareA).manufacturer, cmp(compareB).manufacturer)}
                  ${cmpRow('Presión máx (PSI)', cmp(compareA).max_psi_direct, cmp(compareB).max_psi_direct)}
                  ${cmpRow('Amperaje (A)', cmp(compareA).amperage_a, cmp(compareB).amperage_a)}
                  ${cmpRow('Flujo libre (LPH)', cmp(compareA).flow_lph_free, cmp(compareB).flow_lph_free)}
                  ${cmpRow('Estilo', cmp(compareA).pump_style, cmp(compareB).pump_style)}
                  ${cmpRow('Entrada', cmp(compareA).inlet_desc, cmp(compareB).inlet_desc)}
                  ${cmpRow('Salida', cmp(compareA).outlet_desc, cmp(compareB).outlet_desc)}
                  ${cmpRow('Polaridad', cmp(compareA).polarity_desc, cmp(compareB).polarity_desc)}
                  <div class="alert blue" style=${{ marginTop: '12px' }}>
                    <${Icon} name="Info" size=${14} />
                    <span>Comprueba medidas físicas y conector antes de comprar. “Universal” no significa compatible.</span>
                  </div>
                </div>`}
            </div>`}

          ${tab === 'gloss' && html`
            <div>
              <input type="search" class="styled-input" placeholder="Buscar término (ej. cedazo, regulador, PSI…)" value=${gloss} onChange=${e => setGloss(e.target.value)} style=${{ maxWidth: '420px' }} />
              <div class="tool-gloss">
                ${GLOSSARY.filter(g => !gloss || g.t.toLowerCase().includes(gloss.toLowerCase()) || g.d.toLowerCase().includes(gloss.toLowerCase()))
                  .map(g => html`<div class="tool-gloss-item" key=${g.t}><strong>${g.t}</strong><span>${g.d}</span></div>`)}
              </div>
            </div>`}

          ${tab === 'jobs' && html`
            <div>
              <div style=${{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'flex-end', marginBottom: '14px' }}>
                <div style=${{ flex: '1', minWidth: '200px' }}>
                  <label class="muted" style=${{ display: 'block', fontSize: '10px', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '5px' }}>Vehículo</label>
                  <select class="styled-input" value=${jobsFor} onChange=${e => setJobsFor(e.target.value)}>
                    <option value="">General / sin vehículo</option>
                    ${vehicles.map(v => html`<option key=${v.id} value=${v.id}>${v.brand} ${v.model} ${v.year_from}-${v.year_to}</option>`)}
                  </select>
                </div>
                <div style=${{ flex: '2', minWidth: '220px' }}>
                  <label class="muted" style=${{ display: 'block', fontSize: '10px', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '5px' }}>Trabajo realizado</label>
                  <input type="text" class="styled-input" placeholder="Ej. Cambio de bomba y cedazo; presión 52 PSI OK" value=${jobText} onChange=${e => setJobText(e.target.value)} onKeyDown=${e => { if (e.key === 'Enter') addJob(); }} />
                </div>
                <button type="button" class="tool-add-btn" onClick=${addJob} disabled=${!jobText.trim()}><${Icon} name="Plus" size=${14} /> Registrar</button>
              </div>
              <div class="tool-jobs">
                ${jobsList.length === 0 ? html`<div class="empty" style=${{ padding: '24px' }}>No hay trabajos registrados para este vehículo.</div>`
                  : jobsList.slice().reverse().map((j, ri) => html`
                    <div class="tool-job" key=${ri}>
                      <div class="tool-job-t">${j.t}</div>
                      <div class="tool-job-meta">${new Date(j.ts).toLocaleString()} <button type="button" class="link-btn" onClick=${() => rmJob(jobsList.length - 1 - ri)}>quitar</button></div>
                    </div>`)}
              </div>
              <p class="muted" style=${{ fontSize: '11px', marginTop: '10px' }}>Se guarda solo en este navegador (sin conexión a servidor).</p>
            </div>`}
        </div>
      </div>
    </div>`;
}


/* Reconstruye al cambiar de tema. Las escenas de Three.js fijan sus colores al
   crear los materiales, así que recolorear en vivo exigiría recorrerlas enteras;
   rehacerlas es más simple y solo ocurre al pulsar el selector de tema. */
function useThemeKey() {
  const [k, setK] = useState(0);
  useEffect(() => {
    const bump = () => setK(n => n + 1);
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    window.addEventListener('ft-theme-change', bump);
    mq.addEventListener('change', bump);   // modo 'auto': sigue al sistema
    return () => { window.removeEventListener('ft-theme-change', bump); mq.removeEventListener('change', bump); };
  }, []);
  return k;
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
  const tk = useThemeKey();
  const ref = use3D((el, FT3D) => FT3D.car(el, { zone, psiText, zoneLabel: ZONE_SHORT[zone], body }), [zone, psiText, body, tk]);
  return html`<div class="v3d" ref=${ref}></div>`;
}
function Module3D({ kind }) {
  const tk = useThemeKey();
  const ref = use3D((el, FT3D) => FT3D.module(el, { kind }), [kind, tk]);
  return html`<div class="v3d" ref=${ref}></div>`;
}
function Pump3D({ psi, style, code }) {
  const tk = useThemeKey();
  const ref = use3D((el, FT3D) => FT3D.pump(el, { psi, style, code }), [psi, code, tk]);
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

/* ---------- Sección de Comentarios ---------- */
function CommentsSection({ vehicleId }) {
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [savedName, setSavedName] = useState(() => localStorage.getItem('ftm_author_name') || '');
  const [authorName, setAuthorName] = useState(savedName);
  const [content, setContent] = useState('');
  const [replyTo, setReplyTo] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api(`/api/vehicles/${vehicleId}/comments`)
      .then(d => { if (alive) { setComments(d); setError(null); } })
      .catch(e => { if (alive) setError(e); })
      .finally(() => { if (alive) setLoading(false); });
    setReplyTo(null);
    setContent('');
    return () => { alive = false; };
  }, [vehicleId]);

  const handleSubmit = async (e, parentId = null) => {
    e.preventDefault();
    if (!authorName.trim() || !content.trim() || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/vehicles/${vehicleId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ author_name: authorName, content, parent_id: parentId })
      });
      if (!res.ok) throw new Error('Error al enviar el comentario');
      const newComment = await res.json();
      if (!savedName) {
        localStorage.setItem('ftm_author_name', authorName.trim());
        setSavedName(authorName.trim());
      }
      setComments(prev => [...prev, newComment]);
      setContent('');
      setReplyTo(null);
    } catch (e) {
      alert('No se pudo enviar el comentario. Intenta de nuevo.');
    } finally {
      setSubmitting(false);
    }
  };

  const tree = [];
  const map = {};
  comments.forEach(c => { map[c.id] = { ...c, children: [] }; });
  comments.forEach(c => {
    if (c.parent_id && map[c.parent_id]) {
      map[c.parent_id].children.push(map[c.id]);
    } else {
      tree.push(map[c.id]);
    }
  });

  const renderComment = (c, isReply = false) => html`
    <div key=${c.id} class=${'comment-item ' + (isReply ? 'reply' : '')}>
      <div class="comment-head">
        <strong>${c.author_name}</strong>
        <span class="muted">${new Date(c.created_at).toLocaleString()}</span>
      </div>
      <div class="comment-body">${c.content}</div>
      <button type="button" class="link-btn mt-small" onClick=${() => { setReplyTo(c.id); setContent(''); }}>
        <${Icon} name="MessageSquareReply" size=${13} /> Responder
      </button>
      
      ${replyTo === c.id && html`
        <form class="comment-form mt" onSubmit=${(e) => handleSubmit(e, c.id)}>
          <input type="text" class="styled-input" placeholder="Tu Nombre" value=${authorName} onInput=${e => setAuthorName(e.target.value)} required disabled=${!!savedName} style=${savedName ? { opacity: 0.7, cursor: 'not-allowed' } : {}} />
          <textarea class="styled-input" placeholder="Escribe tu respuesta..." rows="2" value=${content} onInput=${e => setContent(e.target.value)} required style=${{ resize: 'vertical', marginTop: '6px' }}></textarea>
          <div style=${{ display: 'flex', gap: '8px', marginTop: '6px' }}>
            <button type="submit" class="v3d-btn" style=${{ position: 'static' }} disabled=${submitting}>
              ${submitting ? 'Enviando...' : 'Enviar Respuesta'}
            </button>
            <button type="button" class="link-btn muted" onClick=${() => setReplyTo(null)}>Cancelar</button>
          </div>
        </form>
      `}
      
      ${c.children.length > 0 && html`
        <div class="comment-replies">
          ${c.children.map(child => renderComment(child, true))}
        </div>
      `}
    </div>
  `;

  return html`
    <div class="panel mt">
      <h2>Comentarios y Dudas</h2>
      ${loading ? html`<div class="empty">Cargando comentarios...</div>` : null}
      ${error ? html`<div class="alert"><${Icon} name="AlertTriangle" size=${14} /> No se pudieron cargar los comentarios.</div>` : null}
      
      ${!loading && !error && html`
        <div class="comments-list">
          ${tree.length === 0 ? html`<div class="empty" style=${{ padding: '20px' }}>No hay comentarios aún. ¡Sé el primero!</div>` : tree.map(c => renderComment(c))}
        </div>
        
        ${replyTo === null && html`
          <form class="comment-form mt" onSubmit=${(e) => handleSubmit(e, null)} style=${{ borderTop: '1px solid var(--border)', paddingTop: '16px' }}>
            <h3 style=${{ fontSize: '13px', marginBottom: '8px', color: 'var(--text)' }}>Deja un comentario</h3>
            <input type="text" class="styled-input" placeholder="Tu Nombre" value=${authorName} onInput=${e => setAuthorName(e.target.value)} required disabled=${!!savedName} style=${savedName ? { opacity: 0.7, cursor: 'not-allowed' } : {}} />
            <textarea class="styled-input" placeholder="Escribe tu duda o comentario..." rows="3" value=${content} onInput=${e => setContent(e.target.value)} required style=${{ resize: 'vertical', marginTop: '6px' }}></textarea>
            <button type="submit" class="v3d-btn" style=${{ position: 'static', marginTop: '8px' }} disabled=${submitting}>
              ${submitting ? 'Enviando...' : 'Comentar'}
            </button>
          </form>
        `}
      `}
    </div>
  `;
}

/* ---------- Detalle del vehículo (vista en vivo, siempre junto al buscador) ---------- */
function VehicleDetail({ id }) {
  const [v, setV] = useState(null);
  const [err, setErr] = useState(null);
  const garage = useGarage(); // debe ir ANTES de cualquier return temprano (reglas de hooks)
  useEffect(() => {
    // el error se limpia al cambiar de vehículo, y una respuesta vieja no pisa a la nueva
    let alive = true;
    setV(null); setErr(null);
    api(`/api/vehicles/${id}`).then(d => {
      if (!alive) return;
      setV(d);
      // page_view por vehículo → alimenta el reporte de Páginas de GA4 en el SPA
      track('page_view', { page_path: '/vehiculo/' + (d.slug || ''), page_title: `${d.brand} ${d.model}` });
    }).catch(e => alive && setErr(e));
    return () => { alive = false; };
  }, [id]);
  if (err) return html`<div class="empty" aria-live="polite">ERROR CARGANDO EL VEHÍCULO — INTENTA DE NUEVO</div>`;
  // Esqueleto en vez de una línea de texto: mantiene la altura de la ficha, así
  // el contenido no salta bajo el dedo cuando terminan de llegar los datos.
  if (!v) return html`
    <div class="panel" aria-live="polite" aria-busy="true">
      <span class="sr-only">Cargando ficha técnica…</span>
      <div class="skel" aria-hidden="true">
        <div class="skel-line" style=${{ width: '45%', height: '22px' }}></div>
        <div class="skel-line" style=${{ width: '70%' }}></div>
        <div class="skel-line" style=${{ width: '35%', height: '30px', marginTop: '8px' }}></div>
        <div class="skel-line" style=${{ width: '90%', marginTop: '14px' }}></div>
        <div class="skel-line" style=${{ width: '80%' }}></div>
        <div class="skel-line" style=${{ width: '60%' }}></div>
      </div>
    </div>`;

  const psiText = `${v.rail_pressure.psi_min}–${v.rail_pressure.psi_max}`;
  const multiModule = v.modules.length > 1;

  // Compartir la ficha = distribución gratis (cada envío por WhatsApp trae usuarios nuevos)
  const shareUrl = `${location.origin}/vehiculo/${v.slug || ''}`;
  const shareMsg = `${v.brand} ${v.model} — ${psiText} PSI. Ficha técnica en FuelTech Master:`;
  const shareWhatsApp = () => { track('compartir', { method: 'whatsapp' }); window.open(`https://wa.me/?text=${encodeURIComponent(shareMsg + ' ' + shareUrl)}`, '_blank', 'noopener'); };
  const shareNative = async () => {
    track('compartir', { method: 'nativo' });
    try {
      if (navigator.share) await navigator.share({ title: 'FuelTech Master', text: shareMsg, url: shareUrl });
      else { await navigator.clipboard.writeText(shareUrl); toast('Enlace copiado'); }
    } catch (e) { /* cancelado por el usuario */ }
  };
  const shareBtn = {
    display: 'inline-flex', alignItems: 'center', gap: '7px', font: '700 11px var(--font)',
    letterSpacing: '1px', textTransform: 'uppercase', background: 'transparent', color: 'var(--accent)',
    border: '1px solid var(--accent-dim)', borderRadius: '2px', padding: '9px 14px', cursor: 'pointer'
  };
  const saved = garage.some(x => x.id === v.id);
  const onStar = () => {
    toggleGarage({ id: v.id, brand: v.brand, model: v.model, psi: v.rail_pressure.psi_max, slug: v.slug });
    toast(saved ? 'Quitado de Mi Garage' : 'Guardado en Mi Garage');
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
          <button type="button" onClick=${onStar} style=${{ ...shareBtn, color: saved ? 'var(--amber)' : 'var(--muted)', borderColor: saved ? 'var(--amber-dim)' : 'var(--border-hi)' }} title=${saved ? 'Quitar de Mi Garage' : 'Guardar en Mi Garage'}><${MarkIcon} name="Favorite" size=${14} /> ${saved ? 'Guardado' : 'Guardar'}</button>
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

      <${CommentsSection} vehicleId=${v.id} />
    </div>`;
}

/* ---------- Logotipo FuelTech Master ----------
   Las dos versiones del manual de marca. Cuál se ve lo decide el CSS
   (--logo-dark / --logo-light) según el esquema de color del sistema:
   así el cambio de tema es instantáneo y no depende de JS. */
const LogoLockup = () => html`
  <${React.Fragment}>
    <img class="logo-lockup on-dark" src="/brand/logo-dark.png" width="760" height="205"
         alt="FuelTech Master" decoding="async" />
    <img class="logo-lockup on-light" src="/brand/logo-light.png" width="760" height="193"
         alt="" aria-hidden="true" decoding="async" />
  <//>`;

/* Isotipo suelto, para cabeceras compactas y avatares */
const LogoMark = ({ className = '' }) => html`
  <${React.Fragment}>
    <img class=${'logo-mark on-dark ' + className} src="/brand/mark-dark.png" width="256" height="283" alt="" aria-hidden="true" decoding="async" />
    <img class=${'logo-mark on-light ' + className} src="/brand/mark-light.png" width="256" height="266" alt="" aria-hidden="true" decoding="async" />
  <//>`;

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
    track('usar_chat', {});

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
        <${MarkIcon} name="Assistant" size=${24} />
      </button>

      <!-- Panel de chat -->
      ${open && html`
        <div class="chat-panel" role="dialog" aria-label="Chat de asistencia automotriz">
          <div class="chat-head">
            <${MarkIcon} name="Assistant" size=${18} />
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
                <div class="chat-empty-logo"><${LogoMark} /></div>
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
                ${m.role === 'bot' && html`<div class="chat-avatar"><${LogoMark} className="chat-avatar-mark" /></div>`}
                <div class="chat-bubble">${m.content}</div>
              </div>
            `)}
            ${loading && html`
              <div class="chat-msg bot">
                <div class="chat-avatar"><${LogoMark} className="chat-avatar-mark" /></div>
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

/* ---------- Calculadoras Técnicas ---------- */
function Calculators() {
  const [tab, setTab] = useState('flow');

  // Presión
  const [psi, setPsi] = useState('');
  const [bar, setBar] = useState('');
  const onPsi = (e) => { const v = e.target.value; setPsi(v); setBar(v ? (v * 0.0689476).toFixed(2) : ''); };
  const onBar = (e) => { const v = e.target.value; setBar(v); setPsi(v ? (v * 14.5038).toFixed(1) : ''); };

  // Caudal
  const [lph, setLph] = useState('');
  const [gph, setGph] = useState('');
  const [cc, setCc] = useState('');
  const onLph = (e) => { const v = e.target.value; setLph(v); setGph(v ? (v * 0.264172).toFixed(1) : ''); setCc(v ? (v * 16.6667).toFixed(0) : ''); };
  const onGph = (e) => { const v = e.target.value; setGph(v); setLph(v ? (v / 0.264172).toFixed(0) : ''); setCc(v ? (v * 63.0902).toFixed(0) : ''); };
  const onCc = (e) => { const v = e.target.value; setCc(v); setLph(v ? (v / 16.6667).toFixed(0) : ''); setGph(v ? (v / 63.0902).toFixed(1) : ''); };

  // Requerimiento BSFC
  const [hp, setHp] = useState('');
  const [aspiration, setAspiration] = useState('na'); 
  const bsfcMap = { na: 0.38, turbo: 0.47, e85: 0.61 };
  const reqLph = hp ? Math.ceil(hp * bsfcMap[aspiration]) : 0;

  // Eléctrico
  const [volts, setVolts] = useState('13.5');
  const [ohms, setOhms] = useState('');
  const amps = volts && ohms && ohms > 0 ? (volts / ohms).toFixed(1) : 0;
  
  let ampStatus = '';
  let ampColor = '';
  if (amps > 0) {
    if (amps > 20) { ampStatus = 'Consumo crítico. Motor atascado o en corto.'; ampColor = 'var(--danger)'; }
    else if (amps > 14) { ampStatus = 'Consumo alto. Riesgo de sobrecalentar relay.'; ampColor = 'var(--amber)'; }
    else if (amps < 2) { ampStatus = 'Consumo muy bajo. Circuito abierto o sin carga.'; ampColor = 'var(--amber)'; }
    else { ampStatus = 'Consumo normal para bomba estándar.'; ampColor = 'var(--text)'; }
  }

  const innerBoxStyle = {
    background: 'var(--panel2)', border: '1px solid var(--border)', borderRadius: '6px', 
    padding: '20px', display: 'flex', flexDirection: 'column'
  };

  const tabBtn = (id, icon, text) => html`
    <button type="button" onClick=${() => setTab(id)} style=${{
      flex: 1, padding: '14px 8px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
      background: tab === id ? 'var(--accent-soft)' : 'transparent',
      border: 'none', borderBottom: tab === id ? '2px solid var(--accent)' : '2px solid transparent',
      color: tab === id ? 'var(--text)' : 'var(--muted)',
      fontFamily: 'var(--font)', fontSize: '11px', fontWeight: '700', letterSpacing: '1px', textTransform: 'uppercase',
      cursor: 'pointer', transition: 'all .2s'
    }}>
      <${MarkIcon} name=${({ flow: 'Droplets', pressure: 'Gauge', electrical: 'Zap' })[id] || 'Gauge'} size=${16} /> 
      <span>${text}</span>
    </button>
  `;

  return html`
    <div style=${{ maxWidth: '800px', margin: '0 auto' }}>
      <div class="panel" style=${{ padding: 0, overflow: 'hidden' }}>
        <div style=${{ padding: '20px 24px 0' }}>
          <div class="vh-head">
            <h2><${MarkIcon} name="Stethoscope" size=${20} /> Diagnóstico Profesional</h2>
          </div>
          <p class="muted mt" style=${{ marginBottom: '20px' }}>Herramientas técnicas para cálculo de caudal y análisis eléctrico de bombas de combustible.</p>
        </div>

        <div style=${{ display: 'flex', flexWrap: 'wrap', borderBottom: '1px solid var(--border)', background: 'var(--panel)' }}>
          ${tabBtn('flow', 'Droplets', 'Caudal (LPH)')}
          ${tabBtn('pressure', 'Gauge', 'Presión (PSI)')}
          ${tabBtn('electrical', 'Zap', 'Eléctrico (Ley de Ohm)')}        </div>

        <div style=${{ padding: '24px' }}>
          
          ${tab === 'flow' ? html`
            <div class="grid2">
              <div style=${innerBoxStyle}>
                <h3 style=${{ fontSize: '14.5px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <${Icon} name="Cpu" size=${16} /> Requerimiento por Motor
                </h3>
                <div style=${{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <div>
                    <label class="muted" style=${{ display: 'block', fontSize: '11px', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '6px' }}>Caballos de fuerza (HP)</label>
                    <input type="number" class="styled-input" value=${hp} onChange=${e => setHp(e.target.value)} placeholder="Ej: 300" />
                  </div>
                  <div>
                    <label class="muted" style=${{ display: 'block', fontSize: '11px', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '6px' }}>Tipo de Inducción</label>
                    <select class="styled-input" value=${aspiration} onChange=${e => setAspiration(e.target.value)}>
                      <option value="na">Aspirado Natural (NA)</option>
                      <option value="turbo">Turbo / Supercargado</option>
                      <option value="e85">Modificado / Etanol (E85)</option>
                    </select>
                  </div>
                </div>
                ${reqLph > 0 ? html`
                  <div class="alert blue" style=${{ marginTop: '20px', alignItems: 'center' }}>
                    <${Icon} name="CheckCircle2" size=${18} color="var(--accent)" /> 
                    <span>La bomba debe entregar mínimo <b style=${{ color: 'var(--text)', fontSize: '15px' }}>${reqLph} LPH</b> reales a la presión de trabajo.</span>
                  </div>` : ''}
              </div>

              <div style=${innerBoxStyle}>
                <h3 style=${{ fontSize: '14.5px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <${Icon} name="Repeat" size=${16} /> Conversor de Caudal
                </h3>
                <div style=${{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <div style=${{ display: 'grid', gridTemplateColumns: '1fr 24px', alignItems: 'center', gap: '10px' }}>
                    <input type="number" class="styled-input" value=${lph} onChange=${onLph} placeholder="255" />
                    <span style=${{ fontSize: '12px', fontWeight: 700, color: 'var(--muted)' }}>LPH</span>
                  </div>
                  <div style=${{ display: 'grid', gridTemplateColumns: '1fr 24px', alignItems: 'center', gap: '10px' }}>
                    <input type="number" class="styled-input" value=${gph} onChange=${onGph} placeholder="67" />
                    <span style=${{ fontSize: '12px', fontWeight: 700, color: 'var(--muted)' }}>GPH</span>
                  </div>
                  <div style=${{ display: 'grid', gridTemplateColumns: '1fr 24px', alignItems: 'center', gap: '10px' }}>
                    <input type="number" class="styled-input" value=${cc} onChange=${onCc} placeholder="4250" />
                    <span style=${{ fontSize: '12px', fontWeight: 700, color: 'var(--muted)' }}>CC</span>
                  </div>
                </div>
              </div>
            </div>
          ` : ''}

          ${tab === 'pressure' ? html`
            <div style=${innerBoxStyle}>
              <h3 style=${{ fontSize: '14.5px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <${Icon} name="Gauge" size=${16} /> Conversor de Presión (Riel)
              </h3>
              <div style=${{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: '20px', alignItems: 'end' }}>
                <div>
                  <label class="muted" style=${{ display: 'block', fontSize: '11px', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '6px' }}>PSI (Libras)</label>
                  <input type="number" class="styled-input" value=${psi} onChange=${onPsi} placeholder="43.5" />
                </div>
                <div style=${{ color: 'var(--border-hi)', paddingBottom: '10px', display: 'flex', justifyContent: 'center' }}>
                  <${Icon} name="ArrowRight" size=${20} />
                </div>
                <div>
                  <label class="muted" style=${{ display: 'block', fontSize: '11px', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '6px' }}>Bar</label>
                  <input type="number" class="styled-input" value=${bar} onChange=${onBar} placeholder="3.0" />
                </div>
              </div>
            </div>
          ` : ''}

          ${tab === 'electrical' ? html`
            <div class="grid2">
              <div style=${innerBoxStyle}>
                <h3 style=${{ fontSize: '14.5px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <${Icon} name="Plug" size=${16} /> Multímetro (Entradas)
                </h3>
                <div style=${{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <div>
                    <label class="muted" style=${{ display: 'block', fontSize: '11px', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '6px' }}>Voltaje Real en Bomba (V)</label>
                    <input type="number" class="styled-input" value=${volts} onChange=${e => setVolts(e.target.value)} placeholder="Ej: 13.5" step="0.1" />
                  </div>
                  <div>
                    <label class="muted" style=${{ display: 'block', fontSize: '11px', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '6px' }}>Resistencia del Motor (Ohms Ω)</label>
                    <input type="number" class="styled-input" value=${ohms} onChange=${e => setOhms(e.target.value)} placeholder="Ej: 1.2" step="0.1" />
                  </div>
                </div>
              </div>

              <div style=${innerBoxStyle}>
                <h3 style=${{ fontSize: '14.5px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--amber)' }}>
                  <${Icon} name="CircuitBoard" size=${16} /> Diagnóstico Amperaje
                </h3>
                <div style=${{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: '8px', padding: '10px 0' }}>
                  <div style=${{ fontSize: '12px', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '2px' }}>Consumo Teórico</div>
                  <div style=${{ fontSize: '42px', fontWeight: 800, color: amps > 0 ? ampColor : 'var(--border-hi)', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
                    ${amps} <span style=${{ fontSize: '18px' }}>A</span>
                  </div>
                </div>
                ${amps > 0 ? html`
                  <div style=${{ marginTop: '16px', padding: '12px', background: 'var(--sunken)', border: '1px solid var(--border)', borderRadius: '4px', fontSize: '13px', color: ampColor, textAlign: 'center', fontWeight: 600 }}>
                    ${ampStatus}
                  </div>
                ` : ''}
              </div>
            </div>
          ` : ''}

        </div>
      </div>
    </div>
  `;
}

/* ---------- Login / registro del taller ---------- */
function LoginScreen({ onLogin }) {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (form.password.length < 8) { setErr('La contraseña debe tener al menos 8 caracteres'); return; }
    setBusy(true); setErr('');
    try {
      const res = await fetch(mode === 'register' ? '/api/auth/register' : '/api/auth/login', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Error');
      setDone(true); onLogin(body);
    } catch (e2) { setErr(e2.message); }
    setBusy(false);
  };
  // Migración best-effort desde localStorage (datos viejos del taller)
  const importLocal = async () => {
    const grab = (k) => { try { return JSON.parse(localStorage.getItem(k)) || []; } catch { return []; } };
    const inv = grab('ft_inventory'), cli = grab('ft_clients'), ord = grab('ft_orders'), notes = grab('ft_notes'), cash = grab('ft_cash');
    if (!inv.length && !cli.length && !ord.length && !notes.length && !cash.length) { setErr('No se encontraron datos locales para importar'); return; }
    setBusy(true); setErr('');
    try {
      for (const i of inv) await fetch('/api/inventory', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: i.name, qty: i.qty, min_qty: i.min, unit_price: i.price || 0 }) });
      for (const c of cli) await fetch('/api/clients', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: c.name, phone: c.phone, notes: [c.veh, c.plate].filter(Boolean).join(' · ') }) });
      for (const o of ord) await fetch('/api/orders', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: o.desc || o.title || 'Orden importada', descr: o.desc, status: o.status }) });
      for (const n of notes) await fetch('/api/notes', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: n.t, vehicle_ref: n.veh }) });
      for (const m of cash) await fetch('/api/cash', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ concept: m.concept, amount: m.amount, type: m.type }) });
      setErr('Datos importados del navegador ✓');
      ['ft_inventory', 'ft_clients', 'ft_orders', 'ft_notes', 'ft_cash', 'ft_pressure_log'].forEach(k => localStorage.removeItem(k));
    } catch (e) { setErr('Error al importar: ' + e.message); }
    setBusy(false);
  };
  return html`
    <div class="home">
      <header class="home-header">
        <img class="logo-lockup on-dark" src="/brand/logo-dark.png" width="760" height="205" alt="FuelTech Master" />
        <img class="logo-lockup on-light" src="/brand/logo-light.png" width="760" height="193" alt="" />
        <p class="home-tagline">Inicia sesión para gestionar tu taller</p>
      </header>
      <div class="login-card panel" style=${{ maxWidth: '420px', margin: '20px auto 60px', padding: '22px' }}>
        ${done && html`<div class="alert blue"><span>¡Bienvenido! Tu sesión está activa.</span></div>`}
        <div class="conv-modes" style=${{ marginBottom: '14px' }}>
          <button type="button" class=${'conv-mode' + (mode === 'login' ? ' active' : '')} onClick=${() => { setMode('login'); setErr(''); }}>Iniciar sesión</button>
          <button type="button" class=${'conv-mode' + (mode === 'register' ? ' active' : '')} onClick=${() => { setMode('register'); setErr(''); }}>Crear cuenta</button>
        </div>
        <form onSubmit=${submit} style=${{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          ${mode === 'register' && html`<input type="text" class="styled-input" placeholder="Nombre del taller / dueño" value=${form.name} onChange=${e => setForm({ ...form, name: e.target.value })} />`}
          <input type="email" class="styled-input" placeholder="Correo" value=${form.email} onChange=${e => setForm({ ...form, email: e.target.value })} />
          <input type="password" class="styled-input" placeholder="Contraseña (mín 8)" value=${form.password} onChange=${e => setForm({ ...form, password: e.target.value })} />
          <button type="submit" class="tool-add-btn" disabled=${busy || !form.email || !form.password}>${busy ? '…' : mode === 'register' ? 'Crear cuenta y entrar' : 'Entrar'}</button>
        </form>
        ${err && html`<div class="alert" style=${{ marginTop: '10px' }}><span>${err}</span></div>`}
        <button type="button" class="link-btn" style=${{ marginTop: '12px' }} onClick=${importLocal} disabled=${busy}>⬆ Importar mis datos del navegador</button>
        <div class="muted" style=${{ marginTop: '8px', fontSize: '11px' }}>Tus datos (inventario, clientes, órdenes, notas, caja) se guardan en la nube y se pueden exportar como respaldo.</div>
      </div>
    </div>
  `;
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
  const [showGarage, setShowGarage] = useState(false);
  const [viewState, setViewState] = useState('home'); // 'home' | 'search' | 'calculators' | 'tools'
  const [microApp, setMicroApp] = useState(null);     // micro app abierta desde el dashboard
  // ── Sesión del taller (cuenta de mecánico) ──
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'same-origin' })
      .then(r => { if (!r.ok) throw new Error('no-session'); return r.json(); })
      .then(setUser).catch(() => setUser(null))
      .finally(() => setAuthChecked(true));
  }, []);
  const logout = () => {
    fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).finally(() => setUser(null));
  };
  const garage = useGarage();
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
      .then(rows => { if (seq === seqRef.current) { setResults(rows); setSearchErr(false); setIsSearching(false); if (rows.length === 0) track('busqueda_sin_resultado', { q: filters.model || '' }); } })
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

  // Manejador de apertura de micro app desde el dashboard
  const openMicro = (id) => {
    const FT = window.FT_MICRO || {};
    const map = {
      search: () => setViewState('search'),
      diag: () => { setViewState('tools'); },
      calc: () => setViewState('calculators'),
      glossary: () => { setViewState('tools'); },
      guides: () => { window.location.href = '/guias'; },
      aid: () => { /* identificador IA: abre el chat con prompt */ setViewState('search'); },
    };
    if (map[id]) return map[id]();
    // micro apps del dashboard (componentes propios); las de negocio requieren sesión
    const apps = { dtc: 'DtcApp', torque: 'TorqueApp', spark: 'SparkApp', cross: 'CrossApp', convert: 'ConverterApp', vin: 'VinApp', pressure: 'PressureApp', regulator: 'RegulatorApp', orders: 'OrdersApp', inventory: 'InventoryApp', clients: 'ClientsApp', notes: 'NotesApp', cash: 'CashApp', forum: 'ForumApp', connect: 'ConnectApp', quickdiag: 'QuickDiagApp', documents: 'DocumentsApp', market: 'MarketApp', timing: 'TimingApp' };
    const protectedIds = ['orders', 'inventory', 'clients', 'notes', 'cash', 'documents'];
    if (protectedIds.includes(id) && !user) return; // requiere login (el candado está en el Home)
    if (apps[id] && FT[apps[id]]) { setMicroApp(apps[id]); setViewState('home'); }
  };
  const closeMicro = () => setMicroApp(null);

  // --- DASHBOARD (pantalla completa) ---
  if (viewState === 'home') {
    const FT = window.FT_MICRO || {};
    if (microApp && FT[microApp]) {
      const AppComp = FT[microApp];
      return html`<div class="micro-app-view">${html`<${AppComp} onBack=${closeMicro} />`}</div>`;
    }
    if (!authChecked) return html`<div class="home"><div class="empty">Cargando…</div></div>`;
    if (FT.Home) {
      if (!user) return html`<${LoginScreen} onLogin=${setUser} />`;
      return html`<${FT.Home} onOpen=${openMicro} user=${user} onLogout=${logout} />`;
    }
  }

  return html`
    <div class="app-shell">
      <!-- Panel de filtros: siempre fijo al lado -->
      <aside class="search-pane">
        <div class="logo-block">
          <${LogoLockup} />
          <h1 class="sr-only">FuelTech Master</h1>
        </div>
        <${ThemeSwitch} />

        <div class="panel">
          <h2>Filtros de búsqueda</h2>
          <div class="filters">
            <div><label htmlFor="f-brand"><${MarkIcon} name="Tag" size=${13} /> Marca</label>
              <select id="f-brand" name="brand" autocomplete="off" title="Filtra por marca del vehículo" value=${filters.brand_id} onChange=${set('brand_id')}>
                <option value="">Todas</option>
                ${meta?.brands.map(b => html`<option key=${b.id} value=${b.id}>${b.name}</option>`)}
              </select></div>
            <div><label htmlFor="f-model"><${MarkIcon} name="Car" size=${13} /> Modelo</label>
              <input id="f-model" name="model" autocomplete="off" placeholder="Tsuru, Jetta…" maxLength="60" title="Buscar por modelo, ej. Tsuru, Silverado, Jetta (atajo: /)"
                     ref=${modelInputRef} value=${filters.model} onChange=${set('model')} /></div>
            <div><label htmlFor="f-year"><${MarkIcon} name="Calendar" size=${13} /> Año</label>
              <input id="f-year" name="year" autocomplete="off" type="number" inputMode="numeric"
                     min=${meta?.year_range.min} max=${meta?.year_range.max}
                     placeholder=${meta ? `${meta.year_range.min}–${meta.year_range.max}` : ''}
                     title=${meta ? `Año del modelo, entre ${meta.year_range.min} y ${meta.year_range.max}` : 'Año del modelo'}
                     value=${filters.year} onChange=${set('year')} /></div>
            <div><label htmlFor="f-inj"><${MarkIcon} name="Fuel" size=${13} /> Tipo de Inyección</label>
              <select id="f-inj" name="injection_type" autocomplete="off" title="Filtra por tipo de sistema de inyección de combustible" value=${filters.injection_type_id} onChange=${set('injection_type_id')}>
                <option value="">Todas</option>
                ${meta?.injection_types.map(t => html`<option key=${t.id} value=${t.id}>${t.name}</option>`)}
              </select></div>
            <div><label htmlFor="f-ord"><${MarkIcon} name="ArrowUpDown" size=${13} /> Ordenar por</label>
              <select id="f-ord" name="order_by" autocomplete="off" title="Orden de los resultados" value=${filters.order_by} onChange=${set('order_by')}>
                <option value="">Marca, Modelo, Año</option>
                <option value="psi_desc">Presión (Mayor a Menor)</option>
                <option value="year_desc">Año (Más reciente)</option>
              </select></div>
            <button type="button" title="Limpiar filtros (Esc)" onClick=${clearFilters}>Limpiar filtros</button>
            <button type="button" class="mt" style=${{ marginTop: '8px', background: 'var(--accent-fill)', color: 'var(--accent-ink)', border: '1px solid var(--accent-fill)' }} onClick=${() => { setMicroApp(null); setViewState('home'); }}>
              <${MarkIcon} name="View3D" size=${14} /> Inicio (Dashboard)
            </button>
            <button type="button" class="mt" style=${{ marginTop: '8px', background: 'var(--card)', color: 'var(--text)', border: '1px solid var(--border-hi)' }} onClick=${() => { setViewState(viewState === 'calculators' ? 'search' : 'calculators'); }}>
              <${MarkIcon} name="Stethoscope" size=${14} /> ${viewState === 'calculators' ? 'Cerrar Calculadoras' : 'Abrir Calculadoras'}
            </button>
            <button type="button" class="mt" style=${{ marginTop: '8px', background: 'var(--card)', color: 'var(--text)', border: '1px solid var(--border-hi)' }} onClick=${() => { setViewState(viewState === 'tools' ? 'search' : 'tools'); }}>
              <${MarkIcon} name="Wrench" size=${14} /> ${viewState === 'tools' ? 'Cerrar Herramientas' : 'Herramientas del Taller'}
            </button>
          </div>
          ${metaErr && html`<div class="alert"><${Icon} name="AlertTriangle" size=${14} /> Error al cargar catálogos. Verifica tu conexión.</div>`}
        </div>

        <div class="app-footer">
          <div class="footer-head">
            <img class="footer-mark on-dark" src="/brand/mark-dark.png" width="256" height="283" alt="" aria-hidden="true" decoding="async" />
            <img class="footer-mark on-light" src="/brand/mark-light.png" width="256" height="266" alt="" aria-hidden="true" decoding="async" />
            <div class="footer-brand">FUEL<span>TECH</span> MASTER</div>
          </div>
          <div class="footer-desc">Catálogo técnico de módulos y pilas de gasolina</div>
          <div class="footer-desc" style=${{ marginTop: '5px' }}><a href="/guias" style=${{ color: 'var(--muted)', textDecoration: 'underline' }}>Guías de diagnóstico</a> · <a href="/vehiculos" style=${{ color: 'var(--muted)', textDecoration: 'underline' }}>Catálogo completo</a></div>
          <div class="footer-desc" style=${{ marginTop: '4px' }}><a href="/acerca-de" style=${{ color: 'var(--muted)', textDecoration: 'underline' }}>Acerca de</a> · <a href="/contacto" style=${{ color: 'var(--muted)', textDecoration: 'underline' }}>Contacto</a> · <a href="/privacidad" style=${{ color: 'var(--muted)', textDecoration: 'underline' }}>Privacidad y cookies</a> · <a href="/terminos" style=${{ color: 'var(--muted)', textDecoration: 'underline' }}>Términos</a></div>
          <div class="footer-desc" style=${{ marginTop: '5px', opacity: .8 }}>Datos técnicos de referencia: verifica siempre contra el manual de servicio del fabricante antes de intervenir el vehículo.</div>
          <div class="footer-copy">© 2025–2026 FuelTech Master. Todos los derechos reservados.</div>
          <div class="dev-contact">
            <${Icon} name="Mail" size=${13} />
            <a href="#" onClick=${handleEmailClick} title="Enviar correo a newpersonal98@gmail.com">¿Quieres un desarrollo similar? Contáctame: <strong>newpersonal98@gmail.com</strong></a>
          </div>
        </div>
      </aside>

      <!-- Resultados + ficha técnica: misma pantalla, sin navegar -->
      <div class="content-pane" id="main-content">
        <div class="results-strip">
          <div class="rs-head">
            <h2>${showGarage ? 'Mi Garage' : 'Vehículos encontrados'} <button type="button" class="link-btn" style=${{ marginLeft: '10px', fontSize: '11px', letterSpacing: '.5px' }} onClick=${() => setShowGarage(s => !s)}>${showGarage ? '← búsqueda' : `★ Garage (${garage.length})`}</button></h2>
            <div class="result-count" aria-live="polite">
              ${isSearching ? html`<span style=${{color: 'var(--accent)', marginRight: '6px'}}><${Icon} name="Loader2" size=${12} spin=${true} /></span>` : ''}
              ${results ? html`<strong>${results.length}</strong> resultado(s)` : 'Cargando vehículos…'}
              ${results?.some(r => !r.data_verified) &&
                html`<span class="legend-est" title="Dato estimado por clase de sistema, aún sin confirmar contra el manual de servicio del vehículo">${' · '}<em class="r-est">EST.</em> = sin verificar</span>`}
              ${(filters.brand_id || filters.model || filters.year || filters.injection_type_id) &&
                html`<span> · <button type="button" class="link-btn" onClick=${clearFilters}>limpiar filtros</button></span>`}
            </div>
          </div>
          <div class="result-row">
            ${!showGarage && results?.length > 0 && html`<button type="button" class="rl-nav prev" aria-label="Desplazar a la izquierda" onClick=${scrollList(-1)}><${Icon} name="ChevronLeft" size=${20} /></button>`}
            <div class="result-list" ref=${listRef} role="listbox" aria-label=${showGarage ? 'Mi garage' : 'Vehículos encontrados'}>
              ${showGarage && (garage.length
                ? garage.map(r => html`<button key=${r.id} type="button" role="option" aria-selected=${selected === r.id} class=${'result-item' + (selected === r.id ? ' active' : '')} onClick=${() => setSelected(r.id)}>
                    <div class="r-name">${r.brand} ${r.model}</div>
                    <div class="r-meta"><span class="r-psi">${r.psi} PSI</span></div>
                  </button>`)
                : html`<div class="empty-state"><${MarkIcon} name="Favorite" size=${22} /><p>Tu garage está vacío.</p><p class="hint">Abre la ficha de un vehículo y toca "Guardar" para tenerlo a la mano aquí.</p></div>`)}
              ${!showGarage && results?.map(r => html`
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
              ${!showGarage && results?.length === 0 && html`<div class="empty-state" aria-live="polite">
                ${searchErr
                  ? html`<${Icon} name="WifiOff" size=${22} /><p>ERROR DE CONEXIÓN — REINTENTA EN UNOS SEGUNDOS</p>`
                  : html`
                    <${Icon} name="SearchX" size=${22} />
                    <p>No se encontraron vehículos con estos filtros.</p>
                    <p class="hint">Intenta ampliar tu búsqueda: quita la marca, el año o el tipo de inyección.</p>
                    <button type="button" onClick=${clearFilters}><${Icon} name="FilterX" size=${14} /> Limpiar filtros</button>`}
              </div>`}
            </div>
            ${!showGarage && results?.length > 0 && html`<button type="button" class="rl-nav next" aria-label="Desplazar a la derecha" onClick=${scrollList(1)}><${Icon} name="ChevronRight" size=${20} /></button>`}
          </div>
        </div>

        <div class="preview-inner">
          ${viewState === 'calculators' 
             ? html`<${Calculators} />`
             : viewState === 'tools'
               ? html`<${Tools} selectedId=${selected} meta=${meta} />`
               : selected
                 ? html`<${VehicleDetail} id=${selected} />`
                 : html`<div class="empty">SELECCIONA UN VEHÍCULO PARA VER SU FICHA TÉCNICA</div>`}
        </div>
      </div>
      <${ChatBot} vehicleId=${selected} />
      <${ToastStack} />
      ${showPrivacy && html`<div class="panel privacy-notice" role="region" aria-label="Aviso de privacidad">
        <h3 style=${{fontSize: '13px', color: 'var(--text)', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px'}}>
          <${Icon} name="ShieldCheck" size=${16} color="var(--accent)" /> Privacidad y Cookies
        </h3>
        <p style=${{fontSize: '11.5px', color: 'var(--muted)', marginBottom: '14px', lineHeight: 1.45}}>
          Usamos almacenamiento local para tus preferencias, estadísticas anónimas (respetamos Do-Not-Track) y cookies de terceros —incluido Google— para mostrar y medir anuncios.
          Detalle y cómo desactivarlos en la <a href="/privacidad" style=${{color: 'var(--accent)'}}>política de privacidad y cookies</a>.
        </p>
        <button type="button" onClick=${acceptPrivacy} style=${{background: 'var(--accent-fill)', color: 'var(--accent-ink)', border: 'none', padding: '8px 16px', borderRadius: '4px', cursor: 'pointer', fontSize: '11.5px', fontWeight: 600, width: '100%'}}>Aceptar y continuar</button>
      </div>`}
    </div>`;
}

ReactDOM.createRoot(document.getElementById('root')).render(html`<${App} />`);

// PWA: registra el service worker (offline + instalable). Estrategia network-first,
// sin riesgo de servir versiones viejas del código.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
