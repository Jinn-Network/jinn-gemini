"use client";

import React, { forwardRef, useRef } from "react";
import { cn } from "@/lib/utils";
import { AnimatedBeam } from "@/components/magicui/animated-beam";
import { Bot, FileText, Cpu, Package, ShieldCheck } from "lucide-react";

const BeamNode = forwardRef<
  HTMLDivElement,
  {
    className?: string;
    children: React.ReactNode;
    label: string;
  }
>(({ className, children, label }, ref) => (
  <div className="flex flex-col items-center gap-2">
    <div
      ref={ref}
      className={cn(
        "z-10 flex size-12 items-center justify-center rounded-full border border-white/10 bg-white/5 p-3 backdrop-blur-sm",
        className
      )}
    >
      {children}
    </div>
    <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">
      {label}
    </span>
  </div>
));
BeamNode.displayName = "BeamNode";

export function HeroBeamDiagram() {
  const containerRef = useRef<HTMLDivElement>(null);
  const agentRef = useRef<HTMLDivElement>(null);
  const blueprintRef = useRef<HTMLDivElement>(null);
  const executionRef = useRef<HTMLDivElement>(null);
  const artifactRef = useRef<HTMLDivElement>(null);
  const verifiedRef = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={containerRef}
      className="relative flex w-full items-center justify-between px-4 py-8 md:px-8"
    >
      <BeamNode ref={agentRef} label="Agent" className="border-violet-500/30 bg-violet-500/10">
        <Bot className="size-5 text-violet-400" />
      </BeamNode>
      <BeamNode ref={blueprintRef} label="Blueprint" className="border-indigo-500/30 bg-indigo-500/10">
        <FileText className="size-5 text-indigo-400" />
      </BeamNode>
      <BeamNode ref={executionRef} label="Execution" className="border-cyan-500/30 bg-cyan-500/10">
        <Cpu className="size-5 text-cyan-400" />
      </BeamNode>
      <BeamNode ref={artifactRef} label="Artifact" className="border-teal-500/30 bg-teal-500/10">
        <Package className="size-5 text-teal-400" />
      </BeamNode>
      <BeamNode ref={verifiedRef} label="Verified" className="border-emerald-500/30 bg-emerald-500/10">
        <ShieldCheck className="size-5 text-emerald-400" />
      </BeamNode>

      <AnimatedBeam
        containerRef={containerRef}
        fromRef={agentRef}
        toRef={blueprintRef}
        gradientStartColor="#8b5cf6"
        gradientStopColor="#6366f1"
        duration={4}
      />
      <AnimatedBeam
        containerRef={containerRef}
        fromRef={blueprintRef}
        toRef={executionRef}
        gradientStartColor="#6366f1"
        gradientStopColor="#22d3ee"
        duration={4}
        delay={0.5}
      />
      <AnimatedBeam
        containerRef={containerRef}
        fromRef={executionRef}
        toRef={artifactRef}
        gradientStartColor="#22d3ee"
        gradientStopColor="#2dd4bf"
        duration={4}
        delay={1}
      />
      <AnimatedBeam
        containerRef={containerRef}
        fromRef={artifactRef}
        toRef={verifiedRef}
        gradientStartColor="#2dd4bf"
        gradientStopColor="#10b981"
        duration={4}
        delay={1.5}
      />
    </div>
  );
}
