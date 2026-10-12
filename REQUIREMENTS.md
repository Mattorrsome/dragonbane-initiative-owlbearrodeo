# Dragonbane Initiative Tracker - Project Requirements Document

## Overview

An Owlbear Rodeo extension that implements the Dragonbane RPG initiative system. The extension allows GMs and players to manage combat turns using a card-based initiative mechanic where participants can act or swap their position in the turn order.

---

## 1. Dragonbane Initiative System Rules

### 1.1 Core Mechanics
1. A virtual deck of 10 cards numbered 1-10 is used for initiative
2. At the start of each combat round, each participant draws one card
3. Turn order proceeds from lowest number (1) to highest (10)
4. Only the cards that were drawn are in play (not all 1-10)

### 1.2 Turn Actions
On their turn, a participant can choose one of two actions:

1. **Act**: Take their turn and complete their action. Their turn ends and initiative passes to the next number.

2. **Swap**: Exchange initiative cards with another participant who has NOT yet acted this round.
   - The swapping player receives the higher number
   - The target receives the lower number and becomes the active turn
   - After swapping, the player who initiated the swap is marked as "waited" and can NO LONGER be a swap target for the rest of the round
   - The recipient of the swap can also choose to swap (but not back with the person who just swapped with them, since they are marked as "waited")

### 1.3 Swap Restrictions
- Can only swap with participants who have NOT acted yet (higher initiative numbers)
- Once a participant chooses to "wait/swap," they cannot be targeted for swaps by anyone else
- NPCs/monsters NEVER initiate swaps; they can only be passive swap targets

### 1.4 Round Completion
- A round ends when all participants have acted
- A new round begins with fresh card draws for all participants

---

## 2. User Roles & Permissions

### 2.1 Game Master (GM)
The GM has exclusive control over:
1. Initiating combat (adding selected tokens to the tracker)
2. Ending combat
3. Adding participants between rounds
4. Removing participants (can be done at any time, takes effect immediately)
5. Starting a new round / triggering card draws
6. Fallback: Drawing cards for all participants at once

### 2.2 Players
Players can:
1. Open and view the initiative tracker
2. Draw their own initiative card (during the draw phase, once per round)
3. Click "Act" or "Swap" when it is their character's turn
4. Select which participant to swap with (seeing names and initiative numbers)

---

## 3. Extension Workflow

### 3.1 Phase 1: Combat Initiation
1. GM selects one or more tokens on the battle map
2. GM opens the initiative tracker extension (action popover)
3. GM clicks **"Start Combat with N Combatants"** (N = live count of selected tokens; button is disabled until at least one token is selected)
4. All selected tokens are added as combat participants
5. Extension enters the **Card Drawing Phase**

### 3.2 Phase 2: Card Drawing
1. Display all participants without initiative numbers yet
2. **Option A (Ideal)**: Each player clicks a "Draw Card" button next to their character
   - Button is only enabled for the player who controls that token
   - Button is disabled after the player has drawn
   - GM has a "Draw Card" button for each NPC/monster they control
3. **Option B (Fallback/GM Override)**: GM clicks **"Draw All Cards"** button
   - Automatically assigns random cards to all participants who haven't drawn yet
4. Cards are drawn blindly - no one sees available cards, only drawn results
5. Once all participants have cards, the **"Start Round"** button becomes enabled

### 3.3 Phase 3: Active Round
1. GM clicks **"Start Round"**
2. Participants are sorted by initiative number (ascending: 1 first, then 2, etc.)
3. The participant with the lowest number is highlighted as the **active turn**
4. Display for each participant:
   - Token name
   - Initiative number (displayed in a card-shaped icon)
   - Status indicator (waiting to act / acted / waited-swapped)
5. **On Active Turn**: The controlling player sees two buttons:
   - **"Act"**: Ends their turn, marks them as "acted," advances to next initiative
   - **"Swap"**: Opens a selection of valid swap targets (participants who haven't acted and haven't waited)

### 3.4 Swap Interaction
1. Player clicks "Swap"
2. A list/dropdown appears showing valid swap targets:
   - Only participants with higher initiative numbers
   - Only participants who have NOT acted
   - Only participants who have NOT already "waited"
   - Shows: Name + Initiative Number
3. Player selects a target
4. Cards are exchanged:
   - Original player receives the target's higher number
   - Target receives the original player's lower number
5. Original player is marked as "waited" (cannot be swapped with)
6. Active turn moves to the target (who now has the lower number)
7. Target can now Act or Swap (but cannot swap back with the original player)

