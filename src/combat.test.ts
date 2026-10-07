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
