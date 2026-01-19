import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";

interface LiveOutputViewProps {
    url: string;
}

export function LiveOutputView({ url }: LiveOutputViewProps) {
    return (
        <div className="h-full flex flex-col overflow-hidden border-2 shadow-sm rounded-xl bg-background/50 backdrop-blur-sm">
            {/* Browser Chrome Header */}
            <div className="h-10 border-b bg-muted/30 px-4 flex items-center justify-between shrink-0">
                <div className="flex gap-2">
                    <div className="h-3 w-3 rounded-full bg-red-400/80" />
                    <div className="h-3 w-3 rounded-full bg-yellow-400/80" />
                    <div className="h-3 w-3 rounded-full bg-green-400/80" />
                </div>
                <div className="flex-1 mx-4">
                    <div className="h-6 bg-background rounded-md border flex items-center justify-center px-3 text-xs text-muted-foreground truncate max-w-[300px] mx-auto">
                        {url}
                    </div>
                </div>
                <Button variant="ghost" size="sm" asChild className="gap-1.5 text-muted-foreground hover:text-foreground h-7 px-2">
                    <a href={url} target="_blank" rel="noopener noreferrer">
                        <span className="text-xs">Open</span>
                        <ExternalLink className="h-3 w-3" />
                    </a>
                </Button>
            </div>

            {/* Iframe Container */}
            <div className="w-full flex-1 bg-white relative">
                <iframe
                    src={url}
                    className="w-full h-full border-0"
                    title="Live Service Output"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
                />
            </div>
        </div>
    );
}
