import type { Logger } from "./types";

export interface MarkdownSpecialFormatTransformer {
  beforeRender(markdown: string): string;
  afterRender(html: string): string;
}

type PlaceholderKind = "flowchart" | "math-block" | "math-inline";

interface Placeholder {
  token: string;
  kind: PlaceholderKind;
  value: string;
}

export class ObsidianSpecialFormatTransformer implements MarkdownSpecialFormatTransformer {
  private placeholders: Placeholder[] = [];

  constructor(private logger: Logger) {}

  beforeRender(markdown: string): string {
    this.placeholders = [];
    this.logger.info("Applying Obsidian special-format preprocessing");

    const chunks = splitByFencedCodeBlocks(markdown);
    return chunks.map((chunk) => {
      if (chunk.kind === "fence") {
        return this.processFence(chunk.text);
      }

      return this.processMarkdownText(chunk.text);
    }).join("");
  }

  afterRender(html: string): string {
    this.logger.info("Applying Obsidian special-format HTML postprocessing", {
      placeholders: this.placeholders.map((placeholder) => placeholder.kind),
    });

    let output = html;
    for (const placeholder of this.placeholders) {
      output = replaceRenderedPlaceholder(output, placeholder.token, renderPlaceholder(placeholder));
    }

    return normalizeCodeBlocks(normalizeTables(normalizeRenderedImages(normalizeAdmonitionCallouts(output))));
  }

  private processFence(fence: string): string {
    const match = fence.match(/^(```|~~~)([^\n]*)\n([\s\S]*?)\n\1[ \t]*$/);
    if (!match) return fence;

    const language = match[2].trim().split(/\s+/)[0]?.toLowerCase();
    const body = match[3];
    if (language === "mermaid") return fence;
    if (language === "flowchart" || language === "flow") return this.createPlaceholder("flowchart", body);

    return fence;
  }

  private processMarkdownText(text: string): string {
    return transformInlineFormatting(
      protectMath(removeObsidianComments(text), (kind, value) => this.createPlaceholder(kind, value)),
    );
  }

  private createPlaceholder(kind: PlaceholderKind, value: string): string {
    const token = `OWP_SPECIAL_FORMAT_${this.placeholders.length}`;
    this.placeholders.push({ token, kind, value });
    return token;
  }
}

interface MarkdownChunk {
  kind: "text" | "fence";
  text: string;
}

function splitByFencedCodeBlocks(markdown: string): MarkdownChunk[] {
  const chunks: MarkdownChunk[] = [];
  const fenceRegex = /(^|\n)(```|~~~)[^\n]*\n[\s\S]*?\n\2[ \t]*(?=\n|$)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = fenceRegex.exec(markdown)) !== null) {
    const fenceStart = match.index + match[1].length;
    if (fenceStart > lastIndex) {
      chunks.push({ kind: "text", text: markdown.slice(lastIndex, fenceStart) });
    }
    chunks.push({ kind: "fence", text: markdown.slice(fenceStart, fenceRegex.lastIndex) });
    lastIndex = fenceRegex.lastIndex;
  }

  if (lastIndex < markdown.length) {
    chunks.push({ kind: "text", text: markdown.slice(lastIndex) });
  }

  return chunks;
}

function removeObsidianComments(markdown: string): string {
  return markdown.replace(/%%[\s\S]*?%%/g, "");
}

function protectMath(markdown: string, createPlaceholder: (kind: PlaceholderKind, value: string) => string): string {
  const blockProtected = markdown.replace(/\$\$\s*([\s\S]*?)\s*\$\$/g, (_match, body: string) => {
    return createPlaceholder("math-block", body);
  });

  return blockProtected.replace(/(^|[^\\$])\$([^\n$]+?)\$/g, (_match, prefix: string, body: string) => {
    return `${prefix}${createPlaceholder("math-inline", body)}`;
  });
}

function transformInlineFormatting(markdown: string): string {
  return markdown
    .replace(/==([^=\n][^\n]*?)==/g, (_match, body: string) => `<mark>${body}</mark>`)
    .replace(/~~([^~\n][^\n]*?)~~/g, (_match, body: string) => `<del>${body}</del>`);
}

function replaceRenderedPlaceholder(html: string, token: string, replacement: string): string {
  const escapedToken = escapeRegExp(token);
  return html
    .replace(new RegExp(`<p>\\s*${escapedToken}\\s*</p>`, "g"), replacement)
    .replace(new RegExp(escapedToken, "g"), replacement);
}

