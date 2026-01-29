# AI Execution Prompt: Market Viewer Refinement Implementation

You are tasked with implementing the Market Viewer refinement plan systematically and completely. This is a multi-phase project that requires careful analysis, planning, and execution tracking.

## Your Mission

Read the refinement plan (`MarketViewerRefinementPlan_Complete.md`), analyze the existing codebase, and execute each phase with complete transparency and progress tracking.

## Critical Operating Constraints

### Absolute Rules

1. **Never skip Phase 0** — You must inventory the existing codebase before making any changes
2. **Never make assumptions** — If you cannot locate a component or mechanism, explicitly state this in your progress document
3. **Never modify files without documenting** — Every change must be recorded before execution
4. **Never proceed to the next phase until the current phase is validated** — Each phase has explicit validation criteria
5. **Never touch Swapper logic** — This plan applies only to Market Viewer components
6. **Never rename files or create duplicates** — Extend existing components unless absolutely necessary

### Documentation Protocol

You will maintain a living document called `IMPLEMENTATION_PROGRESS.md` that tracks:

- Current phase
- Completed tasks within current phase
- Discoveries from codebase analysis
- Decisions made and rationale
- Files modified with change descriptions
- Validation results
- Blockers or questions requiring human input

**Update this document after every significant action.**

## Execution Workflow

### Step 1: Initial Analysis

1. Read `MarketViewerRefinementPlan_Complete.md` completely
2. Understand the two-path model (Cold Path vs Hot Path)
3. Understand the four registry concepts
4. Understand all 10 execution phases
5. Create `IMPLEMENTATION_PROGRESS.md` with initial structure

### Step 2: Codebase Inventory (Phase 0)

**Objective:** Map existing codebase to required architectural roles WITHOUT making changes.

**Tasks:**

1. Locate the project root and document the directory structure
2. Identify the primary language(s) and framework(s)
3. Find and document each of these components:

   **Required Component Inventory:**
   
   - [ ] Token registry location and current schema
   - [ ] Network separation mechanism (how tokens are scoped per network)
   - [ ] Cache layer implementation (in-memory? Redis? other?)
   - [ ] Cache freshness/TTL logic (where is the 10s interval defined?)
   - [ ] Request batcher/deduplicator (where are duplicate requests handled?)
   - [ ] Controller/scheduler (what triggers refreshes?)
   - [ ] Alive/stale decision logic (how does the system track which tokens are active?)
   - [ ] Multicall query engine (where are RPC calls batched and executed?)
   - [ ] RPC provider configuration (how many providers? round-robin?)
   - [ ] Pricing computation engine (where is price calculated from reserves/liquidity?)
   - [ ] V2 vs V3 pool handling (how are different DEX types handled?)
   - [ ] Garbage collection mechanism (what gets purged and when?)
   - [ ] Logo/metadata cache (where are logos stored?)
   - [ ] Discovery mechanism (how do new tokens enter the system?)
   - [ ] Explorer API integration (which explorers? how are they called?)
   - [ ] Pagination logic (where is nextnumber handled?)
   - [ ] Search functionality (where does token search occur?)
   - [ ] UI interaction layer (how does frontend request token data?)

4. Document findings in `IMPLEMENTATION_PROGRESS.md` under "Phase 0 Inventory Results"

5. Answer these critical questions:

   **Critical Discovery Questions:**
   
   - Does a pool registry already exist, or only implicit pool references?
   - Is there any pool → token mapping, or only token → pool?
   - Does the controller track per-entity timing, or only global intervals?
   - Is there infrastructure for background tasks/workers?
   - Are there any existing tiered refresh mechanisms?
   - How are multicall batches currently sized?
   - Is block number currently captured from multicall results?
   - Is there any cache versioning or tick concept?
   - Where do explorer discoveries currently write to?
   - Are there any quarantine or validation mechanisms?

6. Create a component map in `IMPLEMENTATION_PROGRESS.md`:

   ```markdown
   ## Component Map
   
   | Required Role | Current Implementation | File Location | Notes |
   |---------------|------------------------|---------------|-------|
   | Token Registry | [Found/Not Found] | path/to/file.ts | Current schema: ... |
   | Cache Layer | [Found/Not Found] | path/to/file.ts | Current TTL: ... |
   | ... | ... | ... | ... |
   ```

7. **STOP and document** — Do not proceed to Phase 1 until Phase 0 inventory is complete and reviewed

### Step 3: Phase-by-Phase Execution

For **each phase (1-10)**, follow this exact workflow:

#### 3.1 Plan Phase

Before writing any code:

