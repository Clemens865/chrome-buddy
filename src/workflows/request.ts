// UI/content helpers for the SW-owned workflow store.
import type {
  WorkflowSaveMessage,
  WorkflowListMessage,
  WorkflowDeleteMessage,
  WorkflowListResponse,
  BuddyResponse,
} from '../key/messages';
import type { Workflow } from './types';

async function send(message: unknown): Promise<BuddyResponse | undefined> {
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return undefined;
  try {
    return (await chrome.runtime.sendMessage(message)) as BuddyResponse;
  } catch {
    return undefined;
  }
}

export async function persistWorkflow(workflow: Workflow): Promise<void> {
  const msg: WorkflowSaveMessage = { type: 'WORKFLOW_SAVE', workflow };
  await send(msg);
}

export async function fetchWorkflows(): Promise<Workflow[]> {
  const msg: WorkflowListMessage = { type: 'WORKFLOW_LIST' };
  const res = await send(msg);
  return res && res.type === 'WORKFLOW_LIST' ? (res as WorkflowListResponse).workflows : [];
}

export async function removeWorkflow(id: string): Promise<void> {
  const msg: WorkflowDeleteMessage = { type: 'WORKFLOW_DELETE', id };
  await send(msg);
}
