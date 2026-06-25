export type LoopKind = "bug" | "feature" | "usability" | "copy";

export type Binding = {
  id: string;
  kind: LoopKind;
  title: string;
  risk: "low" | "med" | "high";
  acceptance: string[];
};

const KINDS: LoopKind[] = ["bug", "feature", "usability", "copy"];

/** Parse the YAML-ish frontmatter of a `.loop.md` binding. No YAML dependency. */
export function parseBinding(md: string): Binding {
  const match = md.match(/^---\n([\s\S]*?)\n---/);
  if (!match || !match[1]) throw new Error("Binding has no frontmatter block.");
  const lines = match[1].split("\n");
  const scalars: Record<string, string> = {};
  const acceptance: string[] = [];
  let inAcceptance = false;
  for (const line of lines) {
    if (/^acceptance:\s*$/.test(line)) {
      inAcceptance = true;
      continue;
    }
    if (inAcceptance && /^\s*-\s+/.test(line)) {
      acceptance.push(line.replace(/^\s*-\s+/, "").trim());
      continue;
    }
    inAcceptance = false;
    const kv = line.match(/^([a-zA-Z]+):\s*(.*)$/);
    if (kv && kv[1] && kv[2] !== undefined) scalars[kv[1]] = kv[2].trim();
  }
  const id = scalars.id;
  const kind = scalars.kind as LoopKind;
  if (!id) throw new Error("Binding missing required field: id");
  if (!kind || !KINDS.includes(kind))
    throw new Error(`Binding kind must be one of ${KINDS.join("|")}`);
  return {
    id,
    kind,
    title: scalars.title ?? "",
    risk: (scalars.risk as Binding["risk"]) ?? "low",
    acceptance
  };
}
