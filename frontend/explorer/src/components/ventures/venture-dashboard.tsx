'use client';

import { HeartPulse, Activity, ArrowRight, Bot, GitBranch, Calendar, Rows3 } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LiveOutputView } from './live-output-view';
import { ArtifactsGallery } from './artifacts-gallery';
import { ActivityFeed } from './activity-feed';
import { HealthSummary } from './health-summary';
import { InvariantList, type InvariantWithMeasurement } from './invariant-list';
import { ServiceOutputCard } from './service-output-card';
import { TokenInfoCard } from './token-info-card';
import { DispatchScheduleTab } from './dispatch-schedule';
import { WorkstreamsTable } from '@/components/workstreams-table';
import { transformToActivityItems } from '@/lib/ventures/activity-utils';
import type { ServiceOutput } from '@/lib/ventures/service-types';
import type { JobDefinition, Request, Workstream } from '@/lib/subgraph';
import type { Venture } from '@/lib/ventures-services';
import { type HealthStatus } from '@jinn/shared-ui';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

// Format timestamp in social media style (e.g., "2 mins ago", "3 hours ago")
function formatTimeAgo(timestamp: number): string {
    const now = Date.now();
    const diff = now - timestamp;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    const months = Math.floor(days / 30);
    const years = Math.floor(days / 365);

    if (seconds < 60) return 'just now';
    if (minutes < 60) return `${minutes} min${minutes !== 1 ? 's' : ''} ago`;
    if (hours < 24) return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
    if (days < 30) return `${days} day${days !== 1 ? 's' : ''} ago`;
    if (months < 12) return `${months} month${months !== 1 ? 's' : ''} ago`;
    return `${years} year${years !== 1 ? 's' : ''} ago`;
}

interface TokenInfo {
    token_address: string | null;
    token_symbol: string | null;
    token_name: string | null;
    token_launch_platform: string | null;
    governance_address: string | null;
    pool_address: string | null;
    token_metadata: Record<string, unknown> | null;
}

interface VentureDashboardProps {
    liveOutputUrl: string | null;
    telegramUrl: string | null;
    activityData: { jobDefinitions: JobDefinition[] };
    workstreamId: string;
    ventureId: string;
    venture?: Venture | null;
    invariants: InvariantWithMeasurement[];
    statusCounts: Record<HealthStatus, number>;
    primaryOutput: ServiceOutput | null;
    fetchActivity: (id: string) => Promise<{ jobDefinitions: JobDefinition[] }>;
    initialTab?: 'dashboard' | 'health' | 'activity' | 'workstreams' | 'schedule';
    dispatches?: Record<string, { count: number; latestRequest: Request | null; requests: Request[] }>;
    workstreams?: Workstream[];
    tokenInfo?: TokenInfo | null;
}


