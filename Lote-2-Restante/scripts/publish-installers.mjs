import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const defaultRoot = fileURLToPath(new URL('../', import.meta.url));

function inside(root, ...parts) {
  const target = path.resolve(root, ...parts);
  const relative = path.relative(root, target);
  if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
    throw new Error('O caminho do instalador está fora do projeto.');
  }
  return target;
}

async function hashFile(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function checkOutputFile(file) {
  try {
    const existing = await lstat(file);
    if (!existing.isFile() || existing.isSymbolicLink()) throw new Error('O destino do instalador deve ser um arquivo do build.');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

export async function publishInstallers(projectRoot = defaultRoot) {
  const root = await realpath(path.resolve(projectRoot));
  const packageJson = JSON.parse(await readFile(inside(root, 'package.json'), 'utf8'));
  const version = packageJson.version;
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(version)) {
    throw new Error('A versão em package.json não é válida para os instaladores.');
  }
  const source = inside(root, 'installers');
  try { inside(root, path.relative(root, await realpath(source))); }
  catch (error) {
    if (error.code === 'ENOENT') throw new Error('Instaladores ainda não preparados. Execute npm run release:local para gerar APK, EXE e manifesto. Para compilar apenas a interface, use npm run build.');
    throw error;
  }
  const manifest = JSON.parse(await readFile(path.join(source, 'manifest.json'), 'utf8'));
  if (manifest.version !== version || !Array.isArray(manifest.files) || manifest.files.length !== 2) {
    throw new Error(`Prepare os dois instaladores da versão ${version} antes de publicar o site.`);
  }
  const expectedNames = {
    android: `Backstage-Music-${version}.apk`,
    windows: `Backstage-Music-Setup-${version}.exe`,
  };
  const platforms = new Set();
  const files = [];
  for (const item of manifest.files) {
    if (!item || !Object.hasOwn(expectedNames, item.platform) || platforms.has(item.platform) || expectedNames[item.platform] !== item.name
      || !Number.isSafeInteger(item.bytes) || item.bytes <= 0
      || typeof item.sha256 !== 'string' || !/^[a-f\d]{64}$/i.test(item.sha256)) {
      throw new Error('O manifesto dos instaladores contém uma entrada inválida.');
    }
    platforms.add(item.platform);
    const filePath = inside(source, item.name);
    const file = await lstat(filePath);
    inside(root, path.relative(root, await realpath(filePath)));
    if (!file.isFile() || file.size !== item.bytes || await hashFile(filePath) !== item.sha256.toLowerCase()) {
      throw new Error(`O tamanho ou hash do instalador não confere: ${item.name}`);
    }
    files.push({ platform: item.platform, name: item.name, bytes: file.size, sha256: item.sha256.toLowerCase() });
  }
  const expectedUpdates = new Set(['latest.yml', `${expectedNames.windows}.blockmap`]);
  const updates = [];
  if (!Array.isArray(manifest.updates) || manifest.updates.length !== 2) throw new Error('Prepare também os arquivos de atualização com npm run stage:installers.');
  for (const item of manifest.updates) {
    if (!item || !expectedUpdates.delete(item.name) || !Number.isSafeInteger(item.bytes) || item.bytes <= 0 || !/^[a-f\d]{64}$/i.test(item.sha256 || '')) throw new Error('Metadados de atualização inválidos.');
    const sourcePath = inside(source, item.name);
    inside(root, path.relative(root, await realpath(sourcePath)));
    const file = await lstat(sourcePath);
    if (!file.isFile() || file.size !== item.bytes || await hashFile(sourcePath) !== item.sha256.toLowerCase()) throw new Error(`Arquivo de atualização não confere: ${item.name}`);
    updates.push(item);
  }
  const dist = inside(root, 'dist');
  inside(root, path.relative(root, await realpath(dist)));
  if (!(await lstat(path.join(dist, 'index.html'))).isFile()) throw new Error('Gere o build web antes de preparar os downloads.');
  const destination = inside(dist, 'downloads');
  await mkdir(destination, { recursive: true });
  const directory = await lstat(destination);
  if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error('A pasta de downloads precisa ser um diretório do build.');
  for (const item of [...files, ...updates]) {
    const output = inside(destination, item.name);
    await checkOutputFile(output);
    await copyFile(inside(source, item.name), output);
  }
  const publishedManifest = { version, files, updates,
    ...(Number.isSafeInteger(manifest.androidVersionCode) && manifest.androidVersionCode > 0 ? { androidVersionCode: manifest.androidVersionCode } : {}),
    ...(/^[a-f\d]{40}$/i.test(manifest.commit || '') ? { commit: manifest.commit } : {}) };
  await checkOutputFile(path.join(destination, 'manifest.json'));
  await writeFile(path.join(destination, 'manifest.json'), `${JSON.stringify(publishedManifest, null, 2)}\n`, 'utf8');
  return publishedManifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  publishInstallers().then(manifest => {
    console.log(`Downloads ${manifest.version} verificados e copiados para dist/downloads/.`);
  }).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
