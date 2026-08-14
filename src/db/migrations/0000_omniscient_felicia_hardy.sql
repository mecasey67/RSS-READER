CREATE TABLE `articles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`feed_id` integer NOT NULL,
	`external_id` text,
	`canonical_url` text,
	`original_url` text,
	`title` text,
	`author` text,
	`published_at` text,
	`updated_at` text,
	`summary_html` text,
	`content_html` text,
	`content_text` text,
	`image_url` text,
	`content_hash` text NOT NULL,
	`first_seen_at` text DEFAULT (current_timestamp) NOT NULL,
	`last_seen_at` text DEFAULT (current_timestamp) NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`db_updated_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`feed_id`) REFERENCES `feeds`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `articles_feed_id_idx` ON `articles` (`feed_id`);--> statement-breakpoint
CREATE INDEX `articles_published_at_idx` ON `articles` (`published_at`);--> statement-breakpoint
CREATE INDEX `articles_external_id_idx` ON `articles` (`external_id`);--> statement-breakpoint
CREATE INDEX `articles_canonical_url_idx` ON `articles` (`canonical_url`);--> statement-breakpoint
CREATE UNIQUE INDEX `articles_feed_external_id_idx` ON `articles` (`feed_id`,`external_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `articles_feed_canonical_url_idx` ON `articles` (`feed_id`,`canonical_url`);--> statement-breakpoint
CREATE TABLE `feeds` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`feed_url` text NOT NULL,
	`site_url` text,
	`title` text,
	`description` text,
	`language` text,
	`icon_url` text,
	`etag` text,
	`last_modified` text,
	`last_checked_at` text,
	`last_successful_fetch_at` text,
	`next_check_at` text,
	`consecutive_failure_count` integer DEFAULT 0 NOT NULL,
	`http_status` integer,
	`status` text DEFAULT 'active' NOT NULL,
	`last_error` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `feeds_feed_url_unique` ON `feeds` (`feed_url`);--> statement-breakpoint
CREATE INDEX `feeds_next_check_at_idx` ON `feeds` (`next_check_at`);--> statement-breakpoint
CREATE INDEX `feeds_status_idx` ON `feeds` (`status`);--> statement-breakpoint
CREATE TABLE `folders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`name` text NOT NULL,
	`parent_id` integer,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `folders_user_id_idx` ON `folders` (`user_id`);--> statement-breakpoint
CREATE INDEX `folders_parent_id_idx` ON `folders` (`parent_id`);--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`feed_id` integer NOT NULL,
	`folder_id` integer,
	`custom_title` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`feed_id`) REFERENCES `feeds`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`folder_id`) REFERENCES `folders`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `subscriptions_user_feed_idx` ON `subscriptions` (`user_id`,`feed_id`);--> statement-breakpoint
CREATE INDEX `subscriptions_folder_id_idx` ON `subscriptions` (`folder_id`);--> statement-breakpoint
CREATE TABLE `user_article_states` (
	`user_id` integer NOT NULL,
	`article_id` integer NOT NULL,
	`is_read` integer DEFAULT false NOT NULL,
	`read_at` text,
	`is_starred` integer DEFAULT false NOT NULL,
	`starred_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`article_id`) REFERENCES `articles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_article_states_pk_idx` ON `user_article_states` (`user_id`,`article_id`);--> statement-breakpoint
CREATE INDEX `user_article_states_user_read_idx` ON `user_article_states` (`user_id`,`is_read`);--> statement-breakpoint
CREATE INDEX `user_article_states_user_starred_idx` ON `user_article_states` (`user_id`,`is_starred`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);