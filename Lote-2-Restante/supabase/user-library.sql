-- Execute no SQL Editor para preparar a persistência da biblioteca por conta.
-- Esta migração não importa dados locais nem altera tracks/Storage/social.
BEGIN;

CREATE TABLE IF NOT EXISTS public.user_playlists (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 200),
  description text NOT NULL DEFAULT '',
  source text NOT NULL DEFAULT 'user' CHECK (source = 'user'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, user_id)
);

CREATE TABLE IF NOT EXISTS public.followed_artists (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- O catálogo atual identifica artistas pelo nome em tracks.artist.
  artist_name text NOT NULL CHECK (char_length(btrim(artist_name)) BETWEEN 1 AND 300),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, artist_name)
);

-- Usa o tipo real de tracks.id (UUID, bigint, etc.) nas relações de faixas.
DO $$
DECLARE track_id_type text;
BEGIN
  SELECT format_type(atttypid, atttypmod) INTO track_id_type
  FROM pg_attribute
  WHERE attrelid = 'public.tracks'::regclass AND attname = 'id' AND NOT attisdropped;
  IF track_id_type IS NULL THEN RAISE EXCEPTION 'public.tracks.id não foi encontrado'; END IF;
  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS public.liked_songs (
      user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      track_id %s NOT NULL REFERENCES public.tracks(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, track_id)
    )
  $sql$, track_id_type);
  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS public.user_playlist_tracks (
      playlist_id text NOT NULL,
      user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      track_id %s NOT NULL REFERENCES public.tracks(id) ON DELETE CASCADE,
      position integer NOT NULL DEFAULT 0 CHECK (position >= 0),
      PRIMARY KEY (playlist_id, track_id),
      FOREIGN KEY (playlist_id, user_id) REFERENCES public.user_playlists(id, user_id) ON DELETE CASCADE
    )
  $sql$, track_id_type);
END;
$$;

CREATE INDEX IF NOT EXISTS user_playlists_owner_created_idx ON public.user_playlists(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS followed_artists_owner_created_idx ON public.followed_artists(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS liked_songs_owner_created_idx ON public.liked_songs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS user_playlist_tracks_owner_order_idx ON public.user_playlist_tracks(user_id, playlist_id, position);
CREATE INDEX IF NOT EXISTS user_playlist_tracks_track_id_idx ON public.user_playlist_tracks(track_id);
CREATE INDEX IF NOT EXISTS liked_songs_track_id_idx ON public.liked_songs(track_id);

ALTER TABLE public.user_playlists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.followed_artists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.liked_songs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_playlist_tracks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owner manages user playlists" ON public.user_playlists;
CREATE POLICY "Owner manages user playlists" ON public.user_playlists
  FOR ALL TO authenticated USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS "Owner manages followed artists" ON public.followed_artists;
CREATE POLICY "Owner manages followed artists" ON public.followed_artists
  FOR ALL TO authenticated USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS "Owner manages liked songs" ON public.liked_songs;
CREATE POLICY "Owner manages liked songs" ON public.liked_songs
  FOR ALL TO authenticated USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS "Owner manages playlist tracks" ON public.user_playlist_tracks;
CREATE POLICY "Owner manages playlist tracks" ON public.user_playlist_tracks
  FOR ALL TO authenticated USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));

REVOKE ALL ON public.user_playlists, public.followed_artists, public.liked_songs, public.user_playlist_tracks FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_playlists, public.followed_artists, public.liked_songs, public.user_playlist_tracks TO authenticated;
COMMIT;
