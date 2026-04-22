/*
 * ChatGPT Conversation Toolkit - Conversation export
 */
const exportMessages = () => {
  ensureConversationState();
  const entries = getConversationMessageEntries({
    mode:
      TOOLKIT_MESSAGE_MODE === TOOLKIT_MESSAGE_MODE_EXTENDED
        ? TOOLKIT_MESSAGE_MODE_EXTENDED
        : TOOLKIT_MESSAGE_MODE_LOADED,
    refreshDom: true,
    forceRefresh: true,
  });
  const mergedEntries = [...entries];
  const seenKeys = new Set(entries.map((entry) => entry.key));

  if (state.isCollapsed) {
    state.collapsedNodes.forEach((entry, index) => {
      const node = entry?.node;
      if (!(node instanceof HTMLElement)) {
        return;
      }
      const key = getMessageNodeKey(node, index);
      if (!key || seenKeys.has(key)) {
        return;
      }
      const text = extractMessageText(node);
      if (!text) {
        return;
      }
      seenKeys.add(key);
      mergedEntries.push({
        key,
        role: detectRole(node),
        text,
        order: getMessageNodeOrder(node, index),
        node: node.isConnected ? node : null,
        lastSeenAt: Date.now(),
      });
    });
  }

  const messages = buildMessagePayloadFromEntries(mergedEntries);

  const payload = {
    exportedAt: new Date().toISOString(),
    url: window.location.href,
    messageCount: messages.length,
    messages,
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });

  const dateTag = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `chatgpt-session-${dateTag}.json`;

  const link = document.createElement("a");
  const objectUrl = URL.createObjectURL(blob);
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);

  updateStatusByKey("status.exportStarted", "success");
};
