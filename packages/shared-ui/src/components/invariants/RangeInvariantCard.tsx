'use client';

import type { RangeInvariant, InvariantMeasurement, HealthStatus } from '../../lib/invariant-types';
import { getHealthStatusColor, invariantTypeBadgeColors } from '../../lib/invariant-utils';
import { cn } from '../../lib/utils';

export interface RangeInvariantCardProps {
  invariant: RangeInvariant;
  measurement?: InvariantMeasurement;
  status?: HealthStatus;
  compact?: boolean;
  className?: string;
}

export function RangeInvariantCard({
  invariant,
  measurement,
  status = 'unknown',
  compact = false,
  className,
}: RangeInvariantCardProps) {
  const formatScore = (score: number | boolean | undefined): string => {
    if (score === undefined) return '—';
    if (typeof score === 'boolean') return score ? 'PASS' : 'FAIL';
    return String(score);
  };

  if (compact) {
    return (
      <div className={cn('flex items-center justify-between gap-4 py-2', className)}>
        <div className="flex items-center gap-2 min-w-0">
          <code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded shrink-0">
            {invariant.id}
          </code>
          <span className={cn('text-xs px-1.5 py-0.5 rounded border', invariantTypeBadgeColors.RANGE)}>
            RANGE
          </span>
          <span className="text-sm truncate">{invariant.min} ≤ {invariant.metric} ≤ {invariant.max}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={cn('text-xs px-1.5 py-0.5 rounded border', getHealthStatusColor(status))}>
            {status}
          </span>
          <span className="text-lg font-semibold">{formatScore(measurement?.score)}</span>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('p-4 rounded-lg border bg-card', className)}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">
              {invariant.id}
            </code>
            <span className={cn('text-xs px-1.5 py-0.5 rounded border', invariantTypeBadgeColors.RANGE)}>
              RANGE
            </span>
            {status !== 'unknown' && (
              <span className={cn('text-xs px-1.5 py-0.5 rounded border', getHealthStatusColor(status))}>
                {status}
              </span>
            )}
          </div>

          <div className="mb-2">
            <span className="text-sm font-medium">{invariant.metric}</span>
            <span className="text-muted-foreground"> must be between </span>
            <span className="text-sm font-semibold text-blue-500">{invariant.min}</span>
            <span className="text-muted-foreground"> and </span>
            <span className="text-sm font-semibold text-blue-500">{invariant.max}</span>
          </div>

          <p className="text-sm text-muted-foreground">{invariant.assessment}</p>

          {invariant.examples && (
            <div className="mt-3 text-xs space-y-1">
              {invariant.examples.do && invariant.examples.do.length > 0 && (
                <div>
                  <span className="text-green-500 font-medium">Do:</span>{' '}
                  <span className="text-muted-foreground">{invariant.examples.do.join('; ')}</span>
                </div>
              )}
              {invariant.examples.dont && invariant.examples.dont.length > 0 && (
                <div>
                  <span className="text-red-500 font-medium">Don't:</span>{' '}
                  <span className="text-muted-foreground">{invariant.examples.dont.join('; ')}</span>
                </div>
              )}
            </div>
          )}
        </div>

        {measurement && (
          <div className="text-right shrink-0">
            <div className="text-2xl font-semibold">{formatScore(measurement.score)}</div>
            {measurement.context && (
              <div className="text-xs text-muted-foreground mt-1 max-w-[150px] truncate">
                {measurement.context}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
