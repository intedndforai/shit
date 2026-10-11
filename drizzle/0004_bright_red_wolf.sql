CREATE TABLE `project_chunks` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`file_id` text NOT NULL,
	`ordinal` integer DEFAULT 0 NOT NULL,
	`content` text NOT NULL,
	`embedding` text,
	`tokens` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`file_id`) REFERENCES `project_files`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `project_chunks_project_idx` ON `project_chunks` (`project_id`);