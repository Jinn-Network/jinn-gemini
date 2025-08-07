'use client'

import Link from 'next/link';
import { useState, useEffect } from 'react';
import { navigationCategories } from '@/lib/utils';
import { Button } from '@/components/ui/button';

interface SidebarProps {
  isOpen: boolean;
  onToggle: () => void;
}

export function Sidebar({ isOpen, onToggle }: SidebarProps) {
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(['Jobs', 'Output', 'System']) // All categories expanded by default
  );

  const toggleCategory = (categoryTitle: string) => {
    const newExpanded = new Set(expandedCategories);
    if (newExpanded.has(categoryTitle)) {
      newExpanded.delete(categoryTitle);
    } else {
      newExpanded.add(categoryTitle);
    }
    setExpandedCategories(newExpanded);
  };

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
          <div className="space-y-4">
            {navigationCategories.map((category) => {
              const isExpanded = expandedCategories.has(category.title);
              
              return (
                <div key={category.title}>
                  <button
                    onClick={() => toggleCategory(category.title)}
                    className="w-full flex items-center justify-between px-2 py-2 text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent rounded-md transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-xs">{category.icon}</span>
                      <span>{category.title}</span>
                    </div>
                    <span className={`text-xs transition-transform ${isExpanded ? 'rotate-90' : ''}`}>
                      ▶
                    </span>
                  </button>
                  
                  {isExpanded && (
                    <ul className="mt-2 ml-4 space-y-1">
                      {category.items.map((item) => (
                        <li key={item.collection}>
                          <Link 
                            href={`/${item.collection}`}
                            className="block px-3 py-2 text-sm text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground rounded-md transition-colors"
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
                  )}
                </div>
              );
            })}
          </div>
        </nav>
      </aside>
    </>
  );
}