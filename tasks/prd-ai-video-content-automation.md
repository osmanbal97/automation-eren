# PRD: AI Video Content Automation Pipeline

## Introduction/Overview

A personal, self-hosted automation system that turns short content ideas ("POV riding a bike into an infinite trippy tunnel", "a cat helping a human stand up") into fully-produced short-form videos and publishes them on a schedule to TikTok, Instagram Reels, and YouTube Shorts — with a human approval checkpoint before any money is spent and before anything goes public.

The pipeline: **Claude generates video concepts & prompts → operator approves (web or phone via Telegram) → chosen provider (Higgsfield, Nano Banana, Omni, etc.) generates the video → operator approves the result (web or Telegram) → scheduled → auto-published** once each platform's API access is live.

Two equally-capable control surfaces:
- **Web dashboard** (Vercel, password-gated, no custom domain) — full management: niches, providers, connections, scheduling, history.
- **Telegram bot** — full approval + editing on the go: approve/reject/edit ideas and videos, change provider/specs, all from your phone.

Both surfaces call the same underlying service layer, so nothing is Telegram-only or web-only — anything you can do in one, you can do in the other.

The system is designed to start with one niche/account and scale to several niches (separate accounts, separate themes, separate providers) without a rewrite.

## Goals

- Go from "content idea" to "published Short/Reel/TikTok" with at most two deliberate approval actions (approve idea, approve generated video) — doable from your phone via Telegram just as fully as from the web dashboard.
- Support multiple independent niches/accounts, each with its own theme, posting schedule, platform connections, and default video-generation provider.
- Support multiple video-generation providers (Higgsfield, Nano Banana, Omni, others added later) behind one interface, selectable per niche and overridable per idea.
- Always show an approximate cost estimate before a paid generation call is made — on both Telegram and web — so nothing gets spent blind.
- Never silently blow through a platform's API quota or rate limit — track usage and back off proactively.
- Be ready to flip on real public posting the moment TikTok's audit and Meta's app review clear, with zero code changes needed at that point (only a status flag flips).
- Ship with automated tests around every external-API integration (Anthropic, each video provider, Telegram, TikTok, Meta, YouTube) covering success, rate-limit, and failure/retry paths.

## Tech Stack Decision

**Next.js 15 (App Router) + TypeScript, deployed on Vercel with Fluid Compute, Postgres (Neon, via Vercel Marketplace) with Drizzle ORM, Vercel Blob for video files, Vercel Cron for scheduling, Vitest for tests. Telegram integration via webhook (not long-polling).**

Why not Go: Vercel's first-class runtime is Node.js (Go is community/unmaintained there); introducing Go means fighting an unsupported runtime or standing up a second host, which contradicts wanting everything controlled from one Vercel project. Fluid Compute already reuses warm instances across concurrent requests, and combined with Postgres `SELECT ... FOR UPDATE SKIP LOCKED` for job claiming, that's enough concurrency safety for dozens of niches without a message queue.

Why webhook, not polling, for Telegram: you flagged that Telegram/BotFather-style bots can feel slow — that's almost always a polling/blocking-call problem, not a Telegram limitation. This system uses Telegram's **webhook** delivery (Telegram pushes updates directly to a Vercel API route instantly) instead of long-polling, and every handler follows a strict rule: **acknowledge in under 1 second, do slow work (Claude calls, provider calls) asynchronously, then edit the message or send a follow-up once done.** That keeps the bot feeling instant regardless of how slow an upstream provider is.

## Architecture Note: Shared Action Layer

Every mutating action (approve idea, edit prompt, change provider/specs, approve video, reject, schedule) is implemented **once**, as a plain TypeScript function in a shared `actions/` module (e.g. `approveIdea(ideaId, opts)`, `setIdeaProvider(ideaId, providerId, specs)`, `approveVideo(videoId)`). Both the Telegram webhook handler and the web dashboard's API routes call these same functions — never duplicated logic per channel. This is what makes "full parity between Telegram and web" actually hold, and it's built in Phase 0 before either UI exists.

## User Stories

### Phase 0 — Foundation

#### US-001: App scaffold, deploy, and password gate
**Acceptance Criteria:**
- [ ] Next.js App Router project scaffolded, deployed to Vercel under the default `*.vercel.app` URL
- [ ] Middleware requires a shared secret password (env var) via a login cookie before any dashboard page/API route is reachable
- [ ] `/api/cron/*` and `/api/telegram/webhook` routes use their own separate secret/signature checks (not the login cookie)
- [ ] Typecheck + lint pass

