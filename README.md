# Social MCP Portal (Cloudflare Workers)

MCP servers for **Instagram**, **Facebook Pages**, **X (Twitter)**, **WhatsApp**, **Google Business Profile**, **YouTube**, **Google Ads** and **Google Analytics (GA4)**, running as a single stateless Worker via `createMcpHandler` from the Agents SDK.

## Endpoints

| Endpoint | Server | Tools |
|----------|--------|-------|
| `/mcp` | Social MCP Portal | every tool below, in one endpoint |
| `/mcp/instagram` | Instagram MCP Server | `instagram_*` |
| `/mcp/facebook` | Facebook MCP Server | `facebook_*` |
| `/mcp/x` | X (Twitter) MCP Server | `x_*` |
| `/mcp/whatsapp` | WhatsApp MCP Server | `whatsapp_*` |
| `/mcp/google` | Google MCP Server | all four Google servers below |
| `/mcp/google-business` | Google Business Profile MCP Server | `google_business_*` |
| `/mcp/youtube` | YouTube MCP Server | `youtube_*` |
| `/mcp/google-ads` | Google Ads MCP Server | `google_ads_*` |
| `/mcp/google-analytics` | Google Analytics MCP Server | `ga4_*` |
| `/mcp/tenant` | Tenant API Gateway | sintetizadas do manifesto do tenant |

Every endpoint also exposes `ping`, which reports which credentials are configured — handy for checking the deploy without touching the social APIs.

## Tenant API Gateway (`/mcp/tenant`)

