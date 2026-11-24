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
    tokenIds: ["t-" + id],
    name: id,
    customName: null,
    initiativeCard: null,
    status: "PENDING",
    controlledBy: "GM",
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
    drawnCards: drawn,
    deckSize: c.deckSizeOf(ps),
    lastDraw: null,
    anyPlayerCanEdit: false,
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
      lightningFast: false,
      surprise: false,
      retainNext: false,
      pendingCards: null,
      initiativeCard: 3,
      tokenIds: ["t"],
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

  it("buildParticipants resolves player ownership and uses token names by default", () => {
    const ps = c.buildParticipants(
      [
        { id: "t1", name: "Token", createdUserId: "p1", layer: "CHARACTER" },
        { id: "t2", name: "", createdUserId: "unknown", layer: "CHARACTER" },
      ],
      [{ id: "p1", name: "Alice" }],
      false,
      false,
      counter()
    );
    expect(ps[0]).toMatchObject({ id: "id1", tokenIds: ["t1"], name: "Token", controlledBy: "p1" });
    expect(ps[1]).toMatchObject({ name: "Unknown", controlledBy: "GM", lightningFast: false });
  });

  it("buildParticipants takes the controlling player's name when asked", () => {
    const ps = c.buildParticipants(
      [
        { id: "t1", name: "Token", createdUserId: "p1", layer: "CHARACTER" },
        { id: "t2", name: "Goblin", createdUserId: "gm", layer: "CHARACTER" },
      ],
      [{ id: "p1", name: "Alice" }],
      true,
      false,
      counter()
    );
    expect(ps.map((p) => p.name)).toEqual(["Alice", "Goblin"]);
  });

  it("buildParticipants groups GM tokens with the same name and image, never player tokens", () => {
    const tok = (id: string, name: string, url: string, createdUserId = "gm") =>
      ({ id, name, createdUserId, layer: "CHARACTER", image: { url } });
    const items = [
      tok("g1", "Goblin", "gob.png"),
      tok("p1", "Hero", "hero.png", "p1"),
      tok("g2", "Goblin", "gob.png"),
      tok("g3", "Goblin", "archer.png"),
      tok("p2", "Hero", "hero.png", "p1"),
    ];
    const players = [{ id: "p1", name: "Alice" }];
    const grouped = c.buildParticipants(items, players, false, true, counter());
    expect(grouped.map((p) => p.tokenIds)).toEqual([["g1", "g2"], ["p1"], ["g3"], ["p2"]]);
    expect(c.buildParticipants(items, players, false, false, counter())).toHaveLength(5);
  });

  it("isToken accepts only Character and Mount layer items", () => {
    expect(["CHARACTER", "MOUNT", "DRAWING", "PROP", "TEXT", "MAP"].filter((layer) => c.isToken({ layer })))
      .toEqual(["CHARACTER", "MOUNT"]);
  });

  it("addParticipants adds only the new tokens of a group", () => {
    const s = mkS([mkP("a")]);
    const r = c.addParticipants(s, { participants: [mkP("g", { tokenIds: ["t-a", "t-new"] })] }, GM);
    expect(r.state.participants[1].tokenIds).toEqual(["t-new"]);
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
    const r = c.addParticipants(s, { participants: [mkP("n1"), mkP("n2"), mkP("p0x", { tokenIds: ["t-p0"] })] }, GM);
    expect(r.state.participants).toHaveLength(12);
    expect(r.state.deckSize).toBe(12);
    const full = mkS(Array.from({ length: 20 }, (_, i) => mkP("p" + i)));
    const over = c.addParticipants(full, { participants: [mkP("z")] }, GM);
    expect(over.error).toBeDefined();
    expect(over.state).toBe(full);
  });

  it("addParticipants reports tokens already in combat", () => {
    const s = mkS([mkP("a")]);
    const r = c.addParticipants(s, { participants: [mkP("a2", { tokenIds: ["t-a"] })] }, GM);
    expect(r.error).toMatch(/already/i);
  });

  it("addFerocity duplicates a participant and respects the cap", () => {
    const s = mkS([mkP("a", { customName: "Troll" })]);
    const r = c.addFerocity(s, { id: "a", newId: "a2" }, GM);
    expect(r.state.participants[1]).toMatchObject({
      id: "a2", tokenIds: ["t-a"], customName: "Troll", initiativeCard: null,
    });
    const full = mkS(Array.from({ length: 20 }, (_, i) => mkP("p" + i)));
    expect(c.addFerocity(full, { id: "p0", newId: "x" }, GM).state).toBe(full);
  });

  it("addFerocity copies Lightning Fast and grows the deck for it", () => {
    const ps = Array.from({ length: 9 }, (_, i) => mkP("p" + i));
    const s = mkS([mkP("a", { lightningFast: true }), ...ps]);
    const r = c.addFerocity(s, { id: "a", newId: "a2" }, GM).state;
    expect(r.participants[10].lightningFast).toBe(true);
    expect(r.deckSize).toBe(13); // 11 participants + 2 Lightning Fast
  });

  it("setCustomName trims and clears blank names", () => {
    const s = mkS([mkP("a")]);
    expect(c.setCustomName(s, { id: "a", name: "  Boss " }, GM).state.participants[0].customName).toBe("Boss");
    expect(c.setCustomName(s, { id: "a", name: "   " }, GM).state.participants[0].customName).toBeNull();
    expect(c.setCustomName(s, { id: "a", name: "x" }, P1).error).toBeDefined();
  });
});

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
    expect(r.notice).toMatch(/removed/);
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

  it("removeTokens removes every Ferocity duplicate of a token", () => {
    const s = mkS([mkP("a", { tokenIds: ["t"] }), mkP("a2", { tokenIds: ["t"] }), mkP("b")]);
    expect(c.removeTokens(s, { tokenIds: ["t"] }, GM).state.participants.map((p) => p.id)).toEqual(["b"]);
    expect(c.removeTokens(s, { tokenIds: ["zzz"] }, GM).state).toBe(s);
    expect(c.removeTokens(s, { tokenIds: ["t"] }, P1).state).toBe(s);
  });

  it("removeTokens keeps a group (and its card) until its last token goes", () => {
    const s = mkS([mkP("g", { tokenIds: ["g1", "g2"], initiativeCard: 4 })], { drawnCards: [4] });
    const one = c.removeTokens(s, { tokenIds: ["g1"] }, GM).state;
    expect(one.participants[0]).toMatchObject({ tokenIds: ["g2"], initiativeCard: 4 });
    expect(one.drawnCards).toEqual([4]);
    const all = c.removeTokens(one, { tokenIds: ["g2"] }, GM).state;
    expect(all.participants).toHaveLength(0);
    expect(all.drawnCards).toEqual([]);
  });
});

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

  it("drawCard rejects an LF participant; drawAll deals their pair first", () => {
    const s = lf([mkP("b")]);
    expect(c.drawCard(s, { id: "a" }, GM).error).toBeDefined();
    const r = c.drawAll(s, GM).state;
    expect(r.participants[0]).toMatchObject({ initiativeCard: null, pendingCards: [1, 2] });
    expect(r.participants[1].initiativeCard).toBe(3);
    expect(r.drawnCards).toEqual([1, 2, 3]);
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

describe("Players can Alter Any Token", () => {
  it("lets players toggle Lightning Fast, Surprise and Keep on tokens they don't control", () => {
    const off = mkS([mkP("b")]);
    const on = mkS([mkP("b")], { anyPlayerCanEdit: true });
    expect(c.setLightningFast(off, { id: "b", value: true }, P1).error).toBeDefined();
    expect(c.setSurprise(off, { id: "b", value: true }, P1).error).toBeDefined();
    expect(c.setRetainNext(off, { id: "b", value: true }, P1).error).toBeDefined();
    expect(c.setLightningFast(on, { id: "b", value: true }, P1).state.participants[0].lightningFast).toBe(true);
    expect(c.setSurprise(on, { id: "b", value: true }, P1).state.participants[0].surprise).toBe(true);
    expect(c.setRetainNext(on, { id: "b", value: true }, P1).state.participants[0].retainNext).toBe(true);
  });

  it("lets players Act and Wait on any participant's turn", () => {
    const off = mkS(
      [mkP("a", { initiativeCard: 1, status: "ACTIVE" }), mkP("b", { initiativeCard: 2 })],
      { phase: "ACTIVE" }
    );
    const on = { ...off, anyPlayerCanEdit: true };
    expect(c.act(off, P1).error).toBeDefined();
    expect(c.swap(off, { targetId: "b" }, P1).error).toBeDefined();
    expect(c.act(on, P1).state.participants[0].status).toBe("ACTED");
    expect(c.swap(on, { targetId: "b" }, P1).state.participants[0].status).toBe("WAITED");
  });

  it("lets players draw, pick Surprise and choose Lightning Fast cards for any token", () => {
    const off = mkS([mkP("b"), mkP("s", { surprise: true }), mkP("l", { pendingCards: [2, 5] })]);
    const on = { ...off, anyPlayerCanEdit: true };
    expect(c.drawCard(mkS([mkP("b")]), { id: "b" }, P1).error).toBeDefined();
    expect(c.drawCard(mkS([mkP("b")], { anyPlayerCanEdit: true }), { id: "b" }, P1).state.participants[0].initiativeCard).not.toBeNull();
    expect(c.pickSurpriseCard(off, { id: "s", card: 7 }, P1).error).toBeDefined();
    expect(c.pickSurpriseCard(on, { id: "s", card: 7 }, P1).state.participants[1].initiativeCard).toBe(7);
    expect(c.chooseOne(off, { id: "l", card: 5 }, P1).error).toBeDefined();
    expect(c.chooseOne(on, { id: "l", card: 5 }, P1).state.participants[2].initiativeCard).toBe(5);
  });

  it("startCombat stores the flag", () => {
    const s = c.startCombat(INITIAL_COMBAT_STATE, { participants: [mkP("a")], anyPlayerCanEdit: true }, GM).state;
    expect(s.anyPlayerCanEdit).toBe(true);
  });
});

describe("endRound", () => {
  it("skips everyone left and deals the next round, keeping Veteran cards", () => {
    const s = mkRound([3, 1, 2], [{ retainNext: true }]);
    const r = c.endRound(s, GM).state;
    expect(r).toMatchObject({ phase: "DRAWING", roundNumber: s.roundNumber + 1 });
    expect(r.participants.every((p) => p.status === "PENDING" && p.initiativeCard !== null)).toBe(true);
    expect(r.participants[0].initiativeCard).toBe(3);
  });

  it("is GM only and needs an active round", () => {
    const s = mkRound([1, 2]);
    expect(c.endRound(s, P1).state).toBe(s);
    expect(c.endRound(mkS([mkP("a")]), GM).error).toBeDefined();
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

  it("newRound keeps flagged cards and clears one-round flags", () => {
    const s = complete([
      mkP("a", { initiativeCard: 4, retainNext: true, status: "ACTED" }),
      mkP("b", { initiativeCard: 2, surprise: true, status: "ACTED" }),
    ]);
    const r = c.newRound(s, GM).state;
    expect(r.phase).toBe("DRAWING");
    expect(r.roundNumber).toBe(2);
    expect(r.participants[0]).toMatchObject({ initiativeCard: 4, status: "PENDING", retainNext: false });
    expect(r.participants[1]).toMatchObject({ surprise: false });
    expect(r.lastDraw).toBeNull();
  });

  it("newRound deals everyone, Lightning Fast gets a pair to choose from", () => {
    const s = complete([
      mkP("a", { initiativeCard: 1 }),
      mkP("b", { initiativeCard: 2, lightningFast: true }),
      mkP("c", { initiativeCard: 3, retainNext: true }),
    ]);
    const r = c.newRound(s, GM).state;
    expect(r.participants[0].initiativeCard).not.toBeNull();
    expect(r.participants[1].pendingCards).toHaveLength(2);
    expect(r.participants[2].initiativeCard).toBe(3);
    expect(new Set(r.drawnCards).size).toBe(4);
    expect(r.drawnCards).toContain(3);
  });

  it("newRound with every card kept still starts drawing", () => {
    const s = complete([mkP("a", { initiativeCard: 5, retainNext: true })]);
    const r = c.newRound(s, GM).state;
    expect(r.phase).toBe("DRAWING");
    expect(r.drawnCards).toEqual([5]);
  });

  it("a kept card is never drawn again", () => {
    const s = complete([
      mkP("a", { initiativeCard: 1, retainNext: true }),
      mkP("b", { initiativeCard: 2 }),
    ]);
    const r = c.newRound(s, GM).state;
    expect(r.participants[1].initiativeCard).not.toBe(1);
  });

  it("a kept card above a shrunk deck stays reserved", () => {
    const s = complete(
      [mkP("a", { initiativeCard: 13, retainNext: true }), mkP("b", { initiativeCard: 1 })],
      { deckSize: 14 }
    );
    const r = c.newRound(s, GM).state;
    expect(r.deckSize).toBe(13);
    expect(r.drawnCards).toContain(13);
    expect(r.participants[1].initiativeCard).not.toBe(13);
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
describe("GM overrides", () => {
  it("gmSwapCards exchanges cards and keeps the same participant active", () => {
    const s = mkRound([1, 2, 3]);
    const r = c.gmSwapCards(s, { first: "a", second: "c" }, GM).state;
    expect(r.participants.find((p) => p.id === "a")?.initiativeCard).toBe(3);
    expect(r.participants.find((p) => p.id === "c")?.initiativeCard).toBe(1);
    expect(activeId(r)).toBe("a");
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

  it("parryEvade marks a waiting participant ACTED and leaves the turn alone", () => {
    let s = mkRound([1, 2, 3]);
    s = c.parryEvade(s, { id: "c" }, GM).state;
    expect(s.participants.find((p) => p.id === "c")).toMatchObject({ status: "ACTED", initiativeCard: 3 });
    expect(activeId(s)).toBe("a");
    s = c.act(s, GM).state; // a acts
    s = c.act(s, GM).state; // b acts, c is skipped
    expect(s.phase).toBe("ROUND_COMPLETE");
  });

  it("parryEvade works on a participant who has Waited", () => {
    let s = c.swap(mkRound([1, 2, 3]), { targetId: "b" }, GM).state; // a waits with card 2
    s = c.parryEvade(s, { id: "a" }, GM).state;
    expect(s.participants.find((p) => p.id === "a")?.status).toBe("ACTED");
    expect(activeId(s)).toBe("b");
  });

  it("parryEvade rejects the active participant, ACTED, card-less and other phases", () => {
    let s = mkRound([1, 2]);
    expect(c.parryEvade(s, { id: "a" }, GM).error).toBeDefined();
    s = c.act(s, GM).state;
    expect(c.parryEvade(s, { id: "a" }, GM).error).toBeDefined();
    expect(c.parryEvade(s, { id: "zzz" }, GM).state).toBe(s);
    const noCard = c.gmSetCard(mkRound([1, 2, 3]), { id: "c", card: null }, GM).state;
    expect(c.parryEvade(noCard, { id: "c" }, GM).error).toBeDefined();
    const drawing = mkS([mkP("a", { initiativeCard: 1 })]);
    expect(c.parryEvade(drawing, { id: "a" }, GM).state).toBe(drawing);
  });

  it("parryEvade is allowed for the controller, or anyone when Players can Alter Any Token", () => {
    const s = mkRound([1, 2, 3], [{}, { controlledBy: "p1" }, {}]);
    expect(c.parryEvade(s, { id: "b" }, P1).state.participants[1].status).toBe("ACTED");
    expect(c.parryEvade(s, { id: "c" }, P1).error).toBeDefined();
    const open = { ...s, anyPlayerCanEdit: true };
    expect(c.parryEvade(open, { id: "c" }, P1).state.participants[2].status).toBe("ACTED");
  });

  it("gmSetCard assigns a free card, returning the old one", () => {
    const s = mkRound([1, 2, 3]);
    const r = c.gmSetCard(s, { id: "a", card: 9 }, GM).state;
    expect(r.participants[0].initiativeCard).toBe(9);
    expect(r.drawnCards.slice().sort((x, y) => x - y)).toEqual([2, 3, 9]);
    expect(activeId(r)).toBe("a");
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

describe("final review fixes", () => {
  it("gmSwapCards and gmSetCard clear lastDraw", () => {
    const s = mkS([mkP("a", { initiativeCard: 4 }), mkP("b")], { lastDraw: { participantId: "a", card: 4 } });
    expect(c.gmSwapCards(s, { first: "a", second: "b" }, GM).state.lastDraw).toBeNull();
    expect(c.gmSetCard(s, { id: "b", card: 2 }, GM).state.lastDraw).toBeNull();
  });

  it("addParticipants and addFerocity never shrink the deck below a held card", () => {
    const s = mkS([mkP("a", { initiativeCard: 13 }), mkP("b")], { deckSize: 14 });
    expect(c.addParticipants(s, { participants: [mkP("n")] }, GM).state.deckSize).toBe(14);
    expect(c.addFerocity(s, { id: "b", newId: "b2" }, GM).state.deckSize).toBe(14);
  });

  it("normalizeState recovers an ACTIVE save with nobody ACTIVE, and leaves healthy states alone", () => {
    const stuck = { ...mkRound([1, 2]), participants: mkRound([1, 2]).participants.map((p) => ({ ...p, status: "PENDING" })) };
    const fixed = c.normalizeState(stuck);
    expect(c.activeParticipant(fixed)?.id).toBe("a");
    const healthy = mkRound([1, 2]);
    expect(c.normalizeState(healthy)).toEqual(healthy);
  });
});

describe("endCombat", () => {
  it("resets to the initial state and is GM only", () => {
    const s = mkRound([1, 2]);
    expect(c.endCombat(s, GM).state).toEqual(INITIAL_COMBAT_STATE);
    expect(c.endCombat(s, P1).state).toBe(s);
  });
});
