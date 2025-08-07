import { JobImpactReport, CreatedRecord } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { IdLink } from './id-link';

function DetailItem({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-gray-100 pb-3">
      <div className="font-medium text-gray-900 text-sm mb-1">{label}:</div>
      <div className="text-sm text-gray-700">{children}</div>
    </div>
  );
}

function CreatedRecords({ records }: { records: CreatedRecord[] }) {
  if (records.length === 0) {
    return <p className="text-sm text-gray-500">This job did not create any new records.</p>;
  }

  return (
    <ul className="space-y-2">
      {records.map(record => (
        <li key={record.id} className="flex items-center space-x-2 text-sm">
          <span className="font-semibold">{record.record_type}:</span>
          <IdLink collection={record.record_type} id={String(record.id)} />
          <span>({record.description})</span>
        </li>
      ))}
    </ul>
  );
}

export default function JobImpactView({ report }: { report: JobImpactReport }) {
  const { job_report, source_schedule, created_records } = report;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Execution Summary</CardTitle>
        </CardHeader>
        <CardContent>
          {job_report ? (
            <div className="space-y-2">
              <DetailItem label="Status">{job_report.status}</DetailItem>
              <DetailItem label="Duration">{job_report.duration_ms}ms</DetailItem>
              <DetailItem label="Total Tokens">{job_report.total_tokens}</DetailItem>
              <DetailItem label="Final Output">{job_report.final_output}</DetailItem>
            </div>
          ) : (
            <p className="text-sm text-gray-500">No job report found.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Causality</CardTitle>
        </CardHeader>
        <CardContent>
          {source_schedule ? (
            <DetailItem label="Triggered By Schedule">
              <IdLink collection="job_schedules" id={String(source_schedule.id)} />
              <span>({source_schedule.job_name})</span>
            </DetailItem>
          ) : (
            <p className="text-sm text-gray-500">Source schedule not found.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Impact: Created Records</CardTitle>
        </CardHeader>
        <CardContent>
          <CreatedRecords records={created_records} />
        </CardContent>
      </Card>
    </div>
  );
}