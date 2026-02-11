'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Calendar, Clock, Hash, CheckCircle2, Circle, Loader2 } from 'lucide-react';
import type { ScheduleEntry } from '@/lib/ventures-services';
import type { Request } from '@/lib/subgraph';

interface DispatchScheduleTabProps {
  ventureId: string;
  schedule: ScheduleEntry[];
  dispatches?: Record<string, { count: number; latestRequest: Request | null; requests: Request[] }>;
}

/**
 * Format a cron expression into a human-readable description.
 */
function describeCron(cron: string): string {
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

function formatTimeAgo(timestamp: string): string {
  const diff = Date.now() - new Date(timestamp).getTime();
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(hours / 24);

  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours}h ago`;
  if (days < 30) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

/** Group requests by calendar day, returning day label + requests sorted newest first */
function groupByDay(requests: Request[]): { dayLabel: string; runs: Request[] }[] {
  const groups = new Map<string, Request[]>();
  for (const req of requests) {
    const d = new Date(Number(req.blockTimestamp) * 1000);
    const key = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const existing = groups.get(key);
    if (existing) {
      existing.push(req);
    } else {
      groups.set(key, [req]);
    }
  }
  return Array.from(groups.entries()).map(([dayLabel, runs]) => ({ dayLabel, runs }));
}

function formatTime(blockTimestamp: string): string {
  const d = new Date(Number(blockTimestamp) * 1000);
  return d.toLocaleString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

export function DispatchScheduleTab({ ventureId, schedule, dispatches }: DispatchScheduleTabProps) {
  if (!schedule || schedule.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          No dispatch schedule configured
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-2">
        <Calendar className="h-5 w-5 text-muted-foreground" />
        <h3 className="text-lg font-semibold">Dispatch Schedule</h3>
        <Badge variant="outline" className="text-xs">
          {schedule.length} {schedule.length === 1 ? 'entry' : 'entries'}
        </Badge>
      </div>

      <div className="grid gap-4">
        {schedule.map((entry) => (
          <ScheduleEntryCard
            key={entry.id}
            entry={entry}
            ventureId={ventureId}
            dispatchData={dispatches?.[entry.templateId]}
          />
        ))}
      </div>
    </div>
  );
}

function StatusBadge({ delivered }: { delivered: boolean }) {
  if (delivered) {
    return (
      <span className="inline-flex items-center gap-1 text-green-600">
        <CheckCircle2 className="h-3 w-3" />
        <span className="text-[11px]">Delivered</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-yellow-500">
      <Loader2 className="h-3 w-3" />
      <span className="text-[11px]">Pending</span>
    </span>
  );
}

function ScheduleEntryCard({
  entry,
  ventureId,
  dispatchData,
}: {
  entry: ScheduleEntry;
  ventureId: string;
  dispatchData?: { count: number; latestRequest: Request | null; requests: Request[] };
}) {
  const isEnabled = entry.enabled !== false;
  const requests = dispatchData?.requests ?? [];
  const deliveredCount = requests.filter(r => r.delivered).length;
  const pendingCount = requests.length - deliveredCount;
  const dayGroups = groupByDay(requests);

  return (
    <Card className={!isEnabled ? 'opacity-60' : undefined}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <CardTitle className="text-base">
              {entry.label || entry.templateId}
            </CardTitle>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="h-3.5 w-3.5" />
              <span>{describeCron(entry.cron)}</span>
            </div>
          </div>
          <Badge
            variant={isEnabled ? 'default' : 'secondary'}
            className="text-xs"
          >
            {isEnabled ? 'Active' : 'Paused'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        {/* Template ID + cron */}
        <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
          <div className="flex items-center gap-1">
            <Hash className="h-3 w-3" />
            <span className="font-mono">{entry.templateId.slice(0, 8)}...</span>
          </div>
          {entry.cron && (
            <div className="flex items-center gap-1">
              <span className="font-mono text-[10px] bg-muted px-1.5 py-0.5 rounded">
                {entry.cron}
              </span>
            </div>
          )}
        </div>

        {/* Dispatch summary */}
        {dispatchData && dispatchData.count > 0 && (
          <div className="text-xs text-muted-foreground border-t pt-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-foreground">
                {dispatchData.count} dispatch{dispatchData.count !== 1 ? 'es' : ''}
              </span>
              <span className="text-muted-foreground">(last 30d)</span>
              {dispatchData.latestRequest && (
                <>
                  <span>·</span>
                  <span>
                    Latest {formatTimeAgo(
                      new Date(Number(dispatchData.latestRequest.blockTimestamp) * 1000).toISOString()
                    )}
                  </span>
                </>
              )}
              {deliveredCount > 0 && (
                <>
                  <span>·</span>
                  <span className="text-green-600">{deliveredCount} delivered</span>
                </>
              )}
              {pendingCount > 0 && (
                <>
                  <span>·</span>
                  <span className="text-yellow-500">{pendingCount} pending</span>
                </>
              )}
            </div>
          </div>
        )}

        {/* Runs grouped by day */}
        {dayGroups.length > 0 && (
          <div className="border-t pt-3">
            <div className="text-xs font-medium text-muted-foreground mb-2">Recent Runs</div>
            <div className="space-y-2">
              {dayGroups.slice(0, 5).map(({ dayLabel, runs }) => (
                <div key={dayLabel}>
                  <div className="text-[11px] font-medium text-muted-foreground mb-1">{dayLabel}</div>
                  <div className="space-y-0.5 pl-3 border-l-2 border-muted">
                    {runs.map((req) => (
                      <div
                        key={req.id}
                        className="flex items-center gap-3 text-xs py-0.5"
                      >
                        <span className="font-mono text-muted-foreground w-[48px] shrink-0">
                          {formatTime(req.blockTimestamp)}
                        </span>
                        <StatusBadge delivered={req.delivered} />
                        <span className="font-mono text-muted-foreground/60 text-[11px]">
                          {req.id.slice(0, 6)}...{req.id.slice(-4)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Empty state */}
        {dispatchData && dispatchData.count === 0 && (
          <div className="text-xs text-muted-foreground border-t pt-3 italic">
            No dispatches in the last 30 days
          </div>
        )}
      </CardContent>
    </Card>
  );
}
