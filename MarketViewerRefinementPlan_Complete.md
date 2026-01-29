# Market Viewer Refinement Plan — Complete Specification

**DEX Aggregator: Market Viewer Component**

---

## Scope Guard

**This plan applies exclusively to the Market Viewer.**

**Prohibited Actions:**
- Do not modify Swapper logic
- Do not redesign project structure
- Do not rename files
- Do not create duplicate components if similar functionality exists
- Do not replace JSON registries with databases

**Permitted Actions:**
- Refine internal behavior using existing components
- Extend existing structures without breaking compatibility
- Introduce new roles without new files (logical separation)
- Correct execution primitives to match AMM pricing reality

---

## Architectural Foundation

### Two-Path Model

The Market Viewer operates via two distinct, non-overlapping execution paths:

**Cold Path — Identity, Registry, Eligibility**
- Owns all registry artifacts (read/write)
- Serves token metadata, pagination, search
- Manages discovery and promotion
- Resolves logos and static metadata
- **Never touches RPC**

**Hot Path — State, Scheduling, Pricing**
- Pure consumer of registries (read-only)
- Tracks user interest in pools
- Schedules multicall queries
- Computes prices from on-chain state
- Distributes results via cache
- **Never modifies registries**

**Critical Invariant:**
> The cold path feeds the hot path.  
> The hot path never discovers, resolves, or modifies registries.

---

## Registry Architecture

### Four Registry Concepts (Per Network)

The cold path owns and manages four distinct registry types:

#### 1. Primary Token Registry
- **Purpose:** Curated, pricing-eligible tokens visible to users
- **Contents:** Token metadata (address, symbol, name, decimals, logoUrl)
- **Constraints:** Only tokens with valid pool mappings
- **Mutability:** Cold path exclusive (append on promotion, never delete)

#### 2. Pool Registry
- **Purpose:** Pricing topology — defines how tokens are priced
- **Contents:** Pool address, DEX type, fee tier (V3), token pairs, pricing routes
- **Structure:**
  ```javascript
  {
    poolAddress: string,
    dexType: "v2" | "v3",
    token0: address,
    token1: address,
    feeTier?: number, // V3 only
    weight: number // multicall cost estimate
  }
  ```
- **Pricing Routes:** Pre-indexed, fixed routes (max 2-hop)
  ```javascript
  {
    tokenAddress: {
      pricingRoute: [
        { pool: poolAddress1, base: "WETH" },
        { pool: poolAddress2, base: "USDC" }
      ]
    }
  }
  ```
- **Constraints:** No runtime pathfinding; routes are deterministic

#### 3. Discovery Quarantine Registry
- **Purpose:** Temporary holding area for untrusted explorer discoveries
- **Contents:** Unverified token metadata awaiting validation
- **Lifecycle:** 
  - Enter on discovery
  - Validated by background process (pool existence, liquidity check)
  - Promoted to primary registry if valid
  - Purged after 7 days if not promoted

#### 4. Logo/Metadata Cache
- **Purpose:** Asset storage for resolved logos and metadata
- **Retention Policy:**
  - Primary registry tokens: 30 days
  - Quarantine tokens: 7 days
- **Invalidation:** TTL-based expiration

**Ownership Rule:**
> All four registries are exclusively owned, written, and maintained by the cold path.  
> The hot path is a pure read-only consumer.

---

## Cold Path: Detailed Mechanics

### Core Responsibilities

The cold path's function is **not** to fetch prices. Its responsibilities are:

1. **Serve token identity fast** — metadata lookup without RPC
2. **Decide which tokens users can see** — curation and filtering
3. **Feed the hot path with valid tokens** — ensure pool mappings exist
4. **Grow the registry safely** — quarantine and validation
5. **Never touch RPC** — explorer APIs and JSON only

**Fundamental Rule:**
> If the cold path is clean, the hot path stays cheap.

### Token Serving Contract

**Hard Rule (Encoded in Implementation):**

> Any time a token is served to the UI, it must already have:
> 1. Verified metadata (symbol, name, decimals)
> 2. Verified pool mapping (pricing route known)
> 3. Eligibility for pricing (pool exists in registry)
> 4. Logo resolved or cached

This preparation occurs **exclusively in the cold path** before the hot path begins.

**Violation Consequence:**
If this contract breaks, the hot path efficiency model collapses and begins performing dynamic lookups, negating all optimization.

### Pagination (nextnumber)

**Current Design: Correct — Do Not Change**

