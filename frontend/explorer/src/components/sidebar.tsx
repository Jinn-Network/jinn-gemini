'use client'

import Link from 'next/link';
import { useState } from 'react';
import { navigationCategories } from '@/lib/utils';

export function Sidebar() {
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

  return (
    <aside className="w-64 min-w-64 flex-shrink-0 p-4 border-r bg-slate-50 min-h-screen">
      <h2 className="text-lg font-bold mb-4">Explorer</h2>
      <nav>
        <div className="space-y-4">
          {navigationCategories.map((category) => {
            const isExpanded = expandedCategories.has(category.title);
            
            return (
              <div key={category.title}>
                <button
                  onClick={() => toggleCategory(category.title)}
                  className="w-full flex items-center justify-between px-2 py-2 text-sm font-medium text-slate-800 hover:bg-slate-100 rounded-md transition-colors"
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
                          className="block px-3 py-2 text-sm text-slate-600 hover:bg-slate-200 hover:text-slate-800 rounded-md transition-colors"
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
  );
}