'use client'

import { Sidebar } from "@/components/sidebar";
import { Button } from "@/components/ui/button";
import { useState } from "react";

interface ClientLayoutProps {
  children: React.ReactNode;
}

export function ClientLayout({ children }: ClientLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const toggleSidebar = () => setSidebarOpen(!sidebarOpen);

  return (
    <div className="flex h-screen">
      <Sidebar isOpen={sidebarOpen} onToggle={toggleSidebar} />
      
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile header with menu button */}
        <header className="md:hidden bg-card border-b p-4 flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={toggleSidebar}
            aria-label="Open menu"
          >
            ☰
          </Button>
          <h1 className="text-lg font-semibold">Jinn Explorer</h1>
        </header>
        
        {/* Main content area with responsive padding */}
        <main className="flex-1 overflow-auto p-4 md:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}