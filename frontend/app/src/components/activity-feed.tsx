"use client";

import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CheckCircle2, Rocket, Brain, Terminal, AlertCircle, Quote } from "lucide-react";
import { formatRelativeTime, type Request, type Delivery } from "@jinn/shared-ui";
import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchWorkstreamActivityAction } from "@/app/actions";
import { transformToActivityItems, type ActivityItem } from "@/lib/activity-utils";

const EXPLORER_BASE_URL = process.env.NEXT_PUBLIC_EXPLORER_URL || "http://localhost:3000";

interface ActivityFeedProps {
    initialData: { requests: Request[], deliveries: Delivery[] };
    workstreamId?: string;
}

/**
 * ActivityFeed - Uses real data with transformed items
 */
export function ActivityFeed({ initialData, workstreamId }: ActivityFeedProps) {
    const [data, setData] = useState(initialData);

    // Update local state if props change (re-hydration or navigation)
    useEffect(() => {
        setData(initialData);
    }, [initialData]);

    // Polling logic
    useEffect(() => {
        const targetId = workstreamId || (data.requests.length > 0 ? data.requests[0].workstreamId : null);
        if (!targetId) return;

        const interval = setInterval(async () => {
            try {
                const newData = await fetchWorkstreamActivityAction(targetId);
                if (newData.requests.length > 0 || newData.deliveries.length > 0) {
                    setData(prev => {
                        // Simple check if counts changed or latest ID changed
                        const prevReqCount = prev.requests.length;
                        const newReqCount = newData.requests.length;
                        if (prevReqCount !== newReqCount) return newData;

                        const prevDevCount = prev.deliveries.length;
                        const newDevCount = newData.deliveries.length;
                        if (prevDevCount !== newDevCount) return newData;

                        return prev;
                    });
                }
            } catch (e) {
                console.error("Polling failed", e);
            }
        }, 5000);

        return () => clearInterval(interval);
    }, [workstreamId, data]);

    // Transform and enrich events
    const events = transformToActivityItems(data.requests, data.deliveries);

    if (events.length === 0) {
        return (
            <div className="h-full flex flex-col gap-4">
                <div className="flex items-center gap-2">
                    <Terminal className="h-4 w-4 text-muted-foreground" />
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
                <Terminal className="h-4 w-4 text-muted-foreground" />
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

function getEventIcon(type: ActivityItem['type']) {
    switch (type) {
        case 'started': return <Rocket className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />;
        case 'completed': return <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0 mt-0.5" />;
        case 'thinking': return <Brain className="h-4 w-4 text-purple-500 shrink-0 mt-0.5" />;
        case 'action': return <Terminal className="h-4 w-4 text-cyan-500 shrink-0 mt-0.5" />;
        case 'error': return <AlertCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />;
        default: return <Terminal className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />;
    }
}

function getEventColor(type: ActivityItem['type']) {
    switch (type) {
        case 'started': return 'text-blue-500';
        case 'completed': return 'text-green-500';
        case 'thinking': return 'text-purple-500';
        case 'action': return 'text-cyan-500';
        case 'error': return 'text-red-500';
        default: return 'text-foreground';
    }
}

function ActivityEventItem({ event }: { event: ActivityItem }) {
    const isThinking = event.type === 'thinking';
    const isAction = event.type === 'action';
    const isSystem = ['started', 'completed', 'error'].includes(event.type);

    return (
        <div className="relative group pl-2">
            {/* Timeline Line */}
            <div className="absolute left-[7px] top-8 bottom-[-12px] w-px bg-border/50 group-last:hidden" />

            {/* Timeline Dot */}
            <div
                className={`absolute left-[3px] top-2 h-2.5 w-2.5 rounded-full border ring-4 ring-background z-10 
                    ${event.type === 'completed' ? 'bg-green-500 border-green-400' :
                        event.type === 'started' ? 'bg-blue-500 border-blue-400' :
                            event.type === 'thinking' ? 'bg-purple-500 border-purple-400/50' :
                                event.type === 'action' ? 'bg-cyan-500 border-cyan-400/50' :
                                    'bg-muted border-muted-foreground'
                    }`}
            />

            <div className="ml-6 flex flex-col gap-1">
                {/* Header (Job Name + Time) */}
                <div className="flex items-center gap-2 text-xs text-muted-foreground mb-0.5">
                    <span className="font-medium text-foreground/70">{event.jobName}</span>
                    <span>•</span>
                    <span>{formatRelativeTime(event.timestamp)}</span>
                </div>

                {/* Message Bubble / Quote */}
                <div className={`relative rounded-lg p-3 border transition-all
                    ${isSystem ? 'bg-muted/30 border-border/40 text-sm' :
                        'bg-card border-border/60 shadow-sm text-sm'
                    }
                `}>
                    {/* Quote Icon for non-system messages */}
                    {!isSystem && (
                        <Quote className="h-3 w-3 absolute -top-1.5 -left-1.5 text-muted-foreground/40 bg-background rotate-180" />
                    )}

                    <div className="flex items-start gap-3">
                        {isSystem && getEventIcon(event.type)}

                        <p className={`leading-relaxed ${isSystem ? 'text-muted-foreground font-medium' :
                                'text-foreground/90 font-serif italic'
                            }`}>
                            {event.message}
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
