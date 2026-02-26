"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { X } from "lucide-react";

export function AnnouncementBanner() {
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem("adw-banner-dismissed");
    if (!stored) setDismissed(false);
  }, []);

  const dismiss = () => {
    setDismissed(true);
    localStorage.setItem("adw-banner-dismissed", "true");
  };

  if (dismissed) return null;

  return (
    <div className="relative flex flex-wrap items-center justify-center gap-2 border-b border-white/[0.06] bg-gradient-to-r from-violet-500/10 via-transparent to-cyan-500/10 px-6 py-2.5 text-sm">
      <span className="rounded-full bg-violet-500/20 px-2 py-0.5 text-[10px] font-medium text-violet-300">
        DRAFT
      </span>
      <span className="text-muted-foreground">v0.1 published</span>
      <Link href="/intro" className="font-medium text-violet-400 hover:text-violet-300">
        Start with Intro &rarr;
      </Link>
      <span className="text-muted-foreground/60">|</span>
      <Link href="/spec" className="font-medium text-violet-400 hover:text-violet-300">
        Full Spec
      </Link>
      <button
        onClick={dismiss}
        className="absolute right-4 text-muted-foreground hover:text-foreground"
        aria-label="Dismiss banner"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
