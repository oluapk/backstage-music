import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, Clock3, Disc3, ListMusic, Music2, Search, UsersRound, X } from 'lucide-react';
import { createSearchIndex, getSearchSuggestions, makeSearchEntries } from './search.js';

function SearchArtwork({ entry }) {
  const Icon = entry.type === 'query' ? Clock3 : entry.type === 'artist' ? UsersRound : entry.type === 'album' ? Disc3 : entry.type === 'playlist' ? ListMusic : Music2;
  return <span className={`search-result-art search-result-art--${entry.type}`} style={entry.cover ? { background: entry.cover } : undefined} aria-hidden="true">
    {!entry.cover?.startsWith('url(') && <Icon size={21} />}
  </span>;
}

export default function CatalogSearch({ query = '', onQueryChange, onSearchPage, onSelect, onSubmitQuery, recentSearches = [], onRemoveRecent, onClearRecent, songs = [], playlists = [], searchIndex, onOpenChange }) {
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;
  const index = useMemo(() => searchIndex || createSearchIndex(makeSearchEntries(songs, playlists)), [searchIndex, songs, playlists]);
  const entries = useMemo(() => index.records.map(record => record.entry), [index]);
  const hasQuery = Boolean(query.trim());
  const results = useMemo(() => {
    if (hasQuery) return getSearchSuggestions(query, index);
    const available = new Map(entries.map(entry => [entry.key, entry]));
    const seen = new Set();
    return recentSearches.filter(entry => {
      if (!entry || !['song', 'artist', 'album', 'playlist', 'query'].includes(entry.type) || typeof entry.title !== 'string' || typeof entry.key !== 'string' || seen.has(entry.key)) return false;
      seen.add(entry.key);
      return true;
    }).slice(0, 10).map(entry => available.get(entry.key) || entry);
  }, [hasQuery, query, index, entries, recentSearches]);

  useEffect(() => { onOpenChangeRef.current?.(open); }, [open]);
  useEffect(() => { setHighlighted(-1); }, [query]);
  useEffect(() => {
    setHighlighted(index => index >= results.length ? results.length - 1 : index);
  }, [results.length]);
  useEffect(() => {
    if (!open || highlighted < 0) return;
    document.getElementById(`catalog-search-option-${highlighted}`)?.scrollIntoView({ block: 'nearest' });
  }, [highlighted, open]);
  useEffect(() => {
    const focusSearch = event => {
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key.toLocaleLowerCase() !== 'k' && !(event.shiftKey && event.key.toLocaleLowerCase() === 'l')) return;
      event.preventDefault();
      onSearchPage?.();
      window.requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
        setOpen(true);
      });
    };
    window.addEventListener('keydown', focusSearch);
    return () => window.removeEventListener('keydown', focusSearch);
  }, [onSearchPage]);
  useEffect(() => {
    if (!open) return undefined;
    const closeOutside = event => {
      if (!rootRef.current?.contains(event.target)) {
        setOpen(false);
        setHighlighted(-1);
      }
    };
    window.addEventListener('pointerdown', closeOutside);
    return () => window.removeEventListener('pointerdown', closeOutside);
  }, [open]);

  const submitQuery = () => {
    const text = query.trim();
    if (text && onSubmitQuery) onSubmitQuery(text);
    else onSearchPage?.();
    setOpen(false);
    setHighlighted(-1);
  };
  const selectEntry = entry => {
    onSelect?.(entry);
    inputRef.current?.focus({ preventScroll: true });
    setOpen(false);
    setHighlighted(-1);
  };
  const handleKeys = event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      setHighlighted(-1);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
      if (results.length) setHighlighted(index => event.key === 'ArrowDown' ? (index + 1) % results.length : index < 0 ? results.length - 1 : (index - 1 + results.length) % results.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (open && highlighted >= 0 && results[highlighted]) selectEntry(results[highlighted]);
      else submitQuery();
    }
  };

  return <div className={`catalog-search search-box${open ? ' catalog-search--open' : ''}`} role="search" ref={rootRef} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    <Search size={21} aria-hidden="true" />
    <input id="search" ref={inputRef} type="search" value={query} aria-label="Buscar no catálogo" role="combobox" autoComplete="off" spellCheck={false}
      aria-expanded={open} aria-controls="catalog-search-results" aria-autocomplete="list" aria-activedescendant={open && highlighted >= 0 ? `catalog-search-option-${highlighted}` : undefined}
      placeholder="O que você quer ouvir?" onFocus={() => setOpen(true)} onKeyDown={handleKeys}
      onChange={event => { onQueryChange?.(event.target.value); setOpen(true); }} />
    {query ? <button type="button" className="search-query-clear" aria-label="Limpar busca" onMouseDown={event => event.preventDefault()} onClick={() => { onQueryChange?.(''); setOpen(true); inputRef.current?.focus(); }}><X size={19} /></button>
      : <kbd className="catalog-search-shortcut" title="Buscar: Ctrl + K ou Ctrl + Shift + L">Ctrl K</kbd>}
    {open && <div className="catalog-search-dropdown">
      <div className="catalog-search-heading"><strong>{hasQuery ? 'No seu catálogo' : 'Buscas recentes'}</strong>
        {!hasQuery && results.length > 0 && onClearRecent && <button type="button" onMouseDown={event => event.preventDefault()} onClick={onClearRecent}>Limpar tudo</button>}
      </div>
      <div className="catalog-search-results" id="catalog-search-results" role="listbox" aria-label={hasQuery ? 'Sugestões do catálogo' : 'Buscas recentes'}>
        {results.map((entry, index) => <div className="search-suggestion-row" key={entry.key} role="presentation">
          <button type="button" id={`catalog-search-option-${index}`} role="option" aria-selected={highlighted === index} className={highlighted === index ? 'search-suggestion selected' : 'search-suggestion'}
            onMouseDown={event => event.preventDefault()} onMouseEnter={() => setHighlighted(index)} onClick={() => selectEntry(entry)}>
            <SearchArtwork entry={entry} /><span className="search-suggestion-label"><b>{entry.title}</b><small>{entry.subtitle || (entry.type === 'query' ? 'Busca' : 'No seu catálogo')}</small></span>
          </button>
          {!hasQuery && onRemoveRecent && <button type="button" className="search-recent-remove" aria-label={`Remover ${entry.title} das buscas recentes`} onMouseDown={event => event.preventDefault()} onClick={() => onRemoveRecent(entry.key)}><X size={17} /></button>}
        </div>)}
      </div>
      {!results.length && <p className="catalog-search-empty">{hasQuery ? 'Nenhum resultado neste catálogo. Tente outro título, artista ou álbum.' : 'As buscas que você abrir aparecerão aqui.'}</p>}
      {hasQuery && <button type="button" className="catalog-search-all" onMouseDown={event => event.preventDefault()} onClick={submitQuery}>Ver todos os resultados <ArrowUpRight size={17} /></button>}
    </div>}
  </div>;
}