- 15 tokens per page
- Network-specific registry
- No RPC involvement
- Logo cache resolution on first request

**Implementation:**
```javascript
startIndex = (nextNumber - 1) * PAGE_SIZE
tokensToServe = primaryRegistry.slice(startIndex, startIndex + PAGE_SIZE)

for (token in tokensToServe) {
  token.pricingPools = poolRegistry.lookup(token.address, networkId)
  token.logoUrl = logoCache.resolve(token.address)
}
```

**Invariant:** Pagination remains token-based; only hot path scheduling becomes pool-based.

### Search

**Constraint:** Search operates exclusively on the primary registry.

**Flow:**
1. User types query
2. Search only curated tokens in primary registry
3. If not found → trigger discovery (goes to quarantine)
4. Do **not** search quarantine entries
5. Do **not** allow quarantine tokens into pagination results

**Rationale:** Prevents registry pollution from affecting UX.

### Discovery and Promotion

**Current Flow (Incorrect):**
```
explorer → token JSON → viewer
```

**New Flow (Correct):**
```
explorer → quarantine → background validation → promotion → primary registry
```

**Steps:**

1. **Discovery (Cold Path):**
   ```javascript
   if (token not in primaryRegistry) {
     quarantineRegistry.add(token)
     scheduleValidation(token)
   }
   ```

2. **Validation (Background Process — RPC Allowed):**
   - Check pool existence in pool registry
   - Verify liquidity threshold (on-chain call)
   - Confirm token can be paired to known base (WETH/USDC/USDT)

3. **Promotion (Cold Path):**
   - If validation passes → move to primary registry
   - If validation fails or 7 days elapse → purge from quarantine

**Critical Separation:**
The background validator is **neither cold nor hot path**. It runs asynchronously, decoupled from user activity, with RPC access permitted.

**This resolves the "No RPC in cold path" contradiction.**

### Pool Mapping Attachment

**Mechanism:**

Before serving tokens to UI, cold path attaches pool references:

```javascript
token.metadata.pricingPools = poolRegistry.lookup(token.address, networkId)
```

**Benefit:**
When hot path receives interest, it **does not search** the pool registry. The mapping is already known.

**Performance Impact:**
Eliminates repeated registry lookups during pricing cycles.

### Filtering Empty Tokens

**Rule:**

A token that:
- Exists in registry
- Has **no pool mapping**

Must **never** be forwarded to hot path.

**Implementation:**
```javascript
eligibleTokens = tokensToServe.filter(token => token.pricingPools.length > 0)
```

**UX Impact:**
User can still see metadata, but no price spinner appears.

### Network Isolation

**Strict Separation:**

Everything remains network-scoped:
- Token registry per network
- Pool registry per network
- Discovery quarantine per network
- Pagination per network
- Logo cache per network

**Never mix networks in any operation.**

### RPC Prohibition

**Absolute Rule:**

If any of these operations touch RPC, remove it:
- Token load
- Search
- Pagination
- Discovery (initial)

**Allowed RPC Usage:**
- Background validator only (asynchronous, user-decoupled)

---

## Hot Path: Detailed Mechanics

### Pool-Centric Execution Model

**Fundamental Shift:**

The hot path no longer tracks tokens. It tracks **pools**.

**Reason:**
- Tokens are presentation entities
- Pools are pricing entities
- N tokens can share 1 pool → 1 RPC call instead of N calls

### Controller Transformation

**Current Behavior (Token-Centric):**
```
Controller tracks: Set<TokenAddress>
Executes: multicall per token
```

**New Behavior (Pool-Centric):**
```
Controller tracks: Set<PoolAddress>
Receives: token interest from UI
Executes: token → pool mapping, deduplication, multicall per pool
```

**Implementation Steps:**

1. **Receive token requests** (unchanged)
2. **Map tokens → pools** using pre-attached metadata:
   ```javascript
   requestedPools = new Set()
   for (token in requestedTokens) {
     for (pool in token.metadata.pricingPools) {
       requestedPools.add(pool)
     }
   }
   ```
3. **Deduplicate pools** (not tokens)
4. **Controller liveness and scheduling** apply to pools

**No UI change. No cache schema change.**

### Tiered Scheduling (Volatility-Based)

**Elimination of Fixed 10s Ticker:**

Replace global refresh interval with per-pool scheduling.

