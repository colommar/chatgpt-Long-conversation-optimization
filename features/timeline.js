/*
 * ChatGPT Conversation Toolkit - Timeline
 */
// ============ 时间线功能 ============

let timelineBoundScrollRoot = null;
let timelineWindowScrollBound = false;
const TIMELINE_SOURCE_SYNC_INTERVAL_MS = 140;
const TIMELINE_JUMP_RETRY_DELAY_MS = 180;
const TIMELINE_JUMP_RETRY_ATTEMPTS = 4;
const TIMELINE_JUMP_STEP_DELAY_MS = 72;
const TIMELINE_JUMP_STEP_MAX_STEPS = 6;
const TOC_TITLE_MAX_LENGTH = 88;
const TOC_PREVIEW_MAX_LENGTH = 180;
let timelineJumpResolveTimer = null;
let timelineJumpScrollTimer = null;

const getTimelineElements = () => {
  const timeline = document.getElementById(TIMELINE_ID);
  if (!timeline) {
    return null;
  }

  return {
    timeline,
    track: timeline.querySelector(`#${TIMELINE_TRACK_ID}`),
    count: timeline.querySelector(`#${TIMELINE_COUNT_ID}`),
    content: timeline.querySelector(`.${TIMELINE_CONTENT_CLASS}`),
    preview: timeline.querySelector(`#${TIMELINE_PREVIEW_ID}`),
    hint: timeline.querySelector(`#${TIMELINE_HINT_ID}`),
  };
};

const ensureTimelineTrackContent = (track) => {
  if (!(track instanceof HTMLElement)) {
    return null;
  }

  const existingContent = track.querySelector(`.${TIMELINE_CONTENT_CLASS}`);
  if (existingContent instanceof HTMLElement) {
    return existingContent;
  }

  const content = document.createElement("div");
  content.className = TIMELINE_CONTENT_CLASS;
  while (track.firstChild) {
    content.appendChild(track.firstChild);
  }
  track.appendChild(content);
  return content;
};

const getTimelineMessageKey = (node, index) => {
  if (!(node instanceof HTMLElement)) {
    return `timeline-user-${index}`;
  }
  if (typeof getMessageNodeKey === "function") {
    return getMessageNodeKey(node, index);
  }

  const messageId =
    node.getAttribute("data-turn-id") ||
    node.querySelector("[data-turn-id]")?.getAttribute("data-turn-id") ||
    node.getAttribute("data-message-id") ||
    node.querySelector("[data-message-id]")?.getAttribute("data-message-id") ||
    "";
  if (messageId) {
    return `mid:${messageId}`;
  }

  const turnTestId =
    node.getAttribute("data-testid") ||
    node.querySelector('[data-testid^="conversation-turn-"]')?.getAttribute("data-testid") ||
    "";
  if (turnTestId) {
    // Append index to avoid collisions when testid is duplicated in nested/virtualized structures.
    return `tid:${turnTestId}:${index}`;
  }

  return `timeline-user-${index}`;
};

const getTimelineSourceKey = (source, index) => {
  if (source instanceof HTMLElement) {
    return getTimelineMessageKey(source, index);
  }
  return source?.key || `timeline-user-${index}`;
};

const getTimelineSourceNode = (source, options = {}) => {
  const { resolve = true } = options;
  if (source instanceof HTMLElement) {
    return source;
  }
  if (!resolve) {
    return source?.node instanceof HTMLElement && source.node.isConnected ? source.node : null;
  }
  if (typeof resolveCachedMessageNode === "function") {
    return resolveCachedMessageNode(source);
  }
  return source?.node instanceof HTMLElement && source.node.isConnected ? source.node : null;
};

const getTimelineSourceText = (source) => {
  if (source instanceof HTMLElement) {
    return extractMessageText(source);
  }
  return source?.text || "";
};

const getTimelineSourceOrder = (source, index) => {
  if (source instanceof HTMLElement && typeof getMessageNodeOrder === "function") {
    return getMessageNodeOrder(source, index);
  }
  if (!(source instanceof HTMLElement) && Number.isFinite(source?.order)) {
    return source.order;
  }
  return index + 1;
};

const getTimelineSourceRole = (source) => {
  if (source instanceof HTMLElement) {
    return typeof detectRole === "function" ? detectRole(source) : "unknown";
  }
  return source?.role || "unknown";
};

const getTimelineSourceNodes = () => {
  const sourceItems =
    typeof getConversationMessageEntries === "function"
      ? getConversationMessageEntries({
          mode: TOOLKIT_MESSAGE_MODE_EXTENDED,
          refreshDom: true,
        })
      : typeof getCachedMessageEntries === "function"
        ? getCachedMessageEntries({ mode: TOOLKIT_MESSAGE_MODE_EXTENDED })
        : getMessageNodes();
  const fallbackItems =
    sourceItems.length > 0
      ? sourceItems
      : typeof getConversationMessageEntries === "function"
        ? getConversationMessageEntries({
            mode: TOOLKIT_MESSAGE_MODE_EXTENDED,
            refreshDom: false,
          })
        : typeof getCachedMessageEntries === "function"
          ? getCachedMessageEntries({ mode: TOOLKIT_MESSAGE_MODE_EXTENDED })
          : getMessageNodes();
  const uniqueItems = [];
  const seenKeys = new Set();

  fallbackItems.forEach((source, index) => {
    const role = getTimelineSourceRole(source);
    if (role !== "user" && role !== "assistant") {
      return;
    }
    const key = getTimelineSourceKey(source, index);
    if (!key || seenKeys.has(key)) {
      return;
    }
    seenKeys.add(key);
    uniqueItems.push(source);
  });

  return uniqueItems;
};

const normalizeTimelineText = (text) => (text || "").replace(/\s+/g, " ").trim();
const truncateTimelineText = (text, maxLength = 110) =>
  text.length <= maxLength ? text : `${text.slice(0, maxLength)}...`;
const clampTimelineValue = (value, min, max) => Math.min(Math.max(value, min), max);
const isTimelineTitleEditing = () =>
  Boolean(document.querySelector(".chatgpt-toolkit-toc-edit-input"));

const getTimelineAutoTitle = (text, index) => {
  const normalized = normalizeTimelineText(text);
  if (!normalized) {
    return t("timeline.previewFallback", { index: index + 1 });
  }
  return truncateTimelineText(normalized, TOC_TITLE_MAX_LENGTH);
};

const getTimelineCustomTitle = (messageKey) =>
  typeof getTocTitle === "function" ? getTocTitle(state.conversationKey || "", messageKey) : "";

const getTimelineDisplayTitle = (messageKey, text, index) => {
  const customTitle = getTimelineCustomTitle(messageKey);
  return customTitle || getTimelineAutoTitle(text, index);
};

const isTimelineSourceStub = (source, node = null) => {
  const sourceNode = node instanceof HTMLElement ? node : getTimelineSourceNode(source, { resolve: false });
  return typeof isToolkitMessageStubNode === "function" && isToolkitMessageStubNode(sourceNode);
};

const getTimelineRoleLabel = (role) =>
  role === "assistant" ? t("stub.roleAssistant") : t("stub.roleUser");

const parseTimelineTimestampCandidate = (value) => {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  const text = String(value).trim();
  if (!text) {
    return null;
  }

  if (/^\d{10}$/.test(text)) {
    const numeric = Number(text);
    return Number.isFinite(numeric) ? numeric * 1000 : null;
  }

  if (/^\d{11,16}$/.test(text)) {
    const numeric = Number(text);
    return Number.isFinite(numeric) ? numeric : null;
  }

  const parsed = Date.parse(text);
  if (Number.isNaN(parsed)) {
    return null;
  }
  return parsed;
};

const extractTimelineTimestamp = (node, index, previousTimestamp) => {
  const directCandidates = [
    node.getAttribute("data-timestamp"),
    node.getAttribute("data-created-at"),
    node.getAttribute("data-time"),
    node.getAttribute("datetime"),
  ];

  for (const candidate of directCandidates) {
    const parsed = parseTimelineTimestampCandidate(candidate);
    if (parsed !== null) {
      return parsed;
    }
  }

  const nestedSelectors = [
    "time[datetime]",
    "[data-timestamp]",
    "[data-created-at]",
    "[datetime]",
  ];

  for (const selector of nestedSelectors) {
    const element = node.querySelector(selector);
    if (!(element instanceof HTMLElement)) {
      continue;
    }
    const parsed = parseTimelineTimestampCandidate(
      element.getAttribute("datetime") ||
      element.getAttribute("data-timestamp") ||
      element.getAttribute("data-created-at") ||
      element.getAttribute("data-time")
    );
    if (parsed !== null) {
      return parsed;
    }
  }

  if (Number.isFinite(previousTimestamp)) {
    return previousTimestamp + 60000;
  }
  return index * 60000;
};

const pickNearestUnselectedIndex = (items, targetTimestamp, selectedIndexes) => {
  let bestIndex = -1;
  let bestDistance = Number.POSITIVE_INFINITY;

  items.forEach((item, index) => {
    if (selectedIndexes.has(index)) {
      return;
    }
    const distance = Math.abs(item.timestamp - targetTimestamp);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });

  return bestIndex;
};

