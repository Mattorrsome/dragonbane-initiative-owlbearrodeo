# Initiative Fixes and Dragonbane Abilities Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the examined initiative bugs, add opt-in Veteran / Surprise / Lightning Fast abilities, and give the GM manual override tools, by moving all combat logic into pure, unit-tested reducers.

**Architecture:** New `src/combat.ts` holds pure reducers `(state, args, ctx) => Result`. `App.tsx` keeps rendering and thin handlers; a `dispatch` helper re-reads room metadata, applies a reducer to the fresh state, and writes it (skipping the write and notifying if the reducer rejects). One GM-only scene watcher replaces the buggy deletion effect.

**Tech Stack:** React 18, TypeScript 5 (strict, `noUnusedLocals`), Vite 5, `@owlbear-rodeo/sdk` 2.2, Vitest (new, dev only).

**Spec:** `docs/superpowers/specs/2026-10-07-initiative-fixes-and-abilities-design.md` (source bug list: `Initial_ Requirements and examination.md`). Run all commands from `C:\Projects\OwlbearInitiative\dragonbane-initiative-owlbearrodeo`.

## Global Constraints

- Deck size: `deckSize = min(20, max(10, participants.length + lightningFastCount))` (each Lightning Fast participant needs one extra card). At 20 participants, Add Participants and +Ferocity are disabled.
- Every action: re-read metadata, apply a pure reducer, write. No mutation of input state (tests deep-freeze inputs).
- Keep card and Lightning Fast toggles: GM or the controlling player. Surprise: GM only, round 1 only.
- Keep-card timing: toggle only, set before "Draw New Round". No late "Keep #N" button.
- Item 1 of the examination (NPCs can Wait) is left as is; docs are reworded to stop saying NPCs cannot wait.
- Role checks live in reducers (they guard mistaken UI, not malicious clients).
- Old saved metadata must load: missing fields get defaults.
- ACTIVE and ROUND_COMPLETE layout unchanged; reuse existing classes in `App.css`; no UI tests; no splitting `App.tsx`.
- Out of scope: verifying ability prerequisites, draw animation or history log, cross-scene token tracking, GM-authoritative broadcast.
- TS config has `noUnusedLocals`/`noUnusedParameters`: every helper in `combat.ts` is `export`ed so tasks compile before later tasks use them.

## Review Focus

Inputs the spec implies but no spec line names; each has a pinning test in the task shown.

1. **Lightning Fast with too few free cards** (20 participants + 1 LF at the cap, or `drawAll` leaving 1 card): `drawTwo` must reject with a message, never deadlock the draw phase (Task 5). The GM can turn LF off or use Set card. The deck counts LF draws, so this only happens once the 20-card cap is hit (e.g. 20 participants + 1 LF).
2. **Ferocity duplicates share a `tokenId`**: deleting that token must remove every entry (Task 3, `participantIdsForTokens`).
3. **Old saved state with no new fields** (`deckSize`, `lastDraw`, ability flags) loads with defaults (Task 1).
4. **GM clears/removes the active or last unacted participant**: turn promotes the next, or the round completes, never a dangling ACTIVE with no card (Tasks 3 and 6).
5. **Kept card above a shrunk deck** (participants removed so `deckSizeFor` drops below a kept card): no duplicate draws, no card orphaned (Task 5, `newRound`).

---

## File Structure

| File | Responsibility |
|---|---|
| `src/types.ts` (modify) | Data model: new `Participant` / `CombatState` fields, `INITIAL_COMBAT_STATE`. |
| `src/combat.ts` (create) | All pure reducers, selectors and helpers. No OBR imports. |
| `src/combat.test.ts` (create) | Vitest unit tests for `combat.ts`. |
| `src/App.tsx` (modify) | Rendering, `dispatch`, thin handlers, deletion watcher, new UI controls. |
| `src/App.css` (modify) | A few small classes for toggles and GM controls. |
| `package.json` (modify) | `vitest` dev dependency, `test` script. |
| `README.md`, `CLAUDE.md`, `docs/store.md` (modify) | Wording fixes and new feature docs. |

Result contract used everywhere:

```ts
export interface Result { state: CombatState; error?: string; notice?: string }
```
A rejected reducer returns the **same state object** (`toBe`) plus `error`. A no-op returns the same state with no error.

---

### Task 1: Vitest, data model, state normalisation, shared helpers

**Files:**
- Modify: `package.json`, `src/types.ts`
- Create: `src/combat.ts`, `src/combat.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (all exported from `src/combat.ts`): `Role`, `Ctx { role; playerId; rand?: () => number }`, `Result`, `MAX_PARTICIPANTS = 20`, `deckSizeFor(n)`, `deckSizeOf(participants)`, `ok(state, notice?)`, `reject(state, error)`, `canControl(p, ctx)`, `displayName(p)`, `findP(s, id)`, `mapP(s, id, fn)`, `sortedByCard(ps)`, `freeCards(s)`, `pick(arr, ctx)`, `heldCards(p)`, `activeParticipant(s)`, `settle(s, skipId?)`, `withDefaults(p)`, `normalizeState(raw)`.

- [ ] **Step 1: Install Vitest and add the script**

Run: `npm install -D vitest@^2.1.0`

Then edit `package.json` scripts to:

```json
"scripts": {
  "dev": "vite",
  "build": "tsc && vite build",
  "preview": "vite preview",
  "test": "vitest run"
},
```

- [ ] **Step 2: Extend the data model in `src/types.ts`**

Replace the file contents with:

```ts
export type CombatPhase = "DRAWING" | "ACTIVE" | "ROUND_COMPLETE";

export type ParticipantStatus = "PENDING" | "ACTIVE" | "ACTED" | "WAITED";

export interface Participant {
  id: string;
  tokenId: string;
  name: string;
  customName: string | null;
  initiativeCard: number | null;
  status: ParticipantStatus;
  controlledBy: string; // Player ID or "GM"
  previousCard: number | null; // card held at the end of the last round
  lightningFast: boolean; // draws two cards, keeps one
  surprise: boolean; // picks a card before anyone else draws (round 1)
  retainNext: boolean; // Veteran: keep final card into the next round
  pendingCards: [number, number] | null; // reserved Lightning Fast pair
}

export interface CombatState {
  isActive: boolean;
  phase: CombatPhase;
  roundNumber: number;
  participants: Participant[];
  currentTurnIndex: number;
  drawnCards: number[]; // every taken card, incl. reserved pairs and kept cards
  deckSize: number;
  lastDraw: { participantId: string; card: number } | null;
}

export const INITIAL_COMBAT_STATE: CombatState = {
  isActive: false,
  phase: "DRAWING",
  roundNumber: 0,
  participants: [],
  currentTurnIndex: 0,
  drawnCards: [],
  deckSize: 10,
  lastDraw: null,
};

export const METADATA_KEY = "com.dragonbane-initiative/combat-state";
```

- [ ] **Step 3: Write the failing tests**

Create `src/combat.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import * as c from "./combat";
import { CombatState, INITIAL_COMBAT_STATE, Participant } from "./types";

// rand 0 always picks the first free card, so draws are deterministic.
export const GM: c.Ctx = { role: "GM", playerId: "gm", rand: () => 0 };
export const P1: c.Ctx = { role: "PLAYER", playerId: "p1", rand: () => 0 };

function deepFreeze<T>(o: T): T {
  if (o && typeof o === "object" && !Object.isFrozen(o)) {
    Object.freeze(o);
    Object.values(o as object).forEach(deepFreeze);
  }
  return o;
}

export function mkP(id: string, over: Partial<Participant> = {}): Participant {
  return {
    id,
    tokenId: "t-" + id,
    name: id,
    customName: null,
    initiativeCard: null,
    status: "PENDING",
    controlledBy: "GM",
    previousCard: null,
    lightningFast: false,
    surprise: false,
    retainNext: false,
    pendingCards: null,
    ...over,
  };
}

// Frozen so any reducer that mutates its input throws.
export function mkS(ps: Participant[], over: Partial<CombatState> = {}): CombatState {
  const drawn = ps.flatMap((p) => c.heldCards(p));
  return deepFreeze({
    isActive: true,
    phase: "DRAWING",
    roundNumber: 1,
    participants: ps,
    currentTurnIndex: 0,
    drawnCards: drawn,
    deckSize: c.deckSizeOf(ps),
    lastDraw: null,
    ...over,
  });
}

describe("deckSizeFor", () => {
  it("clamps between 10 and 20", () => {
    expect(c.deckSizeFor(3)).toBe(10);
    expect(c.deckSizeFor(10)).toBe(10);
    expect(c.deckSizeFor(14)).toBe(14);
    expect(c.deckSizeFor(25)).toBe(20);
  });
});

describe("normalizeState", () => {
  it("returns the initial state for missing metadata", () => {
    expect(c.normalizeState(undefined)).toEqual(INITIAL_COMBAT_STATE);
  });

  it("defaults fields missing from an old in-progress combat", () => {
    const old = {
      isActive: true,
      phase: "ACTIVE",
      roundNumber: 2,
      currentTurnIndex: 1,
      drawnCards: [3, 5],
      participants: [
        { id: "a", tokenId: "t", name: "A", customName: null, initiativeCard: 3, status: "ACTIVE", controlledBy: "GM" },
      ],
    };
    const s = c.normalizeState(old);
    expect(s.deckSize).toBe(10);
    expect(s.lastDraw).toBeNull();
    expect(s.participants[0]).toMatchObject({
      previousCard: null,
      lightningFast: false,
      surprise: false,
      retainNext: false,
      pendingCards: null,
      initiativeCard: 3,
    });
  });
});

