// Pure helpers for mapping scheduled workflows to chrome.alarms. Kept free of
// chrome.* so they're unit-testable; the background SW applies the result.
import type { Workflow } from './types';

/** Storage key holding the list of workflow ids that are currently "due". */
export const DUE_WORKFLOWS_KEY = 'dueWorkflows';

const ALARM_PREFIX = 'wf:';

/** Alarm name for a workflow id (namespaced so we don't clobber other alarms). */
export function alarmName(workflowId: string): string {
  return `${ALARM_PREFIX}${workflowId}`;
}

/** Workflow id from an alarm name, or null if it isn't one of ours. */
export function workflowIdFromAlarm(name: string): string | null {
  return name.startsWith(ALARM_PREFIX) ? name.slice(ALARM_PREFIX.length) : null;
}

export interface AlarmSpec {
  name: string;
  periodInMinutes: number;
}

/** Alarm specs for every scheduled workflow (manual ones produce nothing). */
export function alarmSpecsFor(workflows: Workflow[]): AlarmSpec[] {
  const specs: AlarmSpec[] = [];
  for (const wf of workflows) {
    if (wf.trigger.type === 'schedule' && wf.trigger.everyMinutes > 0) {
      specs.push({ name: alarmName(wf.id), periodInMinutes: wf.trigger.everyMinutes });
    }
  }
  return specs;
}
