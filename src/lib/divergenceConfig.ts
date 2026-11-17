/**
 * Loads and validates the divergence threshold from the environment.
 *
 * The threshold is read from the DIVERGENCE_THRESHOLD environment variable.
 * If the variable is absent, the default value of 0.05 (5 percentage points) is used.
 *
 * Valid range: [0.01, 1.00].
 * If the parsed value falls outside this range, the function throws an Error
 * so that the deployment fails fast rather than silently using an invalid config.
 *
 * Requirements: 4.5
 */

import { DivergenceConfigSchema, type DivergenceConfig } from "./schemas.js";

const DEFAULT_THRESHOLD = 0.05;

/**
 * Reads DIVERGENCE_THRESHOLD from process.env, falls back to 0.05, and
 * validates the result against DivergenceConfigSchema.
 *
 * @throws {Error} if the configured value is outside [0.01, 1.00] or is not a
 *   finite number.
 */
export function loadDivergenceConfig(): DivergenceConfig {
  const raw = process.env["DIVERGENCE_THRESHOLD"];

  let threshold: number;

  if (raw === undefined || raw === "") {
    threshold = DEFAULT_THRESHOLD;
  } else {
    threshold = parseFloat(raw);
    if (!isFinite(threshold)) {
      throw new Error(
        `DIVERGENCE_THRESHOLD must be a finite number; received: "${raw}"`
      );
    }
  }

  const result = DivergenceConfigSchema.safeParse({ threshold });

  if (!result.success) {
    throw new Error(
      `DIVERGENCE_THRESHOLD value ${threshold} is out of range. ` +
        `Valid range is [0.01, 1.00]. ` +
        `Validation error: ${result.error.message}`
    );
  }

  return result.data;
}

/**
 * Singleton config instance, initialised once at module load time.
 *
 * Import this in API routes and engine modules instead of calling
 * loadDivergenceConfig() repeatedly.
 *
 * The module-level call ensures the application fails fast on startup if the
 * environment variable is misconfigured.
 */
export const divergenceConfig: DivergenceConfig = loadDivergenceConfig();
