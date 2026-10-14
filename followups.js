// Lógica pura de los recordatorios de seguimiento (sin DOM ni chrome.*): la usan el service worker, el panel, el popup, la PWA y las pruebas.
// Los tiempos son segundos Unix (como los devuelve AGENT-FOLLOWUPS); las reglas (`rules`) vienen del servidor.
(function (root) {
  const DEFAULT_RULES = { working_hours: [9, 18], nag_seconds: 3600, stale_stage_seconds: 3 * 86400,
    digests: { morning: "09:00", evening: "17:30", weekly_day: 1, weekly_time: "09:15", friday_cleanup: "16:00" } };
  const TZ = "Europe/London";
  const WEEKDAYS = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

  const rulesOf = (r) => ({ ...DEFAULT_RULES, ...(r || {}), digests: { ...DEFAULT_RULES.digests, ...((r && r.digests) || {}) } });

  // Fecha y hora "de pared" en Londres: { date:'2026-10-14', minutes:570, weekday:3 }
  function londonParts(ts) {
    const parts = {};
    for (const p of new Intl.DateTimeFormat("en-GB", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23" }).formatToParts(new Date(ts * 1000))) parts[p.type] = p.value;
    return { date: parts.year + "-" + parts.month + "-" + parts.day, minutes: Number(parts.hour) * 60 + Number(parts.minute), weekday: WEEKDAYS[parts.weekday] };
  }
  const hhmm = (s) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || "")); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };

  function inWorkingHours(ts, rules) {
    const r = rulesOf(rules), h = londonParts(ts).minutes / 60;
    return h >= r.working_hours[0] && h < r.working_hours[1];
  }

  const isDue = (it, now) => !!it && Number(it.due_at) > 0 && Number(it.due_at) <= now;
  function dueItems(items, now) { return (items || []).filter((i) => isDue(i, now)).sort((a, b) => a.due_at - b.due_at); }
  function todayItems(items, now) {
    const today = londonParts(now).date;
    return (items || []).filter((i) => Number(i.due_at) > 0 && londonParts(i.due_at).date === today).sort((a, b) => a.due_at - b.due_at);
  }
  function staleItems(items, now, rules) {
    const r = rulesOf(rules);
    return (items || []).filter((i) => i.stage_since && now - i.stage_since > r.stale_stage_seconds).sort((a, b) => a.stage_since - b.stage_since);
  }

  // ¿Suena este aviso ahora? lastRang = { [conversation_id]: segundos del último sonido }.
  // Primer sonido tras vencer: siempre. Insistencia: cada nag_seconds y solo en horario laboral.
  function shouldRing(item, now, lastRang, rules) {
    if (!isDue(item, now)) return false;
    const r = rulesOf(rules), last = Number((lastRang || {})[item.conversation_id]) || 0;
    if (last < item.due_at) return true;
    return inWorkingHours(now, r) && now - last >= r.nag_seconds;
  }

  // Resúmenes pendientes de mostrar. shown = { morning:'2026-10-14', evening:'…', weekly:'2026-10-12', friday:'…' } (claves de "ya mostrado").
  function digestsToShow(now, rules, shown) {
    const r = rulesOf(rules), p = londonParts(now), s = shown || {}, out = [];
    const at = (key, hm, dayOk) => { const t = hhmm(hm); return t !== null && p.minutes >= t && dayOk && s[key] !== (key === "weekly" ? mondayOf(p) : p.date); };
    if (p.weekday <= 6 && at("morning", r.digests.morning, true)) out.push("morning");
    if (at("weekly", r.digests.weekly_time, p.weekday === Number(r.digests.weekly_day))) out.push("weekly");
    if (at("friday", r.digests.friday_cleanup, p.weekday === 5)) out.push("friday");
    if (p.weekday <= 6 && at("evening", r.digests.evening, true)) out.push("evening");
    return out;
  }
  function mondayOf(p) { const d = new Date(p.date + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - (p.weekday - 1)); return d.toISOString().slice(0, 10); }
  const shownKey = (kind, now) => { const p = londonParts(now); return kind === "weekly" ? mondayOf(p) : p.date; };

  const plural = (n, one, many) => n + " " + (n === 1 ? one : many);
  function digestSummary(kind, items, now, rules) {
    const due = dueItems(items, now), today = todayItems(items, now).filter((i) => !isDue(i, now)), stale = staleItems(items, now, rules);
    const names = (list) => list.slice(0, 4).map((i) => i.name || i.phone).join(", ") + (list.length > 4 ? " y " + (list.length - 4) + " más" : "");
    switch (kind) {
      case "morning": return { title: "Buenos días: seguimientos de hoy", lines: due.length + today.length ? [plural(due.length, "vencido", "vencidos") + " · " + plural(today.length, "para hoy", "para hoy"), names(due.concat(today))] : ["No tienes seguimientos pendientes hoy."], count: due.length + today.length };
      case "evening": return { title: "Antes de cerrar el día: actualiza las etapas", lines: stale.length || due.length ? [plural(due.length, "seguimiento sin hacer", "seguimientos sin hacer"), plural(stale.length, "lead sin cambiar de etapa", "leads sin cambiar de etapa") + (stale.length ? ": " + names(stale) : "")] : ["Todo al día. Buen trabajo."], count: due.length + stale.length };
      case "weekly": return { title: "Resumen semanal de seguimiento", lines: [plural(items.length, "lead activo", "leads activos"), plural(due.length, "seguimiento vencido", "seguimientos vencidos"), plural(stale.length, "lead sin movimiento de etapa", "leads sin movimiento de etapa")], count: items.length };
      case "friday": { const old = (items || []).filter((i) => i.stage_since && now - i.stage_since > 7 * 86400); return { title: "Viernes de limpieza: cierra lo que no avanza", lines: old.length ? [plural(old.length, "lead lleva", "leads llevan") + " 7+ días sin movimiento: ciérralos como ganado, perdido o ponles fecha.", names(old)] : ["Ningún lead lleva más de 7 días parado."], count: old.length }; }
      default: return { title: "Seguimiento", lines: [], count: 0 };
    }
  }

  const KIND_TEXT = { stage: "Actualiza la etapa", followup: "Toca hacer seguimiento", close_out: "Sin respuesta: ciérralo (ganado, perdido o amplía el plazo)" };
  const kindText = (k) => KIND_TEXT[k] || KIND_TEXT.followup;
  const waLink = (phone) => "https://web.whatsapp.com/send?phone=" + String(phone || "").replace(/\D/g, "");
  function dueLabel(ts, now) {
    const d = ts - now;
    if (d <= 0) { const m = Math.floor(-d / 60); return m < 1 ? "ahora" : m < 60 ? "hace " + m + " min" : m < 2880 ? "hace " + Math.floor(m / 60) + " h" : "hace " + Math.floor(m / 1440) + " días"; }
    const m = Math.floor(d / 60); return m < 60 ? "en " + m + " min" : m < 2880 ? "en " + Math.floor(m / 60) + " h" : "en " + Math.floor(m / 1440) + " días";
  }

  // Texto de la nota + etapa que se guardan en Chatwoot al cerrar un seguimiento (acción `update` de AGENT-API)
  function outcomePlan(outcome, form, rules, outcomes) {
    const f = form || {};
    const titleOf = ((outcomes || []).find((o) => o.code === outcome) || {}).title || outcome;
    const text = String(f.text || "").trim().slice(0, 500);
    const stage = outcome === "lost" ? "lead_lost" : outcome === "won" ? "lead_won" : outcome === "responded" ? f.stage || "" : "";
    const note = "Seguimiento: " + titleOf + (text ? " — " + text : "");
    const body = { outcome };
    if (outcome === "responded" && stage) body.stage = stage;
    if (outcome === "later" && f.due_at) body.due_at = Math.floor(Number(f.due_at));
    if (outcome === "snooze") body.snooze_minutes = Number(f.snooze_minutes) || 15;
    const err = outcome === "lost" && !text ? "Escribe el motivo (por qué no)." : outcome === "responded" && !stage ? "Elige la nueva etapa." : outcome === "later" && !(Number(f.due_at) > 0) ? "Elige cuándo volver a escribirle." : "";
    return { err, update: outcome === "snooze" ? null : { ...(stage ? { stage } : {}), note }, done: body };
  }

  const api = { DEFAULT_RULES, rulesOf, londonParts, inWorkingHours, isDue, dueItems, todayItems, staleItems, shouldRing, digestsToShow, shownKey, digestSummary, kindText, waLink, dueLabel, outcomePlan };
  if (typeof module !== "undefined") module.exports = api; else root.MVFU = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
