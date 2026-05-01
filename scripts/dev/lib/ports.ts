import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import net from "node:net";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const PORT_NAMES = [
  "PORT_DB",
  "PORT_API",
  "PORT_STUDIO",
  "PORT_INBUCKET",
  "PORT_REDIS",
  "PORT_INNGEST",
] as const;

export type PortName = (typeof PORT_NAMES)[number];
export type PortMap = Record<PortName, number>;

const REGISTRY_PATH = join(homedir(), ".carbon", "dev-ports.json");

type Registry = Record<string, { worktreeRoot: string; ports: PortMap }>;

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

export async function resolvePorts(
  slug: string,
  worktreeRoot: string
): Promise<PortMap> {
  const registry = readRegistry();
  const existing = registry[slug];
  if (existing && existing.worktreeRoot === worktreeRoot) {
    return existing.ports;
  }

  const claimed = new Set<number>();
  for (const entry of Object.values(registry)) {
    for (const p of Object.values(entry.ports)) claimed.add(p);
  }

  const ports = {} as PortMap;
  for (const name of PORT_NAMES) {
    ports[name] = await pickFreePort(claimed);
  }

  registry[slug] = { worktreeRoot, ports };
  writeRegistry(registry);
  return ports;
}

export function getPorts(slug: string): PortMap | null {
  return readRegistry()[slug]?.ports ?? null;
}

export function listSlugs(): Registry {
  return readRegistry();
}

async function pickFreePort(taken: Set<number>): Promise<number> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const port = await new Promise<number>((resolve, reject) => {
      const server = net.createServer();
      server.unref();
      server.on("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (typeof address === "object" && address) {
          const p = address.port;
          server.close(() => resolve(p));
        } else {
          server.close();
          reject(new Error("Could not determine port"));
        }
      });
    });
    if (!taken.has(port)) {
      taken.add(port);
      return port;
    }
  }
  throw new Error("Failed to allocate a free port after 50 attempts");
}
