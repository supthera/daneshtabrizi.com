const ALLOWED_TAGS = new Set([
  "p",
  "br",
  "hr",
  "h1",
  "h2",
  "h3",
  "h4",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "blockquote",
  "ul",
  "ol",
  "li",
  "a",
  "img",
  "figure",
  "figcaption",
  "code",
  "pre",
  "span",
  "div",
]);

const ALLOWED_ATTRS: Record<string, Set<string>> = {
  a: new Set(["href", "title", "rel", "target"]),
  img: new Set(["src", "alt", "title", "width", "height"]),
};

/** Strip paste junk (inline dark colors, class soup) before publishing. */
export function sanitizePublisherHtml(input: string): string {
  let html = String(input || "");
  if (!html.trim()) return "";

  html = html
    .replace(/<(script|style|noscript|iframe|object|embed)[\s\S]*?<\/\1>/gi, "")
    .replace(/<\/?(script|style|noscript|iframe|object|embed)\b[^>]*>/gi, "");

  html = html.replace(/<\/?([a-z0-9]+)([^>]*)>/gi, (full, rawTag: string, rawAttrs: string) => {
    const tag = rawTag.toLowerCase();
    const isClose = full.startsWith("</");
    if (!ALLOWED_TAGS.has(tag)) return "";
    if (isClose) return `</${tag}>`;

    const selfClosing = /\/>$/.test(full) || tag === "br" || tag === "hr" || tag === "img";
    const allowed = ALLOWED_ATTRS[tag];
    if (!allowed) return `<${tag}>`;

    const kept: string[] = [];
    const attrRe =
      /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
    let match: RegExpExecArray | null;
    while ((match = attrRe.exec(rawAttrs))) {
      const name = match[1].toLowerCase();
      if (!allowed.has(name)) continue;
      let value = match[3] ?? match[4] ?? match[5] ?? "";
      if ((name === "href" || name === "src") && /^\s*javascript:/i.test(value)) continue;
      if (name === "href" || name === "src") value = value.trim();
      kept.push(`${name}="${value.replace(/"/g, "&quot;")}"`);
    }
    const attrs = kept.length ? ` ${kept.join(" ")}` : "";
    return `<${tag}${attrs}>`;
  });

  for (let i = 0; i < 4; i++) {
    html = html.replace(/<(div|span)>\s*<\/\1>/gi, "");
  }

  return html.replace(/\n{3,}/g, "\n\n").trim();
}
