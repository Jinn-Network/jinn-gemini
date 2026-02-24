"use client";

import { motion } from "framer-motion";
import { useState } from "react";
import { Check, Copy } from "lucide-react";

const examples = {
  Skill: `{
  "@context": "https://adw.jinn.network/v0.1",
  "@type": "adw:Skill",
  "adw:id": {
    "contentHash": "bafybeih2qgh5tap4ncbfv7j3mlxpwz..."
  },
  "adw:metadata": {
    "name": "web-research",
    "version": "2.0.0",
    "creator": "did:web:example.com",
    "description": "Structured web research with source verification"
  },
  "adw:capabilities": {
    "taxonomy": "skill.research.web",
    "inputs": ["query", "depth", "source_filter"],
    "outputs": ["structured_report", "source_list"]
  }
}`,
  Artifact: `{
  "@context": "https://adw.jinn.network/v0.1",
  "@type": "adw:Artifact",
  "adw:id": {
    "contentHash": "bafybeigxyz...",
    "registry": "erc8004:8453:0x1234...5678:99"
  },
  "adw:metadata": {
    "name": "market-analysis-q1-2026",
    "creator": "erc8004:8453:0xAgent...Addr:7",
    "created": "2026-02-24T10:30:00Z"
  },
  "adw:provenance": {
    "inputs": ["bafybeiabc...", "bafybeiqrs..."],
    "executor": "erc8004:8453:0xAgent...Addr:7",
    "blueprint": "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3..."
  },
  "adw:trust": {
    "level": 3,
    "evidence": {
      "signature": "0x1234...abcd",
      "executionTrace": "bafybeiexec..."
    }
  }
}`,
  Blueprint: `{
  "@context": "https://adw.jinn.network/v0.1",
  "@type": "adw:Blueprint",
  "adw:id": {
    "contentHash": "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
    "registry": "erc8004:8453:0x1234...5678:42"
  },
  "adw:metadata": {
    "name": "content-growth-blueprint",
    "version": "1.2.0",
    "creator": "did:key:z6Mkf5rGMo...",
    "description": "Multi-agent content growth orchestration"
  },
  "invariants": [
    {
      "id": "GOAL-001",
      "form": "constraint",
      "description": "All published content must be original"
    }
  ]
}`,
};

type Tab = keyof typeof examples;

export function CodeExample() {
  const [activeTab, setActiveTab] = useState<Tab>("Skill");
  const [copied, setCopied] = useState(false);

  const copyToClipboard = async () => {
    await navigator.clipboard.writeText(examples[activeTab]);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section className="py-24">
      <div className="mx-auto max-w-4xl px-6">
        <motion.h2
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mb-8 text-center text-3xl font-bold"
        >
          Code Examples
        </motion.h2>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="glass overflow-hidden rounded-xl"
        >
          <div className="flex items-center justify-between border-b border-white/[0.06] px-4">
            <div className="flex">
              {(Object.keys(examples) as Tab[]).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-4 py-3 font-mono text-xs transition-colors ${
                    activeTab === tab
                      ? "border-b-2 border-violet-500 text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>
            <button
              onClick={copyToClipboard}
              className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
            >
              {copied ? (
                <Check className="size-3.5 text-emerald-400" />
              ) : (
                <Copy className="size-3.5" />
              )}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <pre className="overflow-x-auto p-5 font-mono text-xs leading-relaxed">
            <code>{examples[activeTab]}</code>
          </pre>
        </motion.div>
      </div>
    </section>
  );
}
