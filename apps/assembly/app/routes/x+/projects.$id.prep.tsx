import { error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { assemblySimulateTask } from "@carbon/jobs/trigger/assembly-simulate";
import { Button, Card, Heading, Input } from "@carbon/react";
import { tasks } from "@trigger.dev/sdk";
import { useCallback, useState } from "react";
import {
  BsChevronDown,
  BsChevronRight,
  BsFolder,
  BsPencil,
  BsPlay
} from "react-icons/bs";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, redirect, useLoaderData, useNavigation } from "react-router";
import { XeokitCanvas } from "~/components/Viewer";
import { path } from "~/utils/path";

interface TreeNode {
  id: string;
  name: string;
  originalName: string;
  type: "assembly" | "part";
  children?: TreeNode[];
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    update: "assembly"
  });

  const projectId = params.id;
  if (!projectId) {
    throw new Response("Project not found", { status: 404 });
  }

  const { data: project, error: projectError } = await client
    .from("assemblyProject")
    .select("*")
    .eq("id", projectId)
    .eq("companyId", companyId)
    .single();

  if (projectError || !project) {
    throw new Response("Project not found", { status: 404 });
  }

  // Get model URL if available (from CAD parsing)
  const modelUrl = project.modelPath
    ? `/file/model/${project.modelPath}`
    : undefined;

  return {
    project,
    assemblyTree: (project.assemblyTree as TreeNode) || mockTree,
    modelUrl
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "assembly"
  });

  const projectId = params.id;
  if (!projectId) {
    throw new Response("Project not found", { status: 404 });
  }

  const formData = await request.formData();
  const action = formData.get("_action");

  if (action === "updateTree") {
    const treeJson = formData.get("assemblyTree") as string;
    try {
      const assemblyTree = JSON.parse(treeJson);

      const { error: updateError } = await client
        .from("assemblyProject")
        .update({
          assemblyTree,
          updatedBy: userId,
          updatedAt: new Date().toISOString()
        })
        .eq("id", projectId)
        .eq("companyId", companyId);

      if (updateError) {
        return redirect(
          path.to.projectPrep(projectId),
          await flash(request, error(updateError, "Failed to save changes"))
        );
      }

      return redirect(
        path.to.projectPrep(projectId),
        await flash(request, success("Assembly tree saved"))
      );
    } catch {
      return redirect(
        path.to.projectPrep(projectId),
        await flash(request, error(null, "Invalid tree data"))
      );
    }
  }

  if (action === "runSimulation") {
    // Update status and trigger simulation job
    const { error: updateError } = await client
      .from("assemblyProject")
      .update({
        status: "simulating",
        simulationStatus: "pending",
        updatedBy: userId,
        updatedAt: new Date().toISOString()
      })
      .eq("id", projectId)
      .eq("companyId", companyId);

    if (updateError) {
      return redirect(
        path.to.projectPrep(projectId),
        await flash(request, error(updateError, "Failed to start simulation"))
      );
    }

    // Trigger simulation job via Trigger.dev
    await tasks.trigger<typeof assemblySimulateTask>("assembly-simulate", {
      projectId,
      companyId,
    });

    return redirect(
      path.to.project(projectId),
      await flash(
        request,
        success("Simulation started! This may take a few minutes.")
      )
    );
  }

  return null;
}

// Mock tree for demo - will be replaced with parsed STEP data
const mockTree: TreeNode = {
  id: "root",
  name: "Motor Assembly",
  originalName: "MOTOR_ASSEMBLY_V2",
  type: "assembly",
  children: [
    {
      id: "base",
      name: "Base Plate",
      originalName: "PART_001_BASE",
      type: "part"
    },
    {
      id: "motor-sub",
      name: "Motor Subassembly",
      originalName: "SUBASM_MOTOR",
      type: "assembly",
      children: [
        {
          id: "motor-housing",
          name: "Motor Housing",
          originalName: "MOTOR_HOUSING_V1",
          type: "part"
        },
        {
          id: "motor-rotor",
          name: "Rotor",
          originalName: "ROTOR_001",
          type: "part"
        },
        {
          id: "motor-stator",
          name: "Stator",
          originalName: "STATOR_001",
          type: "part"
        }
      ]
    },
    {
      id: "bracket",
      name: "Mounting Bracket",
      originalName: "BRACKET_MTG_001",
      type: "part"
    },
    {
      id: "fasteners",
      name: "Fasteners",
      originalName: "HARDWARE",
      type: "assembly",
      children: [
        {
          id: "bolt-1",
          name: "M8 Bolt x4",
          originalName: "M8X25_BOLT",
          type: "part"
        },
        {
          id: "washer-1",
          name: "M8 Washer x4",
          originalName: "M8_WASHER",
          type: "part"
        },
        { id: "nut-1", name: "M8 Nut x4", originalName: "M8_NUT", type: "part" }
      ]
    }
  ]
};

