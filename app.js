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
let tab = ['servicios', 'seguimiento'].includes(store.get(TAB_STORAGE)) ? store.get(TAB_STORAGE) : 'mudanzas';
const FU_URL = API_URL.replace(/agent-api$/, 'agent-followups');
let fu = null;        // { items, rules } de AGENT-FOLLOWUPS

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
async function api(action, payload = {}, url = API_URL) {
  const key = store.get(KEY_STORAGE);
  const res = await fetch(url, {
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

function tabsBar(counts) {
  const c = counts || { mudanzas: data.clients.filter((x) => x.group === 'mudanzas').length, servicios: data.clients.filter((x) => x.group === 'servicios').length };
  const due = fuDue().length;
  const names = { mudanzas: 'Mudanzas (' + c.mudanzas + ')', servicios: 'Servicios (' + c.servicios + ')', seguimiento: '⏰ Seguir' + (due ? ' (' + due + ')' : '') };
  return h('div', { className: 'tabs' }, ['mudanzas', 'servicios', 'seguimiento'].map((g) =>
    h('button', { className: g === tab ? 'on' : '', textContent: names[g], onclick: () => { tab = g; store.set(TAB_STORAGE, g); renderList(); } })));
}

function renderList() {
  if (tab === 'seguimiento') return renderFollowups();
  const clients = data.clients.filter((c) => c.group === tab);
  const counts = { mudanzas: data.clients.filter((c) => c.group === 'mudanzas').length, servicios: data.clients.filter((c) => c.group === 'servicios').length };
  const tabs = tabsBar(counts);
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
    h('main', {}, h('div', { id: 'banner', className: 'banner' }), fuBar(), tabs, list),
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
  loadFollowups(true);
}

window.addEventListener('online', flushQueue);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && store.get(KEY_STORAGE)) { flushQueue(); loadList(true); loadFollowups(true); } });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

// ---------- seguimiento y recordatorios ----------
// Avisos con sonido mientras la app está abierta (iOS no permite sonido en segundo plano sin notificaciones push).
const FU = window.MVFU;
const nowS = () => Math.floor(Date.now() / 1000);
const fuDue = () => (fu && fu.items ? FU.dueItems(fu.items, nowS()) : []);
const rangGet = () => { try { return JSON.parse(store.get('fu_rang') || '{}'); } catch { return {}; } };
const shownGet = () => { try { return JSON.parse(store.get('fu_shown') || '{}'); } catch { return {}; } };

let audioCtx = null;
function unlockAudio() { try { if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)(); if (audioCtx.state === 'suspended') audioCtx.resume(); } catch {} }
['pointerdown', 'keydown'].forEach((ev) => document.addEventListener(ev, unlockAudio, { passive: true }));
function beep(soft) {
  unlockAudio(); if (!audioCtx) return;
  const notes = soft ? [660, 880] : [880, 1175, 880, 1175, 880, 1175], step = soft ? 0.28 : 0.22, len = soft ? 0.22 : 0.18, gain = soft ? 0.2 : 0.4, t0 = audioCtx.currentTime + 0.05;
  notes.forEach((f, i) => {
    const o = audioCtx.createOscillator(), g = audioCtx.createGain(), t = t0 + i * step;
    o.type = 'sine'; o.frequency.value = f; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(g); g.connect(audioCtx.destination); o.start(t); o.stop(t + len + 0.02);
  });
  try { navigator.vibrate && navigator.vibrate(soft ? [150] : [300, 120, 300, 120, 300]); } catch {}
}
function notify(title, body) {
  try { if ('Notification' in window && Notification.permission === 'granted') new Notification(title, { body, icon: 'icon-192.png', requireInteraction: true }); } catch {}
}
let titleTimer = null;
function blinkTitle(n) {
  clearInterval(titleTimer);
  if (!n) { document.title = 'Mis clientes'; return; }
  let on = false; titleTimer = setInterval(() => { on = !on; document.title = on ? '⏰ ' + n + ' vencidos' : 'Mis clientes'; }, 1000);
}

async function loadFollowups(silent) {
  try { fu = await api('fu_list', {}, FU_URL); if (!silent && tab === 'seguimiento' && data) renderList(); }
  catch (e) { if (e.message !== 'auth' && !fu) fu = { items: [], rules: FU.DEFAULT_RULES, error: e.message }; }
  fuTick();
}
function fuTick() {
  if (!fu || !fu.items) return;
  const now = nowS(), rules = fu.rules, due = FU.dueItems(fu.items, now), rang = rangGet(), ring = due.filter((i) => FU.shouldRing(i, now, rang, rules));
  blinkTitle(due.length);
  if (ring.length) {
    ring.forEach((i) => { rang[i.conversation_id] = now; });
    store.set('fu_rang', JSON.stringify(rang));
    beep(false); toast('⏰ ' + ring[0].name + ' · ' + FU.kindText(ring[0].kind) + (ring.length > 1 ? ' (+' + (ring.length - 1) + ')' : ''));
    notify('Seguimiento: ' + ring[0].name, FU.kindText(ring[0].kind));
  }
  const shown = shownGet();
  for (const kind of FU.digestsToShow(now, rules, shown)) {
    shown[kind] = FU.shownKey(kind, now);
    const sum = FU.digestSummary(kind, fu.items, now, rules);
    if (sum.count || kind === 'morning') { if (!ring.length) beep(true); toast(sum.title + ': ' + sum.lines[0]); notify(sum.title, sum.lines.join(' · ')); }
  }
  store.set('fu_shown', JSON.stringify(shown));
  if (data && !document.querySelector('.sheet-bg')) renderList();   // refresca contadores sin pisar una hoja abierta
}

