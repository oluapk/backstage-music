import { cp, lstat, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const defaultRoot = fileURLToPath(new URL('../', import.meta.url));
export function releaseRoutes(version) {
  if (!/^\d+\.\d+\.\d+$/.test(version || '')) throw new Error('Versão de publicação inválida.');
  return [
    { src: '/downloads/Backstage-Music-latest[.]apk', status: 307, headers: { Location: `/downloads/Backstage-Music-${version}.apk`, 'Cache-Control': 'no-store' } },
    { src: '/downloads/Backstage-Music-Setup-latest[.]exe', status: 307, headers: { Location: `/downloads/Backstage-Music-Setup-${version}.exe`, 'Cache-Control': 'no-store' } },
    { src: '/downloads/(manifest[.]json|latest[.]yml)', headers: { 'Cache-Control': 'no-store' }, continue: true },
    { handle: 'filesystem' },
    { src: '/.*', dest: '/index.html' },
  ];
}
export async function prepareVercel(projectRoot = defaultRoot) {
  const root = await realpath(projectRoot);
  const manifest = JSON.parse(await readFile(path.join(root, 'dist/downloads/manifest.json'), 'utf8'));
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  if (manifest.version !== pkg.version) throw new Error('Compile e prepare os instaladores da versão atual antes de publicar.');
  const routes = releaseRoutes(manifest.version);
  // A remoção se limita ao diretório gerado; recusa links que saiam do projeto.
  const output = path.join(root, '.vercel', 'output');
  await mkdir(output, { recursive: true });
  if (await realpath(output) !== output) throw new Error('Diretório de publicação não pode ser um link.');
  const destination = path.resolve(output, 'static');
  if (path.dirname(destination) !== output || !destination.startsWith(root + path.sep)) throw new Error('Destino fora do projeto.');
  const existing = await lstat(destination).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (existing?.isSymbolicLink()) throw new Error('Diretório estático não pode ser um link.');
  if (existing) await rm(destination, { recursive: true });
  await cp(path.join(root, 'dist'), destination, { recursive: true, dereference: false });
  await writeFile(path.join(output, 'config.json'), JSON.stringify({ version: 3, routes }, null, 2) + '\n');
  return manifest;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  prepareVercel().then(manifest => console.log(`Site, instaladores ${manifest.version} e links fixos preparados em .vercel/output/.`))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
