# Backstage Music

Player musical com catálogo exclusivo do Supabase em React + Vite, com app desktop Windows via Electron e projeto Android via Capacitor.

Builds automáticos por push na main, configuração do GitHub e links permanentes: [Guia de automação](docs/BUILD-AUTOMATICO.md). Localmente, use `npm.cmd run release:next` para gerar uma nova versão dos dois instaladores e `npm.cmd run deploy:release` para publicá-la e verificar os downloads.

Guia com arquitetura, código, busca indexada e persistência: [Implementação e distribuição](docs/IMPLEMENTACAO-E-DISTRIBUICAO.md).

**Sua Biblioteca** mostra somente a coleção fixa de músicas curtidas, playlists criadas pelo usuário e artistas seguidos. Veja a [lógica, o layout e a estrutura de persistência por conta](docs/BIBLIOTECA-PESSOAL.md).

## Site privado sempre online (Vercel + Supabase)
O app pode ser hospedado na Vercel sem manter este computador ligado. O acesso é privado e por convite: só pessoas que você convidar pelo Supabase podem entrar.

Antes de publicar:
1. Em **Supabase → Authentication → Settings → User Signups**, desative **Enable sign ups** para impedir cadastros públicos. Para adicionar um familiar, abra **Authentication → Users → Invite user**, informe o e-mail dele e envie o convite. Cada familiar entra com o próprio e-mail e define sua própria senha; convide usuários, não os adicione como membros do projeto/organização Supabase e não compartilhe sua conta de administrador.
2. No **SQL Editor**, execute o SQL abaixo. Ele remove as políticas atuais da tabela `tracks` e permite que usuários autenticados leiam apenas faixas publicadas:

```sql
ALTER TABLE public.tracks ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE existing_policy RECORD;
BEGIN
  FOR existing_policy IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'tracks'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.tracks', existing_policy.policyname);
  END LOOP;
END
$$;

CREATE POLICY "Authenticated users can read published tracks"
ON public.tracks
FOR SELECT
TO authenticated
USING (is_published = true);
```

3. Em **Storage → music → Settings**, desative **Public bucket**. Em **Storage → Policies**, remova qualquer política `anon`/pública que permita leitura de arquivos do bucket `music` e crie uma política `SELECT` para `authenticated` com a condição `bucket_id = 'music'`. O app usa links assinados para tocar essas faixas.
4. Para ativar **Amigos / Atividade dos amigos**, execute também o conteúdo de [`supabase/social.sql`](./supabase/social.sql) no **SQL Editor**. Isso cria perfis públicos apenas pelo nome escolhido no app, relações de acompanhamento e atividade de reprodução com RLS: o nome pode ser descoberto por usuários autenticados, mas cada pessoa só pode alterar seu perfil e sua própria atividade; a faixa atual fica visível somente para quem acompanha esse perfil. Cada familiar precisa entrar uma vez no app para aparecer no diretório. A atividade é atualizada durante a reprodução e consultada periodicamente; não compartilha e-mail, playlists ou histórico completo.
5. No terminal da pasta do projeto, conecte a conta e crie o projeto Vercel com `npx vercel login` e depois `npx vercel`. As configurações de build já estão no `vercel.json` (`npm run build`, saída `dist`); `.vercelignore` exclui arquivos de ambiente e o projeto Android.
6. No painel da Vercel, em **Project Settings → Environment Variables**, cadastre `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_SUPABASE_STORAGE_BUCKET=music` e `VITE_SUPABASE_STORAGE_PUBLIC=false`. Use apenas a chave pública `anon`; nunca cadastre `service_role`.
7. Publique com `npx vercel --prod` e adicione o domínio final em **Supabase → Authentication → URL Configuration → Redirect URLs**; configure também o domínio como **Site URL**. O link de convite deve redirecionar ao domínio publicado. Depois de abrir o convite e entrar no app, o familiar pode abrir **Perfil → Definir senha**. Após salvar, o app confirma a alteração e passa a mostrar **Alterar senha**. O convite cria um usuário autenticado comum: não concede acesso ao Dashboard do Supabase nem permissões de administrador. Em **Perfil**, cada pessoa pode escolher o nome exibido no app e gerenciar a senha; com as tabelas sociais configuradas, o nome também é sincronizado para o diretório de familiares. Favoritos, playlists, fila e histórico continuam separados por conta neste navegador/aparelho e não sincronizam entre dispositivos. A URL do site é distribuída, mas os dados e os arquivos só ficam privados se as políticas RLS e o bucket privado estiverem configurados como acima.

## Abrir no VS Code
1. Extraia o ZIP e abra a pasta `backstage-music` no VS Code.
2. No terminal, execute `npm install`.
3. Execute `npm run dev` e abra o endereço local mostrado no terminal.

