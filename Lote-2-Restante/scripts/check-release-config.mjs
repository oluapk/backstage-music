const required = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'];
if (process.argv.includes('--ci')) required.push('VERCEL_ORG_ID', 'VERCEL_PROJECT_ID', 'VERCEL_TOKEN', 'ANDROID_KEYSTORE_BASE64', 'ANDROID_KEYSTORE_PASSWORD', 'ANDROID_KEY_ALIAS', 'ANDROID_KEY_PASSWORD');
const missing = required.filter(name => !process.env[name]?.trim());
if (missing.length) throw new Error('Configure no GitHub os secrets/variables: ' + missing.join(', '));
const url = new URL(process.env.VITE_SUPABASE_URL);
if (url.protocol !== 'https:' || !url.hostname.endsWith('.supabase.co')) throw new Error('VITE_SUPABASE_URL deve ser a URL HTTPS do projeto Supabase.');
const key = process.env.VITE_SUPABASE_ANON_KEY;
let role;
try { role = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role; } catch {}
if (key.startsWith('sb_secret_') || role === 'service_role') throw new Error('Use somente uma chave pública do Supabase no build.');
console.log('Configuração de build verificada; valores sensíveis não foram exibidos.');
