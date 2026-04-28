# CLAUDE.md

Guidance for Claude Code (and other AI assistants) working in this repo.

## What this project is

A teaching demo: a single-page React app that backs a `<textarea>` with a Yjs
`Y.Text` and provides snapshot-based version history, all in the browser. No
backend, no router, no state library. The point is to **show how a CRDT works
end-to-end**, not to be a production editor.

Keep changes aligned with that goal: prefer clarity over cleverness, and
prefer demonstrating Yjs concepts over hiding them behind abstractions.

## Stack

- **React 18** (function components, hooks)
- **Vite 5** with `@vitejs/plugin-react`
- **Yjs 13** — `Y.Doc`, `Y.Text`, `Y.encodeStateAsUpdate`, `Y.applyUpdate`
- Plain CSS (`src/styles.css`)
- Persistence: `localStorage` only

No TypeScript, no test runner, no linter configured. Don't add them unless
asked.

## Layout

```
index.html              Vite entry
vite.config.js          Vite + React plugin
src/
  main.jsx              React root
  App.jsx               THE demo — Y.Doc setup, textarea binding,
                        snapshot save/restore, localStorage persistence
  styles.css
```

`App.jsx` is intentionally one file. Don't split it into `Editor.jsx`,
`History.jsx`, `useYDoc.js`, etc. unless the user asks — the demo's value is
that you can read the whole thing top-to-bottom in one go.

## Key concepts to preserve

### `Y.Text` is a CRDT-backed string

A doubly-linked list of character runs with stable IDs and tombstoned
deletes. Each character is anchored to a neighbour, which is what gives Yjs
deterministic conflict-free merging. The README has the long version under
"What is `Y.Text`?".

### Textarea ↔ `Y.Text` binding (the prefix/suffix diff)

`<textarea onChange>` gives us the *new full string*. We deliberately do
**not** call `ytext.delete(0, ytext.length); ytext.insert(0, next)` — that
would replace the whole doc on every keystroke and throw away the CRDT op
history that the demo exists to showcase.

Instead, `diff(oldStr, newStr)` in `App.jsx` finds the common prefix and
suffix and produces the smallest `(index, removeLen, insertText)` triple,
which we apply inside a `doc.transact(...)`. **Don't replace this with a blob
overwrite.** If you need a richer binding, swap in `y-textarea` or
`y-codemirror.next`.

### Snapshots = encoded CRDT state

- `Y.encodeStateAsUpdate(doc)` → `Uint8Array` → base64 → `localStorage`.
- Restore: decode → fresh `Y.Doc` → `Y.applyUpdate(doc, bytes)` → swap the
  active doc and re-attach the `doc.on('update', …)` listener.

The base64 helpers (`toBase64` / `fromBase64`) are intentionally inline; they
exist because `localStorage` only stores strings.

### Persistence keys

- `crdt-editor:doc` — the active document's encoded update bytes (base64).
- `crdt-editor:history` — JSON array of `{ id, label, ts, update, preview }`.

If you change the schema, bump the keys (e.g. `:doc:v2`) so old data doesn't
crash the loader.

## Working principles for this repo

- **Don't add a backend.** The "no backend" property is a feature of the demo.
- **Don't add a build step beyond Vite.** No SSR, no Next.js, no monorepo.
- **Don't introduce a UI framework** (Tailwind, MUI, shadcn). The styling is
  intentionally plain.
- **Don't replace `localStorage` with IndexedDB / `y-indexeddb`** unless the
  user asks — the README lists it as a *suggested extension*, not a TODO.
- **Don't silently swap `Y.encodeStateAsUpdate` for `Y.snapshot`.** They solve
  related but different problems; the README mentions snapshots as an
  extension idea.

## Common tasks

- **Run locally:** `npm install && npm run dev`
- **Verify a change builds:** `npm run build` (fast, ~0.5s)
- **No tests** — verify changes by running the dev server and exercising the
  textarea + snapshot UI manually.

## Out of scope (unless explicitly requested)

- Multi-user sync (`y-websocket`, `y-webrtc`)
- Rich-text editing (ProseMirror, Tiptap, CodeMirror)
- Conflict-resolution UI / diffing between snapshots
- Auth, sharing, server-side history
- Migrating to TypeScript
