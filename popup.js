(async () => {
  const {
    LEGACY_SETTINGS_KEY,
    SETTINGS_KEY,
    TARGET_GALLERY_ID,
    DEFAULT_BLOCKED_HEAD_ID,
    mergeAvailableHeads,
    normalizeSettings,
    pickStoredSettings
  } = SingulEyeShared;

  const statusLine = document.querySelector("#statusLine");
  const floatingIpToggle = document.querySelector("#floatingIpToggle");
  const floatingIpCommentToggle = document.querySelector(
    "#floatingIpCommentToggle"
  );
  const headList = document.querySelector("#headList");
  const emptyState = document.querySelector("#emptyState");
  const hiddenCountValue = document.querySelector("#hiddenCountValue");
  const blockedHeadCountValue = document.querySelector("#blockedHeadCountValue");
  const blockAllButton = document.querySelector("#blockAllButton");
  const unblockAllButton = document.querySelector("#unblockAllButton");
  const resetHeadsButton = document.querySelector("#resetHeadsButton");

  let activeTab = null;
  let settings = normalizeSettings();
  let liveContext = null;

  function setStatus(message) {
    statusLine.textContent = message;
  }

  async function getStoredSettings() {
    const storageResult = await chrome.storage.sync.get([
      SETTINGS_KEY,
      LEGACY_SETTINGS_KEY
    ]);
    settings = normalizeSettings(pickStoredSettings(storageResult));
    return settings;
  }

  async function saveSettings(nextSettings, options = {}) {
    const { applyToPage = true } = options;

    settings = normalizeSettings(nextSettings);

    await chrome.storage.sync.set({
      [SETTINGS_KEY]: settings
    });

    if (applyToPage && activeTab?.id) {
      try {
        await chrome.tabs.sendMessage(activeTab.id, {
          type: "FORCE_APPLY_SETTINGS"
        });
      } catch (error) {
        // Matching tabs still receive the storage update.
      }
    }

    return settings;
  }

  async function getActiveTab() {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true
    });

    return tab || null;
  }

  async function loadLiveContext(tabId) {
    try {
      return await chrome.tabs.sendMessage(tabId, {
        type: "GET_PAGE_CONTEXT"
      });
    } catch (error) {
      return null;
    }
  }

  function getRenderableHeads() {
    return liveContext?.heads?.length
      ? liveContext.heads
      : settings.availableHeads;
  }

  function getCurrentStats() {
    return liveContext?.stats || null;
  }

  function renderMetrics() {
    const stats = getCurrentStats();
    const heads = getRenderableHeads();
    const blockedCount = heads.filter((head) => settings.blockedHeads[head.id]).length;

    hiddenCountValue.textContent = stats ? `${stats.hiddenRows}` : "-";
    blockedHeadCountValue.textContent = heads.length > 0 ? `${blockedCount}` : "-";
  }

  function renderActionAvailability() {
    const hasHeads = getRenderableHeads().length > 0;

    blockAllButton.disabled = !hasHeads;
    unblockAllButton.disabled = !hasHeads;
    resetHeadsButton.disabled = !hasHeads;
  }

  function createToggleSwitch({ id, checked, onChange }) {
    const wrapper = document.createElement("label");
    wrapper.className = "toggle-wrap";

    const input = document.createElement("input");
    input.className = "toggle-input";
    input.type = "checkbox";
    input.id = id;
    input.checked = checked;
    input.addEventListener("change", onChange);

    const ui = document.createElement("span");
    ui.className = "toggle-ui";
    ui.setAttribute("aria-hidden", "true");

    wrapper.append(input, ui);
    return wrapper;
  }

  function renderHeads() {
    const rawHeads = getRenderableHeads();
    headList.replaceChildren();

    if (rawHeads.length === 0) {
      emptyState.hidden = false;
      return;
    }

    emptyState.hidden = true;

    const pinned = rawHeads.filter((head) => head.id === DEFAULT_BLOCKED_HEAD_ID);
    const rest = rawHeads.filter((head) => head.id !== DEFAULT_BLOCKED_HEAD_ID);
    const heads = [...pinned, ...rest];

    heads.forEach((head) => {
      const row = document.createElement("div");
      row.className =
        head.id === DEFAULT_BLOCKED_HEAD_ID ? "head-row head-row--pinned" : "head-row";

      const copyBlock = document.createElement("div");
      copyBlock.className = "copy-block";

      const meta = document.createElement("div");
      meta.className = "head-meta";

      const name = document.createElement("span");
      name.className = "head-name";
      name.textContent = head.label;

      const idBadge = document.createElement("span");
      idBadge.className = "head-id";
      idBadge.textContent = `HEAD ${head.id}`;

      meta.append(name, idBadge);
      copyBlock.append(meta);

      const toggle = createToggleSwitch({
        id: `head-${head.id}`,
        checked: Boolean(settings.blockedHeads[head.id]),
        onChange: async (event) => {
          await saveSettings({
            ...settings,
            blockedHeads: {
              ...settings.blockedHeads,
              [head.id]: event.target.checked
            }
          });
          await refreshLiveContext({ mode: "silent" });

          setStatus(`${head.label} 차단을 ${event.target.checked ? "ON" : "OFF"}으로 적용했습니다.`);
          renderAll();
        }
      });

      row.append(copyBlock, toggle);
      headList.append(row);
    });
  }

  function renderFloatingIpToggles() {
    floatingIpToggle.checked = settings.showFloatingIpPosts;
    floatingIpCommentToggle.checked = settings.showFloatingIpComments;
  }

  function renderAll() {
    renderFloatingIpToggles();
    renderMetrics();
    renderHeads();
    renderActionAvailability();
  }

  function createLoadedStatusMessage(context) {
    if (context.pageType === "view") {
      const totalComments = context.stats?.totalRows || 0;
      return totalComments > 0
        ? `${context.galleryTitle} 본문에서 댓글 ${totalComments}개를 확인했습니다.`
        : `${context.galleryTitle} 본문 설정을 불러왔습니다.`;
    }

    return `${context.galleryTitle}에서 탭 ${context.heads.length}개를 불러왔습니다.`;
  }

  async function refreshLiveContext(options = {}) {
    const { mode = "initial" } = options;

    liveContext = activeTab?.id ? await loadLiveContext(activeTab.id) : null;

    if (liveContext?.supported && liveContext.galleryId === TARGET_GALLERY_ID) {
      const merged = mergeAvailableHeads(settings, liveContext.heads);
      settings = merged.settings;

      if (merged.changed) {
        await saveSettings(settings, { applyToPage: false });
      }

      renderAll();

      if (mode === "initial") {
        setStatus(createLoadedStatusMessage(liveContext));
      }

      return liveContext;
    }

    renderAll();

    if (mode === "initial") {
      if (settings.availableHeads.length > 0) {
        setStatus("저장된 탭 목록으로 설정을 표시합니다.");
      } else {
        setStatus("특이점이 온다 갤러리 목록 또는 본문 페이지를 열면 자동으로 불러옵니다.");
      }
    }

    return liveContext;
  }

  function createBulkBlockedHeads(isBlocked) {
    const nextBlockedHeads = { ...settings.blockedHeads };

    getRenderableHeads().forEach((head) => {
      nextBlockedHeads[head.id] = isBlocked;
    });

    return nextBlockedHeads;
  }

  function createDefaultBlockedHeads() {
    const nextBlockedHeads = { ...settings.blockedHeads };
    const heads = getRenderableHeads();

    heads.forEach((head) => {
      nextBlockedHeads[head.id] = head.id === DEFAULT_BLOCKED_HEAD_ID;
    });

    if (!heads.some((head) => head.id === DEFAULT_BLOCKED_HEAD_ID)) {
      nextBlockedHeads[DEFAULT_BLOCKED_HEAD_ID] = true;
    }

    return nextBlockedHeads;
  }

  async function hydrate() {
    activeTab = await getActiveTab();
    await getStoredSettings();
    await refreshLiveContext({ mode: "initial" });
  }

  floatingIpToggle.addEventListener("change", async (event) => {
    await saveSettings({
      ...settings,
      showFloatingIpPosts: event.target.checked
    });
    await refreshLiveContext({ mode: "silent" });

    setStatus(`유동 IP 글 보기를 ${event.target.checked ? "ON" : "OFF"}으로 적용했습니다.`);
    renderAll();
  });

  floatingIpCommentToggle.addEventListener("change", async (event) => {
    await saveSettings({
      ...settings,
      showFloatingIpComments: event.target.checked
    });
    await refreshLiveContext({ mode: "silent" });

    setStatus(`유동 IP 댓글 보기를 ${event.target.checked ? "ON" : "OFF"}으로 적용했습니다.`);
    renderAll();
  });

  blockAllButton.addEventListener("click", async () => {
    await saveSettings({
      ...settings,
      blockedHeads: createBulkBlockedHeads(true)
    });
    await refreshLiveContext({ mode: "silent" });

    setStatus("모든 탭 차단을 ON으로 적용했습니다.");
    renderAll();
  });

  unblockAllButton.addEventListener("click", async () => {
    await saveSettings({
      ...settings,
      blockedHeads: createBulkBlockedHeads(false)
    });
    await refreshLiveContext({ mode: "silent" });

    setStatus("모든 탭 차단을 OFF로 적용했습니다.");
    renderAll();
  });

  resetHeadsButton.addEventListener("click", async () => {
    await saveSettings({
      ...settings,
      blockedHeads: createDefaultBlockedHeads()
    });
    await refreshLiveContext({ mode: "silent" });

    setStatus("탭 차단 설정을 기본값으로 복원했습니다.");
    renderAll();
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "sync" || !changes[SETTINGS_KEY]) {
      return;
    }

    settings = normalizeSettings(changes[SETTINGS_KEY].newValue);
    renderAll();
  });

  hydrate().catch((error) => {
    setStatus("설정을 불러오지 못했습니다. 다시 열어 주세요.");
    console.error(error);
  });
})();
