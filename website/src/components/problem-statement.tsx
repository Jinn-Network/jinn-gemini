"use client";

import { motion } from "framer-motion";

export function ProblemStatement() {
  return (
    <section className="py-24">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-100px" }}
        transition={{ duration: 0.6 }}
        className="mx-auto max-w-3xl px-6 text-center"
      >
        <h2 className="text-3xl font-bold mb-6">The Problem</h2>
        <p className="text-lg leading-relaxed text-muted-foreground">
          Agent skills live in Git repos. Blueprints sit in databases. Artifacts
          land on IPFS. Agent identities are on-chain, but the documents they
          produce have no equivalent standard. There is no way to discover,
          verify, or trust a document across organizational and platform
          boundaries.
        </p>
      </motion.div>
    </section>
  );
}
