CREATE TABLE `exchange_rates` (
	`id` text PRIMARY KEY NOT NULL,
	`from_currency` text NOT NULL,
	`to_currency` text NOT NULL,
	`rate` integer NOT NULL,
	`source` text NOT NULL,
	`fetched_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `accounts` ADD `currency` text DEFAULT 'CLP' NOT NULL;--> statement-breakpoint
ALTER TABLE `movements` ADD `needs_review` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `movements` ADD `currency` text DEFAULT 'CLP' NOT NULL;--> statement-breakpoint
ALTER TABLE `movements` ADD `amount_usd` integer;--> statement-breakpoint
ALTER TABLE `movements` ADD `exchange_rate` integer;