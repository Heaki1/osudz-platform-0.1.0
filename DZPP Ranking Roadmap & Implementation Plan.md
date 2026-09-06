# osu!DZ — DZPP Ranking Roadmap & Implementation Plan

## Purpose

Build a new Algeria-only ranking system called **DZ Performance Points (DZPP)**.

DZPP is osu!DZ's own performance ranking currency. It is **not osu! pp**, and no osu! global rank, profile pp, or ranked-score value is imported into the ranking system.

Players earn DZPP **only through osu!DZ monthly challenges**.

The intended flow is:

```text
Play / Import Challenge Score
        ↓
Validate Score
        ↓
Get osu! Performance Value
        ↓
Calculate Completion Points
        ↓
Calculate Qualification Points
        ↓
Challenge Ends
        ↓
Calculate Final Placement + Field Factor
        ↓
Finalize DZPP
        ↓
Store/Fix Historical Result
        ↓
Update Cumulative DZPP Ranking
        ↓
Display on DZ Performance Rankings page
```

---

# IMPORTANT WORKING RULES

1. Do not change existing challenge, voting, authentication, or phase rules unless the ranking feature strictly requires it.
2. Keep self-voting protection unchanged.
3. Do not weaken security rules to make testing easier.
4. Do not import osu! profile pp or global rank into DZPP.
5. Do not implement a second difficulty multiplier if the osu! performance calculation already accounts for map difficulty.
6. Do not let voting generate DZPP.
7. DZPP earned from a completed challenge must be historically stable/frozen.
8. Work in small phases. Complete and verify each phase before starting the next.
9. For each implementation phase, add tests before or alongside code changes.
10. Before changing code in a new phase, inspect the existing implementation and explain what will be changed.
11. If a command cannot be run in your environment, tell Heaki the exact command and directory needed so it can be run manually.
12. Do not modify the production database with synthetic data unless an explicitly approved development/testing fixture is required.

---

# CORE DZPP FORMULA

The current design baseline is:

```text
Final DZPP = osu! Performance Value
           + Completion Points
           + Qualification Points
           + Adjusted Placement Points
```

Where:

```text
Adjusted Placement Points
= Base Placement Points × Field Factor
```

and:

```text
Field Factor = min(1, Qualified Players / 8)
```

The exact point amounts may be finalized during Phase 1 before implementation.

---

# COMPONENT 1 — osu! PERFORMANCE VALUE

The osu! performance calculation is the foundation of DZPP.

The intent is to use the appropriate osu! performance value for the player's submitted/imported score rather than inventing another independent performance formula.

The performance component should account for the actual play quality, including the relevant osu! performance factors such as accuracy, misses, and map difficulty as appropriate to the selected osu! performance system.

Do **not** add a separate star-rating multiplier on top unless Phase 1 explicitly determines that it is required after checking exactly what the chosen osu! performance calculation already includes.

The implementation must clearly document:

- How the performance value is obtained.
- Whether it is fetched, calculated, or both.
- Which osu! endpoint/library/service is used.
- What happens if the performance value cannot be obtained.
- Whether the value is provisional during the challenge and finalized later.

---

# COMPONENT 2 — COMPLETION POINTS

Completion Points reward participation in a valid challenge attempt.

Current proposal:

```text
+10 DZPP
```

Rules:

- No submission → 0 Completion Points.
- Invalid/rejected submission → 0 Completion Points.
- Valid challenge score → +10 Completion Points.
- A player receives the completion reward only once for a challenge.
- Multiple attempts must never multiply Completion Points.

The exact definition of “valid score” must be aligned with the existing challenge score validation logic.

---

# COMPONENT 3 — QUALIFICATION POINTS

Qualification Points reward satisfying the challenge's explicit requirements.

Current proposal:

```text
+25 DZPP
```

Example:

```text
Challenge requirement: HDHR + Full Combo

98%, 0 misses, HDHR → qualifies → +25
98%, 1 miss, HDHR    → does not qualify → +0
```

Rules:

- Qualification is determined using the challenge's existing requirements.
- Qualification Points are fixed rather than scaled by accuracy.
- Accuracy is already represented by the osu! performance component.
- A player who does not qualify cannot receive Placement Points.