**Tiers:**
| Condition | Refresh Interval | Trigger |
|-----------|------------------|---------|
| High volatility | 5s | `priceDelta > X%` over last refresh |
| Normal volatility | 10s | `priceDelta` small but non-zero |
| Low activity | 30s | Price unchanged for N cycles |

**Implementation:**
```javascript
for (pool in aliveSet) {
  priceDelta = abs(pool.currentPrice - pool.lastPrice) / pool.lastPrice
  
  if (priceDelta > 0.05) { // 5% threshold
    pool.tier = "high"
    pool.nextRefresh = now + 5s
  } else if (priceDelta > 0.001) { // 0.1% threshold
    pool.tier = "normal"
    pool.nextRefresh = now + 10s
  } else {
    pool.tier = "low"
    pool.nextRefresh = now + 30s
  }
}
```

**Decay Mechanism:**
- New pools start at 5s tier
- Pools automatically decay to lower tiers when price stabilizes

**Result:** Self-adjusting scheduler without external data dependencies.

### Multicall Batching: Weight-Aware Round-Robin

**Problem:**
- Provider payload limits
- Provider rate limits
- Different DEX query costs

**Solution:** Two-layer strategy

#### Layer 1: Weight-Based Chunking

**Definition of "Safe Size":**

Each pool query has known weight:
- V2 pool: `getReserves()` → weight = 1 (light)
- V3 pool: `slot0() + liquidity()` → weight = 2 (heavier)

**Chunking Algorithm:**
```javascript
MAX_CALL_WEIGHT_PER_BATCH = 50 // configurable

batches = []
currentBatch = []
currentWeight = 0

for (pool in scheduledPools) {
  poolWeight = pool.dexType === "v2" ? 1 : 2
  
  if (currentWeight + poolWeight > MAX_CALL_WEIGHT_PER_BATCH) {
    batches.push(currentBatch)
    currentBatch = []
    currentWeight = 0
  }
  
  currentBatch.push(pool)
  currentWeight += poolWeight
}

if (currentBatch.length > 0) {
  batches.push(currentBatch)
}
```

#### Layer 2: Round-Robin Distribution

**Provider Rotation:**
```javascript
providerIndex = 0
for (batch in batches) {
  provider = providers[providerIndex % providers.length]
  dispatch(batch, provider)
  providerIndex++
}
```

**Benefits:**
- Prevents single provider overload
- Handles rate limits without coordination
- Distributes load across infrastructure

### Block-Aware Pricing

**Optimization:**

Ethereum state changes per block. If block number unchanged, pricing recomputation is unnecessary.

**Implementation:**
```javascript
for (poolResult in multicallResults) {
  if (poolResult.blockNumber === pool.lastBlockSeen) {
    // State unchanged
    extendCacheTTL(poolResult.poolAddress)
  } else {
    // State changed
    computePrice(poolResult)
    updateCache(poolResult)
    pool.lastBlockSeen = poolResult.blockNumber
  }
}
```

**CPU Impact:** Reduces pricing engine load by ~30-50% during low-volatility periods.

### Cache Versioning (Tick Consistency)

**Problem:**

UI must never display mixed-epoch data (token A from block X, token B from block Y).

**Solution:**

Augment cache entries with tick metadata:

```javascript
cacheEntry = {
  poolAddress: string,
  price: number,
  liquidity: number,
  blockNumber: number,
  tickId: string, // monotonic identifier per refresh cycle
  timestamp: number,
  ttl: number
}
```

**Client Read Logic:**
```javascript
requestedTokens = [tokenA, tokenB, tokenC]
poolResults = []

for (token in requestedTokens) {
  for (pool in token.metadata.pricingPools) {
    poolResults.push(cache.get(pool))
  }
}

// Verify all results share same tick
tickIds = new Set(poolResults.map(r => r.tickId))
if (tickIds.size > 1) {
  // Mixed-tick data — wait for next refresh
  return staleData
}

// Consistent tick — safe to render
return poolResults
```

**Result:** UI never flickers between old and new data.

### Failure Isolation

**Rule:**
> Cache is never cleared on failure. Only overwritten on success.

**Implementation:**
```javascript
try {
  results = await multicall.execute(batch, provider)
  
  for (result in results) {
    if (result.success) {
      updateCache(result)
    } else {
      // Keep existing cache value
      scheduleRetry(result.poolAddress)
    }
  }
} catch (error) {
  // Network failure — entire batch failed
  // Do NOT clear cache
  // Schedule all pools in batch for retry
  for (pool in batch) {
    scheduleRetry(pool.address)
  }
}
```