### 3.5 Phase 4: Round Completion
1. When all participants have acted, display "Round Complete" state
2. GM sees **"Draw New Round"** button
3. Clicking resets all statuses and returns to Phase 2 (Card Drawing)

### 3.6 Combat End
1. GM can click **"End Combat"** at any time
2. All combat state is cleared
3. Extension returns to initial state (ready for new combat)

---

## 4. User Interface Specifications

### 4.1 Extension Type
- **Action Popover**: Button in the Owlbear Rodeo toolbar that opens a panel

### 4.2 Main Panel Layout

#### Header Section
- Extension title: "Dragonbane Initiative"
- Combat status indicator (No Combat / Drawing Cards / Round X Active / Round Complete)
- **"End Combat"** button (GM only, visible during active combat)

#### Participant List
Each row displays:
- Token name (as shown on the map)
- Initiative card icon with number (or placeholder if not yet drawn)
- Status badge:
  - "Draw" button (during draw phase, for controlling player)
  - "Active" (current turn, highlighted row)
  - "Acted" (turn completed)
  - "Waited" (swapped and cannot be targeted)
  - No badge (waiting for turn)

#### Action Buttons (Context-Dependent)

**No Combat State:**
- **"Start Combat with N Combatants"** (GM only) - Adds selected map tokens to tracker; disabled with "Select tokens to start combat" when nothing is selected, count updates live on reselect

**Drawing Phase:**
- **"Draw Card"** per participant (for controlling player)
- **"Draw All Cards"** (GM only) - Auto-assign remaining cards
- **"Start Round"** (GM only, enabled when all cards drawn)

