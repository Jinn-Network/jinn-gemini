"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { HeroBeamDiagram } from "@/components/hero-beam-diagram";
import { ArrowRight } from "lucide-react";

export function Hero() {
  return (
    <section className="relative overflow-hidden py-28 md:py-36">
      {/* Glow orbs */}
      <div className="pointer-events-none absolute left-1/4 top-0 h-[500px] w-[500px] -translate-x-1/2 rounded-full bg-violet-600/15 blur-[120px]" />
      <div className="pointer-events-none absolute right-1/4 top-20 h-[400px] w-[400px] translate-x-1/2 rounded-full bg-cyan-500/10 blur-[100px]" />

      <div className="relative mx-auto flex max-w-5xl flex-col items-center gap-8 px-6 text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-sm backdrop-blur-sm">
          <span className="text-muted-foreground">Open Standard</span>
          <span className="text-white/20">|</span>
          <span className="text-violet-400">Agentic Document Web</span>
        </div>

        <h1 className="text-5xl font-bold leading-[1.1] tracking-tight md:text-6xl lg:text-7xl">
          <span className="gradient-text">The Trust Layer</span>
          <br />
          <span className="text-foreground">for Agent Documents</span>
        </h1>

        <p className="max-w-2xl text-lg leading-relaxed text-muted-foreground">
          An open standard for identity, discovery, and verification of AI agent
          documents. Content-addressed, cryptographically signed, verifiable
          across ecosystems.
        </p>

        <div className="flex flex-wrap items-center justify-center gap-4">
          <Link href="/intro">
            <Button size="lg" className="bg-gradient-to-r from-violet-600 to-indigo-600 text-white hover:from-violet-500 hover:to-indigo-500 shadow-lg shadow-violet-500/20">
              Start with Intro
              <ArrowRight className="ml-1 size-4" />
            </Button>
          </Link>
          <Link href="/spec">
            <Button variant="outline" size="lg" className="border-white/10 bg-white/5 backdrop-blur-sm hover:bg-white/10">
              Read the Spec
            </Button>
          </Link>
          <a
            href="https://github.com/Jinn-Network/adw-spec"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Button variant="ghost" size="lg" className="text-muted-foreground hover:text-foreground">
              View on GitHub
            </Button>
          </a>
        </div>

        {/* Glass container for beam diagram */}
        <div className="mt-4 w-full max-w-3xl rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4 backdrop-blur-xl">
          <HeroBeamDiagram />
        </div>
      </div>
    </section>
  );
}
