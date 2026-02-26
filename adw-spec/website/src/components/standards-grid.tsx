"use client";

import { motion } from "framer-motion";
import { ExternalLink } from "lucide-react";

const standards = [
  {
    name: "ERC-8004",
    emoji: "🤖",
    description: "Trustless agent identity registry — ADW extends the same pattern for documents",
    url: "https://erc8004.org",
  },
  {
    name: "W3C DIDs",
    emoji: "🔑",
    description: "Decentralized identifiers for creator and document identity",
    url: "https://www.w3.org/TR/did-core/",
  },
  {
    name: "W3C VCs",
    emoji: "📜",
    description: "Verifiable credentials for document attestations and trust proofs",
    url: "https://www.w3.org/TR/vc-data-model-2.0/",
  },
  {
    name: "IPFS / DASL",
    emoji: "📦",
    description: "Content-addressed storage and deterministic hashing conventions",
    url: "https://ipfs.tech",
  },
  {
    name: "A2A Protocol",
    emoji: "🔄",
    description: "Well-known endpoint pattern for agent discovery",
    url: "https://github.com/google/A2A",
  },
  {
    name: "C2PA",
    emoji: "🛡️",
    description: "Content provenance model adapted for agent execution chains",
    url: "https://c2pa.org",
  },
  {
    name: "OASF",
    emoji: "📂",
    description: "Dotted notation taxonomy for skill and capability classification",
    url: "https://docs.agntcy.org/oasf/open-agentic-schema-framework/",
  },
  {
    name: "SKILL.md",
    emoji: "📝",
    description: "Agent skill format adopted by Claude Code, Copilot, and Cursor",
    url: "https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills",
  },
];

export function StandardsGrid() {
  return (
    <section className="py-24">
      <div className="mx-auto max-w-6xl px-6">
        <motion.h2
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mb-12 text-center text-3xl font-bold"
        >
          Built on Standards
        </motion.h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {standards.map((std, i) => (
            <motion.a
              key={std.name}
              href={std.url}
              target="_blank"
              rel="noopener noreferrer"
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-50px" }}
              transition={{ duration: 0.4, delay: i * 0.08 }}
              className="glass glass-hover group flex flex-col gap-2 rounded-xl p-5 transition-all duration-300"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-lg">{std.emoji}</span>
                  <span className="text-sm font-semibold">
                    {std.name}
                  </span>
                </div>
                <ExternalLink className="size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {std.description}
              </p>
            </motion.a>
          ))}
        </div>
      </div>
    </section>
  );
}
