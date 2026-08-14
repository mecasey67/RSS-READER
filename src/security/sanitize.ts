import sanitizeHtml from "sanitize-html";

// Feed HTML is untrusted input. This allowlist covers common article
// formatting while stripping anything capable of executing script or
// escaping the reading pane's layout.
const ALLOWED_TAGS = [
  "p", "a", "img", "figure", "figcaption", "blockquote",
  "strong", "b", "em", "i", "u", "s", "code", "pre",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "li",
  "table", "thead", "tbody", "tr", "th", "td",
  "br", "hr", "span", "div", "sub", "sup", "small", "mark",
];

const ALLOWED_ATTRIBUTES: sanitizeHtml.IOptions["allowedAttributes"] = {
  a: ["href", "title", "rel", "target"],
  img: ["src", "alt", "title", "width", "height", "loading"],
  "*": ["lang"],
};

export function sanitizeArticleHtml(dirty: string | null | undefined): string {
  if (!dirty) return "";
  return sanitizeHtml(dirty, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: ALLOWED_ATTRIBUTES,
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesByTag: { img: ["http", "https", "data"] },
    // iframe is intentionally absent from ALLOWED_TAGS — embeds are stripped
    // entirely rather than sandboxed, per the "security over fidelity" rule.
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer", target: "_blank" }, true),
    },
    disallowedTagsMode: "discard",
    // Strip style attributes/tags entirely — publisher CSS is not trusted
    // to stay inside the reading pane.
    allowedStyles: {},
    nonTextTags: ["style", "script", "textarea", "option", "noscript"],
  });
}

export function sanitizePlainSummary(html: string | null | undefined, maxLength = 280): string {
  if (!html) return "";
  const text = sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} })
    .replace(/\s+/g, " ")
    .trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}
