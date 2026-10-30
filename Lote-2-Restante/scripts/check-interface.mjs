// Integração com Edge real; Supabase é substituído somente no servidor de teste.
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('../', import.meta.url));
const profile = await mkdtemp(path.join(os.tmpdir(), 'backstage-check-'));
let server, browser, socket;
let networkError = false;
const audio = Buffer.alloc(44 + 8000 * 2 * 120);
audio.write('RIFF'); audio.writeUInt32LE(audio.length - 8, 4); audio.write('WAVEfmt ', 8);
audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22);
audio.writeUInt32LE(8000, 24); audio.writeUInt32LE(16000, 28); audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34);
audio.write('data', 36); audio.writeUInt32LE(audio.length - 44, 40);
const tracks = Array.from({ length: 12 }, (_, i) => ({ id: String(i), title: i === 0 ? 'Coração Azul' : `Faixa ${i}`, artist: i < 6 ? 'João' : 'Lia', album: `Álbum ${i % 3}`, object_path: `${i}.wav`, cover_path: null, content_type: i === 10 ? 'podcast' : i === 11 ? 'audiobook' : 'music', duration_seconds: 120, created_at: '2026-10-30T00:00:00Z', license: 'Teste' }));
const mockModule = `
  const session = { user: { id: 'preview-family', email: 'familia@example.test', user_metadata: {} } };
  export function createClient() { return {
    auth: { getSession: async () => ({ data: { session } }), onAuthStateChange: callback => ({ data: { subscription: { unsubscribe() {} } } }), signOut: async () => ({ error: null }) },
    from(table) {
      const chain = new Proxy({}, { get(_target, key) {
        if (key === 'then') return (resolve, reject) => (table === 'tracks' ? fetch('/__tracks').then(r => { if (!r.ok) throw new TypeError('offline'); return r.json(); }) : Promise.resolve({ data: [], error: null, count: 0 })).then(resolve, reject);
        return () => chain;
      } }); return chain;
    },
    storage: { from: () => ({ getPublicUrl: () => ({ data: { publicUrl: location.origin + '/__audio.wav' } }), createSignedUrl: async () => ({ data: { signedUrl: location.origin + '/__audio.wav' }, error: null }) }) }
  }; }
`;
try {
  server = await createServer({ root, configFile: false, envDir: profile, server: { host: '127.0.0.1', port: 5187, strictPort: true },
    define: { 'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('https://preview.supabase.co'), 'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('preview-key'), 'import.meta.env.VITE_SUPABASE_STORAGE_PUBLIC': JSON.stringify('false') },
    plugins: [{ name: 'preview-data', enforce: 'pre', resolveId(id) { if (id === '/__preview_supabase.js') return id; }, load(id) { if (id === '/__preview_supabase.js') return mockModule; }, transform(code, id) { if (id.replaceAll('\\', '/').endsWith('/src/App.jsx')) return code.replace("from '@supabase/supabase-js'", "from '/__preview_supabase.js'"); },
      configureServer(vite) { vite.middlewares.use((req, res, next) => {
        if (req.url === '/__tracks') { res.statusCode = networkError ? 503 : 200; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ data: tracks, error: null })); }
        else if (req.url?.startsWith('/__audio.wav')) { res.setHeader('Content-Type', 'audio/wav'); res.end(audio); }
        else if (req.url === '/downloads/manifest.json') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ version: '1.0.2', files: [{ platform: 'android', name: 'Backstage-Music-1.0.2.apk', bytes: 10, sha256: 'a'.repeat(64) }, { platform: 'windows', name: 'Backstage-Music-Setup-1.0.2.exe', bytes: 20, sha256: 'b'.repeat(64) }] })); }
        else next();
      }); }
    }, react()],
  });
  await server.listen();
  browser = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=9334', '--autoplay-policy=no-user-gesture-required', `--user-data-dir=${profile}`, 'http://127.0.0.1:5187'], { windowsHide: true, stdio: 'ignore' });
  browser.on('error', error => console.error(error.message));
  let tab;
  for (let i = 0; i < 100 && !tab; i++) {
    try { tab = (await (await fetch('http://127.0.0.1:9334/json')).json()).find(item => item.type === 'page' && item.url.includes('5187')); } catch {}
    if (!tab) await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(tab, 'Edge deve iniciar');
  socket = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let nextId = 0;
  const pending = new Map(), exceptions = [];
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails.text);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id); pending.delete(message.id);
      if (message.error) reject(new Error(JSON.stringify(message.error))); else resolve(message.result);
    }
  };
  const cdp = (method, params = {}) => new Promise((resolve, reject) => { const id = ++nextId; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
  const evaluate = async expression => { const value = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (value.exceptionDetails) throw new Error(JSON.stringify(value.exceptionDetails)); return value.result.value; };
  const until = async (expression, label) => { for (let i = 0; i < 100; i++) { if (await evaluate(`Boolean(${expression})`)) return; await new Promise(resolve => setTimeout(resolve, 100)); } throw new Error(label || expression); };
  const click = expression => evaluate(`(${expression}).click()`);
  const search = value => evaluate(`(() => { const input = document.querySelector('#search'); input.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)}); input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await cdp('Runtime.enable');
  await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await until("document.querySelector('.shelf-card')", 'catálogo deve carregar');
  await evaluate(`(() => {
    const key = value => 'backstage-profile:preview-family:' + value;
    localStorage.setItem(key('favorites'), JSON.stringify(['supabase-0']));
    localStorage.setItem(key('saved-artists'), JSON.stringify(['João', 'Artista sem faixas']));
    localStorage.setItem(key('playlists'), JSON.stringify([
      { id: 'manual', ownerId: 'preview-family', source: 'user', name: 'Escolhidas por mim', songIds: ['supabase-0'] },
      { id: 'legacy', name: 'Minha playlist antiga', songIds: [] },
      { id: 'automatic', source: 'system', name: 'Playlist automática proibida', songIds: ['supabase-1'] },
      { id: 'foreign', ownerId: 'outra-conta', source: 'user', name: 'Playlist de outra conta', songIds: [] }
    ]));
    localStorage.setItem(key('recently-played'), JSON.stringify(['supabase-8']));
    localStorage.setItem(key('listening-data'), JSON.stringify({ pinnedCollections: ['album:' + JSON.stringify(['Álbum 2', 'Lia']), 'artist:Lia', 'favorites'] }));
  })()`);
  await cdp('Page.reload', { ignoreCache: true });
  await until("document.querySelector('.shelf-card')", 'catálogo deve restaurar');
  await click("document.querySelector('.library-heading button')");
  await until("document.querySelector('.collection-browser')", 'biblioteca deve abrir');
  assert.deepEqual(await evaluate("[...document.querySelectorAll('.collection-filter-bar button')].map(el => el.textContent)"), ['Playlists', 'Artistas']);
  assert.deepEqual(await evaluate("[...document.querySelectorAll('.library-collection-item')].map(el => el.dataset.collectionKey)"), ['favorites', 'playlist:manual', 'playlist:legacy']);
  assert.equal(await evaluate("[...document.querySelectorAll('.sidebar .collection')].some(el => /Catálogo|episódios|Lia/.test(el.textContent))"), false, 'sidebar não inclui catálogo, episódios nem artista apenas fixado');
  await click("[...document.querySelectorAll('.collection-filter-bar button')].find(el => el.textContent === 'Artistas')");
  await until("document.querySelector('[data-collection-key=\"artist:João\"]')", 'artistas seguidos devem aparecer');
  assert.deepEqual(await evaluate("[...document.querySelectorAll('.library-collection-item')].map(el => el.dataset.collectionKey).sort()"), ['artist:Artista sem faixas', 'artist:João', 'favorites'].sort());
  await click("document.querySelector('[aria-label=\"Buscar na biblioteca\"]')");
  await evaluate(`(() => { const input=document.querySelector('.collection-search input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Lia'); input.dispatchEvent(new Event('input',{bubbles:true})); })()`);
  await until("document.querySelectorAll('.library-collection-item').length === 0", 'busca interna não pode incluir artista não seguido');
  await click("document.querySelector('[aria-label=\"Fechar busca na biblioteca\"]')");
  await click("document.querySelector('[data-collection-key=\"artist:Artista sem faixas\"] .library-context-trigger')");
  await click("[...document.querySelectorAll('[role=menuitem]')].find(el => el.textContent.includes('Deixar de seguir'))");
  await until("!document.querySelector('[data-collection-key=\"artist:Artista sem faixas\"]')", 'deixar de seguir deve remover da biblioteca');
  await evaluate("window.prompt = () => 'Minha nova playlist'; window.confirm = () => true;");
  await click("document.querySelector('.collection-browser [aria-label=\"Criar playlist\"]')");
  await until("document.querySelector('.library-collection-list')?.textContent.includes('Minha nova playlist')", 'playlist criada deve aparecer');
  assert.equal(await evaluate("JSON.parse(localStorage.getItem('backstage-profile:preview-family:playlists')).some(p => p.name === 'Minha nova playlist' && p.source === 'user' && p.ownerId === 'preview-family')"), true);
  const output = path.join(root, 'artifacts', 'functional-review'); await mkdir(output, { recursive: true });
  await writeFile(path.join(output, 'library-desktop.png'), Buffer.from((await cdp('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 900, deviceScaleFactor: 1, mobile: true });
  await writeFile(path.join(output, 'library-mobile.png'), Buffer.from((await cdp('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await search('coracao joao');
  await until("document.querySelectorAll('.track-row').length === 1 && document.querySelector('.search-suggestion')?.textContent.includes('Coração Azul')", 'busca sem acentos deve funcionar');
  await click("document.querySelector('.search-suggestion')");
  await until("document.querySelector('audio')?.currentTime > 0", 'áudio deve tocar');
  await search('');
  await click("[...document.querySelectorAll('.sidebar-shortcuts button')].find(el => el.textContent.includes('Meu catálogo'))");
  await until("document.querySelectorAll('.online-track-card').length === 12 && document.querySelector('.catalog-play-button.is-playing')", 'catálogo único e indicação ativa');
  await click("document.querySelector('.online-track-card .catalog-play-button')");
  await until("!document.querySelector('.catalog-play-button.is-playing')", 'pausa deve atualizar animação');
  await click("document.querySelector('.online-track-card button[title=\"Baixar para ouvir offline\"]')");
  await until("document.querySelector('.online-track-card button[title=\"Remover download offline\"]')", 'download deve salvar');
  assert.equal(await evaluate("document.querySelectorAll('.online-track-card').length"), 12, 'download não duplica a faixa');
  const snapshot = await evaluate(`new Promise((resolve, reject) => { const request = indexedDB.open('backstage-music-library', 3); request.onsuccess = () => { const db = request.result; const tx = db.transaction(['catalog-snapshots','offline-tracks']); const catalog = tx.objectStore('catalog-snapshots').getAll(); const offline = tx.objectStore('offline-tracks').getAll(); tx.oncomplete = () => { resolve({ count: catalog.result[0].tracks.length, offline: offline.result.length, privateLinks: JSON.stringify(catalog.result).includes('signedUrl') }); db.close(); }; }; request.onerror = reject; })`);
  assert.deepEqual(snapshot, { count: 12, offline: 1, privateLinks: false });
  await click("document.querySelector('.topbar-install')");
  await until("document.querySelectorAll('.installer-option').length === 2", 'links de instalação devem existir');
  await click("document.querySelector('[aria-label=\"Fechar Instalar Backstage Music\"]')");
  await writeFile(path.join(output, 'desktop.png'), Buffer.from((await cdp('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  for (const width of [320, 390, 700, 1024, 1440]) {
    await cdp('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 700 });
    await new Promise(resolve => setTimeout(resolve, 120));
    assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), `sem rolagem horizontal em ${width}px`);
    if (width === 390) await writeFile(path.join(output, 'mobile.png'), Buffer.from((await cdp('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  }
  networkError = true;
  await cdp('Page.reload', { ignoreCache: true });
  await until("document.body.textContent.includes('Exibindo o índice salvo') && document.querySelector('.shelf-card')", 'metadados devem sobreviver ao reinício sem rede');
  await search('faixa 1');
  await until("document.querySelector('.track-row')", 'faixa privada deve continuar pesquisável');
  await click("document.querySelector('.track-row .catalog-play-button')");
  await click("document.querySelector('.track-row .catalog-play-button')");
  assert.equal(await evaluate("document.querySelectorAll('.track-row .catalog-play-button.is-playing').length"), 0, 'faixa privada sem download não indica reprodução');
  await click("document.querySelector('.track-row button[title=\"Baixar para ouvir offline\"]')");
  await until("document.body.textContent.includes('antes de baixar esta faixa')", 'download privado exige atualizar a fonte');
  await search('coracao');
  await until("document.querySelectorAll('.track-row').length === 1", 'busca deve funcionar com índice salvo');
  await click("document.querySelector('.track-row .catalog-play-button')");
  await until("document.querySelector('audio')?.currentTime > 0 && document.querySelector('audio')?.src.startsWith('blob:')", 'download deve tocar após reiniciar');
  assert.deepEqual(exceptions, [], 'sem exceções de runtime');
  console.log('OK: biblioteca pessoal, isolamento por conta, artistas seguidos, criação de playlist, busca, reprodução, animação, download sem duplicação, cache após reinício, instaladores e layouts 320–1440px.');
  console.log('Capturas: artifacts/functional-review/desktop.png e mobile.png');
} finally {
  socket?.close(); browser?.kill(); await server?.close();
  await new Promise(resolve => setTimeout(resolve, 600));
  if (path.dirname(profile) === os.tmpdir() && path.basename(profile).startsWith('backstage-check-')) await rm(profile, { recursive: true, force: true, maxRetries: 5 }).catch(() => {});
}
