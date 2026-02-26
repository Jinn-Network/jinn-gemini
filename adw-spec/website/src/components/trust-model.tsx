"use client";

import { motion } from "framer-motion";
import { FileText, Key, Star, ShieldCheck } from "lucide-react";

const levels = [
  {
    level: 0,
    title: "Declared",
    icon: FileText,
    description: "Self-asserted metadata. No cryptographic proof. Lowest trust.",
    iconColor: "text-slate-400",
    gradient: "from-slate-500/10 to-slate-500/5",
    borderClass: "",
  },
  {
    level: 1,
    title: "Signed",
    icon: Key,
    description: "Cryptographically signed by the creator. Tamper-evident.",
    iconColor: "text-violet-400",
    gradient: "from-violet-500/15 to-indigo-500/10",
    borderClass: "border-violet-500/20",
  },
  {
    level: 2,
    title: "Reputation-Backed",
    icon: Star,
    description: "Creator has verifiable on-chain reputation and history.",
    iconColor: "text-cyan-400",
    gradient: "from-indigo-500/15 to-cyan-500/10",
    borderClass: "border-cyan-500/20",
  },
  {
    level: 3,
    title: "Provenance-Verified",
    icon: ShieldCheck,
    description:
      "Full execution chain verifiable. Inputs, process, and outputs all traceable.",
    iconColor: "text-emerald-400",
    gradient: "from-cyan-500/15 to-emerald-500/15",
    borderClass: "border-emerald-500/30",
  },
];

export function TrustModel() {
  return (
    <section className="py-24">
      <div className="mx-auto max-w-6xl px-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mb-12 text-center"
        >
          <h2 className="text-3xl font-bold">
            <span className="gradient-text-trust">Trust Model</span>
          </h2>
          <p className="mt-3 text-sm text-muted-foreground">
            Four levels of trust escalation — from self-declared to fully
            provenance-verified.
          </p>
        </motion.div>
        <div className="grid gap-4 md:grid-cols-4">
          {levels.map((level, i) => (
            <motion.div
              key={level.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-50px" }}
              transition={{ duration: 0.4, delay: i * 0.15 }}
              className={`glass relative overflow-hidden rounded-xl p-6 ${level.borderClass}`}
            >
              <div className="mb-4 flex items-center gap-2">
                <span className={`flex size-7 items-center justify-center rounded-md bg-gradient-to-br ${level.gradient}`}>
                  <level.icon className={`size-3.5 ${level.iconColor}`} />
                </span>
                <span className="font-mono text-xs text-muted-foreground">
                  L{level.level}
                </span>
              </div>
              <h3 className="mb-2 text-sm font-semibold">
                {level.title}
              </h3>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {level.description}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
