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
