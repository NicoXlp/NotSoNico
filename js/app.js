import './compat.js';
import { createStore, newId, COLLECTIONS, readLocal } from './store.js';
import { parseICS, buildICS } from './ics.js';
import * as CONFIG from './config.js';
// Als Namensraum importiert: fehlt ein Eintrag (z. B. ältere config.js im Zwischenspeicher), gilt er als „nicht gesetzt“
const FIREBASE_CONFIG = CONFIG.FIREBASE_CONFIG ?? null;
const VAPID_PUBLIC_KEY = CONFIG.VAPID_PUBLIC_KEY ?? null;
const PUSH_WORKER_URL = CONFIG.PUSH_WORKER_URL ?? null;
import { prepareFile, uploadMedia, loadMediaURL, cachedURL, removeMedia, MAX_ITEMS } from './media.js';
import {
  pad, iso, parseISO, addDays, daysBetween, binDates, binWho as binWhoRaw, doneInfo, binAppliesTo, binColorFor,
  dueReminders, reminderText, DEFAULT_PREFS, EVENT_TYPES,
} from './trash-logic.js';

/* ═══════════════════════════════════════════════════════════════════════════
   Hilfsfunktionen
   ═══════════════════════════════════════════════════════════════════════════ */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LS = {
  get(k, d = null) { try { const v = localStorage.getItem('vt.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('vt.' + k, JSON.stringify(v)); } catch { /* privat */ } },
  del(k) { try { localStorage.removeItem('vt.' + k); } catch { /* privat */ } },
};
const haptic = (ms = 8) => { try { navigator.vibrate?.(ms); } catch { /* egal */ } };

// Datum (immer lokale Kalendertage als 'YYYY-MM-DD')
const today = () => iso(new Date());
const clock = (ts) => new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' }).format(new Date(ts));
const fmt = (s, o) => new Intl.DateTimeFormat('de-DE', o).format(parseISO(s));
function fmtDay(s) {
  const n = daysBetween(today(), s);
  if (n === 0) return 'Heute';
  if (n === 1) return 'Morgen';
  if (n === 2) return 'Übermorgen';
  if (n === -1) return 'Gestern';
  if (n > 2 && n < 7) return fmt(s, { weekday: 'long' });
  return fmt(s, { weekday: 'short', day: 'numeric', month: 'short' });
}
const fmtLong = (s) => fmt(s, { weekday: 'long', day: 'numeric', month: 'long' });
function relTime(ts) {
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return 'gerade eben';
  if (s < 3600) return `vor ${Math.floor(s / 60)} Min.`;
  if (s < 86400) return `vor ${Math.floor(s / 3600)} Std.`;
  const d = Math.floor(s / 86400);
  if (d === 1) return 'gestern';
  if (d < 7) return `vor ${d} Tagen`;
  return new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'short' }).format(new Date(ts));
}
function greeting() {
  // Morgens 5–11 Uhr, tagsüber 11–18 Uhr, abends 18–5 Uhr
  const h = new Date().getHours();
  if (h >= 5 && h < 11) return 'Guten Morgen';
  if (h >= 11 && h < 18) return 'Guten Tag';
  return 'Guten Abend';
}
function genCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const r = crypto.getRandomValues(new Uint8Array(10));
  const s = [...r].map((x) => A[x % A.length]).join('');
  return `${s.slice(0, 5)}-${s.slice(5)}`;
}
const normCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^(.{5})(.+)$/, '$1-$2');
const b64e = (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64d = (s) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));
function download(name, content, type) {
  const blob = new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/* ═══════════════════════════════════════════════════════════════════════════
   Icons (SF-Symbols-artige Strichzeichnungen)
   ═══════════════════════════════════════════════════════════════════════════ */
const svg = (d, w = 2) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const I = {
  home: svg('<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5"/>'),
  tasks: svg('<rect x="3.5" y="3.5" width="17" height="17" rx="4.5"/><path d="m8 12.2 2.6 2.6L16 9.4"/>'),
  trash: svg('<path d="M4 7h16"/><path d="M9.5 7V4.8c0-.4.4-.8.8-.8h3.4c.4 0 .8.4.8.8V7"/><path d="M6 7l1 12.2A2 2 0 0 0 9 21h6a2 2 0 0 0 2-1.8L18 7"/><path d="M10 11v6M14 11v6"/>'),
  board: svg('<path d="M20 15.5a2 2 0 0 1-2 2H8l-4.5 3.5V6a2 2 0 0 1 2-2H18a2 2 0 0 1 2 2Z"/><path d="M8 9h8M8 12.5h5"/>'),
  reply: svg('<path d="M9.5 6 4 11.5 9.5 17"/><path d="M4.5 11.5H14a6 6 0 0 1 6 6V19"/>'),
  dm: svg('<path d="M21 11.5a8.5 8.5 0 0 1-12.3 7.6L3.5 20.5l1.4-4.8A8.5 8.5 0 1 1 21 11.5Z"/><path d="M8.5 11.5h.01M12.5 11.5h.01M16.5 11.5h.01" stroke-width="2.6"/>'),
  people: svg('<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.6"/><path d="M15.5 14.3A5 5 0 0 1 21 19"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>', 2.6),
  check: svg('<path d="m5 12.5 4.5 4.5L19 7.5"/>', 3),
  close: svg('<path d="M6 6l12 12M18 6 6 18"/>', 2.4),
  heart: svg('<path d="M12 20.5s-7.5-4.4-9.2-9.4C1.6 7.4 4 4 7.4 4c2 0 3.6 1.2 4.6 2.8C13 5.2 14.6 4 16.6 4 20 4 22.4 7.4 21.2 11.1 19.5 16.1 12 20.5 12 20.5Z"/>'),
  heartFill: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 20.5s-7.5-4.4-9.2-9.4C1.6 7.4 4 4 7.4 4c2 0 3.6 1.2 4.6 2.8C13 5.2 14.6 4 16.6 4 20 4 22.4 7.4 21.2 11.1 19.5 16.1 12 20.5 12 20.5Z"/></svg>',
  comment: svg('<path d="M21 12a8.5 8.5 0 0 1-12.6 7.4L3 21l1.6-5A8.5 8.5 0 1 1 21 12Z"/>'),
  smile: svg('<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0"/><path d="M9 9.5h.01M15 9.5h.01"/><path d="M19 3v4M17 5h4"/>'),
  more: svg('<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>', 2.2),
  cal: svg('<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>'),
  clock: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
  pin: svg('<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z"/><circle cx="12" cy="10" r="2.3"/>'),
  repeat: svg('<path d="M17 2.5 20.5 6 17 9.5"/><path d="M3.5 11.5V10a4 4 0 0 1 4-4h13"/><path d="M7 21.5 3.5 18 7 14.5"/><path d="M20.5 12.5V14a4 4 0 0 1-4 4h-13"/>'),
  chart: svg('<path d="M5 20V11M12 20V5M19 20v-6"/>', 2.6),
  pen: svg('<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/>'),
  send: svg('<path d="M12 19V5M6 11l6-6 6 6"/>', 2.6),
  chev: svg('<path d="m9 5 7 7-7 7"/>', 2.4),
  left: svg('<path d="m15 5-7 7 7 7"/>', 2.4),
  share: svg('<path d="M12 3v12M7.5 7.5 12 3l4.5 4.5"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/>'),
  copy: svg('<rect x="8" y="8" width="12" height="12" rx="3"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>'),
  cloud: svg('<path d="M7 18.5a4.5 4.5 0 0 1-.5-9 6 6 0 0 1 11.6 1.5A3.8 3.8 0 0 1 17.5 18.5Z"/>'),
  download: svg('<path d="M12 3v12M7.5 10.5 12 15l4.5-4.5"/><path d="M5 19h14"/>'),
  upload: svg('<path d="M12 15V3M7.5 7.5 12 3l4.5 4.5"/><path d="M5 19h14"/>'),
  moon: svg('<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"/>'),
  user: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/>'),
  door: svg('<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/><path d="M10 16.5 14.5 12 10 7.5M14.5 12H3"/>'),
  star: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9Z"/></svg>',
  bell: svg('<path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15Z"/><path d="M10 21h4"/>'),
  pinned: svg('<path d="M9 3h6l-1 6 4 4H6l4-4Z"/><path d="M12 13v8"/>'),
  sparkle: svg('<path d="M12 3c.6 4.5 2.5 6.4 7 7-4.5.6-6.4 2.5-7 7-.6-4.5-2.5-6.4-7-7 4.5-.6 6.4-2.5 7-7Z"/>'),
  play: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.9l10.2-6.5a1 1 0 0 0 0-1.8L9.5 4.6A1 1 0 0 0 8 5.5Z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4.2" height="14" rx="1.4"/><rect x="13.8" y="5" width="4.2" height="14" rx="1.4"/></svg>',
  photo: svg('<rect x="3" y="5" width="18" height="15" rx="3.5"/><circle cx="12" cy="12.5" r="3.6"/><path d="M8.5 5 10 3h4l1.5 2"/>'),
  mic: svg('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>'),
  house: svg('<path d="M3 11 12 4l9 7"/><path d="M5.5 9.5V20h13V9.5"/><path d="M10 20v-5h4v5"/>'),
};

/* ═══════════════════════════════════════════════════════════════════════════
   Konstanten
   ═══════════════════════════════════════════════════════════════════════════ */
const TABS = [
  { id: 'home', label: 'Übersicht', icon: I.home },
  { id: 'tasks', label: 'Aufgaben', icon: I.tasks },
  { id: 'trash', label: 'Müll', icon: I.trash },
  { id: 'board', label: 'Social Hub', icon: I.board },
  { id: 'house', label: 'Haus', icon: I.people },
];
const MEMBER_EMOJIS = ['😀', '😎', '🥰', '🤓', '🦊', '🐼', '🐨', '🦁', '🐸', '🐙', '🦄', '🐝', '🐱', '🐶', '🌻', '🌈', '⭐', '🍕', '☕', '🎸', '👑', '💜', '🌸', '🍀'];
const MEMBER_COLORS = ['#ff6b6b', '#ff922b', '#fcc419', '#51cf66', '#20c997', '#339af0', '#5c7cfa', '#cc5de8', '#f06595', '#868e96'];
const QUICK_REACTIONS = ['❤️', '👍', '😂', '😮', '😢', '🎉', '🙏', '🔥'];
const ALL_EMOJIS = ['😀', '😃', '😄', '😁', '😆', '🥹', '😅', '😂', '🤣', '😊', '😇', '🙂', '😉', '😍', '🥰', '😘', '😋', '😜', '🤪', '🤨', '🧐', '🤓', '😎', '🥳', '😏', '😒', '😞', '😔', '😟', '😕', '🙁', '😣', '😫', '😩', '🥺', '😢', '😭', '😤', '😠', '😡', '🤯', '😳', '🥵', '🥶', '😱', '😨', '🤗', '🤔', '🫡', '🤭', '🫢', '🤫', '😶', '😐', '🙄', '😬', '😴', '🤤', '🤢', '🤧', '😷', '🤒', '🤠', '😈', '👻', '💩', '🤡', '👽', '🤖', '🎃', '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '💔', '💯', '💥', '✨', '🔥', '⭐', '👍', '👎', '👌', '✌️', '🤞', '🤝', '👏', '🙌', '🙏', '💪', '👀', '🫶', '🎉', '🎊', '🎂', '🍕', '🍔', '🍝', '🍰', '🍺', '🍷', '☕', '🧹', '🧽', '🧺', '🗑️', '♻️', '🛒', '🏠', '🔑', '💡', '🚿', '🛁', '🌱', '🌻', '🐶', '🐱', '☀️', '🌧️', '❄️', '⚡', '✅', '❌', '⚠️', '❓', '💤', '📦', '📅', '💶'];
const BIN_COLORS = [
  ['Grau', '#6b7280'], ['Schwarz', '#2c2c30'], ['Braun', '#8b5a2b'], ['Blau', '#2f7de1'],
  ['Gelb', '#eab308'], ['Grün', '#2fa84f'], ['Türkis', '#14b8a6'], ['Rot', '#e5484d'], ['Orange', '#f08c2e'], ['Lila', '#8e5cf7'],
];
const BIN_PRESETS = [
  ['Restmüll', '#6b7280'], ['Biotonne', '#8b5a2b'], ['Papier', '#2fa84f'], ['Gelber Sack', '#eab308'], ['Glas', '#14b8a6'], ['Sperrmüll', '#e5484d'],
];
const DEFAULT_BINS = [
  { name: 'Restmüll', color: '#6b7280' },
  { name: 'Biotonne', color: '#8b5a2b' },
  { name: 'Papier', color: '#2fa84f' },
  { name: 'Gelber Sack', color: '#eab308' },
];
const REPEAT = { none: 'Einmalig', daily: 'Täglich', weekly: 'Wöchentlich', biweekly: 'Alle 2 Wochen', monthly: 'Monatlich' };

/* ═══════════════════════════════════════════════════════════════════════════
   Zustand
   ═══════════════════════════════════════════════════════════════════════════ */
const state = {
  ready: false,
  hid: null,
  house: null,
  members: [], tasks: [], feed: [], trash: [], messages: [],
  loaded: new Set(),
  synced: new Set(), // Sammlungen, die wirklich vom Server (nicht nur aus dem Zwischenspeicher) kamen
  me: null,
  tab: LS.get('tab', 'home'),
  taskView: 'open',
  taskPerson: 'all',
  feedFilter: 'all',
  binScope: LS.get('binScope', 'mine'),
  calMonth: null,
  presence: [],
};
if (!TABS.some((t) => t.id === state.tab)) state.tab = 'home';
let store = null;
const cloudConfig = () => FIREBASE_CONFIG || LS.get('fbconfig');

const member = (id) => state.members.find((m) => m.id === id);
const membersSorted = () => [...state.members].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
const me = () => member(state.me);

function avatar(id, size = 32) {
  if (id === 'all') return `<span class="av" style="--s:${size}px;--c:#8e8e93" title="Alle">👥</span>`;
  const m = member(id);
  if (!m) return `<span class="av" style="--s:${size}px;--c:#8e8e93">?</span>`;
  const dot = size >= 20 && id !== state.me && presenceOf(id)?.online ? '<i class="online-dot" aria-label="online"></i>' : '';
  if (m.photo) return `<span class="av photo" style="--s:${size}px;--c:${esc(m.color)}" title="${esc(dn(id))}"><img src="${esc(m.photo)}" alt="" loading="lazy" decoding="async">${dot}</span>`;
  return `<span class="av" style="--s:${size}px;--c:${esc(m.color)}" title="${esc(dn(id))}">${esc(m.emoji || m.name.slice(0, 1))}${dot}</span>`;
}

/* ─── Online-Status ───────────────────────────────────────────────────────
   Jede:r schreibt einmal pro Minute „bin da“ in presence/{memberId}.
   Bleibt das länger als PRESENCE_TTL aus, gilt man als offline. */
const PRESENCE_TTL = 150e3;
const myPresence = () => state.presence.find((x) => x.id === state.me);
const presenceHidden = () => myPresence()?.hidden ?? LS.get('presenceOff', false);
function presenceOf(id) {
  const p = state.presence.find((x) => x.id === id);
  if (!p || p.hidden || !p.lastSeen) return null;
  return { online: !!p.online && Date.now() - p.lastSeen < PRESENCE_TTL, lastSeen: p.lastSeen };
}
function lastSeenLabel(ts) {
  const diff = Date.now() - ts;
  if (diff < 60e3) return 'gerade eben';
  if (diff < 3600e3) return `vor ${Math.floor(diff / 60e3)} Min.`;
  const d = iso(new Date(ts));
  const t = clock(ts);
  const n = daysBetween(d, today());
  if (n === 0) return `heute um ${t}`;
  if (n === 1) return `gestern um ${t}`;
  if (n < 7) return `am ${new Intl.DateTimeFormat('de-DE', { weekday: 'long' }).format(new Date(ts))} um ${t}`;
  return `am ${new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'short' }).format(new Date(ts))}`;
}
/** HTML für die Statuszeile, leer wenn unbekannt/verborgen */
function presenceText(id) {
  if (id === state.me) return presenceHidden() ? '<span class="presence off">Status verborgen</span>' : '<span class="presence on">Online</span>';
  const p = presenceOf(id);
  if (!p) return '';
  return p.online ? '<span class="presence on">Online</span>' : `<span class="presence">Zuletzt online ${lastSeenLabel(p.lastSeen)}</span>`;
}
function beat(online = true) {
  if (!state.ready || !state.me || !store || !member(state.me)) return;
  const doc = presenceHidden()
    ? { hidden: true, memberId: state.me }
    : { hidden: false, online, lastSeen: Date.now(), memberId: state.me };
  store.set('presence', state.me, doc).catch(() => {});
}
function setPresenceVisible(visible) {
  LS.set('presenceOff', !visible);
  const doc = visible ? { hidden: false, online: true, lastSeen: Date.now(), memberId: state.me } : { hidden: true, memberId: state.me };
  state.presence = [...state.presence.filter((x) => x.id !== state.me), { ...doc, id: state.me }];
  store.set('presence', state.me, doc).catch(() => {});
  toast(visible ? '🟢 Andere sehen jetzt, wann du online bist' : '🙈 Dein Online-Status ist jetzt verborgen');
  render();
}
// Nur neu zeichnen, wenn sich eine sichtbare Anzeige ändert (nicht bei jedem Herzschlag)
let presenceSig = '';
function presenceChanged() {
  const sig = state.members.map((m) => `${m.id}:${presenceText(m.id)}`).join('|');
  if (sig === presenceSig) return false;
  presenceSig = sig;
  return true;
}
/** Anzeigename: dein eigener Spitzname für die Person (nur für dich sichtbar) oder ihr Name */
const nickOf = (id) => (id && id !== state.me ? String(me()?.nick?.[id] || '').trim() : '');
const dn = (id) => { const m = member(id); return m ? nickOf(id) || m.name : '?'; };
const nameOf = (id) => (id === state.me ? 'Du' : member(id) ? dn(id) : 'Jemand');

/** Neuigkeit für die Push-Mitteilungen hinterlegen (verschickt der Server alle 5 Min.).
 *  to: Empfänger-IDs oder null = alle außer mir; pref: Art (abschaltbar) */
async function emit(pref, { title, body, to = null, tab = 'home', tag } = {}) {
  if (store?.mode !== 'cloud' || !state.me) return;
  const id = newId();
  const ev = { id, pref, actor: state.me, at: Date.now(), to, title, body: String(body || '').slice(0, 180), tab, tag: tag || `${pref}-${id}` };
  // 1) Sofort-Push über den Cloudflare Worker
  if (PUSH_WORKER_URL && store.idToken) {
    try {
      const token = await store.idToken();
      const res = await fetch(`${PUSH_WORKER_URL.replace(/\/$/, '')}/notify`, {
        method: 'POST', keepalive: true,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ hid: state.hid, event: ev }),
      });
      if (res.ok) return;
    } catch (e) { console.warn('Sofort-Push nicht erreichbar, nutze Ersatzweg', e); }
  }
  // 2) Ersatzweg: Neuigkeit ablegen, die GitHub Action verschickt sie (alle 5 Min.)
  store.add('events', ev).catch((e) => console.warn('Neuigkeit nicht gespeichert', e));
}
const myName = () => me()?.name || 'Jemand';

/* ─── Markieren (@Name) ──────────────────────────────────────────────────── */
/** IDs aller Mitglieder, die im Text mit @Name markiert sind */
function mentionIds(text) {
  const t = String(text || '');
  return state.members.filter((m) => t.includes('@' + m.name)).map((m) => m.id);
}
/** Text sicher darstellen und @Namen hervorheben (längere Namen zuerst, keine Doppelungen) */
function richText(text) {
  let h = esc(text);
  const ms = [...state.members].sort((a, b) => b.name.length - a.name.length);
  const marks = [];
  ms.forEach((m) => {
    const needle = '@' + esc(m.name);
    if (!h.includes(needle)) return;
    marks.push(`<span class="mention${m.id === state.me ? ' me' : ''}">${needle}</span>`);
    h = h.split(needle).join(`\u0000${marks.length - 1}\u0000`);
  });
  return h.replace(/\u0000(\d+)\u0000/g, (_, i) => marks[+i]);
}
/** Vorschlagsliste an ein Eingabefeld hängen: „@“ tippen → Personen antippen */
function attachMentions(field, triggerBtn) {
  if (!field) return;
  const box = document.createElement('div');
  box.className = 'mention-box';
  box.hidden = true;
  field.insertAdjacentElement('afterend', box);
  const query = () => {
    const pos = field.selectionStart ?? field.value.length;
    const m = field.value.slice(0, pos).match(/@([^\s@]{0,20})$/);
    return m ? { start: pos - m[0].length, pos, q: m[1].toLowerCase() } : null;
  };
  const show = () => {
    const q = query();
    if (!q) { box.hidden = true; return; }
    const list = membersSorted().filter((m) => m.id !== state.me && m.name.toLowerCase().startsWith(q.q));
    if (!list.length) { box.hidden = true; return; }
    box.innerHTML = list.map((m) => `<button type="button" data-mention="${m.id}">${avatar(m.id, 26)}<span>${esc(m.name)}</span></button>`).join('');
    box.hidden = false;
  };
  field.addEventListener('input', show);
  field.addEventListener('click', show);
  field.addEventListener('blur', () => setTimeout(() => { box.hidden = true; }, 250));
  box.addEventListener('pointerdown', (e) => e.preventDefault()); // Fokus im Feld lassen
  box.addEventListener('click', (e) => {
    const b = e.target.closest('[data-mention]');
    if (!b) return;
    const m = member(b.dataset.mention);
    const q = query() || { start: field.selectionStart, pos: field.selectionStart };
    const ins = `@${m.name} `;
    field.value = field.value.slice(0, q.start) + ins + field.value.slice(q.pos);
    const c = q.start + ins.length;
    field.focus();
    field.setSelectionRange(c, c);
    box.hidden = true;
    haptic(6);
    field.dispatchEvent(new Event('input'));
  });
  triggerBtn?.addEventListener('click', () => {
    const pos = field.selectionStart ?? field.value.length;
    const before = field.value.slice(0, pos);
    const ins = (before && !/\s$/.test(before) ? ' @' : '@');
    field.value = before + ins + field.value.slice(pos);
    field.focus();
    field.setSelectionRange(pos + ins.length, pos + ins.length);
    show();
  });
}
/** Markierte Personen benachrichtigen */
function emitMentions(text, { exclude = [], what = 'einem Beitrag' } = {}) {
  const ids = mentionIds(text).filter((id) => id !== state.me && !exclude.includes(id));
  if (ids.length) emit('mention', { title: `🏷️ ${myName()} hat dich markiert`, body: `In ${what}: ${snippet(text, 110)}`, to: ids, tab: 'board' });
  return ids;
}
const snippet = (t, n = 80) => { const s = String(t || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

/* Optimistische Änderung: sofort lokal anzeigen, dann speichern */
function mutate(col, id, fn) {
  const i = state[col].findIndex((x) => x.id === id);
  if (i >= 0) { state[col][i] = { ...fn(structuredClone(state[col][i])), id }; render(); }
  store.update(col, id, fn).catch((e) => { console.error(e); toast('⚠️ Konnte nicht speichern'); });
}
function addDoc(col, obj) {
  const doc = { ...obj, id: obj.id || newId() };
  state[col] = [...state[col].filter((x) => x.id !== doc.id), doc];
  render();
  store.add(col, doc).catch((e) => { console.error(e); toast('⚠️ Konnte nicht speichern'); });
  return doc.id;
}
function setDoc(col, doc) {
  state[col] = state[col].map((x) => (x.id === doc.id ? doc : x));
  render();
  store.set(col, doc.id, doc).catch((e) => { console.error(e); toast('⚠️ Konnte nicht speichern'); });
}
function removeDoc(col, id) {
  state[col] = state[col].filter((x) => x.id !== id);
  render();
  store.remove(col, id).catch((e) => { console.error(e); toast('⚠️ Konnte nicht löschen'); });
}

/* ═══════════════════════════════════════════════════════════════════════════
   UI-Bausteine: Toast, Sheets, Bestätigung
   ═══════════════════════════════════════════════════════════════════════════ */
function toast(msg, ms = 2600) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  $('#toasts').appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 350); }, ms);
}

const sheets = [];
/* Hintergrund festhalten, solange ein Sheet offen ist (auch iOS: body fixieren statt nur overflow) */
let scrollLockY = null;
function lockScroll() {
  if (scrollLockY != null) return;
  scrollLockY = window.scrollY;
  const b = document.body.style;
  b.position = 'fixed'; b.top = `-${scrollLockY}px`; b.left = '0'; b.right = '0'; b.width = '100%';
  document.documentElement.classList.add('sheet-open');
}
function unlockScroll() {
  if (scrollLockY == null) return;
  const y = scrollLockY;
  scrollLockY = null;
  const b = document.body.style;
  b.position = b.top = b.left = b.right = b.width = '';
  document.documentElement.classList.remove('sheet-open');
  window.scrollTo(0, y);
}

function openSheet({ title, html, onMount, refresh, onClose }) {
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `
    <div class="sheet-backdrop"></div>
    <section class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="grabber"></div>
      <header class="sheet-head"><h2>${esc(title)}</h2>
        <button class="icon-btn" data-close aria-label="Schließen">${I.close}</button></header>
      <div class="sheet-body">${html}</div>
    </section>`;
  document.body.appendChild(wrap);
  const panel = $('.sheet', wrap);
  const api = { el: wrap, body: $('.sheet-body', wrap), close, refresh: refresh || null, closed: false };
  function close() {
    if (api.closed) return;
    api.closed = true;
    try { onClose?.(api); } catch (e) { console.error(e); }
    panel.style.transform = '';
    wrap.classList.remove('open');
    wrap.classList.add('closing');
    setTimeout(() => wrap.remove(), 380);
    sheets.splice(sheets.indexOf(api), 1);
    if (!sheets.length) setTimeout(() => { if (!sheets.length) unlockScroll(); }, 0);
  }
  wrap.addEventListener('click', (e) => {
    if (e.target.classList.contains('sheet-backdrop') || e.target.closest('[data-close]')) close();
  });
  // Nach unten wischen zum Schließen
  let y0 = null, dy = 0;
  const head = $('.sheet-head', wrap), grab = $('.grabber', wrap);
  const start = (e) => { y0 = e.clientY; dy = 0; panel.style.transition = 'none'; e.target.setPointerCapture?.(e.pointerId); };
  const move = (e) => { if (y0 == null) return; dy = Math.max(0, e.clientY - y0); panel.style.transform = `translateY(${dy}px)`; };
  const end = () => {
    if (y0 == null) return;
    y0 = null; panel.style.transition = '';
    if (dy > 110) close(); else panel.style.transform = '';
  };
  [head, grab].forEach((el) => {
    el.addEventListener('pointerdown', (e) => { if (!e.target.closest('button')) start(e); });
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  });
  sheets.push(api);
  lockScroll();
  requestAnimationFrame(() => requestAnimationFrame(() => wrap.classList.add('open')));
  onMount?.(api);
  settleSegs(wrap);
  const first = $('[autofocus]', wrap);
  if (first && matchMedia('(hover: hover)').matches) setTimeout(() => first.focus(), 350);
  return api;
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && sheets.length) sheets[sheets.length - 1].close(); });

function confirmSheet(text, ok = 'Löschen', danger = true) {
  return new Promise((resolve) => {
    let done = false;
    const s = openSheet({
      title: 'Sicher?',
      html: `<p class="muted" style="margin:0 0 18px">${esc(text)}</p>
        <div class="sheet-actions"><button class="btn" data-close>Abbrechen</button>
        <button class="btn primary" ${danger ? 'style="background:var(--danger);box-shadow:none"' : ''} id="ok">${esc(ok)}</button></div>`,
      onMount: (api) => { $('#ok', api.el).onclick = () => { done = true; resolve(true); api.close(); }; },
    });
    const orig = s.close;
    s.close = () => { if (!done) resolve(false); orig(); };
    s.el.addEventListener('click', (e) => {
      if (!done && (e.target.classList.contains('sheet-backdrop') || e.target.closest('[data-close]'))) { done = true; resolve(false); }
    }, true);
  });
}

