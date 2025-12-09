import { SiteHeader } from '@/components/site-header'
import { DashboardView } from '@/components/dashboard-view'

export default function Home() {
  return (
    <>
      <SiteHeader 
        title="Home"
      />
      <DashboardView />
    </>
  );
}