1. Re-read the phase objectives from the refinement plan
2. Review your Phase 0 inventory to understand what exists
3. Create a detailed task list for this phase in `IMPLEMENTATION_PROGRESS.md`:

   ```markdown
   ## Phase N: [Phase Name]
   
   **Status:** Planning
   **Started:** [timestamp]
   
   ### Objectives
   [Copy from refinement plan]
   
   ### Pre-Implementation Analysis
   
   #### What Currently Exists
   - Component X does Y
   - File Z contains logic for A
   
   #### What Needs to Change
   - [ ] Modify file X to add Y
   - [ ] Extend schema in Z to include A
   - [ ] Create new function B in file C
   
   #### Implementation Strategy
   [Explain your approach step by step]
   
   #### Files to Modify
   - `path/to/file1.ts` - Reason for modification
   - `path/to/file2.ts` - Reason for modification
   
   #### New Code to Write
   [Describe what new functions/types/logic you'll add]
   
   #### Expected Behavior After Changes
   [Describe observable outcomes]
   
   #### Validation Criteria
   [Copy from refinement plan and add specific checks]
   ```

2. **STOP and confirm plan** — Do not write code until planning is documented

#### 3.2 Execute Phase

1. Implement changes **one file at a time**
2. After each file modification, update `IMPLEMENTATION_PROGRESS.md`:

   ```markdown
   #### Implementation Log
   
   **File:** `path/to/file.ts`
   **Modified:** [timestamp]
   **Changes:**
   - Added function `mapTokensToPools()` that deduplicates pool addresses
   - Modified `Controller.trackInterest()` to accept pool addresses instead of token addresses
   - Extended type `AliveEntry` to include pool-specific fields
   
   **Before (relevant section):**
   ```typescript
   // paste old code snippet
   ```
   
   **After:**
   ```typescript
   // paste new code snippet
   ```
   
   **Rationale:** This implements the pool-centric tracking model from Phase 2
   ```

3. Continue until all planned changes are implemented

#### 3.3 Validate Phase

1. Run validation checks specified in the refinement plan
2. Document validation results in `IMPLEMENTATION_PROGRESS.md`:

   ```markdown
   ### Phase N Validation Results
   
   **Validation Performed:** [timestamp]
   
   #### Invariant Checks
   
   - [✅/❌] Invariant 1: [description]
     - Test method: [how you verified]
     - Result: [what you observed]
   
   - [✅/❌] Invariant 2: [description]
     - Test method: [how you verified]
     - Result: [what you observed]
   
   #### Behavioral Verification
   
   - [✅/❌] Behavior 1: [description]
     - Expected: [what should happen]
     - Actual: [what did happen]
   
   #### Issues Found
   
   [List any problems discovered during validation]
   
   #### Status
   
   - [ ] Phase complete and validated
   - [ ] Phase complete but issues found (describe below)
   - [ ] Phase incomplete (blockers below)
   ```

3. **STOP if validation fails** — Do not proceed to next phase until current phase validates

#### 3.4 Mark Complete

1. Update phase status in `IMPLEMENTATION_PROGRESS.md`:

   ```markdown
   **Status:** ✅ Complete
   **Completed:** [timestamp]
   **Validation:** Passed
   ```

2. Commit changes (if using version control)
3. Move to next phase

### Step 4: Final Validation (Phase 10)

After all phases complete, perform comprehensive system validation:

1. Verify all 8 invariants from refinement plan
2. Compare behavior before/after refactoring
3. Document metrics (RPC call reduction, scheduling efficiency, etc.)
4. Create final summary in `IMPLEMENTATION_PROGRESS.md`

## IMPLEMENTATION_PROGRESS.md Structure

Create this document at the start with the following structure:

