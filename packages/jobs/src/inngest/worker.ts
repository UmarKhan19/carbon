/**
 * Inngest Connect Worker
 *
 * This worker establishes a persistent WebSocket connection to Inngest,
 * enabling long-running tasks without HTTP timeout limits.
 *
 * Use this for:
 * - Container deployments (ECS, Kubernetes, Railway, Fly.io)
 * - Long-running tasks (>60s)
 * - Horizontal scaling across multiple workers
 *
 * Usage:
 *   pnpm run worker        # Production
 *   pnpm run worker:dev    # Local development
 *
 * Environment variables:
 *   INNGEST_MODE           # "connect" | "serve" (default: auto-detect)
 *   INNGEST_SIGNING_KEY    # Required in production
 *   INNGEST_EVENT_KEY      # Required in production
 *   INNGEST_DEV=1          # Set for local development
 *   WORKER_CONCURRENCY     # Max concurrent function executions (default: 10)
 */

import { connect } from "inngest/connect";
import { inngest, functions } from "./index";

export type InngestMode = "connect" | "serve";

/**
 * Detect which mode to use based on environment.
 * - Vercel/serverless: use "serve" (HTTP)
 * - Container/worker: use "connect" (WebSocket)
 */
export function detectMode(): InngestMode {
  // Explicit mode override
  const explicitMode = process.env.INNGEST_MODE?.toLowerCase();
  if (explicitMode === "connect" || explicitMode === "serve") {
    return explicitMode;
  }

  // Auto-detect based on environment
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NETLIFY) {
    return "serve";
  }

  // Default to connect for container environments
  return "connect";
}

const WORKER_CONCURRENCY = parseInt(
  process.env.WORKER_CONCURRENCY || "10",
  10
);

async function startWorker() {
  const mode = detectMode();

  if (mode === "serve") {
    console.log("[inngest-worker] Mode is 'serve', skipping worker start.");
    console.log("[inngest-worker] Use the /api/inngest HTTP endpoint instead.");
    return;
  }

  console.log(`[inngest-worker] Starting worker in '${mode}' mode`);
  console.log(`[inngest-worker] Concurrency: ${WORKER_CONCURRENCY}`);
  console.log(`[inngest-worker] Registered ${functions.length} functions`);

  try {
    const connection = await connect({
      apps: [
        {
          client: inngest,
          functions,
        },
      ],
      // Track deployment version for rolling updates
      appVersion: process.env.APP_VERSION || process.env.VERCEL_GIT_COMMIT_SHA,
      // Unique identifier for this worker instance
      instanceId: process.env.WORKER_INSTANCE_ID || `worker-${process.pid}`,
      // Max concurrent function executions per worker
      maxWorkerConcurrency: WORKER_CONCURRENCY,
      // Graceful shutdown on container signals
      handleShutdownSignals: ["SIGTERM", "SIGINT"],
    });

    console.log("[inngest-worker] Connected to Inngest", {
      connectionId: connection,
    });

    // Keep the process running
    process.on("SIGTERM", () => {
      console.log("[inngest-worker] Received SIGTERM, shutting down gracefully...");
    });

    process.on("SIGINT", () => {
      console.log("[inngest-worker] Received SIGINT, shutting down gracefully...");
    });
  } catch (error) {
    console.error("[inngest-worker] Failed to connect:", error);
    process.exit(1);
  }
}

// Only auto-start if this file is run directly
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  startWorker();
}

export { startWorker };
