/* FuelTech Master — Panel de administración (vanilla JS, sin scripts inline por CSP) */
const $ = (id) => document.getElementById(id);
const TOKEN_KEY = 'ft_admin_token';
let token = sessionStorage.getItem(TOKEN_KEY) || '';
let boot = null;

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const show = (el, on) => el.classList.toggle('hidden', !on);
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

async function authFetch(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) }
  });
  if (res.status === 401) { logout(); throw new Error('Sesión expirada'); }
  return res;
}

function logout() {
  token = ''; sessionStorage.removeItem(TOKEN_KEY);
  show($('app'), false); show($('login'), true);
}

/* ---------- Login ---------- */
async function doLogin() {
  $('loginErr').textContent = '';
  try {
    const res = await fetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: $('pass').value }) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { $('loginErr').textContent = d.error || 'Error de conexión'; return; }
    token = d.token; sessionStorage.setItem(TOKEN_KEY, token); $('pass').value = '';
    start();
  } catch (e) { $('loginErr').textContent = 'Error de conexión'; }
}
$('loginBtn').addEventListener('click', doLogin);
$('pass').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });

/* ---------- Arranque ---------- */
async function start() {
  try {
    const res = await authFetch('/api/admin/bootstrap');
    boot = await res.json();
  } catch (e) { return; }
  show($('login'), false); show($('app'), true);
  renderCounts(); fillSelects(); renderPumpChecklist([]); loadList(''); switchView('list');
}

const opt = (v, t) => { const o = document.createElement('option'); o.value = v; o.textContent = t; return o; };
function fillSelects() {
  const set = (id, arr, val, txt) => { const s = $(id); s.innerHTML = ''; arr.forEach(x => s.appendChild(opt(val(x), txt(x)))); };
  set('v_brand', boot.brands, b => b.id, b => b.name);
  set('v_inj', boot.injection_types, t => t.id, t => t.name);
  set('v_body', boot.enums.body_types, x => x, x => x);
  set('m_assembly', boot.enums.assembly, x => x, x => x);
  set('l_zone', boot.enums.zones, x => x, x => x);
}
function renderCounts() {
  const c = boot.counts;
  $('counts').innerHTML = `<span><strong>${c.vehicles}</strong> vehículos</span> <span><strong>${c.brands}</strong> marcas</span> <span><strong>${c.pumps}</strong> pilas</span> <span><strong>${c.unverified}</strong> sin verificar</span>`;
}
function renderPumpChecklist(selected) {
  const box = $('p_list'); box.innerHTML = '';
  const sel = new Map((selected || []).map(p => [p.pump_id, p]));
  boot.pumps.forEach(p => {
    const row = document.createElement('div'); row.className = 'pump-row'; row.dataset.id = p.id;
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.className = 'p-sel'; cb.checked = sel.has(p.id);
    const nm = document.createElement('div'); nm.className = 'nm'; nm.textContent = `${p.code} · ${p.manufacturer}`;
    const oemL = document.createElement('label');
    const oem = document.createElement('input'); oem.type = 'checkbox'; oem.className = 'p-oem'; oem.checked = !!(sel.get(p.id) && sel.get(p.id).is_oem);
    oemL.appendChild(oem); oemL.appendChild(document.createTextNode(' OEM'));
    row.append(cb, nm, oemL); box.appendChild(row);
  });
}
async function reloadBoot() {
  try { const res = await authFetch('/api/admin/bootstrap'); boot = await res.json(); renderCounts(); fillSelects(); renderPumpChecklist([]); } catch (e) {}
}

/* ---------- Navegación ---------- */
function switchView(name) {
  show($('view-list'), name === 'list');
  show($('view-editor'), name === 'new' || name === 'editor');
  show($('view-pumps'), name === 'pumps');
  show($('view-brands'), name === 'brands');
  show($('view-insights'), name === 'insights');
  ['list', 'new', 'pumps', 'brands', 'insights'].forEach(n => $('nav-' + n).classList.toggle('active', n === name || (name === 'editor' && n === 'new')));
  if (name === 'insights') loadMissing();
}
$('nav-list').addEventListener('click', () => { loadList($('search').value); switchView('list'); });
$('nav-new').addEventListener('click', () => newVehicle());
$('nav-pumps').addEventListener('click', () => switchView('pumps'));
$('nav-brands').addEventListener('click', () => switchView('brands'));
$('nav-insights').addEventListener('click', () => switchView('insights'));
$('logoutBtn').addEventListener('click', logout);
$('cancelBtn').addEventListener('click', () => { loadList($('search').value); switchView('list'); });
$('search').addEventListener('input', debounce(() => loadList($('search').value), 300));

