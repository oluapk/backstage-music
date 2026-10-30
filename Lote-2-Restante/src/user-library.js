import { normalizeSearchText } from './search.js';

// Playlists antigas deste app eram criadas manualmente e não tinham source/ownerId.
// O chamador fornece apenas os dados lidos do armazenamento da conta atual.
export function getUserPlaylists(playlists = [], ownerId) {
  return playlists.filter(playlist => playlist && typeof playlist.id === 'string'
    && (playlist.source == null || playlist.source === 'user')
    && playlist.isSystem !== true
    && (!playlist.ownerId || (ownerId && playlist.ownerId === ownerId)));
}

export function buildUserLibrary({ songs = [], playlists = [], favorites = [], savedArtists = [], ownerId,
  tab = 'playlists', search = '', sort = 'name', pinnedCollections = [], recentlyPlayedSongs = [] } = {}) {
  const likedIds = new Set(favorites);
  const followedNames = [...new Set(savedArtists.filter(name => typeof name === 'string' && name.trim()))];
  const liked = songs.filter(song => likedIds.has(song.id));
  const entries = [{ id: 'favorites', key: 'favorites', title: 'Músicas curtidas',
    subtitle: `Playlist · ${liked.length} ${liked.length === 1 ? 'música curtida' : 'músicas curtidas'}`, kind: 'favorites', songs: liked, pinned: true }];
  const byId = new Map(songs.map(song => [song.id, song]));
  if (tab !== 'artists') {
    for (const playlist of getUserPlaylists(playlists, ownerId)) {
      const tracks = [...new Set(Array.isArray(playlist.songIds) ? playlist.songIds : [])].map(id => byId.get(id)).filter(Boolean);
      entries.push({ id: playlist.id, key: `playlist:${playlist.id}`, title: playlist.name || 'Playlist',
        subtitle: `Criada por você · ${tracks.length} ${tracks.length === 1 ? 'faixa' : 'faixas'}`, kind: 'playlist', cover: playlist.cover,
        songs: tracks, createdAt: Number(playlist.createdAt) || 0 });
    }
  } else {
    const byArtist = new Map();
    for (const song of songs) {
      if (!byArtist.has(song.artist)) byArtist.set(song.artist, []);
      byArtist.get(song.artist).push(song);
    }
    // A relação seguida é a fonte: artistas salvos continuam aqui sem faixas disponíveis.
    for (const name of followedNames) {
      const tracks = byArtist.get(name) || [];
      entries.push({ id: name, key: `artist:${name}`, title: name, subtitle: `Artista seguido · ${tracks.length} faixas`,
        kind: 'artist', saved: true, songs: tracks, createdAt: 0 });
    }
  }
  const tokens = normalizeSearchText(search).split(/\s+/).filter(Boolean);
  const recentOrder = new Map(recentlyPlayedSongs.map((song, index) => [song.id, index]));
  const ranked = entries.map(item => ({ ...item, pinned: item.kind === 'favorites' || pinnedCollections.includes(item.key),
    recentIndex: item.songs.reduce((rank, song) => Math.min(rank, recentOrder.get(song.id) ?? Infinity), Infinity) }));
  return ranked.filter(item => tokens.every(token => normalizeSearchText(`${item.title} ${item.subtitle}`).includes(token))).sort((a, b) => {
    if (a.kind === 'favorites' || b.kind === 'favorites') return a.kind === b.kind ? 0 : a.kind === 'favorites' ? -1 : 1;
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (sort === 'recent') {
      const difference = a.recentIndex - b.recentIndex;
      if (Number.isFinite(difference) && difference !== 0) return difference;
      if (a.recentIndex !== b.recentIndex) return a.recentIndex < b.recentIndex ? -1 : 1;
    }
    if (sort === 'created' && a.createdAt !== b.createdAt) return b.createdAt - a.createdAt;
    return a.title.localeCompare(b.title, 'pt-BR');
  });
}
