import { createClient } from '@/lib/supabase';
import JobImpactView from '@/components/job-impact-view';
import { JobImpactReport } from '@/lib/types';

interface JobImpactPageProps {
  params: Promise<{ id: string }>;
}

export default async function JobImpactPage({ params }: JobImpactPageProps) {
  const { id } = await params;
  const supabase = createClient();

  const { data, error } = await supabase.rpc('get_job_impact', { p_job_id: id });

  if (error) {
    return (
      <div className="container mx-auto p-4">
        <h1 className="text-2xl font-bold mb-4">Impact Report for Job {id}</h1>
        <div className="text-red-500">Error loading impact report: {error.message}</div>
      </div>
    );
  }

  const report: JobImpactReport = data;

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">Impact Report for Job {id}</h1>
      <div className="mb-4">
        <a href={`/job_board/${id}`} className="text-blue-500 hover:underline">
          ← Back to Job Details
        </a>
      </div>
      <JobImpactView report={report} />
    </div>
  );
}