// Merkt sich die letzte Position je Umschalter, damit die Linse nach dem Neuzeichnen
// von der alten zur neuen Position gleitet statt zu springen.
const segPos = {};
function segmented(items, current, act) {
  const i = Math.max(0, items.findIndex(([v]) => v === current));
  const key = act !== 'noop' ? act : null;
  const from = key && segPos[key] != null && segPos[key] < items.length ? segPos[key] : i;
  if (key) segPos[key] = i;
  return `<div class="seg" style="--n:${items.length};--i:${from}" data-i="${i}" role="tablist"><span class="thumb"><span class="thumb-glass"></span></span>${items
    .map(([v, l]) => `<button role="tab" aria-selected="${v === current}" class="${v === current ? 'on' : ''}" data-act="${act}" data-v="${esc(v)}">${l}</button>`)
    .join('')}</div>`;
}
/** Nach dem Neuzeichnen: Linsen von der alten zur neuen Position gleiten lassen */
function settleSegs(root = document) {
  const segs = $$('.seg[data-i]', root).filter((x) => x.style.getPropertyValue('--i').trim() !== x.dataset.i);
  if (!segs.length) return;
  requestAnimationFrame(() => requestAnimationFrame(() => segs.forEach((x) => x.style.setProperty('--i', x.dataset.i))));
}

/** Ziehen der Linse in jedem Umschalter – wie in der Navigationsleiste */
(function segDrag() {
  let d = null;
  const geom = (seg) => {
    const n = +getComputedStyle(seg).getPropertyValue('--n') || $$('button', seg).length;
    const w = (seg.clientWidth - 8) / n;
    return { n, w };
  };
  document.addEventListener('pointerdown', (e) => {
    const seg = e.target.closest('.seg');
    if (!seg || e.button > 0) return;
    const { w } = geom(seg);
    const i = +getComputedStyle(seg).getPropertyValue('--i') || 0;
    d = { seg, id: e.pointerId, x0: e.clientX, start: i * w, w, dragging: false, x: i * w };
    seg.classList.add('pressed');
  });
  document.addEventListener('pointermove', (e) => {
    if (!d || e.pointerId !== d.id) return;
    const dx = e.clientX - d.x0;
    if (!d.dragging) {
      if (Math.abs(dx) < 8) return;
      d.dragging = true;
      d.seg.classList.add('dragging');
      try { d.seg.setPointerCapture(e.pointerId); } catch { /* egal */ }
      // Linse dort anfassen, wo der Finger ist
      const r = d.seg.getBoundingClientRect();
      const fingerX = e.clientX - r.left - 4;
      if (fingerX < d.start || fingerX > d.start + d.w) d.start = Math.max(0, Math.min(fingerX - d.w / 2, (geom(d.seg).n - 1) * d.w));
      d.x0 = e.clientX;
      haptic(5);
    }
    const { n, w } = geom(d.seg);
    d.x = Math.max(0, Math.min((n - 1) * w, d.start + (e.clientX - d.x0)));
    $('.thumb', d.seg).style.transform = `translateX(${d.x}px)`;
    const hi = Math.round(d.x / w);
    $$('button', d.seg).forEach((b, k) => b.classList.toggle('hover', k === hi));
  });
  const end = (e, cancel) => {
    if (!d || e.pointerId !== d.id) return;
    const { seg, dragging, x } = d;
    d = null;
    seg.classList.remove('pressed');
    if (!dragging) return; // normales Tippen → der Klick übernimmt
    const { w } = geom(seg);
    const btns = $$('button', seg);
    const idx = Math.max(0, Math.min(btns.length - 1, Math.round(x / w)));
    btns.forEach((b) => b.classList.remove('hover'));
    seg.classList.remove('dragging');
    $('.thumb', seg).style.transform = '';
    seg.style.setProperty('--i', idx);
    const swallow = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
    seg.addEventListener('click', swallow, { capture: true, once: true }); // Geister-Klick nach dem Ziehen verhindern
    setTimeout(() => seg.removeEventListener('click', swallow, { capture: true }), 400);
    if (!cancel && !btns[idx].classList.contains('on')) {
      const act = btns[idx].dataset.act;
      if (act && act !== 'noop') segPos[act] = idx;
      seg.removeEventListener('click', swallow, { capture: true });
      btns[idx].click();
    }
  };
  document.addEventListener('pointerup', (e) => end(e, false));
  document.addEventListener('pointercancel', (e) => end(e, true));
})();

const toggle = (id, label, checked) => `<label class="toggle-row" for="${id}"><span>${label}</span><span class="switch"><input type="checkbox" id="${id}" ${checked ? 'checked' : ''}><span></span></span></label>`;

/* ═══════════════════════════════════════════════════════════════════════════
   Tab-Leiste mit verschiebbarer Liquid-Glass-Linse
   ═══════════════════════════════════════════════════════════════════════════ */
function buildTabbar() {
  const bar = $('#tabbar');
  bar.insertAdjacentHTML('beforeend', TABS.map((t) =>
    `<button class="tab" data-tab="${t.id}" aria-label="${t.label}">${t.icon}<span>${t.label}</span></button>`).join(''));

  // Die Linse: äußeres Element verschiebt (translateX), inneres Glas skaliert.
  // Getrennt, damit Ziehen (direkt, ohne Verzögerung) und Größe (federnd) sich nicht stören.
  const lens = $('#lens');
  const tabs = () => $$('.tab', bar);
  const activeIdx = () => Math.max(0, TABS.findIndex((t) => t.id === state.tab));
  let lensX = 0;
  const setX = (x) => { lensX = x; lens.style.transform = `translate3d(${x}px,0,0)`; };
  const geom = () => {
    const n = tabs().length;
    const pad = 4;
    return { pad, n, w: (bar.clientWidth - pad * 2) / n };
  };
  const placeLens = (idx, animate = true) => {
    const { pad, w } = geom();
    lens.style.width = `${w}px`;
    if (!animate) lens.classList.add('no-anim');
    setX(pad + idx * w);
    if (!animate) { void lens.offsetWidth; lens.classList.remove('no-anim'); }
  };

  let down = null, dragging = false, hoverIdx = -1, raf = 0, pendingX = null;
  const idxAt = (clientX) => {
    const r = bar.getBoundingClientRect();
    const { pad, w, n } = geom();
    return Math.max(0, Math.min(n - 1, Math.floor((clientX - r.left - pad) / w)));
  };
  new ResizeObserver(() => { if (!dragging) placeLens(activeIdx(), false); }).observe(bar);

  const setHover = (hi) => {
    if (hi === hoverIdx) return;
    hoverIdx = hi;
    tabs().forEach((t, i) => t.classList.toggle('hover', i === hi));
    if (dragging && hi >= 0) haptic(4);
  };
  bar.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    down = { x: e.clientX, idx: idxAt(e.clientX), id: e.pointerId, offset: 0 };
    dragging = false;
    bar.classList.add('pressed');
    try { bar.setPointerCapture(e.pointerId); } catch { /* egal */ }
  });
  bar.addEventListener('pointermove', (e) => {
    if (!down || e.pointerId !== down.id) return;
    const r = bar.getBoundingClientRect();
    const { pad, w } = geom();
    if (!dragging) {
      if (Math.abs(e.clientX - down.x) < 8) return;
      dragging = true;
      // Linse dort „anfassen“, wo der Finger sie gerade hält – kein Springen
      down.offset = (down.x - r.left) - lensX;
      if (down.offset < 0 || down.offset > w) down.offset = w / 2;
      bar.classList.add('dragging');
      haptic(5);
    }
    pendingX = Math.max(pad, Math.min(bar.clientWidth - pad - w, e.clientX - r.left - down.offset));
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; if (pendingX != null && dragging) setX(pendingX); });
    setHover(idxAt(r.left + pendingX + w / 2));
  });
  const finish = (e, cancel) => {
    if (!down || (e && e.pointerId !== down.id)) return;
    const { w } = geom();
    const r = bar.getBoundingClientRect();
    const x = pendingX != null ? pendingX : lensX;
    const idx = cancel ? activeIdx() : dragging ? idxAt(r.left + x + w / 2) : down.idx;
    cancelAnimationFrame(raf); raf = 0; pendingX = null;
    if (dragging) setX(x);
    down = null; dragging = false;
    setHover(-1);
    bar.classList.remove('dragging', 'pressed');
    switchTab(TABS[idx].id);
  };
  bar.addEventListener('pointerup', (e) => finish(e, false));
  bar.addEventListener('pointercancel', (e) => finish(e, true));
  bar.addEventListener('lostpointercapture', (e) => { if (down) finish(e, !dragging); });
  bar.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { const t = e.target.closest('.tab'); if (t) { e.preventDefault(); switchTab(t.dataset.tab); } }
  });

  // Lichtbrechung nur dort, wo der Browser SVG-Filter als backdrop-filter kann (Chromium)
  if (window.chrome && CSS.supports('backdrop-filter', 'url(#lg-refract)')) document.documentElement.classList.add('refract');

  let placed = false;
  syncTabbar = () => {
    const ai = activeIdx();
    tabs().forEach((t, i) => { t.classList.toggle('active', i === ai); t.setAttribute('aria-current', i === ai ? 'page' : 'false'); });
    if (!dragging) placeLens(ai, placed);
    placed = true;
    const open = myOpenTasks().filter((t) => t.due && t.due <= today()).length;
    const tb = tabs()[1];
    let b = $('.badge', tb);
    if (open) { if (!b) { b = document.createElement('i'); b.className = 'badge'; tb.appendChild(b); } b.textContent = open; } else b?.remove();
  };
}
let syncTabbar = () => {};

let tabRender = 0;
function switchTab(id) {
  if (state.tab !== id) {
    haptic(6);
    state.tab = id;
    LS.set('tab', id);
    // Erst die Linse losgleiten lassen, dann (zwei Frames später) den neuen Inhalt aufbauen –
    // so ruckelt die Animation nicht, während die Seite neu gezeichnet wird.
    syncTabbar();
    cancelAnimationFrame(tabRender);
    tabRender = requestAnimationFrame(() => {
      tabRender = requestAnimationFrame(() => { window.scrollTo({ top: 0 }); renderNow(true); });
    });
  } else {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    syncTabbar();
  }
}

function onFab() {
  haptic(8);
  if (state.tab === 'tasks') return taskSheet();
  if (state.tab === 'trash') return binSheet();
  if (state.tab === 'board') return composeSheet('post');
  openSheet({
    title: 'Neu erstellen',
    html: `<div class="menu-list">
      <button data-new="task">${I.tasks}<span>Aufgabe<span class="desc">Was muss erledigt werden?</span></span></button>
      <button data-new="post">${I.board}<span>Beitrag<span class="desc">Etwas im Social Hub posten</span></span></button>
      <button data-new="photo">${I.photo}<span>Foto / Video<span class="desc">Bilder und Clips mit allen teilen</span></span></button>
      <button data-new="voice">${I.mic}<span>Sprachnachricht<span class="desc">Einfach draufsprechen</span></span></button>
      <button data-new="poll">${I.chart}<span>Umfrage<span class="desc">Alle abstimmen lassen</span></span></button>
      <button data-new="event">${I.cal}<span>Ereignis<span class="desc">Grillabend, Handwerker, Geburtstag …</span></span></button>
    </div>`,
    onMount: (api) => api.body.addEventListener('click', (e) => {
      const b = e.target.closest('[data-new]');
      if (!b) return;
      api.close();
      const t = b.dataset.new;
      // Foto-Auswahl direkt im Tipp öffnen (iOS erlaubt den Dateidialog nur dort)
      if (t === 'photo') composeSheet('photo');
      else setTimeout(() => (t === 'task' ? taskSheet() : composeSheet(t)), 120);
    }),
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   Rendering
   ═══════════════════════════════════════════════════════════════════════════ */
let queued = false;
function render() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => { queued = false; renderNow(false); });
}
function renderNow(animate) {
  if (!state.ready) return;
  ensureDmSub();
  const v = $('#view');
  v.innerHTML = VIEWS[state.tab]();
  syncTabbar();
  updateVoiceUI();
  hydrateMedia();
  settleSegs(v);
  sheets.forEach((s) => s.refresh?.(s));
}

const ADD_LABEL = { home: 'Neu erstellen', tasks: 'Neue Aufgabe', trash: 'Neue Tonne', board: 'Neuer Beitrag' };
const header = (eyebrow, title) => `
  <header class="top">
    <div class="top-text"><p class="eyebrow">${eyebrow}</p><h1>${title}</h1></div>
    <div class="top-actions">
      ${ADD_LABEL[state.tab] ? `<button class="add-btn" data-act="add" aria-label="${ADD_LABEL[state.tab]}">${I.plus}</button>` : ''}
      <button class="add-btn dm-btn" data-act="dms" aria-label="Nachrichten${dmUnread() ? ` (${dmUnread()} ungelesen)` : ''}">${I.dm}${dmUnread() ? `<b class="badge">${dmUnread()}</b>` : ''}</button>
      <button class="me-btn" data-act="profile" aria-label="Mein Profil">${avatar(state.me, 42)}</button>
    </div>
  </header>`;

function localBanner() {
  if (store?.mode !== 'local') return '';
  return `<div class="banner">${I.cloud}<span style="flex:1">Lokaler Modus – die Daten sind nur auf diesem Gerät.</span><button data-act="cloud">Synchronisieren</button></div>`;
}

/* ─── Aufgaben-Logik ─────────────────────────────────────────────────────── */
const openTasks = () => state.tasks.filter((t) => !t.done);
const myOpenTasks = () => openTasks().filter((t) => t.assignee === state.me || !t.assignee);
const sortTasks = (a, b) => (a.due || '9999') .localeCompare(b.due || '9999') || (b.important ? 1 : 0) - (a.important ? 1 : 0) || (a.createdAt || 0) - (b.createdAt || 0);
function nextDue(due, rep) {
  const d = parseISO(due || today());
  if (rep === 'daily') d.setDate(d.getDate() + 1);
  else if (rep === 'weekly') d.setDate(d.getDate() + 7);
  else if (rep === 'biweekly') d.setDate(d.getDate() + 14);
  else if (rep === 'monthly') d.setMonth(d.getMonth() + 1);
  return iso(d);
}
function toggleTask(id) {
  const t = state.tasks.find((x) => x.id === id);
  if (!t) return;
  haptic(12);
  if (!t.done && t.repeat && t.repeat !== 'none') {
    const ids = membersSorted().map((m) => m.id);
    let nd = nextDue(t.due, t.repeat);
    while (nd <= today()) nd = nextDue(nd, t.repeat);
    mutate('tasks', id, (cur) => {
      let due = nextDue(cur.due, cur.repeat);
      while (due <= today()) due = nextDue(due, cur.repeat);
      let assignee = cur.assignee;
      if (cur.rotate && assignee && ids.length) assignee = ids[(ids.indexOf(assignee) + 1) % ids.length];
      const history = [{ by: state.me, at: Date.now() }, ...(cur.history || [])].slice(0, 30);
      return { ...cur, due, assignee, history, lastDoneBy: state.me, lastDoneAt: Date.now() };
    });
    toast(`✓ Erledigt – nächstes Mal ${fmtDay(nd)}`);
    emit('task_done', { title: `✅ ${myName()} hat eine Aufgabe erledigt`, body: t.title, tab: 'tasks' });
  } else {
    mutate('tasks', id, (cur) => ({ ...cur, done: !cur.done, doneBy: cur.done ? null : state.me, doneAt: cur.done ? null : Date.now() }));
    if (!t.done) {
      toast('✓ Erledigt – super!');
      emit('task_done', { title: `✅ ${myName()} hat eine Aufgabe erledigt`, body: t.title, tab: 'tasks' });
    }
  }
}

function dueInfo(t) {
  if (!t.due) return '';
  const n = daysBetween(today(), t.due);
  const cls = t.done ? '' : n < 0 ? 'red' : n === 0 ? 'orange' : n <= 2 ? 'blue' : '';
  const label = n < 0 && !t.done ? `${fmtDay(t.due)} · überfällig` : fmtDay(t.due);
  return `<span class="pill ${cls}">${I.cal}${esc(label)}</span>`;
}

function taskRow(t) {
  return `<div class="list-item task ${t.done ? 'done' : ''}">
    <button class="check ${t.done ? 'on' : ''}" data-act="task-toggle" data-id="${t.id}" aria-label="${t.done ? 'Wieder öffnen' : 'Erledigen'}">${I.check}</button>
    <button class="main" data-act="task-edit" data-id="${t.id}" style="text-align:left">
      <div class="title">${t.important ? `<span class="star">★</span> ` : ''}${esc(t.title)}</div>
      <div class="sub">${t.done
        ? `<span>✓ ${esc(nameOf(t.doneBy))} · ${relTime(t.doneAt || Date.now())}</span>`
        : `${dueInfo(t)}${t.repeat && t.repeat !== 'none' ? `<span class="pill">${I.repeat}${REPEAT[t.repeat]}${t.rotate ? ' · reihum' : ''}</span>` : ''}${t.notes ? `<span>${esc(t.notes.slice(0, 60))}${t.notes.length > 60 ? '…' : ''}</span>` : ''}`}
      </div>
    </button>
    ${avatar(t.assignee || 'all', 30)}
  </div>`;
}

/* ─── Müll-Logik ─────────────────────────────────────────────────────────── */
const memberIds = () => membersSorted().map((m) => m.id);
/** Früher automatisch angelegte Beispiel-Tonnen ohne echte Termine still entfernen */
let exampleCleanupDone = false;
function removeExampleBins() {
  if (exampleCleanupDone) return;
  const ex = exampleBins();
  if (!ex.length) return;
  exampleCleanupDone = true;
  ex.forEach((b) => removeDoc('trash', b.id));
}
/** Die früher per „Standard-Tonnen anlegen“ erzeugten, nie angepassten Beispiel-Tonnen */
function exampleBins() {
  const names = DEFAULT_BINS.map((b) => b.name);
  const ex = state.trash.filter((b) => names.includes(b.name) && b.mode === 'interval' && +b.interval === 2
    && !(b.dates || []).length && !b.importedBy && !(b.members || []).length && b.createdAt);
  if (ex.length !== DEFAULT_BINS.length || new Set(ex.map((b) => b.name)).size !== ex.length) return [];
  const t = ex.map((b) => b.createdAt);
  return Math.max(...t) - Math.min(...t) < 5000 ? ex : [];
}
const binWho = (bin, p) => binWhoRaw(bin, p, memberIds());
/** scope: 'mine' = nur Tonnen, die für mich gelten; 'all' = alle */
function pickups(from, to, scope = 'all') {
  const out = [];
  for (const bin of state.trash) {
    if (scope === 'mine' && !binAppliesTo(bin, state.me)) continue;
    for (const p of binDates(bin, from, to)) out.push({ bin, date: p.date, who: binWho(bin, p), done: doneInfo(bin, p.date) });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.bin.name.localeCompare(b.bin.name));
}
function binFor(bin) {
  const ms = (bin.members || []).filter(member);
  if (!ms.length) return 'ganzes Haus';
  return ms.map((id) => (id === state.me ? 'dich' : dn(id))).join(', ');
}
/** Das Bestätigungsfeld: für alle sichtbar, wer die Tonne wann rausgestellt hat */
function confirmBox(p) {
  const d = p.done;
  return `<button class="confirm ${d ? 'on' : ''}" data-act="bin-done" data-id="${p.bin.id}" data-date="${p.date}" aria-pressed="${!!d}">
    <span class="box">${I.check}</span>
    <span class="ctext">${d
      ? `<b>Rausgestellt</b> von ${d.by === state.me ? 'dir' : esc(nameOf(d.by))}${d.at ? ` · ${daysBetween(iso(new Date(d.at)), today()) ? fmtDay(iso(new Date(d.at))) + ', ' : ''}${clock(d.at)} Uhr` : ''}`
      : 'Tippen, wenn die Tonne draußen steht'}</span>
    ${d ? avatar(d.by, 24) : ''}
  </button>`;
}
function binSchedule(bin) {
  if (bin.mode === 'dates') {
    const n = (bin.dates || []).filter((d) => d >= today()).length;
    return n ? `${plural(n, 'Termin', 'Termine')} geplant` : 'Keine kommenden Termine';
  }
  if (!bin.start) return 'Noch kein Rhythmus';
  const i = +bin.interval || 1;
  return `${i === 1 ? 'Jede Woche' : `Alle ${i} Wochen`} ${fmt(bin.start, { weekday: 'long' })}s`;
}
async function toggleBinDone(id, date) {
  const bin = state.trash.find((b) => b.id === id);
  const d = bin && doneInfo(bin, date);
  if (d && d.by !== state.me && !(await confirmSheet(`${nameOf(d.by)} hat das bestätigt. Bestätigung wirklich zurücknehmen?`, 'Zurücknehmen'))) return;
  haptic(d ? 8 : 18);
  if (!d) {
    toast(`✓ ${bin?.name || 'Tonne'} ist draußen – danke! 🙌`);
    if (bin) emit('bin_done', { title: `🗑️ ${bin.name} ist draußen`, body: `${myName()} hat die Tonne rausgestellt ✓`, to: (bin.members || []).length ? bin.members : null, tab: 'trash', tag: `bin-${bin.id}-${date}` });
  }
  mutate('trash', id, (b) => {
    const done = { ...(b.done || {}) };
    if (done[date]) delete done[date]; else done[date] = { by: state.me, at: Date.now() };
    const cutoff = addDays(today(), -60);
    Object.keys(done).forEach((d) => { if (d < cutoff) delete done[d]; });
    return { ...b, done };
  });
}
const binIcon = (bin, lg) => `<span class="bin-icon ${lg ? 'lg' : ''}" style="--c:${esc(binColorFor(bin))}">${I.trash}</span>`;
/** „Wer ist zuständig?“ – feste Person oder alle, für die die Tonne gilt */
function binWhoHtml(p, { size = 18, short = false } = {}) {
  if (p.who) return `${avatar(p.who, size)} ${p.who === state.me ? '<b>Du bist dran</b>' : `${esc(dn(p.who))} ist dran`}`;
  const ids = (p.bin.members || []).filter(member);
  const all = ids.length ? ids : membersSorted().map((m) => m.id);
  const label = ids.length ? `Für ${esc(binFor(p.bin))}` : 'Für alle';
  return `<span class="av-stack">${all.slice(0, 5).map((id) => avatar(id, size)).join('')}</span> ${short ? '' : label}`;
}

/* ─── Social Hub-Logik ─────────────────────────────────────────────────────── */
const feedSorted = () => [...state.feed].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (b.createdAt || 0) - (a.createdAt || 0));
const upcomingEvents = () => state.feed.filter((p) => p.type === 'event' && p.event?.date >= today())
  .sort((a, b) => (a.event.date + (a.event.time || '')).localeCompare(b.event.date + (b.event.time || '')));
const openPollsForMe = () => state.feed.filter((p) => p.type === 'poll' && !p.poll?.closed && !(p.poll?.options || []).some((o) => (o.votes || []).includes(state.me)));

function postLabel(p) {
  if (p.type === 'poll') return `deine Umfrage „${snippet(p.poll?.question, 50)}“`;
  if (p.type === 'event') return `dein Ereignis „${snippet(p.event?.title, 50)}“`;
  if (p.type === 'voice') return 'deine Sprachnachricht';
  return p.text ? `deinen Beitrag „${snippet(p.text, 50)}“` : 'deinen Beitrag';
}
function toggleLike(id) {
  haptic(10);
  const post = state.feed.find((x) => x.id === id);
  if (post && post.author !== state.me && !(post.likes || []).includes(state.me)) {
    emit('social', { title: `❤️ ${myName()} gefällt das`, body: `${myName()} gefällt ${postLabel(post)}`, to: [post.author], tab: 'board', tag: `like-${id}` });
  }
  mutate('feed', id, (p) => {
    const s = new Set(p.likes || []);
    s.has(state.me) ? s.delete(state.me) : s.add(state.me);
    return { ...p, likes: [...s] };
  });
}
function react(id, emoji) {
  haptic(10);
  const post = state.feed.find((x) => x.id === id);
  if (post && post.author !== state.me && !(post.reactions?.[emoji] || []).includes(state.me)) {
    emit('social', { title: `${emoji} ${myName()} hat reagiert`, body: `${myName()} hat mit ${emoji} auf ${postLabel(post)} reagiert`, to: [post.author], tab: 'board', tag: `react-${id}` });
  }
  mutate('feed', id, (p) => {
    const r = { ...(p.reactions || {}) };
    const s = new Set(r[emoji] || []);
    s.has(state.me) ? s.delete(state.me) : s.add(state.me);
    if (s.size) r[emoji] = [...s]; else delete r[emoji];
    return { ...p, reactions: r };
  });
}
function vote(id, optId) {
  haptic(10);
  mutate('feed', id, (p) => {
    if (p.poll.closed) return p;
    const options = p.poll.options.map((o) => {
      const v = new Set(o.votes || []);
      if (o.id === optId) { v.has(state.me) ? v.delete(state.me) : v.add(state.me); }
      else if (!p.poll.multi) v.delete(state.me);
      return { ...o, votes: [...v] };
    });
    return { ...p, poll: { ...p.poll, options } };
  });
}
function rsvp(id, v) {
  haptic(10);
  mutate('feed', id, (p) => {
    const r = { ...(p.event.rsvp || {}) };
    if (r[state.me] === v) delete r[state.me]; else r[state.me] = v;
    return { ...p, event: { ...p.event, rsvp: r } };
  });
}

function postCard(p, compact = false) {
  const likes = p.likes || [];
  const liked = likes.includes(state.me);
  const comments = p.comments || [];
  const reactions = Object.entries(p.reactions || {}).filter(([, v]) => v.length).sort((a, b) => b[1].length - a[1].length);
  const tag = p.type === 'poll' ? '<span class="type-tag poll">Umfrage</span>' : p.type === 'event' ? '<span class="type-tag event">Ereignis</span>' : p.type === 'voice' ? '<span class="type-tag voice">Sprachnachricht</span>' : '';
  const past = p.type === 'event' && p.event?.date < today();
  let body = '';
  if (p.type === 'poll') body = pollBody(p);
  else if (p.type === 'event') body = eventBody(p);
  else if (p.type === 'voice') body = voiceBody(p);
  else body = `${p.text ? `<div class="post-text">${richText(p.text)}</div>` : ''}${mediaGrid(p)}`;
  const last = comments[comments.length - 1];
  return `<article class="card ${past ? 'past' : ''}" data-post="${p.id}">
    <div class="post-head">
      ${avatar(p.author, 40)}
      <div style="flex:1;min-width:0">
        <div class="who">${esc((member(p.author) ? dn(p.author) : 'Ehemaliges Mitglied'))}</div>
        <div class="meta">${p.pinned ? `<span class="pin-tag">${I.pinned}</span>` : ''}${tag}<span>${relTime(p.createdAt)}</span>${p.editedAt ? '<span>· bearbeitet</span>' : ''}</div>
      </div>
      <button class="icon-btn" data-act="post-menu" data-id="${p.id}" aria-label="Optionen">${I.more}</button>
    </div>
    ${body}
    ${reactions.length ? `<div class="reactions">${reactions.map(([e, v]) =>
      `<button class="reaction ${v.includes(state.me) ? 'mine' : ''}" data-act="react" data-id="${p.id}" data-e="${esc(e)}" title="${esc(v.map(nameOf).join(', '))}"><span class="e">${esc(e)}</span>${v.length}</button>`).join('')}</div>` : ''}
    <div class="post-actions">
      <button class="act ${liked ? 'liked' : ''}" data-act="like" data-id="${p.id}" aria-label="Gefällt mir" title="${esc(likes.map(nameOf).join(', '))}">${liked ? I.heartFill : I.heart}${likes.length || ''}</button>
      <button class="act" data-act="comments" data-id="${p.id}" aria-label="Kommentare">${I.comment}${comments.length || ''}</button>
      <button class="act" data-act="react-pick" data-id="${p.id}" aria-label="Reagieren">${I.smile}</button>
      ${likes.length ? `<span class="spacer"></span><span class="av-stack">${likes.slice(0, 4).map((id) => avatar(id, 24)).join('')}</span>` : ''}
    </div>
    ${!compact && last ? `<button class="last-comment" data-act="comments" data-id="${p.id}">${avatar(last.author, 22)}<span><b>${esc(dn(last.author))}</b>${richText(last.text.slice(0, 120))}${comments.length > 1 ? ` <span class="muted">· alle ${comments.length} ansehen</span>` : ''}</span></button>` : ''}
  </article>`;
}

