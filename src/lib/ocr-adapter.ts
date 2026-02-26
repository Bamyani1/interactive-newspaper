/**
 * Compatibility shim.
 *
 * New canonical location: src/server/ocr-adapter
 * Keep this file to avoid breaking existing imports during migration.
 */

export * from "../server/ocr-adapter";

import ocrAdapter from "../server/ocr-adapter";
export default ocrAdapter;
