# Backstage Music: regras de entrega

## Instaladores acompanham alterações de código

Por solicitação explícita do usuário, toda alteração no código, interface, configuração de build ou funcionalidades do aplicativo deve incluir a geração de novos instaladores Windows (.exe) e Android (.apk).

1. Execute os testes apropriados.
2. Use `npm.cmd run release:next` no PowerShell para incrementar/sincronizar a versão, compilar ambas as plataformas, preparar os downloads e o pacote Vercel. Em outros shells, use `npm run release:next`.
3. Quando a publicação estiver autorizada, use `npm.cmd run deploy:release` e confirme os links públicos com `npm.cmd run verify:release`.
4. A resposta final de alterações de código deve conter os links verificados e os comandos de build/publicação acima. Se algo falhar, informe precisamente o que foi gerado, o que está publicado e o impedimento; não afirme que instaladores foram atualizados sem conferi-los.
5. Preserve applicationId/appId e a chave Android existente. Não publique APK com assinatura diferente da versão distribuída sem explicar a incompatibilidade e obter a decisão do usuário.
6. Nunca inclua tokens, keystores, senhas ou chaves administrativas nos arquivos distribuídos ou no Git. O pipeline só publica após as duas compilações e os testes passarem.

`npm run build` continua sendo apenas o build Vite. Não copie APK/EXE para os bundles nativos: os downloads só entram em `build:web`, após as compilações.