describe("settle", () => {
  it("is a no-op outside ACTIVE", () => {
    const s = mkS([mkP("a", { initiativeCard: 1 })]);
    expect(c.settle(s)).toBe(s);
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npx vitest run src/combat.test.ts`
Expected: FAIL (cannot resolve `./combat` / functions undefined).

- [ ] **Step 5: Write `src/combat.ts` (helpers only)**

```ts
import { CombatState, INITIAL_COMBAT_STATE, Participant } from "./types";

export type Role = "GM" | "PLAYER";

export interface Ctx {
  role: Role;
  playerId: string;
  rand?: () => number; // tests inject; defaults to Math.random
}

export interface Result {
  state: CombatState;
  error?: string;
  notice?: string;
}

export const MAX_PARTICIPANTS = 20;
const MIN_DECK = 10;

export const deckSizeFor = (n: number): number =>
  Math.min(MAX_PARTICIPANTS, Math.max(MIN_DECK, n));

export const deckSizeOf = (ps: Participant[]): number =>
  deckSizeFor(ps.length + ps.filter((p) => p.lightningFast).length);

export const ok = (state: CombatState, notice?: string): Result => ({ state, notice });
export const reject = (state: CombatState, error: string): Result => ({ state, error });

export const canControl = (p: Participant, ctx: Ctx): boolean =>
  ctx.role === "GM" || p.controlledBy === ctx.playerId;

export const displayName = (p: Participant): string => p.customName || p.name;

export const findP = (s: CombatState, id: string): Participant | undefined =>
  s.participants.find((p) => p.id === id);

export const mapP = (
  s: CombatState,
  id: string,
  fn: (p: Participant) => Participant
): CombatState => ({
  ...s,
  participants: s.participants.map((p) => (p.id === id ? fn(p) : p)),
});

/** Participants holding a card, lowest first. Never mutates the input. */
export const sortedByCard = (ps: Participant[]): Participant[] =>
  ps
    .filter((p) => p.initiativeCard !== null)
    .sort((a, b) => (a.initiativeCard as number) - (b.initiativeCard as number));

export const freeCards = (s: Pick<CombatState, "deckSize" | "drawnCards">): number[] => {
  const out: number[] = [];
  for (let i = 1; i <= s.deckSize; i++) if (!s.drawnCards.includes(i)) out.push(i);
  return out;
};

export const pick = (arr: number[], ctx: Ctx): number =>
  arr[Math.floor((ctx.rand ?? Math.random)() * arr.length)];

/** Cards a participant currently occupies in the deck (final card + reserved pair). */
export const heldCards = (p: Participant): number[] => [
  ...(p.initiativeCard !== null ? [p.initiativeCard] : []),
  ...(p.pendingCards ?? []),
];

export const activeParticipant = (s: CombatState): Participant | undefined =>
  s.participants.find((p) => p.status === "ACTIVE");

/**
 * After any change in ACTIVE phase: guarantee exactly one ACTIVE participant who holds a
 * card, promoting the lowest-card unacted participant (skipping `skipId` once), or move
 * to ROUND_COMPLETE if nobody is left. Re-derives currentTurnIndex from the active id.
 */
export function settle(s: CombatState, skipId?: string): CombatState {
  if (s.phase !== "ACTIVE") return s;

  let participants: Participant[] = s.participants.map((p) =>
    p.status === "ACTIVE" && p.initiativeCard === null ? { ...p, status: "PENDING" as const } : p
  );

  let active = participants.find((p) => p.status === "ACTIVE");
  if (!active) {
    const left = sortedByCard(participants).filter((p) => p.status !== "ACTED");
    active = left.find((p) => p.id !== skipId) ?? left[0];
    if (!active) {
      return { ...s, participants, phase: "ROUND_COMPLETE", currentTurnIndex: 0 };
    }
    const promoted = active.id;
    participants = participants.map((p) =>
      p.id === promoted ? { ...p, status: "ACTIVE" as const } : p
    );
  }

  const activeId = active.id;
  participants = participants.map((p) =>
    p.status === "ACTIVE" && p.id !== activeId ? { ...p, status: "PENDING" as const } : p
  );

  return {
    ...s,
    participants,
    currentTurnIndex: sortedByCard(participants).findIndex((p) => p.id === activeId),
  };
}

const DEFAULTS = {
  customName: null,
  initiativeCard: null,
  status: "PENDING",
  previousCard: null,
  lightningFast: false,
  surprise: false,
  retainNext: false,
  pendingCards: null,
} as const;

export const withDefaults = (p: Partial<Participant>): Participant =>
  ({ ...DEFAULTS, ...p }) as Participant;

/** Load metadata written by any version of the extension. */
export function normalizeState(raw: unknown): CombatState {
  if (!raw || typeof raw !== "object") return INITIAL_COMBAT_STATE;
  const s = raw as Partial<CombatState>;
  const participants = (s.participants ?? []).map(withDefaults);
  return {
    ...INITIAL_COMBAT_STATE,
    ...s,
    participants,
    deckSize: s.deckSize ?? deckSizeOf(participants),
    lastDraw: s.lastDraw ?? null,
  };
}
```

- [ ] **Step 6: Run tests and typecheck**

Run: `npx vitest run src/combat.test.ts && npx tsc --noEmit`
Expected: all PASS; tsc reports no errors in `combat.ts`/`types.ts`. (`App.tsx` may report errors only if it constructs `Participant`/`CombatState` literals missing the new fields: it does. Those errors are fixed in Task 7; ignore `App.tsx` errors for Tasks 1-6 and check only with `npx vitest run`.)

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/types.ts src/combat.ts src/combat.test.ts
git commit -m "feat: add combat data model, normalizeState and shared helpers with vitest"
```

---

### Task 2: Setup reducers (start, add, ferocity, rename)

**Files:**
- Modify: `src/combat.ts` (append), `src/combat.test.ts` (append)

**Interfaces:**
- Consumes: Task 1 exports.
- Produces: `TokenInfo`, `buildParticipants(items, players, newId?)`, `startCombat(s, {participants}, ctx)`, `addParticipants(s, {participants}, ctx)`, `addFerocity(s, {id, newId}, ctx)`, `setCustomName(s, {id, name}, ctx)`.

- [ ] **Step 1: Write the failing tests** (append to `src/combat.test.ts`)

```ts
describe("setup reducers", () => {
  const counter = () => {
    let n = 0;
    return () => "id" + ++n;
  };

  it("buildParticipants resolves player ownership and names", () => {
    const ps = c.buildParticipants(
      [
        { id: "t1", name: "Token", createdUserId: "p1" },
        { id: "t2", name: "", createdUserId: "unknown" },
      ],
      [{ id: "p1", name: "Alice" }],
      counter()
    );
    expect(ps[0]).toMatchObject({ id: "id1", tokenId: "t1", name: "Alice", controlledBy: "p1" });
    expect(ps[1]).toMatchObject({ name: "Unknown", controlledBy: "GM", lightningFast: false });
  });

  it("startCombat is GM only and sets deck size", () => {
    const parts = [mkP("a"), mkP("b")];
    const r = c.startCombat(INITIAL_COMBAT_STATE, { participants: parts }, GM);
    expect(r.state).toMatchObject({ isActive: true, phase: "DRAWING", roundNumber: 1, deckSize: 10 });
    expect(c.startCombat(INITIAL_COMBAT_STATE, { participants: parts }, P1).error).toBeDefined();
  });

  it("startCombat refuses when already running or over 20", () => {
    const running = mkS([mkP("a")]);
    expect(c.startCombat(running, { participants: [mkP("b")] }, GM).state).toBe(running);
    const many = Array.from({ length: 21 }, (_, i) => mkP("p" + i));
    expect(c.startCombat(INITIAL_COMBAT_STATE, { participants: many }, GM).error).toBeDefined();
  });

  it("addParticipants grows the deck, skips known tokens, caps at 20", () => {
    const s = mkS(Array.from({ length: 10 }, (_, i) => mkP("p" + i)));
    const r = c.addParticipants(s, { participants: [mkP("n1"), mkP("n2"), mkP("p0x", { tokenId: "t-p0" })] }, GM);
    expect(r.state.participants).toHaveLength(12);
    expect(r.state.deckSize).toBe(12);
    const full = mkS(Array.from({ length: 20 }, (_, i) => mkP("p" + i)));
    const over = c.addParticipants(full, { participants: [mkP("z")] }, GM);
    expect(over.error).toBeDefined();
    expect(over.state).toBe(full);
  });

  it("addParticipants reports tokens already in combat", () => {
    const s = mkS([mkP("a")]);
    const r = c.addParticipants(s, { participants: [mkP("a2", { tokenId: "t-a" })] }, GM);
    expect(r.error).toMatch(/already/i);
  });

  it("addFerocity duplicates a participant and respects the cap", () => {
    const s = mkS([mkP("a", { customName: "Troll" })]);
    const r = c.addFerocity(s, { id: "a", newId: "a2" }, GM);
    expect(r.state.participants[1]).toMatchObject({
      id: "a2", tokenId: "t-a", customName: "Troll", initiativeCard: null,
    });
    const full = mkS(Array.from({ length: 20 }, (_, i) => mkP("p" + i)));
    expect(c.addFerocity(full, { id: "p0", newId: "x" }, GM).state).toBe(full);
  });

  it("setCustomName trims and clears blank names", () => {
    const s = mkS([mkP("a")]);
    expect(c.setCustomName(s, { id: "a", name: "  Boss " }, GM).state.participants[0].customName).toBe("Boss");
    expect(c.setCustomName(s, { id: "a", name: "   " }, GM).state.participants[0].customName).toBeNull();
    expect(c.setCustomName(s, { id: "a", name: "x" }, P1).error).toBeDefined();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/combat.test.ts -t "setup reducers"`
Expected: FAIL, `c.buildParticipants is not a function`.

- [ ] **Step 3: Implement** (append to `src/combat.ts`)

```ts
export interface TokenInfo {
  id: string;
  name: string;
  createdUserId: string;
}

/** Shared by start combat and add participants. */
export function buildParticipants(
  items: TokenInfo[],
  players: { id: string; name: string }[],
  newId: () => string = () => crypto.randomUUID()
): Participant[] {
  return items.map((item) => {
    const owner = players.find((pl) => pl.id === item.createdUserId);
    return withDefaults({
      id: newId(),
      tokenId: item.id,
      name: owner?.name || item.name || "Unknown",
      controlledBy: owner ? owner.id : "GM",
    });
  });
}

const gmOnly = (s: CombatState, ctx: Ctx, what: string): Result | null =>
  ctx.role === "GM" ? null : reject(s, `Only the GM can ${what}`);

export function startCombat(s: CombatState, a: { participants: Participant[] }, ctx: Ctx): Result {
  const denied = gmOnly(s, ctx, "start combat");
  if (denied) return denied;
  if (s.isActive) return reject(s, "Combat is already running");
  if (a.participants.length === 0) return reject(s, "Select tokens to add to combat");
  if (a.participants.length > MAX_PARTICIPANTS)
    return reject(s, `At most ${MAX_PARTICIPANTS} participants`);
  return ok(
    {
      ...INITIAL_COMBAT_STATE,
      isActive: true,
      phase: "DRAWING",
      roundNumber: 1,
      participants: a.participants,
      deckSize: deckSizeOf(a.participants),
    },
    "Combat started!"
  );
}

export function addParticipants(
  s: CombatState,
  a: { participants: Participant[] },
  ctx: Ctx
): Result {
  const denied = gmOnly(s, ctx, "add participants");
  if (denied) return denied;
  if (s.phase !== "DRAWING") return reject(s, "Participants can only be added while drawing");
  const known = new Set(s.participants.map((p) => p.tokenId));
  const fresh = a.participants.filter((p) => !known.has(p.tokenId));
  if (fresh.length === 0) return reject(s, "Selected tokens are already in combat");
  if (s.participants.length + fresh.length > MAX_PARTICIPANTS)
    return reject(s, `At most ${MAX_PARTICIPANTS} participants`);
  const participants = [...s.participants, ...fresh];
  return ok(
    { ...s, participants, deckSize: deckSizeOf(participants) },
    `Added ${fresh.length} participant(s)`
  );
}

export function addFerocity(s: CombatState, a: { id: string; newId: string }, ctx: Ctx): Result {
  const denied = gmOnly(s, ctx, "add Ferocity");
  if (denied) return denied;
  const p = findP(s, a.id);
  if (!p) return reject(s, "Participant not found");
  if (s.phase !== "DRAWING") return reject(s, "Ferocity can only be added while drawing");
  if (s.participants.length >= MAX_PARTICIPANTS)
    return reject(s, `At most ${MAX_PARTICIPANTS} participants`);
  const participants = [
    ...s.participants,
    withDefaults({
      id: a.newId,
      tokenId: p.tokenId,
      name: p.name,
      customName: p.customName,
      controlledBy: p.controlledBy,
    }),
  ];
  return ok({ ...s, participants, deckSize: deckSizeOf(participants) });
}

export function setCustomName(s: CombatState, a: { id: string; name: string }, ctx: Ctx): Result {
  const denied = gmOnly(s, ctx, "rename participants");
  if (denied) return denied;
  if (!findP(s, a.id)) return reject(s, "Participant not found");
  const trimmed = a.name.trim();
  return ok(mapP(s, a.id, (p) => ({ ...p, customName: trimmed.length > 0 ? trimmed : null })));
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/combat.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/combat.ts src/combat.test.ts
git commit -m "feat: add setup reducers (start, add, ferocity, rename) with deck sizing"
```

---

### Task 3: Turn flow reducers (start round, act, swap, remove)

**Files:**
- Modify: `src/combat.ts` (append), `src/combat.test.ts` (append)

**Interfaces:**
- Consumes: Task 1 helpers (`settle`, `activeParticipant`, `sortedByCard`, `heldCards`, `ok`, `reject`, `canControl`, `displayName`).
- Produces: `startRound(s, ctx)`, `act(s, ctx)`, `validSwapTargets(s): Participant[]`, `swap(s, {targetId}, ctx)`, `removeParticipants(s, {ids}, ctx)`, `participantIdsForTokens(s, tokenIds): string[]`.

- [ ] **Step 1: Write the failing tests** (append)

```ts
const mkRound = (cards: number[], over: Partial<Participant>[] = []) => {
  const ps = cards.map((card, i) => mkP("abcdefghij"[i], { initiativeCard: card, ...over[i] }));
  return c.startRound(mkS(ps), GM).state;
};
const order = (s: CombatState) => c.sortedByCard(s.participants).map((p) => p.id).join("");
const activeId = (s: CombatState) => c.activeParticipant(s)?.id;

describe("turn flow", () => {
  it("startRound activates the lowest card", () => {
    const s = mkRound([3, 1, 2]);
    expect(s.phase).toBe("ACTIVE");
    expect(activeId(s)).toBe("b");
    expect(s.currentTurnIndex).toBe(0);
  });

  it("startRound rejects while a card is missing", () => {
    const s = mkS([mkP("a", { initiativeCard: 1 }), mkP("b")]);
    const r = c.startRound(s, GM);
    expect(r.error).toBeDefined();
    expect(r.state).toBe(s);
  });

  it("act advances in card order and completes the round", () => {
    let s = mkRound([3, 1, 2]);
    s = c.act(s, GM).state;
    expect(activeId(s)).toBe("c");
    expect(s.participants.find((p) => p.id === "b")?.status).toBe("ACTED");
    s = c.act(s, GM).state;
    s = c.act(s, GM).state;
    expect(s.phase).toBe("ROUND_COMPLETE");
    expect(activeId(s)).toBeUndefined();
  });

  it("act is limited to the controlling player or the GM", () => {
    const s = mkRound([1, 2], [{ controlledBy: "p1" }, {}]);
    expect(c.act(s, { ...P1, playerId: "p2" }).error).toBeDefined();
    expect(c.act(s, P1).error).toBeUndefined();
    const npc = mkRound([1, 2]);
    expect(c.act(npc, P1).state).toBe(npc);
  });

  it("swap exchanges cards, marks the swapper WAITED and keeps order consistent", () => {
    let s = mkRound([1, 2, 3]);
    s = c.swap(s, { targetId: "c" }, GM).state;
    expect(order(s)).toBe("cba");
    expect(activeId(s)).toBe("c");
    expect(s.participants.find((p) => p.id === "a")?.status).toBe("WAITED");
    expect(s.currentTurnIndex).toBe(0);
    s = c.act(s, GM).state;
    expect(activeId(s)).toBe("b");
    s = c.act(s, GM).state;
    expect(activeId(s)).toBe("a");
    s = c.act(s, GM).state;
    expect(s.phase).toBe("ROUND_COMPLETE");
  });

  it("swap rejects ACTED, WAITED and lower-card targets", () => {
    let s = mkRound([1, 2, 3]);
    s = c.act(s, GM).state; // b active, a acted
    expect(c.swap(s, { targetId: "a" }, GM).error).toBeDefined();
    let t = c.swap(mkRound([1, 2, 3]), { targetId: "c" }, GM).state; // c active, a WAITED
    expect(c.swap(t, { targetId: "a" }, GM).error).toBeDefined();
    t = mkRound([1, 2, 3]);
    expect(c.validSwapTargets(t).map((p) => p.id)).toEqual(["b", "c"]);
  });

  it("removeParticipants promotes the next participant when the active one is removed", () => {
    const s = mkRound([1, 2, 3]);
    const r = c.removeParticipants(s, { ids: ["a"] }, GM);
    expect(activeId(r.state)).toBe("b");
    expect(r.state.drawnCards).toEqual([2, 3]);
    expect(r.state.currentTurnIndex).toBe(0);
    expect(r.notice).toMatch(/removed/);
  });

  it("removeParticipants re-derives the turn index when a lower participant is removed", () => {
    let s = mkRound([1, 2, 3]);
    s = c.act(s, GM).state; // b active, index 1
    expect(s.currentTurnIndex).toBe(1);
    const r = c.removeParticipants(s, { ids: ["a"] }, GM);
    expect(activeId(r.state)).toBe("b");
    expect(r.state.currentTurnIndex).toBe(0);
  });

  it("removeParticipants completes the round when nobody unacted remains", () => {
    let s = mkRound([1, 2]);
    s = c.act(s, GM).state;
    const r = c.removeParticipants(s, { ids: ["b"] }, GM);
    expect(r.state.phase).toBe("ROUND_COMPLETE");
    expect(r.state.drawnCards).toEqual([1]);
    const all = c.removeParticipants(mkRound([1, 2]), { ids: ["a", "b"] }, GM);
    expect(all.state.phase).toBe("ROUND_COMPLETE");
    expect(all.state.participants).toEqual([]);
  });

  it("removeParticipants returns reserved pairs to the deck and is GM only", () => {
    const s = mkS([mkP("a", { pendingCards: [4, 5] }), mkP("b", { initiativeCard: 2 })]);
    expect(c.removeParticipants(s, { ids: ["a"] }, GM).state.drawnCards).toEqual([2]);
    expect(c.removeParticipants(s, { ids: ["a"] }, P1).state).toBe(s);
    expect(c.removeParticipants(s, { ids: ["zzz"] }, GM).state).toBe(s);
  });

  it("participantIdsForTokens returns every Ferocity duplicate of a token", () => {
    const s = mkS([mkP("a", { tokenId: "t" }), mkP("a2", { tokenId: "t" }), mkP("b")]);
    expect(c.participantIdsForTokens(s, ["t"])).toEqual(["a", "a2"]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/combat.test.ts -t "turn flow"`
Expected: FAIL, `c.startRound is not a function`.

- [ ] **Step 3: Implement** (append to `src/combat.ts`)

```ts
export function startRound(s: CombatState, ctx: Ctx): Result {
  const denied = gmOnly(s, ctx, "start the round");
  if (denied) return denied;
  if (s.phase !== "DRAWING") return reject(s, "Round already started");
  if (s.participants.length === 0 || s.participants.some((p) => p.initiativeCard === null))
    return reject(s, "Everyone needs a card first");
  return ok(
    settle({
      ...s,
      phase: "ACTIVE",
      participants: s.participants.map((p) => ({ ...p, status: "PENDING" as const })),
    })
  );
}

export function act(s: CombatState, ctx: Ctx): Result {
  if (s.phase !== "ACTIVE") return reject(s, "No round in progress");
  const cur = activeParticipant(s);
  if (!cur) return reject(s, "No active participant");
  if (!canControl(cur, ctx)) return reject(s, "It isn't your turn");
  return ok(settle(mapP(s, cur.id, (p) => ({ ...p, status: "ACTED" as const }))));
}

export function validSwapTargets(s: CombatState): Participant[] {
  const cur = activeParticipant(s);
  if (!cur || cur.initiativeCard === null) return [];
  const card = cur.initiativeCard;
  return sortedByCard(s.participants).filter(
    (p) =>
      p.id !== cur.id &&
      p.status !== "ACTED" &&
      p.status !== "WAITED" &&
      (p.initiativeCard as number) > card
  );
}

export function swap(s: CombatState, a: { targetId: string }, ctx: Ctx): Result {
  if (s.phase !== "ACTIVE") return reject(s, "No round in progress");
  const cur = activeParticipant(s);
  if (!cur) return reject(s, "No active participant");
  if (!canControl(cur, ctx)) return reject(s, "It isn't your turn");
  const target = validSwapTargets(s).find((p) => p.id === a.targetId);
  if (!target) return reject(s, "That participant can't be swapped with");
  return ok(
    settle({
      ...s,
      participants: s.participants.map((p) =>
        p.id === cur.id
          ? { ...p, initiativeCard: target.initiativeCard, status: "WAITED" as const }
          : p.id === target.id
          ? { ...p, initiativeCard: cur.initiativeCard, status: "ACTIVE" as const }
          : p
      ),
    })
  );
}

export function removeParticipants(s: CombatState, a: { ids: string[] }, ctx: Ctx): Result {
  const denied = gmOnly(s, ctx, "remove participants");
  if (denied) return denied;
  const gone = s.participants.filter((p) => a.ids.includes(p.id));
  if (gone.length === 0) return ok(s);
  const released = new Set(gone.flatMap(heldCards));
  const next = settle({
    ...s,
    participants: s.participants.filter((p) => !a.ids.includes(p.id)),
    drawnCards: s.drawnCards.filter((card) => !released.has(card)),
  });
  return ok(next, `${gone.map(displayName).join(", ")} removed from combat`);
}

/** Every participant entry (incl. Ferocity duplicates) backed by one of these tokens. */
export const participantIdsForTokens = (s: CombatState, tokenIds: string[]): string[] =>
  s.participants.filter((p) => tokenIds.includes(p.tokenId)).map((p) => p.id);
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/combat.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/combat.ts src/combat.test.ts
git commit -m "feat: add turn-flow reducers with safe participant removal"
```

---

### Task 4: Drawing reducers (draw one, draw all)

**Files:**
- Modify: `src/combat.ts` (append), `src/combat.test.ts` (append)

**Interfaces:**
- Consumes: Task 1 helpers.
- Produces: `waitingOnSurprise(s): boolean`, `drawCard(s, {id}, ctx)`, `drawAll(s, ctx)`. (`drawCard` sets `lastDraw`; `drawAll` sets `lastDraw` to null.)

- [ ] **Step 1: Write the failing tests** (append)

```ts
describe("drawing", () => {
  it("drawCard takes a free card and records it", () => {
    let s = mkS([mkP("a"), mkP("b")]);
    s = c.drawCard(s, { id: "a" }, GM).state;
    expect(s.participants[0].initiativeCard).toBe(1);
    expect(s.drawnCards).toEqual([1]);
    expect(s.lastDraw).toEqual({ participantId: "a", card: 1 });
    s = c.drawCard(s, { id: "b" }, GM).state;
    expect(s.participants[1].initiativeCard).toBe(2);
  });

  it("a player can draw only for their own participant", () => {
    const s = mkS([mkP("a"), mkP("b", { controlledBy: "p1" })]);
    expect(c.drawCard(s, { id: "a" }, P1).state).toBe(s);
    expect(c.drawCard(s, { id: "b" }, P1).error).toBeUndefined();
  });

  it("drawCard rejects a second draw, a wrong phase and an empty deck", () => {
    const s = mkS([mkP("a", { initiativeCard: 1 }), mkP("b")]);
    expect(c.drawCard(s, { id: "a" }, GM).error).toBeDefined();
    const active = mkS([mkP("a")], { phase: "ACTIVE" });
    expect(c.drawCard(active, { id: "a" }, GM).error).toBeDefined();
    const tiny = mkS([mkP("a"), mkP("b")], { deckSize: 1 });
    const after = c.drawCard(tiny, { id: "a" }, GM).state;
    expect(c.drawCard(after, { id: "b" }, GM).error).toMatch(/no cards/i);
  });

  it("drawAll draws unique cards without mutating the input", () => {
    const s = mkS(Array.from({ length: 12 }, (_, i) => mkP("p" + i)));
    const r = c.drawAll(s, { ...GM, rand: () => 0.99 }).state;
    const cards = r.participants.map((p) => p.initiativeCard);
    expect(new Set(cards).size).toBe(12);
    expect(Math.max(...(cards as number[]))).toBeLessThanOrEqual(12);
    expect(r.drawnCards).toHaveLength(12);
    expect(s.participants[0].initiativeCard).toBeNull();
    expect(s.drawnCards).toEqual([]);
  });

  it("drawAll covers a full 20-participant table and is GM only", () => {
    const s = mkS(Array.from({ length: 20 }, (_, i) => mkP("p" + i)));
    const cards = c.drawAll(s, GM).state.participants.map((p) => p.initiativeCard);
    expect([...cards].sort((x, y) => (x as number) - (y as number))).toEqual(
      Array.from({ length: 20 }, (_, i) => i + 1)
    );
    expect(c.drawAll(s, P1).state).toBe(s);
  });

  it("drawAll leaves already drawn participants alone", () => {
    const s = mkS([mkP("a", { initiativeCard: 4 }), mkP("b")]);
    const r = c.drawAll(s, GM).state;
    expect(r.participants[0].initiativeCard).toBe(4);
    expect(r.participants[1].initiativeCard).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/combat.test.ts -t "drawing"`
Expected: FAIL, `c.drawCard is not a function`.

- [ ] **Step 3: Implement** (append to `src/combat.ts`)

```ts
/** True while a Surprise participant still has to pick a card. */
export const waitingOnSurprise = (s: CombatState): boolean =>
  s.participants.some((p) => p.surprise && p.initiativeCard === null);

/** Shared preconditions for any draw/pick on behalf of a participant. */
export function drawBlock(s: CombatState, p: Participant | undefined, ctx: Ctx): string | null {
  if (!p) return "Participant not found";
  if (s.phase !== "DRAWING") return "Cards can only be drawn while drawing";
  if (!canControl(p, ctx)) return "You don't control that participant";
  if (p.initiativeCard !== null || p.pendingCards) return "Already has a card";
  return null;
}

export function drawCard(s: CombatState, a: { id: string }, ctx: Ctx): Result {
  const p = findP(s, a.id);
  const block = drawBlock(s, p, ctx);
  if (block || !p) return reject(s, block ?? "Participant not found");
  if (p.surprise) return reject(s, "Pick a card for Surprise");
  if (p.lightningFast) return reject(s, "Lightning Fast draws two cards");
  if (waitingOnSurprise(s)) return reject(s, "Waiting for surprise picks");
  const free = freeCards(s);
  if (free.length === 0) return reject(s, "No cards left in the deck");
  const card = pick(free, ctx);
  return ok({
    ...mapP(s, a.id, (x) => ({ ...x, initiativeCard: card })),
    drawnCards: [...s.drawnCards, card],
    lastDraw: { participantId: a.id, card },
  });
}

export function drawAll(s: CombatState, ctx: Ctx): Result {
  const denied = gmOnly(s, ctx, "draw for everyone");
  if (denied) return denied;
  if (s.phase !== "DRAWING") return reject(s, "Cards can only be drawn while drawing");
  if (waitingOnSurprise(s)) return reject(s, "Waiting for surprise picks");
  let drawn = s.drawnCards;
  let changed = false;
  const participants = s.participants.map((p) => {
    if (p.initiativeCard !== null || p.pendingCards || p.lightningFast) return p;
    const free = freeCards({ deckSize: s.deckSize, drawnCards: drawn });
    if (free.length === 0) return p;
    const card = pick(free, ctx);
    drawn = [...drawn, card];
    changed = true;
    return { ...p, initiativeCard: card };
  });
  if (!changed) return reject(s, "Nobody left to draw for");
  return ok({ ...s, participants, drawnCards: drawn, lastDraw: null });
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/combat.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/combat.ts src/combat.test.ts
git commit -m "feat: add non-mutating draw reducers with surprise gating hooks"
```

---

### Task 5: Ability reducers (Lightning Fast, Surprise, Keep card) and new round

**Files:**
- Modify: `src/combat.ts` (append), `src/combat.test.ts` (append)

**Interfaces:**
- Consumes: Task 4 `drawBlock`, `waitingOnSurprise`; Task 1 helpers.
- Produces: `setLightningFast(s, {id, value}, ctx)`, `drawTwo(s, {id}, ctx)`, `chooseOne(s, {id, card}, ctx)`, `setSurprise(s, {id, value}, ctx)`, `pickSurpriseCard(s, {id, card}, ctx)`, `setRetainNext(s, {id, value}, ctx)`, `newRound(s, ctx)`.

- [ ] **Step 1: Write the failing tests** (append)

```ts
describe("Lightning Fast", () => {
  const lf = (extra: Participant[] = [], over: Partial<CombatState> = {}) =>
    mkS([mkP("a", { lightningFast: true }), ...extra], over);

  it("drawTwo reserves two distinct cards", () => {
    const r = c.drawTwo(lf(), { id: "a" }, GM).state;
    expect(r.participants[0].pendingCards).toEqual([1, 2]);
    expect(r.participants[0].initiativeCard).toBeNull();
    expect(r.drawnCards).toEqual([1, 2]);
  });

  it("chooseOne keeps one card and releases the other", () => {
    const s = c.drawTwo(lf(), { id: "a" }, GM).state;
    const r = c.chooseOne(s, { id: "a", card: 2 }, GM).state;
    expect(r.participants[0]).toMatchObject({ initiativeCard: 2, pendingCards: null });
    expect(r.drawnCards).toEqual([2]);
    expect(r.lastDraw).toEqual({ participantId: "a", card: 2 });
  });

  it("chooseOne rejects a card outside the pair and a non-controller", () => {
    const s = c.drawTwo(lf(), { id: "a" }, GM).state;
    expect(c.chooseOne(s, { id: "a", card: 3 }, GM).state).toBe(s);
    expect(c.chooseOne(s, { id: "a", card: 1 }, P1).state).toBe(s);
  });

  it("drawCard rejects an LF participant and drawAll skips them", () => {
    const s = lf([mkP("b")]);
    expect(c.drawCard(s, { id: "a" }, GM).error).toBeDefined();
    const r = c.drawAll(s, GM).state;
    expect(r.participants[0]).toMatchObject({ initiativeCard: null, pendingCards: null });
    expect(r.participants[1].initiativeCard).toBe(1);
  });

  it("drawTwo rejects when it would leave others without a card", () => {
    const ps = Array.from({ length: 20 }, (_, i) => mkP(String(i), i === 0 ? { lightningFast: true } : {}));
    const s = mkS(ps); // deck capped at 20, LF needs 21
    expect(s.deckSize).toBe(20);
    const r = c.drawTwo(s, { id: "0" }, GM);
    expect(r.error).toMatch(/not enough/i);
    expect(r.state).toBe(s);
    const ten = mkS(ps.slice(0, 10)); // 10 participants + 1 LF -> deck 11
    expect(ten.deckSize).toBe(11);
    expect(c.drawTwo(ten, { id: "0" }, GM).error).toBeUndefined();
  });

  it("drawAll leaving one card makes drawTwo reject instead of looping", () => {
    const ps = Array.from({ length: 20 }, (_, i) => mkP(String(i), i === 0 ? { lightningFast: true } : {}));
    const after = c.drawAll(mkS(ps), GM).state;
    expect(c.drawTwo(after, { id: "0" }, GM).error).toBeDefined();
  });

  it("setLightningFast grows the deck by one card per LF participant", () => {
    const s = mkS(Array.from({ length: 10 }, (_, i) => mkP(String(i))));
    expect(s.deckSize).toBe(10);
    const r = c.setLightningFast(s, { id: "0", value: true }, GM).state;
    expect(r.deckSize).toBe(11);
  });

  it("setLightningFast: controller or GM, before a card is held", () => {
    const s = mkS([mkP("a", { controlledBy: "p1" }), mkP("b")]);
    expect(c.setLightningFast(s, { id: "a", value: true }, P1).state.participants[0].lightningFast).toBe(true);
    expect(c.setLightningFast(s, { id: "b", value: true }, P1).error).toBeDefined();
    const held = mkS([mkP("a", { initiativeCard: 3 })]);
    expect(c.setLightningFast(held, { id: "a", value: true }, GM).state).toBe(held);
  });
});

describe("Surprise", () => {
  it("setSurprise is GM only and round 1 only", () => {
    const s = mkS([mkP("a")]);
    expect(c.setSurprise(s, { id: "a", value: true }, GM).state.participants[0].surprise).toBe(true);
    expect(c.setSurprise(s, { id: "a", value: true }, P1).error).toBeDefined();
    const r2 = mkS([mkP("a")], { roundNumber: 2 });
    expect(c.setSurprise(r2, { id: "a", value: true }, GM).state).toBe(r2);
  });

  it("blocks other draws until the surprise participant picks", () => {
    let s = mkS([mkP("a", { surprise: true }), mkP("b")]);
    expect(c.drawCard(s, { id: "b" }, GM).error).toMatch(/surprise/i);
    expect(c.drawAll(s, GM).error).toMatch(/surprise/i);
    expect(c.drawCard(s, { id: "a" }, GM).error).toBeDefined();
    s = c.pickSurpriseCard(s, { id: "a", card: 7 }, GM).state;
    expect(s.participants[0].initiativeCard).toBe(7);
    expect(s.drawnCards).toEqual([7]);
    expect(s.lastDraw).toEqual({ participantId: "a", card: 7 });
    expect(c.drawCard(s, { id: "b" }, GM).state.participants[1].initiativeCard).toBe(1);
  });

  it("pickSurpriseCard rejects taken, out-of-range and non-surprise picks", () => {
    const s = mkS([mkP("a", { surprise: true }), mkP("b", { initiativeCard: 3 }), mkP("c")]);
    expect(c.pickSurpriseCard(s, { id: "a", card: 3 }, GM).error).toBeDefined();
    expect(c.pickSurpriseCard(s, { id: "a", card: 11 }, GM).error).toBeDefined();
    expect(c.pickSurpriseCard(s, { id: "c", card: 5 }, GM).error).toBeDefined();
  });
});

describe("Keep card and newRound", () => {
  const complete = (ps: Participant[], over: Partial<CombatState> = {}) =>
    mkS(ps, { phase: "ROUND_COMPLETE", ...over });

  it("setRetainNext works for the controller in any phase, not for others", () => {
    const s = complete([mkP("a", { controlledBy: "p1", initiativeCard: 2 }), mkP("b", { initiativeCard: 3 })]);
    expect(c.setRetainNext(s, { id: "a", value: true }, P1).state.participants[0].retainNext).toBe(true);
    expect(c.setRetainNext(s, { id: "b", value: true }, P1).error).toBeDefined();
  });

  it("newRound keeps flagged cards, records previousCard and clears one-round flags", () => {
    const s = complete([
      mkP("a", { initiativeCard: 4, retainNext: true, status: "ACTED" }),
      mkP("b", { initiativeCard: 2, surprise: true, status: "ACTED" }),
    ]);
    const r = c.newRound(s, GM).state;
    expect(r.phase).toBe("DRAWING");
    expect(r.roundNumber).toBe(2);
    expect(r.drawnCards).toEqual([4]);
    expect(r.participants[0]).toMatchObject({ initiativeCard: 4, previousCard: 4, status: "PENDING", retainNext: false });
    expect(r.participants[1]).toMatchObject({ initiativeCard: null, previousCard: 2, surprise: false });
    expect(r.lastDraw).toBeNull();
  });

  it("a kept card is never drawn again", () => {
    const s = complete([
      mkP("a", { initiativeCard: 1, retainNext: true }),
      mkP("b", { initiativeCard: 2 }),
    ]);
    const r = c.newRound(s, GM).state;
    expect(c.drawCard(r, { id: "b" }, GM).state.participants[1].initiativeCard).toBe(2);
  });

  it("a kept card above a shrunk deck stays reserved", () => {
    const s = complete(
      [mkP("a", { initiativeCard: 13, retainNext: true }), mkP("b", { initiativeCard: 1 })],
      { deckSize: 14 }
    );
    const r = c.newRound(s, GM).state;
    expect(r.deckSize).toBe(13);
    expect(r.drawnCards).toEqual([13]);
  });

  it("newRound recomputes deck size, is GM only and needs a finished round", () => {
    const ps = Array.from({ length: 12 }, (_, i) => mkP("p" + i, { initiativeCard: i + 1 }));
    expect(c.newRound(complete(ps), GM).state.deckSize).toBe(12);
    const s = complete(ps);
    expect(c.newRound(s, P1).state).toBe(s);
    const active = mkS(ps, { phase: "ACTIVE" });
    expect(c.newRound(active, GM).state).toBe(active);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/combat.test.ts -t "Lightning Fast"`
Expected: FAIL, `c.drawTwo is not a function`.

- [ ] **Step 3: Implement** (append to `src/combat.ts`)

```ts
const unheld = (p: Participant): boolean => p.initiativeCard === null && !p.pendingCards;

export function setLightningFast(
  s: CombatState,
  a: { id: string; value: boolean },
  ctx: Ctx
): Result {
  const p = findP(s, a.id);
  if (!p) return reject(s, "Participant not found");
  if (!canControl(p, ctx)) return reject(s, "You don't control that participant");
  if (s.phase !== "DRAWING" || !unheld(p))
    return reject(s, "Lightning Fast can only change before drawing");
  const next = mapP(s, a.id, (x) => ({ ...x, lightningFast: a.value }));
  if (a.value && deckSizeOf(next.participants) > MAX_PARTICIPANTS)
    return reject(s, "Deck is full");
  return ok({ ...next, deckSize: Math.max(next.deckSize, deckSizeOf(next.participants)) });
}

export function drawTwo(s: CombatState, a: { id: string }, ctx: Ctx): Result {
  const p = findP(s, a.id);
  const block = drawBlock(s, p, ctx);
  if (block || !p) return reject(s, block ?? "Participant not found");
  if (!p.lightningFast) return reject(s, "Lightning Fast is off");
  if (p.surprise) return reject(s, "Pick a card for Surprise");
  if (waitingOnSurprise(s)) return reject(s, "Waiting for surprise picks");
  const free = freeCards(s);
  const othersUndrawn = s.participants.filter((o) => o.id !== a.id && unheld(o)).length;
  if (free.length - 2 < othersUndrawn)
    return reject(s, "Not enough cards left for Lightning Fast");
  const first = pick(free, ctx);
  const second = pick(
    free.filter((card) => card !== first),
    ctx
  );
  return ok({
    ...mapP(s, a.id, (x) => ({ ...x, pendingCards: [first, second] as [number, number] })),
    drawnCards: [...s.drawnCards, first, second],
  });
}

export function chooseOne(s: CombatState, a: { id: string; card: number }, ctx: Ctx): Result {
  const p = findP(s, a.id);
  if (!p || !p.pendingCards) return reject(s, "Nothing to choose");
  if (!canControl(p, ctx)) return reject(s, "You don't control that participant");
  if (!p.pendingCards.includes(a.card)) return reject(s, "Pick one of the two drawn cards");
  const other = p.pendingCards[0] === a.card ? p.pendingCards[1] : p.pendingCards[0];
  return ok({
    ...mapP(s, a.id, (x) => ({ ...x, initiativeCard: a.card, pendingCards: null })),
    drawnCards: s.drawnCards.filter((card) => card !== other),
    lastDraw: { participantId: a.id, card: a.card },
  });
}

export function setSurprise(
  s: CombatState,
  a: { id: string; value: boolean },
  ctx: Ctx
): Result {
  const denied = gmOnly(s, ctx, "set Surprise");
  if (denied) return denied;
  const p = findP(s, a.id);
  if (!p) return reject(s, "Participant not found");
  if (s.roundNumber !== 1) return reject(s, "Surprise only applies in round 1");
  if (s.phase !== "DRAWING" || !unheld(p))
    return reject(s, "Surprise can only change before drawing");
  return ok(mapP(s, a.id, (x) => ({ ...x, surprise: a.value })));
}

export function pickSurpriseCard(
  s: CombatState,
  a: { id: string; card: number },
  ctx: Ctx
): Result {
  const p = findP(s, a.id);
  const block = drawBlock(s, p, ctx);
  if (block || !p) return reject(s, block ?? "Participant not found");
  if (!p.surprise) return reject(s, "Not a Surprise participant");
  if (!freeCards(s).includes(a.card)) return reject(s, "That card isn't available");
  return ok({
    ...mapP(s, a.id, (x) => ({ ...x, initiativeCard: a.card })),
    drawnCards: [...s.drawnCards, a.card],
    lastDraw: { participantId: a.id, card: a.card },
  });
}

export function setRetainNext(
  s: CombatState,
  a: { id: string; value: boolean },
  ctx: Ctx
): Result {
  const p = findP(s, a.id);
  if (!p) return reject(s, "Participant not found");
  if (!canControl(p, ctx)) return reject(s, "You don't control that participant");
  return ok(mapP(s, a.id, (x) => ({ ...x, retainNext: a.value })));
}

export function newRound(s: CombatState, ctx: Ctx): Result {
  const denied = gmOnly(s, ctx, "start a new round");
  if (denied) return denied;
  if (s.phase !== "ROUND_COMPLETE") return reject(s, "The round isn't complete");
  const participants = s.participants.map((p) => ({
    ...p,
    previousCard: p.initiativeCard,
    initiativeCard: p.retainNext ? p.initiativeCard : null,
    status: "PENDING" as const,
    retainNext: false,
    surprise: false,
    pendingCards: null,
  }));
  const drawnCards = participants.flatMap((p) => (p.initiativeCard === null ? [] : [p.initiativeCard]));
  return ok({
    ...s,
    phase: "DRAWING",
    roundNumber: s.roundNumber + 1,
    participants,
    currentTurnIndex: 0,
    drawnCards,
    deckSize: Math.max(deckSizeOf(participants), ...drawnCards),
    lastDraw: null,
  });
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/combat.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/combat.ts src/combat.test.ts
git commit -m "feat: add Lightning Fast, Surprise and Keep card reducers and newRound"
```

---

### Task 6: GM override reducers

**Files:**
- Modify: `src/combat.ts` (append), `src/combat.test.ts` (append)

**Interfaces:**
- Consumes: `settle`, `findP`, `mapP`, `gmOnly` (module-private from Task 2, same file), `freeCards`.
- Produces: `gmSwapCards(s, {first, second}, ctx)`, `gmToggleWait(s, {id}, ctx)`, `gmSetCard(s, {id, card}, ctx)` where `card: number | null`.

- [ ] **Step 1: Write the failing tests** (append)

```ts
describe("GM overrides", () => {
  it("gmSwapCards exchanges cards and keeps the same participant active", () => {
    const s = mkRound([1, 2, 3]);
    const r = c.gmSwapCards(s, { first: "a", second: "c" }, GM).state;
    expect(r.participants.find((p) => p.id === "a")?.initiativeCard).toBe(3);
    expect(r.participants.find((p) => p.id === "c")?.initiativeCard).toBe(1);
    expect(activeId(r)).toBe("a");
    expect(r.currentTurnIndex).toBe(2);
    expect(r.participants.map((p) => p.status)).toEqual(["ACTIVE", "PENDING", "PENDING"]);
  });

  it("gmSwapCards is GM only, needs two different people and is blocked when complete", () => {
    const s = mkRound([1, 2]);
    expect(c.gmSwapCards(s, { first: "a", second: "b" }, P1).state).toBe(s);
    expect(c.gmSwapCards(s, { first: "a", second: "a" }, GM).state).toBe(s);
    const done = c.act(c.act(s, GM).state, GM).state;
    expect(done.phase).toBe("ROUND_COMPLETE");
    expect(c.gmSwapCards(done, { first: "a", second: "b" }, GM).state).toBe(done);
  });

  it("gmSwapCards works while drawing, including with a participant who has no card", () => {
    const s = mkS([mkP("a", { initiativeCard: 4 }), mkP("b")]);
    const r = c.gmSwapCards(s, { first: "a", second: "b" }, GM).state;
    expect(r.participants.map((p) => p.initiativeCard)).toEqual([null, 4]);
  });

  it("gmToggleWait marks the active participant WAITED without moving cards, then clears it", () => {
    let s = mkRound([1, 2, 3]);
    s = c.gmToggleWait(s, { id: "a" }, GM).state;
    expect(s.participants.find((p) => p.id === "a")).toMatchObject({ status: "WAITED", initiativeCard: 1 });
    expect(activeId(s)).toBe("b");
    s = c.gmToggleWait(s, { id: "a" }, GM).state;
    expect(s.participants.find((p) => p.id === "a")?.status).toBe("PENDING");
    expect(activeId(s)).toBe("b");
  });

  it("a waited participant acts once they are the lowest remaining", () => {
    let s = c.gmToggleWait(mkRound([1, 2, 3]), { id: "a" }, GM).state;
    s = c.act(s, GM).state; // b acts
    expect(activeId(s)).toBe("a");
    expect(c.gmToggleWait(s, { id: "zzz" }, GM).state).toBe(s);
  });

  it("gmToggleWait rejects ACTED participants, non-GM and other phases", () => {
    let s = mkRound([1, 2]);
    s = c.act(s, GM).state;
    expect(c.gmToggleWait(s, { id: "a" }, GM).error).toBeDefined();
    expect(c.gmToggleWait(s, { id: "b" }, P1).error).toBeDefined();
    const drawing = mkS([mkP("a")]);
    expect(c.gmToggleWait(drawing, { id: "a" }, GM).state).toBe(drawing);
  });

  it("gmSetCard assigns a free card, returning the old one", () => {
    const s = mkRound([1, 2, 3]);
    const r = c.gmSetCard(s, { id: "a", card: 9 }, GM).state;
    expect(r.participants[0].initiativeCard).toBe(9);
    expect(r.drawnCards.slice().sort((x, y) => x - y)).toEqual([2, 3, 9]);
    expect(activeId(r)).toBe("a");
    expect(r.currentTurnIndex).toBe(2);
  });

  it("gmSetCard rejects taken, out-of-range and non-GM requests, and pending pairs", () => {
    const s = mkRound([1, 2, 3]);
    expect(c.gmSetCard(s, { id: "a", card: 3 }, GM).state).toBe(s);
    expect(c.gmSetCard(s, { id: "a", card: 0 }, GM).state).toBe(s);
    expect(c.gmSetCard(s, { id: "a", card: 11 }, GM).state).toBe(s);
    expect(c.gmSetCard(s, { id: "a", card: 5 }, P1).state).toBe(s);
    const pending = mkS([mkP("a", { pendingCards: [1, 2] })]);
    expect(c.gmSetCard(pending, { id: "a", card: 5 }, GM).state).toBe(pending);
  });

  it("clearing the active participant's card promotes the next one", () => {
    const s = mkRound([1, 2, 3]);
    const r = c.gmSetCard(s, { id: "a", card: null }, GM).state;
    expect(activeId(r)).toBe("b");
    expect(r.participants[0]).toMatchObject({ initiativeCard: null, status: "PENDING" });
    expect(r.drawnCards).toEqual([2, 3]);
  });

  it("clearing the last unacted participant completes the round", () => {
    let s = mkRound([1, 2]);
    s = c.act(s, GM).state;
    expect(c.gmSetCard(s, { id: "b", card: null }, GM).state.phase).toBe("ROUND_COMPLETE");
  });

  it("gmSetCard works while drawing and is blocked when the round is complete", () => {
    const s = mkS([mkP("a", { initiativeCard: 2 })]);
    expect(c.gmSetCard(s, { id: "a", card: 6 }, GM).state.drawnCards).toEqual([6]);
    const done = mkS([mkP("a", { initiativeCard: 2, status: "ACTED" })], { phase: "ROUND_COMPLETE" });
    expect(c.gmSetCard(done, { id: "a", card: 6 }, GM).state).toBe(done);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/combat.test.ts -t "GM overrides"`
Expected: FAIL, `c.gmSwapCards is not a function`.

- [ ] **Step 3: Implement** (append to `src/combat.ts`)

```ts
export function gmSwapCards(
  s: CombatState,
  a: { first: string; second: string },
  ctx: Ctx
): Result {
  const denied = gmOnly(s, ctx, "swap cards");
  if (denied) return denied;
  if (s.phase === "ROUND_COMPLETE") return reject(s, "The round is complete");
  const x = findP(s, a.first);
  const y = findP(s, a.second);
  if (!x || !y || x.id === y.id) return reject(s, "Pick two different participants");
  if (x.pendingCards || y.pendingCards) return reject(s, "Wait for the pending choice");
  return ok(
    settle({
      ...s,
      participants: s.participants.map((p) =>
        p.id === x.id
          ? { ...p, initiativeCard: y.initiativeCard }
          : p.id === y.id
          ? { ...p, initiativeCard: x.initiativeCard }
          : p
      ),
    })
  );
}

export function gmToggleWait(s: CombatState, a: { id: string }, ctx: Ctx): Result {
  const denied = gmOnly(s, ctx, "toggle Wait");
  if (denied) return denied;
  if (s.phase !== "ACTIVE") return reject(s, "No round in progress");
  const p = findP(s, a.id);
  if (!p) return reject(s, "Participant not found");
  if (p.status === "ACTED") return reject(s, "Already acted");
  const waiting = p.status !== "WAITED";
  return ok(
    settle(
      mapP(s, a.id, (x) => ({ ...x, status: waiting ? ("WAITED" as const) : ("PENDING" as const) })),
      waiting ? a.id : undefined
    )
  );
}

export function gmSetCard(
  s: CombatState,
  a: { id: string; card: number | null },
  ctx: Ctx
): Result {
  const denied = gmOnly(s, ctx, "set cards");
  if (denied) return denied;
  if (s.phase === "ROUND_COMPLETE") return reject(s, "The round is complete");
  const p = findP(s, a.id);
  if (!p) return reject(s, "Participant not found");
  if (p.pendingCards) return reject(s, "Wait for the pending choice");
  if (a.card !== null && a.card !== p.initiativeCard && !freeCards(s).includes(a.card))
    return reject(s, "That card isn't available");
  const kept = s.drawnCards.filter((card) => card !== p.initiativeCard);
  return ok(
    settle({
      ...mapP(s, a.id, (x) => ({ ...x, initiativeCard: a.card })),
      drawnCards: a.card === null ? kept : [...kept, a.card],
    })
  );
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/combat.test.ts`
Expected: all PASS (every reducer test green).

- [ ] **Step 5: Commit**

```bash
git add src/combat.ts src/combat.test.ts
git commit -m "feat: add GM override reducers (swap cards, toggle wait, set card)"
```

---

### Task 7: Wire `App.tsx` to reducers; fix the deletion watcher

**Files:**
- Modify: `src/App.tsx` (lines 1-474 logic block; render constants at lines 482-486)

**Interfaces:**
- Consumes: everything from `combat.ts`.
- Produces: `dispatch`, `run`, handlers named as before (`startCombat`, `drawCard`, `drawAllCards`, `startRound`, `act`, `initiateSwap`, `cancelSwap`, `executeSwap`, `addFerocity`, `newRound`, `endCombat`, `removeParticipant`, `addParticipants`, `saveCustomName`) so the existing JSX keeps working. Reducers are imported as `import * as combat` to avoid name clashes.

No unit test (UI/SDK glue); verification is `npx tsc --noEmit`, `npm test`, `npm run build`.

- [ ] **Step 1: Replace imports and the logic block**

Replace lines 1-474 of `src/App.tsx` (everything above `// === RENDER ===`) with:

```tsx
import { useEffect, useState, useCallback } from "react";
import OBR, { Player } from "@owlbear-rodeo/sdk";
import { CombatState, Participant, INITIAL_COMBAT_STATE, METADATA_KEY } from "./types";
import * as combat from "./combat";
import type { Ctx, Result } from "./combat";

type Role = "GM" | "PLAYER";
type Theme = "DARK" | "LIGHT";

function App() {
  const [isReady, setIsReady] = useState(false);
  const [role, setRole] = useState<Role>("PLAYER");
  const [playerId, setPlayerId] = useState<string>("");
  const [theme, setTheme] = useState<Theme>("DARK");
  const [combatState, setCombatState] = useState<CombatState>(INITIAL_COMBAT_STATE);
  const [swappingFrom, setSwappingFrom] = useState<string | null>(null);
  const [partyPlayers, setPartyPlayers] = useState<Player[]>([]);
  const [editingNameId, setEditingNameId] = useState<string | null>(null);
  const [editingNameValue, setEditingNameValue] = useState("");

  const ctx: Ctx = { role, playerId };

  // Re-read metadata, apply the reducer to the fresh state, write. Not atomic, but the
  // read-modify-write window is milliseconds instead of "whatever this client last saw".
  const dispatch = useCallback(
    async (reducer: (s: CombatState) => Result): Promise<boolean> => {
      const metadata = await OBR.room.getMetadata();
      const current = combat.normalizeState(metadata[METADATA_KEY]);
      const { state, error, notice } = reducer(current);
      if (error) {
        await OBR.notification.show(error, "WARNING");
        return false;
      }
      if (state !== current) await OBR.room.setMetadata({ [METADATA_KEY]: state });
      if (notice) await OBR.notification.show(notice);
      return true;
    },
    []
  );
  const run = (reducer: (s: CombatState, c: Ctx) => Result) =>
    dispatch((s) => reducer(s, ctx));

  // Initialize OBR SDK
  useEffect(() => {
    return OBR.onReady(async () => {
      const [playerRole, id, currentTheme, players] = await Promise.all([
        OBR.player.getRole(),
        OBR.player.getId(),
        OBR.theme.getTheme(),
        OBR.party.getPlayers(),
      ]);
      setRole(playerRole);
      setPlayerId(id);
      setTheme(currentTheme.mode);
      setPartyPlayers(players);
      setIsReady(true);

      const metadata = await OBR.room.getMetadata();
      setCombatState(combat.normalizeState(metadata[METADATA_KEY]));
    });
  }, []);

  // Subscribe to metadata changes
  useEffect(() => {
    if (!isReady) return;

    const unsubMetadata = OBR.room.onMetadataChange((metadata) => {
      setCombatState(combat.normalizeState(metadata[METADATA_KEY]));
    });
    const unsubTheme = OBR.theme.onChange((t) => setTheme(t.mode));
    const unsubParty = OBR.party.onChange((p) => setPartyPlayers(p));

    return () => {
      unsubMetadata();
      unsubTheme();
      unsubParty();
    };
  }, [isReady]);

  // Watch for deleted tokens (GM client only, created once, independent of combat state).
  // A token only counts as deleted if we saw it in the scene and it is now gone, so a
  // scene switch (items briefly empty or from another scene) never removes anyone.
  useEffect(() => {
    if (!isReady || role !== "GM") return;

    let sceneReady = false;
    let prevIds = new Set<string>();
    const gmCtx: Ctx = { role: "GM", playerId };

    const seed = async () => {
      const items = await OBR.scene.items.getItems();
      prevIds = new Set(items.map((i) => i.id));
    };

    OBR.scene.isReady().then(async (ready) => {
      sceneReady = ready;
      if (ready) await seed();
    });

    const unsubReady = OBR.scene.onReadyChange(async (ready) => {
      sceneReady = ready;
      prevIds = new Set();
      if (ready) await seed();
    });

    const unsubItems = OBR.scene.items.onChange((items) => {
      if (!sceneReady) return;
      const current = new Set(items.map((i) => i.id));
      const gone = [...prevIds].filter((id) => !current.has(id));
      prevIds = current;
      if (gone.length === 0) return;
      dispatch((s) =>
        combat.removeParticipants(s, { ids: combat.participantIdsForTokens(s, gone) }, gmCtx)
      );
    });

    return () => {
      unsubReady();
      unsubItems();
    };
  }, [isReady, role, playerId, dispatch]);

  const canControl = (participant: Participant): boolean => combat.canControl(participant, ctx);
  const getDisplayName = combat.displayName;

  // === ACTIONS ===

  const saveCustomName = async (participantId: string, newName: string) => {
    await run((s, c) => combat.setCustomName(s, { id: participantId, name: newName }, c));
    setEditingNameId(null);
  };

  const startCombat = async () => {
    const selection = await OBR.player.getSelection();
    if (!selection || selection.length === 0) {
      await OBR.notification.show("Select tokens to add to combat", "WARNING");
      return;
    }
    const items = await OBR.scene.items.getItems(selection);
    const participants = combat.buildParticipants(items, partyPlayers);
    await run((s, c) => combat.startCombat(s, { participants }, c));
  };

  const drawCard = (participantId: string) => {
    const p = combatState.participants.find((x) => x.id === participantId);
    return run((s, c) =>
      p?.lightningFast
        ? combat.drawTwo(s, { id: participantId }, c)
        : combat.drawCard(s, { id: participantId }, c)
    );
  };

  const drawAllCards = () => run((s, c) => combat.drawAll(s, c));
  const startRound = () => run((s, c) => combat.startRound(s, c));
  const act = () => run((s, c) => combat.act(s, c));
  const newRound = () => run((s, c) => combat.newRound(s, c));

  const initiateSwap = (participantId: string) => setSwappingFrom(participantId);
  const cancelSwap = () => setSwappingFrom(null);

  const executeSwap = async (targetId: string) => {
    await run((s, c) => combat.swap(s, { targetId }, c));
    setSwappingFrom(null);
  };

  const addFerocity = (participantId: string) =>
    run((s, c) =>
      combat.addFerocity(s, { id: participantId, newId: crypto.randomUUID() }, c)
    );

  const removeParticipant = (participantId: string) =>
    run((s, c) => combat.removeParticipants(s, { ids: [participantId] }, c));

  const endCombat = async () => {
    if (role !== "GM") return;
    await OBR.room.setMetadata({ [METADATA_KEY]: undefined });
    setCombatState(INITIAL_COMBAT_STATE);
    await OBR.notification.show("Combat ended");
  };

  const addParticipants = async () => {
    const selection = await OBR.player.getSelection();
    if (!selection || selection.length === 0) {
      await OBR.notification.show("Select tokens to add", "WARNING");
      return;
    }
    const items = await OBR.scene.items.getItems(selection);
    const participants = combat.buildParticipants(items, partyPlayers);
    await run((s, c) => combat.addParticipants(s, { participants }, c));
  };

```

- [ ] **Step 2: Update the render constants**

Replace the block (original lines 482-486) that defines `sorted`, `allDrawn`, `currentParticipant`, `validSwapTargets`, `isGM` with:

```tsx
  const sorted = combat.sortedByCard(combatState.participants);
  const allDrawn = combatState.participants.every((p) => p.initiativeCard !== null);
  const currentParticipant = combat.activeParticipant(combatState);
  const validSwapTargets = combat.validSwapTargets(combatState);
  const isGM = role === "GM";
```

- [ ] **Step 3: Typecheck, test, build**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: tsc clean (no `noUnusedLocals` errors; if `Participant` or another import is flagged unused, remove it), all tests PASS, build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "fix: route all actions through dispatch + reducers; rewrite deletion watcher"
```

---

### Task 8: UI for abilities, GM overrides, deck header, last draw

**Files:**
- Modify: `src/App.tsx` (render block), `src/App.css` (append)

**Interfaces:**
- Consumes: Task 7 handlers; `combat.freeCards`, `combat.waitingOnSurprise`, `combat.MAX_PARTICIPANTS`.
- Produces: new handlers `setToggle`, `chooseCard`, `pickSurprise`, `gmSwapClick`, `gmWait`, `gmSetCard`.

No unit tests (UI). Verify with `npx tsc --noEmit && npm run build`, then the manual checklist in Task 9.

- [ ] **Step 1: Add handlers** (insert after `addParticipants`, before `// === RENDER ===`)

```tsx
  const [gmSwapFirst, setGmSwapFirst] = useState<string | null>(null);

  const setLightningFast = (id: string, value: boolean) =>
    run((s, c) => combat.setLightningFast(s, { id, value }, c));
  const setSurprise = (id: string, value: boolean) =>
    run((s, c) => combat.setSurprise(s, { id, value }, c));
  const setRetainNext = (id: string, value: boolean) =>
    run((s, c) => combat.setRetainNext(s, { id, value }, c));
  const chooseCard = (id: string, card: number) =>
    run((s, c) => combat.chooseOne(s, { id, card }, c));
  const pickSurprise = (id: string, card: number) =>
    run((s, c) => combat.pickSurpriseCard(s, { id, card }, c));
  const gmWait = (id: string) => run((s, c) => combat.gmToggleWait(s, { id }, c));
  const gmSetCard = (id: string, card: number | null) =>
    run((s, c) => combat.gmSetCard(s, { id, card }, c));
  const gmSwapClick = async (id: string) => {
    if (gmSwapFirst === null) return setGmSwapFirst(id);
    if (gmSwapFirst === id) return setGmSwapFirst(null);
    const first = gmSwapFirst;
    setGmSwapFirst(null);
    await run((s, c) => combat.gmSwapCards(s, { first, second: id }, c));
  };
```

- [ ] **Step 2: Header, deck and last-draw line**

In the render, replace the header block with:

```tsx
      <div className="header">
        <h1>Draw Initiative</h1>
        <span className="status-badge">
          {getStatusText()}
          {combatState.isActive && ` · Deck 1-${combatState.deckSize}`}
        </span>
      </div>
```

Immediately before `<div className="participant-list">` add:

```tsx
          {combatState.phase === "DRAWING" && combatState.lastDraw && (
            <div className="last-draw">
              {(() => {
                const who = combatState.participants.find(
                  (p) => p.id === combatState.lastDraw!.participantId
                );
                return who ? `${getDisplayName(who)} drew #${combatState.lastDraw.card}` : null;
              })()}
            </div>
          )}
