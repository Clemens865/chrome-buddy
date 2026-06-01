// LibraryView — the rail surface for the local RAG library.
//
// Jobs:
//   1. Collections bar — filter docs by collection + pick the target for adds,
//      create / delete collections.
//   2. Ingest — add files (multi-format), capture the active page, or import a
//      folder — all into the selected collection with an optional note.
//   3. Search via the same search_library tool the agent uses.
//   4. List / view / edit / delete docs.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Ic } from '../ui/icons';
import { walkFolder, type FsdHandle, type WalkedFile } from '../library/walk';
import type { LibrarySource } from '../library';
import { listDocs, deleteDoc } from '../library/store';
import type { LibraryDoc } from '../library/store';
import { parseFile, isSupportedTextFile, baseName } from '../library/parseFile';
import { extractPdfText, isPdfFile } from '../library/pdf';
import type { LibraryCollectionRecord } from '../key/messages';

interface SearchHit {
  docId: string;
  title: string;
  source: LibrarySource;
  sourceRef?: string;
  chunkIdx: number;
  score: number;
  snippet: string;
}

type NewCol = { name: string; description: string; kind: 'project' | 'general' | 'profile'; autoContext: 'always' | 'active' | 'manual' };
const EMPTY_NEW_COL: NewCol = { name: '', description: '', kind: 'project', autoContext: 'active' };

