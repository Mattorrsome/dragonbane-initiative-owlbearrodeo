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