/* ─── Fotos & Videos ──────────────────────────────────────────────────── */
const ratio = (m) => Math.max(0.75, Math.min(1.9, (m.w || 4) / (m.h || 3))).toFixed(3);
function mediaGrid(p) {
  const m = p.media || [];
  if (!m.length) return '';
  const n = m.length;
  return `<div class="mgrid n${Math.min(n, 4)}" ${p.text ? '' : 'style="margin-top:0"'}>${m.slice(0, 4).map((x, i) => {
    const url = x.kind === 'image' ? cachedURL(x.id) : null;
    return `<button class="mtile ${x.kind}" data-act="media-open" data-id="${p.id}" data-i="${i}" ${n === 1 ? `style="aspect-ratio:${ratio(x)}"` : ''} aria-label="${x.kind === 'video' ? 'Video' : 'Foto'} öffnen">
      ${x.kind === 'image'
        ? `<img alt="" data-media="${x.id}" class="${url ? '' : 'blur'}" src="${esc(url || x.thumb || '')}">`
        : `${x.poster ? `<img alt="" src="${esc(x.poster)}">` : '<span class="vph"></span>'}<span class="vplay">${I.play}</span>${x.dur ? `<span class="vdur">${fmtDur(x.dur)}</span>` : ''}`}
      ${i === 3 && n > 4 ? `<span class="more">+${n - 4}</span>` : ''}
    </button>`;
  }).join('')}</div>`;
}
function findMedia(id) {
  for (const p of [...state.feed, ...state.messages]) for (const m of p.media || []) if (m.id === id) return m;
  return null;
}
function hydrateOne(img) {
  const meta = findMedia(img.dataset.media);
  if (!meta) return;
  loadMediaURL(store, meta).then((u) => { img.src = u; img.classList.remove('blur'); }).catch(() => {});
}
const mediaObserver = 'IntersectionObserver' in window
  ? new IntersectionObserver((entries) => entries.forEach((e) => {
    if (e.isIntersecting) { mediaObserver.unobserve(e.target); hydrateOne(e.target); }
  }), { rootMargin: '400px' })
  : null;
function hydrateMedia() {
  $$('img[data-media].blur').forEach((img) => (mediaObserver ? mediaObserver.observe(img) : hydrateOne(img)));
}

/** Vollbild-Ansicht für Fotos & Videos (wischen, Pfeiltasten, speichern) */
function openViewer(postId, start = 0) {
  const p = state.feed.find((x) => x.id === postId) || state.messages.find((x) => x.id === postId);
  const items = p?.media || [];
  if (!items.length) return;
  let i = Math.min(start, items.length - 1);
  const wrap = document.createElement('div');
  wrap.className = 'viewer';
  wrap.setAttribute('role', 'dialog');
  wrap.setAttribute('aria-modal', 'true');
  wrap.innerHTML = `
    <div class="vbar">
      <button class="vbtn" data-v="close" aria-label="Schließen">${I.close}</button>
      <span class="vcount"></span>
      <a class="vbtn" data-v="save" aria-label="Speichern">${I.download}</a>
    </div>
    <div class="vstage"></div>
    ${items.length > 1 ? `<button class="vbtn vnav prev" data-v="prev" aria-label="Zurück">${I.left}</button><button class="vbtn vnav next" data-v="next" aria-label="Weiter">${I.chev}</button>` : ''}`;
  document.body.appendChild(wrap);
  requestAnimationFrame(() => wrap.classList.add('open'));
  const stage = $('.vstage', wrap);
  const save = $('[data-v=save]', wrap);
  const show = async () => {
    const m = items[i];
    $('.vcount', wrap).textContent = items.length > 1 ? `${i + 1} / ${items.length}` : '';
    save.removeAttribute('href');
    stage.innerHTML = m.kind === 'image'
      ? `<img alt="" class="${cachedURL(m.id) ? '' : 'blur'}" src="${esc(cachedURL(m.id) || m.thumb || '')}">`
      : `<div class="vload">${m.poster ? `<img alt="" src="${esc(m.poster)}">` : ''}<div class="spinner"></div></div>`;
    try {
      const u = await loadMediaURL(store, m);
      if (items[i] !== m || !wrap.isConnected) return;
      if (m.kind === 'image') { const img = $('img', stage); img.src = u; img.classList.remove('blur'); }
      else stage.innerHTML = `<video src="${u}" controls playsinline autoplay></video>`;
      const ext = m.kind === 'image' ? 'jpg' : ((m.mime || '').split('/')[1] || 'mp4').replace('quicktime', 'mov');
      save.href = u;
      save.download = `vermietertagebuch-${m.id}.${ext}`;
    } catch (e) {
      console.error(e);
      if (items[i] === m) stage.innerHTML = '<p class="muted center">Die Datei konnte nicht geladen werden 😕</p>';
    }
  };
  const close = () => {
    $('video', wrap)?.pause();
    wrap.classList.remove('open');
    setTimeout(() => wrap.remove(), 260);
    document.removeEventListener('keydown', key, true);
  };
  const go = (d) => { if (items.length < 2) return; $('video', wrap)?.pause(); i = (i + d + items.length) % items.length; show(); };
  const key = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
    if (e.key === 'ArrowRight') go(1);
    if (e.key === 'ArrowLeft') go(-1);
  };
  document.addEventListener('keydown', key, true);
  wrap.addEventListener('click', (e) => {
    const b = e.target.closest('[data-v]');
    if (!b) { if (e.target === wrap || e.target === stage) close(); return; }
    if (b.dataset.v === 'close') close();
    if (b.dataset.v === 'prev') go(-1);
    if (b.dataset.v === 'next') go(1);
    if (b.dataset.v === 'save' && !b.href) e.preventDefault();
  });
  let x0 = null, y0 = null;
  stage.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
  stage.addEventListener('touchend', (e) => {
    if (x0 == null) return;
    const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? 1 : -1);
    else if (dy > 90 && Math.abs(dy) > Math.abs(dx)) close();
    x0 = null;
  });
  show();
}

/* ─── Sprachnachrichten ─────────────────────────────────────────────────── */
const fmtDur = (sec) => { const x = Math.max(0, Math.round(sec || 0)); return `${Math.floor(x / 60)}:${pad(x % 60)}`; };
const audioCache = new Map();
const player = { audio: null, id: null };

function voiceBody(p) {
  const v = p.voice || {};
  const peaks = v.peaks?.length ? v.peaks : Array(40).fill(0.3);
  const heard = (v.heard || []).filter((id) => id !== p.author);
  return `${p.text ? `<div class="post-text" style="margin-bottom:10px">${richText(p.text)}</div>` : ''}
    <div class="voice" data-voice="${p.id}">
      <button class="play" data-act="voice-play" data-id="${p.id}" aria-label="Abspielen/Pause">${I.play}</button>
      <div class="wave" data-id="${p.id}" role="slider" aria-label="Spulen" tabindex="0">${peaks.map((h) => `<i style="--h:${Math.max(0.12, h).toFixed(2)}"></i>`).join('')}</div>
      <span class="dur">${fmtDur(v.duration)}</span>
    </div>
    ${heard.length ? `<div class="small muted" style="margin-top:6px">🎧 Gehört von ${heard.map((id) => (id === state.me ? 'dir' : esc(nameOf(id)))).join(', ')}</div>` : ''}`;
}

function updateVoiceUI() {
  $$('[data-voice]').forEach((el) => {
    const id = el.dataset.voice;
    if (scrub && el.contains(scrub.el)) return;
    const p = state.feed.find((x) => x.id === id) || state.messages.find((x) => x.id === id);
    const a = player.id === id ? player.audio : null;
    const playing = !!a && !a.paused;
    el.classList.toggle('playing', playing);
    const btn = $('.play', el);
    const want = playing ? 'pause' : 'play';
    if (btn.dataset.icon !== want) { btn.innerHTML = I[want]; btn.dataset.icon = want; }
    const total = (a && isFinite(a.duration) && a.duration > 0 ? a.duration : p?.voice?.duration) || 1;
    const t = a ? a.currentTime : 0;
    const bars = $$('.wave i', el);
    const n = Math.round((t / total) * bars.length);
    bars.forEach((b, i) => b.classList.toggle('on', i < n));
    $('.dur', el).textContent = a ? fmtDur(t) : fmtDur(p?.voice?.duration);
  });
}

function stopVoice() {
  if (player.audio) { player.audio.pause(); player.audio.src = ''; }
  player.audio = null; player.id = null;
  updateVoiceUI();
}

async function playVoice(id, frac = null) {
  const col = state.feed.some((x) => x.id === id) ? 'feed' : 'messages';
  const p = state[col].find((x) => x.id === id);
  if (!p?.voice) return;
  if (player.id === id && player.audio) {
    const a = player.audio;
    if (frac != null) { a.currentTime = frac * (isFinite(a.duration) ? a.duration : p.voice.duration); if (a.paused) a.play(); }
    else if (a.paused) a.play(); else a.pause();
    return;
  }
  stopVoice();
  const el = $(`[data-voice="${id}"]`);
  el?.classList.add('loading');
  let src = audioCache.get(p.voice.audioId);
  if (!src) {
    const doc = await store.get('audio', p.voice.audioId).catch(() => null);
    el?.classList.remove('loading');
    if (!doc) return toast('Sprachnachricht nicht gefunden 🤔');
    src = doc.data;
    audioCache.set(p.voice.audioId, src);
  }
  const a = new Audio(src);
  player.audio = a; player.id = id;
  a.ontimeupdate = a.onplay = a.onpause = updateVoiceUI;
  a.onended = () => { player.audio = null; player.id = null; updateVoiceUI(); };
  a.onerror = () => { if (player.audio === a) { toast('⚠️ Dieses Audioformat kann dein Gerät leider nicht abspielen', 4000); stopVoice(); } };
  if (frac != null) a.addEventListener('loadedmetadata', () => { a.currentTime = frac * (isFinite(a.duration) ? a.duration : p.voice.duration); }, { once: true });
  try { await a.play(); } catch (e) { console.error(e); }
  if (p.author !== state.me && !(p.voice.heard || []).includes(state.me)) {
    mutate(col, id, (x) => ({ ...x, voice: { ...x.voice, heard: [...new Set([...(x.voice.heard || []), state.me])] } }));
  }
}

/* Spulen: auf der Wellenform tippen oder ziehen (Finger/Maus), Pfeiltasten ±5 s */
let scrub = null;
const waveFrac = (el, x) => { const r = el.getBoundingClientRect(); return Math.max(0, Math.min(1, (x - r.left) / r.width)); };
function voiceTotal(id) {
  const p = state.feed.find((x) => x.id === id) || state.messages.find((x) => x.id === id);
  const a = player.id === id ? player.audio : null;
  return (a && isFinite(a.duration) && a.duration > 0 ? a.duration : p?.voice?.duration) || 1;
}
function showScrub(el, frac) {
  const bars = $$('i', el);
  const n = Math.round(frac * bars.length);
  bars.forEach((b, i) => b.classList.toggle('on', i < n));
  const dur = $('.dur', el.closest('.voice'));
  if (dur) dur.textContent = fmtDur(frac * voiceTotal(el.dataset.id));
}
document.addEventListener('pointerdown', (e) => {
  const w = e.target.closest('.wave[data-id]');
  if (!w || (e.pointerType === 'mouse' && e.button !== 0)) return;
  scrub = { el: w, id: e.pointerId, frac: waveFrac(w, e.clientX) };
  try { w.setPointerCapture(e.pointerId); } catch { /* egal */ }
  w.classList.add('scrubbing');
  showScrub(w, scrub.frac);
});
document.addEventListener('pointermove', (e) => {
  if (!scrub || e.pointerId !== scrub.id) return;
  scrub.frac = waveFrac(scrub.el, e.clientX);
  showScrub(scrub.el, scrub.frac);
});
const endScrub = (e) => {
  if (!scrub || e.pointerId !== scrub.id) return;
  const { el, frac } = scrub;
  scrub = null;
  el.classList.remove('scrubbing');
  if (e.type === 'pointerup') playVoice(el.dataset.id, frac);
};
document.addEventListener('pointerup', endScrub);
document.addEventListener('pointercancel', endScrub);
document.addEventListener('keydown', (e) => {
  const w = e.target.closest?.('.wave[data-id]');
  if (!w || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
  e.preventDefault();
  const id = w.dataset.id, total = voiceTotal(id);
  const cur = player.id === id && player.audio ? player.audio.currentTime : 0;
  playVoice(id, Math.max(0, Math.min(1, (cur + (e.key === 'ArrowRight' ? 5 : -5)) / total)));
});

const blobToDataURL = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });

/** Aufnahme-Steuerung im Erstellen-Sheet */
function setupRecorder(root) {
  const btn = $('#r-btn', root), time = $('#rt', root), hint = $('#r-hint', root);
  const playBtn = $('#r-play', root), discard = $('#r-del', root), bars = $$('#rw i', root);
  const MAX_BYTES = 650_000, MAX_SEC = 180;
  const mime = ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']
    .find((m) => window.MediaRecorder?.isTypeSupported?.(m)) || '';
  let mr = null, stream = null, ctx = null, raf = 0, t0 = 0, levels = [], chunks = [], size = 0, result = null, preview = null;

  const draw = (arr) => {
    const last = arr.slice(-bars.length);
    const off = bars.length - last.length;
    bars.forEach((b, i) => b.style.setProperty('--h', (i >= off ? Math.max(0.1, Math.min(1, last[i - off])) : 0.1).toFixed(2)));
  };
  const setPreviewIcon = (playing) => { playBtn.innerHTML = playing ? I.pause : I.play; };

  async function start() {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return toast('Dein Browser unterstützt leider keine Sprachaufnahmen', 4000);
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch { return toast('🎤 Kein Mikrofon-Zugriff – bitte in den Einstellungen erlauben', 4500); }
    preview?.pause();
    chunks = []; size = 0; levels = []; result = null;
    root.classList.remove('has');
    playBtn.hidden = discard.hidden = true;
    const opts = { audioBitsPerSecond: 32000 };
    if (mime) opts.mimeType = mime;
    mr = new MediaRecorder(stream, opts);
    mr.ondataavailable = (e) => {
      if (!e.data.size) return;
      chunks.push(e.data); size += e.data.size;
      if (size > MAX_BYTES && mr.state === 'recording') { stop(); toast('Maximale Länge erreicht'); }
    };
    mr.onstop = finish;
    mr.start(400);
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      const an = ctx.createAnalyser();
      an.fftSize = 1024;
      ctx.createMediaStreamSource(stream).connect(an);
      const buf = new Uint8Array(an.fftSize);
      let lastPush = 0;
      const loop = (ts) => {
        an.getByteTimeDomainData(buf);
        let sum = 0;
        for (const x of buf) { const d = (x - 128) / 128; sum += d * d; }
        if (ts - lastPush > 90) { levels.push(Math.min(1, Math.sqrt(sum / buf.length) * 5)); lastPush = ts; draw(levels); }
        const sec = (performance.now() - t0) / 1000;
        time.textContent = fmtDur(sec);
        if (sec >= MAX_SEC) { stop(); return; }
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    } catch (e) { console.error(e); }
    t0 = performance.now();
    root.classList.add('recording');
    btn.setAttribute('aria-label', 'Aufnahme beenden');
    hint.textContent = 'Aufnahme läuft … tippen zum Beenden';
    haptic(15);
  }
  function stop() {
    if (mr && mr.state !== 'inactive') mr.stop();
    cancelAnimationFrame(raf);
    stream?.getTracks().forEach((t) => t.stop());
    ctx?.close().catch(() => {});
    ctx = null; stream = null;
    root.classList.remove('recording');
    btn.setAttribute('aria-label', 'Neu aufnehmen');
    haptic(10);
  }
  function finish() {
    const duration = (performance.now() - t0) / 1000;
    if (duration < 0.8 || !chunks.length) { hint.textContent = 'Zu kurz – halte die Aufnahme etwas länger 🙂'; time.textContent = '0:00'; draw([]); return; }
    const blob = new Blob(chunks, { type: mr.mimeType || mime || 'audio/webm' });
    const n = 40, peaks = [];
    for (let i = 0; i < n; i++) {
      const sl = levels.slice(Math.floor((i * levels.length) / n), Math.floor(((i + 1) * levels.length) / n));
      peaks.push(sl.length ? Math.max(...sl) : 0);
    }
    const mx = Math.max(0.05, ...peaks);
    const norm = peaks.map((v) => +(v / mx).toFixed(2));
    result = { blob, duration: Math.round(duration * 10) / 10, peaks: norm, mime: blob.type };
    bars.forEach((b, i) => b.style.setProperty('--h', Math.max(0.12, norm[i]).toFixed(2)));
    time.textContent = fmtDur(duration);
    hint.textContent = 'Fertig! Anhören, neu aufnehmen oder veröffentlichen.';
    playBtn.hidden = discard.hidden = false;
    setPreviewIcon(false);
    root.classList.add('has');
  }
  playBtn.onclick = () => {
    if (!result) return;
    if (!preview) {
      preview = new Audio(URL.createObjectURL(result.blob));
      preview.onended = preview.onpause = () => setPreviewIcon(false);
      preview.onplay = () => setPreviewIcon(true);
    }
    if (preview.paused) preview.play().catch(() => {}); else preview.pause();
  };
  discard.onclick = () => {
    preview?.pause(); preview = null; result = null;
    draw([]); time.textContent = '0:00';
    playBtn.hidden = discard.hidden = true;
    root.classList.remove('has');
    hint.textContent = 'Tippe auf den Knopf, um aufzunehmen';
  };
  // Neue Aufnahme → alte Vorschau verwerfen
  const origStart = start;
  btn.onclick = () => { if (mr?.state === 'recording') stop(); else { preview?.pause(); preview = null; origStart(); } };
  return { get: () => result, cleanup: () => { stop(); preview?.pause(); } };
}

function pollBody(p) {
  const opts = p.poll.options || [];
  const total = new Set(opts.flatMap((o) => o.votes || [])).size;
  const max = Math.max(1, ...opts.map((o) => (o.votes || []).length));
  return `<div class="poll-q">${esc(p.poll.question)}</div>
    ${opts.map((o) => {
      const v = o.votes || [];
      const pct = total ? Math.round((v.length / total) * 100) : 0;
      const mine = v.includes(state.me);
      return `<button class="poll-opt ${mine ? 'mine' : ''} ${p.poll.closed ? 'closed' : ''}" data-act="vote" data-id="${p.id}" data-opt="${o.id}" style="--p:${total ? (v.length / max) * 100 : 0}%">
        <span class="fill"></span><span class="tick">${mine ? I.check : ''}</span>
        <span class="txt">${esc(o.text)}</span>
        ${v.length ? `<span class="av-stack">${v.slice(0, 3).map((id) => avatar(id, 22)).join('')}</span>` : ''}
        <span class="pct">${pct}%</span></button>`;
    }).join('')}
    <div class="small muted">${plural(total, 'Stimme', 'Stimmen')}${p.poll.multi ? ' · Mehrfachauswahl' : ''}${p.poll.closed ? ' · <b>Beendet</b>' : ''}</div>`;
}

