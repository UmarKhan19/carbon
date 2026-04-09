Picking List — VER-INVENTORY-004

Verification ID: VER-INVENTORY-004
Test Object: Picking List
Requirement Ref(s): REQ-FUN-INVENTORY-004
Verification Method: I/A/D/T

  I (Inspection): Review BoM structure, item master batch rules (FIFO/LIFO/etc.), and MRP output used for prevaluation.
  A (Analysis): Validate logic determining item, batch, and quantity based on BoM and MRP calculations.
  D (Demonstration): Show Picking List creation, editing, and linkage to production orders.
  T (Test): Execute picking workflows to confirm correct valuation, traceability, and adherence to batch selection rules.

Assumptions / Scope
  Picking List is generated before production consumption.
  System auto-populates items, quantities, and proposed batches based on BoM and MRP.
  Users with permission may modify quantities/batches before confirmation.
  Batch selection respects warehouse allocation logic (FIFO/LIFO/custom).
  Traceability between Picking List and production order must be preserved.
  No assumptions about mobile app UI or scanner model.

Acceptance Criteria

ID
Acceptance Criterion
Method
AC-PICK-01
Picking List can be created for a production order before material consumption.
I/D
AC-PICK-02
Items on the Picking List are automatically populated according to BoM.
A/D
AC-PICK-03
Quantities are calculated correctly by MRP and displayed on the list.
A/T
AC-PICK-04
Batch selection respects defined warehouse allocation rules (FIFO/LIFO/etc.).
T
AC-PICK-05
Users can adjust quantities and batches before confirmation with appropriate permissions.
D/T
AC-PICK-06
Picking List maintains traceability to the associated production order.
I/D
AC-PICK-07
Final confirmation of the Picking List locks values and records audit.
I
AC-PICK-08
Picking List data is available to warehouse operators for staging materials.
D
AC-PICK-09
System prevents confirming a Picking List if required data (batch, qty) is missing.
T


Scenario Outlines

ID
Scenario Outline
Method
TV-PICK-01
Given a production order, when a Picking List is created, then items and quantities are auto-populated based on BoM + MRP.
D
TV-PICK-02
Given batch rules, when proposing a batch, the system selects one according to FIFO/LIFO/etc.
A/T
TV-PICK-03
Given user permissions, when editing the list, the user may change quantities/batches.
D/T
TV-PICK-04
Given missing required batch data, when confirming, the system prevents finalization.
T
TV-PICK-05
Given confirmation, when Picking List is finalized, the system locks values and logs changes.
I/D
TV-PICK-06
Given a Picking List, when viewing it from production, traceability to the order is visible.
D


Evidence to Capture

ID
Artifact
Verification
EV-PICK-01
Picking List creation screenshot.
I/D
EV-PICK-02
BoM and MRP-derived quantity calculation examples.
A
EV-PICK-03
Batch selection logs or screenshots.
T
EV-PICK-04
Edited Picking List before confirmation.
D
EV-PICK-05
Audit log showing confirmation and lock.
I
EV-PICK-06
Traceability chain: Production Order → Picking List.
D


Pass / Fail Rules
  PF-PICK-001: All AC-PICK-01…AC-PICK-09 verified with evidence.
  PF-PICK-002: No Critical/High issues open regarding batch selection, quantity valuation, or traceability.
  PF-PICK-003: Medium/Low issues documented and assigned.
  PF-PICK-004: Any future extensions (mobile app enhancements, pre-staging automation) formally acknowledged if excluded.

Picking List
Item Description
Picking List
Requirement ID
REQ-FUN-INVENTORY-004
Requirement Title
Picking List
Priority
Must
Requirement Description
Description
Currently, the valuation of the Picking List is performed during production operations using the mobile app, following the procedure below:
Current Workflow (Mobile App)
The operator scans the QR code with the production handheld device using the Material Consumption function.
The scanned code is searched in the database and linked to a production order, where the materials to be issued and their respective quantities have already been calculated by the MRP during the planner registration phase.
Through the Automatic Proposal function, the item code, batch, and expected quantity are automatically populated.
The operator only needs to confirm or adjust the data if necessary.
Current Limitation
There is currently no functionality that allows prevaluation or creation of a Picking List to group materials before the start of the production process.

Picking List Valuation Logic
Item Code: Determined according to the Bill of Materials (BoM).
Batch: Determined according to the warehouse management logic defined in the item master data (e.g., FIFO, LIFO, etc.).
Quantity: Calculated by the MRP following the planner’s scheduling process.

System Behavior (To Be Implemented)
The system should allow the generation and valuation of a Picking List prior to material consumption, enabling warehouse operators to prepare and stage required materials in advance.
The Picking List should be automatically populated based on BoM and MRP data but remain editable by authorized users before final confirmation.
Batch selection should respect warehouse allocation rules (FIFO, LIFO, etc.).
The system should ensure traceability between the production order and the corresponding Picking List.


Frequency of Use
Daily
Related Business Need
Enable accurate and efficient material preparation prior to production, improving process traceability, reducing errors, and optimizing material flow between warehouse and production lines.