---

# COMPONENT 4 — PLACEMENT POINTS

Placement Points reward performing better than the other qualified players.

Placement must use the challenge's own ranking rule.

Examples:

- Best Accuracy challenge → rank by accuracy.
- Lowest Miss Count challenge → rank by miss count.
- Future challenge types must define their own ordering rule.

Only qualified players receive Placement Points.

## Current example base placement table

This table is a starting proposal and must be finalized in Phase 1:

| Placement | Base Points |
|---:|---:|
| 1st | 50 |
| 2nd | 40 |
| 3rd | 30 |
| 4th | 25 |
| 5th | 20 |
| 6th | 15 |
| 7th | 10 |
| 8th | 5 |
| 9th+ | 0 |

Do not assume this table is final until approved.

---

# FIELD FACTOR

Placement Points are adjusted according to the number of qualified players.

```text
Field Factor = min(1, Qualified Players / 8)
```

Current intended behavior:

| Qualified Players | Field Factor |
|---:|---:|
| 1 | 12.5% |
| 2 | 25% |
| 3 | 37.5% |
| 4 | 50% |
| 5 | 62.5% |
| 6 | 75% |
| 7 | 87.5% |
| 8+ | 100% |

Important:

- Count **qualified players**, not total submissions.
- The field factor applies **only to Placement Points**.
- Completion and Qualification Points are unaffected.
- osu! performance value is unaffected.
- The purpose is to prevent a tiny early field from generating the same placement reward as a mature competition.

Example:

```text
6 qualified players
2nd-place base = 40
Field factor = 6/8 = 0.75
Actual placement = 40 × 0.75 = 30
```

---

# SCORE OUTCOME MATRIX

The implementation must handle every major score state consistently.

| Situation | Performance | Completion | Qualification | Placement | DZPP |
|---|---|---|---|---|---|
| No submission | 0 | 0 | 0 | 0 | 0 |
| Invalid/rejected submission | 0 | 0 | 0 | 0 | 0 |
| Valid score, fails requirements | Yes | +10 | +0 | +0 | Performance + 10 |
| Valid score, qualifies | Yes | +10 | +25 | Yes | Performance + 10 + 25 + placement |
| Qualified 1st | Yes | +10 | +25 | Highest adjusted placement | Sum of all components |
| Qualified 2nd/3rd/etc. | Yes | +10 | +25 | Adjusted placement | Sum of all components |

The final exact definitions of “valid,” “qualified,” and “best score” must use existing project rules wherever possible.

---

# MULTIPLE ATTEMPTS

A player may potentially submit multiple attempts, but only **one final eligible challenge result** contributes DZPP.

The system must not grant:

```text
Completion Points × number of attempts
```

Instead, determine the player's final/best eligible score according to the challenge's existing scoring rules and calculate one DZPP result for that player for that round.

---

# WINNER / FC / VOTING RULES

## Winner bonus

Do not add a separate winner bonus initially.

1st place is already rewarded through Placement Points.

## FC bonus

Do not add a separate FC bonus initially if the challenge already uses FC as a qualification requirement and the osu! performance calculation already rewards the quality of the play.

## Voting

Voting earns **0 DZPP**.

DZPP is earned through playing challenges, not influencing the ballot.

---

# WHEN DZPP BECOMES FINAL

During the active challenge:

- Store/obtain the player's score information.
- Obtain the applicable osu! performance value.
- Determine completion eligibility.
- Determine qualification status where possible.
- Treat final placement as provisional until the challenge closes.

When the challenge ends:

1. Stop accepting eligible scores according to the existing phase rules.
2. Determine each player's final eligible challenge score.
3. Determine qualification for each player.
4. Determine the qualified field size.
5. Calculate each qualified player's placement.
6. Apply the field factor.
7. Calculate final DZPP.
8. Persist/freeze the final DZPP result.
9. Update the cumulative ranking automatically.

Historical challenge DZPP must not silently change because a formula constant is changed later.

---

# RANKING ELIGIBILITY

The ranking is Algeria-only.

Current intended population:

```text
country_code = DZ
```

The implementation should reuse the existing allowed-country mechanism where appropriate, while keeping Algeria as the only country participating in this ranking for now.

