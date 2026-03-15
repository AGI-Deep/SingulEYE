(() => {
  const {
    LEGACY_SETTINGS_KEY,
    SETTINGS_KEY,
    TARGET_GALLERY_ID,
    VISITED_KEY,
    VISITED_MAX,
    OO_NICK_PATTERN,
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
  const TITLE_CELL_SELECTOR = "td.gall_tit";
  const HIDDEN_MARKER = "data-singul-eye-hidden";
  const VISITED_MARKER = "data-singul-eye-visited";
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
  let visitedPosts = new Set();
  let visitedStyleInjected = false;

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

  function isNoticeRow(row) {
    if (row.dataset.type === "icon_notice") {
      return true;
    }

    const subject = getRowHeadLabel(row);

    if (subject === "공지" || subject === "설문") {
      return true;
    }

    const writer = row.querySelector(LIST_WRITER_CELL_SELECTOR);
    return normalizeText(writer?.textContent || "") === "운영자";
  }

  function isOoNickRow(row) {
    const writer = row.querySelector(LIST_WRITER_CELL_SELECTOR);

    if (!(writer instanceof HTMLElement)) {
      return false;
    }

    if (normalizeText(writer.getAttribute("data-ip") || "")) {
      return false;
    }

    const nick = normalizeText(
      writer.dataset.nick ||
      writer.querySelector(".nickname em")?.textContent ||
      writer.querySelector(".nickname")?.textContent ||
      ""
    );

    if (!nick) {
      return false;
    }

    return OO_NICK_PATTERN.test(nick);
  }

  function getRowTitle(row) {
    const titleCell = row.querySelector(TITLE_CELL_SELECTOR);

    if (!titleCell) {
      return "";
    }

    const titleAnchor = titleCell.querySelector("a:not(.reply_numbox)");
    return normalizeText(
      titleAnchor?.textContent || titleCell?.textContent || ""
    );
  }

  function buildTitleKeys(title) {
    const normalized = title
      .normalize("NFKC")
      .toLowerCase()
      .replace(/\[[^\]]*]/g, " ")
      .replace(/[~`!@#$%^&*()_+\-=[\]{};:'",.<>/?\\|]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    return {
      exact: normalized.replace(/\s+/g, ""),
      noDigits: normalized.replace(/\s+/g, "").replace(/\d+/g, "")
    };
  }

  function buildDuplicateIndex(rowMetas) {
    const exactCounts = new Map();
    const noDigitsCounts = new Map();

    if (
      !currentSettings.hideDuplicateExact &&
      !currentSettings.hideDuplicateLoose
    ) {
      return { exactCounts, noDigitsCounts, seenGroups: new Set() };
    }

    for (const meta of rowMetas) {
      if (!meta.isDuplicateCandidate || meta.isFilteredByBase) {
        continue;
      }

      if (
        currentSettings.hideDuplicateExact &&
        meta.titleKeyExact.length >= 4
      ) {
        exactCounts.set(
          meta.titleKeyExact,
          (exactCounts.get(meta.titleKeyExact) || 0) + 1
        );
      }

      if (
        currentSettings.hideDuplicateLoose &&
        meta.titleKeyNoDigits.length >= 6
      ) {
        noDigitsCounts.set(
          meta.titleKeyNoDigits,
          (noDigitsCounts.get(meta.titleKeyNoDigits) || 0) + 1
        );
      }
    }

    return { exactCounts, noDigitsCounts, seenGroups: new Set() };
  }

  function classifyDuplicate(meta, dupIndex) {
    if (!meta.isDuplicateCandidate) {
      return null;
    }

    const isExactDup =
      currentSettings.hideDuplicateExact &&
      meta.titleKeyExact.length >= 4 &&
      (dupIndex.exactCounts.get(meta.titleKeyExact) || 0) > 1;

    const isLooseDup =
      currentSettings.hideDuplicateLoose &&
      meta.titleKeyNoDigits.length >= 6 &&
      (dupIndex.noDigitsCounts.get(meta.titleKeyNoDigits) || 0) > 1;

    if (!isExactDup && !isLooseDup) {
      return null;
    }

    const groupKey = isExactDup
      ? `exact:${meta.titleKeyExact}`
      : `nodigits:${meta.titleKeyNoDigits}`;
    const isFirst = !dupIndex.seenGroups.has(groupKey);
    dupIndex.seenGroups.add(groupKey);

    return { isFirst };
  }

  function syncCommentReplyVisibility() {
    document.querySelectorAll(".view_comment .reply").forEach((replyWrap) => {
      const hasVisibleReplies = Array.from(
        replyWrap.querySelectorAll(".reply_list > li.ub-content")
      ).some((row) => {
        return row.style.display !== "none" && !row.hasAttribute(HIDDEN_MARKER);
      });

      if (hasVisibleReplies) {
        replyWrap.style.removeProperty("display");
      } else {
        replyWrap.style.setProperty("display", "none", "important");
      }
    });

    document.querySelectorAll(".img_comment").forEach((wrap) => {
      const hasVisibleComments = Array.from(
        wrap.querySelectorAll(".img_comment_box li.ub-content")
      ).some((row) => {
        return row.style.display !== "none" && !row.hasAttribute(HIDDEN_MARKER);
      });

      if (hasVisibleComments) {
        wrap.style.removeProperty("display");
      } else {
        wrap.style.setProperty("display", "none", "important");
      }
    });
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

  function injectVisitedStyles() {
    if (visitedStyleInjected) {
      return;
    }

    const style = document.createElement("style");
    style.id = "singul-eye-visited-styles";
    style.textContent = [
      `tr.ub-content[${VISITED_MARKER}] td.gall_tit > a:first-of-type::before {`,
      `  content: "✓";`,
      `  margin-right: 4px;`,
      `  color: #3182f6;`,
      `  font-weight: 700;`,
      `  font-size: 11px;`,
      `}`,
      `tr.ub-content[${VISITED_MARKER}] td.gall_tit > a:first-of-type {`,
      `  color: #8b95a1 !important;`,
      `}`
    ].join("\n");

    (document.head || document.documentElement).appendChild(style);
    visitedStyleInjected = true;
  }

  function removeVisitedStyles() {
    const style = document.getElementById("singul-eye-visited-styles");

    if (style) {
      style.remove();
    }

    visitedStyleInjected = false;
  }

  async function loadVisitedPosts() {
    const result = await chrome.storage.local.get(VISITED_KEY);
    const data = result[VISITED_KEY];
    visitedPosts = new Set(Array.isArray(data) ? data : []);
    return visitedPosts;
  }

  async function saveVisitedPost(postNo) {
    if (!postNo) {
      return;
    }

    visitedPosts.delete(postNo);
    visitedPosts.add(postNo);

    if (visitedPosts.size > VISITED_MAX) {
      const entries = Array.from(visitedPosts);
      visitedPosts = new Set(entries.slice(entries.length - VISITED_MAX));
    }

    await chrome.storage.local.set({
      [VISITED_KEY]: Array.from(visitedPosts)
    });
  }

  function getPostNoFromRow(row) {
    const dataNo = row.getAttribute("data-no");

    if (dataNo && /^\d+$/.test(dataNo)) {
      return dataNo;
    }

    const link = row.querySelector('a[href*="no="]');

    if (link) {
      const match = (link.getAttribute("href") || "").match(/[?&]no=(\d+)/);

      if (match) {
        return match[1];
      }
    }

    return "";
  }

  function applyVisitedMarks() {
    if (!currentSettings.showVisitedMarks) {
      removeVisitedStyles();
      document.querySelectorAll(`[${VISITED_MARKER}]`).forEach((row) => {
        row.removeAttribute(VISITED_MARKER);
      });
      return;
    }

    injectVisitedStyles();

    document.querySelectorAll(LIST_ROW_SELECTOR).forEach((row) => {
      const postNo = getPostNoFromRow(row);

      if (!postNo) {
        return;
      }

      if (visitedPosts.has(postNo)) {
        row.setAttribute(VISITED_MARKER, "true");
      } else {
        row.removeAttribute(VISITED_MARKER);
      }
    });
  }

  function setupListClickTracking() {
    document.addEventListener(
      "click",
      (event) => {
        if (!currentSettings.showVisitedMarks || !isTargetListPage()) {
          return;
        }

        const link = event.target.closest(
          TITLE_CELL_SELECTOR + ' a[href*="no="]'
        );

        if (!link) {
          return;
        }

        const match = (link.getAttribute("href") || "").match(/[?&]no=(\d+)/);

        if (!match) {
          return;
        }

        const postNo = match[1];
        const row = link.closest(LIST_ROW_SELECTOR);

        if (row) {
          row.setAttribute(VISITED_MARKER, "true");
        }

        saveVisitedPost(postNo).catch(() => {});
      },
      true
    );
  }

  async function markCurrentPostAsVisited() {
    if (!currentSettings.showVisitedMarks) {
      return;
    }

    const postNo = getCurrentUrl().searchParams.get("no");

    if (postNo && /^\d+$/.test(postNo)) {
      await saveVisitedPost(postNo);
    }
  }

  function applyListFilters() {
    const availableHeads = getAvailableHeads();
    const blockedHeadLabels = createBlockedHeadLabelSet(
      currentSettings,
      availableHeads
    );
    const hideFloatingIpPosts = !currentSettings.showFloatingIpPosts;
    const hideOoNick = !currentSettings.showOoNickPosts;
    const preserveNotice = currentSettings.preserveNotice;
    const nextStats = {
      ...createEmptyFilterStats(),
      scope: "list"
    };

    // Pass 1: parse every row and collect metadata
    const rowMetas = [];

    document.querySelectorAll(LIST_ROW_SELECTOR).forEach((row) => {
      if (!(row instanceof HTMLTableRowElement)) {
        return;
      }

      const isNotice = isNoticeRow(row);
      const isProtected = preserveNotice && isNotice;
      const byHead = blockedHeadLabels.has(getRowHeadLabel(row));
      const byWriter = hideFloatingIpPosts && isFloatingIpRow(row);
      const byOoNick = hideOoNick && isOoNickRow(row);
      const title = getRowTitle(row);
      const titleKeys = buildTitleKeys(title);

      rowMetas.push({
        row,
        isNotice,
        isProtected,
        byHead,
        byWriter,
        byOoNick,
        isFilteredByBase: !isProtected && (byHead || byWriter || byOoNick),
        titleKeyExact: titleKeys.exact,
        titleKeyNoDigits: titleKeys.noDigits,
        isDuplicateCandidate: !isNotice && Boolean(title)
      });
    });

    // Build duplicate title index from non-base-filtered rows
    const dupIndex = buildDuplicateIndex(rowMetas);

    // Pass 2: apply hide/show
    for (const meta of rowMetas) {
      const dupInfo = classifyDuplicate(meta, dupIndex);
      const byDuplicate = dupInfo !== null && !dupInfo.isFirst;
      const shouldHide =
        !meta.isProtected && (meta.isFilteredByBase || byDuplicate);

      nextStats.totalRows += 1;

      if (meta.byHead && !meta.isProtected) {
        nextStats.hiddenByHead += 1;
      }

      if ((meta.byWriter || meta.byOoNick || byDuplicate) && !meta.isProtected) {
        nextStats.hiddenByWriter += 1;
      }

      if (shouldHide) {
        nextStats.hiddenRows += 1;
        hideNode(meta.row);
      } else {
        nextStats.visibleRows += 1;
        showNode(meta.row);
      }
    }

    currentFilterStats = nextStats;
    applyVisitedMarks();
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

    syncCommentReplyVisibility();
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
    await loadVisitedPosts();

    if (pageType === "list") {
      const scrapedHeads = scrapeHeads();
      currentHeads =
        scrapedHeads.length > 0 ? scrapedHeads : currentSettings.availableHeads;

      if (scrapedHeads.length > 0) {
        await persistScrapedHeads(scrapedHeads);
      }
    } else {
      currentHeads = currentSettings.availableHeads;

      if (pageType === "view") {
        await markCurrentPostAsVisited();
      }
    }

    applyFilters();

    return {
      supported: true,
      pageType,
      galleryId: TARGET_GALLERY_ID,
      galleryTitle: getGalleryTitle(),
      heads: getAvailableHeads(),
      settings: currentSettings,
      stats: currentFilterStats,
      visitedCount: visitedPosts.size
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

    if (message?.type === "CLEAR_VISITED") {
      visitedPosts = new Set();
      chrome.storage.local
        .remove(VISITED_KEY)
        .then(() => {
          applyVisitedMarks();
          sendResponse({ ok: true });
        })
        .catch((error) =>
          sendResponse({ ok: false, error: String(error) })
        );

      return true;
    }

    if (message?.type === "GET_VISITED_COUNT") {
      loadVisitedPosts()
        .then(() => sendResponse({ count: visitedPosts.size }))
        .catch(() => sendResponse({ count: 0 }));

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
  setupListClickTracking();

  window.addEventListener("pageshow", () => {
    refreshPageContext().catch(() => {
      scheduleApplyFilters();
    });
  });
})();
