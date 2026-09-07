# Change Notice Impact workspace

Last tested: 2026-09-07
Route: `/x/items/change-notice/:id/impact`

## Prerequisites
- Local Carbon ERP dev server is running.
- The seeded company has at least one Change Notice with affected items and supported production or purchasing records.

## Steps
### 1. Navigate
Open Items → Change Notices and open a Change Notice, then select **Open Impact workspace**. The page should show the Operational Impact heading, engineering status, coverage cards, and current/historical sections.

### 2. Verify read-only exposure
Confirm supported rows are grouped by readable PO/Job, producing Job and Job Material rows are distinct, current rows show source facts and an **Open source** link, the **Informational context only** notice is visible instead of legacy mixed-domain rows. Verify decision controls appear according to assessment eligibility. Filter/search controls are not part of the current slice.

### 3. Verify refresh and navigation
Select **Refresh** and confirm the same workspace reloads. Select **Open source** on a supported row and confirm it navigates to the corresponding source detail, then return to the workspace.

### 4. Verify layout
Scroll the content pane through the full workspace. Confirm the content scrolls vertically without horizontal overflow and the browser console has no errors.

### 5. Verify Impact task controls
On a Done or Cancelled Change Notice with an existing Action required Impact decision, open the Impact workspace and confirm **Create follow-up** is visible. Open it and verify the form contains task name, assignee, due date, and notes fields, but no first-assessment rationale; cancel without submitting. On an unassessed row, including an unassessed Cancelled row, confirm **Create follow-up** is not shown.

### 6. Verify lazy Impact history
On a row with an existing Impact decision, confirm **History** is visible. Open it and verify the drawer shows the current conclusion and source facts before the event timeline. Confirm the browser requests one decision-specific `/impact/history/<decisionId>` resource only after opening the drawer. Verify assessment events show conclusion changes, rationale, resolution notes, and expandable snapshots; task events show the task label or a details-unavailable fallback; provenance events show the affected-item label. Close the drawer and confirm the workspace remains usable.

## Selector Notes
- Navigate through visible labels rather than cached accessibility refs.
- Use the **Open Impact workspace**, **Refresh**, and **Open source** link names.
- Coverage warnings and restricted/partial behavior are best verified with the focused service tests when the seeded browser user has full source access.

## Common Failures
- Login may take several seconds while the local Turnstile bypass initializes; wait before submitting the email form.
- A seeded Change Notice may have no historical rows; use the focused Impact tests for historical/source-coverage edge cases.
