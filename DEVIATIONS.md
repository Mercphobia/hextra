# DEVIATIONS from opencode / upstream (with reasons)

## Runtime: Bun effects broken, use Node 26
- `@androidtui/solid@0.5.17` `useKeyboard`/`onMount`/`createEffect` never fire
  under Bun on Termux (proven: raw stdin bytes arrive, zero `keypress` events,
  `mounted` never logs). Same code works on Node.
- Fix: run `tui-native` under **Node ≥ 26 with `--experimental-ffi`**
  (Termux ships Node 26.x). Verified A/B locally: fork solid + Node 26 fires
  `mounted` + keys; upstream solid behaves identically.

## Single core copy (npm alias duality)
- npm installs `@androidtui/core` and `@opentui/core` (npm alias to the same
  release) as two separate copies. `instanceof CliRenderer` inside solid's
  `render()` then fails, spawning a second renderer
  ("stdin is already used by another CliRenderer").
- Fix: `apps/tui-native` creates the renderer from `@opentui/core` — the exact
  copy `@androidtui/solid` uses (verified single resolved path).

## Versions
- `solid-js 1.9.12` instead of opencode's `1.9.10` (peer dep of
  `@androidtui/solid@0.5.17` requires ≥1.9.12; patch-level).

## Termux-only guards
- `tui-native` refuses non-Termux (needs the Bionic `.so`) and non-TTY.
- The Bionic `.so` ships via npm optional dep; a postinstall symlink satisfies
  the loader's prebuilt-path check (the loader's npm fallback names don't
  exist — fork bug, worked around, not fixed upstream).

## Prompt box port (phase 4a)
- Fork reconciler types have no `key` prop: lists render without keys.
- Submit keys remapped to opencode binds (return=submit,
  shift/ctrl/meta+return=newline) via merged `keyBindings`.
- Stubbed (no equivalent in our agent): IME composition flush, paste
  attachments/images, editor selection context, prompt stash, workspace move
  dialog, session auto-create with workspaces, model-variant picker.
- `@` mentions complete bots + files only (no skill/agent providers).
- History navigates sent prompts only (no persistent cross-session history).
