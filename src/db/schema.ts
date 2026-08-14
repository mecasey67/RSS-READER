import { sql } from "drizzle-orm";
import {
  sqliteTable,
  text,
  integer,
  uniqueIndex,
  index,
} from "drizzle-orm/sqlite-core";

// Timestamps are stored as ISO-8601 UTC strings for readability and easy
// portability to Postgres `timestamptz` later.

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: text("created_at").notNull().default(sql`(current_timestamp)`),
});

export const folders = sqliteTable(
  "folders",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    parentId: integer("parent_id"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: text("created_at").notNull().default(sql`(current_timestamp)`),
    updatedAt: text("updated_at").notNull().default(sql`(current_timestamp)`),
  },
  (t) => [
    index("folders_user_id_idx").on(t.userId),
    index("folders_parent_id_idx").on(t.parentId),
  ],
);

export const FEED_STATUSES = [
  "active",
  "temporarily_failed",
  "permanently_failed",
  "disabled",
] as const;
export type FeedStatus = (typeof FEED_STATUSES)[number];

// A Feed is a shared, canonical remote resource. Multiple users' Subscriptions
// may point at the same Feed row so it is only ever fetched once.
export const feeds = sqliteTable(
  "feeds",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    feedUrl: text("feed_url").notNull().unique(),
    siteUrl: text("site_url"),
    title: text("title"),
    description: text("description"),
    language: text("language"),
    iconUrl: text("icon_url"),
    etag: text("etag"),
    lastModified: text("last_modified"),
    lastCheckedAt: text("last_checked_at"),
    lastSuccessfulFetchAt: text("last_successful_fetch_at"),
    nextCheckAt: text("next_check_at"),
    consecutiveFailureCount: integer("consecutive_failure_count")
      .notNull()
      .default(0),
    httpStatus: integer("http_status"),
    status: text("status").$type<FeedStatus>().notNull().default("active"),
    lastError: text("last_error"),
    createdAt: text("created_at").notNull().default(sql`(current_timestamp)`),
    updatedAt: text("updated_at").notNull().default(sql`(current_timestamp)`),
  },
  (t) => [
    index("feeds_next_check_at_idx").on(t.nextCheckAt),
    index("feeds_status_idx").on(t.status),
  ],
);

// A user's subscription to a Feed. Decoupled from Feed so the same feed can
// be shared across users in a future multi-user version without re-fetching.
export const subscriptions = sqliteTable(
  "subscriptions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    feedId: integer("feed_id")
      .notNull()
      .references(() => feeds.id, { onDelete: "cascade" }),
    folderId: integer("folder_id").references(() => folders.id, {
      onDelete: "set null",
    }),
    customTitle: text("custom_title"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: text("created_at").notNull().default(sql`(current_timestamp)`),
  },
  (t) => [
    uniqueIndex("subscriptions_user_feed_idx").on(t.userId, t.feedId),
    index("subscriptions_folder_id_idx").on(t.folderId),
  ],
);

// Canonical, format-agnostic article representation. The reader UI never
// needs to know whether this came from RSS, Atom, or RDF.
export const articles = sqliteTable(
  "articles",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    feedId: integer("feed_id")
      .notNull()
      .references(() => feeds.id, { onDelete: "cascade" }),
    externalId: text("external_id"),
    canonicalUrl: text("canonical_url"),
    originalUrl: text("original_url"),
    title: text("title"),
    author: text("author"),
    publishedAt: text("published_at"),
    updatedAt: text("updated_at"),
    summaryHtml: text("summary_html"),
    contentHtml: text("content_html"),
    contentText: text("content_text"),
    imageUrl: text("image_url"),
    contentHash: text("content_hash").notNull(),
    firstSeenAt: text("first_seen_at")
      .notNull()
      .default(sql`(current_timestamp)`),
    lastSeenAt: text("last_seen_at")
      .notNull()
      .default(sql`(current_timestamp)`),
    createdAt: text("created_at").notNull().default(sql`(current_timestamp)`),
    dbUpdatedAt: text("db_updated_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (t) => [
    index("articles_feed_id_idx").on(t.feedId),
    index("articles_published_at_idx").on(t.publishedAt),
    index("articles_external_id_idx").on(t.externalId),
    index("articles_canonical_url_idx").on(t.canonicalUrl),
    // A feed cannot report the same external id or canonical URL twice.
    // SQLite unique indexes treat NULL as distinct, so articles lacking
    // these fields are not falsely deduplicated against each other.
    uniqueIndex("articles_feed_external_id_idx").on(t.feedId, t.externalId),
    uniqueIndex("articles_feed_canonical_url_idx").on(
      t.feedId,
      t.canonicalUrl,
    ),
  ],
);

// Per-user read/starred state, kept separate from article content so the
// same article row never needs duplicating across users.
export const userArticleStates = sqliteTable(
  "user_article_states",
  {
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    articleId: integer("article_id")
      .notNull()
      .references(() => articles.id, { onDelete: "cascade" }),
    isRead: integer("is_read", { mode: "boolean" }).notNull().default(false),
    readAt: text("read_at"),
    isStarred: integer("is_starred", { mode: "boolean" })
      .notNull()
      .default(false),
    starredAt: text("starred_at"),
  },
  (t) => [
    uniqueIndex("user_article_states_pk_idx").on(t.userId, t.articleId),
    index("user_article_states_user_read_idx").on(t.userId, t.isRead),
    index("user_article_states_user_starred_idx").on(t.userId, t.isStarred),
  ],
);