function eventBody(p) {
  const e = p.event;
  const r = e.rsvp || {};
  const who = (v) => Object.keys(r).filter((k) => r[k] === v);
  const btn = (v, label, emoji) => {
    const list = who(v);
    return `<button class="${v} ${r[state.me] === v ? 'on' : ''}" data-act="rsvp" data-id="${p.id}" data-v="${v}"><span>${emoji} ${label}</span>${list.length ? `<span class="av-stack">${list.slice(0, 4).map((id) => avatar(id, 20)).join('')}</span>` : '<span class="small muted">–</span>'}</button>`;
  };
  return `<div class="event">
      <div class="date-block"><div class="m">${fmt(e.date, { month: 'short' }).replace('.', '')}</div><div class="d">${parseISO(e.date).getDate()}</div><div class="w">${fmt(e.date, { weekday: 'short' }).replace('.', '')}</div></div>
      <div style="flex:1;min-width:0">
        <div class="event-title">${esc(e.title)}</div>
        <div class="event-meta">
          <span>${I.cal}${esc(fmtDay(e.date))}${e.time ? `, ${esc(e.time)}${e.endTime ? `–${esc(e.endTime)}` : ''} Uhr` : ''}</span>
          ${e.location ? `<span>${I.pin}${esc(e.location)}</span>` : ''}
        </div>
      </div>
    </div>
    ${e.desc ? `<div class="post-text" style="margin-top:10px">${esc(e.desc)}</div>` : ''}
    <div class="rsvp">${btn('yes', 'Dabei', '✅')}${btn('maybe', 'Vielleicht', '🤔')}${btn('no', 'Nicht dabei', '❌')}</div>`;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Ansichten
   ═══════════════════════════════════════════════════════════════════════════ */

/* ─── „Neues“: Ankündigungen auf der Startseite ──────────────────────────────
   Neuen Eintrag oben einfügen → die Kachel zeigt immer den neuesten. */
const NEWS = [
  {
    id: '2026-11-13-fixes-2',
    date: '2026-11-13',
    label: '🛠️ Bug-Fixes',
    items: [
      { icon: '🫳', title: 'Gedrückt halten', text: 'Nachricht im Chat gedrückt halten öffnet ein kompaktes Menü: reagieren, antworten, kopieren, löschen.' },
      { icon: '↪️', title: 'Zur zitierten Nachricht', text: 'Eine Antwort antippen springt direkt zur Nachricht, auf die geantwortet wurde.' },
      { icon: '🏷️', title: 'Spitznamen', text: 'Im Profil einer Person einen eigenen Spitznamen speichern – nur du siehst ihn.', act: 'tab', v: 'house', btn: 'Zu den Mitbewohner:innen' },
    ],
  },
  {
    id: '2026-11-13-fixes',
    date: '2026-11-13',
    label: '🛠️ Bug-Fixes',
    items: [
      { icon: '⏩', title: 'Sprachnachrichten spulen', text: 'Auf der Tonspur tippen oder mit dem Finger ziehen – vor und zurück, wie du willst.' },
      { icon: '↩️', title: 'Antworten per Wischen', text: 'Im Privatchat eine Nachricht nach rechts wischen, um direkt darauf zu antworten.' },
      { icon: '😍', title: 'Reaktionen & Medien im Chat', text: 'Nachricht antippen und mit Emoji reagieren – und schickt euch jetzt auch Fotos und Videos.', act: 'dms', btn: 'Nachrichten öffnen' },
    ],
  },
  {
    id: '2026-11-13-dm',
    date: '2026-11-13',
    items: [
      { icon: '💬', title: 'Privatnachrichten', text: 'Schreibt euch privat – mit Text oder Sprachnachricht. Nur ihr beide seht den Chat.', act: 'dms', btn: 'Nachrichten öffnen' },
      { icon: '📋', title: 'Aufgaben zuteilen', text: 'Im Chat mit ☑️ eine Aufgabe für dein Gegenüber anlegen – sie kann direkt dort abgehakt werden.' },
      { icon: '🏠', title: 'Wer wohnt wo?', text: 'Unter „Haus“ seht ihr alle nach Stockwerk – vom 1. OG bis in den Keller.', act: 'tab', v: 'house', btn: 'Ansehen' },
    ],
  },
];
function newsCard() {
  const n = NEWS[0];
  if (!n) return '';
  return `<section class="card news-card">
    <div class="news-head"><span class="news-badge">${esc(n.label || '✨ Neu')}</span><h2>Neues</h2><span class="small muted">${esc(fmt(n.date, { day: 'numeric', month: 'long' }))}</span></div>
    <div class="news-list">${n.items.map((it) => `<div class="news-item"><span class="news-ico">${it.icon}</span>
      <div class="main"><div class="title">${esc(it.title)}</div><div class="small muted">${esc(it.text)}</div>
      ${it.act ? `<button class="link news-btn" data-act="${it.act}" ${it.v ? `data-v="${it.v}"` : ''}>${esc(it.btn)} ›</button>` : ''}</div></div>`).join('')}</div>
  </section>`;
}

const VIEWS = {
  home() {
    const m = me();
    const mine = myOpenTasks().sort(sortTasks);
    const overdue = openTasks().filter((t) => t.due && t.due < today());
    const todayCount = openTasks().filter((t) => t.due === today()).length;
    const next = pickups(today(), addDays(today(), 60), 'mine');
    const nextDate = next.find((p) => !p.done)?.date;
    const nextGroup = nextDate ? next.filter((p) => p.date === nextDate) : [];
    const soon = nextDate && daysBetween(today(), nextDate) <= 1;
    const events = upcomingEvents().slice(0, 3);
    const polls = openPollsForMe().slice(0, 2);
    const posts = feedSorted().filter((p) => p.type === 'post' || p.type === 'voice').slice(0, 2);
    const people = membersSorted();
    const maxLoad = Math.max(1, ...people.map((p) => openTasks().filter((t) => t.assignee === p.id).length));

    return `${header(fmtLong(today()), `${greeting()}, ${esc(m?.name || '')} ${esc(m?.emoji || '👋')}`)}
      ${localBanner()}
      ${newsCard()}
      <div class="kpis">
        <button class="kpi card" data-act="goto-tasks" data-v="mine"><div class="n">${mine.length}</div><div class="l">Für dich offen</div></button>
        <button class="kpi card" data-act="goto-tasks" data-v="all"><div class="n">${todayCount}</div><div class="l">Heute fällig</div></button>
        <button class="kpi card ${overdue.length ? 'red' : ''}" data-act="goto-tasks" data-v="all"><div class="n">${overdue.length}</div><div class="l">Überfällig</div></button>
      </div>
      <div class="home-grid"><div>
      <h2 class="section-title">Nächste Abholung <button class="link" data-act="tab" data-v="trash">Plan</button></h2>
      ${nextGroup.length ? `<div class="card hero-trash ${soon ? 'soon' : ''}">
        ${nextGroup.map((p, i) => `<div class="next-pickup" ${i ? 'style="margin-top:16px"' : ''}>
          ${binIcon(p.bin, true)}
          <div style="flex:1;min-width:0">
            ${i === 0 ? `<div class="when">${esc(fmtDay(p.date))}</div>` : ''}
            <div style="font-weight:700">${esc(p.bin.name)}</div>
            <div class="small muted bin-who">${binWhoHtml(p)}${soon && !p.done ? ' · am Vorabend rausstellen' : ''}</div>
          </div>
        </div>${confirmBox(p)}`).join('')}
      </div>` : `<div class="card empty"><div class="big">🗑️</div>Noch kein Abholplan. <br><button class="btn sm primary" style="margin-top:12px" data-act="tab" data-v="trash">Müllplan einrichten</button></div>`}

      <h2 class="section-title">Deine Aufgaben <button class="link" data-act="goto-tasks" data-v="mine">Alle</button></h2>
      ${mine.length ? `<div class="list card tight">${mine.slice(0, 5).map(taskRow).join('')}</div>`
        : `<div class="card empty"><div class="big">🎉</div>Alles erledigt – gönn dir was!</div>`}

      <h2 class="section-title">Wer hat was zu tun?</h2>
      <div class="people">${people.map((p) => {
        const n = openTasks().filter((t) => t.assignee === p.id).length;
        const od = openTasks().filter((t) => t.assignee === p.id && t.due && t.due < today()).length;
        return `<button class="person card" data-act="goto-person" data-id="${p.id}">
          <div class="row">${avatar(p.id, 34)}<div class="name">${esc(dn(p.id))}</div></div>
          <div class="stat">${plural(n, 'offene Aufgabe', 'offene Aufgaben')}${od ? ` · <span style="color:var(--danger)">${od} überfällig</span>` : ''}</div>
          <div class="stat">${p.id === state.me ? '<span class="presence">Das bist du</span>' : presenceText(p.id) || '<span class="presence">–</span>'}</div>
          <div class="meter"><i style="width:${(n / maxLoad) * 100}%"></i></div></button>`;
      }).join('')}</div>
      </div><div>

      ${polls.length ? `<h2 class="section-title">Deine Stimme fehlt <button class="link" data-act="goto-feed" data-v="poll">Umfragen</button></h2>${polls.map((p) => postCard(p, true)).join('')}` : ''}

      <h2 class="section-title">Demnächst <button class="link" data-act="goto-feed" data-v="event">Ereignisse</button></h2>
      ${events.length ? `<div class="list card tight">${events.map((p) => `
        <button class="list-item" data-act="goto-feed" data-v="event">
          <div class="date-block" style="width:46px"><div class="m">${fmt(p.event.date, { month: 'short' }).replace('.', '')}</div><div class="d" style="font-size:19px;padding-bottom:4px">${parseISO(p.event.date).getDate()}</div></div>
          <div class="main"><div class="title">${esc(p.event.title)}</div><div class="sub">${esc(fmtDay(p.event.date))}${p.event.time ? `, ${esc(p.event.time)} Uhr` : ''}${p.event.location ? ` · ${esc(p.event.location)}` : ''}</div></div>
          <span class="av-stack">${Object.keys(p.event.rsvp || {}).filter((k) => p.event.rsvp[k] === 'yes').slice(0, 3).map((id) => avatar(id, 22)).join('')}</span>
        </button>`).join('')}</div>`
        : `<div class="card empty"><div class="big">📅</div>Nichts geplant. <button class="link" style="color:var(--accent);font-weight:650" data-act="compose" data-v="event">Ereignis erstellen</button></div>`}

      <h2 class="section-title">Social Hub <button class="link" data-act="tab" data-v="board">Alle</button></h2>
      ${posts.length ? posts.map((p) => postCard(p)).join('') : `<button class="card compose-prompt" data-act="compose" data-v="post">${avatar(state.me, 36)}<span class="fake-input">Schreib etwas an alle …</span></button>`}
      </div></div>`;
  },

  tasks() {
    const people = membersSorted();
    let list = state.taskView === 'open' ? openTasks() : state.tasks.filter((t) => t.done);
    const fp = state.taskPerson;
    if (fp === 'mine') list = list.filter((t) => t.assignee === state.me || !t.assignee);
    else if (fp === 'none') list = list.filter((t) => !t.assignee);
    else if (fp !== 'all') list = list.filter((t) => t.assignee === fp);
    const chip = (v, label, count, av) => `<button class="chip chip-glass ${av ? '' : 'no-av'} ${fp === v ? 'on' : ''}" data-act="task-person" data-v="${v}">${av || ''}${label}${count != null ? `<span class="count">${count}</span>` : ''}</button>`;
    const cnt = (f) => openTasks().filter(f).length;

    let content = '';
    if (state.taskView === 'open') {
      const t0 = today(), w = addDays(t0, 7);
      const groups = [
        ['Überfällig', list.filter((t) => t.due && t.due < t0), 'danger'],
        ['Heute', list.filter((t) => t.due === t0)],
        ['Nächste 7 Tage', list.filter((t) => t.due > t0 && t.due <= w)],
        ['Später', list.filter((t) => t.due > w)],
        ['Ohne Datum', list.filter((t) => !t.due)],
      ];
      content = groups.filter(([, l]) => l.length).map(([label, l, cls]) =>
        `<div class="group-label ${cls || ''}">${label} · ${l.length}</div><div class="list card tight">${l.sort(sortTasks).map(taskRow).join('')}</div>`).join('');
      if (!list.length) content = `<div class="card empty"><div class="big">✨</div>Keine offenen Aufgaben${fp !== 'all' ? ' in diesem Filter' : ''}.<br><button class="btn sm primary" style="margin-top:12px" data-act="task-new">${I.plus}Aufgabe anlegen</button></div>`;
    } else {
      list.sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
      content = list.length ? `<div class="list card tight">${list.slice(0, 60).map(taskRow).join('')}</div>
        <div class="center" style="margin-top:14px"><button class="btn sm danger" data-act="tasks-clear">Erledigte aufräumen</button></div>`
        : `<div class="card empty"><div class="big">📭</div>Noch nichts erledigt.</div>`;
    }

    return `${header(`${openTasks().length} offen`, 'Aufgaben')}
      ${segmented([['open', 'Offen'], ['done', 'Erledigt']], state.taskView, 'task-view')}
      <div class="chips">
        ${chip('all', 'Alle', state.taskView === 'open' ? openTasks().length : null)}
        ${chip('mine', 'Meine', state.taskView === 'open' ? myOpenTasks().length : null)}
        ${people.filter((p) => p.id !== state.me).map((p) => chip(p.id, esc(dn(p.id)), state.taskView === 'open' ? cnt((t) => t.assignee === p.id) : null, avatar(p.id, 24))).join('')}
        ${chip('none', '👥 Für alle', state.taskView === 'open' ? cnt((t) => !t.assignee) : null)}
      </div>
      ${content}`;
  },

  trash() {
    const from = today();
    const scope = state.binScope;
    const list = pickups(from, addDays(from, 42), scope);
    const byDate = {};
    list.forEach((p) => (byDate[p.date] ||= []).push(p));

    // Monatskalender
    const cm = state.calMonth || from.slice(0, 7);
    const first = parseISO(cm + '-01');
    const startOffset = (first.getDay() + 6) % 7;
    const gridStart = addDays(iso(first), -startOffset);
    const monthEnd = iso(new Date(first.getFullYear(), first.getMonth() + 1, 0));
    const gridDays = Math.ceil((startOffset + parseISO(monthEnd).getDate()) / 7) * 7;
    const calPick = pickups(gridStart, addDays(gridStart, gridDays), scope);
    const calEv = state.feed.filter((p) => p.type === 'event');
    const cells = [];
    for (let i = 0; i < gridDays; i++) {
      const d = addDays(gridStart, i);
      const ps = calPick.filter((p) => p.date === d);
      const ev = calEv.filter((p) => p.event?.date === d);
      const dots = [...ps.map((p) => binColorFor(p.bin)), ...ev.map(() => '#ff3b30')].slice(0, 4);
      cells.push(`<div class="cal-day ${d.slice(0, 7) !== cm ? 'out' : ''} ${d === from ? 'today' : ''} ${dots.length ? 'has' : ''}" data-act="cal-day" data-v="${d}" role="button" aria-label="${esc(fmtLong(d))}">
        <span>${parseISO(d).getDate()}</span><span class="dots">${dots.map((c) => `<i style="--c:${esc(c)}"></i>`).join('')}</span></div>`);
    }
    const monthName = new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric' }).format(first);

    return `${header('Abholplan', 'Müllabfuhr')}
      ${state.trash.length ? segmented([['mine', 'Für mich'], ['all', 'Ganzes Haus']], scope, 'bin-scope') : ''}
      ${notifyCard()}
      ${state.trash.length ? '' : `<div class="card empty"><div class="big">🗑️</div><h3>Noch keine Tonnen</h3><p class="muted" style="margin-bottom:14px">Lade den Abfallkalender eurer Stadt hoch (.ics) oder lege eure Tonnen von Hand an.</p>
        <div class="row wrap" style="justify-content:center"><button class="btn sm primary" data-act="ics-import">${I.upload}Abfallkalender hochladen</button><button class="btn sm" data-act="bin-new">${I.plus}Tonne anlegen</button></div></div>`}

      ${state.trash.length ? `<h2 class="section-title">Die nächsten 6 Wochen</h2>
      ${Object.keys(byDate).length ? Object.entries(byDate).map(([d, ps]) => `
        <div class="group-label">${esc(fmtDay(d))}${daysBetween(from, d) > 1 && daysBetween(from, d) < 7 ? ` · ${fmt(d, { day: 'numeric', month: 'long' })}` : ''}</div>
        <div class="list card tight">${ps.map((p) => `
          <div class="list-item">
            ${binIcon(p.bin)}
            <div class="main"><div class="title">${esc(p.bin.name)}</div>
              <div class="sub bin-who">${binWhoHtml(p)}${p.who && (p.bin.members || []).length ? ` · für ${esc(binFor(p.bin))}` : ''}</div></div>
          </div>
          <div class="confirm-row">${confirmBox(p)}</div>`).join('')}</div>`).join('') : `<div class="card empty">Keine Termine in den nächsten 6 Wochen.</div>`}` : ''}

      <h2 class="section-title">Kalender <span class="small muted" style="font-weight:500">Tag antippen zum Anlegen</span></h2>
      <div class="card cal">
        <div class="cal-head">
          <button class="icon-btn" data-act="cal-move" data-v="-1" aria-label="Vorheriger Monat">${I.left}</button>
          <strong>${esc(monthName)}</strong>
          <button class="icon-btn" data-act="cal-move" data-v="1" aria-label="Nächster Monat">${I.chev}</button>
        </div>
        <div class="cal-grid">${['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((w) => `<div class="wd">${w}</div>`).join('')}${cells.join('')}</div>
      </div>

      ${state.trash.length ? `<h2 class="section-title">Tonnen <button class="link" data-act="bin-new">Hinzufügen</button></h2>
      ${`<div class="list card tight">${[...state.trash].filter((b) => scope === 'all' || binAppliesTo(b, state.me)).sort((a, b) => a.name.localeCompare(b.name)).map((b) => `
        <button class="list-item" data-act="bin-edit" data-id="${b.id}">
          ${binIcon(b)}
          <div class="main"><div class="title">${esc(b.name)}</div><div class="sub">${esc(binSchedule(b))} · für ${esc(binFor(b))}${b.rotationSet && (b.rotation || []).filter(member).length ? ` · reihum: ${b.rotation.filter(member).map((id) => esc(dn(id))).join(' → ')}` : ''}${b.importedBy ? ` · Kalender von ${esc(nameOf(b.importedBy))}` : ''}</div></div>
          <span class="chev">${I.chev}</span>
        </button>`).join('')}</div>`}

      <div class="row wrap" style="margin-top:14px;justify-content:center">
        <button class="btn sm chip-glass" data-act="ics-import">${I.upload}Abfallkalender hochladen (.ics)</button>
        <button class="btn sm chip-glass" data-act="ics-export">${I.cal}In meinen Kalender exportieren</button>
      </div>` : ''}`;
  },

  board() {
    let list = feedSorted();
    if (state.feedFilter !== 'all') list = list.filter((p) => p.type === state.feedFilter || (state.feedFilter === 'post' && p.type === 'voice'));
    return `${header(state.house?.name || 'Hausgemeinschaft', 'Social Hub')}
      ${segmented([['all', 'Alle'], ['post', 'Beiträge'], ['poll', 'Umfragen'], ['event', 'Ereignisse']], state.feedFilter, 'feed-filter')}
      <div class="card compose-prompt" style="margin-bottom:12px">
        ${avatar(state.me, 36)}
        <button class="fake-input" data-act="compose" data-v="${state.feedFilter === 'all' ? 'post' : state.feedFilter}">${state.feedFilter === 'poll' ? 'Neue Umfrage starten …' : state.feedFilter === 'event' ? 'Neues Ereignis planen …' : 'Was gibt\'s Neues im Haus?'}</button>
        <button class="mic-btn" data-act="compose" data-v="photo" aria-label="Foto oder Video posten">${I.photo}</button>
        <button class="mic-btn" data-act="compose" data-v="voice" aria-label="Sprachnachricht aufnehmen">${I.mic}</button>
      </div>
      <div class="stack">${list.length ? list.map((p) => postCard(p)).join('') : `<div class="card empty"><div class="big">📌</div>Hier ist noch nichts. Mach den Anfang!</div>`}</div>`;
  },

  house() {
    const people = membersSorted();
    const mode = store?.mode === 'cloud' ? 'Cloud – alle sehen dasselbe' : 'Lokal – nur dieses Gerät';
    const theme = LS.get('theme', 'auto');
    return `${header('Einstellungen', esc(state.house?.name || 'Unser Haus'))}
      ${localBanner()}
      <h2 class="section-title" style="margin-top:6px">Mitbewohner:innen <button class="link" data-act="member-new">Hinzufügen</button></h2>
      ${byFloor(people).map(([label, list]) => `<div class="group-label floor-label">${esc(label)} · ${list.length}</div>
      <div class="list card tight">${list.map((p) => {
        const open = openTasks().filter((t) => t.assignee === p.id).length;
        const done = state.tasks.filter((t) => t.doneBy === p.id).length + state.tasks.reduce((n, t) => n + (t.history || []).filter((h) => h.by === p.id).length, 0);
        return `<div class="list-item member-row">
          <button class="main" data-act="member-edit" data-id="${p.id}">
            ${avatar(p.id, 40)}
            <span class="txt"><div class="title">${esc(dn(p.id))}${nickOf(p.id) ? ` <span class="floor-tag">${esc(p.name)}</span>` : ''}${p.id === state.me ? ' <span class="pill blue">Du</span>' : ''}</div>
            ${presenceText(p.id) ? `<div class="sub">${presenceText(p.id)}</div>` : ''}<div class="sub">${plural(open, 'offene Aufgabe', 'offene Aufgaben')} · ${done} erledigt</div></span>
          </button>
          ${p.id !== state.me ? `<button class="icon-btn" data-act="dm-open" data-id="${p.id}" aria-label="Nachricht an ${esc(dn(p.id))}">${I.dm}${dmUnread(p.id) ? `<b class="badge">${dmUnread(p.id)}</b>` : ''}</button>` : ''}
        </div>`;
      }).join('')}</div>`).join('')}

      <h2 class="section-title">Einladen</h2>
      <div class="card">
        <p class="muted small" style="margin-bottom:10px">${store?.mode === 'cloud'
          ? 'Schick den Link an deine Mitbewohner:innen. Sie öffnen ihn und wählen ihr Profil – fertig.'
          : 'Zum Einladen muss zuerst die Synchronisierung eingerichtet werden. Danach funktioniert der Link auf allen Geräten.'}</p>
        <div class="code">${esc(state.hid)}</div>
        <div class="row" style="margin-top:12px">
          <button class="btn block" data-act="copy-invite">${I.copy}Link kopieren</button>
          ${navigator.share ? `<button class="btn block primary" data-act="share-invite">${I.share}Teilen</button>` : ''}
        </div>
      </div>

      <h2 class="section-title">Darstellung</h2>
      ${segmented([['auto', 'Automatisch'], ['light', 'Hell'], ['dark', 'Dunkel']], theme, 'theme')}
      <div class="label" style="margin:14px 6px 8px">Farbschema</div>
      ${paletteHtml()}

      <h2 class="section-title">Privatsphäre</h2>
      ${toggle('pres-on', '🟢 Online-Status anzeigen', !presenceHidden())}
      <p class="small muted" style="margin:-4px 6px 0">Wenn aus, sehen die anderen nicht, ob du gerade online bist oder wann du zuletzt da warst. Gilt für alle deine Geräte.</p>

      <h2 class="section-title">Daten</h2>
      <div class="menu-list">
        <button data-act="notify">${I.bell}<span>Mitteilungen<span class="desc">${notifyPrefs().enabled ? 'An – Aufgaben, Social Hub, Müll' : 'Aus'}</span></span></button>
        <button data-act="cloud">${I.cloud}<span>Synchronisierung<span class="desc">${esc(mode)}</span></span></button>
        <button data-act="house-rename">${I.pen}<span>Haus umbenennen</span></button>
        <button data-act="export">${I.download}<span>Backup herunterladen<span class="desc">Alle Daten als JSON-Datei</span></span></button>
        <button data-act="import">${I.upload}<span>Backup wiederherstellen</span></button>
        <button data-act="switch-user">${I.user}<span>Profil wechseln<span class="desc">Angemeldet als ${esc(me()?.name || '–')}</span></span></button>
        <button class="danger" data-act="leave">${I.door}<span>Haus auf diesem Gerät verlassen</span></button>
      </div>
      <p class="center small muted" style="margin-top:22px">Vermietertagebuch · mit 💜 für eure Hausgemeinschaft</p>`;
  },
};


/* ═══════════════════════════════════════════════════════════════════════════
   Stockwerke
   ═══════════════════════════════════════════════════════════════════════════ */
const FLOORS = [['dg', 'Dachgeschoss'], ['og2', '2. Obergeschoss'], ['og1', '1. Obergeschoss'], ['eg', 'Erdgeschoss'], ['keller', 'Keller']];
const floorName = (f) => FLOORS.find(([k]) => k === f)?.[1] || '';
// Erstbelegung: wer wo wohnt (nur solange bei einer Person noch nie ein Stockwerk gespeichert war)
const FLOOR_SEED = { julia: 'keller', robert: 'keller', susanne: 'eg', nico: 'og1', flo: 'og1', florian: 'og1' };
function seedFloors() {
  if (!state.synced.has('members')) return;
  state.members.forEach((m) => {
    if (m.floor !== undefined) return;
    const f = FLOOR_SEED[String(m.name || '').trim().split(/\s+/)[0].toLowerCase()];
    if (f) mutate('members', m.id, (x) => (x.floor === undefined ? { ...x, floor: f } : x));
  });
}
/** Mitglieder nach Stockwerk (von oben nach unten) gruppiert */
function byFloor(people) {
  return [...FLOORS, [null, 'Ohne Stockwerk']]
    .map(([k, label]) => [label, people.filter((p) => (k ? p.floor === k : !FLOORS.some(([f]) => f === p.floor)))])
    .filter(([, l]) => l.length);
}

/* ═══════════════════════════════════════════════════════════════════════════
   Privatnachrichten
   Jede Nachricht: { members: [a, b], author, to, text, voice?, taskId?, createdAt, read }
   Geladen werden nur Nachrichten, an denen man selbst beteiligt ist.
   ═══════════════════════════════════════════════════════════════════════════ */
let dmUnsub = null, dmSubFor = null;
function ensureDmSub() {
  if (!store || !state.me || dmSubFor === state.me) return;
  dmUnsub?.();
  dmSubFor = state.me;
  state.messages = [];
  dmUnsub = store.subscribe('messages', (list) => { state.messages = list; render(); }, { field: 'members', contains: state.me });
}
const dmWith = (id) => state.messages
  .filter((m) => id !== state.me && m.members?.includes(id) && m.members?.includes(state.me))
  .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
const dmUnread = (id = null) => state.messages.filter((m) => m.to === state.me && !m.read && (!id || m.author === id)).length;
function dmMarkRead(id) {
  state.messages.filter((m) => m.author === id && m.to === state.me && !m.read)
    .forEach((m) => mutate('messages', m.id, (x) => ({ ...x, read: true, readAt: Date.now() })));
}
const hhmm = (ts) => new Date(ts).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
function shortTime(ts) {
  const d = iso(new Date(ts));
  if (d === today()) return hhmm(ts);
  if (d === addDays(today(), -1)) return 'Gestern';
  return new Date(ts).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
}
function dmPreview(m) {
  const who = m.author === state.me ? 'Du: ' : '';
  if (m.voice) return `${who}🎤 Sprachnachricht (${fmtDur(m.voice.duration)})`;
  if (m.media?.length) return `${who}${m.media.every((x) => x.kind === 'video') ? '🎬 Video' : '📷 Foto'}${m.media.length > 1 ? ` (${m.media.length})` : ''}${m.text ? ` · ${snippet(m.text, 40)}` : ''}`;
  if (m.taskId) return `${who}📋 ${state.tasks.find((t) => t.id === m.taskId)?.title || 'Aufgabe'}`;
  return who + snippet(m.text, 60);
}
function sendDm(to, data, { push = true, pushBody = null } = {}) {
  addDoc('messages', { members: [state.me, to].sort(), author: state.me, to, createdAt: Date.now(), read: false, text: '', ...data });
  haptic(8);
  if (push) {
    const body = pushBody || (data.voice ? `🎤 Sprachnachricht (${fmtDur(data.voice.duration)})` : snippet(data.text, 160));
    emit('dm', { title: `💬 ${myName()}`, body, to: [to], tab: `dm:${state.me}`, tag: `dm-${state.me}` });
  }
}

function dmTaskCard(m) {
  const t = state.tasks.find((x) => x.id === m.taskId);
  if (!t) return '<div class="small muted">📋 Aufgabe wurde gelöscht</div>';
  const status = t.done ? `✓ erledigt von ${esc(nameOf(t.doneBy))}` : `${t.assignee ? `Für ${t.assignee === state.me ? 'dich' : esc(nameOf(t.assignee))}` : 'Für alle'}${t.due ? ` · fällig ${esc(fmtDay(t.due))}` : ''}`;
  return `<div class="dm-task ${t.done ? 'done' : ''}">
    <button class="check ${t.done ? 'on' : ''}" data-act="task-toggle" data-id="${t.id}" aria-label="${t.done ? 'Wieder öffnen' : 'Erledigen'}">${I.check}</button>
    <button class="main" data-act="task-edit" data-id="${t.id}"><div class="eyebrow-s">📋 Aufgabe</div><div class="title">${esc(t.title)}</div><div class="sub">${status}</div></button>
  </div>`;
}
function dmMessagesHtml(id, ui = {}) {
  const list = dmWith(id);
  if (!list.length) {
    return `<div class="empty dm-empty">${avatar(id, 64)}<p>Schreib ${esc(dn(id))} die erste Nachricht 👋</p>
      <p class="small muted">Nur ihr beide seht diesen Chat.</p></div>`;
  }
  let day = '';
  const lastMine = [...list].reverse().find((m) => m.author === state.me);
  return list.map((m) => {
    const mine = m.author === state.me;
    const d = iso(new Date(m.createdAt));
    const sep = d !== day ? `<div class="dm-day">${esc(fmtDay(d))}</div>` : '';
    day = d;
    const kind = m.voice ? 'bare' : m.taskId ? 'rich' : m.media?.length ? 'media' : '';
    const cap = m.text ? `<div class="txt">${richText(m.text)}</div>` : '';
    const body = m.voice ? voiceBody(m)
      : m.taskId ? dmTaskCard(m) + cap
        : m.media?.length ? mediaGrid({ ...m, text: '' }) + cap
          : richText(m.text);
    const q = m.replyTo ? state.messages.find((x) => x.id === m.replyTo) : null;
    const quote = m.replyTo ? `<button class="dm-quote" data-jump="${esc(m.replyTo)}"><b>${q ? esc(q.author === state.me ? 'Du' : dn(q.author)) : ''}</b><span>${q ? esc(dmPreview({ ...q, author: '' })) : 'Nachricht gelöscht'}</span></button>` : '';
    const reacts = Object.entries(m.reactions || {});
    const counts = {};
    reacts.forEach(([, e]) => { counts[e] = (counts[e] || 0) + 1; });
    const seen = mine && m === lastMine ? (m.read ? ' · Gelesen' : ' · Gesendet') : '';
    const sel = ui.sel === m.id;
    return `${sep}<div class="dm-msg ${mine ? 'me' : ''} ${sel ? 'sel' : ''}" data-mid="${m.id}">
      <span class="dm-swipe-ico" aria-hidden="true">${I.reply}</span>
      ${sel ? `<div class="dm-actions">
        <div class="dm-emo" role="toolbar" aria-label="Reagieren">${QUICK_REACTIONS.slice(0, 6).map((e) => `<button data-react="${e}" class="${m.reactions?.[state.me] === e ? 'on' : ''}" aria-label="Mit ${e} reagieren">${e}</button>`).join('')}</div>
        <div class="dm-ops">
          <button data-reply="${m.id}">${I.reply}Antworten</button>
          ${m.text ? `<button data-copy="${m.id}">${I.copy}Kopieren</button>` : ''}
          ${mine ? `<button class="danger" data-dmdel="${m.id}">${I.trash}Löschen</button>` : ''}
        </div>
      </div>` : ''}
      <div class="dm-bubble ${kind} ${quote ? 'has-quote' : ''}">${quote}${body}</div>
      ${reacts.length ? `<button class="dm-reacts" data-react-list="${m.id}" title="${esc(reacts.map(([who, e]) => `${e} ${nameOf(who)}`).join(', '))}">${Object.entries(counts).map(([e, n]) => `${e}${n > 1 ? `<small>${n}</small>` : ''}`).join('')}</button>` : ''}
      <div class="dm-meta"><span>${hhmm(m.createdAt)}${seen}</span></div>
    </div>`;
  }).join('');
}

function dmReact(msgId, emoji) {
  const m = state.messages.find((x) => x.id === msgId);
  if (!m) return;
  const removing = m.reactions?.[state.me] === emoji;
  mutate('messages', msgId, (x) => {
    const r = { ...(x.reactions || {}) };
    if (r[state.me] === emoji) delete r[state.me]; else r[state.me] = emoji;
    return { ...x, reactions: r };
  });
  haptic(8);
  if (!removing && m.author !== state.me) {
    emit('dm', { title: `${emoji} ${myName()} hat reagiert`, body: snippet(dmPreview({ ...m, author: '' }), 120), to: [m.author], tab: `dm:${state.me}`, tag: `dmr-${msgId}` });
  }
}
function dmDelete(m) {
  removeDoc('messages', m.id);
  (m.media || []).forEach((x) => removeMedia(store, x));
  if (m.voice?.audioId) store.remove('audio', m.voice.audioId).catch(() => {});
}

function chatSheet(id) {
  const other = member(id);
  if (!other || id === state.me) return;
  if (sheets.some((s) => s.dmWith === id)) return;
  let lastHtml = '';
  const ui = { sel: null, reply: null };
  let root = null; // Sheet-Element (steht schon in onMount bereit)
  const api = openSheet({
    title: dn(id),
    html: `<div class="dm-pres small muted" id="dm-pres">${[nickOf(id) ? esc(other.name) : '', floorName(other.floor), presenceText(id)].filter(Boolean).join(' · ')}</div>
      <div class="dm-list" id="dmlist"></div>
      <div class="dm-replybar" id="dm-rb" hidden></div>
      <form class="composer dm-bar" id="dmf">
        <button type="button" class="icon-btn dm-tool" id="dm-task" aria-label="Aufgabe zuteilen" title="Aufgabe zuteilen">${I.tasks}</button>
        <label class="icon-btn dm-tool" aria-label="Foto oder Video senden" title="Foto oder Video senden">${I.photo}<input type="file" id="dm-file" accept="image/*,video/*" multiple hidden></label>
        <textarea id="dmt" rows="1" maxlength="2000" placeholder="Nachricht …" aria-label="Nachricht an ${esc(dn(id))}"></textarea>
        <button type="button" class="send" id="dm-mic" aria-label="Sprachnachricht aufnehmen">${I.mic}</button>
        <button type="submit" class="send" id="dm-send" aria-label="Senden" hidden>${I.send}</button>
      </form>`,
    refresh: (api) => {
      if (!member(id)) return api.close();
      $('#dm-pres', api.el).innerHTML = [nickOf(id) ? esc(member(id).name) : '', floorName(member(id).floor), presenceText(id)].filter(Boolean).join(' · ');
      const h2 = $('.sheet-head h2', api.el); if (h2.textContent !== dn(id)) h2.textContent = dn(id);
      paint();
      if (!document.hidden) dmMarkRead(id);
    },
    onMount: (api) => {
      root = api.el;
      api.el.classList.add('dm-sheet');
      const f = $('#dmf', api.el), ta = $('#dmt', api.el), list = $('#dmlist', api.el);
      const sync = () => { const has = !!ta.value.trim(); $('#dm-send', f).hidden = !has; $('#dm-mic', f).hidden = has; };
      ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = Math.min(140, ta.scrollHeight) + 'px'; sync(); });
      ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && matchMedia('(hover: hover)').matches) { e.preventDefault(); f.requestSubmit(); } });
      f.onsubmit = (e) => {
        e.preventDefault();
        const text = ta.value.trim();
        if (!text) return;
        ta.value = ''; ta.style.height = ''; sync();
        sendDm(id, { text, ...replyData() });
        setReply(null);
        setTimeout(() => { list.scrollTop = list.scrollHeight; }, 60);
        ta.focus();
      };
      $('#dm-mic', f).onclick = () => dmVoiceSheet(id, replyData(), () => setReply(null));
      $('#dm-file', f).onchange = (e) => {
        const files = [...e.target.files];
        e.target.value = '';
        if (files.length) dmMediaSheet(id, files, replyData(), () => setReply(null));
      };
      $('#dm-task', f).onclick = () => taskSheet(null, {
        assignee: id,
        title: `Aufgabe für ${dn(id)}`,
        onCreate: (taskId) => sendDm(id, { taskId }, { push: false }),
      });
      $('#dm-rb', api.el).addEventListener('click', (e) => { if (e.target.closest('[data-rb-x]')) setReply(null); });

      // Gedrückt halten → Menü (Reaktionen, Antworten, Kopieren, Löschen)
      // Tippen auf eine Antwort → zur zitierten Nachricht springen
      let swiped = false;
      const jumpTo = (mid) => {
        const t = $(`[data-mid="${CSS.escape(mid)}"]`, list);
        if (!t) return toast('Die Nachricht gibt es nicht mehr');
        t.scrollIntoView({ behavior: 'smooth', block: 'center' });
        t.classList.remove('flash'); void t.offsetWidth; t.classList.add('flash');
        setTimeout(() => t.classList.remove('flash'), 1500);
      };
      const openMenu = (mid) => { ui.sel = mid; haptic(15); getSelection()?.removeAllRanges(); paint(); };
      list.addEventListener('contextmenu', (e) => {
        const msg = e.target.closest('.dm-msg');
        if (!msg || e.target.closest('video')) return;
        e.preventDefault();
        openMenu(msg.dataset.mid);
      });
      list.addEventListener('click', async (e) => {
        if (swiped) { swiped = false; return; }
        if (Date.now() - lpAt < 450 && !e.target.closest('.dm-actions')) return;
        const cp = e.target.closest('[data-copy]');
        if (cp) {
          const m = state.messages.find((x) => x.id === cp.dataset.copy);
          ui.sel = null; paint();
          try { await navigator.clipboard.writeText(m?.text || ''); toast('📋 Kopiert'); } catch { toast('Kopieren hat nicht geklappt'); }
          return;
        }
        const r = e.target.closest('[data-react]');
        if (r) { dmReact(ui.sel, r.dataset.react); ui.sel = null; return paint(); }
        const rp = e.target.closest('[data-reply]');
        if (rp) { ui.sel = null; setReply(rp.dataset.reply); return paint(); }
        const d = e.target.closest('[data-dmdel]');
        if (d) {
          const m = state.messages.find((x) => x.id === d.dataset.dmdel);
          if (m && await confirmSheet('Nachricht für euch beide löschen?')) { ui.sel = null; dmDelete(m); }
          return;
        }
        if (ui.sel && !e.target.closest('.dm-actions')) { ui.sel = null; paint(); return; }
        const j = e.target.closest('[data-jump]');
        if (j) return jumpTo(j.dataset.jump);
        if (e.target.closest('[data-react-list]')) {
          const m = state.messages.find((x) => x.id === e.target.closest('[data-react-list]').dataset.reactList);
          if (m) toast(Object.entries(m.reactions || {}).map(([who, em]) => `${em} ${nameOf(who)}`).join(' · '));
          return;
        }
        // Antwort-Nachricht antippen (nicht auf Knöpfe/Tonspur) → zum Original
        const msg = e.target.closest('.dm-msg');
        const m = msg && state.messages.find((x) => x.id === msg.dataset.mid);
        if (m?.replyTo && e.target.closest('.dm-bubble') && !e.target.closest('button, a, .wave, video')) jumpTo(m.replyTo);
      });

      // Nach rechts wischen → antworten
      let sw = null, lp = 0, lpAt = 0;
      const cancelLp = () => { clearTimeout(lp); lp = 0; };
      list.addEventListener('pointerdown', (e) => {
        const msg = e.target.closest('.dm-msg');
        if (!msg || e.target.closest('.wave, .dm-actions') || (e.pointerType === 'mouse' && e.button !== 0)) return;
        sw = { el: msg, x: e.clientX, y: e.clientY, dx: 0, on: false, id: e.pointerId };
        cancelLp();
        if (e.target.closest('.dm-bubble')) {
          lp = setTimeout(() => {
            lp = 0;
            if (!sw || sw.on) return;
            sw = null;
            lpAt = Date.now(); // den Klick beim Loslassen ignorieren
            openMenu(msg.dataset.mid);
          }, 450);
        }
      });
      list.addEventListener('pointermove', (e) => {
        if (!sw || e.pointerId !== sw.id) return;
        const dx = e.clientX - sw.x, dy = e.clientY - sw.y;
        if (Math.abs(dx) > 8 || Math.abs(dy) > 8) cancelLp();
        if (!sw.on) {
          if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { sw = null; return; }
          if (dx > 12 && dx > Math.abs(dy) * 1.5) { sw.on = true; sw.el.classList.add('swiping'); getSelection()?.removeAllRanges(); try { list.setPointerCapture(e.pointerId); } catch { /* egal */ } }
          else return;
        }
        e.preventDefault();
        sw.dx = Math.max(0, Math.min(90, dx));
        sw.el.style.setProperty('--sx', `${sw.dx}px`);
        sw.el.classList.toggle('armed', sw.dx > 60);
      });
      const end = () => {
        cancelLp();
        if (!sw) return;
        const { el, on, dx } = sw;
        sw = null;
        if (!on) return;
        swiped = true;
        setTimeout(() => { swiped = false; }, 350);
        el.classList.remove('swiping', 'armed');
        el.style.removeProperty('--sx');
        if (dx > 60) { haptic(12); setReply(el.dataset.mid); ta.focus(); }
      };
      list.addEventListener('pointerup', end);
      list.addEventListener('pointercancel', end);
      list.addEventListener('scroll', cancelLp, { passive: true });

      api.refresh(api);
    },
  });
  api.dmWith = id;

  function replyData() { return ui.reply ? { replyTo: ui.reply } : {}; }
  function setReply(mid) {
    ui.reply = mid;
    const bar = $('#dm-rb', root);
    const m = mid && state.messages.find((x) => x.id === mid);
    bar.hidden = !m;
    if (m) {
      bar.innerHTML = `<span class="dm-rb-ico">${I.reply}</span><div class="dm-rb-txt"><b>Antwort an ${esc(m.author === state.me ? 'dich selbst' : dn(m.author))}</b><span>${esc(dmPreview({ ...m, author: '' }))}</span></div>
        <button type="button" class="icon-btn" data-rb-x aria-label="Antwort abbrechen">${I.close}</button>`;
    }
  }
  function paint() {
    const l = root && $('#dmlist', root);
    if (!l) return;
    const html = dmMessagesHtml(id, ui);
    if (html === lastHtml) return;
    const atBottom = !lastHtml || l.scrollHeight - l.scrollTop - l.clientHeight < 60;
    lastHtml = html;
    l.innerHTML = html;
    updateVoiceUI();
    hydrateMedia();
    if (atBottom && !ui.sel) l.scrollTop = l.scrollHeight;
  }
}

