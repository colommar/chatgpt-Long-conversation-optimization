/*
 * ChatGPT Conversation Toolkit - Global state and configuration
 */
const TOOLKIT_ID = "chatgpt-conversation-toolkit";
const STATUS_ID = "chatgpt-conversation-toolkit-status";
const MINIMIZED_ID = "chatgpt-conversation-toolkit-minimized";
const POSITION_KEY = "chatgpt-toolkit-position";
const TOOLBAR_MINIMIZED_KEY = "chatgpt-toolkit-toolbar-minimized";
const LANGUAGE_PREFERENCE_KEY = "chatgpt-toolkit-language";
const TIMELINE_POSITION_KEY = "chatgpt-toolkit-timeline-position";
const TIMELINE_VISIBLE_KEY = "chatgpt-toolkit-timeline-visible";
const COLLAPSE_MEMORY_STORAGE_KEY = "chatgpt-toolkit-collapse-memory-v1";
const COLLAPSE_MEMORY_LOCAL_FALLBACK_KEY = "chatgpt-toolkit-collapse-memory-fallback";
let COLLAPSE_MEMORY_RETENTION_MS = 10 * 24 * 60 * 60 * 1000;
let COLLAPSE_AUTO_REOPTIMIZE_BUFFER = 10;
const COLLAPSE_AUTO_REOPTIMIZE_DELAY_MS = 180;
const THEME_ATTR = "data-toolkit-theme";
const TIMELINE_ID = "chatgpt-conversation-toolkit-timeline";
const TIMELINE_TRACK_ID = "chatgpt-conversation-toolkit-timeline-track";
const TIMELINE_COUNT_ID = "chatgpt-conversation-toolkit-timeline-count";
const TIMELINE_PREVIEW_ID = "chatgpt-conversation-toolkit-timeline-preview";
const TIMELINE_HINT_ID = "chatgpt-conversation-toolkit-timeline-hint";
const LATEX_COPY_ID = "chatgpt-toolkit-latex-copy";
let TIMELINE_VISIBLE_NODE_CAPACITY = 10;
let TIMELINE_MAX_NODES = 20;
const TIMELINE_CONTENT_CLASS = "chatgpt-toolkit-timeline-content";
const TIMELINE_WHEEL_DISTANCE_SCALE = 0.24;
const TIMELINE_WHEEL_MIN_STEP = 4;
const TIMELINE_WHEEL_MAX_STEP = 72;
const TIMELINE_DRAG_MARGIN = 8;
const TIMELINE_DRAG_THRESHOLD = 4;
const PROMPT_MODAL_ID = "chatgpt-toolkit-prompt-modal";
const PROMPT_FILE_INPUT_ID = "chatgpt-toolkit-prompt-file";
const PROMPT_TOAST_ID = "chatgpt-toolkit-prompt-toast";
const PROMPT_STORAGE_KEY = "chatgpt-toolkit-prompts-v1";
const PROMPT_LOCAL_FALLBACK_KEY = "chatgpt-toolkit-prompts-fallback";
const FOLDER_MANAGER_ID = "chatgpt-toolkit-folder-manager";
const FOLDER_MENU_ID = "chatgpt-toolkit-folder-menu";
const FOLDER_STORAGE_KEY = "chatgpt-toolkit-folders-v1";
const FOLDER_LOCAL_FALLBACK_KEY = "chatgpt-toolkit-folders-fallback";
const FOLDER_ROOT_ATTR = "data-toolkit-folder-root";

const state = {
  isCollapsed: false,
  isMinimized: false,
  keepLatest: 20,
  collapsedNodes: [],
  conversationKey: null,
  anchorNode: null,
  anchorParent: null,
  // 搜索相关状态
  searchQuery: '',
  searchMatches: [],
  currentMatchIndex: -1,
};

const minimizedButtonState = {
  pointerDown: false,
  dragging: false,
};

