# Run Lint and Fix Errors

## Tasks

- [x] Run biome check on modified modules/packages. Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.
- [x] Fix any linting and formatting issues found by biome. Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.
- [x] Verify that biome check returns clean. Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.

## Review

- Identified and fixed 3 biome/a11y/useValidAnchor warnings in `Cta.tsx` and `Lede.tsx` by replacing `asChild` and nested `<a>` elements with direct `<Button>` components.
- Fixed 1 biome/suspicious/useIterableCallbackReturn warning in `useInViewClass.ts` by using a block statement with an explicit `if` conditional inside a `forEach` loop.
- Re-ran `pnpm run lint` and verified that the entire workspace lint check is now 100% clean (0 errors, 0 warnings across all 23 packages/apps).
