const SingulEyeShared = (() => {
  const TARGET_GALLERY_ID = "thesingularity";
  const SETTINGS_KEY = "singulEyeSettings";
  const LEGACY_SETTINGS_KEY = "singulShieldSettings";
  const DEFAULT_BLOCKED_HEAD_ID = "130";
  const VISITED_KEY = "singulEyeVisited";
  const VISITED_MAX = 5000;
  const OO_NICK_PATTERN = /^ㅇㅇ(?:[\s._-]*\d+(?:[\s._-]?\d+)*)?$/u;

  function normalizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function normalizeHeadId(value) {
    return normalizeText(value);
  }

  function normalizeHeadLabel(value) {
    return normalizeText(value);
  }

  function parseHeadId(onclickValue) {
    const match = String(onclickValue || "").match(/listSearchHead\((\d+)\)/);
    return match ? match[1] : "";
  }

  function normalizeHeads(rawHeads) {
    const uniqueHeads = [];
    const seenIds = new Set();

    for (const rawHead of Array.isArray(rawHeads) ? rawHeads : []) {
      const id = normalizeHeadId(rawHead?.id);
      const label = normalizeHeadLabel(rawHead?.label);

      if (!id || !label || seenIds.has(id)) {
        continue;
      }

      uniqueHeads.push({ id, label });
      seenIds.add(id);
    }

    return uniqueHeads;
  }

  function createDefaultSettings() {
    return {
      blockedHeads: {
        [DEFAULT_BLOCKED_HEAD_ID]: true
      },
      showFloatingIpPosts: true,
      showFloatingIpComments: true,
      showOoNickPosts: true,
      hideDuplicateExact: false,
      hideDuplicateLoose: false,
      preserveNotice: true,
      showVisitedMarks: true,
      availableHeads: []
    };
  }

  function pickStoredSettings(storageResult) {
    if (!storageResult || typeof storageResult !== "object") {
      return undefined;
    }

    if (
      storageResult[SETTINGS_KEY] &&
      typeof storageResult[SETTINGS_KEY] === "object"
    ) {
      return storageResult[SETTINGS_KEY];
    }

    if (
      storageResult[LEGACY_SETTINGS_KEY] &&
      typeof storageResult[LEGACY_SETTINGS_KEY] === "object"
    ) {
      return storageResult[LEGACY_SETTINGS_KEY];
    }

    return undefined;
  }

  function normalizeBlockedHeads(rawBlockedHeads, useDefaultWhenMissing) {
    const blockedHeads = {};

    if (rawBlockedHeads && typeof rawBlockedHeads === "object") {
      for (const [rawId, rawValue] of Object.entries(rawBlockedHeads)) {
        const id = normalizeHeadId(rawId);

        if (!id) {
          continue;
        }

        blockedHeads[id] = Boolean(rawValue);
      }
    }

    if (useDefaultWhenMissing && Object.keys(blockedHeads).length === 0) {
      blockedHeads[DEFAULT_BLOCKED_HEAD_ID] = true;
    }

    return blockedHeads;
  }

  function normalizeSettings(rawSettings) {
    const defaultSettings = createDefaultSettings();

    if (!rawSettings || typeof rawSettings !== "object") {
      return defaultSettings;
    }

    return {
      blockedHeads: normalizeBlockedHeads(rawSettings.blockedHeads, false),
      showFloatingIpPosts:
        typeof rawSettings.showFloatingIpPosts === "boolean"
          ? rawSettings.showFloatingIpPosts
          : defaultSettings.showFloatingIpPosts,
      showFloatingIpComments:
        typeof rawSettings.showFloatingIpComments === "boolean"
          ? rawSettings.showFloatingIpComments
          : defaultSettings.showFloatingIpComments,
      showOoNickPosts:
        typeof rawSettings.showOoNickPosts === "boolean"
          ? rawSettings.showOoNickPosts
          : defaultSettings.showOoNickPosts,
      hideDuplicateExact:
        typeof rawSettings.hideDuplicateExact === "boolean"
          ? rawSettings.hideDuplicateExact
          : defaultSettings.hideDuplicateExact,
      hideDuplicateLoose:
        typeof rawSettings.hideDuplicateLoose === "boolean"
          ? rawSettings.hideDuplicateLoose
          : defaultSettings.hideDuplicateLoose,
      preserveNotice:
        typeof rawSettings.preserveNotice === "boolean"
          ? rawSettings.preserveNotice
          : defaultSettings.preserveNotice,
      showVisitedMarks:
        typeof rawSettings.showVisitedMarks === "boolean"
          ? rawSettings.showVisitedMarks
          : defaultSettings.showVisitedMarks,
      availableHeads: normalizeHeads(rawSettings.availableHeads)
    };
  }

  function mergeAvailableHeads(settings, availableHeads) {
    const normalizedSettings = normalizeSettings(settings);
    const normalizedHeads = normalizeHeads(availableHeads);
    const currentHeadsJson = JSON.stringify(normalizedSettings.availableHeads);
    const nextHeadsJson = JSON.stringify(normalizedHeads);

    if (currentHeadsJson === nextHeadsJson) {
      return {
        changed: false,
        settings: normalizedSettings
      };
    }

    return {
      changed: true,
      settings: {
        ...normalizedSettings,
        availableHeads: normalizedHeads
      }
    };
  }

  return {
    TARGET_GALLERY_ID,
    SETTINGS_KEY,
    LEGACY_SETTINGS_KEY,
    DEFAULT_BLOCKED_HEAD_ID,
    VISITED_KEY,
    VISITED_MAX,
    OO_NICK_PATTERN,
    createDefaultSettings,
    mergeAvailableHeads,
    normalizeHeadId,
    normalizeHeadLabel,
    normalizeHeads,
    normalizeSettings,
    normalizeText,
    parseHeadId,
    pickStoredSettings
  };
})();
