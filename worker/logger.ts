/**
 * @fileoverview Temporary bridge to shared logging module.
 *
 * This file re-exports everything from the shared logging module for backward compatibility.
 * It will be removed once all worker files are updated to import from '../logging/index.js'.
 *
 * @deprecated Import from '../logging/index.js' instead
 */

export * from '../logging/index.js';