const limitTimelineItems = (items, maxNodes = 20) => {
  if (items.length <= maxNodes) {
    return items.map((item) => ({ ...item }));
  }

  const minTimestamp = items[0].timestamp;
  const maxTimestamp = items[items.length - 1].timestamp;
  const selectedIndexes = new Set();

  if (maxTimestamp <= minTimestamp) {
    for (let i = 0; i < maxNodes; i += 1) {
      const index = Math.round((i * (items.length - 1)) / Math.max(1, maxNodes - 1));
      selectedIndexes.add(index);
    }
  } else {
    for (let i = 0; i < maxNodes; i += 1) {
      const ratio = i / Math.max(1, maxNodes - 1);
      const targetTimestamp = minTimestamp + (maxTimestamp - minTimestamp) * ratio;
      const picked = pickNearestUnselectedIndex(items, targetTimestamp, selectedIndexes);
      if (picked >= 0) {
        selectedIndexes.add(picked);
      }
    }
  }

  const indexes = Array.from(selectedIndexes).sort((left, right) => left - right);
  return indexes.map((index) => ({ ...items[index] }));
};

const assignTimelinePositions = (items) => {
  if (items.length <= 1) {
    return items.map((item) => ({ ...item, position: 0.5 }));
  }

  const minTimestamp = items[0].timestamp;
  const maxTimestamp = items[items.length - 1].timestamp;

  if (maxTimestamp <= minTimestamp) {
    return items.map((item, index) => ({
      ...item,
      position: clampTimelineValue(index / (items.length - 1), 0.02, 0.98),
    }));
  }

  return items.map((item) => ({
    ...item,
    position: clampTimelineValue(
      (item.timestamp - minTimestamp) / (maxTimestamp - minTimestamp),
      0.02,
      0.98
    ),
  }));
};

const buildTimelineSignature = (items) =>
  items
    .map((item) =>
      `${item.key}:${item.title || ""}:${item.isStub ? "stub" : "live"}:${Math.round(item.position * 1000)}`,
    )
    .join("|");

const buildTimelineSourceSignature = (sources) =>
  `${sources.length}|${sources
    .map((source, index) => {
      const node = getTimelineSourceNode(source, { resolve: false });
      const stubFlag =
        typeof isToolkitMessageStubNode === "function" && isToolkitMessageStubNode(node) ? "stub" : "live";
      return `${getTimelineSourceKey(source, index)}:${getTimelineSourceText(source).length}:${stubFlag}`;
    })
    .join("|")}`;

const isSameTimelineSource = (sources, signature) =>
  timelineState.sourceSignature === signature &&
  timelineState.sourceNodes.length === sources.length &&
  sources.every(
    (source, index) =>
      getTimelineSourceKey(source, index) === getTimelineSourceKey(timelineState.sourceNodes[index], index),
  );

const calculateTimelineContentHeight = (trackHeight, itemCount) => {
  const safeTrackHeight = Math.max(1, Math.round(trackHeight));
  if (itemCount <= TIMELINE_VISIBLE_NODE_CAPACITY) {
    return safeTrackHeight;
  }
  const ratio = itemCount / TIMELINE_VISIBLE_NODE_CAPACITY;
  return Math.max(safeTrackHeight, Math.round(safeTrackHeight * ratio));
};

const getTimelineTrackMaxScrollTop = (track) =>
  Math.max(0, track.scrollHeight - track.clientHeight);

const normalizeTimelineWheelDelta = (event) => {
  let delta = event.deltaY;
  if (event.deltaMode === 1) {
    delta *= 16;
  } else if (event.deltaMode === 2) {
    delta *= Math.max(window.innerHeight * 0.85, 320);
  }

  if (delta !== 0 && Math.abs(delta) < 2) {
    return delta > 0 ? 2 : -2;
  }
  return delta;
};

const compressTimelineWheelDelta = (delta) => {
  if (delta === 0) {
    return 0;
  }
  const distance = clampTimelineValue(
    Math.abs(delta) * TIMELINE_WHEEL_DISTANCE_SCALE,
    TIMELINE_WHEEL_MIN_STEP,
    TIMELINE_WHEEL_MAX_STEP
  );
  return delta > 0 ? distance : -distance;
};

const isTimelineInteractionLocked = () => timelineState.pointerDown || timelineState.dragging;

const markTimelineRefreshPending = () => {
  timelineState.refreshPending = true;
};

const updateTimelineBubblePlacement = () => {
  const elements = getTimelineElements();
  const timeline = elements?.timeline;
  if (!(timeline instanceof HTMLElement)) {
    return;
  }
  if (isTimelineInteractionLocked()) {
    return;
  }

  const timelineRect = timeline.getBoundingClientRect();
  const previewWidth = elements.preview instanceof HTMLElement
    ? Math.max(220, Math.round(elements.preview.getBoundingClientRect().width || 0))
    : 240;
  const hintWidth = elements.hint instanceof HTMLElement
    ? Math.max(120, Math.round(elements.hint.getBoundingClientRect().width || 0))
    : 140;
  const sideBubbleWidth = Math.max(previewWidth, hintWidth);
  const rightSpace = window.innerWidth - timelineRect.right;
  const leftSpace = timelineRect.left;
  const shouldFlip = rightSpace < sideBubbleWidth + 20 && leftSpace > rightSpace;
  timeline.classList.toggle("is-flipped", shouldFlip);

  const hintHeight = elements.hint instanceof HTMLElement
    ? Math.max(30, Math.round(elements.hint.getBoundingClientRect().height || 0))
    : 30;
  const bottomSpace = window.innerHeight - timelineRect.bottom;
  const shouldShowHintOnTop = bottomSpace < hintHeight + 16;
  timeline.classList.toggle("is-hint-top", shouldShowHintOnTop);
};

const hideTimelineHint = () => {
  const elements = getTimelineElements();
  const hint = elements?.hint;
  if (!(hint instanceof HTMLElement)) {
    return;
  }
  hint.classList.remove("is-visible");
  hint.textContent = "";
};

const showTimelineHint = (message) => {
  const elements = getTimelineElements();
  const hint = elements?.hint;
  if (!(hint instanceof HTMLElement)) {
    return;
  }
  if (timelineHintTimer) {
    clearTimeout(timelineHintTimer);
  }
  hint.textContent = message;
  updateTimelineBubblePlacement();
  hint.classList.add("is-visible");
  timelineHintTimer = setTimeout(() => {
    hint.classList.remove("is-visible");
    timelineHintTimer = null;
  }, 2000);
};

const hideTimelinePreview = () => {
  const elements = getTimelineElements();
  const preview = elements?.preview;
  if (!(preview instanceof HTMLElement)) {
    return;
  }
  preview.classList.remove("is-visible");
  preview.textContent = "";
  timelineState.hoverIndex = -1;
};

const showTimelinePreview = (index) => {
  if (index < 0 || index >= timelineState.items.length) {
    hideTimelinePreview();
    return;
  }

  const elements = getTimelineElements();
  const preview = elements?.preview;
  if (!(preview instanceof HTMLElement)) {
    return;
  }

  const item = timelineState.items[index];
  if (!item) {
    hideTimelinePreview();
    return;
  }

  if (timelineState.hoverIndex === index && preview.classList.contains("is-visible")) {
    return;
  }

  timelineState.hoverIndex = index;
  preview.textContent = truncateTimelineText(
    item.previewText || item.title || t("timeline.previewFallback", { index: item.order || index + 1 }),
    TOC_PREVIEW_MAX_LENGTH,
  );
  updateTimelineBubblePlacement();
  preview.classList.add("is-visible");
};

const updateTimelineActiveUi = () => {
  const elements = getTimelineElements();
  const track = elements?.track;
  if (!(track instanceof HTMLElement)) {
    return;
  }

  const nodes = track.querySelectorAll(".chatgpt-toolkit-timeline-node");
  nodes.forEach((node) => {
    const element = node;
    if (!(element instanceof HTMLElement)) {
      return;
    }
    const index = Number(element.dataset.timelineIndex);
    if (Number.isNaN(index)) {
      return;
    }
    if (index === timelineState.activeIndex) {
      element.classList.add("is-active");
    } else {
      element.classList.remove("is-active");
    }
  });
};

const highlightTimelineMessageNode = (node) => {
  if (!(node instanceof HTMLElement)) {
    return;
  }
  if (timelineHighlightTimer) {
    clearTimeout(timelineHighlightTimer);
  }
  node.classList.add("chatgpt-toolkit-timeline-target");
  timelineHighlightTimer = setTimeout(() => {
    node.classList.remove("chatgpt-toolkit-timeline-target");
    timelineHighlightTimer = null;
  }, 1400);
};

const clearTimelineJumpResolveTimer = () => {
  if (timelineJumpResolveTimer) {
    clearTimeout(timelineJumpResolveTimer);
    timelineJumpResolveTimer = null;
  }
};

const clearTimelineJumpScrollTimer = () => {
  if (timelineJumpScrollTimer) {
    clearTimeout(timelineJumpScrollTimer);
    timelineJumpScrollTimer = null;
  }
};

const getConversationScrollController = () => {
  const scrollRoot =
    typeof resolveConversationScrollRoot === "function"
      ? resolveConversationScrollRoot()
      : null;
  if (!(scrollRoot instanceof HTMLElement)) {
    return null;
  }

  const isDocumentLike =
    typeof isConversationDocumentScrollRoot === "function" &&
    isConversationDocumentScrollRoot(scrollRoot);

  if (isDocumentLike) {
    const doc = document.scrollingElement || document.documentElement || document.body;
    return {
      isDocumentLike: true,
      viewportHeight: Math.max(1, window.innerHeight || document.documentElement?.clientHeight || 0),
      getTop: () =>
        Math.max(0, window.scrollY || window.pageYOffset || document.documentElement?.scrollTop || 0),
      getMaxTop: () => {
        const viewportHeight = Math.max(1, window.innerHeight || document.documentElement?.clientHeight || 0);
        return Math.max(0, (doc?.scrollHeight || 0) - viewportHeight);
      },
      setTop: (top, behavior = "auto") => {
        window.scrollTo({ top, behavior });
      },
    };
  }

  return {
    isDocumentLike: false,
    viewportHeight: Math.max(1, scrollRoot.clientHeight || 1),
    getTop: () => Math.max(0, scrollRoot.scrollTop || 0),
    getMaxTop: () => Math.max(0, scrollRoot.scrollHeight - scrollRoot.clientHeight),
    setTop: (top, behavior = "auto") => {
      scrollRoot.scrollTo({ top, behavior });
    },
  };
};

