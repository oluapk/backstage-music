// Adaptador pronto para as tabelas de supabase/user-library.sql.
// O app atual mantém a persistência local por conta; esta API não é ativada implicitamente.
function requireOwner(userId) {
  if (typeof userId !== 'string' || !userId.trim()) throw new Error('Entre na sua conta para acessar a biblioteca.');
}
function rawTrackId(trackId) {
  if (typeof trackId !== 'string' || !trackId.startsWith('supabase-') || trackId.length <= 9) throw new Error('Escolha uma faixa do catálogo.');
  return trackId.slice(9);
}
async function readPages(query) {
  const data = [];
  for (let start = 0; ; start += 1000) {
    const result = await query().range(start, start + 999);
    if (result.error) throw result.error;
    data.push(...(result.data || []));
    if (!result.data || result.data.length < 1000) return data;
  }
}

export async function loadUserLibrary(client, userId) {
  requireOwner(userId);
  // RLS é a autorização real. O filtro explícito evita carregar dados sem relação com a conta.
  const [likes, playlists, followed, links] = await Promise.all([
    readPages(() => client.from('liked_songs').select('user_id,track_id,created_at').eq('user_id', userId).order('track_id')),
    readPages(() => client.from('user_playlists').select('id,user_id,name,description,source,created_at').eq('user_id', userId).eq('source', 'user').order('id')),
    readPages(() => client.from('followed_artists').select('user_id,artist_name,created_at').eq('user_id', userId).order('artist_name')),
    readPages(() => client.from('user_playlist_tracks').select('user_id,playlist_id,track_id,position').eq('user_id', userId).order('playlist_id').order('track_id')),
  ]);
  const tracksByPlaylist = new Map();
  for (const link of links.filter(link => link.user_id === userId).sort((a, b) => a.position - b.position)) {
    if (!tracksByPlaylist.has(link.playlist_id)) tracksByPlaylist.set(link.playlist_id, []);
    tracksByPlaylist.get(link.playlist_id).push(`supabase-${link.track_id}`);
  }
  return {
    favorites: [...new Set(likes.filter(row => row.user_id === userId).map(row => `supabase-${row.track_id}`))],
    savedArtists: [...new Set(followed.filter(row => row.user_id === userId).map(row => row.artist_name))],
    playlists: playlists.filter(row => row.user_id === userId && row.source === 'user').map(row => ({
      id: row.id, ownerId: row.user_id, source: 'user', name: row.name, description: row.description,
      createdAt: Date.parse(row.created_at) || 0, songIds: [...new Set(tracksByPlaylist.get(row.id) || [])],
    })),
  };
}

export async function setSongLiked(client, userId, songId, liked) {
  requireOwner(userId);
  const trackId = rawTrackId(songId);
  const result = liked
    ? await client.from('liked_songs').upsert({ user_id: userId, track_id: trackId }, { onConflict: 'user_id,track_id', ignoreDuplicates: true })
    : await client.from('liked_songs').delete().eq('user_id', userId).eq('track_id', trackId);
  if (result.error) throw result.error;
}

export async function setArtistFollowed(client, userId, artistName, followed) {
  requireOwner(userId);
  const name = artistName?.trim();
  if (!name) throw new Error('Escolha um artista.');
  const result = followed
    ? await client.from('followed_artists').upsert({ user_id: userId, artist_name: name }, { onConflict: 'user_id,artist_name', ignoreDuplicates: true })
    : await client.from('followed_artists').delete().eq('user_id', userId).eq('artist_name', name);
  if (result.error) throw result.error;
}
