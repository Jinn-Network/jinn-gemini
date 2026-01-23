'use client';

import { useEffect, useState, useCallback } from 'react';
import { FileText, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { queryArtifacts, fetchIpfsContent, getJobName, type Artifact } from '@/lib/subgraph';
import { MarkdownField } from '@/components/markdown-field';
import { Badge } from '@/components/ui/badge';
import { formatRelativeTime } from '@jinn/shared-ui';

interface ArtifactsGalleryProps {
  workstreamId: string;
}

// Operational topics to exclude - these are internal system artifacts
const OPERATIONAL_TOPICS = [
  'SITUATION',
  'MEASUREMENT',
  'GIT_BRANCH',
  'SERVICE_OUTPUT',
];

interface ArtifactWithJobName extends Artifact {
  jobName?: string;
}

export function ArtifactsGallery({ workstreamId }: ArtifactsGalleryProps) {
  const [artifacts, setArtifacts] = useState<ArtifactWithJobName[]>([]);
  const [selectedArtifact, setSelectedArtifact] = useState<ArtifactWithJobName | null>(null);
  const [artifactContent, setArtifactContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [contentLoading, setContentLoading] = useState(false);

  const fetchArtifacts = useCallback(async () => {
    try {
      const response = await queryArtifacts({
        where: { sourceRequestId: workstreamId },
        orderBy: 'blockTimestamp',
        orderDirection: 'desc',
        limit: 100,
      });

      // Filter out operational topics
      const contentArtifacts = response.items.filter(
        (a) => !OPERATIONAL_TOPICS.includes(a.topic)
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

      // Auto-select most recent artifact if none selected or selection no longer exists
      if (artifactsWithJobNames.length > 0) {
        const currentSelectionExists = selectedArtifact &&
          artifactsWithJobNames.some(a => a.id === selectedArtifact.id);

        if (!currentSelectionExists) {
          setSelectedArtifact(artifactsWithJobNames[0]);
        }
      }

      setLoading(false);
    } catch (error) {
      console.error('Error fetching artifacts:', error);
      setLoading(false);
    }
  }, [workstreamId, selectedArtifact]);

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
          <h3 className="text-lg font-medium text-foreground mb-2">No Artifacts Yet</h3>
          <p className="text-sm text-muted-foreground max-w-md">
            This venture hasn&apos;t produced any content artifacts yet.
            Check back later or view the Activity tab to see what&apos;s happening.
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
                onClick={() => setSelectedArtifact(artifact)}
                className={cn(
                  "w-full text-left p-3 rounded-lg transition-colors",
                  selectedArtifact?.id === artifact.id
                    ? "bg-primary/10 border border-primary/30"
                    : "hover:bg-muted/50"
                )}
              >
                <div className="flex items-start gap-2">
                  <Badge variant="secondary" className="text-[10px] shrink-0">
                    {artifact.topic}
                  </Badge>
                </div>
                <div className="font-medium text-sm mt-1 line-clamp-2">
                  {artifact.name || 'Untitled'}
                </div>
                {artifact.jobName && (
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