```

- [ ] **Step 3: Status text and per-row logic**

Replace `getParticipantStatusText` with:

```tsx
  const surpriseOutstanding = combat.waitingOnSurprise(combatState);

  const getParticipantStatusText = (p: Participant): string => {
    if (p.status === "ACTIVE") return "Active";
    if (p.status === "ACTED") return "Acted";
    if (p.status === "WAITED") return "Waited";
    if (combatState.phase === "DRAWING" && p.initiativeCard === null) {
      if (p.pendingCards) return "Choosing...";
      if (p.surprise) return "Surprise: pick a card";
      if (surpriseOutstanding) return "Waiting for surprise picks";
      return p.lightningFast ? "Draw two cards" : "Draw card";
    }
    return "";
  };
```

In the `displayParticipants.map` callback, replace the `canDraw` definition with:

```tsx
              const canDraw =
                combatState.phase === "DRAWING" &&
                p.initiativeCard === null &&
                !p.pendingCards &&
                !p.surprise &&
                canControl(p);
              const drawing = combatState.phase === "DRAWING";
              const unheld = p.initiativeCard === null && !p.pendingCards;
              const mine = canControl(p);
              const free = combat.freeCards(combatState);
              const atCap = combatState.participants.length >= combat.MAX_PARTICIPANTS;
