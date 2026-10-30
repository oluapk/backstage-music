CREATE TABLE IF NOT EXISTS public.music_profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 40),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.music_follows (
  follower_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  followed_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, followed_id),
  CHECK (follower_id <> followed_id)
);

CREATE TABLE IF NOT EXISTS public.music_activity (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  track_title text,
  artist text,
  album text,
  is_playing boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS music_follows_followed_id_idx
  ON public.music_follows (followed_id);

ALTER TABLE public.music_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.music_follows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.music_activity ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can discover music profiles"
  ON public.music_profiles;
CREATE POLICY "Authenticated users can discover music profiles"
  ON public.music_profiles FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Users can create their own music profile"
  ON public.music_profiles;
CREATE POLICY "Users can create their own music profile"
  ON public.music_profiles FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users can update their own music profile"
  ON public.music_profiles;
CREATE POLICY "Users can update their own music profile"
  ON public.music_profiles FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users can read their own follow relationships"
  ON public.music_follows;
CREATE POLICY "Users can read their own follow relationships"
  ON public.music_follows FOR SELECT TO authenticated
  USING (follower_id = (SELECT auth.uid()) OR followed_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users can follow other profiles"
  ON public.music_follows;
CREATE POLICY "Users can follow other profiles"
  ON public.music_follows FOR INSERT TO authenticated
  WITH CHECK (follower_id = (SELECT auth.uid()) AND followed_id <> (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users can unfollow profiles"
  ON public.music_follows;
CREATE POLICY "Users can unfollow profiles"
  ON public.music_follows FOR DELETE TO authenticated
  USING (follower_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users can read their own and followed activity"
  ON public.music_activity;
CREATE POLICY "Users can read their own and followed activity"
  ON public.music_activity FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.music_follows
      WHERE follower_id = (SELECT auth.uid())
        AND followed_id = music_activity.user_id
    )
  );

DROP POLICY IF EXISTS "Users can publish their own activity"
  ON public.music_activity;
CREATE POLICY "Users can publish their own activity"
  ON public.music_activity FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users can update their own activity"
  ON public.music_activity;
CREATE POLICY "Users can update their own activity"
  ON public.music_activity FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users can delete their own activity"
  ON public.music_activity;
CREATE POLICY "Users can delete their own activity"
  ON public.music_activity FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

GRANT SELECT, INSERT, UPDATE ON public.music_profiles TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.music_follows TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.music_activity TO authenticated;
