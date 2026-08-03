# Social MCP Portal (Cloudflare Workers)

MCP servers for **Instagram**, **Facebook Pages** and **X (Twitter)**, running as a single stateless Worker via `createMcpHandler` from the Agents SDK.

## Endpoints

| Endpoint | Server | Tools |
|----------|--------|-------|
| `/mcp` | Social MCP Portal | every tool below, in one endpoint |
| `/mcp/instagram` | Instagram MCP Server | `instagram_*` |
| `/mcp/facebook` | Facebook MCP Server | `facebook_*` |
| `/mcp/x` | X (Twitter) MCP Server | `x_*` |

Every endpoint also exposes `ping`, which reports which credentials are configured — handy for checking the deploy without touching the social APIs.

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

## Credentials

Store them as Worker secrets — never in `wrangler.jsonc`:

```sh
npx wrangler secret put FACEBOOK_ACCESS_TOKEN     # Page token (Facebook, and Instagram fallback)
npx wrangler secret put INSTAGRAM_ACCESS_TOKEN    # optional; overrides the token above for Instagram
npx wrangler secret put X_BEARER_TOKEN            # X app-only token (reads)
npx wrangler secret put X_USER_ACCESS_TOKEN       # X user-context token (posting/deleting)
```

For local development, put the same keys in a `.dev.vars` file (git-ignored).

Required permissions:

- **Instagram**: `instagram_basic`, `instagram_content_publish`, `instagram_manage_comments`
- **Facebook**: `pages_read_engagement`, `pages_manage_posts`, `pages_manage_engagement`
- **X**: `tweet.read`, `users.read`, and `tweet.write` for publishing

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
    env.d.ts           secret/var types
  client.tsx           browser tool tester
```

## Adding a network

Create `src/social/<network>.ts` exporting a `register<Network>Tools(server, env)` function, then add it to the `SERVERS` map in `src/server.ts`.
