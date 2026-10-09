// PWA "Mis clientes" | habla SOLO con el gateway de n8n (nunca con Chatwoot directo)
const GATEWAY_URL = 'https://n8n.alchimedia.co.uk/webhook/wa-gateway';
const KEY_STORAGE = 'agent_key';
const QUEUE_STORAGE = 'agent_queue';

const $app = document.getElementById('app');
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
  del: (k) => { try { localStorage.removeItem(k); } catch {} }
};
let data = null;      // { clients, stages, tags, attributes }
let current = null;   // cliente abierto en la hoja

// ---------- utilidades ----------
function h(tag, props = {}, ...kids) {
  const n = Object.assign(document.createElement(tag), props);
  n.append(...kids.flat().filter((k) => k !== null && k !== undefined));
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
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());

// ---------- gateway ----------
async function gateway(action, payload = {}) {
  const key = store.get(KEY_STORAGE);
  const res = await fetch(GATEWAY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Agent-Key': key || '' },
    body: JSON.stringify({ action, request_id: uuid(), source: 'agent-pwa', sent_at: new Date().toISOString(), ...payload })
  });
  if (res.status === 401) { store.del(KEY_STORAGE); showLogin('Clave incorrecta o desactivada.'); throw new Error('auth'); }
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

// ---------- cola offline (iOS no soporta Background Sync: se reintenta al abrir / volver la red) ----------
const getQueue = () => { try { return JSON.parse(store.get(QUEUE_STORAGE) || '[]'); } catch { return []; } };
const setQueue = (q) => store.set(QUEUE_STORAGE, JSON.stringify(q));
async function flushQueue() {
  let q = getQueue();
  if (!q.length || !navigator.onLine) return renderBanner();
  const rest = [];
  for (const item of q) {
    try { await gateway('update', item); } catch (e) { if (e.message === 'auth') return; rest.push(item); }
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
  try { await gateway('update', payload); return true; }
  catch (e) {
    if (e.message === 'auth') return false;
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

function stageOf(c) {
  const s = (data.stages || []).find((x) => c.labels.includes(x.label));
  return s ? s.title : null;
}

function renderList() {
  const list = h('div');
  if (!data.clients.length) list.append(h('div', { className: 'empty', textContent: 'No tienes clientes abiertos. Pulsa + para añadir uno.' }));
  for (const c of data.clients) {
    const st = stageOf(c);
    list.append(h('div', { className: 'card', onclick: () => openSheet(c) },
      h('div', { className: 'n' }, h('b', { textContent: c.name || c.phone }), h('small', { textContent: c.phone })),
      h('span', { className: 'pill' + (st ? '' : ' none'), textContent: st || 'Sin etapa' })
    ));
  }
  $app.replaceChildren(
    h('header', {}, h('h1', { textContent: 'Mis clientes' }),
      h('button', { textContent: '⟳', title: 'Actualizar', onclick: () => loadList() }),
      h('button', { textContent: 'Salir', onclick: () => { store.del(KEY_STORAGE); showLogin(); } })),
    h('main', {}, h('div', { id: 'banner', className: 'banner' }), list),
    h('button', { className: 'fab', textContent: '+', onclick: () => openSheet(null) })
  );
  renderBanner();
}

// Hoja inferior: cliente existente (c) o nuevo (c = null)
function openSheet(c) {
  current = c;
  const isNew = !c;
  const phoneIn = h('input', { type: 'tel', placeholder: 'Teléfono: pega +44 7700 900123', inputMode: 'tel' });
  const nameIn = h('input', { placeholder: 'Nombre (opcional)', style: 'margin-top:8px' });
  const noteIn = h('textarea', { placeholder: 'Nota interna (opcional)', rows: 2, style: 'margin-top:8px' });
  const bg = h('div', { className: 'sheet-bg', style: 'display:block', onclick: (e) => e.target === bg && bg.remove() });

  const stageBtns = h('div', { className: 'stages' });
  for (const s of data.stages) {
    const on = c && c.labels.includes(s.label);
    stageBtns.append(h('button', { className: on ? 'on' : '', textContent: s.title, onclick: async () => {
      let phone = c ? c.phone : normalizePhone(phoneIn.value);
      if (!phone) return toast('Teléfono no válido', true);
      // Etapa nueva + conserva el resto de etiquetas del cliente (el gateway filtra las no gestionadas)
      const stageSet = new Set(data.stages.map((x) => x.label));
      const labels = [...(c ? c.labels.filter((l) => !stageSet.has(l)) : []), s.label];
      const payload = { phone, name: c ? c.name : nameIn.value.trim() || undefined, name_hint: c ? c.name : nameIn.value.trim() || undefined,
                        labels, note: noteIn.value.trim() || undefined };
      stageBtns.querySelectorAll('button').forEach((b) => (b.disabled = true));
      const r = await sendUpdate(payload);
      if (r === false) return;
      toast(r === 'queued' ? 'Sin conexión: guardado para enviar' : 'Guardado ✓');
      if (c) c.labels = labels;
      bg.remove();
      if (r === true) loadList(true); else renderList();
    } }));
  }

  const sheet = h('div', { className: 'sheet' },
    isNew ? h('h2', { textContent: 'Nuevo cliente' }) : h('h2', { textContent: c.name || c.phone }),
    isNew ? [phoneIn, nameIn] : h('div', { className: 'ph', textContent: c.phone }),
    isNew ? null : h('div', { className: 'acts' },
      h('a', { href: 'tel:' + c.phone, textContent: '📞 Llamar' }),
      h('a', { href: 'https://wa.me/' + c.phone.replace(/\D/g, ''), textContent: '💬 WhatsApp' })),
    h('div', { textContent: 'Etapa', style: 'color:var(--mu);font-size:13px;margin-top:6px' }),
    stageBtns, noteIn,
    // Archivar = resolver la conversación: sale de la lista pero el cliente y su Deal siguen en el CRM
    isNew ? null : h('button', { className: 'btn sec', style: 'color:var(--err)', textContent: 'Quitar de mi lista', onclick: async () => {
      if (!confirm(`¿Quitar a ${c.name || c.phone} de tu lista?\n\nNo se borra: el cliente y su negocio siguen en el CRM.`)) return;
      try {
        await gateway('archive', { conversation_id: c.conversation_id });
        data.clients = data.clients.filter((x) => x.conversation_id !== c.conversation_id);
        bg.remove(); renderList(); toast('Quitado de tu lista');
      } catch (e) { if (e.message !== 'auth') toast('No se pudo quitar (¿sin conexión?)', true); }
    } }),
    h('button', { className: 'btn sec', textContent: 'Cerrar', onclick: () => bg.remove() })
  );
  bg.append(sheet); document.body.append(bg);
  if (isNew) setTimeout(() => phoneIn.focus(), 50);
}

async function loadList(silent = false) {
  if (!silent) toast('Actualizando…');
  try { data = await gateway('mine'); renderList(); }
  catch (e) { if (e.message !== 'auth') { toast('No se pudo cargar la lista', true); if (data) renderList(); } }
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
