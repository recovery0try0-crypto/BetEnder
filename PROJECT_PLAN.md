# Project Plan: High-Performance DEX Aggregator

This document outlines the development plan to refactor the application into a specialized, high-performance DEX price aggregator for Ethereum and Polygon. The architecture is designed for speed, accuracy, and scalability, centered around a multi-layered caching system and an efficient request-batching pipeline. The core UI and business logic will be shared, with changes focused on the data and infrastructure layers.

---

## **Phase 1: Foundation & Data Management (Completed)**

*Objective: Establish the core data structures and the "cold path" for discovering and storing information about new tokens and liquidity pools.*

### **Step 1.1: Restrict Network Scope (Completed)**
- **Alignment:** Refactor
- **Status:** Complete
- *Note: This step simplified the codebase by removing all logic not related to chains other than Ethereum and Polygon, which is a prerequisite for the new focused design.*
- [X] Review `shared/tokens.ts` and confirm only Ethereum and Polygon configs exist.
- [X] Update `client/src/pages/Dashboard.tsx` to remove the `ChainSelector` component.
- [X] Refactor `server/infrastructure/adapters/EthersAdapter.ts` to handle multiple providers.
- [X] Verify that `server/routes.ts` is updated to remove the `:chain` parameter from API endpoints.

### **Step 1.2: Implement "Cold Path" Data Discovery & Storage (Completed)**
- **Alignment:** Feature
- **Status:** Complete
- *Note: This step creates the background process that discovers all possible token pairs and their liquidity pools, storing the results in chain-specific files for the "hot path" to use. This discovery happens once on application startup.*
- [X] Create the data directory: `server/data`.
- [X] Create `server/data/tokens.json` seeded with popular tokens (e.g., WETH, USDC, USDT) for both Ethereum (1) and Polygon (137).
- [X] Create empty data files for each chain: `server/data/pools_ethereum.json` and `server/data/pools_polygon.json`.
- [X] Create a new `StorageService.ts` to handle atomic reads/writes to these files.
- [X] Implement a `DiscoveryService.ts` that, on startup, iterates through every possible pair of tokens in `tokens.json` for each configured chain.
- [X] For each pair, the service will use the `EthersAdapter` to query the appropriate Uniswap V3 factory contract to find the liquidity pool address.
- [X] Discovered pool addresses will be saved to the corresponding chain-specific file (e.g., `pools_ethereum.json`) via the `StorageService`.

---

## **Phase 2: Backend - The "Hot Path" Core Engine (Completed)**

*Objective: Implement the real-time request processing pipeline, from batching user requests to fetching on-chain data with maximum efficiency.*

### **Step 2.1: Develop the Request Batcher (Completed)**
- **Alignment:** New
- **Status:** Complete
- *Note: This step introduces a new, asynchronous batching system to absorb user requests and deduplicate work.*
- [X] Create a new service: `server/application/services/RequestBatcher.ts`.
- [X] It will expose an `addQuoteRequest()` method that holds a `Promise` and adds requests to an in-memory queue.
- [X] Implement a `setInterval` loop (e.g., every 100ms) to trigger a `processQueue()` method.
- [X] `processQueue()` will deduplicate requested tokens and forward them to the Controller.
- [X] Create a new API endpoint `/api/quote` in `server/routes.ts` that awaits the `Promise` from the `RequestBatcher`.

### **Step 2.2: Implement the Controller (Completed)**
- **Alignment:** New
- **Status:** Complete
- *Note: The existing `SnapshotService` is replaced by a sophisticated Controller that manages different update intervals for volatile vs. standard tokens.*
- [X] Create the orchestration service: `server/application/services/ControllerService.ts`.
- [X] The Controller will be invoked by the `RequestBatcher` with a unique set of tokens.
- [X] It will maintain an in-memory `Map` to store `lastUpdated` timestamps for each token.
- [X] Implement logic to segregate tokens into update tiers (Immediate, Fast-5s, Standard-10s).
- [X] The Controller will group tokens by network and pass them to the Query Engine.

