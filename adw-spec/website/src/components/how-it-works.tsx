"use client";

import { motion } from "framer-motion";
import { FileCheck, Search, ShieldCheck } from "lucide-react";

const steps = [
  {
    number: "01",
    icon: FileCheck,
    title: "Register",
    description:
      "Content-address your document and register it on-chain. Get a stable, cross-ecosystem identity tied to the content hash.",
    gradient: "from-violet-500/20 to-indigo-500/20",
    iconColor: "text-violet-400",
  },
  {
    number: "02",
    icon: Search,
    title: "Discover",
    description:
      "Expose documents via well-known endpoints, registry lookups, or protocol-level announcements. Found by any agent, anywhere.",
    gradient: "from-indigo-500/20 to-cyan-500/20",
    iconColor: "text-cyan-400",
  },
  {
    number: "03",
    icon: ShieldCheck,
    title: "Verify",
    description:
      "Escalate trust from declared to provenance-verified. Cryptographic signatures, reputation scores, and execution chain proofs.",
    gradient: "from-cyan-500/20 to-emerald-500/20",
    iconColor: "text-emerald-400",
  },
];

export function HowItWorks() {
  return (
    <section className="py-24">
      <div className="mx-auto max-w-6xl px-6">
        <motion.h2
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mb-12 text-center text-3xl font-bold"
        >
          How It Works
        </motion.h2>
        <div className="grid gap-6 md:grid-cols-3">
          {steps.map((step, i) => (
            <motion.div
              key={step.title}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-50px" }}
              transition={{ duration: 0.5, delay: i * 0.15 }}
              className="glass glass-hover group rounded-xl p-6 transition-all duration-300"
            >
              <div className="mb-4 flex items-center gap-3">
                <span className={`flex size-8 items-center justify-center rounded-lg bg-gradient-to-br ${step.gradient}`}>
                  <step.icon className={`size-4 ${step.iconColor}`} />
                </span>
                <span className="font-mono text-xs text-muted-foreground">
                  {step.number}
                </span>
              </div>
              <h3 className="mb-2 text-lg font-semibold">
                {step.title}
              </h3>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {step.description}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
