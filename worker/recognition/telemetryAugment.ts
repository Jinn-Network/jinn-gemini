/**
 * Telemetry augmentation: merge recognition prefix into metadata
 */

import type { RecognitionPhaseResult } from '../recognition_helpers.js';
import type { IpfsMetadata } from '../types.js';

/**
 * Augment metadata prompt with recognition learnings
 */
export function augmentPromptWithRecognition(
  metadata: IpfsMetadata,
  recognition: RecognitionPhaseResult | null
): IpfsMetadata {
  if (!recognition?.promptPrefix) {
    return metadata;
  }

  const prefix = recognition.promptPrefix.trim();
  if (prefix.length === 0) {
    return metadata;
  }

  const originalPrompt = metadata?.prompt || '';
  return {
    ...metadata,
    prompt: `${prefix}\n\n${originalPrompt}`,
  };
}