const getTimelineOrderTargetTop = (order, totalCount, maxTop) => {
  const normalizedOrder = Number.isFinite(order) ? Math.max(1, Math.trunc(order)) : 1;
  const normalizedTotal = Number.isFinite(totalCount) ? Math.max(1, Math.trunc(totalCount)) : 1;
  const ratio =
    normalizedTotal <= 1 ? 1 : clampTimelineValue((normalizedOrder - 1) / (normalizedTotal - 1), 0, 1);
  if (ratio <= 0.02) {
    return 0;
  }
  if (ratio >= 0.98) {
    return maxTop;
  }
  return Math.round(maxTop * ratio);
};

const scrollConversationToTimelineOrder = (order, totalCount, options = {}) => {
  const { behavior = "smooth" } = options;
  const controller = getConversationScrollController();
  if (!controller) {
    return false;
  }

  const maxTop = controller.getMaxTop();
  const targetTop = getTimelineOrderTargetTop(order, totalCount, maxTop);
  controller.setTop(targetTop, behavior);
  return true;
};

const simulateConversationScrollTowardsTimelineOrder = (order, totalCount, options = {}) => {
  const {
    maxSteps = TIMELINE_JUMP_STEP_MAX_STEPS,
    stepDelayMs = TIMELINE_JUMP_STEP_DELAY_MS,
    onDone = null,
  } = options;
  const controller = getConversationScrollController();
  if (!controller) {
    return false;
  }

  const maxTop = controller.getMaxTop();
  const targetTop = getTimelineOrderTargetTop(order, totalCount, maxTop);
  const safeMaxSteps = Math.max(1, Math.trunc(maxSteps));
  const stepPx = clampTimelineValue(
    Math.round(controller.viewportHeight * 0.72),
    160,
    860,
  );

  clearTimelineJumpScrollTimer();

  let remainingSteps = safeMaxSteps;
  const runStep = () => {
    const currentTop = controller.getTop();
    const distance = targetTop - currentTop;
    if (Math.abs(distance) <= stepPx || remainingSteps <= 0) {
      controller.setTop(targetTop, "auto");
      if (typeof getMessageNodes === "function") {
        getMessageNodes({ forceRefresh: true });
      }
      if (typeof onDone === "function") {
        onDone();
      }
      return;
    }

    const nextTop = currentTop + Math.sign(distance) * stepPx;
    controller.setTop(nextTop, "auto");
    if (typeof getMessageNodes === "function") {
      getMessageNodes({ forceRefresh: true });
    }
    remainingSteps -= 1;
    timelineJumpScrollTimer = setTimeout(runStep, stepDelayMs);
  };

  runStep();
  return true;
};

const queueTimelineNodeResolveAfterJump = (index, options = {}) => {
  clearTimelineJumpResolveTimer();
  clearTimelineJumpScrollTimer();
  const { highlightMessage = false, attempts = TIMELINE_JUMP_RETRY_ATTEMPTS } = options;
  const maxAttempts = Math.max(1, Math.trunc(attempts));

  const attemptResolve = (remainingAttempts) => {
    timelineJumpResolveTimer = setTimeout(() => {
      timelineJumpResolveTimer = null;

      if (!timelineState.visible || document.hidden || document.visibilityState === "hidden") {
        return;
      }

      const item = timelineState.items[index];
      if (!item) {
        return;
      }

      let liveNode = getTimelineSourceNode(item.source);
      if (liveNode instanceof HTMLElement && liveNode.isConnected) {
        if (
          typeof isToolkitMessageStubNode === "function" &&
          isToolkitMessageStubNode(liveNode) &&
          typeof restoreMessageStubByKey === "function"
        ) {
          const restoredNode = restoreMessageStubByKey(item.key, { refreshTimeline: false });
          if (restoredNode instanceof HTMLElement && restoredNode.isConnected) {
            liveNode = restoredNode;
            item.isStub = false;
            if (!(item.source instanceof HTMLElement)) {
              item.source.node = restoredNode;
            }
            scheduleTimelineRefresh();
          }
        }
        item.node = liveNode;
        if (typeof scrollElementIntoConversationView === "function") {
          scrollElementIntoConversationView(liveNode, { behavior: "smooth", block: "center" });
        } else {
          liveNode.scrollIntoView({ behavior: "smooth", block: "center" });
        }
        if (highlightMessage) {
          highlightTimelineMessageNode(liveNode);
        }
        return;
      }

      if (remainingAttempts <= 1) {
        showTimelineHint(t("timeline.hintMessageNotLoaded"));
        return;
      }

      const currentOrder = Number.isFinite(item.order) ? item.order : index + 1;
      const simulated = simulateConversationScrollTowardsTimelineOrder(
        currentOrder,
        timelineState.totalUserCount,
        {
          maxSteps: TIMELINE_JUMP_STEP_MAX_STEPS,
          stepDelayMs: TIMELINE_JUMP_STEP_DELAY_MS,
          onDone: () => {
            attemptResolve(remainingAttempts - 1);
          },
        },
      );
      if (!simulated) {
        scrollConversationToTimelineOrder(currentOrder, timelineState.totalUserCount, {
          behavior: "auto",
        });
        attemptResolve(remainingAttempts - 1);
        return;
      }
      if (typeof getMessageNodes === "function") {
        getMessageNodes({ forceRefresh: true });
      }
    }, TIMELINE_JUMP_RETRY_DELAY_MS);
  };

  if (typeof getMessageNodes === "function") {
    getMessageNodes({ forceRefresh: true });
  }
  const currentItem = timelineState.items[index];
  if (currentItem) {
    const currentOrder = Number.isFinite(currentItem.order) ? currentItem.order : index + 1;
    simulateConversationScrollTowardsTimelineOrder(currentOrder, timelineState.totalUserCount, {
      maxSteps: Math.max(1, Math.trunc(TIMELINE_JUMP_STEP_MAX_STEPS / 2)),
      stepDelayMs: TIMELINE_JUMP_STEP_DELAY_MS,
      onDone: () => {
        attemptResolve(maxAttempts);
      },
    });
    return;
  }
  attemptResolve(maxAttempts);
};

