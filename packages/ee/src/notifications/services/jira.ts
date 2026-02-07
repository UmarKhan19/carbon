import { getUser } from "@carbon/auth";
import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TiptapDocument } from "../../jira/lib";
import {
  getJiraClient,
  getJiraIssueFromExternalId,
  mapCarbonStatusToJiraStatus,
  tiptapToMarkdown
} from "../../jira/lib";
import type { NotificationEvent, NotificationService } from "../types";

const jira = getJiraClient();

/**
 * JIRA Notification Service
 * Updates JIRA issues based on Carbon notification events
 */
export class JiraNotificationService implements NotificationService {
  id = "jira";
  name = "JIRA";

  async send(
    event: NotificationEvent,
    context: { serviceRole: SupabaseClient<Database> }
  ): Promise<void> {
    switch (event.type) {
      case "task.status.changed": {
        if (!["action", "investigation"].includes(event.data.type)) return;

        const issue = await getJiraIssueFromExternalId(
          context.serviceRole,
          event.companyId,
          event.data.id
        );

        if (!issue) return;

        const transitions = await jira.getAvailableTransitions(
          event.companyId,
          issue.id
        );

        const statusName = mapCarbonStatusToJiraStatus(event.data.status);
        const transition = transitions.find(
          (t) =>
            t.to.statusCategory.key.toLowerCase() === statusName.toLowerCase()
        );

        if (transition) {
          await jira.transitionIssue(event.companyId, issue.id, transition.id);
        }

        break;
      }

      case "task.assigned": {
        if (event.data.table !== "nonConformanceActionTask") return;

        const issue = await getJiraIssueFromExternalId(
          context.serviceRole,
          event.companyId,
          event.data.id
        );

        if (!issue) return; // No linked JIRA issue

        const { data: user } = await getUser(
          context.serviceRole,
          event.data.assignee
        );

        if (!user) return; // No assignee user

        const jiraUsers = await jira.getUsers(
          event.companyId,
          issue.key.split("-")[0] // Extract project key
        );

        const jiraUser = jiraUsers.find((u) => u.emailAddress === user.email);

        if (!jiraUser) return;

        await jira.updateIssue(event.companyId, {
          issueId: issue.id,
          assigneeAccountId: jiraUser.accountId
        });
        break;
      }

      case "task.notes.changed": {
        if (event.data.table !== "nonConformanceActionTask") return;

        const issue = await getJiraIssueFromExternalId(
          context.serviceRole,
          event.companyId,
          event.data.id
        );

        if (!issue) return; // No linked JIRA issue

        // Convert Tiptap notes to markdown for JIRA
        const notes = event.data.notes as TiptapDocument | null | undefined;
        if (!notes) return;

        try {
          const description = tiptapToMarkdown(notes);

          await jira.updateIssue(event.companyId, {
            issueId: issue.id,
            description
          });
        } catch (error) {
          console.error("Failed to update JIRA issue description:", error);
        }

        break;
      }
    }
  }
}
