# CRDT Editor — Version History Demo

A minimal React + [Yjs](https://github.com/yjs/yjs) demo that shows how to use a
CRDT to back a plain `<textarea>` and capture/restore version snapshots — all
in the browser, no backend.

## Contents

- [What this demonstrates](#what-this-demonstrates)
- [What is `Y.Text`?](#what-is-ytext)
- [Storage: how data is persisted](#storage-how-data-is-persisted)
- [Persisting in a database](#persisting-in-a-database)
- [Wire protocol: sending bytes to a backend](#wire-protocol-sending-bytes-to-a-backend)
- [Concurrent editing & conflict resolution](#concurrent-editing--conflict-resolution)
- [Development](#development)
- [Why a CRDT for a single-user textarea?](#why-a-crdt-for-a-single-user-textarea)

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
import * as Y from "yjs";

const doc = new Y.Doc();
const ytext = doc.getText("content"); // get-or-create a Y.Text named "content"

ytext.insert(0, "Hello"); // insert at index
ytext.insert(5, " world");
ytext.delete(0, 1); // delete N chars at index
ytext.toString(); // serialise to plain string
ytext.length; // length in characters

doc.on("update", (update) => {
  /* binary CRDT update emitted */
});
ytext.observe((event) => {
  /* fine-grained delta */
});

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

## Storage: how data is persisted

Everything lives in `localStorage`. There are exactly two keys, both holding
the binary CRDT state base64-encoded into strings.

### `crdt-editor:doc` — the live document

```
localStorage["crdt-editor:doc"] = base64(Y.encodeStateAsUpdate(doc))
```

The flow on every keystroke:

```
keystroke
  → diff(oldStr, newStr)              → (index, removeLen, insertText)
  → ytext.delete / ytext.insert       inside doc.transact(...)
  → doc fires 'update'
  → Y.encodeStateAsUpdate(doc)        → Uint8Array (entire merged op log)
  → toBase64(bytes)                   → string
  → localStorage.setItem(...)
```

`Y.encodeStateAsUpdate(doc)` returns the **whole merged op log** in Yjs's
compact binary format — not just the latest delta. So this one string is
enough to fully rehydrate the doc on reload.

### `crdt-editor:history` — the snapshot list

A plain JSON array, one entry per snapshot:

```js
[
  {
    id:      "uuid-…",
    label:   "before refactor",
    ts:      1714248000000,
    update:  "AQHv…=",        // base64 of Y.encodeStateAsUpdate(doc) at save time
    preview: "first 200 chars of text…"
  },
  ...
]
```

Each snapshot carries its **own** full encoded CRDT state — independent of
the live doc and of other snapshots. Restoring snapshot N doesn't depend on
N-1 existing.

### Why base64?

`localStorage` only stores **strings**. `Y.encodeStateAsUpdate` returns a
`Uint8Array` of raw bytes (often containing non-printable / invalid UTF-16
code units), so we can't just `String(bytes)` or `JSON.stringify` it without
corruption. Base64 is the standard way to round-trip arbitrary bytes through
a text-only channel.

The two helpers in `src/App.jsx`:

```js
const toBase64 = (bytes) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
```

### Round-trip on reload

```
localStorage.getItem("crdt-editor:doc")   →  base64 string
  → fromBase64(...)                        →  Uint8Array
  → const doc = new Y.Doc()
  → Y.applyUpdate(doc, bytes)              →  doc is fully restored
  → doc.getText('content').toString()      →  the text you left off with
```

### Trade-offs

- **Size cost:** base64 is ~33% larger than the raw bytes. Fine for a demo;
  for big docs, IndexedDB (e.g. `y-indexeddb`) stores `Uint8Array` natively.
- **`localStorage` cap:** ~5 MB per origin in most browsers. Many large
  snapshots will hit that.
- **Tombstones never go away:** Yjs keeps deleted characters as tombstones so
  concurrent ops can still resolve. The encoded update grows monotonically
  with edit history. For a single-user demo this is invisible; for long-lived
  docs you'd periodically `Y.encodeStateAsUpdate` into a fresh doc to "garbage
  collect" — Yjs already does some of this automatically.
- **No schema versioning yet:** if the storage format changes, old data could
  break the loader. The convention is to bump the keys (e.g. `:doc:v2`).

## Persisting in a database

If you outgrow `localStorage`, the rule is: **store raw bytes, drop the
base64.** Databases handle binary directly; base64 just wastes ~33% of the
column for nothing.

### Type mapping

| Storage             | Type                                |
| ------------------- | ----------------------------------- |
| Postgres            | `BYTEA`                             |
| MySQL               | `BLOB` / `LONGBLOB`                 |
| SQLite              | `BLOB`                              |
| MongoDB             | `BinData` (`Buffer`)                |
| Redis               | binary string (default)             |
| S3 / object store   | the `Uint8Array` as the object body |
| DynamoDB            | `B` (Binary) attribute              |
| IndexedDB (browser) | `Uint8Array` directly — no base64   |

### Strategy A — snapshot-only (simplest)

One row per document. Overwrite on every save. This is what the demo does,
just bigger.

```sql
CREATE TABLE documents (
  id    UUID PRIMARY KEY,
  state BYTEA NOT NULL,        -- Y.encodeStateAsUpdate(doc)
  updated_at TIMESTAMPTZ
);
```

Save:

```js
await pg.query("UPDATE documents SET state = $1, updated_at = now() WHERE id = $2", [
  Buffer.from(Y.encodeStateAsUpdate(doc)),
  id,
]);
```

Load:

```js
const { rows } = await pg.query("SELECT state FROM documents WHERE id = $1", [id]);
const doc = new Y.Doc();
Y.applyUpdate(doc, new Uint8Array(rows[0].state));
```

✅ Easy. ✅ Cheap reads.
❌ Every save rewrites the whole blob — bad for many concurrent writers.

### Strategy B — append-only update log (what real Yjs backends do)

One row per delta. Never rewrite, just append. Periodically compact.

```sql
CREATE TABLE doc_updates (
  doc_id     UUID NOT NULL,
  seq        BIGSERIAL,
  update     BYTEA NOT NULL,             -- the delta from doc.on('update', …)
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (doc_id, seq)
);
```

Append on every local edit:

```js
doc.on("update", async (update, origin) => {
  if (origin === "remote") return; // don't echo back
  await pg.query("INSERT INTO doc_updates (doc_id, update) VALUES ($1, $2)", [
    docId,
    Buffer.from(update),
  ]);
});
```

Replay on load:

```js
const { rows } = await pg.query("SELECT update FROM doc_updates WHERE doc_id = $1 ORDER BY seq", [
  docId,
]);
const doc = new Y.Doc();
for (const r of rows) Y.applyUpdate(doc, new Uint8Array(r.update));
```

Compact periodically (`Y.mergeUpdates` collapses many deltas into one):

```js
const merged = Y.mergeUpdates(rows.map((r) => new Uint8Array(r.update)));
// transactionally: replace all rows with one merged row
```

✅ Cheap writes. ✅ Multi-writer friendly. ✅ Audit log for free.
❌ Reads need to replay N rows (mitigated by compaction).

### Existing adapters — don't roll your own

- [`y-leveldb`](https://github.com/yjs/y-leveldb) — LevelDB persistence (Node)
- [`@y/redis`](https://github.com/yjs/y-redis) — Redis-backed scaling layer
- [`y-mongodb-provider`](https://github.com/MaxNoetzold/y-mongodb-provider)
- [`y-postgresql`](https://github.com/dukeluo/y-postgresql)
- [`y-indexeddb`](https://github.com/yjs/y-indexeddb) — browser IndexedDB
- [`y-sweet`](https://github.com/jamsocket/y-sweet) — hosted/self-hosted Yjs
  server with built-in persistence

These all implement strategy B (append + compact) under the hood and expose a
"give me the doc, I'll keep it synced" API.

### Watch out for

`Y.encodeStateAsUpdate(doc)` returns a **complete** state blob. The argument
to `doc.on('update', cb)` is a **delta** (just the new ops). Don't mix them
up:

- Strategy A persists the **complete** state, overwriting.
- Strategy B persists the **deltas**, appending.

Both are valid `Uint8Array`s and both go through `Y.applyUpdate` — the
difference is just _what_ you choose to write.

## Wire protocol: sending bytes to a backend

When data leaves the browser, **send raw bytes whenever you can.** Base64 is
a fallback for text-only channels, not the protocol.

### When to use what

| Channel                          | Send                                                                | Why                                |
| -------------------------------- | ------------------------------------------------------------------- | ---------------------------------- |
| WebSocket                        | `Uint8Array` (binary frame)                                         | binary native                      |
| WebRTC DataChannel               | `Uint8Array`                                                        | binary native                      |
| `fetch` / HTTP body              | `Uint8Array` / `Blob` with `Content-Type: application/octet-stream` | binary native                      |
| `postMessage` (workers, iframes) | `Uint8Array`                                                        | structured clone passes it through |
| Server-Sent Events (text-only)   | base64                                                              | SSE is `text/event-stream`         |
| JSON field                       | base64                                                              | JSON has no byte type              |
| URL / query string               | base64url                                                           | URL is text                        |

### Yjs's own protocol

Yjs already defines a tiny binary message protocol — you don't invent one. It
lives in [`y-protocols`](https://github.com/yjs/y-protocols):

```
sync step 1   "here's my state vector, tell me what I'm missing"
sync step 2   "here are the updates you're missing"
update        "here's a new delta I just made"  (doc.on('update', …))
awareness     cursor positions, presence (Y.Awareness)
```

Typical handshake between two peers:

```
client → server : sync-step-1 (state vector)         [Y.encodeStateVector(doc)]
server → client : sync-step-2 (diff)                 [Y.encodeStateAsUpdate(doc, clientSV)]
client → server : sync-step-2 (diff the other way)
both peers      : update (on every local edit)       [doc.on('update', …)]
```

The state-vector exchange is the optimisation that makes it efficient — each
side sends a tiny "I have up to clock N from each clientId" vector and only
the missing ops travel back.

### Option 1 — `fetch` with a binary body (simplest, request/response)

Browser:

```js
const update = Y.encodeStateAsUpdate(doc); // Uint8Array

await fetch("/api/docs/123", {
  method: "POST",
  headers: { "Content-Type": "application/octet-stream" },
  body: update, // raw bytes — do NOT JSON.stringify
});
```

Server (Express):

```js
app.post(
  "/api/docs/:id",
  express.raw({ type: "application/octet-stream", limit: "10mb" }),
  async (req, res) => {
    const update = new Uint8Array(req.body); // req.body is a Buffer
    const doc = await loadDoc(req.params.id);
    Y.applyUpdate(doc, update);
    await saveDoc(req.params.id, Y.encodeStateAsUpdate(doc));
    res.sendStatus(204);
  },
);
```

Reading bytes back:

```js
const res = await fetch("/api/docs/123");
const update = new Uint8Array(await res.arrayBuffer());
Y.applyUpdate(doc, update);
```

### Option 2 — WebSocket binary frames (best for live sync)

Browser:

```js
const ws = new WebSocket("wss://example.com/doc/123");
ws.binaryType = "arraybuffer"; // give us bytes, not Blob

ws.onopen = () => ws.send(Y.encodeStateAsUpdate(doc));

doc.on("update", (update, origin) => {
  if (origin === ws) return; // don't echo
  if (ws.readyState === WebSocket.OPEN) ws.send(update);
});

ws.onmessage = (ev) => {
  Y.applyUpdate(doc, new Uint8Array(ev.data), ws /* origin */);
};
```

Server (Node, `ws` package):

```js
import { WebSocketServer } from "ws";
const wss = new WebSocketServer({ port: 8080 });
const doc = new Y.Doc();

wss.on("connection", (sock) => {
  sock.send(Y.encodeStateAsUpdate(doc)); // initial state
  sock.on("message", (data) => {
    const update = new Uint8Array(data);
    Y.applyUpdate(doc, update, sock);
    for (const peer of wss.clients) {
      if (peer !== sock && peer.readyState === 1) peer.send(update);
    }
  });
});
```

This is exactly what `y-websocket` automates for you — but the manual version
is ~30 lines.

### Option 3 — `navigator.sendBeacon` (fire-and-forget on tab close)

```js
window.addEventListener("beforeunload", () => {
  const update = Y.encodeStateAsUpdate(doc);
  navigator.sendBeacon("/api/docs/123", new Blob([update], { type: "application/octet-stream" }));
});
```

### Option 4 — JSON wrapping (only if you must)

When stuck inside a JSON-only API:

```js
const msg = { docId, kind: "update", payload: toBase64(update) };
fetch("/sync", { method: "POST", body: JSON.stringify(msg) });
```

But prefer Option 1 — native binary, no encoding tax.

### Common gotchas

1. **Don't `JSON.stringify(update)`.** A `Uint8Array` becomes
   `{"0":1,"1":47,…}` — ~10× bigger and a parse pain. Send bytes directly,
   or base64-wrap inside JSON if JSON is mandatory.
2. **Set `ws.binaryType = 'arraybuffer'`.** Default in some browsers is
   `'blob'`, which forces an extra `await blob.arrayBuffer()` step.
3. **`Buffer` vs `Uint8Array`.** Node's `Buffer` _is_ a `Uint8Array` subclass.
   `Y.applyUpdate` accepts both; `new Uint8Array(buf)` is the safe explicit
   form.
4. **Body parsers.** Don't put `express.json()` in front of a binary route —
   it'll UTF-8-decode the bytes and corrupt them.
5. **CORS for binary.** Same headers as any cross-origin request; the binary
   content type doesn't change CORS rules.
6. **Compression.** Yjs updates are already compact binary. `gzip`/`br` on
   top usually saves <10% — don't bother unless measured.

### Don't write the protocol layer yourself

For real apps, use existing providers — they implement `y-protocols`
correctly (sync handshake, awareness, reconnection, framing):

- [`y-websocket`](https://github.com/yjs/y-websocket) — WebSocket client + reference server
- [`y-webrtc`](https://github.com/yjs/y-webrtc) — peer-to-peer over WebRTC
- [Hocuspocus](https://hocuspocus.dev/) — production-grade Yjs WebSocket server (auth, persistence, scaling)
- [`y-sweet`](https://github.com/jamsocket/y-sweet) — managed Yjs server

## Concurrent editing & conflict resolution

### How Yjs resolves concurrent edits

The honest one-liner: **there are no conflicts to resolve**, in the
traditional sense. There's no "server takes the latest", no diff3 merge, no
rebasing. The CRDT is designed so any two histories of operations merge to
the **same final state** regardless of order. This property is _strong
eventual consistency_.

#### Stable IDs, not indices

Every character carries:

```
ID = (clientId, clock)
   = (random-int-per-Y.Doc, monotonically-increasing-counter)
```

When you `ytext.insert(5, 'X')`, Yjs records:

```
char 'X', id=(C1, 7), inserted AFTER the char currently at index 4
```

The "inserted after" pointer is the **origin** — a stable reference to a
neighbour, not a numeric index. Indices shift; IDs don't.

#### Concurrent insert at the "same" position

Tab A and Tab B both see `"hello"`. Each types at index 5 without seeing the
other yet:

```
Tab A: insert 'X' at end  →  ('X', id=(A,1), origin=last-char-of-"hello")
Tab B: insert 'Y' at end  →  ('Y', id=(B,1), origin=last-char-of-"hello")
```

Both ops have the **same origin**. When the docs sync, Yjs needs a
deterministic tie-break. The rule (YATA): order by `clientId`. Both tabs
converge to `"helloXY"` or `"helloYX"` — whichever — but **the same one on
every replica**, every time.

#### Concurrent edit vs delete

```
Tab A: ytext.delete(0, 5)         (deletes "hello")
Tab B: ytext.insert(2, '!')       (inserts '!' between l and l)
```

After merge: the "hello" characters become tombstones, `'!'` lives on as a
regular char anchored to `'l'`'s ID. Final visible text: `"!"`. The delete
didn't "win"; both ops applied, and the visible string is what falls out.

#### Last-write-wins for `Y.Map` values

`Y.Text` interleaves character-by-character. `Y.Map` is different: setting
the same key concurrently is resolved by **clientId tiebreak** (effectively
deterministic last-write-wins). If you need merge logic for a value, model
it with a nested CRDT instead of a primitive.

#### What you _don't_ get

Yjs guarantees **convergence**, not **intent**. Classic example:

```
Doc:   "the cat sat"
Tab A: replaces "cat" with "dog"   →  "the dog sat"
Tab B: replaces "cat" with "fox"   →  "the fox sat"
```

Concurrent merge yields something like `"the dogfox sat"` — deterministic,
but a mash-up. No CRDT can know you meant these as alternatives — that's a
semantic conflict, not a data conflict. If you need it, build a UI on top
(comments, suggested edits).

### How sync between replicas actually flows

```js
// On every replica:
doc.on("update", (update, origin) => {
  if (origin === "remote") return; // don't echo
  channel.send(update); // → other peer
});

channel.onMessage = (update) => {
  Y.applyUpdate(doc, update, "remote"); // tag origin so we don't echo back
};
```

Transport doesn't matter — WebSocket, WebRTC, BroadcastChannel, postMessage,
even a polling fetch loop. Yjs only cares that updates arrive eventually.

### What this demo _actually_ does with two tabs (the unflattering truth)

The current `src/App.jsx` does **not** sync tabs. Here's what happens:

1. Tab A loads → reads `crdt-editor:doc` → builds `Y.Doc` instance A.
2. Tab B loads → reads the same key → builds `Y.Doc` instance B (different
   in-memory object, same starting state).
3. Tab A types `"hi"` → A's `'update'` fires → A writes its full encoded
   state to `localStorage`.
4. Tab B types `"yo"` → B's `'update'` fires → B writes _its_ full encoded
   state to `localStorage`, **clobbering A's**.

The CRDT itself is fine — if A's and B's docs ever met, they'd merge
cleanly. But they never meet, because neither tab listens for the other's
writes. Last tab to type wins the persistence race. **This is a transport
limitation, not a CRDT failure.**

#### Fix #1 — `BroadcastChannel` (cross-tab, same origin, no server)

The smallest change that makes two tabs collaborate live:

```js
const bc = new BroadcastChannel("crdt-editor");

doc.on("update", (update, origin) => {
  if (origin === bc) return; // skip echoes from ourselves
  bc.postMessage(update); // structured-cloned Uint8Array
  localStorage.setItem(DOC_KEY, toBase64(Y.encodeStateAsUpdate(doc)));
});

bc.onmessage = (ev) => {
  Y.applyUpdate(doc, new Uint8Array(ev.data), bc /* origin */);
};
```

Now Tab A's keystrokes apply to Tab B's `Y.Doc` in real time, both tabs
converge on every edit, and the localStorage write is no longer a race.

#### Fix #2 — `y-indexeddb`

Drop-in replacement for our hand-rolled `localStorage` glue, with cross-tab
sync built in (uses IndexedDB + a `BroadcastChannel` internally):

```js
import { IndexeddbPersistence } from "y-indexeddb";
const persistence = new IndexeddbPersistence("crdt-editor", doc);
```

#### Fix #3 — a real backend

Once a server is in the loop (`y-websocket` / Hocuspocus), two browsers —
same user or different — see each other's edits via the protocol described
above. Server holds the canonical doc, fans out updates to every connected
client.

### Concurrent typing in practice

Assume Fix #1 is in place. The doc says `"hello world"`. Both tabs have the
cursor at index 5 (after `"hello"`).

| Time  | Tab A            | Tab B            | Both tabs converge on                                             |
| ----- | ---------------- | ---------------- | ----------------------------------------------------------------- |
| t=0   | types `","` at 5 | —                | `"hello, world"`                                                  |
| t=0+ε | —                | types `"!"` at 5 | merge: insert at 5 with origin = `'o'`'s ID, tiebreak by clientId |
| final |                  |                  | `"hello,! world"` or `"hello!, world"` — same on both tabs        |

You can't predict which order ends up visible (clientIds are random per
`Y.Doc`), but you can predict that **both tabs see the same string** and
**no characters are lost**. Compare with naive last-write-wins, which would
have dropped one keystroke entirely.

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

A textarea's `onChange` gives us the _new_ full string. To turn that into a
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
  `Y.applyUpdate(doc, bytes)` → swap it in as the active doc and re-attach
  the update listener.

### Known limitations

- **No cross-tab sync.** See ["What this demo actually does with two
  tabs"](#what-this-demo-actually-does-with-two-tabs-the-unflattering-truth) —
  two tabs of the same origin race on `localStorage`.
- **No multi-user sync.** No WebSocket / WebRTC layer.
- **No storage migration.** Schema bumps would need a new key prefix.
- **Tombstones grow forever** in long-lived single-tab sessions.

### Extending it

A few natural next steps:

- Wire up `BroadcastChannel` (~5 lines) to make two tabs collaborate live.
- Replace the manual diff with [`y-textarea`](https://github.com/yjs/y-textarea)
  or use a richer editor binding (`y-prosemirror`, `y-codemirror.next`,
  `y-tiptap`).
- Swap `localStorage` for [`y-indexeddb`](https://github.com/yjs/y-indexeddb)
  for larger documents and free cross-tab sync.
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
