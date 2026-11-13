// Vermietertagebuch – Sofort-Push (Cloudflare Worker)
//
// POST /notify  { hid, event: { pref, actor, to, title, body, tab, tag, at } }
//   Authorization: Bearer <Firebase-ID-Token des Absenders>
//
// Der Worker liest mit dem Token des Absenders die Push-Abos des Hauses aus Firestore
// (die Firestore-Regeln prüfen die Berechtigung), filtert nach Empfängern und Einstellungen
// und verschickt die Mitteilungen sofort. Abgelaufene Abos werden entfernt.

import { eventsFor } from '../../js/trash-logic.js';
import { sendPush } from './webpush.js';

const json = (data, status, cors) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...cors } });

function corsFor(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const ok = allowed.includes(origin) || /^http:\/\/localhost(:\d+)?$/.test(origin);
  return ok ? {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  } : {};
}

// Firestore-REST-Werte → normale Objekte
function fromValue(v) {
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return v.timestampValue;
  if ('mapValue' in v) return fromFields(v.mapValue.fields || {});
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromValue);
  return null;
}
const fromFields = (f) => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, fromValue(v)]));

export default {
  async fetch(request, env, ctx, { fetchImpl = fetch } = {}) {
    const cors = corsFor(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/') return json({ ok: true, service: 'vermietertagebuch-push' }, 200, cors);
    if (request.method !== 'POST' || url.pathname !== '/notify') return json({ error: 'not found' }, 404, cors);

    const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    let input;
    try { input = await request.json(); } catch { return json({ error: 'bad json' }, 400, cors); }
    const { hid, event } = input || {};
    if (!token || typeof hid !== 'string' || !/^[A-Z0-9-]{3,40}$/.test(hid) || !event?.title || !event?.actor) {
      return json({ error: 'bad request' }, 400, cors);
    }
    const ev = {
      pref: String(event.pref || ''), actor: String(event.actor), to: Array.isArray(event.to) ? event.to.map(String) : null,
      title: String(event.title).slice(0, 120), body: String(event.body || '').slice(0, 240),
      tab: String(event.tab || 'home'), tag: String(event.tag || ''), at: Date.now(),
    };

    // Abos des Hauses lesen – mit dem Token des Absenders (Firestore-Regeln greifen)
    const base = `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/households/${hid}`;
    const auth = { Authorization: `Bearer ${token}` };
    const r = await fetchImpl(`${base}/subs?pageSize=300`, { headers: auth });
    if (r.status === 401 || r.status === 403) return json({ error: 'unauthorized' }, 401, cors);
    if (!r.ok) return json({ error: 'firestore', status: r.status }, 502, cors);
    const docs = (await r.json()).documents || [];
    const subs = docs.map((d) => ({ ...fromFields(d.fields || {}), id: d.name.split('/').pop() }));

    const vapid = { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT || 'https://nicoxlp.github.io/Vermietertagebuch-App/' };
    let sent = 0, failed = 0, removed = 0;
    await Promise.all(subs.map(async (sub) => {
      if (!sub.subscription?.endpoint || !sub.subscription?.keys) return;
      if (!eventsFor([ev], sub.memberId, sub.prefs).length) return;
      try {
        const res = await sendPush(sub.subscription, { title: ev.title, body: ev.body, tag: ev.tag, tab: ev.tab }, vapid, { fetchImpl });
        if (res.ok) { sent++; return; }
        if (res.status === 404 || res.status === 410) {
          removed++;
          await fetchImpl(`${base}/subs/${sub.id}`, { method: 'DELETE', headers: auth }).catch(() => {});
          return;
        }
        failed++;
        console.log('Push fehlgeschlagen', res.status, res.text);
      } catch (e) {
        failed++;
        console.log('Push-Fehler', e?.message);
      }
    }));
    return json({ ok: true, sent, failed, removed }, 200, cors);
  },
};
