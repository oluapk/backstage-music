# Sua Biblioteca: somente escolhas do usuário

A biblioteca tem uma coleção fixa **Músicas curtidas** e duas abas: **Playlists** e **Artistas**. A coleção de curtidas aparece nas duas abas, sempre antes dos demais itens. Buscar filtra somente as coleções da aba atual; a busca não importa resultados do catálogo para a biblioteca.

## Implementação no aplicativo

`src/user-library.js` centraliza a seleção; `LibraryView` em `src/LibraryViews.jsx` renderiza os resultados. A barra lateral segue as mesmas regras. O histórico pode ordenar coleções já salvas, mas não cria itens. Fixar um álbum, artista ou mix no início também não o adiciona implicitamente à biblioteca.

```jsx
const [tab, setTab] = useState('playlists');

const items = useMemo(() => buildUserLibrary({
  songs: catalogTracks,
  playlists: userPlaylists,
  favorites: likedSongIds,
  savedArtists: followedArtistNames,
  ownerId: session?.user.id,
  tab,
  search,
}), [catalogTracks, userPlaylists, likedSongIds, followedArtistNames,
  session?.user.id, tab, search]);
```

As fontes são explícitas:

| Categoria | Fonte do estado | Entrada na biblioteca | Remoção |
| --- | --- | --- | --- |
| Músicas curtidas | `favorites` | Curtir uma faixa | Descurtir a faixa |
| Playlists | `playlists`, com `source: 'user'` e `ownerId` | Criar manualmente ou escolher Salvar como playlist | Excluir a playlist |
| Artistas | `savedArtistNames` | Escolher Seguir na página do artista | Seguindo ou menu Deixar de seguir |

Uma seleção automática só vira playlist pessoal se o usuário executar **Salvar como playlist**. Essa ação cria uma playlist independente, editável e identificada como `source: 'user'`; sugestões não salvas continuam fora da biblioteca. Playlists antigas deste projeto não tinham `source`/`ownerId`: são preservadas como manuais dentro do armazenamento da conta em que já existiam. Novas playlists gravam ambos os campos. Entradas explicitamente marcadas como sistema ou de outro proprietário são ocultadas.

Um artista seguido continua salvo mesmo sem músicas disponíveis no catálogo. A origem da lista de artistas é a relação de seguidos, não `distinct tracks.artist`. Downloads, episódios, histórico, álbuns e artistas não seguidos ficam fora de Sua Biblioteca. O catálogo e as páginas de exploração continuam acessíveis separadamente; downloads têm uma tela própria.

Exemplo de layout já aplicado:

```jsx
<LibraryView
  ownerId={session?.user.id}
  songs={catalogTracks}
  playlists={userPlaylists}
  favorites={likedSongIds}
  savedArtists={followedArtistNames}
  tab={tab}
  onTabChange={setTab}
  onOpenFavorites={openLikedSongs}
  onOpenPlaylist={openPlaylist}
  onOpenArtist={openArtist}
  onToggleArtist={toggleFollowedArtist}
/>
```

O componente mantém lista/grade, busca, ordenação, reprodução, fila, download de coleções e edição/exclusão de playlists. São ações sobre as escolhas do usuário; não ampliam automaticamente os itens exibidos.

## Persistência atual

O app mantém preferências no `localStorage`, separadas pelo identificador da conta:

```text
backstage-profile:<userId>:favorites
backstage-profile:<userId>:playlists
backstage-profile:<userId>:saved-artists
```

Metadados do catálogo e áudio offline continuam no IndexedDB. O conteúdo baixado não se torna curtido nem uma playlist por ser baixado. Durante a troca de conta, a biblioteca aguarda o estado correspondente ao perfil para não exibir escolhas do perfil anterior.

## Estrutura pronta para Supabase

`supabase/user-library.sql` prepara quatro tabelas:

