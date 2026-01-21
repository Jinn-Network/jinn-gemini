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
          <Button asChild variant="ghost">
            <a
              href="https://docs.jinn.network"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1"
            >
              Docs
              <ExternalLink className="h-3 w-3" />
            </a>
          </Button>
          <Button asChild variant="ghost">
            <a
              href="https://blog.jinn.network"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1"
            >
              Blog
              <ExternalLink className="h-3 w-3" />
            </a>
          </Button>
          <Button asChild>
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