### **Step 2.3: Build the Multicall Query Engine (Completed)**
- **Alignment:** Enhancement
- **Status:** Complete
- *Note: This step enhanced the `EthersAdapter` to execute optimized `multicall` requests while managing multiple RPC providers for resilience.*
- [X] Enhance `server/infrastructure/adapters/EthersAdapter.ts`.
- [X] The adapter's constructor will accept a list of RPC endpoints for each supported chain, configured via environment variables.
- [X] The `getBatchPoolData` method was updated to handle `multicall` batching.

---

## **Phase 3: Backend - Pricing, Caching, and Distribution (Completed)**

*Objective: Process the raw on-chain data, calculate the best price, cache the results, and deliver them to the user.*

### **Step 3.1: Implement the Advanced Pricing Module (Completed)**
- **Alignment:** Enhancement
- **Status:** Complete
- *Note: `server/domain/pricing.ts` exists but is a placeholder. This step will implement the core business logic to calculate the best price by comparing results from multiple liquidity pools.*
- [X] Enhance the existing `server/domain/pricing.ts`.
- [X] Create a function `calculateBestPrice(tokenAddress, rawPoolData)` that runs parallel computations to find the optimal swap rate.
- [X] It will return the best price found and identify the corresponding liquidity pool.

### **Step 3.2: Set Up Multi-Layer Caching (Completed)**
- **Alignment:** Enhancement
- **Status:** Complete
- *Note: A very basic cache exists within the `SnapshotService`. This will be replaced with a dedicated `CacheService` for a robust in-memory cache, with a stretch goal of adding Redis for persistence.*
- [X] Create a new service: `server/application/services/CacheService.ts`.
- [X] Implement a primary in-memory cache using a `Map`.
- [X] Implement `getQuote` and `setQuote` methods.

### **Step 3.3: Create the Dispatcher & Response Handler (Completed)**
- **Alignment:** New
- **Status:** Complete
- *Note: In the new asynchronous architecture, a Dispatcher is required to resolve the pending promises held by the `RequestBatcher`. This component does not exist in the current synchronous flow.*
- [X] Create a final service: `server/application/services/DispatcherService.ts`.
- [X] After the Pricing Module returns prices, it will invoke the Dispatcher.
- [X] The Dispatcher will call `CacheService.setQuote()` to store results.
- [X] It will then resolve the original pending Promises in the `RequestBatcher`'s queue to send the HTTP response back to the client.

---

## **Phase 4: Frontend Integration (Completed)**

*Objective: Connect the redesigned user interface to the new high-performance backend API.*

### **Step 4.1: Redesign the User Interface (Completed)**
- **Alignment:** Refactor / New
- **Status:** Complete
- *Note: This step replaces the existing data-table-focused UI with a new, purpose-built `SwapInterface` component, aligning the frontend with the app's core purpose.*
- [X] Overhaul `client/src/pages/Dashboard.tsx`.
- [X] Create a new `client/src/components/SwapInterface.tsx`.
- [X] This component will feature inputs for amount, token selection, and a display for the quote.
- [X] Remove the now-obsolete `TokenTable.tsx` and related components.

### **Step 4.2: Connect to the New API (Completed)**
- **Alignment:** Refactor
- **Status:** Complete
- *Note: The current frontend fetching logic in `use-snapshots.ts` will be removed. We will refactor the UI to use `useQuery` to call the new `/api/quote` endpoint.*
- [X] In `SwapInterface.tsx`, use `@tanstack/react-query`'s `useQuery` hook to fetch data from `/api/quote`.
- [X] The query key will be dynamic, based on the selected tokens and amount.
- [X] Implement debouncing on the amount input to prevent excessive API calls.
- [X] Use TanStack Query's cache as the client-side cache and `Skeleton` components for loading states.