function dmMediaSheet(to, files, extra = {}, onSent) {
  const items = [];
  let processing = 0;
  openSheet({
    title: `📷 An ${dn(to)}`,
    html: `<form id="mf2"><div class="attach" id="dm-att"></div>
      <div class="field"><label for="dm-cap">Text dazu (optional)</label><input id="dm-cap" maxlength="500" placeholder="z. B. Schau mal 😄"></div>
      <div class="sheet-actions"><button class="btn primary" type="submit">${I.send}Senden</button></div></form>`,
    onMount: async (api) => {
      const f = $('#mf2', api.el), att = $('#dm-att', f);
      const draw = () => {
        att.innerHTML = items.map((a, i) => `<div class="att">${(a.kind === 'image' ? a.preview : a.poster) ? `<img alt="" src="${esc(a.kind === 'image' ? a.preview : a.poster)}">` : '<span class="vph"></span>'}${a.kind === 'video' ? `<span class="vplay sm">${I.play}</span>` : ''}<button type="button" class="att-x" data-att-del="${i}" aria-label="Entfernen">${I.close}</button></div>`).join('')
          + '<div class="att loading"><div class="spinner"></div></div>'.repeat(processing);
      };
      att.addEventListener('click', (e) => { const x = e.target.closest('[data-att-del]'); if (x) { items.splice(+x.dataset.attDel, 1); draw(); if (!items.length && !processing) api.close(); } });
      f.onsubmit = async (e) => {
        e.preventDefault();
        if (processing) return toast('Moment, die Dateien werden noch vorbereitet …');
        if (!items.length) return api.close();
        const submit = $('button[type=submit]', f);
        submit.disabled = true;
        try {
          const total = items.reduce((n, a) => n + a.blob.size, 0) || 1;
          let doneBytes = 0;
          const metas = [];
          for (const a of items) {
            metas.push(await uploadMedia(store, a, {
              id: newId(), author: state.me,
              onProgress: (fr) => { submit.textContent = `Sende … ${Math.round(((doneBytes + fr * a.blob.size) / total) * 100)} %`; },
            }));
            doneBytes += a.blob.size;
          }
          const n = metas.length, vids = metas.filter((m) => m.kind === 'video').length;
          sendDm(to, { media: metas, text: $('#dm-cap', f).value.trim(), ...extra }, { pushBody: vids === n ? (n > 1 ? `🎬 ${n} Videos` : '🎬 Video') : vids ? `📷 ${n} Fotos & Videos` : n > 1 ? `📷 ${n} Fotos` : '📷 Foto' });
          onSent?.();
          api.close();
        } catch (err) {
          console.error(err);
          submit.disabled = false;
          submit.innerHTML = `${I.send}Senden`;
          toast(`⚠️ ${err.message || 'Senden fehlgeschlagen'}`, 4500);
        }
      };
      for (const file of files.slice(0, MAX_ITEMS)) {
        processing++; draw();
        try { items.push(await prepareFile(file)); } catch (e) { toast(`⚠️ ${e.message}`, 4500); }
        processing--; draw();
      }
      if (files.length > MAX_ITEMS) toast(`Maximal ${MAX_ITEMS} Fotos/Videos auf einmal`);
      if (!items.length) api.close();
    },
  });
}

function dmVoiceSheet(to, extra = {}, onSent) {
  let recorder = null;
  openSheet({
    title: `🎤 An ${dn(to)}`,
    onClose: () => recorder?.cleanup(),
    html: `<form id="vf"><div data-k="voice">
        <div class="recorder card">
          <div class="rec-wave" id="rw">${'<i></i>'.repeat(40)}</div>
          <div class="rec-time" id="rt">0:00</div>
          <div class="rec-ctrl">
            <button type="button" class="icon-btn lg" id="r-del" hidden aria-label="Verwerfen">${I.trash}</button>
            <button type="button" class="rec-btn" id="r-btn" aria-label="Aufnahme starten"><span class="dot"></span>${I.mic}</button>
            <button type="button" class="icon-btn lg" id="r-play" hidden aria-label="Anhören">${I.play}</button>
          </div>
          <p class="small muted center" id="r-hint" style="margin:10px 0 0">Tippe auf den Knopf, um aufzunehmen</p>
        </div></div>
      <div class="sheet-actions"><button class="btn primary" type="submit">${I.send}Senden</button></div></form>`,
    onMount: (api) => {
      const f = $('#vf', api.el);
      recorder = setupRecorder($('[data-k=voice]', f));
      f.onsubmit = async (ev) => {
        ev.preventDefault();
        const r = recorder?.get();
        if (!r) return toast('Nimm zuerst eine Sprachnachricht auf 🎤');
        const submit = $('button[type=submit]', f);
        submit.disabled = true;
        try {
          const data = await blobToDataURL(r.blob);
          if (data.length > 950_000) throw new Error('Die Aufnahme ist zu lang – bitte kürzer aufnehmen');
          const audioId = newId();
          audioCache.set(audioId, data);
          await Promise.race([
            store.add('audio', { id: audioId, data, mime: r.mime, duration: r.duration, author: state.me, createdAt: Date.now() }),
            new Promise((res) => setTimeout(res, 4000)),
          ]);
          sendDm(to, { voice: { audioId, duration: r.duration, peaks: r.peaks, mime: r.mime, heard: [] }, ...extra });
          onSent?.();
          api.close();
        } catch (e) {
          console.error(e);
          submit.disabled = false;
          toast(`⚠️ ${e.message || 'Konnte die Sprachnachricht nicht speichern'}`, 4500);
        }
      };
    },
  });
}

