import { CronExpressionParser } from 'cron-parser';
import type { ScheduleEntry } from '@/lib/ventures-services';
import type { Workstream } from '@/lib/subgraph';

/**
 * Format a cron expression into a human-readable description.
 */
export function describeCron(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length < 5) return cron;

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  if (dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    if (minute !== '*' && hour !== '*') {
      return `Daily at ${hour.padStart(2, '0')}:${minute.padStart(2, '0')} UTC`;
    }
    if (hour !== '*') {
      return `Daily at ${hour.padStart(2, '0')}:00 UTC`;
    }
    return 'Every day';
  }

  if (dayOfMonth === '*' && month === '*' && dayOfWeek !== '*') {
    const days: Record<string, string> = {
      '0': 'Sunday', '1': 'Monday', '2': 'Tuesday', '3': 'Wednesday',
      '4': 'Thursday', '5': 'Friday', '6': 'Saturday', '7': 'Sunday',
    };
    const dayName = days[dayOfWeek] || `day ${dayOfWeek}`;
    if (minute !== '*' && hour !== '*') {
      return `${dayName}s at ${hour.padStart(2, '0')}:${minute.padStart(2, '0')} UTC`;
    }
    return `Every ${dayName}`;
  }

  if (dayOfMonth !== '*' && month === '*' && dayOfWeek === '*') {
    const suffix = dayOfMonth === '1' ? 'st' : dayOfMonth === '2' ? 'nd' : dayOfMonth === '3' ? 'rd' : 'th';
    return `Monthly on the ${dayOfMonth}${suffix}`;
  }

  return cron;
}

export type TimelineEntryStatus =
  | 'pending'
  | 'overdue'
  | 'dispatched';

export interface TimelineEntry {
  /** Scheduled tick time */
  time: Date;
  /** Schedule entry label */
  label: string;
  /** Template ID from the schedule entry */
  templateId: string;
  /** Whether this tick is in the past */
  isPast: boolean;
  /** Classification */
  status: TimelineEntryStatus;
  /** Matched workstream (if dispatched) */
  workstream?: Workstream;
}

/**
 * Get forward cron ticks from `from` to `to`.
 */
export function getCronTicks(cron: string, from: Date, to: Date, maxTicks = 200): Date[] {
  try {
    const interval = CronExpressionParser.parse(cron, {
      currentDate: from,
      endDate: to,
    });
    const ticks: Date[] = [];
    while (ticks.length < maxTicks) {
      try {
        const next = interval.next();
        if (next.toDate() > to) break;
        ticks.push(next.toDate());
      } catch {
        break; // StopIteration
      }
    }
    return ticks;
  } catch {
    return [];
  }
}

/**
 * Get backward cron ticks from `to` back to `from`.
 */
export function getPastCronTicks(cron: string, from: Date, to: Date, maxTicks = 200): Date[] {
  try {
    const interval = CronExpressionParser.parse(cron, {
      currentDate: to,
    });
    const ticks: Date[] = [];
    while (ticks.length < maxTicks) {
      try {
        const prev = interval.prev();
        if (prev.toDate() < from) break;
        ticks.push(prev.toDate());
      } catch {
        break;
      }
    }
    return ticks.reverse(); // chronological order
  } catch {
    return [];
  }
}

const MATCH_TOLERANCE_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Build timeline entries for all schedule entries, matching against actual workstreams.
 */
export function buildTimelineEntries(
  schedule: ScheduleEntry[],
  workstreams: Workstream[],
  now: Date,
  hoursBack = 48,
  hoursForward = 48,
): TimelineEntry[] {
  const windowStart = new Date(now.getTime() - hoursBack * 60 * 60 * 1000);
  const windowEnd = new Date(now.getTime() + hoursForward * 60 * 60 * 1000);

  const entries: TimelineEntry[] = [];

  for (const entry of schedule) {
    if (entry.enabled === false) continue;

    // Get all ticks in the window
    const pastTicks = getPastCronTicks(entry.cron, windowStart, now);
    const futureTicks = getCronTicks(entry.cron, now, windowEnd);
    const allTicks = [...pastTicks, ...futureTicks];

    // Filter workstreams matching this template
    const matchingWs = workstreams.filter(ws => ws.templateId === entry.templateId);

    for (const tick of allTicks) {
      const isPast = tick <= now;
      const tickMs = tick.getTime();

      // Try to match a workstream by closest blockTimestamp within tolerance
      let matched: Workstream | undefined;
      let bestDiff = Infinity;

      for (const ws of matchingWs) {
        const wsTime = Number(ws.blockTimestamp) * 1000;
        const diff = Math.abs(wsTime - tickMs);
        if (diff < MATCH_TOLERANCE_MS && diff < bestDiff) {
          bestDiff = diff;
          matched = ws;
        }
      }

      let status: TimelineEntryStatus;
      if (matched) {
        status = 'dispatched';
      } else if (isPast) {
        status = 'overdue';
      } else {
        status = 'pending';
      }

      entries.push({
        time: tick,
        label: entry.label || entry.templateId.slice(0, 8),
        templateId: entry.templateId,
        isPast,
        status,
        workstream: matched,
      });
    }
  }

  // Sort chronologically
  entries.sort((a, b) => a.time.getTime() - b.time.getTime());
  return entries;
}
