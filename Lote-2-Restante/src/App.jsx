import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import { Capacitor } from '@capacitor/core';
import { MediaSession } from '@capgo/capacitor-media-session';
import { LocalNotifications } from '@capacitor/local-notifications';
import { CollectionCover, HomeView, LibraryView } from './LibraryViews.jsx';
import { loadPublishedTracks } from './catalog.js';
import { openMusicDB, OFFLINE_TRACK_STORE, catalogCacheKey, readCatalogSnapshot, saveCatalogSnapshot } from './catalog-cache.js';
import { createSearchIndex, makeSearchEntries, getSearchSuggestions } from './search.js';
import TrackPlayButton from './TrackPlayButton.jsx';
import { getUserPlaylists } from './user-library.js';
import CatalogSearch from './CatalogSearch.jsx';
import { CatalogUpdates, InstallDialog, ShortcutHelp } from './AppFeatures.jsx';
import { normalizeContentType, buildRecommendations, normalizeSearchHistory, compactProgress } from './catalog-models.js';
import {
  AudioLines, Search, Home, Library, Heart, Plus, Play, Pause, SkipBack,
  SkipForward, Volume2, Music2, Disc3, Shuffle, Repeat, ListMusic,
  X, UsersRound, Clock3, ArrowLeft, Radio, Repeat1, Download, Check,
  Trash2, Settings2, ChevronDown, ArrowUp, ArrowDown, UserPlus,
  UserCheck, Users, Gauge, Share2, PanelRight, LogOut, Bell, Pin, Maximize2, Minimize2,
  Bookmark, RotateCcw, RotateCw, Keyboard, Monitor
} from 'lucide-react';

