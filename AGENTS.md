# Carbon Manufacturing System - AI Agent Instructions

## Project Overview

Carbon is a manufacturing system with ERP, MES, and Academy applications built as a TypeScript monorepo.

- **ERP** - Enterprise Resource Planning (primary app)
- **MES** - Manufacturing Execution System
- **Academy** - Training application
- **Starter** - Template application

## Knowledge Base

ALWAYS query `llm/cache/` before making changes:

| File | Purpose |
|------|---------|
| `project-overview.md` | Architecture & structure |
| `coding-conventions.md` | Code standards |
| `authentication.md` | Auth patterns |
| `database-patterns.md` | Database conventions |
| Module-specific docs | Business logic |

## Workflows

Check `llm/workflows/` for documented procedures:

- `database-migration.md` - Database changes workflow
- `edge-function.md` - Edge function development

## Technology Stack

- **Framework**: React Router 7 (flat routes)
- **UI**: Radix UI primitives with Tailwind CSS
- **Database**: Supabase (PostgreSQL)
- **Auth**: Supabase Auth with RBAC/ABAC
- **Forms**: Zod validation
- **Testing**: Jest with ts-jest
- **Linting**: Biome
- **Build**: Turbo monorepo

## Development Rules

1. Make small, incremental changes
2. Ask clarifying questions if uncertain
3. Always write tests for new code
4. Run tests before committing
5. Never commit directly to main
6. Update CHANGELOG.md for changes
7. Create PR for review before merging

## Key Commands

```bash
npm run dev          # Start all apps
npm run dev:erp      # ERP app only
npm run dev:mes      # MES app only
npm run test         # Run tests
npm run lint         # Lint code
npm run typecheck    # Type checking
npm run db:migrate   # Create migration
npm run db:generate  # Generate types
```

## File Patterns

### App Structure
```
components/    - React components
hooks/         - Custom React hooks
routes/        - React Router routes
services/      - Business logic & API calls
stores/        - State management
types/         - TypeScript types & validators
modules/       - Feature modules (ERP)
```

### Routing Conventions
- Protected routes: `x+/` prefix
- Public routes: `_public+/` prefix
- API routes: `api+/` prefix
- File serving: `file+/` prefix
- Shared/external: `share+/` prefix

## Custom Agents

Use these agents for specialized tasks:

- `@db-migrate` - Database migration specialist
- `@feature-dev` - Feature development helper
- `@reviewer` - Code review assistant
