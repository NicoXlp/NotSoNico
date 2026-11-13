// Datenschicht: gleiche API für lokalen Modus (localStorage) und Cloud-Modus (Firebase Firestore).
//
//   subscribe(col, cb)   → ruft cb(liste) bei jeder Änderung auf, gibt unsubscribe zurück
//   add(col, obj)        → legt Dokument an, gibt id zurück
//   set(col, id, obj)    → überschreibt Dokument
//   update(col, id, fn)  → liest, wendet fn(aktuell) an, schreibt zurück (in der Cloud als Transaktion)
//   remove(col, id)
//   getHouse()/setHouse(obj)

const FB = 'https://www.gstatic.com/firebasejs/10.12.2/';
export const COLLECTIONS = ['members', 'tasks', 'feed', 'trash'];
// Werden nicht live abonniert: Sprachnachrichten (groß) und Push-Abos
export const SIDE_COLLECTIONS = ['audio', 'subs'];

export const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const clean = (o) => JSON.parse(JSON.stringify(o));

class LocalStore {
  constructor(hid) {
    this.hid = hid;
    this.key = 'vt.local.' + hid;
    this.subs = {};
    this.data = this._load();
    try {
      this.bc = new BroadcastChannel('vt-' + hid);
      this.bc.onmessage = () => { this.data = this._load(); Object.keys(this.subs).forEach((c) => this._emit(c)); };
    } catch { /* ältere Browser */ }
  }
  get mode() { return 'local'; }
  async init() { return this; }
  _load() { try { return JSON.parse(localStorage.getItem(this.key)) || {}; } catch { return {}; } }
  _save() {
    try { localStorage.setItem(this.key, JSON.stringify(this.data)); } catch (e) {
      this.data = this._load(); // Änderung zurückrollen
      throw new Error('Speicher voll – bitte Synchronisierung einrichten');
    }
    this.bc?.postMessage(1);
  }
  _col(c) { return (this.data[c] ||= {}); }
  _emit(c) { const list = Object.values(this._col(c)).map((x) => ({ ...x })); (this.subs[c] || []).forEach((f) => f(list)); }
  subscribe(c, f) {
    (this.subs[c] ||= []).push(f);
    queueMicrotask(() => f(Object.values(this._col(c)).map((x) => ({ ...x }))));
    return () => { this.subs[c] = this.subs[c].filter((x) => x !== f); };
  }
  async get(c, id) { const d = this._col(c)[id]; return d ? { ...d } : null; }
  async add(c, obj) { const id = obj.id || newId(); this._col(c)[id] = clean({ ...obj, id }); this._save(); this._emit(c); return id; }
  async set(c, id, obj) { this._col(c)[id] = clean({ ...obj, id }); this._save(); this._emit(c); }
  async update(c, id, fn) {
    const cur = this._col(c)[id];
    if (!cur) return;
    this._col(c)[id] = clean({ ...fn(structuredClone(cur)), id });
    this._save(); this._emit(c);
  }
  async remove(c, id) { delete this._col(c)[id]; this._save(); this._emit(c); }
  async getHouse() { return this.data._house || null; }
  async setHouse(h) { this.data._house = clean(h); this._save(); }
}

class CloudStore {
  constructor(hid, config) { this.hid = hid; this.config = config; }
  get mode() { return 'cloud'; }
  async init() {
    const [appMod, fs, auth] = await Promise.all([
      import(FB + 'firebase-app.js'),
      import(FB + 'firebase-firestore.js'),
      import(FB + 'firebase-auth.js'),
    ]);
    this.fs = fs;
    const app = appMod.getApps()[0] || appMod.initializeApp(this.config);
    try {
      this.db = fs.initializeFirestore(app, {
        localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }),
      });
    } catch {
      this.db = fs.getFirestore(app);
    }
    await auth.signInAnonymously(auth.getAuth(app));
    return this;
  }
  _c(c) { return this.fs.collection(this.db, 'households', this.hid, c); }
  _d(c, id) { return this.fs.doc(this.db, 'households', this.hid, c, id); }
  subscribe(c, f) {
    return this.fs.onSnapshot(this._c(c), (snap) => f(snap.docs.map((d) => ({ ...d.data(), id: d.id }))),
      (err) => console.error('Snapshot-Fehler', c, err));
  }
  async get(c, id) { const s = await this.fs.getDoc(this._d(c, id)); return s.exists() ? { ...s.data(), id } : null; }
  async add(c, obj) { const id = obj.id || newId(); await this.fs.setDoc(this._d(c, id), clean({ ...obj, id })); return id; }
  async set(c, id, obj) { await this.fs.setDoc(this._d(c, id), clean({ ...obj, id })); }
  async update(c, id, fn) {
    const ref = this._d(c, id);
    try {
      await this.fs.runTransaction(this.db, async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists()) return;
        tx.set(ref, clean({ ...fn(snap.data()), id }));
      });
    } catch (e) {
      // Offline: auf den lokalen Cache zurückfallen (wird synchronisiert, sobald wieder online)
      const snap = await this.fs.getDoc(ref);
      if (!snap.exists()) throw e;
      await this.fs.setDoc(ref, clean({ ...fn(snap.data()), id }));
    }
  }
  async remove(c, id) { await this.fs.deleteDoc(this._d(c, id)); }
  async getHouse() {
    const s = await this.fs.getDoc(this.fs.doc(this.db, 'households', this.hid));
    return s.exists() ? s.data() : null;
  }
  async setHouse(h) { await this.fs.setDoc(this.fs.doc(this.db, 'households', this.hid), clean(h)); }
}

export async function createStore(hid, config) {
  const s = config ? new CloudStore(hid, config) : new LocalStore(hid);
  return s.init();
}

export function readLocal(hid) {
  try { return JSON.parse(localStorage.getItem('vt.local.' + hid)) || {}; } catch { return {}; }
}
