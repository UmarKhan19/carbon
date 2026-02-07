import { getCarbonServiceRole } from "@carbon/auth";
import axios, { type AxiosInstance } from "axios";
import type z from "zod";
import type { JiraIssueSchema } from "./service";
import { getJiraIntegration } from "./service";

export type JiraIssue = z.infer<typeof JiraIssueSchema>;

export interface JiraProject {
  id: string;
  name: string;
  key: string;
}

export interface JiraUser {
  accountId: string;
  emailAddress: string;
  displayName: string;
}

export interface JiraStatus {
  self: string;
  description: string;
  iconUrl: string;
  name: string;
  id: string;
  statusCategory: {
    self: string;
    id: number;
    key: string;
    colorName: string;
    name: string;
  };
}

interface AuthHeaders {
  Authorization: string;
  baseURL: string;
}

export class JiraClient {
  instance: AxiosInstance;

  constructor() {
    this.instance = axios.create({
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      }
    });
  }

  async getAuthHeaders(companyId: string): Promise<AuthHeaders> {
    const serviceRole = getCarbonServiceRole();

    const { data } = await getJiraIntegration(serviceRole, companyId);

    const integration = data?.[0];

    if (!integration) {
      throw new Error("JIRA integration not found for company");
    }

    const metadata = integration.metadata as {
      domain: string;
      email: string;
      apiToken: string;
    };

    const credentials = Buffer.from(
      `${metadata.email}:${metadata.apiToken}`
    ).toString("base64");

    return {
      Authorization: `Basic ${credentials}`,
      baseURL: `https://${metadata.domain}/rest/api/3`
    };
  }

  async healthcheck(companyId: string) {
    try {
      const headers = await this.getAuthHeaders(companyId);
      const response = await this.instance.get(`${headers.baseURL}/myself`, {
        headers: { Authorization: headers.Authorization }
      });

      return response.status === 200;
    } catch {
      return false;
    }
  }

  async listProjects(companyId: string) {
    try {
      const headers = await this.getAuthHeaders(companyId);
      const response = await this.instance.get<{ values: JiraProject[] }>(
        `${headers.baseURL}/project/search`,
        {
          headers: { Authorization: headers.Authorization },
          params: { maxResults: 50 }
        }
      );

      return response.data.values.map((el) => el);
    } catch (error) {
      console.error("Error listing JIRA projects:", error);
      return [];
    }
  }

  async searchIssues(companyId: string, jql: string) {
    try {
      const headers = await this.getAuthHeaders(companyId);
      const domain = headers.baseURL.split("/rest/api/3")[0];

      const response = await this.instance.get<{
        issues: Array<{
          id: string;
          key: string;
          fields: {
            summary: string;
            description: string | null;
            status: JiraStatus;
            assignee: JiraUser | null;
            duedate: string | null;
          };
        }>;
      }>(`${headers.baseURL}/search`, {
        headers: { Authorization: headers.Authorization },
        params: {
          jql,
          fields: [
            "summary",
            "description",
            "status",
            "assignee",
            "duedate"
          ].join(","),
          maxResults: 5
        }
      });

      return response.data.issues.map((el) => ({
        id: el.id,
        key: el.key,
        title: el.fields.summary,
        description: el.fields.description || "",
        state: {
          name: el.fields.status.name,
          type: el.fields.status.statusCategory.key,
          color: el.fields.status.statusCategory.colorName
        },
        assignee: el.fields.assignee
          ? { email: el.fields.assignee.emailAddress }
          : null,
        dueDate: el.fields.duedate,
        url: `${domain}/browse/${el.key}`
      }));
    } catch (error) {
      console.error("Error searching JIRA issues:", error);
      return [];
    }
  }

  async getIssueById(companyId: string, issueId: string) {
    try {
      const headers = await this.getAuthHeaders(companyId);
      const domain = headers.baseURL.split("/rest/api/3")[0];

      const response = await this.instance.get<{
        id: string;
        key: string;
        fields: {
          summary: string;
          description: string | null;
          status: JiraStatus;
          assignee: JiraUser | null;
          duedate: string | null;
        };
      }>(`${headers.baseURL}/issue/${issueId}`, {
        headers: { Authorization: headers.Authorization },
        params: {
          fields: [
            "summary",
            "description",
            "status",
            "assignee",
            "duedate"
          ].join(",")
        }
      });

      return {
        id: response.data.id,
        key: response.data.key,
        title: response.data.fields.summary,
        description: response.data.fields.description || "",
        state: {
          name: response.data.fields.status.name,
          type: response.data.fields.status.statusCategory.key,
          color: response.data.fields.status.statusCategory.colorName
        },
        assignee: response.data.fields.assignee
          ? { email: response.data.fields.assignee.emailAddress }
          : null,
        dueDate: response.data.fields.duedate,
        url: `${domain}/browse/${response.data.key}`
      };
    } catch (error) {
      console.error("Error getting JIRA issue by ID:", error);
      return null;
    }
  }

  async createIssue(
    companyId: string,
    data: {
      projectKey: string;
      title: string;
      description?: string;
      assigneeAccountId?: string | null;
    }
  ) {
    try {
      const headers = await this.getAuthHeaders(companyId);
      const response = await this.instance.post<{
        id: string;
        key: string;
      }>(
        `${headers.baseURL}/issue`,
        {
          fields: {
            project: { key: data.projectKey },
            summary: data.title,
            description: data.description || "",
            assignee: data.assigneeAccountId
              ? { accountId: data.assigneeAccountId }
              : null,
            issuetype: { name: "Task" }
          }
        },
        {
          headers: { Authorization: headers.Authorization }
        }
      );

      return await this.getIssueById(companyId, response.data.id);
    } catch (error) {
      console.error("Error creating JIRA issue:", error);
      return null;
    }
  }

  async updateIssue(
    companyId: string,
    data: {
      issueId: string;
      title?: string;
      description?: string;
      assigneeAccountId?: string | null;
      statusId?: string;
    }
  ) {
    try {
      const headers = await this.getAuthHeaders(companyId);
      const updateData: Record<string, unknown> = {};

      if (data.title) updateData.summary = data.title;
      if (data.description) updateData.description = data.description;
      if (data.assigneeAccountId !== undefined) {
        updateData.assignee = data.assigneeAccountId
          ? { accountId: data.assigneeAccountId }
          : null;
      }

      await this.instance.put(
        `${headers.baseURL}/issue/${data.issueId}`,
        {
          fields: updateData
        },
        {
          headers: { Authorization: headers.Authorization }
        }
      );

      return await this.getIssueById(companyId, data.issueId);
    } catch (error) {
      console.error("Error updating JIRA issue:", error);
      return null;
    }
  }

  async transitionIssue(
    companyId: string,
    issueId: string,
    transitionId: string
  ) {
    try {
      const headers = await this.getAuthHeaders(companyId);
      await this.instance.post(
        `${headers.baseURL}/issue/${issueId}/transitions`,
        {
          transition: { id: transitionId }
        },
        {
          headers: { Authorization: headers.Authorization }
        }
      );

      return true;
    } catch (error) {
      console.error("Error transitioning JIRA issue:", error);
      return false;
    }
  }

  async getAvailableTransitions(companyId: string, issueId: string) {
    try {
      const headers = await this.getAuthHeaders(companyId);
      const response = await this.instance.get<{
        transitions: Array<{
          id: string;
          name: string;
          to: JiraStatus;
        }>;
      }>(`${headers.baseURL}/issue/${issueId}/transitions`, {
        headers: { Authorization: headers.Authorization }
      });

      return response.data.transitions;
    } catch (error) {
      console.error("Error getting JIRA transitions:", error);
      return [];
    }
  }

  async getUsers(companyId: string, projectKey: string) {
    try {
      const headers = await this.getAuthHeaders(companyId);
      const response = await this.instance.get<JiraUser[]>(
        `${headers.baseURL}/user/assignable/search`,
        {
          headers: { Authorization: headers.Authorization },
          params: { project: projectKey, maxResults: 50 }
        }
      );

      return response.data;
    } catch (error) {
      console.error("Error getting JIRA users:", error);
      return [];
    }
  }

  async addIssueLink(
    companyId: string,
    issueId: string,
    linkData: {
      url: string;
      title: string;
    }
  ) {
    try {
      const headers = await this.getAuthHeaders(companyId);
      await this.instance.post(
        `${headers.baseURL}/issue/${issueId}/remotelink`,
        {
          object: {
            url: linkData.url,
            title: linkData.title
          }
        },
        {
          headers: { Authorization: headers.Authorization }
        }
      );

      return true;
    } catch (error) {
      console.error("Error adding JIRA issue link:", error);
      return false;
    }
  }
}

let instance: JiraClient | null = null;

export const getJiraClient = () => {
  if (!instance) instance = new JiraClient();
  return instance;
};
