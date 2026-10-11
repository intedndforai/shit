CREATE TABLE `project_skills` (
	`project_id` text NOT NULL,
	`skill_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`skill_id`) REFERENCES `skills`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `project_skills_project_idx` ON `project_skills` (`project_id`);--> statement-breakpoint
CREATE INDEX `project_skills_skill_idx` ON `project_skills` (`skill_id`);--> statement-breakpoint
CREATE TABLE `skills` (
	`id` text PRIMARY KEY NOT NULL,
	`skill_key` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`task_types` text DEFAULT '[]' NOT NULL,
	`instructions` text DEFAULT '' NOT NULL,
	`required_tools` text DEFAULT '[]' NOT NULL,
	`source` text DEFAULT 'user' NOT NULL,
	`provenance` text DEFAULT '{}' NOT NULL,
	`trust_status` text DEFAULT 'untrusted' NOT NULL,
	`integrity_hash` text DEFAULT '' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `skills_key_idx` ON `skills` (`skill_key`);--> statement-breakpoint
CREATE INDEX `skills_enabled_idx` ON `skills` (`enabled`);