Os outros endpoints têm ferramentas fixas no código. Este não: **as ferramentas são
sintetizadas do manifesto do tenant que está chamando**, resolvido pelo token da
requisição. Ele existe para a plataforma de agentes de WhatsApp
(`celfons/whatsapp`, issue #1324) consultar a API própria de cada cliente ao vivo,
dentro do turno, **sem que o backend dela mude uma linha**: para o backend, isto
aqui é um servidor MCP como qualquer outro.

### Como funciona

```
turno → backend lê tenant_mcp_servers (URL = este endpoint)
      → tools/list  (sintetizado do manifesto)
      → o LLM escolhe a ferramenta; bindCallScope injeta o telefone verificado
      → tools/call  → este gateway chama a API REST do cliente
                    → projeta SÓ os campos declarados
      → o texto entra no prompt como <external_data>
```

### O manifesto

Guardado em KV (`TENANT_MANIFESTS`), em duas famílias de chave:

```
tenant-token:<sha-256 do token>  ->  tenantId
tenant-manifest:<tenantId>       ->  o manifesto
```

O índice guarda o **hash** do token, não o token: um dump do KV não vira um chaveiro.

```json
{
  "tenantId": "tnt_1",
  "label": "ERP da Loja",
  "baseUrl": "https://api.cliente.com",
  "auth": { "type": "bearer", "token": "..." },
  "timeoutMs": 3000,
  "tools": [
    {
      "name": "consultar_pedido",
      "description": "Status e previsão de entrega de um pedido",
      "method": "GET",
      "path": "/pedidos/{orderId}",
      "scope": "customer",
      "identityParam": "telefone",
      "params": [
        { "name": "orderId", "in": "path", "required": true },
        { "name": "telefone", "in": "query", "required": true }
      ],
      "fields": [
        { "path": "status", "label": "Status" },
        { "path": "entrega.previsao", "label": "Previsão" }
      ],
      "maxChars": 1200
    }
  ]
}
```

Cadastrar:

O namespace já existe e o binding está declarado em `wrangler.jsonc`.

### Cadastro pela rota admin (preferido)

`PUT /admin/tenants/:tenantId/manifest`, protegida por `ADMIN_TOKEN`
(`npx wrangler secret put ADMIN_TOKEN`). Ela **valida pelo mesmo `parseManifest`**
antes de gravar e grava as duas chaves de uma vez:

```bash
curl -X PUT https://mcp.closing.trade/admin/tenants/tnt_1/manifest \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "manifest": { ... }, "token": "<token-que-a-plataforma-vai-usar>" }'
```

Manifesto inválido é recusado com motivo nomeado e **nada** é gravado — diferente
do painel, que aceita JSON quebrado calado e deixa a falha aparecer depois, como um
agente respondendo sem o dado. `GET` devolve o manifesto **sem** a credencial da API
do cliente; `DELETE` torna o tenant inalcançável.

Sem `ADMIN_TOKEN` configurado, `/admin/*` responde 503 — ausência de credencial nunca
vira "aberto".

### Cadastro pela CLI (emergência)

```bash
npx wrangler kv key put --binding=TENANT_MANIFESTS "tenant-manifest:tnt_1" --path manifesto.json
npx wrangler kv key put --binding=TENANT_MANIFESTS "tenant-token:<sha256-do-token>" "tnt_1"
```

Do lado da plataforma, a linha em `tenant_mcp_servers` aponta para
`https://mcp.closing.trade/mcp/tenant` com `Authorization: Bearer <token>`, e o `tool_policy`
classifica cada ferramenta com o MESMO escopo declarado aqui.

### O que o manifesto obriga, e por quê

- **`fields` é obrigatório.** Sem projeção, o JSON do cliente iria cru para o prompt —
  com margem, custo interno e dado de terceiro dentro. Campo não declarado não viaja.
- **Lista: use o caminho de repetição** `produtos[].nome`. Ele projeta todos os itens
  (até 30, ou até o teto de caracteres), **uma linha por item** com os campos daquele
  item juntos — é o que permite uma ferramenta de BUSCA e o agente sugerir a partir do
  catálogo do cliente. Agrupar por campo em vez de por item deixaria o modelo parear
  preço com o produto errado, que é a pior saída possível deste módulo.

  ```json
  "fields": [
    { "path": "produtos[].nome",  "label": "Produto" },
    { "path": "produtos[].preco", "label": "Preço" }
  ]
  ```

  → `Produto: Creatina · Preço: R$ 89`
- **Ferramenta `customer` precisa declarar o `identityParam` entre os `params`.** O
  backend recusa (`identityParam_missing`) a que não o declara no `inputSchema`;
  aceitar aqui seria anunciar uma ferramenta nunca chamável.
- **Ferramenta `business` não pode ter `identityParam`** — a contradição é recusada,
  não resolvida em silêncio.
- Manifesto inválido é recusado **inteiro**: meio manifesto aplicado é uma ferramenta
  que some sem ninguém notar.

### Quando a API do cliente não fala a língua da plataforma

Quatro campos opcionais existem porque, sem eles, boa parte das APIs reais fica
inexprimível — não por elegância.

- **`transform`** no parâmetro (`"digits"` · `"br_local"`). A plataforma escreve no
  `identityParam` o `wa_id` da Meta: E.164 em dígitos, com DDI (`5534999530186`). ERP
  brasileiro guarda o telefone em formato **local**. Sem normalizar, a busca casa zero
  registros — e nada quebra: o leg degrada em `empty_result` e o dono conclui que "não
  funciona" sem nenhum sinal apontando a causa. `br_local` remove o DDI só quando o
  número tem 12–13 dígitos e começa em `55` (a janela é o que impede um número de DDD 55
  de perder dois dígitos).

- **`query`** — pares fixos, do autor do manifesto, fora do alcance do modelo:
  `{"idBranch": "7", "active": "true", "take": "20"}`. Pinar a unidade como *parâmetro*
  seria deixar o modelo escolher a unidade a partir do texto do cliente.

- **`root`** — onde, na resposta, mora o que a projeção deve ler, em candidatos.
  `["list", "lista", "$"]` desce num envelope de paginação; `["[0]", "$"]` cobre
  objeto-ou-lista quando o swagger do cliente diz uma coisa e a API faz outra. `"$"` é a
  resposta inteira. Candidato que existe mas está **vazio** não conta como achado.

- **`resolve`** — o salto `identidade verificada → chave interna`, feito pelo gateway
  antes da consulta principal:

  ```json
  "resolve": {
    "path": "/api/v1/members/basic",
    "param": "phone",
    "query": { "take": "1" },
    "extract": ["[0].idMember", "idMember"],
    "into": "memberId"
  }
  ```

  Ele existe porque a plataforma só conhece o **telefone** (é o que ela verifica no
  ingresso do canal) e a maioria das APIs keya por um id interno. Sem o salto, metade das
  consultas escopadas por cliente é inexprimível.

  O ADR-0036 proíbe **encadear ferramentas** — mas o que ele proíbe é o laço de decisão da
  LLM (chamar → ler → decidir de novo). Daqui sai **um** `tools/call`; os dois saltos são
  determinísticos e dividem o mesmo `timeoutMs`. E a amarra fica mais **forte**: o limite
  conhecido nº 1 do ADR-0036 é que a plataforma prova o *envio* da identidade, não o
  *respeito* a ela — com o salto, a chave é **derivada** do telefone verificado pelo
  próprio gateway, e o modelo não tem como propô-la.

  Três propriedades não são configuráveis, de propósito: o valor enviado é **sempre** o
  `identityParam` (se houvesse campo para escolher outro, o modelo escolheria); `into` não
  pode colidir com parâmetro nem com query fixa; e **resolução vazia aborta a
  ferramenta** — a consulta principal não acontece, porque um `/receivables` sem
  `memberId` devolveria o financeiro da academia inteira.

### O que este gateway assume como responsabilidade

Ao viver fora da plataforma, ele perde o `INV-TENANT-SCOPE` e o guard estrutural que o
cobra lá. O que sobra é a regra em `src/tenant/store.ts` e os testes: **o token resolve
UM tenant, e as ferramentas daquela requisição saem do manifesto DAQUELE tenant.** Não
há caminho que leia manifesto de outro, e não há listagem.

Também moram aqui: o SSRF (`https` apenas, sem faixa privada/loopback/metadata,
redirecionamento não seguido, corpo com teto de bytes), a credencial da API do cliente,
e o cuidado de a mensagem de erro **nunca** ecoar o corpo do cliente — esse texto entra
no prompt de um agente.

**Limite conhecido:** um host que *resolve* para IP privado passa pela guarda (não há
resolução de DNS antes do `fetch`). Rebind de DNS exigiria proxy com resolvedor próprio;
está fora de escopo, e é melhor estar escrito do que subentendido.

## Preset: EVO (academias)

A EVO (W12) é o sistema de gestão que boa parte das academias usa. Ela é o oposto do caso
que o manifesto por tenant atende: a API é **fixa e conhecida**, a mesma para todas as
academias. Colar 250 linhas de JSON por academia produziria divergência entre clientes
idênticos e nenhum lugar onde corrigir todo mundo quando a W12 mudar um campo.

`src/tenant/presets/evo.ts` é esse lugar. Ele **gera** um manifesto e o passa pelo mesmo
`parseManifest` — não é um caminho de gravação paralelo, é um gerador de entrada para o
mesmo. Ativar uma academia vira três campos.

### Ativar

**1 · No gateway** (aqui):

```bash
curl -X PUT https://mcp.closing.trade/admin/tenants/tnt_gym/preset/evo \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
        "dns": "<dns-da-unidade-na-evo>",
        "secretKey": "<secret-key-da-evo>",
        "idBranch": 7,
        "label": "Academia Centro",
        "token": "<token-que-a-plataforma-vai-apresentar>"
      }'
```

Auth da EVO é **Basic** (DNS como usuário, secret key como senha), montado aqui — o
esquema do manifesto não precisa saber o que é Basic. A resposta traz a `tool_policy`
pronta e **nunca** a credencial.

**2 · Na plataforma** (`celfons/whatsapp`), cole a `tool_policy` que veio na resposta:

```bash
curl -X PUT https://<plataforma>/api/admin/tenants/tnt_gym/mcp-server \
  -H "Authorization: Bearer $ADMIN" -H "Content-Type: application/json" \
  -d '{ "label": "EVO",
        "url": "https://mcp.closing.trade/mcp/tenant",
        "authHeader": "Bearer <o-mesmo-token-acima>",
        "toolPolicy": { ... } }'
```

Os dois documentos **têm de concordar**: uma ferramenta anunciada aqui e não classificada
lá nasce inchamável (`unclassified`), e o dono só descobre pela métrica de degradação. Por
isso a policy é **gerada**, não transcrita.

### As ferramentas

| Ferramenta | Escopo | Endpoint EVO | Salto |
|---|---|---|---|
| `evo_meu_cadastro` | customer | `GET /api/v1/members/basic` | — |
| `evo_meu_plano` | customer | `GET /api/v1/members/basic` | — |
| `evo_minhas_cobrancas` | customer | `GET /api/v1/receivables` | → `memberId` |
| `evo_minhas_aulas` | customer | `GET /api/v1/activities/schedule` | → `idMember` |
| `evo_planos_e_precos` | business | `GET /api/v3/membership` | — |
| `evo_servicos_e_precos` | business | `GET /api/v1/service` | — |
| `evo_grade_de_aulas` | business | `GET /api/v1/activities/schedule` | — |
| `evo_modalidades` | business | `GET /api/v1/activities` | — |
| `evo_unidade` | business | `GET /api/v1/configuration` | — |

`evo_meu_plano` não precisa de salto porque `MembersBasicApiViewModel.memberships` já vem
embutido na busca por telefone — uma consulta, e é o que a mantém barata.

O preset usa `/api/v1/members/basic`, **não** `/api/v2/members`: o v2 devolve `cpf`,
`document`, `address`, `zipCode`, `birthDate` e `photoUrl`. Projeção estreita protege o
prompt, mas o que não sai da EVO não precisa de projeção — é uma camada de PII a menos
atravessando o fio.

### O que o preset deliberadamente não faz

**Escrita.** Matricular em aula (`POST /activities/schedule/enroll`), criar prospect,
agendar experimental — todos existem na EVO e nenhum entra aqui. O ADR-0036 §2.3 contrata
**leitura**, e é essa contratação que dispensa reserva de idempotência: a entrega do turno
é at-least-once, então um turno reentregue **repete a consulta**. Repetir leitura custa
tempo; repetir matrícula cria duas. Escrita é outra feature, e ela reabre o P-3.

### Verificar na ativação (não dá para saber do código)

1. **Semântica do filtro `phone`** em `/members/basic`: exato, parcial, ignora máscara? Se
   a academia guardar o número **com** DDI, o transform correto é `digits` — é uma linha
   em `PHONE_TRANSFORM`. **É a suposição mais frágil do preset**, e a que falha em
   silêncio: nenhuma consulta escopada acha ninguém, e nada fica vermelho. O sinal é
   `empty_result` perto de 100% para aquele tenant, logo depois da ativação.
2. **Latência p95** de `/members/basic` + `/receivables`: os dois saltos têm de caber nos
   `3400 ms` do preset, que ficam abaixo do `MCP_TIMEOUT_MS` (4 s) da plataforma.
3. **Rate limit** da API por token — não está documentado pela W12, e o agente consulta
   por turno.
4. **`idBranch`** numa rede multi-unidade: sem ele, a EVO responde pelo escopo do token.

### O que não deve passar por aqui

Preço de plano é a pergunta nº 1 de uma academia e a mais tentadora de pôr no MCP. Mas o
ADR-0036 §2.4 proíbe cache entre turnos: `evo_planos_e_precos` seria chamado **em todo
turno**, com uma chamada de LLM de seleção junto, para um dado que muda uma vez por
semestre. Ele está aqui para quem quer o preço sempre vivo — mas contexto quase estático
(tabela de preços, horário, modalidades) sai mais barato no portal do agente ou no RAG,
que já são lastro e custam zero de latência. O MCP se paga no dado **vivo e por pessoa**:
situação do contrato, cobrança em aberto, aula agendada, vaga de hoje.

## Tools

### Instagram (Graph API — Business/Creator accounts)

| Tool | What it does |
|------|--------------|
| `instagram_get_profile` | Profile data (followers, bio, media count) |
| `instagram_list_media` | Recent posts |
| `instagram_get_media` | Details of a single post |
| `instagram_get_media_insights` | Post metrics (reach, likes, saves, shares) |
| `instagram_publish_post` | Publishes an image or reel (container + publish) |
| `instagram_list_comments` | Comments on a post |
| `instagram_reply_to_comment` | Replies to a comment |

### Facebook (Pages Graph API)

| Tool | What it does |
|------|--------------|
| `facebook_list_pages` | Pages the token can manage |
| `facebook_get_page` | Page details |
| `facebook_list_posts` | Recent Page posts |
| `facebook_create_post` | Publishes a text post (optionally with a link) |
| `facebook_upload_photo` | Publishes a photo from a public URL |
| `facebook_delete_post` | Deletes a post |
| `facebook_get_post_insights` | Post metrics |
| `facebook_list_comments` | Comments on a post |
| `facebook_reply_to_comment` | Replies to a comment |

### X / Twitter (API v2)

| Tool | What it does |
|------|--------------|
| `x_get_me` | Authenticated account |
| `x_get_user` | Profile lookup by @username |
| `x_list_user_tweets` | Recent posts from an account |
| `x_get_tweet` | A single post with its metrics |
| `x_search_recent` | Search posts from the last 7 days |
| `x_post_tweet` | Publishes a post (reply/quote supported) |
| `x_delete_tweet` | Deletes a post |

### WhatsApp (Cloud API)

| Tool | What it does |
|------|--------------|
| `whatsapp_send_message` | Free-form text (24-hour window only) |
| `whatsapp_send_template` | Approved template, with body parameters |
| `whatsapp_send_media` | Image, video, audio or document from a URL |
| `whatsapp_send_reaction` | Reacts to a message with an emoji |
| `whatsapp_mark_as_read` | Marks a received message as read |
| `whatsapp_get_business_profile` | Business profile of the sending number |
| `whatsapp_list_templates` | Templates of a WABA, with approval status |
| `whatsapp_get_media_url` | Download URL of received media |

### Google Business Profile

| Tool | What it does |
|------|--------------|
| `google_business_list_accounts` | Manageable accounts |
| `google_business_list_locations` | Locations of an account |
| `google_business_get_location` | Address, hours, phone, categories |
| `google_business_list_reviews` | Reviews with rating and existing replies |
| `google_business_reply_to_review` | Replies to a review |
| `google_business_create_post` | Publishes a local post, with optional CTA |

### YouTube (Data API v3)

| Tool | What it does |
|------|--------------|
| `youtube_get_channel` | Channel by ID, handle, or the authenticated one |
| `youtube_list_videos` | Recent videos of a channel |
| `youtube_get_video` | Video with views, likes and comment count |
| `youtube_search` | Searches videos, channels or playlists |
| `youtube_list_comments` | Comment threads on a video |
| `youtube_reply_to_comment` | Replies to a comment |
| `youtube_update_video` | Title, description, tags, privacy |

### Google Ads

| Tool | What it does |
|------|--------------|
| `google_ads_list_accounts` | Accessible accounts |
| `google_ads_list_campaigns` | Campaigns with status, budget and metrics |
| `google_ads_campaign_performance` | Daily performance of one campaign |
| `google_ads_list_ad_groups` | Ad groups of the account or a campaign |
| `google_ads_keyword_performance` | Keyword metrics, ordered by impressions |
| `google_ads_run_query` | Arbitrary GAQL query |
| `google_ads_update_campaign_status` | Pauses/enables/removes a campaign — **changes live spend** |

### Google Analytics (GA4)

| Tool | What it does |
|------|--------------|
| `ga4_list_accounts` | Analytics accounts |
| `ga4_list_properties` | GA4 properties of an account |
| `ga4_report` | Report with the metrics/dimensions you choose |
| `ga4_traffic_overview` | Users, sessions, engagement and conversions by channel |
| `ga4_top_pages` | Most viewed pages |
| `ga4_realtime` | Users active right now |
| `ga4_list_metadata` | Metrics and dimensions available on the property |

## Credentials

Store them as Worker secrets — never in `wrangler.jsonc`:

```sh
npx wrangler secret put FACEBOOK_ACCESS_TOKEN     # Page token (Facebook, and Instagram fallback)
npx wrangler secret put INSTAGRAM_ACCESS_TOKEN    # optional; overrides the token above for Instagram
npx wrangler secret put X_BEARER_TOKEN            # X app-only token (reads)
npx wrangler secret put X_USER_ACCESS_TOKEN       # X user-context token (posting/deleting)

# WhatsApp Cloud API
npx wrangler secret put WHATSAPP_ACCESS_TOKEN     # optional; falls back to FACEBOOK_ACCESS_TOKEN
npx wrangler secret put WHATSAPP_PHONE_NUMBER_ID  # default sender number ID

# Google (shared by Business Profile, YouTube, Ads and Analytics)
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put GOOGLE_REFRESH_TOKEN

# Google, per-product extras
npx wrangler secret put YOUTUBE_API_KEY               # optional; used for read-only YouTube calls
npx wrangler secret put GOOGLE_ADS_DEVELOPER_TOKEN
npx wrangler secret put GOOGLE_ADS_LOGIN_CUSTOMER_ID  # optional, for MCC accounts
npx wrangler secret put GOOGLE_ADS_CUSTOMER_ID        # optional default account
npx wrangler secret put GA4_PROPERTY_ID               # optional default property
```

Google access tokens expire in about an hour, so the Worker mints them on demand from the refresh token and caches them in the isolate. A static `GOOGLE_ACCESS_TOKEN` is also accepted, which is convenient for local testing but will expire in production.

For local development, put the same keys in a `.dev.vars` file (git-ignored).

Required permissions:

- **Instagram**: `instagram_basic`, `instagram_content_publish`, `instagram_manage_comments`
- **Facebook**: `pages_read_engagement`, `pages_manage_posts`, `pages_manage_engagement`
- **X**: `tweet.read`, `users.read`, and `tweet.write` for publishing
- **WhatsApp**: `whatsapp_business_messaging`, `whatsapp_business_management`
- **Google Business Profile**: `business.manage`
- **YouTube**: `youtube.force-ssl` (writes); reads can use an API key
- **Google Ads**: `adwords`, plus an approved developer token
- **GA4**: `analytics.readonly`

The Graph API version defaults to `v21.0` and can be changed with the `GRAPH_API_VERSION` var in `wrangler.jsonc`.

Any tool called without its credential returns an MCP error result explaining which secret is missing — it never leaks the token value.

## Running

```sh
npm install
npm start        # http://localhost:5173 — built-in tool tester with an endpoint switcher
npm run build    # generates dist/ (Worker + client assets)
npm run deploy   # build + wrangler deploy
```

### Deploying from Cloudflare Workers Builds

The Vite plugin is what fills in `assets.directory` — it writes the final Worker config to `dist/mcp_social/wrangler.json` at build time. So a bare `npx wrangler deploy` with no build first fails with:

```
✘ [ERROR] The `assets` property in your configuration is missing the required `directory` property.
```

In the Workers Builds settings for this project, set **either**:

- **Build command**: `npm run build` (keeping the default deploy command `npx wrangler deploy`), **or**
- **Deploy command**: `npm run deploy` (which builds and deploys in one step).

Connect an MCP client (Claude, MCP Inspector, …) to `https://<your-worker>/mcp`, or to one of the per-network endpoints.

## Structure

```
src/
  server.ts            routing: one MCP server per endpoint
  social/
    shared.ts          HTTP helper, error handling, secret loading
    instagram.ts       instagram_* tools
    facebook.ts        facebook_* tools
    twitter.ts         x_* tools
    whatsapp.ts        whatsapp_* tools
    google-shared.ts   Google OAuth: refresh token -> cached access token
    google-business.ts google_business_* tools
    youtube.ts         youtube_* tools
    google-ads.ts      google_ads_* tools
    google-analytics.ts ga4_* tools
    env.d.ts           secret/var types
  tenant/
    manifest.ts        esquema do manifesto (a fronteira do gateway) + transforms
    store.ts           KV: token -> tenant -> manifesto (o isolamento mora aqui)
    safeUrl.ts         SSRF: destino verificado, sem redirect, corpo com teto
    project.ts         resposta do cliente -> só os campos declarados; raiz por candidatos
    gateway.ts         manifesto -> ferramentas MCP; o salto de resolução
    admin.ts           rotas de manifesto e de preset
    presets/evo.ts     EVO (academias): manifesto gerado + a tool_policy da plataforma
  client.tsx           browser tool tester
test/
  tenantGateway.test.ts  isolamento, manifesto, SSRF, projeção, execução
  tenantResolve.test.ts  salto de resolução, transform, raiz, query fixa
  tenantAdmin.test.ts    rotas admin de manifesto e de preset
  evoPreset.test.ts      o preset da EVO e o acordo com a tool_policy
```

Testes: `npm test` (vitest).

## Adding a network

Create `src/social/<network>.ts` exporting a `register<Network>Tools(server, env)` function, then add it to the `SERVERS` map in `src/server.ts`. For a Google product, reuse `googleGet`/`googlePost` from `google-shared.ts` so it shares the token refresh.
