// Metadados e áudio ficam em stores separados. Links assinados nunca são persistidos.
export const MUSIC_DB_NAME = 'backstage-music-library';
export const MUSIC_DB_VERSION = 3;
export const OFFLINE_TRACK_STORE = 'offline-tracks';
const CATALOG_STORE = 'catalog-snapshots';

export function openMusicDB() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) return reject(new Error('IndexedDB não está disponível neste aparelho.'));
    const request = indexedDB.open(MUSIC_DB_NAME, MUSIC_DB_VERSION);
    request.onupgradeneeded = () => {
      for (const store of [OFFLINE_TRACK_STORE, CATALOG_STORE]) {
        if (!request.result.objectStoreNames.contains(store)) request.result.createObjectStore(store, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Não foi possível abrir a biblioteca.'));
    request.onblocked = () => reject(new Error('Feche outras abas antigas do aplicativo e tente novamente.'));
  });
}

export function catalogCacheKey(projectUrl, userId) {
  return `${projectUrl}:${userId}`;
}

export async function readCatalogSnapshot(id) {
  const db = await openMusicDB();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(CATALOG_STORE).objectStore(CATALOG_STORE).get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}

export async function saveCatalogSnapshot(id, tracks) {
  // Lista explícita: nem tokens de sessão nem URLs temporárias entram no cache.
  const fields = ['id', 'title', 'artist', 'album', 'object_path', 'cover_path', 'license', 'created_at', 'duration_seconds', 'content_type'];
  const unique = new Map(tracks.filter(track => track?.id).map(track => [String(track.id),
    Object.fromEntries(fields.map(field => [field, track[field] ?? null]))]));
  const db = await openMusicDB();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(CATALOG_STORE, 'readwrite');
      tx.objectStore(CATALOG_STORE).put({ id, savedAt: Date.now(), tracks: [...unique.values()] });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}
