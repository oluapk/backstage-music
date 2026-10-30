// Impede publicar um commit antigo se a branch avançou durante as compilações.
const { GITHUB_REPOSITORY: repository, GITHUB_SHA: sha, GITHUB_TOKEN: token } = process.env;
if (!/^[\w.-]+\/[\w.-]+$/.test(repository || '') || !/^[a-f\d]{40}$/i.test(sha || '') || !token) throw new Error('Contexto GitHub ausente.');
const response = await fetch(`https://api.github.com/repos/${repository}/commits/main`, {
  headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(30000),
});
if (!response.ok) throw new Error(`Não foi possível conferir a branch main: HTTP ${response.status}.`);
if ((await response.json()).sha !== sha) throw new Error('main recebeu outro commit durante o build. A execução mais recente publicará os instaladores.');
console.log('Commit corresponde ao estado atual da branch main.');
