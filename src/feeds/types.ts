export interface NormalizedFeedMeta {
  title: string | null;
  description: string | null;
  siteUrl: string | null;
  language: string | null;
  iconUrl: string | null;
}

export interface NormalizedArticle {
  externalId: string | null;
  canonicalUrl: string | null;
  originalUrl: string | null;
  title: string | null;
  author: string | null;
  publishedAt: string | null;
  updatedAt: string | null;
  summaryHtml: string;
  contentHtml: string;
  contentText: string;
  imageUrl: string | null;
  contentHash: string;
}

export interface NormalizedFeed {
  meta: NormalizedFeedMeta;
  articles: NormalizedArticle[];
}
