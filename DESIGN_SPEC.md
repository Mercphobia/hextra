# DESIGN_SPEC — opencode TUI port (source: `/opencode-ref`, anomalyco/opencode @ dev)

Reference repo: https://github.com/anomalyco/opencode, branch `dev`.
TUI lives in two layers: reusable kit `packages/tui/src/` + direct-mode wiring
`packages/opencode/src/cli/cmd/run/`. Line numbers below are from the fetched
revision (Oct 2026); re-verify if the ref moves.

## 1. Stack (verified)
- `packages/opencode/package.json:102-104` — `@opentui/core/solid/keymap 0.4.5`
  (catalog), `solid-js` catalog `1.9.10` (`package.json:92`).
- TS: `packages/opencode/tsconfig.json:5-6` —
  `"jsx": "preserve"`, `"jsxImportSource": "@opentui/solid"`.
- Boot: `cmd/run/footer.ts:301` — `render(() => <RunFooterView/>, renderer)`
  with a self-created `CliRenderer`. Terminal teardown via `renderer.destroy()`.
- We use `@androidtui/* 0.5.17` + `solid-js 1.9.12`. Reconciler `.d.ts` trees
  diffed identical except additive `image` element.

## 2. Theme (packages/tui/src/theme/index.ts)
- Token type `Theme` (index.ts:36-93): `primary secondary accent error warning
  success info text textMuted selectedListItemText background backgroundPanel
  backgroundElement backgroundMenu border borderActive borderSubtle`
  + `diffAdded/Removed/Context/HunkHeader/HighlightAdded/HighlightRemoved/
  AddedBg/RemovedBg/ContextBg/LineNumber/AddedLineNumberBg/RemovedLineNumberBg`
  + `markdownText/Heading/Link/LinkText/Code/BlockQuote/Emph/Strong/
  HorizontalRule/ListItem/ListEnumeration/Image/ImageText/CodeBlock`
  + `syntaxComment/Keyword/Function/Variable/String/Number/Type/Operator/
  Punctuation` + `thinkingOpacity`.
- Built-ins (index.ts:130+): synthwave84, tokyonight, vercel, vesper, zenburn
  (+ system-detected + default dark fallback).
- `ThemeJson` supports `defs` refs + `{dark, light}` variants per token.
- Provided via theme context (`useTheme`), never hardcoded in components.
- Run-mode fallback palette (`cmd/run/theme.ts:605` RUN_THEME_FALLBACK):
  text `#f8fafc`, muted `#64748b`, success `#22c55e`, warning `#f59e0b`,
  error `#ef4444`, panel `#0f172a`, highlight `#38bdf8`.

## 3. Layout tree
- Session route with optional sidebar (`tui/src/routes/session/sidebar.tsx:14`):
  `Sidebar({sessionID, overlay})` — panel bg, **width 42**, full height,
  padding 1/1/2/2, scrollbox list, `position absolute` when overlay.
- Prompt box (`component/prompt/index.tsx:1350-1362`): full-width box,
  inner box **`border={["left"]}`** (LEFT border only, tinted by mode/agent),
  paddingLeft/Right 2, paddingTop 1. No full borders anywhere in prompt.
- Footer status row (`index.tsx:1444`): row, `justifyContent="space-between"`,
  agent/model info left, hints right.
- Messages: flat full-width boxes, `paddingLeft={1}`, blank separator rows
  between groups (`cmd/run/scrollback.writer.tsx:169-271` — no borders).
- Entry kinds (`cmd/run/types.ts:76`): system/user/assistant/reasoning/tool/error.
  Tones (`scrollback.shared.ts` entryLook): user=body, final=dim, tool-start
  special, error=bold.
- Tool titles (`cmd/run/tool.ts:276-359`): `Read <file>`, `Edit <file>`,
  `Write <file>`, `Glob "<p>"`, `Grep "<p>"`, `WebFetch <url>` — single rows.
- Permission UI (`cmd/run/footer.permission.tsx:260`): full-screen overlay
  `width/height 100%` + surface bg, options list with selected highlight
  (`footer.permission.tsx:46-52`).
- Command palette (`component/command-palette.tsx:78`): shared `DialogSelect`
  with `title="Commands"` (`tui/src/ui/dialog-select.tsx`).
- Shared dialog kit (`tui/src/ui/`): dialog, dialog-select, dialog-confirm,
  dialog-prompt, dialog-alert, toast, spinner.

## 4. Prompt box behavior (component/prompt/index.tsx + footer.prompt.tsx)
- Textarea `minHeight`/`maxHeight` rows, `wrapMode="word"`, placeholder muted:
  first run `Ask anything... "Fix a TODO in the codebase"`, shell mode
  `Run a command... "git status"` (`footer.prompt.tsx:284+`).
- `!` prefix toggles shell mode; `@` mentions + `/` commands open filter menus;
  draft/stash, history navigation, paste relayout (`footer.prompt.tsx:195-330`).
- Submit/newline per keybind table below (NOT hardcoded).

## 5. Keybindings (packages/tui/src/config/keybind.ts — verbatim defaults)
- Leader: `ctrl+x` (:41). Exit: `ctrl+c,ctrl+d,<leader>q`.
- Input: submit `return`; newline `shift+return,ctrl+return,alt+return,ctrl+j`;
  left/right `left,ctrl+b` / `right,ctrl+f`; up/down history; home/end buffer;
  `ctrl+a/e` line home/end; `ctrl+k/u` kill; `ctrl+w` word-back; `alt+f/b`
  word jump; `ctrl+d/delete` del; undo `ctrl+-`; select-all `super+a`;
  clear `ctrl+c`; paste `ctrl+v`.
- Sessions: new `<leader>n`, list `<leader>l`, rename `ctrl+r`, delete `ctrl+d`,
  interrupt `escape`, compact `<leader>c`, background `ctrl+b`,
  queued `<leader>q`, timeline `<leader>g`, parent/child `up/down/left/right`,
  quick-switch `<leader>1-9`.
- Models: list `<leader>m`, provider `ctrl+a`, cycle `f2`, sidebar `<leader>b`,
  status `<leader>s`, theme `<leader>t`, editor `<leader>e`, agent `<leader>a`.
- Messages scroll: pageup/pagedown, `ctrl+alt+u/d` half, `ctrl+g/home` first.
- Diff viewer: open none, close `escape,q`, toggle `enter,space`.

## 6. Narrow terminals (phone 40-60 cols)
- No explicit narrow breakpoint found in run/ or sidebar (width 42 fixed).
  Menus compute `Math.max(20, width-8)` (`footer.prompt.tsx:width memo`).
- Our call: overlay sidebar on narrow screens (opencode supports
  `overlay` mode), keep menus at `width-8`.

## 7. Component→adapter map (for Phase 3/4)
opencode components expect: `useSync` (sessions/messages store), `useProject`
(workspaces), `useTheme`, `useTuiConfig` (keybinds), `usePluginRuntime`,
`OpencodeKeymapProvider`, sdk client (`@opencode-ai/sdk`), `Sync` event bus.
Our adapters must expose the same names/shapes: session store, message parts
(text/reasoning/tool/question), tool registry metadata, config+keybinds,
theme tokens. Anything missing gets stubbed in DEVIATIONS.md.

## 8. NOT yet read (do not copy blind — read in Phase 4 per component)
- `component/prompt/autocomplete|history|stash|frecency.tsx` (menu details)
- `util/transcript|tool-display|revert-diff|format.ts` (row text construction)
- `component/dialog-*.tsx` except names listed above
- `ui/toast|spinner|dialog-help.tsx` specifics
