/**
 * Shape every language's dictionary must implement. Interpolated strings are typed as
 * functions (not template literals baked into one string) so each language controls its
 * own word order and pluralization -- Turkish doesn't suffix a noun after a numeral
 * ("5 fikir", never "5 fikirler"), which a shared English-shaped template would get wrong.
 *
 * Keeping this as a TypeScript interface (rather than JSON) means `tsc --noEmit` fails
 * the moment `en.ts`/`tr.ts` drift out of sync with each other or with this shape.
 */
export interface Dictionary {
  login: {
    title: string;
    subtitle: string;
    passwordLabel: string;
    passwordPlaceholder: string;
    incorrectPassword: string;
    verifying: string;
    enterConsole: string;
    footer: string;
  };

  sidebar: {
    brandName: string;
    brandTagline: string;
    nav: {
      overview: string;
      niches: string;
      providers: string;
      history: string;
      socials: string;
      usage: string;
      videos: string;
      schedule: string;
    };
    soonTag: string;
    soonTooltip: string;
    signOut: string;
  };

  overview: {
    eyebrow: string;
    title: string;
    description: string;
    manageNiches: string;
    stats: {
      niches: { label: string; hint: string };
      ideasPending: { label: string; hint: string };
      videosPending: { label: string; hint: string };
      estimatedSpend: { label: string; hint: string };
    };
    yourNiches: string;
    noNichesTitle: string;
    noNichesBody: string;
    getStarted: string;
    openNiche: string;
    publishingSoon: { title: string; description: string; viewAll: string; empty: string };
  };

  nichesList: {
    eyebrow: string;
    title: string;
    description: string;
    emptyTitle: string;
    emptyBody: string;
    delete: string;
    provider: string;
    postsPerDay: string;
    none: string;
    newNichePanel: { title: string; description: string };
    createNiche: string;
  };

  nicheForm: {
    nameLabel: string;
    namePlaceholder: string;
    themeGuidanceLabel: string;
    themeGuidanceHint: string;
    themeGuidancePlaceholder: string;
    referenceGuidanceLabel: string;
    referenceGuidanceHint: string;
    referenceGuidancePlaceholder: string;
    perDayLabel: (platform: string) => string;
    defaultProviderLabel: string;
    none: string;
    resolutionLabel: string;
    durationLabel: string;
    aspectRatioLabel: string;
    saveChanges: string;
  };

  nicheDetail: {
    allNiches: string;
    connectionsPanel: { title: string; description: string };
    connectViaOAuth: string;
    markSubmitted: string;
    markActive: string;
    reset: string;
    disconnect: string;
    ideasPanel: { title: string; description: string };
    generateIdeas: string;
    reviewIdeasCta: (n: number) => string;
    noIdeasPending: string;
    jobsPanel: { title: string; description: string };
    attempt: (n: number) => string;
    noJobsYet: string;
    videosPanel: { title: string; description: string };
    reviewVideosCta: (n: number) => string;
    noVideosPending: string;
    schedulePanel: { title: string; description: string };
    scheduleVideosCta: (n: number) => string;
    noVideosReady: string;
    settingsPanel: { title: string };
  };

  connectionStatus: {
    active: string;
    notConnected: string;
    pending: { tiktok: string; instagram: string; youtube: string };
    connected: (platform: string) => string;
    connectError: (platform: string) => string;
    notConfigured: (platform: string) => string;
  };

  ideas: {
    eyebrow: string;
    title: string;
    pendingDescription: (n: number) => string;
    emptyTitle: string;
    emptyBodyPrefix: string;
    emptyBodyLink: string;
    emptyBodySuffix: string;
    approve: string;
    reject: string;
    optimize: string;
    optimizePlaceholder: string;
    rewritePrompt: string;
    promptLabel: string;
    captionLabel: string;
    providerLabel: string;
    resolutionLabel: string;
    durationLabel: string;
    aspectRatioLabel: string;
    estimatedCost: string;
    pickProvider: string;
    saveChanges: string;
  };

  videos: {
    eyebrow: string;
    title: string;
    pendingDescription: (n: number) => string;
    emptyTitle: string;
    emptyBodyPrefix: string;
    emptyBodyLink: string;
    emptyBodySuffix: string;
    approve: string;
    reject: string;
    captionLabel: string;
    hashtagsLabel: string;
    hashtagsPlaceholder: string;
    saveChanges: string;
    regenerateToggle: string;
    regenerateEditedLabel: string;
    regenerateButton: string;
    optimizeLabel: string;
    optimizePlaceholder: string;
    optimizeRegenerateButton: string;
  };

  schedule: {
    eyebrow: string;
    title: string;
    readyDescription: (n: number) => string;
    emptyTitle: string;
    emptyBodyPrefix: string;
    emptyBodyLink: string;
    emptyBodySuffix: string;
    platformsLabel: string;
    whenLabel: string;
    whenHint: string;
    scheduleButton: string;
  };

  status: {
    job: { queued: string; processing: string; complete: string; failed: string };
    post: {
      scheduled: string;
      awaiting_platform_approval: string;
      publishing: string;
      published: string;
      failed: string;
    };
    pricing: { per_second: string; per_generation: string; per_credit: string };
  };

  providers: {
    eyebrow: string;
    title: string;
    description: string;
    emptyTitle: string;
    emptyBodyPrefix: string;
    emptyBodySuffix: string;
    enabled: string;
    disabled: string;
    unitPrice: string;
    usedBy: string;
    notUsedYet: string;
  };

  socials: {
    eyebrow: string;
    title: string;
    description: string;
    credentialsPanel: { title: string; description: string };
    configured: string;
    configuredEnv: string;
    notConfigured: string;
    clientIdEnding: (last4: string) => string;
    clientIdLabel: string;
    clientIdPlaceholder: string;
    clientSecretLabel: string;
    clientSecretPlaceholder: string;
    save: string;
    connectedPanel: { title: string; description: string };
    accountPrefix: (id: string) => string;
    updatedAt: (date: string) => string;
    noAccounts: string;
    addAccountPanel: { title: string; description: string };
    selectNichePlaceholder: string;
    connectViaOAuth: string;
    needsApiKeyHint: string;
  };

  history: {
    eyebrow: string;
    title: string;
    description: string;
    nicheLabel: string;
    platformLabel: string;
    statusLabel: string;
    allNiches: string;
    allPlatforms: string;
    allStatuses: string;
    filter: string;
    emptyTitle: string;
    emptyBody: string;
    scheduledFor: (date: string) => string;
    platformPost: (id: string) => string;
    retryNow: string;
  };

  usage: {
    eyebrow: string;
    title: string;
    description: string;
    totalEstimated: { label: string; hint: string };
    totalActual: { label: string; hint: string };
    quotaPanel: { title: string; description: string };
    noUsageToday: string;
    quotaLine: (used: string, cap: string | null, pct: number | null) => string;
    providerSpendTitle: string;
    noProviders: string;
    spendLine: (estimated: string, actual: string) => string;
    nicheSpendTitle: string;
    noNiches: string;
  };
}
