// Mudanzas ganadas y confirmación de driver (JOBS-DRIVERS de n8n). Todos los agentes ven la lista; solo el supervisor asigna/confirma.
// También el formulario de fecha y precio que hace falta para marcar un lead como Ganado. Se carga antes de app.js.
(function () {
  const JOBS_URL = API_URL.replace(/agent-api$/, 'jobs-api');
  const st = { jobs: null, drivers: [], can: false, timer: null };
  const STATE = { sin_driver: ['SIN DRIVER', 'var(--err)'], por_reconfirmar: ['Reconfirmar', '#c77700'], ok: ['Driver OK', 'var(--g)'], incompleto: ['Falta fecha/precio', 'var(--err)'] };
  const when = (j) => (j.days_left === null ? 'sin fecha' : j.days_left === 0 ? 'HOY' : j.days_left === 1 ? 'MAÑANA' : 'en ' + j.days_left + ' días') + (j.move_date ? ' · ' + j.move_date : '');

  async function load(silent) {
    try { const r = await api('jobs_list', {}, JOBS_URL); st.jobs = r.jobs || []; st.drivers = r.drivers || []; st.can = !!r.can_assign; }
    catch (e) { if (e.message !== 'auth' && !st.jobs) st.jobs = []; }
    if (typeof tab !== 'undefined' && tab === 'jobs' && !silent) renderList(); else if (data && !document.querySelector('.sheet-bg')) renderList();
  }
  const overlay = (title, kids) => {
    const bg = h('div', { className: 'sheet-bg', style: 'display:block', onclick: (e) => e.target === bg && bg.remove() });
    bg.append(h('div', { className: 'sheet' }, h('h2', { textContent: title }), ...kids(bg))); document.body.append(bg); return bg;
  };

  function assignSheet(j) {
    const f = { name: j.driver_name || '', phone: j.driver_phone || '' };
    overlay((j.driver_name ? 'Cambiar driver · ' : 'Asignar driver · ') + (j.client_name || j.phone), (bg) => {
      const dl = h('datalist', { id: 'drv-list' }, st.drivers.map((d) => h('option', { value: d.name })));
      const name = h('input', { type: 'text', placeholder: 'Nombre del driver', value: f.name }); name.setAttribute('list', 'drv-list');
      const phone = h('input', { type: 'tel', placeholder: 'Teléfono (solo si es un driver nuevo)', value: f.phone });
      const err = h('div', { className: 'hint', style: 'color:var(--err)' });
      const known = () => st.drivers.find((d) => d.name.toLowerCase() === name.value.trim().toLowerCase());
      name.addEventListener('input', () => { const k = known(); if (k) phone.value = k.phone; });
      const go = h('button', { className: 'btn', textContent: 'Guardar driver', onclick: async () => {
        const n = name.value.trim(); if (n.length < 2) { err.textContent = 'Escribe el nombre del driver.'; return; }
        go.disabled = true;
        try { await api('job_assign', { conversation_id: j.conversation_id, driver_name: n, driver_phone: phone.value.trim() }, JOBS_URL); bg.remove(); toast('Driver guardado ✓ (el agente recibió el aviso)'); load(); }
        catch (e) { go.disabled = false; if (e.message !== 'auth') err.textContent = e.message === 'driver_phone_required' ? 'Driver nuevo: añade su teléfono.' : 'No se pudo guardar: ' + e.message; }
      } });
      return [h('div', { className: 'ph', textContent: when(j) + ' · £' + j.price }), dl, h('div', { className: 'lbl', textContent: 'Driver (escribe o elige uno guardado)' }), name, h('div', { className: 'lbl', textContent: 'Teléfono' }), phone, err, go, h('button', { className: 'btn sec', textContent: 'Cerrar', onclick: () => bg.remove() })];
    });
  }
  async function confirmDriver(j) {
    try { await api('job_confirm', { conversation_id: j.conversation_id }, JOBS_URL); toast('Driver reconfirmado ✓'); load(); }
    catch (e) { if (e.message !== 'auth') toast('No se pudo: ' + e.message, true); }
  }

  function renderJobs() {
    const jobs = st.jobs || [];
    const card = (j) => { const s = STATE[j.state] || STATE.ok;
      return h('div', { className: 'card' + (j.state === 'sin_driver' && j.days_left !== null && j.days_left <= 1 ? ' due' : ''), style: 'display:block;cursor:default' },
        h('div', { style: 'display:flex;align-items:center;gap:8px' }, h('b', { style: 'flex:1', textContent: j.client_name || j.phone }), h('span', { className: 'pill', style: 'background:' + s[1], textContent: s[0] })),
        h('small', { textContent: when(j) + ' · £' + j.price }),
        j.driver_name ? h('div', { className: 'hint', textContent: '🚚 ' + j.driver_name + (j.driver_phone ? ' · ' + j.driver_phone : '') }) : h('div', { className: 'hint', style: 'color:var(--err)', textContent: 'Aún sin driver: recuérdaselo al supervisor.' }),
        h('div', { className: 'acts' },
          j.driver_phone ? h('a', { href: 'tel:' + j.driver_phone, textContent: '📞 Driver' }) : null,
          j.phone ? h('a', { href: 'tel:' + j.phone, textContent: '📞 Cliente' }) : null),
        st.can && j.state !== 'incompleto' ? h('div', { className: 'acts' },
          h('button', { className: 'btn', style: 'margin:0', textContent: j.driver_name ? 'Cambiar driver' : 'Asignar driver', onclick: () => assignSheet(j) }),
          j.driver_name && j.state === 'por_reconfirmar' ? h('button', { className: 'btn sec', style: 'margin:0', textContent: 'Reconfirmar', onclick: () => confirmDriver(j) }) : null) : null); };
    $app.replaceChildren(
      h('header', {}, h('h1', { textContent: 'Mudanzas y drivers' }), h('button', { textContent: '⟳', title: 'Actualizar', onclick: () => load() })),
      h('main', {}, h('div', { id: 'banner', className: 'banner' }), tabsBar(),
        !st.jobs ? h('div', { className: 'empty', textContent: 'Cargando…' }) : !jobs.length ? h('div', { className: 'empty', textContent: 'No hay mudanzas ganadas pendientes.' }) : jobs.map(card)));
    renderBanner();
  }

  // Formulario previo a marcar Ganado: fecha de mudanza y precio obligatorios (la hora no hace falta)
  function wonForm(attrs, done) {
    const date = h('input', { type: 'date', value: String(attrs.estimated_moving_date || '').slice(0, 10) });
    const price = h('input', { type: 'number', inputMode: 'decimal', min: '1', step: '1', placeholder: 'Precio en £', value: Number(attrs.pipeline_value_quote_) > 0 ? attrs.pipeline_value_quote_ : '' });
    const err = h('div', { className: 'hint', style: 'color:var(--err)' });
    overlay('Para marcar Ganado', (bg) => [h('div', { className: 'ph', textContent: 'Hace falta la fecha de la mudanza y el precio.' }), h('div', { className: 'lbl', textContent: 'Fecha de mudanza' }), date, h('div', { className: 'lbl', textContent: 'Precio (£)' }), price, err,
      h('button', { className: 'btn', textContent: 'Guardar y marcar Ganado', onclick: () => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date.value)) { err.textContent = 'Elige la fecha de la mudanza.'; return; }
        if (!(Number(price.value) > 0)) { err.textContent = 'Escribe el precio.'; return; }
        bg.remove(); done({ estimated_moving_date: date.value, pipeline_value_quote_: Number(price.value) });
      } }), h('button', { className: 'btn sec', textContent: 'Cancelar', onclick: () => { bg.remove(); done(null); } })]);
  }

  window.MVJOBS = {
    renderJobs, wonForm,
    start() { load(true); clearInterval(st.timer); st.timer = setInterval(() => load(true), 5 * 60 * 1000); },
    count() { return (st.jobs || []).filter((j) => j.state === 'sin_driver' || j.state === 'incompleto' || (st.can && j.state === 'por_reconfirmar')).length; }
  };
})();
