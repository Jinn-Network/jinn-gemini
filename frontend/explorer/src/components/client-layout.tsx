'use client'

import { Sidebar } from "@/components/sidebar";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { RealtimeStatusIndicator } from "@/components/realtime-status-indicator";
import { useRealtimeData } from "@/hooks/use-realtime-data";

interface ClientLayoutProps {
  children: React.ReactNode;
}

export function ClientLayout({ children }: ClientLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { status: realtimeStatus } = useRealtimeData(undefined, { enabled: true });

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
          <div className="ml-auto">
            <RealtimeStatusIndicator status={realtimeStatus} />
          </div>
        </header>
        
        {/* Desktop header with real-time status indicator */}
        <header className="hidden md:flex bg-card border-b p-4 items-center justify-end">
          <RealtimeStatusIndicator status={realtimeStatus} />
        </header>
        
        {/* Main content area with responsive padding */}
        <main className="flex-1 overflow-auto p-4 md:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}