No other country should appear in the DZPP ranking.

---

# RANKING PERIODS

Provide both:

1. **All-Time DZPP** — cumulative DZPP from all finalized challenges.
2. **Year/Season DZPP** — cumulative DZPP for a selected year, e.g. 2026.

All-Time should be the default view.

The existing round year should be used for yearly aggregation where possible.

---

# DATA MODEL DIRECTION

The preferred approach is to store the finalized components with the challenge score/result so historical calculations are explainable and stable.

Conceptually:

```text
challenge_score / challenge result
├── performance_value
├── completion_points
├── qualification_points
├── placement_points
├── placement
├── qualified
└── final_dzpp
```

Exact schema changes must be determined during Phase 1/Phase 3 after inspecting the current tables.

The ranking can then aggregate finalized DZPP values rather than repeatedly reconstructing old calculations.

If a migration is required, make it explicit, safe, reversible where practical, and explain exactly what Heaki needs to run manually.

---

# ROADMAP

## PHASE 1 — DZPP SPECIFICATION (NO CODE)

### Goal
Freeze the rules before implementation.

### Work

Claude should inspect the existing challenge-score, round, user, submission, settings, and osu! score/performance code and produce a final DZPP specification.

Resolve:

- Exact osu! performance calculation/source.
- Exact Completion Points.
- Exact Qualification Points.
- Exact placement table.
- Tie handling.
- Multiple-attempt behavior.
- Valid/rejected score handling.
- Qualification logic for every current challenge requirement.
- Exact challenge closing/finalization trigger.
- Historical storage strategy.
- All-Time/year aggregation.
- Algeria eligibility logic.
- Rounding rules for fractional points.
- What happens if the osu! performance value cannot be obtained.

### Deliverable
A written, implementation-ready DZPP specification with examples.

### Constraint
**Do not modify code in this phase.**

Wait for approval before Phase 2.

---

# PHASE 2 — PURE DZPP CALCULATION ENGINE

### Goal
Implement the scoring logic independently from HTTP/database concerns wherever practical.

### Work

Create a pure/testable calculation module that accepts the required inputs and returns the DZPP components and final result.

Test at minimum:

- No submission.
- Invalid/rejected submission.
- Valid non-qualified score.
- Valid qualified score.
- 1 qualified player.
- 2 qualified players.
- 3 qualified players.
- 4 qualified players.
- 6 qualified players.
- 8 qualified players.
- More than 8 qualified players.
- Every configured placement.
- Ties.
- Fractional placement results.
- Multiple attempts reduced to one final result.
- Zero/low/high performance values.
- Exact rounding behavior.

### Deliverable
Fully tested DZPP calculation engine.

### Verification
Run tests and typecheck before moving on.

---

# PHASE 3 — DATABASE + CHALLENGE INTEGRATION

### Goal
Connect real challenge scores to DZPP finalization.

### Work

- Add required database fields/migration if necessary.
- Persist performance value as needed.
- Persist Completion Points.
- Persist Qualification Points.
- Persist Placement Points.
- Persist placement/qualification status as needed.
- Persist final DZPP.
- Integrate with challenge score processing.
- Integrate finalization with the challenge/round lifecycle.
- Ensure finalized DZPP cannot be silently rewritten.
- Ensure duplicate finalization cannot award points twice.

### Safety
The implementation must be transactionally safe and idempotent.

### Deliverable
A completed challenge automatically produces stable DZPP results for its participants.

---

# PHASE 4 — DZPP RANKING API

### Goal
Provide clean public data for the ranking page.

### Required capabilities

- All-Time ranking.
- Year-specific ranking.
- Algeria-only filtering.
- Pagination.
- Player rank.
- Player DZPP total.
- Challenge count.
- Challenge history/details needed by the UI.

Potential endpoint shape should be chosen after inspecting existing API conventions.

### Tests
Test:

- Algeria-only results.
- Non-DZ users excluded.
- Correct totals.
- Correct ordering.
- Ties in total DZPP.
- Pagination.
- Empty leaderboard.
- Year filtering.
- All-Time filtering.

---

# PHASE 5 — FIGMA MAKE DESIGN HANDOFF

