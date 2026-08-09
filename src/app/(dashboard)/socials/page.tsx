import { listNichesWithConnections } from "@/actions/niches";
import { listPlatformAppStatuses } from "@/actions/platform-apps";
import { getDb } from "@/db/client";
import { Badge, Button, Field, Input, PageHeader, Panel, PanelHeader, Select } from "@/components/ui";
import { getT, toBcp47 } from "@/lib/i18n";
import { connectionStatusLabel, PLATFORMS, STATUS_TONES, type ConnectionPlatform } from "@/lib/platform-connection-ui";
import { saveAppCredentialsAction } from "./actions";

export const dynamic = "force-dynamic";

const PLATFORM_LABELS: Record<ConnectionPlatform, string> = {
  tiktok: "TikTok",
  instagram: "Instagram",
  youtube: "YouTube",
};

export default async function SocialsPage() {
  const { t, locale } = await getT();
  const db = getDb();
  const [appStatuses, nichesWithConnections] = await Promise.all([
    listPlatformAppStatuses(db),
    listNichesWithConnections(db),
  ]);

  const statusByPlatform = new Map(appStatuses.map((status) => [status.platform, status]));

  const connectedAccounts = nichesWithConnections
    .flatMap((niche) => niche.connections.map((connection) => ({ niche, connection })))
    .sort((a, b) => +b.connection.updatedAt - +a.connection.updatedAt);

  return (
    <>
      <PageHeader
        eyebrow={t.socials.eyebrow}
        title={t.socials.title}
        description={t.socials.description}
      />

      <Panel>
        <PanelHeader title={t.socials.credentialsPanel.title} description={t.socials.credentialsPanel.description} />
        <div className="grid gap-4 px-6 py-6 sm:grid-cols-3">
          {PLATFORMS.map((platform) => {
            const status = statusByPlatform.get(platform);
            return (
              <div key={platform} className="rounded-lg border border-line bg-ink-900/50 p-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-medium">{PLATFORM_LABELS[platform]}</div>
                  <Badge tone={status?.configured ? "success" : "idle"}>
                    {status?.configured
                      ? status.source === "database"
                        ? t.socials.configured
                        : t.socials.configuredEnv
                      : t.socials.notConfigured}
                  </Badge>
                </div>
                {status?.configured && status.clientIdPreview ? (
                  <p className="mt-1 text-xs text-fg-subtle">{t.socials.clientIdEnding(status.clientIdPreview)}</p>
                ) : null}
                <form action={saveAppCredentialsAction} className="mt-3 space-y-3">
                  <input type="hidden" name="platform" value={platform} />
                  <Field label={t.socials.clientIdLabel}>
                    <Input name="clientId" placeholder={t.socials.clientIdPlaceholder} required />
                  </Field>
                  <Field label={t.socials.clientSecretLabel}>
                    <Input type="password" name="clientSecret" placeholder={t.socials.clientSecretPlaceholder} required />
                  </Field>
                  <Button type="submit" variant="primary" size="sm" className="w-full">
                    {t.socials.save}
                  </Button>
                </form>
              </div>
            );
          })}
        </div>
      </Panel>

      <Panel className="mt-6">
        <PanelHeader title={t.socials.connectedPanel.title} description={t.socials.connectedPanel.description} />
        <div className="px-6 py-6">
          {connectedAccounts.length > 0 ? (
            <ul className="space-y-3">
              {connectedAccounts.map(({ niche, connection }) => (
                <li
                  key={connection.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-ink-900/50 px-4 py-3.5"
                >
                  <div>
                    <div className="text-sm font-medium">
                      {niche.name} <span className="text-fg-subtle">· {PLATFORM_LABELS[connection.platform]}</span>
                    </div>
                    <div className="mt-1 text-xs text-fg-subtle">
                      {connection.externalAccountId ? t.socials.accountPrefix(connection.externalAccountId) : ""}
                      {t.socials.updatedAt(connection.updatedAt.toLocaleString(toBcp47(locale)))}
                    </div>
                  </div>
                  <Badge tone={STATUS_TONES[connection.status] ?? "idle"}>
                    {connectionStatusLabel(t.connectionStatus, connection.platform, connection.status)}
                  </Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-fg-subtle">{t.socials.noAccounts}</p>
          )}
        </div>
      </Panel>

      <Panel className="mt-6">
        <PanelHeader title={t.socials.addAccountPanel.title} description={t.socials.addAccountPanel.description} />
        <div className="space-y-3 px-6 py-6">
          {PLATFORMS.map((platform) => {
            const configured = statusByPlatform.get(platform)?.configured ?? false;
            return (
              <form
                key={platform}
                action={`/api/auth/${platform}/authorize`}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-ink-900/50 px-4 py-3.5"
              >
                <span className="w-24 shrink-0 text-sm font-medium">{PLATFORM_LABELS[platform]}</span>
                <Select name="nicheId" required defaultValue="" className="max-w-xs flex-1">
                  <option value="" disabled>
                    {t.socials.selectNichePlaceholder}
                  </option>
                  {nichesWithConnections.map((niche) => (
                    <option key={niche.id} value={niche.id}>
                      {niche.name}
                    </option>
                  ))}
                </Select>
                <Button type="submit" variant="secondary" size="sm" disabled={!configured}>
                  {t.socials.connectViaOAuth}
                </Button>
                {!configured ? (
                  <span className="text-xs text-fg-subtle">{t.socials.needsApiKeyHint}</span>
                ) : null}
              </form>
            );
          })}
        </div>
      </Panel>
    </>
  );
}