#### US-002: Database schema
**Acceptance Criteria:**
- [ ] Postgres provisioned via Vercel Marketplace (Neon), Drizzle ORM configured with migrations
- [ ] Tables: `niches`, `platform_connections`, `video_providers`, `ideas`, `generation_jobs`, `videos`, `scheduled_posts`, `publish_jobs`, `api_quota_usage`, `error_logs`, `bot_sessions`
- [ ] Migration runs cleanly against a fresh database
- [ ] Typecheck passes

#### US-003: Blob storage wiring
**Acceptance Criteria:**
- [ ] Vercel Blob configured; helper to upload/fetch/delete a video or thumbnail by key
- [ ] `videos` table stores the Blob URL + size + duration once downloaded from a provider
- [ ] Unit test for the upload/fetch helper (mocked)

#### US-004: Resilient external API client core
**Acceptance Criteria:**
- [ ] Shared client wrapper: exponential backoff + jitter on 429/5xx, max attempts, structured error capture
- [ ] `api_quota_usage` table + helper to record/pre-check daily usage per provider
- [ ] Every failure writes a row to `error_logs` with provider, operation, payload summary, attempt count
- [ ] Unit tests: success path, 429 triggers backoff+retry, exhausted retries surfaces a typed error, quota pre-check blocks an over-cap call

#### US-005: Shared action layer skeleton
**Description:** As a developer, I need the approve/edit/reject business logic to live in one place both UIs call into.

**Acceptance Criteria:**
- [ ] `actions/` module with typed functions for every mutating operation used later (idea approve/reject/edit/set-provider, video approve/reject/edit-caption, schedule, retry-publish)
- [ ] Each action records which channel triggered it (`web` or `telegram`) on the affected row for audit
- [ ] Unit tests for each action function against a test database

### Phase 1 — Providers & Cost Estimation

#### US-006: Provider registry
**Description:** As the operator, I want the system to know about multiple video-generation providers (Higgsfield, Nano Banana, Omni, ...) with their pricing, so I can pick per niche.

**Acceptance Criteria:**
- [ ] `video_providers` table: name, adapter key, pricing model (`per_second` / `per_generation` / `per_credit`), unit price, default specs (resolution, duration, aspect ratio, extra params as JSON), enabled flag
- [ ] Seed migration with Higgsfield + placeholders for Nano Banana and Omni (real pricing filled in once each is actually integrated — see US-007)
- [ ] Settings page lists providers with their current pricing and enabled state
- [ ] Typecheck passes; verify in browser using dev-browser skill

#### US-007: `VideoProvider` adapter interface + Higgsfield implementation
**Acceptance Criteria:**
- [ ] `VideoProvider` interface: `submit(prompt, specs) -> jobId`, `getStatus(jobId) -> queued|processing|complete|failed`, `getResult(jobId) -> {videoUrl, actualCost?}`
- [ ] Higgsfield implementation behind this interface, using the shared resilient client (US-004)
- [ ] Adapter registry maps a `video_providers.adapter_key` to its implementation, so adding Nano Banana/Omni later is "write an adapter + flip `enabled`", not a core rewrite
- [ ] Unit tests against a mocked Higgsfield HTTP layer covering all four statuses + a failure/timeout case
- [ ] Note: exact request/response shape finalized once the Higgsfield account is purchased; Nano Banana and Omni adapters are follow-up tickets once you confirm which of those you're actually purchasing access to (they're currently placeholders in the registry, not implemented)

#### US-008: Cost estimator
**Acceptance Criteria:**
- [ ] Given a provider + specs (mainly duration), computes an estimated cost using the provider's pricing model
- [ ] Estimate stored on the idea once a provider/specs is attached (see US-011) and re-computed live if provider/specs change
- [ ] Unit tests for all three pricing models

### Phase 2 — Niches & Platform Connections

#### US-009: Niche management
**Acceptance Criteria:**
- [ ] CRUD page: name, theme/style guidance text, target posts/day per platform, default video provider, default generation specs (resolution/duration/aspect ratio)
- [ ] Niche list shows platform connection status per niche
- [ ] Typecheck passes; verify in browser using dev-browser skill

#### US-010: Platform connection status per niche
**Acceptance Criteria:**
- [ ] Each niche can have 0-1 connection per platform (TikTok/Instagram/YouTube), storing OAuth tokens (encrypted at rest) and status: `disconnected` / `pending_review` / `active`
- [ ] UI clearly shows "waiting on TikTok audit" / "waiting on Meta app review" vs "active" per niche+platform
- [ ] Flipping a connection to `active` is a manual confirmation once you know the platform approved it
- [ ] Typecheck passes; verify in browser using dev-browser skill