const setTimelineActiveIndex = (index, options = {}) => {
  if (index < 0 || index >= timelineState.items.length) {
    updateTimelineCount(0, timelineState.totalUserCount);
    return;
  }

  const { scrollToMessage = false, highlightMessage = false } = options;
  timelineState.activeIndex = index;
  updateTimelineActiveUi();

  const item = timelineState.items[index];
  if (!item) {
    updateTimelineCount(0, timelineState.totalUserCount);
    return;
  }
  const currentOrder = Number.isFinite(item.order) ? item.order : index + 1;
  updateTimelineCount(currentOrder, timelineState.totalUserCount);

  let liveNode =
    item.node instanceof HTMLElement && item.node.isConnected
      ? item.node
      : getTimelineSourceNode(item.source);
  if (liveNode instanceof HTMLElement && liveNode.isConnected) {
    item.node = liveNode;
  }

  if (scrollToMessage && liveNode instanceof HTMLElement && liveNode.isConnected) {
    clearTimelineJumpResolveTimer();
    clearTimelineJumpScrollTimer();
    const shouldRestoreStub =
      typeof isToolkitMessageStubNode === "function" &&
      isToolkitMessageStubNode(liveNode) &&
      typeof restoreMessageStubByKey === "function";
    if (shouldRestoreStub) {
      if (typeof scrollElementIntoConversationView === "function") {
        scrollElementIntoConversationView(liveNode, { behavior: "smooth", block: "center" });
      } else {
        liveNode.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      const restoredNode = restoreMessageStubByKey(item.key, { refreshTimeline: false });
      if (restoredNode instanceof HTMLElement && restoredNode.isConnected) {
        liveNode = restoredNode;
        item.node = restoredNode;
        if (!(item.source instanceof HTMLElement)) {
          item.source.node = restoredNode;
        }
        item.isStub = false;
        scheduleTimelineRefresh();
      }
    }
    if (typeof scrollElementIntoConversationView === "function") {
      scrollElementIntoConversationView(liveNode, { behavior: "smooth", block: "center" });
    } else {
      liveNode.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  } else if (scrollToMessage) {
    const jumped = scrollConversationToTimelineOrder(currentOrder, timelineState.totalUserCount, {
      behavior: "smooth",
    });
    if (jumped) {
      queueTimelineNodeResolveAfterJump(index, { highlightMessage });
    } else {
      showTimelineHint(t("timeline.hintMessageNotLoaded"));
    }
  }

  if (highlightMessage && liveNode instanceof HTMLElement && liveNode.isConnected) {
    highlightTimelineMessageNode(liveNode);
  }
};

const buildTimelineItemsFromSourceNodes = (sources) => {
  const withTimestamps = [];
  let previousTimestamp = null;

  sources.forEach((source, index) => {
    const node = getTimelineSourceNode(source, { resolve: false });
    const key = getTimelineSourceKey(source, index);
    const role = getTimelineSourceRole(source);
    const timestamp =
      node instanceof HTMLElement
        ? extractTimelineTimestamp(node, index, previousTimestamp)
        : Number.isFinite(previousTimestamp)
          ? previousTimestamp + 60000
          : getTimelineSourceOrder(source, index) * 60000;
    previousTimestamp = timestamp;
    const previewText = normalizeTimelineText(getTimelineSourceText(source));
    withTimestamps.push({
      key,
      source,
      node,
      timestamp,
      order: getTimelineSourceOrder(source, index),
      tocOrder: index + 1,
      role,
      previewText,
      autoTitle: getTimelineAutoTitle(previewText, index),
      customTitle: getTimelineCustomTitle(key),
      title: getTimelineDisplayTitle(key, previewText, index),
      isStub: isTimelineSourceStub(source, node),
    });
  });

  const sortedItems = withTimestamps
    .slice()
    .sort((left, right) => left.timestamp - right.timestamp)
    .map((item, index) => ({ ...item, tocOrder: index + 1 }));
  return {
    items: assignTimelinePositions(sortedItems),
    totalUserCount: withTimestamps.length,
  };
};

const updateTimelineTocRow = (row, item, index) => {
  if (!(row instanceof HTMLElement) || !item) {
    return;
  }

  row.dataset.timelineIndex = String(index);
  row.dataset.timelineKey = item.key;
  row.className = "chatgpt-toolkit-timeline-node chatgpt-toolkit-toc-item";
  row.classList.toggle("is-stub", Boolean(item.isStub));
  row.classList.toggle("is-assistant", item.role === "assistant");
  row.classList.toggle("is-user", item.role === "user");
  row.classList.toggle("has-custom-title", Boolean(item.customTitle));
  row.setAttribute("aria-label", t("timeline.jumpAria", { index: item.tocOrder || index + 1 }));

  let jumpButton = row.querySelector(".chatgpt-toolkit-toc-jump");
  if (!(jumpButton instanceof HTMLButtonElement)) {
    jumpButton = document.createElement("button");
    jumpButton.type = "button";
    jumpButton.className = "chatgpt-toolkit-toc-jump";
    row.appendChild(jumpButton);
  }
  jumpButton.dataset.timelineIndex = String(index);
  jumpButton.dataset.timelineKey = item.key;
  jumpButton.title = item.previewText || item.title;
  jumpButton.setAttribute("aria-label", t("timeline.jumpAria", { index: item.tocOrder || index + 1 }));

  let number = jumpButton.querySelector(".chatgpt-toolkit-toc-number");
  if (!(number instanceof HTMLElement)) {
    number = document.createElement("span");
    number.className = "chatgpt-toolkit-toc-number";
    jumpButton.appendChild(number);
  }
  number.textContent = String(item.tocOrder || index + 1);

  let textWrap = jumpButton.querySelector(".chatgpt-toolkit-toc-text");
  if (!(textWrap instanceof HTMLElement)) {
    textWrap = document.createElement("span");
    textWrap.className = "chatgpt-toolkit-toc-text";
    jumpButton.appendChild(textWrap);
  }

  let title = textWrap.querySelector(".chatgpt-toolkit-toc-title");
  if (!(title instanceof HTMLElement)) {
    title = document.createElement("span");
    title.className = "chatgpt-toolkit-toc-title";
    textWrap.appendChild(title);
  }
  title.textContent = item.title || getTimelineAutoTitle(item.previewText, index);

  let meta = textWrap.querySelector(".chatgpt-toolkit-toc-meta");
  if (!(meta instanceof HTMLElement)) {
    meta = document.createElement("span");
    meta.className = "chatgpt-toolkit-toc-meta";
    textWrap.appendChild(meta);
  }
  meta.textContent = `${getTimelineRoleLabel(item.role)} · ${
    item.isStub ? t("timeline.stubMeta") : t("timeline.liveMeta")
  }`;

  let toggleButton = row.querySelector(".chatgpt-toolkit-toc-toggle");
  if (!(toggleButton instanceof HTMLButtonElement)) {
    toggleButton = document.createElement("button");
    toggleButton.type = "button";
    toggleButton.className = "chatgpt-toolkit-toc-toggle";
    row.appendChild(toggleButton);
  }
  toggleButton.dataset.timelineIndex = String(index);
  toggleButton.dataset.timelineKey = item.key;
  toggleButton.dataset.timelineAction = item.isStub ? "expand" : "hide";
  toggleButton.textContent = item.isStub ? t("timeline.expandMessage") : t("timeline.hideMessage");
  toggleButton.title = item.isStub ? t("timeline.expandMessageTitle") : t("timeline.hideMessageTitle");
  toggleButton.setAttribute(
    "aria-label",
    item.isStub ? t("timeline.expandMessageTitle") : t("timeline.hideMessageTitle"),
  );

  let editButton = row.querySelector(".chatgpt-toolkit-toc-edit");
  if (!(editButton instanceof HTMLButtonElement)) {
    editButton = document.createElement("button");
    editButton.type = "button";
    editButton.className = "chatgpt-toolkit-toc-edit";
    row.appendChild(editButton);
  }
  editButton.textContent = t("timeline.renameShort");
  editButton.dataset.timelineIndex = String(index);
  editButton.dataset.timelineKey = item.key;
  editButton.title = t("timeline.renameTitle");
  editButton.setAttribute("aria-label", t("timeline.renameTitle"));
};

const enterTimelineTitleEditMode = (row, index) => {
  if (!(row instanceof HTMLElement) || index < 0 || index >= timelineState.items.length) {
    return;
  }
  if (row.querySelector(".chatgpt-toolkit-toc-edit-input")) {
    return;
  }

  const item = timelineState.items[index];
  if (!item?.key) {
    return;
  }

  const jumpButton = row.querySelector(".chatgpt-toolkit-toc-jump");
  const editButton = row.querySelector(".chatgpt-toolkit-toc-edit");
  const input = document.createElement("input");
  input.type = "text";
  input.className = "chatgpt-toolkit-toc-edit-input";
  input.value = item.customTitle || item.title || item.autoTitle || "";
  input.setAttribute("aria-label", t("timeline.renameTitle"));

  row.classList.add("is-editing");
  if (jumpButton instanceof HTMLElement) {
    jumpButton.hidden = true;
  }
  if (editButton instanceof HTMLElement) {
    editButton.hidden = true;
  }
  row.appendChild(input);
  input.focus();
  input.select();

  let isExiting = false;
  const finish = (shouldSave) => {
    if (isExiting) {
      return;
    }
    isExiting = true;

    if (shouldSave) {
      const nextTitle = input.value.replace(/\s+/g, " ").trim();
      if (typeof saveTocTitle === "function") {
        saveTocTitle(state.conversationKey || "", item.key, nextTitle);
      }
      item.customTitle = nextTitle;
      item.title = nextTitle || item.autoTitle || getTimelineAutoTitle(item.previewText, index);
    }

    input.remove();
    row.classList.remove("is-editing");
    if (jumpButton instanceof HTMLElement) {
      jumpButton.hidden = false;
    }
    if (editButton instanceof HTMLElement) {
      editButton.hidden = false;
    }
    updateTimelineTocRow(row, item, index);
    updateTimelineActiveUi();
    timelineState.signature = buildTimelineSignature(timelineState.items);
    if (timelineState.refreshPending) {
      timelineState.refreshPending = false;
      scheduleTimelineRefresh();
    }
  };

  input.addEventListener("click", (event) => event.stopPropagation());
  input.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      finish(true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      finish(false);
    }
  });
  input.addEventListener("blur", () => finish(true));
};

const toggleTimelineMessageVisibility = (index) => {
  if (index < 0 || index >= timelineState.items.length) {
    return;
  }

  const item = timelineState.items[index];
  if (!item?.key) {
    return;
  }

  if (item.isStub) {
    if (typeof restoreMessageStubByKey !== "function") {
      showTimelineHint(t("timeline.hintMessageNotLoaded"));
      return;
    }
    const restoredNode = restoreMessageStubByKey(item.key, { refreshTimeline: false });
    if (restoredNode instanceof HTMLElement && restoredNode.isConnected) {
      item.node = restoredNode;
      item.isStub = false;
      if (!(item.source instanceof HTMLElement)) {
        item.source.node = restoredNode;
      }
      if (typeof scrollElementIntoConversationView === "function") {
        scrollElementIntoConversationView(restoredNode, { behavior: "smooth", block: "center" });
      }
      highlightTimelineMessageNode(restoredNode);
    }
    forceTimelineRefresh();
    return;
  }

  if (typeof collapseMessageByKey !== "function") {
    showTimelineHint(t("timeline.hintMessageNotLoaded"));
    return;
  }
  const collapsedEntry = collapseMessageByKey(item.key, { refreshTimeline: false });
  if (!collapsedEntry) {
    showTimelineHint(t("timeline.hintMessageNotLoaded"));
    return;
  }

  item.node = collapsedEntry.stub;
  item.isStub = true;
  if (!(item.source instanceof HTMLElement)) {
    item.source.node = collapsedEntry.stub;
  }
  forceTimelineRefresh();
};

