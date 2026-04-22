# MCP Configuration

This plugin supports MCP through a two-part design:

1. The Obsidian plugin opens a localhost-only API.
2. The MCP bridge process forwards MCP tool calls to that local API.

Obsidian must be open, and the plugin must be enabled, because WordPress publishing still runs inside Obsidian.

## Is This A Skill?

No. This is not a Codex skill.

- An MCP server exposes callable tools to a client such as Codex.
- A skill is a set of local instructions that tells Codex how to perform a workflow.
- This plugin provides an MCP server/bridge. You could optionally write a separate skill later that teaches Codex when and how to call these MCP tools, but the API itself is MCP, not a skill.

## Obsidian Plugin Setup

In Obsidian:

1. Open `Settings`.
2. Open `Obsidian to WordPress`.
3. Find `Local API / MCP`.
4. Enable `Enable local API`.
5. Set the port to `27187`, or keep the default.
6. Generate an API key.
7. Copy the API key immediately. It is shown only once.

If the API key is lost, generate a new one. The old key becomes invalid.

## Build The MCP Bridge

From this plugin repository:

```bash
npm install
npm run build:mcp
```

This creates:

```text
dist/mcp-server.js
```

## Codex MCP Config

Add this to your Codex MCP configuration, replacing both placeholders:

```toml
[mcp_servers.obsidian-to-wordpress]
command = "node"
args = ["/absolute/path/to/obsidian-to-wordpress/dist/mcp-server.js"]

[mcp_servers.obsidian-to-wordpress.env]
OTW_API_BASE_URL = "http://127.0.0.1:27187"
OTW_API_KEY = "YOUR_OBSIDIAN_TO_WORDPRESS_API_KEY"
```

A ready-to-edit template is available at:

```text
examples/codex-mcp.config.toml
```

## Generic MCP JSON Config

Some MCP clients use JSON:

```json
{
  "mcpServers": {
    "obsidian-to-wordpress": {
      "command": "node",
      "args": [
        "/absolute/path/to/obsidian-to-wordpress/dist/mcp-server.js"
      ],
      "env": {
        "OTW_API_BASE_URL": "http://127.0.0.1:27187",
        "OTW_API_KEY": "YOUR_OBSIDIAN_TO_WORDPRESS_API_KEY"
      }
    }
  }
}
```

A ready-to-edit template is available at:

```text
examples/mcp.config.json
```

## MCP Bridge Logs

The MCP bridge never writes diagnostics to stderr/stdout, because MCP uses stdio as its protocol transport.

MCP file logging follows the plugin `Debug mode` setting after the bridge can reach Obsidian's local API. When debug mode is disabled, the MCP bridge does not write a log file.

Default log file:

```text
/tmp/obsidian-to-wordpress-mcp.log
```

You can override it with:

```toml
[mcp_servers.obsidian-to-wordpress.env]
OTW_MCP_LOG_PATH = "/tmp/obsidian-to-wordpress-mcp.log"
```

The log records startup, JSON-RPC framing, tool calls, and local API response status. It does not write the API key.

If MCP startup itself is failing before the bridge can read the plugin debug setting, temporarily add:

```toml
[mcp_servers.obsidian-to-wordpress.env]
OTW_MCP_DEBUG = "1"
```

Remove `OTW_MCP_DEBUG` after diagnosis if you want the plugin setting to be the only logging control.

## Available MCP Tools

- `obsidian_wordpress_health`: checks whether Obsidian's local API is reachable.
- `list_published_obsidian_posts`: lists vault Markdown notes that have `wp_post_id` and fetches remote WordPress status when reachable.
- `publish_current_obsidian_note`: publishes the currently active Obsidian note.
- `publish_obsidian_note`: publishes a vault-relative note path, such as `folder/note.md`.
- `get_obsidian_wordpress_post_status`: fetches the remote WordPress status for a note path, or the active note if `path` is omitted.
- `change_obsidian_wordpress_post_status`: changes `wp_status` in note frontmatter for a note path, or the active note if `path` is omitted.
- `unpublish_obsidian_wordpress_post`: moves the remote WordPress post for a note path back to draft. Requires destructive API actions enabled.
- `delete_obsidian_wordpress_post`: moves the remote WordPress post to trash or deletes it permanently. Requires destructive API actions enabled.

## Security Notes

- Do not commit your real API key.
- Do not publish screenshots containing the API key.
- The local API listens on `127.0.0.1` only.
- The API key itself is not stored in Obsidian plugin data. Only a salted SHA-256 hash and salt are stored for verification.
- If you suspect the key leaked, regenerate it in plugin settings.
