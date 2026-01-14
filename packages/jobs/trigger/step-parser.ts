import { getCarbonServiceRole } from "@carbon/auth";
import { task, logger } from "@trigger.dev/sdk";

/**
 * Assembly metadata extracted from STEP file
 */
interface AssemblyNode {
  id: string;
  name: string;
  partNumber?: string;
  quantity: number;
  children: AssemblyNode[];
}

interface AssemblyMetadata {
  isAssembly: boolean;
  partCount: number;
  hierarchy: AssemblyNode[];
  rootName?: string;
}

/**
 * Parse STEP file text content to extract assembly structure.
 * STEP files are text-based and contain structured data about parts and assemblies.
 */
function parseStepContent(content: string): AssemblyMetadata {
  // Extract PRODUCT definitions - these define individual parts/assemblies
  // Format: PRODUCT('name','description','part_number',(context));
  const productRegex =
    /PRODUCT\s*\(\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'/gi;
  const products = new Map<string, { name: string; partNumber: string }>();

  // Extract PRODUCT_DEFINITION - links products to their definitions
  // Format: #123 = PRODUCT_DEFINITION(...,#productId,...);
  const productDefRegex =
    /#(\d+)\s*=\s*PRODUCT_DEFINITION\s*\([^)]*,\s*#(\d+)/gi;
  const productDefs = new Map<string, string>();

  // Extract NEXT_ASSEMBLY_USAGE_OCCURRENCE - defines parent-child relationships
  // Format: NEXT_ASSEMBLY_USAGE_OCCURRENCE('id','name','desc',#parent,#child,...);
  const assemblyRegex =
    /NEXT_ASSEMBLY_USAGE_OCCURRENCE\s*\(\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'[^']*'\s*,\s*#(\d+)\s*,\s*#(\d+)/gi;
  const assemblyRelations: Array<{
    id: string;
    name: string;
    parentId: string;
    childId: string;
  }> = [];

  // Find all entity ID to PRODUCT mappings
  const entityProductRegex = /#(\d+)\s*=\s*PRODUCT\s*\(\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'/gi;
  const entityToProduct = new Map<
    string,
    { name: string; description: string; partNumber: string }
  >();

  let match;

  // Parse entity-to-product mappings
  while ((match = entityProductRegex.exec(content)) !== null) {
    const [, entityId, name, description, partNumber] = match;
    entityToProduct.set(entityId, {
      name: name || description || `Part_${entityId}`,
      description,
      partNumber,
    });
  }

  // Parse product definitions (maps product_definition entity to product entity)
  while ((match = productDefRegex.exec(content)) !== null) {
    const [, defId, productId] = match;
    productDefs.set(defId, productId);
  }

  // Parse assembly relationships
  while ((match = assemblyRegex.exec(content)) !== null) {
    const [, id, name, parentId, childId] = match;
    assemblyRelations.push({ id, name, parentId, childId });
  }

  // Build hierarchy from relationships
  const childToParent = new Map<string, string>();
  const parentToChildren = new Map<string, string[]>();

  for (const rel of assemblyRelations) {
    childToParent.set(rel.childId, rel.parentId);
    const children = parentToChildren.get(rel.parentId) || [];
    children.push(rel.childId);
    parentToChildren.set(rel.parentId, children);
  }

  // Find root nodes (entities with no parent)
  const allChildIds = new Set(assemblyRelations.map((r) => r.childId));
  const allParentIds = new Set(assemblyRelations.map((r) => r.parentId));
  const rootIds = [...allParentIds].filter((id) => !allChildIds.has(id));

  // Get product info for an entity ID
  const getProductInfo = (entityId: string) => {
    // First try direct lookup
    if (entityToProduct.has(entityId)) {
      return entityToProduct.get(entityId)!;
    }
    // Try through product definition
    const productId = productDefs.get(entityId);
    if (productId && entityToProduct.has(productId)) {
      return entityToProduct.get(productId)!;
    }
    return { name: `Entity_${entityId}`, description: "", partNumber: "" };
  };

  // Count occurrences of each child
  const childCounts = new Map<string, number>();
  for (const rel of assemblyRelations) {
    childCounts.set(rel.childId, (childCounts.get(rel.childId) || 0) + 1);
  }

  // Build tree recursively
  const buildNode = (entityId: string, visited = new Set<string>()): AssemblyNode => {
    if (visited.has(entityId)) {
      // Prevent circular references
      const info = getProductInfo(entityId);
      return {
        id: entityId,
        name: info.name,
        partNumber: info.partNumber || undefined,
        quantity: 1,
        children: [],
      };
    }
    visited.add(entityId);

    const info = getProductInfo(entityId);
    const childIds = parentToChildren.get(entityId) || [];

    // Group children by their product to count quantities
    const childGroups = new Map<string, { count: number; entityId: string }>();
    for (const childId of childIds) {
      const childInfo = getProductInfo(childId);
      const key = `${childInfo.name}_${childInfo.partNumber}`;
      const existing = childGroups.get(key);
      if (existing) {
        existing.count++;
      } else {
        childGroups.set(key, { count: 1, entityId: childId });
      }
    }

    const children: AssemblyNode[] = [];
    for (const [, group] of childGroups) {
      const childNode = buildNode(group.entityId, new Set(visited));
      childNode.quantity = group.count;
      children.push(childNode);
    }

    return {
      id: entityId,
      name: info.name,
      partNumber: info.partNumber || undefined,
      quantity: 1,
      children,
    };
  };

  // Build hierarchy from roots
  const hierarchy: AssemblyNode[] = rootIds.map((rootId) => buildNode(rootId));

  // Count total unique parts
  const countParts = (nodes: AssemblyNode[]): number => {
    let count = 0;
    for (const node of nodes) {
      if (node.children.length === 0) {
        count += node.quantity;
      } else {
        count += countParts(node.children);
      }
    }
    return count;
  };

  const partCount = entityToProduct.size;
  const isAssembly = assemblyRelations.length > 0;

  return {
    isAssembly,
    partCount,
    hierarchy,
    rootName: hierarchy.length > 0 ? hierarchy[0].name : undefined,
  };
}

/**
 * Trigger.dev task to parse STEP files and extract assembly metadata
 */
export const stepParserTask = task({
  id: "step-parser",
  retry: {
    maxAttempts: 3,
    minTimeoutInMs: 1000,
    maxTimeoutInMs: 30000,
  },
  run: async (payload: { modelId: string; companyId: string; modelPath: string }) => {
    const { modelId, companyId, modelPath } = payload;

    logger.info("Starting STEP parser task", { modelId, companyId, modelPath });

    const client = getCarbonServiceRole();

    // Update status to processing
    const { error: statusError } = await client
      .from("modelUpload")
      .update({ parsingStatus: "processing" })
      .eq("id", modelId);

    if (statusError) {
      console.error("Failed to update parsing status to processing", {
        modelId,
        error: statusError.message,
      });
    }

    try {
      // Download the STEP file from storage
      logger.info("Downloading STEP file", { modelPath });
      const { data: fileData, error: downloadError } = await client.storage
        .from("private")
        .download(modelPath);

      if (downloadError || !fileData) {
        throw new Error(`Failed to download file: ${downloadError?.message}`);
      }

      // Read file content as text (STEP files are text-based)
      const content = await fileData.text();
      logger.info("File downloaded", { size: content.length });

      // Parse the STEP content
      const assemblyMetadata = parseStepContent(content);
      logger.info("Parsed assembly metadata", {
        isAssembly: assemblyMetadata.isAssembly,
        partCount: assemblyMetadata.partCount,
        hierarchyDepth: assemblyMetadata.hierarchy.length,
      });

      // Update the modelUpload record with parsed metadata
      const { error: updateError } = await client
        .from("modelUpload")
        .update({
          assemblyMetadata,
          parsingStatus: "completed",
          parsedAt: new Date().toISOString(),
          parsingError: null,
        })
        .eq("id", modelId);

      if (updateError) {
        console.error("Failed to update model metadata", {
          modelId,
          error: updateError.message,
        });
        throw new Error(`Failed to update metadata: ${updateError.message}`);
      }

      logger.info("STEP parsing completed", { modelId });

      return {
        success: true,
        modelId,
        isAssembly: assemblyMetadata.isAssembly,
        partCount: assemblyMetadata.partCount,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      logger.error("STEP parsing failed", { modelId, error: errorMessage });

      // Update status to failed
      await client
        .from("modelUpload")
        .update({
          parsingStatus: "failed",
          parsingError: errorMessage,
        })
        .eq("id", modelId);

      throw error;
    }
  },
});