const supabaseUrlValue = import.meta.env.VITE_SUPABASE_URL?.trim().replace(/\/+$/, '') || '';
const supabaseUrlIsValid = (() => {
  try {
    const url = new URL(supabaseUrlValue);
    return url.protocol === 'https:' && url.hostname.endsWith('.supabase.co')
      && url.hostname.length > '.supabase.co'.length && (url.pathname === '' || url.pathname === '/');
  } catch {
    return false;
  }
})();
const supabaseUrl = supabaseUrlIsValid ? supabaseUrlValue : '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() || '';
const supabaseBucket = import.meta.env.VITE_SUPABASE_STORAGE_BUCKET || 'music';
const publicStorage = import.meta.env.VITE_SUPABASE_STORAGE_PUBLIC !== 'false';
const supabase = supabaseUrl && supabaseAnonKey ? createClient(supabaseUrl, supabaseAnonKey) : null;
const covers = [
  'linear-gradient(135deg,#176b50,#09251c)',
  'linear-gradient(135deg,#58417d,#21152e)',
  'linear-gradient(135deg,#8c542b,#321d10)',
  'linear-gradient(135deg,#b33c5a,#43172a)',
  'linear-gradient(135deg,#24649a,#102239)',
  'linear-gradient(135deg,#ab8b28,#43320c)',
];
const makeId = () => globalThis.crypto?.randomUUID?.() || `bsm-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const defaultAppSettings = {
  theme: 'dark',
  accent: 'mint',
  autoplay: true,
  shuffleDefault: false,
  repeatDefault: 'off',
  dataSaver: false,
  offlineMode: false,
  playbackRate: 1,
  librarySort: 'recent',
  libraryViewMode: 'list',
};
const accentColors = {
  mint: { color: '#1ed760', contrast: '#071e10' },
  blue: { color: '#78aaff', contrast: '#101c33' },
  rose: { color: '#ff91ad', contrast: '#35131e' },
  amber: { color: '#ffd166', contrast: '#32250a' },
};

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

function getStoredJSON(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || 'null');
    return value ?? fallback;
  } catch {
    return fallback;
  }
}
function isCatalogTrackId(id) {
  return typeof id === 'string' && id.startsWith('supabase-');
}
function getFavorites() {
  const value = getStoredJSON('backstage-favorites', []);
  return Array.isArray(value) ? value.filter(isCatalogTrackId) : [];
}
function getPlaylists() {
  const value = getStoredJSON('backstage-playlists', []);
  return normalizePlaylists(value);
}
function normalizePlaylists(value, ownerId) {
  return Array.isArray(value)
    ? value.filter(playlist => playlist && typeof playlist === 'object' && typeof playlist.id === 'string')
      .map(playlist => ({
        ...playlist,
        source: playlist.source || 'user',
        ownerId: playlist.ownerId || ownerId,
        songIds: (Array.isArray(playlist.songIds) ? playlist.songIds : []).filter(isCatalogTrackId),
      }))
    : [];
}
function getProfileStorageKey(profileId, preference) {
  return profileId === 'offline'
    ? `backstage-${preference}`
    : `backstage-profile:${profileId}:${preference}`;
}
async function deleteMusicRecord(storeName, id) {
  const db = await openMusicDB();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).delete(id);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error('Não foi possível excluir o item salvo.'));
      tx.onabort = () => reject(tx.error || new Error('A exclusão foi cancelada.'));
    });
  } finally { db.close(); }
}
async function loadOfflineTracks() {
  const db = await openMusicDB();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(OFFLINE_TRACK_STORE, 'readonly').objectStore(OFFLINE_TRACK_STORE).getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error || new Error('Não foi possível ler os downloads offline.'));
    });
  } finally { db.close(); }
}
async function saveOfflineTrack(track) {
  const db = await openMusicDB();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(OFFLINE_TRACK_STORE, 'readwrite');
      tx.objectStore(OFFLINE_TRACK_STORE).put(track);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error('Não foi possível salvar o download offline.'));
      tx.onabort = () => reject(tx.error || new Error('O download offline foi cancelado.'));
    });
  } finally { db.close(); }
}

export default function App() {
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState('');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [showAuthScreen, setShowAuthScreen] = useState(false);
  const [showPasswordDialog, setShowPasswordDialog] = useState(false);
  const [profileSettingsOpen, setProfileSettingsOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [nowPanelOpen, setNowPanelOpen] = useState(true);
  const [artistShowAll, setArtistShowAll] = useState(false);
  const [discographyView, setDiscographyView] = useState('all');
  const [savedArtistNames, setSavedArtistNames] = useState([]);
  const [listenerData, setListenerData] = useState({ recentSearches: [], pinnedCollections: ['favorites'], savedEpisodeIds: [], playbackProgress: {}, lastCatalogSeenAt: 0 });
  const [playbackContext, setPlaybackContext] = useState(null);
  const [selectedMix, setSelectedMix] = useState(null);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [installOpen, setInstallOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [libraryExpanded, setLibraryExpanded] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [bulkDownloading, setBulkDownloading] = useState(false);
  const [appSettingsOpen, setAppSettingsOpen] = useState(false);
  const [appSettings, setAppSettings] = useState(defaultAppSettings);
  const [loadedAppSettingsProfileId, setLoadedAppSettingsProfileId] = useState('');
  const [storageEstimate, setStorageEstimate] = useState(null);
  const [storageLoading, setStorageLoading] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState('unknown');
  const [socialProfiles, setSocialProfiles] = useState([]);
  const [socialFollowingIds, setSocialFollowingIds] = useState([]);
  const [socialFollowerCount, setSocialFollowerCount] = useState(0);
  const [socialActivity, setSocialActivity] = useState([]);
  const [socialReady, setSocialReady] = useState(false);
  const [socialLoading, setSocialLoading] = useState(false);
  const [socialError, setSocialError] = useState('');
  const [socialQuery, setSocialQuery] = useState('');
  const [profileName, setProfileName] = useState('');
  const [profileNameDraft, setProfileNameDraft] = useState('');
  const [passwordConfigured, setPasswordConfigured] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordSubmitting, setPasswordSubmitting] = useState(false);
  const [explicitlySignedOut, setExplicitlySignedOut] = useState(
    () => localStorage.getItem('backstage-explicitly-signed-out') === 'true'
  );
  const [supabaseTracks, setSupabaseTracks] = useState([]);
  const [offlineTracks, setOfflineTracks] = useState([]);
  const [offlineDownloadsLoading, setOfflineDownloadsLoading] = useState(true);
  const [downloadingIds, setDownloadingIds] = useState([]);
  const [supabaseLoading, setSupabaseLoading] = useState(false);
  const [supabaseError, setSupabaseError] = useState('');
  const [catalogFromCache, setCatalogFromCache] = useState(false);
  const [favorites, setFavorites] = useState(getFavorites);
  const [playlists, setPlaylists] = useState(getPlaylists);
  const [queuedSongIds, setQueuedSongIds] = useState(() => {
    const ids = getStoredJSON('backstage-queue', []);
    return Array.isArray(ids) ? ids.filter(isCatalogTrackId) : [];
  });
  const [recentlyPlayedIds, setRecentlyPlayedIds] = useState(() => {
    const ids = getStoredJSON('backstage-recently-played', []);
    return Array.isArray(ids) ? ids.filter(isCatalogTrackId) : [];
  });
  const [queueOpen, setQueueOpen] = useState(false);
  const [expandedPlayerOpen, setExpandedPlayerOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [trackPageSize, setTrackPageSize] = useState(100);
  const [section, setSection] = useState('home');
  useEffect(() => { setTrackPageSize(100); }, [query, section]);
  const [libraryTab, setLibraryTab] = useState('playlists');
  const [catalogCategory, setCatalogCategory] = useState('all');
  const [librarySearchOpen, setLibrarySearchOpen] = useState(false);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState(null);
  const [selectedArtist, setSelectedArtist] = useState('');
  const [selectedAlbum, setSelectedAlbum] = useState('');
  const [selectedAlbumArtist, setSelectedAlbumArtist] = useState('');
  const [collectionSort, setCollectionSort] = useState('added-desc');
  const [trackToAdd, setTrackToAdd] = useState(null);
  const [currentId, setCurrentId] = useState('');
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(80);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [shuffle, setShuffle] = useState(false);
  const [repeatMode, setRepeatMode] = useState('off');
  const [notice, setNotice] = useState('');
  const [loadedPreferencesProfileId, setLoadedPreferencesProfileId] = useState('');
  const preferencesProfileId = session?.user?.id || 'offline';
  const audioRef = useRef(null);
  const profileMenuRef = useRef(null);
  const mediaSessionActionsRef = useRef({});
  const mediaSessionActionsStarted = useRef(false);
  const notificationPermissionRequested = useRef(false);
  const lastMediaPositionUpdateAt = useRef(0);
  const supabaseLoadStarted = useRef(false);
  const supabaseLoadRequestId = useRef(0);
  const playHistoryRef = useRef([]);
  const historyIndexRef = useRef(-1);
  const pendingSeekRef = useRef(null);
  const renewedAudioSrcRef = useRef('');
  const lastProgressSaveAt = useRef(0);
  const loadedAudioTrackRef = useRef('');
  const keyboardActionsRef = useRef({});
  function createObjectUrl(blob) {
    return URL.createObjectURL(blob);
  }
  const offlineTrackMap = useMemo(() => new Map(offlineTracks.map(track => [track.id, track])), [offlineTracks]);
  const catalogTracks = useMemo(() => {
    if (appSettings.offlineMode) return offlineTracks;
    const onlineIds = new Set(supabaseTracks.map(track => track.id));
    const online = supabaseTracks.map(track => {
      const offline = offlineTrackMap.get(track.id);
      if (!offline) return track;
      return {
        ...track,
        src: offline.src,
        isDownloaded: true,
      };
    });
    if (!session) return offlineTracks;
    return [...online, ...offlineTracks.filter(track => !onlineIds.has(track.id))];
  }, [appSettings.offlineMode, offlineTrackMap, offlineTracks, session, supabaseTracks]);
  const allSongs = catalogTracks;
  const libraryAccountReady = loadedPreferencesProfileId === preferencesProfileId;
  const userPlaylists = useMemo(() => libraryAccountReady ? getUserPlaylists(playlists, preferencesProfileId) : [], [playlists, preferencesProfileId, libraryAccountReady]);
  const libraryArtists = libraryAccountReady ? savedArtistNames : [];
  const libraryFavorites = libraryAccountReady ? favorites : [];
  const catalogBrowseTracks = useMemo(() => catalogCategory === 'all' ? allSongs
    : allSongs.filter(song => normalizeContentType(song.contentType) === catalogCategory), [allSongs, catalogCategory]);
  const searchIndex = useMemo(() => createSearchIndex(makeSearchEntries(allSongs, userPlaylists)), [allSongs, userPlaylists]);
  const current = allSongs.find(song => song.id === currentId)
    || null;
  const selectedPlaylist = userPlaylists.find(playlist => playlist.id === selectedPlaylistId) || null;
  const recommendations = useMemo(() => buildRecommendations(allSongs, {
    favorites, recentlyPlayedIds, savedArtists: savedArtistNames, profileId: preferencesProfileId,
    day: new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date()),
  }), [allSongs, favorites, recentlyPlayedIds, savedArtistNames, preferencesProfileId]);
  const unseenCatalogIds = allSongs.filter(song => (song.addedAt || 0) > listenerData.lastCatalogSeenAt).map(song => song.id);
  const isLongform = current && normalizeContentType(current.contentType) !== 'music';
  const downloadBaseUrl = Capacitor.isNativePlatform() || window.location.protocol === 'file:' ? 'https://backstage-music.vercel.app' : '';
  keyboardActionsRef.current = { hasTrack: Boolean(current), toggle: togglePlayback, seek: seekBy, move: moveTrack };
  useEffect(() => {
    const handleKeyboard = event => {
      if (event.target?.isContentEditable || event.target?.closest?.('input,textarea,select,button,a,[role="dialog"]')) return;
      const actions = keyboardActionsRef.current;
      if (!actions.hasTrack) return;
      if (event.code === 'Space') { event.preventDefault(); actions.toggle(); }
      else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        event.preventDefault();
        const direction = event.key === 'ArrowRight' ? 1 : -1;
        if (event.ctrlKey || event.metaKey) actions.move(direction);
        else actions.seek(direction * 5);
      }
    };
    const trackFullscreen = () => setFullscreen(Boolean(document.fullscreenElement));
    window.addEventListener('keydown', handleKeyboard);
    document.addEventListener('fullscreenchange', trackFullscreen);
    return () => {
      window.removeEventListener('keydown', handleKeyboard);
      document.removeEventListener('fullscreenchange', trackFullscreen);
    };
  }, []);

  useEffect(() => {
    if (!profileMenuOpen) return undefined;
    const menu = profileMenuRef.current;
    menu?.querySelector('[role="menuitem"]')?.focus();
    const closeOutside = event => {
      if (!menu?.contains(event.target)) setProfileMenuOpen(false);
    };
    const handleKeys = event => {
      if (event.key === 'Escape') {
        setProfileMenuOpen(false);
        menu?.querySelector('.profile-menu-trigger')?.focus();
      }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      const items = [...(menu?.querySelectorAll('[role="menuitem"]') || [])];
      if (!items.length) return;
      event.preventDefault();
      const index = items.indexOf(document.activeElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
        : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[next].focus();
    };
    window.addEventListener('pointerdown', closeOutside);
    window.addEventListener('keydown', handleKeys);
    return () => {
      window.removeEventListener('pointerdown', closeOutside);
      window.removeEventListener('keydown', handleKeys);
    };
  }, [profileMenuOpen]);

  useEffect(() => {
    if (!supabase) {
      setAuthError('O Supabase não está configurado. Confira as variáveis de ambiente da hospedagem.');
      setAuthLoading(false);
      return undefined;
    }

    let active = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setAuthError('');
      setAuthLoading(false);
    });
    supabase.auth.getSession().then(({ data, error }) => {
      if (error) throw error;
      if (active) {
        setSession(data.session);
        setAuthLoading(false);
      }
    }).catch(error => {
      console.error('Não foi possível verificar a sessão:', error);
      if (active) {
        setAuthError('Não foi possível verificar seu acesso. Confira sua conexão e tente novamente.');
        setAuthLoading(false);
      }
    });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);
  useEffect(() => {
    if (!session || !supabase || !socialReady) return undefined;
    let active = true;
    const publishListeningState = async () => {
      try {
        const { error } = await supabase.from('music_activity').upsert({
          user_id: session.user.id,
          track_title: current?.title || null,
          artist: current?.artist || null,
          album: current?.album || null,
          is_playing: Boolean(playing && current.src),
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' });
        if (error) throw error;
      } catch (error) {
        console.error('Não foi possível sincronizar a atividade de reprodução:', error);
        if (active && section === 'social') {
          setSocialError('Não foi possível atualizar sua atividade. Confira se as tabelas sociais do Supabase foram configuradas.');
        }
      }
    };
    void publishListeningState();
    const heartbeat = playing ? window.setInterval(() => void publishListeningState(), 45000) : null;
    return () => {
      active = false;
      if (heartbeat) window.clearInterval(heartbeat);
    };
  }, [current?.id, playing, section, session?.user?.id, socialReady]);
  useEffect(() => {
    if (!expandedPlayerOpen) return undefined;
    const closeOnEscape = event => {
      if (event.key === 'Escape') setExpandedPlayerOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [expandedPlayerOpen]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const savedOfflineTracks = await loadOfflineTracks();
        if (cancelled) return;
        const restoredOfflineTracks = savedOfflineTracks.filter(track => isCatalogTrackId(track.id)).map(track => ({
          ...track,
          src: createObjectUrl(track.blob),
          cover: track.coverBlob ? `url("${createObjectUrl(track.coverBlob)}") center/cover` : track.cover,
          isDownloaded: true,
        }));
        setOfflineTracks(restoredOfflineTracks);
      } catch (error) {
        console.error('Erro ao restaurar os downloads offline:', error);
        if (!cancelled) notify('Não foi possível restaurar os downloads offline.');
      } finally {
        if (!cancelled) setOfflineDownloadsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (authLoading) return;
    const userId = session?.user?.id;
    const profileId = userId || 'offline';
    const preferences = ['favorites', 'playlists', 'queue', 'recently-played', 'saved-artists'];
    const migrationKey = 'backstage-profile-preferences-migrated';
    if (userId && localStorage.getItem(migrationKey) !== 'true') {
      for (const preference of preferences) {
        const legacyKey = `backstage-${preference}`;
        const profileKey = getProfileStorageKey(profileId, preference);
        if (localStorage.getItem(profileKey) === null && localStorage.getItem(legacyKey) !== null) {
          localStorage.setItem(profileKey, localStorage.getItem(legacyKey));
        }
      }
      localStorage.setItem(migrationKey, 'true');
    }
    const readArray = (preference, fallback) => {
      const value = getStoredJSON(getProfileStorageKey(profileId, preference), userId ? fallback : getStoredJSON(`backstage-${preference}`, fallback));
      return Array.isArray(value) ? value : fallback;
    };
    setFavorites(readArray('favorites', []).filter(isCatalogTrackId));
    setPlaylists(normalizePlaylists(readArray('playlists', []), profileId));
    setQueuedSongIds(readArray('queue', []).filter(isCatalogTrackId));
    setRecentlyPlayedIds(readArray('recently-played', []).filter(isCatalogTrackId).slice(0, 30));
    setSavedArtistNames(readArray('saved-artists', []).filter(name => typeof name === 'string'));
    const listening = getStoredJSON(getProfileStorageKey(profileId, 'listening-data'), {});
    setListenerData({
      recentSearches: normalizeSearchHistory(listening?.recentSearches),
      pinnedCollections: Array.isArray(listening?.pinnedCollections) ? listening.pinnedCollections.filter(key => typeof key === 'string') : ['favorites'],
      savedEpisodeIds: Array.isArray(listening?.savedEpisodeIds) ? listening.savedEpisodeIds.filter(isCatalogTrackId) : [],
      playbackProgress: compactProgress(listening?.playbackProgress),
      lastCatalogSeenAt: Number(listening?.lastCatalogSeenAt) || 0,
    });
    setPlaybackContext(null);
    setSelectedMix(null);
    const savedProfileName = getStoredJSON(getProfileStorageKey(profileId, 'profile-name'), '');
    setProfileName(typeof savedProfileName === 'string' ? savedProfileName : '');
    setPasswordConfigured(getStoredJSON(getProfileStorageKey(profileId, 'password-configured'), false) === true);
    const savedAppSettings = getStoredJSON(getProfileStorageKey(profileId, 'app-settings'), {});
    setAppSettings({ ...defaultAppSettings, ...(savedAppSettings && typeof savedAppSettings === 'object' && !Array.isArray(savedAppSettings) ? savedAppSettings : {}) });
    setLoadedPreferencesProfileId(profileId);
    setLoadedAppSettingsProfileId(profileId);
  }, [authLoading, session?.user?.id]);
  useEffect(() => {
    if (loadedPreferencesProfileId !== preferencesProfileId) return;
    localStorage.setItem(getProfileStorageKey(preferencesProfileId, 'favorites'), JSON.stringify(favorites));
  }, [favorites, loadedPreferencesProfileId, preferencesProfileId]);
  useEffect(() => {
    if (loadedPreferencesProfileId !== preferencesProfileId) return;
    localStorage.setItem(getProfileStorageKey(preferencesProfileId, 'playlists'), JSON.stringify(playlists));
  }, [playlists, loadedPreferencesProfileId, preferencesProfileId]);
  useEffect(() => {
    if (loadedPreferencesProfileId !== preferencesProfileId) return;
    localStorage.setItem(getProfileStorageKey(preferencesProfileId, 'queue'), JSON.stringify(queuedSongIds));
  }, [loadedPreferencesProfileId, preferencesProfileId, queuedSongIds]);
  useEffect(() => {
    if (loadedPreferencesProfileId !== preferencesProfileId) return;
    localStorage.setItem(getProfileStorageKey(preferencesProfileId, 'recently-played'), JSON.stringify(recentlyPlayedIds));
  }, [loadedPreferencesProfileId, preferencesProfileId, recentlyPlayedIds]);
  useEffect(() => {
    if (loadedPreferencesProfileId !== preferencesProfileId) return;
    localStorage.setItem(getProfileStorageKey(preferencesProfileId, 'saved-artists'), JSON.stringify(savedArtistNames));
  }, [loadedPreferencesProfileId, preferencesProfileId, savedArtistNames]);
  useEffect(() => {
    if (loadedPreferencesProfileId !== preferencesProfileId) return;
    localStorage.setItem(getProfileStorageKey(preferencesProfileId, 'listening-data'), JSON.stringify(listenerData));
  }, [loadedPreferencesProfileId, preferencesProfileId, listenerData]);
  useEffect(() => {
    if (loadedAppSettingsProfileId !== preferencesProfileId) return;
    localStorage.setItem(getProfileStorageKey(preferencesProfileId, 'app-settings'), JSON.stringify(appSettings));
  }, [appSettings, loadedAppSettingsProfileId, preferencesProfileId]);
  useEffect(() => {
    if (loadedAppSettingsProfileId !== preferencesProfileId) return;
    const accent = accentColors[appSettings.accent] || accentColors.mint;
    document.documentElement.dataset.theme = appSettings.theme === 'light' ? 'light' : 'dark';
    document.documentElement.style.setProperty('--backstage-accent', accent.color);
    document.documentElement.style.setProperty('--backstage-accent-contrast', accent.contrast);
  }, [appSettings.accent, appSettings.theme, loadedAppSettingsProfileId, preferencesProfileId]);
  useEffect(() => {
    if (loadedAppSettingsProfileId !== preferencesProfileId) return;
    setShuffle(appSettings.shuffleDefault === true);
    setRepeatMode(['off', 'all', 'one'].includes(appSettings.repeatDefault) ? appSettings.repeatDefault : 'off');
  }, [loadedAppSettingsProfileId, preferencesProfileId]);
  useEffect(() => { localStorage.removeItem('backstage-streaming-tracks'); }, []);
  useEffect(() => {
    let cancelled = false;
    supabaseLoadRequestId.current += 1;
    supabaseLoadStarted.current = false;
    setSupabaseTracks([]);
    setCatalogFromCache(false);
    setSupabaseError('');
    setSupabaseLoading(false);
    if (!session?.user?.id || offlineDownloadsLoading || appSettings.offlineMode) return;
    const initialize = async () => {
      try {
        const snapshot = await readCatalogSnapshot(catalogCacheKey(supabaseUrl, session.user.id));
        if (cancelled) return;
        if (snapshot?.tracks?.length) {
          setSupabaseTracks(snapshot.tracks.map((track, index) => ({
            id: `supabase-${track.id}`, title: track.title, artist: track.artist || 'Artista não informado',
            album: track.album || 'Meu catálogo', contentType: normalizeContentType(track.content_type),
            objectPath: track.object_path, license: track.license, addedAt: Date.parse(track.created_at) || 0,
            durationSeconds: track.duration_seconds, durationLabel: Number.isFinite(track.duration_seconds) ? time(track.duration_seconds) : '',
            src: publicStorage && supabase ? supabase.storage.from(supabaseBucket).getPublicUrl(track.object_path).data.publicUrl : '',
            cover: publicStorage && track.cover_path && supabase ? `url("${supabase.storage.from(supabaseBucket).getPublicUrl(track.cover_path).data.publicUrl}") center/cover` : covers[index % covers.length],
          })));
          setCatalogFromCache(true);
        }
      } catch (error) { console.warn('Cache de metadados indisponível:', error); }
      if (!cancelled) {
        supabaseLoadStarted.current = true;
        void loadSupabaseTracks(offlineTracks);
      }
    };
    void initialize();
    return () => { cancelled = true; supabaseLoadRequestId.current += 1; };
  }, [session?.user?.id, appSettings.offlineMode, offlineDownloadsLoading]);
  useEffect(() => {
    if (Capacitor.getPlatform() !== 'android' || mediaSessionActionsStarted.current) return;
    mediaSessionActionsStarted.current = true;
    ['play', 'pause', 'seekbackward', 'seekforward', 'previoustrack', 'nexttrack', 'seekto', 'stop'].forEach(action => {
      MediaSession.setActionHandler({ action }, details => {
        mediaSessionActionsRef.current[details.action]?.(details);
      }).catch(error => {
        console.error(`Não foi possível registrar o controle de mídia "${action}":`, error);
        notify('Os controles de música na tela bloqueada não estão disponíveis.');
      });
    });
  }, []);
  useEffect(() => {
    if (Capacitor.getPlatform() !== 'android') return;
    let cancelled = false;
    (async () => {
      try {
        let artwork = [];
        const coverUrl = current?.cover?.match(/^url\(["']?(.*?)["']?\)/)?.[1];
        if (coverUrl) artwork = [{ src: coverUrl, sizes: '512x512' }];
        if (cancelled || !current) return;
        await MediaSession.setMetadata({
          title: current.title,
          artist: current.artist,
          album: current.album,
          artwork,
        });
      } catch (error) {
        if (!cancelled) console.error('Não foi possível atualizar as informações da música no Android:', error);
      }
    })();
    return () => { cancelled = true; };
  }, [current?.id, current?.title, current?.artist, current?.album, current?.cover]);
  useEffect(() => {
    if (Capacitor.getPlatform() !== 'android') return;
    MediaSession.setPlaybackState({ playbackState: current ? playing ? 'playing' : 'paused' : 'none' })
      .catch(error => console.error('Não foi possível atualizar o estado do player no Android:', error));
  }, [current?.id, playing]);
  useEffect(() => {
    if (Capacitor.getPlatform() !== 'android' || !duration || !current) return;
    const now = Date.now();
    if (now - lastMediaPositionUpdateAt.current < 1000) return;
    lastMediaPositionUpdateAt.current = now;
    MediaSession.setPositionState({ duration, position: Math.min(progress, duration), playbackRate: Number(appSettings.playbackRate) || 1 })
      .catch(error => console.error('Não foi possível atualizar a posição do player no Android:', error));
  }, [appSettings.playbackRate, current, duration, playing, progress]);
  useEffect(() => { if (audioRef.current) audioRef.current.volume = volume / 100; }, [volume]);
  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = [0.5, 0.75, 1, 1.25, 1.5, 2].includes(Number(appSettings.playbackRate))
      ? Number(appSettings.playbackRate)
      : 1;
  }, [appSettings.playbackRate]);
  useEffect(() => {
    if (!audioRef.current) return;
    if (playing && current?.src) audioRef.current.play().catch(() => setPlaying(false));
    else audioRef.current.pause();
  }, [playing, currentId, current?.src]);

  function notify(message) {
    setNotice(message);
    window.clearTimeout(notify.timer);
    notify.timer = window.setTimeout(() => setNotice(''), 3200);
  }
  function openCatalog() {
    setCatalogCategory('all');
    setProfileMenuOpen(false);
    setSection('explore');
    setQuery('');
  }
  function navigateTo(nextSection) {
    setProfileMenuOpen(false);
    setQuery('');
    setSection(nextSection);
  }
  function openArtist(name) {
    setSelectedArtist(name);
    setArtistShowAll(false);
    setDiscographyView('all');
    navigateTo('artist');
  }
  function openAlbum(album) {
    setSelectedAlbum(album.album);
    setSelectedAlbumArtist(album.artist || '');
    navigateTo('album');
  }
  function openPlaylist(playlist) {
    setSelectedPlaylistId(typeof playlist === 'string' ? playlist : playlist.id);
    navigateTo('playlist');
  }
  function toggleSavedArtist(name) {
    setSavedArtistNames(old => old.includes(name) ? old.filter(item => item !== name) : [...old, name]);
    if (savedArtistNames.includes(name)) setListenerData(old => ({ ...old, pinnedCollections: old.pinnedCollections.filter(key => key !== 'artist:' + name) }));
  }
  function openDownloads() {
    navigateTo('downloads');
  }
  function openCategory(category) {
    if (category === 'recent') { navigateTo('recent'); return; }
    if (category === 'playlists' || category === 'following') {
      setLibraryTab(category === 'following' ? 'artists' : 'playlists'); navigateTo('library'); return;
    }
    if (category === 'artists' || category === 'albums') { navigateTo('catalog-' + category); return; }
    setCatalogCategory(category === 'podcasts' ? 'podcast' : category === 'audiobooks' ? 'audiobook' : category === 'music' ? 'music' : 'all');
    navigateTo('explore');
  }
  function toggleCollectionPin(key) {
    setListenerData(old => ({ ...old, pinnedCollections: old.pinnedCollections.includes(key)
      ? old.pinnedCollections.filter(item => item !== key) : [...old.pinnedCollections, key] }));
  }
  function toggleEpisode(songOrId) {
    const id = typeof songOrId === 'string' ? songOrId : songOrId?.id;
    const track = allSongs.find(song => song.id === id);
    if (!track || normalizeContentType(track.contentType) !== 'podcast') return;
    setListenerData(old => ({ ...old, savedEpisodeIds: old.savedEpisodeIds.includes(id)
      ? old.savedEpisodeIds.filter(item => item !== id) : [...old.savedEpisodeIds, id] }));
  }
  function saveRecentSearch(entry) {
    setListenerData(old => ({ ...old, recentSearches: normalizeSearchHistory([entry, ...old.recentSearches]) }));
  }
  function submitSearch(text) {
    const value = text.trim();
    if (value) saveRecentSearch({ type: 'query', title: value });
    setProfileMenuOpen(false);
    setQuery(value);
    setSection('search');
  }
  function selectSearchEntry(entry) {
    saveRecentSearch(entry);
    if (entry.type === 'song') {
      const song = allSongs.find(track => track.id === entry.id);
      if (song) { selectSong(song); setQueuedSongIds([]); setPlaybackContext({ key: 'catalog', label: 'Seu catálogo', songIds: allSongs.filter(track => normalizeContentType(track.contentType) === normalizeContentType(song.contentType)).map(track => track.id) }); }
      else notify('Este item não está disponível no catálogo atual.');
    } else if (entry.type === 'artist') openArtist(entry.artist || entry.title);
    else if (entry.type === 'album') openAlbum({ album: entry.album || entry.title, artist: entry.artist });
    else if (entry.type === 'playlist') openPlaylist(entry.id);
    else submitSearch(entry.title);
  }
  function currentViewContext() {
    if (section === 'downloads') return { key: 'downloads', label: 'Downloads neste aparelho' };
    if (section === 'playlist' && selectedPlaylist) return { key: 'playlist:' + selectedPlaylist.id, label: selectedPlaylist.name };
    if (section === 'favorites') return { key: 'favorites', label: 'Músicas curtidas' };
    if (section === 'episodes') return { key: 'episodes', label: 'Seus episódios' };
    if (section === 'artist') return { key: 'artist:' + selectedArtist, label: selectedArtist };
    if (section === 'album') return { key: 'album:' + JSON.stringify([selectedAlbum, selectedAlbumArtist]), label: selectedAlbum };
    if (section === 'mix' && selectedMix) return { key: 'mix:' + selectedMix.id, label: selectedMix.title };
    return null;
  }
  function playSong(song) {
    let context = currentViewContext();
    let tracks = context ? baseSongs : allSongs;
    if (!context && normalizeContentType(song.contentType) !== 'music') {
      context = { key: 'album:' + JSON.stringify([song.album, song.artist]), label: song.album };
      tracks = allSongs.filter(track => track.album === song.album && track.artist === song.artist && normalizeContentType(track.contentType) === normalizeContentType(song.contentType));
    }
    selectSong(song);
    setQueuedSongIds([]);
    setPlaybackContext(context ? { ...context, songIds: tracks.map(track => track.id) } : { key: 'catalog', label: 'Seu catálogo', songIds: allSongs.filter(track => normalizeContentType(track.contentType) === normalizeContentType(song.contentType)).map(track => track.id) });
  }
  function openMix(mix) {
    setSelectedMix(mix);
    navigateTo('mix');
  }
  function saveMixAsPlaylist() {
    if (!selectedMix) return;
    const playlist = { id: makeId(), name: selectedMix.title, description: selectedMix.description,
      source: 'user', ownerId: preferencesProfileId,
      songIds: selectedMix.songs.map(song => song.id), cover: selectedMix.cover || covers[0], createdAt: Date.now() };
    setPlaylists(old => [...old, playlist]);
    openPlaylist(playlist);
    notify('Seleção salva nas suas playlists.');
  }
  async function handleCollectionAction(action, item) {
    const tracks = item.songs || [];
    if (action === 'play') { playCollection(tracks, false, { key: item.key, label: item.title }); return; }
    if (action === 'queue') {
      const ids = tracks.filter(song => song.src).map(song => song.id);
      setQueuedSongIds(old => [...new Set([...old, ...ids])]);
      notify(ids.length ? 'Coleção adicionada à fila.' : 'Não há faixas disponíveis nesta coleção.');
    } else if (action === 'rename') {
      const playlist = playlists.find(value => value.id === item.id);
      if (!playlist) return;
      const name = window.prompt('Novo nome da playlist:', playlist.name);
      if (name?.trim()) setPlaylists(old => old.map(value => value.id === item.id ? { ...value, name: name.trim() } : value));
    } else if (action === 'delete') {
      const playlist = playlists.find(value => value.id === item.id);
      if (playlist) removePlaylist(playlist);
    } else if (action === 'download') {
      if (bulkDownloading) { notify('Já existe um download de coleção em andamento.'); return; }
      const pending = tracks.filter(song => !offlineTrackMap.has(song.id));
      if (!pending.length) { notify(tracks.length ? 'Esta coleção já está disponível offline.' : 'A coleção está vazia.'); return; }
      setBulkDownloading(true);
      let downloaded = 0;
      try {
        for (const song of pending) {
          if (await downloadTrackOffline(song, { silent: true })) downloaded += 1;
        }
        notify(downloaded + ' de ' + pending.length + ' faixas baixadas para ouvir offline.');
      } finally { setBulkDownloading(false); }
    }
  }
  function rememberPlaybackPosition(track = current, position = audioRef.current?.currentTime, length = audioRef.current?.duration) {
    if (!track || normalizeContentType(track.contentType) === 'music' || !Number.isFinite(position) || !Number.isFinite(length) || length <= 0) return;
    setListenerData(old => {
      const next = { ...old.playbackProgress };
      if (position <= 0 || position >= length - 3) delete next[track.id];
      else next[track.id] = { position, duration: length };
      return { ...old, playbackProgress: next };
    });
  }
  function seekBy(seconds) {
    const audio = audioRef.current;
    if (!audio || !current) return;
    const position = Math.max(0, Math.min(audio.duration || Infinity, audio.currentTime + seconds));
    audio.currentTime = position;
    setProgress(position);
    rememberPlaybackPosition(current, position, audio.duration);
  }
  async function toggleFullscreen() {
    if (!current) return;
    if (Capacitor.isNativePlatform()) { setExpandedPlayerOpen(true); return; }
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
      else setExpandedPlayerOpen(true);
    } catch { setExpandedPlayerOpen(true); }
  }
  async function refreshStorageEstimate() {
    if (!navigator.storage?.estimate) {
      notify('Este navegador não informa o uso de armazenamento.');
      return;
    }
    setStorageLoading(true);
    try {
      const estimate = await navigator.storage.estimate();
      setStorageEstimate({ usage: estimate.usage || 0, quota: estimate.quota || 0 });
    } catch (error) {
      console.error('Não foi possível consultar o armazenamento do app:', error);
      notify('Não foi possível consultar o armazenamento deste aparelho.');
    } finally {
      setStorageLoading(false);
    }
  }
  async function clearOfflineDownloads() {
    if (!offlineTracks.length) return;
    if (!window.confirm(`Remover ${offlineTracks.length} download(s) offline deste aparelho? Isso não apagará as faixas originais do catálogo.`)) return;
    const removedIds = [];
    if (current?.isDownloaded) pendingSeekRef.current = audioRef.current?.currentTime || 0;
    try {
      for (const track of offlineTracks) {
        await deleteMusicRecord(OFFLINE_TRACK_STORE, track.id);
        removedIds.push(track.id);
        if (track.src?.startsWith('blob:')) URL.revokeObjectURL(track.src);
      }
      setOfflineTracks(old => old.filter(track => !removedIds.includes(track.id)));
      if (session && !appSettings.offlineMode) void loadSupabaseTracks([]);
      notify('Downloads offline removidos deste aparelho.');
    } catch (error) {
      console.error('Não foi possível limpar os downloads offline:', error);
      setOfflineTracks(old => old.filter(track => !removedIds.includes(track.id)));
      if (session && !appSettings.offlineMode) void loadSupabaseTracks(offlineTracks.filter(track => !removedIds.includes(track.id)));
      notify(removedIds.length
        ? `${removedIds.length} download(s) removido(s); não foi possível remover os restantes.`
        : 'Não foi possível remover os downloads offline.');
    }
  }
  function clearListeningHistory() {
    if (!recentlyPlayedIds.length) return;
    if (!window.confirm('Limpar o histórico de reproduções deste perfil neste aparelho?')) return;
    setRecentlyPlayedIds([]);
    notify('Histórico de reproduções apagado.');
  }
  function updateAppSetting(key, value) {
    setAppSettings(old => ({ ...old, [key]: value }));
    if (key === 'shuffleDefault') setShuffle(value);
    if (key === 'repeatDefault') setRepeatMode(value);
  }
  async function checkNotificationPermission() {
    if (Capacitor.getPlatform() !== 'android') {
      setNotificationPermission('unsupported');
      return;
    }
    try {
      const { display } = await LocalNotifications.checkPermissions();
      setNotificationPermission(display);
    } catch (error) {
      console.error('Não foi possível verificar a permissão de notificações:', error);
      setNotificationPermission('unknown');
      notify('Não foi possível verificar a permissão de notificações.');
    }
  }
  async function signIn(event) {
    event.preventDefault();
    if (!supabase || authSubmitting) return;
    setAuthSubmitting(true);
    setAuthError('');
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: authEmail.trim(),
        password: authPassword,
      });
      if (error) throw error;
      setAuthPassword('');
      setShowAuthScreen(false);
      setExplicitlySignedOut(false);
      localStorage.removeItem('backstage-explicitly-signed-out');
    } catch (error) {
      console.error('Não foi possível entrar:', error);
      setAuthError('Não foi possível entrar. Confira o e-mail e a senha e tente novamente.');
    } finally {
      setAuthSubmitting(false);
    }
  }
  async function updatePassword(event) {
    event.preventDefault();
    if (!supabase || passwordSubmitting) return;
    if (newPassword.length < 8) {
      setPasswordError('A senha deve ter pelo menos 8 caracteres.');
      return;
    }
    if (newPassword !== passwordConfirmation) {
      setPasswordError('As senhas não coincidem.');
      return;
    }
    setPasswordSubmitting(true);
    setPasswordError('');
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      setShowPasswordDialog(false);
      setProfileSettingsOpen(false);
      setPasswordConfigured(true);
      localStorage.setItem(getProfileStorageKey(preferencesProfileId, 'password-configured'), JSON.stringify(true));
      setNewPassword('');
      setPasswordConfirmation('');
      notify('Senha salva. Você poderá alterá-la nas configurações do perfil.');
    } catch (error) {
      console.error('Não foi possível definir a senha da conta:', error);
      setPasswordError('Não foi possível definir a senha. Abra o convite novamente e tente mais uma vez.');
    } finally {
      setPasswordSubmitting(false);
    }
  }
  async function signOut() {
    if (!supabase) return;
    const { error } = await supabase.auth.signOut();
    if (error) {
      console.error('Não foi possível encerrar a sessão:', error);
      notify('Não foi possível sair da conta. Tente novamente.');
      return;
    }
    setPlaying(false);
    setCurrentId('');
    setShowAuthScreen(true);
    setExplicitlySignedOut(true);
    localStorage.setItem('backstage-explicitly-signed-out', 'true');
    supabaseLoadStarted.current = false;
    setSupabaseTracks([]);
  }
  async function requestMediaNotificationPermission(forceRequest = false) {
    if (Capacitor.getPlatform() !== 'android' || (notificationPermissionRequested.current && !forceRequest)) return;
    notificationPermissionRequested.current = true;
    try {
      const { display } = await LocalNotifications.requestPermissions();
      setNotificationPermission(display);
      if (display !== 'granted') notify('Permita notificações nas configurações do Android para ver os controles na tela bloqueada.');
    } catch (error) {
      console.error('Não foi possível solicitar permissão para os controles de mídia:', error);
      notify('Não foi possível ativar os controles de mídia na tela bloqueada.');
    }
  }
  function togglePlayback() {
    if (!current?.src) { setPlaying(false); notify('Conecte-se para atualizar esta faixa ou escolha uma música baixada.'); return; }
    if (playing) rememberPlaybackPosition();
    if (!playing) void requestMediaNotificationPermission();
    setPlaying(value => !value);
  }
  function toggleFavorite(id) {
    setFavorites(old => old.includes(id) ? old.filter(item => item !== id) : [...old, id]);
  }
  function selectSong(song, { recordHistory = true } = {}) {
    if (!song) return;
    if (song.id !== currentId) rememberPlaybackPosition();
    void requestMediaNotificationPermission();
    if (recordHistory && song.id !== currentId) {
      const history = playHistoryRef.current.slice(0, historyIndexRef.current + 1);
      history.push(song.id);
      playHistoryRef.current = history;
      historyIndexRef.current = history.length - 1;
    }
    if (song.src) {
      setRecentlyPlayedIds(old => [song.id, ...old.filter(id => id !== song.id)].slice(0, 30));
    }
    setCurrentId(song.id);
    const resume = normalizeContentType(song.contentType) !== 'music' ? listenerData.playbackProgress[song.id]?.position || 0 : 0;
    pendingSeekRef.current = resume || null;
    setProgress(resume);
    if (song.id === currentId && audioRef.current) audioRef.current.currentTime = resume;
    if (!song.src) { setPlaying(false); notify('Conecte-se para atualizar esta faixa ou escolha uma música baixada.'); }
    else setPlaying(true);
  }
  function addToQueue(song) {
    if (!song?.src) return;
    if (queuedSongIds.includes(song.id)) {
      notify('Essa música já está na fila.');
      return;
    }
    setQueuedSongIds(old => [...old, song.id]);
    notify(`“${song.title}” adicionada à fila.`);
  }
  function removeFromQueue(songId) {
    setQueuedSongIds(old => old.filter(id => id !== songId));
  }
  function moveQueuedSong(songId, offset) {
    setQueuedSongIds(old => {
      const currentIndex = old.indexOf(songId);
      const nextIndex = currentIndex + offset;
      if (currentIndex < 0 || nextIndex < 0 || nextIndex >= old.length) return old;
      const reordered = [...old];
      [reordered[currentIndex], reordered[nextIndex]] = [reordered[nextIndex], reordered[currentIndex]];
      return reordered;
    });
  }
  async function downloadTrackOffline(track, { silent = false } = {}) {
    if (!track.src) { if (!silent) notify('Conecte-se para atualizar o catálogo antes de baixar esta faixa.'); return false; }
    if (offlineTrackMap.has(track.id)) return true;
    if (downloadingIds.includes(track.id)) return false;
    setDownloadingIds(old => [...old, track.id]);
    try {
      const response = await fetch(track.src);
      if (!response.ok) throw new Error(`O download falhou (HTTP ${response.status}).`);
      const blob = await response.blob();
      if (!blob.size) throw new Error('O arquivo de áudio recebido está vazio.');
      let coverBlob = null;
      const coverUrl = track.cover?.match(/^url\("([^"]+)"\)/)?.[1];
      if (coverUrl) {
        try {
          const image = await fetch(coverUrl);
          if (image.ok) coverBlob = await image.blob();
        } catch { /* O áudio pode ser salvo mesmo sem a capa. */ }
      }
      const savedTrack = {
        id: track.id,
        title: track.title,
        artist: track.artist,
        album: track.album,
        cover: track.cover?.startsWith('url(') ? covers[0] : track.cover,
        objectPath: track.objectPath,
        contentType: normalizeContentType(track.contentType),
        durationSeconds: track.durationSeconds,
        durationLabel: track.durationLabel,
        addedAt: track.addedAt,
        blob,
        coverBlob,
      };
      if (navigator.storage?.persist) void navigator.storage.persist().catch(() => {});
      await saveOfflineTrack(savedTrack);
      const offlineTrack = { ...savedTrack, src: createObjectUrl(blob), cover: coverBlob ? `url("${createObjectUrl(coverBlob)}") center/cover` : savedTrack.cover, isDownloaded: true };
      if (track.id === currentId) pendingSeekRef.current = audioRef.current?.currentTime || 0;
      setOfflineTracks(old => [...old.filter(item => item.id !== track.id), offlineTrack]);
      if (!silent) notify(`“${track.title}” foi baixada para ouvir offline.`);
      return true;
    } catch (error) {
      console.error(`Erro ao baixar "${track.title}" para ouvir offline:`, error);
      if (!silent) notify(error.message || 'Não foi possível baixar essa música para ouvir offline.');
      return false;
    } finally {
      setDownloadingIds(old => old.filter(id => id !== track.id));
    }
  }
  async function removeOfflineDownload(track) {
    if (!window.confirm(`Remover “${track.title}” dos downloads offline? A faixa original do Supabase não será apagada.`)) return;
    try {
      await deleteMusicRecord(OFFLINE_TRACK_STORE, track.id);
      if (currentId === track.id) pendingSeekRef.current = audioRef.current?.currentTime || 0;
      setOfflineTracks(old => old.filter(item => item.id !== track.id));
      if (session && !appSettings.offlineMode) void loadSupabaseTracks(offlineTracks.filter(item => item.id !== track.id));
      if (track.src?.startsWith('blob:')) URL.revokeObjectURL(track.src);
      notify(`“${track.title}” foi removida dos downloads offline.`);
    } catch (error) {
      console.error(`Erro ao remover o download de "${track.title}" para ouvir offline:`, error);
      notify('Não foi possível remover esse download offline.');
    }
  }
  function createPlaylist() {
    const name = window.prompt('Qual será o nome da playlist?');
    if (!name?.trim()) return;
    const playlist = {
      id: makeId(), name: name.trim(), description: 'Criada por você',
      source: 'user', ownerId: preferencesProfileId,
      songIds: trackToAdd ? [trackToAdd] : [], cover: covers[playlists.length % covers.length], createdAt: Date.now(),
    };
    setPlaylists(old => [...old, playlist]);
    setTrackToAdd(null);
    setSection('library');
    setLibraryTab('playlists');
    notify(`Playlist “${playlist.name}” criada!`);
  }
  function addToPlaylist(playlistId) {
    const playlist = playlists.find(item => item.id === playlistId);
    if (!playlist || !trackToAdd) return;
    setPlaylists(old => old.map(item => item.id === playlistId
      ? { ...item, songIds: item.songIds.includes(trackToAdd) ? item.songIds : [...item.songIds, trackToAdd] }
      : item));
    notify(`Música adicionada à playlist “${playlist.name}”.`);
    setTrackToAdd(null);
  }
  function removePlaylist(playlist) {
    if (!window.confirm(`Excluir a playlist “${playlist.name}”? As músicas não serão apagadas.`)) return;
    setPlaylists(old => old.filter(item => item.id !== playlist.id));
    setListenerData(old => ({ ...old, pinnedCollections: old.pinnedCollections.filter(key => key !== 'playlist:' + playlist.id) }));
    if (selectedPlaylistId === playlist.id) {
      setSelectedPlaylistId(null);
      setSection('library');
      setLibraryTab('playlists');
    }
    notify(`Playlist “${playlist.name}” excluída.`);
  }
  function removeTrackFromPlaylist(trackId) {
    if (!selectedPlaylist) return;
    setPlaylists(old => old.map(item => item.id === selectedPlaylist.id
      ? { ...item, songIds: item.songIds.filter(id => id !== trackId) }
      : item));
    notify('Música removida da playlist.');
  }
  async function loadSupabaseTracks(savedOfflineTracks = offlineTracks) {
    if (appSettings.offlineMode) {
      notify('Desative o modo offline nas configurações para carregar o catálogo online.');
      return;
    }
    if (!supabase) {
      setSupabaseError('Confira no .env.local se VITE_SUPABASE_URL contém a URL completa do projeto (https://<project-ref>.supabase.co) e VITE_SUPABASE_ANON_KEY contém a chave pública. Depois reinicie o app.');
      return;
    }
    const requestId = ++supabaseLoadRequestId.current;
    setSupabaseLoading(true);
    setSupabaseError('');
    let loadingStage = 'consulta da tabela tracks';
    try {
      const { data, error } = await loadPublishedTracks(supabase);
      if (error) throw error;

      loadingStage = 'criação de links temporários no Storage';
      const offlineMap = new Map(savedOfflineTracks.map(track => [track.id, track]));
      const tracks = await Promise.all((data || []).map(async (track, index) => {
        if (!track.object_path?.trim()) {
          throw new Error(`A faixa "${track.title}" não tem object_path configurado.`);
        }
        const id = `supabase-${track.id}`;
        const offline = offlineMap.get(id);
        let src = offline?.src;
        if (!src && publicStorage) {
          src = supabase.storage.from(supabaseBucket).getPublicUrl(track.object_path).data.publicUrl;
        } else if (!src) {
          const { data: signedFile, error: signedUrlError } = await supabase.storage
            .from(supabaseBucket)
            .createSignedUrl(track.object_path, 60 * 60);
          if (signedUrlError) throw signedUrlError;
          src = signedFile.signedUrl;
        }
        let cover = covers[index % covers.length];
        if (track.cover_path?.trim()) {
          if (publicStorage) {
            cover = `url("${supabase.storage.from(supabaseBucket).getPublicUrl(track.cover_path).data.publicUrl}") center/cover`;
          } else {
            const { data: coverFile, error: coverUrlError } = await supabase.storage
              .from(supabaseBucket)
              .createSignedUrl(track.cover_path, 60 * 60);
            if (coverUrlError) {
              console.warn('Capa indisponível; mantendo a arte padrão da faixa:', coverUrlError.message);
            } else if (coverFile?.signedUrl) {
              cover = `url("${coverFile.signedUrl}") center/cover`;
            }
          }
        }
        return {
          id,
          title: track.title,
          artist: track.artist || 'Artista não informado',
          album: track.album || 'Meu catálogo',
          contentType: normalizeContentType(track.content_type),
          src,
          cover,
          license: track.license || 'Licença não informada',
          objectPath: track.object_path,
          addedAt: track.created_at ? Date.parse(track.created_at) : 0,
          durationSeconds: Number.isFinite(track.duration_seconds) ? track.duration_seconds : null,
          durationLabel: Number.isFinite(track.duration_seconds) ? time(track.duration_seconds) : '',
          isDownloaded: Boolean(offline),
        };
      }));
      if (requestId !== supabaseLoadRequestId.current) return;
      setSupabaseTracks(previous => tracks.map(track => {
        const existing = previous.find(item => item.id === track.id);
        return track.id === currentId && playing && existing?.objectPath === track.objectPath && existing.src && !existing.src.startsWith('blob:')
          ? { ...track, src: existing.src } : track;
      }));
      setCatalogFromCache(false);
      // O armazenamento local é uma otimização; falhas de quota não impedem ouvir online.
      void saveCatalogSnapshot(catalogCacheKey(supabaseUrl, session.user.id), data || [])
        .catch(error => console.warn('Não foi possível salvar o índice do catálogo:', error));
    } catch (error) {
      console.error(`Erro durante ${loadingStage}:`, error);
      if (requestId === supabaseLoadRequestId.current) {
        supabaseLoadStarted.current = false;
        setSupabaseError(error instanceof TypeError
          ? `Falha de rede durante ${loadingStage}. Confira a conexão e a URL do Supabase. Se ocorreu ao criar links no Storage, confira também a política SELECT do bucket "${supabaseBucket}" para usuários autenticados.`
          : error.message || `Não foi possível concluir ${loadingStage}.`);
      }
    } finally {
      if (requestId === supabaseLoadRequestId.current) {
        setSupabaseLoading(false);
      }
    }
  }
  async function recoverExpiredTrackUrl() {
    const audio = audioRef.current;
    if (!audio) return;
    if (!current?.objectPath || current.isDownloaded || !current.id.startsWith('supabase-')) {
      setPlaying(false);
      notify('Não foi possível reproduzir este arquivo. Confira se ele ainda está disponível.');
      return;
    }
    if (renewedAudioSrcRef.current === current.src) {
      setPlaying(false);
      notify('Não foi possível reproduzir esta faixa. Atualize o catálogo e tente novamente.');
      return;
    }
    renewedAudioSrcRef.current = current.src;
    pendingSeekRef.current = audio.currentTime;
    try {
      let src;
      if (publicStorage) {
        src = supabase.storage.from(supabaseBucket).getPublicUrl(current.objectPath).data.publicUrl;
      } else {
        const { data, error } = await supabase.storage
          .from(supabaseBucket)
          .createSignedUrl(current.objectPath, 60 * 60);
        if (error) throw error;
        src = data.signedUrl;
      }
      setSupabaseTracks(old => old.map(track => track.id === current.id ? { ...track, src } : track));
      setPlaying(true);
    } catch (error) {
      console.error(`Não foi possível renovar o link de "${current.title}":`, error);
      setPlaying(false);
      notify('Não foi possível renovar o link da faixa. Confira sua conexão e o acesso ao Storage.');
    }
  }
  function getQueue() {
    if (playbackContext?.songIds?.length) return playbackContext.songIds.map(id => allSongs.find(song => song.id === id)).filter(Boolean);
    if (section === 'explore') return catalogTracks;
    if (section === 'search') return allSongs;
    if (section === 'playlist' && selectedPlaylist) return allSongs.filter(song => selectedPlaylist.songIds.includes(song.id));
    if (section === 'favorites') return allSongs.filter(song => favorites.includes(song.id));
    if (section === 'artist') return allSongs.filter(song => song.artist === selectedArtist);
    if (section === 'album') return allSongs.filter(song => song.album === selectedAlbum
      && (!selectedAlbumArtist || (song.artist || 'Artista desconhecido') === selectedAlbumArtist));
    return allSongs;
  }
  function moveTrack(step) {
    if (step > 0 && queuedSongIds.length) {
      const nextQueuedSong = allSongs.find(song => song.id === queuedSongIds[0]);
      setQueuedSongIds(old => old.slice(1));
      if (nextQueuedSong?.src) {
        selectSong(nextQueuedSong);
        return;
      }
    }
    const list = getQueue().filter(song => song.src);
    if (!list.length) { notify('Escolha uma música do catálogo para usar os controles do player.'); return; }
    const index = list.findIndex(song => song.id === currentId);
    if (step < 0 && audioRef.current?.currentTime > 3) {
      audioRef.current.currentTime = 0;
      setProgress(0);
      return;
    }
    if (shuffle) {
      const history = playHistoryRef.current;
      if (step < 0 && historyIndexRef.current > 0) {
        historyIndexRef.current -= 1;
        const previous = list.find(song => song.id === history[historyIndexRef.current]);
        if (previous) { selectSong(previous, { recordHistory: false }); return; }
      } else if (step > 0 && historyIndexRef.current < history.length - 1) {
        historyIndexRef.current += 1;
        const next = list.find(song => song.id === history[historyIndexRef.current]);
        if (next) { selectSong(next, { recordHistory: false }); return; }
      }
      if (step < 0) {
        if (index >= 0) { audioRef.current.currentTime = 0; setProgress(0); }
        return;
      }
      const choices = list.filter(song => song.id !== currentId);
      if (choices.length) selectSong(choices[Math.floor(Math.random() * choices.length)]);
      return;
    }
    selectSong(list[(index + step + list.length) % list.length]);
  }
  function handleTrackEnded() {
    if (current && normalizeContentType(current.contentType) !== 'music') {
      setListenerData(old => { const next = { ...old.playbackProgress }; delete next[current.id]; return { ...old, playbackProgress: next }; });
    }
    if (repeatMode === 'one' && audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(error => {
        console.error('Não foi possível repetir a faixa:', error);
        setPlaying(false);
      });
      return;
    }
    if (!appSettings.autoplay) {
      setPlaying(false);
      return;
    }
    const queue = getQueue().filter(song => song.src);
    const index = queue.findIndex(song => song.id === currentId);
    if (queuedSongIds.length || repeatMode === 'all' || (index >= 0 && index < queue.length - 1)) moveTrack(1);
    else setPlaying(false);
  }
  mediaSessionActionsRef.current = {
    play: () => setPlaying(true),
    pause: () => setPlaying(false),
    seekbackward: () => {
      if (!audioRef.current) return;
      audioRef.current.currentTime = Math.max(0, audioRef.current.currentTime - 10);
    },
    seekforward: () => {
      if (!audioRef.current) return;
      audioRef.current.currentTime = Math.min(duration || Infinity, audioRef.current.currentTime + 10);
    },
    previoustrack: () => moveTrack(-1),
    nexttrack: () => moveTrack(1),
    seekto: ({ seekTime }) => {
      if (typeof seekTime === 'number' && audioRef.current) audioRef.current.currentTime = seekTime;
    },
    stop: () => setPlaying(false),
  };
  function time(value) { return Number.isFinite(value) ? `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}` : '0:00'; }

  const recentlyPlayedSongs = useMemo(() => recentlyPlayedIds
    .map(id => allSongs.find(song => song.id === id))
    .filter(Boolean), [allSongs, recentlyPlayedIds]);
  const queuedSongs = useMemo(() => queuedSongIds
    .map(id => allSongs.find(song => song.id === id))
    .filter(Boolean), [allSongs, queuedSongIds]);
  const accountEmail = session?.user?.email || '';
  async function refreshSocialData() {
    if (!session || !supabase) {
      setSocialError('Entre na sua conta para acessar a atividade dos familiares.');
      return;
    }
    setSocialLoading(true);
    setSocialError('');
    try {
      const { data: existingProfile, error: profileLookupError } = await supabase
        .from('music_profiles')
        .select('display_name')
        .eq('user_id', session.user.id)
        .maybeSingle();
      if (profileLookupError) throw profileLookupError;
      const fallbackName = session.user.user_metadata?.name
        || accountEmail.split('@')[0]
        || `Membro ${session.user.id.slice(0, 6)}`;
      const displayName = (profileName.trim() || existingProfile?.display_name || fallbackName).slice(0, 40);
      const { error: saveProfileError } = await supabase.from('music_profiles').upsert({
        user_id: session.user.id,
        display_name: displayName,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });
      if (saveProfileError) throw saveProfileError;
      if (!profileName.trim() && existingProfile?.display_name) setProfileName(existingProfile.display_name);

      const [
        { data: profiles, error: profilesError },
        { data: follows, error: followsError },
        { count: followerCount, error: followerError },
      ] = await Promise.all([
        supabase.from('music_profiles').select('user_id, display_name').order('display_name', { ascending: true }),
        supabase.from('music_follows').select('followed_id').eq('follower_id', session.user.id),
        supabase.from('music_follows').select('follower_id', { count: 'exact', head: true }).eq('followed_id', session.user.id),
      ]);
      if (profilesError) throw profilesError;
      if (followsError) throw followsError;
      if (followerError) throw followerError;
      const followedIds = (follows || []).map(follow => follow.followed_id);
      const activityIds = [...new Set([session.user.id, ...followedIds])];
      let activities = [];
      if (activityIds.length) {
        const { data, error: activityError } = await supabase.from('music_activity')
          .select('user_id, track_title, artist, album, is_playing, updated_at')
          .in('user_id', activityIds);
        if (activityError) throw activityError;
        activities = data || [];
      }
      setSocialProfiles(profiles || []);
      setSocialFollowingIds(followedIds);
      setSocialFollowerCount(followerCount || 0);
      setSocialActivity(activities);
      setSocialReady(true);
    } catch (error) {
      console.error('Não foi possível carregar a atividade social:', error);
      setSocialReady(false);
      setSocialError('Não foi possível carregar a atividade social. Execute supabase/social.sql no SQL Editor do Supabase e tente novamente.');
    } finally {
      setSocialLoading(false);
    }
  }
  useEffect(() => {
    if (section === 'social') void refreshSocialData();
  }, [section, session?.user?.id]);
  useEffect(() => {
    if (section !== 'social' || !session) return undefined;
    const refreshTimer = window.setInterval(() => void refreshSocialData(), 30000);
    return () => window.clearInterval(refreshTimer);
  }, [section, session?.user?.id]);
  async function toggleFollow(profile) {
    if (!session || !supabase) return;
    const alreadyFollowing = socialFollowingIds.includes(profile.user_id);
    try {
      const request = alreadyFollowing
        ? supabase.from('music_follows').delete().eq('follower_id', session.user.id).eq('followed_id', profile.user_id)
        : supabase.from('music_follows').insert({ follower_id: session.user.id, followed_id: profile.user_id });
      const { error } = await request;
      if (error) throw error;
      setSocialFollowingIds(old => alreadyFollowing ? old.filter(id => id !== profile.user_id) : [...old, profile.user_id]);
      if (alreadyFollowing) setSocialActivity(old => old.filter(activity => activity.user_id !== profile.user_id));
      else void refreshSocialData();
    } catch (error) {
      console.error('Não foi possível atualizar quem você acompanha:', error);
      setSocialError('Não foi possível atualizar o acompanhamento. Verifique a configuração das tabelas sociais.');
    }
  }
  function openProfileSettings() {
    setAppSettingsOpen(false);
    setProfileNameDraft(profileName);
    setPasswordError('');
    setShowPasswordDialog(false);
    setProfileSettingsOpen(true);
  }
  async function saveProfileSettings(event) {
    event.preventDefault();
    const nextName = profileNameDraft.trim();
    setProfileName(nextName);
    localStorage.setItem(getProfileStorageKey(preferencesProfileId, 'profile-name'), JSON.stringify(nextName));
    setProfileSettingsOpen(false);
    if (session && supabase) {
      const fallbackName = session.user.email?.split('@')[0] || `Membro ${session.user.id.slice(0, 6)}`;
      const { error } = await supabase.from('music_profiles').upsert({
        user_id: session.user.id,
        display_name: nextName || fallbackName,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });
      if (error) {
        console.error('O nome do perfil foi salvo localmente, mas não sincronizado com o Supabase:', error);
        setSocialError('Nome salvo neste aparelho, mas não sincronizado com a atividade social. Confira a configuração social no Supabase.');
        notify('Nome salvo neste aparelho, mas não foi possível sincronizá-lo com os familiares.');
        return;
      }
    }
    notify(session ? 'Nome do perfil salvo e sincronizado.' : 'Configurações do perfil salvas neste aparelho.');
  }
  function openAppSettings() {
    setProfileSettingsOpen(false);
    setShowPasswordDialog(false);
    setAppSettingsOpen(true);
    void refreshStorageEstimate();
    void checkNotificationPermission();
  }
  function playCollection(tracks, startShuffle = false, context = currentViewContext()) {
    const available = tracks.filter(song => song.src);
    if (!available.length) {
      notify('Não há faixas disponíveis para reproduzir nesta coleção.');
      return;
    }
    const firstIndex = startShuffle ? Math.floor(Math.random() * available.length) : 0;
    const ordered = [available[firstIndex], ...available.filter((_, index) => index !== firstIndex)];
    setShuffle(startShuffle);
    setQueuedSongIds(ordered.slice(1).map(song => song.id));
    selectSong(ordered[0]);
    setPlaybackContext(context ? { ...context, songIds: available.map(song => song.id) } : null);
  }
  const baseSongs = useMemo(() => {
    if (section === 'search') return allSongs;
    if (query.trim()) return allSongs;
    if (section === 'recent') return recentlyPlayedSongs;
    if (section === 'downloads') return allSongs.filter(song => song.isDownloaded);
    if (section === 'episodes') return allSongs.filter(song => listenerData.savedEpisodeIds.includes(song.id));
    if (section === 'mix') return (selectedMix?.songs || []).map(song => allSongs.find(value => value.id === song.id)).filter(Boolean);
    if (section === 'favorites') return allSongs.filter(song => favorites.includes(song.id));
    if (section === 'playlist') return allSongs.filter(song => selectedPlaylist?.songIds.includes(song.id));
    if (section === 'artist') return allSongs.filter(song => song.artist === selectedArtist);
    if (section === 'album') return allSongs.filter(song => song.album === selectedAlbum
      && (!selectedAlbumArtist || (song.artist || 'Artista desconhecido') === selectedAlbumArtist));
    return allSongs;
  }, [allSongs, favorites, section, selectedPlaylist, selectedArtist, selectedAlbum, selectedAlbumArtist, query, recentlyPlayedSongs, listenerData.savedEpisodeIds, selectedMix]);
  const visibleSongs = useMemo(() => {
    if (!query.trim()) return baseSongs;
    const ids = new Set(getSearchSuggestions(query, searchIndex, Infinity).filter(entry => entry.type === 'song').map(entry => entry.id));
    return baseSongs.filter(song => ids.has(song.id));
  }, [baseSongs, query, searchIndex]);
  const artists = useMemo(() => [...new Set(allSongs.map(song => song.artist || 'Artista desconhecido'))].sort((a, b) => a.localeCompare(b)), [allSongs]);
  const albums = useMemo(() => {
    const seen = new Map();
    allSongs.forEach(song => {
      const key = `${song.album || 'Sem álbum'}::${song.artist || 'Artista desconhecido'}`;
      if (!seen.has(key)) seen.set(key, { key, album: song.album || 'Sem álbum', artist: song.artist || 'Artista desconhecido', cover: song.cover, songs: [] });
      seen.get(key).songs.push(song);
    });
    return [...seen.values()].sort((a, b) => a.album.localeCompare(b.album));
  }, [allSongs]);
  const selectedAlbumInfo = albums.find(item => item.album === selectedAlbum
    && (!selectedAlbumArtist || item.artist === selectedAlbumArtist));
  const artistAlbums = albums.filter(item => item.artist === selectedArtist);
  const artistTracks = allSongs.filter(song => song.artist === selectedArtist);
  const artistHero = artistTracks.find(song => song.cover?.startsWith('url(')) || artistTracks[0];
  const discographyAlbums = artistAlbums.filter(album => discographyView === 'all'
    || (discographyView === 'albums' ? album.songs.length > 1 : album.songs.length === 1));
  const renderedSongs = section === 'artist' && !artistShowAll ? visibleSongs.slice(0, 5) : visibleSongs.slice(0, trackPageSize);
  const sortedSidebarPlaylists = [...userPlaylists].sort((a, b) => {
    const pinA = listenerData.pinnedCollections.includes('playlist:' + a.id);
    const pinB = listenerData.pinnedCollections.includes('playlist:' + b.id);
    if (pinA !== pinB) return pinA ? -1 : 1;
    if (appSettings.librarySort === 'name') return a.name.localeCompare(b.name, 'pt-BR');
    const index = playlist => Math.min(Infinity, ...playlist.songIds.map(id => { const value = recentlyPlayedIds.indexOf(id); return value < 0 ? Infinity : value; }));
    return (appSettings.librarySort === 'recent' ? index(a) - index(b) : 0) || (b.createdAt || 0) - (a.createdAt || 0);
  });
  const libraryHeader = section === 'downloads' ? 'Downloads neste aparelho' : section === 'search' ? query.trim() ? 'Resultados do catálogo' : 'Buscar no catálogo' : section === 'favorites' ? 'Músicas curtidas' : section === 'playlist' ? selectedPlaylist?.name || 'Playlist' : section === 'artist' ? 'Músicas' : section === 'album' ? selectedAlbum : section === 'recent' ? 'Reproduções recentes' : section === 'episodes' ? 'Seus episódios' : section === 'mix' ? selectedMix?.title || 'Feito para você' : 'Sua biblioteca';
  const displayName = profileName || accountEmail.split('@')[0] || 'Seu perfil';
  const mobileTitle = section === 'downloads' ? 'Downloads' : section === 'catalog-artists' ? 'Explorar artistas' : section === 'catalog-albums' ? 'Explorar álbuns' : section === 'library' ? 'Sua biblioteca' : section === 'explore' ? 'Meu catálogo'
    : section === 'social' ? 'Amigos' : section === 'profile' ? 'Seu perfil' : section === 'recent' ? 'Recentes' : 'backstage';
  const collectionFeatures = {
    ownerId: preferencesProfileId,
    savedArtists: libraryArtists, pinnedCollections: listenerData.pinnedCollections,
    savedEpisodeIds: listenerData.savedEpisodeIds, currentId, playing,
    playbackContextKey: playbackContext?.key || '', recommendations,
    playbackProgress: listenerData.playbackProgress,
    onPlayCollection: (songs, context) => playCollection(songs, false, context),
    onOpenMix: openMix, onOpenEpisodes: () => navigateTo('episodes'), onOpenCategory: openCategory,
    onCreatePlaylist: createPlaylist, onOpenDownloads: openDownloads,
    onTogglePin: toggleCollectionPin, onToggleEpisode: toggleEpisode,
    onToggleArtist: toggleSavedArtist,
    onCollectionAction: handleCollectionAction,
    sortMode: appSettings.librarySort, onSortChange: value => updateAppSetting('librarySort', value),
    viewMode: appSettings.libraryViewMode, onViewModeChange: value => updateAppSetting('libraryViewMode', value),
  };

  const hasOfflineLibrary = offlineTracks.length > 0;
  if ((authLoading || (offlineDownloadsLoading && !hasOfflineLibrary)) && !hasOfflineLibrary) {
    return <main className="auth-shell"><div className="auth-card"><div className="brand-mark"><AudioLines size={25} /></div><p>Verificando seu acesso...</p></div></main>;
  }
  if (!session && (showAuthScreen || explicitlySignedOut || (!hasOfflineLibrary && !offlineDownloadsLoading))) {
    return <main className="auth-shell"><form className="auth-card" onSubmit={signIn}>
      <div className="brand-mark"><AudioLines size={25} /></div>
      <p className="eyebrow muted">BACKSTAGE MUSIC</p>
      <h1>Acesso privado</h1>
      <p className="auth-description">Entre com a conta autorizada para acessar seu catálogo.</p>
      <p className="auth-description">Ainda não tem acesso? Peça ao administrador para enviar um convite ao seu e-mail.</p>
      <label>E-mail<input autoComplete="username" type="email" value={authEmail} onChange={event => setAuthEmail(event.target.value)} required /></label>
      <label>Senha<input autoComplete="current-password" type="password" value={authPassword} onChange={event => setAuthPassword(event.target.value)} required /></label>
      {authError && <p className="auth-error" role="alert">{authError}</p>}
      <button className="primary-button" type="submit" disabled={authSubmitting || !supabase}>{authSubmitting ? 'Entrando...' : 'Entrar'}</button>
    </form></main>;
  }

  return <div className={`app-shell${current && nowPanelOpen ? ' has-now-playing' : ''}${libraryExpanded ? ' library-focus-mode' : ''}`} data-section={section}>
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><AudioLines size={25} /></div><span>backstage<span className="brand-light"> music</span></span></div>
      <div className="library-heading"><button onClick={() => { setLibraryTab('playlists'); navigateTo('library'); }}><Library size={21} /> Sua biblioteca</button><button title="Criar playlist" onClick={createPlaylist}><Plus size={20} /></button><button className="library-expand-button" aria-label="Expandir biblioteca" aria-pressed={libraryExpanded} onClick={() => { setLibraryExpanded(true); navigateTo('library'); }}><Maximize2 size={17} /></button></div>
      <div className="sidebar-library-filter"><button onClick={() => { setLibraryTab('playlists'); navigateTo('library'); }}>Playlists</button><button onClick={() => { setLibraryTab('artists'); navigateTo('library'); }}>Artistas</button><button aria-label="Buscar na biblioteca pela barra lateral" onClick={() => { setLibrarySearchOpen(true); navigateTo('library'); }}><Search size={16} /></button></div>
      <div className="sidebar-sort-row"><span>Suas coleções</span><select aria-label="Ordenar playlists na barra lateral" value={appSettings.librarySort} onChange={event => updateAppSetting('librarySort', event.target.value)}><option value="recent">Recentes</option><option value="name">Nome</option><option value="created">Criadas recentemente</option></select></div>
      <div className="sidebar-collection-row"><button className={'collection' + (section === 'favorites' ? ' active' : '')} onClick={() => navigateTo('favorites')}><CollectionCover className="collection-cover" kind="favorites" /><span><b>Músicas curtidas</b><small><Pin size={11} /> Playlist · {allSongs.filter(song => libraryFavorites.includes(song.id)).length} músicas</small></span></button></div>
      {sortedSidebarPlaylists.map(playlist => <div className="sidebar-collection-row" key={playlist.id}><button className={'collection' + (section === 'playlist' && selectedPlaylistId === playlist.id ? ' active' : '') + (playing && playbackContext?.key === 'playlist:' + playlist.id ? ' sidebar-current' : '')} onClick={() => openPlaylist(playlist)}><CollectionCover className="collection-cover" songs={allSongs.filter(song => playlist.songIds.includes(song.id))} cover={playlist.cover} /><span><b>{playlist.name}</b><small>{listenerData.pinnedCollections.includes('playlist:' + playlist.id) && <Pin size={11} />} Playlist · {allSongs.filter(song => playlist.songIds.includes(song.id)).length} músicas</small></span>{playing && playbackContext?.key === 'playlist:' + playlist.id && <AudioLines size={17} className="sidebar-playing" />}</button><button className={'sidebar-collection-pin' + (listenerData.pinnedCollections.includes('playlist:' + playlist.id) ? ' pinned' : '')} aria-label={(listenerData.pinnedCollections.includes('playlist:' + playlist.id) ? 'Desafixar ' : 'Fixar ') + playlist.name} onClick={() => toggleCollectionPin('playlist:' + playlist.id)}><Pin size={14} /></button></div>)}
      {libraryArtists.map(name => <button className="collection" key={name} onClick={() => openArtist(name)}><CollectionCover className="collection-cover" kind="artist" songs={allSongs.filter(song => song.artist === name)} /><span><b>{name}</b><small>Artista seguido</small></span></button>)}
      <nav className="sidebar-shortcuts" aria-label="Explorar"><button onClick={openCatalog}><Radio size={18} /> Meu catálogo</button><button onClick={() => navigateTo('social')}><Users size={18} /> Amigos</button></nav>
      <div className="sidebar-bottom"><div className="status-dot" /> Sua música, do seu jeito.</div>
    </aside>

    <nav className="mobile-nav" aria-label="Navegação principal">
      <button className={section === 'home' ? 'mobile-nav-item active' : 'mobile-nav-item'} onClick={() => { setSection('home'); setQuery(''); }}><Home size={19} /><span>Início</span></button>
      <button className={section === 'search' ? 'mobile-nav-item active' : 'mobile-nav-item'} onClick={() => { setSection('search'); setQuery(''); document.querySelector('#search')?.focus(); }}><Search size={19} /><span>Buscar</span></button>
      <button className={section === 'library' ? 'mobile-nav-item active' : 'mobile-nav-item'} onClick={() => { setSection('library'); setLibraryTab('playlists'); setQuery(''); }}><Library size={19} /><span>Biblioteca</span></button>
      <button className="mobile-nav-item" onClick={createPlaylist}><Plus size={24} /><span>Criar</span></button>
    </nav>

    <main className="main-content">
      <header className="topbar">
        <button className="desktop-home-button" aria-label="Início" onClick={() => navigateTo('home')}><Home size={23} /></button>
        <span className="mobile-page-title">{mobileTitle}</span>
        <CatalogSearch query={query} searchIndex={searchIndex} onQueryChange={value => { setQuery(value); setSection('search'); }}
          onSearchPage={() => setSection('search')} onSelect={selectSearchEntry} onSubmitQuery={submitSearch}
          recentSearches={listenerData.recentSearches} songs={allSongs} playlists={userPlaylists}
          onRemoveRecent={key => setListenerData(old => ({ ...old, recentSearches: old.recentSearches.filter(entry => entry.key !== key) }))}
          onClearRecent={() => setListenerData(old => ({ ...old, recentSearches: [] }))} />
        {libraryExpanded && <button className="library-focus-exit" onClick={() => setLibraryExpanded(false)}>Restaurar layout</button>}
        {!Capacitor.isNativePlatform() && !navigator.userAgent.includes('Electron/') && <button className="topbar-install" onClick={() => setInstallOpen(true)}><Download size={17} /><span>Instalar aplicativo</span></button>}
        <button className="topbar-updates" aria-label="Novidades no catálogo" title="Novidades no catálogo" onClick={() => setNotificationsOpen(true)}><Bell size={20} />{unseenCatalogIds.length > 0 && <span>{unseenCatalogIds.length > 99 ? '99+' : unseenCatalogIds.length}</span>}</button>
        <button className="desktop-friends-button" aria-label="Amigos" title="Amigos" onClick={() => navigateTo('social')}><Users size={20} /></button>
        <div className="profile-menu-wrap" ref={profileMenuRef}>
          <button className="profile-menu-trigger avatar" aria-label={`Abrir menu de ${displayName}`} aria-haspopup="menu" aria-expanded={profileMenuOpen} aria-controls="profile-dropdown" onClick={() => setProfileMenuOpen(open => !open)}>{displayName[0]?.toLocaleUpperCase() || 'B'}</button>
          {profileMenuOpen && <div className="profile-dropdown" id="profile-dropdown" role="menu" aria-label="Menu do perfil">
            <div className="profile-menu-identity"><strong>{displayName}</strong><small>{accountEmail || 'Downloads offline'}</small></div>
            {session && <button role="menuitem" onClick={() => { setProfileMenuOpen(false); openProfileSettings(); }}><Settings2 size={17} /> Conta</button>}
            <button role="menuitem" onClick={() => navigateTo('profile')}><UsersRound size={17} /> Perfil</button>
            <button role="menuitem" onClick={() => navigateTo('recent')}><Clock3 size={17} /> Recentes</button>
            <button role="menuitem" onClick={() => { navigateTo('episodes'); }}><Bookmark size={17} /> Seus episódios</button>
            <button role="menuitem" onClick={() => { setProfileMenuOpen(false); setNotificationsOpen(true); }}><Bell size={17} /> Novidades</button>
            <button role="menuitem" onClick={() => { setProfileMenuOpen(false); setInstallOpen(true); }}><Download size={17} /> Instalar aplicativo</button>
            <button role="menuitem" onClick={() => { setProfileMenuOpen(false); setShortcutsOpen(true); }}><Keyboard size={17} /> Atalhos do teclado</button>
            <button role="menuitem" onClick={openCatalog}><Radio size={17} /> Meu catálogo</button>
            <button role="menuitem" onClick={openDownloads}><Download size={17} /> Downloads</button>
            <button role="menuitem" onClick={() => navigateTo('social')}><Users size={17} /> Amigos</button>
            <button role="menuitem" onClick={() => { setProfileMenuOpen(false); openAppSettings(); }}><Settings2 size={17} /> Configurações</button>
            {session ? <button role="menuitem" onClick={() => { setProfileMenuOpen(false); void signOut(); }}><LogOut size={17} /> Sair</button> : <button role="menuitem" onClick={() => { setProfileMenuOpen(false); setShowAuthScreen(true); }}><LogOut size={17} /> Conectar conta</button>}
          </div>}
        </div>
        {section === 'library' ? <>
          <button className="mobile-search-trigger" aria-label={librarySearchOpen ? 'Fechar busca na biblioteca' : 'Buscar na biblioteca'} aria-expanded={librarySearchOpen} onClick={() => setLibrarySearchOpen(open => !open)}><Search size={25} /></button>
          <button className="mobile-library-create" aria-label="Criar playlist" onClick={createPlaylist}><Plus size={28} /></button>
        </> : <button className="mobile-search-trigger" aria-label="Buscar músicas" onClick={() => { navigateTo('search'); window.setTimeout(() => document.querySelector('#search')?.focus(), 0); }}><Search size={25} /></button>}
      </header>
      {profileSettingsOpen && <div className="account-password-backdrop" onMouseDown={event => {
        if (event.target === event.currentTarget) {
          setProfileSettingsOpen(false);
          setShowPasswordDialog(false);
        }
      }}>
        <div className="account-password-dialog" role="dialog" aria-modal="true" aria-labelledby="password-dialog-title">
          {!showPasswordDialog ? <form onSubmit={saveProfileSettings}>
            <h2 id="password-dialog-title">Configurações do perfil</h2>
            <p>O nome deste perfil fica neste aparelho e, quando a área Amigos estiver configurada, também aparece para os demais familiares. Ele não altera sua conta de acesso.</p>
            <label>Nome do perfil<input autoComplete="nickname" type="text" maxLength={40} value={profileNameDraft} onChange={event => setProfileNameDraft(event.target.value)} placeholder="Como quer aparecer no app?" /></label>
            <label>E-mail da conta<input type="email" value={accountEmail} readOnly /></label>
            <div className="account-password-actions">
              <button type="button" className="text-button" onClick={() => setProfileSettingsOpen(false)}>Cancelar</button>
              <button className="primary-button" type="submit">Salvar perfil</button>
            </div>
          </form> : <form onSubmit={updatePassword}>
            <h2 id="password-dialog-title">{passwordConfigured ? 'Alterar senha' : 'Definir senha'}</h2>
            <p>{passwordConfigured ? 'Escolha uma nova senha para sua conta.' : 'Defina uma senha pessoal para sua conta convidada.'}</p>
          <label>Nova senha<input autoComplete="new-password" type="password" value={newPassword} onChange={event => setNewPassword(event.target.value)} minLength={8} required /></label>
          <label>Confirme a nova senha<input autoComplete="new-password" type="password" value={passwordConfirmation} onChange={event => setPasswordConfirmation(event.target.value)} minLength={8} required /></label>
          {passwordError && <p className="auth-error" role="alert">{passwordError}</p>}
          <div className="account-password-actions">
            <button type="button" className="text-button" onClick={() => { setShowPasswordDialog(false); setPasswordError(''); setNewPassword(''); setPasswordConfirmation(''); }}>Voltar</button>
            <button className="primary-button" type="submit" disabled={passwordSubmitting || !supabase}>{passwordSubmitting ? 'Salvando...' : 'Salvar senha'}</button>
          </div>
          </form>}
          {!showPasswordDialog && <div className="profile-password-setting">
            <div><b>Senha da conta</b><span>{passwordConfigured ? 'Senha definida' : 'Ainda não definida neste aparelho'}</span></div>
            <button type="button" className="outline-button" onClick={() => { setPasswordError(''); setShowPasswordDialog(true); }}>{passwordConfigured ? 'Alterar senha' : 'Definir senha'}</button>
          </div>}
        </div>
      </div>}
      {appSettingsOpen && <div className="account-password-backdrop settings-backdrop" onMouseDown={event => {
        if (event.target === event.currentTarget) setAppSettingsOpen(false);
      }}>
        <section className="account-password-dialog app-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="app-settings-title">
          <div className="settings-title-row">
            <div><p className="eyebrow muted">BACKSTAGE MUSIC</p><h2 id="app-settings-title">Configurações do app</h2></div>
            <button type="button" className="heart-button" aria-label="Fechar configurações" onClick={() => setAppSettingsOpen(false)}><X size={20} /></button>
          </div>
          <div className="app-settings-content">
            <section className="settings-section">
              <h3>Aparência</h3>
              <label>Tema<select value={appSettings.theme} onChange={event => updateAppSetting('theme', event.target.value)}><option value="dark">Escuro</option><option value="light">Claro</option></select></label>
              <label>Cor de destaque<select value={appSettings.accent} onChange={event => updateAppSetting('accent', event.target.value)}><option value="mint">Menta</option><option value="blue">Azul</option><option value="rose">Rosa</option><option value="amber">Âmbar</option></select></label>
            </section>
            <section className="settings-section">
              <h3>Reprodução</h3>
              <label className="settings-toggle"><span><b>Reproduzir próxima faixa automaticamente</b><small>Continua a sequência ou a fila quando a música termina.</small></span><input type="checkbox" checked={appSettings.autoplay} onChange={event => updateAppSetting('autoplay', event.target.checked)} /></label>
              <label className="settings-toggle"><span><b>Modo aleatório inicial</b><small>Usar aleatório ao abrir o perfil neste aparelho.</small></span><input type="checkbox" checked={appSettings.shuffleDefault} onChange={event => updateAppSetting('shuffleDefault', event.target.checked)} /></label>
              <label>Repetição inicial<select value={appSettings.repeatDefault} onChange={event => updateAppSetting('repeatDefault', event.target.value)}><option value="off">Desativada</option><option value="all">Fila inteira</option><option value="one">Faixa atual</option></select></label>
            </section>
            <section className="settings-section">
              <h3>Áudio e dados</h3>
              <label>Velocidade de reprodução<select value={appSettings.playbackRate || 1} onChange={event => updateAppSetting('playbackRate', Number(event.target.value))}><option value="0.5">0,5×</option><option value="0.75">0,75×</option><option value="1">Normal (1×)</option><option value="1.25">1,25×</option><option value="1.5">1,5×</option><option value="2">2×</option></select></label>
              <label className="settings-toggle"><span><b>Modo offline</b><small>Oculta faixas online e limita a reprodução às músicas do catálogo baixadas neste aparelho.</small></span><input type="checkbox" checked={appSettings.offlineMode === true} onChange={event => updateAppSetting('offlineMode', event.target.checked)} /></label>
              <label className="settings-toggle"><span><b>Economia de dados</b><small>Evita pré-carregar o próximo áudio antes de você reproduzir. A qualidade disponível continua dependendo do arquivo de origem.</small></span><input type="checkbox" checked={appSettings.dataSaver} onChange={event => updateAppSetting('dataSaver', event.target.checked)} /></label>
              <p className="settings-note">O app não converte nem oferece versões alternativas de qualidade: a qualidade depende do arquivo publicado no catálogo. O equalizador e opções de qualidade de streaming ainda não estão disponíveis.</p>
            </section>
            <section className="settings-section">
              <div className="settings-section-heading"><h3>Armazenamento</h3><button className="text-button" onClick={() => void refreshStorageEstimate()} disabled={storageLoading}>{storageLoading ? 'Verificando…' : 'Atualizar'}</button></div>
              <div className="settings-stats"><span>Uso estimado do site neste navegador</span><b>{storageEstimate ? `${formatBytes(storageEstimate.usage)} de ${formatBytes(storageEstimate.quota)}` : 'Não consultado'}</b><span>Downloads offline</span><b>{formatBytes(offlineTracks.reduce((total, track) => total + (track.blob?.size || 0), 0))} · {offlineTracks.length} faixa(s)</b></div>
              <button className="outline-button settings-action" onClick={() => void clearOfflineDownloads()} disabled={!offlineTracks.length}>Remover todos os downloads offline</button>
              <p className="settings-note">A consulta do navegador pode incluir outros dados do site. Remover downloads libera espaço neste aparelho e mantém as músicas no catálogo.</p>
            </section>
            <section className="settings-section">
              <h3>Privacidade</h3>
              <p className="settings-note">O histórico de reprodução é salvo apenas neste perfil e aparelho. Limpar o histórico não remove músicas, favoritos nem playlists.</p>
              <button className="outline-button settings-action" onClick={clearListeningHistory} disabled={!recentlyPlayedIds.length}>Limpar histórico de reproduções</button>
            </section>
            <section className="settings-section">
              <h3>Notificações e controles de mídia</h3>
              {Capacitor.getPlatform() === 'android'
                ? <><p className="settings-note">Os controles de reprodução usam a sessão de mídia do Android. Permita notificações nas configurações do sistema para exibi-los na área de notificações e na tela bloqueada.</p><div className="settings-notification-row"><span>Permissão: {notificationPermission === 'granted' ? 'permitida' : notificationPermission === 'denied' ? 'negada' : notificationPermission === 'unsupported' ? 'não disponível' : 'não verificada'}</span><button className="outline-button" onClick={() => void requestMediaNotificationPermission(true)}>Verificar / permitir</button></div></>
                : <p className="settings-note">Os controles da área de notificações estão disponíveis na versão Android do app.</p>}
            </section>
          </div>
          <div className="account-password-actions"><button className="primary-button" onClick={() => setAppSettingsOpen(false)}>Concluir</button></div>
        </section>
      </div>}
      {(appSettings.offlineMode || (!session && !explicitlySignedOut)) && <p className="catalog-offline-notice">{appSettings.offlineMode ? 'Modo offline ativado: somente músicas do catálogo baixadas neste aparelho.' : 'Modo offline: reproduzindo apenas músicas do catálogo baixadas neste aparelho.'}</p>}
      {catalogFromCache && !appSettings.offlineMode && <p className="catalog-offline-notice" role="status">Exibindo o índice salvo neste aparelho. {supabaseLoading ? 'Atualizando o catálogo…' : 'Conecte-se para atualizar e ouvir faixas ainda não baixadas.'}</p>}
      {session && !appSettings.offlineMode && ['home', 'library', 'profile'].includes(section) && (supabaseLoading || supabaseError) && <div className="catalog-load-status" role={supabaseError && !supabaseLoading ? 'alert' : 'status'}>
        <Radio size={21} aria-hidden="true" />
        <div><b>{supabaseLoading ? 'Carregando suas músicas…' : 'Não foi possível atualizar o catálogo'}</b>{!supabaseLoading && <p>{supabaseError}</p>}</div>
        {!supabaseLoading && <button className="outline-button" onClick={() => loadSupabaseTracks()}>Tentar novamente</button>}
      </div>}


      {section === 'explore' && <section className="section-block explore-section">
        <div className="explore-heading">
          <div><p className="eyebrow muted">SUA MÚSICA</p><h1>{catalogCategory === 'podcast' ? 'Podcasts do catálogo' : catalogCategory === 'audiobook' ? 'Audiolivros do catálogo' : 'Músicas do Catálogo'}</h1><p>Toda a sua música, em um só lugar.</p>{catalogCategory !== 'all' && <button className="text-button" onClick={() => setCatalogCategory('all')}>Ver catálogo completo</button>}</div>
        </div>
        <div className="supabase-catalog-heading">
          <p className="catalog-disclaimer">As músicas da sua biblioteca, prontas para tocar.</p>
          <button className="primary-button" onClick={() => loadSupabaseTracks()} disabled={supabaseLoading || !session || appSettings.offlineMode} title={appSettings.offlineMode ? 'Desative o modo offline nas configurações.' : !session ? 'Entre na sua conta para atualizar o catálogo.' : undefined}><Radio size={17} /> {appSettings.offlineMode ? 'Modo offline' : supabaseLoading ? 'Carregando...' : !session ? 'Entre para atualizar' : 'Atualizar músicas'}</button>
        </div>
        {supabaseLoading && !catalogTracks.length && <div className="empty-state"><Radio size={28} /><p>Buscando suas faixas no Supabase...</p></div>}
        {!supabaseLoading && supabaseError && !catalogTracks.length && <div className="empty-state"><Music2 size={28} /><p>{supabaseError}</p></div>}
        {supabaseError && catalogTracks.length > 0 && <p className="catalog-offline-notice">Não foi possível atualizar o catálogo. As músicas já carregadas foram mantidas. {supabaseError}</p>}
        {catalogBrowseTracks.length > 0 && <div className="online-track-list">
          {catalogBrowseTracks.slice(0, trackPageSize).map(track => <article className={currentId === track.id && playing ? 'online-track-card is-playing' : 'online-track-card'} key={track.id}>
            <TrackPlayButton title={track.title} active={currentId === track.id} playing={playing} onClick={() => currentId === track.id ? togglePlayback() : playSong(track)} />
            <div className="online-track-cover" style={{ background: track.cover }} aria-label={`Capa de ${track.album}`} role="img">{!track.cover?.startsWith('url(') && <Music2 size={20} />}</div>
            <div className="online-track-info"><b>{track.title}</b><span>{track.artist}</span><small>{track.isDownloaded ? 'Disponível offline' : `Licença: ${track.license}`}</small></div>
            {track.isDownloaded
              ? <button className="heart-button" title="Remover download offline" aria-label={`Remover download de ${track.title}`} onClick={() => removeOfflineDownload(offlineTrackMap.get(track.id) || track)}><Trash2 size={17} /></button>
              : <button className="heart-button" disabled={downloadingIds.includes(track.id)} title={downloadingIds.includes(track.id) ? 'Baixando...' : 'Baixar para ouvir offline'} onClick={() => downloadTrackOffline(track)}>{downloadingIds.includes(track.id) ? '…' : <Download size={17} />}</button>}
              <button className="heart-button" title="Adicionar à fila" aria-label={`Adicionar ${track.title} à fila`} onClick={() => addToQueue(track)}><ListMusic size={17} /></button>
              <button className={favorites.includes(track.id) ? 'heart-button liked' : 'heart-button'} title={favorites.includes(track.id) ? 'Remover dos curtidos' : 'Curtir'} onClick={() => toggleFavorite(track.id)}><Heart size={17} fill={favorites.includes(track.id) ? 'currentColor' : 'none'} /></button>
            <button className="heart-button" title="Adicionar à playlist" onClick={() => setTrackToAdd(track.id)}><Plus size={18} /></button>
          </article>)}
          <p className="catalog-count">{catalogBrowseTracks.length} faixa(s) nesta seleção · {offlineTracks.length} baixada(s) no aparelho</p>
          {catalogBrowseTracks.length > trackPageSize && <button className="outline-button" onClick={() => setTrackPageSize(value => value + 100)}>Mostrar mais músicas ({catalogBrowseTracks.length - trackPageSize})</button>}
        </div>}
        {!supabaseLoading && !supabaseError && !catalogBrowseTracks.length && <div className="empty-state"><Music2 size={28} /><p>{appSettings.offlineMode || !session ? 'Baixe músicas quando estiver conectado para ouvi-las offline.' : 'As músicas publicadas nesta categoria aparecerão aqui.'}</p></div>}
      </section>}

      {section === 'social' && <section className="section-block social-section">
        <div className="social-page-heading">
          <div><p className="eyebrow muted">OUÇAM JUNTOS</p><h1>Amigos</h1><p>Acompanhe os familiares e veja o que está tocando agora.</p></div>
          <button className="outline-button" onClick={() => void refreshSocialData()} disabled={socialLoading || !session}><Users size={17} /> {socialLoading ? 'Atualizando...' : 'Atualizar'}</button>
        </div>
        {!session
          ? <div className="empty-state"><Users size={28} /><h3>Entre para ver seus familiares</h3><p>A atividade compartilhada está disponível para os perfis conectados ao Supabase.</p><button className="primary-button" onClick={() => setShowAuthScreen(true)}>Conectar conta</button></div>
          : socialError
            ? <div className="empty-state"><Users size={28} /><h3>Não foi possível carregar a área social</h3><p>{socialError}</p><button className="outline-button" onClick={() => void refreshSocialData()}>Tentar novamente</button></div>
            : <>
              <section className="social-self-profile">
                <span className="social-avatar">{(profileName || accountEmail || 'B')[0]?.toLocaleUpperCase()}</span>
                <span className="social-self-name"><b>{profileName || socialProfiles.find(profile => profile.user_id === session.user.id)?.display_name || accountEmail.split('@')[0]}</b><small>Seu perfil familiar</small></span>
                <span><b>{socialFollowingIds.length}</b><small>Acompanhando</small></span>
                <span><b>{socialFollowerCount}</b><small>Seguidores</small></span>
              </section>
              <div className="social-columns">
              <section className="social-card">
                <div className="social-card-heading"><div><p className="eyebrow muted">PERFIS DO BACKSTAGE</p><h2>Encontrar familiares</h2></div><span>{socialProfiles.filter(profile => profile.user_id !== session.user.id).length} perfil(is)</span></div>
                <label className="social-search"><Search size={17} /><input type="search" value={socialQuery} onChange={event => setSocialQuery(event.target.value)} placeholder="Buscar pelo nome do perfil" /></label>
                <div className="social-member-list">
                  {socialProfiles.filter(profile => profile.user_id !== session.user.id
                    && (profile.display_name || '').toLocaleLowerCase().includes(socialQuery.trim().toLocaleLowerCase()))
                    .map(profile => {
                      const followed = socialFollowingIds.includes(profile.user_id);
                      return <article className="social-member" key={profile.user_id}>
                        <span className="social-avatar">{(profile.display_name || 'B')[0]?.toLocaleUpperCase()}</span>
                        <span className="social-member-name"><b>{profile.display_name || `Membro ${profile.user_id.slice(0, 6)}`}</b><small>Perfil familiar</small></span>
                        <button className={followed ? 'outline-button following-button' : 'primary-button'} onClick={() => void toggleFollow(profile)} aria-label={followed ? `Deixar de acompanhar ${profile.display_name}` : `Acompanhar ${profile.display_name}`}>
                          {followed ? <><UserCheck size={16} /> Acompanhando</> : <><UserPlus size={16} /> Acompanhar</>}
                        </button>
                      </article>;
                    })}
                  {!socialProfiles.some(profile => profile.user_id !== session.user.id
                    && (profile.display_name || '').toLocaleLowerCase().includes(socialQuery.trim().toLocaleLowerCase()))
                    && <p className="queue-empty">Nenhum outro perfil encontrado. Cada familiar precisa entrar no app pelo menos uma vez para aparecer aqui.</p>}
                </div>
              </section>
              <section className="social-card">
                <div className="social-card-heading"><div><p className="eyebrow muted">AO VIVO</p><h2>Atividade dos amigos</h2></div><span>{socialFollowingIds.length} acompanhado(s)</span></div>
                <div className="social-activity-list">
                  {socialProfiles.filter(profile => socialFollowingIds.includes(profile.user_id)).map(profile => {
                    const activity = socialActivity.find(item => item.user_id === profile.user_id);
                    const recentlyUpdated = activity && Date.now() - new Date(activity.updated_at).getTime() < 120000;
                    const isPlayingNow = Boolean(activity?.is_playing && recentlyUpdated);
                    return <article className="social-activity" key={profile.user_id}>
                      <span className={isPlayingNow ? 'activity-indicator active' : 'activity-indicator'}><AudioLines size={17} /></span>
                      <span><b>{profile.display_name || `Membro ${profile.user_id.slice(0, 6)}`}</b><small>{isPlayingNow ? `${activity.track_title} · ${activity.artist}` : activity?.track_title ? `Última faixa: ${activity.track_title} · ${activity.artist}` : 'Ainda não compartilhou uma reprodução'}</small></span>
                      <span className={isPlayingNow ? 'activity-status active' : 'activity-status'}>{isPlayingNow ? 'Ouvindo' : 'Offline'}</span>
                    </article>;
                  })}
                  {!socialFollowingIds.length && <p className="queue-empty">Acompanhe os perfis da família para ver a atividade de reprodução deles.</p>}
                </div>
              </section>
            </div>
            </>}
      </section>}

{section === 'home' && <HomeView {...collectionFeatures}
        songs={allSongs} playlists={userPlaylists} favorites={libraryFavorites}
        recentlyPlayedSongs={recentlyPlayedSongs} profileName={displayName}
        onOpenPlaylist={openPlaylist} onOpenFavorites={() => navigateTo('favorites')}
        onOpenArtist={openArtist} onOpenAlbum={openAlbum}
        onOpenCatalog={openCatalog} onPlay={playSong}
      />}

      {['catalog-artists', 'catalog-albums'].includes(section) && <section className="section-block">
        <div className="section-title-row"><h1>{section === 'catalog-artists' ? 'Explorar artistas' : 'Explorar álbuns'}</h1><button className="text-button" onClick={openCatalog}>Abrir catálogo</button></div>
        <p className="catalog-disclaimer">Explore o catálogo. Só suas escolhas aparecem em Sua Biblioteca.</p>
        <div className="collection-grid">{section === 'catalog-artists' ? artists.map(name => <button className="entity-card artist-card" key={name} onClick={() => openArtist(name)}><CollectionCover kind="artist" songs={allSongs.filter(song => song.artist === name)} /><b>{name}</b><span>{savedArtistNames.includes(name) ? 'Seguindo' : 'Ver artista'}</span></button>) : albums.map(album => <button className="entity-card" key={album.key} onClick={() => openAlbum(album)}><CollectionCover kind="album" songs={album.songs} /><b>{album.album}</b><span>{album.artist}</span></button>)}</div>
      </section>}

      {section === 'library' && <LibraryView {...collectionFeatures}
        songs={allSongs} playlists={userPlaylists} favorites={libraryFavorites} savedArtists={libraryArtists}
        tab={libraryTab} onTabChange={setLibraryTab} onOpenPlaylist={openPlaylist} onPlay={playSong} recentlyPlayedSongs={recentlyPlayedSongs}
        searchVisible={librarySearchOpen} onSearchVisibleChange={setLibrarySearchOpen}
        onOpenFavorites={() => navigateTo('favorites')} onOpenArtist={openArtist}
        onOpenAlbum={openAlbum} onCreatePlaylist={createPlaylist}
      />}

      {section === 'profile' && <section className="profile-page">
        <div className="collection-detail">
          <div className="profile-page-avatar">{displayName[0]?.toLocaleUpperCase()}</div>
          <div className="collection-detail-info"><p className="eyebrow muted">PERFIL</p><h1>{displayName}</h1>
            <p>{userPlaylists.length} playlists · {allSongs.filter(song => libraryFavorites.includes(song.id)).length} músicas curtidas · {libraryArtists.length} artistas seguidos</p>
            {session && <button className="outline-button" onClick={openProfileSettings}>Editar perfil</button>}
          </div>
        </div>
        {libraryArtists.length > 0 && <div className="profile-artists"><h2>Artistas que você segue</h2><div className="collection-grid">
          {libraryArtists.map(name => <button className="entity-card artist-card" key={name} onClick={() => openArtist(name)}>
            <CollectionCover kind="artist" songs={allSongs.filter(song => song.artist === name)} />
            <b>{name}</b><span>Artista</span>
          </button>)}
        </div></div>}
        <LibraryView {...collectionFeatures} songs={allSongs} playlists={userPlaylists} favorites={libraryFavorites} tab="playlists" onPlay={playSong} recentlyPlayedSongs={recentlyPlayedSongs}
          onTabChange={tab => { setLibraryTab(tab); navigateTo('library'); }}
          onOpenPlaylist={openPlaylist} onOpenFavorites={() => navigateTo('favorites')}
          onOpenArtist={openArtist} onOpenAlbum={openAlbum} onCreatePlaylist={createPlaylist} />
      </section>}

      {section === 'artist' && <>
        <section className="artist-page-banner" style={{ background: artistHero?.cover || covers[4] }}>
          <div className="artist-banner-content"><span className="artist-label"><AudioLines size={17} /> Artista do seu catálogo</span>
            <h1>{selectedArtist}</h1><p className="artist-catalog-stats">{artistTracks.length} músicas · {artistAlbums.length} álbuns no seu catálogo</p>
          </div>
        </section>
        <div className="collection-detail artist-detail"><div className="collection-detail-actions">
          <button className="primary-button collection-play-button" aria-label={`Reproduzir ${selectedArtist}`} onClick={() => playCollection(artistTracks)}><Play size={27} fill="currentColor" /></button>
          <button className="heart-button artist-shuffle-button" aria-label={`Embaralhar músicas de ${selectedArtist}`} onClick={() => playCollection(artistTracks, true)}><Shuffle size={27} /></button>
          <button className="outline-button artist-follow-button" aria-pressed={savedArtistNames.includes(selectedArtist)} onClick={() => toggleSavedArtist(selectedArtist)}>{savedArtistNames.includes(selectedArtist) ? 'Seguindo' : 'Seguir'}</button>
          <button className="text-button" onClick={() => openCategory('artists')}>Explorar artistas</button>
        </div></div>
      </>}

      {['search', 'favorites', 'playlist', 'artist', 'album', 'recent', 'episodes', 'mix', 'downloads'].includes(section) && <section className="section-block library-section">
        {['playlist', 'album', 'favorites', 'episodes', 'mix'].includes(section) && <div className="collection-detail">
          <CollectionCover className="collection-detail-cover" kind={section === 'favorites' ? 'favorites' : section === 'episodes' ? 'episodes' : section === 'album' ? 'album' : 'playlist'}
            songs={visibleSongs} cover={section === 'playlist' ? selectedPlaylist?.cover : section === 'mix' ? selectedMix?.cover : selectedAlbumInfo?.cover} />
          <div className="collection-detail-info"><p className="eyebrow muted">{section === 'album' ? 'ÁLBUM' : 'PLAYLIST'}</p>
            <h1>{libraryHeader}</h1>
            <p>{section === 'album' ? selectedAlbumInfo?.artist || 'Vários artistas' : displayName} · {visibleSongs.length} músicas</p>
            <div className="collection-detail-actions">
              <button className="primary-button collection-play-button" aria-label={`Reproduzir ${libraryHeader}`} onClick={() => playCollection(visibleSongs)}><Play size={25} fill="currentColor" /></button>
              <button className="heart-button artist-shuffle-button" aria-label="Reproduzir em ordem aleatória" onClick={() => playCollection(visibleSongs, true)}><Shuffle size={25} /></button>
              {section === 'playlist' && selectedPlaylist && <button className="text-button" onClick={() => removePlaylist(selectedPlaylist)}><Trash2 size={17} /> Excluir playlist</button>}
              {section === 'album' && selectedAlbumInfo && <button className="text-button" onClick={() => openArtist(selectedAlbumInfo.artist)}>Ver artista</button>}
              {section === 'mix' && <button className="outline-button" onClick={saveMixAsPlaylist}><Plus size={17} /> Salvar como playlist</button>}
              {currentViewContext() && <button className="heart-button" aria-label={listenerData.pinnedCollections.includes(currentViewContext().key) ? 'Desafixar coleção' : 'Fixar coleção'} onClick={() => toggleCollectionPin(currentViewContext().key)}><Pin size={19} fill={listenerData.pinnedCollections.includes(currentViewContext().key) ? 'currentColor' : 'none'} /></button>}
              <button className="heart-button" aria-label="Baixar coleção" disabled={bulkDownloading} onClick={() => handleCollectionAction('download', { songs: visibleSongs })}><Download size={20} /></button>
            </div>
          </div>
        </div>}
        <div className="section-title-row"><div>
          {section === 'search' && <p className="eyebrow muted">SEU CATÁLOGO</p>}
          <h2 className={section === 'artist' ? 'artist-popular-title' : ''}>{['album', 'playlist', 'favorites', 'mix'].includes(section) ? 'Músicas' : libraryHeader}</h2>
        </div>{section === 'recent' && <button className="text-button" onClick={clearListeningHistory}>Limpar histórico</button>}</div>
        {section === 'search' && !query.trim() && <p className="catalog-disclaimer">Encontre uma música, um artista ou um álbum da sua biblioteca.</p>}
        {supabaseLoading && !catalogTracks.length
          ? <div className="empty-state"><Radio size={28} /><h3>Carregando seu catálogo</h3><p>Preparando suas músicas.</p></div>
          : supabaseError && !catalogTracks.length && !appSettings.offlineMode && session
            ? <div className="empty-state"><Music2 size={28} /><h3>Não foi possível carregar o catálogo</h3><p>{supabaseError}</p><button className="outline-button" onClick={() => loadSupabaseTracks()}>Tentar novamente</button></div>
            : renderedSongs.length ? <div className="track-list">
              <div className="track-list-head"><span>#</span><span>Título</span><span>Álbum</span><span><Clock3 size={15} /></span><span></span></div>
              {renderedSongs.map((song, index) => <div className={currentId === song.id && playing ? 'track-row is-playing' : 'track-row'} key={song.id}>
                <TrackPlayButton title={song.title} number={index + 1} active={currentId === song.id} playing={playing} onClick={() => currentId === song.id ? togglePlayback() : playSong(song)} />
                <div className="track-main">
                  <button className="track-thumb" style={{ background: song.cover || covers[0] }} aria-label={`Reproduzir ${song.title}`} onClick={() => playSong(song)}>{!song.cover?.startsWith('url(') && <Music2 size={19} />}</button>
                  <span className="track-labels"><button className="track-title-link" onClick={() => playSong(song)}>{song.title}</button><button className="track-artist-link" onClick={() => openArtist(song.artist)}>{song.artist}</button></span>
                </div>
                <button className="track-album" onClick={() => openAlbum({ album: song.album, artist: song.artist })}>{song.album}</button>
                <span className="track-duration">{song.durationLabel || '—:—'}</span>
                <div className="track-actions">
                  {offlineTrackMap.has(song.id)
                    ? <button className="heart-button" title="Remover download offline" aria-label={`Remover download de ${song.title}`} onClick={() => removeOfflineDownload(offlineTrackMap.get(song.id))}><Trash2 size={16} /></button>
                    : <button className="heart-button" disabled={downloadingIds.includes(song.id)} title={downloadingIds.includes(song.id) ? 'Baixando...' : 'Baixar para ouvir offline'} aria-label={`Baixar ${song.title}`} onClick={() => downloadTrackOffline(song)}>{downloadingIds.includes(song.id) ? '…' : <Download size={16} />}</button>}
                  <button title="Adicionar à fila" aria-label={`Adicionar ${song.title} à fila`} className="heart-button" onClick={() => addToQueue(song)}><ListMusic size={17} /></button>
                  <button title={favorites.includes(song.id) ? 'Remover dos curtidos' : 'Curtir'} aria-label={`Curtir ${song.title}`} className={favorites.includes(song.id) ? 'heart-button liked' : 'heart-button'} onClick={() => toggleFavorite(song.id)}><Heart size={17} fill={favorites.includes(song.id) ? 'currentColor' : 'none'} /></button>
                  <button title="Adicionar à playlist" aria-label={`Adicionar ${song.title} à playlist`} className="heart-button" onClick={() => setTrackToAdd(song.id)}><Plus size={18} /></button>
                  {section === 'playlist' && <button title="Remover da playlist" aria-label={`Remover ${song.title} da playlist`} className="heart-button" onClick={() => removeTrackFromPlaylist(song.id)}><X size={17} /></button>}
                </div>
              </div>)}
            </div>
              : <EmptyState icon={section === 'favorites' ? 'heart' : 'music'}
                title={query.trim() ? 'Nenhum resultado encontrado' : section === 'favorites' ? 'Nenhuma música curtida ainda' : section === 'playlist' ? 'Esta playlist está vazia' : section === 'recent' ? 'Você ainda não ouviu nenhuma música' : 'Nenhuma música disponível'}
                text={query.trim() ? 'Tente outro título, artista ou álbum.' : section === 'favorites' ? 'Curta músicas do catálogo para encontrá-las aqui.' : section === 'playlist' ? 'Adicione músicas do catálogo à sua playlist.' : section === 'recent' ? 'Suas próximas reproduções aparecerão aqui.' : 'Explore o catálogo para encontrar seu próximo som.'}
                onAction={openCatalog} />}
        {(section !== 'artist' || artistShowAll) && visibleSongs.length > trackPageSize && <button className="outline-button" onClick={() => setTrackPageSize(value => value + 100)}>Mostrar mais músicas ({visibleSongs.length - trackPageSize})</button>}
        {section === 'artist' && visibleSongs.length > 5 && <button className="text-button artist-show-more" onClick={() => setArtistShowAll(value => !value)}>{artistShowAll ? 'Ver menos' : 'Ver mais'}</button>}
        {section === 'artist' && artistAlbums.length > 0 && <section className="discography-section">
          <div className="discography-heading"><h2>Discografia</h2><button className="text-button" onClick={() => { setDiscographyView('all'); openCategory('albums'); }}>Todos os álbuns</button></div>
          <div className="discography-tabs" aria-label="Filtrar discografia">
            {[['all', 'Todos'], ['albums', 'Álbuns'], ['singles', 'Faixas avulsas']].map(([id, label]) => <button className={discographyView === id ? 'active' : ''} aria-pressed={discographyView === id} onClick={() => setDiscographyView(id)} key={id}>{label}</button>)}
          </div>
          <div className="collection-grid">{discographyAlbums.map(album => <button className="entity-card" key={album.key} onClick={() => openAlbum(album)}>
            <CollectionCover kind="album" songs={album.songs} cover={album.cover} /><b>{album.album}</b><span>{album.songs.length} faixas no catálogo</span>
          </button>)}</div>
          {!discographyAlbums.length && <p className="catalog-disclaimer">Nenhum lançamento deste tipo no seu catálogo.</p>}
        </section>}
      </section>}
      <footer>BACKSTAGE MUSIC <span>•</span> SUA MÚSICA, SUA HISTÓRIA</footer>
    </main>

    {current && nowPanelOpen && <aside className="now-playing-panel" aria-label="Tocando agora">
      <div className="now-panel-heading"><b>Tocando agora</b><button className="heart-button" aria-label="Fechar painel da faixa" onClick={() => setNowPanelOpen(false)}><X size={18} /></button></div>
      <CollectionCover className="now-panel-cover" kind="album" songs={[current]} cover={current.cover} />
      <div className="now-panel-title"><div><h2>{current.title}</h2><button className="track-artist-link" onClick={() => openArtist(current.artist)}>{current.artist}</button></div>
        <button className={favorites.includes(current.id) ? 'heart-button liked' : 'heart-button'} aria-label={favorites.includes(current.id) ? 'Remover dos curtidos' : 'Curtir faixa atual'} onClick={() => toggleFavorite(current.id)}><Heart size={21} fill={favorites.includes(current.id) ? 'currentColor' : 'none'} /></button>
      </div>
      <div className="local-playback-status"><Monitor size={15} /><span>{playing ? 'Tocando neste aparelho' : 'Pausado neste aparelho'}</span></div>
      <section className="now-panel-card"><h3>Sobre o artista</h3>
        <CollectionCover kind="artist" songs={allSongs.filter(song => song.artist === current.artist)} />
        <h3>{current.artist}</h3><p>{allSongs.filter(song => song.artist === current.artist).length} músicas no seu catálogo</p>
        <button className="outline-button" onClick={() => openArtist(current.artist)}>Ver artista</button>
      </section>
      <section className="now-panel-card"><div className="now-panel-heading"><h3>A seguir</h3><button className="text-button" onClick={() => setQueueOpen(true)}>Abrir fila</button></div>
        {queuedSongs.slice(0, 3).map(song => <button className="queue-song" key={song.id} onClick={() => { removeFromQueue(song.id); selectSong(song); }}>
          <CollectionCover className="queue-cover" kind="album" songs={[song]} cover={song.cover} /><span><b>{song.title}</b><small>{song.artist}</small></span>
        </button>)}
        {!queuedSongs.length && <p>Adicione músicas à fila para escolher seu próximo som.</p>}
      </section>
    </aside>}

    <div className="player-bar">
      <div className="now-playing"><button className="now-playing-open" onClick={() => current && setExpandedPlayerOpen(true)} aria-label={current ? `Abrir player de ${current.title}` : 'Nenhuma música selecionada'} disabled={!current}><span className="mini-cover" style={{ background: current?.cover || covers[0] }}>{!current?.cover?.startsWith('url(') && <Music2 size={22} />}</span><span className="now-text"><b>{current?.title || 'Escolha uma música'}</b><span>{current?.artist || 'Seu catálogo de músicas'}</span></span></button>{current && <button className={favorites.includes(current.id) ? 'heart-button liked' : 'heart-button'} onClick={() => toggleFavorite(current.id)} aria-label="Curtir música"><Heart size={18} fill={favorites.includes(current.id) ? 'currentColor' : 'none'} /></button>}</div>
      <div className="player-controls"><div className="control-buttons"><button className={shuffle ? 'control-active' : ''} title={shuffle ? 'Desativar aleatório' : 'Ativar aleatório'} aria-pressed={shuffle} onClick={() => setShuffle(value => !value)}><Shuffle size={17} /></button><button title="Anterior" onClick={() => moveTrack(-1)}><SkipBack size={19} fill="currentColor" /></button><button className="play-button" title={playing ? 'Pausar' : 'Reproduzir'} onClick={() => current?.src ? togglePlayback() : openCatalog()}>{playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}</button><button title="Próxima" onClick={() => moveTrack(1)}><SkipForward size={19} fill="currentColor" /></button><button className={repeatMode !== 'off' ? 'control-active' : ''} title={`Repetição: ${repeatMode === 'off' ? 'desativada' : repeatMode === 'one' ? 'faixa atual' : 'fila'}`} aria-pressed={repeatMode !== 'off'} onClick={() => setRepeatMode(mode => mode === 'off' ? 'all' : mode === 'all' ? 'one' : 'off')}>{repeatMode === 'one' ? <Repeat1 size={17} /> : <Repeat size={17} />}</button></div><div className="progress-row"><span>{time(progress)}</span><input aria-label="Progresso da música" type="range" min="0" max={duration || 100} value={Math.min(progress, duration || 100)} onChange={event => { const value = Number(event.target.value); setProgress(value); if (audioRef.current && duration) audioRef.current.currentTime = value; }} /><span>{time(duration)}</span></div></div>
      <div className="player-extra"><button className={nowPanelOpen ? 'now-panel-toggle active' : 'now-panel-toggle'} title="Mostrar faixa atual" aria-label="Mostrar faixa atual" aria-pressed={nowPanelOpen} onClick={() => setNowPanelOpen(value => !value)}><PanelRight size={18} /></button><button className={queueOpen ? 'queue-toggle active' : 'queue-toggle'} title="Abrir fila de reprodução" aria-label="Abrir fila de reprodução" aria-pressed={queueOpen} onClick={() => setQueueOpen(value => !value)}><ListMusic size={18} />{queuedSongIds.length > 0 && <span>{queuedSongIds.length}</span>}</button><button className="fullscreen-toggle" aria-label={fullscreen ? 'Sair da tela cheia' : 'Abrir em tela cheia'} onClick={toggleFullscreen} disabled={!current}>{fullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}</button><Volume2 size={19} /><input aria-label="Volume" type="range" min="0" max="100" value={volume} onChange={event => setVolume(Number(event.target.value))} /></div>
    </div>
    {queueOpen && <aside className="play-queue-panel" aria-label="Fila de reprodução">
      <div className="play-queue-heading"><div><p className="eyebrow muted">PRÓXIMAS FAIXAS</p><h2>Fila de reprodução</h2></div><div><button className="text-button" onClick={() => setQueuedSongIds([])} disabled={!queuedSongIds.length}>Limpar</button><button className="heart-button" aria-label="Fechar fila" onClick={() => setQueueOpen(false)}><X size={18} /></button></div></div>
      {current && <div className="queue-current"><span className="queue-cover" style={{ background: current.cover || covers[0] }}><AudioLines size={17} /></span><span><small>Tocando agora</small><b>{current.title}</b><span>{current.artist}</span></span></div>}
      <div className="play-queue-list">
        {queuedSongs.map((song, index) => <div className="play-queue-item" key={song.id}>
          <button className="queue-song" onClick={() => { removeFromQueue(song.id); selectSong(song); }}>
            <span className="queue-cover" style={{ background: song.cover || covers[0] }}><Music2 size={17} /></span>
            <span><b>{song.title}</b><small>{song.artist}</small></span>
          </button>
          <div className="queue-item-actions"><button className="heart-button" title={`Mover ${song.title} para cima`} aria-label={`Mover ${song.title} para cima`} disabled={index === 0} onClick={() => moveQueuedSong(song.id, -1)}><ArrowUp size={16} /></button><button className="heart-button" title={`Mover ${song.title} para baixo`} aria-label={`Mover ${song.title} para baixo`} disabled={index === queuedSongs.length - 1} onClick={() => moveQueuedSong(song.id, 1)}><ArrowDown size={16} /></button>
          <button className="heart-button" title={`Remover ${song.title} da fila`} aria-label={`Remover ${song.title} da fila`} onClick={() => removeFromQueue(song.id)}><X size={17} /></button>
          </div>
        </div>)}
        {!queuedSongs.length && <p className="queue-empty">A fila está vazia. Use o ícone de fila ao lado de uma música para adicioná-la.</p>}
      </div>
    </aside>}
    {expandedPlayerOpen && current && <div className="expanded-player-backdrop" onMouseDown={event => {
      if (event.target === event.currentTarget) setExpandedPlayerOpen(false);
    }}>
      <section className="expanded-player" role="dialog" aria-modal="true" aria-labelledby="expanded-player-title">
        <header className="expanded-player-header"><span className="eyebrow muted">TOCANDO AGORA</span><button className="heart-button" aria-label="Fechar player expandido" onClick={() => setExpandedPlayerOpen(false)}><ChevronDown size={23} /></button></header>
        <div className="expanded-player-layout">
          <div className="expanded-player-main">
            <div className="expanded-cover" style={{ background: current.cover || covers[0] }} role="img" aria-label={`Capa de ${current.album}`}>{!current.cover?.startsWith('url(') && <Music2 size={64} />}</div>
            <div className="expanded-track-details"><div><h2 id="expanded-player-title">{current.title}</h2><p>{current.artist} · {current.album}</p></div><button className={favorites.includes(current.id) ? 'heart-button liked' : 'heart-button'} onClick={() => toggleFavorite(current.id)} aria-label={favorites.includes(current.id) ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}><Heart size={23} fill={favorites.includes(current.id) ? 'currentColor' : 'none'} /></button></div>
            <div className="expanded-controls">
              <div className="control-buttons">
                <button className={shuffle ? 'control-active' : ''} title={shuffle ? 'Desativar aleatório' : 'Ativar aleatório'} aria-pressed={shuffle} onClick={() => setShuffle(value => !value)}><Shuffle size={19} /></button>
                <button title="Anterior" onClick={() => moveTrack(-1)}><SkipBack size={22} fill="currentColor" /></button>
                <button className="play-button expanded-play-button" title={playing ? 'Pausar' : 'Reproduzir'} onClick={togglePlayback}>{playing ? <Pause size={23} fill="currentColor" /> : <Play size={23} fill="currentColor" />}</button>
                <button title="Próxima" onClick={() => moveTrack(1)}><SkipForward size={22} fill="currentColor" /></button>
                <button className={repeatMode !== 'off' ? 'control-active' : ''} title={`Repetição: ${repeatMode === 'off' ? 'desativada' : repeatMode === 'one' ? 'faixa atual' : 'fila'}`} aria-pressed={repeatMode !== 'off'} onClick={() => setRepeatMode(mode => mode === 'off' ? 'all' : mode === 'all' ? 'one' : 'off')}>{repeatMode === 'one' ? <Repeat1 size={19} /> : <Repeat size={19} />}</button>
              </div>
              <div className="progress-row"><span>{time(progress)}</span><input aria-label="Progresso da música" type="range" min="0" max={duration || 100} value={Math.min(progress, duration || 100)} onChange={event => { const value = Number(event.target.value); setProgress(value); if (audioRef.current && duration) audioRef.current.currentTime = value; }} /><span>{time(duration)}</span></div>
              <label className="expanded-volume"><Volume2 size={18} /><input aria-label="Volume" type="range" min="0" max="100" value={volume} onChange={event => setVolume(Number(event.target.value))} /></label>
              {isLongform && <div className="longform-controls"><button aria-label="Voltar 15 segundos" onClick={() => seekBy(-15)}><RotateCcw size={17} /> 15 s</button><label>Velocidade<select aria-label="Velocidade do áudio" value={appSettings.playbackRate} onChange={event => updateAppSetting('playbackRate', Number(event.target.value))}>{[0.5,0.75,1,1.25,1.5,2].map(rate => <option value={rate} key={rate}>{rate}×</option>)}</select></label><button aria-label="Avançar 15 segundos" onClick={() => seekBy(15)}>15 s <RotateCw size={17} /></button>{normalizeContentType(current.contentType) === 'podcast' && <button className={'episode-save-button' + (listenerData.savedEpisodeIds.includes(current.id) ? ' saved' : '')} aria-label={listenerData.savedEpisodeIds.includes(current.id) ? 'Remover episódio salvo' : 'Salvar episódio'} onClick={() => toggleEpisode(current)}><Bookmark size={20} fill={listenerData.savedEpisodeIds.includes(current.id) ? 'currentColor' : 'none'} /></button>}</div>}
            </div>
          </div>
          <aside className="expanded-queue">
            <div className="expanded-queue-heading"><div><p className="eyebrow muted">PRÓXIMAS FAIXAS</p><h3>Fila de reprodução</h3></div><button className="text-button" onClick={() => setQueuedSongIds([])} disabled={!queuedSongIds.length}>Limpar</button></div>
            <div className="expanded-queue-list">
              {queuedSongs.map((song, index) => <div className="play-queue-item" key={song.id}>
                <button className="queue-song" onClick={() => { removeFromQueue(song.id); selectSong(song); }}>
                  <span className="queue-cover" style={{ background: song.cover || covers[0] }}><Music2 size={17} /></span>
                  <span><b>{song.title}</b><small>{song.artist}</small></span>
                </button>
                <div className="queue-item-actions"><button className="heart-button" title={`Mover ${song.title} para cima`} aria-label={`Mover ${song.title} para cima`} disabled={index === 0} onClick={() => moveQueuedSong(song.id, -1)}><ArrowUp size={16} /></button><button className="heart-button" title={`Mover ${song.title} para baixo`} aria-label={`Mover ${song.title} para baixo`} disabled={index === queuedSongs.length - 1} onClick={() => moveQueuedSong(song.id, 1)}><ArrowDown size={16} /></button><button className="heart-button" title={`Remover ${song.title} da fila`} aria-label={`Remover ${song.title} da fila`} onClick={() => removeFromQueue(song.id)}><X size={17} /></button></div>
              </div>)}
              {!queuedSongs.length && <p className="queue-empty">Adicione músicas à fila para escolher a ordem em que serão tocadas.</p>}
            </div>
          </aside>
        </div>
      </section>
    </div>}
    {notificationsOpen && <CatalogUpdates tracks={[...allSongs].sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0))} unseenIds={unseenCatalogIds}
      onPlay={song => { playSong(song); setNotificationsOpen(false); }} onMarkRead={() => setListenerData(old => ({ ...old, lastCatalogSeenAt: Date.now() }))} onClose={() => setNotificationsOpen(false)} />}
    {installOpen && <InstallDialog baseUrl={downloadBaseUrl} onClose={() => setInstallOpen(false)} />}
    {shortcutsOpen && <ShortcutHelp onClose={() => setShortcutsOpen(false)} />}
    <audio
      ref={audioRef}
      src={current?.src || undefined}
      preload={appSettings.dataSaver ? 'none' : 'metadata'}
      onTimeUpdate={event => {
        const audio = event.currentTarget;
        setProgress(audio.currentTime);
        if (Date.now() - lastProgressSaveAt.current > 5000) {
          lastProgressSaveAt.current = Date.now();
          rememberPlaybackPosition(current, audio.currentTime, audio.duration);
        }
      }}
      onLoadedMetadata={event => {
        loadedAudioTrackRef.current = current?.id || '';
        const loadedDuration = event.currentTarget.duration;
        setDuration(loadedDuration);
        if (pendingSeekRef.current !== null) {
          const seekPosition = Math.min(pendingSeekRef.current, loadedDuration || pendingSeekRef.current);
          event.currentTarget.currentTime = seekPosition;
          setProgress(seekPosition);
          pendingSeekRef.current = null;
        }
      }}
      onError={() => { void recoverExpiredTrackUrl(); }}
      onPause={event => { if (loadedAudioTrackRef.current === current?.id) rememberPlaybackPosition(current, event.currentTarget.currentTime, event.currentTarget.duration); }}
      onSeeked={event => { if (loadedAudioTrackRef.current === current?.id) rememberPlaybackPosition(current, event.currentTarget.currentTime, event.currentTarget.duration); }}
      onEnded={handleTrackEnded}
    />
    {trackToAdd && <div className="modal-backdrop" onClick={() => setTrackToAdd(null)}><div className="playlist-modal" role="dialog" aria-modal="true" aria-labelledby="playlist-modal-title" onClick={event => event.stopPropagation()}><div className="modal-heading"><div><p className="eyebrow muted">ORGANIZE SUAS FAIXAS</p><h2 id="playlist-modal-title">Adicionar à playlist</h2></div><button className="heart-button" aria-label="Fechar" onClick={() => setTrackToAdd(null)}><X size={20} /></button></div>{userPlaylists.length ? userPlaylists.map(playlist => <button className="playlist-choice" key={playlist.id} onClick={() => addToPlaylist(playlist.id)}><span className="choice-cover" style={{ background: playlist.cover }}><ListMusic size={20} /></span><span><b>{playlist.name}</b><small>{playlist.songIds.length} músicas</small></span><Plus size={18} /></button>) : <p className="modal-empty">Você ainda não criou nenhuma playlist.</p>}<button className="primary-button modal-create" onClick={createPlaylist}><Plus size={17} /> Criar playlist{userPlaylists.length ? ' e adicionar música' : ''}</button></div></div>}
    {notice && <div className="toast"><span>{notice}</span><button aria-label="Dispensar aviso" onClick={() => setNotice('')}><X size={16} /></button></div>}
  </div>;
}

function EmptyState({ icon = 'music', title, text, onAction, buttonLabel = 'Abrir catálogo' }) {
  const Icon = icon === 'heart' ? Heart : icon === 'artist' ? UsersRound : icon === 'album' ? Disc3 : Music2;
  return <div className="empty-state"><Icon size={29} /><h3>{title}</h3><p>{text}</p>{onAction && <button className="primary-button" onClick={onAction}><Radio size={17} /> {buttonLabel}</button>}</div>;
}
