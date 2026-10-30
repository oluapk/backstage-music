import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownUp, ArrowUpRight, Bookmark, Check, ChevronLeft, ChevronRight,
  Disc3, Download, Grid2X2, Heart, LayoutList, ListMusic, MoreHorizontal,
  Music2, Pin, Play, Plus, Search, UsersRound, X
} from 'lucide-react';
import { buildUserLibrary } from './user-library.js';

const libraryTabs = [
  ['playlists', 'Playlists'], ['artists', 'Artistas'],
];
const contentType = song => ['podcast', 'audiobook'].includes(song.contentType) ? song.contentType : 'music';

function collectAlbums(songs) {
  const albums = new Map();
  songs.forEach(song => {
    const album = song.album || 'Sem álbum';
    const artist = song.artist || 'Artista não informado';
    const key = JSON.stringify([album, artist]);
    if (!albums.has(key)) albums.set(key, { key, album, artist, songs: [] });
    albums.get(key).songs.push(song);
  });
  return [...albums.values()];
}
function collectArtists(songs) {
  const artists = new Map();
  songs.forEach(song => {
    if (!song.artist) return;
    if (!artists.has(song.artist)) artists.set(song.artist, []);
    artists.get(song.artist).push(song);
  });
  return [...artists.entries()];
}
function isCurrentCollection(item, currentId, contextKey) {
  if (!currentId || !item.songs.some(song => song.id === currentId)) return false;
  return item.kind === 'song' || !contextKey || item.key === contextKey;
}
function PlayingBars() {
  return <span className="playing-bars" role="img" aria-label="Tocando agora"><i /><i /><i /></span>;
}
export function CollectionCover({ songs = [], cover, kind = 'playlist', className = '' }) {
  const images = [...new Set(songs.map(song => song.cover).filter(value => typeof value === 'string' && value.startsWith('url(')))].slice(0, 4);
  const Icon = kind === 'favorites' ? Heart : kind === 'episodes' ? Bookmark : kind === 'artist' ? UsersRound : kind === 'album' ? Disc3 : kind === 'song' ? Music2 : ListMusic;
  const symbolic = kind === 'favorites' || kind === 'episodes';
  const mosaic = images.length > 1 && ['playlist', 'mix'].includes(kind);
  return <span className={'cover-art cover-art--' + kind + (mosaic ? ' cover-art--mosaic' : '') + ' ' + className} style={mosaic || symbolic ? undefined : { background: images[0] || cover }} aria-hidden="true">
    {mosaic ? Array.from({ length: 4 }, (_, index) => <span key={index} style={{ background: images[index % images.length] }} />) : (!images.length || symbolic) && <Icon size={32} fill={symbolic ? 'currentColor' : 'none'} />}
  </span>;
}
function CollectionShelf({ title, description, children, onMore }) {
  return <section className="collection-shelf">
    <div className="collection-shelf-heading"><div><h2>{title}</h2>{description && <p>{description}</p>}</div>{onMore && <button type="button" onClick={onMore}>Mostrar tudo <ArrowUpRight size={14} /></button>}</div>
    <div className="collection-shelf-grid">{children}</div>
  </section>;
}
function ShelfCard({ item, onPlay, playing, currentId, contextKey, progress }) {
  const current = isCurrentCollection(item, currentId, contextKey);
  const ratio = progress?.duration > 0 ? Math.min(100, Math.max(0, progress.position / progress.duration * 100)) : 0;
  return <article className={'shelf-card' + (item.kind === 'artist' ? ' shelf-card--artist' : '') + (current ? ' is-current' : '')}>
    <div className="shelf-card-art"><button type="button" className="shelf-cover-button" onClick={item.onOpen} aria-label={'Abrir capa de ' + item.title}><CollectionCover songs={item.songs} cover={item.cover} kind={item.kind} /></button>
      {item.songs.length > 0 && onPlay && <button type="button" className="shelf-play" aria-label={'Reproduzir ' + item.title} onClick={() => onPlay(item)}>{current && playing ? <PlayingBars /> : <Play size={23} fill="currentColor" />}</button>}
    </div>
    <button type="button" className="shelf-card-main" onClick={item.onOpen} aria-label={'Abrir ' + item.title}>
      <b>{item.title}</b><span>{item.subtitle}</span>
      {progress && <><span className="resume-progress" role="progressbar" aria-label={'Progresso de ' + item.title} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(ratio)}><span style={{ width: ratio + '%' }} /></span><small>{Math.floor(progress.position / 60)} de {Math.ceil(progress.duration / 60)} min</small></>}
    </button>
  </article>;
}

