REQ-FUN-ERP-001
Acceptance Test Specifications

Pricing List Management — VER-ERP-001

Verification ID: VER-ERP-001
Test Object: Pricing List Management
Requirement Ref(s): REQ-FUN-ERP-001
Verification Method: I/A/D/T

I (Inspection): Review price list definitions, rule configurations, thresholds, and customer assignments.
A (Analysis): Validate price calculation logic, rule stacking, conflict resolution, determinism, and threshold behavior.
D (Demonstration): Demonstrate creation, modification, assignment, and price application in the ERP.
T (Test): Execute sales orders to verify correct price resolution for different customers, items, and quantities.

Assumptions / Scope
Applies to items and product categories.
Rules may include discounts, surcharges, and quantity thresholds.
Multiple price lists may coexist; overlapping cases are governed by a conflict resolution policy.
Customer or group assignment determines the effective pricing scope.
Versioning and traceability of price lists are required.
No assumptions are made on UI layout or navigation sequence.

Acceptance Criteria

ID
Acceptance Criterion
Method
AC-ERP-01
Price list created with required metadata (name, validity, currency, type).
I
AC-ERP-02
Items/categories configured with prices, discounts, surcharges, thresholds.
I/A
AC-ERP-03
Automatic calculation rules produce correct final price.
A/T
AC-ERP-04
Customer/group assignment determines effective price.
D/T
AC-ERP-05
Conflicts resolved deterministically per policy.
A/T
AC-ERP-06
Price resolution deterministic and explainable.
A/T
AC-ERP-07
Version history preserved.
I
AC-ERP-08
Modifications generate new versions with traceability.
I/D
AC-ERP-09
Correct price applied during sales order creation.
T

Scenario Outlines

ID
Scenario Outline
Method
TV-ERP-01
Given required fields, when price list is created, then it is stored and versioned.
D
TV-ERP-02
Given editable list, when rules added, then price calculation updates accordingly.
A/D
TV-ERP-03
Given customer assignment, when sales order created, then correct price is applied.
T
TV-ERP-04
Given overlapping lists, when conflict occurs, policy resolves it deterministically.
A/T
TV-ERP-05
Given thresholds, when quantity changes, then pricing adjusts accordingly.
A/T
TV-ERP-01
Given required fields, when price list is created, then it is stored and versioned.
D

Evidence to Capture

ID
Evidence
Verification
EV-ERP-01
Price list master data.
I
EV-ERP-02
Rule evaluation examples or logs.
A
EV-ERP-03
Sales order pricing trace.
T
EV-ERP-04
Version history log.
I
EV-ERP-05
Customer/group assignment mapping.
D

Pass / Fail Rules
 PF-ERP-001: All AC-ERP-01…AC-ERP-09 verified.
 PF-ERP-002: No High/Critical pricing issues open.
 PF-ERP-003: Medium/Low issues documented with owners.

Functional Requirements

Pricing List
Item Description
Pricing List Management
Requirement ID
REQ-FUN-ERP-001
Requirement Title
Pricing List
Priority
Must
Requirement Description
Access to the Function
The user accesses the “Sales” module → “Price Lists” section.
Creation of the Price List
The user selects “Create New Price List”.
They enter the main fields:
Price list name (e.g., “Summer Price List 2025”)
Validity dates (from / to)
Currency
Price type (gross, net, discounted)
Adding Items and Pricing Rules
The user adds individual items or product categories.
For each item, they define:
Unit price
Discounts or surcharges
Minimum / maximum quantity thresholds for application
The user can set automatic calculation rules (e.g., “–10% for Category A customers”).
Assigning the Price List to Customers
The user assigns the price list to one or more customers or customer groups.
The system validates that the dates and rules do not overlap with other active price lists.
Saving and Publishing
The user saves the price list.
The system confirms the creation and makes it available for future sales orders.
Automatic Application During Sales
When a sales order is created, the system checks:
Customer → category → assigned price list
Validity dates
The correct price is automatically applied to each order line.
Review and Update of the Price List
The user can duplicate an existing price list, modify prices, or close it.
The system maintains the history of previous versions for traceability and audit purposes.

Frequency of Use
Daily
Related Business Need
Ensure accurate and consistent product pricing across customers, seasons, and sales channels to optimize revenue and maintain pricing transparency.
