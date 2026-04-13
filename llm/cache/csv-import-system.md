# CSV Import System

## Overview

The Carbon system includes a comprehensive CSV import system that allows users to bulk import data for various entities including customers, suppliers, parts, materials, work centers, and processes. The import system is designed to be idempotent and supports enum mappings for dropdown fields.

## Architecture

### Frontend Components

- **Location**: `/apps/erp/app/components/ImportCSVModal/`
- **Main Component**: `ImportCSVModal.tsx` - Modal interface for CSV imports
- **Sub-components**:
  - `UploadCSV.tsx` - Handles CSV file upload to private storage
  - `FieldMappings.tsx` - UI for mapping CSV columns to database fields
  - `useCsvContext.tsx` - Context management for import state

### Backend Route

- **Location**: `/apps/erp/app/routes/x+/shared+/import.$tableId.tsx`
- **Method**: Validates permissions and form data
- **Flow**:
  1. Checks user permissions for the table being imported
  2. Validates form data using Zod schemas
  3. Extracts column mappings and enum mappings
  4. Calls Supabase edge function

### Supabase Edge Function

- **Location**: `/packages/database/supabase/functions/import-csv/index.ts`
- **Runtime**: Deno
- **Responsibilities**:
  1. Downloads CSV file from private storage
  2. Parses CSV using Deno std library
  3. Maps CSV columns to database fields
  4. Handles enum value mappings
  5. Performs upsert operations with idempotent behavior
  6. Stores external ID mappings for re-imports

## Field Mappings

Field mappings are defined in `/apps/erp/app/modules/shared/imports.models.ts` and include:

### Field Mapping Structure

```typescript
{
  label: string;           // User-friendly field name
  required: boolean;       // Whether field is mandatory
  type: string;           // "string" | "number" | "boolean" | "enum"
  enumData?: {            // For enum fields
    description: string;   // Explanation of the field
    options?: string[];   // Static enum options
    fetcher?: Function;   // Database fetcher for dynamic options
    default?: string;     // Default value
  };
  default?: string;       // Optional default value
}
```

## Supported Import Tables

### Core Tables with Field Mappings

1. **customer** - Permission: `sales`

   - Fields: id, name, accountManagerId, fax, taxId, currencyCode, website

2. **customerContact** - Permission: `sales`

   - Fields: id, companyId, firstName, lastName, email, title, mobilePhone, workPhone, homePhone, fax, notes

3. **supplier** - Permission: `purchasing`

   - Fields: id, name, accountManagerId, phone, fax, taxId, currencyCode, website

4. **supplierContact** - Permission: `purchasing`

   - Fields: id, companyId, firstName, lastName, email, title, mobilePhone, workPhone, homePhone, fax, notes

5. **part** - Permission: `parts`

   - Fields: id, readableId, revision, name, description, active, replenishmentSystem, defaultMethodType, itemTrackingType, unitOfMeasureCode

6. **material** - Permission: `parts`

   - Fields: Same as part, plus: materialSubstanceId, materialFormId, finish, grade, dimensions

7. **tool** - Permission: `parts`

   - Fields: Same as part

8. **fixture** - Permission: `parts`

   - Fields: Same as part

9. **consumable** - Permission: `parts`

   - Fields: Same as part

10. **methodMaterial** - Permission: `parts`
    - Fields: level, partId, description, methodType, quantity, unitOfMeasureCode
    - Status: Not yet implemented

### NEW: Production Tables

11. **workCenter** - Permission: `production`

    - Required Fields: id, name, description, defaultStandardFactor, laborRate, machineRate, overheadRate, locationId
    - Description: Bulk import work centers with cost rates and location assignment

12. **process** - Permission: `production`
    - Required Fields: id, name, processType
    - Optional Fields: defaultStandardFactor (required for Inside processes), completeAllOnScan
    - Description: Bulk import processes (Inside/Outside) with default standards

## Import Process Flow

### Frontend Flow

1. User opens ImportCSVModal
2. Uploads CSV file to `/private` storage (via browser)
3. Selects field mappings (which CSV columns map to which database fields)
4. Configures enum mappings for dropdown fields (e.g., "Buy" → "Make")
5. Submits form to `/import/$tableId` route

### Backend Flow

1. **Route Handler** (`import.$tableId.tsx`):

   - Verifies user has permission to import the table
   - Validates input data using Zod schema
   - Extracts column mappings and enum mappings
   - Calls Supabase edge function

2. **Edge Function** (`import-csv/index.ts`):
   - Downloads CSV from private storage
   - Parses CSV into records
   - Maps CSV columns to field names using columnMappings
   - Applies enum mappings for enum fields
   - Validates records
   - Handles insert/update logic:
     - **Insert**: Creates new records with external ID mapping
     - **Update**: Updates existing records found via external ID mapping
   - Performs database transaction with rollback on error

