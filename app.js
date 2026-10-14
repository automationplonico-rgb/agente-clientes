// PWA "Mis clientes" | habla SOLO con AGENT-API v2 de n8n (nunca con Chatwoot directo)
const API_URL = 'https://n8n.alchimedia.co.uk/webhook/agent-api';
const KEY_STORAGE = 'agent_key';
const QUEUE_STORAGE = 'agent_queue_v2';
const TAB_STORAGE = 'agent_tab';
const CALL_NOTE = /^📞 Llamada registrada/;   // nota que deja el dashboard del supervisor al registrar una llamada

const $app = document.getElementById('app');
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
  del: (k) => { try { localStorage.removeItem(k); } catch {} }
};
let cfg = null;       // { stages, services, home_services, agent }
let data = null;      // { clients }
let tab = store.get(TAB_STORAGE) === 'servicios' ? 'servicios' : 'mudanzas';

// ---------- utilidades ----------
function h(tag, props = {}, ...kids) {
  const n = Object.assign(document.createElement(tag), props);
  n.append(...kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false));
  return n;
}
function toast(msg, err = false) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = err ? 'err' : ''; t.style.display = 'block';
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.style.display = 'none'), 2500);
}
function normalizePhone(raw) {
  let d = String(raw).replace(/[^\d+]/g, '');
  if (d.startsWith('00')) d = '+' + d.slice(2);
  else if (/^0\d{10}$/.test(d)) d = '+44' + d.slice(1);   // UK por defecto
  else if (!d.startsWith('+')) d = '+' + d;
  return /^\+\d{9,15}$/.test(d) ? d : null;
}
const fmtDate = (t) => { try { return new Date(t * 1000).toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };

// ---------- API ----------
async function api(action, payload = {}) {
  const key = store.get(KEY_STORAGE);
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Agent-Key': key || '' },
    body: JSON.stringify({ action, ...payload })
  });
  if (res.status === 401) { store.del(KEY_STORAGE); showLogin('Clave incorrecta o desactivada.'); throw new Error('auth'); }
  let j = null; try { j = await res.json(); } catch {}
  if (!res.ok || !j || j.ok === false) { const e = new Error((j && j.error) || 'HTTP ' + res.status); e.api = true; throw e; }
  return j;
}

// ---------- cola offline (iOS no soporta Background Sync: se reintenta al abrir / volver la red) ----------
const getQueue = () => { try { return JSON.parse(store.get(QUEUE_STORAGE) || '[]'); } catch { return []; } };
const setQueue = (q) => store.set(QUEUE_STORAGE, JSON.stringify(q));
async function flushQueue() {
  const q = getQueue();
  if (!q.length || !navigator.onLine) return renderBanner();
  const rest = [];
  for (const item of q) {
    try { await api('update', item); }
    catch (e) { if (e.message === 'auth') return; if (!e.api) rest.push(item); }   // error de red: se conserva; rechazo del servidor: se descarta
  }
  setQueue(rest);
  renderBanner();
  if (rest.length < q.length) loadList(true);
}
function renderBanner() {
  const b = document.getElementById('banner'); if (!b) return;
  const n = getQueue().length;
  b.style.display = n ? 'block' : 'none';
  b.textContent = n ? `${n} cambio(s) pendientes de enviar — se reintentarán al tener conexión.` : '';
}
async function sendUpdate(payload) {
  try { await api('update', payload); return true; }
  catch (e) {
    if (e.message === 'auth') return false;
    if (e.api) { toast('No se pudo guardar: ' + e.message, true); return false; }
    setQueue([...getQueue(), payload]); renderBanner(); return 'queued';
  }
}

// ---------- pantallas ----------
function showLogin(msg = '') {
  const input = h('input', { type: 'password', placeholder: 'Clave de agente', autocomplete: 'off', autocapitalize: 'off' });
  const go = () => { const k = input.value.trim(); if (!k) return; store.set(KEY_STORAGE, k); start(); };
  input.addEventListener('keydown', (e) => e.key === 'Enter' && go());
  $app.replaceChildren(h('div', { className: 'login' },
    h('h1', { textContent: 'Mis clientes' }),
    h('p', { textContent: 'Introduce la clave que te dio el administrador.' }),
    input,
    h('button', { className: 'btn', textContent: 'Entrar', onclick: go }),
    h('p', { textContent: msg, style: 'color:var(--err)' })
  ));
}

