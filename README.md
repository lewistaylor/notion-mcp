# Notion MCP Server

An MCP server that exposes the [Notion](https://notion.so) API as tools for LLMs.
Deploy it as a remote HTTP endpoint and connect from Claude, Cursor, or any MCP client.

## Tools

| Tool | Description |
|---|---|
| `search_notion` | Full-text search across all pages and databases the integration can access |
| `get_page` | Retrieve a page's properties, icon, cover, and metadata by ID |
| `create_page` | Create a new page inside a parent page or database |
| `update_page` | Update page properties, archive status, icon, or cover |
| `get_page_property` | Retrieve a specific (possibly paginated) property value from a page |
| `list_databases` | List all databases accessible to the integration |
| `get_database` | Retrieve a database's schema (column names, types, options) |
| `query_database` | Query database rows with filters and sorts |
| `create_database` | Create a new database as a child of an existing page |
| `update_database` | Update a database's title, description, or schema |
| `get_block` | Retrieve a single block by ID |
| `update_block` | Update a block's content or archive it |
| `delete_block` | Delete (archive) a block |
| `get_block_children` | List the immediate children of a block or page |
| `append_block_children` | Append new child blocks to a block or page |
| `create_comment` | Create a top-level comment on a page or reply to a discussion thread |
| `get_comments` | List all comments on a block or page |
| `list_users` | List all users in the workspace |
| `get_user` | Retrieve a specific user by ID |
| `get_me` | Retrieve the bot user associated with the integration token |

## Setup

### Prerequisites

Create a Notion integration at [notion.so/my-integrations](https://www.notion.so/my-integrations):

1. Click **New integration** and give it a name.
2. Copy the **Internal Integration Secret** (starts with `secret_`).
3. In each Notion page or database the integration should access, open **…** → **Connections** → add your integration.

### Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `NOTION_TOKEN` | Yes | — | Notion integration secret (`secret_...`) |
| `PORT` | No | `3000` | Server port |
| `LOG_LEVEL` | No | `info` | Log verbosity (`debug`, `info`, `warn`, `error`) |

### Run locally

```bash
cp .env.example .env
# Fill in NOTION_TOKEN

npm install
npm run build
npm start
```

The server listens on `http://localhost:3000/mcp` (Streamable HTTP transport)
with a health check at `/health`.

### Deploy with Docker

```bash
docker build -t notion-mcp .
docker run -p 3000:3000 -e NOTION_TOKEN=secret_... notion-mcp
```

### Deploy to Railway (behind auth gateway)

1. In your Railway project, add a new service and connect this repo.
2. Name it **`notion-mcp`** (the auth gateway derives the upstream hostname
   from the service name: `notion-mcp.railway.internal`).
3. Set env var: `NOTION_TOKEN`.
4. **Pin the port**: set `PORT=8000` (must match the auth gateway's
   `INTERNAL_PORT`, which defaults to `8000`).
5. **Do NOT add a public domain** — the auth gateway handles public access.
6. Deploy. The included `railway.toml` configures the build and healthcheck.
7. The Notion MCP is now reachable at
   `https://<auth-gateway-domain>/notion/mcp`.

## Connect a client

### Via auth gateway (OAuth 2.1)

```json
{
  "mcpServers": {
    "notion": {
      "url": "https://<auth-gateway-domain>/notion/mcp"
    }
  }
}
```

### Direct (standalone only)

```json
{
  "mcpServers": {
    "notion": {
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

## Development

```bash
npm install
npm run build
npm test
```

### Project structure

```
notion-mcp/
├── Dockerfile              # Builds TypeScript, runs Node.js server
├── railway.toml            # Railway config (healthcheck, restart policy)
├── package.json            # Dependencies and scripts
├── tsconfig.json           # TypeScript config
├── .env.example            # Env var template
├── .dockerignore           # Docker build exclusions
└── src/
    ├── index.ts            # Entrypoint — validates token, starts Express
    ├── notion.ts           # Notion API client, assertId, safeHandler, helpers
    ├── transport.ts        # Express app, Streamable HTTP transport, sessions
    ├── logger.ts           # Structured JSON logger
    └── tools/
        ├── index.ts        # Registers all tool groups
        ├── search.ts       # search_notion
        ├── pages.ts        # get_page, create_page, update_page, get_page_property
        ├── databases.ts    # list_databases, get_database, query_database, create_database, update_database
        ├── blocks.ts       # get_block, update_block, delete_block, get_block_children, append_block_children
        ├── comments.ts     # create_comment, get_comments
        └── users.ts        # list_users, get_user, get_me
```

## Security notes

- **Token scope**: The integration token grants access only to pages and databases
  that have been explicitly shared with the integration via Notion's Connections UI.
  Grant access only to the workspaces/pages your LLM needs.
- **ID validation**: All block, page, database, and user IDs are validated against
  a UUID regex before being interpolated into API paths. Hyphens are stripped before
  use. This prevents path-traversal attacks via crafted IDs.
- **No public domain**: When running behind an auth gateway on Railway, do not add
  a public domain to this service. The gateway enforces authentication; the MCP
  service itself has no auth layer.
- **Secrets**: Never commit `.env` files. Use Railway environment variables or
  Docker secrets for production deployments.