**Benefit:**
- No UI flickering
- Graceful degradation under RPC failures
- Last-known-good values persist

### Alive Pool Management

**Liveness Tracking:**

```javascript
aliveSet = Map<PoolAddress, AlivePool>

type AlivePool = {
  address: string,
  tier: "high" | "normal" | "low",
  nextRefresh: timestamp,
  lastBlockSeen: number,
  lastPrice: number,
  requestCount: number,
  lastRequestTime: timestamp
}

function handleTokenInterest(tokens: Token[]) {
  for (token in tokens) {
    for (pool in token.metadata.pricingPools) {
      if (aliveSet.has(pool.address)) {
        // Extend liveness
        aliveSet.get(pool.address).lastRequestTime = now()
        aliveSet.get(pool.address).requestCount++
      } else {
        // Add to alive set
        aliveSet.set(pool.address, {
          address: pool.address,
          tier: "high", // new pools start aggressive
          nextRefresh: now() + 5s,
          lastBlockSeen: 0,
          lastPrice: 0,
          requestCount: 1,
          lastRequestTime: now()
        })
      }
    }
  }
}
```

**Garbage Collection:**

```javascript
function pruneStaleAlive() {
  for ([address, alivePool] in aliveSet) {
    if (now() - alivePool.lastRequestTime > 30s) {
      aliveSet.delete(address)
      cache.delete(address) // optional: keep cache longer
    }
  }
}

setInterval(pruneStaleAlive, 10s)
```

### Cache Serving

**Single Source of Truth:**

```javascript
function getTokenPrices(tokens: Token[]): TokenPrice[] {
  results = []
  
  for (token in tokens) {
    poolAddresses = token.metadata.pricingPools.map(p => p.pool)
    
    // Multi-hop pricing if route is 2-hop
    if (poolAddresses.length === 1) {
      // Single hop: TOKEN/USDC
      poolData = cache.get(poolAddresses[0])
      token.price = computeDirectPrice(poolData)
    } else {
      // Two-hop: TOKEN/WETH → WETH/USDC
      pool1Data = cache.get(poolAddresses[0])
      pool2Data = cache.get(poolAddresses[1])
      token.price = computeMultiHopPrice(pool1Data, pool2Data)
    }
    
    results.push(token)
  }
  
  return results
}
```

---

## Pricing Routes: Pre-Indexed Pathfinding

**Critical Design Decision:**

The Market Viewer **never** performs runtime pathfinding. That belongs to the Swapper.

**Pool Registry Route Schema:**

```javascript
{
  "0xTokenAddress": {
    "pricingRoute": [
      {
        "pool": "0xPool1Address",
        "base": "WETH",
        "dexType": "v2",
        "weight": 1
      },
      {
        "pool": "0xPool2Address",
        "base": "USDC",
        "dexType": "v2",
        "weight": 1
      }
    ]
  }
}
```

**Route Constraints:**

- Most tokens: 1 hop (TOKEN/USDC)
- Some tokens: 2 hops (TOKEN/WETH → WETH/USDC)
- Maximum: 2 hops (never more)
- Routes are **static** — decided at registry creation time
- Routes are **deterministic** — no conditional logic

**Hot Path Assumption:**

> "If I received this token, I already know its pools."

If this assumption ever breaks, the entire efficiency model collapses.

---

## Garbage Collection

**Retention Policies:**

| Artifact | Retention | Purge Condition |
|----------|-----------|-----------------|
| Token/pool state cache | 30s | Stale (no recent request) |
| Logos (primary tokens) | 30 days | TTL expiration |
| Logos (quarantine tokens) | 7 days | TTL expiration |
| Quarantine tokens (not promoted) | 7 days | No promotion after validation |
| Alive pool entries | 30s | No requests in last 30s |

**Implementation:**

```javascript
// State cache GC
setInterval(() => {
  for ([address, entry] in stateCache) {
    if (now() - entry.timestamp > 30s) {
      stateCache.delete(address)
    }
  }
}, 10s)

// Logo cache GC
setInterval(() => {
  for ([address, logo] in logoCache) {
    tier = getTier(address) // primary vs quarantine
    maxAge = tier === "primary" ? 30days : 7days
    
    if (now() - logo.cachedAt > maxAge) {
      logoCache.delete(address)
    }
  }
}, 1hour)

// Quarantine GC
setInterval(() => {
  for (token in quarantineRegistry) {
    if (now() - token.discoveredAt > 7days && !token.promoted) {
      quarantineRegistry.delete(token.address)
      logoCache.delete(token.address)
    }
  }
}, 1hour)
```

