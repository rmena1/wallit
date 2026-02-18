ALTER TABLE `movements` ADD `loan` integer NOT NULL DEFAULT false;--> statement-breakpoint
ALTER TABLE `movements` ADD `loan_settled` integer NOT NULL DEFAULT false;--> statement-breakpoint
ALTER TABLE `movements` ADD `loan_id` text;
