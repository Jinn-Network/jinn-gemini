export default function Home() {
  return (
    <div className="max-w-4xl">
      <h1 className="text-3xl font-bold mb-6">Welcome to Jinn Explorer</h1>
      <div className="prose">
        <p className="text-lg text-slate-600 mb-4">
          A comprehensive database explorer for the Jinn autonomous AI agent system.
        </p>
        <p className="text-slate-600 mb-6">
          Use the sidebar to navigate through different database collections and explore the data
          flowing through the system. Each collection provides both an index view (list of all records)
          and detailed views for individual records.
        </p>
        
        <div className="bg-slate-50 p-6 rounded-lg border">
          <h2 className="text-xl font-semibold mb-3">Available Collections</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            <div className="flex flex-col space-y-1">
              <span className="font-medium">job_board</span>
              <span className="text-slate-500">Central job queue</span>
            </div>
            <div className="flex flex-col space-y-1">
              <span className="font-medium">job_definitions</span>
              <span className="text-slate-500">Reusable job templates</span>
            </div>
            <div className="flex flex-col space-y-1">
              <span className="font-medium">job_schedules</span>
              <span className="text-slate-500">Job triggering rules</span>
            </div>
            <div className="flex flex-col space-y-1">
              <span className="font-medium">prompt_library</span>
              <span className="text-slate-500">Versioned prompts</span>
            </div>
            <div className="flex flex-col space-y-1">
              <span className="font-medium">threads</span>
              <span className="text-slate-500">Hierarchical work organization</span>
            </div>
            <div className="flex flex-col space-y-1">
              <span className="font-medium">artifacts</span>
              <span className="text-slate-500">Generated content</span>
            </div>
            <div className="flex flex-col space-y-1">
              <span className="font-medium">memories</span>
              <span className="text-slate-500">Vector-based memory storage</span>
            </div>
            <div className="flex flex-col space-y-1">
              <span className="font-medium">messages</span>
              <span className="text-slate-500">Inter-agent communication</span>
            </div>
            <div className="flex flex-col space-y-1">
              <span className="font-medium">system_state</span>
              <span className="text-slate-500">Global key-value state</span>
            </div>
            <div className="flex flex-col space-y-1">
              <span className="font-medium">job_reports</span>
              <span className="text-slate-500">Execution reports and telemetry</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}