function normalizeCodeBlocks(html: string): string {
  const container = document.createElement("div");
  container.innerHTML = html;

  let codeBlockIndex = 0;
  container.querySelectorAll<HTMLElement>("pre").forEach((pre) => {
    const code = pre.querySelector<HTMLElement>("code");
    if (!code) return;
    normalizeCodeLanguageClasses(pre, code);

    const copySourceId = `owp-code-source-${codeBlockIndex++}`;
    code.id = copySourceId;
    const copyToastId = `owp-code-toast-${codeBlockIndex}`;

    pre.classList.add("owp-code-block");
    appendInlineStyle(pre, [
      "position:relative",
      "box-sizing:border-box",
      "overflow:auto",
      "padding:1em",
      "padding-right:3.25em",
      "border:1px solid rgba(0,0,0,0.12)",
      "border-radius:8px",
      "background:#f7f7f8",
      "line-height:1.55",
      "color:#1f2937",
      "font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, monospace",
    ]);

    appendInlineStyle(code, [
      "display:block",
      "overflow-x:auto",
      "white-space:pre",
      "background:transparent",
      "color:#1f2937",
      "font-family:inherit",
      "font-size:0.95em",
    ]);

    normalizeCodeHighlightTokens(code);

    const copyToast = document.createElement("span");
    copyToast.id = copyToastId;
    copyToast.textContent = "Copied";
    copyToast.setAttribute("aria-hidden", "true");
    appendInlineStyle(copyToast, [
      "position:absolute",
      "top:0.8em",
      "right:3.35em",
      "padding:0.22em 0.55em",
      "border-radius:999px",
      "background:#111827",
      "color:#ffffff",
      "font-size:0.75em",
      "line-height:1.2",
      "white-space:nowrap",
      "box-shadow:0 2px 8px rgba(0,0,0,0.18)",
      "opacity:0",
      "transform:translateY(-4px)",
      "pointer-events:none",
      "transition:opacity 140ms ease, transform 140ms ease",
    ]);
    pre.appendChild(copyToast);

    pre.querySelectorAll<HTMLElement>(".copy-code-button").forEach((button) => {
      const copyScript = buildCopyButtonScript(copySourceId, copyToastId);
      button.setAttribute("type", "button");
      button.setAttribute("aria-label", button.getAttribute("aria-label") || "Copy code");
      button.setAttribute("title", button.getAttribute("title") || "Copy code");
      button.setAttribute("onclick", copyScript);
      appendInlineStyle(button, [
        "position:absolute",
        "top:0.55em",
        "right:0.55em",
        "display:inline-flex",
        "align-items:center",
        "justify-content:center",
        "width:2em",
        "height:2em",
        "min-width:2em",
        "min-height:2em",
        "padding:0",
        "margin:0",
        "border:1px solid rgba(0,0,0,0.16)",
        "border-radius:6px",
        "background:#ffffff",
        "color:#455a64",
        "line-height:1",
        "box-shadow:0 1px 2px rgba(0,0,0,0.08)",
        "cursor:pointer",
      ]);
    });

    pre.querySelectorAll<SVGElement>(".copy-code-button svg").forEach((svg) => {
      svg.setAttribute("width", "16");
      svg.setAttribute("height", "16");
      appendInlineStyle(svg, [
        "display:block",
        "width:1em",
        "height:1em",
        "max-width:1em",
        "max-height:1em",
        "min-width:0",
        "min-height:0",
      ]);
    });
  });

  return container.innerHTML;
}

function normalizeCodeHighlightTokens(code: HTMLElement): void {
  const tokenStyles: Array<[selector: string, styles: string[]]> = [
    [".token.comment, .token.prolog, .token.doctype, .token.cdata", ["color:#6b7280", "font-style:italic"]],
    [".token.punctuation, .token.operator", ["color:#475569"]],
    [".token.property, .token.tag, .token.boolean, .token.number, .token.constant, .token.symbol, .token.deleted", ["color:#b91c1c"]],
    [".token.selector, .token.attr-name, .token.string, .token.char, .token.builtin, .token.inserted", ["color:#047857"]],
    [".token.atrule, .token.attr-value, .token.keyword", ["color:#7c3aed", "font-weight:600"]],
    [".token.function, .token.class-name", ["color:#1d4ed8"]],
    [".token.regex, .token.important, .token.variable", ["color:#c2410c"]],
    [".token.url", ["color:#0f766e", "text-decoration:underline"]],
  ];

  for (const [selector, styles] of tokenStyles) {
    code.querySelectorAll<HTMLElement>(selector).forEach((token) => appendInlineStyle(token, styles));
  }
}

function normalizeCodeLanguageClasses(pre: HTMLElement, code: HTMLElement): void {
  const normalizedLanguage = detectNormalizedLanguage(pre, code);
  stripLanguageClasses(pre);
  stripLanguageClasses(code);

  if (!normalizedLanguage) return;

  pre.classList.add(`language-${normalizedLanguage}`);
  code.classList.add(`language-${normalizedLanguage}`);
}