const syncTimelineNodeButtons = (content, items, contentHeight) => {
  if (!(content instanceof HTMLElement)) {
    return;
  }

  const existingButtons = Array.from(content.querySelectorAll(".chatgpt-toolkit-timeline-node"));
  const existingByKey = new Map();
  existingButtons.forEach((node) => {
    if (node instanceof HTMLElement) {
      const key = node.dataset.timelineKey || "";
      if (key) {
        existingByKey.set(key, node);
      }
    }
  });

  const fragment = document.createDocumentFragment();

  items.forEach((item, index) => {
    let nodeButton = existingByKey.get(item.key);
    if (!(nodeButton instanceof HTMLElement)) {
      nodeButton = document.createElement("div");
    }

    existingByKey.delete(item.key);
    updateTimelineTocRow(nodeButton, item, index);
    fragment.appendChild(nodeButton);
  });

  existingByKey.forEach((button) => button.remove());
  content.replaceChildren(fragment);
};

const getTimelineActiveScrollRoot = () => {
  if (timelineBoundScrollRoot instanceof HTMLElement && timelineBoundScrollRoot.isConnected) {
    return timelineBoundScrollRoot;
  }

  if (timelineWindowScrollBound) {
    return document.scrollingElement instanceof HTMLElement ? document.scrollingElement : null;
  }

  return resolveTimelineScrollRoot();
};

const getTimelineViewportMetrics = (scrollRoot = getTimelineActiveScrollRoot()) => {
  const windowHeight = Math.max(
    0,
    window.innerHeight || document.documentElement?.clientHeight || 0,
  );
  const windowScrollTop = Math.max(
    0,
    window.scrollY || window.pageYOffset || document.documentElement?.scrollTop || 0,
  );
  const fallbackViewport = {
    top: windowScrollTop,
    bottom: windowScrollTop + windowHeight,
    center: windowScrollTop + windowHeight / 2,
    isDocumentLike: true,
    scrollRoot: null,
    rootRect: null,
  };

  if (!(scrollRoot instanceof HTMLElement) || isDocumentLikeScrollRoot(scrollRoot)) {
    return fallbackViewport;
  }

  const rootHeight = Math.max(0, scrollRoot.clientHeight);
  if (!(rootHeight > 32)) {
    return fallbackViewport;
  }

  const top = Math.max(0, scrollRoot.scrollTop);
  return {
    top,
    bottom: top + rootHeight,
    center: top + rootHeight / 2,
    isDocumentLike: false,
    scrollRoot,
    rootRect: scrollRoot.getBoundingClientRect(),
  };
};

const getTimelineItemViewportBounds = (node, viewport) => {
  if (!(node instanceof HTMLElement) || !node.isConnected) {
    return null;
  }

  const rect = node.getBoundingClientRect();
  if (!(rect.height > 0)) {
    return null;
  }

  const rootRect = viewport.rootRect;
  if (
    viewport.isDocumentLike ||
    !rootRect ||
    !Number.isFinite(rootRect.top)
  ) {
    const top = rect.top + viewport.top;
    const bottom = rect.bottom + viewport.top;
    return {
      top,
      bottom,
      center: top + (bottom - top) / 2,
    };
  }

  const top = viewport.top + (rect.top - rootRect.top);
  const bottom = top + rect.height;
  return {
    top,
    bottom,
    center: top + rect.height / 2,
  };
};

const refreshTimelineItemViewportCache = (items, viewport = null) => {
  const safeItems = Array.isArray(items) ? items : [];
  if (safeItems.length === 0) {
    return false;
  }

  const metrics = viewport || getTimelineViewportMetrics();
  let measured = false;

  safeItems.forEach((item) => {
    const liveNode =
      item?.node instanceof HTMLElement && item.node.isConnected
        ? item.node
        : getTimelineSourceNode(item?.source);
    if (liveNode instanceof HTMLElement && liveNode.isConnected) {
      item.node = liveNode;
    }

    const bounds = getTimelineItemViewportBounds(liveNode, metrics);
    if (!bounds) {
      item.viewportTop = Number.NaN;
      item.viewportBottom = Number.NaN;
      item.viewportCenter = Number.NaN;
      return;
    }

    measured = true;
    item.viewportTop = bounds.top;
    item.viewportBottom = bounds.bottom;
    item.viewportCenter = bounds.center;
  });

  return measured;
};

const resolveTimelineNearestIndexFromCache = (viewport) => {
  if (!viewport || timelineState.items.length === 0) {
    return -1;
  }

  let nearestVisibleIndex = -1;
  let nearestVisibleDistance = Number.POSITIVE_INFINITY;
  let nearestFallbackIndex = -1;
  let nearestFallbackDistance = Number.POSITIVE_INFINITY;

  timelineState.items.forEach((item, index) => {
    const top = Number(item?.viewportTop);
    const bottom = Number(item?.viewportBottom);
    const center = Number(item?.viewportCenter);
    if (!Number.isFinite(top) || !Number.isFinite(bottom) || !Number.isFinite(center)) {
      return;
    }

    const distance = Math.abs(center - viewport.center);
    const isVisible = bottom > viewport.top && top < viewport.bottom;

    if (isVisible) {
      if (distance < nearestVisibleDistance) {
        nearestVisibleDistance = distance;
        nearestVisibleIndex = index;
      }
      return;
    }

    if (distance < nearestFallbackDistance) {
      nearestFallbackDistance = distance;
      nearestFallbackIndex = index;
    }
  });

  return nearestVisibleIndex >= 0 ? nearestVisibleIndex : nearestFallbackIndex;
};

const syncTimelineActiveFromViewport = () => {
  if (isTimelineInteractionLocked()) {
    return true;
  }
  if (timelineState.items.length === 0) {
    return false;
  }

  const viewport = getTimelineViewportMetrics();
  let nextIndex = resolveTimelineNearestIndexFromCache(viewport);
  if (nextIndex < 0) {
    const measured = refreshTimelineItemViewportCache(timelineState.items, viewport);
    if (!measured) {
      return false;
    }
    nextIndex = resolveTimelineNearestIndexFromCache(viewport);
  }

  if (nextIndex >= 0 && nextIndex !== timelineState.activeIndex) {
    setTimelineActiveIndex(nextIndex);
  }
  return nextIndex >= 0;
};

const hasTimelineSourceChangedOnScroll = () => {
  const now = Date.now();
  if (now - (timelineState.sourceCheckAt || 0) < TIMELINE_SOURCE_SYNC_INTERVAL_MS) {
    return false;
  }
  timelineState.sourceCheckAt = now;

  const sourceNodes = getTimelineSourceNodes();
  const sourceSignature = buildTimelineSourceSignature(sourceNodes);
  return !isSameTimelineSource(sourceNodes, sourceSignature);
};

const onTimelineWindowScroll = () => {
  if (document.hidden || document.visibilityState === "hidden") {
    return;
  }
  if (!timelineState.visible) {
    return;
  }
  if (isTimelineInteractionLocked()) {
    return;
  }
  if (timelineScrollTicking) {
    return;
  }
  timelineScrollTicking = true;
  requestAnimationFrame(() => {
    timelineScrollTicking = false;
    if (hasTimelineSourceChangedOnScroll()) {
      scheduleTimelineRefresh();
      return;
    }
    if (timelineState.items.length === 0) {
      scheduleTimelineRefresh();
      return;
    }
    const synced = syncTimelineActiveFromViewport();
    if (!synced) {
      scheduleTimelineRefresh();
    }
  });
};

const isDocumentLikeScrollRoot = (root) =>
  root === document.scrollingElement ||
  root === document.documentElement ||
  root === document.body;

const resolveTimelineScrollRoot = () => {
  if (typeof resolveConversationScrollRoot === "function") {
    const conversationRoot = resolveConversationScrollRoot();
    if (conversationRoot instanceof HTMLElement) {
      return conversationRoot;
    }
  }

  const main =
    typeof getConversationMain === "function"
      ? getConversationMain()
      : document.querySelector("main");
  if (main instanceof HTMLElement) {
    const mainRoot = main.closest("[data-scroll-root]");
    if (mainRoot instanceof HTMLElement) {
      return mainRoot;
    }

    const scopedRoots = Array.from(document.querySelectorAll("[data-scroll-root]")).filter(
      (root) =>
        root instanceof HTMLElement &&
        (root.contains(main) || main.contains(root)),
    );
    const scopedScrollableRoot = scopedRoots.find(
      (root) => root.scrollHeight > root.clientHeight + 24,
    );
    if (scopedScrollableRoot instanceof HTMLElement) {
      return scopedScrollableRoot;
    }
    if (scopedRoots[0] instanceof HTMLElement) {
      return scopedRoots[0];
    }

    let current = main.parentElement;
    while (current instanceof HTMLElement && current !== document.body) {
      const style = window.getComputedStyle(current);
      const overflowY = style?.overflowY || "";
      const hasScrollableOverflow =
        overflowY === "auto" ||
        overflowY === "scroll" ||
        overflowY === "overlay";
      if (hasScrollableOverflow && current.scrollHeight > current.clientHeight + 24) {
        return current;
      }
      current = current.parentElement;
    }
  }

  const fallbackRoot = Array.from(document.querySelectorAll("[data-scroll-root]")).find(
    (root) => root instanceof HTMLElement && root.scrollHeight > root.clientHeight + 24,
  );
  if (fallbackRoot instanceof HTMLElement) {
    return fallbackRoot;
  }

  if (document.scrollingElement instanceof HTMLElement) {
    return document.scrollingElement;
  }

  return null;
};

