# Obsidian to WordPress

[English](README.md) | [中文](README.zh-CN.md)

Obsidian plugin for publishing the current note to a self-hosted WordPress site through the WordPress REST API using WordPress Application Passwords.

## Release Status

Current release target: `1.0.0-beta.1`. This beta is intended for early testing; features will continue to be added incrementally.

## Supported

- Publishes the currently active Obsidian Markdown note from the command palette.
- Converts Obsidian Markdown to HTML before sending it to WordPress, so the public page renders correctly.
- Creates a WordPress post on first publish.
- Updates the same WordPress post on later publishes using `wp_post_id`.
- Checks the remote WordPress `modified` timestamp before overwriting an existing post and asks for confirmation if the remote post changed.
- Provides command-palette actions to show remote WordPress post status, move the remote post back to draft, or trash/delete the remote post.
- Provides a command-palette action to change the current note's WordPress status, so a note first published as `draft` can later be changed to `publish`, `private`, or `pending` before republishing.
- Loads WordPress categories in the first-publish modal so users select categories instead of typing them manually.
- Displays WordPress categories with parent/child hierarchy in the first-publish modal.
- Supports adding WordPress categories with an optional parent category, and deleting categories from the first-publish modal.
- Writes WordPress ID, URL, publish time, and update time back to note frontmatter.
- Provides a plugin settings tab for site URL, username, Application Password, default status, and debug mode.
- Shows full logs after each upload when debug mode is enabled; otherwise shows logs only on failures.
- Uploads local images to the selected image storage provider before publishing.
- Supports WordPress Media Library and Aliyun OSS as image storage providers.
- Converts Obsidian image embeds like `![[image.png]]` to WordPress media URLs.
- Converts local standard Markdown images like `![alt](path)` to WordPress media URLs.
- Reuses the same uploaded image URL within a single publish operation when the same local image appears multiple times.
- Persists a media cache so unchanged images are not uploaded again on later publishes.
- Checks cached media URLs before reuse; missing media such as `404` or `410` is re-uploaded.
- Supports custom Aliyun OSS object key rules such as `{postTitle}/{fileName}`.
- Provides an Aliyun OSS test-upload button in settings for configuration diagnosis.
- Converts common Aliyun OSS XML errors into friendlier user-facing explanations while keeping the full raw response in logs.
- Removes Obsidian-rendered `referrerpolicy="no-referrer"` from image tags so OSS/CDN hotlink protection can receive the blog Referer.
- Strips query/hash from Aliyun OSS `Public base URL` before writing image URLs, avoiding temporary signed URL parameters in posts.
- Detects Aliyun OSS endpoint mismatch responses and asks whether to switch to the recommended endpoint automatically.
- Compresses supported local images before upload using a configurable quality setting.
- Shows a confirmation dialog when a prepared image upload exceeds the configurable large-image threshold.

## Supported Special Formats

The current converter handles these formats before uploading HTML to WordPress:

- Code blocks are rendered as HTML code blocks with normalized spacing, border, overflow behavior, and compact copy-button styling.
- Math formulas `$...$` and `$$...$$` are emitted with MathJax-compatible wrappers; WordPress needs MathJax or KaTeX enabled on the frontend.
- Mermaid code fences, ` ```mermaid `, are passed through Obsidian's native Markdown renderer so the published HTML contains the rendered diagram output instead of raw Mermaid source. New notes should use ` ```mermaid ` for diagrams such as `flowchart`, `sequenceDiagram`, `classDiagram`, `stateDiagram`, and `gantt`.
- Legacy ` ```flowchart ` or ` ```flow ` fences are accepted as compatibility aliases and emitted as preserved source blocks, but new notes should prefer ` ```mermaid `.
- Footnotes are rendered by Obsidian's Markdown renderer.
- Highlight `==text==` becomes `<mark>text</mark>`.
- Strikethrough `~~text~~` becomes `<del>text</del>`.
- Task lists are rendered by Obsidian's Markdown renderer.
- Tables are wrapped in a responsive container and receive inline border, header, padding, and zebra-striping styles for clearer WordPress rendering.
- Obsidian comments `%% comment %%` are removed before publishing.

## Aliyun OSS Notes

The current OSS implementation uses direct AccessKey signing inside the Obsidian plugin. This is acceptable for a personal local plugin, but a public plugin should later move to STS or backend-signed upload.

Object key rules support these tokens:

- `{postTitle}`
- `{fileName}`
- `{fileBaseName}`
- `{ext}`
- `{yyyy}`
- `{mm}`
- `{dd}`
- `{hash}`

Example rules:

```text
{postTitle}/{fileName}
obsidian/{yyyy}/{mm}/{postTitle}/{hash}-{fileName}
```

If OSS hotlink protection only allows your blog domain, configure `Test Referer` in settings before using the OSS test-upload button. Blog image URLs should usually use only your CDN or public OSS domain in `Public base URL`, for example `https://blogimg.example.com`. Do not paste temporary signed URLs containing `Expires`, `OSSAccessKeyId`, or `Signature`.

