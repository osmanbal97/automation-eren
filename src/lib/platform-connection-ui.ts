import type { BadgeTone } from "@/components/ui";
import type { Dictionary } from "@/lib/i18n";

export const PLATFORMS = ["tiktok", "instagram", "youtube"] as const;
export type ConnectionPlatform = (typeof PLATFORMS)[number];

export const STATUS_TONES: Record<string, BadgeTone> = {
  active: "success",
  pending_review: "pending",
  disconnected: "idle",
};

/** Per-platform copy for what "pending" actually means, per the PRD's "waiting on TikTok
 * audit" / "waiting on Meta app review" wording — a generic "Pending review" label doesn't
 * tell the operator which external process they're actually waiting on. Shared between the
 * niche detail page and the Socials page so both describe connections identically. */
export function connectionStatusLabel(t: Dictionary["connectionStatus"], platform: ConnectionPlatform, status: string) {
  if (status === "active") return t.active;
  if (status === "pending_review") return t.pending[platform];
  return t.notConnected;
}

/** Human copy for the OAuth callback's `?connected=`/`?connection_error=` redirect params,
 * shown as a banner on the niche detail page immediately after a connect attempt. */
export function connectionResultMessage(
  t: Dictionary["connectionStatus"],
  params: { connected?: string; connectionError?: string; reason?: string },
): { tone: "success" | "danger"; message: string } | null {
  if (params.connected) {
    return { tone: "success", message: t.connected(capitalize(params.connected)) };
  }
  if (params.connectionError) {
    const platform = capitalize(params.connectionError);
    if (params.reason === "not_configured") {
      return { tone: "danger", message: t.notConfigured(platform) };
    }
    return { tone: "danger", message: t.connectError(platform) };
  }
  return null;
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
