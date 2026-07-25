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

## Storage / transport rules of thumb

These are the principles the README documents in detail; encode them so
suggestions stay consistent.

### Inside the browser (this demo)

- `localStorage` is **string-only**, so the `Uint8Array` from
  `Y.encodeStateAsUpdate` MUST be base64-encoded. That's the only reason the
  base64 helpers exist.
- IndexedDB stores `Uint8Array` natively — if a future change moves to
  IndexedDB / `y-indexeddb`, drop the base64 step.
- `BroadcastChannel` / `postMessage` use structured clone, so `Uint8Array`
  passes through directly. No base64.

### Crossing a process boundary (database / network)

- **Default to raw bytes.** Base64 is a tax (~33%) and a fallback for
  text-only channels, not the protocol.
- **Database column types:** `BYTEA` (Postgres), `BLOB` / `LONGBLOB` (MySQL),
  `BLOB` (SQLite), `BinData` (Mongo), Binary (`B`) attribute (DynamoDB).
- **HTTP:** `Content-Type: application/octet-stream`; pass the `Uint8Array`
  as `body` directly; on the server use `express.raw({ type: 'application/octet-stream' })`
  — never `express.json()` in front of a binary route.
- **WebSocket:** binary frame. Set `ws.binaryType = 'arraybuffer'` on the
  client; the server gets a `Buffer`. Wrap with `new Uint8Array(...)` before
  `Y.applyUpdate`.
- **Only base64-wrap** when the channel is JSON / SSE / URL — i.e. has no
  byte type at all.
- **Don't `JSON.stringify(update)`.** A `Uint8Array` becomes
  `{"0":1,"1":47,…}` — ~10× bloat and corruption-prone parsing.

### Two storage strategies if a backend is added

- **Strategy A (snapshot):** one row per doc, `Y.encodeStateAsUpdate(doc)`
  overwrites on save. Simple; bad for concurrent writers.
- **Strategy B (append-only update log):** one row per delta from
  `doc.on('update', …)`; replay on load; periodically compact with
  `Y.mergeUpdates(...)`. This is what `y-leveldb`, `y-redis`, Hocuspocus etc.
  do internally. Prefer this for any real multi-writer scenario.

Don't conflate these: `Y.encodeStateAsUpdate(doc)` returns the **whole**
state; the `'update'` callback's argument is a **delta**. Both go through
`Y.applyUpdate`, but they mean different things.

### Yjs sync protocol (if asked to wire up multi-user)

The handshake from `y-protocols`:

1. client → server: `sync-step-1` carrying `Y.encodeStateVector(doc)`
2. server → client: `sync-step-2` carrying `Y.encodeStateAsUpdate(doc, clientSV)`
3. both peers: `update` messages on every local edit, tagged with an `origin`
   so receivers don't echo

Recommend `y-websocket` / Hocuspocus / `y-sweet` over hand-rolling this. A
manual implementation is ~30 lines but lacks awareness, reconnection, and
auth.

## Concurrency / conflict resolution

If the user asks "what happens when two people edit at the same time":

- Yjs gives **strong eventual consistency** — any two histories merge to the
  same final state regardless of order. There is no manual conflict
  resolution.
- Concurrent inserts at the same logical position get a deterministic order
  via `(clientId, clock)` tiebreak (YATA rule).
- Concurrent edit + delete: deletes are tombstones, so both ops apply; the
  visible string is what falls out.
- `Y.Map` value updates resolve by clientId tiebreak (effectively
  deterministic LWW). For value-level merging, nest a CRDT.
- Yjs guarantees **convergence**, not **intent**. Two users replacing "cat"
  with different words can produce a deterministic mash-up; that's a
  semantic conflict the application has to surface (e.g. suggested edits).

### Known limitation in THIS demo: no cross-tab sync

`App.jsx` writes to `localStorage` on every `'update'` but does NOT listen
for changes from other tabs. Two tabs of the same origin therefore race on
the storage key — last writer wins. The CRDT is innocent; the transport
layer is missing.

If asked to fix this, the smallest viable change is a `BroadcastChannel`
in `App.jsx`:

```js
const bc = new BroadcastChannel('crdt-editor');
doc.on('update', (update, origin) => {
  if (origin === bc) return;
  bc.postMessage(update);
  // existing localStorage write...
});
bc.onmessage = (ev) => Y.applyUpdate(doc, new Uint8Array(ev.data), bc);
```

Alternative: swap to `y-indexeddb`, which solves persistence + tab sync
together. Either is fine; pick based on what the user is asking for.

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
