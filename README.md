# Etapa 3: Crawling / Extração (Node.js)

**Serviço HTTP que lê a listagem de arquivos de uma página alvo, baixa todos em paralelo e devolve o resultado em um único `.zip` por `GET /download`.**

![Node](https://img.shields.io/badge/Node-%3E%3D20-5FA04E?logo=nodedotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)
![Vitest](https://img.shields.io/badge/Vitest-4-6E9F18?logo=vitest&logoColor=white)
![cheerio](https://img.shields.io/badge/cheerio-1.2-E88C1C)
![archiver](https://img.shields.io/badge/archiver-8.0-1F6FEB)

## Sobre

Projeto da Etapa 3 de um processo seletivo. O desafio era: entrar em uma página que lista arquivos,
identificar cada um, baixar todos e entregar tudo junto em um `.zip` disponível por HTTP.

Na prática o serviço faz três coisas por chamada: extrai a listagem da página alvo, baixa os arquivos
com concorrência limitada e unifica o que deu certo em um artefato `.zip`. Quem chama decide quando
rodar e depois baixa o resultado; não há interface gráfica nem agendamento.

Desafio original: [Luis-Carlos-Moraes/Etapa-3-Crawling-Extração-Node.js-Arquitetura](https://github.com/Luis-Carlos-Moraes/Etapa-3-Crawling-Extra-o-Node.js-Arquitetura-).

## Como funciona

```
POST /process
  │
  ├─ 1. extract.ts    GET TARGET_URL e parse do <ul><li> com cheerio
  │                   (rótulo "CODIGO - nome" + <a href="..." codigo="...">)
  │                   cada link é validado contra a mesma origem do alvo (anti-SSRF)
  │                   e o nome do arquivo passa por sanitização (anti path traversal)
  │
  ├─ 2. download.ts   baixa cada arquivo com concorrência limitada (DOWNLOAD_CONCURRENCY)
  │                   timeout por arquivo; falha de um arquivo não derruba os outros
  │
  └─ 3. unify.ts      junta os arquivos baixados em DATA_DIR/artifact.zip (archiver)

GET /health    → { "status": "ok" }
GET /download  → devolve o .zip gerado na última execução bem-sucedida de /process
GET /          → 302 para /health, para a raiz não responder 404
```

Decisões que valem registro:

- **Uma execução por vez.** Se um `/process` chega enquanto outro está rodando, o segundo responde `409` na hora, em vez de disputar a mesma pasta de download e o mesmo `.zip`.
- **O guard anti-SSRF compara a origem.** A página alvo entrega os links; como ela pode estar comprometida, um link que aponte para outro host ou outra porta é descartado (com aviso no log) e o restante do pipeline segue normal.
- **Nada de erro inesperado vazando.** Erro não previsto vira `500` genérico para o cliente; o motivo real fica só no log do servidor.
- **Servidor HTTP nativo e sem abstração extra.** São 3 rotas e um pipeline; não há framework, interface ou fábrica por camada.

## Stack

| Camada | Escolha |
|---|---|
| Runtime | Node.js `>=20` (ESM, `fetch` nativo) |
| Linguagem | TypeScript 5.9, sem `any` e com `strict` ligado |
| HTTP | `node:http` nativo, sem framework |
| Parsing HTML | cheerio 1.2 |
| Zip | archiver 8 (streaming) |
| Testes | Vitest 4 com cobertura v8 |
| Gerenciador | npm (lockfile versionado) |

## Requisitos

- Node.js `>=20` (declarado em `engines`; verificado com Node 24.20.0 e npm 11.19.0)
- Nenhum serviço externo: banco, fila e cache não existem aqui. A única rede usada é o `TARGET_URL` configurado.

## Início rápido

```bash
npm install
npm run dev                        # http://localhost:3000, com reload via tsx

curl -s http://localhost:3000/health
curl -s -X POST http://localhost:3000/process
curl -OJ http://localhost:3000/download
```

`TARGET_URL` aponta por padrão para a página do desafio original (`http://omnissolucoes.com/teste3/`),
que é um site de terceiros. Para testar de ponta a ponta sem sair da máquina, sirva o fixture
`test/fixtures/target-page.html` em um servidor estático, coloque os PDFs referenciados ao lado dele
(FT1, FH1, AXL, ZTT, FTR, AAA) e rode com `TARGET_URL=http://127.0.0.1:8901/`.

## API

Referência completa, com todos os erros por rota e exemplos: [`docs/API.md`](docs/API.md).

| Método | Rota | O que faz |
|---|---|---|
| GET | `/` | Redireciona (302) para `/health`. |
| GET | `/health` | Diz se o serviço está de pé. Não toca em rede nem em disco. |
| POST | `/process` | Roda o pipeline inteiro (extrai, baixa, unifica) e devolve um resumo. |
| GET | `/download` | Devolve o `.zip` gerado na última execução bem-sucedida de `/process`. |

Resposta de `POST /process` (execução real contra um alvo local, 6 arquivos):

```json
{
  "filesFound": 6,
  "filesDownloaded": 6,
  "filesFailed": 0,
  "files": [
    { "name": "Arquivo documento145", "code": "FT1", "url": "http://127.0.0.1:8901/FT1.pdf" }
  ],
  "failures": [],
  "artifactPath": "./data/artifact.zip",
  "artifactBytes": 940,
  "durationMs": 89
}
```

O campo `files` traz nome, código e URL de cada arquivo que a extração encontrou na página (o desafio
pedia essa identificação), e `failures` mostra o motivo de cada download que falhou.

Erros seguem sempre o formato `{ "error": "CODIGO", "message": "..." }`:

| Status | Código | Quando acontece |
|---|---|---|
| 404 | `NOT_FOUND` | Rota inexistente, método errado (ex.: `GET /process`) ou `/download` chamado antes de qualquer `/process` bem-sucedido. |
| 409 | `CONFLICT` | Já existe um `/process` em andamento. |
| 502 | `EXTRACTION_FAILED` | A página alvo não respondeu (timeout, erro de rede, status não-2xx) ou não tinha nenhum arquivo válido na listagem. |
| 500 | `UNIFICATION_FAILED` | Nenhum arquivo foi baixado ou o `.zip` não pôde ser gerado. |
| 500 | `INTERNAL_ERROR` | Falha não prevista, com mensagem genérica no cliente e detalhe só no log. |

## Configuração

Todas as variáveis são opcionais. Valor inválido (porta fora da faixa, número negativo, URL não
http/https) derruba a aplicação na inicialização, antes de aceitar request, e o processo sai com
código 1.

| Variável | Padrão | Para que serve |
|---|---|---|
| `TARGET_URL` | `http://omnissolucoes.com/teste3/` | Página que vai ser raspada. |
| `HOST` | `0.0.0.0` | Interface onde o servidor escuta. |
| `PORT` | `3000` | Porta do servidor. |
| `DATA_DIR` | `./data` | Onde ficam os downloads e o `.zip` final. |
| `PAGE_FETCH_TIMEOUT_MS` | `10000` | Timeout para buscar a página alvo. |
| `FILE_DOWNLOAD_TIMEOUT_MS` | `20000` | Timeout por arquivo baixado. |
| `DOWNLOAD_CONCURRENCY` | `4` | Quantos downloads rodam ao mesmo tempo. |

## Produção

```bash
npm run build     # tsc -p tsconfig.json, gera dist/
npm start         # node dist/index.js (respeita HOST e PORT)
```

Não há Dockerfile, CI nem systemd unit neste repositório: o deploy é rodar esses dois comandos onde o
serviço for hospedado, com as variáveis de ambiente acima. O `DATA_DIR` precisa persistir entre
reinícios se você quiser que `/download` continue servindo o último artefato.

## Estrutura do projeto

```
src/
├── index.ts       sobe o servidor e cuida do shutdown (SIGINT/SIGTERM)
├── server.ts      rotas, orquestração do pipeline, tradução de erro para HTTP
├── env.ts         lê e valida as variáveis de ambiente antes de subir
├── extract.ts     busca a página, parseia a listagem, descarta link fora da origem
├── download.ts    download com concorrência limitada e falha isolada por arquivo
├── unify.ts       monta o .zip com archiver
├── security.ts    sanitização de nome de arquivo, join seguro e guard anti-SSRF
├── errors.ts      uma classe de erro com statusCode e code
├── *.test.ts      testes de cada módulo (6 arquivos)
└── archiver.d.ts  declaração mínima para o archiver 8 (ESM, sem tipos próprios)
test/fixtures/
└── target-page.html   HTML de exemplo com a mesma estrutura da página alvo
docs/
└── API.md             contrato das rotas e catálogo de erros
```

São 8 arquivos de implementação, 480 linhas ao todo.

## Verificação

O que existe hoje, e o que roda de fato:

- `npm run build` = 0 (TypeScript com `strict`, `noUncheckedIndexedAccess` e `exactOptionalPropertyTypes`);
- `npm test` = 55 testes em 6 arquivos, todos passando;
- `npm run coverage` = 96,96% de statements e 93,06% de branches (`@vitest/coverage-v8`);
- `npm audit --omit=dev` = 0 vulnerabilidades nas duas dependências de produção;
- teste de ponta a ponta contra um alvo local: `POST /process` baixou 6 de 6 arquivos e gerou um `.zip` válido com 6 entradas, servido por `GET /download` com `200` e `content-type: application/zip`;
- casos de erro exercitados contra o binário compilado: `404` (`/download` antes de `/process`), `409` (duas chamadas concorrentes), `502` (alvo fora do ar) e descarte de link de outra origem pelo guard anti-SSRF.

Os testes ficam em `src/*.test.ts` e usam pasta temporária real para o que mexe com arquivo, em vez de
mockar o `fs`. Não há suíte de integração separada nem testes em navegador.

## Estado atual e limitações

- Sem CI configurada: build e testes rodam só localmente.
- Sem licença definida no repositório.
- Sem `.env.example`: todas as variáveis têm padrão no código e a tabela acima é a referência.
- O alvo padrão é a página do desafio (`omnissolucoes.com`), um site de terceiros que pode sair do ar; para uso real, configure `TARGET_URL`.
- A extração depende do formato do HTML: itens `<li>` com rótulo `CODIGO - nome` e um `<a href codigo="...">`. Item fora desse formato é simplesmente ignorado (sem erro, sem aviso no log), diferente dos links para outra origem, que geram aviso.
- O estado de execução é em memória: reiniciar o servidor libera a trava de concorrência e o `/download` só responde depois de um novo `/process`, a menos que o `DATA_DIR` persista o `artifact.zip`.
- A lista de arquivos é obtida de uma única página, sem paginação; não há autenticação nem limite de taxa nas rotas.
- No shutdown (SIGINT/SIGTERM) o servidor para de aceitar novas conexões e o processo só termina quando os requests em andamento acabam.

## Documentação

| Documento | Conteúdo |
|---|---|
| [`docs/API.md`](docs/API.md) | Contrato das rotas, campos de resposta, catálogo de erros e exemplos de `curl` |

## Licença

Nenhuma licença foi definida para este repositório. Sem um arquivo `LICENSE`, os direitos são
reservados ao autor e o código não tem permissão explícita de reuso.
