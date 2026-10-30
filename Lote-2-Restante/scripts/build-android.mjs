import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const variant = process.env.ANDROID_BUILD_TYPE || 'debug';
if (!['debug', 'release'].includes(variant)) throw new Error('ANDROID_BUILD_TYPE deve ser debug ou release.');
if (variant === 'release') {
  const required = ['ANDROID_KEYSTORE_PATH', 'ANDROID_KEYSTORE_PASSWORD', 'ANDROID_KEY_ALIAS', 'ANDROID_KEY_PASSWORD'];
  if (required.some(name => !process.env[name]) || !existsSync(process.env.ANDROID_KEYSTORE_PATH)) {
    console.error('Configure a chave e as quatro variáveis ANDROID_KEYSTORE_* / ANDROID_KEY_* para gerar um APK release assinado.');
    process.exit(1);
  }
}
const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT
  || (process.platform === 'win32' && process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk') : '');
if (!sdk || !existsSync(sdk)) {
  console.error('Android SDK não encontrado. Defina ANDROID_HOME para a pasta do SDK instalada pelo Android Studio.');
  process.exit(1);
}
const result = spawnSync(process.platform === 'win32' ? 'gradlew.bat' : 'sh', [
  ...(process.platform === 'win32' ? [] : ['./gradlew']),
  variant === 'release' ? 'assembleRelease' : 'assembleDebug', '--no-daemon', '--console=plain',
], {
  cwd: path.join(root, 'android'), stdio: 'inherit', shell: process.platform === 'win32',
  env: { ...process.env, ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk }, windowsHide: true,
});
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;
