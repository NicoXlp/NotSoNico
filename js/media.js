// Fotos & Videos für die Pinnwand.
//
// Fotos werden im Browser verkleinert (max. 1600 px, JPEG). Dateien werden in Stücke
// (< 1 MB, Firestore-Grenze) zerlegt und in der Sammlung „chunks“ gespeichert. So reicht
// der kostenlose Firestore-Tarif – Firebase Storage (kostenpflichtig) wird nicht gebraucht.

export const MAX_ITEMS = 6;
export const MAX_VIDEO_MB = 20;
const CHUNK_BYTES = 675_000; // → ca. 900 KB als Base64
const PHOTO_MAX = 1600;

const loadImage = (src) => new Promise((res, rej) => {
  const img = new Image();
  img.onload = () => res(img);
  img.onerror = () => rej(new Error('Bild konnte nicht gelesen werden'));
  img.src = src;
});
const canvasBlob = (c, type, q) => new Promise((res) => c.toBlob(res, type, q));
function drawScaled(src, w, h, max) {
  const s = Math.min(1, max / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * s));
  c.height = Math.max(1, Math.round(h * s));
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

/** Datei auswählen → vorbereitetes Medium {kind, blob, mime, w, h, dur, thumb, poster, preview} */
export async function prepareFile(file) {
  if (file.type.startsWith('image/')) {
    const url = URL.createObjectURL(file);
    try {
      const img = await loadImage(url);
      const w = img.naturalWidth, h = img.naturalHeight;
      const big = drawScaled(img, w, h, PHOTO_MAX);
      const blob = await canvasBlob(big, 'image/jpeg', 0.82);
      const thumb = drawScaled(img, w, h, 28).toDataURL('image/jpeg', 0.5);
      return { kind: 'image', blob, mime: 'image/jpeg', w: big.width, h: big.height, thumb, preview: URL.createObjectURL(blob) };
    } finally { URL.revokeObjectURL(url); }
  }
  if (file.type.startsWith('video/') || /\.(mov|mp4|m4v|webm)$/i.test(file.name)) {
    if (file.size > MAX_VIDEO_MB * 1024 * 1024) {
      throw new Error(`Das Video ist zu groß (${(file.size / 1048576).toFixed(0)} MB, max. ${MAX_VIDEO_MB} MB) – bitte kürzen`);
    }
    const url = URL.createObjectURL(file);
    const info = await new Promise((res) => {
      const v = document.createElement('video');
      v.muted = true; v.playsInline = true; v.preload = 'metadata';
      let done = false;
      const finish = (poster) => { if (done) return; done = true; res({ w: v.videoWidth, h: v.videoHeight, dur: isFinite(v.duration) ? v.duration : 0, poster }); };
      v.onloadeddata = () => { v.currentTime = Math.min(0.5, (v.duration || 1) / 3); };
      v.onseeked = () => {
        try {
          const c = drawScaled(v, v.videoWidth || 640, v.videoHeight || 360, 480);
          finish(c.toDataURL('image/jpeg', 0.6));
        } catch { finish(null); }
      };
      v.onerror = () => finish(null);
      setTimeout(() => finish(null), 5000);
      v.src = url;
    });
    return {
      kind: 'video', blob: file, mime: file.type || 'video/mp4',
      w: info.w || 16, h: info.h || 9, dur: Math.round(info.dur * 10) / 10,
      thumb: info.poster, poster: info.poster, preview: url,
    };
  }
  throw new Error('Nur Fotos und Videos werden unterstützt');
}

function bytesToB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function b64ToBytes(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** Hochladen → Metadaten für den Beitrag. onProgress(0..1) */
export async function uploadMedia(store, item, { id, author, onProgress } = {}) {
  const bytes = new Uint8Array(await item.blob.arrayBuffer());
  const n = Math.max(1, Math.ceil(bytes.length / CHUNK_BYTES));
  let done = 0;
  const writes = [];
  for (let i = 0; i < n; i++) {
    const data = bytesToB64(bytes.subarray(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES));
    writes.push(store.set('chunks', `${id}_${i}`, { media: id, i, data, author, createdAt: Date.now() })
      .then(() => { done++; onProgress?.(done / n); }));
  }
  // Nicht ewig warten, falls offline – Firestore lädt später hoch. Fehler (z. B. Speicher voll) aber melden.
  await Promise.race([Promise.all(writes), new Promise((res) => setTimeout(res, 120_000))]);
  return {
    id, kind: item.kind, mime: item.mime, chunks: n, size: bytes.length,
    w: item.w, h: item.h, ...(item.dur ? { dur: item.dur } : {}),
    thumb: item.kind === 'image' ? item.thumb : null,
    poster: item.kind === 'video' ? item.poster : null,
  };
}

const urlCache = new Map();
const pendingLoads = new Map();
/** Lädt ein Medium und liefert eine abspielbare URL (Blob-URL, gecacht) */
export function loadMediaURL(store, meta) {
  if (urlCache.has(meta.id)) return Promise.resolve(urlCache.get(meta.id));
  if (pendingLoads.has(meta.id)) return pendingLoads.get(meta.id);
  const p = (async () => {
    const parts = await Promise.all(Array.from({ length: meta.chunks }, (_, i) => store.get('chunks', `${meta.id}_${i}`)));
    if (parts.some((x) => !x)) throw new Error('Datei nicht (mehr) vorhanden');
    const blob = new Blob(parts.map((x) => b64ToBytes(x.data)), { type: meta.mime });
    const url = URL.createObjectURL(blob);
    urlCache.set(meta.id, url);
    return url;
  })().finally(() => pendingLoads.delete(meta.id));
  pendingLoads.set(meta.id, p);
  return p;
}
export const cachedURL = (id) => urlCache.get(id);

export async function removeMedia(store, meta) {
  await Promise.all(Array.from({ length: meta.chunks }, (_, i) => store.remove('chunks', `${meta.id}_${i}`).catch(() => {})));
}
