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

## Run it

```bash
npm install
npm run dev
```

Then open the URL Vite prints (usually http://localhost:5173).

## Files of interest

- `src/App.jsx` — the whole demo: Yjs doc setup, textarea ↔ `Y.Text` binding,
  snapshot save/restore, localStorage persistence.

## Why a CRDT for a single-user textarea?

You don't strictly need one — but using `Y.Text` here means the same code
generalises to multi-user collaboration: swap `localStorage` for
`y-websocket` / `y-webrtc` and the snapshot model still works unchanged.