### Phase 3 — Idea Generation (Claude)

#### US-011: Generate video ideas for a niche
**Acceptance Criteria:**
- [ ] Action generates N (default 5) ideas via Claude using the niche's theme guidance: title, concept, full generation prompt, suggested caption/hashtags
- [ ] Each idea is created with the niche's default provider + default specs already attached, and an estimated cost computed (US-008) — no need to specify these per idea unless you want to change them
- [ ] Ideas saved with status `pending_review`
- [ ] Uses the shared resilient client (US-004) and the shared action layer (US-005)
- [ ] Unit test mocking the Anthropic call, asserting parsed ideas + defaults are stored correctly

#### US-012: Idea review — web
**Acceptance Criteria:**
- [ ] Review list per niche: pending ideas with inline edit for prompt/caption, provider/specs picker (shows updated cost estimate live), approve/reject buttons
- [ ] Approve → status `approved`; reject → `rejected` (kept for history)
- [ ] Typecheck passes; verify in browser using dev-browser skill

### Phase 4 — Telegram Bot

#### US-013: Telegram webhook + fast-ack pattern
**Description:** As the operator, I want the bot to feel instant even though the work behind it (Claude, video providers) is slow.

**Acceptance Criteria:**
- [ ] `/api/telegram/webhook` verifies Telegram's secret token header, registered via `setWebhook`
- [ ] Every incoming update is acknowledged (200 OK) in under 1s; any slow work is kicked off async and the result is delivered via a follow-up `sendMessage`/`editMessageText` call
- [ ] `bot_sessions` table tracks the operator's chat_id and any pending multi-step interaction (e.g. "awaiting new caption text for idea #42")
- [ ] Unit test for the fast-ack behavior (handler returns before the slow work resolves) and for routing a plain-text reply to the correct pending session

#### US-014: Idea approval via Telegram
**Acceptance Criteria:**
- [ ] New pending ideas are pushed to Telegram as a message: title, concept, prompt, provider name + estimated cost, with inline buttons: Approve / Reject / Edit Prompt / Edit Caption / Change Provider
- [ ] Edit Prompt/Caption → bot asks for replacement text → next plain-text message from that chat updates the idea via the shared action layer (US-005) and re-sends the updated card
- [ ] Change Provider → inline keyboard of enabled providers with their price for this idea's specs; picking one updates the idea and shown estimate
- [ ] Approve/Reject call the exact same action functions the web UI uses
- [ ] Unit tests covering approve, reject, and the edit round-trip via session state