const stageOf = (c) => ((cfg && cfg.stages) || []).find((x) => c.labels.includes(x.label));
const hasCall = (labels) => (labels || []).includes('pending_call');

function renderList() {
  const clients = data.clients.filter((c) => c.group === tab);
  const counts = { mudanzas: data.clients.filter((c) => c.group === 'mudanzas').length, servicios: data.clients.filter((c) => c.group === 'servicios').length };
  const tabs = h('div', { className: 'tabs' }, ['mudanzas', 'servicios'].map((g) =>
    h('button', { className: g === tab ? 'on' : '', textContent: (g === 'mudanzas' ? 'Mudanzas' : 'Servicios') + ' (' + counts[g] + ')',
      onclick: () => { tab = g; store.set(TAB_STORAGE, g); renderList(); } })));
  const list = h('div');
  if (!clients.length) list.append(h('div', { className: 'empty', textContent: 'No tienes clientes abiertos aquí. Pulsa + para añadir uno.' }));
  for (const c of clients) {
    const st = stageOf(c);
    list.append(h('div', { className: 'card', onclick: () => openSheet(c) },
      h('div', { className: 'n' }, h('b', { textContent: c.name || c.phone }), h('small', { textContent: c.phone })),
      hasCall(c.labels) ? h('span', { className: 'call', title: 'Llamada pendiente con el supervisor', textContent: '📞' }) : null,
      h('span', { className: 'pill' + (st ? '' : ' none'), textContent: st ? st.title : 'Sin etapa' })
    ));
  }
  $app.replaceChildren(
    h('header', {}, h('h1', { textContent: 'Mis clientes' }),
      h('button', { textContent: '⟳', title: 'Actualizar', onclick: () => loadList() }),
      h('button', { textContent: 'Salir', onclick: () => { store.del(KEY_STORAGE); showLogin(); } })),
    h('main', {}, h('div', { id: 'banner', className: 'banner' }), tabs, list),
    h('button', { className: 'fab', textContent: '+', onclick: () => openSheet(null) })
  );
  renderBanner();
}

// Hoja inferior: cliente existente (c) o nuevo (c = null)
function openSheet(c) {
  const isNew = !c;
  const bg = h('div', { className: 'sheet-bg', style: 'display:block', onclick: (e) => e.target === bg && bg.remove() });
  const sheet = h('div', { className: 'sheet' });
  bg.append(sheet); document.body.append(bg);
  if (isNew) sheetNew(sheet, bg); else sheetClient(sheet, bg, c);
}

function sheetNew(sheet, bg) {
  const phoneIn = h('input', { type: 'tel', placeholder: 'Teléfono: pega +44 7700 900123', inputMode: 'tel' });
  const nameIn = h('input', { placeholder: 'Nombre (opcional)', style: 'margin-top:8px' });
  const noteIn = h('textarea', { placeholder: 'Nota interna (opcional)', rows: 2, style: 'margin-top:8px' });
  let group = tab;
  const svcSel = h('select', { style: 'margin-top:8px' });
  const fillSvc = () => {
    const list = group === 'servicios' ? (cfg.home_services || []) : (cfg.services || []);
    svcSel.replaceChildren(...list.map((s) => h('option', { value: s.code, textContent: s.title })));
  };
  const grp = h('div', { className: 'tabs' }, ['mudanzas', 'servicios'].map((g) => h('button', { className: g === group ? 'on' : '', textContent: g === 'mudanzas' ? 'Mudanza' : 'Servicio del hogar',
    onclick: (e) => { group = g; grp.querySelectorAll('button').forEach((b) => b.classList.remove('on')); e.target.classList.add('on'); fillSvc(); } })));
  fillSvc();
  const save = h('button', { className: 'btn', textContent: 'Añadir al CRM', onclick: async () => {
    const phone = normalizePhone(phoneIn.value);
    if (!phone) return toast('Teléfono no válido', true);
    save.disabled = true;
    try {
      const r = await api('create', { phone, name_hint: nameIn.value.trim() || undefined, service: svcSel.value, ...(group === 'servicios' ? { group: 'servicios' } : {}) });
      if (r.conversation_id && noteIn.value.trim()) await sendUpdate({ conversation_id: r.conversation_id, note: noteIn.value.trim() });
      toast(r.created ? 'Añadido al CRM ✓' : 'Ese cliente ya estaba en el CRM');
      bg.remove(); loadList(true);
    } catch (e) { save.disabled = false; if (e.message !== 'auth') toast('No se pudo crear: ' + e.message, true); }
  } });
  sheet.append(h('h2', { textContent: 'Nuevo cliente' }), grp, phoneIn, nameIn, svcSel, noteIn, save, h('button', { className: 'btn sec', textContent: 'Cerrar', onclick: () => bg.remove() }));
  setTimeout(() => phoneIn.focus(), 50);
}

