// usePersistedState — small hook backed by chrome.storage.local, with an
// in-memory fallback when the chrome API isn't available (e.g. vite preview).
import { useEffect, useRef, useState } from 'react';

type StorageArea = { get(keys: string): Promise<Record<string, unknown>>; set(items: Record<string, unknown>): Promise<void> };

function area(): StorageArea | null {
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    return chrome.storage.local as unknown as StorageArea;
  }
  return null;
}

export function usePersistedState<T>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(initial);
  const hydrated = useRef(false);

  // Load once on mount.
  useEffect(() => {
    const a = area();
    if (!a) {
      hydrated.current = true;
      return;
    }
    a.get(key)
      .then((res) => {
        const stored = res[key];
        if (stored !== undefined) setValue(stored as T);
      })
      .finally(() => {
        hydrated.current = true;
      });
  }, [key]);

  // Persist after hydration so we don't immediately overwrite stored values.
  useEffect(() => {
    if (!hydrated.current) return;
    area()?.set({ [key]: value }).catch(() => {});
  }, [key, value]);

  // Keep every instance of the same key in sync (e.g. the model picker in
  // Settings and the chat header live in different components).
  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return;
    const onChanged = (changes: Record<string, { newValue?: unknown }>, areaName: string) => {
      if (areaName !== 'local' || !(key in changes)) return;
      const next = changes[key].newValue;
      if (next !== undefined) setValue(next as T);
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, [key]);

  return [value, setValue];
}