export function VentureDashboard({
    liveOutputUrl,
    telegramUrl,
    activityData,
    workstreamId,
    ventureId,
    venture,
    invariants,
    statusCounts,
    primaryOutput,
    fetchActivity,
    initialTab,
    dispatches,
    workstreams,
    tokenInfo,
}: VentureDashboardProps) {
    // Determine if we should show the Artifacts Gallery instead of Live Output
    // Show gallery when neither liveOutputUrl nor telegramUrl is configured
    const showArtifactsGallery = !liveOutputUrl && !telegramUrl;
    const defaultTab = initialTab ?? 'dashboard';
    const router = useRouter();
    const [activeTab, setActiveTab] = useState(defaultTab);

    useEffect(() => {
        setActiveTab(defaultTab);
    }, [defaultTab]);

    const [activityPreviewData, setActivityPreviewData] = useState(activityData);

    useEffect(() => {
        setActivityPreviewData(activityData);
    }, [activityData]);

    // Use ventureId for polling (aggregate across all workstreams)
    const pollId = ventureId || workstreamId;

    useEffect(() => {
        if (!pollId) return;

        const interval = setInterval(async () => {
            try {
                const newData = await fetchActivity(pollId);
                if (newData.jobDefinitions.length > 0) {
                    setActivityPreviewData(prev => {
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
    }, [pollId, fetchActivity]);

    // Get latest 10 activity items for preview
    const activityItems = transformToActivityItems(activityPreviewData.jobDefinitions).slice(0, 10);

    const total = statusCounts.healthy + statusCounts.warning + statusCounts.critical + statusCounts.unknown;
    const measured = total - statusCounts.unknown;
    const passing = statusCounts.healthy;

    const hasSchedule = venture?.dispatch_schedule && venture.dispatch_schedule.length > 0;
    const hasWorkstreams = workstreams && workstreams.length > 0;

    return (
        <Tabs
            value={activeTab}
            onValueChange={(value) => {
                setActiveTab(value as typeof activeTab);
                const basePath = `/ventures/${ventureId}`;
                let nextPath = basePath;
                if (value === 'health') {
                    nextPath = `${basePath}/health`;
                } else if (value === 'activity') {
                    nextPath = `${basePath}/activity`;
                } else if (value === 'workstreams') {
                    nextPath = `${basePath}/workstreams`;
                } else if (value === 'schedule') {
                    nextPath = `${basePath}/schedule`;
                }
                if (typeof window !== 'undefined') {
                    window.history.pushState({}, '', nextPath);
                } else {
                    router.push(nextPath);
                }
            }}
            className="flex-1 flex flex-col min-h-0"
        >
            <TabsList className="w-full md:w-fit">
                <TabsTrigger value="dashboard" className="gap-1 md:gap-2">
                    <span className="hidden sm:inline">Dashboard</span>
                    <span className="sm:hidden">Home</span>
                </TabsTrigger>
                <TabsTrigger value="health" className="gap-1 md:gap-2">
                    <HeartPulse className="h-4 w-4" />
                    <span className="hidden sm:inline">Health ({invariants.length})</span>
                    <span className="sm:hidden">{invariants.length}</span>
                </TabsTrigger>
                <TabsTrigger value="activity" className="gap-1 md:gap-2">
                    <Activity className="h-4 w-4" />
                    <span className="hidden sm:inline">Activity</span>
                </TabsTrigger>
                {hasSchedule && (
                    <TabsTrigger value="schedule" className="gap-1 md:gap-2">
                        <Calendar className="h-4 w-4" />
                        <span className="hidden sm:inline">Schedule</span>
                    </TabsTrigger>
                )}
                <TabsTrigger value="workstreams" className="gap-1 md:gap-2">
                    <Rows3 className="h-4 w-4" />
                    <span className="hidden sm:inline">Workstreams</span>
                </TabsTrigger>
            </TabsList>

            {/* Dashboard Tab */}
            <TabsContent value="dashboard" className="flex-1 min-h-0 mt-4">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 h-full">
                    {/* Left Column: Live Output or Artifacts Gallery (2/3) */}
                    <div className="lg:col-span-2 flex flex-col min-h-[500px]">
                        {showArtifactsGallery ? (
                            <ArtifactsGallery
                                workstreamId={workstreamId}
                                onNavigateToJob={(jobDefId) => {
                                    router.push(`/workstreams/${workstreamId}`);
                                }}
                            />
                        ) : (
                            <LiveOutputView url={liveOutputUrl!} telegramUrl={telegramUrl || undefined} />
                        )}
                    </div>

                    {/* Right Column: Health + Activity (1/3) */}
                    <div className="lg:col-span-1 flex flex-col gap-4">
                        {/* Token Info Card */}
                        {tokenInfo?.token_address && (
                            <TokenInfoCard tokenInfo={tokenInfo} />
                        )}

                        {/* Health Summary Card */}
                        <Card>
                            <CardHeader className="pb-2">
                                <div className="flex items-center justify-between">
                                    <CardTitle className="text-base flex items-center gap-2">
                                        <HeartPulse className="h-4 w-4" />
                                        Health
                                    </CardTitle>
                                    <TabsList className="h-auto p-0 bg-transparent">
                                        <TabsTrigger
                                            value="health"
                                            className="text-xs text-primary hover:underline px-0 py-0 h-auto data-[state=active]:bg-transparent data-[state=active]:shadow-none"
                                        >
                                            View all <ArrowRight className="h-3 w-3 ml-1" />
                                        </TabsTrigger>
                                    </TabsList>
                                </div>
                            </CardHeader>
                            <CardContent>
                                <div className="flex gap-4 text-center">
                                    <div className="flex-1">
                                        <div className="text-2xl font-bold text-green-500">{statusCounts.healthy}</div>
                                        <div className="text-xs text-muted-foreground">Healthy</div>
                                    </div>
                                    <div className="flex-1">
                                        <div className="text-2xl font-bold text-yellow-500">{statusCounts.warning}</div>
                                        <div className="text-xs text-muted-foreground">Warning</div>
                                    </div>
                                    <div className="flex-1">
                                        <div className="text-2xl font-bold text-red-500">{statusCounts.critical}</div>
                                        <div className="text-xs text-muted-foreground">Critical</div>
                                    </div>
                                    <div className="flex-1">
                                        <div className="text-2xl font-bold text-muted-foreground">{statusCounts.unknown}</div>
                                        <div className="text-xs text-muted-foreground">Unknown</div>
                                    </div>
                                </div>
                                {measured > 0 && (
                                    <p className="text-sm text-muted-foreground mt-3 text-center">
                                        {passing}/{measured} invariants passing
                                    </p>
                                )}
                            </CardContent>
                        </Card>

                        {/* Activity Preview Card */}
                        <Card className="flex-1 flex flex-col min-h-0">
                            <CardHeader className="pb-2">
                                <div className="flex items-center justify-between">
                                    <CardTitle className="text-base flex items-center gap-2">
                                        <Activity className="h-4 w-4" />
                                        Recent Activity
                                    </CardTitle>
                                    <TabsList className="h-auto p-0 bg-transparent">
                                        <TabsTrigger
                                            value="activity"
                                            className="text-xs text-primary hover:underline px-0 py-0 h-auto data-[state=active]:bg-transparent data-[state=active]:shadow-none"
                                        >
                                            View all <ArrowRight className="h-3 w-3 ml-1" />
                                        </TabsTrigger>
                                    </TabsList>
                                </div>
                            </CardHeader>
                            <CardContent className="flex-1 overflow-auto">
                                {activityItems.length === 0 ? (
                                    <p className="text-sm text-muted-foreground text-center py-4">No activity yet</p>
                                ) : (
                                    <div className="space-y-3">
                                        {activityItems.map((item) => (
                                            <div key={item.id} className="flex gap-2 rounded-md px-1.5 py-1">
                                                <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                                                    <Bot className="h-3 w-3 text-primary" />
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-baseline gap-1.5 mb-0.5">
                                                        <a
                                                            href={`/ventures/${ventureId}`}
                                                            className="font-medium text-xs text-primary hover:underline"
                                                        >
                                                            {item.jobName}
                                                        </a>
                                                        <span className="text-[10px] text-muted-foreground">
                                                            {formatTimeAgo(item.timestamp)}
                                                        </span>
                                                    </div>
                                                    <p className="text-xs text-muted-foreground line-clamp-2">
                                                        {item.message}
                                                    </p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </CardContent>
                        </Card>

                    </div>
                </div>
            </TabsContent>

            {/* Health Tab */}
            <TabsContent value="health" className="flex-1 min-h-0 mt-4 overflow-auto">
                <div className="space-y-6">
                    {/* Service Output Card */}
                    {primaryOutput && (
                        <ServiceOutputCard output={primaryOutput} />
                    )}

                    {/* Health Summary */}
                    {invariants.length > 0 && (
                        <HealthSummary counts={statusCounts} />
                    )}

                    {/* Invariants List */}
                    {invariants.length > 0 ? (
                        <InvariantList invariants={invariants} />
                    ) : (
                        <Card>
                            <CardContent className="py-8 text-center text-muted-foreground">
                                No blueprint invariants found for this venture
                            </CardContent>
                        </Card>
                    )}
                </div>
            </TabsContent>

            {/* Activity Tab */}
            <TabsContent value="activity" className="flex-1 min-h-0 mt-4">
                <div className="h-[600px]">
                    <ActivityFeed
                        initialData={activityData}
                        workstreamId={pollId}
                        fetchActivity={fetchActivity}
                    />
                </div>
            </TabsContent>

            {/* Schedule Tab */}
            {hasSchedule && (
                <TabsContent value="schedule" className="flex-1 min-h-0 mt-4 overflow-auto">
                    <DispatchScheduleTab
                        ventureId={ventureId}
                        schedule={venture!.dispatch_schedule}
                        dispatches={dispatches}
                    />
                </TabsContent>
            )}

            {/* Workstreams Tab */}
            <TabsContent value="workstreams" className="flex-1 min-h-0 mt-4 overflow-auto">
                <WorkstreamsTable workstreams={workstreams ?? []} />
            </TabsContent>
        </Tabs>
    );
}
