ALTER TABLE "ideas" ADD COLUMN "updated_via" "channel";--> statement-breakpoint
ALTER TABLE "publish_jobs" ADD COLUMN "updated_via" "channel";--> statement-breakpoint
ALTER TABLE "scheduled_posts" ADD COLUMN "created_via" "channel";--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "updated_via" "channel";