const promptState = {
  loaded: false,
  isOpen: false,
  items: [],
  filteredItems: [],
  selectedId: null,
  searchText: "",
  category: "all",
  sortBy: "updated-desc",
};
const timelineState = {
  items: [],
  sourceNodes: [],
  sourceSignature: "",
  totalUserCount: 0,
  activeIndex: -1,
  hoverIndex: -1,
  signature: "",
  contentHeight: 0,
  rendered: false,
  visible: false,
  manualPosition: null,
  pointerDown: false,
  dragging: false,
  refreshPending: false,
};
const folderState = {
  initialized: false,
  loaded: false,
  folders: [],
  assignments: {},
  itemOrders: {},
  section: null,
  headerButton: null,
  history: null,
  nativeList: null,
  previousNativeList: null,
  conversationRenderCache: new Map(),
  folderRenderCache: new Map(),
  otherNativeOrderCache: new Map(),
  menuFolderId: null,
  draggingConversationId: null,
  draggingFolderId: null,
  currentDropZoneKey: "",
  currentSortZoneKey: "",
  dragLayout: null,
  refreshQueued: false,
  refreshPending: false,
  missingHistoryRetryCount: 0,
};
const collapseMemoryState = {
  initialized: false,
  loaded: false,
  entries: {},
  currentConversationKey: "",
  pendingAutoConversationKey: "",
  recentOptionsConversationKey: "",
  recentOptionsAt: 0,
};
let promptToastTimer = null;
let timelineHintTimer = null;
let timelineHighlightTimer = null;
let timelineRefreshTimer = null;
let folderHighlightTimer = null;
let folderSettledRefreshTimer = null;
let folderMissingSectionRetryTimer = null;
let collapseMemoryAutoApplyTimer = null;
let collapseMemoryReoptimizeTimer = null;
let collapseMemoryArchiveCheckTimer = null;
let timelineScrollTicking = false;
let timelineScrollListenerAdded = false;
let themeObserver = null;
let themeMediaQuery = null;
let bodyThemeObserved = false;

const themeAttributeFilter = ["class", "data-theme", "style"];

const TOOLKIT_BOOTSTRAP_FLAG = "__chatgptConversationToolkitBootstrapped";

const TOOLKIT_CONFIG_KEY = "chatgpt-toolkit-config-v2";

const loadToolkitConfig = () => {
  try {
    const stored = localStorage.getItem(TOOLKIT_CONFIG_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed.keepLatest !== undefined) state.keepLatest = parsed.keepLatest;
      if (parsed.autoReoptimizeBuffer !== undefined) COLLAPSE_AUTO_REOPTIMIZE_BUFFER = parsed.autoReoptimizeBuffer;
      if (parsed.timelineVisibleNodeCapacity !== undefined) TIMELINE_VISIBLE_NODE_CAPACITY = parsed.timelineVisibleNodeCapacity;
      if (parsed.timelineMaxNodes !== undefined) TIMELINE_MAX_NODES = parsed.timelineMaxNodes;
      if (parsed.collapseMemoryRetentionDays !== undefined) COLLAPSE_MEMORY_RETENTION_MS = parsed.collapseMemoryRetentionDays * 24 * 60 * 60 * 1000;
    }
  } catch (e) {}
};

const saveToolkitConfig = (configObj) => {
  try {
    const current = {};
    try {
      const stored = localStorage.getItem(TOOLKIT_CONFIG_KEY);
      if (stored) Object.assign(current, JSON.parse(stored));
    } catch (e) {}
    
    Object.assign(current, configObj);
    localStorage.setItem(TOOLKIT_CONFIG_KEY, JSON.stringify(current));
    
    if (current.keepLatest !== undefined) state.keepLatest = current.keepLatest;
    if (current.autoReoptimizeBuffer !== undefined) COLLAPSE_AUTO_REOPTIMIZE_BUFFER = current.autoReoptimizeBuffer;
    if (current.timelineVisibleNodeCapacity !== undefined) TIMELINE_VISIBLE_NODE_CAPACITY = current.timelineVisibleNodeCapacity;
    if (current.timelineMaxNodes !== undefined) TIMELINE_MAX_NODES = current.timelineMaxNodes;
    if (current.collapseMemoryRetentionDays !== undefined) COLLAPSE_MEMORY_RETENTION_MS = current.collapseMemoryRetentionDays * 24 * 60 * 60 * 1000;
  } catch (e) {}
};

loadToolkitConfig();
