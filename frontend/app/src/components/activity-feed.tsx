"use client";

import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Activity, CheckCircle2, Rocket, ArrowRight } from "lucide-react";
import { formatRelativeTime, type Request } from "@jinn/shared-ui";
import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchWorkstreamActivityAction } from "@/app/actions";

const EXPLORER_BASE_URL = process.env.NEXT_PUBLIC_EXPLORER_URL || "http://localhost:3000";

/**
 * Activity Event Types for the stream
 */
type ActivityEventType = 'started' | 'completed';

interface ActivityEvent {
    id: string;
    type: ActivityEventType;
    jobName: string;
    timestamp: number;
    workstreamId: string;
}

/**
 * Transform requests into activity events
 * Each request can generate both a "started" and "completed" event
 */
function requestsToEvents(requests: Request[]): ActivityEvent[] {
    const events: ActivityEvent[] = [];

    for (const request of requests) {
        const jobName = request.jobName || `Job ${request.id.slice(0, 8)}`;
        const workstreamId = request.workstreamId || request.id;

        // Always add a "started" event
        events.push({
            id: `${request.id}-started`,
            type: 'started',
            jobName,
            timestamp: parseInt(request.blockTimestamp),
            workstreamId,
        });

        // Add "completed" event if delivered
        if (request.delivered) {
            events.push({
                id: `${request.id}-completed`,
                type: 'completed',
                jobName,
                // Assume completion is slightly after start (we don't have exact delivery time)
                timestamp: parseInt(request.blockTimestamp) + 1,
                workstreamId,
            });
        }
    }

    // Sort by timestamp descending (most recent first)
    return events.sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * Get human-friendly action text for event type
 */
function getEventActionText(type: ActivityEventType): string {
    switch (type) {
        case 'started':
            return 'has started';
        case 'completed':
            return 'has completed';
        default:
            return '';
    }
}

interface ActivityFeedProps {
    requests: Request[];
    workstreamId?: string; // Optional context for polling if needed, though we can infer from requests if strictly same stream
}

/**
 * ActivityFeed - An event-based stream showing job lifecycle events
 * Auto-polls for new updates every 5 seconds
 */
export function ActivityFeed({ requests: initialRequests, workstreamId }: ActivityFeedProps) {
    const [requests, setRequests] = useState<Request[]>(initialRequests);

    // Update local state if props change (re-hydration or navigation)
    useEffect(() => {
        setRequests(initialRequests);
    }, [initialRequests]);

    // Polling logic
    useEffect(() => {
        // Only poll if we have a context ID (workstreamId) or can derive one
        // We'll prefer the explicit prop if passed
        const targetId = workstreamId || (requests.length > 0 ? requests[0].workstreamId : null);

        if (!targetId) return;

        const interval = setInterval(async () => {
            try {
                const newRequests = await fetchWorkstreamActivityAction(targetId);
                if (newRequests && newRequests.length > 0) {
                    // Simple dedup/update: just replace if different count or latest ID differs
                    setRequests(prev => {
                        // Only update if data actually changed to avoid re-renders if referentially different but same content
                        if (newRequests.length !== prev.length || newRequests[0]?.id !== prev[0]?.id) {
                            return newRequests;
                        }
                        return prev;
                    });
                }
            } catch (e) {
                console.error("Polling failed", e);
            }
        }, 5000); // Poll every 5 seconds

        return () => clearInterval(interval);
    }, [workstreamId, requests]); // Dependent on requests to find ID if workstreamId shouldn't change dynamically

    const events = requestsToEvents(requests);

    if (events.length === 0) {
        return (
            <div className="h-full flex flex-col gap-4">
                <div className="flex items-center gap-2">
                    <Activity className="h-4 w-4 text-muted-foreground" />
                    <h2 className="text-lg font-semibold">Activity Stream</h2>
                </div>
                <Card className="flex-1 border-0 shadow-none bg-transparent flex items-center justify-center">
                    <p className="text-muted-foreground text-sm">No activity yet</p>
                </Card>
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col gap-4">
            <div className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-lg font-semibold">Activity Stream</h2>
                <span className="text-xs text-muted-foreground ml-auto">{events.length} events</span>
            </div>

            <Card className="flex-1 border-0 shadow-none bg-transparent">
                <ScrollArea className="h-full pr-4">
                    <div className="relative border-l border-border ml-3 pl-6 pb-6 space-y-5">
                        {events.map((event) => (
                            <ActivityEventItem key={event.id} event={event} />
                        ))}
                    </div>
                </ScrollArea>
            </Card>
        </div>
    );
}

/**
 * Individual activity event item with event-specific styling
 */
function ActivityEventItem({ event }: { event: ActivityEvent }) {
    const isCompleted = event.type === 'completed';

    return (
        <div className="relative">
            {/* Timeline Dot */}
            <div
                className={`absolute -left-[30px] top-1.5 h-3 w-3 rounded-full border-2 ring-4 ring-background ${isCompleted
                    ? 'bg-green-500 border-green-400'
                    : 'bg-blue-500 border-blue-400'
                    }`}
            />

            <div className="flex flex-col gap-2 bg-card/50 rounded-lg p-3 border border-border/50">
                {/* Event Header with Icon */}
                <div className="flex items-start gap-2">
                    {isCompleted ? (
                        <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0 mt-0.5" />
                    ) : (
                        <Rocket className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
                    )}

                    <div className="flex-1 min-w-0">
                        {/* Event Message - Natural Language Style */}
                        <p className="text-sm leading-relaxed">
                            <span className="font-semibold">{event.jobName}</span>
                            {' '}
                            <span className={isCompleted ? 'text-green-500' : 'text-blue-500'}>
                                {getEventActionText(event.type)}
                            </span>
                        </p>

                        {/* Timestamp */}
                        <p className="text-xs text-muted-foreground mt-1">
                            {formatRelativeTime(event.timestamp)}
                        </p>
                    </div>
                </div>

                {/* Always-visible link to workstream */}
                <Link
                    href={`${EXPLORER_BASE_URL}/workstreams/${event.workstreamId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors w-fit"
                >
                    View in Workstream
                    <ArrowRight className="h-3 w-3" />
                </Link>
            </div>
        </div>
    );
}