```

- [ ] **Step 4: Toggles under the status line**

Directly after `<div className="participant-status">…</div>` add:

```tsx
                    <div className="toggle-row">
                      {drawing && unheld && mine && (
                        <label className="toggle">
                          <input
                            type="checkbox"
                            checked={p.lightningFast}
                            onChange={(e) => setLightningFast(p.id, e.target.checked)}
                          />
                          Lightning Fast
                        </label>
                      )}
                      {isGM && drawing && unheld && combatState.roundNumber === 1 && (
                        <label className="toggle">
                          <input
                            type="checkbox"
                            checked={p.surprise}
                            onChange={(e) => setSurprise(p.id, e.target.checked)}
                          />
                          Surprise
                        </label>
                      )}
                      {mine && (
                        <label className="toggle">
                          <input
                            type="checkbox"
                            checked={p.retainNext}
                            onChange={(e) => setRetainNext(p.id, e.target.checked)}
                          />
                          Keep card next round
                        </label>
                      )}
                    </div>
```

- [ ] **Step 5: Draw controls and GM overrides in the actions column**

Replace the `+Ferocity` button's condition/props and the Draw button with, inside `participant-actions`:

```tsx
                    {isGM && drawing && p.controlledBy === "GM" && (
                      <button
                        className="btn-secondary btn-small"
                        onClick={() => addFerocity(p.id)}
                        disabled={atCap}
                        title={atCap ? "Maximum 20 participants" : "Add Ferocity"}
                      >
                        +Ferocity
                      </button>
                    )}
                    {canDraw && (
                      <button
                        className="btn-primary btn-small"
                        onClick={() => drawCard(p.id)}
                        disabled={surpriseOutstanding}
                      >
                        {p.lightningFast ? "Draw 2" : "Draw"}
                      </button>
                    )}
                    {p.pendingCards && mine && (
                      <>
                        {p.pendingCards.map((card) => (
                          <button
                            key={card}
                            className="btn-primary btn-small"
                            onClick={() => chooseCard(p.id, card)}
                          >
                            #{card}
                          </button>
                        ))}
                      </>
                    )}
                    {p.surprise && p.initiativeCard === null && mine && (
                      <select
                        className="card-select"
                        value=""
                        onChange={(e) => e.target.value && pickSurprise(p.id, Number(e.target.value))}
                      >
                        <option value="">Pick…</option>
                        {free.map((card) => (
                          <option key={card} value={card}>
                            {card}
                          </option>
                        ))}
                      </select>
                    )}

                    {isGM && combatState.phase !== "ROUND_COMPLETE" && (
                      <>
                        <button
                          className={`btn-secondary btn-small ${gmSwapFirst === p.id ? "selected" : ""}`}
                          onClick={() => gmSwapClick(p.id)}
                          title={gmSwapFirst ? "Swap cards with this participant" : "Swap cards (pick two)"}
                        >
                          ⇄
                        </button>
                        {combatState.phase === "ACTIVE" && p.status !== "ACTED" && (
                          <button
                            className="btn-secondary btn-small"
                            onClick={() => gmWait(p.id)}
                            title="Toggle Wait without exchanging cards"
                          >
                            {p.status === "WAITED" ? "Unwait" : "Wait"}
                          </button>
                        )}
                        {!p.pendingCards && (
                          <select
                            className="card-select"
                            value=""
                            onChange={(e) => {
                              if (e.target.value === "") return;
                              gmSetCard(p.id, e.target.value === "none" ? null : Number(e.target.value));
                            }}
                            title="Set or clear card"
                          >
                            <option value="">Set…</option>
                            {p.initiativeCard !== null && <option value="none">Clear</option>}
                            {free.map((card) => (
                              <option key={card} value={card}>
                                {card}
                              </option>
                            ))}
                          </select>
                        )}
                      </>
                    )}
