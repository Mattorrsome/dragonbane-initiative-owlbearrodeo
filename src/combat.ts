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
