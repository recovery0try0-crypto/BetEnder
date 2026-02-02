# Market Viewer Refinement - Implementation Plan

**Status**: Ready for execution  
**Start Date**: February 2, 2026  
**Total Estimated Time**: ~4.5 hours

---

## Current State Problems

- ❌ Pagination reads entire file every request (no sorting)
- ❌ No server-side token cache (disk I/O repeated)
- ❌ `pruneStalePools()` defined but never called
- ❌ No ref-counting for pools
- ❌ No "stay-alive" client-server mechanism
- ❌ No micro-batching before multicall
- ❌ Pools persist forever (no grace period)
- ❌ Deduplication missing at multiple stages

---

## Implementation Sequence

### **Phase 1: Schema & Data Structures** (Foundation)
**Files**: `server/domain/types.ts`  
**Effort**: 15min  
**Task**: Add refCount to PoolRegistry

**Change**:
```typescript
// Add to PoolRegistry interface:
refCount?: Record<string, number>; // per-pool user count
```

---

### **Phase 2: In-Memory Caching** (Performance)
**Files**: `server/application/services/CacheLayer.ts` (new)  
**Effort**: 30min  
**Task**: Create token and registry cache layer

**Responsibilities**:
- `getTokensByNetworkCached(chainId)` - cached, invalidated only on discovery
- `getPoolRegistryCached(chainId)` - cached, updated on topology change

**Why**: Eliminate repeated disk reads. Cache invalidates only when topology changes (rare).

---

### **Phase 3: Ref-Counting** (Core Logic)
**Files**: `server/application/services/PoolController.ts`  
**Effort**: 45min  
**Task**: Add ref-counting without removal logic

**Changes**:
- Add `incrementRefCount(poolAddress, chainId)`
- Add `decrementRefCount(poolAddress, chainId)`
- Modify `handleTokenInterest()` to use ref-counting
- **Remove all removal/pruning logic** ← GCManager owns it

**PoolController now only does**:
```typescript
public incrementRefCount(poolAddress: string, chainId: number): void {
  const poolKey = `${chainId}:${poolAddress}`;
  const pool = this.aliveSet.get(poolKey);
  if (pool) pool.refCount++;
}

public decrementRefCount(poolAddress: string, chainId: number): void {
  const poolKey = `${chainId}:${poolAddress}`;
  const pool = this.aliveSet.get(poolKey);
  if (pool) pool.refCount = Math.max(0, pool.refCount - 1);
}
```

---

### **Phase 4: Stay-Alive Protocol** (Demand-Driven)
**Files**: `server/routes.ts` + `client/src/lib/api/MarketViewerClient.ts`  
**Effort**: 60min  
**Task**: Implement client-server stay-alive handshake

**Endpoint**: `POST /api/market/stay-alive`
```json
{
  "tokenAddresses": ["0xaddr1", "0xaddr2"],
  "chainId": 137,
  "ttl": 30000
}
```

**Backend**: Increments refCount for each token's pools

---

### **Phase 5: Micro-Batching** (RPC Efficiency)
**Files**: `server/application/services/PoolScheduler.ts`  
**Effort**: 45min  
**Task**: Collect pools for 50-100ms before multicall

**Changes**:
- Replace immediate multicall with collection window
- Deduplicate pools before batching
- **No GC logic** ← GCManager owns it

---

### **Phase 6: Garbage Collection** (Memory Management)
**Files**: `server/application/services/GCManager.ts`  
**Effort**: 30min  
**Task**: Handle pool removal with grace periods

**Responsibilities**:
- Track pools with refCount=0
- Apply 20s grace period
- Remove expired pools every 30s
- No blocking of hot path

**Logic**:
```typescript
private gracePeriod = 20 * 1000;
private poolsWithZeroRefCount = new Map<string, number>();

private async cleanupPools(): Promise<void> {
  // Check refCount, apply grace period, remove expired
}

startAllCleanupLoops(): void {
  setInterval(() => this.cleanupPools(), 30 * 1000);
}
```

---

### **Phase 7: Deduplication** (Data Quality)
**Files**: `server/application/services/MarketViewerService.ts`  
**Effort**: 30min  
**Task**: Remove duplicate pools at all stages

