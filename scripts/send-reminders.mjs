// Verschickt die Müll-Erinnerungen als Web-Push.
// Läuft stündlich per GitHub Action (.github/workflows/reminders.yml).
//
// Benötigte Umgebungsvariablen (als GitHub-Secrets hinterlegen):
//   FIREBASE_SERVICE_ACCOUNT  – JSON des Firebase-Dienstkontos
//   VAPID_PUBLIC_KEY          – öffentlicher VAPID-Schlüssel (derselbe wie in js/config.js)
//   VAPID_PRIVATE_KEY         – privater VAPID-Schlüssel
//   VAPID_SUBJECT (optional)  – z. B. mailto:du@example.com

import admin from 'firebase-admin';
import webpush from 'web-push';
import { dueReminders, reminderText, nowIn } from '../js/trash-logic.js';

const { FIREBASE_SERVICE_ACCOUNT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY } = process.env;
const DRY = process.argv.includes('--dry-run');
// Test-Modus: an jedes Gerät mit eingeschalteten Erinnerungen eine Test-Mitteilung schicken
const TEST = process.env.PUSH_TEST === '1' || process.argv.includes('--test');
if (!FIREBASE_SERVICE_ACCOUNT || !VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
  console.log('Push ist nicht eingerichtet (Secrets fehlen) – nichts zu tun.');
  process.exit(0);
}

admin.initializeApp({ credential: admin.credential.cert(JSON.parse(FIREBASE_SERVICE_ACCOUNT)) });
const db = admin.firestore();
webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'https://nicoxlp.github.io/Vermietertagebuch-App/', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const load = (ref, col) => ref.collection(col).get().then((s) => s.docs.map((d) => ({ ...d.data(), id: d.id })));
let sentTotal = 0;
let subsTotal = 0;

for (const house of await db.collection('households').listDocuments()) {
  const subs = await load(house, 'subs');
  if (!subs.length) continue;
  const [members, bins] = await Promise.all([load(house, 'members'), load(house, 'trash')]);
  const memberIds = members.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)).map((m) => m.id);
  const nameOf = (id) => members.find((m) => m.id === id)?.name || 'Jemand';

  for (const sub of subs) {
    if (!sub.subscription || !memberIds.includes(sub.memberId)) continue;
    subsTotal++;
    if (TEST) {
      try {
        await webpush.sendNotification(sub.subscription, JSON.stringify({
          title: '🔔 Test: Push funktioniert!',
          body: `Hallo ${nameOf(sub.memberId)}, ab jetzt erinnert dich das Vermietertagebuch an die Müllabfuhr.`,
          tag: 'push-test', url: './?tab=trash',
        }), { TTL: 3600 });
        sentTotal++;
        console.log('Test gesendet an', nameOf(sub.memberId), '·', (sub.device || '').slice(0, 60));
      } catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410) { await house.collection('subs').doc(sub.id).delete(); console.log('Abgelaufenes Abo entfernt'); }
        else console.error('Test fehlgeschlagen', e.statusCode, e.body);
      }
      continue;
    }
    const { date, hour } = nowIn(sub.tz || 'Europe/Berlin');
    const due = dueReminders({ bins, memberId: sub.memberId, memberIds, prefs: sub.prefs, date, hour, sent: sub.sent || [] });
    if (!due.length) continue;

    const sentKeys = [];
    let gone = false;
    for (const r of due) {
      const t = reminderText(r, { memberId: sub.memberId, nameOf, today: date });
      const payload = JSON.stringify({ ...t, tag: `${r.bin.id}:${r.date}`, bin: r.bin.id, date: r.date, url: './?tab=trash' });
      if (DRY) { console.log('[dry-run]', house.id, sub.memberId, t.title); sentKeys.push(r.key); continue; }
      try {
        await webpush.sendNotification(sub.subscription, payload, { TTL: 6 * 3600, urgency: 'high' });
        sentKeys.push(r.key);
        sentTotal++;
      } catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410) { gone = true; break; } // Abo abgelaufen
        console.error('Push fehlgeschlagen', house.id, sub.id, e.statusCode, e.body);
      }
    }
    const ref = house.collection('subs').doc(sub.id);
    if (gone) { await ref.delete(); console.log('Abgelaufenes Abo entfernt', sub.id); continue; }
    if (sentKeys.length && !DRY) await ref.update({ sent: [...sentKeys, ...(sub.sent || [])].slice(0, 60), lastPushAt: Date.now() });
  }
}
console.log(`Fertig – ${subsTotal} Gerät(e) mit Erinnerungen, ${sentTotal} ${TEST ? 'Test-Mitteilung(en)' : 'Erinnerung(en)'} verschickt.`);
