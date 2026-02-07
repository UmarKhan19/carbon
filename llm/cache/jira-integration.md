# JIRA Integration - Implementation Guide

## Overview

The JIRA integration for Carbon allows synchronization of Quality Management issues (non-conformances) with JIRA issues. It provides two-way synchronization between Carbon action tasks and JIRA issues, similar to the Linear integration.

## Architecture

### Integration Setup

**Configuration File:** `/packages/ee/src/jira/config.tsx`

- Integration name: "JIRA"
- Category: "Project Management"
- Required settings:
  - `domain`: JIRA domain (e.g., your-domain.atlassian.net)
  - `email`: Email address associated with JIRA account
  - `apiToken`: API token for authentication

### Key Components Implemented

#### 1. JIRA Client (`/packages/ee/src/jira/lib/client.ts`)

REST API client for JIRA that provides:

- `healthcheck(companyId)` - Verify integration connectivity
- `listProjects(companyId)` - Get all JIRA projects
- `searchIssues(companyId, jql)` - Search issues by JQL query
- `getIssueById(companyId, issueId)` - Fetch specific issue with full details
- `createIssue(companyId, data)` - Create new JIRA issue
- `updateIssue(companyId, data)` - Update issue title, description, assignee
- `transitionIssue(companyId, issueId, transitionId)` - Change issue status
- `getAvailableTransitions(companyId, issueId)` - Get available status transitions
- `getUsers(companyId, projectKey)` - Get assignable users in project
- `addIssueLink(companyId, issueId, linkData)` - Add remote link to issue

**Authentication:**

- Uses Basic Auth with email + API token
- Credentials encoded to Base64
- API endpoint: `https://{domain}/rest/api/3`

#### 2. Service Layer (`/packages/ee/src/jira/lib/service.ts`)

**Data Types:**

```typescript
JiraIssueSchema = {
  id: string,
  key: string,
  title: string,
  description: string | null,
  url: string,
  state: {
    name: string,
    type: string, // todo, in_progress, done
    color: string,
  },
  dueDate: string | null,
  assignee: { email: string } | null,
};
```

**Functions:**

- `linkActionToJiraIssue()` - Links Carbon action task to JIRA issue

  - Creates/updates row in `externalIntegrationMapping` with `entityType='nonConformanceActionTask'`, `integration='jira'`
  - Stores JIRA issue data in `metadata` JSONB field
  - Updates assignee if JIRA assignee matches Carbon employee
  - Syncs status and due date
  - Returns `nonConformanceId` for creating backlink

- `unlinkActionFromJiraIssue()` - Removes link by deleting the `externalIntegrationMapping` row

- `getJiraIssueFromExternalId()` - Retrieves JIRA issue data from `externalIntegrationMapping.metadata`

- `getCompanyEmployees()` - Finds Carbon employees by email addresses

#### 3. Status Mapping (`/packages/ee/src/jira/lib/utils.ts`)

**JIRA Status Categories → Carbon Status:**

- `todo`, `new`, `backlog` → Carbon "Pending"
- `in_progress`, `in progress` → Carbon "In Progress"
- `done`, `completed` → Carbon "Completed"

**Reverse Mapping (Carbon → JIRA):**

- "Pending" → `todo`
- "In Progress" → `in_progress`
- "Completed" → `done`
- "Skipped" → `done`

#### 4. Rich Text Conversion (`/packages/ee/src/jira/lib/richtext.ts`)

- `markdownToTiptap()` - Converts JIRA descriptions to Carbon notes
- `tiptapToMarkdown()` - Converts Carbon notes back to JIRA

#### 5. Notification Service (`/packages/ee/src/notifications/services/jira.ts`)

Listens for Carbon events and updates JIRA:

**Event: `task.status.changed`**

- Gets linked JIRA issue from `externalIntegrationMapping`
- Maps Carbon status to JIRA workflow transition
- Uses available transitions to update JIRA issue status

