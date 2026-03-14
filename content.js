(() => {
  const {
    LEGACY_SETTINGS_KEY,
    SETTINGS_KEY,
    TARGET_GALLERY_ID,
    mergeAvailableHeads,
    normalizeHeadLabel,
    normalizeHeads,
    normalizeSettings,
    normalizeText,
    parseHeadId,
    pickStoredSettings
  } = SingulEyeShared;

  const LIST_ROW_SELECTOR = "tr.ub-content";
  const SUBJECT_CELL_SELECTOR = "td.gall_subject";
  const LIST_WRITER_CELL_SELECTOR = "td.gall_writer";
  const COMMENT_WRAP_SELECTOR = "#focus_cmt";
  const COMMENT_ITEM_SELECTOR = "li.ub-content";
  const COMMENT_WRITER_SELECTOR = ".gall_writer.ub-writer, .gall_writer[data-ip]";
  const HIDDEN_MARKER = "data-singul-eye-hidden";
  const LIST_OBSERVER_SELECTORS = [
    LIST_ROW_SELECTOR,
    SUBJECT_CELL_SELECTOR,
    LIST_WRITER_CELL_SELECTOR,
    ".gall_listwrap.list",
    "table.gall_list",
    "tbody.listwrap2"
  ];
  const HEAD_OBSERVER_SELECTORS = [
    'a[onclick*="listSearchHead("]',
    ".list_array_option"
  ];
  const VIEW_OBSERVER_SELECTORS = [
    COMMENT_WRAP_SELECTOR,
    COMMENT_ITEM_SELECTOR,
    COMMENT_WRITER_SELECTOR
  ];

  let currentSettings = normalizeSettings();
  let currentHeads = [];
  let currentFilterStats = createEmptyFilterStats();
  let applyScheduled = false;
  let headSyncScheduled = false;

  function createEmptyFilterStats() {
    return {
      totalRows: 0,
      visibleRows: 0,
      hiddenRows: 0,
      hiddenByHead: 0,
      hiddenByWriter: 0,
      scope: "idle"
    };
  }

  function getCurrentUrl() {
    return new URL(window.location.href);
  }

  function getCurrentPageType() {
    const url = getCurrentUrl();
    const pathname = url.pathname.replace(/\/+$/, "");
    const galleryId = url.searchParams.get("id");

    if (galleryId !== TARGET_GALLERY_ID) {
      return "";
    }

    if (pathname === "/mgallery/board/lists") {
      return "list";
    }

    if (pathname === "/mgallery/board/view") {
      return "view";
    }

    return "";
  }

  function isTargetGalleryPage() {
    return getCurrentPageType() !== "";
  }

  function isTargetListPage() {
    return getCurrentPageType() === "list";
  }

  function formatGalleryTitle(rawTitle) {
    const normalized = normalizeText(rawTitle)
      .replace(/\s*-\s*커뮤니티 포털 디시인사이드$/u, "")
      .replace(/\s*-\s*디시인사이드$/u, "")
      .replace(/\s*마이너\s*갤러리$/u, " 갤러리");

    return normalized || TARGET_GALLERY_ID;
  }

  function getGalleryTitle() {
    const titleLink = document.querySelector(".page_head h2 a");
    const title =
      titleLink instanceof HTMLElement
        ? titleLink.innerText || titleLink.textContent || ""
        : document.title || "";

    return formatGalleryTitle(title);
  }

  function scrapeHeads() {
    const headLinks = Array.from(
      document.querySelectorAll('a[onclick*="listSearchHead("]')
    );

    return normalizeHeads(
      headLinks.map((link) => ({
        id: parseHeadId(link.getAttribute("onclick")),
        label: normalizeText(link.textContent || "")
      }))
    );
  }

  function getAvailableHeads() {
    return currentHeads.length > 0 ? currentHeads : currentSettings.availableHeads;
  }

  function nodeTouchesSelectors(node, selectors, includeDescendants = false) {
    if (node instanceof DocumentFragment) {
      return Array.from(node.childNodes).some((childNode) =>
        nodeTouchesSelectors(childNode, selectors, true)
      );
    }

    const element =
      node instanceof Element
        ? node
        : node instanceof CharacterData
          ? node.parentElement
          : null;

    if (!(element instanceof Element)) {
      return false;
    }

    const matchesRelevantArea = selectors.some(
      (selector) => element.matches(selector) || element.closest(selector)
    );

    if (matchesRelevantArea) {
      return true;
    }

    if (!includeDescendants) {
      return false;
    }

    return selectors.some((selector) => element.querySelector(selector));
  }

  function mutationTouchesSelectors(mutation, selectors) {
    if (mutation.type !== "childList") {
      return false;
    }

    if (nodeTouchesSelectors(mutation.target, selectors)) {
      return true;
    }

    return (
      Array.from(mutation.addedNodes).some((node) =>
        nodeTouchesSelectors(node, selectors, true)
      ) ||
      Array.from(mutation.removedNodes).some((node) =>
        nodeTouchesSelectors(node, selectors, true)
      )
    );
  }

  function getHeadLabelFromCell(subjectCell) {
    if (!(subjectCell instanceof HTMLElement)) {
      return "";
    }

    const originalLabel = subjectCell.querySelector(".subject_inner");

    if (originalLabel instanceof HTMLElement) {
      return normalizeHeadLabel(originalLabel.textContent || "");
    }

    const clonedCell = subjectCell.cloneNode(true);

    if (clonedCell instanceof HTMLElement) {
      clonedCell.querySelectorAll(".subject_inner").forEach((element) => {
        element.remove();
      });
      return normalizeHeadLabel(clonedCell.textContent || "");
    }

    return normalizeHeadLabel(subjectCell.textContent || "");
  }

  function getRowHeadLabel(row) {
    return getHeadLabelFromCell(row.querySelector(SUBJECT_CELL_SELECTOR));
  }

  function isFloatingIpElement(element) {
    return (
      element instanceof HTMLElement &&
      normalizeText(element.getAttribute("data-ip")) !== ""
    );
  }

  function isFloatingIpRow(row) {
    return isFloatingIpElement(row.querySelector(LIST_WRITER_CELL_SELECTOR));
  }

  function isFloatingIpComment(commentItem) {
    return isFloatingIpElement(commentItem.querySelector(COMMENT_WRITER_SELECTOR));
  }

  function createBlockedHeadLabelSet(settings, heads) {
    const labelById = new Map(
      heads.map((head) => [head.id, normalizeHeadLabel(head.label)])
    );
    const blockedLabels = new Set();

    for (const [headId, isBlocked] of Object.entries(settings.blockedHeads)) {
      if (!isBlocked) {
        continue;
      }

      const label = labelById.get(headId);

      if (label) {
        blockedLabels.add(label);
      }
    }

    return blockedLabels;
  }

  function hideNode(node) {
    node.setAttribute(HIDDEN_MARKER, "true");
    node.style.setProperty("display", "none", "important");
  }

  function showNode(node) {
    if (node.getAttribute(HIDDEN_MARKER) === "true") {
      node.removeAttribute(HIDDEN_MARKER);
      node.style.removeProperty("display");
    }
  }

  function applyListFilters() {
    const availableHeads = getAvailableHeads();
    const blockedHeadLabels = createBlockedHeadLabelSet(
      currentSettings,
      availableHeads
    );
    const hideFloatingIpPosts = !currentSettings.showFloatingIpPosts;
    const nextStats = {
      ...createEmptyFilterStats(),
      scope: "list"
    };

    document.querySelectorAll(LIST_ROW_SELECTOR).forEach((row) => {
      if (!(row instanceof HTMLTableRowElement)) {
        return;
      }

      const shouldHideByHead = blockedHeadLabels.has(getRowHeadLabel(row));
      const shouldHideByWriter = hideFloatingIpPosts && isFloatingIpRow(row);
      const shouldHide = shouldHideByHead || shouldHideByWriter;

      nextStats.totalRows += 1;

      if (shouldHideByHead) {
        nextStats.hiddenByHead += 1;
      }

      if (shouldHideByWriter) {
        nextStats.hiddenByWriter += 1;
      }

      if (shouldHide) {
        nextStats.hiddenRows += 1;
        hideNode(row);
        return;
      }

      nextStats.visibleRows += 1;
      showNode(row);
    });

    currentFilterStats = nextStats;
  }

  function applyViewFilters() {
    const commentWrap = document.querySelector(COMMENT_WRAP_SELECTOR);
    const hideFloatingIpComments = !currentSettings.showFloatingIpComments;
    const nextStats = {
      ...createEmptyFilterStats(),
      scope: "view"
    };

    if (!(commentWrap instanceof HTMLElement)) {
      currentFilterStats = nextStats;
      return;
    }

    commentWrap.querySelectorAll(COMMENT_ITEM_SELECTOR).forEach((commentItem) => {
      if (!(commentItem instanceof HTMLLIElement)) {
        return;
      }

      const shouldHideByWriter =
        hideFloatingIpComments && isFloatingIpComment(commentItem);

      nextStats.totalRows += 1;

      if (shouldHideByWriter) {
        nextStats.hiddenByWriter += 1;
        nextStats.hiddenRows += 1;
        hideNode(commentItem);
        return;
      }

      nextStats.visibleRows += 1;
      showNode(commentItem);
    });

    currentFilterStats = nextStats;
  }

  function applyFilters() {
    const pageType = getCurrentPageType();

    if (pageType === "list") {
      applyListFilters();
      return;
    }

    if (pageType === "view") {
      applyViewFilters();
      return;
    }

    currentFilterStats = createEmptyFilterStats();
  }

  function scheduleApplyFilters() {
    if (applyScheduled) {
      return;
    }

    applyScheduled = true;
    window.requestAnimationFrame(() => {
      applyScheduled = false;
      applyFilters();
    });
  }

  async function loadSettingsFromStorage() {
    const storageResult = await chrome.storage.sync.get([
      SETTINGS_KEY,
      LEGACY_SETTINGS_KEY
    ]);
    currentSettings = normalizeSettings(pickStoredSettings(storageResult));
    return currentSettings;
  }

  async function persistScrapedHeads(scrapedHeads) {
    const merged = mergeAvailableHeads(currentSettings, scrapedHeads);

    currentSettings = merged.settings;
    currentHeads = merged.settings.availableHeads;

    if (merged.changed) {
      await chrome.storage.sync.set({
        [SETTINGS_KEY]: merged.settings
      });
    }
  }

  async function syncHeadsWithPage() {
    if (!isTargetListPage()) {
      return;
    }

    const scrapedHeads = scrapeHeads();

    if (scrapedHeads.length === 0) {
      return;
    }

    const currentHeadsJson = JSON.stringify(currentHeads);
    const scrapedHeadsJson = JSON.stringify(scrapedHeads);

    if (currentHeadsJson === scrapedHeadsJson) {
      return;
    }

    await persistScrapedHeads(scrapedHeads);
    scheduleApplyFilters();
  }

  function scheduleHeadSync() {
    if (headSyncScheduled) {
      return;
    }

    headSyncScheduled = true;
    window.setTimeout(() => {
      headSyncScheduled = false;
      syncHeadsWithPage().catch(() => {
        // Ignore transient DOM/update timing issues and try again on the next change.
      });
    }, 80);
  }

  async function refreshPageContext() {
    const pageType = getCurrentPageType();

    if (!pageType) {
      return {
        supported: false
      };
    }

    await loadSettingsFromStorage();

    if (pageType === "list") {
      const scrapedHeads = scrapeHeads();
      currentHeads =
        scrapedHeads.length > 0 ? scrapedHeads : currentSettings.availableHeads;

      if (scrapedHeads.length > 0) {
        await persistScrapedHeads(scrapedHeads);
      }
    } else {
      currentHeads = currentSettings.availableHeads;
    }

    applyFilters();

    return {
      supported: true,
      pageType,
      galleryId: TARGET_GALLERY_ID,
      galleryTitle: getGalleryTitle(),
      heads: getAvailableHeads(),
      settings: currentSettings,
      stats: currentFilterStats
    };
  }

  function observePageChanges() {
    const observer = new MutationObserver((mutations) => {
      const pageType = getCurrentPageType();

      if (pageType === "list") {
        const shouldSyncHeads = mutations.some((mutation) =>
          mutationTouchesSelectors(mutation, HEAD_OBSERVER_SELECTORS)
        );
        const shouldApplyListFilters = mutations.some((mutation) =>
          mutationTouchesSelectors(mutation, LIST_OBSERVER_SELECTORS)
        );

        if (!shouldSyncHeads && !shouldApplyListFilters) {
          return;
        }

        if (shouldSyncHeads) {
          scheduleHeadSync();
        }

        if (shouldApplyListFilters) {
          scheduleApplyFilters();
        }

        return;
      }

      if (
        pageType === "view" &&
        mutations.some((mutation) =>
          mutationTouchesSelectors(mutation, VIEW_OBSERVER_SELECTORS)
        )
      ) {
        scheduleApplyFilters();
      }
    });

    if (!(document.body instanceof HTMLElement)) {
      return;
    }

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "GET_PAGE_CONTEXT") {
      refreshPageContext()
        .then((context) => sendResponse(context))
        .catch((error) =>
          sendResponse({
            supported: false,
            error: String(error)
          })
        );

      return true;
    }

    if (message?.type === "FORCE_APPLY_SETTINGS") {
      loadSettingsFromStorage()
        .then(() => {
          applyFilters();
          sendResponse({
            ok: true,
            stats: currentFilterStats
          });
        })
        .catch((error) =>
          sendResponse({
            ok: false,
            error: String(error)
          })
        );

      return true;
    }

    return undefined;
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "sync" || !changes[SETTINGS_KEY] || !isTargetGalleryPage()) {
      return;
    }

    currentSettings = normalizeSettings(changes[SETTINGS_KEY].newValue);
    currentHeads =
      currentSettings.availableHeads.length > 0
        ? currentSettings.availableHeads
        : currentHeads;
    scheduleApplyFilters();
  });

  if (!isTargetGalleryPage()) {
    return;
  }

  refreshPageContext().catch(() => {
    scheduleApplyFilters();
  });
  observePageChanges();

  window.addEventListener("pageshow", () => {
    refreshPageContext().catch(() => {
      scheduleApplyFilters();
    });
  });
})();