**Changes**:
- Deduplicate before calling `handleTokenInterest()`
- Deduplicate in `getMarketOverview()` result

---

### **Phase 8: Pagination with Sorting** (Data Access)
**Files**: `server/routes.ts`  
**Effort**: 30min  
**Task**: Add sorting before pagination

**Endpoint**: `GET /api/tokens?chainId=137&page=1&sort=symbol|liquidity|volume`

**Logic**:
```typescript
const tokens = cacheLayer.getTokensByNetworkCached(chainId);
const sortedTokens = sortTokens(tokens, sortParam);
const paginated = sortedTokens.slice(startIdx, endIdx);
```

---

### **Phase 9: Remove On-Demand Discovery** (Clean Hot Path)
**Files**: `server/application/services/MarketViewerService.ts`  
**Effort**: 15min  
**Task**: Remove discovery calls, return insufficient-data

**Changes**:
- Remove any `TokenDiscoveryManager.discoverPoolsForTokens()` calls
- Return `insufficient-data` if pools missing (don't trigger discovery)

---

### **Phase 10: Grace Period Integration** (Smooth Transitions)
**Files**: `server/application/services/PoolController.ts` + `GCManager.ts`  
**Effort**: 20min  
**Task**: Implement 20s grace period after user leaves

**Timeline**:
```
T=0s:   Last user leaves (refCount=0)
T=0-20s: Grace period (pool still refreshed)
T=20s:  No new requests → prune pool
```

---

## Priority Order

| Phase | File | Effort | Impact | Dependency |
|-------|------|--------|--------|------------|
| 1 | types.ts | 15min | Schema | None |
| 2 | CacheLayer.ts (new) | 30min | High (perf) | Phase 1 |
| 3 | PoolController.ts | 45min | Core | Phase 1 |
| 4 | routes.ts + Client | 60min | Core | Phase 3 |
| 5 | PoolScheduler.ts | 45min | Perf | Phase 3 |
| 6 | GCManager.ts | 30min | Memory | Phase 3 |
| 7 | MarketViewerService.ts | 30min | Quality | Phase 2,3 |
| 8 | routes.ts | 30min | UX | Phase 2 |
| 9 | MarketViewerService.ts | 15min | Clean | None |
| 10 | PoolController.ts + GCManager.ts | 20min | UX | Phase 3 |

**Total: ~4.5 hours**

---

## Modularity & Clean Separation

| Component | Responsibility |
|-----------|-----------------|
| **PoolController** | Track pools, manage refCount, answer queries |
| **PoolScheduler** | Batch & refresh pools, update tiers |
| **GCManager** | Remove stale pools, grace periods, cleanup timers |
| **CacheLayer** | In-memory token/registry caching |
| **MarketViewerService** | API responses, deduplication |

---

## Key Invariants

1. ✓ **No duplicate pools** - Every stage deduplicates by pool address
2. ✓ **Ref-counted liveness** - Only pools with refCount > 0 in aliveSet
3. ✓ **Client-driven** - Pools stay alive only if client sends stay-alive
4. ✓ **Non-blocking GC** - Cleanup runs async, never blocks requests
5. ✓ **Pagination sorted** - Always sort before slice
6. ✓ **No on-demand discovery** - Only use pre-computed topology
7. ✓ **Micro-batching** - Collect ~50-100ms before multicall
8. ✓ **Grace period** - 20s buffer after user leaves

---

## What Changes, What Stays

| Component | Status | Details |
|-----------|--------|---------|
| TokenDiscoveryManager | ✓ Keep | Already subgraph-based, working |
| DiscoveryService | ✓ Keep | TTL-aware startup discovery, working |
| SpotPricingEngine | ✓ Keep | Price computation unchanged |
| PoolScheduler | 🔄 Enhance | Add micro-batching (no GC) |
| PoolController | 🔄 Enhance | Add ref-counting (no removal) |
| MarketViewerService | 🔄 Refactor | Remove on-demand, use cache/aliveSet |
| SharedStateCache | ✓ Keep | Live pool state, working |
| Swapper logic | ✓ Untouched | Independent from changes |
| GCManager | 🔄 Enhance | Implement pool cleanup with grace periods |

---

## Next Steps

Execute Phase 1: Schema update to `server/domain/types.ts`
