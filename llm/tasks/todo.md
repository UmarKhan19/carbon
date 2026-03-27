# Migrate getCarbonServiceRole imports

## Task
Update all imports of `getCarbonServiceRole` from `@carbon/auth` to `@carbon/auth/client.server`.

## Plan
- [x] Find all files importing getCarbonServiceRole from @carbon/auth (~142 files)
- [x] Write and run a migration script
- [x] Verify no remaining old imports
- [x] Clean up migration script

## Review
- [x] No files still importing getCarbonServiceRole from @carbon/auth (source files)
- [x] Spot checked 4 files for correctness (solo import, mixed imports, multi-named exports)
