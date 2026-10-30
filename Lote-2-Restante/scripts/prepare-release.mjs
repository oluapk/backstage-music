import { readFile, writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const rootDirectory = fileURLToPath(new URL('../', import.meta.url));
export const releaseBaseUrl = 'https://backstage-music.vercel.app';
export function parseVersion(version) {
  if (!/^\d+\.\d+\.\d+$/.test(version || '')) throw new Error('Use uma versão estável no formato X.Y.Z.');
  const parts = version.split('.').map(Number);
  if (parts.some(part => !Number.isSafeInteger(part) || part > 65535)) throw new Error('A versão excede os limites do Windows.');
  return parts;
}
export function compareVersions(left, right) {
  const a = parseVersion(left), b = parseVersion(right);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}
export function nextVersion(version) {
  const values = parseVersion(version);
  for (let i = 2; i >= 0; i--) {
    if (values[i] < 65535) { values[i]++; return values.join('.'); }
    values[i] = 0;
  }
  throw new Error('Não foi possível incrementar a versão.');
}
export async function fetchPublishedManifest(baseUrl = releaseBaseUrl) {
  const response = await fetch(`${baseUrl}/downloads/manifest.json`, { cache: 'no-store', signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Não foi possível consultar a última versão publicada (HTTP ${response.status}).`);
  const manifest = await response.json();
  parseVersion(manifest.version);
  if (!Array.isArray(manifest.files) || manifest.files.length !== 2) throw new Error('Manifesto publicado inválido.');
  if (manifest.androidVersionCode != null && (!Number.isSafeInteger(manifest.androidVersionCode) || manifest.androidVersionCode < 1 || manifest.androidVersionCode > 2100000000)) throw new Error('versionCode publicado inválido.');
  return manifest;
}
export async function prepareRelease(root = rootDirectory, { version, versionCode, published } = {}) {
  const packageFile = path.join(root, 'package.json'), lockFile = path.join(root, 'package-lock.json');
  const gradleFile = path.join(root, 'android/app/build.gradle');
  const pkg = JSON.parse(await readFile(packageFile, 'utf8'));
  const lock = JSON.parse(await readFile(lockFile, 'utf8'));
  let gradle = await readFile(gradleFile, 'utf8');
  const currentCode = Number(gradle.match(/\bversionCode\s+(\d+)/)?.[1]);
  if (!Number.isSafeInteger(currentCode) || currentCode < 1) throw new Error('versionCode Android inválido.');
  if (!version) {
    published ??= await fetchPublishedManifest();
    const newest = compareVersions(pkg.version, published.version) >= 0 ? pkg.version : published.version;
    version = nextVersion(newest);
    versionCode = Math.max(currentCode, published.androidVersionCode || 0) + 1;
  }
  parseVersion(version);
  if (compareVersions(version, pkg.version) < 0) throw new Error('A versão solicitada é anterior à versão local.');
  if (!Number.isSafeInteger(versionCode) || versionCode < currentCode || versionCode > 2100000000) throw new Error('versionCode Android inválido ou anterior ao código local.');
  pkg.version = version;
  lock.version = version;
  if (lock.packages?.['']) lock.packages[''].version = version;
  gradle = gradle.replace(/\bversionCode\s+\d+/, `versionCode ${versionCode}`)
    .replace(/\bversionName\s+"[^"]+"/, `versionName "${version}"`);
  await writeFile(packageFile, JSON.stringify(pkg, null, 2) + '\n');
  await writeFile(lockFile, JSON.stringify(lock, null, 2) + '\n');
  await writeFile(gradleFile, gradle);
  return { version, versionCode };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const value = flag => process.argv[process.argv.indexOf(flag) + 1];
    const explicit = process.argv.includes('--version');
    const result = await prepareRelease(rootDirectory, explicit ? { version: value('--version'), versionCode: Number(value('--code')) } : {});
    if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `version=${result.version}\nversion_code=${result.versionCode}\n`);
    console.log(`Versão ${result.version}, Android versionCode ${result.versionCode}.`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
