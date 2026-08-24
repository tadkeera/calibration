CREATE TABLE `auditEvents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`validationRecordId` int NOT NULL,
	`actorUserId` int NOT NULL,
	`action` enum('created','updated','approved','rejected','exported') NOT NULL,
	`previousStatus` varchar(32),
	`nextStatus` varchar(32),
	`summary` text NOT NULL,
	`metadata` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `auditEvents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` int AUTO_INCREMENT NOT NULL,
	`openId` varchar(64) NOT NULL,
	`name` text,
	`email` varchar(320),
	`loginMethod` varchar(64),
	`role` enum('user','admin') NOT NULL DEFAULT 'user',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`lastSignedIn` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_openId_unique` UNIQUE(`openId`)
);
--> statement-breakpoint
CREATE TABLE `validationRecords` (
	`id` int AUTO_INCREMENT NOT NULL,
	`instrumentKey` varchar(64) NOT NULL,
	`instrumentName` varchar(255) NOT NULL,
	`instrumentId` varchar(64) NOT NULL,
	`sopNumber` varchar(64) NOT NULL,
	`formNumber` varchar(64) NOT NULL,
	`resultStatus` enum('pass','fail') NOT NULL,
	`lifecycleStatus` enum('draft','approved','rejected') NOT NULL DEFAULT 'draft',
	`resultData` json NOT NULL,
	`pharmacistName` varchar(255) NOT NULL,
	`validatedByUserId` int NOT NULL,
	`approvedByUserId` int,
	`approvedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `validationRecords_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `auditEvents_record_idx` ON `auditEvents` (`validationRecordId`);--> statement-breakpoint
CREATE INDEX `auditEvents_actor_idx` ON `auditEvents` (`actorUserId`);--> statement-breakpoint
CREATE INDEX `auditEvents_createdAt_idx` ON `auditEvents` (`createdAt`);--> statement-breakpoint
CREATE INDEX `validationRecords_createdBy_idx` ON `validationRecords` (`validatedByUserId`);--> statement-breakpoint
CREATE INDEX `validationRecords_status_idx` ON `validationRecords` (`lifecycleStatus`);--> statement-breakpoint
CREATE INDEX `validationRecords_createdAt_idx` ON `validationRecords` (`createdAt`);