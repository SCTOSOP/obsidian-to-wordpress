# Obsidian to WordPress

[English](README.md) | 中文

这是一个 Obsidian 插件，用于把当前打开的 Obsidian 笔记发布到自建 WordPress 站点。插件通过 WordPress REST API 工作，认证方式使用 WordPress Application Passwords。

## 发布状态

当前版本目标：`1.1.1-beta`。

这是一个早期测试版本，重点是验证完整发布链路、安全存储和常用内容渲染。后续功能会逐步补齐。

## 已支持

- 从 Obsidian 命令面板一键发布当前笔记。
- 发布前将 Obsidian Markdown 转成 HTML，再发送到 WordPress，避免 Markdown 源码直接暴露在网页上。
- 首次发布时创建 WordPress 文章。
- 后续发布时通过 `wp_post_id` 更新同一篇远端文章。
- 覆盖前检查远端 WordPress `modified` 时间；如果远端文章已被修改，会先询问是否继续覆盖。
- 支持查看远端文章状态、撤回为草稿、删除或移入回收站。
- 支持修改当前笔记的 WordPress 发布状态，因此首次发布为 `draft` 后，也可以改为 `publish`、`private` 或 `pending` 后再次发布。
- 首次发布界面从 WordPress 拉取分类，用户可以直接选择分类，而不是手动填写。
- 分类以父类/子类层级显示。
- 支持在发布界面添加 WordPress 分类，并可选择父分类。
- 支持在发布界面删除 WordPress 分类。
- 发布后把 WordPress 文章 ID、URL、发布时间、更新时间写回笔记 frontmatter。
- 提供插件设置页，用于配置站点地址、用户名、Application Password、默认发布状态、调试模式等。
- 推送失败时会在 Obsidian 中弹窗显示本次错误日志。
- 只有开启调试模式时，插件和 MCP 才会写入详细日志文件。
- 调试模式位于设置页最下方，开启后可一键复制日志文件路径。
- 发布前上传本地图片，并把文章中的本地图片链接替换为远端 URL。
- 图片存储提供方支持 WordPress 媒体库和阿里云 OSS。
- 支持 Obsidian 图片嵌入语法，例如 `![[image.png]]`。
- 支持本地 Markdown 图片语法，例如 `![alt](path)`。
- 同一次发布中，同一张本地图片只上传一次。
- 使用独立 JSONL 文件持久化图片缓存，避免缓存记录持续写入 `data.json`；后续发布时未变化的图片不会重复上传。
- 复用缓存前会检查远端媒体 URL；如果返回 `404` 或 `410` 等资源缺失状态，会重新上传。
- 支持自定义阿里云 OSS 对象路径规则，例如 `{postTitle}/{fileName}`。
- 设置页提供阿里云 OSS 测试上传按钮，方便排查 OSS 配置问题。
- 对常见阿里云 OSS XML 错误提供更友好的解释。
- 自动移除 Obsidian 渲染出的 `referrerpolicy="no-referrer"`，让 OSS/CDN 防盗链可以收到博客页面的 Referer。
- 写入文章前会移除阿里云 OSS `Public base URL` 中的 query/hash，避免临时签名参数进入正文。
- 能识别阿里云 OSS endpoint 地域不匹配错误，并询问是否自动切换到推荐 endpoint。
- 支持按设置的质量压缩本地图片后再上传。
- 当待上传图片超过设置的大文件阈值时，会弹窗确认是否继续上传。

## 支持的特殊格式

当前转换器会在发布到 WordPress 前处理这些格式：

- 代码块：渲染为 HTML 代码块，并规范化间距、边框、横向滚动、Prism 友好的语言类和复制按钮样式。
- 数学公式：`$...$` 和 `$$...$$` 会输出为兼容 MathJax 的结构；WordPress 前端需要启用 MathJax 或 KaTeX。
- 数学公式占位符会避开 Markdown 强调语法和 HTML 属性，标题中的行内公式不会污染 `data-heading`，也不会留下数字占位符碎片。
- Mermaid：推荐使用 ` ```mermaid ` 代码块；由 Obsidian Markdown 渲染器处理，适用于 `flowchart`、`sequenceDiagram`、`classDiagram`、`stateDiagram`、`gantt` 等 Mermaid 图。
- 兼容旧语法：` ```flowchart ` 或 ` ```flow ` 会作为兼容别名保留源码块；新笔记建议统一使用 ` ```mermaid `。
- 脚注：由 Obsidian Markdown 渲染器处理。
- 高亮：`==text==` 转为 `<mark>text</mark>`。
- 删除线：`~~text~~` 转为 `<del>text</del>`。
- 任务列表：由 Obsidian Markdown 渲染器处理。
- 表格：包裹为响应式容器，并加入边框、表头、内边距和斑马纹样式，改善 WordPress 上的可读性。
- Obsidian 注释：`%% comment %%` 会在发布前移除。

