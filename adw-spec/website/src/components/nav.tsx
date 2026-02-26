"use client";

import Link from "next/link";

export function Nav() {
  return (
    <nav className="sticky top-0 z-50 border-b border-white/[0.06] bg-[oklch(0.08_0.02_270)]/60 backdrop-blur-2xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="flex size-7 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-cyan-400 text-[10px] font-bold text-white">
            A
          </div>
          <span className="text-sm font-semibold tracking-tight text-foreground">
            ADW
          </span>
          <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-muted-foreground">
            v0.1
          </span>
        </Link>
        <div className="flex items-center gap-6">
          <Link
            href="/intro"
            className="text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            Intro
          </Link>
          <Link
            href="/spec"
            className="text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            Specification
          </Link>
          <a
            href="https://github.com/Jinn-Network/adw-spec"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            GitHub
          </a>
        </div>
      </div>
    </nav>
  );
}