```markdown
# Market Viewer Refinement — Implementation Progress

**Started:** [timestamp]
**Current Phase:** Phase 0
**Status:** In Progress

---

## Executive Summary

**Completion Status:** 0/10 phases complete

| Phase | Status | Started | Completed | Validation |
|-------|--------|---------|-----------|------------|
| Phase 0: Inventory | 🔄 In Progress | [timestamp] | - | - |
| Phase 1: Pool Registry | ⏸️ Not Started | - | - | - |
| Phase 2: Controller Transformation | ⏸️ Not Started | - | - | - |
| Phase 3: Tiered Scheduling | ⏸️ Not Started | - | - | - |
| Phase 4: Weight-Aware Batching | ⏸️ Not Started | - | - | - |
| Phase 5: Block-Aware Pricing | ⏸️ Not Started | - | - | - |
| Phase 6: Cache Versioning | ⏸️ Not Started | - | - | - |
| Phase 7: Discovery Quarantine | ⏸️ Not Started | - | - | - |
| Phase 8: GC Alignment | ⏸️ Not Started | - | - | - |
| Phase 9: Preserve UI Flow | ⏸️ Not Started | - | - | - |
| Phase 10: Final Validation | ⏸️ Not Started | - | - | - |

---

## Phase 0: Inventory

**Status:** 🔄 In Progress
**Objective:** Map existing codebase to required architectural roles
**Started:** [timestamp]

### Directory Structure

[Document project structure here]

### Component Map

| Required Role | Current Implementation | File Location | Notes |
|---------------|------------------------|---------------|-------|
| Token Registry | ... | ... | ... |
| Cache Layer | ... | ... | ... |
| Request Batcher | ... | ... | ... |
| Controller/Scheduler | ... | ... | ... |
| Multicall Engine | ... | ... | ... |
| Pricing Engine | ... | ... | ... |
| GC Mechanism | ... | ... | ... |
| Logo Cache | ... | ... | ... |
| Discovery Mechanism | ... | ... | ... |

### Critical Discovery Answers

**Q: Does a pool registry exist?**
A: [Your findings]

**Q: Controller tracking primitive?**
A: [Your findings]

**Q: Background task infrastructure?**
A: [Your findings]

[Continue for all questions]

### Inventory Findings

[Detailed analysis of what exists and what's missing]

### Phase 0 Validation

- [ ] All 18 required components mapped
- [ ] All critical questions answered
- [ ] Component map complete
- [ ] Ready to proceed to Phase 1

---

## Phase 1: Pool Registry Introduction

[Use template from "Phase-by-Phase Execution" section above]

---

## Phase 2: Controller Transformation

[Continue for all phases]

---

## Blockers & Questions

[Maintain a running list of issues that require human input]

---

## Metrics & Observations

### RPC Call Efficiency
- Before: [baseline measurements]
- After Phase N: [measurements]

### Memory Usage
- Before: [baseline]
- After Phase N: [measurements]

[Continue for other metrics]

---

## Change Log

### [Date/Time]
- Modified `file.ts`: [description]
- Added `newfile.ts`: [description]
- Validation result: [✅/❌]

[Maintain chronological log of all changes]
```

## Communication Guidelines

### When You Discover Issues

If you encounter any of these situations, **stop and document clearly**:

1. **Cannot locate a required component** 
   - Document in "Blockers & Questions"
   - Describe what you searched for and where
   - Propose alternatives

2. **Existing code conflicts with plan assumptions**
   - Document the conflict
   - Explain the discrepancy
   - Propose resolution approach

3. **Validation fails**
   - Document the failure
   - Include error messages/logs
   - Describe expected vs actual behavior
   - Do NOT proceed to next phase

4. **Need to make a design decision not covered by plan**
   - Document the decision point
   - Explain options
   - State your recommended approach with rationale

### Progress Updates

After completing each major task, provide a brief update:

```
✅ Completed: [task description]
📝 Updated: IMPLEMENTATION_PROGRESS.md Section [X]
➡️ Next: [next task description]
```

### Phase Completion Announcements

When completing a phase:

```
🎉 Phase N Complete: [Phase Name]

Summary:
- Files modified: [count]
- New functionality: [brief description]
- Validation: [✅ Passed / ❌ Failed]
- Blockers: [None / List blockers]

Updated IMPLEMENTATION_PROGRESS.md with:
- Complete implementation log
- Validation results
- Next phase planning

Ready to proceed: [Yes/No]
```

## Quality Standards

### Code Quality

- Maintain existing code style and conventions
- Add comments explaining non-obvious changes
- Preserve existing functionality unless explicitly changing it
- Use TypeScript types rigorously (if project uses TypeScript)

### Documentation Quality

- Be specific: "Modified line 42 of Controller.ts" not "Changed controller"
- Include code snippets for context
- Explain WHY changes were made, not just WHAT
- Keep IMPLEMENTATION_PROGRESS.md organized and searchable

### Validation Quality

- Test actual behavior, not just syntax
- Include edge cases
- Verify invariants still hold after changes
- Document unexpected observations

## Final Deliverables

When all phases are complete, your final deliverables should include:

1. **IMPLEMENTATION_PROGRESS.md** - Complete implementation journal
2. **All modified source files** - With changes implemented
3. **Final validation report** - Proving all 8 invariants hold
4. **Metrics summary** - Before/after comparison
5. **Outstanding issues list** - Any unresolved blockers or tech debt

## Starting Instructions

Begin by:

1. Reading the refinement plan completely
2. Creating `IMPLEMENTATION_PROGRESS.md` with the structure above
3. Analyzing the codebase to begin Phase 0 inventory
4. Documenting your findings as you discover components

**Remember:** This is a systematic, phase-by-phase transformation. Rushing through phases or skipping documentation will lead to errors and architectural drift. Take your time, be thorough, and maintain complete transparency in your progress tracking.

Good luck with the implementation!
