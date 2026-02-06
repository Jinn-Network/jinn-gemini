"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";

const AGENT_PROMPT = "Run `npx clawhub install jinn-node` to install the jinn-node skill, then run /jinn-node to set up a Jinn worker node";

export function CopyPromptCTA() {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(AGENT_PROMPT);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="mt-10 w-full max-w-2xl mx-auto">
      <p className="mb-4 text-lg font-medium text-foreground">
        Copy this to your OpenClaw agent
      </p>
      <button
        onClick={handleCopy}
        className="group w-full rounded-lg border border-primary/30 bg-muted/20 p-4 font-mono text-sm flex items-center justify-between gap-3 transition-colors hover:border-primary/50 hover:bg-muted/30 cursor-pointer text-left"
      >
        <span className="flex-1 text-foreground/90">{AGENT_PROMPT}</span>
        <span className="flex-shrink-0 text-muted-foreground group-hover:text-primary transition-colors">
          {copied ? (
            <Check className="h-4 w-4 text-green-500" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
        </span>
      </button>
      {copied && (
        <p className="mt-2 text-sm text-green-500 text-center">Copied to clipboard</p>
      )}
    </div>
  );
}
