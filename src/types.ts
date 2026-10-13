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
  drawnCards: number[]; // every taken card, incl. reserved pairs and kept cards
  deckSize: number;
  lastDraw: { participantId: string; card: number } | null;
  anyPlayerCanEdit: boolean; // players may toggle abilities and draw for any participant
}

export const INITIAL_COMBAT_STATE: CombatState = {
  isActive: false,
  phase: "DRAWING",
  roundNumber: 0,
  participants: [],
  drawnCards: [],
  deckSize: 10,
  lastDraw: null,
  anyPlayerCanEdit: false,
};

export const METADATA_KEY = "com.dragonbane-initiative/combat-state";
