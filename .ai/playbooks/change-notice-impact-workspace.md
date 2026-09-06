# Change Notice Impact workspace

Last tested: 2026-09-05
Route: `/x/items/change-notice/:id/impact`

## Prerequisites
- Local Carbon ERP dev server is running.
- The seeded company has at least one Change Notice with affected items and supported production or purchasing records.

## Steps
### 1. Navigate
Open Items → Change Notices and open a Change Notice, then select **Open Impact workspace**. The page should show the Operational Impact heading, engineering status, coverage cards, and current/historical sections.

### 2. Verify read-only exposure
Confirm supported rows are grouped by readable PO/Job, producing Job and Job Material rows are distinct, current rows show source facts and an **Open source** link, the **Informational context only** notice is visible instead of legacy mixed-domain rows, and no decision/filter/search controls are present.

### 3. Verify refresh and navigation
Select **Refresh** and confirm the same workspace reloads. Select **Open source** on a supported row and confirm it navigates to the corresponding source detail, then return to the workspace.

### 4. Verify layout
Scroll the content pane through the full workspace. Confirm the content scrolls vertically without horizontal overflow and the browser console has no errors.

## Selector Notes
- Navigate through visible labels rather than cached accessibility refs.
- Use the **Open Impact workspace**, **Refresh**, and **Open source** link names.
- Coverage warnings and restricted/partial behavior are best verified with the focused service tests when the seeded browser user has full source access.

## Common Failures
- Login may take several seconds while the local Turnstile bypass initializes; wait before submitting the email form.
- A seeded Change Notice may have no historical rows; use the focused Impact tests for historical/source-coverage edge cases.
