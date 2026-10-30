export function normalizeSearchText(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').trim();
}

export function makeSearchEntries(songs = [], playlists = []) {
  const entries = [];
  const artists = new Map();
  const albums = new Map();
  songs.forEach(song => {
    if (!song || typeof song.id !== 'string') return;
    const artist = song.artist || '';
    const album = song.album || '';
    const contentLabel = song.contentType === 'podcast' ? 'Episódio' : song.contentType === 'audiobook' ? 'Audiolivro' : 'Música';
    entries.push({ key: `song:${song.id}`, type: 'song', id: song.id, title: song.title || 'Sem título', subtitle: `${contentLabel}${artist ? ` · ${artist}` : ''}`, artist, album, cover: song.cover || '' });
    if (artist && !artists.has(artist)) artists.set(artist, { key: `artist:${artist}`, type: 'artist', id: artist, title: artist, subtitle: 'Artista', artist, cover: song.cover || '' });
    if (album) {
      const key = JSON.stringify([album, artist]);
      if (!albums.has(key)) albums.set(key, { key: `album:${key}`, type: 'album', id: key, title: album, subtitle: `Álbum${artist ? ` · ${artist}` : ''}`, artist, album, cover: song.cover || '' });
    }
  });
  entries.push(...artists.values(), ...albums.values());
  playlists.forEach(playlist => {
    if (!playlist || typeof playlist.id !== 'string') return;
    const songIds = Array.isArray(playlist.songIds) ? playlist.songIds : [];
    const tracks = songs.filter(song => songIds.includes(song.id));
    entries.push({ key: `playlist:${playlist.id}`, type: 'playlist', id: playlist.id, title: playlist.name || 'Playlist', subtitle: `Playlist · ${tracks.length} faixas`, cover: tracks.find(song => song.cover?.startsWith('url('))?.cover || playlist.cover || '' });
  });
  return entries;
}

const cachedIndexes = new WeakMap();
function grams(value) {
  const result = new Set();
  for (let i = 0; i <= value.length - 3; i += 1) result.add(value.slice(i, i + 3));
  return result;
}

export function createSearchIndex(entries = []) {
  const postings = new Map();
  const records = entries.map((entry, index) => {
    const title = normalizeSearchText(entry.title);
    const artist = normalizeSearchText(entry.artist);
    const haystack = normalizeSearchText(`${entry.title} ${entry.artist || ''} ${entry.album || ''} ${entry.subtitle || ''}`);
    for (const gram of grams(haystack)) {
      if (!postings.has(gram)) postings.set(gram, new Set());
      postings.get(gram).add(index);
    }
    return { entry, title, artist, haystack, index };
  });
  return { records, postings };
}

export function getSearchSuggestions(query, entries = [], limit = 10) {
  const text = normalizeSearchText(query);
  if (!text) return [];
  const tokens = text.split(/\s+/);
  let index = entries;
  if (Array.isArray(entries)) {
    if (!cachedIndexes.has(entries)) cachedIndexes.set(entries, createSearchIndex(entries));
    index = cachedIndexes.get(entries);
  }
  const lists = tokens.flatMap(token => [...grams(token)].map(gram => index.postings.get(gram) || new Set()));
  lists.sort((a, b) => a.size - b.size);
  const candidates = lists.length
    ? [...lists[0]].filter(id => lists.every(list => list.has(id))).map(id => index.records[id])
    : index.records;
  const kindOrder = { artist: 0, album: 1, playlist: 2, song: 3 };
  return candidates.map(({ entry, title, artist, haystack, index }) => {
    if (!tokens.every(token => haystack.includes(token))) return null;
    const score = title === text ? 0 : title.startsWith(text) ? 1 : title.includes(text) ? 2 : artist.startsWith(text) ? 3 : 4;
    return { entry, score, index };
  }).filter(Boolean).sort((a, b) => a.score - b.score || (kindOrder[a.entry.type] ?? 4) - (kindOrder[b.entry.type] ?? 4) || a.index - b.index)
    .slice(0, limit).map(result => result.entry);
}
