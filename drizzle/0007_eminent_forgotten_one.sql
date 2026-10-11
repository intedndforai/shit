CREATE TABLE `egress_events` (
	`id` text PRIMARY KEY NOT NULL,
	`chat_id` text,
	`provider_id` text,
	`kind` text NOT NULL,
	`destination` text NOT NULL,
	`label` text,
	`mode` text DEFAULT 'standard' NOT NULL,
	`bytes_out` integer DEFAULT 0 NOT NULL,
	`redaction_count` integer DEFAULT 0 NOT NULL,
	`payload_hash` text,
	`status` text DEFAULT 'ok' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`provider_id`) REFERENCES `providers`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `egress_chat_idx` ON `egress_events` (`chat_id`);--> statement-breakpoint
CREATE INDEX `egress_created_idx` ON `egress_events` (`created_at`);--> statement-breakpoint
ALTER TABLE `chats` ADD `privacy_mode` text DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE `providers` ADD `data_policy_training` text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE `providers` ADD `data_policy_retention` text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE `providers` ADD `data_policy_region` text;--> statement-breakpoint
ALTER TABLE `providers` ADD `data_policy_url` text;--> statement-breakpoint
ALTER TABLE `providers` ADD `data_policy_declared_by` text;--> statement-breakpoint
ALTER TABLE `providers` ADD `data_policy_declared_at` integer;