---

## Execution Phases

### Phase 0 — Inventory (No Modifications)

**Objective:** Map existing codebase to required roles.

**Locate components that act as:**

1. **Token Registry**
   - Network-separated metadata source
   - Current structure and schema
   - Mutation points (where discoveries are added)

2. **Cache Layer**
   - Current freshness window (likely 10s)
   - Storage mechanism (in-memory Map?)
   - Invalidation logic

3. **Request Batcher**
   - Deduplication mechanism
   - Current batch size limits

4. **Controller / Scheduler**
   - Alive/stale decision logic
   - Current tracking primitive (tokens or pools?)
   - Refresh trigger mechanism

5. **Multicall Query Engine**
   - RPC provider management
   - Batch construction logic
   - Error handling

6. **Pricing Computation Engine**
   - Post-multicall calculation logic
   - V2 vs V3 handling
   - Multi-hop computation (if any)

7. **Garbage Collector**
   - Current purge intervals
   - What artifacts are purged

8. **Logo/Metadata Cache**
   - Resolution mechanism
   - Storage location
   - TTL management

9. **Discovery Mechanism**
   - Explorer API integration
   - Entry point to registry

**Deliverable:**

Document the location and current behavior of each component **without changing anything**.

**Critical Questions to Answer:**

- Does a pool registry already exist, or only implicit pool references?
- Does the controller track per-entity timing, or only global intervals?
- Is there infrastructure for background tasks?

---

### Phase 1 — Introduce Pool Registry

**Objective:** Establish pools as the primary pricing primitive.

**Do not delete token logic. Extend it.**

**Steps:**

1. **Detect Existing Pool References**
   - Search for: pool address usage, pair address usage, V2/V3 reserve fetching
   - If exists → extend schema
   - If not → introduce network-scoped pool registry

2. **Define Pool Registry Schema**
   ```javascript
   {
     "networkId": {
       "pools": {
         "0xPoolAddress": {
           "address": "0xPoolAddress",
           "dexType": "v2" | "v3",
           "token0": "0xToken0Address",
           "token1": "0xToken1Address",
           "feeTier": 3000, // V3 only
           "weight": 1 | 2
         }
       },
       "pricingRoutes": {
         "0xTokenAddress": [
           { "pool": "0xPool1", "base": "WETH" },
           { "pool": "0xPool2", "base": "USDC" }
         ]
       }
     }
   }
   ```

3. **Attach to Existing Registry Location**
   - Do not create new file if token metadata file exists
   - Add pool registry as sibling structure

**Validation:**

Verify that every token in primary registry has a corresponding entry in `pricingRoutes`.

---

### Phase 2 — Controller Tracks Pools, Not Tokens

**Objective:** Decouple user interest (tokens) from execution units (pools).

**Steps:**

1. **Keep receiving token requests** (unchanged)
2. **Before execution, map tokens → pools:**
   ```javascript
   function mapTopools(tokens: Token[]): Set<PoolAddress> {
     pools = new Set()
     for (token in tokens) {
       for (route in token.metadata.pricingRoutes) {
         pools.add(route.pool)
       }
     }
     return pools
   }
   ```
3. **Deduplication now applies to pools**
4. **Controller liveness now tracks pool addresses**

**No UI change. No cache change.**

**Validation:**

Log requested tokens vs executed pools. Confirm pool count < token count for shared liquidity pairs.

---

### Phase 3 — Tiered Scheduling

**Objective:** Replace fixed 10s ticker with per-pool volatility-based scheduling.

**Find the location where:**
```javascript
setInterval(refreshAllTokens, 10000)
```

**Replace with:**
```javascript
function scheduleNextRefresh(pool: AlivePool) {
  priceDelta = abs(pool.currentPrice - pool.lastPrice) / pool.lastPrice
  
  if (priceDelta > 0.05) {
    pool.nextRefresh = now() + 5000
  } else if (priceDelta > 0.001) {
    pool.nextRefresh = now() + 10000
  } else {
    pool.nextRefresh = now() + 30000
  }
}

function executionLoop() {
  poolsDueForRefresh = aliveSet.filter(p => p.nextRefresh <= now())
  
  if (poolsDueForRefresh.length > 0) {
    multicall.execute(poolsDueForRefresh)
  }
  
  setTimeout(executionLoop, 1000) // check every 1s
}
```

