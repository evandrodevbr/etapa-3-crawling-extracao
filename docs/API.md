# API — Referência técnica

Documentação de todas as rotas expostas pelo serviço. Para instalação, execução e decisões de
arquitetura, veja o [README](../README.md).

**Base URL:** `http://localhost:3000` (ou o `HOST`/`PORT` configurado — veja o README).

Toda resposta é JSON (`content-type: application/json; charset=utf-8`), exceto o corpo binário de
`GET /download`. Toda resposta de erro segue o mesmo formato, descrito no final deste documento.

## Índice

- [`GET /health`](#get-health)
- [`POST /process`](#post-process)
- [`GET /download`](#get-download)
- [Formato de erro](#formato-de-erro)

---

## `GET /health`

Verifica se o serviço está no ar. Não dispara nenhuma lógica de negócio, não toca em rede nem em
disco — só confirma que o processo está respondendo.

**Request:** sem parâmetros, sem corpo.

**Resposta — `200 OK`**

```json
{ "status": "ok" }
```

Não tem caso de erro documentado aqui: se o processo estiver de pé, essa rota sempre responde
`200`.

---

## `POST /process`

Dispara o pipeline completo: busca a página alvo, extrai a listagem de arquivos, baixa cada um e
gera o `.zip` unificado. É uma rota que **executa uma ação** — por isso é `POST`, não `GET`. Se
você abrir essa URL direto no navegador (que só faz `GET`), vai receber `404 NOT_FOUND`, porque
não existe rota `GET /process`. Use `curl -X POST`, Postman, Insomnia ou similar.

**Request:** sem parâmetros, sem corpo. A URL alvo (`TARGET_URL`) e os timeouts são configurados
por variável de ambiente na inicialização do servidor, não por request.

**Resposta — `200 OK`**

```json
{
  "filesFound": 6,
  "filesDownloaded": 6,
  "filesFailed": 0,
  "files": [
    { "name": "Arquivo documento145", "code": "FT1", "url": "http://omnissolucoes.com/teste3/FT1.pdf" }
  ],
  "failures": [],
  "artifactPath": "./data/artifact.zip",
  "artifactBytes": 302907,
  "durationMs": 590
}
```

| Campo             | Tipo     | Descrição                                                                 |
|--------------------|----------|------------------------------------------------------------------------------|
| `filesFound`        | number   | Quantos arquivos válidos a extração encontrou na página alvo.               |
| `filesDownloaded`    | number   | Quantos desses arquivos foram baixados com sucesso.                        |
| `filesFailed`         | number   | Quantos falharam no download.                                              |
| `files`                | array    | Nome, código e URL completa de cada arquivo baixado com sucesso.           |
| `failures`              | array    | Um item por arquivo que falhou: `{ fileCode, url, reason }`.               |
| `artifactPath`           | string   | Caminho local do `.zip` gerado.                                            |
| `artifactBytes`           | number   | Tamanho do `.zip` em bytes.                                                |
| `durationMs`                | number   | Quanto tempo o pipeline inteiro levou, em milissegundos.                   |

Se `filesDownloaded` for `0` (nenhum arquivo baixou), a rota não chega a devolver `200` — ela
falha com `500 UNIFICATION_FAILED` (não faz sentido gerar um `.zip` vazio). Um `filesFailed > 0`
com `filesDownloaded > 0` é uma execução parcial normal: o `.zip` é gerado só com o que deu certo.

**Erros possíveis**

| Status | Código               | Quando acontece                                                                 |
|--------|----------------------|------------------------------------------------------------------------------------|
| 409    | `CONFLICT`             | Já existe uma execução de `/process` em andamento — espere ela terminar e tente de novo. |
| 502    | `EXTRACTION_FAILED`     | A página alvo não respondeu (timeout, erro de rede, status não-2xx) ou não tinha nenhum arquivo válido na listagem. |
| 500    | `UNIFICATION_FAILED`     | Todos os downloads falharam (nada pra unificar) ou o `.zip` não pôde ser gerado. |
| 500    | `INTERNAL_ERROR`          | Falha inesperada, não prevista pelo código. A mensagem devolvida é genérica; o detalhe real fica só no log do servidor. |

---

## `GET /download`

Devolve o `.zip` gerado na última execução bem-sucedida de `POST /process`. Precisa ter rodado o
`/process` com sucesso pelo menos uma vez antes — o serviço não gera nada sozinho.

**Request:** sem parâmetros, sem corpo.

**Resposta — `200 OK`**

Corpo binário (o arquivo `.zip`), com os headers:

```
content-type: application/zip
content-disposition: attachment; filename="artefato-unificado.zip"
x-content-type-options: nosniff
```

```bash
curl -OJ http://localhost:3000/download
```

**Erros possíveis**

| Status | Código        | Quando acontece                                                        |
|--------|---------------|---------------------------------------------------------------------------|
| 404    | `NOT_FOUND`     | Nenhum `/process` rodou com sucesso ainda (ou o servidor foi reiniciado e a pasta `data/` não persistiu). |

---

## Formato de erro

Toda resposta com status diferente de `2xx` segue este formato:

```json
{ "error": "CODIGO", "message": "descrição legível do que aconteceu" }
```

`error` é um código estável (bom pra tratar programaticamente); `message` é uma frase pensada pra
humano ler. Uma rota inexistente, ou uma rota existente chamada com o método errado (ex.:
`GET /process`), devolve:

```json
{ "error": "NOT_FOUND", "message": "Route not found" }
```

com status `404`.