**Event: `task.assigned`**

- Gets linked JIRA issue
- Finds JIRA user by Carbon employee email
- Updates JIRA issue assignee

**Event: `task.notes.changed`**

- Converts Tiptap notes to Markdown
- Updates JIRA issue description

#### 6. Barrel Export (`/packages/ee/src/jira/lib/index.ts`)

Exports all public JIRA functions for easy importing.

## Remaining Implementation Steps

### 1. API Routes

Create three API route files:

**A. Link/Unlink Issue Route** (`/apps/erp/app/routes/api+/integrations.jira.issue.link.ts`)

```typescript
// POST: Links action to JIRA issue
// DELETE: Unlinks by deleting mapping
// GET: Searches JIRA issues by title
```

**B. Create Issue Route** (`/apps/erp/app/routes/api+/integrations.jira.issue.create.ts`)

```typescript
// POST: Creates new JIRA issue and links to Carbon action
// GET: Lists JIRA projects and optional team members
```

**C. Webhook Route** (`/apps/erp/app/routes/api+/webhook.jira.$companyId.ts`)

```typescript
// POST: Receives JIRA webhook events
// Validates company and integration active status
// Triggers Trigger.dev task for async processing
```

### 2. Background Task

Create Trigger.dev task (`/packages/jobs/trigger/jira.ts`):

```typescript
// Task ID: sync-issue-from-jira
// Accepts event type: Issue with action: updated
// Finds linked Carbon action via externalIntegrationMapping
// Maps JIRA assignee to Carbon employee (by email)
// Updates Carbon action task with:
//   - Latest JIRA issue state (title, description, state, url)
//   - Mapped status from JIRA status type
//   - Assignee from JIRA (if employee exists)
//   - Due date from JIRA
```

### 3. UI Components

Create React components in `/apps/erp/app/modules/quality/ui/Issue/Jira/`:

**A. `IssueDialog.tsx`** - Modal for linking/creating JIRA issues
**B. `LinkIssue.tsx`** - Search and link existing JIRA issues
**C. `CreateIssue.tsx`** - Form to create new JIRA issues

### 4. IssueTask Component Update

Update `/apps/erp/app/modules/quality/ui/Issue/IssueTask.tsx`:

- Import JIRA UI components
- Add JIRA issue display badge similar to Linear
- Show JIRA issue key and link to JIRA issue URL

### 5. Integration Registration

Add JIRA integration to the system:

1. Register in notification service registry (`/packages/ee/src/notifications/index.ts`)
2. Add JIRA to integration index/exports
3. Database migration (if needed) to register integration in `integration` table

## Data Flow

### Linking Flow (Carbon → JIRA)

1. User selects JIRA issue or creates new one in Carbon UI
2. Carbon fetches issue details from JIRA API
3. Carbon creates `externalIntegrationMapping` row linking the action task to the JIRA issue
4. Carbon syncs assignee (if JIRA assignee email matches Carbon employee)
5. Carbon adds remote link in JIRA pointing back to Carbon issue

### Webhook Flow (JIRA → Carbon)

1. User updates issue in JIRA (status, assignee, title, etc.)
2. JIRA sends webhook to `/api/webhook/jira/:companyId`
3. Carbon validates and triggers Trigger.dev task
4. Task finds linked Carbon action by JIRA issue ID
5. Task updates Carbon action with JIRA changes
6. Assignee synced if JIRA user email matches Carbon employee

### Notification Flow (Carbon → JIRA)

1. User changes task status or assignee in Carbon
2. Carbon notification pipeline detects change
3. If JIRA integration is active, notification service triggers
4. Service finds linked JIRA issue from `externalIntegrationMapping`
5. Service updates JIRA issue via API

## Database Schema

**Storage of Link (externalIntegrationMapping table):**

