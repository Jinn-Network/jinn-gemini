import { createArtifact } from './create_artifact.js';

describe('create_artifact tool', () => {
  it('validates input and returns structured output', async () => {
    const res = await createArtifact({ name: 'unit', topic: 'tests', content: 'hello world' });
    const text = (res as any)?.content?.[0]?.text;
    expect(typeof text).toBe('string');
    const parsed = JSON.parse(text);
    expect(parsed?.meta?.ok).toBe(true);
    expect(parsed?.data?.cid).toBeTruthy();
    expect(parsed?.data?.name).toBe('unit');
    expect(parsed?.data?.topic).toBe('tests');
    expect(typeof parsed?.data?.contentPreview).toBe('string');
  });

  it('rejects invalid inputs', async () => {
    const res = await createArtifact({} as any);
    const text = (res as any)?.content?.[0]?.text;
    const parsed = JSON.parse(text);
    expect(parsed?.meta?.ok).toBe(false);
    expect(parsed?.meta?.code).toBe('VALIDATION_ERROR');
  });
});