export function LibraryView() {
  const [docs, setDocs] = useState<LibraryDoc[] | undefined>();
  const [collections, setCollections] = useState<LibraryCollectionRecord[]>([]);
  const [selectedCol, setSelectedCol] = useState<string>('all');
  const [note, setNote] = useState('');
  const [creating, setCreating] = useState(false);
  const [newCol, setNewCol] = useState<NewCol>(EMPTY_NEW_COL);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[] | undefined>();
  const [searching, setSearching] = useState(false);
  const [importStatus, setImportStatus] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [editing, setEditing] = useState<LibraryDoc | null>(null);
  const [draft, setDraft] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /** The collection adds go into ('all' view → General). */
  const targetCol = selectedCol === 'all' ? 'general' : selectedCol;
  const targetColName =
    collections.find((c) => c.id === targetCol)?.name ?? 'General';

  const refresh = useCallback(async () => {
    setDocs(await listDocs());
  }, []);

  const loadCollections = useCallback(async () => {
    try {
      const r = (await chrome.runtime.sendMessage({ type: 'LIBRARY_COLLECTIONS' })) as
        | { ok: boolean; collections: LibraryCollectionRecord[] }
        | undefined;
      if (r?.ok) setCollections(r.collections);
    } catch {
      /* ignore — collections bar just stays empty */
    }
  }, []);

  useEffect(() => {
    void refresh();
    void loadCollections();
  }, [refresh, loadCollections]);

  const onSearch = useCallback(async () => {
    if (!query.trim()) { setHits(undefined); return; }
    setSearching(true);
    setError(undefined);
    try {
      const r = (await chrome.runtime.sendMessage({
        type: 'TOOL_EXEC',
        tool: 'search_library',
        args: {
          query: query.trim(), k: 8,
          ...(selectedCol !== 'all' ? { collectionIds: [selectedCol] } : {}),
        },
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
  }, [query, selectedCol]);

  const onDelete = useCallback(async (id: string) => {
    await deleteDoc(id);
    await refresh();
    await loadCollections();
    setEditing((cur) => (cur?.id === id ? null : cur));
    setHits((prev) => prev?.filter((h) => h.docId !== id));
  }, [refresh, loadCollections]);

  const onOpenDoc = useCallback((d: LibraryDoc) => {
    setEditing(d);
    setDraft(d.content);
    setError(undefined);
  }, []);

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
        collectionId: editing.collectionId,
        note: editing.note,
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

  // --- Ingest: files ---------------------------------------------------------
  const onFilesPicked = useCallback(async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setError(undefined);
    const files = Array.from(fileList);
    let indexed = 0, skipped = 0, failed = 0;
    for (const file of files) {
      setImportStatus(`Adding ${file.name}…`);
      try {
        let title: string;
        let text: string;
        if (isPdfFile(file.name)) {
          // PDFs are parsed panel-side (pdfjs worker) → plain text.
          const ex = await extractPdfText(await file.arrayBuffer());
          title = baseName(file.name);
          text = ex.text;
        } else if (isSupportedTextFile(file.name)) {
          ({ title, text } = parseFile(file.name, await file.text()));
        } else {
          skipped += 1;
          continue;
        }
        if (!text.trim()) { skipped += 1; continue; }
        const r = (await chrome.runtime.sendMessage({
          type: 'LIBRARY_INDEX',
          source: 'file' as LibrarySource,
          sourceRef: file.name,
          title,
          content: text,
          collectionId: targetCol,
          note: note.trim() || undefined,
        })) as { ok: boolean; result: { ok: boolean } } | undefined;
        if (r?.ok && r.result.ok) indexed += 1; else failed += 1;
      } catch { failed += 1; }
    }
    setImportStatus(`Added ${indexed} file(s) to ${targetColName}${skipped ? ` · ${skipped} skipped` : ''}${failed ? ` · ${failed} failed` : ''}.`);
    setNote('');
    await refresh();
    await loadCollections();
  }, [targetCol, targetColName, note, refresh, loadCollections]);

  // --- Ingest: the active page ----------------------------------------------
  const onAddPage = useCallback(async () => {
    setError(undefined);
    setImportStatus('Reading the current page…');
    try {
      const r = (await chrome.runtime.sendMessage({
        type: 'LIBRARY_CAPTURE_PAGE',
        collectionId: targetCol,
        note: note.trim() || undefined,
      })) as { ok: boolean; title?: string; error?: string } | undefined;
      if (r?.ok) {
        setImportStatus(`Added “${r.title}” to ${targetColName}.`);
        setNote('');
        await refresh();
        await loadCollections();
      } else {
        setError(r?.error ?? 'Could not read the current page.');
        setImportStatus(undefined);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setImportStatus(undefined);
    }
  }, [targetCol, targetColName, note, refresh, loadCollections]);

  // --- Collections: create / delete -----------------------------------------
  const onCreateCollection = useCallback(async () => {
    const r = (await chrome.runtime.sendMessage({
      type: 'LIBRARY_COLLECTION_SAVE',
      collection: { name: newCol.name, description: newCol.description, kind: newCol.kind, autoContext: newCol.autoContext },
    })) as { ok: boolean; collection?: LibraryCollectionRecord; error?: string } | undefined;
    if (r?.ok && r.collection) {
      setCreating(false);
      setNewCol(EMPTY_NEW_COL);
      await loadCollections();
      setSelectedCol(r.collection.id);
    } else {
      setError(r?.error ?? 'Could not create the collection.');
    }
  }, [newCol, loadCollections]);

  const onDeleteCollection = useCallback(async (id: string) => {
    const r = (await chrome.runtime.sendMessage({
      type: 'LIBRARY_COLLECTION_DELETE', id, reassignTo: 'general',
    })) as { ok: boolean; error?: string } | undefined;
    if (r?.ok) {
      if (selectedCol === id) setSelectedCol('all');
      await loadCollections();
      await refresh();
    } else {
      setError(r?.error ?? 'Could not delete the collection.');
    }
  }, [selectedCol, loadCollections, refresh]);

  const onImportFolder = useCallback(async () => {
    const w = window as unknown as { showDirectoryPicker?: () => Promise<FsdHandle> };
    if (!w.showDirectoryPicker) { setError('File System Access is not available in this browser.'); return; }
    let root: FsdHandle;
    try { root = await w.showDirectoryPicker(); } catch { return; }
    setError(undefined);
    setImportStatus('Reading folder…');
    const files: WalkedFile[] = [];
    for await (const f of walkFolder(root)) {
      files.push(f);
      setImportStatus(`Reading folder… ${files.length} file(s) found`);
    }
    if (files.length === 0) { setImportStatus('No markdown / text files found in that folder.'); return; }
    let indexed = 0, skipped = 0, failed = 0;
    for (const f of files) {
      try {
        const r = (await chrome.runtime.sendMessage({
          type: 'LIBRARY_INDEX',
          source: 'folder' as LibrarySource,
          sourceRef: `${root.name}/${f.path}`,
          title: f.path,
          content: f.content,
          collectionId: targetCol,
          note: note.trim() || undefined,
        })) as { ok: boolean; result: { ok: boolean; data?: { reindexed: boolean } } } | undefined;
        if (r?.ok && r.result.ok) { if (r.result.data?.reindexed) indexed += 1; else skipped += 1; } else failed += 1;
      } catch { failed += 1; }
      setImportStatus(`Indexing… ${indexed} indexed · ${skipped} skipped${failed ? ` · ${failed} failed` : ''} (${indexed + skipped + failed}/${files.length})`);
    }
    setImportStatus(`Done — ${indexed} indexed · ${skipped} skipped${failed ? ` · ${failed} failed` : ''} into ${targetColName}.`);
    setNote('');
    void refresh();
    void loadCollections();
  }, [targetCol, targetColName, note, refresh, loadCollections]);

  const visibleDocs = selectedCol === 'all' ? docs : docs?.filter((d) => d.collectionId === selectedCol);
  const selectedColRec = collections.find((c) => c.id === selectedCol);
  const canDeleteSelected = selectedColRec && selectedColRec.kind !== 'general' && selectedColRec.id !== 'personal-profile';

  return (
    <div className="library-view" data-testid="library-view">
      {/* Collections bar */}
      <div className="library-cols" data-testid="library-collections">
        <button type="button" className={'library-col-pill' + (selectedCol === 'all' ? ' is-active' : '')} onClick={() => setSelectedCol('all')}>
          All<span className="library-col-count">{docs?.length ?? 0}</span>
        </button>
        {collections.map((c) => (
          <button
            key={c.id}
            type="button"
            className={'library-col-pill' + (selectedCol === c.id ? ' is-active' : '')}
            onClick={() => setSelectedCol(c.id)}
            title={c.description}
            data-testid={`library-col-${c.id}`}
          >
            {c.autoContext === 'always' && <span className="library-col-dot" title="Always in context" />}
            {c.name}<span className="library-col-count">{c.docCount ?? 0}</span>
          </button>
        ))}
        <button type="button" className="library-col-pill library-col-new" onClick={() => setCreating((v) => !v)} data-testid="library-col-new">
          + New
        </button>
      </div>

      {creating && (
        <div className="library-newcol" data-testid="library-newcol-form">
          <input className="settings-input" placeholder="Collection name (e.g. Acme Project)" value={newCol.name}
            onChange={(e) => setNewCol({ ...newCol, name: e.target.value })} data-testid="library-newcol-name" />
          <input className="settings-input" placeholder="What's in it? (shown to the model so it knows when to search)" value={newCol.description}
            onChange={(e) => setNewCol({ ...newCol, description: e.target.value })} />
          <div className="library-newcol-row">
            <select className="settings-input" value={newCol.kind} onChange={(e) => setNewCol({ ...newCol, kind: e.target.value as NewCol['kind'] })}>
              <option value="project">Project</option>
              <option value="profile">Profile</option>
              <option value="general">General</option>
            </select>
            <select className="settings-input" value={newCol.autoContext} onChange={(e) => setNewCol({ ...newCol, autoContext: e.target.value as NewCol['autoContext'] })}
              title="When should the chat auto-pull from this collection?">
              <option value="active">Auto when active</option>
              <option value="always">Always in context</option>
              <option value="manual">Manual / model-only</option>
            </select>
            <span style={{ flex: 1 }} />
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => { setCreating(false); setNewCol(EMPTY_NEW_COL); }}>Cancel</button>
            <button type="button" className="btn btn-sm btn-primary" disabled={newCol.name.trim().length < 2} onClick={() => void onCreateCollection()} data-testid="library-newcol-create">
              Create
            </button>
          </div>
        </div>
      )}

      {/* Ingest row */}
      <div className="library-ingest">
        <input className="settings-input library-note" placeholder={`Note for adds → ${targetColName} (e.g. "is a competitor")`} value={note}
          onChange={(e) => setNote(e.target.value)} aria-label="Note for the next add" data-testid="library-note" />
        <button type="button" className="btn btn-sm" onClick={() => fileInputRef.current?.click()} data-testid="library-add-files" title="Add files (PDF, .md, .txt, .csv, .json, .html, code…)">
          + Files
        </button>
        <button type="button" className="btn btn-sm" onClick={() => void onAddPage()} data-testid="library-add-page" title="Distill the current tab and add it to this collection">
          + This page
        </button>
        <button type="button" className="btn btn-sm" onClick={onImportFolder} data-testid="library-import-folder" title="Pick a folder; index every .md/.txt inside.">
          + Folder
        </button>
        {canDeleteSelected && (
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => void onDeleteCollection(selectedCol)} title="Delete this collection (docs move to General)">
            Delete collection
          </button>
        )}
        <input ref={fileInputRef} type="file" multiple hidden
          accept=".pdf,.md,.markdown,.mdx,.txt,.text,.rst,.csv,.tsv,.json,.yaml,.yml,.toml,.html,.htm,.xml,.js,.ts,.jsx,.tsx,.py,.go,.rs,.java,.rb,.c,.h,.cpp,.cs,.php,.sh,.sql,.css"
          onChange={(e) => { void onFilesPicked(e.target.files); e.target.value = ''; }} data-testid="library-file-input" />
      </div>

      <div className="library-bar">
        <input type="search" className="settings-input library-search" placeholder="Search your library…" value={query}
          onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') onSearch(); }}
          aria-label="Search library" data-testid="library-search" />
        <button type="button" className="btn btn-sm btn-primary" onClick={onSearch} disabled={searching || !query.trim()}>
          {searching ? 'Searching…' : 'Search'}
        </button>
      </div>

      {importStatus && <div className="library-notice" role="status" data-testid="library-import-status">{importStatus}</div>}
      {error && <div className="library-notice library-notice-err" role="alert">{error}</div>}

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
          <textarea className="settings-input library-editor-area" value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Document content" rows={12} />
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
        <div className="library-section-h">{visibleDocs?.length ?? 0} doc(s){selectedCol !== 'all' ? ` in ${targetColName}` : ' indexed'}</div>
        {!visibleDocs || visibleDocs.length === 0 ? (
          <div className="empty-state">
            <span className="ic" style={{ width: 28, height: 28 }}>{Ic.library}</span>
            <div className="empty-state-title">{selectedCol === 'all' ? 'Library is empty' : 'Nothing here yet'}</div>
            <div className="empty-state-desc">
              Add files, capture the current page, or import a folder into this collection — or right-click any page → “Add page to Library”.
            </div>
          </div>
        ) : (
          visibleDocs.map((d) => (
            <div key={d.id} className="library-doc-row">
              <span className={'library-source library-source-' + d.source}>{d.source}</span>
              <button type="button" className="library-doc-title library-doc-open" title={`View / edit — ${d.sourceRef ?? d.title}`} onClick={() => onOpenDoc(d)} data-testid={`library-open-${d.id}`}>
                {d.title}
              </button>
              {d.note && <span className="library-doc-note" title={d.note}>{d.note}</span>}
              <span className="library-doc-meta">{d.chunkCount} chunk(s)</span>
              <button type="button" className="library-doc-del" onClick={() => onDelete(d.id)} aria-label={`Delete ${d.title}`} title="Remove from library">×</button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
