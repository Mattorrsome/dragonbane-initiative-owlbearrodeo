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
- `drawCard`, `drawAll`: no mutation of input objects. `drawAll` deals Lightning Fast pairs first (see Feedback update 2026-10-12), skips surprise-flagged participants and is disabled while surprise picks are outstanding.
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
- Toggles: "Lightning Fast" (GM or controlling player), "Keep" (GM or controlling player; ACTIVE phase only, see Feedback update 2026-10-12), "Surprise" (GM, round 1 only). Keep-card participants show their card set at round start and no Draw button.
- GM override controls on rows: Wait toggle (ACTIVE, unacted participants), swap cards (click one row, then another) and set/clear card picker (DRAWING, once everyone has a card; see Feedback update 2026-10-12).
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

## Feedback update 2026-10-12 (v2.0.0)

Source: "Feedback Update 2026-10-12" in `Initial_ Requirements and examination.md`. Version bumped to 2.0.0 (`package.json`, `public/manifest.json`; author credit adds Matt Orr).

| Item | Change |
|---|---|
| Swap/Set gating | GM swap and set/clear-card controls render only in DRAWING after every participant has a card. Wait toggle moves out of that group: ACTIVE phase, unacted participants only. |
| Keep checkbox | Renamed "Keep"; shown only in ACTIVE phase. |
| Scrollbar | Thin themed scrollbar on `.scroll-area` (purple in dark theme, deeper purple in light). |
| Lightning Fast in Draw All | `drawAll` deals each LF participant a pending pair first, then single cards to the rest, so singles cannot starve pairs. A pair that would leave another open participant without a card is skipped (same rule as `drawTwo`); the GM resolves it by hand. |
| Pair visibility | Pending pair shows to every client as "X or Y" (sorted) on the card. Only the controlling player or GM gets the choose buttons. |
| Notifications | Non-GM clients show "Combat started" / "Combat ended" when `isActive` flips in room metadata. The acting GM already gets a local toast, so no duplicate. |
| Narrow popover | Participant rows wrap; action buttons take their own line. |

Tests: `combat.test.ts` updated so `drawAll` expects LF pair `[1, 2]`, single `3`, `drawnCards` `[1, 2, 3]`.

## Row labelling update (v2.1.0)

Version bumped to 2.1.0 (`package.json`, `package-lock.json`, `public/manifest.json`). UI only; no reducer or state changes.

| Item | Change |
|---|---|
| Ferocity grouping | Rows sharing a `tokenId` get a thin inset border (`.participant-row.ferocity`, colour via `--fer`). Each group takes the next colour from a six-colour palette (`FEROCITY_COLORS` in `App.tsx`); colours repeat past six groups. |
| Ferocity numbering | Name suffix " - N", N = position within the group in displayed turn order (re-numbers as cards change). Before cards are drawn, and for rows without a card, falls back to added order. |
| Duplicate names | Different tokens with the same display name (custom name if set) get " #1", " #2" in added order. Ferocity duplicates share a token and count once. Combined form: "Goblin #2 - 1". |
| Scope | Labels render in the row only; the rename input and the "drew #N" line use the plain name. |

## Start Combat selection awareness (2026-10-12)

UI only in `App.tsx`; no reducer or state changes, no version bump.

| Item | Change |
|---|---|
| Selection count | `selectionCount` state seeded from `OBR.player.getSelection()` once the SDK is ready, then kept live by `OBR.player.onChange` (fires on every reselect). |
| Start button | Label "Start Combat with N selected" when N > 0. With nothing selected the button is disabled and reads "Select tokens to start combat". |
| Selection preserved | The extension never clears selection (it only reads it; `background.ts` only calls `OBR.action.open()`). If tokens deselect on popover open, that is Owlbear behaviour, not extension code. |
| Unchanged | `startCombat` still re-reads the selection on click, so the count is display-only. "Add Participants" button not changed. |
