'use client'

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { navigationItems } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronRight } from 'lucide-react';

interface SidebarProps {
  isOpen: boolean;
  onToggle: () => void;
}

export function Sidebar({ isOpen, onToggle }: SidebarProps) {
  const pathname = usePathname();
  const [jobsExpanded, setJobsExpanded] = useState(true);

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
        
        <nav>
          <ul className="space-y-1">
            {navigationItems.map((item) => {
              const isActive = pathname === `/${item.collection}` || 
                (item.subItems?.some(subItem => pathname === `/${subItem.collection}`));
              
              return (
                <li key={item.collection}>
                  {item.subItems ? (
                    // Jobs item with collapsible sub-items
                    <>
                      <button
                        onClick={() => setJobsExpanded(!jobsExpanded)}
                        className={`w-full flex items-center justify-between px-3 py-2 text-sm rounded-md transition-colors ${
                          isActive 
                            ? 'bg-sidebar-accent text-sidebar-foreground font-medium border-l-2 border-blue-600' 
                            : 'text-sidebar-foreground hover:bg-sidebar-accent'
                        }`}
                      >
                        <span>{item.label}</span>
                        {jobsExpanded ? (
                          <ChevronDown className="w-4 h-4" />
                        ) : (
                          <ChevronRight className="w-4 h-4" />
                        )}
                      </button>
                      {jobsExpanded && (
                        <ul className="ml-4 mt-1 space-y-1">
                          {item.subItems.map((subItem) => {
                            const isSubItemActive = pathname === `/${subItem.collection}`;
                            return (
                              <li key={subItem.collection}>
                                <Link
                                  href={`/${subItem.collection}`}
                                  className={`block px-3 py-1.5 text-sm rounded-md transition-colors ${
                                    isSubItemActive
                                      ? 'bg-sidebar-accent text-sidebar-foreground font-medium border-l-2 border-blue-600'
                                      : 'text-sidebar-foreground/80 hover:bg-sidebar-accent'
                                  }`}
                                  onClick={() => {
                                    // Close sidebar on mobile when clicking links
                                    if (window.innerWidth < 768) {
                                      onToggle();
                                    }
                                  }}
                                >
                                  {subItem.label}
                                </Link>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </>
                  ) : (
                    // Regular items without sub-items
                    <Link
                      href={`/${item.collection}`}
                      className={`block px-3 py-2 text-sm rounded-md transition-colors ${
                        isActive
                          ? 'bg-sidebar-accent text-sidebar-foreground font-medium border-l-2 border-blue-600'
                          : 'text-sidebar-foreground hover:bg-sidebar-accent'
                      }`}
                      onClick={() => {
                        // Close sidebar on mobile when clicking links
                        if (window.innerWidth < 768) {
                          onToggle();
                        }
                      }}
                    >
                      {item.label}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </nav>
      </aside>
    </>
  );
}