function detectNormalizedLanguage(pre: HTMLElement, code: HTMLElement): string | undefined {
  const classes = [
    ...Array.from(pre.classList),
    ...Array.from(code.classList),
  ];

  for (const className of classes) {
    const raw = extractLanguageName(className);
    if (!raw) continue;
    const normalized = normalizeLanguageName(raw);
    if (normalized) return normalized;
  }

  return undefined;
}

function extractLanguageName(className: string): string | undefined {
  if (className.startsWith("language-")) return className.slice("language-".length);
  if (className.startsWith("lang-")) return className.slice("lang-".length);
  return undefined;
}

function stripLanguageClasses(element: HTMLElement): void {
  Array.from(element.classList).forEach((className) => {
    if (className === "language-none" || className.startsWith("language-") || className.startsWith("lang-")) {
      element.classList.remove(className);
    }
  });
}

function normalizeLanguageName(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.toLowerCase() === "none") return undefined;

  const aliases: Record<string, string> = {
    "c++": "cpp",
    "cpp": "cpp",
    "c#": "csharp",
    "cs": "csharp",
    "js": "javascript",
    "ts": "typescript",
    "shell": "bash",
    "sh": "bash",
    "html": "markup",
    "xml": "markup",
  };

  const lowered = trimmed.toLowerCase();
  return aliases[lowered] ?? lowered.replace(/[^a-z0-9_-]+/g, "");
}

function buildCopyButtonScript(copySourceId: string, copyToastId: string): string {
  const escapedId = JSON.stringify(copySourceId);
  const escapedToastId = JSON.stringify(copyToastId);
  return [
    "(function(button){",
    `var source=document.getElementById(${escapedId});`,
    `var toast=document.getElementById(${escapedToastId});`,
    "if(!source)return;",
    "var text=source.innerText||source.textContent||'';",
    "var onSuccess=function(){var original=button.title||'Copy code';button.title='Copied';button.setAttribute('aria-label','Copied');if(toast){toast.style.opacity='1';toast.style.transform='translateY(0)';clearTimeout(button.__owpCopyToastTimer);button.__owpCopyToastTimer=setTimeout(function(){toast.style.opacity='0';toast.style.transform='translateY(-4px)';},1200);}setTimeout(function(){button.title=original;button.setAttribute('aria-label',original);},1200);};",
    "if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(text).then(onSuccess).catch(function(){});return;}",
    "var area=document.createElement('textarea');area.value=text;area.setAttribute('readonly','readonly');area.style.position='fixed';area.style.opacity='0';document.body.appendChild(area);area.select();try{document.execCommand('copy');onSuccess();}finally{document.body.removeChild(area);}",
    "})(this);",
  ].join("");
}

function normalizeTables(html: string): string {
  const container = document.createElement("div");
  container.innerHTML = html;

  container.querySelectorAll<HTMLTableElement>("table").forEach((table) => {
    if (!table.parentElement?.classList.contains("owp-table-wrapper")) {
      const wrapper = document.createElement("div");
      wrapper.className = "owp-table-wrapper";
      appendInlineStyle(wrapper, [
        "width:100%",
        "overflow-x:auto",
        "margin:1.25em 0",
        "border:1px solid rgba(0,0,0,0.12)",
        "border-radius:10px",
        "box-shadow:0 1px 2px rgba(0,0,0,0.04)",
      ]);
      table.parentNode?.insertBefore(wrapper, table);
      wrapper.appendChild(table);
    }

    table.classList.add("owp-table");
    appendInlineStyle(table, [
      "width:100%",
      "border-collapse:collapse",
      "border-spacing:0",
      "margin:0",
      "font-size:0.95em",
      "line-height:1.6",
    ]);

    table.querySelectorAll<HTMLTableCellElement>("th").forEach((cell) => {
      appendInlineStyle(cell, [
        "padding:0.75em 0.9em",
        "border:1px solid rgba(0,0,0,0.14)",
        "background:#f3f6f8",
        "color:#263238",
        "font-weight:700",
        "text-align:left",
        "vertical-align:top",
      ]);
    });

    table.querySelectorAll<HTMLTableCellElement>("td").forEach((cell) => {
      appendInlineStyle(cell, [
        "padding:0.75em 0.9em",
        "border:1px solid rgba(0,0,0,0.12)",
        "vertical-align:top",
      ]);
    });

    table.querySelectorAll<HTMLTableRowElement>("tbody tr:nth-child(even)").forEach((row) => {
      appendInlineStyle(row, ["background:rgba(0,0,0,0.025)"]);
    });
  });

  return container.innerHTML;
}

