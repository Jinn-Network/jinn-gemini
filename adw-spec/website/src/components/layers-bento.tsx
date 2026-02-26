"use client";

import { motion } from "framer-motion";
import {
  Fingerprint,
  FileText,
  Globe,
  Shield,
  GitBranch,
  Database,
} from "lucide-react";

const layers = [
  {
    icon: Fingerprint,
    title: "Identity",
    description:
      "Content-addressed hashing gives every document an immutable, canonical identity.",
    iconColor: "text-violet-400",
    gradient: "from-violet-500/20 to-indigo-500/20",
    large: true,
  },
  {
    icon: FileText,
    title: "Metadata",
    description:
      "JSON-LD registration files with type, creator, version, and capabilities.",
    iconColor: "text-slate-400",
    gradient: "from-slate-500/20 to-slate-500/10",
    large: false,
  },
  {
    icon: Globe,
    title: "Discovery",
    description:
      "Well-known endpoints, registry lookups, and protocol-level exposure.",
    iconColor: "text-blue-400",
    gradient: "from-blue-500/20 to-blue-500/10",
    large: false,
  },
  {
    icon: Shield,
    title: "Trust",
    description:
      "Four-level escalation from declared to provenance-verified trust.",
    iconColor: "text-emerald-400",
    gradient: "from-emerald-500/20 to-teal-500/20",
    large: true,
  },
  {
    icon: GitBranch,
    title: "Provenance",
    description:
      "Ordered chains of creation and transformation steps, cryptographically linked.",
    iconColor: "text-amber-400",
    gradient: "from-amber-500/20 to-amber-500/10",
    large: false,
  },
  {
    icon: Database,
    title: "Storage",
    description:
      "Implementation-agnostic storage — IPFS, Arweave, S3, or any content-addressable system.",
    iconColor: "text-cyan-400",
    gradient: "from-cyan-500/20 to-cyan-500/10",
    large: false,
  },
];

export function LayersBento() {
  return (
    <section className="py-24">
      <div className="mx-auto max-w-6xl px-6">
        <motion.h2
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mb-12 text-center text-3xl font-bold"
        >
          Six Layers
        </motion.h2>
        <div className="grid gap-4 md:grid-cols-4">
          {layers.map((layer, i) => (
            <motion.div
              key={layer.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-50px" }}
              transition={{ duration: 0.4, delay: i * 0.1 }}
              className={`glass glass-hover rounded-xl p-6 transition-all duration-300 ${
                layer.large ? "md:col-span-2" : ""
              }`}
            >
              <div className={`mb-3 flex size-9 items-center justify-center rounded-lg bg-gradient-to-br ${layer.gradient}`}>
                <layer.icon className={`size-4.5 ${layer.iconColor}`} />
              </div>
              <h3 className="mb-1 text-base font-semibold">
                {layer.title}
              </h3>
              <p className="text-sm text-muted-foreground">
                {layer.description}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