function sheetClient(sheet, bg, c) {
  // Datos completos de la conversación (notas, atributos, etapa) desde AGENT-API
  const info = { conv: null, notes: [], loaded: false };
  const body = h('div');
  const noteIn = h('textarea', { placeholder: 'Nota interna (opcional)', rows: 2, style: 'margin-top:8px' });

  const paint = () => {
    const labels = c.labels || [];
    const stageNow = stageOf(c);
    const lastCall = info.notes.find((n) => CALL_NOTE.test(n.text));
    const stages = h('div', { className: 'stages' }, (cfg.stages || []).map((s) => h('button', { className: stageNow && stageNow.label === s.label ? 'on' : '', textContent: s.title, onclick: async () => {
      const old = c.labels; c.labels = [...old.filter((l) => !(cfg.stages || []).some((x) => x.label === l)), s.label]; paint();
      const r = await sendUpdate({ conversation_id: c.conversation_id, stage: s.label, ...(noteIn.value.trim() ? { note: noteIn.value.trim() } : {}) });
      if (r === false) { c.labels = old; paint(); return; }
      noteIn.value = ''; toast(r === 'queued' ? 'Sin conexión: guardado para enviar' : 'Etapa guardada ✓'); if (r === true) loadList(true);
    } })));

    const callOn = hasCall(labels);
    const callBtn = h('button', { className: 'btn' + (callOn ? '' : ' sec'), textContent: callOn ? '📞 Llamada pendiente con el supervisor ✓ (quitar)' : '📞 Pasar al supervisor para llamar', onclick: async () => {
      const old = c.labels; c.labels = callOn ? old.filter((l) => l !== 'pending_call') : [...old, 'pending_call']; paint();
      const r = await sendUpdate({ conversation_id: c.conversation_id, pending_call: !callOn });
      if (r === false) { c.labels = old; paint(); return; }
      toast(r === 'queued' ? 'Sin conexión: guardado para enviar' : callOn ? 'Llamada pendiente quitada ✓' : 'Pasado al supervisor ✓'); if (r === true) { loadList(true); setTimeout(loadInfo, 1500); }
    } });

    const conv = info.conv, a = (conv && conv.custom_attributes) || {};
    const parts = String(a.lead_name || '').match(/^(\S+) (\S+) (\d{6}) (\S+)$/);
    let svcBox = null;
    if (parts) {
      const svcNow = parts[2] === 'ManVan' ? 'Man&Van' : parts[2];
      const list = a.pipeline === 'servicios' ? (cfg.home_services || []) : (cfg.services || []);
      const opts = list.some((s) => s.code === svcNow) ? list : [...list, { code: svcNow, title: svcNow }];
      const sel = h('select', {}, opts.map((s) => h('option', { value: s.code, textContent: s.title, selected: s.code === svcNow })));
      sel.addEventListener('change', async () => {
        try { const r = await api('rename', { conversation_id: c.conversation_id, service: sel.value }); toast(r.changed ? 'Nombre actualizado ✓' : 'Sin cambios'); loadList(true); loadInfo(); }
        catch (e) { if (e.message !== 'auth') toast(e.message === 'name_not_standard' ? 'Este lead no tiene nombre estándar' : 'No se pudo cambiar el servicio', true); }
      });
      svcBox = [h('div', { className: 'lbl', textContent: 'Servicio (cambia el nombre en todos los sistemas)' }), sel, h('div', { className: 'lbl', textContent: a.lead_name })];
    }

    const notes = info.loaded ? (info.notes.length ? info.notes.map((n) => h('div', { className: 'note' + (CALL_NOTE.test(n.text) ? ' call' : '') },
      h('small', { textContent: [n.by, fmtDate(n.at)].filter(Boolean).join(' · ') }), String(n.text))) : [h('div', { className: 'lbl', textContent: 'Sin notas todavía.' })])
      : [h('div', { className: 'lbl', textContent: 'Cargando notas…' })];

    body.replaceChildren(...[
      h('div', { className: 'acts' },
        h('a', { href: 'tel:' + c.phone, textContent: '📞 Llamar' }),
        h('a', { href: 'https://wa.me/' + c.phone.replace(/\D/g, ''), textContent: '💬 WhatsApp' })),
      lastCall ? h('div', { className: 'note call' }, h('small', { textContent: 'Última llamada del supervisor · ' + [lastCall.by, fmtDate(lastCall.at)].filter(Boolean).join(' · ') }), String(lastCall.text).replace(CALL_NOTE, '').replace(/^\s*—\s*/, '')) : null,
      h('div', { className: 'lbl', textContent: 'Etapa' }), stages, callBtn, svcBox, noteIn,
      h('button', { className: 'btn', textContent: 'Guardar nota', onclick: async () => {
        const t = noteIn.value.trim(); if (!t) return toast('Escribe la nota', true);
        const r = await sendUpdate({ conversation_id: c.conversation_id, note: t });
        if (r === false) return;
        noteIn.value = ''; toast(r === 'queued' ? 'Sin conexión: guardado para enviar' : 'Nota guardada ✓');
        if (r === true) { info.notes = [{ at: Math.floor(Date.now() / 1000), by: 'Tú', text: '[WhatsApp] ' + t }, ...info.notes]; paint(); setTimeout(loadInfo, 1500); }
      } }),
      h('div', { className: 'lbl', textContent: 'Notas internas (incluye las del supervisor)' }), notes,
      // Archivar = resolver la conversación: sale de la lista pero el cliente y su Deal siguen en el CRM
      h('button', { className: 'btn sec', style: 'color:var(--err)', textContent: 'Quitar de mi lista', onclick: async () => {
        if (!confirm(`¿Quitar a ${c.name || c.phone} de tu lista?\n\nNo se borra: el cliente y su negocio siguen en el CRM.`)) return;
        try {
          await api('status', { conversation_id: c.conversation_id, status: 'resolved' });
          data.clients = data.clients.filter((x) => x.conversation_id !== c.conversation_id);
          bg.remove(); renderList(); toast('Quitado de tu lista');
        } catch (e) { if (e.message !== 'auth') toast('No se pudo quitar (¿sin conexión?)', true); }
      } }),
      h('button', { className: 'btn sec', textContent: 'Cerrar', onclick: () => bg.remove() })
    ].flat(Infinity).filter(Boolean));
  };

  async function loadInfo() {
    try {
      const r = await api('lookup', { phone: c.phone });
      if (r.found && r.conversation) { info.conv = r.conversation; info.notes = r.notes || []; if (r.conversation.labels) c.labels = r.conversation.labels; }
      info.loaded = true; paint();
    } catch (e) { info.loaded = true; if (e.message !== 'auth') paint(); }
  }

  sheet.append(h('h2', { textContent: c.name || c.phone }), h('div', { className: 'ph', textContent: c.phone }), body);
  paint(); loadInfo();
}

async function loadList(silent = false) {
  if (!silent) toast('Actualizando…');
  try {
    if (!cfg) cfg = await api('config');
    data = await api('mine');
    renderList();
  } catch (e) { if (e.message !== 'auth') { toast('No se pudo cargar la lista', true); if (data) renderList(); } }
}

function start() {
  // Enlace de activación: #k=CLAVE (se borra de la URL al leerlo)
  const m = location.hash.match(/k=([^&]+)/);
  if (m) { store.set(KEY_STORAGE, decodeURIComponent(m[1])); history.replaceState(null, '', location.pathname); }
  if (!store.get(KEY_STORAGE)) return showLogin();
  $app.replaceChildren(h('div', { className: 'empty', textContent: 'Cargando…' }));
  loadList(true).then(flushQueue);
}

window.addEventListener('online', flushQueue);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && store.get(KEY_STORAGE)) { flushQueue(); loadList(true); } });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
start();
