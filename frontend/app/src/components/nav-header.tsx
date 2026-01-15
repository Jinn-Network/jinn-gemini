"use client";

import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EXPLORER_URL } from '@/lib/featured-services';

export function NavHeader() {
  return (
    <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto flex h-16 items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2">
          <span className="text-xl font-bold">Jinn</span>
        </Link>

        <nav className="flex items-center gap-4">
          <Button variant="ghost" asChild>
            <a
              href={EXPLORER_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1"
            >
              Explorer
              <ExternalLink className="h-3 w-3" />
            </a>
          </Button>
        </nav>
      </div>
    </header>
  );
}
