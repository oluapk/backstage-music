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
    if (!existing.isFile() || existing.isSymbolicLink()) throw new Error('O destino do instalador deve ser um arquivo do projeto.');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

export async function stageInstallers(projectRoot = defaultRoot, variant = process.env.ANDROID_BUILD_TYPE || 'debug') {
  const root = await realpath(path.resolve(projectRoot));
  const packageJson = JSON.parse(await readFile(inside(root, 'package.json'), 'utf8'));
  const version = packageJson.version;
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(version)) {
    throw new Error('A versão em package.json não é válida para os instaladores.');
  }
  if (!['debug', 'release'].includes(variant)) throw new Error('Variante Android inválida.');
  const apkName = `app-${variant}.apk`;
  const apkDirectory = inside(root, 'android', 'app', 'build', 'outputs', 'apk', variant);
  let metadata;
  try { metadata = JSON.parse(await readFile(path.join(apkDirectory, 'output-metadata.json'), 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') throw new Error('APK não encontrado. Execute npm run build:apk antes de npm run stage:installers.');
    throw error;
  }
  if (metadata.applicationId !== 'com.backstage.music'
    || !metadata.elements?.some(element => element.outputFile === apkName && element.versionName === version && Number.isSafeInteger(element.versionCode) && element.versionCode > 0)) {
    throw new Error(`O APK precisa ser recompilado para a versão ${version}. Execute npm run build:apk.`);
  }
  const inputs = [
    { platform: 'android', name: `Backstage-Music-${version}.apk`, source: path.join(apkDirectory, apkName) },
    { platform: 'windows', name: `Backstage-Music-Setup-${version}.exe`, source: inside(root, 'artifacts', 'windows', `Backstage-Music-Setup-${version}.exe`) },
  ];
  for (const input of inputs) {
    const file = await lstat(input.source).catch(error => {
      if (error.code === 'ENOENT') throw new Error(`Instalador ${input.platform} ausente. Execute npm run ${input.platform === 'windows' ? 'dist:win' : 'build:apk'}.`);
      throw error;
    });
    if (!file.isFile() || !file.size) throw new Error(`Instalador ausente ou vazio: ${input.name}`);
    inside(root, path.relative(root, await realpath(input.source)));
  }
  const destination = inside(root, 'installers');
  await mkdir(destination, { recursive: true });
  const directory = await lstat(destination);
  if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error('A pasta installers deve ser um diretório do projeto.');
  const files = [];
  for (const input of inputs) {
    const output = inside(destination, input.name);
    await checkOutputFile(output);
    await copyFile(input.source, output);
    const file = await lstat(output);
    files.push({ platform: input.platform, name: input.name, bytes: file.size, sha256: await hashFile(output) });
  }
  const updates = [];
  const windowsName = `Backstage-Music-Setup-${version}.exe`;
  for (const name of ['latest.yml', `${windowsName}.blockmap`]) {
    const source = inside(root, 'artifacts', 'windows', name);
    const file = await lstat(source);
    if (!file.isFile() || !file.size) throw new Error('Metadados de atualização ausentes. Execute npm run dist:win.');
    if (name === 'latest.yml') {
      const body = await readFile(source, 'utf8');
      if (!body.includes(`version: ${version}\n`) || !body.includes(windowsName)) throw new Error('latest.yml não corresponde à versão atual. Recompile o Windows.');
    }
    const output = inside(destination, name);
    await checkOutputFile(output);
    await copyFile(source, output);
    updates.push({ name, bytes: file.size, sha256: await hashFile(output) });
  }
  const androidVersionCode = metadata.elements.find(element => element.outputFile === apkName).versionCode;
  const manifest = { version, androidVersionCode, files, updates,
    ...(process.env.GITHUB_SHA && /^[a-f\d]{40}$/i.test(process.env.GITHUB_SHA) ? { commit: process.env.GITHUB_SHA } : {}) };
  await checkOutputFile(path.join(destination, 'manifest.json'));
  await writeFile(path.join(destination, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  stageInstallers().then(manifest => {
    console.log(`Instaladores ${manifest.version} preparados em installers/ com hashes SHA-256.`);
  }).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
