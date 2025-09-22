import { extractArtifactsFromOutput, extractArtifactsFromTelemetry } from './artifacts.js';

const toolOk = {
  data: {
    cid: 'f01551220abc',
    name: 'doc',
    topic: 'analysis',
    contentPreview: 'first 100'
  },
  meta: { ok: true }
};

describe('artifact extraction', () => {
  it('extracts artifacts from output JSON blobs', () => {
    const output = `some text\n${JSON.stringify(toolOk)}\nmore text`;
    const items = extractArtifactsFromOutput(output);
    expect(items.length).toBe(1);
    expect(items[0].cid).toBe('f01551220abc');
    expect(items[0].topic).toBe('analysis');
    expect(items[0].name).toBe('doc');
  });

  it('dedupes across telemetry request/response texts', () => {
    const t = { requestText: [JSON.stringify(toolOk)], responseText: [JSON.stringify(toolOk)] };
    const items = extractArtifactsFromTelemetry(t);
    expect(items.length).toBe(1);
  });
});


