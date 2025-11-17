/**
 * Telemetry augmentation: merge recognition prefix into metadata
 */

import type { RecognitionPhaseResult } from '../recognition_helpers.js';
import type { IpfsMetadata } from '../types.js';

/**
 * Augment metadata prompt with recognition learnings and progress checkpoint
 */
export function augmentPromptWithRecognition(
  metadata: IpfsMetadata,
  recognition: RecognitionPhaseResult | null
): IpfsMetadata {
  const parts: string[] = [];
  
  // Add recognition learnings if available
  if (recognition?.promptPrefix) {
    const prefix = recognition.promptPrefix.trim();
    if (prefix.length > 0) {
      parts.push(prefix);
    }
  }
  
  // Add progress checkpoint if available
  if (recognition?.progressCheckpoint?.checkpointSummary) {
    const checkpoint = recognition.progressCheckpoint.checkpointSummary.trim();
    if (checkpoint.length > 0) {
      parts.push(checkpoint);
    }
  }
  
  // If no augmentation, return original metadata
  if (parts.length === 0) {
    return metadata;
  }
  
  const originalBlueprint = metadata?.blueprint || '';
  return {
    ...metadata,
    blueprint: `${parts.join('\n\n')}\n\n${originalBlueprint}`,
  };
}

