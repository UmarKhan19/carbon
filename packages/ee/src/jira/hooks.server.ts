import { getJiraClient } from "./lib/client";

export async function jiraHealthcheck(
  companyId: string,
  _: Record<string, unknown>
) {
  const jira = getJiraClient();
  return await jira.healthcheck(companyId);
}
