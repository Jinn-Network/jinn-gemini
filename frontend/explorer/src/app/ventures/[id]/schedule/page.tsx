import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { SiteHeader } from '@/components/site-header';
import { getVenture } from '@/lib/ventures-services';
import { VentureDetail, VentureDetailSkeleton } from '../page';

interface VentureSchedulePageProps {
  params: Promise<{ id: string }>;
}

export default async function VentureSchedulePage({ params }: VentureSchedulePageProps) {
  const { id } = await params;
  const venture = await getVenture(id);

  if (!venture) {
    notFound();
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader
        breadcrumbs={[
          { label: 'Explorer', href: '/' },
          { label: 'Ventures', href: '/ventures' },
          { label: venture.name }
        ]}
      />

      <main className="flex-1 py-6 flex flex-col min-h-0">
        <div className="flex-1 flex flex-col min-h-0 px-4">
          <Suspense fallback={<VentureDetailSkeleton />}>
            <VentureDetail id={id} initialTab="schedule" />
          </Suspense>
        </div>
      </main>
    </div>
  );
}
