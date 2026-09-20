// Kept out of call.server.ts so it can be tested without loading the service
// registry (and with it the lingui-macro modules), the same split as
// validation-issues.ts.

/**
 * The published MCP instructions tell clients to send
 * `arguments: { args: { … } }`, and clients have copied that shape, but only the
 * operations that genuinely declare an `args` object want it — for every other
 * one the envelope IS the payload, so each declared field arrives undefined and
 * input validation rejects the call before the dispatcher ever unwraps it. Strip
 * a lone envelope here, where the operation's own schema says whether it is one.
 */
export function unwrapArgsEnvelope(
  meta: { schema?: unknown },
  args?: Record<string, unknown>
): Record<string, unknown> | undefined {
  if (!args) return args;
  const declaresArgs = Boolean(
    (meta.schema as { properties?: Record<string, unknown> } | undefined)
      ?.properties?.args
  );
  if (declaresArgs) return args;
  const keys = Object.keys(args);
  if (keys.length !== 1 || keys[0] !== "args") return args;
  const envelope = args.args;
  return envelope && typeof envelope === "object" && !Array.isArray(envelope)
    ? (envelope as Record<string, unknown>)
    : args;
}
