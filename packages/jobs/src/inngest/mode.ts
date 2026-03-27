/**
 * Inngest mode detection and configuration.
 *
 * INNGEST_MODE environment variable:
 * - "serve"   : HTTP-based, Inngest calls your /api/inngest endpoint
 * - "connect" : WebSocket-based, your worker connects to Inngest
 *
 * Auto-detection:
 * - Vercel, AWS Lambda, Netlify → "serve"
 * - Container environments → "connect"
 */

export type InngestMode = "connect" | "serve";

/**
 * Detect which mode to use based on environment.
 */
export function detectMode(): InngestMode {
  // Explicit mode override
  const explicitMode = process.env.INNGEST_MODE?.toLowerCase();
  if (explicitMode === "connect" || explicitMode === "serve") {
    return explicitMode;
  }

  // Auto-detect based on environment
  if (
    process.env.VERCEL ||
    process.env.AWS_LAMBDA_FUNCTION_NAME ||
    process.env.NETLIFY
  ) {
    return "serve";
  }

  // Default to connect for container environments
  return "connect";
}

/**
 * Check if running in connect mode.
 */
export function isConnectMode(): boolean {
  return detectMode() === "connect";
}

/**
 * Check if running in serve mode.
 */
export function isServeMode(): boolean {
  return detectMode() === "serve";
}
