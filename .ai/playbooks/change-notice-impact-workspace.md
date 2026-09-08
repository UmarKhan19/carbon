# Change Notice Impact workspace

Last tested: 2026-09-08 (Slice 5E authenticated browser QA and automated checks)
Route: `/x/items/change-notice/:id/impact`

## Prerequisites
- Local Carbon ERP dev server is running.
- The seeded company has at least one Change Notice with affected items and supported production or purchasing records.

> Slice 5D browser note: seeded CN-000001, CN-000002, and CN-000003 all reported complete task coverage. The incomplete task/candidate coverage warning path is covered by automated tests, but was not available in the seeded browser data.

## Steps
### 1. Navigate
Open Items → Change Notices and open a Change Notice, then select **Open Impact workspace**. The page should show the Operational Impact heading, engineering status, coverage cards, and current/historical sections.

### 2. Verify read-only exposure
Confirm supported rows are grouped by readable PO/Job, producing Job and Job Material rows are distinct, current rows show source facts and an **Open source** link, the **Informational context only** notice is visible instead of legacy mixed-domain rows. Verify decision controls appear according to assessment eligibility. Use the **Search** and **Filter** controls to narrow rows without changing the authoritative coverage cards.

### 3. Verify search and filters
Search a PO readable ID, producing Job readable ID, item/revision label, and supplier name. Confirm search is case-insensitive and trimmed. Apply Domain, Exposure, Decision, Freshness, Availability, Task status, and Assignee filters; select multiple values in one dimension to confirm OR behavior and combine dimensions to confirm AND behavior. Confirm filtered child rows keep their document group, nonmatching siblings disappear, and empty groups are not shown. Use browser back/forward and **Clear Filters** to confirm the URL-backed state restores and clears correctly. If linked-task coverage is incomplete, confirm task/assignee filtering shows the bounded metadata warning rather than implying missing tasks are absent.

### 4. Verify refresh and navigation
With search or filters active, select **Refresh** and confirm the workspace data reloads without clearing the URL state. Select **Open source** on a supported row and confirm it navigates to the corresponding source detail, then return to the workspace.

### 5. Verify layout
Scroll the content pane through the full workspace. Confirm the content scrolls vertically without horizontal overflow and the browser console has no errors.

### 6. Verify Impact task controls
On a Done or Cancelled Change Notice with an existing Action required Impact decision, open the Impact workspace and confirm **Create follow-up** is visible. Open it and verify the form contains task name, assignee, due date, and notes fields, but no first-assessment rationale; cancel without submitting. On an unassessed row, including an unassessed Cancelled row, confirm **Create follow-up** is not shown.

### 7. Verify lazy Impact history
On a row with an existing Impact decision, confirm **History** is visible. Open it and verify the drawer shows the current conclusion and source facts before the event timeline. Confirm the browser requests one decision-specific `/impact/history/<decisionId>` resource only after opening the drawer. Verify assessment events show conclusion changes, rationale, resolution notes, and expandable snapshots; task events show the task label or a details-unavailable fallback; provenance events show the affected-item label. Close the drawer and confirm the workspace remains usable.

### 8. Verify Slice 5E bulk Impact selection
On a Change Notice with at least two eligible current production targets, select rows individually and confirm the count, **Review selected**, and **Clear selection** controls. There is no Select All or Clear Visible control. Open **Review selected** and verify each target's domain/identity, current conclusion, and snapshot facts are listed; confirm the available conclusion options are the intersection of the selected targets' valid operations. Choose the shared conclusion, enter the review rationale, and click the visible **Apply to <count>** button. Verify exactly one bulk POST, one workspace revalidation, the expected success/no-op message, cleared selection, and a closed drawer. Re-submit the same conclusion and rationale to verify the no-op state and that History has no new event. Search and refresh should preserve or reconcile the selection without writing.

Slice 5E browser coverage on seeded data did not include PO targets, Changed-since facts, or a clean stale-preview conflict fixture. Those paths remain covered by focused tests until safe fixtures exist.

## Selector Notes
- Navigate through visible labels rather than cached accessibility refs.
- Use the **Open Impact workspace**, **Refresh**, and **Open source** link names.
- Coverage warnings and restricted/partial behavior are best verified with the focused service tests when the seeded browser user has full source access.

## Common Failures
- Login may take several seconds while the local Turnstile bypass initializes; wait before submitting the email form.
- A seeded Change Notice may have no historical rows; use the focused Impact tests for historical/source-coverage edge cases.
