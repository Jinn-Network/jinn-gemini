import { Metadata } from 'next';
import { getWorkstreams } from '@/lib/subgraph';
import { SiteHeader } from '@/components/site-header';
import { WorkstreamsTable } from '@/components/workstreams-table';

export const metadata: Metadata = {
  title: 'Workstreams',
  description: 'Browse all workstreams - top-level job executions and their downstream graphs',
};

// Force dynamic rendering to avoid build-time data fetching
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 25;

interface PageProps {
  searchParams: Promise<{ after?: string; before?: string }>;
}

export default async function WorkstreamsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const { after, before } = params;

  const { requests } = await getWorkstreams({
    limit: PAGE_SIZE,
    after,
    before,
  });

  return (
    <>
      <SiteHeader
        subtitle="Top-level job executions and their entire downstream graphs"
        breadcrumbs={[{ label: 'Workstreams' }]}
      />
      <div className="p-4 md:p-6">
        <WorkstreamsTable
          workstreams={requests.items}
          pagination={{
            hasPreviousPage: requests.pageInfo.hasPreviousPage,
            hasNextPage: requests.pageInfo.hasNextPage,
            startCursor: requests.pageInfo.startCursor,
            endCursor: requests.pageInfo.endCursor,
            itemCount: requests.items.length,
          }}
        />
      </div>
    </>
  );
}

