'use client';

import { HeartPulse, Activity, ArrowRight, Bot, GitBranch, Coins, ExternalLink } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LiveOutputView } from './live-output-view';
import { ArtifactsGallery } from './artifacts-gallery';
import { ActivityFeed } from './activity-feed';
import { HealthSummary } from './health-summary';
import { InvariantList, type InvariantWithMeasurement } from './invariant-list';
import { ServiceOutputCard } from './service-output-card';
import { WorkstreamTreeList } from '@/components/workstream-tree-list';
import { transformToActivityItems } from '@/lib/ventures/activity-utils';
import type { ServiceOutput } from '@/lib/ventures/service-types';
import type { JobDefinition } from '@/lib/subgraph';
import { formatRelativeTime, type HealthStatus } from '@jinn/shared-ui';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface TokenInfo {
    token_address: string | null;
    token_symbol: string | null;
    token_name: string | null;
    token_launch_platform: string | null;
    governance_address: string | null;
    pool_address: string | null;
}

interface VentureDashboardProps {
    liveOutputUrl: string | null;
    telegramUrl: string | null;
    activityData: { jobDefinitions: JobDefinition[] };
    workstreamId: string;
    invariants: InvariantWithMeasurement[];
    statusCounts: Record<HealthStatus, number>;
    primaryOutput: ServiceOutput | null;
    fetchActivity: (workstreamId: string) => Promise<{ jobDefinitions: JobDefinition[] }>;
    initialTab?: 'dashboard' | 'health' | 'activity' | 'work-tree';
    initialSelectedJobId?: string | null;
    tokenInfo?: TokenInfo | null;
}

