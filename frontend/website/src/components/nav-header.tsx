"use client";

import Link from 'next/link';
import { MessageCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EXPLORER_URL } from '@/lib/featured-services';

export function NavHeader() {
  const scrollToSection = (e: React.MouseEvent<HTMLAnchorElement>, sectionId: string) => {
    e.preventDefault();
    const element = document.getElementById(sectionId);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto flex h-16 items-center justify-between px-4">
        {/* Left side: Logo + All nav items */}
        <div className="flex items-center gap-8">
          <Link href="/" className="flex items-center gap-2">
            <span className="text-xl font-bold">Jinn</span>
          </Link>

          <nav className="hidden md:flex items-center gap-2">
            <Button asChild variant="ghost">
              <a href="#adventures" onClick={(e) => scrollToSection(e, 'adventures')}>
                Featured Ventures
              </a>
            </Button>
            <Button asChild variant="ghost">
              <a href="#stream" onClick={(e) => scrollToSection(e, 'stream')}>
                Live Network Activity
              </a>
            </Button>
            <Button asChild variant="ghost">
              <a href="https://docs.jinn.network" target="_blank" rel="noopener noreferrer">
                Docs
              </a>
            </Button>
            <Button asChild variant="ghost">
              <a href="https://blog.jinn.network" target="_blank" rel="noopener noreferrer">
                Blog
              </a>
            </Button>
            <Button asChild variant="ghost">
              <a href={EXPLORER_URL} target="_blank" rel="noopener noreferrer">
                Explorer
              </a>
            </Button>
            <Button asChild variant="ghost">
              <a href="#" onClick={(e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>
                Run a Node
              </a>
            </Button>
          </nav>
        </div>

        {/* Right side: Telegram CTA */}
        <Button asChild>
          <a
            href="https://t.me/+ZgkG_MbbhrJkMjhk"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2"
          >
            <MessageCircle className="h-4 w-4" />
            <span className="hidden sm:inline">Join Telegram</span>
          </a>
        </Button>
      </div>
    </header>
  );
}