```

Keep the existing remove (`✕`) button after this block unchanged.

- [ ] **Step 6: Footer and Draw-All buttons**

Change the Draw All button to `disabled={allDrawn || surpriseOutstanding}` and add a hint:

```tsx
              <button
                className="btn-secondary btn-full"
                onClick={drawAllCards}
                disabled={allDrawn || surpriseOutstanding}
                title={surpriseOutstanding ? "Waiting for surprise picks" : undefined}
              >
                Draw All Cards
              </button>
```

Change the Add Participants button to `disabled={combatState.participants.length >= combat.MAX_PARTICIPANTS}` (keep its text and `onClick`).

Also update the swap UI header so players see it only when relevant: no change.

- [ ] **Step 7: Append CSS** to `src/App.css`

```css
.toggle-row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
  margin-top: 2px;
}

.toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  opacity: 0.85;
  cursor: pointer;
}

.card-select {
  font-size: 12px;
  max-width: 72px;
}

.btn-small.selected {
  outline: 2px solid currentColor;
}

.last-draw {
  font-size: 12px;
  padding: 4px 8px;
  opacity: 0.8;
}

.participant-actions {
  flex-wrap: wrap;
  justify-content: flex-end;
}
```

- [ ] **Step 8: Verify**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: no TS errors, tests PASS, build succeeds. (If `noUnusedLocals` flags `sorted`/`cancelSwap`, they are still used by the existing JSX; if something is truly unused, delete it.)

- [ ] **Step 9: Commit**

```bash
git add src/App.tsx src/App.css
git commit -m "feat: add ability toggles, card choice, GM overrides, deck header and last-draw line"
```

---

### Task 9: Docs and manual verification

**Files:**
- Modify: `README.md`, `CLAUDE.md`, `docs/store.md`

**Interfaces:** none.

- [ ] **Step 1: README wording** (`README.md`)

- Line 24: replace `- NPCs/monsters (GM-controlled) cannot initiate waits, but can be wait targets` with `- NPCs/monsters (GM-controlled) can wait like any other participant; the GM controls them`.
- Line 67: replace `Click **"Swap"**` with `Click **"Wait"**`.
- Line 77: replace `"Waited" status (swapped, cannot be swap target)` with `"Waited" status (waited, cannot be wait target)` (keep the table's existing formatting).
- Add a new section after the existing initiative rules:

```markdown
### Abilities and GM tools