**Validation:**

Monitor refresh intervals per pool. Confirm different pools have different refresh times.

---

### Phase 4 — Weight-Aware Multicall Batching

**Objective:** Prevent payload overruns and distribute load across providers.

**Locate multicall batch construction.**

**Modify to:**
```javascript
function createBatches(pools: AlivePool[]): Batch[] {
  batches = []
  currentBatch = []
  currentWeight = 0
  
  for (pool in pools) {
    poolWeight = pool.dexType === "v2" ? 1 : 2
    
    if (currentWeight + poolWeight > MAX_WEIGHT) {
      batches.push(currentBatch)
      currentBatch = []
      currentWeight = 0
    }
    
    currentBatch.push(pool)
    currentWeight += poolWeight
  }
  
  if (currentBatch.length > 0) {
    batches.push(currentBatch)
  }
  
  return batches
}

function distributeBatches(batches: Batch[]) {
  providerIndex = 0
  
  for (batch in batches) {
    provider = providers[providerIndex % providers.length]
    execute(batch, provider)
    providerIndex++
  }
}
```

**Validation:**

Log batch weights. Confirm no batch exceeds `MAX_WEIGHT`. Confirm round-robin provider usage.

---

### Phase 5 — Block-Aware Pricing

**Objective:** Skip computation when block unchanged.

**In the handoff between query engine and pricing engine:**

```javascript
function processMulticallResults(results: MulticallResult[]) {
  for (result in results) {
    pool = aliveSet.get(result.poolAddress)
    
    if (result.blockNumber === pool.lastBlockSeen) {
      // Block unchanged — state unchanged
      cache.get(result.poolAddress).ttl = now() + 30s
    } else {
      // Block changed — recompute
      price = computePrice(result)
      cache.set(result.poolAddress, {
        price,
        blockNumber: result.blockNumber,
        tickId: currentTickId,
        timestamp: now(),
        ttl: now() + 30s
      })
      
      pool.lastBlockSeen = result.blockNumber
      pool.lastPrice = price
    }
  }
}
```

**Validation:**

Log block change frequency. Monitor pricing computation calls vs multicall calls. Confirm 30-50% reduction in computation during stable periods.

---

### Phase 6 — Cache Versioning (Tick Consistency)

**Objective:** Prevent mixed-epoch data rendering.

**Augment cache schema:**
```javascript
type CacheEntry = {
  poolAddress: string,
  price: number,
  liquidity: number,
  blockNumber: number,
  tickId: string, // incremented per refresh cycle
  timestamp: number,
  ttl: number
}
```

**Client read logic:**
```javascript
function getConsistentPrices(tokens: Token[]): TokenPrice[] | null {
  results = []
  tickIds = new Set()
  
  for (token in tokens) {
    for (poolAddress in token.metadata.pricingRoutes) {
      entry = cache.get(poolAddress)
      
      if (!entry || entry.ttl < now()) {
        return null // missing or stale data
      }
      
      results.push(entry)
      tickIds.add(entry.tickId)
    }
  }
  
  if (tickIds.size > 1) {
    return null // mixed-tick data — wait for next refresh
  }
  
  return results // consistent tick — safe to render
}
```

**Validation:**

Confirm UI never renders mixed-block data during refresh windows.

---

### Phase 7 — Discovery Quarantine

**Objective:** Prevent untrusted discoveries from polluting primary registry.

**Locate explorer discovery insertion point.**

**Insert quarantine layer:**
```javascript
function handleDiscovery(tokenAddress: string, metadata: TokenMetadata) {
  if (primaryRegistry.has(tokenAddress)) {
    return // already exists
  }
  
  // Add to quarantine
  quarantineRegistry.set(tokenAddress, {
    address: tokenAddress,
    metadata,
    discoveredAt: now(),
    validationScheduled: false,
    promoted: false
  })
  
  // Schedule background validation
  scheduleValidation(tokenAddress)
}

// Background validator (separate process)
async function validateQuarantineToken(tokenAddress: string) {
  token = quarantineRegistry.get(tokenAddress)
  
  // Check pool existence (RPC allowed here)
  pools = await findPoolsForToken(tokenAddress)
  
  if (pools.length === 0) {
    return // no pools — not eligible
  }
  
  // Check liquidity threshold
  liquidity = await checkLiquidity(pools[0])
  
  if (liquidity < MIN_LIQUIDITY) {
    return // insufficient liquidity
  }
  
  // Promote to primary registry
  primaryRegistry.add({
    address: tokenAddress,
    metadata: token.metadata,
    pricingRoutes: pools
  })
  
  token.promoted = true
}
```