This phase is for the ranking page design, not calculation logic.

The design should be inspired by osu!'s ranking experience while remaining clearly an osu!DZ product.

### Main page

Suggested title:

**DZ Performance Rankings**

Controls:

```text
All Time | 2026 | 2025 | ...
```

Leaderboard should communicate:

- Rank.
- Player.
- DZPP.
- Number of challenges played.
- Wins or other useful challenge statistics.
- Optional average/best result.

### Player detail

Provide a way to inspect a player's challenge history, for example:

```text
Challenge 01 — +285 DZPP
Challenge 02 — +194 DZPP
Challenge 03 — +312 DZPP
```

### Required states

Design:

- Loading.
- Empty ranking.
- No results for selected year.
- Error state.
- Pagination.
- Mobile layout.
- Desktop layout.
- Player detail/history.

### Important
Figma Make should design against the **confirmed Phase 4 data structure**, not invent unrelated fields.

---

# PHASE 6 — FRONTEND IMPLEMENTATION

### Goal
Integrate the approved design with the real ranking API.

### Work

- Implement ranking page.
- Connect All-Time/year selectors.
- Display real player data.
- Display DZPP totals.
- Display player/challenge history where approved.
- Implement loading/error/empty states.
- Ensure mobile responsiveness.
- Follow existing project routing and styling conventions.

### Constraint
Do not change DZPP calculation rules while implementing the UI.

---

# PHASE 7 — AUTOMATION + ADMIN SAFETY

### Goal
Make finalization and maintenance reliable.

### Work

- Ensure challenge close automatically finalizes DZPP.
- Ensure finalization is idempotent.
- Add safe admin recomputation if needed.
- Add audit information for manual recomputation/corrections.
- Ensure a recomputation cannot silently rewrite unrelated historical rounds.

Any admin tool must be explicit and protected by existing admin authorization.

---

# PHASE 8 — END-TO-END VERIFICATION

Test the complete real flow:

```text
Challenge opens
    ↓
Player submits/imports score
    ↓
Score validated
    ↓
osu! performance value obtained
    ↓
Challenge score stored
    ↓
Qualification determined
    ↓
Challenge closes
    ↓
Qualified field calculated
    ↓
Placement calculated
    ↓
Field factor applied
    ↓
Final DZPP stored
    ↓
Ranking total updated
    ↓
Ranking API returns correct result
    ↓
Ranking page displays correct result
```

### Include test cases for

- No participants.
- One participant.
- Small field.
- Eight or more qualified players.
- Qualified and non-qualified participants together.
- Ties.
- Multiple attempts.
- Repeated finalization attempts.
- Non-Algerian users.
- Multiple years.
- Existing historical challenge data.

---

# PHASE 9 — POLISH

After the complete system works:

- Performance optimization.
- Query optimization.
- Accessibility.
- Responsive/mobile refinement.
- Better empty/error states.
- Documentation.
- Admin/audit polish.

Do not introduce new ranking mechanics during this phase.

---

# IMPLEMENTATION ORDER

The required order is:

```text
1. Phase 1 — Specification
2. Phase 2 — Calculation Engine
3. Phase 3 — Database + Challenge Integration
4. Phase 4 — Ranking API
5. Phase 5 — Figma Make Design
6. Phase 6 — Frontend Implementation
7. Phase 7 — Automation/Admin Safety
8. Phase 8 — End-to-End Verification
9. Phase 9 — Polish
```

The immediate starting point is **Phase 1 only**.

---

# FIRST INSTRUCTION TO CLAUDE

Before writing code, inspect the existing implementation and produce the final Phase 1 DZPP specification.

Specifically verify:

1. How challenge scores are currently stored.
2. How osu! performance value can be obtained from an imported/submitted score.
3. How challenge requirements and qualification are currently represented.
4. How challenge ordering/placement is currently calculated.
5. How and when a challenge becomes final.
6. What database migration is required, if any.
7. How All-Time and yearly totals should be derived.
8. How Algeria-only filtering should use the existing country rules.
9. The exact rounding/tie rules.
10. Any conflict between this plan and existing project rules.

Then report the proposed final specification and wait for approval.

**Do not implement Phase 2 or any later phase until the specification is approved.**

