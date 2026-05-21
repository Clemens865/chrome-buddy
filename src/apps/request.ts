// UI helpers for the SW-owned Tier-1 app store.
import type {
  AppSaveMessage,
  AppListMessage,
  AppDeleteMessage,
  AppListResponse,
  BuddyResponse,
} from '../key/messages';
import type { AppConfig } from './types';

async function send(message: unknown): Promise<BuddyResponse | undefined> {
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return undefined;
  try {
    return (await chrome.runtime.sendMessage(message)) as BuddyResponse;
  } catch {
    return undefined;
  }
}

export async function persistApp(app: AppConfig): Promise<void> {
  const msg: AppSaveMessage = { type: 'APP_SAVE', app };
  await send(msg);
}

export async function fetchApps(): Promise<AppConfig[]> {
  const msg: AppListMessage = { type: 'APP_LIST' };
  const res = await send(msg);
  return res && res.type === 'APP_LIST' ? (res as AppListResponse).apps : [];
}

export async function removeApp(id: string): Promise<void> {
  const msg: AppDeleteMessage = { type: 'APP_DELETE', id };
  await send(msg);
}
