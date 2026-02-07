/**
 * Maps JIRA status category keys to Carbon task status
 * JIRA status categories: todo, in_progress, done
 */
export function mapJiraStatusToCarbonStatus(
  jiraStatusType: string
): "Pending" | "In Progress" | "Completed" | "Skipped" {
  switch (jiraStatusType.toLowerCase()) {
    case "todo":
    case "new":
    case "backlog":
      return "Pending";
    case "in_progress":
    case "in progress":
      return "In Progress";
    case "done":
    case "completed":
      return "Completed";
    default:
      return "Pending";
  }
}

/**
 * Maps Carbon task status to JIRA status type
 */
export function mapCarbonStatusToJiraStatus(carbonStatus: string): string {
  switch (carbonStatus) {
    case "Pending":
      return "todo";
    case "In Progress":
      return "in_progress";
    case "Completed":
      return "done";
    case "Skipped":
      return "done";
    default:
      return "todo";
  }
}

/**
 * Gets the transition ID for a given JIRA status
 * This is used when updating issue status via transitions
 */
export function getJiraTransitionIdForStatus(
  carbonStatus: string,
  availableTransitions: Array<{ id: string; to: { id: string; name: string } }>
): string | null {
  const targetStatus = mapCarbonStatusToJiraStatus(carbonStatus);

  // Try to find the transition by matching the target status name
  const transition = availableTransitions.find(
    (t) =>
      t.to.name.toLowerCase() === targetStatus.toLowerCase() ||
      t.to.name
        .toLowerCase()
        .includes(targetStatus.split("_").join(" ").toLowerCase())
  );

  return transition?.id || null;
}
