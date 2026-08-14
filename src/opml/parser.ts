import { XMLParser } from "fast-xml-parser";

export interface OpmlOutline {
  text: string | null;
  title: string | null;
  type: string | null;
  xmlUrl: string | null;
  htmlUrl: string | null;
  children: OpmlOutline[];
  isFolder: boolean;
}

export interface OpmlParseResult {
  title: string | null;
  outlines: OpmlOutline[];
}

export class OpmlParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpmlParseError";
  }
}

// fast-xml-parser has no DOCTYPE/external-entity support at all (it is not a
// full XML implementation), so it cannot be coerced into resolving external
// entities — XXE is structurally not possible here.
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  textNodeName: "#text",
  allowBooleanAttributes: true,
  isArray: (name) => name === "outline",
  processEntities: true,
});

type RawOutline = Record<string, unknown>;

function str(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

// An outline with nested <outline> children is a folder/category container
// (its own xmlUrl, if any, is ignored — OPML folders don't carry feed URLs
// in practice). An outline with no children is always a leaf: either a feed
// (has xmlUrl) or an invalid/malformed entry (missing xmlUrl) — leaves are
// never dropped so the importer can surface *why* each one failed.
function normalizeOutline(raw: RawOutline): OpmlOutline {
  const rawChildren = Array.isArray(raw.outline) ? (raw.outline as RawOutline[]) : [];
  const children = rawChildren.map(normalizeOutline);
  const text = str(raw.text) ?? str(raw.title);
  const isFolder = children.length > 0;

  return {
    text,
    title: str(raw.title) ?? text,
    type: str(raw.type),
    xmlUrl: isFolder ? null : str(raw.xmlUrl),
    htmlUrl: str(raw.htmlUrl),
    children,
    isFolder,
  };
}

export function parseOpml(xml: string): OpmlParseResult {
  if (!xml || !xml.trim()) {
    throw new OpmlParseError("Empty OPML file");
  }

  let doc: Record<string, unknown>;
  try {
    doc = parser.parse(xml);
  } catch (err) {
    throw new OpmlParseError(`Failed to parse OPML XML: ${(err as Error).message}`);
  }

  const opml = doc.opml as Record<string, unknown> | undefined;
  if (!opml) {
    throw new OpmlParseError("Not a valid OPML document (missing <opml> root element)");
  }

  const head = opml.head as Record<string, unknown> | undefined;
  const body = opml.body as Record<string, unknown> | undefined;
  const topLevel = body && Array.isArray(body.outline) ? (body.outline as RawOutline[]) : [];

  return {
    title: str(head?.title),
    outlines: topLevel.map(normalizeOutline),
  };
}
