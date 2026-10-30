import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { releaseBaseUrl } from './prepare-release.mjs';

export async function verifyRelease(baseUrl = releaseBaseUrl, projectRoot = fileURLToPath(new URL('../', import.meta.url))) {
  const expected = JSON.parse(await readFile(path.join(projectRoot, 'installers/manifest.json'), 'utf8'));
  const response = await fetch(`${baseUrl}/downloads/manifest.json`, { cache: 'no-store', signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`Manifesto indisponível: HTTP ${response.status}.`);
  const published = await response.json();
  if (published.version !== expected.version || published.androidVersionCode !== expected.androidVersionCode) throw new Error('A versão publicada não corresponde à compilação atual.');
  for (const item of [...expected.files, ...expected.updates]) {
    const result = await fetch(`${baseUrl}/downloads/${encodeURIComponent(item.name)}`, { cache: 'no-store', signal: AbortSignal.timeout(180000) });
    if (!result.ok) throw new Error(`Download indisponível: ${item.name}, HTTP ${result.status}.`);
    const hash = createHash('sha256'); let bytes = 0;
    for await (const chunk of result.body) { hash.update(chunk); bytes += chunk.length; }
    if (bytes !== item.bytes || hash.digest('hex') !== item.sha256) throw new Error(`Integridade inválida: ${item.name}.`);
    console.log(`OK: ${item.name}`);
  }
  for (const file of expected.files) {
    const alias = file.platform === 'android' ? 'Backstage-Music-latest.apk' : 'Backstage-Music-Setup-latest.exe';
    const result = await fetch(`${baseUrl}/downloads/${alias}`, { redirect: 'manual', signal: AbortSignal.timeout(30000) });
    const location = new URL(result.headers.get('location') || '/', baseUrl);
    if (result.status !== 307 || location.pathname !== `/downloads/${file.name}` || !result.headers.get('cache-control')?.includes('no-store')) throw new Error(`Link fixo incorreto: ${alias}.`);
  }
  console.log(`Versão ${published.version} publicada e downloads verificados.`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  verifyRelease().catch(error => { console.error(error.message); process.exitCode = 1; });
}