## Biblioteca musical
- Interface inspirada nas referências de streaming: atalhos para coleções no início, biblioteca em lista ou grade com busca, ordenação e filtros, páginas de artista com músicas e discografia, e menu no avatar com perfil, recentes, downloads, amigos e configurações.
- O layout é compartilhado pelo site, pelo Windows e pelo Android. No computador, um painel lateral mostra a faixa atual e o artista; no celular, o miniplayer fica acima da navegação inferior, com acesso ao player expandido ao tocar na faixa.
- Artistas seguidos ficam salvos por perfil neste aparelho. Capas, títulos e álbuns vêm do catálogo; a interface não inventa números de ouvintes, reproduções, letras ou lançamentos externos.
- Interface responsiva com navegação lateral persistente e player fixo em telas grandes, além de navegação compacta no celular.
- Biblioteca pessoal com Músicas curtidas fixa e abas Playlists/Artistas; catálogo, álbuns, downloads e histórico ficam em telas próprias.
- Reprodução exclusiva das músicas publicadas no catálogo Supabase, sem envio de arquivos do celular ou computador pelo app.
- Capas configuradas nas faixas do catálogo Supabase.
- Reprodução Android em segundo plano, com informações e controles na tela bloqueada.
- Player de mídia do Android na área de notificações durante a reprodução, com capa, faixa atual e controles de reproduzir/pausar e avançar/voltar.
- Download individual de faixas do Supabase para reprodução offline no mesmo aparelho.
- Play/pause, anterior/próxima, volume e barra de progresso.
- Player expandido com capa, faixa atual, controles de reprodução, progresso, volume e fila acessível.
- Fila de reprodução persistente: adicione faixas pela lista ou pelo catálogo, reproduza um item, mude a ordem com os controles de mover para cima/baixo, remova ou limpe itens; a próxima faixa da fila toca antes da sequência atual.
- Páginas de álbum, artista e playlist com informações do acervo, discografia disponível e ações de reproduzir/embaralhar.
- Atalhos de exploração para playlists, artistas, álbuns e catálogo.
- Atividade familiar opcional: acompanhe perfis e veja a faixa atual, usando as tabelas e políticas `supabase/social.sql`.
- Histórico local de até 30 faixas reproduzidas, exibido como reproduções recentes na tela inicial.
- Configurações do app por perfil: tema claro/escuro, cor de destaque, reprodução automática, aleatório e repetição padrão.
- Configurações de áudio incluem velocidade de reprodução (0,5× a 2×) e modo offline, que restringe o app aos downloads do catálogo existentes no aparelho.
- Economia de dados controla o pré-carregamento de áudio; a qualidade reproduzida depende do arquivo de origem e não é convertida pelo app.
- Armazenamento mostra estimativas do navegador e tamanho dos downloads offline, com ação para removê-los somente deste aparelho.
- Privacidade permite limpar o histórico local; a seção de notificações verifica/solicita permissão no Android para os controles de mídia.
- Busca somente as faixas do seu catálogo Supabase e os downloads dessas músicas; o app não pesquisa nem reproduz faixas de serviços externos.
- Favoritos persistentes.
- Criação e exclusão de playlists; adição e remoção de faixas das playlists.
- Remoção de downloads offline somente deste aparelho; essa ação nunca apaga arquivos ou registros do Supabase.
- Título, artista e álbum são definidos no catálogo Supabase.
- Downloads persistentes usando IndexedDB e localStorage para favoritos/playlists.
- Reprodução dos downloads do catálogo já salvos mesmo sem conexão ou sessão ativa do Supabase.

A persistência depende de o navegador/app não apagar os dados do site e de haver espaço disponível. Os downloads offline, fila, histórico, favoritos e playlists permanecem neste navegador/perfil e não são sincronizados automaticamente entre dispositivos. As músicas baixadas podem ser removidas pelo app ou ao limpar os dados do app. Metadados do catálogo são indexados e restaurados por conta; áudio privado sem download exige conexão. Podcasts e audiolivros podem vir do próprio catálogo via `content_type`, com retomada de posição e controle de velocidade. Não inclui letras sincronizadas, equalizador, Spotify Connect ou reprodução em grupo. O APK de teste é assinado com chave de depuração; distribuição de produção exige assinatura própria.

O envio de músicas e a configuração dos metadados e capas são feitos pelo administrador no Supabase. O app não oferece importação de arquivos do celular ou computador. Músicas importadas em versões anteriores deixam de ser carregadas e exibidas; os dados antigos não são apagados automaticamente. As playlists, os favoritos, a fila e o histórico passam a considerar somente faixas do catálogo.

