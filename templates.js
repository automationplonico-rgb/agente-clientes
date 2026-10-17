// Plantillas de mensajes de los agentes (traídas del script AutoHotkey numericos.ahk): variables, calculadora de precio y etiqueta de trabajo.
// Lógica pura (sin DOM ni chrome.*): la usan el panel de la extensión, la PWA, las pruebas y el script que sincroniza Chatwoot.
// Los textos fijos usan las variables de Chatwoot ({{contact.first_name}}, {{agent.first_name}}…) y unas pocas propias ({{platform}}, {{address}}, {{phone}})
// que la extensión y la app piden antes de copiar; en el propio Chatwoot quedan visibles para que el agente las escriba.
(function (root) {
  const TZ = "Europe/London";

  // Variables propias: etiqueta del campo, valor por defecto y, si procede, lista de opciones que viene de la configuración (cfg.phones).
  const VARS = {
    platform: { label: "Plataforma", default: "Bark" },
    address: { label: "Dirección / zona" },
    phone: { label: "Teléfono de contacto", options: "phones" }
  };
  const NATIVE = ["contact.name", "contact.first_name", "contact.last_name", "contact.phone", "contact.email", "agent.name", "agent.first_name", "agent.last_name", "agent.email", "conversation.id"];

  // Títulos y orden de las plantillas de Chatwoot (códigos mv-…). Los textos NO están aquí: llegan de AGENT-API (acción canned) y exigen clave de agente.
  const TITLES = {
    "mv-intro": "Contacto inicial",
    "mv-web-reviews": "Web y reseñas",
    "mv-quote": "Cotización estándar",
    "mv-more-info": "Pedir detalles de la mudanza",
    "mv-post": "Saludo para posts (Nextdoor)",
    "mv-ask-phone": "Pedir teléfono",
    "mv-booking": "Requisitos de reserva",
    "mv-insured": "Seguro y VAT",
    "mv-review-bark": "Pedir reseña (Bark)",
    "mv-fu-1": "Seguimiento 1 · tras el primer contacto",
    "mv-fu-2": "Seguimiento 2 · planificación",
    "mv-fu-3": "Seguimiento 3 · retomar tras silencio",
    "mv-fu-close": "Seguimiento 4 · cierre tras cotizar",
    "mv-counter": "Contraoferta (se va con otro precio)",
    "mv-van-size": "Medidas de la van",
    "mv-review-google": "Pedir reseña (Google)",
    "mv-email-subject": "Email · asunto",
    "mv-email": "Email · saludo inicial"
  };

  // Variables {{...}} del texto que ni Chatwoot ni la extensión rellenan solas (hay que pedirlas al agente), sin repetir y en orden de aparición.
  function customVars(text) {
    const out = [];
    String(text || "").replace(/\{\{\s*([a-z_.]+)\s*\}\}/gi, (m, k) => { k = k.toLowerCase(); if (!NATIVE.includes(k) && VARS[k] && !out.includes(k)) out.push(k); return m; });
    return out;
  }
  function fill(text, values) {
    return String(text || "").replace(/\{\{\s*([a-z_.]+)\s*\}\}/gi, (m, k) => (k.toLowerCase() in values ? String(values[k.toLowerCase()]) : m));
  }

  // ---------- formularios de las plantillas con cálculo ----------
  const SERVICES = [
    { value: "2", label: "2 Loaders + Van", short: "2 loaders + van" },
    { value: "1", label: "1 Loader + Van", short: "1 loader + van" },
    { value: "0", label: "Solo conductor + Van", short: "Only driver + van" }
  ];
  const serviceOf = (v) => SERVICES.find((s) => s.value === String(v)) || SERVICES[0];

  const FORMS = {
    calc: { title: "Calculadora de precio", fields: [
      { key: "hourly", label: "Precio por hora (£)", type: "number" },
      { key: "service", label: "Servicio", type: "select", options: SERVICES.map((s) => ({ value: s.value, label: s.label })), default: "2" },
      { key: "hours", label: "Horas mínimas", type: "number", default: "2" },
      { key: "stairs", label: "Tramos de escaleras (0 = ninguno)", type: "number", default: "0", optional: true }
    ] },
    job: { title: "Etiqueta de trabajo (Job summary)", fields: [
      { key: "type", label: "Tipo", type: "text", default: "MAN&VAN" },
      { key: "driver", label: "Conductor", type: "text" },
      { key: "name", label: "Nombre del cliente", type: "text", from: "contact" },
      { key: "phone", label: "Teléfono del cliente", type: "text", from: "phone" },
      { key: "day", label: "Día (DD/MM/YYYY)", type: "text" },
      { key: "arrival", label: "Hora de llegada", type: "text" },
      { key: "pickAddr", label: "Dirección de recogida", type: "text" },
      { key: "pickMap", label: "Enlace de mapa (recogida)", type: "text", optional: true },
      { key: "dropAddr", label: "Dirección de entrega", type: "text" },
      { key: "dropMap", label: "Enlace de mapa (entrega)", type: "text", optional: true },
      { key: "hourly", label: "Precio por hora (£)", type: "number" },
      { key: "service", label: "Servicio", type: "select", options: SERVICES.map((s) => ({ value: s.value, label: s.label })), default: "2" },
      { key: "hours", label: "Horas mínimas", type: "number", default: "2" }
    ] }
  };

  const num = (v) => { const n = Number(String(v == null ? "" : v).replace(",", ".")); return Number.isFinite(n) ? n : NaN; };
  const money = (n) => String(Math.round(n * 100) / 100);   // 160 → "160", 82.5 → "82.5"; sin decimales de coma flotante
  const plural = (n, one, many) => (n === 1 ? one : many);
  const missing = (form, v) => FORMS[form].fields.filter((f) => !f.optional && !String(v[f.key] == null ? "" : v[f.key]).trim()).map((f) => f.label);

  function calcMessage(v) {
    const hourly = num(v.hourly), hours = num(v.hours), stairs = num(v.stairs || 0) || 0, svc = serviceOf(v.service);
    if (!(hourly > 0) || !(hours > 0)) return "";
    const base = hourly * hours, extra15 = Math.round((hourly / 2) * 100) / 100;
    let stairsText = "", total = "The total would be £" + money(hourly) + " x " + money(hours) + " = £" + money(base);
    if (stairs > 0) {
      const fee = stairs * 10;
      stairsText = "A £10 fee would apply for each flight of stairs, in this case, " + money(stairs) + ".\n";
      total += " + £" + money(fee) + " (" + money(stairs) + " " + plural(stairs, "flight", "flights") + " of stairs) = £" + money(base + fee);
    }
    return "In this case, we can offer you the following option:\n\n" +
      "£" + money(hourly) + " per hour (" + svc.short + ", " + money(hours) + "-hour minimum) = £" + money(base) + ".\n" + stairsText + "\n" + total + "\n\n" +
      "If more time is needed, we simply continue at £" + money(extra15) + " per additional 30 minutes, so you stay in control of the cost.\n\n" +
      "We are fully insured for your peace of mind. Our service includes all necessary protective equipment (blankets, straps).\n" +
      "For your convenience, VAT is already included in our pricing.";
  }

  // Fecha dd/mm/aa en hora de Londres para la referencia (SALES005151026). `ts` en milisegundos.
  function refDate(ts) {
    const p = {};
    for (const x of new Intl.DateTimeFormat("en-GB", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(ts))) p[x.type] = x.value;
    return p.day + p.month + p.year.slice(2);
  }
  const refCode = (ref) => String(ref == null ? "" : ref).replace(/\D/g, "").padStart(3, "0");

  // `ref` es el número del agente (columna ref_code); sin él la referencia no se puede formar y devolvemos "".
  function jobMessage(v, ref, ts) {
    const hourly = num(v.hourly), hours = num(v.hours), svc = serviceOf(v.service);
    if (!(hourly > 0) || !(hours > 0) || !refCode(ref).replace(/0/g, "")) return "";
    const total = hourly * hours, extra15 = Math.round((hourly / 2) * 100) / 100;
    const line = (s) => String(s || "").trim();
    return "(JOB) " + line(v.type) + "\n\n" +
      "DRIVER: " + line(v.driver) + "\n\n" +
      "NAME: " + line(v.name) + "\n\n" +
      "CONTACT NUMBER: " + line(v.phone) + "\n\n" +
      "DAY : " + line(v.day) + "\n\n" +
      "ARRIVAL TIME: " + line(v.arrival) + "\n\n" +
      "Pick-Up Address: " + line(v.pickAddr) + "\n" + line(v.pickMap) + "\n\n" +
      "Drop-off Address: " + line(v.dropAddr) + "\n" + line(v.dropMap) + "\n\n" +
      "💰 QUOTE & BILLING STRUCTURE\n\n" +
      "* Hourly Rate: £" + money(hourly) + " per hour " + svc.label + "\n\n" +
      "* Minimum Booking: £" + money(total) + " (Includes first " + money(hours) + " hours)\n\n" +
      "Estimated total = £" + money(total) + "\n\n" +
      "⏱️ EXTRA TIME POLICY (After " + money(hours) + " hours)\n\n" +
      "* If the job exceeds the initial " + money(hours) + " hours, we bill in 30 minute increments so you only pay for the time you actually need.\n\n" +
      "* Hourly Rate: £" + money(hourly) + " - Charge per 30 mins: £" + money(extra15) + "\n\n" +
      "📋 Additional Charges (if applicable)\n* £10 per flight of stairs (if it's a full flight)\n* £18 Congestion Charge (if your area falls within the congestion zone)\n\n" +
      "Notes:\n\n" +
      "REF: SALES" + refCode(ref) + refDate(ts == null ? Date.now() : ts);
  }

  const api = { TITLES, VARS, NATIVE, FORMS, SERVICES, customVars, fill, calcMessage, jobMessage, missing, refCode, refDate, money };
  if (typeof module !== "undefined") module.exports = api; else root.MVTemplates = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
