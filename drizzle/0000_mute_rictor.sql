CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`chat_id` text NOT NULL,
	`message_id` text,
	`identifier` text NOT NULL,
	`type` text NOT NULL,
	`title` text,
	`content` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `artifacts_chat_idx` ON `artifacts` (`chat_id`,`identifier`);--> statement-breakpoint
CREATE TABLE `chats` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text,
	`system_prompt` text,
	`provider_id` text,
	`model_id` text,
	`temperature` real DEFAULT 0.7 NOT NULL,
	`top_p` real DEFAULT 1 NOT NULL,
	`max_tokens` integer DEFAULT 8192 NOT NULL,
	`thinking_budget` integer,
	`style_id` text,
	`project_id` text,
	`pinned` integer DEFAULT false NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`incognito` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`provider_id`) REFERENCES `providers`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`model_id`) REFERENCES `models`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`style_id`) REFERENCES `response_styles`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `chats_updated_idx` ON `chats` (`updated_at`);--> statement-breakpoint
CREATE INDEX `chats_pinned_idx` ON `chats` (`pinned`,`archived`);--> statement-breakpoint
CREATE INDEX `chats_project_idx` ON `chats` (`project_id`);--> statement-breakpoint
CREATE TABLE `memories` (
	`id` text PRIMARY KEY NOT NULL,
	`content` text NOT NULL,
	`source_chat_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`source_chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`chat_id` text NOT NULL,
	`parent_id` text,
	`branch_index` integer DEFAULT 0 NOT NULL,
	`role` text NOT NULL,
	`content` text DEFAULT '[]' NOT NULL,
	`model_id` text,
	`token_usage` text DEFAULT '{}' NOT NULL,
	`cost` real DEFAULT 0 NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`model_id`) REFERENCES `models`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `messages_chat_idx` ON `messages` (`chat_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `messages_parent_idx` ON `messages` (`parent_id`);--> statement-breakpoint
CREATE TABLE `models` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_id` text NOT NULL,
	`external_id` text NOT NULL,
	`display_name` text,
	`context_window` integer DEFAULT 128000 NOT NULL,
	`max_output_tokens` integer DEFAULT 8192 NOT NULL,
	`capabilities` text DEFAULT '{}' NOT NULL,
	`price_per_million_input` real DEFAULT 0 NOT NULL,
	`price_per_million_output` real DEFAULT 0 NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`is_fallback` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`provider_id`) REFERENCES `providers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `models_provider_idx` ON `models` (`provider_id`);--> statement-breakpoint
CREATE INDEX `models_default_idx` ON `models` (`is_default`);--> statement-breakpoint
CREATE TABLE `project_files` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`mime_type` text,
	`size` integer DEFAULT 0 NOT NULL,
	`storage_path` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`chunk_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`instructions` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `providers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`base_url` text NOT NULL,
	`api_key_encrypted` text,
	`api_key_iv` text,
	`api_format` text DEFAULT 'openai-completions' NOT NULL,
	`custom_headers` text DEFAULT '{}' NOT NULL,
	`organization_id` text,
	`project_id` text,
	`is_default` integer DEFAULT false NOT NULL,
	`is_title_model` integer DEFAULT false NOT NULL,
	`is_summarization_model` integer DEFAULT false NOT NULL,
	`is_embeddings_model` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `providers_default_idx` ON `providers` (`is_default`);--> statement-breakpoint
CREATE TABLE `response_styles` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`instructions` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `response_styles_slug_unique` ON `response_styles` (`slug`);--> statement-breakpoint
CREATE TABLE `saved_prompts` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`command` text NOT NULL,
	`content` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `saved_prompts_command_unique` ON `saved_prompts` (`command`);--> statement-breakpoint
CREATE TABLE `share_links` (
	`id` text PRIMARY KEY NOT NULL,
	`chat_id` text NOT NULL,
	`slug` text NOT NULL,
	`revoked_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `share_links_slug_unique` ON `share_links` (`slug`);--> statement-breakpoint
CREATE INDEX `share_links_chat_idx` ON `share_links` (`chat_id`);--> statement-breakpoint
CREATE TABLE `usage_events` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_id` text,
	`model_id` text,
	`chat_id` text,
	`prompt_tokens` integer DEFAULT 0 NOT NULL,
	`completion_tokens` integer DEFAULT 0 NOT NULL,
	`total_tokens` integer DEFAULT 0 NOT NULL,
	`cost` real DEFAULT 0 NOT NULL,
	`request_at` integer NOT NULL,
	FOREIGN KEY (`provider_id`) REFERENCES `providers`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`model_id`) REFERENCES `models`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `usage_model_idx` ON `usage_events` (`model_id`);--> statement-breakpoint
CREATE INDEX `usage_request_idx` ON `usage_events` (`request_at`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text DEFAULT 'Local user' NOT NULL,
	`role` text DEFAULT 'user' NOT NULL,
	`preferences` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
