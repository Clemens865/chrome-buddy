// LibraryView — the rail surface for the local RAG library.
//
// Three jobs:
//   1. List every doc in the library (source pill, title, chunkCount, age)
//      so the user can see / delete what's there.
//   2. Free-text search via the existing search_library tool — same path the
//      agent uses, so what the user sees is what the agent sees.
//   3. One-shot "Import folder" via FSA showDirectoryPicker → walks .md files
//      → indexes each via LIBRARY_INDEX. Permission expiry is a non-issue
//      because the gesture lasts the picker's lifetime and content goes into
//      IDB after — no further FSA permission ever needed.

import { useCallback, useEffect, useState } from 'react';
import { Ic } from '../ui/icons';
import { walkFolder, type FsdHandle, type WalkedFile } from '../library/walk';
import type { LibrarySource } from '../library';
import { listDocs, deleteDoc, hashContent } from '../library/store';
import type { LibraryDoc } from '../library/store';

interface SearchHit {
  docId: string;
  title: string;
  source: LibrarySource;
  sourceRef?: string;
  chunkIdx: number;
  score: number;
  snippet: string;
}

export function LibraryView() {
  const [docs, setDocs] = useState<LibraryDoc[] | undefined>();
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[] | undefined>();
  const [searching, setSearching] = useState(false);
  const [importStatus, setImportStatus] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  // View/edit a doc's full content (the dashboard's read+edit surface).
  const [editing, setEditing] = useState<LibraryDoc | null>(null);
  const [draft, setDraft] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  const refresh = useCallback(async () => {
    setDocs(await listDocs());
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onSearch = useCallback(async () => {
    if (!query.trim()) {
      setHits(undefined);
      return;
    }
    setSearching(true);
    setError(undefined);
    try {
      const r = (await chrome.runtime.sendMessage({
        type: 'TOOL_EXEC',
        tool: 'search_library',
        args: { query: query.trim(), k: 8 },
      })) as { ok: boolean; result: { ok: boolean; data?: { hits: SearchHit[] }; error?: { message: string } } };
      if (!r.ok || !r.result.ok) {
        setError(r.result.error?.message ?? 'Search failed.');
        setHits([]);
      } else {
        setHits(r.result.data?.hits ?? []);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSearching(false);
    }
  }, [query]);

  const onDelete = useCallback(async (id: string) => {
    await deleteDoc(id);
    await refresh();
    setEditing((cur) => (cur?.id === id ? null : cur));
    // Clear search results that referenced the deleted doc.
    setHits((prev) => prev?.filter((h) => h.docId !== id));
  }, [refresh]);

  const onOpenDoc = useCallback((d: LibraryDoc) => {
    setEditing(d);
    setDraft(d.content);
    setError(undefined);
  }, []);

  // Re-index the doc with the edited content (same source/sourceRef → updates
  // in place, no consolidation). Embedding happens SW-side.
  const onSaveEdit = useCallback(async () => {
    if (!editing || !draft.trim()) return;
    setSavingEdit(true);
    setError(undefined);
    try {
      const r = (await chrome.runtime.sendMessage({
        type: 'LIBRARY_INDEX',
        source: editing.source,
        sourceRef: editing.sourceRef,
        title: editing.title,
        content: draft,
      })) as { ok?: boolean; result?: { ok?: boolean; error?: { message?: string } } } | undefined;
      if (r?.result && r.result.ok === false) {
        setError(r.result.error?.message ?? 'Re-index failed (check the API key).');
      } else {
        await refresh();
        setEditing(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingEdit(false);
    }
  }, [editing, draft, refresh]);

  const onImportFolder = useCallback(async () => {
    const w = window as unknown as { showDirectoryPicker?: () => Promise<FsdHandle> };
    if (!w.showDirectoryPicker) {
      setError('File System Access is not available in this browser.');
      return;
    }
    let root: FsdHandle;
    try {
      root = await w.showDirectoryPicker();
    } catch {
      // User cancelled the picker — silent return.
      return;
    }
    setError(undefined);
    setImportStatus('Reading folder…');
    let scanned = 0;
    let indexed = 0;
    let skipped = 0;
    let failed = 0;
    const files: WalkedFile[] = [];
    for await (const f of walkFolder(root)) {
      files.push(f);
      scanned += 1;
      setImportStatus(`Reading folder… ${scanned} file(s) found`);
    }
    if (files.length === 0) {
      setImportStatus('No markdown / text files found in that folder.');
      return;
    }
    // Index each file sequentially via LIBRARY_INDEX. We could parallelise,
    // but Gemini rate limits + UI feedback work better serially here.
    for (const f of files) {
      const ref = `${root.name}/${f.path}`;
      try {
        const r = (await chrome.runtime.sendMessage({
          type: 'LIBRARY_INDEX',
          source: 'folder' as LibrarySource,
          sourceRef: ref,
          title: f.path,
          content: f.content,
        })) as { ok: boolean; result: { ok: boolean; data?: { reindexed: boolean } } } | undefined;
        if (r?.ok && r.result.ok) {
          if (r.result.data?.reindexed) indexed += 1;
          else skipped += 1;
        } else {
          failed += 1;
        }
      } catch {
        failed += 1;
      }
      setImportStatus(`Indexing… ${indexed} indexed · ${skipped} skipped${failed ? ` · ${failed} failed` : ''} (${indexed + skipped + failed}/${files.length})`);
    }
    setImportStatus(`Done — ${indexed} indexed · ${skipped} skipped${failed ? ` · ${failed} failed` : ''} from ${files.length} file(s).`);
    void refresh();
    // Mark the contentHash list as "we tried" — purely for debugging if needed.
    void hashContent(JSON.stringify(files.map((f) => f.path)));
  }, [refresh]);

  return (
    <div className="library-view" data-testid="library-view">
      <div className="library-bar">
        <input
          type="search"
          className="settings-input library-search"
          placeholder="Search your library…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') onSearch(); }}
          aria-label="Search library"
          data-testid="library-search"
        />
        <button type="button" className="btn btn-sm btn-primary" onClick={onSearch} disabled={searching || !query.trim()}>
          {searching ? 'Searching…' : 'Search'}
        </button>
        <button
          type="button"
          className="btn btn-sm"
          onClick={onImportFolder}
          data-testid="library-import-folder"
          title="One-shot: pick a folder, read every .md/.txt inside, index into the library."
        >
          Import folder
        </button>
      </div>
      {importStatus && (
        <div className="library-notice" role="status" data-testid="library-import-status">{importStatus}</div>
      )}
      {error && (
        <div className="library-notice library-notice-err" role="alert">{error}</div>
      )}
      {hits !== undefined && (
        <div className="library-results" data-testid="library-results">
          <div className="library-section-h">{hits.length} result(s)</div>
          {hits.length === 0 ? (
            <div className="empty-state-desc">No matches above the similarity threshold.</div>
          ) : (
            hits.map((h, i) => (
              <div key={i} className="library-hit">
                <div className="library-hit-hd">
                  <span className={'library-source library-source-' + h.source}>{h.source}</span>
                  <span className="library-hit-title">{h.title}</span>
                  <span className="library-hit-score">{h.score.toFixed(2)}</span>
                </div>
                <div className="library-hit-snippet">{h.snippet}</div>
              </div>
            ))
          )}
        </div>
      )}
      {editing && (
        <div className="library-editor" data-testid="library-editor">
          <div className="library-editor-h">
            <span className={'library-source library-source-' + editing.source}>{editing.source}</span>
            <span className="library-doc-title">{editing.title}</span>
            <button type="button" className="library-doc-del" aria-label="Close editor" onClick={() => setEditing(null)}>×</button>
          </div>
          <textarea
            className="settings-input library-editor-area"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            aria-label="Document content"
            rows={12}
          />
          <div className="library-editor-actions">
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => onDelete(editing.id)}>Delete</button>
            <span style={{ flex: 1 }} />
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
            <button type="button" className="btn btn-sm btn-primary" disabled={savingEdit || !draft.trim()} onClick={() => void onSaveEdit()}>
              {savingEdit ? 'Saving…' : 'Save + re-index'}
            </button>
          </div>
        </div>
      )}
      <div className="library-docs" data-testid="library-docs">
        <div className="library-section-h">{docs?.length ?? 0} doc(s) indexed</div>
        {!docs || docs.length === 0 ? (
          <div className="empty-state">
            <span className="ic" style={{ width: 28, height: 28 }}>{Ic.library}</span>
            <div className="empty-state-title">Library is empty</div>
            <div className="empty-state-desc">
              Save a chat / note, run the Backfill in Settings, or import a folder of markdown files.
            </div>
          </div>
        ) : (
          docs.map((d) => (
            <div key={d.id} className="library-doc-row">
              <span className={'library-source library-source-' + d.source}>{d.source}</span>
              <button
                type="button"
                className="library-doc-title library-doc-open"
                title={`View / edit — ${d.sourceRef ?? d.title}`}
                onClick={() => onOpenDoc(d)}
                data-testid={`library-open-${d.id}`}
              >
                {d.title}
              </button>
              <span className="library-doc-meta">{d.chunkCount} chunk(s)</span>
              <button
                type="button"
                className="library-doc-del"
                onClick={() => onDelete(d.id)}
                aria-label={`Delete ${d.title}`}
                title="Remove from library"
              >
                ×
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