**Validation:**

Verify new discoveries never immediately appear in primary registry. Confirm promotion occurs only after validation.

---

### Phase 8 — Garbage Collection Alignment

**Objective:** Prevent memory bloat while preserving valuable data.

**Adjust GC intervals:**
```javascript
// Frequent purge: token/pool state (30s)
setInterval(() => {
  for ([address, entry] in stateCache) {
    if (now() - entry.timestamp > 30s) {
      stateCache.delete(address)
    }
  }
}, 10s)

// Long retention: primary logos (30 days)
// Aggressive cleanup: quarantine (7 days)
setInterval(() => {
  for ([address, logo] in logoCache) {
    tier = primaryRegistry.has(address) ? "primary" : "quarantine"
    maxAge = tier === "primary" ? 30days : 7days
    
    if (now() - logo.cachedAt > maxAge) {
      logoCache.delete(address)
    }
  }
}, 1hour)

// Quarantine purge (7 days)
setInterval(() => {
  for ([address, token] in quarantineRegistry) {
    if (now() - token.discoveredAt > 7days && !token.promoted) {
      quarantineRegistry.delete(address)
      logoCache.delete(address)
    }
  }
}, 1hour)
```

**Validation:**

Monitor cache sizes over time. Confirm stable memory usage.

---

### Phase 9 — Preserve Pagination, Search, UI Flow

**No changes to:**
- nextnumber pagination
- Search behavior
- Token-based UI flow
- Metadata serving

**Validation:**

User-facing behavior remains identical. Only internal execution changes.

---

### Phase 10 — Validation Invariants

**After refinement, verify these invariants hold:**

1. ✅ **Users never trigger RPC directly**
   - Mechanism: Cold path serves from registries; hot path executes asynchronously

2. ✅ **RPC calls are made per pool, not per token**
   - Mechanism: Token → pool mapping; deduplication in controller

3. ✅ **Only pools with recent interest are scheduled**
   - Mechanism: Alive pool set with 30s liveness TTL

4. ✅ **Pools refresh at different cadences based on volatility**
   - Mechanism: Per-pool tier assignment (5s/10s/30s)

5. ✅ **Pricing skipped if block unchanged**
   - Mechanism: Block number comparison before computation

6. ✅ **Discovery cannot pollute primary registry**
   - Mechanism: Quarantine layer with background validation

7. ✅ **UI never displays mixed-tick data**
   - Mechanism: Cache versioning with tick consistency check

8. ✅ **Cold path fully prepares tokens before hot path sees them**
   - Mechanism: Pool mapping attachment in cold path serving

**If any invariant fails, the refactor is incomplete.**

---

## Cold Path vs Hot Path: Final Responsibilities

| Domain | Cold Path | Hot Path |
|--------|-----------|----------|
| **Tokens** | Decides which exist, which users see, which are promoted | Never modifies, only consumes |
| **Pools** | Maintains topology registry | Decides which to call, when to refresh |
| **Discovery** | Manages quarantine, schedules validation | Never discovers |
| **Pricing** | Never computes prices | Computes from on-chain state |
| **RPC** | Never touches (except background validator) | Primary consumer |
| **Scheduling** | No scheduling responsibilities | Per-pool tiered refresh |
| **Caching** | Logo/metadata cache (long retention) | State cache (short TTL) |

**Summary:**
- Cold path = **curation and eligibility**
- Hot path = **state and scheduling**

---

## What This Plan Does NOT Do

- ❌ Does not rename files
- ❌ Does not rebuild project structure
- ❌ Does not replace JSON with databases
- ❌ Does not change UI behavior
- ❌ Does not touch Swapper logic
- ❌ Does not introduce new dependencies

**It only:**
- ✅ Corrects internal execution primitives
- ✅ Establishes proper registry ownership
- ✅ Aligns scheduling with AMM pricing reality
- ✅ Eliminates redundant RPC calls
- ✅ Prevents registry pollution
- ✅ Ensures cache consistency

---

## Success Criteria

**Technical Metrics:**

1. **RPC Call Reduction:** 
   - Before: N calls per N tokens
   - After: M calls per M pools (where M << N for shared liquidity)

