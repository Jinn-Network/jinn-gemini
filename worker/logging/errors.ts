/**
 * Error serialization and logging utilities
 */

/**
 * Serialize an error to a string representation
 */
export function serializeError(e: any): string {
  if (!e) return 'Unknown error';
  if (typeof e === 'string') return e;
  if (e?.message) return e.message;
  if (e instanceof Error) return e.toString();
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

