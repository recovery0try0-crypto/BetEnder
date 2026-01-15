# DEX Aggregator Dashboard

## Overview

A real-time decentralized exchange (DEX) aggregator dashboard that displays token prices, liquidity, and volume data across multiple blockchain networks. The application follows clean architecture principles with a React frontend and Express backend, featuring auto-refreshing data snapshots every 10 seconds.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React with TypeScript using Vite as the build tool
- **Routing**: Wouter for lightweight client-side routing
- **State Management**: TanStack React Query for server state management with automatic refetching
- **UI Components**: Shadcn/ui component library built on Radix UI primitives
- **Styling**: Tailwind CSS with CSS variables for theming
- **Animations**: Framer Motion for smooth transitions

### Backend Architecture
- **Framework**: Express.js with TypeScript
- **Architecture Pattern**: Clean Architecture with three layers:
  - **Domain Layer** (`server/domain/`): Pure business logic and entities (Token, Pool, Snapshot)
  - **Application Layer** (`server/application/`): Services orchestrating business operations (SnapshotService)
  - **Infrastructure Layer** (`server/infrastructure/`): Adapters for external data sources (MockAdapter)
- **API Design**: RESTful endpoints defined in `shared/routes.ts` with Zod schemas for validation

### Data Flow
1. Frontend requests snapshot data via `/api/snapshot/:chain`
2. SnapshotService checks cache, generates new data if stale (>5 seconds)
3. Chain adapters fetch pool data and compute prices using domain functions
4. Response validated against shared Zod schemas

### Shared Code
- `shared/schema.ts`: Zod schemas for API types (Token, TokenEntry, Snapshot)
- `shared/routes.ts`: API route definitions with response types
- `shared/tokens.ts`: Static token metadata for supported chains (Ethereum, Polygon)

### Database Configuration
- Drizzle ORM configured for PostgreSQL
- Schema defined in `shared/schema.ts`
- Currently uses in-memory caching; database provisioned via `DATABASE_URL` environment variable
- Migrations output to `./migrations` directory

## External Dependencies

### Database
- **PostgreSQL**: Primary database (requires `DATABASE_URL` environment variable)
- **Drizzle ORM**: Database queries and schema management
- **connect-pg-simple**: Session storage for Express

### Frontend Libraries
- **@tanstack/react-query**: Data fetching with 10-second auto-refresh interval
- **Radix UI**: Accessible UI primitives (dialog, select, tooltip, etc.)
- **framer-motion**: Animation library for table transitions
- **date-fns**: Date formatting utilities
- **lucide-react**: Icon library

### Build Tools
- **Vite**: Frontend bundling with HMR
- **esbuild**: Server bundling for production
- **TypeScript**: Type checking across all layers

### Replit-Specific
- **@replit/vite-plugin-runtime-error-modal**: Error overlay in development
- **@replit/vite-plugin-cartographer**: Development tooling
- **@replit/vite-plugin-dev-banner**: Development banner