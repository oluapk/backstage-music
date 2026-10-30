export function normalizeContentType(value) {
  const type = typeof value === 'string'
    ? value.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\s_-]+/g, '')
    : '';
  if (['podcast', 'podcasts', 'episode', 'episodes', 'episodio', 'episodios'].includes(type)) return 'podcast';
  if (['audiobook', 'audiobooks', 'audiolivro', 'audiolivros', 'livro', 'livros', 'book', 'books'].includes(type)) return 'audiobook';
  return 'music';
}

function seededShuffle(items, seed) {
  let state = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    state = Math.imul(state ^ seed.charCodeAt(index), 16777619) >>> 0;
  }
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const swapIndex = Math.floor((state / 4294967296) * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function uniqueSongs(songs) {
  const seen = new Set();
  return songs.filter(song => {
    if (!song || typeof song.id !== 'string' || !song.id.startsWith('supabase-') || seen.has(song.id)) return false;
    seen.add(song.id);
    return true;
  });
}

export function buildRecommendations(songs, {
  favorites = [], recentlyPlayedIds = [], savedArtists = [], profileId = '', day = new Date().toLocaleDateString('sv-SE'),
} = {}) {
  const music = uniqueSongs(Array.isArray(songs) ? songs : [])
    .filter(song => normalizeContentType(song.contentType ?? song.content_type) === 'music');
  if (!music.length) return [];
  const favoriteIds = new Set(favorites);
  const recentOrder = new Map(recentlyPlayedIds.map((id, index) => [id, index]));
  const followedArtists = new Set(savedArtists);
  const favoriteArtists = new Set(music.filter(song => favoriteIds.has(song.id)).map(song => song.artist));
  const recentArtists = new Set(music.filter(song => recentOrder.has(song.id)).map(song => song.artist));
  const seed = `${profileId}:${day}`;
  const score = song => (favoriteIds.has(song.id) ? 12 : 0)
    + (recentOrder.has(song.id) ? Math.max(1, 8 - recentOrder.get(song.id) / 4) : 0)
    + (followedArtists.has(song.artist) ? 6 : 0)
    + (favoriteArtists.has(song.artist) ? 3 : 0)
    + (recentArtists.has(song.artist) ? 2 : 0);
  const ranked = seededShuffle(music, `${seed}:ranked`).sort((a, b) => score(b) - score(a));
  const familiar = music.filter(song => favoriteIds.has(song.id) || favoriteArtists.has(song.artist) || followedArtists.has(song.artist));
  const unheard = music.filter(song => !recentOrder.has(song.id));
  const followed = music.filter(song => followedArtists.has(song.artist));
  const makeMix = (id, title, description, tracks) => {
    const selection = uniqueSongs(tracks).slice(0, 12);
    return {
      id, title, description, songs: selection,
      cover: selection.find(song => typeof song.cover === 'string' && song.cover)?.cover || 'linear-gradient(135deg,#246c52,#13261d)',
    };
  };
  const mixes = [
    makeMix('for-you', 'No seu ritmo', 'Uma seleção do seu catálogo, a partir das suas escolhas.', ranked),
    makeMix('favorites', familiar.length ? 'Perto dos favoritos' : 'Descobertas do seu acervo',
      familiar.length ? 'Músicas curtidas e mais dos artistas que você gosta.' : 'Outros caminhos pelas músicas da sua biblioteca.',
      seededShuffle(familiar.length ? familiar : music, `${seed}:favorites`)),
    makeMix('rediscover', 'Para redescobrir', unheard.length ? 'Faixas que estão fora das suas reproduções recentes.' : 'Reencontre músicas que já passaram pelo seu player.',
      seededShuffle(unheard.length ? unheard : music, `${seed}:rediscover`)),
  ];
  if (followed.length) {
    mixes.push(makeMix('following', 'Dos artistas que você segue', 'Os artistas salvos no seu perfil, em uma seleção.', seededShuffle(followed, `${seed}:following`)));
  }
  return mixes.filter(mix => mix.songs.length);
}

const searchTypes = new Set(['song', 'artist', 'album', 'playlist', 'query']);
const text = (value, limit = 180) => typeof value === 'string' ? value.trim().slice(0, limit) : '';

export function normalizeSearchHistory(entries) {
  if (!Array.isArray(entries)) return [];
  const seen = new Set();
  const normalized = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || !searchTypes.has(entry.type)) continue;
    const type = entry.type;
    const id = text(entry.id, 256);
    const artist = text(entry.artist, 180) || (type === 'artist' ? text(entry.title) : '');
    const album = text(entry.album) || (type === 'album' ? text(entry.title) : '');
    const title = text(entry.title) || (type === 'artist' ? artist : type === 'album' ? album : '');
    if (!title || (type === 'song' && !id.startsWith('supabase-')) || (type === 'playlist' && !id)) continue;
    const key = type === 'song' || type === 'playlist' ? `${type}:${id}`
      : type === 'artist' ? `artist:${artist}`
        : type === 'album' ? `album:${JSON.stringify([album, artist])}`
          : `query:${title.toLocaleLowerCase('pt-BR')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const value = { key, type, id, title, subtitle: text(entry.subtitle), artist, album, cover: text(entry.cover, 8192) };
    if (Number.isFinite(entry.timestamp) && entry.timestamp > 0) value.timestamp = entry.timestamp;
    normalized.push(value);
    if (normalized.length === 12) break;
  }
  return normalized;
}

export function compactProgress(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([id, item]) => id.startsWith('supabase-')
    && item && typeof item === 'object'
    && Number.isFinite(item.position) && Number.isFinite(item.duration)
    && item.duration > 0 && item.position > 0 && item.position < item.duration)
    .map(([id, item]) => [id, { position: item.position, duration: item.duration }]));
}
