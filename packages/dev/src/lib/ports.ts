import { getPort } from "get-port-please";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { generateJwtCreds, type JwtCreds } from "./jwt.js";

export const PORT_NAMES = [
  "PORT_DB",
  "PORT_API",
  "PORT_STUDIO",
  "PORT_INBUCKET",
  "PORT_INNGEST",
] as const;

export type PortName = (typeof PORT_NAMES)[number];
export type PortMap = Record<PortName, number>;

export const REDIS_DB_MAX = 16; // Default Redis databases setting
export const SHARED_REDIS_PORT = 6379;

const REGISTRY_PATH = join(homedir(), ".carbon", "dev-ports.json");

export type RegistryEntry = {
  worktreeRoot: string;
  ports: PortMap;
  redisDb: number;
  jwt: JwtCreds;
};
type Registry = Record<string, RegistryEntry>;

function readRegistry(): Registry {
  if (!existsSync(REGISTRY_PATH)) return {};
  try {
    return JSON.parse(readFileSync(REGISTRY_PATH, "utf8"));
  } catch {
    return {};
  }
}

function writeRegistry(registry: Registry) {
  mkdirSync(dirname(REGISTRY_PATH), { recursive: true });
  writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2));
}

export async function resolveSlot(
  slug: string,
  worktreeRoot: string
): Promise<{ ports: PortMap; redisDb: number; jwt: JwtCreds }> {
  const registry = readRegistry();
  const existing = registry[slug];
  if (
    existing &&
    existing.worktreeRoot === worktreeRoot &&
    typeof existing.redisDb === "number" &&
    existing.jwt?.secret
  ) {
    return {
      ports: existing.ports,
      redisDb: existing.redisDb,
      jwt: existing.jwt,
    };
  }

  const claimedPorts = new Set<number>();
  const claimedDbs = new Set<number>();
  for (const [s, entry] of Object.entries(registry)) {
    if (s === slug) continue;
    for (const p of Object.values(entry.ports)) claimedPorts.add(p);
    if (typeof entry.redisDb === "number") claimedDbs.add(entry.redisDb);
  }

  const ports =
    existing?.ports && existing.worktreeRoot === worktreeRoot
      ? existing.ports
      : await pickPorts(claimedPorts);

  const redisDb =
    typeof existing?.redisDb === "number"
      ? existing.redisDb
      : pickRedisDb(claimedDbs);

  // JWT creds: regenerate only if missing — they're tied to data already
  // signed/stored in postgres; rotating them invalidates existing sessions.
  const jwt = existing?.jwt?.secret ? existing.jwt : generateJwtCreds();

  registry[slug] = { worktreeRoot, ports, redisDb, jwt };
  writeRegistry(registry);
  return { ports, redisDb, jwt };
}

export function getSlot(slug: string): RegistryEntry | null {
  return readRegistry()[slug] ?? null;
}

export function getPorts(slug: string): PortMap | null {
  return readRegistry()[slug]?.ports ?? null;
}

export function listSlugs(): Registry {
  return readRegistry();
}

export function removeSlot(slug: string) {
  const registry = readRegistry();
  if (!(slug in registry)) return;
  delete registry[slug];
  writeRegistry(registry);
}

function pickRedisDb(taken: Set<number>): number {
  for (let i = 0; i < REDIS_DB_MAX; i++) {
    if (!taken.has(i)) return i;
  }
  throw new Error(
    `Redis DB pool exhausted (max ${REDIS_DB_MAX}). Free a slot via \`carbon-dev remove\`.`
  );
}

async function pickPorts(claimed: Set<number>): Promise<PortMap> {
  const ports = {} as PortMap;
  for (const name of PORT_NAMES) {
    const port = await getPort({
      random: true,
      host: "127.0.0.1",
      ports: [],
      portRange: [49152, 65535],
      // get-port-please doesn't accept a "claimed" set, so we ask for a random
      // free port and reroll if it collides with our registry.
    });
    if (claimed.has(port)) {
      // collision with another worktree — try once more
      const retry = await getPort({
        random: true,
        host: "127.0.0.1",
        portRange: [49152, 65535],
      });
      if (claimed.has(retry)) {
        throw new Error(`Port ${retry} already claimed; try again`);
      }
      ports[name] = retry;
      claimed.add(retry);
    } else {
      ports[name] = port;
      claimed.add(port);
    }
  }
  return ports;
}