## Future Goals

Move items from this section into `Supported` when they are implemented.

### Content Conversion

- Convert Obsidian wiki links `[[note]]` and `[[note|label]]` to plain text or WordPress post links.
- Expand or link embedded notes like `![[another-note]]`.
- Upload non-image attachments such as PDF, audio, video, and ZIP files.
- Support featured image selection from note frontmatter or first image.
- Replace direct Aliyun AccessKey upload with STS/backend-signed upload for public plugin distribution.
- Add image resize controls in addition to quality compression.
- Render or snapshot Dataview query results.
- Render Mermaid diagrams to SVG or image instead of requiring WordPress frontend Mermaid JavaScript.
- Render math formulas to static KaTeX/MathJax HTML instead of requiring a WordPress frontend renderer.
- Provide WordPress-side CSS/JS support for generated HTML instead of relying only on inline styles.

### WordPress Publishing

- Support multiple WordPress site profiles.
- Allow each note to choose a target site through frontmatter.
- Support custom post types.
- Support WordPress custom fields.
- Support featured images.
- Support author selection.
- Detect slug conflicts before publishing.
- Cache category and tag lookups to reduce WordPress API requests.
- Add a publish preview step.

### Sync And Safety

- Add local-to-remote and remote-to-local sync workflows.
- Add conflict resolution strategies.
- Encrypt or otherwise protect stored Application Passwords beyond plain plugin data storage.
- Redact secrets from debug logs.
- Add retry and timeout controls for network failures.
- Check WordPress user permissions before publishing.

### Obsidian UX

- Add a ribbon icon.
- Add a file context menu publish action.
- Add a status bar publish button.
- Add publish progress UI.
- Add a dedicated log panel.
- Add a settings-page connection test button.
- Add category and tag fetching in settings or the metadata modal.
- Improve validation in the first-publish metadata modal.
- Add an action to open the published WordPress URL after success.

### Engineering

- Add unit tests.
- Add converter fixture tests.
- Add WordPress API mock tests.
- Add CI.
- Add release packaging scripts.
- Add Obsidian plugin release version management.
- Add typed error classes and more specific error messages.
- Add README screenshots and fuller installation instructions.

## Frontmatter Format

If the active note does not contain the required mapping fields, the plugin opens a modal and writes them to the note before publishing.

```yaml
---
wp_title: My WordPress Title
wp_slug: my-wordpress-title
wp_status: draft
wp_excerpt: Optional excerpt
wp_categories:
  - Tech
wp_tags:
  - obsidian
wp_post_id: 123
wp_url: https://example.com/my-wordpress-title/
wp_published_at: 2026-04-21T10:00:00
wp_updated_at: 2026-04-21T10:00:00
---
```

Required mapping fields:

- `wp_title`
- `wp_status`

## Development

Install dependencies:

```bash
npm install
```

Build:

```bash
npm run build
```

For local Obsidian testing, copy or symlink this folder into:

```text
<your-vault>/.obsidian/plugins/obsidian-to-wordpress
```

Then enable the plugin in Obsidian community plugin settings.

## Interfaces

See `docs/interfaces.md` for module boundaries and extension points.

## Enable Mermaid On WordPress

The plugin can publish Mermaid source blocks, but WordPress must load Mermaid JS on the frontend if diagrams are not pre-rendered to SVG.

Use this when your published page shows raw Mermaid code such as:

```html
<pre><code class="language-mermaid">flowchart LR...</code></pre>
```

### Recommended: Code Snippets Plugin

Install the WordPress plugin `Code Snippets`, then add a PHP snippet that runs on the frontend:

```php
add_action('wp_enqueue_scripts', function () {
    if (!is_singular()) {
        return;
    }

    wp_enqueue_script(
        'mermaid',
        'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js',
        array(),
        null,
        true
    );

    wp_add_inline_script('mermaid', <<<'JS'
document.addEventListener('DOMContentLoaded', function () {
  if (typeof mermaid === 'undefined') {
    return;
  }

  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'default'
  });

  document.querySelectorAll('pre code.language-mermaid, pre code.lang-mermaid').forEach(function (code) {
    var source = code.textContent || '';
    var pre = code.closest('pre');

    if (!pre || !source.trim()) {
      return;
    }

    var container = document.createElement('div');
    container.className = 'mermaid';
    container.textContent = source;

    pre.replaceWith(container);
  });

  mermaid.run({
    querySelector: '.mermaid'
  });
});
JS);
});
```

Save it and run it on the frontend or everywhere.

### Hotlink/CSP Notes

If your site has a Content Security Policy, allow scripts from:

```text
https://cdn.jsdelivr.net
```

