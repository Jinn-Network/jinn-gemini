'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import { FileText, Loader2, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import { queryArtifacts, queryRequests, fetchIpfsContent, getJobName, type Artifact } from '@/lib/subgraph';
import { MarkdownField } from '@/components/markdown-field';
import { Badge } from '@/components/ui/badge';
import { formatRelativeTime } from '@jinn/shared-ui';

interface ArtifactsGalleryProps {
  workstreamId: string;
}

// Operational topics to exclude - these are internal system artifacts (case-insensitive)
const OPERATIONAL_TOPICS = [
  'situation',
  'measurement',
  'git_branch',
  'git/branch',
  'service_output',
];

interface ArtifactWithJobName extends Artifact {
  jobName?: string;
}

export function ArtifactsGallery({ workstreamId }: ArtifactsGalleryProps) {
  const [artifacts, setArtifacts] = useState<ArtifactWithJobName[]>([]);
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);
  const [artifactContent, setArtifactContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [contentLoading, setContentLoading] = useState(false);
  const hasAutoSelected = useRef(false);

  // Derive selected artifact from ID
  const selectedArtifact = artifacts.find(a => a.id === selectedArtifactId) || null;

  const fetchArtifacts = useCallback(async () => {
    try {
      // First, get all requests in this workstream
      const requestsResponse = await queryRequests({
        where: { workstreamId },
        limit: 200,
      });

      // Get unique request IDs (including the root workstream ID)
      const requestIds = [workstreamId, ...requestsResponse.items.map(r => r.id)];

      // Query artifacts for all requests in the workstream
      // We need to fetch artifacts where requestId is in our list
      const allArtifacts: Artifact[] = [];

      // Query in batches to avoid too-long queries
      for (const requestId of requestIds) {
        const response = await queryArtifacts({
          where: { requestId },
          orderBy: 'blockTimestamp',
          orderDirection: 'desc',
          limit: 50,
        });
        allArtifacts.push(...response.items);
      }

      // Sort by blockTimestamp descending
      allArtifacts.sort((a, b) => {
        const tsA = Number(a.blockTimestamp || 0);
        const tsB = Number(b.blockTimestamp || 0);
        return tsB - tsA;
      });

      // Filter out operational topics (case-insensitive)
      const contentArtifacts = allArtifacts.filter(
        (a) => !OPERATIONAL_TOPICS.includes(a.topic.toLowerCase())
      );

      // Fetch job names for artifacts that have sourceJobDefinitionId
      const artifactsWithJobNames = await Promise.all(
        contentArtifacts.map(async (artifact) => {
          if (artifact.sourceJobDefinitionId) {
            const jobName = await getJobName(artifact.sourceJobDefinitionId);
            return { ...artifact, jobName: jobName || undefined };
          }
          return artifact;
        })
      );

      setArtifacts(artifactsWithJobNames);

      // Auto-select most recent artifact only on initial load
      if (!hasAutoSelected.current && artifactsWithJobNames.length > 0) {
        setSelectedArtifactId(artifactsWithJobNames[0].id);
        hasAutoSelected.current = true;
      }

      setLoading(false);
    } catch (error) {
      console.error('Error fetching artifacts:', error);
      setLoading(false);
    }
  }, [workstreamId]);

  // Initial fetch and polling
  useEffect(() => {
    fetchArtifacts();

    const interval = setInterval(() => {
      fetchArtifacts();
    }, 10000); // Poll every 10 seconds

    return () => clearInterval(interval);
  }, [fetchArtifacts]);

  // Fetch content when selected artifact changes
  useEffect(() => {
    if (!selectedArtifact?.cid) {
      setArtifactContent(null);
      return;
    }

    setContentLoading(true);
    fetchIpfsContent(selectedArtifact.cid).then((result) => {
      if (result) {
        try {
          const parsed = JSON.parse(result.content);
          // Extract .content field if it exists (standard artifact format)
          const content = parsed.content || result.content;
          setArtifactContent(typeof content === 'string' ? content : JSON.stringify(content, null, 2));
        } catch {
          setArtifactContent(result.content);
        }
      } else {
        setArtifactContent('[Content not available]');
      }
      setContentLoading(false);
    });
  }, [selectedArtifact]);

  if (loading) {
    return (
      <div className="h-full flex flex-col overflow-hidden border-2 shadow-sm rounded-xl bg-background/50 backdrop-blur-sm">
        {/* Browser Chrome Header */}
        <div className="h-10 border-b bg-muted/30 px-4 flex items-center shrink-0">
          <div className="flex gap-2">
            <div className="h-3 w-3 rounded-full bg-red-400/80" />
            <div className="h-3 w-3 rounded-full bg-yellow-400/80" />
            <div className="h-3 w-3 rounded-full bg-green-400/80" />
          </div>
          <span className="ml-4 text-sm text-muted-foreground">Artifacts Gallery</span>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (artifacts.length === 0) {
    return (
      <div className="h-full flex flex-col overflow-hidden border-2 shadow-sm rounded-xl bg-background/50 backdrop-blur-sm">
        {/* Browser Chrome Header */}
        <div className="h-10 border-b bg-muted/30 px-4 flex items-center shrink-0">
          <div className="flex gap-2">
            <div className="h-3 w-3 rounded-full bg-red-400/80" />
            <div className="h-3 w-3 rounded-full bg-yellow-400/80" />
            <div className="h-3 w-3 rounded-full bg-green-400/80" />
          </div>
          <span className="ml-4 text-sm text-muted-foreground">Artifacts Gallery</span>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
          <FileText className="h-12 w-12 text-muted-foreground/50 mb-4" />
          <h3 className="text-lg font-medium text-foreground mb-2">No Content Artifacts Yet</h3>
          <p className="text-sm text-muted-foreground max-w-md">
            This venture is actively working but hasn&apos;t published content artifacts yet.
            Some ventures commit outputs to git repositories instead.
            View the <span className="font-medium">Activity</span> or <span className="font-medium">Work Tree</span> tabs to see progress.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden border-2 shadow-sm rounded-xl bg-background/50 backdrop-blur-sm">
      {/* Browser Chrome Header */}
      <div className="h-10 border-b bg-muted/30 px-4 flex items-center shrink-0">
        <div className="flex gap-2">
          <div className="h-3 w-3 rounded-full bg-red-400/80" />
          <div className="h-3 w-3 rounded-full bg-yellow-400/80" />
          <div className="h-3 w-3 rounded-full bg-green-400/80" />
        </div>
        <span className="ml-4 text-sm text-muted-foreground">Artifacts Gallery</span>
        <span className="ml-2 text-xs text-muted-foreground/70">({artifacts.length} artifacts)</span>
      </div>

      {/* Two-pane layout */}
      <div className="flex-1 flex min-h-0">
        {/* Left panel: Artifact list */}
        <div className="w-72 border-r bg-muted/20 overflow-y-auto shrink-0">
          <div className="p-2 space-y-1">
            {artifacts.map((artifact) => (
              <button
                key={artifact.id}
                onClick={() => setSelectedArtifactId(artifact.id)}
                className={cn(
                  "w-full text-left p-3 rounded-lg transition-colors",
                  selectedArtifactId === artifact.id
                    ? "bg-primary/10 border border-primary/30"
                    : "hover:bg-muted/50"
                )}
              >
                <div className="flex items-start gap-2">
                  <Badge variant="secondary" className="text-[10px] shrink-0 uppercase">
                    {artifact.topic}
                  </Badge>
                </div>
                <div className="font-medium text-sm mt-1 line-clamp-2">
                  {artifact.name || 'Untitled'}
                </div>
                {artifact.jobName && artifact.sourceJobDefinitionId && (
                  <Link
                    href={`/ventures/${workstreamId}/tree/${artifact.sourceJobDefinitionId}`}
                    onClick={(e) => e.stopPropagation()}
                    className="text-xs text-primary hover:underline mt-1 flex items-center gap-1"
                  >
                    {artifact.jobName}
                    <ExternalLink className="h-3 w-3" />
                  </Link>
                )}
                {artifact.jobName && !artifact.sourceJobDefinitionId && (
                  <div className="text-xs text-muted-foreground mt-1">
                    Job: {artifact.jobName}
                  </div>
                )}
                <div className="text-[10px] text-muted-foreground/70 mt-1">
                  {artifact.blockTimestamp
                    ? formatRelativeTime(Number(artifact.blockTimestamp) * 1000)
                    : 'Unknown time'}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Right pane: Content display */}
        <div className="flex-1 overflow-y-auto bg-background">
          {contentLoading ? (
            <div className="h-full flex items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : artifactContent ? (
            <div className="p-4">
              <MarkdownField content={artifactContent} />
            </div>
          ) : (
            <div className="h-full flex items-center justify-center text-muted-foreground">
              Select an artifact to view its content
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
