// Vista de supervisor dentro de la app de agentes: cola de llamadas (con resultado, posponer y avisos) y panel de control de los agentes.
// Se carga antes de app.js y usa sus utilidades (h, api, toast, tab, ...) solo cuando se ejecuta. Habla con AGENT-SUPERVISOR.
(function () {
  const RESULTS = [
    { code: 'contacted', title: 'Contactado' }, { code: 'quoted', title: 'Cotizado (por llamada)' }, { code: 'send_quote', title: 'Mandar cotización' },
    { code: 'follow_up', title: 'Seguimiento' }, { code: 'lead_won', title: 'Ganado' }, { code: 'lead_lost', title: 'Perdido' },
    { code: 'reclaim', title: 'Reclamar' }, { code: 'no_answer', title: 'No contesta' }];
  const HINTS = {
    contacted: 'Hablaste con el cliente, aún sin precio.', quoted: 'Le diste la cotización durante la llamada.', send_quote: 'El agente recibirá una tarea: enviar la cotización por escrito.',
    follow_up: 'Contestó pero no está seguro, o pidió otra llamada. Con fecha, vuelve a tu cola; sin fecha, vuelve al agente.', lead_won: 'El cliente aceptó (Quote accepted).',
    lead_lost: 'El cliente dijo que no directamente en la llamada.', reclaim: 'Número inválido o no quería el servicio: el agente reclamará el lead en la plataforma donde se compró.', no_answer: 'No contestó; sale de la cola.' };
  const sup = { queue: null, panel: null, seen: null, urgent: {}, timer: null };
  const fmt = (ts) => { try { return new Date(ts * 1000).toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };
  const dayAgo = () => Math.floor(Date.now() / 1000) - 86400;

  async function loadQueue(silent) {
    try {
      const r = await api('sup_queue', {}, SUP_URL);
      const ids = new Set(r.calls.map((c) => c.conversation_id));
      if (sup.seen) { // avisos dentro de la app cuando entra una llamada nueva o se actualiza una solicitud
        const fresh = r.calls.filter((c) => !sup.seen.has(c.conversation_id));
        const upd = r.calls.filter((c) => sup.seen.has(c.conversation_id) && c.urgent_at > (sup.urgent[c.conversation_id] || 0));
        if (fresh.length || upd.length) { beep(false); toast(fresh.length ? '📞 Nueva llamada: ' + fresh[0].name : '🔔 Solicitud actualizada: ' + upd[0].name); }
      }
      sup.seen = ids; sup.urgent = Object.fromEntries(r.calls.map((c) => [c.conversation_id, c.urgent_at]));
      sup.queue = r;
    } catch (e) { if (e.message !== 'auth' && !sup.queue) sup.queue = { calls: [], error: e.message }; }
    refresh();
  }
  async function loadPanel(silent) {
    try { sup.panel = await api('sup_overview', {}, SUP_URL); } catch (e) { if (e.message !== 'auth' && !sup.panel) sup.panel = { agents: [], totals: {}, error: e.message }; }
    if (tab === 'panel' || !silent) refresh();
  }
  const refresh = () => { if (data && !document.querySelector('.sheet-bg')) renderList(); };   // también en las otras pestañas: el contador de llamadas del menú se actualiza

  function frame(title, body, onReload) {
    $app.replaceChildren(
      h('header', {}, h('h1', { textContent: title }), h('button', { textContent: '⟳', title: 'Actualizar', onclick: onReload })),
      h('main', {}, h('div', { id: 'banner', className: 'banner' }), tabsBar(), body));
    renderBanner();
  }

  function renderQueue() {
    const q = sup.queue, calls = (q && q.calls) || [];
    const due = calls.filter((c) => c.due_now), later = calls.filter((c) => !c.due_now);
    const card = (c) => h('div', { className: 'card due-call' + (c.urgent_at > dayAgo() ? ' due' : ''), style: 'display:block;cursor:default' },
      h('div', { style: 'display:flex;align-items:center;gap:8px' }, h('b', { style: 'flex:1', textContent: c.name || c.phone }),
        c.urgent_at > dayAgo() ? h('span', { className: 'pill', style: 'background:var(--err)', textContent: '🔔 Actualizada' }) : null,
        c.status === 'postponed' ? h('span', { className: 'pill none', textContent: '⏸ ' + (c.due_now ? 'lista' : fmt(c.until)) }) : null),
      h('small', { textContent: [c.phone, c.agent && 'Agente: ' + c.agent, c.platform].filter(Boolean).join(' · ') }),
      c.pickup || c.dropoff ? h('div', { className: 'hint', textContent: [c.pickup, c.dropoff].filter(Boolean).join(' → ') + (c.move_date ? ' · ' + c.move_date : '') + (c.size ? ' · ' + c.size : '') }) : null,
      c.note ? h('div', { className: 'note', textContent: '📝 ' + c.note }) : null,
      h('div', { className: 'acts' },
        h('a', { href: 'tel:' + c.phone, textContent: '📞 Llamar' }),
        c.hubspot_url ? h('a', { href: c.hubspot_url, target: '_blank', rel: 'noopener noreferrer', textContent: 'HubSpot' }) : null),
      h('div', { className: 'acts' },
        h('button', { className: 'btn', style: 'margin:0', textContent: 'Registrar llamada', onclick: () => resultSheet(c) }),
        h('button', { className: 'btn sec', style: 'margin:0', textContent: 'Posponer', onclick: () => postponeSheet(c) })));
    frame('Cola de llamadas', [
      !q ? h('div', { className: 'empty', textContent: 'Cargando…' }) : q.error && !calls.length ? h('div', { className: 'empty', textContent: 'No se pudo cargar la cola.' })
        : !calls.length ? h('div', { className: 'empty', textContent: 'No hay llamadas pendientes 🎉' }) : [
          due.length ? h('div', { className: 'lbl', textContent: 'Para llamar ahora (' + due.length + ')' }) : null, due.map(card),
          later.length ? h('div', { className: 'lbl', textContent: 'Pospuestas (' + later.length + ')' }) : null, later.map(card)]], () => loadQueue());
  }

  function sheet(title, kids) {
    const bg = h('div', { className: 'sheet-bg', style: 'display:block', onclick: (e) => e.target === bg && bg.remove() });
    const sh = h('div', { className: 'sheet' }, h('h2', { textContent: title }), ...kids(bg));
    bg.append(sh); document.body.append(bg); return bg;
  }

  function resultSheet(c) {
    const f = { result: '', note: '', ts: 0 };
    let paint;
    sheet('Registrar llamada · ' + (c.name || c.phone), (bg) => {
      const box = h('div');
      const when = whenPicker((ts) => { f.ts = ts; });   // se crea una vez: se conserva la hora elegida al cambiar de resultado
      paint = (err) => {
        const chips = h('div', { className: 'chips' }, RESULTS.map((r) => h('button', { className: f.result === r.code ? 'on' : '', textContent: r.title, onclick: () => { f.result = r.code; paint(); } })));
        const note = h('textarea', { rows: 3, placeholder: f.result === 'send_quote' ? 'Qué cotización / datos debe enviar el agente' : 'Nota de la llamada', value: f.note }); note.addEventListener('input', () => { f.note = note.value; });
        box.replaceChildren(h('div', {}, h('div', { className: 'lbl', textContent: 'Resultado' }), chips,   // h() descarta los null: replaceChildren los pintaría como el texto "null"
          f.result ? h('div', { className: 'hint', textContent: HINTS[f.result] }) : null,
          f.result === 'follow_up' ? [h('div', { className: 'lbl', textContent: 'Volver a llamar el… (opcional)' }), when] : null,
          h('div', { className: 'lbl', textContent: 'Nota (la ve el agente en el chat)' }), note,
          err ? h('div', { className: 'hint', style: 'color:var(--err)', textContent: err }) : null,
          h('button', { className: 'btn', textContent: 'Guardar y avisar al agente', onclick: async () => {
            if (!f.result) return paint('Elige el resultado de la llamada.');
            const until = f.result === 'follow_up' ? f.ts : 0;
            if (until && until < Date.now() / 1000 + 120) return paint('La fecha tiene que ser futura.');
            try { await api('sup_result', { conversation_id: c.conversation_id, result: f.result, note: f.note.trim(), ...(until ? { until } : {}) }, SUP_URL); bg.remove(); toast('Llamada registrada ✓ (el agente recibió el aviso)'); loadQueue(); }
            catch (e) { if (e.message !== 'auth') paint('No se pudo guardar: ' + e.message); }
          } }),
          h('button', { className: 'btn sec', textContent: 'Cerrar', onclick: () => bg.remove() })));
      };
      paint(); return [box];
    });
  }

  function postponeSheet(c) {
    const f = { ts: 0, note: '' };
    sheet('Posponer · ' + (c.name || c.phone), (bg) => {
      const when = whenPicker((ts) => { f.ts = ts; });
      const note = h('textarea', { rows: 2, placeholder: 'Motivo (opcional, lo ve el agente)' }); note.addEventListener('input', () => { f.note = note.value; });
      const err = h('div', { className: 'hint', style: 'color:var(--err)' });
      return [h('div', { className: 'lbl', textContent: 'Volver a llamar el…' }), when, note, err,
        h('button', { className: 'btn', textContent: 'Posponer y avisar al agente', onclick: async () => {
          const ts = f.ts; if (!ts || ts < Date.now() / 1000 + 120) { err.textContent = 'Elige una hora al menos 2 minutos en el futuro.'; return; }
          try { await api('sup_postpone', { conversation_id: c.conversation_id, until: ts, note: f.note.trim() }, SUP_URL); bg.remove(); toast('Llamada pospuesta ✓ (el agente recibió el aviso)'); loadQueue(); }
          catch (e) { if (e.message !== 'auth') err.textContent = 'No se pudo posponer: ' + e.message; }
        } }), h('button', { className: 'btn sec', textContent: 'Cerrar', onclick: () => bg.remove() })];
    });
  }

  function renderPanel() {
    const p = sup.panel, ag = (p && p.agents) || [], t = (p && p.totals) || {};
    const age = (s) => (s >= 86400 ? Math.floor(s / 86400) + ' d' : s >= 3600 ? Math.floor(s / 3600) + ' h' : Math.max(1, Math.floor(s / 60)) + ' min');
    const stat = (label, n, bad) => h('span', { className: 'pill' + (n ? '' : ' none'), style: n && bad ? 'background:var(--err)' : '', textContent: label + ' ' + n });
    const card = (a) => h('div', { className: 'card' + (a.overdue ? ' due' : ''), style: 'display:block;cursor:default' },
      h('div', { style: 'display:flex;align-items:center;gap:8px' }, h('b', { style: 'flex:1', textContent: a.name + (a.is_supervisor ? ' (supervisor)' : '') }), h('small', { textContent: a.push ? '🔔 avisos activos' : '🔕 sin avisos' })),
      h('div', { className: 'chips', style: 'margin:6px 0 0' }, [stat('Activos', a.active), stat('Vencidos', a.overdue, true), stat('Etapa sin actualizar', a.stale, true), stat('Nuevos', a.new_leads), stat('Llamadas', a.calls_waiting)].map((x) => { x.style.fontSize = '13px'; return x; })),
      a.overdue ? h('div', { className: 'hint', textContent: 'El más atrasado: ' + age(a.oldest_overdue_s) + ' · ' + a.overdue_names.join(', ') }) : null);
    frame('Control de agentes', [
      !p ? h('div', { className: 'empty', textContent: 'Cargando…' }) : p.error && !ag.length ? h('div', { className: 'empty', textContent: 'No se pudo cargar el panel.' }) : [
        h('div', { className: 'fubar' + (t.overdue || t.stale ? '' : ' ok'), textContent: t.overdue || t.stale ? '⏰ ' + (t.overdue || 0) + ' seguimientos vencidos · ' + (t.stale || 0) + ' leads con la etapa sin actualizar' : '✅ Todos los seguimientos al día' }),
        h('div', { className: 'hint', textContent: 'Llamadas en cola: ' + (t.calls_waiting || 0) + ' · pospuestas: ' + (t.calls_postponed || 0) + (t.calls_postponed_due ? ' (' + t.calls_postponed_due + ' ya listas)' : '') }),
        ag.map(card)]], () => loadPanel());
  }

  window.MVSUP = {
    renderQueue, renderPanel,
    start() {
      loadQueue(true); loadPanel(true);
      clearInterval(sup.timer);
      sup.timer = setInterval(() => { loadQueue(true); if (tab === 'panel') loadPanel(true); }, 60 * 1000);
    },
    count() { return sup.queue ? sup.queue.calls.filter((c) => c.due_now).length : 0; },
    loadQueue, loadPanel
  };
})();
