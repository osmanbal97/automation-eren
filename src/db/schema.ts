import {
  boolean,
  date,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const platformEnum = pgEnum("platform", ["tiktok", "instagram", "youtube"]);

export const channelEnum = pgEnum("channel", ["web", "telegram"]);

export const connectionStatusEnum = pgEnum("connection_status", [
  "disconnected",
  "pending_review",
  "active",
]);

export const pricingModelEnum = pgEnum("pricing_model", [
  "per_second",
  "per_generation",
  "per_credit",
]);

export const ideaStatusEnum = pgEnum("idea_status", ["pending_review", "approved", "rejected"]);

export const generationJobStatusEnum = pgEnum("generation_job_status", [
  "queued",
  "processing",
  "complete",
  "failed",
]);

export const videoStatusEnum = pgEnum("video_status", [
  "pending_review",
  "ready_to_schedule",
  "rejected",
]);

export const scheduledPostStatusEnum = pgEnum("scheduled_post_status", [
  "scheduled",
  "awaiting_platform_approval",
  "publishing",
  "published",
  "failed",
]);

export const publishJobStatusEnum = pgEnum("publish_job_status", ["pending", "success", "failed"]);

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

export const videoProviders = pgTable("video_providers", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  adapterKey: text("adapter_key").notNull().unique(),
  pricingModel: pricingModelEnum("pricing_model").notNull(),
  unitPrice: numeric("unit_price", { precision: 10, scale: 4 }).notNull(),
  defaultSpecs: jsonb("default_specs").notNull().default({}),
  enabled: boolean("enabled").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const niches = pgTable("niches", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  themeGuidance: text("theme_guidance").notNull(),
  targetPostsPerDay: jsonb("target_posts_per_day").notNull().default({}),
  defaultProviderId: uuid("default_provider_id").references(() => videoProviders.id),
  defaultGenerationSpecs: jsonb("default_generation_specs").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const platformConnections = pgTable(
  "platform_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    nicheId: uuid("niche_id")
      .notNull()
      .references(() => niches.id, { onDelete: "cascade" }),
    platform: platformEnum("platform").notNull(),
    status: connectionStatusEnum("status").notNull().default("disconnected"),
    accessTokenEncrypted: text("access_token_encrypted"),
    refreshTokenEncrypted: text("refresh_token_encrypted"),
    tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
    externalAccountId: text("external_account_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique("platform_connections_niche_platform_unique").on(table.nicheId, table.platform)],
);

export const ideas = pgTable("ideas", {
  id: uuid("id").primaryKey().defaultRandom(),
  nicheId: uuid("niche_id")
    .notNull()
    .references(() => niches.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  concept: text("concept").notNull(),
  prompt: text("prompt").notNull(),
  caption: text("caption").notNull(),
  hashtags: jsonb("hashtags").notNull().default([]),
  providerId: uuid("provider_id").references(() => videoProviders.id),
  generationSpecs: jsonb("generation_specs").notNull().default({}),
  estimatedCost: numeric("estimated_cost", { precision: 10, scale: 4 }),
  status: ideaStatusEnum("status").notNull().default("pending_review"),
  approvedVia: channelEnum("approved_via"),
  updatedVia: channelEnum("updated_via"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const generationJobs = pgTable("generation_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  ideaId: uuid("idea_id")
    .notNull()
    .references(() => ideas.id, { onDelete: "cascade" }),
  providerId: uuid("provider_id")
    .notNull()
    .references(() => videoProviders.id),
  externalJobId: text("external_job_id"),
  status: generationJobStatusEnum("status").notNull().default("queued"),
  attemptCount: integer("attempt_count").notNull().default(0),
  lastError: text("last_error"),
  resultVideoUrl: text("result_video_url"),
  /** Provider-hosted thumbnail URL, when the provider's getResult() reports one (US-017). */
  thumbnailSourceUrl: text("thumbnail_source_url"),
  actualCost: numeric("actual_cost", { precision: 10, scale: 4 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const videos = pgTable("videos", {
  id: uuid("id").primaryKey().defaultRandom(),
  nicheId: uuid("niche_id")
    .notNull()
    .references(() => niches.id, { onDelete: "cascade" }),
  ideaId: uuid("idea_id")
    .notNull()
    .references(() => ideas.id, { onDelete: "cascade" }),
  generationJobId: uuid("generation_job_id")
    .notNull()
    .references(() => generationJobs.id, { onDelete: "cascade" }),
  blobUrl: text("blob_url").notNull(),
  thumbnailBlobUrl: text("thumbnail_blob_url"),
  sizeBytes: integer("size_bytes"),
  durationSeconds: numeric("duration_seconds", { precision: 6, scale: 2 }),
  caption: text("caption").notNull(),
  hashtags: jsonb("hashtags").notNull().default([]),
  status: videoStatusEnum("status").notNull().default("pending_review"),
  approvedVia: channelEnum("approved_via"),
  updatedVia: channelEnum("updated_via"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const scheduledPosts = pgTable("scheduled_posts", {
  id: uuid("id").primaryKey().defaultRandom(),
  videoId: uuid("video_id")
    .notNull()
    .references(() => videos.id, { onDelete: "cascade" }),
  nicheId: uuid("niche_id")
    .notNull()
    .references(() => niches.id, { onDelete: "cascade" }),
  platform: platformEnum("platform").notNull(),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
  status: scheduledPostStatusEnum("status").notNull().default("scheduled"),
  createdVia: channelEnum("created_via"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const publishJobs = pgTable("publish_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  scheduledPostId: uuid("scheduled_post_id")
    .notNull()
    .references(() => scheduledPosts.id, { onDelete: "cascade" }),
  attemptCount: integer("attempt_count").notNull().default(0),
  status: publishJobStatusEnum("status").notNull().default("pending"),
  platformPostId: text("platform_post_id"),
  lastError: text("last_error"),
  updatedVia: channelEnum("updated_via"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const apiQuotaUsage = pgTable(
  "api_quota_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").notNull(),
    usageDate: date("usage_date").notNull(),
    unitsUsed: integer("units_used").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique("api_quota_usage_provider_date_unique").on(table.provider, table.usageDate)],
);

export const errorLogs = pgTable("error_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  provider: text("provider").notNull(),
  operation: text("operation").notNull(),
  payloadSummary: text("payload_summary"),
  errorMessage: text("error_message").notNull(),
  attemptCount: integer("attempt_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const botSessions = pgTable("bot_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  chatId: text("chat_id").notNull().unique(),
  pendingAction: text("pending_action"),
  pendingEntityType: text("pending_entity_type"),
  pendingEntityId: uuid("pending_entity_id"),
  pendingField: text("pending_field"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