## 安装

从 GitHub Release 下载插件文件：

- `main.js`
- `manifest.json`
- 或 `obsidian-to-wordpress-1.1.1-beta.zip`

把插件放入你的库：

```text
<your-vault>/.obsidian/plugins/obsidian-to-wordpress
```

然后在 Obsidian 的第三方插件设置中启用 `Obsidian to WordPress`。

## WordPress 准备

你需要一个自建 WordPress 站点，并启用 WordPress REST API。认证使用 WordPress Application Passwords。

在 WordPress 后台创建 Application Password：

1. 进入用户个人资料页面。
2. 找到 Application Passwords。
3. 创建一个新密码。
4. 把生成的密码填入插件设置页。

插件需要当前 WordPress 用户具备创建、编辑、删除文章，以及读取/管理分类的权限。

## 插件设置

主要设置项：

- `Site URL`：WordPress 站点地址，例如 `https://example.com`。
- `Username`：WordPress 用户名。
- `Application Password`：WordPress Application Password。
- `Default status`：默认发布状态，例如 `draft` 或 `publish`。
- `Debug mode`：设置页最下方的黄色警示项；开启后把详细插件日志与 MCP 日志写入文件，并显示复制日志路径按钮。Obsidian 只在推送失败时弹窗显示本次错误日志。
- `Image storage provider`：选择 WordPress 媒体库或阿里云 OSS。
- `Image compression quality`：图片压缩质量。
- `Large image threshold`：大文件提醒阈值。

## 发布流程

第一次发布某篇笔记时，如果没有找到必要的 `wp_*` 字段，插件会打开发布信息填写窗口。

你需要填写或选择：

- 标题
- slug
- 发布状态
- 摘要
- 分类
- 标签

确认后，插件会把这些映射字段保存到笔记 frontmatter。以后再次发布同一篇笔记时，会读取这些字段，并更新已存在的 WordPress 文章。

## Frontmatter 格式

示例：

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

必要字段：

- `wp_title`
- `wp_status`

插件管理的远端发布字段包括：

- `wp_post_id`
- `wp_url`
- `wp_published_at`
- `wp_updated_at`
- `wp_title`
- `wp_slug`
- `wp_status`
- `wp_excerpt`
- `wp_categories`
- `wp_tags`

删除远端文章后，插件会清理这些发布相关字段。

## 图片上传

插件会在发布前解析本地图片，并上传到当前选择的图片存储提供方。

已支持的图片语法：

```markdown
![[image.png]]
![alt](attachments/image.png)
```

当前仅处理图片。视频、PDF、音频、ZIP 等附件会在后续版本实现。

## 阿里云 OSS

当前 OSS 实现是在 Obsidian 插件内直接使用 AccessKey 签名上传。对于个人本地插件可以接受，但如果作为公开插件长期分发，后续应改为 STS 或后端签名上传。

对象路径规则支持这些变量：

- `{postTitle}`
- `{fileName}`
- `{fileBaseName}`
- `{ext}`
- `{yyyy}`
- `{mm}`
- `{dd}`
- `{hash}`

示例：

```text
{postTitle}/{fileName}
obsidian/{yyyy}/{mm}/{postTitle}/{hash}-{fileName}
```

如果 OSS 开启了防盗链，并且只允许你的博客域名访问图片，请在设置页配置 `Test Referer` 后再使用 OSS 测试上传。

`Public base URL` 通常应填写你的 CDN 域名或公开 OSS 访问域名，例如：

```text
https://blogimg.example.com
```

不要填写包含 `Expires`、`OSSAccessKeyId`、`Signature` 的临时签名 URL。

## Mermaid 前端渲染

如果 WordPress 页面中 Mermaid 没有被渲染，而是显示源码，说明 WordPress 前端没有加载 Mermaid JS，或主题/代码高亮插件改变了代码块结构。

推荐使用 WordPress 插件 `Code Snippets` 添加前端 PHP 片段：

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

保存后选择在前端运行。如果仍未生效，请清理 WordPress 缓存、LiteSpeed/Cloudflare 缓存，并在浏览器开发者工具中检查是否加载了 `mermaid.min.js`。

## WordPress 前端代码高亮

插件发布代码块时，会尽量把语言类规范化为 Prism 友好的形式，例如：

```html
<pre class="language-cpp"><code class="language-cpp">...</code></pre>
```

但 WordPress 端仍然需要加载前端高亮器。推荐使用 Prism.js。

### 推荐：使用 Code Snippets 添加 PHP