function dmListSheet() {
  const html = () => {
    const others = membersSorted().filter((m) => m.id !== state.me);
    if (!others.length) return '<div class="empty"><div class="big">💬</div>Noch niemand außer dir im Haus.</div>';
    const last = (id) => dmWith(id).at(-1);
    others.sort((a, b) => (last(b.id)?.createdAt || 0) - (last(a.id)?.createdAt || 0));
    return `<div class="list card tight">${others.map((m) => {
      const l = last(m.id), n = dmUnread(m.id);
      return `<button class="list-item" data-dm="${m.id}">
        ${avatar(m.id, 44)}
        <div class="main"><div class="title">${esc(dn(m.id))}${m.floor ? ` <span class="floor-tag">${esc(floorName(m.floor))}</span>` : ''}</div>
          <div class="sub ${n ? 'strong' : ''}">${l ? esc(dmPreview(l)) : 'Noch keine Nachrichten'}</div></div>
        <div class="dm-side">${l ? `<span class="small muted">${esc(shortTime(l.createdAt))}</span>` : ''}${n ? `<b class="badge">${n}</b>` : ''}</div>
      </button>`;
    }).join('')}</div>
    <p class="small muted center" style="margin:14px 8px 0">🔒 Privatnachrichten sehen nur die beiden Personen im Chat.</p>`;
  };
  openSheet({
    title: 'Nachrichten',
    html: `<div id="dml">${html()}</div>`,
    refresh: (api) => { $('#dml', api.el).innerHTML = html(); },
    onMount: (api) => {
      api.body.addEventListener('click', (e) => { const b = e.target.closest('[data-dm]'); if (b) chatSheet(b.dataset.dm); });
    },
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   Sheets: Aufgaben
   ═══════════════════════════════════════════════════════════════════════════ */
function memberOptions(selected, allLabel = '👥 Alle / wer Zeit hat') {
  return `<option value="">${allLabel}</option>${membersSorted().map((m) => `<option value="${m.id}" ${m.id === selected ? 'selected' : ''}>${esc(m.emoji || '')} ${esc(dn(m.id))}${m.id === state.me ? ' (du)' : ''}</option>`).join('')}`;
}

function taskSheet(id, preset = {}) {
  const t = id ? state.tasks.find((x) => x.id === id) : null;
  const pre = preset.assignee ?? (state.taskPerson && !['all', 'mine', 'none'].includes(state.taskPerson) ? state.taskPerson : (state.taskPerson === 'mine' ? state.me : ''));
  const v = t || { title: '', notes: '', assignee: pre, due: '', repeat: 'none', rotate: false, important: false };
  openSheet({
    title: t ? 'Aufgabe bearbeiten' : preset.title || 'Neue Aufgabe',
    html: `<form id="f">
      <div class="field"><label for="t-title">Was ist zu tun?</label><input id="t-title" required maxlength="140" placeholder="z. B. Treppenhaus putzen" value="${esc(v.title)}" autofocus></div>
      <div class="field"><label for="t-notes">Notizen</label><textarea id="t-notes" maxlength="1000" placeholder="Details (optional)">${esc(v.notes)}</textarea></div>
      <div class="grid-2">
        <div class="field"><label for="t-who">Zuständig</label><select id="t-who">${memberOptions(v.assignee)}</select></div>
        <div class="field"><label for="t-due">Fällig am</label><input id="t-due" type="date" value="${esc(v.due || '')}"></div>
      </div>
      <div class="field"><label for="t-rep">Wiederholen</label><select id="t-rep">${Object.entries(REPEAT).map(([k, l]) => `<option value="${k}" ${v.repeat === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div id="rot-wrap" ${v.repeat === 'none' ? 'hidden' : ''}>${toggle('t-rot', '🔄 Reihum weitergeben (nach jedem Erledigen ist die nächste Person dran)', v.rotate)}</div>
      ${toggle('t-imp', '⭐ Wichtig', v.important)}
      ${t?.history?.length ? `<div class="label" style="margin:14px 0 6px">Zuletzt erledigt</div><div class="small muted">${t.history.slice(0, 5).map((h) => `${esc(nameOf(h.by))} · ${relTime(h.at)}`).join('<br>')}</div>` : ''}
      ${t ? `<p class="small muted" style="margin-top:10px">Erstellt von ${esc(nameOf(t.createdBy))} · ${relTime(t.createdAt)}</p>` : ''}
      <div class="sheet-actions">
        ${t ? `<button type="button" class="btn danger" id="del">Löschen</button>` : ''}
        <button class="btn primary" type="submit">${t ? 'Speichern' : 'Hinzufügen'}</button>
      </div>
    </form>`,
    onMount: (api) => {
      const f = $('#f', api.el);
      $('#t-rep', f).onchange = (e) => { $('#rot-wrap', f).hidden = e.target.value === 'none'; };
      f.onsubmit = (e) => {
        e.preventDefault();
        const data = {
          title: $('#t-title', f).value.trim(),
          notes: $('#t-notes', f).value.trim(),
          assignee: $('#t-who', f).value || null,
          due: $('#t-due', f).value || null,
          repeat: $('#t-rep', f).value,
          rotate: $('#t-rep', f).value !== 'none' && $('#t-rot', f).checked,
          important: $('#t-imp', f).checked,
        };
        if (!data.title) return;
        if (data.repeat !== 'none' && !data.due) data.due = today();
        const dueTxt = data.due ? ` · fällig ${fmtDay(data.due)}` : '';
        const assigned = data.assignee && data.assignee !== state.me && (!t || t.assignee !== data.assignee) ? data.assignee : null;
        if (assigned) emit('task_assigned', { title: `📋 ${myName()} hat dir eine Aufgabe zugeteilt`, body: `${data.title}${dueTxt}`, to: [assigned], tab: 'tasks', tag: `assign-${newId()}` });
        if (t) mutate('tasks', t.id, (cur) => ({ ...cur, ...data }));
        else {
          const nid = addDoc('tasks', { ...data, done: false, createdBy: state.me, createdAt: Date.now() });
          preset.onCreate?.(nid, data);
          const forWho = data.assignee ? (data.assignee === state.me ? ` (für ${myName()})` : ` · für ${member(data.assignee)?.name || '?'}`) : ' · für alle';
          const others = memberIds().filter((x) => x !== state.me && x !== assigned);
          if (others.length) emit('task_new', { title: `📝 Neue Aufgabe von ${myName()}`, body: `${data.title}${forWho}${dueTxt}`, to: others, tab: 'tasks' });
        }
        haptic(10);
        toast(t ? 'Gespeichert' : '✓ Aufgabe angelegt');
        api.close();
      };
      $('#del', f)?.addEventListener('click', async () => {
        if (await confirmSheet(`„${t.title}“ wirklich löschen?`)) { removeDoc('tasks', t.id); api.close(); }
      });
    },
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   Sheets: Müll
   ═══════════════════════════════════════════════════════════════════════════ */
function binSheet(id, preset = {}) {
  const b = id ? state.trash.find((x) => x.id === id) : null;
  const v = b || { name: '', color: '#6b7280', mode: 'interval', start: preset.start || today(), interval: 2, dates: preset.start ? [preset.start] : [], rotation: [] };
  // Alte, automatisch erzeugte Reihenfolgen zählen nicht – nur bewusst festgelegte
  let rotation = v.rotationSet ? [...(v.rotation || [])].filter(member) : [];
  let dates = [...(v.dates || [])].sort();
  let color = v.color;
  let forMembers = [...(v.members || [])].filter(member);

  const rotHtml = () => {
    const rest = membersSorted().filter((m) => !rotation.includes(m.id));
    return `${rotation.length ? rotation.map((id, i) => `<div class="list-item" style="padding:8px 4px;min-height:0">
        <span class="pill">${i + 1}</span>${avatar(id, 28)}<div class="main title">${esc(dn(id))}</div>
        <button type="button" class="icon-btn" data-rot-up="${i}" aria-label="Nach oben" ${i ? '' : 'disabled style="opacity:.3"'}>↑</button>
        <button type="button" class="icon-btn" data-rot-del="${i}" aria-label="Entfernen">${I.close}</button></div>`).join('')
      : '<p class="small muted" style="margin:4px">Keine feste Reihenfolge – die Tonne ist für alle, alle werden erinnert.</p>'}
      ${rest.length ? `<div class="row wrap" style="margin-top:8px">${rest.map((m) => `<button type="button" class="chip chip-glass" data-rot-add="${m.id}">${avatar(m.id, 22)}+ ${esc(m.name)}</button>`).join('')}</div>` : ''}`;
  };
  const datesHtml = () => {
    const fut = dates.filter((d) => d >= addDays(today(), -14));
    return `${fut.length ? `<div class="row wrap">${fut.map((d) => `<span class="pill" style="padding:6px 10px;font-size:13px">${fmt(d, { day: 'numeric', month: 'short', year: '2-digit' })} <button type="button" data-date-del="${d}" aria-label="Entfernen" style="margin-left:2px">✕</button></span>`).join('')}</div>` : '<p class="small muted">Noch keine Termine.</p>'}
      ${dates.length > fut.length ? `<p class="small muted">+ ${dates.length - fut.length} vergangene</p>` : ''}`;
  };

  openSheet({
    title: b ? 'Tonne bearbeiten' : 'Neue Tonne',
    html: `<form id="f">
      ${b ? '' : `<div class="row wrap" style="gap:6px;margin-bottom:12px">${BIN_PRESETS.map(([n, c]) => `<button type="button" class="chip chip-glass no-av" data-preset="${esc(n)}" data-pc="${c}"><span class="dot-c" style="--c:${c}"></span>${esc(n)}</button>`).join('')}</div>`}
      <div class="field"><label for="b-name">Name</label><input id="b-name" required maxlength="40" placeholder="z. B. Biotonne" value="${esc(v.name)}" autofocus></div>
      <div class="field"><span class="label">Farbe</span><div class="swatches" id="sw">${BIN_COLORS.map(([n, c]) => `<button type="button" class="swatch ${c === color ? 'on' : ''}" style="--c:${c}" data-c="${c}" aria-label="${n}"></button>`).join('')}</div></div>
      <div class="field"><span class="label">Gilt für (bekommt Erinnerungen)</span><div class="for-wrap">${forPicker(forMembers)}</div></div>
      <div class="field"><span class="label">Abholrhythmus</span>${segmented([['interval', 'Regelmäßig'], ['dates', 'Einzeltermine']], v.mode, 'noop')}</div>
      <div id="m-interval" ${v.mode === 'dates' ? 'hidden' : ''}>
        <div class="grid-2">
          <div class="field"><label for="b-start">Nächster/erster Termin</label><input id="b-start" type="date" value="${esc(v.start || today())}"></div>
          <div class="field"><label for="b-int">Alle …</label><select id="b-int">${[1, 2, 3, 4, 6, 8].map((n) => `<option value="${n}" ${+v.interval === n ? 'selected' : ''}>${n === 1 ? 'jede Woche' : `${n} Wochen`}</option>`).join('')}</select></div>
        </div>
      </div>
      <div id="m-dates" ${v.mode === 'dates' ? '' : 'hidden'}>
        <div class="row" style="margin-bottom:10px"><input id="b-newdate" class="input" type="date" style="flex:1"><button type="button" class="btn" id="add-date">${I.plus}</button></div>
        <div id="dates">${datesHtml()}</div>
        <p class="small muted" style="margin-top:8px">Tipp: Viele Städte bieten den Abfuhrkalender als .ics-Datei an – den kannst du unter „Kalender importieren“ einlesen.</p>
      </div>
      <div class="field" style="margin-top:14px"><span class="label">Feste Reihenfolge (optional) – wer stellt reihum raus?</span><div id="rot">${rotHtml()}</div></div>
      <div class="sheet-actions">
        ${b ? `<button type="button" class="btn danger" id="del">Löschen</button>` : ''}
        <button class="btn primary" type="submit">${b ? 'Speichern' : 'Hinzufügen'}</button>
      </div>
    </form>`,
    onMount: (api) => {
      const f = $('#f', api.el);
      let mode = v.mode || 'interval';
      bindForPicker(f, () => forMembers, (x) => { forMembers = x; });
      f.addEventListener('click', (e) => {
        const pre = e.target.closest('[data-preset]');
        if (pre) {
          $('#b-name', f).value = pre.dataset.preset;
          color = pre.dataset.pc;
          $$('.swatch', f).forEach((x) => x.classList.toggle('on', x.dataset.c === color));
          $$('[data-preset]', f).forEach((x) => x.classList.toggle('on', x === pre));
          return;
        }
        const sw = e.target.closest('[data-c]');
        if (sw) { color = sw.dataset.c; $$('.swatch', f).forEach((x) => x.classList.toggle('on', x === sw)); }
        const seg = e.target.closest('.seg button');
        if (seg) {
          e.stopPropagation();
          mode = seg.dataset.v;
          const s = seg.parentElement;
          s.style.setProperty('--i', mode === 'interval' ? 0 : 1);
          $$('button', s).forEach((x) => x.classList.toggle('on', x === seg));
          $('#m-interval', f).hidden = mode !== 'interval';
          $('#m-dates', f).hidden = mode !== 'dates';
        }
        const up = e.target.closest('[data-rot-up]');
        if (up) { const i = +up.dataset.rotUp; [rotation[i - 1], rotation[i]] = [rotation[i], rotation[i - 1]]; $('#rot', f).innerHTML = rotHtml(); }
        const del = e.target.closest('[data-rot-del]');
        if (del) { rotation.splice(+del.dataset.rotDel, 1); $('#rot', f).innerHTML = rotHtml(); }
        const add = e.target.closest('[data-rot-add]');
        if (add) { rotation.push(add.dataset.rotAdd); $('#rot', f).innerHTML = rotHtml(); }
        const dd = e.target.closest('[data-date-del]');
        if (dd) { dates = dates.filter((d) => d !== dd.dataset.dateDel); $('#dates', f).innerHTML = datesHtml(); }
      });
      $('#add-date', f).onclick = () => {
        const d = $('#b-newdate', f).value;
        if (d && !dates.includes(d)) { dates = [...dates, d].sort(); $('#dates', f).innerHTML = datesHtml(); }
      };
      f.onsubmit = (e) => {
        e.preventDefault();
        const data = {
          name: $('#b-name', f).value.trim(), color, mode,
          start: $('#b-start', f).value || today(), interval: +$('#b-int', f).value,
          dates, rotation, rotationSet: rotation.length > 0, members: forMembers,
        };
        if (!data.name) return;
        if (b) mutate('trash', b.id, (cur) => ({ ...cur, ...data }));
        else addDoc('trash', { ...data, done: {}, createdAt: Date.now() });
        toast(b ? 'Gespeichert' : '✓ Tonne angelegt');
        api.close();
      };
      $('#del', f)?.addEventListener('click', async () => {
        if (await confirmSheet(`„${b.name}“ mit allen Terminen löschen?`)) { removeDoc('trash', b.id); api.close(); }
      });
    },
  });
}

/** Auswahl „Gilt für“: leere Liste = ganzes Haus */
function forPicker(sel) {
  const all = !sel.length;
  return `<div class="row wrap">
    <button type="button" class="chip chip-glass no-av ${all ? 'on' : ''}" data-for="">🏠 Ganzes Haus</button>
    ${membersSorted().map((m) => `<button type="button" class="chip chip-glass ${sel.includes(m.id) ? 'on' : ''}" data-for="${m.id}">${avatar(m.id, 22)}${esc(m.id === state.me ? `${m.name} (ich)` : m.name)}</button>`).join('')}
  </div>`;
}
function bindForPicker(root, get, set) {
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-for]');
    if (!b) return;
    const id = b.dataset.for;
    let sel = get();
    if (!id) sel = [];
    else sel = sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id];
    set(sel);
    b.closest('.for-wrap').innerHTML = forPicker(sel);
  });
}

function guessBin(summary) {
  const s = summary.toLowerCase();
  if (/bio|kompost|grün(?!.*glas)/.test(s)) return { name: 'Biotonne', color: '#8b5a2b' };
  if (/papier|pappe|karton|ppk|blau/.test(s)) return { name: 'Papier', color: '#2fa84f' };
  if (/gelb|wertstoff|verpack|leichtverp|plastik/.test(s)) return { name: 'Gelber Sack', color: '#eab308' };
  if (/glas/.test(s)) return { name: 'Glas', color: '#14b8a6' };
  if (/sperr/.test(s)) return { name: 'Sperrmüll', color: '#e5484d' };
  if (/schadstoff|problem/.test(s)) return { name: 'Schadstoffe', color: '#f08c2e' };
  if (/rest|grau|schwarz|haus/.test(s)) return { name: 'Restmüll', color: '#6b7280' };
  return { name: summary.replace(/abfuhr|leerung|abholung/gi, '').trim().slice(0, 40) || summary, color: '#8e5cf7' };
}

function icsImport() {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = '.ics,text/calendar';
  inp.onchange = async () => {
    const file = inp.files[0];
    if (!file) return;
    const events = parseICS(await file.text());
    if (!events.length) return toast('Keine Termine in der Datei gefunden');
    const groups = {};
    for (const e of events) {
      const g = guessBin(e.summary);
      (groups[g.name] ||= { ...g, dates: new Set() }).dates.add(e.date);
    }
    const entries = Object.values(groups);
    let forMembers = [state.me];
    const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
    openSheet({
      title: 'Abfallkalender hochladen',
      html: `<p class="muted" style="margin-top:0">${plural(events.length, 'Termin', 'Termine')} in <b>${esc(file.name)}</b> gefunden.</p>
        <div class="field"><span class="label">Für wen gilt dieser Kalender?</span><div class="for-wrap">${forPicker(forMembers)}</div>
          <p class="small muted" style="margin:2px 4px 0">Nur die ausgewählten Personen sehen die Tonnen unter „Für mich“ und bekommen Erinnerungen.</p></div>
        <div class="list card tight" style="margin-bottom:14px">${entries.map((g) => `<div class="list-item">${binIcon(g)}<div class="main"><div class="title">${esc(g.name)}</div><div class="sub">${g.dates.size} Termine · ab ${esc(fmtDay([...g.dates].sort().find((d) => d >= today()) || [...g.dates].sort().at(-1)))}</div></div></div>`).join('')}</div>
        <div class="sheet-actions"><button class="btn" data-close>Abbrechen</button><button class="btn primary" id="go">Importieren</button></div>`,
      onMount: (api) => {
        bindForPicker(api.body, () => forMembers, (x) => { forMembers = x; });
        $('#go', api.el).onclick = () => {
          for (const g of entries) {
            // Gleiche Tonne für denselben Personenkreis → Termine ergänzen, sonst neue Tonne
            const ex = state.trash.find((b) => b.name.toLowerCase() === g.name.toLowerCase() && sameSet(b.members || [], forMembers));
            const meta = { importedBy: state.me, importedAt: Date.now(), source: file.name };
            if (ex) mutate('trash', ex.id, (b) => ({ ...b, ...meta, mode: 'dates', dates: [...new Set([...(b.dates || []), ...g.dates])].sort() }));
            else addDoc('trash', { name: g.name, color: g.color, mode: 'dates', dates: [...g.dates].sort(), start: today(), interval: 2, rotation: [], rotationSet: false, members: forMembers, done: {}, createdAt: Date.now(), ...meta });
          }
          toast('✓ Abfallkalender importiert');
          api.close();
        };
      },
    });
  };
  inp.click();
}

function icsExport() {
  const evs = pickups(today(), addDays(today(), 365)).map((p) => ({
    uid: `${p.bin.id}-${p.date}`,
    title: `🗑️ ${p.bin.name}${p.who ? ` (${dn(p.who)} ist dran)` : ''}`,
    date: p.date,
    desc: 'Am Vorabend rausstellen. – Vermietertagebuch',
    alarm: '-PT6H', // ganztägig → Erinnerung am Vortag um 18 Uhr
  }));
  download('muellabfuhr.ics', buildICS(evs, `Müllabfuhr – ${state.house?.name || 'Haus'}`), 'text/calendar');
  toast('📅 Kalenderdatei erstellt – öffnen zum Hinzufügen');
}

/* ═══════════════════════════════════════════════════════════════════════════
   Sheets: Social Hub
   ═══════════════════════════════════════════════════════════════════════════ */
function composeSheet(type = 'post', existing = null, preset = {}) {
  const p = existing;
  const pickPhotos = type === 'photo';
  if (pickPhotos) type = 'post';
  let kind = p?.type || type;
  // Anhänge: bereits gespeicherte ({existing, meta}) und neu ausgewählte (prepareFile-Ergebnis)
  let attachments = (p?.media || []).map((meta) => ({ existing: true, kind: meta.kind, meta }));
  let processing = 0;
  let opts = p?.poll?.options?.map((o) => o.text) || ['', ''];
  const optsHtml = () => opts.map((o, i) => `<div class="row" style="margin-bottom:8px"><input class="input" data-opt="${i}" maxlength="80" placeholder="Option ${i + 1}" value="${esc(o)}">${opts.length > 2 ? `<button type="button" class="icon-btn" data-opt-del="${i}" aria-label="Entfernen">${I.close}</button>` : ''}</div>`).join('');
  const e = p?.event || { title: '', date: preset.date || addDays(today(), 1), time: '', endTime: '', location: '', desc: '' };

  let recorder = null;
  openSheet({
    title: p ? 'Bearbeiten' : 'Neu im Social Hub',
    onClose: () => recorder?.cleanup(),
    html: `<form id="f">
      ${p ? '' : segmented([['post', '💬 Text'], ['voice', '🎤 Sprache'], ['poll', '📊 Umfrage'], ['event', '📅 Termin']], kind, 'noop')}
      <div data-k="voice" ${kind === 'voice' ? '' : 'hidden'}>
        ${p ? '<p class="small muted">Die Aufnahme selbst kann nicht geändert werden – nur der Text dazu.</p>' : `
        <div class="recorder card">
          <div class="rec-wave" id="rw">${'<i></i>'.repeat(40)}</div>
          <div class="rec-time" id="rt">0:00</div>
          <div class="rec-ctrl">
            <button type="button" class="icon-btn lg" id="r-del" hidden aria-label="Verwerfen">${I.trash}</button>
            <button type="button" class="rec-btn" id="r-btn" aria-label="Aufnahme starten"><span class="dot"></span>${I.mic}</button>
            <button type="button" class="icon-btn lg" id="r-play" hidden aria-label="Anhören">${I.play}</button>
          </div>
          <p class="small muted center" id="r-hint" style="margin:10px 0 0">Tippe auf den Knopf, um aufzunehmen</p>
        </div>`}
        <div class="field mention-field"><label for="c-vtext">Text dazu (optional)</label><input id="c-vtext" maxlength="300" placeholder="z. B. Kurze Info an alle 🙂" value="${esc(p?.type === 'voice' ? p.text || '' : '')}"></div>
      </div>
      <div data-k="post" ${kind === 'post' ? '' : 'hidden'}>
        <div class="field mention-field"><label for="c-text">Beitrag</label><textarea id="c-text" maxlength="4000" placeholder="Was gibt's Neues? 😊 Mit @ markierst du jemanden" style="min-height:${attachments.length || pickPhotos ? 90 : 140}px">${esc(p?.text || '')}</textarea></div>
        <div class="attach-row">
          <button type="button" class="btn sm attach-btn" id="c-at">@ Person markieren</button>
          <label class="btn sm attach-btn">${I.photo}Fotos / Videos<input type="file" id="c-files" accept="image/*,video/*" multiple hidden></label>
        </div>
        <div class="attach" id="att"></div>
        <p class="small muted" style="margin:6px 4px 12px">Bis zu ${MAX_ITEMS} Stück · Videos bis 20 MB (am besten kurze Clips)</p>
      </div>
      <div data-k="poll" ${kind === 'poll' ? '' : 'hidden'}>
        <div class="field"><label for="c-q">Frage</label><input id="c-q" maxlength="200" placeholder="z. B. Was grillen wir am Samstag?" value="${esc(p?.poll?.question || '')}"></div>
        <div class="field"><span class="label">Antworten</span><div id="opts">${optsHtml()}</div>
          <button type="button" class="btn sm" id="opt-add" style="justify-self:start">${I.plus}Option</button></div>
        ${toggle('c-multi', 'Mehrfachauswahl erlauben', p?.poll?.multi)}
      </div>
      <div data-k="event" ${kind === 'event' ? '' : 'hidden'}>
        <div class="field"><label for="c-et">Titel</label><input id="c-et" maxlength="120" placeholder="z. B. Grillabend im Garten" value="${esc(e.title)}"></div>
        <div class="field"><label for="c-ed">Datum</label><input id="c-ed" type="date" value="${esc(e.date)}"></div>
        <div class="grid-2">
          <div class="field"><label for="c-es">Beginn</label><input id="c-es" type="time" value="${esc(e.time || '')}"></div>
          <div class="field"><label for="c-ee">Ende</label><input id="c-ee" type="time" value="${esc(e.endTime || '')}"></div>
        </div>
        <div class="field"><label for="c-el">Ort</label><input id="c-el" maxlength="120" placeholder="z. B. Garten, Wohnzimmer" value="${esc(e.location || '')}"></div>
        <div class="field"><label for="c-edesc">Beschreibung</label><textarea id="c-edesc" maxlength="2000" placeholder="Wer bringt was mit? …">${esc(e.desc || '')}</textarea></div>
      </div>
      <div class="sheet-actions"><button class="btn primary" type="submit">${I.send}${p ? 'Speichern' : 'Veröffentlichen'}</button></div>
    </form>`,
    onMount: (api) => {
      const f = $('#f', api.el);
      if (!p) recorder = setupRecorder($('[data-k=voice]', f));
      attachMentions($('#c-text', f), $('#c-at', f));
      attachMentions($('#c-vtext', f));
      const renderAtt = () => {
        $('#att', f).innerHTML = attachments.map((a, i) => {
          const src = a.existing ? (a.kind === 'image' ? cachedURL(a.meta.id) || a.meta.thumb : a.meta.poster) : (a.kind === 'image' ? a.preview : a.poster);
          return `<div class="att">${src ? `<img alt="" src="${esc(src)}">` : '<span class="vph"></span>'}${a.kind === 'video' ? `<span class="vplay sm">${I.play}</span>` : ''}<button type="button" class="att-x" data-att-del="${i}" aria-label="Entfernen">${I.close}</button></div>`;
        }).join('') + '<div class="att loading"><div class="spinner"></div></div>'.repeat(processing);
      };
      renderAtt();
      const fileInput = $('#c-files', f);
      fileInput.onchange = async () => {
        const files = [...fileInput.files];
        fileInput.value = '';
        for (const file of files) {
          if (attachments.length + processing >= MAX_ITEMS) { toast(`Maximal ${MAX_ITEMS} Fotos/Videos pro Beitrag`); break; }
          processing++; renderAtt();
          try { attachments.push(await prepareFile(file)); } catch (e) { toast(`⚠️ ${e.message}`, 4500); }
          processing--; renderAtt();
        }
      };
      $('#att', f).addEventListener('click', (e) => {
        const x = e.target.closest('[data-att-del]');
        if (x) { attachments.splice(+x.dataset.attDel, 1); renderAtt(); }
      });
      if (pickPhotos) fileInput.click();
      const syncOpts = () => { opts = $$('[data-opt]', f).map((x) => x.value); };
      f.addEventListener('click', (ev) => {
        const seg = ev.target.closest('.seg button');
        if (seg) {
          ev.stopPropagation();
          kind = seg.dataset.v;
          const s = seg.parentElement;
          s.style.setProperty('--i', ['post', 'voice', 'poll', 'event'].indexOf(kind));
          $$('button', s).forEach((x) => x.classList.toggle('on', x === seg));
          $$('[data-k]', f).forEach((x) => { x.hidden = x.dataset.k !== kind; });
        }
        const del = ev.target.closest('[data-opt-del]');
        if (del) { syncOpts(); opts.splice(+del.dataset.optDel, 1); $('#opts', f).innerHTML = optsHtml(); }
      });
      $('#opt-add', f).onclick = () => { syncOpts(); if (opts.length < 10) { opts.push(''); $('#opts', f).innerHTML = optsHtml(); $$('[data-opt]', f).at(-1).focus(); } };
      f.onsubmit = async (ev) => {
        ev.preventDefault();
        const base = p ? { ...p, editedAt: Date.now() } : { type: kind, author: state.me, createdAt: Date.now(), likes: [], reactions: {}, comments: [] };
        if (kind === 'voice') {
          base.text = $('#c-vtext', f).value.trim();
          if (!p) {
            const r = recorder?.get();
            if (!r) return toast('Nimm zuerst eine Sprachnachricht auf 🎤');
            const submit = $('button[type=submit]', f);
            submit.disabled = true;
            try {
              const data = await blobToDataURL(r.blob);
              if (data.length > 950_000) throw new Error('Die Aufnahme ist zu lang – bitte kürzer aufnehmen');
              const audioId = newId();
              audioCache.set(audioId, data);
              // Nicht ewig warten, falls offline – Firestore lädt später hoch
              await Promise.race([
                store.add('audio', { id: audioId, data, mime: r.mime, duration: r.duration, author: state.me, createdAt: Date.now() }),
                new Promise((res) => setTimeout(res, 4000)),
              ]);
              base.voice = { audioId, duration: r.duration, peaks: r.peaks, mime: r.mime, heard: [] };
            } catch (e) {
              console.error(e);
              submit.disabled = false;
              return toast(`⚠️ ${e.message || 'Konnte die Sprachnachricht nicht speichern'}`, 4500);
            }
          }
        } else if (kind === 'post') {
          const text = $('#c-text', f).value.trim();
          if (processing) return toast('Moment, die Dateien werden noch vorbereitet …');
          if (!text && !attachments.length) return toast('Schreib etwas oder füge ein Foto hinzu 🙂');
          base.text = text;
          const fresh = attachments.filter((a) => !a.existing);
          const submit = $('button[type=submit]', f);
          const label = submit.innerHTML;
          try {
            submit.disabled = true;
            const total = fresh.reduce((n, a) => n + a.blob.size, 0) || 1;
            let doneBytes = 0;
            const metas = [];
            for (const a of attachments) {
              if (a.existing) { metas.push(a.meta); continue; }
              const m = await uploadMedia(store, a, {
                id: newId(), author: state.me,
                onProgress: (fr) => { submit.textContent = `Lade hoch … ${Math.round(((doneBytes + fr * a.blob.size) / total) * 100)} %`; },
              });
              doneBytes += a.blob.size;
              metas.push(m);
            }
            base.media = metas;
            // Entfernte, schon gespeicherte Medien aufräumen
            const kept = new Set(metas.map((m) => m.id));
            (p?.media || []).filter((m) => !kept.has(m.id)).forEach((m) => removeMedia(store, m));
          } catch (e) {
            console.error(e);
            submit.disabled = false;
            submit.innerHTML = label;
            return toast(`⚠️ ${e.message || 'Hochladen fehlgeschlagen'}`, 4500);
          }
        } else if (kind === 'poll') {
          syncOpts();
          const question = $('#c-q', f).value.trim();
          const clean = opts.map((o) => o.trim()).filter(Boolean);
          if (!question || clean.length < 2) return toast('Frage und mindestens 2 Antworten nötig');
          const old = p?.poll?.options || [];
          base.poll = {
            question, multi: $('#c-multi', f).checked, closed: p?.poll?.closed || false,
            options: clean.map((text) => ({ id: old.find((o) => o.text === text)?.id || newId(), text, votes: old.find((o) => o.text === text)?.votes || [] })),
          };
        } else {
          const title = $('#c-et', f).value.trim();
          const date = $('#c-ed', f).value;
          if (!title || !date) return toast('Titel und Datum fehlen noch');
          base.event = { title, date, time: $('#c-es', f).value, endTime: $('#c-ee', f).value, location: $('#c-el', f).value.trim(), desc: $('#c-edesc', f).value.trim(), rsvp: p?.event?.rsvp || { [state.me]: 'yes' } };
        }
        if (base.text) base.mentions = mentionIds(base.text);
        if (p) setDoc('feed', base);
        else {
          addDoc('feed', base);
          const n = myName();
          const tagged = base.text ? emitMentions(base.text, { what: kind === 'voice' ? 'einer Sprachnachricht' : 'einem Beitrag' }) : [];
          const msg = kind === 'poll' ? { title: `📊 Neue Umfrage von ${n}`, body: base.poll.question }
            : kind === 'event' ? { title: `📅 ${n} hat ein Ereignis geplant`, body: `${base.event.title} · ${fmtDay(base.event.date)}${base.event.time ? `, ${base.event.time} Uhr` : ''}` }
            : kind === 'voice' ? { title: `🎤 Sprachnachricht von ${n}`, body: base.text || `${fmtDur(base.voice.duration)} anhören` }
            : { title: `📌 Neuer Beitrag von ${n}`, body: base.text || (base.media?.length ? `${base.media.length === 1 ? (base.media[0].kind === 'video' ? 'Ein Video' : 'Ein Foto') : `${base.media.length} Fotos/Videos`} 📷` : '') };
          // Markierte bekommen die Markierungs-Mitteilung statt der allgemeinen
          const others = state.members.map((m) => m.id).filter((id) => id !== state.me && !tagged.includes(id));
          if (others.length) emit('post_new', { ...msg, body: snippet(msg.body), tab: 'board', to: others });
        }
        haptic(12);
        toast(p ? 'Gespeichert' : '✓ Veröffentlicht');
        api.close();
        if (!p && state.tab !== 'board' && state.tab !== 'home') switchTab('board');
      };
    },
  });
}

function reactSheet(id) {
  openSheet({
    title: 'Reagieren',
    html: `<div class="emoji-pick" style="grid-template-columns:repeat(8,1fr);margin-bottom:14px">${QUICK_REACTIONS.map((e) => `<button data-e="${e}">${e}</button>`).join('')}</div>
      <div class="label" style="margin-bottom:8px">Alle Emojis</div>
      <div class="emoji-pick">${ALL_EMOJIS.map((e) => `<button data-e="${e}">${e}</button>`).join('')}</div>`,
    onMount: (api) => api.body.addEventListener('click', (e) => {
      const b = e.target.closest('[data-e]');
      if (b) { react(id, b.dataset.e); api.close(); }
    }),
  });
}

function commentsSheet(id) {
  const listHtml = () => {
    const p = state.feed.find((x) => x.id === id);
    if (!p) return '<p class="muted">Beitrag wurde gelöscht.</p>';
    const cs = p.comments || [];
    return cs.length ? cs.map((c) => `<div class="comment">${avatar(c.author, 32)}<div style="min-width:0;flex:1">
        <div class="bubble"><div class="who">${esc(dn(c.author))}</div><div class="txt">${richText(c.text)}</div></div>
        <div class="meta"><span>${relTime(c.at)}</span>${c.author === state.me ? `<button data-cdel="${c.id}">Löschen</button>` : ''}</div></div></div>`).join('')
      : '<div class="empty"><div class="big">💬</div>Noch keine Kommentare. Schreib den ersten!</div>';
  };
  openSheet({
    title: 'Kommentare',
    html: `<div id="clist">${listHtml()}</div>
      <form class="composer mention-field" id="cf"><textarea id="ct" rows="1" maxlength="1000" placeholder="Kommentieren …" aria-label="Kommentar"></textarea><button class="send" aria-label="Senden">${I.send}</button></form>`,
    refresh: (api) => {
      const l = $('#clist', api.el);
      const atBottom = api.body.scrollHeight - api.body.scrollTop - api.body.clientHeight < 40;
      l.innerHTML = listHtml();
      if (atBottom) api.body.scrollTop = api.body.scrollHeight;
    },
    onMount: (api) => {
      const ta = $('#ct', api.el);
      attachMentions(ta);
      setTimeout(() => { api.body.scrollTop = api.body.scrollHeight; }, 50);
      ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = Math.min(140, ta.scrollHeight) + 'px'; });
      ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && matchMedia('(hover: hover)').matches) { e.preventDefault(); $('#cf', api.el).requestSubmit(); } });
      $('#cf', api.el).onsubmit = (e) => {
        e.preventDefault();
        const text = ta.value.trim();
        if (!text) return;
        ta.value = ''; ta.style.height = '';
        haptic(8);
        mutate('feed', id, (p) => ({ ...p, comments: [...(p.comments || []), { id: newId(), author: state.me, text, at: Date.now() }] }));
        const post = state.feed.find((x) => x.id === id);
        if (post && post.author !== state.me) {
          emit('social', { title: `💬 ${myName()} hat kommentiert`, body: snippet(text, 120), to: [post.author], tab: 'board', tag: `comment-${id}` });
        }
        emitMentions(text, { exclude: post && post.author !== state.me ? [post.author] : [], what: 'einem Kommentar' });
        setTimeout(() => { api.body.scrollTop = api.body.scrollHeight; }, 80);
      };
      $('#clist', api.el).addEventListener('click', async (e) => {
        const d = e.target.closest('[data-cdel]');
        if (d && await confirmSheet('Kommentar löschen?')) mutate('feed', id, (p) => ({ ...p, comments: (p.comments || []).filter((c) => c.id !== d.dataset.cdel) }));
      });
    },
  });
}

function postMenu(id) {
  const p = state.feed.find((x) => x.id === id);
  if (!p) return;
  const mine = p.author === state.me;
  openSheet({
    title: 'Optionen',
    html: `<div class="menu-list">
      <button data-m="pin">${I.pinned}<span>${p.pinned ? 'Nicht mehr anheften' : 'Oben anheften'}</span></button>
      ${p.type === 'event' ? `<button data-m="cal">${I.cal}<span>Zu meinem Kalender hinzufügen</span></button>` : ''}
      ${mine && p.type === 'poll' ? `<button data-m="close">${I.chart}<span>${p.poll.closed ? 'Umfrage wieder öffnen' : 'Umfrage beenden'}</span></button>` : ''}
      ${mine ? `<button data-m="edit">${I.pen}<span>Bearbeiten</span></button>` : ''}
      ${mine ? `<button data-m="del" class="danger">${I.trash}<span>Löschen</span></button>` : ''}
    </div>`,
    onMount: (api) => api.body.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-m]');
      if (!b) return;
      const m = b.dataset.m;
      api.close();
      if (m === 'pin') mutate('feed', id, (x) => ({ ...x, pinned: !x.pinned }));
      if (m === 'close') mutate('feed', id, (x) => ({ ...x, poll: { ...x.poll, closed: !x.poll.closed } }));
      if (m === 'edit') setTimeout(() => composeSheet(p.type, p), 150);
      if (m === 'cal') {
        const ev = p.event;
        download(`${ev.title.replace(/[^\wäöüÄÖÜß -]/g, '').slice(0, 40) || 'ereignis'}.ics`,
          buildICS([{ uid: p.id, title: ev.title, date: ev.date, time: ev.time, endTime: ev.endTime, location: ev.location, desc: ev.desc, alarm: ev.time ? '-PT1H' : '-PT6H' }]), 'text/calendar');
      }
      if (m === 'del' && await confirmSheet('Diesen Beitrag wirklich löschen?')) {
        if (p.voice?.audioId) { if (player.id === id) stopVoice(); store.remove('audio', p.voice.audioId).catch(() => {}); }
        (p.media || []).forEach((m) => removeMedia(store, m));
        removeDoc('feed', id);
      }
    }),
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   Müll-Erinnerungen (Push)
   – Cloud + VAPID-Schlüssel: echte Push-Mitteilungen, auch wenn die App zu ist
     (Versand per GitHub Action, siehe scripts/send-reminders.mjs)
   – Sonst: Mitteilungen, solange die App geöffnet ist
   ═══════════════════════════════════════════════════════════════════════════ */
const vapidKey = () => VAPID_PUBLIC_KEY || LS.get('vapid');
const notifyPrefs = () => ({ ...DEFAULT_PREFS, enabled: false, ...LS.get('notify', {}) });
const hasNotif = () => typeof Notification !== 'undefined' && 'serviceWorker' in navigator;
const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const canServerPush = () => store?.mode === 'cloud' && !!vapidKey() && 'PushManager' in window;
const nameForPush = (id) => member(id)?.name || 'Jemand';

function b64uToBytes(b64) {
  const pad4 = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad4).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
async function subId(endpoint) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
  return [...new Uint8Array(h)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function notifyCard() {
  if (!state.trash.length) return '';
  const pr = notifyPrefs();
  const on = pr.enabled && hasNotif() && Notification.permission === 'granted';
  return `<button class="card notify-card" data-act="notify">
    <span class="bell ${on ? 'on' : ''}">${I.bell}</span>
    <span class="main"><b>${on ? (pr.trash === false ? 'Müll-Erinnerungen sind aus' : 'Erinnerungen sind an') : 'Erinnerungen einschalten'}</b>
      <span class="small muted">${on
        ? `${pr.dayBefore ? 'Am Vorabend' : 'Am Abholtag'} um ${pr.hour} Uhr${pr.mode === 'mine' ? ' · nur wenn du dran bist' : ''}${pr.followUp ? ` · Nachfassen um ${pr.followHour} Uhr` : ''}`
        : 'Push-Mitteilung, wann welche Tonne raus muss'}</span></span>
    <span class="chev">${I.chev}</span></button>`;
}

/** Betriebssystem & Browser erkennen (für passende Hilfetexte) */
function browserInfo() {
  const ua = navigator.userAgent;
  const os = isIOS() ? (/iPad|Macintosh/.test(ua) ? 'iPadOS' : 'iOS') : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'macOS' : 'Linux';
  const b = /OPR\/|OPT\/|OPX\/|Opera/.test(ua) ? 'Opera' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /EdgA?\//.test(ua) ? 'Edge'
    : /Firefox|FxiOS/.test(ua) ? 'Firefox' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : 'Browser';
  return { os, b };
}
/** So erlaubt man Mitteilungen nachträglich – je nach Gerät und Browser */
function permissionHelp() {
  const { os, b } = browserInfo();
  if (os === 'iOS' || os === 'iPadOS') return '<b>Einstellungen</b> → <b>Mitteilungen</b> → <b>Vermietertagebuch</b> → „Mitteilungen erlauben“ einschalten.';
  if (os === 'Android') {
    if (b === 'Opera') return 'In Opera: <b>Einstellungen</b> → <b>Website-Einstellungen</b> → <b>Benachrichtigungen</b> → diese Seite erlauben. Klappt es dort nicht, die App bitte in <b>Chrome</b> öffnen und dort installieren (⋮ → „App installieren“).';
    if (b === 'Samsung Internet') return 'In Samsung Internet: <b>≡</b> → <b>Einstellungen</b> → <b>Websites und Downloads</b> → <b>Benachrichtigungen</b> → diese Seite erlauben.';
    if (b === 'Firefox') return 'In Firefox: auf das <b>Schloss</b> links neben der Adresse tippen → <b>Benachrichtigungen</b> → erlauben.';
    return 'In Chrome: links neben der Adresse auf das <b>Einstellungs-Symbol</b> tippen → <b>Berechtigungen</b> → <b>Benachrichtigungen</b> → „Zulassen“. Als installierte App: Android-<b>Einstellungen</b> → <b>Apps</b> → <b>Vermietertagebuch</b> → <b>Benachrichtigungen</b> → an.';
  }
  if (b === 'Safari') return 'In Safari: <b>Safari</b> → <b>Einstellungen</b> → <b>Websites</b> → <b>Mitteilungen</b> → diese Seite auf „Erlauben“.';
  if (b === 'Firefox') return 'In Firefox: auf das <b>Schloss</b> links neben der Adresse klicken → Berechtigungen → <b>Benachrichtigungen</b> erlauben.';
  return `In ${b}: auf das <b>Schloss-/Regler-Symbol</b> links neben der Adresse klicken → <b>Benachrichtigungen</b> → „Zulassen“. Danach die Seite neu laden.`;
}
/** Technische Übersicht – hilft beim Fehlersuchen (z. B. Screenshot schicken) */
async function pushDiagnose() {
  const { os, b } = browserInfo();
  let subOk = false;
  try { subOk = !!(await (await navigator.serviceWorker?.getRegistration())?.pushManager?.getSubscription()); } catch { /* egal */ }
  const row = (k, v, ok) => `<div class="diag-row"><span>${k}</span><b class="${ok === true ? 'ok' : ok === false ? 'bad' : ''}">${v}</b></div>`;
  const perm = typeof Notification === 'undefined' ? 'nicht vorhanden' : { granted: 'erlaubt', denied: 'blockiert', default: 'noch nicht gefragt' }[Notification.permission];
  return [
    row('Gerät / Browser', `${os} · ${b}${isStandalone() ? ' · als App' : ''}`),
    row('Mitteilungen', perm, typeof Notification !== 'undefined' ? Notification.permission === 'granted' : false),
    row('Push-Technik', 'PushManager' in window && 'serviceWorker' in navigator ? 'vorhanden' : 'fehlt', 'PushManager' in window),
    row('Push-Abo dieses Geräts', subOk ? 'aktiv' : 'keins', subOk),
    row('Zustellung', PUSH_WORKER_URL ? 'sofort' : 'alle 5 Minuten'),
    LS.get('pushError') ? row('Letzter Fehler', esc(LS.get('pushError')), false) : '',
  ].join('');
}

function pushStatus() {
  const { os, b } = browserInfo();
  if (os === 'Android' && b === 'Opera') {
    return `<div class="banner">🧭 <span><b>Tipp für Opera:</b> Push-Mitteilungen funktionieren in Opera auf Android oft nicht zuverlässig. Am besten den Einladungslink in <b>Chrome</b> öffnen und die App dort installieren (⋮ → „App installieren“).</span></div>`;
  }
  if (isIOS() && !isStandalone()) {
    return `<div class="banner">📱 <span>Auf iPhone/iPad gibt es Mitteilungen nur, wenn die App auf dem Home-Bildschirm ist: <b>Teilen</b> → <b>„Zum Home-Bildschirm“</b>, dann die App von dort öffnen (ab iOS 16.4).</span></div>`;
  }
  if (!hasNotif()) return '<div class="banner">⚠️ <span>Dieser Browser unterstützt leider keine Mitteilungen.</span></div>';
  if (Notification.permission === 'denied') return `<div class="banner">🔕 <span>Mitteilungen sind für diese App blockiert. So erlaubst du sie: ${permissionHelp()}</span></div>`;
  if (store?.mode !== 'cloud') return '<div class="banner">☁️ <span>Im lokalen Modus erinnert die App nur, solange sie geöffnet ist. Für echte Push-Mitteilungen bitte die Synchronisierung einrichten.</span></div>';
  if (!vapidKey()) return '<div class="banner">🛠️ <span>Der Push-Versand ist noch nicht eingerichtet (README → „Push“). Bis dahin erinnert die App, solange sie geöffnet ist.</span></div>';
  return LS.get('pushActive') ? '<div class="banner" style="background:color-mix(in srgb,var(--success) 16%,transparent)">✅ <span>Push ist auf diesem Gerät aktiv – auch wenn die App geschlossen ist.</span></div>' : '';
}

function notifySheet() {
  const pr = notifyPrefs();
  const hours = (sel, from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i)
    .map((h) => `<option value="${h}" ${h === sel ? 'selected' : ''}>${pad(h)}:00 Uhr</option>`).join('');
  openSheet({
    title: 'Mitteilungen',
    html: `${pushStatus()}
      <form id="nf">
        ${toggle('n-on', '🔔 Mitteilungen auf diesem Gerät', pr.enabled || !LS.get('notify'))}
        <div class="label" style="margin:16px 4px 8px">Neuigkeiten aus dem Haus</div>
        ${EVENT_TYPES.map(([k, l]) => toggle(`n-ev-${k}`, l, pr.events?.[k] !== false)).join('')}
        <p class="small muted" style="margin:0 4px 6px">Kommen nach etwa 5–15 Minuten an. Für eigene Aktionen bekommst du keine Mitteilung.</p>
        <div class="label" style="margin:18px 4px 8px">Müll-Erinnerungen</div>
        ${toggle('n-trash', '🗑️ An die Tonnen erinnern', pr.trash !== false)}
        <div class="field"><span class="label">Wann erinnern?</span><div id="n-when">${segmented([['1', 'Am Vorabend'], ['0', 'Am Abholtag']], pr.dayBefore ? '1' : '0', 'noop')}</div></div>
        <div class="field"><label for="n-hour">Uhrzeit</label><select id="n-hour">${hours(pr.hour, 5, 22)}</select></div>
        <div class="field"><span class="label">Wofür?</span><div id="n-mode">${segmented([['all', 'Alle meine Tonnen'], ['mine', 'Nur wenn ich dran bin']], pr.mode, 'noop')}</div>
          <p class="small muted" style="margin:2px 4px 0">„Meine Tonnen“ = alle, die für dich oder das ganze Haus gelten.</p></div>
        ${toggle('n-follow', '⏰ Nachfassen, wenn noch niemand „rausgestellt“ bestätigt hat', pr.followUp)}
        <div class="field" id="n-fh-wrap" ${pr.followUp ? '' : 'hidden'}><label for="n-fh">Nachfassen um</label><select id="n-fh">${hours(pr.followHour, 6, 23)}</select></div>
        <details class="diag"><summary>🔧 Technische Details (bei Problemen)</summary><div id="n-diag" class="small"></div></details>
        <div class="sheet-actions">
          <button type="button" class="btn" id="n-test">${I.bell}Test</button>
          <button class="btn primary" type="submit">Speichern</button>
        </div>
      </form>`,
    onMount: (api) => {
      const f = $('#nf', api.el);
      const val = { when: pr.dayBefore ? '1' : '0', mode: pr.mode };
      f.addEventListener('click', (e) => {
        const b = e.target.closest('.seg button');
        if (!b) return;
        e.stopPropagation();
        const seg = b.parentElement;
        const i = $$('button', seg).indexOf(b);
        seg.style.setProperty('--i', i);
        $$('button', seg).forEach((x) => x.classList.toggle('on', x === b));
        val[seg.parentElement.id === 'n-when' ? 'when' : 'mode'] = b.dataset.v;
      });
      $('#n-follow', f).onchange = (e) => { $('#n-fh-wrap', f).hidden = !e.target.checked; };
      pushDiagnose().then((h) => { const d = $('#n-diag', f); if (d) d.innerHTML = h; });
      $('#n-test', f).onclick = async () => {
        if (!hasNotif()) return toast('Mitteilungen werden hier nicht unterstützt');
        if ((await Notification.requestPermission()) !== 'granted') return toast('🔕 Mitteilungen wurden nicht erlaubt');
        const reg = await navigator.serviceWorker.ready;
        reg.showNotification('🗑️ Gelber Sack rausstellen', { body: 'Morgen ist Abholung. Du bist dran! 💪 (Test)', icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: 'test' });
      };
      f.onsubmit = async (e) => {
        e.preventDefault();
        const prefs = {
          enabled: $('#n-on', f).checked,
          trash: $('#n-trash', f).checked,
          events: Object.fromEntries(EVENT_TYPES.map(([k]) => [k, $(`#n-ev-${k}`, f).checked])),
          dayBefore: val.when === '1',
          hour: +$('#n-hour', f).value,
          mode: val.mode,
          followUp: $('#n-follow', f).checked,
          followHour: +$('#n-fh', f).value,
        };
        if (prefs.followUp && prefs.followHour <= prefs.hour) prefs.followHour = Math.min(23, prefs.hour + 3);
        const btn = e.submitter;
        if (btn) btn.disabled = true;
        const ok = await savePushPrefs(prefs);
        if (btn) btn.disabled = false;
        if (ok) { api.close(); render(); }
      };
    },
  });
}

async function savePushPrefs(prefs) {
  LS.set('notify', prefs);
  if (!prefs.enabled) {
    await unsubscribePush();
    toast('🔕 Mitteilungen aus');
    return true;
  }
  if (!hasNotif()) { toast(isIOS() ? 'Bitte erst zum Home-Bildschirm hinzufügen 📱' : 'Mitteilungen werden hier nicht unterstützt', 4000); return false; }
  let perm = Notification.permission;
  if (perm !== 'granted') {
    try {
      // ältere Browser kennen nur die Rückruf-Variante
      perm = await new Promise((res) => { const p = Notification.requestPermission(res); if (p?.then) p.then(res); });
    } catch { perm = Notification.permission; }
  }
  if (perm !== 'granted') {
    LS.set('pushError', perm === 'denied' ? 'Erlaubnis abgelehnt/blockiert' : 'Erlaubnis-Abfrage nicht beantwortet');
    showPushHelp(perm);
    return false;
  }
  try {
    const active = await syncPushSub(true);
    LS.del('pushError');
    toast(active ? '🔔 Push-Mitteilungen aktiv!' : '🔔 Erinnerungen aktiv (solange die App offen ist)', 3500);
  } catch (e) {
    console.error(e);
    const msg = `${e?.name || 'Fehler'}: ${e?.message || e}`.slice(0, 160);
    LS.set('pushError', msg);
    const { b } = browserInfo();
    const noService = /push service|AbortError|not supported|NotSupported|registration/i.test(msg);
    openSheet({
      title: 'Push klappt hier noch nicht',
      html: `<p style="margin-top:0">${noService
        ? `Dieser Browser (${esc(b)}) konnte keine Verbindung zu seinem Push-Dienst herstellen. Das passiert z. B. in Opera oder in Browsern ohne Google-Dienste.`
        : 'Beim Einrichten der Push-Mitteilungen ist ein Fehler aufgetreten.'}</p>
        <p class="muted small">Am zuverlässigsten: <b>Chrome</b> auf Android, <b>Safari</b> (Home-Bildschirm-App) auf iPhone/iPad, Chrome/Edge/Firefox/Safari am Computer.</p>
        <p class="small muted">Technische Meldung: <code>${esc(msg)}</code></p>
        <div class="sheet-actions"><button class="btn primary" data-close>Okay</button></div>`,
    });
  }
  checkLocalReminders();
  return true;
}

function showPushHelp(perm) {
  openSheet({
    title: perm === 'denied' ? 'Mitteilungen sind blockiert' : 'Erlaubnis fehlt noch',
    html: `<p style="margin-top:0">${perm === 'denied'
      ? 'Mitteilungen wurden für diese App abgelehnt. Der Browser fragt dann nicht noch einmal – du kannst sie aber jederzeit selbst erlauben:'
      : 'Die Abfrage wurde geschlossen oder vom Browser still blockiert (in Chrome erscheint dann eine durchgestrichene Glocke 🔕 in der Adresszeile). So erlaubst du Mitteilungen:'}</p>
      <div class="banner" style="background:var(--fill)"><span>${permissionHelp()}</span></div>
      <p class="small muted">Danach hier noch einmal „Speichern“ tippen.</p>
      <div class="sheet-actions"><button class="btn primary" data-close>Verstanden</button></div>`,
  });
}

/** Push-Abo beim Server (Firestore „subs“) anlegen/aktualisieren. Gibt true zurück, wenn Server-Push aktiv ist. */
async function syncPushSub(create = false) {
  const prefs = notifyPrefs();
  if (!prefs.enabled || !hasNotif() || Notification.permission !== 'granted' || !canServerPush() || !state.me) {
    LS.set('pushActive', false);
    return false;
  }
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub && create) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(vapidKey()) });
  if (!sub) { LS.set('pushActive', false); return false; }
  const id = await subId(sub.endpoint);
  const old = await store.get('subs', id).catch(() => null);
  await store.set('subs', id, {
    ...(old || {}),
    memberId: state.me,
    subscription: sub.toJSON(),
    prefs,
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Berlin',
    device: navigator.userAgent.slice(0, 140),
    updatedAt: Date.now(),
    sent: old?.sent || [],
  });
  LS.set('pushActive', true);
  return true;
}
async function unsubscribePush() {
  LS.set('pushActive', false);
  try {
    const reg = await navigator.serviceWorker?.ready;
    const sub = await reg?.pushManager?.getSubscription();
    if (!sub) return;
    if (store?.mode === 'cloud') await store.remove('subs', await subId(sub.endpoint)).catch(() => {});
    await sub.unsubscribe();
  } catch (e) { console.error(e); }
}

