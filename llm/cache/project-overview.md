# Carbon Project Overview

## Project Structure

Carbon is a manufacturing system built with modern web technologies. It consists of three main applications:

1. **ERP (Enterprise Resource Planning)** - Located at `/apps/erp/`
2. **MES (Manufacturing Execution System)** - Located at `/apps/mes/`
3. **Academy (Training App)** - Located at `/apps/academy/`

## Technology Stack

### Frontend

- **Framework**: React Router (React-based)
- **UI Components**: Custom component library at `/packages/react/`
- **Styling**: Tailwind CSS
- **Forms**: Custom form library at `/packages/form/`
- **TypeScript**: Strict mode enabled

### Backend

- **Database**: Supabase (PostgreSQL)
- **Edge Functions**: Vercel Edge Runtime
- **Authentication**: Supabase Auth via `/packages/auth/`
- **Redis**: ioredis via `/packages/kv/` (rate limiting, caching)

### Build Tools

- **Monorepo**: NPM workspaces with Turbo
- **Bundler**: Vite
- **Linting**: Biome with custom config
- **Formatting**: Prettier

## Package Structure

The monorepo uses NPM workspaces with packages located in `/packages/`:

- `auth` - Authentication services and utilities
- `database` - Database types and migrations
- `documents` - PDF/Email/ZPL document generation
- `form` - Form components and validation
- `kv` - Redis client (ioredis) with rate limiting (Ratelimit class)
- `logger` - Logging utilities
- `notifications` - Notification services
- `react` - Shared React components
- `remix` - React Router-specific utilities
- `utils` - Common utilities

## Common Patterns

### File Organization

Each app follows a consistent structure:

- `components/` - React components
- `hooks/` - Custom React hooks
- `routes/` - React Router routes
- `services/` - Business logic and API calls
- `stores/` - State management (appears to use nanostores)
- `styles/` - CSS files
- `types/` - TypeScript types and validators
- `utils/` - Utility functions

### Module Organization

The ERP app organizes business logic into modules:

- Each module has its own folder in `/modules/`
- Contains `.models.ts`, `.service.ts`, and UI components
- Examples: sales, purchasing, inventory, accounting, etc.

### Database Access

- Uses Supabase client from `@carbon/auth`
- Type-safe queries with generated types from `@carbon/database`
- Service functions handle database operations

### Routing

- Uses React Router flat routes
- Protected routes under `x+/` prefix
- Public routes under `_public+/` prefix
- API routes under `api+/` prefix
- File serving routes under `file+/` prefix
- External/shared routes under `share+/` prefix


### Path Configuration

In `/apps/erp/app/utils/path.ts`:

- `path.to.externalQuote(id)` generates `/share/quote/${id}`
- Quote sharing implemented in `QuoteHeader.tsx` using `window.location.origin + path.to.externalQuote(externalLinkId)`

### Services

Each module defines a set of methods for interacting with the module. The convention is to have at least four methods for each table.

- `deleteCustomerPortal()` - Delete customer portal link
- `getCustomerPortals()` - List customer portal links
- `getCustomerPortal()` - Get specific customer portal
- `upsertCustomerPortal()` - Create/update customer portal


