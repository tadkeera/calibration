CREATE TABLE `recordApprovals` (
	`id` int AUTO_INCREMENT NOT NULL,
	`validationRecordId` int NOT NULL,
	`approverUserId` int NOT NULL,
	`decision` enum('approved','rejected') NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `recordApprovals_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `recordApprovals_record_idx` ON `recordApprovals` (`validationRecordId`);--> statement-breakpoint
CREATE INDEX `recordApprovals_approver_idx` ON `recordApprovals` (`approverUserId`);