**Active Round:**
- **"Act"** (visible to active participant's controller)
- **"Swap"** (visible to active participant's controller, if valid targets exist)

**Round Complete:**
- **"Draw New Round"** (GM only)

#### Footer Section
- **"Add Participants"** (GM only, between rounds) - Opens token selection
- **"Remove"** button per participant (GM only)

### 4.3 Visual Styling
- Active turn row: Highlighted background color
- Initiative number: Displayed inside a card-shaped icon/badge
- Acted participants: Slightly dimmed or with checkmark
- Waited participants: Different styling to show they cannot be swap targets
- Respect Owlbear Rodeo theme (dark/light mode)

---

## 5. Data Model

### 5.1 Combat State (Stored in Room Metadata)
```typescript
interface CombatState {
  isActive: boolean;
  phase: 'DRAWING' | 'ACTIVE' | 'ROUND_COMPLETE';
  roundNumber: number;
  participants: Participant[];
  currentTurnIndex: number; // Index in sorted participants array
  drawnCards: number[]; // Cards already drawn this round (1-10)
}

interface Participant {
  id: string; // Unique identifier
  tokenId: string; // Owlbear Rodeo token ID
  name: string; // Token name
  initiativeCard: number | null; // 1-10 or null if not drawn
  status: 'PENDING' | 'ACTIVE' | 'ACTED' | 'WAITED';
  controlledBy: string | 'GM'; // Player ID or 'GM' for NPCs
}
```

### 5.2 State Persistence
- Combat state stored in **Room Metadata** (persists across page refreshes)
- State persists across scene changes
- State only cleared when GM clicks "End Combat"

### 5.3 Token Synchronization
- Subscribe to `OBR.scene.items.onChange()`
- If a token in combat is deleted from the map:
  - Immediately remove from participants list
  - If it was the active turn, advance to next participant
  - Recalculate turn order if needed

---

## 6. Technical Implementation

### 6.1 Technology Stack
- **Framework**: React with TypeScript
- **Build Tool**: Vite
- **SDK**: @owlbear-rodeo/sdk

### 6.2 Key SDK APIs

| Feature | API |
|---------|-----|
| Get selected tokens | `OBR.player.getSelection()` + `OBR.scene.items.getItems(ids)` |
| Detect GM vs Player | `OBR.player.getRole()` |
| Get current player ID | `OBR.player.getId()` |
| Store combat state | `OBR.room.setMetadata()` / `OBR.room.getMetadata()` |
| Sync state changes | `OBR.room.onMetadataChange()` |
| Watch token deletion | `OBR.scene.items.onChange()` |
| Get all players | `OBR.party.getPlayers()` |
| Show notifications | `OBR.notification.show()` |
| Theme support | `OBR.theme.getTheme()` |

### 6.3 Metadata Namespace
All metadata keys should use the namespace: `com.dragonbane-initiative/`

Example: `com.dragonbane-initiative/combat-state`

### 6.4 Player-Token Ownership
- Determine token ownership via token's `createdUserId` or by checking if player has the token selected
- GM controls all tokens not owned by players
- Use `OBR.player.getId()` to match current player with token ownership

---

## 7. Edge Cases & Error Handling

### 7.1 Token Removal Mid-Combat
- Automatically remove participant from tracker
- If removed participant was active turn, advance to next
- Show notification: "[Name] was removed from combat"

### 7.2 No Valid Swap Targets
- If active participant has no valid swap targets, disable/hide "Swap" button
- Only "Act" is available

### 7.3 All Cards Drawn (10 participants)
- If exactly 10 participants, all cards 1-10 are used
- System handles this normally

### 7.4 Page Refresh / Reconnection
- State reloads from Room Metadata
- UI updates to reflect current combat state
- Player can resume control of their character

### 7.5 Scene Change
- Combat state persists (stored in Room, not Scene metadata)
- Participants remain even if tokens are on different scene
- GM can manually remove participants no longer relevant

### 7.6 Player Disconnection
- GM can take actions on behalf of disconnected player's character
- Or GM can use "Draw All" / act for them

---

## 8. Future Enhancements (Out of Scope for v1)

The following features are NOT included in the initial implementation but may be added later:

1. **Manual card selection**: Players choose specific cards instead of random draw
2. **Initiative history**: Log of actions taken during combat
3. **Token highlighting on map**: Visual indicator on the active token
4. **Sound notifications**: Audio cue when it's your turn
5. **Keyboard shortcuts**: Quick actions via keyboard
6. **Multiple combat groups**: Track separate combats simultaneously
7. **Initiative modifiers**: Bonuses/penalties to card draws

---

## 9. Acceptance Criteria

### 9.1 Combat Setup
- [ ] GM can select tokens and start combat
- [ ] Selected tokens appear as participants in the tracker
- [ ] Players can view the tracker but cannot start combat

### 9.2 Card Drawing
- [ ] Cards are drawn randomly from available pool (1-10)
- [ ] Each participant can only draw once per round
- [ ] GM can auto-draw for all participants
- [ ] Drawn cards are visible to all participants

### 9.3 Turn Management
- [ ] Participants are sorted by initiative (lowest first)
- [ ] Active turn is clearly highlighted
- [ ] Only the active participant's controller can Act or Swap
- [ ] "Act" advances turn to next participant
- [ ] "Swap" exchanges cards and updates turn order correctly

### 9.4 Swap Mechanics
- [ ] Can only swap with participants who haven't acted
- [ ] Can only swap with participants who haven't waited
- [ ] After swapping, player is marked as "waited"
- [ ] Waited players cannot be swap targets
- [ ] Active turn moves to the swap recipient

### 9.5 Round Management
- [ ] Round completes when all participants have acted
- [ ] GM can start new round with fresh card draws
- [ ] Round counter increments correctly

### 9.6 Participant Management
- [ ] GM can remove participants at any time
- [ ] GM can add participants between rounds
- [ ] Token deletion removes participant automatically

### 9.7 Persistence
- [ ] Combat state survives page refresh
- [ ] Combat state survives scene change
- [ ] Combat only ends when GM clicks "End Combat"

### 9.8 UI/UX
- [ ] Initiative numbers shown in card-styled icons
- [ ] Active row is highlighted
- [ ] Status indicators are clear and distinguishable
- [ ] Respects Owlbear Rodeo theme (dark/light)

---

## 10. Appendix: UI Mockup (Text)

```
┌─────────────────────────────────────────┐
│  Dragonbane Initiative      [End Combat]│
│  Round 2 - Active                       │
├─────────────────────────────────────────┤
│  [1] Goblin Scout      ● Active         │
│      [Act]  [Swap]                      │
├─────────────────────────────────────────┤
│  [3] Warrior Finn      ○ Waiting        │
├─────────────────────────────────────────┤
│  [5] Mage Elara        ✓ Acted          │
├─────────────────────────────────────────┤
│  [7] Goblin Chief      ⟳ Waited         │
├─────────────────────────────────────────┤
│  [9] Rogue Kira        ○ Waiting        │
├─────────────────────────────────────────┤
│                                         │
│  [Add Participants]  (GM only)          │
└─────────────────────────────────────────┘
```

---

## 11. Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2024-XX-XX | - | Initial requirements |
