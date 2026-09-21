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