安装 WordPress 插件 `Code Snippets`，然后添加一个前端运行的 PHP 片段：

```php
function otw_enqueue_prism_assets() {
    if (!is_singular()) {
        return;
    }

    wp_enqueue_style(
        'prism-theme',
        'https://cdn.jsdelivr.net/npm/prismjs@1/themes/prism-tomorrow.min.css',
        array(),
        '1.29.0'
    );

    wp_enqueue_script(
        'prism-core',
        'https://cdn.jsdelivr.net/npm/prismjs@1/components/prism-core.min.js',
        array(),
        '1.29.0',
        true
    );

    wp_enqueue_script(
        'prism-clike',
        'https://cdn.jsdelivr.net/npm/prismjs@1/components/prism-clike.min.js',
        array('prism-core'),
        '1.29.0',
        true
    );

    wp_enqueue_script(
        'prism-c',
        'https://cdn.jsdelivr.net/npm/prismjs@1/components/prism-c.min.js',
        array('prism-clike'),
        '1.29.0',
        true
    );

    wp_enqueue_script(
        'prism-cpp',
        'https://cdn.jsdelivr.net/npm/prismjs@1/components/prism-cpp.min.js',
        array('prism-c'),
        '1.29.0',
        true
    );

    wp_enqueue_script(
        'prism-javascript',
        'https://cdn.jsdelivr.net/npm/prismjs@1/components/prism-javascript.min.js',
        array('prism-core'),
        '1.29.0',
        true
    );

    wp_enqueue_script(
        'prism-css',
        'https://cdn.jsdelivr.net/npm/prismjs@1/components/prism-css.min.js',
        array('prism-core'),
        '1.29.0',
        true
    );

    wp_enqueue_script(
        'prism-markup-templating',
        'https://cdn.jsdelivr.net/npm/prismjs@1/components/prism-markup-templating.min.js',
        array('prism-core'),
        '1.29.0',
        true
    );

    wp_enqueue_script(
        'prism-php',
        'https://cdn.jsdelivr.net/npm/prismjs@1/components/prism-php.min.js',
        array('prism-core', 'prism-markup-templating'),
        '1.29.0',
        true
    );

    wp_add_inline_script(
        'prism-php',
        'document.addEventListener("DOMContentLoaded", function () { if (window.Prism) Prism.highlightAll(); });'
    );
}
add_action('wp_enqueue_scripts', 'otw_enqueue_prism_assets');
```

### 注意事项

- `cpp` 需要先加载 `c`，`c` 需要先加载 `clike`。
- `php` 需要依赖 `markup-templating`。
- 使用缓存插件或 CDN 时，添加 Snippet 后请清缓存。
- 如果你的网站不允许从 CDN 加载资源，就把 Prism 下载到你自己的站点再 enqueue。

### 排查方法

在浏览器控制台执行：

```js
typeof Prism
```

预期结果：

```js
"object"
```

再检查页面中的代码块语言类是否正常：

```js
document.querySelectorAll('pre code.language-cpp, pre code.language-javascript, pre code.language-php, pre code.language-css').length
```

如果 Prism 已经加载，但代码依旧是纯文本，请检查代码块类名是不是 `language-cpp` 这种标准形式，而不是 `language-C++` 或 `language-none`。

## 密钥存储

敏感信息通过 `SecretStore` 抽象保存。Obsidian 桌面端会优先使用 Electron `safeStorage`。

加密保存的字段：

- WordPress Application Password
- 阿里云 OSS AccessKey Secret

普通插件 `data.json` 中只保存加密后的内容，以及 `applicationPasswordSaved`、`accessKeySecretSaved` 这类状态标记。

平台行为：

- macOS：Electron safeStorage 使用 Keychain 支撑。
- Windows：Electron safeStorage 使用 DPAPI 支撑。
- Linux：Electron safeStorage 依赖桌面 secret store；如果后端是 `basic_text`，插件会提示保护较弱。

安全边界：

- 该方案保护的是本地插件数据文件中的静态密钥。
- 该方案不能防御同一系统用户下运行的恶意软件、恶意 Obsidian 插件，或运行时内存读取。
- 调试日志只会在开启 `Debug mode` 时写入文件；推送失败弹窗即使未开启调试模式也会显示本次错误日志。
- 日志会尽量脱敏常见密钥字段和签名 URL 参数，但仍不建议随意公开完整日志。

如果旧版本设置中存在明文密钥，插件会在安全存储可用时迁移到加密存储，并移除明文字段。

## 开发

安装依赖：

```bash
npm install
```

构建：

```bash
npm run build
```

本地测试时，把仓库复制或软链接到：

```text
<your-vault>/.obsidian/plugins/obsidian-to-wordpress
```

