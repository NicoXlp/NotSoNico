// Minimaler iCalendar-Parser/-Generator für Müll-Abholtermine und Ereignisse.

const pad = (n) => String(n).padStart(2, '0');

function unfold(text) {
  return text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
}
const unescape = (s) => s.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim();
const escapeICS = (s) => String(s || '').replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');

/** Liefert [{summary, date:'YYYY-MM-DD'}] */
export function parseICS(text) {
  const out = [];
  let cur = null;
  for (const line of unfold(text)) {
    if (line.startsWith('BEGIN:VEVENT')) cur = {};
    else if (line.startsWith('END:VEVENT')) {
      if (cur?.summary && cur.date) out.push(cur);
      cur = null;
    } else if (cur) {
      const idx = line.indexOf(':');
      if (idx < 0) continue;
      const key = line.slice(0, idx).split(';')[0].toUpperCase();
      const val = line.slice(idx + 1);
      if (key === 'SUMMARY') cur.summary = unescape(val);
      if (key === 'DTSTART') {
        const m = val.match(/(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/);
        if (m) {
          if (m[4] && m[7]) {
            const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
            cur.date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
          } else cur.date = `${m[1]}-${m[2]}-${m[3]}`;
        }
      }
    }
  }
  return out;
}

const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
const dateOnly = (iso) => iso.replace(/-/g, '');
function nextDay(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d + 1);
  return `${dt.getFullYear()}${pad(dt.getMonth() + 1)}${pad(dt.getDate())}`;
}

/** events: [{uid, title, date, time?, endTime?, location?, desc?, alarm?: '-PT6H'}] */
export function buildICS(events, calName = 'Vermietertagebuch') {
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Vermietertagebuch//DE', 'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH', `X-WR-CALNAME:${escapeICS(calName)}`,
  ];
  for (const e of events) {
    lines.push('BEGIN:VEVENT', `UID:${e.uid}@vermietertagebuch`, `DTSTAMP:${stamp()}`);
    if (e.time) {
      const t = e.time.replace(':', '') + '00';
      lines.push(`DTSTART:${dateOnly(e.date)}T${t}`);
      const end = (e.endTime || '').replace(':', '');
      if (end) lines.push(`DTEND:${dateOnly(e.date)}T${end}00`);
      else lines.push('DURATION:PT1H');
    } else {
      lines.push(`DTSTART;VALUE=DATE:${dateOnly(e.date)}`, `DTEND;VALUE=DATE:${nextDay(e.date)}`);
    }
    lines.push(`SUMMARY:${escapeICS(e.title)}`);
    if (e.location) lines.push(`LOCATION:${escapeICS(e.location)}`);
    if (e.desc) lines.push(`DESCRIPTION:${escapeICS(e.desc)}`);
    if (e.alarm) {
      lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escapeICS(e.title)}`, `TRIGGER:${e.alarm}`, 'END:VALARM');
    }
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}
