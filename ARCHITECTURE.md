# editor-crdt-example — Architecture

## High-Level Overview

`editor-crdt-example` is a single-page React 18 + Yjs + Vite demo of a
CRDT-backed text editor with version-history snapshots. It runs entirely
in the browser — there is no backend, no WebSocket/WebRTC provider, and no
multi-client awareness layer. The "collaboration" angle is illustrated
within one tab: every textarea edit is translated into a Yjs `Y.Text`
CRDT operation, and the resulting document state is persisted to
`localStorage` so a reload replays the same merge-friendly history.

Runtime model:

1. **Mount.** `src/main.jsx` boots React 18 into `#root` from `index.html`.
2. **Doc construction.** `App.jsx` creates a `Y.Doc` on mount. If a
   base64-encoded update exists at `localStorage["crdt-editor:doc"]`, it
   is decoded via `Y.applyUpdate` to rehydrate the doc.
3. **Shared type.** The doc exposes a single shared `Y.Text` named
   `content`, held in a ref.
4. **Edit path.** `<textarea>` `onChange` diffs the previous vs next
   string (shortest prefix/suffix overlap), then issues a single
   `doc.transact` containing `ytext.delete` + `ytext.insert`. Each
   keystroke becomes a real CRDT op rather than a full-text replace.
5. **Update fan-out.** A `doc.on('update', …)` listener mirrors
   `ytext.toString()` into React state and re-encodes the full doc state
   with `Y.encodeStateAsUpdate` for persistence.
6. **Snapshots.** "Save snapshot" captures `Y.encodeStateAsUpdate(doc)`
   into a labeled entry in `localStorage["crdt-editor:history"]`.
   "Restore" destroys the current doc, builds a fresh `Y.Doc` from the
   snapshot's update bytes, and re-wires the update listener.

Because the only transport is `localStorage`, the demo focuses on the
CRDT data model and snapshot/restore semantics; wiring a real provider
(`y-websocket`, `y-webrtc`) and `awareness` would slot in where the
`doc.on('update', …)` listener lives today.

## Key Directories

- `src/` — All application code. Flat layout, no submodules.
  - `main.jsx` — React 18 entry; mounts `<App />` in StrictMode.
  - `App.jsx` — The entire editor: Yjs doc lifecycle, diff/transact
    edit path, snapshot save/restore/delete, localStorage persistence,
    and the JSX shell (textarea + history pane).
  - `styles.css` — Layout, toolbar, snapshot card, and status styles.
- `public/` — Not present; static assets are inlined via Vite.
- Repo root — Config, HTML entry, lockfile, docs.

## Important Files

- `index.html` — Vite HTML entry. Declares `#root` and loads
  `/src/main.jsx` as an ES module.
- `package.json` — Type-module project. Runtime deps: `react@^18.3.1`,
  `react-dom@^18.3.1`, `yjs@^13.6.18`. Dev deps: `vite@^5.4.8`,
  `@vitejs/plugin-react@^4.3.2`. Scripts: `dev` / `build` / `preview`.
- `package-lock.json` — Pinned dependency graph for reproducible
  installs.
- `vite.config.js` — Minimal Vite config; only registers
  `@vitejs/plugin-react`. No path aliases, proxies, or custom build
  targets — defaults apply.
- `src/main.jsx` — React root creation and StrictMode wrapper.
- `src/App.jsx` — The CRDT setup itself. Key landmarks:
  - `DOC_KEY` / `HISTORY_KEY` — localStorage namespaces.
  - `toBase64` / `fromBase64` — `Uint8Array` <-> string codecs for
    persisting Yjs binary updates in a string-only store.
  - `diff(oldStr, newStr)` — shortest-edit-window computation that
    turns a textarea replace into a minimal CRDT op pair.
  - `createDocFromUpdate(update)` — builds a fresh `Y.Doc` and
    optionally seeds it with `Y.applyUpdate`.
  - Mount effect — creates the doc, binds `ytext`, registers the
    `update` listener, hydrates history.
  - `handleChange` — the diff -> `doc.transact(delete + insert)` path.
  - `saveSnapshot` / `restoreSnapshot` / `deleteSnapshot` / `clearAll`
    — version-history operations over `Y.encodeStateAsUpdate` bytes.
- `README.md` — One-paragraph project summary plus dev-server commands.
- `DEV.md` — Quick-start install + dev commands.
- `CLAUDE.md` — Agent-facing repo notes.

## Build & Release Flow

- **Local dev.** `npm run dev` boots Vite's dev server with HMR against
  `index.html` -> `src/main.jsx`.
- **Production build.** `npm run build` emits a static bundle to
  `dist/` via Vite's default Rollup pipeline. `npm run preview` serves
  that build locally.
- **CI / release.** No `.github/workflows/` directory and no release
  workflow are checked in; there is nothing to dispatch via
  `/sy-release` today. Treat this repo as a static, build-on-demand
  demo until a workflow is added.