### Idempotent Imports

- Uses `externalIntegrationMapping` table to track CSV imports
- Format: `integration: "csv"`, `externalId: <CSV_ID>`
- Allows re-importing same CSV without duplicates
- Updates existing records if CSV ID already exists

## Zod Validators

All import tables have Zod validators in `importSchemas` for client-side validation:

- Ensures required fields are present
- Validates field types
- Provides user-friendly error messages

## Permissions

Import permissions are defined in `importPermissions`:

```typescript
{
  customer: "sales",
  customerContact: "sales",
  supplier: "purchasing",
  supplierContact: "purchasing",
  part: "parts",
  material: "parts",
  tool: "parts",
  fixture: "parts",
  consumable: "parts",
  methodMaterial: "parts",
  workCenter: "production",    // NEW
  process: "production"         // NEW
}
```

## Key Features

1. **Column Mapping**: Flexible assignment of CSV columns to database fields
2. **Enum Mapping**: Custom value mappings for dropdown fields (e.g., "B" → "Buy")
3. **Default Values**: Auto-populate fields from predefined defaults
4. **Validation**: Both client and server-side validation with schema enforcemen t
5. **Idempotent Imports**: Re-import same data without creating duplicates
6. **Transaction Safety**: All or nothing behavior for database operations
7. **Error Handling**: Graceful error reporting with detailed messages

## Example: Importing Work Centers

### CSV Format

```
id,name,description,defaultStandardFactor,laborRate,machineRate,overheadRate,locationId
WC001,Lathe A,Primary lathe machine,Hours,50.00,75.00,25.00,LOC-A
WC002,Mill B,CNC milling machine,Minutes,55.00,80.00,30.00,LOC-A
```

### Field Mapping (User Selection)

- CSV Column "id" → Database Field "id"
- CSV Column "name" → Database Field "name"
- CSV Column "description" → Database Field "description"
- CSV Column "defaultStandardFactor" → Database Field "defaultStandardFactor"
- CSV Column "laborRate" → Database Field "laborRate"
- CSV Column "machineRate" → Database Field "machineRate"
- CSV Column "overheadRate" → Database Field "overheadRate"
- CSV Column "locationId" → Database Field "locationId"

### Edge Function Processing

1. Parses CSV rows
2. Maps columns: "WC001" → id, "Lathe A" → name, etc.
3. Converts numeric fields: "50.00" → 50
4. Creates workCenter records with proper types
5. Stores external ID mapping: "WC001" → internal UUID

## Example: Importing Processes

### CSV Format

```
id,name,processType,defaultStandardFactor,completeAllOnScan
PROC-001,Drilling,Inside,Hours,false
PROC-002,Assembly,Inside,Hours,true
PROC-003,Plating,Outside,,false
```

### Field Mapping (User Selection)

- CSV Column "id" → Database Field "id"
- CSV Column "name" → Database Field "name"
- CSV Column "processType" → Database Field "processType"
- CSV Column "defaultStandardFactor" → Database Field "defaultStandardFactor"
- CSV Column "completeAllOnScan" → Database Field "completeAllOnScan"

### Edge Function Processing

1. Parses CSV rows
2. Maps columns: "PROC-001" → id, "Drilling" → name, etc.
3. Validates processType is "Inside" or "Outside"
4. Converts boolean: "true" → true, "false" → false
5. Creates process records
6. Stores external ID mapping: "PROC-001" → internal UUID

## Location References

### Models & Validation

- `/apps/erp/app/modules/shared/imports.models.ts` - Field mappings and Zod schemas
- `/apps/erp/app/modules/resources/resources.models.ts` - Work center validator
- `/apps/erp/app/modules/production/production.models.ts` - Process validator

### Routes & Controllers

- `/apps/erp/app/routes/x+/shared+/import.$tableId.tsx` - Import route handler

### Frontend Components

- `/apps/erp/app/components/ImportCSVModal/` - Import UI components

### Backend Processing

- `/packages/database/supabase/functions/import-csv/index.ts` - Edge function

## Limitations & Future Work

1. **methodMaterial**: Not yet implemented
2. **Process-WorkCenter Association**: Currently manual association after import
3. **Bulk Updates**: No bulk update from existing records
4. **Error Reporting**: Limited line-by-line error reporting for malformed rows
5. **Preview**: No CSV preview before import confirmation

## Related Systems

- **Authentication**: Uses Carbon auth for permission checks
- **Database**: Uses Supabase/PostgreSQL for storage
- **File Storage**: Uses Supabase private storage for CSV files
- **Form Validation**: Uses Zod for schema validation