export default function ProjectPrepRoute() {
  const { project: _project, assemblyTree, modelUrl } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const [tree, setTree] = useState<TreeNode>(assemblyTree);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // Handle part selection from 3D viewer (bidirectional sync)
  const handlePartSelected = useCallback((partId: string | null, _partName: string | null) => {
    console.log("[PREP] 3D part selected:", partId);
    setSelectedNodeId(partId);
    // TODO: Could expand tree parents and scroll to selected node
  }, []);

  const startEditing = (node: TreeNode) => {
    setEditingNodeId(node.id);
    setEditingName(node.name);
  };

  const finishEditing = () => {
    if (editingNodeId) {
      setTree((prev) => updateNodeName(prev, editingNodeId, editingName));
    }
    setEditingNodeId(null);
    setEditingName("");
  };

  return (
    <div className="flex h-[calc(100vh-49px)]">
      {/* Left Panel - Tree Editor */}
      <div className="w-80 border-r bg-background flex flex-col">
        <div className="p-4 border-b">
          <Heading size="h4">Assembly Tree</Heading>
          <p className="text-sm text-muted-foreground mt-1">
            Rename parts and organize the structure
          </p>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <TreeNodeComponent
            node={tree}
            editingNodeId={editingNodeId}
            editingName={editingName}
            selectedNodeId={selectedNodeId}
            onStartEditing={startEditing}
            onEditingNameChange={setEditingName}
            onFinishEditing={finishEditing}
            onNodeSelect={setSelectedNodeId}
          />
        </div>

        <div className="p-4 border-t space-y-2">
          <Form method="post">
            <input type="hidden" name="_action" value="updateTree" />
            <input
              type="hidden"
              name="assemblyTree"
              value={JSON.stringify(tree)}
            />
            <Button
              type="submit"
              variant="outline"
              className="w-full"
              disabled={isSubmitting}
            >
              Save Changes
            </Button>
          </Form>

          <Form method="post">
            <input type="hidden" name="_action" value="runSimulation" />
            <input
              type="hidden"
              name="assemblyTree"
              value={JSON.stringify(tree)}
            />
            <Button type="submit" className="w-full" disabled={isSubmitting}>
              <BsPlay className="w-4 h-4 mr-2" />
              Run Simulation
            </Button>
          </Form>
        </div>
      </div>

      {/* Right Panel - 3D Preview */}
      <div className="flex-1 bg-[#1a1a2e] relative">
        <XeokitCanvas
          modelUrl={modelUrl}
          modelFormat="gltf"
          highlightedPartIds={selectedNodeId ? [selectedNodeId] : []}
          onPartSelected={handlePartSelected}
        />

        {/* Preview controls */}
        <div className="absolute bottom-4 left-4 right-4 flex justify-center">
          <Card className="px-4 py-2 flex items-center gap-4 bg-background/80 backdrop-blur">
            <Button variant="ghost" size="sm">
              Exploded View
            </Button>
            <Button variant="ghost" size="sm">
              Reset View
            </Button>
            <Button variant="ghost" size="sm">
              Fit to Screen
            </Button>
          </Card>
        </div>
      </div>
    </div>
  );
}

function TreeNodeComponent({
  node,
  level = 0,
  editingNodeId,
  editingName,
  selectedNodeId,
  onStartEditing,
  onEditingNameChange,
  onFinishEditing,
  onNodeSelect
}: {
  node: TreeNode;
  level?: number;
  editingNodeId: string | null;
  editingName: string;
  selectedNodeId: string | null;
  onStartEditing: (node: TreeNode) => void;
  onEditingNameChange: (name: string) => void;
  onFinishEditing: () => void;
  onNodeSelect: (nodeId: string) => void;
}) {
  const [isExpanded, setIsExpanded] = useState(level < 2);
  const hasChildren = node.children && node.children.length > 0;
  const isEditing = editingNodeId === node.id;
  const isSelected = selectedNodeId === node.id;

  return (
    <div className="select-none">
      <div
        className={`
          flex items-center gap-2 py-1 px-2 rounded-md cursor-pointer
          hover:bg-muted transition-colors
          ${isSelected ? "bg-primary/10 ring-1 ring-primary/50" : ""}
        `}
        style={{ paddingLeft: `${level * 16 + 8}px` }}
        onClick={() => onNodeSelect(node.id)}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-0.5 hover:bg-muted-foreground/10 rounded"
          >
            {isExpanded ? (
              <BsChevronDown className="w-3 h-3" />
            ) : (
              <BsChevronRight className="w-3 h-3" />
            )}
          </button>
        ) : (
          <span className="w-4" />
        )}

        <BsFolder
          className={`w-4 h-4 ${node.type === "assembly" ? "text-yellow-500" : "text-blue-500"}`}
        />

        {isEditing ? (
          <Input
            value={editingName}
            onChange={(e) => onEditingNameChange(e.target.value)}
            onBlur={onFinishEditing}
            onKeyDown={(e) => {
              if (e.key === "Enter") onFinishEditing();
              if (e.key === "Escape") {
                onEditingNameChange(node.name);
                onFinishEditing();
              }
            }}
            className="h-6 text-sm py-0 flex-1"
            autoFocus
          />
        ) : (
          <>
            <span className="flex-1 text-sm truncate">{node.name}</span>
            <button
              type="button"
              onClick={() => onStartEditing(node)}
              className="p-1 opacity-0 group-hover:opacity-100 hover:bg-muted-foreground/10 rounded"
            >
              <BsPencil className="w-3 h-3 text-muted-foreground" />
            </button>
          </>
        )}
      </div>

      {hasChildren && isExpanded && (
        <div>
          {node.children!.map((child) => (
            <TreeNodeComponent
              key={child.id}
              node={child}
              level={level + 1}
              editingNodeId={editingNodeId}
              editingName={editingName}
              selectedNodeId={selectedNodeId}
              onStartEditing={onStartEditing}
              onEditingNameChange={onEditingNameChange}
              onFinishEditing={onFinishEditing}
              onNodeSelect={onNodeSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function updateNodeName(
  tree: TreeNode,
  nodeId: string,
  newName: string
): TreeNode {
  if (tree.id === nodeId) {
    return { ...tree, name: newName };
  }

  if (tree.children) {
    return {
      ...tree,
      children: tree.children.map((child) =>
        updateNodeName(child, nodeId, newName)
      )
    };
  }

  return tree;
}
