"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";

export function GetStarted() {
  return (
    <section className="py-28">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        className="mx-auto flex max-w-2xl flex-col items-center gap-6 px-6 text-center"
      >
        <h2 className="text-3xl font-bold">
          <span className="gradient-text">Get Started</span>
        </h2>
        <p className="text-muted-foreground">
          Start with the plain-language intro, then dive into the full
          specification.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-4">
          <Link href="/intro">
            <Button size="lg" className="bg-gradient-to-r from-violet-600 to-indigo-600 text-white hover:from-violet-500 hover:to-indigo-500 shadow-lg shadow-violet-500/20">
              Read the Intro
              <ArrowRight className="ml-1 size-4" />
            </Button>
          </Link>
          <Link href="/spec">
            <Button variant="outline" size="lg" className="border-white/10 bg-white/5 backdrop-blur-sm hover:bg-white/10">
              Read the Specification
            </Button>
          </Link>
          <a
            href="https://github.com/Jinn-Network/adw-spec"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Button variant="outline" size="lg" className="border-white/10 bg-white/5 backdrop-blur-sm hover:bg-white/10">
              View on GitHub
            </Button>
          </a>
          <a
            href="https://github.com/Jinn-Network/adw-spec/discussions"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Button variant="ghost" size="lg" className="text-muted-foreground hover:text-foreground">
              Join the Discussion
            </Button>
          </a>
        </div>
      </motion.div>
    </section>
  );
}