function normalizeRenderedImages(html: string): string {
  const container = document.createElement("div");
  container.innerHTML = html;

  container.querySelectorAll<HTMLImageElement>("img").forEach((image) => {
    if (image.getAttribute("referrerpolicy") === "no-referrer") {
      image.removeAttribute("referrerpolicy");
    }
  });

  return container.innerHTML;
}

function normalizeAdmonitionCallouts(html: string): string {
  const container = document.createElement("div");
  container.innerHTML = html;

  container.querySelectorAll<HTMLElement>(".callout.admonition, .admonition").forEach((callout) => {
    const calloutType = getCalloutType(callout);
    const color = callout.style.getPropertyValue("--callout-color") || calloutColor(calloutType);

    callout.classList.add("owp-callout", `owp-callout-${calloutType}`);
    appendInlineStyle(callout, [
      "box-sizing:border-box",
      "margin:1.25em 0",
      "padding:0",
      "border:1px solid rgba(" + color + ",0.25)",
      "border-left:4px solid rgb(" + color + ")",
      "border-radius:8px",
      "background:rgba(" + color + ",0.06)",
      "overflow:hidden",
    ]);

    callout.querySelectorAll<HTMLElement>(".callout-title, .admonition-title").forEach((title) => {
      title.classList.add("owp-callout-title");
      appendInlineStyle(title, [
        "box-sizing:border-box",
        "display:flex",
        "align-items:center",
        "gap:0.5em",
        "padding:0.7em 0.9em",
        "font-weight:600",
        "line-height:1.35",
        "color:rgb(" + color + ")",
      ]);
    });

    callout.querySelectorAll<HTMLElement>(".callout-icon, .admonition-title-icon").forEach((icon) => {
      icon.classList.add("owp-callout-icon");
      appendInlineStyle(icon, [
        "display:inline-flex",
        "align-items:center",
        "justify-content:center",
        "width:1.1em",
        "height:1.1em",
        "min-width:1.1em",
        "line-height:1",
        "flex:0 0 auto",
      ]);
    });

    callout.querySelectorAll<SVGElement>(".callout-icon svg, .admonition-title-icon svg").forEach((svg) => {
      svg.setAttribute("width", "16");
      svg.setAttribute("height", "16");
      svg.setAttribute("aria-hidden", "true");
      svg.setAttribute("focusable", "false");
      appendInlineStyle(svg, [
        "display:block",
        "width:1em",
        "height:1em",
        "max-width:1em",
        "max-height:1em",
        "min-width:0",
        "min-height:0",
        "flex:0 0 auto",
      ]);
    });

    callout.querySelectorAll<HTMLElement>(".callout-content, .admonition-content").forEach((content) => {
      content.classList.add("owp-callout-content");
      appendInlineStyle(content, [
        "box-sizing:border-box",
        "padding:0.8em 0.9em",
        "line-height:1.65",
      ]);
    });
  });

  return container.innerHTML;
}

function getCalloutType(callout: HTMLElement): string {
  const dataCallout = callout.getAttribute("data-callout");
  if (dataCallout) return sanitizeClassName(dataCallout);

  for (const className of Array.from(callout.classList)) {
    const match = className.match(/^admonition-(.+)$/);
    if (match) return sanitizeClassName(match[1]);
  }

  return "note";
}

function calloutColor(type: string): string {
  const colors: Record<string, string> = {
    tip: "0, 191, 165",
    hint: "0, 191, 165",
    note: "68, 138, 255",
    info: "0, 184, 212",
    warning: "255, 145, 0",
    caution: "255, 145, 0",
    danger: "255, 82, 82",
    error: "255, 82, 82",
    bug: "245, 0, 87",
    quote: "158, 158, 158",
  };
  return colors[type] ?? colors.note;
}

function sanitizeClassName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]/g, "") || "note";
}

function appendInlineStyle(element: HTMLElement | SVGElement, declarations: string[]): void {
  const current = element.getAttribute("style")?.trim();
  const suffix = declarations.join(";");
  element.setAttribute("style", current ? `${current};${suffix}` : suffix);
}

function renderPlaceholder(placeholder: Placeholder): string {
  switch (placeholder.kind) {
    case "flowchart":
      return `<pre class="obsidian-flowchart flowchart">${escapeHtml(placeholder.value)}</pre>`;
    case "math-block":
      return `<div class="obsidian-math obsidian-math-block">\\[${escapeHtml(placeholder.value)}\\]</div>`;
    case "math-inline":
      return `<span class="obsidian-math obsidian-math-inline">\\(${escapeHtml(placeholder.value)}\\)</span>`;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
