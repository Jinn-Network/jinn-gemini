"use client";

import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Bot } from "lucide-react";
import { formatRelativeTime } from "@jinn/shared-ui";
import { useEffect, useState } from "react";
import { transformToActivityItems, type ActivityItem } from "@/lib/ventures/activity-utils";
import type { JobDefinition } from "@/lib/subgraph";

interface ActivityFeedProps {
    initialData: { jobDefinitions: JobDefinition[] };
    workstreamId?: string;
    fetchActivity: (workstreamId: string) => Promise<{ jobDefinitions: JobDefinition[] }>;
}

/**
 * ActivityFeed - Chat-like interface showing agent status updates
 */
export function ActivityFeed({ initialData, workstreamId, fetchActivity }: ActivityFeedProps) {
    const [data, setData] = useState(initialData);

    useEffect(() => {
        setData(initialData);
    }, [initialData]);

    useEffect(() => {
        if (!workstreamId) return;

        const interval = setInterval(async () => {
            try {
                const newData = await fetchActivity(workstreamId);
                if (newData.jobDefinitions.length > 0) {
                    setData(prev => {
                        const prevCount = prev.jobDefinitions.length;
                        const newCount = newData.jobDefinitions.length;
                        if (prevCount !== newCount) return newData;

                        const prevLatest = prev.jobDefinitions[0]?.lastInteraction;
                        const newLatest = newData.jobDefinitions[0]?.lastInteraction;
                        if (prevLatest !== newLatest) return newData;

                        return prev;
                    });
                }
            } catch (e) {
                console.error("Polling failed", e);
            }
        }, 5000);

        return () => clearInterval(interval);
    }, [workstreamId, fetchActivity]);

    const messages = transformToActivityItems(data.jobDefinitions);

    if (messages.length === 0) {
        return (
            <div className="h-full flex flex-col">
                <Card className="flex-1 border-0 shadow-none bg-transparent flex items-center justify-center">
                    <p className="text-muted-foreground text-sm">No activity yet</p>
                </Card>
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col">
            <ScrollArea className="flex-1 pr-4">
                <div className="space-y-4 pb-4">
                    {messages.map((msg) => (
                        <ChatMessage key={msg.id} message={msg} />
                    ))}
                </div>
            </ScrollArea>
        </div>
    );
}

function ChatMessage({ message }: { message: ActivityItem }) {
    return (
        <div className="flex gap-3">
            {/* Agent Avatar */}
            <div className="shrink-0">
                <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                    <Bot className="h-4 w-4 text-primary" />
                </div>
            </div>

            {/* Message Content */}
            <div className="flex-1 min-w-0">
                {/* Agent Name & Time */}
                <div className="flex items-baseline gap-2 mb-1">
                    <span className="font-medium text-sm text-foreground">
                        {message.jobName}
                    </span>
                    <span className="text-xs text-muted-foreground">
                        {formatRelativeTime(message.timestamp)}
                    </span>
                </div>

                {/* Chat Bubble */}
                <div className="bg-muted/50 rounded-2xl rounded-tl-sm px-4 py-2.5 inline-block max-w-full">
                    <p className="text-sm text-foreground/90 whitespace-pre-wrap break-words">
                        {message.message}
                    </p>
                </div>
            </div>
        </div>
    );
}
