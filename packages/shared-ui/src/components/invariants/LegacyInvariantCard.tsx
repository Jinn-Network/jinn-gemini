'use client';

import type { LegacyInvariant, InvariantMeasurement, HealthStatus } from '../../lib/invariant-types';
import { getHealthStatusColor, getLegacyInvariantText } from '../../lib/invariant-utils';
import { cn } from '../../lib/utils';

export interface LegacyInvariantCardProps {
  invariant: LegacyInvariant;
  measurement?: InvariantMeasurement;
  status?: HealthStatus;
  compact?: boolean;
  className?: string;
}

export function LegacyInvariantCard({
  invariant,
  measurement,
  status = 'unknown',
  compact = false,
  className,
}: LegacyInvariantCardProps) {
  const formatScore = (score: number | boolean | undefined): string => {
    if (score === undefined) return '—';
    if (typeof score === 'boolean') return score ? 'PASS' : 'FAIL';
    return String(score);
  };

  const text = getLegacyInvariantText(invariant);

  if (compact) {
    return (
      <div className={cn('flex items-center justify-between gap-4 py-2', className)}>
        <div className="flex items-center gap-2 min-w-0">
          <code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded shrink-0">
            {invariant.id}
          </code>
          <span className="text-sm truncate">{text}</span>
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
            {status !== 'unknown' && (
              <span className={cn('text-xs px-1.5 py-0.5 rounded border', getHealthStatusColor(status))}>
                {status}
              </span>
            )}
          </div>

          <p className="text-sm mb-2">{text}</p>

          {invariant.measurement && (
            <p className="text-sm text-muted-foreground mb-2">
              <span className="font-medium">Measurement:</span> {invariant.measurement}
            </p>
          )}

          {invariant.description && (
            <p className="text-sm text-muted-foreground mb-2">{invariant.description}</p>
          )}

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

          {invariant.commentary && (
            <p className="text-xs text-muted-foreground mt-2 italic">{invariant.commentary}</p>
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