const getSidebarRightEdge = () => {
  const viewportWidth = window.innerWidth;
  const candidates = [];
  const selectors = [
    'aside',
    '[data-testid*="sidebar"]',
    'nav[aria-label]',
    '[class*="sidebar"]',
  ];

  selectors.forEach((selector) => {
    document.querySelectorAll(selector).forEach((element) => {
      if (!(element instanceof HTMLElement)) {
        return;
      }
      const rect = element.getBoundingClientRect();
      if (rect.width < 40 || rect.height < window.innerHeight * 0.35) {
        return;
      }
      if (rect.left > viewportWidth * 0.5 || rect.right <= 0) {
        return;
      }
      candidates.push(rect.right);
    });
  });

  if (candidates.length === 0) {
    return 16;
  }
  return Math.max(...candidates);
};

const updateTimelinePosition = () => {
  const timeline = document.getElementById(TIMELINE_ID);
  if (!(timeline instanceof HTMLElement)) {
    return;
  }
  if (isTimelineInteractionLocked()) {
    return;
  }

  if (
    timelineState.manualPosition &&
    Number.isFinite(timelineState.manualPosition.left) &&
    Number.isFinite(timelineState.manualPosition.top)
  ) {
    const rect = timeline.getBoundingClientRect();
    const width = rect.width || timeline.offsetWidth || 64;
    const height = rect.height || timeline.offsetHeight || Math.round(window.innerHeight * 0.65);
    const maxLeft = Math.max(TIMELINE_DRAG_MARGIN, window.innerWidth - width - TIMELINE_DRAG_MARGIN);
    const maxTop = Math.max(TIMELINE_DRAG_MARGIN, window.innerHeight - height - TIMELINE_DRAG_MARGIN);
    const left = clampTimelineValue(
      Math.round(timelineState.manualPosition.left),
      TIMELINE_DRAG_MARGIN,
      maxLeft
    );
    const top = clampTimelineValue(
      Math.round(timelineState.manualPosition.top),
      TIMELINE_DRAG_MARGIN,
      maxTop
    );
    timeline.style.left = `${left}px`;
    timeline.style.top = `${top}px`;
    timeline.style.transform = "none";
    timelineState.manualPosition = { left, top };
    updateTimelineBubblePlacement();
    return;
  }

  const rightEdge = getSidebarRightEdge();
  const rect = timeline.getBoundingClientRect();
  const width = rect.width || timeline.offsetWidth || 64;
  const height = rect.height || timeline.offsetHeight || Math.round(window.innerHeight * 0.65);
  const maxLeft = Math.max(8, window.innerWidth - width - TIMELINE_DRAG_MARGIN);
  const left = Math.min(maxLeft, Math.max(8, Math.round(rightEdge + 10)));
  const maxTop = Math.max(TIMELINE_DRAG_MARGIN, window.innerHeight - height - TIMELINE_DRAG_MARGIN);
  const top = clampTimelineValue(
    Math.round((window.innerHeight - height) / 2),
    TIMELINE_DRAG_MARGIN,
    maxTop
  );
  timeline.style.left = `${left}px`;
  timeline.style.top = `${top}px`;
  timeline.style.transform = "none";
  updateTimelineBubblePlacement();
};

const setTimelineManualPosition = (timeline, left, top, options = {}) => {
  if (!(timeline instanceof HTMLElement)) {
    return;
  }

  const { persist = true, updateBubble = true, bounds = null } = options;
  const rect = bounds ? null : timeline.getBoundingClientRect();
  const width = bounds?.width || rect?.width || timeline.offsetWidth || 64;
  const height = bounds?.height || rect?.height || timeline.offsetHeight || Math.round(window.innerHeight * 0.65);
  const maxLeft =
    bounds?.maxLeft || Math.max(TIMELINE_DRAG_MARGIN, window.innerWidth - width - TIMELINE_DRAG_MARGIN);
  const maxTop =
    bounds?.maxTop || Math.max(TIMELINE_DRAG_MARGIN, window.innerHeight - height - TIMELINE_DRAG_MARGIN);
  const nextLeft = clampTimelineValue(Math.round(left), TIMELINE_DRAG_MARGIN, maxLeft);
  const nextTop = clampTimelineValue(Math.round(top), TIMELINE_DRAG_MARGIN, maxTop);

  timeline.style.left = `${nextLeft}px`;
  timeline.style.top = `${nextTop}px`;
  timeline.style.transform = "none";

  timelineState.manualPosition = {
    left: nextLeft,
    top: nextTop,
  };

  if (persist) {
    saveTimelinePosition(timelineState.manualPosition);
  }
  if (updateBubble) {
    updateTimelineBubblePlacement();
  }
};

const enableTimelineDrag = (timeline) => {
  if (!(timeline instanceof HTMLElement) || timeline.dataset.dragEnabled === "1") {
    return;
  }

  const header = timeline.querySelector(".chatgpt-toolkit-timeline-header");
  if (!(header instanceof HTMLElement)) {
    return;
  }

  timeline.dataset.dragEnabled = "1";
  let isDragging = false;
  let moved = false;
  let startX = 0;
  let startY = 0;
  let startLeft = 0;
  let startTop = 0;
  let pendingLeft = 0;
  let pendingTop = 0;
  let dragBounds = null;
  let baseTransform = "";

  const dragController = createRafDragController(({ translateX, translateY, transform }) => {
    applyDragTransform(timeline, translateX, translateY, transform);
  });

  const onPointerMove = (event) => {
    if (!isDragging) {
      return;
    }

    const deltaX = event.clientX - startX;
    const deltaY = event.clientY - startY;

    if (!moved) {
      const distanceSquared = deltaX * deltaX + deltaY * deltaY;
      if (distanceSquared < TIMELINE_DRAG_THRESHOLD * TIMELINE_DRAG_THRESHOLD) {
        return;
      }
      moved = true;
      timelineState.dragging = true;
      timeline.classList.add("is-dragging");
      timeline.style.willChange = "transform";
      timeline.style.pointerEvents = "none";
      hideTimelinePreview();
      hideTimelineHint();
      document.documentElement.style.userSelect = "none";
    }

    if (!dragBounds) {
      return;
    }

    const nextLeft = clampTimelineValue(
      startLeft + deltaX,
      TIMELINE_DRAG_MARGIN,
      dragBounds.maxLeft
    );
    const nextTop = clampTimelineValue(
      startTop + deltaY,
      TIMELINE_DRAG_MARGIN,
      dragBounds.maxTop
    );
    pendingLeft = nextLeft;
    pendingTop = nextTop;
    dragController.schedule({
      translateX: nextLeft - startLeft,
      translateY: nextTop - startTop,
      transform: baseTransform,
    });
  };

  const stopDragging = (event) => {
    if (!isDragging) {
      return;
    }
    isDragging = false;
    timelineState.pointerDown = false;
    document.removeEventListener("pointermove", onPointerMove);
    document.removeEventListener("pointerup", stopDragging);
    document.removeEventListener("pointercancel", stopDragging);
    if (moved) {
      dragController.cancel();
      setTimelineManualPosition(timeline, pendingLeft, pendingTop, {
        persist: true,
        updateBubble: true,
        bounds: dragBounds,
      });
    } else {
      dragController.cancel();
      resetDragTransform(timeline, baseTransform);
    }

    timelineState.dragging = false;
    timeline.classList.remove("is-dragging");
    timeline.style.willChange = "";
    timeline.style.pointerEvents = "";
    document.documentElement.style.userSelect = "";
    dragBounds = null;
    baseTransform = "";
    moved = false;
    if (timelineState.refreshPending) {
      timelineState.refreshPending = false;
      scheduleTimelineRefresh();
    }
  };

  header.style.touchAction = "none";
  header.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    const rect = timeline.getBoundingClientRect();
    const width = rect.width || timeline.offsetWidth || 64;
    const height = rect.height || timeline.offsetHeight || Math.round(window.innerHeight * 0.65);
    dragBounds = {
      width,
      height,
      maxLeft: Math.max(TIMELINE_DRAG_MARGIN, window.innerWidth - width - TIMELINE_DRAG_MARGIN),
      maxTop: Math.max(TIMELINE_DRAG_MARGIN, window.innerHeight - height - TIMELINE_DRAG_MARGIN),
    };
    isDragging = true;
    timelineState.pointerDown = true;
    moved = false;
    startX = event.clientX;
    startY = event.clientY;
    startLeft = rect.left;
    startTop = rect.top;
    pendingLeft = rect.left;
    pendingTop = rect.top;
    hideTimelinePreview();
    hideTimelineHint();
    baseTransform = timeline.style.transform && timeline.style.transform !== "none"
      ? timeline.style.transform
      : "";
    resetDragTransform(timeline, baseTransform);
    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", stopDragging);
    document.addEventListener("pointercancel", stopDragging);
  });
};

const handleTimelineWheel = (event) => {
  const elements = getTimelineElements();
  const track = elements?.track;
  if (!(track instanceof HTMLElement)) {
    return;
  }
  const maxScrollTop = getTimelineTrackMaxScrollTop(track);
  // 仅在时间线有可滚动内容时阻止默认滚动
  if (maxScrollTop > 1) {
    event.preventDefault();
    event.stopPropagation();
  } else {
    return;
  }

  if (timelineState.items.length === 0) {
    showTimelineHint(state.isCollapsed ? t("timeline.hintRestore") : t("timeline.hintNoMore"));
    return;
  }

  const rawDelta = normalizeTimelineWheelDelta(event);
  if (rawDelta === 0) {
    return;
  }

  const delta = compressTimelineWheelDelta(rawDelta);
  if (delta === 0) {
    return;
  }

  const previousScrollTop = track.scrollTop;
  const nextScrollTop = clampTimelineValue(previousScrollTop + delta, 0, maxScrollTop);
  track.scrollTop = nextScrollTop;

  if (delta < 0 && previousScrollTop <= 0 && nextScrollTop <= 0) {
    showTimelineHint(state.isCollapsed ? t("timeline.hintRestore") : t("timeline.hintNoMore"));
  }
};

