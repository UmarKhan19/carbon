import { describe, expect, it } from "vitest";
import {
  assemblyUnitCandidates,
  deriveAssemblyUnits,
  type UnitGraph,
  type UnitGraphNode
} from "./assembly-units";

function leaf(
  nodeId: string,
  name: string,
  geometryHash: string
): UnitGraphNode {
  return { nodeId, name, isAssembly: false, geometryHash, children: [] };
}

function asm(
  nodeId: string,
  name: string,
  children: UnitGraphNode[]
): UnitGraphNode {
  return { nodeId, name, isAssembly: true, geometryHash: null, children };
}

function graphOf(root: UnitGraphNode): UnitGraph {
  return { root };
}

describe("deriveAssemblyUnits", () => {
  it("gives a flat model one unit per leaf", () => {
    const graph = graphOf(
      asm("root", "Assembly", [
        leaf("a", "Bracket", "h1"),
        leaf("b", "Screw", "h2"),
        leaf("c", "Cover", "h3")
      ])
    );
    const units = deriveAssemblyUnits({
      graph,
      bomMaterials: [],
      partMappings: [],
      authoredUnits: []
    });
    expect(units).toHaveLength(3);
    expect(units.every((u) => u.nodeIds.length === 1)).toBe(true);
    expect(units.map((u) => u.id).sort()).toEqual(["a", "b", "c"]);
  });

  it("unwraps single-child wrapper layers before taking top-level children", () => {
    const graph = graphOf(
      asm("root", "Product", [
        asm("wrap", "Wrapper", [
          leaf("a", "Bracket", "h1"),
          leaf("b", "Screw", "h2")
        ])
      ])
    );
    const units = deriveAssemblyUnits({
      graph,
      bomMaterials: [],
      partMappings: [],
      authoredUnits: []
    });
    expect(units.map((u) => u.id).sort()).toEqual(["a", "b"]);
  });

  const pcbGraph = () => {
    // 6 top-level leaves + one PCB assembly whose internal solids are NOT in the
    // parent BOM. The BOM has 7 lines including "PCB Assembly".
    const pcbChildren = Array.from({ length: 300 }, (_, i) =>
      leaf(`pcb-${i}`, `C${i}`, `pcbhash-${i}`)
    );
    return graphOf(
      asm("root", "Widget", [
        leaf("l1", "Enclosure Top", "h1"),
        leaf("l2", "Enclosure Bottom", "h2"),
        leaf("l3", "Gasket", "h3"),
        leaf("l4", "Fan", "h4"),
        leaf("l5", "Bracket", "h5"),
        leaf("l6", "Label", "h6"),
        asm("pcb", "PCB Assembly", pcbChildren)
      ])
    );
  };
  const pcbBom = [
    { itemId: "i1", name: "Enclosure Top" },
    { itemId: "i2", name: "Enclosure Bottom" },
    { itemId: "i3", name: "Gasket" },
    { itemId: "i4", name: "Fan" },
    { itemId: "i5", name: "Bracket" },
    { itemId: "i6", name: "Label" },
    { itemId: "i7", name: "PCB Assembly" }
  ];
  const pcbMappings = [
    { geometryHash: "h1", itemId: "i1" },
    { geometryHash: "h2", itemId: "i2" },
    { geometryHash: "h3", itemId: "i3" },
    { geometryHash: "h4", itemId: "i4" },
    { geometryHash: "h5", itemId: "i5" },
    { geometryHash: "h6", itemId: "i6" }
  ];

  it("collapses a PCB-like subassembly to one BOM unit via the LLM match", () => {
    const units = deriveAssemblyUnits({
      graph: pcbGraph(),
      bomMaterials: pcbBom,
      partMappings: pcbMappings,
      authoredUnits: [],
      nodeMatches: [{ nodeId: "pcb", itemId: "i7" }]
    });
    expect(units).toHaveLength(7);
    const pcb = units.find((u) => u.id === "pcb");
    expect(pcb?.nodeIds).toHaveLength(300);
    expect(pcb?.itemId).toBe("i7");
    expect(pcb?.name).toBe("PCB Assembly");
    expect(pcb?.source).toBe("bom");
  });

  it("still collapses the PCB as a hierarchy unit with no LLM match", () => {
    const units = deriveAssemblyUnits({
      graph: pcbGraph(),
      bomMaterials: pcbBom,
      partMappings: pcbMappings,
      authoredUnits: []
    });
    expect(units).toHaveLength(7);
    const pcb = units.find((u) => u.id === "pcb");
    expect(pcb?.nodeIds).toHaveLength(300);
    expect(pcb?.source).toBe("hierarchy");
    expect(pcb?.itemId).toBeUndefined();
  });

  it("lists only assembly-node subtrees as LLM match candidates", () => {
    const candidates = assemblyUnitCandidates(pcbGraph());
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.nodeId).toBe("pcb");
    expect(candidates[0]?.name).toBe("PCB Assembly");
    expect(candidates[0]?.leafCount).toBe(300);
    expect(candidates[0]?.sampleParts.length).toBeGreaterThan(0);
  });

  it("collapses a subassembly with no BOM match as a hierarchy unit", () => {
    const graph = graphOf(
      asm("root", "Widget", [
        leaf("l1", "Base", "h1"),
        asm("sub", "Mystery Module", [
          leaf("s1", "x", "hs1"),
          leaf("s2", "y", "hs2")
        ])
      ])
    );
    const units = deriveAssemblyUnits({
      graph,
      bomMaterials: [{ itemId: "i1", name: "Base" }],
      partMappings: [{ geometryHash: "h1", itemId: "i1" }],
      authoredUnits: []
    });
    const sub = units.find((u) => u.id === "sub");
    expect(sub).toBeDefined();
    expect(sub?.source).toBe("hierarchy");
    expect(sub?.nodeIds.sort()).toEqual(["s1", "s2"]);
  });

  it("descends a wrapper that spans several distinct BOM items", () => {
    const graph = graphOf(
      asm("root", "Widget", [
        asm("grp", "Unnamed Group", [
          leaf("a", "Bracket", "h1"),
          leaf("b", "Screw", "h2")
        ])
      ])
    );
    const units = deriveAssemblyUnits({
      graph,
      bomMaterials: [
        { itemId: "i1", name: "Bracket" },
        { itemId: "i2", name: "Screw" }
      ],
      partMappings: [
        { geometryHash: "h1", itemId: "i1" },
        { geometryHash: "h2", itemId: "i2" }
      ],
      authoredUnits: []
    });
    expect(units.map((u) => u.id).sort()).toEqual(["a", "b"]);
    expect(units.find((u) => u.id === "a")?.itemId).toBe("i1");
  });

  it("honors an authored unit and removes its leaves from the automatic pass", () => {
    const graph = graphOf(
      asm("root", "Widget", [
        leaf("a", "Bracket", "h1"),
        leaf("b", "Screw", "h2"),
        leaf("c", "Washer", "h3")
      ])
    );
    const units = deriveAssemblyUnits({
      graph,
      bomMaterials: [],
      partMappings: [],
      authoredUnits: [
        { id: "unit-1", name: "Fastener Kit", partNodeIds: ["b", "c"] }
      ]
    });
    const authored = units.find((u) => u.id === "unit-1");
    expect(authored?.source).toBe("authored");
    expect(authored?.nodeIds.sort()).toEqual(["b", "c"]);
    expect(units.filter((u) => u.nodeIds.includes("b"))).toHaveLength(1);
    expect(units.find((u) => u.id === "a")).toBeDefined();
  });
});
