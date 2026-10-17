// Plantillas de mensajes de los agentes (traídas del script AutoHotkey numericos.ahk): textos fijos, calculadora de precio y etiqueta de trabajo.
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

  const REVIEWS_MAPS = "https://maps.app.goo.gl/kSs3qdvSy516PFCY7";
  const REVIEWS_GOOGLE = "https://maps.app.goo.gl/wkczf8LPttKAFRig7";
  const REVIEWS_BARK = "https://www.bark.com/en/gb/company/mooveto/g7X1Q/?show_reviews=true";

  const STATIC = [
    { code: "mv-intro", key: "1", title: "Contacto inicial", text: "Hi {{contact.first_name}}! I’m {{agent.first_name}} from Mooveto. I've just received your request on {{platform}} regarding your move in {{address}}." },
    { code: "mv-web-reviews", key: "2", title: "Web y reseñas", text: "You can visit our website here :\nhttps://mooveto.co.uk/\n\nAlso you can see our reviews on here:\n" + REVIEWS_MAPS },
    { code: "mv-quote", key: "3", title: "Cotización estándar", text:
      "*Your Moving Quote* 🚛\nWe offer flexible options depending on your needs:\n\n*Option A*\n2 Loaders + Van - Up to 2 hours - £160\n*Option B*\n1 Loader + Van - Up to 2 hours - £140\n*Option C*\nOnly driver + van - Up to 2 hours - £120\n\n" +
      "*Options A / B Always Include:*\nProfessional, trained movers and an extra-large Luton van.\n\n" +
      "⏱ *Fair Timing Policy*\nWe believe in fair pricing. Unlike many companies that charge for a full hour if you go over, *we only charge in 30-minute increments*. You only pay for the time we are actually working!\n\n" +
      "📋 *Additional Charges (if applicable)*\nTo keep things transparent, the following may apply depending on location and access:\n* £10 per flight of stairs (if it's a full flight)\n* £18 Congestion Charge (if your area falls within the congestion zone)\n\n" +
      "🛡 *What’s Included*\n* Protective equipment: blankets, straps\n* All loading and unloading\n* *Fully insured transport* for complete peace of mind\n* A friendly, punctual team that treats your belongings with care\n\n" +
      "🧰 *Optional Extras* (included in the hourly rate if required):\n* Packing and unpacking\n* Light handyman assistance" },
    { code: "mv-more-info", key: "4", title: "Pedir detalles de la mudanza", text: "Could you tell me more about your move?" },
    { code: "mv-post", key: "5", title: "Saludo para posts (Nextdoor)", text: "Hi {{contact.first_name}}, i’m contacting you for the following post:" },
    { code: "mv-ask-phone", key: "6", title: "Pedir teléfono", text: "Could you share your phone number with me so we can communicate better?" },
    { code: "mv-booking", key: "7", title: "Requisitos de reserva", text:
      "Perfect! In order to secure your booking and lock the van in our system, we just require a deposit equivalent to 1 hour of your selected service.\n\nHere is a quick overview of our flexible booking policy:\n" +
      "* Rescheduling: Totally flexible! You can change your date or time at no extra cost, and the deposit will be transferred to your new date.\n" +
      "* Cancellations (5+ days in advance): 80% of your deposit will be refunded (we only retain 20% for admin fees).\n" +
      "* Cancellations (1 to 4 days in advance): 50% of your deposit will be refunded.\n\n" +
      "Please let me know if you are happy to proceed, and I will send over the payment details to secure your slot!" },
    { code: "mv-insured", key: "8", title: "Seguro y VAT", text: "We are fully insured for your peace of mind. Our service includes all necessary protective equipment (blankets, straps).\n\nFor your convenience, VAT is already included in our pricing." },
    { code: "mv-review-bark", key: "9", title: "Pedir reseña (Bark)", text: "Would you mind sharing your experience by leaving us a review? Your feedback means a lot to us. You can do so here: " + REVIEWS_BARK + "\n\nWe’re delighted to have been of service and hope to assist you again in the future.\n\nCheers,\nThe Mooveto team" },
    { code: "mv-fu-1", key: "q", title: "Seguimiento 1 · tras el primer contacto", text: "Hi {{contact.first_name}}, just following up on my previous message regarding your move. We are currently organising our bookings for the next few weeks and I want to ensure we can book you in for your preferred date. Did you get a chance to see my last message?" },
    { code: "mv-fu-2", key: "w", title: "Seguimiento 2 · planificación", text: "Hi {{contact.first_name}}, just a quick check-in as I’d like to get an accurate quote over to you to help with your planning. If you have a moment, please let me know if it is a full house move or just a few items whenever you have a second." },
    { code: "mv-fu-3", key: "e", title: "Seguimiento 3 · retomar tras silencio", text: "Hi {{contact.first_name}}, I noticed we haven't touched base in a few days. I wanted to check if there was anything else you needed to clarify or if you would like to adjust any details. I’m here to ensure the process is as straightforward as possible for you." },
    { code: "mv-fu-close", key: "r", title: "Seguimiento 4 · cierre tras cotizar", text: "Hi {{contact.first_name}}, just checking if you had any questions regarding the quote I sent. As mentioned, our service is fully insured and the team is ready to handle everything for you. Would you like to go ahead and secure your date today?" },
    { code: "mv-counter", key: "c", title: "Contraoferta (se va con otro precio)", text: "Hi {{contact.first_name}}, thanks for letting me know. I completely understand.\n\nWe always aim to be as competitive as possible, so if your decision is based on price, I would be happy to review the quote you’ve received to see if we can improve it while maintaining our high standard of service.\n\nIf you’re open to it, feel free to share the details and I’ll see what I can do." },
    { code: "mv-van-size", key: "m", title: "Medidas de la van", text: "Dimensions:\n\nLength: 4.0 m / 13.1 ft\n\nWidth: 2.0 m / 6.5 ft\n\nHeight: 2.2 m / 7.2 ft\n\nPayload: 1200-1600 kg" },
    { code: "mv-review-google", key: "v", title: "Pedir reseña (Google)", text: "Hi {{contact.first_name}}. Thank you for using Mooveto!\n\nWe hope you are satisfied with your recent service. We are always looking to improve and would love to hear your thoughts. Please consider leaving us a review here: " + REVIEWS_GOOGLE + "\n\nThank you for your time and for choosing us.\n\nBest,\nThe Mooveto & Keen Resources Team" },
    { code: "mv-email-subject", key: "x", title: "Email · asunto", text: "Your Upcoming Move with Mooveto - Insured & Reliable Service" },
    { code: "mv-email", key: "z", title: "Email · saludo inicial", text:
      "Hi {{contact.first_name}}.\n\nI hope you’re having a great week.\n\nThis is {{agent.first_name}} from Mooveto. I’ve carefully reviewed your request on {{platform}} for your move in {{address}}. We have full availability and we want to make sure your move goes as smoothly and stress-free as possible.\n\n" +
      "Our team is fully prepared to handle everything with the utmost care, ensuring a professional and efficient service from start to finish.\n\n" +
      "🛡️ What’s Included in Our Service: To give you complete peace of mind, my team will arrive fully equipped with:\n\n" +
      "Protective Equipment: Use of professional moving blankets and heavy-duty straps to ensure all your belongings are secured and scratch-free.\n\n" +
      "Full Loading & Unloading: We take care of the heavy lifting so you don't have to worry about a thing.\n\n" +
      "Fully Insured Transport: Your move is covered for your total peace of mind.\n\n" +
      "Assembly & Dismantling: We can assist with light handyman service, dismantling or assembly of furniture during the move if needed too.\n\n" +
      "Professional & Punctual Team: A reliable team that treats your belongings with the care they deserve.\n\n" +
      "Would you be available for a brief chat today? I have also sent you a message on WhatsApp so we can coordinate the details. If you prefer, you can contact me directly by calling or messaging me at {{phone}} so I can provide an exact quote and secure your slot on our calendar.\n\n" +
      "I look forward to hearing from you.\n\nWarm regards,\n\n{{agent.first_name}}\nMooveto\nOur Reviews: " + REVIEWS_GOOGLE }
  ];

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

  const api = { STATIC, VARS, NATIVE, FORMS, SERVICES, customVars, fill, calcMessage, jobMessage, missing, refCode, refDate, money };
  if (typeof module !== "undefined") module.exports = api; else root.MVTemplates = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