2. **Scheduling Efficiency:**
   - Before: All tokens refresh every 10s
   - After: High-volatility pools refresh at 5s, stable pools at 30s

3. **Block-Aware Optimization:**
   - Before: Pricing computed on every refresh
   - After: Pricing skipped when block unchanged (30-50% reduction)

4. **Discovery Safety:**
   - Before: Explorer discoveries immediately visible
   - After: Quarantine → validation → promotion (7-day purge if invalid)

5. **Cache Consistency:**
   - Before: Possible mixed-epoch rendering
   - After: Tick-versioned cache prevents mixed-block data

**Behavioral Invariants:**

- ✅ User interactions remain synchronous and instant (no perceived latency change)
- ✅ Pricing updates continue without interruption
- ✅ Registry integrity maintained under all conditions
- ✅ RPC failures do not cause UI flickering
- ✅ Memory usage stable over long-running sessions

---

## Appendix: Implementation Pseudocode

### Cold Path: Token Serving

```javascript
function serveTokensToUI(nextNumber: number, networkId: string): Token[] {
  // Pagination
  startIndex = (nextNumber - 1) * PAGE_SIZE
  tokens = primaryRegistry[networkId].slice(startIndex, startIndex + PAGE_SIZE)
  
  // Attach pool mappings
  for (token in tokens) {
    token.metadata.pricingPools = poolRegistry[networkId].pricingRoutes[token.address]
    
    // Resolve logo
    if (!logoCache.has(token.address)) {
      logoCache.fetch(token.logoUrl)
    }
    token.logoUrl = logoCache.get(token.address)
  }
  
  // Filter tokens without pools (not pricing-eligible)
  eligibleTokens = tokens.filter(t => t.metadata.pricingPools.length > 0)
  
  return eligibleTokens
}
```

### Hot Path: Pool Scheduling

```javascript
function handleTokenInterest(tokens: Token[]) {
  // Map tokens → pools
  requestedPools = new Set()
  for (token in tokens) {
    for (route in token.metadata.pricingPools) {
      requestedPools.add(route.pool)
    }
  }
  
  // Update alive set
  for (poolAddress in requestedPools) {
    if (aliveSet.has(poolAddress)) {
      aliveSet.get(poolAddress).lastRequestTime = now()
    } else {
      aliveSet.set(poolAddress, {
        address: poolAddress,
        tier: "high",
        nextRefresh: now() + 5s,
        lastBlockSeen: 0,
        lastPrice: 0,
        requestCount: 1,
        lastRequestTime: now()
      })
    }
  }
}

function executionLoop() {
  poolsDue = aliveSet.filter(p => p.nextRefresh <= now())
  
  if (poolsDue.length > 0) {
    batches = createWeightedBatches(poolsDue)
    distributeBatchesRoundRobin(batches)
  }
  
  setTimeout(executionLoop, 1000)
}
```

### Hot Path: Multicall Processing

```javascript
async function processMulticallResults(results: MulticallResult[]) {
  currentTickId = generateTickId()
  
  for (result in results) {
    pool = aliveSet.get(result.poolAddress)
    
    if (result.blockNumber === pool.lastBlockSeen) {
      // Block unchanged — extend TTL only
      cache.get(result.poolAddress).ttl = now() + 30s
    } else {
      // Block changed — recompute price
      price = computePrice(result)
      
      cache.set(result.poolAddress, {
        poolAddress: result.poolAddress,
        price,
        liquidity: result.liquidity,
        blockNumber: result.blockNumber,
        tickId: currentTickId,
        timestamp: now(),
        ttl: now() + 30s
      })
      
      // Update tier based on price change
      priceDelta = abs(price - pool.lastPrice) / pool.lastPrice
      pool.lastPrice = price
      pool.lastBlockSeen = result.blockNumber
      
      if (priceDelta > 0.05) {
        pool.tier = "high"
        pool.nextRefresh = now() + 5s
      } else if (priceDelta > 0.001) {
        pool.tier = "normal"
        pool.nextRefresh = now() + 10s
      } else {
        pool.tier = "low"
        pool.nextRefresh = now() + 30s
      }
    }
  }
}
```

---

## Conclusion

This plan provides a **mechanically complete specification** for refining the Market Viewer component. All ambiguities are resolved with concrete mechanisms. All execution primitives are defined. All invariants are specified.

**The plan is now executable without interpretation gaps or architectural drift.**

Proceed to Phase 0 inventory to map existing codebase components to required roles.
