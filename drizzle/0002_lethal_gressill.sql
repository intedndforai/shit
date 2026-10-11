CREATE TABLE `attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`chat_id` text,
	`message_id` text,
	`name` text NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	`kind` text NOT NULL,
	`storage_path` text NOT NULL,
	`text` text,
	`truncated` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `attachments_chat_idx` ON `attachments` (`chat_id`);--> statement-breakpoint
CREATE INDEX `attachments_message_idx` ON `attachments` (`message_id`);