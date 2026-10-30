import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { stageInstallers } from '../scripts/stage-installers.mjs';
import { publishInstallers } from '../scripts/publish-installers.mjs';
import { prepareVercel } from '../scripts/prepare-vercel.mjs';

test('fluxo de release gera manifesto e rejeita um binário modificado', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'backstage-installers-'));
  try {
    const apk = path.join(root, 'android/app/build/outputs/apk/debug');
    const win = path.join(root, 'artifacts/windows');
    await mkdir(apk, { recursive: true }); await mkdir(win, { recursive: true }); await mkdir(path.join(root, 'dist'));
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ version: '1.0.2' }));
    await writeFile(path.join(root, 'dist/index.html'), '<html></html>');
    await writeFile(path.join(apk, 'output-metadata.json'), JSON.stringify({ applicationId: 'com.backstage.music', elements: [{ outputFile: 'app-debug.apk', versionName: '1.0.1', versionCode: 2 }] }));
    await assert.rejects(stageInstallers(root, 'debug'), /recompilado/);
    await writeFile(path.join(apk, 'output-metadata.json'), JSON.stringify({ applicationId: 'com.backstage.music', elements: [{ outputFile: 'app-debug.apk', versionName: '1.0.2', versionCode: 3 }] }));
    await writeFile(path.join(apk, 'app-debug.apk'), 'APK fixture');
    await writeFile(path.join(win, 'Backstage-Music-Setup-1.0.2.exe'), 'EXE fixture');
    await writeFile(path.join(win, 'Backstage-Music-Setup-1.0.2.exe.blockmap'), 'blockmap fixture');
    await writeFile(path.join(win, 'latest.yml'), 'version: 1.0.2\npath: Backstage-Music-Setup-1.0.2.exe\n');
    const staged = await stageInstallers(root, 'debug');
    assert.equal(staged.files.length, 2);
    assert.equal(staged.updates.length, 2);
    await publishInstallers(root);
    const published = JSON.parse(await readFile(path.join(root, 'dist/downloads/manifest.json'), 'utf8'));
    assert.deepEqual(published, staged);
    assert.equal(published.androidVersionCode, 3);
    await prepareVercel(root);
    const config = JSON.parse(await readFile(path.join(root, '.vercel/output/config.json'), 'utf8'));
    const alias = config.routes.find(route => route.src.includes('Backstage-Music-latest'));
    assert.equal(alias.status, 307);
    assert.equal(alias.headers.Location, '/downloads/Backstage-Music-1.0.2.apk');
    assert.equal(alias.headers['Cache-Control'], 'no-store');
    const staticManifest = JSON.parse(await readFile(path.join(root, '.vercel/output/static/downloads/manifest.json'), 'utf8'));
    assert.deepEqual(staticManifest, staged);
    await writeFile(path.join(root, 'installers/Backstage-Music-1.0.2.apk'), 'APK tampered');
    await assert.rejects(publishInstallers(root), /não confere/);
  } finally {
    if (path.dirname(root) === os.tmpdir() && path.basename(root).startsWith('backstage-installers-')) await rm(root, { recursive: true, force: true });
  }
});