If you do not want to use a CDN, download Mermaid JS and enqueue it from your own WordPress site or theme assets.

### Troubleshooting

Open the browser developer console on a published post and check:

```js
typeof mermaid
```

Expected result after Mermaid JS loads:

```js
"object"
```

Check whether the selector matches your theme/code-highlighter output:

```js
document.querySelectorAll('pre code.language-mermaid, pre code.lang-mermaid').length
```

If that returns `0`, inspect Mermaid-related code blocks:

```js
document.querySelectorAll('code[class*="mermaid"]').length
```

You can also inspect all `pre` blocks:

```js
document.querySelectorAll('pre').forEach((el, i) => console.log(i, el.innerText, el.outerHTML.slice(0, 300)))
```

If the PHP snippet seems unchanged:

- Clear WordPress cache.
- Clear LiteSpeed/Cloudflare cache if used.
- Hard-refresh the browser with `Cmd + Shift + R` on macOS.
- Check the page source for `mermaid.min.js`.
- Check the Network tab for a successful `mermaid.min.js` request.

## Secret Storage

Sensitive values are stored through a `SecretStore` abstraction. On Obsidian desktop, the plugin uses Electron `safeStorage` when available.

Encrypted values:

- WordPress Application Password
- Aliyun OSS AccessKey Secret

The normal plugin `data.json` stores only encrypted blobs in `encryptedSecrets` plus boolean flags such as `applicationPasswordSaved` and `accessKeySecretSaved`.

Platform behavior:

- macOS: Electron safeStorage uses Keychain-backed protection.
- Windows: Electron safeStorage uses DPAPI-backed protection.
- Linux: Electron safeStorage depends on the desktop secret store. If the backend is `basic_text`, the plugin shows a warning because protection is weak.

Security boundaries:

- This protects secrets at rest in the local plugin data file.
- This does not protect against malware running as the same OS user, malicious Obsidian plugins, or memory inspection while the plugin is running.
- Debug logs redact common secret fields and signed URL parameters, but avoid sharing logs unless necessary.

Migration:

- If old plaintext values are found in plugin settings, they are migrated into encrypted storage on load and then removed from plaintext settings.

## Local API And MCP Bridge

The plugin can expose a localhost-only API so MCP clients such as Codex can ask the open Obsidian app to publish notes. This intentionally depends on Obsidian being open and the plugin being enabled.

Security defaults:

- The API is disabled by default.
- It listens on `127.0.0.1` only.
- The listening port is configurable in plugin settings. Default: `27187`.
- API requests require `Authorization: Bearer <api-key>`.
- The API key is generated in plugin settings and shown only once. If you forget it, generate a new key; the old key is invalidated.
- The API key itself is never stored in plugin data. Only a salted SHA-256 hash and salt are saved for verification.
- Interactive Obsidian modals from API calls are disabled by default.
- Destructive API actions are reserved behind a separate setting and are not enabled by the first MCP tools.

Plugin settings:

1. Open Obsidian settings.
2. Open `Obsidian to WordPress`.
3. Find `Local API / MCP`.
4. Enable `Enable local API`.
5. Confirm or change `API port`.
6. Click `Generate` for the API key and copy it immediately.

Available local API endpoints:

```http
GET  /health
GET  /published-posts
POST /publish-current
POST /publish-note
POST /post-status
POST /change-status
POST /unpublish
POST /delete-post
```

All note-specific endpoints accept a vault-relative `path`. If `path` is omitted, the current active note is used. Destructive endpoints such as `/unpublish` and `/delete-post` require `Allow destructive API actions` to be enabled in Obsidian settings.

Example API request:

```bash
curl -X POST http://127.0.0.1:27187/publish-note \
  -H 'Authorization: Bearer YOUR_API_KEY' \
  -H 'Content-Type: application/json' \
  -d '{"path":"folder/note.md","status":"draft","overwriteRemoteChanges":false}'
```

Build the MCP bridge:

```bash
npm run build:mcp
```

Example MCP configuration:

```json
{
  "mcpServers": {
    "obsidian-to-wordpress": {
      "command": "node",
      "args": ["/absolute/path/to/obsidian-to-wordpress/dist/mcp-server.js"],
      "env": {
        "OTW_API_BASE_URL": "http://127.0.0.1:27187",
        "OTW_API_KEY": "paste-the-one-time-shown-api-key-here"
      }
    }
  }
}
```

MCP tools currently exposed:

- `obsidian_wordpress_health`
- `list_published_obsidian_posts`
- `publish_current_obsidian_note`
- `publish_obsidian_note`
- `get_obsidian_wordpress_post_status`
- `change_obsidian_wordpress_post_status`
- `unpublish_obsidian_wordpress_post`
- `delete_obsidian_wordpress_post`

Detailed MCP setup templates are available in `docs/mcp-configuration.md`.
