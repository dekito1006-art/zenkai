/* Zenkai – Bildspeicher
   Bilder sind zu groß für das Sync-Dokument. Sie liegen deshalb getrennt:
   - lokal in IndexedDB (sofort verfügbar, auch offline)
   - zusätzlich im privaten Supabase-Storage-Ordner des Nutzers (zenkai/<user-id>/<bild-id>.jpg)
   Datensätze speichern nur die Bild-ID. Ein anderes Gerät lädt das Bild erst, wenn es angezeigt wird. */
const Images = (() => {
  const DB = 'zenkai-img', STORE = 'images';
  let dbp = null;
  const urls = new Map();

  function db() {
    if (!dbp) dbp = new Promise((ok, fail) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
      r.onsuccess = () => ok(r.result);
      r.onerror = () => fail(r.error);
    });
    return dbp;
  }
  async function tx(mode, fn) {
    const d = await db();
    return new Promise((ok, fail) => {
      const t = d.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      t.oncomplete = () => ok(req ? req.result : undefined);
      t.onerror = () => fail(t.error);
    });
  }
  const get = id => tx('readonly', s => s.get(id));
  const put = rec => tx('readwrite', s => s.put(rec));
  const del = id => tx('readwrite', s => s.delete(id));
  const all = () => tx('readonly', s => s.getAll());

  async function save(blob) {
    const id = 'img_' + Store.uid();
    await put({ id, blob, uploaded: false, at: Date.now() });
    flush();
    return id;
  }

  async function remove(id) {
    if (!id) return;
    if (urls.has(id)) { URL.revokeObjectURL(urls.get(id)); urls.delete(id); }
    await del(id).catch(() => { });
    if (Sync.loggedIn()) Sync.deleteImage(id).catch(() => { });
  }

  async function blobOf(id) {
    const r = await get(id).catch(() => null);
    if (r) return r.blob;
    if (Sync.loggedIn()) {
      const b = await Sync.downloadImage(id).catch(() => null);
      if (b) { await put({ id, blob: b, uploaded: true, at: Date.now() }); return b; }
    }
    return null;
  }

  async function url(id) {
    if (urls.has(id)) return urls.get(id);
    const b = await blobOf(id);
    if (!b) return null;
    const u = URL.createObjectURL(b);
    urls.set(id, u);
    return u;
  }

  // Noch nicht hochgeladene Bilder in den Supabase-Speicher übertragen
  let flushing = false;
  async function flush() {
    if (flushing || !Sync.loggedIn()) return;
    flushing = true;
    try {
      for (const r of await all()) {
        if (r.uploaded) continue;
        await Sync.uploadImage(r.id, r.blob);
        r.uploaded = true;
        await put(r);
      }
    } catch (e) { console.warn('Bild-Upload', e); }
    finally { flushing = false; }
  }

  // Alle <img data-img="..."> im Bereich mit dem passenden Bild füllen
  async function hydrate(root = document) {
    for (const img of root.querySelectorAll('img[data-img]')) {
      const id = img.dataset.img;
      if (!id || img.dataset.loaded === id) continue;
      const u = await url(id).catch(() => null);
      if (u) { img.src = u; img.dataset.loaded = id; img.classList.remove('missing'); }
      else img.classList.add('missing');
    }
  }

  // Foto verkleinern (und optional quadratisch zuschneiden), als JPEG
  async function resize(file, max, square) {
    const bmp = await createImageBitmap(file);
    let sx = 0, sy = 0, sw = bmp.width, sh = bmp.height;
    if (square) { const m = Math.min(sw, sh); sx = (sw - m) / 2; sy = (sh - m) / 2; sw = sh = m; }
    const scale = Math.min(1, max / Math.max(sw, sh));
    const c = document.createElement('canvas');
    c.width = Math.round(sw * scale); c.height = Math.round(sh * scale);
    c.getContext('2d').drawImage(bmp, sx, sy, sw, sh, 0, 0, c.width, c.height);
    return new Promise(ok => c.toBlob(ok, 'image/jpeg', 0.85));
  }

  function fromBase64(b64, mime) {
    const bin = atob(b64), arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime || 'image/png' });
  }
  function toBase64(blob) {
    return new Promise((ok, fail) => {
      const r = new FileReader();
      r.onload = () => ok(String(r.result).split(',')[1]);
      r.onerror = fail;
      r.readAsDataURL(blob);
    });
  }

  // Alle lokal zwischengespeicherten Bilder entfernen (beim Abmelden). Hochgeladene Bilder bleiben in der Cloud.
  async function clearAll() {
    urls.forEach(u => URL.revokeObjectURL(u)); urls.clear();
    await tx('readwrite', s => s.clear()).catch(() => { });
  }
  async function pendingCount() { return (await all().catch(() => [])).filter(r => !r.uploaded).length; }

  return { save, remove, url, blobOf, hydrate, resize, flush, fromBase64, toBase64, clearAll, pendingCount };
})();
