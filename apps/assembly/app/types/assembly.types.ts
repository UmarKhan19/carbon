// Assembly Types for Carbon Assembly App
// These types align with the BuildOS-style architecture

// =============================================================================
// Core Types
// =============================================================================

export interface Position3D {
  x: number;
  y: number;
  z: number;
}

export interface CameraState {
  eye: Position3D;
  center: Position3D;
  up: Position3D;
  fov?: number;
}

// =============================================================================
// Assembly Tree (Layer 2: Unified Digital Product Model)
// =============================================================================

export interface AssemblyTreeNode {
  id: string;
  name: string;
  originalName: string;
  type: "assembly" | "part";
  children?: AssemblyTreeNode[];
  // Viewer-specific
  meshId?: string;
  visible?: boolean;
  highlighted?: boolean;
  // Metadata
  partNumber?: string;
  material?: string;
  quantity?: number;
}

// =============================================================================
// Assembly Steps (Layer 5: Instruction Generator)
// =============================================================================

export interface AssemblyStep {
  id: string;
  projectId: string;
  stepNumber: string; // "1.2.1.4" hierarchical format
  parentStepId?: string;

  // Parts in this step
  partIds: string[];
  partNames: string[];

  // Animation
  animationData?: StepAnimation;
  duration: number;
  cameraPreset?: CameraState;

  // Content
  title: string;
  instruction: string;
  notes?: string;

  // Supplements (right panel in BuildOS)
  tools: StepTool[];
  standardNoteIds: string[];
  mediaIds: string[];
  warnings: StepWarning[];

  // Metadata
  groupId?: string;
  groupLabel?: string;
}

export interface StepAnimation {
  keyframes: StepKeyframe[];
  easing?: "linear" | "ease-in" | "ease-out" | "ease-in-out";
}

export interface StepKeyframe {
  partId: string;
  timestamp: number; // 0-1 normalized
  position: Position3D;
  rotation: Position3D;
  scale?: Position3D;
}

export interface StepTool {
  toolId: string;
  name: string;
  category?: string;
  imageUrl?: string;
  quantity?: number;
}

export interface StepWarning {
  type: "safety" | "quality" | "caution" | "info";
  message: string;
  icon?: string;
}

export interface StepMedia {
  id: string;
  type: "image" | "video" | "document";
  url: string;
  thumbnail?: string;
  caption?: string;
}

// =============================================================================
// Standard Notes (Reusable tribal knowledge)
// =============================================================================

export interface StandardNote {
  id: string;
  companyId: string;
  name: string;
  content: string;
  category?: string;
  tags?: string[];
  usageCount: number;
}

// =============================================================================
// Tools Library
// =============================================================================

export interface Tool {
  id: string;
  companyId: string;
  name: string;
  description?: string;
  category: string;
  partNumber?: string;
  imageUrl?: string;
  specifications?: Record<string, unknown>;
}

// =============================================================================
// Torque Specifications
// =============================================================================

export interface TorqueSpec {
  id: string;
  companyId: string;
  name: string;
  torqueValue: number;
  torqueUnit: "Nm" | "ft-lb" | "in-lb";
  tolerance?: number;
  angleSpec?: number;
  notes?: string;
  fastenerType?: string;
}

// =============================================================================
// Part Associations (Layer 4: Knowledge Engine)
// =============================================================================

export interface PartAssociation {
  id: string;
  companyId: string;
  name: string;

  // Matching criteria
  matchPattern: string;
  matchField: "name" | "partNumber" | "material";
  matchType: "exact" | "contains" | "regex" | "startsWith";

  // Auto-apply settings (tribal knowledge)
  toolIds?: string[];
  torqueSpecIds?: string[];
  defaultInstruction?: string;
  defaultNotes?: string;
  defaultWarnings?: StepWarning[];
  adhesive?: string;
  lubricant?: string;

  // Learning metrics
  usageCount: number;
  confirmationCount: number;
  rejectionCount: number;
  confidence: number; // 0-1
  source: "manual" | "learned" | "imported";
}

// =============================================================================
// Viewer State
// =============================================================================

export interface ViewerState {
  selectedStepId: string | null;
  highlightedPartIds: string[];
  hiddenPartIds: string[];
  explodedView: boolean;
  explodeFactor: number;
  isPlaying: boolean;
  playbackProgress: number; // 0-1
  viewMode: "edit" | "preview";
}

// =============================================================================
// Editor State
// =============================================================================

export interface EditorState {
  // Current state
  project: AssemblyProject | null;
  steps: AssemblyStep[];
  selectedStepIndex: number;

  // Dirty state
  hasUnsavedChanges: boolean;
  isSaving: boolean;

  // UI state
  leftPanelTab: "model" | "instructions";
  rightPanelTab: "supplements" | "tools" | "notes" | "standardNotes" | "media";
  showAnnotations: boolean;
  showPartLabels: boolean;
}

// =============================================================================
// Project
// =============================================================================

export interface AssemblyProject {
  id: string;
  companyId: string;
  name: string;
  description?: string;
  status: "preprocessing" | "simulating" | "editing" | "published";

  // Source CAD file
  modelUploadId?: string;
  originalFileName: string;

  // Parsed assembly tree
  assemblyTree: AssemblyTreeNode;
  originalAssemblyTree?: AssemblyTreeNode;

  // Simulation results
  simulationStatus?: "pending" | "running" | "completed" | "failed";
  simulationResult?: SimulationResult;
  simulationError?: string;

  // Metadata
  thumbnailPath?: string;
  videoPath?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SimulationResult {
  // Rust simulator response (current)
  steps?: SimulationRustStep[];
  stuck_parts?: string[];
  simulation_time_ms?: number;
  success?: boolean;
  error?: string | null;
  issues?: SimulationIssue[];
  planner_stats?: PlannerStats;

  // Legacy editor schema (kept for compatibility)
  sequence?: SimulationStep[];
  totalDuration?: number;
  warnings?: string[];
}

export interface SimulationRustStep {
  step_number: number;
  part_ids: string[];
  part_names: string[];
  assembly_direction: [number, number, number];
  animation_path: unknown[];
  suggested_duration_ms: number;
  motion_type?: string;
  min_clearance?: number;
  planner_score?: number;
}

export type SimulationIssueKind =
  | "overlap"
  | "clearance"
  | "path_not_found"
  | "constraint_conflict";

export type SimulationIssueSeverity = "error" | "warning";

export interface SimulationIssue {
  kind: SimulationIssueKind;
  severity: SimulationIssueSeverity;
  part_ids: string[];
  message: string;
  metrics?: Record<string, unknown>;
}

export interface PlannerStats {
  contact_edges: number;
  dependency_edges: number;
  candidate_paths_evaluated: number;
  collision_checks: number;
  overlap_issue_count: number;
}

export interface SimulationStep {
  partId: string;
  partName: string;
  order: number;
  removalDirection: Position3D;
  animationPath: StepKeyframe[];
  duration: number;
}

// =============================================================================
// Share Links
// =============================================================================

export interface ShareLink {
  id: string;
  projectId: string;
  token: string;
  expiresAt?: string;
  password?: string;
  allowDownload: boolean;
  createdAt: string;
}
