import { z } from 'zod';
import fetch from 'cross-fetch';
import { marketplaceInteract } from 'mech-client-ts/dist/marketplace_interact.js';

const dispatchNewJobBase = z.object({
  jobId: z.string().uuid().optional(),
  jobName: z.string().min(1).optional(),
  // Optional overrides for tools/prompt if caller wants to tweak minor fields
  // If not provided, we use the values from the job definition as-is
  enabledTools: z.array(z.string()).optional(),
  prompt: z.string().optional(),
});

export const dispatchNewJobParams = dispatchNewJobBase.refine((v) => !!v.jobId || !!v.jobName, { message: 'Provide jobId or jobName' });

export const dispatchNewJobSchema = {
  description: 'Dispatch a new request for an existing job definition (by ID or name). Looks up the job in the subgraph and posts a request anchored to its jobDefinitionId.',
  inputSchema: dispatchNewJobBase.shape,
};

export async function dispatchNewJob(args: unknown) {
  const parse = dispatchNewJobParams.safeParse(args);
  if (!parse.success) {
    return { content: [{ type: 'text' as const, text: JSON.stringify({ data: null, meta: { ok: false, code: 'VALIDATION_ERROR', message: parse.error.message } }) }] };
  }
  const { jobId, jobName, enabledTools: overridesTools, prompt: overridePrompt } = parse.data;

  const gqlUrl = process.env.PONDER_GRAPHQL_URL || 'http://localhost:42069/graphql';

  // Find job definition by id or name
  let jobDef: any | null = null;
  try {
    if (jobId) {
      const res = await fetch(gqlUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: `query($id: String!) { jobDefinition(id: $id) { id name enabledTools promptContent } }`,
          variables: { id: jobId },
        }),
      });
      const json = await res.json();
      jobDef = json?.data?.jobDefinition || null;
    } else if (jobName) {
      const res = await fetch(gqlUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: `query($name: String!) { jobDefinitions(where: { name: { equals: $name } }, limit: 1) { items { id name enabledTools promptContent } } }`,
          variables: { name: jobName },
        }),
      });
      const json = await res.json();
      jobDef = json?.data?.jobDefinitions?.items?.[0] || null;
    }
  } catch (e: any) {
    return { content: [{ type: 'text' as const, text: JSON.stringify({ data: null, meta: { ok: false, code: 'SUBGRAPH_ERROR', message: e?.message || String(e) } }) }] };
  }

  if (!jobDef) {
    return { content: [{ type: 'text' as const, text: JSON.stringify({ data: null, meta: { ok: false, code: 'NOT_FOUND', message: 'Job definition not found' } }) }] };
  }

  const jobDefinitionId: string = jobDef.id;
  const name: string = jobDef.name;
  const baseTools: string[] | undefined = Array.isArray(jobDef.enabledTools) ? jobDef.enabledTools : undefined;
  const basePrompt: string | undefined = typeof jobDef.promptContent === 'string' ? jobDef.promptContent : undefined;

  const finalTools = overridesTools ?? baseTools ?? [];
  const finalPrompt = overridePrompt ?? basePrompt ?? '';
  if (!finalPrompt) {
    return { content: [{ type: 'text' as const, text: JSON.stringify({ data: null, meta: { ok: false, code: 'MISSING_PROMPT', message: 'No prompt content available to dispatch.' } }) }] };
  }

  // Build request payload mirroring post_marketplace_job expectations
  const ipfsJsonContents = [{
    prompt: finalPrompt,
    jobName: name,
    enabledTools: finalTools,
    jobDefinitionId,
  }];

  try {
    const result = await (marketplaceInteract as any)({
      prompts: [finalPrompt],
      priorityMech: '0xaB15F8d064b59447Bd8E9e89DD3FA770aBF5EEb7',
      tools: finalTools,
      ipfsJsonContents,
      chainConfig: 'base',
      postOnly: true,
    });

    return { content: [{ type: 'text' as const, text: JSON.stringify({ data: { ...result, jobDefinitionId }, meta: { ok: true } }) }] };
  } catch (e: any) {
    return { content: [{ type: 'text' as const, text: JSON.stringify({ data: null, meta: { ok: false, code: 'EXECUTION_ERROR', message: e?.message || String(e) } }) }] };
  }
}


