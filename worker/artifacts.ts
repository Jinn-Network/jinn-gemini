export type ExtractedArtifact = {
  cid: string;
  name?: string;
  topic: string;
  contentPreview?: string;
};

function tryParseJson(text: string): any | null {
  try { return JSON.parse(text); } catch { return null; }
}

export function extractArtifactsFromOutput(output: string): ExtractedArtifact[] {
  const artifacts: ExtractedArtifact[] = [];
  if (!output || typeof output !== 'string') return artifacts;

  const candidates: string[] = [];
  let buffer = '';
  let started = false;
  let depth = 0;
  let inString = false;
  let escapeNext = false;
  for (let i = 0; i < output.length; i++) {
    const ch = output[i];
    if (!started) {
      if (ch === '{') {
        started = true;
        depth = 1;
        buffer = '{';
        inString = false;
        escapeNext = false;
      }
      continue;
    }
    buffer += ch;
    if (escapeNext) {
      escapeNext = false;
    } else if (ch === '\\' && inString) {
      escapeNext = true;
    } else if (ch === '"') {
      inString = !inString;
    } else if (!inString) {
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
    }
    if (started && depth === 0) {
      candidates.push(buffer.trim());
      started = false;
      buffer = '';
      inString = false;
      escapeNext = false;
    }
  }

  for (const c of candidates) {
    const obj = tryParseJson(c);
    if (!obj) continue;
    const maybe = obj?.data || obj;
    if (maybe && typeof maybe === 'object' && typeof maybe.cid === 'string' && typeof maybe.topic === 'string') {
      const item: ExtractedArtifact = {
        cid: String(maybe.cid),
        topic: String(maybe.topic),
      };
      if (typeof maybe.name === 'string') item.name = maybe.name;
      if (typeof maybe.contentPreview === 'string') item.contentPreview = maybe.contentPreview;
      artifacts.push(item);
    }
  }
  return artifacts;
}

export function extractArtifactsFromTelemetry(telemetry: any): ExtractedArtifact[] {
  const artifacts: ExtractedArtifact[] = [];
  if (!telemetry) return artifacts;
  const texts: string[] = [];
  if (Array.isArray(telemetry?.responseText)) {
    for (const t of telemetry.responseText) {
      if (typeof t === 'string') texts.push(t);
    }
  }
  if (Array.isArray(telemetry?.requestText)) {
    for (const t of telemetry.requestText) {
      if (typeof t === 'string') texts.push(t);
    }
  }
  const seen = new Set<string>();
  for (const t of texts) {
    const items = extractArtifactsFromOutput(t);
    for (const it of items) {
      const key = `${it.cid}|${it.topic}`;
      if (seen.has(key)) continue;
      seen.add(key);
      artifacts.push(it);
    }
  }
  return artifacts;
}


