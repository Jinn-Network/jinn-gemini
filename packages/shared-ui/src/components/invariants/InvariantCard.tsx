'use client';

import { useState } from 'react';
import { Info, X } from 'lucide-react';
import type { Invariant, LegacyInvariant, InvariantMeasurement, HealthStatus } from '../../lib/invariant-types';
import {
  isFloorInvariant,
  isCeilingInvariant,
  isRangeInvariant,
  isBooleanInvariant,
  isNewInvariant,
} from '../../lib/invariant-types';
import { determineHealthStatus, getInvariantDisplayText } from '../../lib/invariant-utils';
import { cn } from '../../lib/utils';

export interface InvariantCardProps {
  invariant: Invariant | LegacyInvariant;
  measurement?: InvariantMeasurement;
  status?: HealthStatus;
  compact?: boolean;
  className?: string;
  onLearnMore?: (invariant: Invariant | LegacyInvariant) => void;
}

const statusConfig: Record<HealthStatus, { label: string; bg: string; border: string; text: string; icon: string }> = {
  healthy: {
    label: 'Healthy',
    bg: 'bg-green-500/10',
    border: 'border-green-500/50',
    text: 'text-green-600 dark:text-green-400',
    icon: '✓',
  },
  warning: {
    label: 'Warning',
    bg: 'bg-yellow-500/10',
    border: 'border-yellow-500/50',
    text: 'text-yellow-600 dark:text-yellow-400',
    icon: '⚠',
  },
  critical: {
    label: 'Critical',
    bg: 'bg-red-500/10',
    border: 'border-red-500/50',
    text: 'text-red-600 dark:text-red-400',
    icon: '✗',
  },
  unknown: {
    label: 'No measurement',
    bg: 'bg-muted',
    border: 'border-border',
    text: 'text-muted-foreground',
    icon: '—',
  },
};

/**
 * Square InvariantCard - shows status with gauge visualization
 */