const handleTimelineClick = (event) => {
  const target = event.target;
  const toggleButton =
    target instanceof Element
      ? target.closest(".chatgpt-toolkit-toc-toggle")
      : target instanceof Node && target.parentElement
        ? target.parentElement.closest(".chatgpt-toolkit-toc-toggle")
        : null;
  if (toggleButton instanceof HTMLElement) {
    event.preventDefault();
    event.stopPropagation();
    const index = Number(toggleButton.dataset.timelineIndex);
    if (!Number.isNaN(index)) {
      toggleTimelineMessageVisibility(index);
    }
    return;
  }

  const editButton =
    target instanceof Element
      ? target.closest(".chatgpt-toolkit-toc-edit")
      : target instanceof Node && target.parentElement
        ? target.parentElement.closest(".chatgpt-toolkit-toc-edit")
        : null;
  if (editButton instanceof HTMLElement) {
    event.preventDefault();
    event.stopPropagation();
    const index = Number(editButton.dataset.timelineIndex);
    if (!Number.isNaN(index)) {
      const row = editButton.closest(".chatgpt-toolkit-timeline-node");
      enterTimelineTitleEditMode(row, index);
    }
    return;
  }

  const nodeButton =
    target instanceof Element
      ? target.closest("[data-timeline-index]")
      : target instanceof Node && target.parentElement
        ? target.parentElement.closest("[data-timeline-index]")
        : null;

  if (!(nodeButton instanceof HTMLElement)) {
    return;
  }

  const index = Number(nodeButton.dataset.timelineIndex);
  if (Number.isNaN(index)) {
    return;
  }

  setTimelineActiveIndex(index, {
    scrollToMessage: true,
    highlightMessage: true,
  });
};

const resolveTimelineNodeIndex = (target) => {
  const nodeButton =
    target instanceof Element
      ? target.closest("[data-timeline-index]")
      : target instanceof Node && target.parentElement
        ? target.parentElement.closest("[data-timeline-index]")
        : null;

  if (!(nodeButton instanceof HTMLElement)) {
    return -1;
  }

  const index = Number(nodeButton.dataset.timelineIndex);
  return Number.isNaN(index) ? -1 : index;
};

const handleTimelineMouseMove = (event) => {
  const timeline = document.getElementById(TIMELINE_ID);
  if (timeline instanceof HTMLElement && timeline.classList.contains("is-dragging")) {
    return;
  }

  const index = resolveTimelineNodeIndex(event.target);
  if (index < 0) {
    hideTimelinePreview();
    return;
  }
  if (index === timelineState.hoverIndex) {
    return;
  }
  showTimelinePreview(index);
};

const handleTimelineMouseLeave = () => {
  hideTimelinePreview();
};

const clearTimelineRefreshTimer = () => {
  if (timelineRefreshTimer) {
    clearTimeout(timelineRefreshTimer);
    timelineRefreshTimer = null;
  }
};

const forceTimelineRefresh = () => {
  clearTimelineJumpResolveTimer();
  clearTimelineJumpScrollTimer();
  timelineState.rendered = false;
  timelineState.sourceSignature = "";
  timelineState.signature = "";
  timelineState.contentHeight = 0;
  timelineState.sourceCheckAt = 0;

  if (!timelineState.visible) {
    return;
  }

  clearTimelineRefreshTimer();
  renderTimeline();
};

const setTimelineScrollListenerEnabled = (enabled) => {
  if (enabled && (document.hidden || document.visibilityState === "hidden")) {
    enabled = false;
  }

  if (enabled) {
    const nextRoot = resolveTimelineScrollRoot();
    if (timelineBoundScrollRoot && timelineBoundScrollRoot !== nextRoot) {
      timelineBoundScrollRoot.removeEventListener("scroll", onTimelineWindowScroll);
      timelineBoundScrollRoot = null;
    }

    const bindWindowFallback =
      !(nextRoot instanceof HTMLElement) || isDocumentLikeScrollRoot(nextRoot);

    if (!bindWindowFallback && nextRoot instanceof HTMLElement && timelineBoundScrollRoot !== nextRoot) {
      nextRoot.addEventListener("scroll", onTimelineWindowScroll, { passive: true });
      timelineBoundScrollRoot = nextRoot;
    } else if (bindWindowFallback && timelineBoundScrollRoot) {
      timelineBoundScrollRoot.removeEventListener("scroll", onTimelineWindowScroll);
      timelineBoundScrollRoot = null;
    }

    if (bindWindowFallback && !timelineWindowScrollBound) {
      window.addEventListener("scroll", onTimelineWindowScroll, { passive: true });
      timelineWindowScrollBound = true;
    } else if (!bindWindowFallback && timelineWindowScrollBound) {
      window.removeEventListener("scroll", onTimelineWindowScroll);
      timelineWindowScrollBound = false;
    }

    timelineScrollListenerAdded = timelineWindowScrollBound || timelineBoundScrollRoot instanceof HTMLElement;
    return;
  }

  if (!timelineScrollListenerAdded) {
    if (timelineBoundScrollRoot) {
      timelineBoundScrollRoot.removeEventListener("scroll", onTimelineWindowScroll);
      timelineBoundScrollRoot = null;
    }
    if (timelineWindowScrollBound) {
      window.removeEventListener("scroll", onTimelineWindowScroll);
      timelineWindowScrollBound = false;
    }
    timelineScrollListenerAdded = false;
    return;
  }

  if (timelineWindowScrollBound) {
    window.removeEventListener("scroll", onTimelineWindowScroll);
    timelineWindowScrollBound = false;
  }
  if (timelineBoundScrollRoot) {
    timelineBoundScrollRoot.removeEventListener("scroll", onTimelineWindowScroll);
    timelineBoundScrollRoot = null;
  }
  timelineScrollListenerAdded = false;
  timelineScrollTicking = false;
};

const destroyTimeline = () => {
  clearTimelineJumpResolveTimer();
  clearTimelineJumpScrollTimer();
  clearTimelineRefreshTimer();
  if (timelineHintTimer) {
    clearTimeout(timelineHintTimer);
    timelineHintTimer = null;
  }
  if (timelineHighlightTimer) {
    clearTimeout(timelineHighlightTimer);
    timelineHighlightTimer = null;
  }

  document
    .querySelectorAll(".chatgpt-toolkit-timeline-target")
    .forEach((node) => node.classList.remove("chatgpt-toolkit-timeline-target"));

  const timeline = document.getElementById(TIMELINE_ID);
  if (timeline instanceof HTMLElement) {
    timeline.remove();
  }

  setTimelineScrollListenerEnabled(false);
  timelineState.items = [];
  timelineState.sourceNodes = [];
  timelineState.sourceSignature = "";
  timelineState.totalUserCount = 0;
  timelineState.activeIndex = -1;
  timelineState.hoverIndex = -1;
  timelineState.signature = "";
  timelineState.contentHeight = 0;
  timelineState.rendered = false;
  timelineState.refreshPending = false;
  timelineState.sourceCheckAt = 0;
};

const updateTimelineCount = (currentNodeOrder, totalCount) => {
  const elements = getTimelineElements();
  const count = elements?.count;
  if (!(count instanceof HTMLElement)) {
    return;
  }
  const current = Number.isFinite(currentNodeOrder) ? Math.max(0, Math.trunc(currentNodeOrder)) : 0;
  const total = Number.isFinite(totalCount) ? Math.max(0, Math.trunc(totalCount)) : 0;
  count.textContent = `${current}/${total}`;
  count.setAttribute("aria-label", t("timeline.countAria", { current, total }));
};

const updateTimelineToggleButton = () => {
  const button = document.querySelector(`#${TOOLKIT_ID} [data-action="timeline-toggle"]`);
  if (!(button instanceof HTMLButtonElement)) {
    return;
  }
  if (timelineState.visible) {
    button.textContent = t("toolbar.timelineHide");
    button.setAttribute("aria-label", t("toolbar.timelineHide"));
  } else {
    button.textContent = t("toolbar.timelineShow");
    button.setAttribute("aria-label", t("toolbar.timelineShow"));
  }
};

const refreshTimelineLocalization = () => {
  const timeline = document.getElementById(TIMELINE_ID);
  if (!(timeline instanceof HTMLElement)) {
    updateTimelineToggleButton();
    return;
  }

  timeline.setAttribute("aria-label", t("timeline.ariaLabel"));

  const title = timeline.querySelector(".chatgpt-toolkit-timeline-title");
  if (title instanceof HTMLElement) {
    title.textContent = t("timeline.title");
  }

  updateTimelineToggleButton();

  const currentItem = timelineState.items[timelineState.activeIndex];
  updateTimelineCount(currentItem?.order || 0, timelineState.totalUserCount);

  const nodes = timeline.querySelectorAll(".chatgpt-toolkit-timeline-node");
  nodes.forEach((node) => {
    if (!(node instanceof HTMLElement)) {
      return;
    }
    const index = Number(node.dataset.timelineIndex);
    if (Number.isNaN(index)) {
      return;
    }
    const item = timelineState.items[index];
    if (item) {
      item.autoTitle = getTimelineAutoTitle(item.previewText, index);
      item.customTitle = getTimelineCustomTitle(item.key);
      item.title = item.customTitle || item.autoTitle;
      updateTimelineTocRow(node, item, index);
    } else {
      node.setAttribute("aria-label", t("timeline.jumpAria", { index: index + 1 }));
    }
  });

  hideTimelinePreview();
  hideTimelineHint();
};

