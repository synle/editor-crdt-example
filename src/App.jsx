import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as Y from 'yjs';

// --- helpers for persisting Uint8Array updates in localStorage ---
const toBase64 = (bytes) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

const DOC_KEY = 'crdt-editor:doc';
const HISTORY_KEY = 'crdt-editor:history';

// Compute the minimal (prefix, suffix) overlap between two strings so we can
// translate a textarea replace into Y.Text insert/delete ops. Keeping the diff
// small means each character edit is a real CRDT op — which is the whole point
// of this demo.
function diff(oldStr, newStr) {
  let start = 0;
  const minLen = Math.min(oldStr.length, newStr.length);
  while (start < minLen && oldStr[start] === newStr[start]) start++;
  let oldEnd = oldStr.length;
  let newEnd = newStr.length;
  while (
    oldEnd > start &&
    newEnd > start &&
    oldStr[oldEnd - 1] === newStr[newEnd - 1]
  ) {
    oldEnd--;
    newEnd--;
  }
  return {
    index: start,
    removeLen: oldEnd - start,
    insertText: newStr.slice(start, newEnd),
  };
}

function createDocFromUpdate(update) {
  const doc = new Y.Doc();
  if (update) Y.applyUpdate(doc, update);
  return doc;
}

export default function App() {
  const docRef = useRef(null);
  const yTextRef = useRef(null);
  const [text, setText] = useState('');
  const [history, setHistory] = useState([]);
  const [label, setLabel] = useState('');
  const [status, setStatus] = useState('');

  // Initial doc + history load from localStorage.
  useEffect(() => {
    const savedDoc = localStorage.getItem(DOC_KEY);
    const doc = createDocFromUpdate(savedDoc ? fromBase64(savedDoc) : null);
    const ytext = doc.getText('content');
    docRef.current = doc;
    yTextRef.current = ytext;
    setText(ytext.toString());

    const onUpdate = () => {
      // Sync React state from Y.Text on every CRDT update.
      setText(ytext.toString());
      // Persist current state.
      localStorage.setItem(
        DOC_KEY,
        toBase64(Y.encodeStateAsUpdate(doc))
      );
    };
    doc.on('update', onUpdate);

    const savedHistory = localStorage.getItem(HISTORY_KEY);
    if (savedHistory) {
      try {
        setHistory(JSON.parse(savedHistory));
      } catch {
        // ignore
      }
    }

    return () => doc.off('update', onUpdate);
  }, []);

  // Persist history list whenever it changes.
  useEffect(() => {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  }, [history]);

  const handleChange = useCallback((e) => {
    const next = e.target.value;
    const ytext = yTextRef.current;
    const doc = docRef.current;
    if (!ytext || !doc) return;
    const current = ytext.toString();
    if (current === next) return;
    const { index, removeLen, insertText } = diff(current, next);
    doc.transact(() => {
      if (removeLen > 0) ytext.delete(index, removeLen);
      if (insertText.length > 0) ytext.insert(index, insertText);
    });
  }, []);

  const saveSnapshot = useCallback(() => {
    const doc = docRef.current;
    if (!doc) return;
    const update = Y.encodeStateAsUpdate(doc);
    const snapshot = {
      id: crypto.randomUUID(),
      label: label.trim() || `Snapshot ${new Date().toLocaleString()}`,
      ts: Date.now(),
      update: toBase64(update),
      preview: doc.getText('content').toString().slice(0, 200),
    };
    setHistory((h) => [snapshot, ...h]);
    setLabel('');
    setStatus(`Saved "${snapshot.label}"`);
    setTimeout(() => setStatus(''), 2000);
  }, [label]);

  // Restore = swap the active Y.Doc with a fresh one built from the snapshot's
  // CRDT update. We re-attach the update listener so subsequent edits keep
  // syncing to React + localStorage.
  const restoreSnapshot = useCallback((snap) => {
    if (!confirm(`Restore "${snap.label}"? Current text will be replaced.`)) {
      return;
    }
    const oldDoc = docRef.current;
    if (oldDoc) oldDoc.destroy();

    const update = fromBase64(snap.update);
    const doc = createDocFromUpdate(update);
    const ytext = doc.getText('content');
    docRef.current = doc;
    yTextRef.current = ytext;
    setText(ytext.toString());

    doc.on('update', () => {
      setText(ytext.toString());
      localStorage.setItem(DOC_KEY, toBase64(Y.encodeStateAsUpdate(doc)));
    });

    localStorage.setItem(DOC_KEY, toBase64(Y.encodeStateAsUpdate(doc)));
    setStatus(`Restored "${snap.label}"`);
    setTimeout(() => setStatus(''), 2000);
  }, []);

  const deleteSnapshot = useCallback((id) => {
    setHistory((h) => h.filter((s) => s.id !== id));
  }, []);

  const clearAll = useCallback(() => {
    if (!confirm('Clear editor and all snapshots? This cannot be undone.')) {
      return;
    }
    localStorage.removeItem(DOC_KEY);
    localStorage.removeItem(HISTORY_KEY);
    const doc = docRef.current;
    if (doc) {
      const ytext = doc.getText('content');
      doc.transact(() => ytext.delete(0, ytext.length));
    }
    setHistory([]);
  }, []);

  return (
    <div className="app">
      <h1>CRDT Editor — Version History Demo</h1>
      <p style={{ fontSize: 13, color: '#555' }}>
        Type in the textarea. Each keystroke is a CRDT operation on a Yjs{' '}
        <code>Y.Text</code>. Click <b>Save snapshot</b> to capture the current
        document state; click <b>Restore</b> on any snapshot to roll back.
      </p>

      <div className="layout">
        <div>
          <div className="toolbar">
            <input
              type="text"
              placeholder="Snapshot label (optional)"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              style={{ flex: 1, padding: '6px 8px', fontSize: 13 }}
            />
            <button className="primary" onClick={saveSnapshot}>
              Save snapshot
            </button>
            <button className="danger" onClick={clearAll}>
              Clear all
            </button>
          </div>
          <textarea
            value={text}
            onChange={handleChange}
            placeholder="Start typing…"
          />
          <div className="status">
            {status || `${text.length} characters · ${history.length} snapshots`}
          </div>
        </div>

        <div className="history">
          <h2>Version history</h2>
          {history.length === 0 ? (
            <div className="empty">No snapshots yet. Save one to begin.</div>
          ) : (
            history.map((snap) => (
              <div key={snap.id} className="snapshot">
                <div className="meta">
                  <b>{snap.label}</b>
                  <br />
                  {new Date(snap.ts).toLocaleString()}
                </div>
                <div className="preview">{snap.preview || '(empty)'}</div>
                <div className="actions">
                  <button onClick={() => restoreSnapshot(snap)}>Restore</button>
                  <button
                    className="danger"
                    onClick={() => deleteSnapshot(snap.id)}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