export function InvariantCard({
  invariant,
  measurement,
  status,
  compact = false,
  className,
  onLearnMore,
}: InvariantCardProps) {
  const [showModal, setShowModal] = useState(false);
  const resolvedStatus = status ?? determineHealthStatus(invariant, measurement);
  const config = statusConfig[resolvedStatus];
  const numericValue = typeof measurement?.score === 'number' ? measurement.score : null;
  const booleanValue = typeof measurement?.score === 'boolean' ? measurement.score : null;
  const displayText = getInvariantDisplayText(invariant);

  // Determine invariant type
  const isGaugeType = isNewInvariant(invariant) &&
    (isFloorInvariant(invariant) || isCeilingInvariant(invariant) || isRangeInvariant(invariant));
  const isBooleanType = isNewInvariant(invariant) && isBooleanInvariant(invariant);
  const isLegacyType = !isNewInvariant(invariant);

  // Calculate gauge data
  const getGaugeData = () => {
    if (!isNewInvariant(invariant)) return null;

    if (isFloorInvariant(invariant)) {
      const min = invariant.min ?? 0;
      const max = numericValue !== null && numericValue > min * 2 ? numericValue * 1.2 : (min === 0 ? 100 : min * 2);
      const range = max - 0 || 100;
      return {
        type: 'floor' as const,
        thresholdPercent: (min / range) * 100,
        valuePercent: numericValue !== null ? Math.min((numericValue / range) * 100, 100) : null,
        threshold: min,
      };
    }

    if (isCeilingInvariant(invariant)) {
      const max = invariant.max ?? 100;
      const visualMax = numericValue !== null && numericValue > max ? numericValue * 1.2 : max * 1.5;
      const range = visualMax || 100;
      return {
        type: 'ceiling' as const,
        thresholdPercent: (max / range) * 100,
        valuePercent: numericValue !== null ? Math.min((numericValue / range) * 100, 100) : null,
        threshold: max,
      };
    }

    if (isRangeInvariant(invariant)) {
      const min = invariant.min ?? 0;
      const max = invariant.max ?? 100;
      const buffer = (max - min) * 0.3;
      const visualMin = Math.max(0, min - buffer);
      const visualMax = max + buffer;
      const range = visualMax - visualMin || 100;
      return {
        type: 'range' as const,
        minPercent: ((min - visualMin) / range) * 100,
        maxPercent: ((max - visualMin) / range) * 100,
        valuePercent: numericValue !== null ? Math.min(Math.max(((numericValue - visualMin) / range) * 100, 0), 100) : null,
        min,
        max,
      };
    }

    return null;
  };

  const gauge = getGaugeData();

  const renderGauge = () => {
    if (!gauge) return null;

    const needleColor = resolvedStatus === 'healthy' ? 'bg-green-500' :
                        resolvedStatus === 'warning' ? 'bg-yellow-500' :
                        resolvedStatus === 'critical' ? 'bg-red-500' : 'bg-muted-foreground';

    return (
      <div className="w-full px-2">
        <div className="relative h-5 rounded-full bg-muted border border-border overflow-hidden">
          {gauge.type === 'floor' && (
            <div
              className="absolute inset-y-0 bg-green-500/20 border-l-2 border-green-500/50"
              style={{ left: `${gauge.thresholdPercent}%`, right: 0 }}
            />
          )}
          {gauge.type === 'ceiling' && (
            <div
              className="absolute inset-y-0 bg-green-500/20 border-r-2 border-green-500/50"
              style={{ left: 0, right: `${100 - gauge.thresholdPercent}%` }}
            />
          )}
          {gauge.type === 'range' && (
            <div
              className="absolute inset-y-0 bg-green-500/20 border-x-2 border-green-500/50"
              style={{ left: `${gauge.minPercent}%`, right: `${100 - gauge.maxPercent}%` }}
            />
          )}
          {gauge.valuePercent !== null && (
            <div
              className={cn('absolute top-1 bottom-1 w-2 rounded-full transition-all shadow-lg', needleColor)}
              style={{ left: `calc(${gauge.valuePercent}% - 4px)` }}
            />
          )}
        </div>
        <div className="flex justify-between mt-1 text-[9px] text-muted-foreground font-mono">
          {gauge.type === 'floor' && <><span>0</span><span>≥{gauge.threshold}</span></>}
          {gauge.type === 'ceiling' && <><span>≤{gauge.threshold}</span><span></span></>}
          {gauge.type === 'range' && <><span>{gauge.min}</span><span>{gauge.max}</span></>}
        </div>
      </div>
    );
  };

  const handleDetailsClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onLearnMore) {
      onLearnMore(invariant);
    } else {
      setShowModal(true);
    }
  };

  return (
    <>
      <div
        className={cn(
          'aspect-square p-3 rounded-xl border-2 transition-all relative',
          'flex flex-col items-center justify-between text-center',
          config.bg,
          config.border,
          className
        )}
      >
        {/* Status Label */}
        <div className={cn('text-xs font-semibold', config.text)}>
          {config.label}
        </div>

        {/* Gauge or Icon */}
        <div className="flex-1 flex flex-col items-center justify-center w-full gap-1">
          {isGaugeType && gauge ? (
            <>
              {renderGauge()}
              {numericValue !== null && (
                <div className={cn('text-xl font-mono font-bold', config.text)}>
                  {numericValue}
                </div>
              )}
            </>
          ) : isBooleanType ? (
            <>
              <div className={cn('text-4xl font-bold', config.text)}>
                {booleanValue === null ? '—' : booleanValue ? '✓' : '✗'}
              </div>
              {booleanValue !== null && (
                <div className={cn('text-sm font-semibold', config.text)}>
                  {booleanValue ? 'TRUE' : 'FALSE'}
                </div>
              )}
            </>
          ) : isLegacyType ? (
            // Legacy invariant - show status icon and a preview of the text
            <>
              <div className={cn('text-3xl font-bold', config.text)}>
                {config.icon}
              </div>
              <div className="text-[10px] text-muted-foreground line-clamp-2 px-1">
                {displayText}
              </div>
            </>
          ) : (
            <div className={cn('text-4xl font-bold', config.text)}>
              {config.icon}
            </div>
          )}
        </div>

        {/* Bottom row: ID + Details button */}
        <div className="flex items-center justify-between w-full gap-1">
          <code className="text-[9px] text-muted-foreground font-mono truncate flex-1 text-left">
            {invariant.id}
          </code>
          <button
            onClick={handleDetailsClick}
            className="text-[10px] text-primary hover:underline flex items-center gap-0.5 shrink-0"
          >
            <Info className="h-3 w-3" />
            Details
          </button>
        </div>
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setShowModal(false)}>
          <div
            className="bg-card border rounded-xl shadow-xl max-w-lg w-full max-h-[80vh] overflow-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="font-semibold">Invariant Details</h3>
              <button onClick={() => setShowModal(false)} className="text-muted-foreground hover:text-foreground">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <div className="text-xs text-muted-foreground mb-1">ID</div>
                <code className="text-sm font-mono">{invariant.id}</code>
              </div>

              <div>
                <div className="text-xs text-muted-foreground mb-1">Status</div>
                <span className={cn('font-semibold', config.text)}>{config.label}</span>
              </div>

              <div>
                <div className="text-xs text-muted-foreground mb-1">Description</div>
                <p className="text-sm">{displayText}</p>
              </div>

              {measurement && (
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Current Measurement</div>
                  <div className="font-mono font-bold text-lg">
                    {typeof measurement.score === 'boolean'
                      ? (measurement.score ? 'TRUE' : 'FALSE')
                      : measurement.score}
                  </div>
                  {measurement.context && (
                    <p className="text-sm text-muted-foreground mt-1">{measurement.context}</p>
                  )}
                </div>
              )}

              {isNewInvariant(invariant) && (
                <>
                  {invariant.assessment && (
                    <div>
                      <div className="text-xs text-muted-foreground mb-1">Assessment Method</div>
                      <p className="text-sm">{invariant.assessment}</p>
                    </div>
                  )}
                  {isFloorInvariant(invariant) && (
                    <div>
                      <div className="text-xs text-muted-foreground mb-1">Threshold</div>
                      <p className="text-sm font-mono">Must be ≥ {invariant.min}</p>
                    </div>
                  )}
                  {isCeilingInvariant(invariant) && (
                    <div>
                      <div className="text-xs text-muted-foreground mb-1">Threshold</div>
                      <p className="text-sm font-mono">Must be ≤ {invariant.max}</p>
                    </div>
                  )}
                  {isRangeInvariant(invariant) && (
                    <div>
                      <div className="text-xs text-muted-foreground mb-1">Threshold</div>
                      <p className="text-sm font-mono">Must be between {invariant.min} and {invariant.max}</p>
                    </div>
                  )}
                  {isBooleanInvariant(invariant) && (
                    <div>
                      <div className="text-xs text-muted-foreground mb-1">Condition</div>
                      <p className="text-sm font-mono">
                        {invariant.condition === 'must_be_true' ? 'Must be TRUE' : 'Must be FALSE'}
                      </p>
                    </div>
                  )}
                </>
              )}

              {!isNewInvariant(invariant) && (
                <>
                  {(invariant as LegacyInvariant).measurement && (
                    <div>
                      <div className="text-xs text-muted-foreground mb-1">How it's measured</div>
                      <p className="text-sm">{(invariant as LegacyInvariant).measurement}</p>
                    </div>
                  )}
                  {(invariant as LegacyInvariant).description && (
                    <div>
                      <div className="text-xs text-muted-foreground mb-1">Description</div>
                      <p className="text-sm">{(invariant as LegacyInvariant).description}</p>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