export function HomeView({
  songs = [], playlists = [], favorites = [], recentlyPlayedSongs = [], profileName,
  savedArtists = [], pinnedCollections = ['favorites'], savedEpisodeIds = [],
  currentId = '', playing = false, playbackContextKey = '', recommendations = [],
  playbackProgress = {}, onOpenPlaylist, onOpenFavorites, onOpenArtist, onOpenAlbum,
  onOpenCatalog, onPlay, onPlayCollection, onOpenMix, onOpenEpisodes, onOpenCategory,
  onCreatePlaylist, onOpenDownloads, onTogglePin,
}) {
  const [filter, setFilter] = useState('all');
  const [tipIndex, setTipIndex] = useState(0);
  const filteredSongs = useMemo(() => songs.filter(song => {
    if (filter === 'music') return contentType(song) === 'music';
    if (filter === 'podcasts') return contentType(song) === 'podcast';
    if (filter === 'audiobooks') return contentType(song) === 'audiobook';
    if (filter === 'following') return savedArtists.includes(song.artist);
    return true;
  }), [songs, filter, savedArtists]);
  const albums = useMemo(() => collectAlbums(filteredSongs), [filteredSongs]);
  const artists = useMemo(() => collectArtists(filteredSongs), [filteredSongs]);
  const likedSongs = filteredSongs.filter(song => favorites.includes(song.id));
  const episodeSongs = songs.filter(song => contentType(song) === 'podcast' && savedEpisodeIds.includes(song.id));
  const openCategory = type => onOpenCategory ? onOpenCategory(type) : onOpenCatalog?.();
  const playItem = item => onPlayCollection ? onPlayCollection(item.songs, { key: item.key, label: item.title }) : onPlay?.(item.songs[0]);
  const playlistEntries = playlists.map(playlist => ({
    id: playlist.id, key: 'playlist:' + playlist.id, title: playlist.name, kind: 'playlist', cover: playlist.cover,
    songs: filteredSongs.filter(song => playlist.songIds.includes(song.id)),
    onOpen: () => onOpenPlaylist?.(playlist.id),
  })).filter(item => ['all', 'playlists'].includes(filter) || item.songs.length > 0);
  const albumEntries = albums.map(album => ({
    id: album.key, key: 'album:' + album.key, title: album.album, subtitle: album.artist,
    kind: 'album', songs: album.songs, onOpen: () => onOpenAlbum?.(album),
  }));
  const artistEntries = artists.map(([artist, artistSongs]) => ({
    id: artist, key: 'artist:' + artist, title: artist, subtitle: 'Artista', kind: 'artist',
    songs: artistSongs, onOpen: () => onOpenArtist?.(artist),
  }));
  const pinnedMixEntries = ['all', 'music', 'playlists'].includes(filter)
    ? recommendations.filter(mix => pinnedCollections.includes('mix:' + mix.id)).map(mix => ({
      ...mix, key: 'mix:' + mix.id, kind: 'mix', subtitle: mix.description,
      onOpen: () => onOpenMix?.(mix),
    })) : [];
  const recentOrder = new Map(recentlyPlayedSongs.map((song, index) => [song.id, index]));
  const recentRank = item => Math.min(Number.MAX_SAFE_INTEGER, ...item.songs.map(song => recentOrder.get(song.id) ?? Number.MAX_SAFE_INTEGER));
  const shortcuts = [
    ...pinnedMixEntries,
    ...(['all', 'music', 'playlists'].includes(filter) ? [
      { id: 'favorites', key: 'favorites', title: 'Músicas curtidas', kind: 'favorites', songs: likedSongs, onOpen: onOpenFavorites },
      ...playlistEntries,
    ] : []),
    ...(filter === 'podcasts' ? [{ id: 'episodes', key: 'episodes', title: 'Seus episódios', kind: 'episodes', songs: episodeSongs, onOpen: onOpenEpisodes }] : []),
    ...(filter !== 'playlists' ? [...albumEntries, ...artistEntries] : []),
  ].sort((a, b) => {
    const aPin = pinnedCollections.indexOf(a.key), bPin = pinnedCollections.indexOf(b.key);
    if (aPin >= 0 || bPin >= 0) return aPin < 0 ? 1 : bPin < 0 ? -1 : aPin - bPin;
    return recentRank(a) - recentRank(b);
  }).slice(0, 8);
  const filteredIds = new Set(filteredSongs.map(song => song.id));
  const recent = recentlyPlayedSongs.filter(song => filteredIds.has(song.id)).slice(0, 6);
  const resumed = filteredSongs.filter(song => {
    const saved = playbackProgress[song.id];
    return contentType(song) !== 'music' && saved?.position > 0 && saved.duration > saved.position + 5;
  }).slice(0, 6);
  const tips = [
    { title: 'Encontre seu próximo som', text: 'Explore as músicas, artistas e álbuns que já estão no seu catálogo.', action: 'Explorar catálogo', run: onOpenCatalog, complete: recentlyPlayedSongs.length > 0 },
    { title: 'Uma playlist com a sua cara', text: 'Crie uma coleção e adicione suas faixas favoritas.', action: 'Criar playlist', run: onCreatePlaylist || onOpenCatalog, complete: playlists.length > 0 },
    { title: 'Leve sua música com você', text: 'Baixe faixas do catálogo e ouça neste aparelho mesmo sem internet.', action: 'Ver downloads', run: onOpenDownloads || onOpenCatalog, complete: songs.some(song => song.isDownloaded) },
  ];
  const tip = tips[tipIndex];
  const emptyCategory = ['following', 'podcasts', 'audiobooks'].includes(filter) && filteredSongs.length === 0;
  return <div className="music-home" data-home-filter={filter}>
    <div className="home-filter-bar" aria-label="Filtrar início">
      {[['all', 'Tudo'], ['music', 'Músicas'], ['following', 'Seguindo'], ['podcasts', 'Podcasts'], ['audiobooks', 'Audiolivros'], ['playlists', 'Playlists']].map(([value, label]) => <button type="button" key={value} aria-pressed={filter === value} className={filter === value ? 'selected' : ''} onClick={() => setFilter(value)}>{label}</button>)}
    </div>
    <div className="home-welcome"><p>SEU BACKSTAGE</p><h1>{profileName ? 'Seu som, ' + profileName + '.' : 'O seu som está aqui.'}</h1><span>Seu catálogo, suas escolhas, seu momento.</span></div>
    <div className="quick-access-grid">
      {shortcuts.map(item => {
        const current = isCurrentCollection(item, currentId, playbackContextKey);
        return <article className={'quick-access-item' + (current ? ' is-current' : '')} key={item.key}>
          <button type="button" className="quick-access-main" onClick={item.onOpen}><CollectionCover songs={item.songs} cover={item.cover} kind={item.kind} /><span>{item.title}</span></button>
          {current && playing && <PlayingBars />}
          {onTogglePin && <button type="button" className={'quick-pin-button' + (pinnedCollections.includes(item.key) ? ' is-pinned' : '')} aria-label={(pinnedCollections.includes(item.key) ? 'Desafixar ' : 'Fixar ') + item.title} aria-pressed={pinnedCollections.includes(item.key)} onClick={() => onTogglePin(item.key)}><Pin size={15} /></button>}
          {item.songs.length > 0 && <button type="button" className="quick-access-play" aria-label={'Reproduzir ' + item.title} onClick={() => playItem(item)}><Play size={19} fill="currentColor" /></button>}
        </article>;
      })}
    </div>
    {emptyCategory && <div className="collection-view-empty"><Music2 size={32} /><h2>{filter === 'following' ? 'Seu próximo artista favorito está por aqui' : filter === 'podcasts' ? 'Nenhum podcast no catálogo ainda' : 'Nenhum audiolivro no catálogo ainda'}</h2><p>{filter === 'following' ? 'Abra um artista do catálogo e escolha Seguir para encontrá-lo nesta seleção.' : 'Os títulos publicados nesta categoria aparecerão aqui para reproduzir, salvar e baixar.'}</p><button type="button" className="outline-button" onClick={() => openCategory(filter === 'following' ? 'artists' : filter)}>Explorar {filter === 'following' ? 'artistas' : 'catálogo'}</button></div>}
    {filter !== 'playlists' && resumed.length > 0 && <CollectionShelf title="Continue de onde parou" description="Seu ponto de reprodução fica salvo neste aparelho.">
      {resumed.map(song => <ShelfCard key={song.id} item={{ id: song.id, key: 'song:' + song.id, title: song.title, subtitle: song.artist, songs: [song], kind: 'song', onOpen: () => onPlay?.(song) }} progress={playbackProgress[song.id]} onPlay={() => onPlay?.(song)} currentId={currentId} playing={playing} contextKey={playbackContextKey} />)}
    </CollectionShelf>}
    {filter !== 'playlists' && recent.length > 0 && <CollectionShelf title="Volte para o seu som" description="Suas últimas reproduções." onMore={() => openCategory('recent')}>
      {recent.map(song => <ShelfCard key={song.id} item={{ id: song.id, key: 'song:' + song.id, title: song.title, subtitle: song.artist, songs: [song], kind: 'song', onOpen: () => onPlay?.(song) }} onPlay={() => onPlay?.(song)} playing={playing} currentId={currentId} contextKey={playbackContextKey} />)}
    </CollectionShelf>}
    {['all', 'music'].includes(filter) && recommendations.length > 0 && <CollectionShelf title={'Feito para ' + (profileName || 'você')} description="Seleções feitas com as músicas do seu catálogo.">
      {recommendations.map(mix => <ShelfCard key={mix.id} item={{ ...mix, key: 'mix:' + mix.id, kind: 'mix', subtitle: mix.description, onOpen: () => onOpenMix?.(mix) }} onPlay={playItem} currentId={currentId} playing={playing} contextKey={playbackContextKey} />)}
    </CollectionShelf>}
    {['all', 'music', 'playlists'].includes(filter) && playlistEntries.length > 0 && <CollectionShelf title="Feitas por você" description="Um lugar para cada momento." onMore={() => openCategory('playlists')}>
      {playlistEntries.slice(0, 6).map(item => <ShelfCard key={item.key} item={{ ...item, subtitle: 'Playlist · ' + item.songs.length + ' faixas' }} onPlay={playItem} currentId={currentId} playing={playing} contextKey={playbackContextKey} />)}
    </CollectionShelf>}
    {filter !== 'playlists' && albums.length > 0 && <CollectionShelf title={filter === 'podcasts' ? 'Podcasts para ouvir' : filter === 'audiobooks' ? 'Livros para ouvir' : 'Álbuns para explorar'} onMore={() => openCategory(filter === 'podcasts' || filter === 'audiobooks' ? filter : 'albums')}>
      {albumEntries.slice(0, 6).map(item => <ShelfCard key={item.key} item={item} onPlay={playItem} currentId={currentId} playing={playing} contextKey={playbackContextKey} />)}
    </CollectionShelf>}
    {filter !== 'playlists' && artists.length > 0 && <CollectionShelf title={filter === 'following' ? 'Artistas que você segue' : 'Artistas do seu catálogo'} onMore={() => openCategory(filter === 'following' ? 'following' : 'artists')}>
      {artistEntries.slice(0, 6).map(item => <ShelfCard key={item.key} item={item} onPlay={playItem} currentId={currentId} playing={playing} contextKey={playbackContextKey} />)}
    </CollectionShelf>}
    {!songs.length && <div className="collection-view-empty"><Music2 size={34} /><h2>Seu próximo play começa aqui</h2><p>As músicas do seu catálogo aparecerão neste espaço.</p><button type="button" className="primary-button" onClick={onOpenCatalog}>Abrir catálogo <ArrowUpRight size={17} /></button></div>}
    <section className="getting-started" aria-label="Como começar">
      <div className="collection-shelf-heading"><h2>Como começar</h2><div className="tip-navigation"><button type="button" aria-label="Dica anterior" onClick={() => setTipIndex(index => (index + tips.length - 1) % tips.length)}><ChevronLeft size={20} /></button><button type="button" aria-label="Próxima dica" onClick={() => setTipIndex(index => (index + 1) % tips.length)}><ChevronRight size={20} /></button></div></div>
      <div className="getting-started-card"><span className="tip-step">{tip.complete ? <Check size={23} /> : tipIndex + 1}</span><div><span className="tip-kicker">{tip.complete ? 'Você já deu esse passo' : 'Do seu jeito'}</span><h3>{tip.title}</h3><p>{tip.text}</p><button type="button" onClick={tip.run}>{tip.action} <ArrowUpRight size={16} /></button></div></div>
      <div className="tip-dots" aria-label="Escolher dica">{tips.map((item, index) => <button type="button" key={item.title} aria-label={'Ver dica ' + (index + 1)} aria-pressed={index === tipIndex} onClick={() => setTipIndex(index)} />)}</div>
    </section>
  </div>;
}