然后在 Obsidian 第三方插件设置中启用插件。

## 接口文档

模块边界和扩展点见：

```text
docs/interfaces.md
```

## 后续目标

这些功能尚未完成。完成后应从本节移动到“已支持”。

### 内容转换

- 将 Obsidian wiki 链接 `[[note]]` 和 `[[note|label]]` 转为纯文本或 WordPress 文章链接。
- 展开或链接嵌入笔记，例如 `![[another-note]]`。
- 上传非图片附件，例如 PDF、音频、视频、ZIP。
- 从 frontmatter 或首图选择特色图片。
- 用 STS 或后端签名上传替代插件内直接使用阿里云 AccessKey。
- 增加图片尺寸调整控制。
- 渲染或快照 Dataview 查询结果。
- 将 Mermaid 渲染为 SVG 或图片，避免依赖 WordPress 前端 Mermaid JS。
- 将数学公式渲染为静态 KaTeX/MathJax HTML，避免依赖 WordPress 前端渲染器。
- 提供 WordPress 侧 CSS/JS 支持，而不只依赖内联样式。

### WordPress 发布

- 支持多个 WordPress 站点配置。
- 每篇笔记可通过 frontmatter 指定目标站点。
- 支持自定义文章类型。
- 支持 WordPress 自定义字段。
- 支持特色图片。
- 支持作者选择。
- 发布前检测 slug 冲突。
- 缓存分类和标签查询，减少 WordPress API 请求。
- 增加发布预览步骤。

### 同步与安全

- 增加本地到远端、远端到本地的同步工作流。
- 增加冲突解决策略。
- 增加网络失败重试和超时控制。
- 发布前检查 WordPress 用户权限。

### Obsidian 体验

- 增加左侧 Ribbon 图标。
- 增加文件右键菜单发布动作。
- 增加状态栏发布按钮。
- 增加发布进度 UI。
- 增加独立日志面板。
- 增加设置页连接测试按钮。
- 改进首次发布元数据窗口的校验。
- 发布成功后增加打开 WordPress URL 的动作。

### 工程化

- 增加单元测试。
- 增加转换器 fixture 测试。
- 增加 WordPress API mock 测试。
- 增加 CI。
- 增加发布打包脚本。
- 增加 Obsidian 插件版本管理流程。
- 增加类型化错误和更细粒度错误信息。
- 增加 README 截图和更完整安装说明。

## 本地 API 与 MCP Bridge

插件可以开放一个仅限 localhost 的本地 API，让 Codex 等 MCP Client 请求已经打开的 Obsidian 插件发布文章。这个设计明确依赖 Obsidian 已打开，并且当前库已启用本插件。

安全默认值：

- 本地 API 默认关闭。
- 只监听 `127.0.0.1`。
- 监听端口可以在插件设置中修改，默认是 `27187`。
- API 请求必须携带 `Authorization: Bearer <api-key>`。
- API key 在插件设置中自动生成，并且只显示一次。如果忘记，只能重新生成；旧 key 会立即失效。
- API key 明文本身不会写入插件数据文件。插件只保存 salted SHA-256 hash 和 salt，用于请求校验。
- API 触发 Obsidian 交互弹窗默认关闭。
- 删除等破坏性 API 行为由独立开关控制，默认关闭。

启用方式：

1. 打开 Obsidian 设置。
2. 进入 `Obsidian to WordPress` 插件设置页。
3. 找到 `Local API / MCP`。
4. 打开 `Enable local API`。
5. 确认或修改 `API port`。
6. 点击 `Generate` 生成 API key，并立即复制保存。

当前本地 API：

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

所有与笔记相关的接口都支持 vault 相对路径 `path`。如果不传 `path`，则使用当前打开的笔记。`/unpublish` 和 `/delete-post` 等破坏性接口需要先在 Obsidian 设置中开启 `Allow destructive API actions`。

API 调用示例：

```bash
curl -X POST http://127.0.0.1:27187/publish-note \
  -H 'Authorization: Bearer YOUR_API_KEY' \
  -H 'Content-Type: application/json' \
  -d '{"path":"folder/note.md","status":"draft","overwriteRemoteChanges":false}'
```

构建 MCP bridge：

```bash
npm run build:mcp
```

MCP 配置示例：

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

当前 MCP 工具：

- `obsidian_wordpress_health`
- `list_published_obsidian_posts`
- `publish_current_obsidian_note`
- `publish_obsidian_note`
- `get_obsidian_wordpress_post_status`
- `change_obsidian_wordpress_post_status`
- `unpublish_obsidian_wordpress_post`
- `delete_obsidian_wordpress_post`

更完整的 MCP 配置模板见 `docs/mcp-configuration.md`。