- **Lightning Fast**: toggle on a participant before drawing. They draw two cards and keep one.
- **Surprise** (GM, round 1 only): the participant picks any free card before anyone else draws.
- **Keep card next round** (Veteran): toggle at any time before "Draw New Round"; the participant keeps their final card.
- The extension does not check that a character actually has an ability.
- The GM can swap two participants' cards (⇄), toggle Wait without exchanging cards, and set or clear any card.
- The deck holds `min(20, max(10, participants + Lightning Fast participants))` cards; at 20 participants, adding more is disabled.
```

- [ ] **Step 2: CLAUDE.md**

- Replace `No linter or test runner is configured.` with `- \`npm test\` — Run Vitest unit tests for \`src/combat.ts\`. No linter is configured.`
- In "Single-component React app", add: `Combat rules live in \`src/combat.ts\` as pure reducers (\`(state, args, ctx) => Result\`); \`App.tsx\` applies them via \`dispatch\` (re-read metadata, reduce, write).`
- Replace `- NPCs/monsters (controlledBy === "GM") cannot initiate swaps but can be swap targets` with `- NPCs/monsters (controlledBy === "GM") can Wait and be Wait targets; the GM controls them`.
- Replace `- Deck of 10 cards (1-10)` with `- Deck of min(20, max(10, participants + Lightning Fast participants)) cards`.
- Replace the `Token deletion is watched…` bullet with `- Token deletion is watched by one GM-client \`OBR.scene.items.onChange\` subscription that only removes tokens it previously saw (scene switches never remove participants)`.

