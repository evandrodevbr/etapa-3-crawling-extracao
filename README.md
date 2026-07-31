# Etapa 3 — Crawling / Extração (Node.js)

Esse é o projeto que fiz pra Etapa 3 de um processo seletivo. A proposta era simples de explicar
e um pouco chata de fazer direito: entrar numa página, ver quais arquivos estão listados lá,
baixar todos, juntar tudo num `.zip` só e deixar isso disponível pra download via API.

Desafio original: [Etapa-3-Crawling-Extração-Node.js-Arquitetura](https://github.com/Luis-Carlos-Moraes/Etapa-3-Crawling-Extra-o-Node.js-Arquitetura-).

## Rodando o projeto

Precisa de Node 20 ou mais novo.

```bash
npm install
npm run dev      # sobe com reload automático (tsx), bom pra mexer no código
# ou
npm run build && npm start   # compila pra dist/ e roda com Node puro, sem dependência de dev
```

Por padrão sobe em `http://localhost:3000`. Dá pra mudar isso (e outras coisas) por variável de
ambiente — tem uma tabela mais embaixo.

## Endpoints

Resumo rápido — request/response completo, todos os erros possíveis por rota e o formato de erro
padrão estão em [`docs/API.md`](docs/API.md).

| Método | Rota        | O que faz                                                          |
|--------|-------------|----------------------------------------------------------------------|
| GET    | `/health`   | Só pra saber se o serviço está de pé.                                |
| POST   | `/process`  | Roda o pipeline inteiro (extrai → baixa → unifica) e devolve um resumo. |
| GET    | `/download` | Devolve o `.zip` gerado na última vez que `/process` rodou com sucesso. |

Na prática:

```bash
curl -X POST http://localhost:3000/process
# {"filesFound":6,"filesDownloaded":6,"filesFailed":0,
#  "files":[{"name":"Arquivo documento145","code":"FT1","url":"http://omnissolucoes.com/teste3/FT1.pdf"}, ...],
#  "failures":[],"artifactPath":"./data/artifact.zip","artifactBytes":302907,"durationMs":590}

curl -OJ http://localhost:3000/download
```

O campo `files` é justamente o nome, código e URL completa de cada arquivo que a extração
encontrou na página — o desafio pede isso como informação a ser identificada, então deixei
visível na resposta em vez de só contar quantos deram certo.

Quando dá erro, a resposta sempre vem no formato `{ "error": "CODIGO", "message": "..." }`:

| Status | Acontece quando...                                                     |
|--------|---------------------------------------------------------------------------|
| 404    | Você chama `/download` antes de rodar `/process` alguma vez.             |
| 409    | Você chama `/process` enquanto outra execução ainda está rolando.        |
| 502    | A página alvo não respondeu direito (fora do ar, demorou demais, etc).   |
| 500    | Nenhum arquivo foi baixado, ou deu ruim ao montar o `.zip`.               |

Erro que eu não previ não vaza detalhe nenhum pro cliente — vira um `500` genérico e o motivo real
fica só no log do servidor. Não faz sentido devolver stack trace pra quem está chamando a API.

## Configuração

Tudo abaixo é opcional, mas se você colocar um valor inválido a aplicação nem sobe — prefiro
quebrar na inicialização a quebrar no meio de um request.

| Variável                    | Padrão                                | Pra que serve                         |
|-----------------------------|----------------------------------------|------------------------------------------|
| `TARGET_URL`                | `http://omnissolucoes.com/teste3/`     | Página que vai ser raspada.              |
| `HOST`                      | `0.0.0.0`                              | Interface onde o servidor escuta.        |
| `PORT`                      | `3000`                                 | Porta do servidor.                       |
| `DATA_DIR`                  | `./data`                               | Onde ficam os downloads e o zip final.   |
| `PAGE_FETCH_TIMEOUT_MS`     | `10000`                               | Timeout pra buscar a página alvo.        |
| `FILE_DOWNLOAD_TIMEOUT_MS`  | `20000`                               | Timeout por arquivo baixado.             |
| `DOWNLOAD_CONCURRENCY`      | `4`                                    | Quantos downloads rodam ao mesmo tempo.  |

## Como o código está organizado

```
src/
  index.ts     → sobe o servidor e cuida do shutdown
  server.ts     → servidor HTTP (nativo, sem framework): rotas, orquestra o pipeline, trata erro
  extract.ts     → busca a página, lê a listagem de arquivos, valida os links (anti-SSRF)
  download.ts     → baixa os arquivos com um limite de concorrência, isola falha por arquivo
  unify.ts         → junta tudo num .zip
  security.ts       → as duas funções de segurança (nome de arquivo seguro + anti-SSRF)
  errors.ts          → uma classe de erro só, com statusCode e um código pra identificar
  env.ts               → lê e valida as variáveis de ambiente antes de subir qualquer coisa
```

8 arquivos, uns 480 linhas ao todo. Cada um cuida de uma coisa só, sem interface nem fábrica por
trás — as funções são chamadas direto de onde precisam. Não faz sentido criar uma abstração pra
trocar uma implementação que nunca vai ser trocada.

### Por que não é maior que isso

Confesso que a primeira versão que fiz desse projeto ficou bem mais inchada: tinha interface e
fábrica pra cada camada, um logger próprio, um limitador de concorrência isolado num arquivo à
parte, seis tipos diferentes de erro, e o servidor rodava em cima de Fastify com plugin de helmet
e de rate limit. Reli tudo depois e percebi que estava resolvendo o problema de um sistema bem
maior do que esse — no fim das contas são 3 rotas baixando 6 PDFs, não precisa de tanta cerimônia.
Enxuguei pra essa versão: tirei o Fastify e os plugins (servidor HTTP nativo dá conta, e o rate
limit nem é essencial aqui), tirei as interfaces e fábricas (as funções já bastam), e juntei os
seis tipos de erro numa classe só com `statusCode` e `code`.

O que eu não toquei foi justamente o que evita dor de cabeça de verdade: a validação contra SSRF,
a proteção contra path traversal no nome dos arquivos, timeout em toda chamada de rede, um
download quebrado não travar os outros, e uma trava simples pra impedir duas execuções do
pipeline pisando uma na outra ao mesmo tempo.

### Segurança

O que mais me preocupava aqui era o SSRF: a página alvo entrega uma lista de links, e se eu
simplesmente baixasse tudo que vem lá, bastaria alguém alterar aquela página (ou eu apontar o
`TARGET_URL` pra algo comprometido) pra fazer meu servidor buscar qualquer URL, inclusive coisa
interna. Por isso todo link é conferido contra a mesma origem configurada antes de virar
download — se apontar pra outro domínio, é descartado e o resto continua normal.

O nome de cada arquivo também passa por uma sanitização antes de virar caminho no disco (só
letras, números e alguns símbolos), e depois o caminho final ainda é checado de novo pra garantir
que não escapou da pasta de downloads. É meio redundante de propósito: se uma das duas camadas
falhar por algum motivo que eu não previ, a outra ainda segura.

Fora isso, nenhum erro que eu não previ chega ao cliente com detalhe — vira um `500` genérico e o
motivo de verdade fica só no log do servidor. E as duas dependências de produção (`cheerio` e
`archiver`) estão em zero vulnerabilidades conhecidas (`npm audit --omit=dev`).

### Tratando erro de verdade

Toda chamada de rede tem timeout, tanto a busca da página quanto cada download individual. Um
arquivo que falha não derruba o resto — o download continua nos outros e o resumo final mostra
quem deu certo e quem não deu. Se todos os downloads falharem, o serviço não finge que deu certo
gerando um zip vazio; devolve erro na hora. E se duas chamadas de `/process` chegarem ao mesmo
tempo, a segunda recebe `409` de cara em vez de disputar a mesma pasta e o mesmo zip com a
primeira — já vi esse tipo de corrida dar problema chato de debugar depois.

## Testes

```bash
npm test          # roda tudo uma vez
npm run coverage  # com relatório de cobertura
```

54 testes cobrindo os pontos que realmente costumam quebrar numa integração dessas: HTML fora do
formato esperado, página alvo fora do ar ou lenta demais, link apontando pra outro domínio,
download que trava ou corta no meio, tentativa de escapar da pasta de destino, zip vazio,
variável de ambiente mal configurada, chamadas concorrentes ao pipeline. Onde o teste mexe com
arquivo de verdade, uso pasta temporária real em vez de mockar o `fs` — fica mais próximo do que
acontece de fato.
