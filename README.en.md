# ChatGPT Conversation Toolkit

[简体中文](./README.md) | English

A browser extension for `ChatGPT Web` focused on making long conversations easier to work with. It improves day-to-day usability with long-conversation cleanup, full-session export, in-page search, a prompt library, timeline navigation, and sidebar folder management.

Current active maintainer: `bujue3709` (primary / sole active maintainer)

## Supported Sites

- `https://chat.openai.com/*`
- `https://chatgpt.com/*`

## Feature Highlights

- Long conversation cleanup: hide older messages and keep only the latest part of the conversation visible.
- Full JSON export: export the current conversation even if older messages were previously collapsed.
- In-page search: search within the current conversation, highlight matches, and jump between results.
- Prompt library: add, delete, search, categorize, sort, import JSON, export JSON, and copy prompts with one click.
- Timeline navigation: generate timeline nodes from loaded user messages, preview them, jump to them, and move the timeline panel around.
- Conversation folders: manage chat folders above the native “Your chats” list without replacing native conversation nodes.
- Theme sync: the toolbar, timeline, prompt modal, and folder UI follow ChatGPT light/dark appearance.
- Draggable floating UI: the minimized toolbar button and timeline can both be dragged.

## Installation

### Chrome

1. Open `chrome://extensions/`
2. Turn on Developer mode
3. Click “Load unpacked”
4. Select the repository root

### Edge

1. Open `edge://extensions/`
2. Turn on Developer mode
3. Click “Load unpacked”
4. Select the repository root

### Firefox

1. Open `about:debugging#/runtime/this-firefox`
2. Click “Load Temporary Add-on”
3. Select [manifest.json](./manifest.json) from the repository root

## Screenshot

![Extension UI](./image/image.png)

## How It Works

### Toolbar

After the page loads, the extension shows a floating toolbar in the bottom-right corner.

Available actions:

- Optimize long conversations
- Restore hidden messages
- Export the current conversation
- Open the prompt library
- Show or hide the timeline
- Search messages

When collapsed, the toolbar becomes a floating button. The button can be dragged and snaps to the nearest edge when released.

### Long Conversation Cleanup

- “Optimize long conversations” hides older messages and keeps the latest `20` visible.
- “Restore hidden messages” puts hidden messages back into the page.
- The restore flow tries to preserve reading position instead of jumping the page back to the top.

### Export

- “Export” downloads the current conversation as JSON.
- Export still includes all messages even if the page has already been collapsed.

### Search

- Enter a keyword in the toolbar search box and press Enter, or click the search button.
- Matches are highlighted in the conversation.
- Use previous / next navigation to move between results.
- If matching messages are currently hidden by long-conversation cleanup, restore them first.

### Timeline

- The timeline sits on the left side of the conversation area.
- It only uses user messages that are already loaded in the current page DOM.
- The node counter format is `current/total`.
- Hover a node to preview the message.
- Click a node to jump to that user message.
- The active timeline node follows page scrolling.
- The timeline supports wheel scrolling.
- The timeline panel can be dragged by its header.
- The timeline is off by default and can be toggled from the toolbar.
- If you reach the top of the timeline and there are no more visible messages:
  - it shows `已经没有消息了` when everything is already visible
  - it shows `请恢复隐藏消息` when older messages are still hidden

### Prompt Library

- Open it from the toolbar.
- Supported actions:
  - search by title, category, or content
  - filter by category
  - sort by update time, title, or category
  - add prompts
  - delete prompts
  - import JSON
  - export JSON
  - copy content with one click
- A success toast appears after copying.

### Conversation Folders

- Folder controls appear above the sidebar “Your chats” heading.
- You can create, rename, delete, collapse, and expand folders.
- You can drag ungrouped conversations into a folder.
- You can drag conversations back out to `Ungrouped`.
- Drop targets include:
  - the folder header
  - the conversation area inside a folder
  - blank space inside the visible managed folder segment
- You can drag folder headers to reorder folders.
- Folder management only adds local classification and ordering in the sidebar. It does not replace native conversation nodes, so native rename, archive, and other built-in conversation actions remain available.
- Folder structure, assignments, collapse state, and order are persisted locally and restored after refresh.

## Support

If this project is useful to you, a GitHub Star is appreciated.

<img src="./image/收款码.jpg" width="250" alt="Support QR code" />

## Project Structure

The extension is split into small modules and loaded in order by `manifest.json`.

```text
core/
  state.js

features/
  collapse.js
  export.js
  folders.js
  search.js
  timeline.js
  prompt-library.js

ui/
  theme.js
  toolbar.js

utils/
  dom.js
  storage.js

contentScript.js
styles.css
manifest.json
```

## Module Overview

- [core/state.js](./core/state.js)
  Runtime constants, shared state, and base configuration.
- [utils/dom.js](./utils/dom.js)
  DOM helpers, message node detection, and shared drag scheduling.
