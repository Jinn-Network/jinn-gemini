"use client";

import { useEffect, useState } from "react";
import { type ActivityItem, transformToActivityItems } from "@/lib/activity-utils";
import { Terminal, Brain, Rocket, CheckCircle2, AlertCircle, Sparkles } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Badge } from "./ui/badge";

export function GlobalActivityFeed() {
    const [activities, setActivities] = useState<ActivityItem[]>([]);

    useEffect(() => {
        let isMounted = true;

        async function fetchData() {
            try {
                const response = await fetch("/api/global-activity", {
                    cache: "no-store",
                });

                if (!response.ok) {
                    return;
                }

                const data = await response.json();
                const items = await transformToActivityItems(data.requests, data.deliveries);
                if (isMounted) {
                    setActivities(items);
                }
            } catch (error) {
                console.error("Failed to fetch global activity:", error);
            }
        }

        fetchData();
        const interval = setInterval(fetchData, 4000); // Poll every 4 seconds

        return () => {
            isMounted = false;
            clearInterval(interval);
        };
    }, []);

    return (
        <div className="w-full max-w-5xl mx-auto space-y-6">
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                    <div className="relative">
                        <div className="absolute inset-0 bg-green-500/20 rounded-full animate-ping" />
                        <div className="relative h-2.5 w-2.5 bg-green-500 rounded-full" />
                    </div>
                    <h2 className="text-xl font-mono font-bold tracking-tight bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
                        LIVE AGENT STREAM
                    </h2>
                </div>
                <div className="text-xs font-mono text-muted-foreground">
                    Connected to Jinn Network
                </div>
            </div>

            <div className="relative rounded-xl border border-border/50 bg-black/50 backdrop-blur-xl shadow-2xl overflow-hidden min-h-[500px]">
                {/* Glow Effects */}
                <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-cyan-500/50 to-transparent" />
                <div className="absolute bottom-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-purple-500/50 to-transparent" />
                <div className="absolute top-0 right-0 h-full w-px bg-gradient-to-b from-transparent via-cyan-500/20 to-transparent" />
                <div className="absolute top-0 left-0 h-full w-px bg-gradient-to-b from-transparent via-purple-500/20 to-transparent" />

                {/* Header Row */}
                <div className="grid grid-cols-12 gap-4 p-4 border-b border-white/5 text-xs font-mono text-muted-foreground uppercase tracking-wider bg-black/20">
                    <div className="col-span-2">Timestamp</div>
                    <div className="col-span-2">Venture</div>
                    <div className="col-span-2">Job</div>
                    <div className="col-span-6">Activity</div>
                </div>

                {/* Stream Content */}
                <div className="p-4 space-y-2 font-mono text-sm relative">

                    {/* Scanline Effect */}
                    <div className="absolute inset-0 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.1)_50%),linear-gradient(90deg,rgba(255,0,0,0.03),rgba(0,255,0,0.01),rgba(0,0,255,0.03))] z-10 pointer-events-none bg-[length:100%_4px,3px_100%] opacity-20" />

                    <AnimatePresence initial={false} mode="popLayout">
                        {activities.map((item) => (
                            <ActivityRow key={item.id} item={item} />
                        ))}
                    </AnimatePresence>

                    {/* Empty State / Loading */}
                    {activities.length === 0 && (
                        <div className="py-20 text-center text-muted-foreground animate-pulse">
                            Initializing neural link...
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

function ActivityRow({ item }: { item: ActivityItem }) {
    return (
        <motion.div
            layout
            initial={{ opacity: 0, x: -20, filter: "blur(10px)" }}
            animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="grid grid-cols-12 gap-4 items-center p-3 rounded-lg border border-transparent hover:border-white/10 hover:bg-white/5 transition-colors group"
        >
            {/* Timestamp */}
            <div className="col-span-2 text-xs text-muted-foreground font-mono">
                {new Date(item.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </div>

            {/* Venture Name */}
            <div className="col-span-2">
                <a
                    href={item.explorerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block"
                    onClick={(e) => e.stopPropagation()}
                >
                    <Badge variant="secondary" className="bg-white/5 hover:bg-white/10 text-[10px] font-normal border-white/10 text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
                        {item.ventureName}
                    </Badge>
                </a>
            </div>

            {/* Job Name */}
            <a
                href={item.explorerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="col-span-2 text-xs text-cyan-400 truncate opacity-80 hover:opacity-100 hover:underline transition-opacity cursor-pointer"
                onClick={(e) => e.stopPropagation()}
            >
                {item.jobName}
            </a>

            {/* Message & Icon */}
            <div className="col-span-6 flex items-center gap-3">
                <StatusIcon type={item.type} />
                <span className={`truncate ${getStatusColor(item.type)}`}>
                    {item.message}
                </span>
            </div>
        </motion.div>
    );
}

function StatusIcon({ type }: { type: ActivityItem['type'] }) {
    switch (type) {
        case 'started': return <Rocket className="h-4 w-4 text-blue-500 animate-pulse" />;
        case 'completed': return <CheckCircle2 className="h-4 w-4 text-green-500" />;
        case 'thinking': return <Brain className="h-4 w-4 text-purple-500 animate-[pulse_3s_ease-in-out_infinite]" />;
        case 'action': return <Terminal className="h-4 w-4 text-cyan-500" />;
        case 'error': return <AlertCircle className="h-4 w-4 text-red-500" />;
        default: return <Sparkles className="h-4 w-4 text-muted-foreground" />;
    }
}

function getStatusColor(type: ActivityItem['type']) {
    switch (type) {
        case 'started': return 'text-blue-400';
        case 'completed': return 'text-green-400';
        case 'thinking': return 'text-purple-400';
        case 'action': return 'text-foreground';
        case 'error': return 'text-red-400';
        default: return 'text-muted-foreground';
    }
}