- [ ] **Step 3: docs/store.md**

Replace the "Real-Time Sync" paragraph's race-condition note with: `*Note*: every action re-reads the latest shared state before applying, so simultaneous clicks are safe in normal use; in the rare case two clients act within the same few milliseconds, one action may be rejected with a short notice and can simply be repeated.` Also add one sentence under Features describing Lightning Fast, Surprise and Keep card, matching the README section. Update "participants draw one card per round... from 1-10" to mention the deck grows up to 20 with larger tables.

- [ ] **Step 4: Full verification**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: all green.

- [ ] **Step 5: Manual checklist** (run `npm run dev`, add `http://localhost:5173/manifest.json` in Owlbear Rodeo; use one GM and one player browser). Record results:

- [ ] Start combat with 3 tokens; switch to another scene and back: all participants still listed, no "removed" notice.
- [ ] Verify `onReadyChange` fires on scene switch (the spec's open risk): if participants disappear after a switch, stop and report.
- [ ] Delete a token that is in combat while it is the active participant: one notification (GM client only), next participant becomes active; deleting the last unacted token completes the round.
- [ ] Ferocity duplicate: deleting its token removes both entries.
- [ ] Two clients clicking Draw at the same instant never leave two participants with the same card.
- [ ] With 12 participants the header shows `Deck 1-12`; at 20, "Add Participants" and "+Ferocity" are disabled.
- [ ] Lightning Fast: owner (and GM) see two `#N` buttons; others see "Choosing..."; after choosing, everyone sees "X drew #N".
- [ ] Surprise (round 1): other Draw buttons disabled until the pick; Surprise toggle absent in round 2.
- [ ] Keep card: toggle, finish round, "Draw New Round": card kept, no Draw button, nobody else can draw that number.
- [ ] GM: swap two cards (⇄ then ⇄), Wait toggle, Set/Clear card, including clearing the active participant.
- [ ] An old in-progress combat (saved before this update) still loads.

- [ ] **Step 6: Commit**

```bash
git add README.md CLAUDE.md docs/store.md
git commit -m "docs: document abilities, GM tools, deck sizing and corrected NPC Wait wording"
```

---

## Self-Review

**Spec coverage:** Decisions table (item 1 docs → Task 9; deck size → Tasks 1, 2, 5; concurrency → Task 7 `dispatch`; toggles → Tasks 5, 8; keep-card timing → Task 5/8). Architecture, data model, reducers (`buildParticipants`, `addParticipants`, `addFerocity`, `removeParticipants`, `drawCard`, `drawAll`, `setLightningFast`, `setSurprise`, `setRetainNext`, `drawTwo`, `chooseOne`, `pickSurpriseCard`, `startRound`, `act`, `swap`, `newRound`, GM overrides, settle rule) → Tasks 1-6. Deletion watcher and scene change → Task 7 + checklist. UI bullets (draw 2, chooser, surprise picker, toggles, GM controls, deck header, "drew #N") → Task 8. Error handling → `Result`/`dispatch` and reject tests. Minor fixes (shared `buildParticipants`, README wording) → Tasks 2, 9. Testing list → Tasks 1-6 plus manual checklist. `docs/store.md` wording → Task 9.

**Deviations/clarifications to confirm with the human:** (1) arg-less reducers take `(state, ctx)` rather than `(state, args, ctx)`. (2) `gmToggleWait` marks WAITED and the participant acts again once they are the lowest remaining unacted card; it does not reposition them. (3) Deck size counts Lightning Fast participants (+1 card each); LF can still fail only at the 20-card cap, see Review Focus 1. (4) `newRound` raises `deckSize` to the highest kept card instead of orphaning it. (5) Lightning Fast and Surprise toggles are only changeable in DRAWING before a card is held.

**Placeholder scan:** none. **Type consistency:** `Ctx`, `Result`, `participantIdsForTokens`, `validSwapTargets`, `activeParticipant`, `waitingOnSurprise`, `freeCards`, `MAX_PARTICIPANTS` names match across tasks; `gmSwapCards` args are `{first, second}` in both reducer and handler.
