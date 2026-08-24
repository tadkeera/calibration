CREATE TABLE `instrumentChangeEvents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`instrumentKey` varchar(64) NOT NULL,
	`editorUserId` int NOT NULL,
	`previousData` json,
	`nextData` json NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `instrumentChangeEvents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `instrumentProfiles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`instrumentKey` varchar(64) NOT NULL,
	`nameAr` varchar(255) NOT NULL,
	`nameEn` varchar(255) NOT NULL,
	`instrumentId` varchar(64) NOT NULL,
	`sopNumber` varchar(64) NOT NULL,
	`manufacturer` varchar(255) NOT NULL,
	`model` varchar(128) NOT NULL,
	`serialNumber` varchar(128) NOT NULL,
	`formNumber` varchar(64) NOT NULL,
	`accent` varchar(16) NOT NULL,
	`updatedByUserId` int NOT NULL,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `instrumentProfiles_id` PRIMARY KEY(`id`),
	CONSTRAINT `instrumentProfiles_instrumentKey_unique` UNIQUE(`instrumentKey`)
);
--> statement-breakpoint
CREATE INDEX `instrumentChangeEvents_key_idx` ON `instrumentChangeEvents` (`instrumentKey`);--> statement-breakpoint
CREATE INDEX `instrumentChangeEvents_editor_idx` ON `instrumentChangeEvents` (`editorUserId`);--> statement-breakpoint
CREATE INDEX `instrumentChangeEvents_createdAt_idx` ON `instrumentChangeEvents` (`createdAt`);