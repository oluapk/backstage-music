-- Execute no SQL Editor do seu projeto Supabase para classificar o acervo.
-- As faixas existentes continuam sendo músicas. RLS e permissões não são alteradas.
ALTER TABLE public.tracks
ADD COLUMN IF NOT EXISTS content_type text NOT NULL DEFAULT 'music'
CHECK (content_type IN ('music', 'podcast', 'audiobook'));

-- No Table Editor, use content_type = 'podcast' para episódios e
-- content_type = 'audiobook' para livros/capítulos; 'music' é o padrão.
-- Os campos artist e album identificam o criador e a série/livro, respectivamente.
