// Gemeinsame Müll-Logik – wird von der App UND vom Push-Versand (scripts/send-reminders.mjs) genutzt.
// Bitte keine Browser-APIs hier verwenden.

export const pad = (n) => String(n).padStart(2, '0');
export const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseISO = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (s, n) => { const d = parseISO(s); d.setDate(d.getDate() + n); return iso(d); };
export const daysBetween = (a, b) => Math.round((parseISO(b) - parseISO(a)) / 864e5);

/** Abholtermine einer Tonne im Zeitraum [from, to] → [{date, idx}] (idx = laufende Nummer für die Rotation) */
export function binDates(bin, from, to) {
  if (bin.mode === 'dates') {
    const all = [...new Set(bin.dates || [])].sort();
    return all.map((date, idx) => ({ date, idx })).filter((p) => p.date >= from && p.date <= to);
  }
  if (!bin.start) return [];
  const step = Math.max(1, +bin.interval || 1) * 7;
  const out = [];
  let k = Math.max(0, Math.ceil(daysBetween(bin.start, from) / step));
  for (let i = 0; i < 500; i++, k++) {
    const date = addDays(bin.start, k * step);
    if (date > to) break;
    if (date >= from) out.push({ date, idx: k });
  }
  return out;
}

/** Wer ist für diesen Termin dran? memberIds = existierende Mitglieder */
export function binWho(bin, p, memberIds) {
  if (bin.assign?.[p.date]) return bin.assign[p.date];
  // Nur wenn jemand bewusst eine Reihenfolge festgelegt hat – sonst ist die Tonne für alle
  if (!bin.rotationSet) return null;
  const rot = (bin.rotation || []).filter((id) => memberIds.includes(id));
  return rot.length ? rot[p.idx % rot.length] : null;
}

/** Anzeigefarbe: Papier/Pappe/Karton ist immer grün */
export function binColorFor(bin) {
  return /papier|pappe|karton|ppk/i.test(bin?.name || '') ? '#2fa84f' : (bin?.color || '#6b7280');
}

/** Bestätigung „rausgestellt“ → {by, at} oder null (ältere Daten speicherten nur die ID) */
export function doneInfo(bin, date) {
  const d = bin.done?.[date];
  if (!d) return null;
  return typeof d === 'string' ? { by: d, at: null } : d;
}

/** Gilt die Tonne für dieses Mitglied? Leere Liste = ganzes Haus */
export const binAppliesTo = (bin, memberId) => !(bin.members || []).length || bin.members.includes(memberId);

/** Aktuelles Datum/Stunde in einer Zeitzone (für den Server-Versand) */
export function nowIn(timeZone = 'Europe/Berlin', now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: +parts.hour };
}

export const DEFAULT_PREFS = { enabled: true, trash: true, dayBefore: true, hour: 18, mode: 'all', followUp: true, followHour: 21, events: {} };

/** Arten von Neuigkeits-Mitteilungen (einzeln abschaltbar) */
export const EVENT_TYPES = [
  ['task_new', '📝 Neue Aufgaben'],
  ['task_done', '✅ Erledigte Aufgaben'],
  ['post_new', '📌 Neue Beiträge im Social Hub'],
  ['social', '❤️ Likes, Kommentare & Reaktionen auf meine Beiträge'],
  ['bin_done', '🗑️ Tonne wurde rausgestellt'],
  ['mention', '🏷️ Wenn mich jemand markiert'],
];

/** Welche Neuigkeiten gehen an dieses Mitglied? (nicht an die auslösende Person, nur an Empfänger, abgeschaltete Arten weg) */
export function eventsFor(events, memberId, prefs, now = Date.now()) {
  const pr = { ...DEFAULT_PREFS, ...prefs };
  if (!pr.enabled) return [];
  return events.filter((e) => now - (e.at || 0) < 6 * 3600e3
    && e.actor !== memberId
    && (!e.to || e.to.includes(memberId))
    && (pr.events?.[e.pref] !== false));
}

/**
 * Welche Erinnerungen sind JETZT für ein Mitglied fällig?
 * Liefert [{key, bin, date, who, kind:'main'|'follow'}]. „sent“ = bereits verschickte Keys.
 * Ein Zeitfenster von 3 Stunden fängt verspätete Läufe ab; die Keys verhindern Doppelte.
 */
export function dueReminders({ bins, memberId, memberIds, prefs, date, hour, sent = [] }) {
  const pr = { ...DEFAULT_PREFS, ...prefs };
  if (!pr.enabled || pr.trash === false) return [];
  const out = [];
  const target = pr.dayBefore ? addDays(date, 1) : date;
  const slots = [['main', pr.hour]];
  if (pr.followUp && pr.followHour > pr.hour) slots.push(['follow', pr.followHour]);
  for (const [kind, h] of slots) {
    if (hour < h || hour >= h + 3) continue;
    for (const bin of bins) {
      if (!binAppliesTo(bin, memberId)) continue;
      for (const p of binDates(bin, target, target)) {
        if (doneInfo(bin, p.date)) continue;
        const who = binWho(bin, p, memberIds);
        if (pr.mode === 'mine' && who && who !== memberId) continue;
        if (kind === 'follow' && who && who !== memberId) continue;
        const key = `${bin.id}:${p.date}:${kind}`;
        if (sent.includes(key)) continue;
        out.push({ key, bin, date: p.date, who, kind });
      }
    }
  }
  return out;
}

/** Text für eine Benachrichtigung */
export function reminderText(r, { memberId, nameOf, today }) {
  const when = r.date === today ? 'Heute' : r.date === addDays(today, 1) ? 'Morgen' : r.date;
  const whoTxt = !r.who ? 'Wer kann sie rausstellen?' : r.who === memberId ? 'Du bist dran! 💪' : `${nameOf(r.who)} ist dran.`;
  if (r.kind === 'follow') {
    return { title: `⏰ ${r.bin.name} ist noch nicht draußen`, body: `${when} ist Abholung. Bitte kurz bestätigen, wenn sie draußen ist.` };
  }
  return { title: `🗑️ ${r.bin.name} rausstellen`, body: `${when} ist Abholung. ${whoTxt}` };
}
