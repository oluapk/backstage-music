import React, { useEffect, useRef, useState } from 'react';
import { Bell, Check, Download, Keyboard, Monitor, Play, Smartphone, X } from 'lucide-react';
import { CollectionCover } from './LibraryViews.jsx';

function FeatureDialog({ title, onClose, children, className = '' }) {
  const dialogRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previousFocus = document.activeElement;
    dialogRef.current?.querySelector('button')?.focus();
    const close = event => {
      if (event.key === 'Escape') closeRef.current();
      if (event.key !== 'Tab') return;
      const items = [...(dialogRef.current?.querySelectorAll('button:not([disabled]),a[href],input,select') || [])];
      if (!items.length) return;
      if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items[items.length - 1].focus(); }
      else if (!event.shiftKey && document.activeElement === items[items.length - 1]) { event.preventDefault(); items[0].focus(); }
    };
    window.addEventListener('keydown', close);
    return () => { window.removeEventListener('keydown', close); if (previousFocus?.isConnected) previousFocus.focus(); };
  }, []);
  return <div className="feature-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialogRef} className={`feature-dialog ${className}`} role="dialog" aria-modal="true" aria-label={title}>
      <header><h2>{title}</h2><button className="feature-icon-button" aria-label={`Fechar ${title}`} onClick={onClose}><X size={22} /></button></header>
      {children}
    </section>
  </div>;
}

export function CatalogUpdates({ tracks, unseenIds, onPlay, onMarkRead, onClose }) {
  return <FeatureDialog title="Novidades no catálogo" onClose={onClose}>
    <div className="feature-dialog-intro"><Bell size={20} /><p>Os itens publicados mais recentemente na sua biblioteca.</p><button className="text-button" onClick={onMarkRead}>Marcar como vistas</button></div>
    <div className="updates-list">{tracks.slice(0, 30).map(track => <button className="update-row" key={track.id} onClick={() => onPlay(track)}>
      <CollectionCover songs={[track]} kind="song" /><span><b>{track.title}</b><small>{track.artist} · {track.album}</small></span>
      {unseenIds.includes(track.id) && <i className="update-unread" aria-label="Novo no catálogo" />}<Play size={18} />
    </button>)}</div>
    {!tracks.length && <div className="collection-view-empty"><Check size={30} /><h3>Tudo em dia</h3><p>As próximas publicações do catálogo aparecerão aqui.</p></div>}
  </FeatureDialog>;
}

export function InstallDialog({ baseUrl = '', onClose }) {
  const [manifest, setManifest] = useState(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    fetch(`${baseUrl}/downloads/manifest.json`, { signal: controller.signal, cache: 'no-store' })
      .then(response => { if (!response.ok) throw new Error('Os instaladores ainda não estão disponíveis.'); return response.json(); })
      .then(result => {
        if (!/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(result.version || '') || !Array.isArray(result.files) || result.files.length !== 2
          || !['android', 'windows'].every(platform => result.files.some(file => file.platform === platform))
          || result.files.some(file => !Number.isSafeInteger(file.bytes) || file.bytes <= 0 || !/^[a-f\d]{64}$/i.test(file.sha256 || '')
            || file.name !== (file.platform === 'android' ? `Backstage-Music-${result.version}.apk` : `Backstage-Music-Setup-${result.version}.exe`))) throw new Error('Não foi possível consultar os instaladores.');
        setManifest(result);
      })
      .catch(cause => { if (!controller.signal.aborted) setError(cause.message || 'Confira a conexão e tente novamente.'); });
    return () => controller.abort();
  }, [baseUrl, attempt]);
  return <FeatureDialog title="Instalar Backstage Music" onClose={onClose}>
    <p>Leve seu catálogo para o celular ou computador. Entre com a mesma conta autorizada para acessar as músicas.</p>
    <DesktopUpdates />
    {!manifest && !error && <p role="status">Consultando instaladores…</p>}
    {error && <div role="alert"><p>{error}</p><button className="outline-button" onClick={() => setAttempt(value => value + 1)}>Tentar novamente</button></div>}
    <div className="installer-list">{manifest?.files.map(file => <a className="installer-option" href={`${baseUrl}/downloads/${encodeURIComponent(file.name)}`} download={file.name} key={file.name}>
      {file.platform === 'android' ? <Smartphone size={28} /> : <Monitor size={28} />}<span><b>{file.platform === 'android' ? 'Android' : 'Windows'}</b><small>Versão {manifest.version} · {(file.bytes / 1048576).toFixed(1)} MB</small></span><Download size={21} />
    </a>)}</div>
    {manifest && <p className="feature-note">Favoritos, playlists e downloads são guardados neste aparelho. Atualizar o aplicativo preserva os dados da instalação compatível.</p>}
  </FeatureDialog>;
}

function DesktopUpdates() {
  const [state, setState] = useState(null);
  useEffect(() => {
    const desktop = window.backstageDesktop;
    if (!desktop) return;
    let active = true;
    desktop.getUpdateState().then(value => { if (active) setState(value); }).catch(() => {});
    const unsubscribe = desktop.onUpdateState(value => { if (active) setState(value); });
    return () => { active = false; unsubscribe(); };
  }, []);
  if (!state) return null;
  const messages = { idle: 'Verifique se há uma nova versão.', checking: 'Verificando atualizações…', downloading: `Baixando atualização: ${state.percent || 0}%`, downloaded: `Versão ${state.nextVersion} pronta para instalar.`, current: 'Você já está na versão mais recente.', development: 'As atualizações funcionam na versão instalada.', error: state.message };
  return <div className="desktop-update-panel" role="status"><p>Windows · Versão {state.version}</p><p>{messages[state.status]}</p>
    <button className="outline-button" disabled={['checking', 'downloading'].includes(state.status)} onClick={() => {
      const action = state.status === 'downloaded' ? window.backstageDesktop.installUpdate : window.backstageDesktop.checkForUpdates;
      action().catch(() => setState(old => ({ ...old, status: 'error', message: 'Não foi possível verificar a atualização.' })));
    }}>{state.status === 'downloaded' ? 'Reiniciar e atualizar' : 'Verificar atualizações'}</button>
  </div>;
}

export function ShortcutHelp({ onClose }) {
  return <FeatureDialog title="Atalhos do teclado" onClose={onClose}>
    <p><Keyboard size={19} /> Use os atalhos enquanto navega pela sua biblioteca.</p>
    <dl className="shortcut-list">
      <div><dt>Buscar no catálogo</dt><dd>Ctrl + K / Ctrl + Shift + L</dd></div>
      <div><dt>Reproduzir ou pausar</dt><dd>Espaço</dd></div>
      <div><dt>Avançar ou voltar 5 segundos</dt><dd>→ / ←</dd></div>
      <div><dt>Próxima ou anterior</dt><dd>Ctrl + → / Ctrl + ←</dd></div>
      <div><dt>Fechar menus e janelas</dt><dd>Esc</dd></div>
    </dl>
  </FeatureDialog>;
}
