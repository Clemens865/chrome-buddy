// UI/content helpers for the SW-owned skill store (shared across panel + overlay).
import type {
  SkillSaveMessage,
  SkillListMessage,
  SkillDeleteMessage,
  SkillListResponse,
  BuddyResponse,
} from '../key/messages';
import type { Skill } from './types';

async function send(message: unknown): Promise<BuddyResponse | undefined> {
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return undefined;
  try {
    return (await chrome.runtime.sendMessage(message)) as BuddyResponse;
  } catch {
    return undefined;
  }
}

export async function persistSkill(skill: Skill): Promise<void> {
  const msg: SkillSaveMessage = { type: 'SKILL_SAVE', skill };
  await send(msg);
}

export async function fetchSkills(): Promise<Skill[]> {
  const msg: SkillListMessage = { type: 'SKILL_LIST' };
  const res = await send(msg);
  return res && res.type === 'SKILL_LIST' ? (res as SkillListResponse).skills : [];
}

export async function removeSkill(id: string): Promise<void> {
  const msg: SkillDeleteMessage = { type: 'SKILL_DELETE', id };
  await send(msg);
}
