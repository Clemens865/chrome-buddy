// UI/content helpers for run history — routed to the SW-owned store via messages
// so the side panel and overlay share one history.
import type {
  MemorySaveRunMessage,
  MemoryListRunsMessage,
  MemoryClearMessage,
  MemoryListRunsResponse,
  BuddyResponse,
} from '../key/messages';
import type { RunRecord } from './types';

async function send(message: unknown): Promise<BuddyResponse | undefined> {
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return undefined;
  try {
    return (await chrome.runtime.sendMessage(message)) as BuddyResponse;
  } catch {
    return undefined;
  }
}

export async function persistRun(run: RunRecord): Promise<void> {
  const msg: MemorySaveRunMessage = { type: 'MEMORY_SAVE_RUN', run };
  await send(msg);
}

export async function fetchRuns(limit = 100): Promise<RunRecord[]> {
  const msg: MemoryListRunsMessage = { type: 'MEMORY_LIST_RUNS', limit };
  const res = await send(msg);
  return res && res.type === 'MEMORY_LIST_RUNS' ? (res as MemoryListRunsResponse).runs : [];
}

export async function clearHistory(): Promise<void> {
  const msg: MemoryClearMessage = { type: 'MEMORY_CLEAR' };
  await send(msg);
}