- [utils/storage.js](./utils/storage.js)
  Local persistence for UI state, positions, visibility, and saved data.
- [ui/theme.js](./ui/theme.js)
  ChatGPT theme detection and UI theme synchronization.
- [ui/toolbar.js](./ui/toolbar.js)
  Floating toolbar, minimize button, and related drag interactions.
- [features/collapse.js](./features/collapse.js)
  Long-conversation collapse and restore behavior.
- [features/export.js](./features/export.js)
  Conversation export.
- [features/folders.js](./features/folders.js)
  Sidebar folder management, drag classification, folder sorting, and local restore.
- [features/search.js](./features/search.js)
  Message search and result navigation.
- [features/timeline.js](./features/timeline.js)
  Timeline rendering, preview, scrolling, dragging, and active-node synchronization.
- [features/prompt-library.js](./features/prompt-library.js)
  Prompt library CRUD, filtering, copying, import, and export.
- [contentScript.js](./contentScript.js)
  Bootstrap entry point, initialization, and DOM observer wiring.
- [styles.css](./styles.css)
  Styles for the toolbar, timeline, prompt modal, and folder UI.

## Configuration

Common settings live in [core/state.js](./core/state.js).

Example:

```js
const TIMELINE_VISIBLE_NODE_CAPACITY = 10;
const TIMELINE_MAX_NODES = 20;

const state = {
  isCollapsed: false,
  isMinimized: false,
  keepLatest: 20,
  collapsedNodes: [],
  cachedNodes: [],
};
```

Key fields:

- `keepLatest`: how many latest messages remain visible after long-conversation cleanup
- `TIMELINE_VISIBLE_NODE_CAPACITY`: approximate number of timeline nodes visible in one screenful
- `TIMELINE_MAX_NODES`: maximum sampled timeline node count

## Exported Conversation JSON

```json
{
  "exportedAt": "2026-03-13T08:30:00.000Z",
  "url": "https://chatgpt.com/c/xxxxxxxx",
  "messageCount": 2,
  "messages": [
    {
      "index": 1,
      "role": "user",
      "text": "Your message"
    },
    {
      "index": 2,
      "role": "assistant",
      "text": "ChatGPT response"
    }
  ]
}
```

Field notes:

- `exportedAt`: export timestamp in ISO 8601 format
- `url`: current conversation URL
- `messageCount`: total exported message count
- `messages`: message array
- `messages[].index`: message order
- `messages[].role`: usually `user` or `assistant`
- `messages[].text`: plain text content

## Prompt Library JSON

The prompt library exports as an object:

```json
{
  "version": 1,
  "updatedAt": "2026-03-13T08:30:00.000Z",
  "prompts": [
    {
      "id": "c94f7299-40f3-4f95-a9f7-0ff93029a3f8",
      "title": "Daily Summary",
      "category": "Work",
      "content": "Summarize today’s work by completed items, risks, and next steps.",
      "createdAt": 1741576200000,
      "updatedAt": 1741576200000
    }
  ]
}
```

Field notes:

- `version`: format version, currently `1`
- `updatedAt`: library-level update timestamp
- `prompts`: prompt array
- `prompts[].id`: unique ID
- `prompts[].title`: title
- `prompts[].category`: category
- `prompts[].content`: prompt body
- `prompts[].createdAt`: creation timestamp
- `prompts[].updatedAt`: update timestamp

### Supported Import Shapes

The library supports two import shapes:

#### Object shape

```json
{
  "prompts": [
    {
      "title": "Code Review",
      "category": "Development",
      "content": "List issues by severity and suggest fixes."
    }
  ]
}
```

#### Array shape

```json
[
  {
    "title": "Requirement Breakdown",
    "category": "Product",
    "content": "Break this down into tasks with priorities and acceptance criteria."
  }
]
```

Import rules:

- records with empty `content` are ignored
- empty `title` values are generated from the content
- empty `category` values fall back to `未分类`
- duplicates are removed using `title + category + content`, case-insensitive

## Development Notes

- This project does not use a bundler.
- After changing scripts, reload the extension from the browser extensions page.
- Script execution order is defined by the `content_scripts.js` array in [manifest.json](./manifest.json).

## Known Limitations

- The timeline only works with message nodes that are already loaded into the current page.
- Search only works on messages currently present in the DOM. If messages were hidden by cleanup, restore them first.
- Folder management depends on the current ChatGPT sidebar DOM structure and stores classification locally. It does not sync to the ChatGPT service.
- ChatGPT DOM changes may require selector updates over time.

## Maintainer

This project is currently maintained by `bujue3709` as the sole active maintainer.

## License

This project is licensed under the [MIT License](./LICENSE).

You are free to use, modify, publish, distribute, and sell copies of the software as allowed by MIT, provided the license notice is kept with the software.

### Non-license Note

Please do not misrepresent the original project name, authorship, or branding. If you distribute a modified or unofficial version, label it clearly. This note is only to prevent confusion and does not add extra license restrictions.