export function LibraryView({
  songs = [], playlists = [], favorites = [], recentlyPlayedSongs = [], savedArtists = [],
  pinnedCollections = ['favorites'], ownerId, currentId = '', playing = false,
  playbackContextKey = '', tab = 'playlists', onTabChange, onOpenPlaylist, onOpenFavorites,
  onOpenArtist, onCreatePlaylist, onPlay, onPlayCollection,
  onTogglePin, onToggleArtist, onCollectionAction, searchVisible, onSearchVisibleChange,
  sortMode, onSortChange, viewMode, onViewModeChange,
}) {
  const activeTab = tab === 'artists' || tab === 'following' ? 'artists' : 'playlists';
  const [search, setSearch] = useState('');
  const [internalSearchOpen, setInternalSearchOpen] = useState(false);
  const searchOpen = searchVisible ?? internalSearchOpen;
  const setSearchOpen = onSearchVisibleChange || setInternalSearchOpen;
  useEffect(() => { if (!searchOpen) setSearch(''); }, [searchOpen]);
  const [internalSort, setInternalSort] = useState('recent');
  const sort = sortMode ?? internalSort;
  const setSort = onSortChange || setInternalSort;
  const [internalGrid, setInternalGrid] = useState(false);
  const grid = viewMode ? viewMode === 'grid' : internalGrid;
  const setGrid = value => onViewModeChange ? onViewModeChange(value ? 'grid' : 'list') : setInternalGrid(value);
  const [menuKey, setMenuKey] = useState(null);
  const [menuPosition, setMenuPosition] = useState({});
  const menuRef = useRef(null);
  const menuTriggerRef = useRef(null);
  useEffect(() => {
    if (!menuKey) return undefined;
    menuRef.current?.querySelector('[role="menuitem"]')?.focus();
    const closeOutside = event => {
      if (!menuRef.current?.contains(event.target) && !menuTriggerRef.current?.contains(event.target)) setMenuKey(null);
    };
    const keys = event => {
      if (event.key === 'Escape') { event.preventDefault(); setMenuKey(null); menuTriggerRef.current?.focus(); }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      const buttons = [...(menuRef.current?.querySelectorAll('[role="menuitem"]') || [])];
      if (!buttons.length) return;
      event.preventDefault();
      const index = buttons.indexOf(document.activeElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next].focus();
    };
    window.addEventListener('pointerdown', closeOutside);
    window.addEventListener('keydown', keys);
    const closeOnResize = () => setMenuKey(null);
    window.addEventListener('resize', closeOnResize);
    return () => { window.removeEventListener('pointerdown', closeOutside); window.removeEventListener('keydown', keys); window.removeEventListener('resize', closeOnResize); };
  }, [menuKey]);
  useEffect(() => { setMenuKey(null); }, [tab, search, grid, sort]);
  const items = useMemo(() => buildUserLibrary({ songs, playlists, favorites, savedArtists, ownerId,
    tab: activeTab, search, sort, pinnedCollections, recentlyPlayedSongs }).map(item => ({ ...item,
      onOpen: item.kind === 'favorites' ? onOpenFavorites : item.kind === 'playlist'
        ? () => onOpenPlaylist?.(item.id) : () => onOpenArtist?.(item.id),
    })), [songs, playlists, favorites, savedArtists, ownerId, activeTab, search, sort, pinnedCollections, recentlyPlayedSongs, onOpenFavorites, onOpenPlaylist, onOpenArtist]);
  const toggleSearch = () => { setSearchOpen(!searchOpen); setSearch(''); };
  const playItem = item => {
    if (onCollectionAction) onCollectionAction('play', item);
    else if (onPlayCollection) onPlayCollection(item.songs, { key: item.key, label: item.title });
    else if (item.songs[0]) onPlay?.(item.songs[0]);
  };
  const act = (action, item) => {
    setMenuKey(null);
    if (action === 'pin') onTogglePin?.(item.key);
    else if (action === 'unfollow') onToggleArtist?.(item.id);
    else if (action === 'play') playItem(item);
    else onCollectionAction?.(action, item);
  };
  const personalItems = items.filter(item => item.kind !== 'favorites');
  const emptyTitle = search ? 'Nenhum resultado encontrado' : activeTab === 'artists' ? 'Você ainda não segue nenhum artista' : 'Você ainda não criou uma playlist';
  return <section className={'collection-browser' + (grid ? ' collection-browser--grid' : '')}>
    <div className="collection-browser-heading"><div><p>SEU ESPAÇO</p><h1>Sua Biblioteca</h1></div><div className="collection-browser-actions"><button type="button" className="icon-button" aria-label={searchOpen ? 'Fechar busca na biblioteca' : 'Buscar na biblioteca'} aria-expanded={searchOpen} onClick={toggleSearch}>{searchOpen ? <X size={25} /> : <Search size={25} />}</button><button type="button" className="icon-button" aria-label="Criar playlist" onClick={onCreatePlaylist}><Plus size={30} /></button></div></div>
    <p className="library-personal-note">Suas músicas curtidas, playlists e artistas seguidos.</p>
    <div className="collection-filter-bar" aria-label="Filtrar biblioteca">{libraryTabs.map(([value, label]) => <button type="button" key={value} className={activeTab === value ? 'selected' : ''} aria-pressed={activeTab === value} onClick={() => onTabChange?.(value)}>{label}</button>)}</div>
    {searchOpen && <label className="collection-search"><Search size={18} /><input autoFocus value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar na sua biblioteca" aria-label="Buscar na sua biblioteca" />{search && <button type="button" aria-label="Limpar busca na biblioteca" onClick={() => setSearch('')}><X size={17} /></button>}</label>}
    <div className="library-toolbar"><label className="library-sort"><ArrowDownUp size={19} /><select aria-label="Ordenar biblioteca" value={sort} onChange={event => setSort(event.target.value)}><option value="recent">Recentes</option><option value="name">Nome</option><option value="created">Criadas recentemente</option></select></label><button type="button" className="icon-button" aria-label={grid ? 'Mostrar biblioteca em lista' : 'Mostrar biblioteca em grade'} aria-pressed={grid} onClick={() => setGrid(!grid)}>{grid ? <LayoutList size={21} /> : <Grid2X2 size={21} />}</button></div>
    <div className="library-collection-list">{items.map(item => {
      const current = isCurrentCollection(item, currentId, playbackContextKey);
      const hasActions = item.kind === 'favorites' ? item.songs.length > 0 && (onCollectionAction || onPlayCollection) : onTogglePin || onToggleArtist || onCollectionAction || onPlayCollection;
      return <article key={item.key} className={'library-collection-item library-collection-item--' + item.kind + (current ? ' is-current' : '')} data-collection-key={item.key}>
        <button type="button" className="library-collection-main" aria-label={(item.kind === 'song' ? 'Reproduzir ' : 'Abrir ') + item.title} onClick={item.onOpen}>
          <CollectionCover songs={item.songs} cover={item.cover} kind={item.kind} /><span className="library-collection-label"><b>{item.title}</b><span>{item.pinned && <Pin size={14} className="library-pinned" />}{item.saved && <Check size={14} className="library-pinned" />}{item.downloaded && <Download size={14} className="library-pinned" />}{item.subtitle}</span></span>
        </button>
        <div className="library-row-actions">
          {current && playing && <PlayingBars />}
          {item.songs.length > 0 && <button type="button" className="library-track-play" aria-label={'Reproduzir coleção ' + item.title} onClick={() => playItem(item)}><Play size={18} fill="currentColor" /></button>}
          {hasActions && <button type="button" className="library-context-trigger" aria-label={'Opções de ' + item.title} aria-haspopup="menu" aria-expanded={menuKey === item.key} onClick={event => {
            menuTriggerRef.current = event.currentTarget;
            const rect = event.currentTarget.getBoundingClientRect();
            const reservedBottom = window.innerWidth <= 760 ? 150 : 104;
            const availableHeight = Math.max(160, window.innerHeight - reservedBottom - 24);
            const estimatedHeight = Math.min(330, availableHeight);
            const below = rect.bottom + 8;
            const top = below + estimatedHeight <= window.innerHeight - reservedBottom ? below : Math.max(12, rect.top - estimatedHeight);
            setMenuPosition({ top, left: Math.max(8, Math.min(rect.right - 260, window.innerWidth - 268)), maxHeight: availableHeight });
            setMenuKey(key => key === item.key ? null : item.key);
          }}><MoreHorizontal size={21} /></button>}
        </div>
        {menuKey === item.key && <div className="collection-context-menu" role="menu" aria-label={'Opções de ' + item.title} ref={menuRef} style={menuPosition}>
          {item.songs.length > 0 && <button type="button" role="menuitem" onClick={() => act('play', item)}><Play size={16} /> Reproduzir</button>}
          {onCollectionAction && item.songs.length > 0 && <button type="button" role="menuitem" onClick={() => act('queue', item)}><ListMusic size={16} /> Adicionar à fila</button>}
          {onTogglePin && item.kind !== 'favorites' && <button type="button" role="menuitem" onClick={() => act('pin', item)}><Pin size={16} /> {item.pinned ? 'Desafixar' : 'Fixar'}</button>}
          {onCollectionAction && item.songs.some(song => !song.isDownloaded) && <button type="button" role="menuitem" onClick={() => act('download', item)}><Download size={16} /> Baixar para ouvir offline</button>}
          {onToggleArtist && item.kind === 'artist' && <button type="button" role="menuitem" onClick={() => act('unfollow', item)}><UsersRound size={16} /> Deixar de seguir</button>}
          {onCollectionAction && item.kind === 'playlist' && <><button type="button" role="menuitem" onClick={() => act('rename', item)}>Renomear playlist</button><button type="button" role="menuitem" className="collection-menu-danger" onClick={() => act('delete', item)}>Excluir playlist</button></>}
        </div>}
      </article>;
    })}</div>
    {(!items.length || (!search && !personalItems.length)) && <div className="collection-view-empty"><Search size={29} /><h2>{emptyTitle}</h2><p>{search ? 'Busque entre suas músicas curtidas, playlists criadas e artistas seguidos.' : activeTab === 'artists' ? 'Escolha Seguir na página de um artista para adicioná-lo à sua biblioteca.' : 'Crie uma playlist e escolha quais músicas adicionar.'}</p>{!search && activeTab === 'playlists' && <button type="button" className="primary-button" onClick={onCreatePlaylist}><Plus size={17} /> Criar playlist</button>}</div>}
    <p className="library-collection-count">{personalItems.length} {activeTab === 'artists' ? personalItems.length === 1 ? 'artista seguido' : 'artistas seguidos' : personalItems.length === 1 ? 'playlist criada por você' : 'playlists criadas por você'}</p>
  </section>;
}