## Conectar catálogo próprio pelo Supabase
O projeto lista e reproduz somente faixas do catálogo Supabase e os downloads dessas músicas. Configure na raiz um `.env.local` com `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`. O bucket de Storage padrão é `music`; opcionalmente configure `VITE_SUPABASE_STORAGE_BUCKET`. Buckets públicos são usados por padrão; para bucket privado, defina `VITE_SUPABASE_STORAGE_PUBLIC=false` e conceda à chave pública permissão de leitura dos arquivos, pois o app solicita links temporários de uma hora.

O app espera uma tabela `public.tracks` com `id`, `title`, `artist`, `album`, `object_path`, `license`, `is_published` e `created_at`. A coluna opcional `cover_path` guarda o caminho de uma imagem de capa no bucket configurado. Antes de publicar uma versão do app que exibe capas, crie a coluna no **Supabase → SQL Editor**:

```sql
ALTER TABLE public.tracks
ADD COLUMN IF NOT EXISTS cover_path text;
```

`duration_seconds` também é opcional. O catálogo continua carregando se essa coluna ou `cover_path` não existir. Sem a duração cadastrada, a lista mostra um marcador e o player obtém a duração ao abrir o áudio. Uma capa privada indisponível usa a arte padrão, preservando o carregamento das músicas.

Envie cada imagem autorizada para o bucket `music` (por exemplo, em `capas/nome-do-album.jpg`) e associe-a à faixa com o caminho exato:

```sql
UPDATE public.tracks AS t
SET cover_path = 'capas/nome-do-album.jpg'
WHERE t.object_path = 'pasta/nome-exato-da-musica.mp3'
  AND EXISTS (
    SELECT 1
    FROM storage.objects AS o
    WHERE o.bucket_id = 'music'
      AND o.name = 'capas/nome-do-album.jpg'
  )
RETURNING t.id, t.title, t.cover_path;
```

O app usa URLs públicas para buckets públicos e links assinados para buckets privados; não é necessário tornar o bucket público. Para um bucket privado, a política `SELECT` do Storage deve permitir à conta autenticada ler tanto o áudio quanto as imagens. Publique apenas faixas e imagens que você tem autorização para transmitir/exibir. Ative RLS e permita leitura das faixas publicadas. Nunca use a chave `service_role` no frontend.

Após configurar ou alterar `.env.local`, reinicie `npm run dev`; as faixas publicadas são carregadas automaticamente ao abrir o app. **Buscar** pesquisa somente as faixas do catálogo Supabase e os downloads dessas músicas; **Meu catálogo** lista as faixas que você publicou e os downloads offline. O app não inclui um catálogo externo: só toca as músicas publicadas no seu próprio Supabase e os downloads dessas faixas. Use **Atualizar músicas** para buscar novamente. A atualização preserva o link da faixa atual para não interromper a reprodução; se um link privado expirar, o app tenta renová-lo. O campo `object_path` precisa corresponder exatamente ao caminho do arquivo dentro do bucket, por exemplo `albuns/faixa-01.mp3`.

No Android, inicie uma música e permita as notificações para usar os controles na tela bloqueada; a reprodução continua com a tela bloqueada ou o app minimizado, mas não após forçar o encerramento do app. Use o botão de download ao lado de uma faixa para guardá-la no aparelho e ouvi-la sem internet. Os downloads são salvos no armazenamento local do app e não sincronizam com outros dispositivos.

## Executar como app Windows
Depois de instalar as dependências: `npm run desktop`

## Preparar o app Android
Requisitos: Android Studio, Android SDK 36 e JDK 21. O app usa Capacitor e compartilha a interface e o player web. No Android Studio, selecione o JDK 21 em **Settings → Build, Execution, Deployment → Build Tools → Gradle → Gradle JDK**.

1. Instale as dependências: `npm install`.
2. Gere/sincronize o app Android: `npm run android:sync`.
3. Abra o projeto nativo no Android Studio: `npm run android:open`.
4. No Android Studio, aguarde a sincronização do Gradle e use **Build → Build Bundle(s) / APK(s) → Build APK(s)** para gerar um APK de teste. O APK de depuração fica em `android/app/build/outputs/apk/debug/app-debug.apk`. Para publicar na Play Store, gere um Android App Bundle assinado pelo Android Studio.

Para executar em um dispositivo Android com depuração USB ou emulador: `npm run android:run`. O Supabase precisa estar acessível pela internet; configure as variáveis `VITE_SUPABASE_*` antes do build e não inclua chaves administrativas no app.

## Gerar instalador Windows
Execute `npm.cmd run dist:win`. O instalador NSIS será criado em `artifacts/windows/Backstage-Music-Setup-<versão>.exe`, junto de `latest.yml` e `.blockmap`. O updater consulta o feed publicado e pede para reiniciar quando uma atualização está pronta. O instalador não é assinado digitalmente, então o Windows pode mostrar um aviso de segurança ao executá-lo. Veja o [fluxo completo de release](docs/IMPLEMENTACAO-E-DISTRIBUICAO.md) para publicar downloads e atualizações compatíveis.