/** Erinnerungen direkt aus der geöffneten App (wenn kein Server-Push aktiv ist) */
async function checkLocalReminders() {
  const prefs = notifyPrefs();
  if (!state.ready || !state.me || !prefs.enabled || LS.get('pushActive') || !hasNotif() || Notification.permission !== 'granted') return;
  const sent = LS.get('sentLocal', []);
  const due = dueReminders({ bins: state.trash, memberId: state.me, memberIds: memberIds(), prefs, date: today(), hour: new Date().getHours(), sent });
  if (!due.length) return;
  LS.set('sentLocal', [...due.map((r) => r.key), ...sent].slice(0, 120));
  const reg = await navigator.serviceWorker.ready;
  for (const r of due) {
    const t = reminderText(r, { memberId: state.me, nameOf: nameForPush, today: today() });
    reg.showNotification(t.title, {
      body: t.body, tag: `${r.bin.id}:${r.date}`, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png',
      data: { url: './?tab=trash', bin: r.bin.id, date: r.date },
      actions: [{ action: 'done', title: '✓ Rausgestellt' }],
    });
  }
}

/** Bestätigung aus einer Mitteilung heraus (nie versehentlich zurücknehmen) */
function confirmFromNotification(binId, date) {
  const bin = state.trash.find((b) => b.id === binId);
  if (!bin) return;
  state.tab = 'trash';
  renderNow(true);
  if (doneInfo(bin, date)) return toast(`✓ ${bin.name} wurde schon von ${nameOf(doneInfo(bin, date).by)} bestätigt`);
  toggleBinDone(binId, date);
}

/* ═══════════════════════════════════════════════════════════════════════════
   Sheets: Mitglieder & Haus
   ═══════════════════════════════════════════════════════════════════════════ */
function memberForm(v, submitLabel) {
  return `<form id="mf">
    <div class="profile-photo">
      <div id="prev">${previewAv(v)}</div>
      <div class="row" style="justify-content:center;gap:8px;flex-wrap:wrap">
        <label class="btn sm attach-btn">${I.photo}${v.photo ? 'Foto ändern' : 'Profilbild wählen'}<input type="file" id="m-photo" accept="image/*" hidden></label>
        <button type="button" class="btn sm danger" id="m-photo-del" ${v.photo ? '' : 'hidden'}>Entfernen</button>
      </div>
    </div>
    <div class="field"><label for="m-name">Name</label><input id="m-name" required maxlength="30" placeholder="Dein Name" value="${esc(v.name)}" autofocus></div>
    <div class="field"><label for="m-floor">Stockwerk</label><select id="m-floor"><option value="">– keine Angabe –</option>${FLOORS.map(([k, l]) => `<option value="${k}" ${v.floor === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    <div class="field"><span class="label">Emoji</span><div class="emoji-pick" id="m-emo">${MEMBER_EMOJIS.map((e) => `<button type="button" class="${e === v.emoji ? 'on' : ''}" data-e="${e}">${e}</button>`).join('')}</div></div>
    <div class="field"><span class="label">Farbe</span><div class="swatches" id="m-col">${MEMBER_COLORS.map((c) => `<button type="button" class="swatch ${c === v.color ? 'on' : ''}" style="--c:${c}" data-c="${c}" aria-label="Farbe ${c}"></button>`).join('')}</div></div>
    <div class="sheet-actions">${v.id && v.id !== state.me && state.members.length > 1 ? '<button type="button" class="btn danger" id="m-del">Entfernen</button>' : ''}<button class="btn primary" type="submit">${submitLabel}</button></div>
  </form>`;
}
const previewAv = (v) => (v.photo
  ? `<span class="av photo" style="--s:96px;--c:${esc(v.color)}"><img src="${esc(v.photo)}" alt=""></span>`
  : `<span class="av" style="--s:96px;--c:${esc(v.color)}">${esc(v.emoji)}</span>`);
function bindMemberForm(root, v, onSubmit) {
  const f = $('#mf', root);
  f.addEventListener('click', (e) => {
    const em = e.target.closest('[data-e]');
    if (em) { v.emoji = em.dataset.e; $$('#m-emo button', f).forEach((x) => x.classList.toggle('on', x === em)); }
    const c = e.target.closest('[data-c]');
    if (c) { v.color = c.dataset.c; $$('#m-col button', f).forEach((x) => x.classList.toggle('on', x === c)); }
    if (em || c) $('#prev', f).innerHTML = previewAv(v);
  });
  const photoIn = $('#m-photo', f);
  const delBtn = $('#m-photo-del', f);
  const syncPhotoUI = () => {
    $('#prev', f).innerHTML = previewAv(v);
    delBtn.hidden = !v.photo;
    photoIn.parentElement.childNodes[1].textContent = v.photo ? 'Foto ändern' : 'Profilbild wählen';
  };
  photoIn.onchange = async () => {
    const file = photoIn.files[0];
    photoIn.value = '';
    if (!file) return;
    const photo = await cropPhoto(file);
    if (photo) { v.photo = photo; syncPhotoUI(); }
  };
  delBtn.onclick = () => { v.photo = null; syncPhotoUI(); };
  f.onsubmit = (e) => {
    e.preventDefault();
    v.name = $('#m-name', f).value.trim();
    v.floor = $('#m-floor', f).value || null;
    if (v.name) onSubmit(v);
  };
  return f;
}
/** Profilbild zuschneiden: verschieben (Finger/Maus), zoomen (Regler, zwei Finger, Mausrad).
 *  Liefert ein quadratisches JPEG (320 px) als Data-URL oder null. */
function cropPhoto(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onerror = () => { URL.revokeObjectURL(url); toast('⚠️ Dieses Bild kann nicht geöffnet werden'); resolve(null); };
    img.onload = () => {
      let done = false;
      const finish = (val) => { if (done) return; done = true; URL.revokeObjectURL(url); resolve(val); };
      openSheet({
        title: 'Profilbild zuschneiden',
        html: `<p class="small muted center" style="margin:0 0 12px">Verschieben mit dem Finger, zoomen mit dem Regler oder zwei Fingern.</p>
          <div class="crop-stage" id="cs"><img id="ci" alt="" draggable="false"><div class="crop-mask"></div></div>
          <div class="crop-zoom">${I.photo}<input type="range" id="cz" min="1" max="4" step="0.01" value="1" aria-label="Zoom"></div>
          <div class="sheet-actions"><button type="button" class="btn" data-close>Abbrechen</button><button type="button" class="btn primary" id="cok">Übernehmen</button></div>`,
        onClose: () => finish(null),
        onMount: (api) => {
          const stage = $('#cs', api.el), el = $('#ci', api.el), zoomIn = $('#cz', api.el);
          el.src = url;
          const W = img.naturalWidth, H = img.naturalHeight;
          let S = stage.clientWidth || 280;
          let z = 1, ox = 0, oy = 0;
          const base = () => S / Math.min(W, H);
          const clamp = () => {
            const dw = W * base() * z, dh = H * base() * z;
            ox = Math.max(-(dw - S) / 2, Math.min((dw - S) / 2, ox));
            oy = Math.max(-(dh - S) / 2, Math.min((dh - S) / 2, oy));
          };
          const draw = () => {
            clamp();
            const dw = W * base() * z, dh = H * base() * z;
            el.style.width = `${dw}px`;
            el.style.height = `${dh}px`;
            el.style.transform = `translate3d(${(S - dw) / 2 + ox}px, ${(S - dh) / 2 + oy}px, 0)`;
          };
          const setZoom = (nz) => { z = Math.max(1, Math.min(4, nz)); zoomIn.value = z; draw(); };
          new ResizeObserver(() => { S = stage.clientWidth || S; draw(); }).observe(stage);
          draw();
          zoomIn.oninput = () => setZoom(+zoomIn.value);
          stage.addEventListener('wheel', (e) => { e.preventDefault(); setZoom(z * (e.deltaY < 0 ? 1.08 : 1 / 1.08)); }, { passive: false });
          const pts = new Map();
          let pinch = null;
          stage.addEventListener('pointerdown', (e) => {
            stage.setPointerCapture(e.pointerId);
            pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (pts.size === 2) {
              const [a, b] = [...pts.values()];
              pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z };
            }
          });
          stage.addEventListener('pointermove', (e) => {
            const prev = pts.get(e.pointerId);
            if (!prev) return;
            const cur = { x: e.clientX, y: e.clientY };
            pts.set(e.pointerId, cur);
            if (pts.size === 2 && pinch) {
              const [a, b] = [...pts.values()];
              setZoom(pinch.z * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.d));
            } else if (pts.size === 1) {
              ox += cur.x - prev.x; oy += cur.y - prev.y; draw();
            }
          });
          const up = (e) => { pts.delete(e.pointerId); if (pts.size < 2) pinch = null; };
          stage.addEventListener('pointerup', up);
          stage.addEventListener('pointercancel', up);
          $('#cok', api.el).onclick = () => {
            const k = base() * z;
            const dw = W * k, dh = H * k;
            const left = (S - dw) / 2 + ox, top = (S - dh) / 2 + oy;
            const c = document.createElement('canvas');
            c.width = c.height = 320;
            const ctx = c.getContext('2d');
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, -left / k, -top / k, S / k, S / k, 0, 0, 320, 320);
            finish(c.toDataURL('image/jpeg', 0.86));
            api.close();
          };
        },
      });
    };
    img.src = url;
  });
}

const randomMember = () => {
  const used = new Set(state.members.map((m) => m.color));
  return {
    name: '',
    emoji: MEMBER_EMOJIS[Math.floor(Math.random() * MEMBER_EMOJIS.length)],
    color: MEMBER_COLORS.find((c) => !used.has(c)) || MEMBER_COLORS[0],
  };
};

function memberSheet(id, { asMe = false } = {}) {
  const m = id ? member(id) : null;
  const v = m ? { ...m } : randomMember();
  openSheet({
    title: m ? (m.id === state.me ? 'Mein Profil' : dn(m.id)) : asMe ? 'Wer bist du?' : 'Mitglied hinzufügen',
    html: `${m && m.id !== state.me ? `<div class="row" style="gap:8px;margin-bottom:14px"><button type="button" class="btn block primary" id="m-dm">${I.dm}Nachricht</button><button type="button" class="btn block" id="m-task">${I.tasks}Aufgabe</button></div>
      <div class="field nick-field"><label for="m-nick">🏷️ Dein Spitzname für ${esc(m.name)}</label><input id="m-nick" maxlength="30" placeholder="z. B. Schatz, Flocke …" value="${esc(nickOf(m.id))}">
        <p class="small muted" style="margin:6px 4px 0">Nur du siehst ihn – überall in der App statt „${esc(m.name)}“.</p></div>
      <div class="divider">Profil von ${esc(m.name)}</div>` : ''}${!m && !asMe ? '<p class="small muted" style="margin-top:0">Für Personen ohne eigenes Gerät – sie können trotzdem Aufgaben und Müll-Dienste bekommen.</p>' : ''}${m && m.id !== state.me && presenceText(m.id) ? `<p class="center small" style="margin:0 0 10px">${presenceText(m.id)}</p>` : ''}${memberForm(v, m ? 'Speichern' : 'Hinzufügen')}`,
    onMount: (api) => {
      const f = bindMemberForm(api.el, v, (val) => {
        if (m) mutate('members', m.id, (cur) => ({ ...cur, name: val.name, emoji: val.emoji, color: val.color, photo: val.photo || null, floor: val.floor }));
        else {
          const nid = addDoc('members', { name: val.name, emoji: val.emoji, color: val.color, photo: val.photo || null, floor: val.floor, createdAt: Date.now() });
          if (asMe) { state.me = nid; LS.set('me', nid); }
        }
        toast(m ? 'Gespeichert' : `👋 Willkommen, ${val.name}!`);
        api.close();
      });
      $('#m-dm', api.el)?.addEventListener('click', () => { api.close(); chatSheet(m.id); });
      $('#m-task', api.el)?.addEventListener('click', () => { api.close(); taskSheet(null, { assignee: m.id, title: `Aufgabe für ${dn(m.id)}` }); });
      const nickIn = $('#m-nick', api.el);
      nickIn?.addEventListener('change', () => {
        const val = nickIn.value.trim().slice(0, 30);
        if (val === nickOf(m.id)) return;
        mutate('members', state.me, (x) => { const n = { ...(x.nick || {}) }; if (val) n[m.id] = val; else delete n[m.id]; return { ...x, nick: n }; });
        $('.sheet-head h2', api.el).textContent = val || m.name;
        toast(val ? `🏷️ ${m.name} heißt für dich jetzt „${val}“` : 'Spitzname entfernt');
      });
      nickIn?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); nickIn.blur(); } });
      $('#m-del', f)?.addEventListener('click', async () => {
        if (await confirmSheet(`${m.name} aus dem Haus entfernen? Zugewiesene Aufgaben werden „für alle“.`)) {
          state.tasks.filter((t) => t.assignee === m.id).forEach((t) => mutate('tasks', t.id, (x) => ({ ...x, assignee: null })));
          removeDoc('members', m.id);
          api.close();
        }
      });
    },
  });
}

function inviteLink() {
  const u = new URL(location.href.split('?')[0].split('#')[0]);
  u.searchParams.set('haus', state.hid);
  if (!FIREBASE_CONFIG && LS.get('fbconfig')) u.searchParams.set('cfg', b64e(JSON.stringify(LS.get('fbconfig'))));
  if (!VAPID_PUBLIC_KEY && LS.get('vapid')) u.searchParams.set('vk', LS.get('vapid'));
  return u.toString();
}

function parseConfig(text) {
  const t = text.trim();
  try { return JSON.parse(t); } catch { /* weiter */ }
  const obj = {};
  for (const m of t.matchAll(/(\w+)\s*:\s*["'`]([^"'`]+)["'`]/g)) obj[m[1]] = m[2];
  return obj.apiKey && obj.projectId ? obj : null;
}

function cloudSheet() {
  const cfg = cloudConfig();
  openSheet({
    title: 'Synchronisierung',
    html: `${store?.mode === 'cloud'
      ? `<div class="banner" style="background:color-mix(in srgb,var(--success) 16%,transparent)">✅ <span>Verbunden mit Firebase-Projekt <b>${esc(cfg?.projectId)}</b>. Alle Geräte mit dem Haus-Code sehen dieselben Daten.</span></div>`
      : `<p class="muted" style="margin-top:0">Damit alle im Haus dieselben Aufgaben, Beiträge und den Müllplan sehen, braucht die App einen kostenlosen Firebase-Speicher. Das richtet eine Person einmal ein (ca. 5 Minuten, Anleitung in der README).</p>`}
      ${FIREBASE_CONFIG ? '<p class="small muted">Die Konfiguration ist fest in <code>js/config.js</code> hinterlegt.</p>' : `
      <div class="field"><label for="cfg">Firebase-Konfiguration einfügen</label>
        <textarea id="cfg" style="min-height:150px;font-family:ui-monospace,monospace;font-size:13px" placeholder='{ "apiKey": "…", "authDomain": "…", "projectId": "…", "appId": "…" }'>${cfg ? esc(JSON.stringify(cfg, null, 2)) : ''}</textarea></div>
      ${VAPID_PUBLIC_KEY ? '' : `<div class="field"><label for="vk">VAPID Public Key (optional, für Push)</label><input id="vk" autocomplete="off" spellcheck="false" style="font-family:ui-monospace,monospace;font-size:13px" placeholder="BP…" value="${esc(LS.get('vapid') || '')}"></div>`}
      <div class="sheet-actions">
        ${cfg ? '<button class="btn danger" id="cfg-off">Trennen</button>' : ''}
        <button class="btn primary" id="cfg-save">${store?.mode === 'cloud' ? 'Aktualisieren' : 'Verbinden & Daten hochladen'}</button>
      </div>`}`,
    onMount: (api) => {
      $('#cfg-save', api.el)?.addEventListener('click', async (e) => {
        const c = parseConfig($('#cfg', api.el).value);
        if (!c) return toast('Das sieht nicht nach einer Firebase-Konfiguration aus');
        const vk = $('#vk', api.el)?.value.trim();
        if (vk) LS.set('vapid', vk); else if ($('#vk', api.el)) LS.del('vapid');
        e.target.disabled = true;
        e.target.textContent = 'Verbinde …';
        try {
          if (!state.ready) {
            // Noch kein Haus offen (Willkommensbildschirm): nur Verbindung testen und speichern
            await createStore('verbindungstest', c);
            LS.set('fbconfig', c);
            toast('✓ Verbunden! Jetzt Haus anlegen oder beitreten.');
            setTimeout(() => location.reload(), 900);
            return;
          }
          const cloud = await createStore(state.hid, c);
          if (!(await cloud.getHouse())) {
            // Lokale Daten in die Cloud übernehmen
            await cloud.setHouse(state.house || { name: 'Unser Haus', createdAt: Date.now() });
            const local = readLocal(state.hid);
            for (const col of [...COLLECTIONS, 'audio', 'chunks']) for (const doc of Object.values(local[col] || {})) await cloud.set(col, doc.id, doc);
          }
          LS.set('fbconfig', c);
          toast('✓ Verbunden!');
          setTimeout(() => location.reload(), 600);
        } catch (err) {
          console.error(err);
          toast('⚠️ Verbindung fehlgeschlagen – Konfiguration & Firestore-Regeln prüfen', 4500);
          e.target.disabled = false;
          e.target.textContent = 'Erneut versuchen';
        }
      });
      $('#cfg-off', api.el)?.addEventListener('click', async () => {
        if (await confirmSheet('Synchronisierung auf diesem Gerät trennen? Die App nutzt dann wieder lokale Daten.', 'Trennen')) {
          LS.del('fbconfig'); location.reload();
        }
      });
    },
  });
}

function exportData() {
  const data = { app: 'vermietertagebuch', version: 1, exportedAt: new Date().toISOString(), hid: state.hid, house: state.house };
  COLLECTIONS.forEach((c) => { data[c] = state[c]; });
  download(`vermietertagebuch-${today()}.json`, JSON.stringify(data, null, 2), 'application/json');
}
function importData() {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = '.json,application/json';
  inp.onchange = async () => {
    try {
      const data = JSON.parse(await inp.files[0].text());
      if (data.app !== 'vermietertagebuch') throw new Error('falsches Format');
      if (!(await confirmSheet('Backup einspielen? Vorhandene Einträge mit gleicher ID werden überschrieben.', 'Einspielen', false))) return;
      for (const c of COLLECTIONS) for (const d of data[c] || []) await store.set(c, d.id, d);
      toast('✓ Backup wiederhergestellt');
    } catch (e) { console.error(e); toast('⚠️ Datei konnte nicht gelesen werden'); }
  };
  inp.click();
}

/* ═══════════════════════════════════════════════════════════════════════════
   Aktionen (Event-Delegation)
   ═══════════════════════════════════════════════════════════════════════════ */
const ACTIONS = {
  tab: (d) => switchTab(d.v),
  noop: () => {},
  profile: () => memberSheet(state.me),
  add: () => onFab(),
  dms: () => dmListSheet(),
  'dm-open': (d) => chatSheet(d.id),
  'goto-tasks': (d) => { state.taskView = 'open'; state.taskPerson = d.v; switchTab('tasks'); },
  'goto-person': (d) => { state.taskView = 'open'; state.taskPerson = d.id === state.me ? 'mine' : d.id; switchTab('tasks'); },
  'goto-feed': (d) => { state.feedFilter = d.v; switchTab('board'); },
  'task-toggle': (d) => toggleTask(d.id),
  'task-edit': (d) => taskSheet(d.id),
  'task-new': () => taskSheet(),
  'task-view': (d) => { state.taskView = d.v; renderNow(false); },
  'task-person': (d) => { state.taskPerson = d.v; renderNow(false); },
  'tasks-clear': async () => {
    const done = state.tasks.filter((t) => t.done);
    if (done.length && await confirmSheet(`${plural(done.length, 'erledigte Aufgabe', 'erledigte Aufgaben')} endgültig löschen?`)) done.forEach((t) => removeDoc('tasks', t.id));
  },
  'bin-done': (d) => toggleBinDone(d.id, d.date),
  'bin-scope': (d) => { state.binScope = d.v; LS.set('binScope', d.v); renderNow(false); },
  notify: () => notifySheet(),
  'bin-new': () => binSheet(),
  'bin-edit': (d) => binSheet(d.id),
  'ics-import': () => icsImport(),
  'ics-export': () => icsExport(),
  'cal-move': (d) => {
    const cm = parseISO((state.calMonth || today().slice(0, 7)) + '-01');
    cm.setMonth(cm.getMonth() + +d.v);
    state.calMonth = iso(cm).slice(0, 7);
    renderNow(false);
  },
  'cal-day': (d) => {
    const body = () => {
    const ps = pickups(d.v, d.v, state.binScope);
    const ev = state.feed.filter((p) => p.type === 'event' && p.event?.date === d.v);
    if (!ps.length && !ev.length) return '<p class="muted center" style="margin:4px 0 0">An diesem Tag ist noch nichts eingetragen.</p>';
    return `<div class="list card tight">${ps.map((p) => `<div class="list-item">${binIcon(p.bin)}<div class="main"><div class="title">${esc(p.bin.name)}</div><div class="sub bin-who">${binWhoHtml(p)}</div></div></div><div class="confirm-row">${confirmBox(p)}</div>`).join('')}
        ${ev.map((p) => `<div class="list-item"><span class="bin-icon" style="--c:#ff3b30">${I.cal}</span><div class="main"><div class="title">${esc(p.event.title)}</div><div class="sub">${p.event.time ? `${esc(p.event.time)} Uhr` : 'Ganztägig'}${p.event.location ? ` · ${esc(p.event.location)}` : ''}</div></div></div>`).join('')}</div>`;
    };
    openSheet({
      title: fmtLong(d.v),
      html: `<div id="cd">${body()}</div>
        <div class="menu-list" style="margin-top:12px">
          <button data-day-act="bin">${I.trash}<span>Tonne ab diesem Tag anlegen<span class="desc">z. B. Restmüll alle 2 Wochen ab ${esc(fmt(d.v, { day: 'numeric', month: 'long' }))}</span></span></button>
          <button data-day-act="event">${I.cal}<span>Ereignis an diesem Tag<span class="desc">Grillabend, Handwerker, Geburtstag …</span></span></button>
        </div>`,
      refresh: (api) => { $('#cd', api.el).innerHTML = body(); },
      onMount: (api) => api.body.addEventListener('click', (e) => {
        const b = e.target.closest('[data-day-act]');
        if (!b) return;
        api.close();
        setTimeout(() => (b.dataset.dayAct === 'bin' ? binSheet(null, { start: d.v }) : composeSheet('event', null, { date: d.v })), 150);
      }),
    });
  },
  'feed-filter': (d) => { state.feedFilter = d.v; renderNow(false); },
  compose: (d) => composeSheet(d.v),
  like: (d) => toggleLike(d.id),
  react: (d) => react(d.id, d.e),
  'react-pick': (d) => reactSheet(d.id),
  'voice-play': (d) => playVoice(d.id),
  'media-open': (d) => openViewer(d.id, +d.i),
  comments: (d) => commentsSheet(d.id),
  'post-menu': (d) => postMenu(d.id),
  vote: (d) => vote(d.id, d.opt),
  rsvp: (d) => rsvp(d.id, d.v),
  'member-new': () => memberSheet(null),
  'member-edit': (d) => memberSheet(d.id),
  theme: (d) => { LS.set('theme', d.v); applyTheme(); renderNow(false); },
  palette: (d) => { LS.set('palette', d.v); applyPalette(); haptic(8); renderNow(false); },
  cloud: () => cloudSheet(),
  'copy-invite': async () => {
    try { await navigator.clipboard.writeText(inviteLink()); toast('🔗 Einladungslink kopiert'); } catch { prompt('Einladungslink:', inviteLink()); }
  },
  'share-invite': async () => {
    try { await navigator.share({ title: 'Vermietertagebuch', text: `Komm in unser Haus „${state.house?.name || ''}“ im Vermietertagebuch 🏠`, url: inviteLink() }); } catch { /* abgebrochen */ }
  },
  'house-rename': () => {
    openSheet({
      title: 'Haus umbenennen',
      html: `<form id="hf"><div class="field"><label for="h-name">Name</label><input id="h-name" maxlength="40" value="${esc(state.house?.name || '')}" autofocus></div><div class="sheet-actions"><button class="btn primary">Speichern</button></div></form>`,
      onMount: (api) => {
        $('#hf', api.el).onsubmit = async (e) => {
          e.preventDefault();
          const name = $('#h-name', api.el).value.trim();
          if (!name) return;
          state.house = { ...(state.house || {}), name };
          await store.setHouse(state.house);
          render(); api.close();
        };
      },
    });
  },
  export: () => exportData(),
  import: () => importData(),
  'switch-user': () => whoAreYou(true),
  leave: async () => {
    if (await confirmSheet('Haus auf diesem Gerät verlassen? Die Daten bleiben für alle anderen erhalten. Du kannst mit dem Code jederzeit zurück.', 'Verlassen')) {
      LS.del('house'); LS.del('me'); location.reload();
    }
  },
};
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el.closest('form#f')) return;
  const fn = ACTIONS[el.dataset.act];
  if (fn) { e.preventDefault(); fn(el.dataset, el, e); }
});