#### US-015: Video approval via Telegram
**Acceptance Criteria:**
- [ ] On a completed generation, bot sends the video (direct upload if under Telegram's bot upload size limit, otherwise a thumbnail + Blob link) with Approve / Reject / Edit Caption buttons
- [ ] Same action functions as the web review queue (US-017)
- [ ] Unit test for the size-based branch (small file vs. link fallback)

### Phase 5 — Video Generation

#### US-016: Generation queue & tracking
**Acceptance Criteria:**
- [ ] Approving an idea creates a `generation_jobs` row and submits it to the idea's attached provider/specs via the adapter registry (US-007)
- [ ] A cron-driven poller updates job status, with capped retries on transient failure
- [ ] Dashboard shows live status per job with last error if failed; Telegram is notified when a job completes (feeds into US-015)
- [ ] Verify in browser using dev-browser skill

#### US-017: Store completed videos
**Acceptance Criteria:**
- [ ] On `complete`, video downloaded and uploaded to Vercel Blob; `videos` row created linking back to the idea/niche, storing actual cost if the provider reports one
- [ ] Basic thumbnail stored alongside
- [ ] Unit test for the download-then-upload flow (mocked)

### Phase 6 — Review & Scheduling

#### US-018: Video review — web
**Acceptance Criteria:**
- [ ] Review page: inline video preview, per-platform caption/hashtag editor, approve/reject
- [ ] Approve → `ready_to_schedule`; reject → `rejected` (kept for history)
- [ ] Typecheck passes; verify in browser using dev-browser skill

#### US-019: Scheduling calendar
**Acceptance Criteria:**
- [ ] Calendar/list UI to pick platform(s) + datetime for a `ready_to_schedule` video; creates one `scheduled_posts` row per platform
- [ ] Validation blocks scheduling beyond a platform's known daily cap per account (configurable per niche, conservative defaults)
- [ ] Typecheck passes; verify in browser using dev-browser skill

### Phase 7 — Publishing

#### US-020: Publish gating on connection status
**Acceptance Criteria:**
- [ ] Publish worker checks `platform_connections.status` before attempting a post
- [ ] Not `active` → post marked `awaiting_platform_approval`, no API call attempted
- [ ] `active` → proceeds to the platform adapter
- [ ] Unit test covering both branches

#### US-021: TikTok Content Posting API adapter
**Acceptance Criteria:**
- [ ] OAuth connect flow, automatic token refresh (24h expiry)
- [ ] `video.publish` implemented; sandbox/`SELF_ONLY` mode supported pre-audit
- [ ] Required UX compliance (show creator username/avatar before posting) present in the schedule confirmation step
- [ ] Unit tests: success, 429 backoff, expired-token refresh, audit-not-passed error surfaced clearly

#### US-022: Instagram Graph API adapter
**Acceptance Criteria:**
- [ ] OAuth connect flow for a Business account (via linked Facebook Page)
- [ ] Container-model publish: `POST /{ig-user-id}/media` → poll → `POST /{ig-user-id}/media_publish`
- [ ] Videos over 90s rejected client-side with a clear message
- [ ] Unit tests: success, container-processing timeout, publish failure, missing-permission error

#### US-023: YouTube Data API v3 adapter
**Acceptance Criteria:**
- [ ] OAuth with `youtube.upload` scope, refresh token stored per niche
- [ ] Resumable upload; vertical 9:16 + <60s auto-classifies as a Short
- [ ] Quota tracked via US-004 (1600 units/upload); pre-flight check defers uploads that would exceed the day's remaining quota
- [ ] Unit tests: success, quota pre-check blocks the call, 403 quotaExceeded caught and deferred

#### US-024: Publish worker (cron)
**Acceptance Criteria:**
- [ ] Vercel Cron hits `/api/cron/publish`; worker selects due `scheduled_posts` using `FOR UPDATE SKIP LOCKED` so overlapping runs never double-post
- [ ] Each due post routed to the correct platform adapter, result recorded on `publish_jobs`
- [ ] Failed posts retried with backoff up to a max, then marked `failed`
- [ ] Test simulating two overlapping worker runs against the same due post, asserting only one publish attempt happens

### Phase 8 — Observability

#### US-025: Post history dashboard
**Acceptance Criteria:**
- [ ] Table/list of `scheduled_posts`/`publish_jobs` filterable by niche, platform, status
- [ ] Failed posts show captured error + manual "retry now" action
- [ ] Verify in browser using dev-browser skill

#### US-026: Quota & spend dashboard
**Acceptance Criteria:**
- [ ] Per-provider, per-day API usage vs known cap (YouTube units, TikTok posts/day, etc.)
- [ ] Per-provider running spend (sum of `estimated_cost`/`actual_cost` across generations), total and per-niche, so cost vs. output is visible at a glance
- [ ] Verify in browser using dev-browser skill

## Functional Requirements

1. The system must run entirely on a single Vercel project with no custom domain.
2. The system must require a shared password before any dashboard page/API route (except cron and Telegram webhook, which use their own secrets) is reachable.
3. The system must expose every mutating action (approve/reject/edit/schedule/retry) through one shared action layer used identically by the web dashboard and the Telegram bot.
4. The system must support multiple independent niches, each with its own theme guidance, posting cadence, platform connections, default video provider, and default generation specs.
5. The system must support multiple video-generation providers behind one adapter interface, selectable as a niche default and overridable per idea, with pricing metadata stored per provider.
6. The system must compute and display an estimated cost for the attached provider/specs on every idea, before generation, on both Telegram and web.
7. No paid video-generation call may occur without an idea first being explicitly approved.
8. The system must generate video ideas + prompts via Claude, scoped to a niche's theme guidance.
9. The system must track every generation job's lifecycle (queued/processing/complete/failed) and expose it in the dashboard, notifying Telegram on completion.
10. Completed videos must be copied into Vercel Blob rather than only referencing the provider's URL.
11. No video may be scheduled for posting without explicit operator approval after preview, on either channel.
12. The Telegram bot must acknowledge every update in under 1 second and perform slow work asynchronously, delivering results via follow-up messages/edits.
13. The system must track a connection status (`disconnected`/`pending_review`/`active`) per niche per platform, and must not attempt a real public post unless `active`.
14. The system must implement retry-with-backoff and structured error logging for every external API call (Anthropic, each video provider, Telegram, TikTok, Meta, YouTube).
15. The system must track daily API usage per provider and pre-emptively avoid calls that would exceed a known cap.
16. The publish worker must claim due posts atomically (DB-level locking) so concurrent invocations never result in a duplicate post.
17. The system must support TikTok direct post (sandbox/self-only pre-audit), Instagram Reels container-publish, and YouTube resumable upload as posting targets.
18. The system must enforce conservative, configurable per-platform daily posting caps at scheduling time.
19. All external-API adapters must have automated tests covering at least: success, rate-limit/backoff, and a hard-failure path.
20. Rejected ideas and rejected videos must be retained (not deleted) for history/audit.
21. The system must track and surface running spend per provider and per niche.

## Non-Goals (Out of Scope for MVP)

- No third-party unified posting API (e.g. Ayrshare) — native platform APIs only, even though it means waiting on TikTok/Meta review.
- No multi-user auth/roles on the web dashboard, and the Telegram bot only ever talks to your single chat — personal use only.
- No message queue (Redis/SQS/etc) — a DB-backed job table with atomic claiming is the concurrency model for now.
- No monetization integrations (ad revenue programs, affiliate link injection, sponsorship tracking) — this PRD builds the content engine only.
- No deep analytics/engagement pull-back (views, likes, watch time) from the platforms — only post success/failure status.
- No automated content-policy/NSFW screening beyond the human review checkpoints already in the pipeline.
- No mobile app beyond the Telegram bot — the web dashboard is a responsive web app.
- No automatic detection of "TikTok/Meta approved us now" — flipping a connection to `active` is a manual confirmation.
- Nano Banana and Omni adapters are registry placeholders in this PRD, not built — implementing each is a follow-up ticket once you confirm you're purchasing access to it.

## Design Considerations

- Dashboard reads as a small internal ops tool — density over polish.
- Every stage that costs money or goes public needs an unmistakable, deliberate approve action on both channels — no accidental one-tap spends, especially important on Telegram where taps are easy.
- Status badges (queued/processing/complete/failed/awaiting_platform_approval) use consistent color coding across web and consistent emoji/labels in Telegram messages.
- Telegram messages always show cost estimate before a spend-triggering Approve button, mirroring the web review queue.

## Technical Considerations

- **Stack:** Next.js 15 App Router + TypeScript, Vercel (Fluid Compute), Postgres via Vercel Marketplace (Neon) + Drizzle ORM, Vercel Blob, Vercel Cron, Vitest.
- **Telegram:** Bot API via webhook (`setWebhook` to the Vercel deployment URL), secret token header verification, fast-ack + async-follow-up pattern throughout.
- **Secrets:** Anthropic API key, per-provider API keys, TikTok/Meta/Google OAuth client credentials, per-niche OAuth tokens (encrypted at rest), Telegram bot token + webhook secret, app password, cron secret — all via Vercel env vars.
- **Providers:** Higgsfield adapter built first (account not yet purchased — built against documented shapes, adjusted on first real call). Nano Banana/Omni are registry placeholders until you confirm which to purchase.
- **TikTok/Meta review:** start the audit/review process immediately, in parallel with build-out — it's the long pole (2-4 weeks).
- **YouTube:** no audit-style review for personal single-channel OAuth "Testing" mode use, but confirm token longevity before depending on unattended re-auth long-term (open question).
- **Encryption:** platform tokens stored encrypted at rest, never in plaintext columns.

## Success Metrics

- An idea can be fully approved, edited, or rejected from Telegram with the same effect as doing it on web, and vice versa.
- A cost estimate is visible before every generation approval, on both channels.
- One niche can go from "generate ideas" to "video sitting in the scheduling calendar" with zero manual editing of video content.
- Once at least one platform connection is `active`, a scheduled post publishes automatically with no manual step at post time.
- Zero duplicate posts under concurrent worker execution.
- Zero unhandled crashes from external API failures — every failure path has a test and a visible status.
- Adding a second/third niche, or a second/third video provider, requires no core rewrite — only configuration (niche) or a new adapter (provider).

## Open Questions

- Which of Nano Banana / Omni (and any others) do you actually want purchased/integrated first, once Higgsfield is up and running?
- Exact Higgsfield request/response schema and pricing — pending account purchase; same for whichever other providers you pick.
- Final list of TikTok/Meta OAuth scopes to request in the audit/review submissions.
- YouTube OAuth "Testing" mode refresh-token longevity for a single personal channel — confirm before depending on unattended re-auth.
- Per-niche daily posting cap defaults — start conservative (1-3/day) and adjust once real accounts exist?
- Monetization mechanics — deliberately deferred out of this PRD; revisit once the pipeline is producing consistent output.