```sql
-- Example JIRA integration mapping
entityType = 'nonConformanceActionTask'
entityId = <action task ID>
integration = 'jira'
externalId = <JIRA issue ID>
metadata = {
  "id": "10000",
  "key": "PROJ-123",
  "title": "Fix widget bug",
  "description": "The widget is broken...",
  "url": "https://your-domain.atlassian.net/browse/PROJ-123",
  "state": { "name": "In Progress", "type": "in_progress", "color": "blue" },
  "dueDate": "2026-02-15" | null,
  "assignee": { "email": "user@example.com" } | null
}
companyId = <company ID>
```

## Setup Instructions (for users)

1. Login to your JIRA account
2. Go to account.atlassian.com → Security → API tokens
3. Create new API token and copy it
4. In Carbon, go to Settings → Integrations → JIRA
5. Enter your JIRA domain (e.g., your-domain.atlassian.net)
6. Enter your email address
7. Paste your API token
8. Save integration
9. Go to your JIRA instance Settings → Webhooks
10. Create webhook with URL: `https://app.carbon.ms/api/webhook/jira/{companyId}`
11. Configure to listen for: Issue Updated events

## Important Notes

- Only **action tasks** can be linked to JIRA issues (not investigation or approval tasks)
- Assignee sync requires matching email between JIRA user and Carbon employee
- Two-way sync means changes in either system update the other
- JIRA issue data is stored in `externalIntegrationMapping` table
- Remote links in JIRA point back to Carbon issue details page
- Webhook processes updates asynchronously via Trigger.dev
- Integration must be active (`companyIntegration.active = true`) for notifications to flow
- JIRA uses REST API v3 (not GraphQL like Linear)
- Status mapping uses JIRA status category keys (todo, in_progress, done)

## Key Files Reference

**Packages:**

- `/packages/ee/src/jira/config.tsx` - Integration config
- `/packages/ee/src/jira/lib/client.ts` - REST API client
- `/packages/ee/src/jira/lib/service.ts` - Business logic
- `/packages/ee/src/jira/lib/utils.ts` - Status mapping
- `/packages/ee/src/jira/lib/richtext.ts` - Rich text conversion
- `/packages/ee/src/jira/lib/index.ts` - Barrel export
- `/packages/ee/src/notifications/services/jira.ts` - Notification handler

**Routes (TO BE CREATED):**

- `/apps/erp/app/routes/api+/webhook.jira.$companyId.ts` - Webhook endpoint
- `/apps/erp/app/routes/api+/integrations.jira.issue.link.ts` - Link/unlink API
- `/apps/erp/app/routes/api+/integrations.jira.issue.create.ts` - Create issue API

**Background Tasks (TO BE CREATED):**

- `/packages/jobs/trigger/jira.ts` - Webhook handler task

**UI (TO BE CREATED):**

- `/apps/erp/app/modules/quality/ui/Issue/Jira/LinkIssue.tsx`
- `/apps/erp/app/modules/quality/ui/Issue/Jira/CreateIssue.tsx`
- `/apps/erp/app/modules/quality/ui/Issue/Jira/IssueDialog.tsx`
- Update: `/apps/erp/app/modules/quality/ui/Issue/IssueTask.tsx`

## Comparison with Linear Integration

| Aspect            | Linear                     | JIRA                                        |
| ----------------- | -------------------------- | ------------------------------------------- |
| API Type          | GraphQL                    | REST v3                                     |
| Authentication    | API Key (Bearer)           | Basic Auth (email + token)                  |
| Status Model      | Workflow states with types | Status categories (todo, in_progress, done) |
| Status Transition | Direct state update        | Workflow transitions                        |
| Project Model     | Teams                      | Projects with keys                          |
| User Assignment   | By ID                      | By account ID                               |
| Rich Text         | Markdown                   | Markdown                                    |
| Webhook Setup     | URL + events configuration | URL + events configuration                  |

The JIRA integration follows the same pattern as Linear but adapted for JIRA's REST API and different status management model.
