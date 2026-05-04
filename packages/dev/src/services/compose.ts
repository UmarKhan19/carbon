import { execa } from "execa";
import { COMPOSE_DEV_FILE, COMPOSE_SHARED_FILE } from "../constants.js";
import { projectName } from "../lib/slug.js";

/** Bring up the per-worktree compose stack (postgres + supabase services). */
export async function bootStack(root: string, slug: string) {
  await execStrict(
    "docker",
    [
      "compose",
      "-f",
      COMPOSE_DEV_FILE,
      "-p",
      projectName(slug),
      "--env-file",
      ".env.local",
      "up",
      "-d"
    ],
    root
  );
}

/** Stop the per-worktree compose stack. */
export async function stopStack(
  root: string,
  slug: string,
  withVolumes: boolean
) {
  const args = [
    "compose",
    "-f",
    COMPOSE_DEV_FILE,
    "-p",
    projectName(slug),
    "down"
  ];
  if (withVolumes) args.push("-v");
  await execa("docker", args, { cwd: root, stdio: "ignore", reject: false });
}

/**
 * Boot the shared redis container (one per host). Recovers from a stale
 * `carbon-redis` container left over from a previous compose project.
 */
export async function bootSharedRedis(root: string) {
  const args = ["compose", "-f", COMPOSE_SHARED_FILE, "up", "-d", "redis"];
  let r = await execa("docker", args, { cwd: root, reject: false });
  if (r.exitCode !== 0 && /already in use/i.test(r.stderr ?? "")) {
    await execa("docker", ["rm", "-f", "carbon-redis"], {
      reject: false,
      stdio: "ignore"
    });
    r = await execa("docker", args, { cwd: root, reject: false });
  }
  if (r.exitCode !== 0) {
    process.stderr.write(r.stderr ?? "");
    throw new Error(`shared redis up failed (exit ${r.exitCode})`);
  }
}

/** Tear down the named compose project's volumes (used by `dev remove`). */
export async function destroyProjectVolumes(cwd: string, project: string) {
  await execa(
    "docker",
    ["compose", "-f", COMPOSE_DEV_FILE, "-p", project, "down", "-v"],
    { cwd, stdio: "ignore", reject: false }
  );
}

/** Read NDJSON output of `docker compose ps -a --format json` for a project. */
export async function listContainers(
  root: string,
  slug: string
): Promise<Container[]> {
  const r = await execa(
    "docker",
    [
      "compose",
      "-f",
      COMPOSE_DEV_FILE,
      "-p",
      projectName(slug),
      "ps",
      "-a",
      "--format",
      "json"
    ],
    { cwd: root, reject: false }
  );
  if (r.exitCode !== 0 || !r.stdout?.trim()) return [];
  return r.stdout
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Container);
}

/** docker ps → map<compose-project, state>. */
export async function dockerProjectStates(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const r = await execa(
    "docker",
    [
      "ps",
      "-a",
      "--format",
      '{{.Label "com.docker.compose.project"}}\t{{.State}}'
    ],
    { reject: false }
  );
  for (const line of (r.stdout ?? "").split("\n")) {
    const [project, state] = line.split("\t");
    if (!project) continue;
    if (state === "running") out.set(project, "running");
    else if (!out.has(project)) out.set(project, state);
  }
  return out;
}

export type Container = {
  Service: string;
  Name: string;
  State: string;
  Status: string;
  Health?: string;
  Publishers?: { PublishedPort: number; TargetPort: number }[] | null;
};

async function execStrict(cmd: string, args: string[], cwd: string) {
  const r = await execa(cmd, args, { cwd, reject: false, preferLocal: true });
  if (r.exitCode !== 0) {
    process.stderr.write(r.stderr?.toString() ?? "");
    process.stdout.write(r.stdout?.toString() ?? "");
    throw new Error(`${cmd} ${args.join(" ")} failed (exit ${r.exitCode})`);
  }
}