/* ═══════════════════════════════════════════════════════════════════════════
   Onboarding
   ═══════════════════════════════════════════════════════════════════════════ */
/* ─── Farbschemata ────────────────────────────────────────────────────────
   accent/accent2: Akzentfarben (hell, dunkel), light/dark: die vier Hintergrund-Farbflecken */
const PALETTES = {
  indigo: { name: 'Indigo', accent: ['#0a7cff', '#3d9bff'], accent2: ['#5e5ce6', '#7d7aff'],
    light: ['#7cc4ff', '#ffb1d6', '#b9a7ff', '#ffd89a'], dark: ['#1f5fd1', '#a8326e', '#5a3fd1', '#b8701a'] },
  ocean: { name: 'Ozean', accent: ['#0891b2', '#22c3e6'], accent2: ['#0f766e', '#2dd4bf'],
    light: ['#7dd3fc', '#99f6e4', '#a5b4fc', '#bae6fd'], dark: ['#0c4a6e', '#115e59', '#1e3a8a', '#155e75'] },
  sunset: { name: 'Sonnenuntergang', accent: ['#ea580c', '#fb8c3c'], accent2: ['#db2777', '#f472b6'],
    light: ['#fdba74', '#f9a8d4', '#fca5a5', '#fde68a'], dark: ['#9a3412', '#9d174d', '#7f1d1d', '#92400e'] },
  forest: { name: 'Wald', accent: ['#16a34a', '#34d36e'], accent2: ['#65a30d', '#a3e635'],
    light: ['#86efac', '#d9f99d', '#a7f3d0', '#fde68a'], dark: ['#14532d', '#3f6212', '#065f46', '#713f12'] },
  rose: { name: 'Rosé', accent: ['#e11d74', '#f472b6'], accent2: ['#a855f7', '#c084fc'],
    light: ['#fbcfe8', '#f5d0fe', '#fecdd3', '#ddd6fe'], dark: ['#831843', '#701a75', '#881337', '#4c1d95'] },
  graphite: { name: 'Graphit', accent: ['#3f3f46', '#d4d4d8'], accent2: ['#52525b', '#a1a1aa'],
    light: ['#d4d4d8', '#e4e4e7', '#cbd5e1', '#e7e5e4'], dark: ['#27272a', '#3f3f46', '#1e293b', '#292524'] },
};
/** Relative Leuchtdichte (WCAG) einer Hex-Farbe */
function luminance(hex) {
  const m = String(hex).replace('#', '').match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return 0.2;
  const [r, g, b] = m.slice(1).map((x) => { const c = parseInt(x, 16) / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const darken = (hex, t) => '#' + String(hex).replace('#', '').match(/../g).map((x) => Math.round(parseInt(x, 16) * (1 - t)).toString(16).padStart(2, '0')).join('');
/** Knopf-Farben: möglichst weiße Schrift (Knopf dafür etwas dunkler), sonst dunkle Schrift – immer Kontrast ≥ 4,5:1 */
function buttonColors(hex) {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return { bg: hex, fg: '#ffffff' };
  for (let t = 0; t <= 0.3; t += 0.02) {
    const bg = t ? darken(hex, t) : hex;
    if (contrast(bg, '#ffffff') >= 4.5) return { bg, fg: '#ffffff' };
  }
  return { bg: hex, fg: '#111216' };
}
const isDark = () => {
  const t = LS.get('theme', 'auto');
  return t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
};
function applyPalette() {
  const key = LS.get('palette', 'indigo');
  const custom = LS.get('accentCustom', null);
  const p = PALETTES[key] || PALETTES.indigo;
  const d = isDark() ? 1 : 0;
  const st = document.documentElement.style;
  const accent = key === 'custom' && custom ? custom : p.accent[d];
  st.setProperty('--accent', accent);
  // Knöpfe & Akzentflächen: gut lesbare Schrift, Fläche bei Bedarf leicht abgedunkelt
  const btn = buttonColors(accent);
  st.setProperty('--accent-btn', btn.bg);
  st.setProperty('--on-accent', btn.fg);
  st.setProperty('--accent-2', key === 'custom' && custom ? `color-mix(in srgb, ${custom} 70%, #7d7aff)` : p.accent2[d]);
  const blobs = key === 'custom' && custom
    ? [custom, `color-mix(in srgb, ${custom} 55%, ${d ? '#000' : '#fff'})`, `color-mix(in srgb, ${custom} 60%, #ff7ab6)`, `color-mix(in srgb, ${custom} 50%, #ffd27a)`]
    : p[d ? 'dark' : 'light'];
  blobs.forEach((c, i) => st.setProperty(`--blob-${i + 1}`, c));
  // Für die Startanimation merken (wird beim nächsten Start sofort im HTML genutzt)
  LS.set('splash', { accent: btn.bg, fg: btn.fg, blobs: blobs.slice(0, 3) });
}
function applyTheme() {
  const t = LS.get('theme', 'auto');
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.dataset.theme = t;
  applyPalette();
}
function paletteHtml() {
  const cur = LS.get('palette', 'indigo');
  const d = isDark() ? 1 : 0;
  return `<div class="palettes">${Object.entries(PALETTES).map(([k, p]) => `
    <button class="palette ${cur === k ? 'on' : ''}" data-act="palette" data-v="${k}" aria-label="Farbschema ${p.name}">
      <span class="pal-swatch" style="background:linear-gradient(135deg, ${p[d ? 'dark' : 'light'][0]}, ${p[d ? 'dark' : 'light'][1]} 55%, ${p[d ? 'dark' : 'light'][2]})"><i style="background:${p.accent[d]}"></i></span>
      <span>${p.name}</span></button>`).join('')}
    <label class="palette ${cur === 'custom' ? 'on' : ''}" aria-label="Eigene Farbe">
      <span class="pal-swatch custom" style="${LS.get('accentCustom') ? `background:${esc(LS.get('accentCustom'))}` : ''}"><input type="color" id="pal-custom" value="${esc(LS.get('accentCustom', '#7c5cff'))}"></span>
      <span>Eigene</span></label>
  </div>`;
}

const LOGO = `<div class="logo"><img src="icons/icon.svg?v=3" alt=""></div>`;

function showWelcome() {
  $('#dock').hidden = true;
  const hasCloud = !!cloudConfig();
  $('#view').innerHTML = `<div class="welcome"><div class="card center">
    ${LOGO}
    <h1>Vermietertagebuch</h1>
    <p class="muted" style="margin:0 0 22px">Aufgaben, Müllabfuhr, Social Hub, Umfragen & Ereignisse – für eure ganze Hausgemeinschaft.</p>
    <form id="new" style="text-align:left">
      <div class="field"><label for="w-name">Wie heißt euer Haus?</label><input id="w-name" maxlength="40" placeholder="z. B. Villa Kunterbunt" required></div>
      <button class="btn primary block">${I.sparkle}Neues Haus anlegen</button>
    </form>
    <div class="divider">oder</div>
    <form id="join" style="text-align:left">
      <div class="field"><label for="w-code">Haus-Code</label><input id="w-code" placeholder="XXXXX-XXXXX" autocapitalize="characters" autocomplete="off" required style="text-transform:uppercase;letter-spacing:.08em"></div>
      <button class="btn block">${I.door}Beitreten</button>
    </form>
    ${hasCloud ? '' : `<p class="small muted" style="margin:18px 0 0">Zum Beitreten auf mehreren Geräten wird die Synchronisierung benötigt. Am einfachsten: den Einladungslink öffnen. <button class="link" style="color:var(--accent);font-weight:650" id="w-cloud">Selbst einrichten</button></p>`}
  </div></div>`;
  $('#new').onsubmit = async (e) => {
    e.preventDefault();
    const name = $('#w-name').value.trim();
    const hid = genCode();
    e.submitter && (e.submitter.disabled = true);
    try {
      await connect(hid, { create: { name, createdAt: Date.now() } });
    } catch (err) {
      console.error(err);
      toast('⚠️ Konnte das Haus nicht anlegen');
      e.submitter && (e.submitter.disabled = false);
    }
  };
  $('#join').onsubmit = async (e) => {
    e.preventDefault();
    const hid = normCode($('#w-code').value);
    if (!cloudConfig()) return toast('Bitte zuerst die Synchronisierung einrichten oder den Einladungslink nutzen', 4000);
    try { await connect(hid); } catch (err) { console.error(err); toast('⚠️ Verbindung fehlgeschlagen'); }
  };
  $('#w-cloud')?.addEventListener('click', () => cloudSheet());
}

function whoAreYou(switching = false) {
  const synced = () => state.synced.has('members');
  const pickHtml = () => {
    const people = membersSorted();
    if (!people.length) {
      return synced()
        ? '<p class="muted center" style="margin:0">Noch niemand im Haus – du bist die erste Person! Erstelle unten dein Profil.</p>'
        : '<div class="center" style="padding:10px 0"><div class="spinner" style="margin:0 auto 10px"></div><p class="small muted" style="margin:0">Profile werden geladen …</p></div>';
    }
    return `<div class="profile-pick">${people.map((p) => `<button data-pick="${p.id}" class="${p.id === state.me ? 'on' : ''}">${avatar(p.id, 56)}<span>${esc(p.name)}</span>${presenceText(p.id) && p.id !== state.me ? `<span class="small">${presenceText(p.id)}</span>` : ''}</button>`).join('')}</div>`;
  };
  const s = openSheet({
    title: switching ? 'Profil wechseln' : 'Willkommen im Haus! 👋',
    html: `<div class="who-step">
        <div class="label" style="margin:0 4px 8px">Du bist schon dabei? Wähle dein Profil:</div>
        <div id="who-pick">${pickHtml()}</div>
      </div>
      <div class="divider">oder</div>
      <button type="button" class="btn block" id="who-new-btn">${I.plus}Neues Profil erstellen</button>
      <div id="who-new" hidden>
        <div class="label" style="margin:0 4px 8px">Wie sollen dich die anderen sehen?</div>
        ${memberForm(randomMember(), 'Profil erstellen')}
      </div>`,
    refresh: (api) => {
      $('#who-pick', api.el).innerHTML = pickHtml();
      // Erst-Person: Formular direkt zeigen
      if (synced() && !state.members.length) { $('#who-new', api.el).hidden = false; $('#who-new-btn', api.el).hidden = true; }
    },
    onMount: (api) => {
      api.body.addEventListener('click', (e) => {
        const b = e.target.closest('[data-pick]');
        if (b) {
          state.me = b.dataset.pick; LS.set('me', state.me); api.close(); render(); beat(true);
          syncPushSub().catch(() => {});
          toast(`👋 Hallo ${member(state.me)?.name}!`);
          return;
        }
        if (e.target.closest('#who-new-btn')) {
          $('#who-new', api.el).hidden = false;
          $('#who-new-btn', api.el).hidden = true;
          setTimeout(() => $('#m-name', api.el)?.focus(), 50);
        }
      });
      if (synced() && !state.members.length) { $('#who-new', api.el).hidden = false; $('#who-new-btn', api.el).hidden = true; }
      const v = randomMember();
      bindMemberForm(api.el, v, (val) => {
        const id = addDoc('members', { name: val.name, emoji: val.emoji, color: val.color, photo: val.photo || null, floor: val.floor, createdAt: Date.now() });
        state.me = id; LS.set('me', id);
        api.close();
        setTimeout(() => beat(true), 300);
        toast(`👋 Willkommen, ${val.name}!`);
      });
    },
  });
  if (!switching) {
    // Ohne Profil geht es nicht weiter
    $('[data-close]', s.el).hidden = true;
    const bd = $('.sheet-backdrop', s.el);
    bd.style.pointerEvents = 'none';
    const orig = s.close;
    s.close = () => { if (state.me && member(state.me)) orig(); };
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   Start
   ═══════════════════════════════════════════════════════════════════════════ */
/** Verständliche Erklärung für Firebase-Fehler */
function cloudErrorText(err) {
  const c = String(err?.code || err?.message || '');
  if (c.includes('admin-restricted-operation') || c.includes('operation-not-allowed')) return 'In Firebase ist die anonyme Anmeldung noch nicht aktiviert (Authentication → Anmeldemethode → Anonym).';
  if (c.includes('unauthorized-domain')) return `Diese Adresse (${location.hostname}) fehlt in Firebase unter Authentication → Einstellungen → Autorisierte Domains.`;
  if (c.includes('permission-denied') || c.includes('insufficient permissions')) return 'Die Firestore-Regeln erlauben den Zugriff nicht. Bitte die Regeln aus der Anleitung einfügen und veröffentlichen.';
  if (c.includes('not-found') || c.includes('NOT_FOUND')) return 'Die Firestore-Datenbank wurde noch nicht angelegt.';
  if (c.includes('network') || c.includes('unavailable') || c.includes('Failed to fetch')) return 'Keine Verbindung zum Server – bist du online?';
  return `Unbekannter Fehler: ${c.slice(0, 120)}`;
}
function showCloudError(err, hid) {
  console.error(err);
  $('#dock').hidden = true;
  $('#view').innerHTML = `<div class="welcome"><div class="card center">
    ${LOGO}
    <h1 style="font-size:24px">Verbindung klappt noch nicht</h1>
    <p class="muted" style="margin:6px 0 18px">${esc(cloudErrorText(err))}</p>
    <button class="btn primary block" id="retry">Erneut versuchen</button>
    <p class="small muted" style="margin:14px 0 0">Deine Daten auf diesem Gerät bleiben erhalten.</p>
  </div></div>`;
  $('#retry').onclick = () => connect(hid).catch((e) => showCloudError(e, hid));
}

/** Haus aus dem lokalen Modus in die Cloud übertragen (einmalig, beim ersten Verbinden) */
async function migrateLocalToCloud(hid) {
  const local = readLocal(hid);
  if (!local._house) return null;
  $('#view').innerHTML = `<div class="loader"><div class="center"><div class="spinner" style="margin:0 auto 14px"></div><p class="muted">Deine Daten werden in die Cloud übertragen …</p></div></div>`;
  for (const col of [...COLLECTIONS, 'audio', 'chunks']) {
    for (const doc of Object.values(local[col] || {})) await store.set(col, doc.id, doc);
  }
  await store.setHouse(local._house);
  toast('☁️ Fertig! Deine Daten sind jetzt in der Cloud', 4000);
  return local._house;
}

async function connect(hid, { create } = {}) {
  $('#view').innerHTML = '<div class="loader"><div class="spinner"></div></div>';
  const cfg = cloudConfig();
  try {
    store = await createStore(hid, cfg);
  } catch (err) {
    if (!cfg) throw err;
    showCloudError(err, hid);
    return;
  }
  let house;
  try {
    if (create) await store.setHouse(create);
    house = await store.getHouse();
    if (!house && store.mode === 'cloud') house = await migrateLocalToCloud(hid);
  } catch (err) {
    if (store.mode === 'cloud') { showCloudError(err, hid); return; }
    throw err;
  }
  if (!house && store.mode === 'cloud') {
    toast('Kein Haus mit diesem Code gefunden 🤔', 4000);
    if (LS.get('house') === hid && !readLocal(hid)._house) LS.del('house');
    showWelcome();
    return;
  }
  if (!house) { house = { name: 'Unser Haus', createdAt: Date.now() }; await store.setHouse(house); }
  state.hid = hid;
  state.house = house;
  LS.set('house', hid);
  state.me = LS.get('me');

  for (const col of COLLECTIONS) {
    store.subscribe(col, (list, meta) => {
      state[col] = list;
      state.loaded.add(col);
      if (!meta?.fromCache) state.synced.add(col);
      if (col === 'trash') removeExampleBins();
      if (col === 'members') seedFloors();
      if (col === 'members' && state.ready && (!state.me || !member(state.me)) && !sheets.some((s) => s.el.querySelector('#mf'))) whoAreYou();
      render();
    });
  }
  store.subscribe('presence', (list) => {
    state.presence = list;
    // Auf einem anderen Gerät verborgen? → hier übernehmen
    const mine = list.find((x) => x.id === state.me);
    if (mine && typeof mine.hidden === 'boolean') LS.set('presenceOff', mine.hidden);
    if (state.ready && presenceChanged()) render();
  });
  // Warten bis Mitglieder geladen sind
  // (auf einem neuen Gerät ist der Zwischenspeicher leer – deshalb auf die Server-Antwort warten)
  await new Promise((res) => { const t = setInterval(() => { if (state.synced.has('members') || (state.loaded.has('members') && state.members.length)) { clearInterval(t); res(); } }, 30); setTimeout(() => { clearInterval(t); res(); }, 6000); });
  setTimeout(() => { state.synced.add('members'); render(); }, 8000); // offline: nicht ewig „wird geladen“ zeigen

  state.ready = true;
  $('#dock').hidden = false;
  if (pending.tab && TABS.some((t) => t.id === pending.tab)) state.tab = pending.tab;
  renderNow(true);
  presenceChanged();
  beat(true);
  if (!state.me || !member(state.me)) whoAreYou();
  else {
    syncPushSub().catch((e) => console.warn('Push-Sync', e));
    if (pending.done) {
      const [bin, date] = pending.done.split(':');
      setTimeout(() => confirmFromNotification(bin, date), 400);
    }
    setTimeout(checkLocalReminders, 1500);
  }
  if (pending.tab?.startsWith('dm:') && state.me && member(state.me)) { const who = pending.tab.slice(3); setTimeout(() => chatSheet(who), 450); }
  pending.tab = pending.done = null;
}
const pending = { tab: null, done: null };

/* ─── Startanimation ─────────────────────────────────────────────────────── */
function hideSplash(now = false) {
  const el = document.getElementById('splash');
  if (!el || el.classList.contains('out')) return;
  const min = matchMedia('(prefers-reduced-motion: reduce)').matches ? 400 : 2300; // ab Seitenstart gezählt
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 500); }, now ? 0 : Math.max(0, min - performance.now()));
}
document.getElementById('splash')?.addEventListener('click', () => hideSplash(true));
setTimeout(() => hideSplash(true), 7000); // Sicherheitsnetz

async function boot() {
  applyTheme();
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => applyTheme());
  buildTabbar();

  const url = new URL(location.href);
  const join = url.searchParams.get('haus');
  const cfg = url.searchParams.get('cfg');
  const vk = url.searchParams.get('vk');
  pending.tab = url.searchParams.get('tab');
  pending.done = url.searchParams.get('done');
  if (cfg) { try { LS.set('fbconfig', JSON.parse(b64d(cfg))); } catch { /* ungültig */ } }
  if (vk) LS.set('vapid', vk);
  if (join) {
    const code = normCode(join);
    if (code !== LS.get('house')) LS.del('me');
    LS.set('house', code);
  }
  if (url.search) history.replaceState(null, '', url.pathname);

  const hid = LS.get('house');
  if (!hid) { showWelcome(); hideSplash(); return; }
  try { await connect(hid); } catch (e) { console.error(e); if (cloudConfig()) showCloudError(e, hid); else showWelcome(); }
  hideSplash();
}

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
  // Klick auf „✓ Rausgestellt“ in einer Mitteilung, während die App schon offen ist
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type === 'bin-done' && state.ready) confirmFromNotification(e.data.bin, e.data.date);
    if (e.data?.type === 'open-tab' && state.ready && TABS.some((t) => t.id === e.data.tab)) switchTab(e.data.tab);
    if (e.data?.type === 'open-tab' && state.ready && String(e.data.tab).startsWith('dm:')) chatSheet(String(e.data.tab).slice(3));
  });
}
setInterval(checkLocalReminders, 60000);
// Tageswechsel → neu zeichnen (Fälligkeiten, „Heute“ usw.)
let lastDay = today();
let lastGreeting = greeting();
setInterval(() => {
  // Tageswechsel oder neue Tageszeit (Guten Morgen / Tag / Abend) → neu zeichnen
  if (today() !== lastDay || greeting() !== lastGreeting) { lastDay = today(); lastGreeting = greeting(); render(); }
}, 60000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) { beat(true); render(); checkLocalReminders(); } else beat(false);
});
window.addEventListener('pagehide', () => beat(false));
setInterval(() => { if (!document.hidden) beat(true); if (state.ready && presenceChanged()) render(); }, 60000);
document.addEventListener('change', (e) => { if (e.target.id === 'pres-on') setPresenceVisible(e.target.checked); });
document.addEventListener('input', (e) => {
  if (e.target.id !== 'pal-custom') return;
  LS.set('accentCustom', e.target.value);
  LS.set('palette', 'custom');
  applyPalette();
});
document.addEventListener('change', (e) => { if (e.target.id === 'pal-custom') renderNow(false); });

boot();