| Tabela | Campos principais | Relação |
| --- | --- | --- |
| `user_playlists` | `id`, `user_id`, `name`, `description`, `source`, `created_at` | Playlists criadas pelo dono |
| `liked_songs` | `user_id`, `track_id`, `created_at` | Faixas explicitamente curtidas |
| `followed_artists` | `user_id`, `artist_name`, `created_at` | Artistas explicitamente seguidos |
| `user_playlist_tracks` | `playlist_id`, `user_id`, `track_id`, `position` | Faixas e ordem de cada playlist |

O script usa o tipo real de `tracks.id` para as chaves de faixas. A chave composta da relação playlist/proprietário impede adicionar faixas a uma playlist de outra conta. Artistas usam `artist_name`, compatível com o catálogo atual; se futuramente existir uma tabela `artists` com ID estável, essa relação poderá migrar para `artist_id` para tratar renomeações.

Todas as tabelas têm RLS com leitura/escrita restritas ao dono:

```sql
USING (user_id = (SELECT auth.uid()))
WITH CHECK (user_id = (SELECT auth.uid()))
```

O frontend também filtra `user_id`, mas a autorização é aplicada pelo banco. O modelo segue a [documentação de RLS do Supabase](https://supabase.com/docs/guides/database/postgres/row-level-security).

As consultas implementadas em `src/user-library-api.js` são equivalentes a:

```js
const userId = session.user.id;

const playlists = await supabase.from('user_playlists')
  .select('id,user_id,name,description,source,created_at')
  .eq('user_id', userId)
  .eq('source', 'user');

const followed = await supabase.from('followed_artists')
  .select('user_id,artist_name,created_at')
  .eq('user_id', userId);

const likes = await supabase.from('liked_songs')
  .select('user_id,track_id,created_at')
  .eq('user_id', userId);
```

O adaptador real também pagina as consultas e carrega `user_playlist_tracks`, devolvendo o mesmo formato de estado que a interface usa:

```js
import { loadUserLibrary, setSongLiked, setArtistFollowed } from './user-library-api.js';

const state = await loadUserLibrary(supabase, session.user.id);
// { favorites: ['supabase-<id>'], playlists: [...], savedArtists: [...] }

await setSongLiked(supabase, session.user.id, song.id, true);
await setArtistFollowed(supabase, session.user.id, artistName, true);
```

**A migração e a sincronização em nuvem não foram ativadas automaticamente.** O fluxo atual continua usando persistência local. Para adotar a nuvem:

1. Revise e execute `supabase/user-library.sql` no SQL Editor do projeto.
2. Teste com duas contas: nenhuma deve conseguir consultar ou alterar os registros da outra.
3. Importe explicitamente as escolhas locais para a conta correspondente antes de substituir o estado local pelos resultados do servidor. Não sobrescreva dados locais com uma consulta vazia durante a migração.
4. Conecte leitura e escrita das ações ao adaptador, mantendo cache local, confirmação de falhas e verificação de que a conta continua a mesma ao receber respostas assíncronas. A nuvem exige conexão; o cache mantém as escolhas acessíveis offline.
5. Para salvar uma playlist inteira e suas faixas, use uma transação/RPC: atualize a playlist e substitua seus vínculos como uma única operação. Não trate uma gravação parcial como sucesso.

Nenhum registro de curtida, playlist ou artista seguido deve ser criado ao carregar o catálogo. Use a chave pública com a sessão autenticada; o cliente não precisa de `service_role`.

## Validação

`npm.cmd test` cobre a seleção estrita, isolamento por proprietário, compatibilidade das playlists antigas, busca, artistas sem faixas e consultas por conta. `node scripts/check-interface.mjs` valida a interface no Edge com dados fictícios, incluindo criação de playlist, exclusão de artista seguido e ausência de sugestões, itens de sistema e dados de outra conta. Capturas da biblioteca ficam em `artifacts/functional-review/library-desktop.png` e `library-mobile.png`.