function fuBar() {
  const due = fuDue();
  const items = [];
  if (due.length) items.push(h('div', { className: 'fubar', textContent: '⏰ ' + due.length + ' seguimiento(s) vencido(s) — toca para verlos', onclick: () => { tab = 'seguimiento'; store.set(TAB_STORAGE, tab); renderList(); } }));
  if ('Notification' in window && Notification.permission === 'default') items.push(h('div', { className: 'fubar ok', textContent: '🔔 Toca aquí para activar los avisos del teléfono', onclick: () => Notification.requestPermission().then(() => { unlockAudio(); beep(true); renderList(); }) }));
  return h('div', {}, items);
}

function renderFollowups() {
  const now = nowS(), items = (fu && fu.items) || [];
  const cards = items.map((it) => h('div', { className: 'card' + (FU.isDue(it, now) ? ' due' : ''), onclick: () => openFollowSheet(it) },
    h('div', { className: 'n' }, h('b', { textContent: it.name || it.phone }), h('small', { textContent: FU.kindText(it.kind) + ' · ' + (it.due_at ? FU.dueLabel(it.due_at, now) : 'sin fecha') })),
    h('span', { className: 'pill', textContent: it.stage_title })));
  $app.replaceChildren(
    h('header', {}, h('h1', { textContent: 'Seguimiento' }), h('button', { textContent: '⟳', title: 'Actualizar', onclick: () => loadFollowups() })),
    h('main', {}, h('div', { id: 'banner', className: 'banner' }), fuBar(), tabsBar(),
      h('div', { className: 'hint', textContent: 'Cada seguimiento se cierra con un resultado. El sonido solo funciona con la app abierta.' }),
      !fu ? h('div', { className: 'empty', textContent: 'Cargando…' }) : fu.error && !items.length ? h('div', { className: 'empty', textContent: 'No se pudo cargar el seguimiento.' }) : items.length ? cards : h('div', { className: 'empty', textContent: 'Nada que seguir ahora mismo 🎉' })));
  renderBanner();
}

function openFollowSheet(it) {
  const bg = h('div', { className: 'sheet-bg', style: 'display:block', onclick: (e) => e.target === bg && bg.remove() });
  const sheet = h('div', { className: 'sheet' }); bg.append(sheet); document.body.append(bg);
  const rules = fu.rules, form = { outcome: '', text: '', stage: '', due_at: 0 };
  const paint = (err) => {
    const outs = (rules.outcomes || []).map((o) => h('button', { className: form.outcome === o.code ? 'on' : '', textContent: o.title, onclick: () => { form.outcome = o.code; paint(); } }));
    const kids = [h('h2', { textContent: it.name || it.phone }), h('div', { className: 'ph', textContent: it.phone + ' · ' + it.stage_title + ' · ' + FU.kindText(it.kind) }),
      h('div', { className: 'acts' }, h('a', { href: 'tel:' + it.phone, textContent: '📞 Llamar' }), h('a', { href: 'https://wa.me/' + it.phone.replace(/\D/g, ''), textContent: '💬 WhatsApp' })),
      h('div', { className: 'lbl', textContent: '¿Qué pasó?' }), h('div', { className: 'chips' }, outs)];
    if (form.outcome === 'responded') kids.push(h('div', { className: 'lbl', textContent: 'Nueva etapa' }), h('div', { className: 'chips' }, ['contacted', 'quoted', 'send_to_calendar'].map((s) =>
      h('button', { className: form.stage === s ? 'on' : '', textContent: (rules.stage_titles || {})[s] || s, onclick: () => { form.stage = s; paint(); } }))));
    if (form.outcome === 'later') { const d = h('input', { type: 'datetime-local' }); d.addEventListener('change', () => { form.due_at = d.value ? Math.floor(new Date(d.value).getTime() / 1000) : 0; }); kids.push(h('div', { className: 'lbl', textContent: 'Volver a escribirle el…' }), d); }
    if (form.outcome) {
      const t = h('textarea', { rows: 2, placeholder: form.outcome === 'lost' ? 'Motivo (obligatorio)' : 'Nota (opcional)', value: form.text }); t.addEventListener('input', () => { form.text = t.value; });
      kids.push(t, err ? h('div', { className: 'hint', style: 'color:var(--err)', textContent: err }) : null, h('button', { className: 'btn', textContent: 'Guardar resultado', onclick: submit }));
    }
    kids.push(h('div', { className: 'lbl', textContent: 'O pospón el aviso (no cierra el seguimiento)' }), h('div', { className: 'chips' }, [15, 60].map((m) => h('button', { textContent: m === 60 ? '1 hora' : m + ' min', onclick: () => finish({ outcome: 'snooze', snooze_minutes: m }, null) }))), h('button', { className: 'btn sec', textContent: 'Cerrar', onclick: () => bg.remove() }));
    sheet.replaceChildren(...kids.filter(Boolean));
  };
  async function finish(done, update) {
    try {
      if (update) { const r = await sendUpdate({ conversation_id: it.conversation_id, ...update }); if (r !== true) { if (r === 'queued') toast('Sin conexión: inténtalo de nuevo con red', true); return; } }
      await api('fu_done', { conversation_id: it.conversation_id, ...done }, FU_URL);
      bg.remove(); toast('Seguimiento guardado ✓'); loadFollowups(); loadList(true);
    } catch (e) { if (e.message !== 'auth') toast('No se pudo guardar: ' + e.message, true); }
  }
  function submit() {
    const plan = FU.outcomePlan(form.outcome, form, rules, rules.outcomes);
    if (plan.err) return paint(plan.err);
    finish(plan.done, plan.update);
  }
  paint();
}

setInterval(fuTick, 30 * 1000);
setInterval(() => store.get(KEY_STORAGE) && loadFollowups(true), 5 * 60 * 1000);

start();
