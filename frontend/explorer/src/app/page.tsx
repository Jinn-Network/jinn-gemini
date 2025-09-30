export default function Home() {
  return (
    <div className="max-w-4xl">
      <h1 className="text-3xl font-bold mb-6">Welcome to Jinn Explorer</h1>
      <div className="prose">
        <p className="text-lg text-slate-600 mb-4">
          A comprehensive database explorer for the Jinn autonomous AI agent system.
        </p>
        <p className="text-slate-600 mb-6">
          Use the sidebar to navigate through different subgraph collections and explore blockchain data
          from the Jinn system. Each collection provides both an index view (list of all records)
          and detailed views for individual records.
        </p>
        
        <div className="bg-slate-50 p-6 rounded-lg border">
          <h2 className="text-xl font-semibold mb-3">Available Collections</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            <div className="flex flex-col space-y-1">
              <span className="font-medium">jobDefinitions</span>
              <span className="text-slate-500">Job template definitions with prompts and tool configs</span>
            </div>
            <div className="flex flex-col space-y-1">
              <span className="font-medium">requests</span>
              <span className="text-slate-500">On-chain job requests with lineage and context</span>
            </div>
            <div className="flex flex-col space-y-1">
              <span className="font-medium">deliveries</span>
              <span className="text-slate-500">Job execution results delivered on-chain</span>
            </div>
            <div className="flex flex-col space-y-1">
              <span className="font-medium">artifacts</span>
              <span className="text-slate-500">Generated content, reports, and outputs</span>
            </div>
            <div className="flex flex-col space-y-1">
              <span className="font-medium">messages</span>
              <span className="text-slate-500">Work Protocol messages between parent and child jobs</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}