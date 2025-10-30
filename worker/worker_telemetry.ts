/**
 * Worker Telemetry Service
 * 
 * Captures operational telemetry for the worker's execution lifecycle,
 * separate from the agent's execution telemetry. This provides visibility
 * into worker-level operations like claiming requests, recognition phases,
 * artifact creation, and on-chain delivery.
 */

export interface WorkerTelemetryEvent {
  timestamp: string;
  phase: string;
  event: string;
  duration_ms?: number;
  metadata?: Record<string, unknown>;
  error?: string;
}

export interface WorkerTelemetryLog {
  version: string;
  requestId: string;
  jobName?: string;
  startTime: string;
  endTime?: string;
  totalDuration_ms?: number;
  events: WorkerTelemetryEvent[];
  summary: {
    totalEvents: number;
    phases: string[];
    errors: number;
  };
}

export class WorkerTelemetryService {
  private events: WorkerTelemetryEvent[] = [];
  private startTime: number;
  private requestId: string;
  private jobName?: string;
  private currentPhaseStart?: number;

  constructor(requestId: string, jobName?: string) {
    this.requestId = requestId;
    this.jobName = jobName;
    this.startTime = Date.now();
  }

  /**
   * Start tracking a new phase
   */
  startPhase(phase: string, metadata?: Record<string, unknown>): void {
    this.currentPhaseStart = Date.now();
    this.events.push({
      timestamp: new Date().toISOString(),
      phase,
      event: 'phase_start',
      metadata,
    });
  }

  /**
   * End the current phase
   */
  endPhase(phase: string, metadata?: Record<string, unknown>): void {
    const duration = this.currentPhaseStart ? Date.now() - this.currentPhaseStart : undefined;
    this.events.push({
      timestamp: new Date().toISOString(),
      phase,
      event: 'phase_end',
      duration_ms: duration,
      metadata,
    });
    this.currentPhaseStart = undefined;
  }

  /**
   * Log a checkpoint within a phase
   */
  logCheckpoint(phase: string, event: string, metadata?: Record<string, unknown>): void {
    this.events.push({
      timestamp: new Date().toISOString(),
      phase,
      event,
      metadata,
    });
  }

  /**
   * Log an error
   */
  logError(phase: string, error: Error | string, metadata?: Record<string, unknown>): void {
    this.events.push({
      timestamp: new Date().toISOString(),
      phase,
      event: 'error',
      error: typeof error === 'string' ? error : error.message,
      metadata,
    });
  }

  /**
   * Get the complete telemetry log
   */
  getLog(): WorkerTelemetryLog {
    const endTime = Date.now();
    const phases = [...new Set(this.events.map((e) => e.phase))];
    const errors = this.events.filter((e) => e.event === 'error').length;

    return {
      version: 'worker-telemetry-v1',
      requestId: this.requestId,
      jobName: this.jobName,
      startTime: new Date(this.startTime).toISOString(),
      endTime: new Date(endTime).toISOString(),
      totalDuration_ms: endTime - this.startTime,
      events: this.events,
      summary: {
        totalEvents: this.events.length,
        phases,
        errors,
      },
    };
  }

  /**
   * Get a JSON string representation of the log
   */
  toJSON(): string {
    return JSON.stringify(this.getLog(), null, 2);
  }
}

