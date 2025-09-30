'use client'

import Link from 'next/link';
import { useEffect } from 'react';
import { navigationItems } from '@/lib/utils';
import { Button } from '@/components/ui/button';

interface SidebarProps {
  isOpen: boolean;
  onToggle: () => void;
}

export function Sidebar({ isOpen, onToggle }: SidebarProps) {
  // Close sidebar on route change (mobile)
  useEffect(() => {
    const handleResize = () => {
      // Close sidebar on mobile when window resizes to desktop
      if (window.innerWidth >= 768 && isOpen) {
        // Don't auto-close on desktop, let users manage it
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [isOpen]);

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 z-40 md:hidden"
          onClick={onToggle}
        />
      )}
      
      {/* Sidebar */}
      <aside className={`
        fixed md:static inset-y-0 left-0 z-50 md:z-auto
        w-64 min-w-64 flex-shrink-0 p-4 border-r bg-sidebar 
        transform transition-transform duration-300 ease-in-out
        ${isOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
        md:min-h-screen h-full md:h-auto
      `}>
        {/* Mobile close button */}
        <div className="flex items-center justify-between mb-4 md:block">
          <h2 className="text-lg font-bold text-sidebar-foreground">Explorer</h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggle}
            className="md:hidden"
            aria-label="Close sidebar"
          >
            ✕
          </Button>
        </div>
        
        {/* Search Link */}
        <div className="mb-4">
          <Link 
            href="/search"
            className="block w-full px-3 py-2 text-sm font-medium text-sidebar-foreground bg-sidebar-accent hover:bg-sidebar-primary border border-sidebar-border rounded-md transition-colors"
            onClick={() => {
              // Close sidebar on mobile when clicking links
              if (window.innerWidth < 768) {
                onToggle();
              }
            }}
          >
            🔍 Search Events
          </Link>
        </div>
        
        <nav>
          <ul className="space-y-1">
            {navigationItems.map((item) => (
              <li key={item.collection}>
                <Link
                  href={`/${item.collection}`}
                  className="block px-3 py-2 text-sm text-sidebar-foreground hover:bg-sidebar-accent rounded-md transition-colors"
                  onClick={() => {
                    // Close sidebar on mobile when clicking links
                    if (window.innerWidth < 768) {
                      onToggle();
                    }
                  }}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </aside>
    </>
  );
}