/* ---------- Lista de vehículos ---------- */
async function loadList(q) {
  const res = await authFetch('/api/admin/vehicles?q=' + encodeURIComponent(q || ''));
  const rows = await res.json();
  const box = $('vlist'); box.innerHTML = '';
  if (!rows.length) { box.innerHTML = '<p class="muted">Sin resultados.</p>'; return; }
  rows.forEach(v => {
    const row = document.createElement('div'); row.className = 'vrow';
    const left = document.createElement('div');
    left.innerHTML = `<div>${esc(v.brand)} ${esc(v.model)} <span class="tag ${v.data_verified ? 'ok' : 'est'}">${v.data_verified ? 'VERIF' : 'EST'}</span></div><div class="meta">${v.year_from}-${v.year_to} · ${esc(v.engine)}</div>`;
    const actions = document.createElement('div'); actions.className = 'row';
    const edit = document.createElement('button'); edit.className = 'small'; edit.textContent = 'Editar'; edit.addEventListener('click', () => editVehicle(v.id));
    const del = document.createElement('button'); del.className = 'small danger'; del.textContent = 'Borrar'; del.addEventListener('click', () => delVehicle(v.id, v));
    actions.append(edit, del);
    row.append(left, actions); box.appendChild(row);
  });
}

/* ---------- Editor ---------- */
function clearForm() {
  ['v_model', 'v_year_from', 'v_year_to', 'v_engine', 'v_psi_min', 'v_psi_max', 'v_notes',
    'm_code', 'm_name', 'm_diagram', 'm_reg_psi', 'm_flow', 'm_regulator', 'm_float', 'm_strainer', 'm_connector', 'm_lines', 'm_mount',
    'l_text', 'l_access'].forEach(id => { $(id).value = ''; });
  $('v_verified').checked = false; $('l_tank').checked = false;
  if (boot) { $('v_brand').selectedIndex = 0; $('v_inj').selectedIndex = 0; $('v_body').value = 'sedan'; $('m_assembly').value = 'module_returnless'; $('l_zone').value = 'tank_drop'; }
}
function newVehicle() {
  $('ed_title').textContent = 'Nuevo vehículo'; $('ed_id').value = '';
  clearForm(); renderPumpChecklist([]); $('saveErr').textContent = ''; $('saveErr').className = 'msg';
  switchView('new');
}
async function editVehicle(id) {
  let d;
  try { const res = await authFetch('/api/admin/vehicles/' + id); if (!res.ok) return; d = await res.json(); } catch (e) { return; }
  const v = d.vehicle, m = d.module || {}, l = d.link || {};
  $('ed_title').textContent = 'Editar: ' + v.model; $('ed_id').value = v.id;
  $('v_brand').value = v.brand_id; $('v_model').value = v.model; $('v_year_from').value = v.year_from; $('v_year_to').value = v.year_to;
  $('v_engine').value = v.engine; $('v_body').value = v.body_type; $('v_inj').value = v.injection_type_id;
  $('v_psi_min').value = v.rail_pressure_psi_min; $('v_psi_max').value = v.rail_pressure_psi_max;
  $('v_notes').value = v.notes || ''; $('v_verified').checked = !!v.data_verified;
  $('m_code').value = m.code || ''; $('m_name').value = m.name || ''; $('m_assembly').value = m.assembly_type || 'module_returnless';
  $('m_diagram').value = m.diagram_key || ''; $('m_reg_psi').value = m.regulated_psi == null ? '' : m.regulated_psi; $('m_flow').value = m.flow_lph == null ? '' : m.flow_lph;
  $('m_regulator').value = m.regulator_type || ''; $('m_float').value = m.float_type || ''; $('m_strainer').value = m.strainer_ref || '';
  $('m_connector').value = m.connector_desc || ''; $('m_lines').value = m.lines_desc || ''; $('m_mount').value = m.mount_desc || '';
  $('l_zone').value = l.location_zone || 'tank_drop'; $('l_tank').checked = !!l.requires_tank_removal; $('l_text').value = l.location_text || ''; $('l_access').value = l.access_notes || '';
  renderPumpChecklist(d.pumps || []);
  $('saveErr').textContent = ''; $('saveErr').className = 'msg';
  switchView('editor');
}
function gatherPayload() {
  const pumps = [];
  document.querySelectorAll('#p_list .pump-row').forEach(r => {
    if (r.querySelector('.p-sel').checked) pumps.push({ pump_id: Number(r.dataset.id), is_oem: r.querySelector('.p-oem').checked, fitment: 'directa' });
  });
  return {
    brand_id: $('v_brand').value, model: $('v_model').value, year_from: $('v_year_from').value, year_to: $('v_year_to').value,
    engine: $('v_engine').value, body_type: $('v_body').value, injection_type_id: $('v_inj').value,
    rail_pressure_psi_min: $('v_psi_min').value, rail_pressure_psi_max: $('v_psi_max').value,
    notes: $('v_notes').value, data_verified: $('v_verified').checked,
    module: {
      code: $('m_code').value, name: $('m_name').value, assembly_type: $('m_assembly').value, diagram_key: $('m_diagram').value,
      regulated_psi: $('m_reg_psi').value, flow_lph: $('m_flow').value, regulator_type: $('m_regulator').value, float_type: $('m_float').value,
      strainer_ref: $('m_strainer').value, connector_desc: $('m_connector').value, lines_desc: $('m_lines').value, mount_desc: $('m_mount').value
    },
    link: { location_text: $('l_text').value, location_zone: $('l_zone').value, requires_tank_removal: $('l_tank').checked, access_notes: $('l_access').value },
    pumps
  };
}
async function save() {
  const err = $('saveErr'); err.textContent = ''; err.className = 'msg';
  const id = $('ed_id').value;
  try {
    const res = await authFetch('/api/admin/vehicles' + (id ? '/' + id : ''), { method: id ? 'PUT' : 'POST', body: JSON.stringify(gatherPayload()) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { err.textContent = d.error || 'Error al guardar'; err.className = 'msg err'; return; }
    await reloadBoot(); loadList(''); switchView('list');
  } catch (e) { err.textContent = 'Error de conexión'; err.className = 'msg err'; }
}
$('saveBtn').addEventListener('click', save);
async function delVehicle(id, v) {
  if (!confirm(`¿Borrar ${v.brand} ${v.model} (${v.year_from}-${v.year_to})? No se puede deshacer.`)) return;
  try { const res = await authFetch('/api/admin/vehicles/' + id, { method: 'DELETE' }); if (res.ok) { await reloadBoot(); loadList($('search').value); } } catch (e) {}
}

/* ---------- Marcas ---------- */
$('br_add').addEventListener('click', async () => {
  const name = $('br_name').value.trim(); const msg = $('br_msg'); msg.className = 'msg'; msg.textContent = '';
  if (!name) { msg.className = 'msg err'; msg.textContent = 'Escribe un nombre'; return; }
  try {
    const res = await authFetch('/api/admin/brands', { method: 'POST', body: JSON.stringify({ name }) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { msg.className = 'msg err'; msg.textContent = d.error || 'Error'; return; }
    msg.className = 'msg ok'; msg.textContent = 'Marca lista: ' + (d.name || name); $('br_name').value = '';
    await reloadBoot();
  } catch (e) { msg.className = 'msg err'; msg.textContent = 'Error de conexión'; }
});

/* ---------- Pilas ---------- */
$('pa_add').addEventListener('click', async () => {
  const msg = $('pa_msg'); msg.className = 'msg'; msg.textContent = '';
  const body = {
    code: $('pa_code').value, manufacturer: $('pa_manuf').value, pump_style: $('pa_style').value,
    max_psi_direct: $('pa_psi').value, amperage_a: $('pa_amp').value, voltage_v: $('pa_volt').value, flow_lph_free: $('pa_flow').value,
    inlet_desc: $('pa_inlet').value, outlet_desc: $('pa_outlet').value, polarity_desc: $('pa_polarity').value, diagram_key: $('pa_diagram').value
  };
  try {
    const res = await authFetch('/api/admin/pumps', { method: 'POST', body: JSON.stringify(body) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { msg.className = 'msg err'; msg.textContent = d.error || 'Error'; return; }
    msg.className = 'msg ok'; msg.textContent = 'Pila agregada.';
    ['pa_code', 'pa_manuf', 'pa_style', 'pa_psi', 'pa_amp', 'pa_volt', 'pa_flow', 'pa_inlet', 'pa_outlet', 'pa_polarity', 'pa_diagram'].forEach(id => { $(id).value = ''; });
    await reloadBoot();
  } catch (e) { msg.className = 'msg err'; msg.textContent = 'Error de conexión'; }
});

/* ---------- Insights ---------- */
async function loadMissing() {
  try {
    const res = await authFetch('/api/admin/missing'); const rows = await res.json();
    const box = $('missing'); box.innerHTML = '';
    if (!rows.length) { box.innerHTML = '<p class="muted">Aún no hay búsquedas sin resultado registradas.</p>'; return; }
    rows.forEach(r => { const d = document.createElement('div'); d.className = 'vrow'; d.innerHTML = `<div>${esc(r.q)}</div><div class="meta">${r.veces}×</div>`; box.appendChild(d); });
  } catch (e) {}
}

/* ---------- Init ---------- */
if (token) start(); else show($('login'), true);