const setTimelineVisibility = (visible, options = {}) => {
  const { persist = true } = options;
  timelineState.visible = !!visible;
  if (persist) {
    saveTimelineVisibility(timelineState.visible);
  }
  updateTimelineToggleButton();

  const timeline = document.getElementById(TIMELINE_ID);
  if (timeline instanceof HTMLElement) {
    timeline.classList.toggle("is-hidden", !timelineState.visible);
  }

  if (!timelineState.visible) {
    destroyTimeline();
    return;
  }

  renderTimeline();
};

const toggleTimelineVisibility = () => {
  setTimelineVisibility(!timelineState.visible, { persist: true });
};

const ensureTimeline = () => {
  if (!timelineState.visible) {
    return null;
  }

  const existingTimeline = document.getElementById(TIMELINE_ID);
  if (existingTimeline) {
    const existingTrack = existingTimeline.querySelector(`#${TIMELINE_TRACK_ID}`);
    ensureTimelineTrackContent(existingTrack);
    const existingCount = existingTimeline.querySelector(`#${TIMELINE_COUNT_ID}`);
    if (!(existingCount instanceof HTMLElement)) {
      const panel = existingTimeline.querySelector(".chatgpt-toolkit-timeline-panel");
      if (panel instanceof HTMLElement) {
        let header = panel.querySelector(".chatgpt-toolkit-timeline-header");
        if (!(header instanceof HTMLElement)) {
          header = document.createElement("div");
          header.className = "chatgpt-toolkit-timeline-header";
          const existingTitle = panel.querySelector(".chatgpt-toolkit-timeline-title");
          if (existingTitle instanceof HTMLElement) {
            header.appendChild(existingTitle);
          } else {
            const title = document.createElement("span");
            title.className = "chatgpt-toolkit-timeline-title";
            title.textContent = t("timeline.title");
            header.appendChild(title);
          }
          panel.prepend(header);
        }
        const count = document.createElement("span");
        count.id = TIMELINE_COUNT_ID;
        count.className = "chatgpt-toolkit-timeline-count";
        count.textContent = "0/0";
        header.appendChild(count);
      }
    }
    existingTimeline.setAttribute("aria-label", t("timeline.ariaLabel"));
    existingTimeline.classList.toggle("is-hidden", !timelineState.visible);
    enableTimelineDrag(existingTimeline);
    updateTimelinePosition();
    setTimelineScrollListenerEnabled(true);
    return existingTimeline;
  }

  if (!document.body) {
    return null;
  }

  const timeline = document.createElement("section");
  timeline.id = TIMELINE_ID;
  timeline.className = "chatgpt-toolkit-timeline";
  if (!timelineState.visible) {
    timeline.classList.add("is-hidden");
  }
  timeline.setAttribute("aria-label", t("timeline.ariaLabel"));
  timeline.innerHTML = `
    <div class="chatgpt-toolkit-timeline-panel">
      <div class="chatgpt-toolkit-timeline-header">
        <span class="chatgpt-toolkit-timeline-title">${t("timeline.title")}</span>
        <span id="${TIMELINE_COUNT_ID}" class="chatgpt-toolkit-timeline-count">0/0</span>
      </div>
      <div id="${TIMELINE_TRACK_ID}" class="chatgpt-toolkit-timeline-track">
        <div class="${TIMELINE_CONTENT_CLASS}"></div>
      </div>
    </div>
    <div id="${TIMELINE_PREVIEW_ID}" class="chatgpt-toolkit-timeline-preview"></div>
    <div id="${TIMELINE_HINT_ID}" class="chatgpt-toolkit-timeline-hint"></div>
  `;

  timeline.addEventListener("wheel", handleTimelineWheel, { passive: false });
  timeline.addEventListener("click", handleTimelineClick);
  timeline.addEventListener("mousemove", handleTimelineMouseMove);
  timeline.addEventListener("mouseleave", handleTimelineMouseLeave);

  setTimelineScrollListenerEnabled(true);
  document.body.appendChild(timeline);
  enableTimelineDrag(timeline);
  updateTimelinePosition();
  syncToolkitTheme();
  return timeline;
};

const renderTimeline = () => {
  updateTimelineToggleButton();
  if (document.hidden || document.visibilityState === "hidden") {
    markTimelineRefreshPending();
    setTimelineScrollListenerEnabled(false);
    return;
  }
  if (!timelineState.visible) {
    destroyTimeline();
    return;
  }

  const conversationChanged = ensureConversationState();
  if (conversationChanged) {
    clearTimelineJumpResolveTimer();
    clearTimelineJumpScrollTimer();
    timelineState.activeIndex = -1;
    timelineState.sourceCheckAt = 0;
    updateTimelineCount(0, 0);
    hideTimelinePreview();
    hideTimelineHint();
    scheduleTimelineRefresh();
    return;
  }
  if (isTimelineInteractionLocked()) {
    markTimelineRefreshPending();
    return;
  }
  if (isTimelineTitleEditing()) {
    markTimelineRefreshPending();
    return;
  }
  timelineState.refreshPending = false;
  // 标记正在渲染，防止 MutationObserver 循环触发
  window.__toolkitIsRendering = true;
  try {
  const timeline = ensureTimeline();
  if (!timeline) {
    return;
  }
  timeline.classList.toggle("is-hidden", !timelineState.visible);
  if (!timelineState.visible) {
    destroyTimeline();
    return;
  }

  const elements = getTimelineElements();
  const track = elements?.track;
  const content = elements?.content || ensureTimelineTrackContent(track);
  if (!(track instanceof HTMLElement) || !(content instanceof HTMLElement)) {
    return;
  }
  if (track.clientHeight <= 0) {
    scheduleTimelineRefresh();
    return;
  }

  const previousScrollTop = track.scrollTop;
  const previousMaxScroll = Math.max(0, track.scrollHeight - track.clientHeight);
  const previousItems = timelineState.items;
  const previousActiveKey = previousItems[timelineState.activeIndex]?.key || null;
  const previousHoverKey = previousItems[timelineState.hoverIndex]?.key || null;
  const sourceNodes = getTimelineSourceNodes();
  const sourceSignature = buildTimelineSourceSignature(sourceNodes);
  const sourceStable = timelineState.rendered && isSameTimelineSource(sourceNodes, sourceSignature);

  const timelineData = sourceStable
    ? null
    : buildTimelineItemsFromSourceNodes(sourceNodes);
  const nextItems = sourceStable ? timelineState.items : timelineData.items;
  const totalUserCount = sourceStable ? sourceNodes.length : timelineData.totalUserCount;
  const nextSignature = sourceStable ? timelineState.signature : buildTimelineSignature(nextItems);
  const contentHeight = nextItems.length;
  content.style.height = "auto";
  content.style.minHeight = `${Math.max(track.clientHeight, 1)}px`;
  const shouldRebuild =
    !timelineState.rendered ||
    !sourceStable ||
    timelineState.signature !== nextSignature ||
    timelineState.contentHeight !== contentHeight;

  if (shouldRebuild) {
    syncTimelineNodeButtons(content, nextItems, contentHeight);

    const nextMaxScroll = Math.max(0, track.scrollHeight - track.clientHeight);
    if (nextMaxScroll > 0) {
      if (previousMaxScroll > 0) {
        const scrollRatio = previousScrollTop / previousMaxScroll;
        track.scrollTop = clampTimelineValue(scrollRatio * nextMaxScroll, 0, nextMaxScroll);
      } else {
        track.scrollTop = nextMaxScroll;
      }
    } else {
      track.scrollTop = 0;
    }
  }

  timelineState.items = nextItems;
  timelineState.sourceNodes = sourceNodes;
  timelineState.sourceSignature = sourceSignature;
  timelineState.totalUserCount = totalUserCount;
  timelineState.signature = nextSignature;
  timelineState.contentHeight = contentHeight;
  timelineState.rendered = true;
  refreshTimelineItemViewportCache(timelineState.items);

  if (timelineState.items.length === 0) {
    timelineState.activeIndex = -1;
    track.scrollTop = 0;
    updateTimelineCount(0, timelineState.totalUserCount);
    hideTimelinePreview();
    return;
  }

  let nextActiveIndex = previousActiveKey
    ? timelineState.items.findIndex((item) => item.key === previousActiveKey)
    : -1;
  if (nextActiveIndex < 0) {
    nextActiveIndex = timelineState.items.length - 1;
  }
  setTimelineActiveIndex(nextActiveIndex);
  syncTimelineActiveFromViewport();

  if (previousHoverKey) {
    const nextHoverIndex = timelineState.items.findIndex((item) => item.key === previousHoverKey);
    if (nextHoverIndex >= 0) {
      showTimelinePreview(nextHoverIndex);
    } else {
      hideTimelinePreview();
    }
  }
  } finally {
    window.__toolkitIsRendering = false;
  }
};

const scheduleTimelineRefresh = () => {
  if (document.hidden || document.visibilityState === "hidden") {
    clearTimelineRefreshTimer();
    markTimelineRefreshPending();
    return;
  }
  if (!timelineState.visible) {
    clearTimelineRefreshTimer();
    return;
  }
  if (isTimelineInteractionLocked()) {
    markTimelineRefreshPending();
    return;
  }
  if (timelineRefreshTimer) {
    return;
  }
  timelineRefreshTimer = setTimeout(() => {
    timelineRefreshTimer = null;
    if (isTimelineInteractionLocked()) {
      markTimelineRefreshPending();
      return;
    }
    renderTimeline();
  }, 120);
};
