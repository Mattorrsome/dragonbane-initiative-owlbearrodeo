# Initiative fixes and Dragonbane abilities: design

Date: 2026-10-07. Source: `Initial_ Requirements and examination.md`.

## Goals

- Fix the examined bugs (items 2-8; item 1 is deliberately left as is).
- Add opt-in support for three Dragonbane abilities: Veteran (retain card), Surprise, Lightning Fast. The extension does not verify that a character has the ability.
- Give the GM manual override tools for table mistakes.
- Confirm players can follow card draws.

## Decisions

| Topic | Decision |
|---|---|
| Item 1 (NPCs can Wait) | Ignored; leave behaviour. Reword docs (CLAUDE.md, README) so they stop saying NPCs cannot wait. |
| Deck size | Dynamic: `deckSize = min(20, max(10, participants.length))`. At 20, Add Participants and +Ferocity are disabled. |
| Concurrency | Every action: re-read metadata, apply a pure reducer, write. Not atomic; window shrinks from seconds to milliseconds. |
| Ability toggles | Keep card and Lightning Fast: GM or the controlling player. Surprise: GM only, round 1 only. |
| Keep card timing | Toggle only, set before "Draw New Round". No late "Keep #N" button. |

## Architecture

New `src/combat.ts`: pure reducers `(state, args, ctx) => state`, `ctx = { role, playerId }`. No OBR calls, no mutation. `App.tsx` keeps rendering and thin handlers; a `dispatch(reducer)` helper calls `OBR.room.getMetadata()`, applies the reducer to the fresh state, writes with `setMetadata`. If a reducer rejects (returns the same state with a reason), no write happens and a short `OBR.notification` shows the reason.

Role/control checks live in the reducers. They guard against mistaken UI, not malicious clients (anyone can write room metadata).

## Data model (`src/types.ts`)

- `Participant` adds: `previousCard: number | null`, `lightningFast: boolean`, `surprise: boolean`, `retainNext: boolean`, `pendingCards: [number, number] | null`.
- `CombatState` adds: `deckSize: number`, `lastDraw: { participantId: string; card: number } | null`.
- `drawnCards` remains the single record of taken cards, including reserved pending pairs and retained cards.
- On load, missing fields get defaults so in-progress combats survive the update.

## Reducers (`src/combat.ts`)

- `buildParticipants(items, players)`: shared by start combat and add participants (removes the duplicated code).
- `addParticipants`, `addFerocity`: refuse beyond 20 participants; recompute `deckSize`.
- `removeParticipants(state, ids)`: returns cards (including pending pairs) to the deck; re-finds the active participant by id; if the active one was removed, promotes the next unacted participant, or moves to `ROUND_COMPLETE` if none remain. Used by the remove button and the deletion watcher.
- `drawCard`, `drawAll`: no mutation of input objects. `drawAll` skips Lightning Fast and surprise-flagged participants and is disabled while surprise picks are outstanding.
- `setLightningFast`, `setSurprise`, `setRetainNext`.
- `drawTwo(id)`: reserves two random cards into `pendingCards`; `chooseOne(id, card)`: keeps one, releases the other. Rejects a card not in the pending pair.
- `pickSurpriseCard(id, card)`: any free card. Non-surprise draws are rejected while any surprise participant has no card. Surprise flags clear at `newRound`; setting is rejected after round 1.
- `startRound`, `act`, `swap` (existing Wait semantics), `newRound`.
- `newRound`: for each participant, `previousCard` is set from the final card held. Participants with `retainNext` keep that card (it stays in `drawnCards`, status PENDING); others clear to null. `retainNext` and `surprise` clear.
- GM overrides (GM only):
  - `gmSwapCards(a, b)`: exchange cards between any two participants, statuses unchanged, turn re-derived from the active id. Allowed in DRAWING and ACTIVE, blocked in ROUND_COMPLETE.
  - `gmToggleWait(id)`: ACTIVE phase; sets WAITED without exchanging cards, or clears WAITED back to PENDING.
  - `gmSetCard(id, card | null)`: assign any free card (old card returns to the deck) or clear to null. Allowed in DRAWING and ACTIVE.
- Any change in ACTIVE that leaves no ACTIVE participant promotes the lowest-card unacted participant, or moves to `ROUND_COMPLETE` if none. A participant with a null card is not in turn order.

## Deletion watcher and scene changes (items 2, 3)

- One `OBR.scene.items.onChange` subscription, created once, GM client only. It does not depend on `combatState`; it uses `dispatch` for current state.
- It keeps `prevIds`. A participant is removed only if its `tokenId` is in `prevIds` and absent from the current items. Tokens never seen cannot be treated as deleted.
- `OBR.scene.onReadyChange(false)` clears `prevIds`; callbacks while the scene is not ready are ignored; on ready, `prevIds` is seeded from `items.getItems()` without removing anything.
- Removal uses `removeParticipants` and shows one notification (GM client only).
- Participants whose tokens live in another scene stay in the tracker (requirement 7.5). Known limit: delete in scene A, switch away and back leaves a stale participant; the GM removes it manually.
- Risk to verify manually: that `onReadyChange` fires on every scene switch.

## UI (DRAWING-phase additions; ACTIVE and ROUND_COMPLETE layout unchanged)

- Draw button: draws two cards when Lightning Fast is on. The controlling player or GM then sees two card buttons; others see "Choosing..." with hidden cards.
- Surprise-flagged row: card picker of free cards instead of Draw; other Draw buttons disabled with "Waiting for surprise picks".
- Toggles: "Lightning Fast" (GM or controlling player), "Keep card next round" (GM or controlling player; visible in ACTIVE, ROUND_COMPLETE and DRAWING), "Surprise" (GM, round 1 only). Keep-card participants show their card set at round start and no Draw button.
- GM override controls on rows: swap cards (click one row, then another), Wait toggle (ACTIVE), set/clear card picker.
- Header shows "Deck: 1-N".
- Player visibility of draws (examined): already live, since all clients render from shared metadata. Added: a "drew #N" line from `lastDraw`. No animation or history log.
- Styling reuses existing classes in `App.css`.

## Error handling

- Reducers return unchanged state for illegal actions (draw past deck size, taken card, wrong role, card not in pending pair); `dispatch` skips the write and notifies the reason. This also covers a stale click losing a race.
- Old saved state is defaulted on load.

## Minor fixes (item 8)

- Shared `buildParticipants` (above).
- README "Swap" -> "Wait" wording; NPC-wait documentation corrected per decision 1.

## Testing

- Add Vitest (dev dependency); unit tests for `combat.ts`: remove active / last / mid-order participant; `drawAll` does not mutate input; deck growth and 20 cap; keep-card carryover and reservation; Surprise gating and round-1 limit; Lightning Fast reserve/release; GM swap, Wait toggle, set/clear card including clearing the active participant.
- No UI tests.
- Manual checklist: scene switch keeps participants; token deletion removes once, GM client only; two clients clicking at once does not lose draws in normal use.

## Out of scope

Verifying ability prerequisites, draw animation or history log, cross-scene token tracking, GM-authoritative broadcast, splitting `App.tsx` into components.