export function VentureDashboard({
    liveOutputUrl,
    telegramUrl,
    activityData,
    workstreamId,
    invariants,
    statusCounts,
    primaryOutput,
    fetchActivity,
    initialTab,
    initialSelectedJobId,
    tokenInfo,
}: VentureDashboardProps) {
    // Determine if we should show the Artifacts Gallery instead of Live Output
    // Show gallery when neither liveOutputUrl nor telegramUrl is configured
    const showArtifactsGallery = !liveOutputUrl && !telegramUrl;
    const defaultTab = initialTab ?? (initialSelectedJobId ? 'work-tree' : 'dashboard');
    const router = useRouter();
    const [activeTab, setActiveTab] = useState(defaultTab);
    const [selectedJobIdOverride, setSelectedJobIdOverride] = useState<string | null>(initialSelectedJobId ?? null);

    useEffect(() => {
        setActiveTab(defaultTab);
    }, [defaultTab]);

    useEffect(() => {
        setSelectedJobIdOverride(initialSelectedJobId ?? null);
    }, [initialSelectedJobId]);
    const [activityPreviewData, setActivityPreviewData] = useState(activityData);

    useEffect(() => {
        setActivityPreviewData(activityData);
    }, [activityData]);

    useEffect(() => {
        if (!workstreamId) return;

        const interval = setInterval(async () => {
            try {
                const newData = await fetchActivity(workstreamId);
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
    }, [workstreamId, fetchActivity]);

    // Get latest 10 activity items for preview
    const activityItems = transformToActivityItems(activityPreviewData.jobDefinitions).slice(0, 10);

    const total = statusCounts.healthy + statusCounts.warning + statusCounts.critical + statusCounts.unknown;
    const measured = total - statusCounts.unknown;
    const passing = statusCounts.healthy;

    return (
        <Tabs
            value={activeTab}
            onValueChange={(value) => {
                setActiveTab(value as typeof activeTab);
                const basePath = `/ventures/${workstreamId}`;
                let nextPath = basePath;
                if (value === 'health') {
                    nextPath = `${basePath}/health`;
                } else if (value === 'activity') {
                    nextPath = `${basePath}/activity`;
                } else if (value === 'work-tree') {
                    setSelectedJobIdOverride(null);
                    nextPath = `${basePath}/tree`;
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
                <TabsTrigger value="work-tree" className="gap-1 md:gap-2">
                    <GitBranch className="h-4 w-4" />
                    <span className="hidden sm:inline">Work Tree</span>
                    <span className="sm:hidden">Tree</span>
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
                                    setSelectedJobIdOverride(jobDefId);
                                    setActiveTab('work-tree');
                                    const nextPath = `/ventures/${workstreamId}/tree/${jobDefId}`;
                                    if (typeof window !== 'undefined') {
                                        window.history.pushState({}, '', nextPath);
                                    } else {
                                        router.push(nextPath);
                                    }
                                }}
                            />
                        ) : (
                            <LiveOutputView url={liveOutputUrl!} telegramUrl={telegramUrl || undefined} />
                        )}
                    </div>

                    {/* Right Column: Health + Activity (1/3) */}
                    <div className="lg:col-span-1 flex flex-col gap-4">
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

                        {/* Token Info Card */}
                        {tokenInfo?.token_address && (
                            <Card>
                                <CardHeader className="pb-2">
                                    <CardTitle className="text-base flex items-center gap-2">
                                        <Coins className="h-4 w-4" />
                                        Token
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="space-y-2 text-sm">
                                    <div className="flex justify-between">
                                        <span className="text-muted-foreground">Name</span>
                                        <span className="font-medium">{tokenInfo.token_name}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-muted-foreground">Symbol</span>
                                        <span className="font-mono font-medium">${tokenInfo.token_symbol}</span>
                                    </div>
                                    <div className="flex justify-between items-center">
                                        <span className="text-muted-foreground">Contract</span>
                                        <a
                                            href={`https://basescan.org/address/${tokenInfo.token_address}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-primary hover:underline flex items-center gap-1 font-mono text-xs"
                                        >
                                            {tokenInfo.token_address.slice(0, 6)}...{tokenInfo.token_address.slice(-4)}
                                            <ExternalLink className="h-3 w-3" />
                                        </a>
                                    </div>
                                    {tokenInfo.pool_address && (
                                        <div className="flex justify-between items-center">
                                            <span className="text-muted-foreground">Pool</span>
                                            <a
                                                href={`https://basescan.org/address/${tokenInfo.pool_address}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-primary hover:underline flex items-center gap-1 font-mono text-xs"
                                            >
                                                {tokenInfo.pool_address.slice(0, 6)}...{tokenInfo.pool_address.slice(-4)}
                                                <ExternalLink className="h-3 w-3" />
                                            </a>
                                        </div>
                                    )}
                                    {tokenInfo.governance_address && (
                                        <div className="flex justify-between items-center">
                                            <span className="text-muted-foreground">Governance</span>
                                            <a
                                                href={`https://basescan.org/address/${tokenInfo.governance_address}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-primary hover:underline flex items-center gap-1 font-mono text-xs"
                                            >
                                                {tokenInfo.governance_address.slice(0, 6)}...{tokenInfo.governance_address.slice(-4)}
                                                <ExternalLink className="h-3 w-3" />
                                            </a>
                                        </div>
                                    )}
                                    {tokenInfo.token_launch_platform && (
                                        <div className="flex justify-between">
                                            <span className="text-muted-foreground">Platform</span>
                                            <span className="capitalize">{tokenInfo.token_launch_platform}</span>
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        )}

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
                                            <button
                                                key={item.id}
                                                type="button"
                                                className="flex gap-2 rounded-md px-1.5 py-1 transition-colors hover:bg-accent/50 text-left"
                                                onClick={() => {
                                                    setSelectedJobIdOverride(item.id);
                                                    setActiveTab('work-tree');
                                                    const nextPath = `/ventures/${workstreamId}/tree/${item.id}`;
                                                    if (typeof window !== 'undefined') {
                                                        window.history.pushState({}, '', nextPath);
                                                    } else {
                                                        router.push(nextPath);
                                                    }
                                                }}
                                            >
                                                <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                                                    <Bot className="h-3 w-3 text-primary" />
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-baseline gap-1.5 mb-0.5">
                                                        <span className="font-medium text-xs text-foreground">{item.jobName}</span>
                                                        <span className="text-[10px] text-muted-foreground">{formatRelativeTime(item.timestamp)}</span>
                                                    </div>
                                                    <p className="text-xs text-muted-foreground line-clamp-2">
                                                        {item.message}
                                                    </p>
                                                </div>
                                            </button>
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
                        workstreamId={workstreamId}
                        fetchActivity={fetchActivity}
                    />
                </div>
            </TabsContent>

            {/* Work Tree Tab */}
            <TabsContent value="work-tree" className="flex-1 min-h-0 mt-4">
                <Card className="py-0 gap-0">
                    <CardContent className="p-0">
                        <WorkstreamTreeList
                            rootId={workstreamId}
                            initialSelectedJobId={initialSelectedJobId ?? undefined}
                            selectedJobId={selectedJobIdOverride}
                            onJobSelectRoute={(jobId) => {
                                if (typeof window !== 'undefined') {
                                    window.history.pushState({}, '', `/ventures/${workstreamId}/tree/${jobId}`);
                                }
                            }}
                        />
                    </CardContent>
                </Card>
            </TabsContent>
        </Tabs>
    );
}
