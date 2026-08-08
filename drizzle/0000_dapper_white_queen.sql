CREATE TYPE "public"."channel" AS ENUM('web', 'telegram');--> statement-breakpoint
CREATE TYPE "public"."connection_status" AS ENUM('disconnected', 'pending_review', 'active');--> statement-breakpoint
CREATE TYPE "public"."generation_job_status" AS ENUM('queued', 'processing', 'complete', 'failed');--> statement-breakpoint
CREATE TYPE "public"."idea_status" AS ENUM('pending_review', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."platform" AS ENUM('tiktok', 'instagram', 'youtube');--> statement-breakpoint
CREATE TYPE "public"."pricing_model" AS ENUM('per_second', 'per_generation', 'per_credit');--> statement-breakpoint
CREATE TYPE "public"."publish_job_status" AS ENUM('pending', 'success', 'failed');--> statement-breakpoint
CREATE TYPE "public"."scheduled_post_status" AS ENUM('scheduled', 'awaiting_platform_approval', 'publishing', 'published', 'failed');--> statement-breakpoint
CREATE TYPE "public"."video_status" AS ENUM('pending_review', 'ready_to_schedule', 'rejected');--> statement-breakpoint
CREATE TABLE "api_quota_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"usage_date" date NOT NULL,
	"units_used" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_quota_usage_provider_date_unique" UNIQUE("provider","usage_date")
);
--> statement-breakpoint
CREATE TABLE "bot_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chat_id" text NOT NULL,
	"pending_action" text,
	"pending_entity_type" text,
	"pending_entity_id" uuid,
	"pending_field" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bot_sessions_chat_id_unique" UNIQUE("chat_id")
);
--> statement-breakpoint
CREATE TABLE "error_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"operation" text NOT NULL,
	"payload_summary" text,
	"error_message" text NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "generation_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"idea_id" uuid NOT NULL,
	"provider_id" uuid NOT NULL,
	"external_job_id" text,
	"status" "generation_job_status" DEFAULT 'queued' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"result_video_url" text,
	"actual_cost" numeric(10, 4),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ideas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"niche_id" uuid NOT NULL,
	"title" text NOT NULL,
	"concept" text NOT NULL,
	"prompt" text NOT NULL,
	"caption" text NOT NULL,
	"hashtags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"provider_id" uuid,
	"generation_specs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"estimated_cost" numeric(10, 4),
	"status" "idea_status" DEFAULT 'pending_review' NOT NULL,
	"approved_via" "channel",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "niches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"theme_guidance" text NOT NULL,
	"target_posts_per_day" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"default_provider_id" uuid,
	"default_generation_specs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"niche_id" uuid NOT NULL,
	"platform" "platform" NOT NULL,
	"status" "connection_status" DEFAULT 'disconnected' NOT NULL,
	"access_token_encrypted" text,
	"refresh_token_encrypted" text,
	"token_expires_at" timestamp with time zone,
	"external_account_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_connections_niche_platform_unique" UNIQUE("niche_id","platform")
);
--> statement-breakpoint
CREATE TABLE "publish_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scheduled_post_id" uuid NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"status" "publish_job_status" DEFAULT 'pending' NOT NULL,
	"platform_post_id" text,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduled_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"video_id" uuid NOT NULL,
	"niche_id" uuid NOT NULL,
	"platform" "platform" NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"status" "scheduled_post_status" DEFAULT 'scheduled' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "video_providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"adapter_key" text NOT NULL,
	"pricing_model" "pricing_model" NOT NULL,
	"unit_price" numeric(10, 4) NOT NULL,
	"default_specs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "video_providers_name_unique" UNIQUE("name"),
	CONSTRAINT "video_providers_adapter_key_unique" UNIQUE("adapter_key")
);
--> statement-breakpoint
CREATE TABLE "videos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"niche_id" uuid NOT NULL,
	"idea_id" uuid NOT NULL,
	"generation_job_id" uuid NOT NULL,
	"blob_url" text NOT NULL,
	"thumbnail_blob_url" text,
	"size_bytes" integer,
	"duration_seconds" numeric(6, 2),
	"caption" text NOT NULL,
	"hashtags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "video_status" DEFAULT 'pending_review' NOT NULL,
	"approved_via" "channel",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_idea_id_ideas_id_fk" FOREIGN KEY ("idea_id") REFERENCES "public"."ideas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_provider_id_video_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."video_providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_niche_id_niches_id_fk" FOREIGN KEY ("niche_id") REFERENCES "public"."niches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_provider_id_video_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."video_providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "niches" ADD CONSTRAINT "niches_default_provider_id_video_providers_id_fk" FOREIGN KEY ("default_provider_id") REFERENCES "public"."video_providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_connections" ADD CONSTRAINT "platform_connections_niche_id_niches_id_fk" FOREIGN KEY ("niche_id") REFERENCES "public"."niches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publish_jobs" ADD CONSTRAINT "publish_jobs_scheduled_post_id_scheduled_posts_id_fk" FOREIGN KEY ("scheduled_post_id") REFERENCES "public"."scheduled_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_posts" ADD CONSTRAINT "scheduled_posts_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_posts" ADD CONSTRAINT "scheduled_posts_niche_id_niches_id_fk" FOREIGN KEY ("niche_id") REFERENCES "public"."niches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "videos" ADD CONSTRAINT "videos_niche_id_niches_id_fk" FOREIGN KEY ("niche_id") REFERENCES "public"."niches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "videos" ADD CONSTRAINT "videos_idea_id_ideas_id_fk" FOREIGN KEY ("idea_id") REFERENCES "public"."ideas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "videos" ADD CONSTRAINT "videos_generation_job_id_generation_jobs_id_fk" FOREIGN KEY ("generation_job_id") REFERENCES "public"."generation_jobs"("id") ON DELETE cascade ON UPDATE no action;