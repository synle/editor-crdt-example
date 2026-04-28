# CRDT Editor — Version History Demo

A minimal React + [Yjs](https://github.com/yjs/yjs) demo that shows how to use a
CRDT to back a plain `<textarea>` and capture/restore version snapshots — all
in the browser, no backend.

## What this demonstrates

- **Yjs `Y.Text` as the source of truth.** Each edit in the textarea is
  translated into the smallest possible `insert` / `delete` op on the CRDT (via
  a prefix/suffix diff), so the document history is real CRDT operations rather
  than blob replacements.
- **Snapshots = encoded CRDT state.** "Save snapshot" calls
  `Y.encodeStateAsUpdate(doc)` and stores the bytes (base64) in `localStorage`.
- **Restore = rebuild a `Y.Doc` from the snapshot's update bytes.** The active
  doc is swapped in place; subsequent edits keep flowing through the CRDT.
- **Persistence across reloads** for both the live document and the snapshot
  list — again, just `localStorage`.

## What is `Y.Text`?

`Y.Text` is one of Yjs's built-in **shared data types** — a CRDT-backed string.
It looks like a regular string from the outside, but every insert and delete is
recorded as a CRDT operation rather than overwriting the whole value.

### Mental model

A normal string is a flat array of characters. `Y.Text` is more like a
doubly-linked list of character runs, where each character carries:

- a **unique ID** (`clientId` + sequence number),
- a pointer to the character it was inserted **after** (its "origin"), and
- a **deletion flag** — deletes are tombstones, not real removals.

This is a variant of Yjs's [YATA](https://www.researchgate.net/publication/310212186_Near_Real-Time_Peer-to-Peer_Shared_Editing_on_Extensible_Data_Types)
algorithm (similar in spirit to RGA). Because every character is anchored to a
stable neighbour, two clients that both "insert at position 5" still end up
with a deterministic, conflict-free merge — no central server required.

### API used in this demo

```js
import * as Y from 'yjs';

const doc = new Y.Doc();
const ytext = doc.getText('content');   // get-or-create a Y.Text named "content"

ytext.insert(0, 'Hello');                // insert at index
ytext.insert(5, ' world');
ytext.delete(0, 1);                      // delete N chars at index
ytext.toString();                        // serialise to plain string
ytext.length;                            // length in characters

doc.on('update', (update) => { /* binary CRDT update emitted */ });
ytext.observe((event) => { /* fine-grained delta */ });

// Snapshot the entire document state (used for our version history):
const bytes = Y.encodeStateAsUpdate(doc);

// Rehydrate a doc from those bytes:
const restored = new Y.Doc();
Y.applyUpdate(restored, bytes);
```

### Why it matters for the demo

Using `Y.Text` (instead of just storing the string) buys us three things:

1. **A real op log.** `Y.encodeStateAsUpdate(doc)` returns a compact binary
   blob of all ops, which is exactly what we save as a snapshot.
2. **Deterministic merging** of concurrent edits — the property a plain string
   can't give you.
3. **A free upgrade path to multi-user.** Swap `localStorage` for
   `y-websocket` or `y-webrtc` and the same `Y.Text` syncs across clients with
   no other code changes; the snapshot model keeps working unchanged.

### Related shared types

`Y.Text` is the string variant. The same `Y.Doc` can also hold:

- `Y.Array` — ordered list CRDT
- `Y.Map` — key/value CRDT
- `Y.XmlFragment` / `Y.XmlElement` — tree-structured docs (used by Tiptap,
  ProseMirror)

They all share the same update/snapshot machinery, so the patterns in this
demo generalise to richer documents.

## Development

### Prerequisites

- Node.js 18+ (tested on Node 24)
- npm

### Scripts

```bash
npm install      # install deps (React, Yjs, Vite)
npm run dev      # start the Vite dev server with HMR (default: http://localhost:5173)
npm run build    # production build → dist/
npm run preview  # serve the production build locally
```

### Project layout

```
.
├── index.html          # Vite entry HTML
├── vite.config.js      # Vite + @vitejs/plugin-react
├── src/
│   ├── main.jsx        # React root
│   ├── App.jsx         # the whole demo: Y.Doc setup, textarea binding,
│   │                   # snapshot save/restore, localStorage persistence
│   └── styles.css
└── package.json
```

There is no router, no state library, no backend — `App.jsx` is the demo.

### How the textarea ↔ `Y.Text` binding works

A textarea's `onChange` gives us the *new* full string. To turn that into a
real CRDT op (instead of a blob replace), `App.jsx` does a tiny prefix/suffix
diff against the current `ytext.toString()` and emits the minimal
`ytext.delete(index, n)` + `ytext.insert(index, str)` pair inside a
`doc.transact(...)`.

The opposite direction is simpler: a `doc.on('update', …)` listener pulls
`ytext.toString()` back into React state on every change, and persists the
encoded doc to `localStorage`.

### Snapshots

- **Save:** `Y.encodeStateAsUpdate(doc)` → `Uint8Array` → base64 →
  `localStorage`, alongside a label and timestamp.
- **Restore:** decode base64 → `Uint8Array` → build a fresh `Y.Doc` →
  `Y.applyUpdate(doc, bytes)` → swap it in as the active doc and re-attach the
  update listener.

### Extending it

A few natural next steps if you want to play:

- Replace the manual diff with [`y-textarea`](https://github.com/yjs/y-textarea)
  or use a richer editor binding (`y-prosemirror`, `y-codemirror.next`,
  `y-tiptap`).
- Swap `localStorage` for [`y-indexeddb`](https://github.com/yjs/y-indexeddb)
  for larger documents.
- Add multi-user sync with [`y-websocket`](https://github.com/yjs/y-websocket)
  or [`y-webrtc`](https://github.com/yjs/y-webrtc) — the snapshot UI keeps
  working as-is.
- Replace full-state snapshots with Yjs's
  [`snapshot`](https://docs.yjs.dev/api/about-snapshots) API for true
  point-in-time views without losing the live op history.

## Why a CRDT for a single-user textarea?

You don't strictly need one — but using `Y.Text` here means the same code
generalises to multi-user collaboration: swap `localStorage` for
`y-websocket` / `y-webrtc` and the snapshot model still works unchanged.
