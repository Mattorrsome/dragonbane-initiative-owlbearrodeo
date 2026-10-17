# Card Initiative for Dragonbane

An Owlbear Rodeo extension that implements the Dragonbane RPG initiative system. Manage combat turns using a card-based initiative mechanic where participants can act or swap their position in the turn order.

## Installation

1. Open Owlbear Rodeo and go to your profile
2. Click "Add Extension"
3. Enter the extension URL: `https://cardinitiativefordragonbane.netlify.app/manifest.json`

## How It Works

The Dragonbane initiative system uses a virtual deck of cards numbered 1 up to N, where N = min(20, max(10, participants + Lightning Fast participants)):

- At the start of each round, participants draw cards from the deck
- Turn order goes from **lowest** (1) to **highest** (the top card in the deck, up to 20)
- On your turn, you can **Act** (take your turn) or **Wait** (exchange cards with someone else)
- Out of turn, you can **Parry/Evade**, which spends your action for the round

### Waiting Rules

- You can only swap cards with participants who have a higher card than you and haven't acted or waited yet
- The participant you swap with takes your lower card and acts now; you take their higher card
- After waiting, you're marked as "Waited" and can no longer be a swap target
- The Wait button only appears when there is someone you can swap with
- NPCs/monsters (GM-controlled) can wait like any other participant; the GM controls them

### Parry/Evade

- During a round, a participant who isn't active, hasn't acted and holds a card can Parry or Evade
- This spends their action: they're marked "Acted" and their turn is skipped. Nobody else's order changes
- Participants who have Waited can still Parry/Evade
- Each Ferocity entry is a separate action
- Usable by the GM and the token's player (anyone when "Players can Alter Any Action" is on)

### Abilities

- **Lightning Fast**: tick it on a participant before they draw. They draw two cards and keep one; the other goes back in the deck.
- **Surprise** (round 1 only): the GM ticks it before anyone draws (players can too with "Players can Alter Any Action"). The participant picks any free card first; everyone else draws once all Surprise picks are made.
- **Keep Card** (Veteran): tick it during the round, or once it's complete, before "Draw New Round". The participant keeps their final card into the next round.
- The extension does not check that a character actually has an ability.

### Combat Options (set before combat starts)

The GM sees two checkboxes before starting combat. Both are remembered in the GM's browser for future combats.

- **Players can Alter Any Action**: every player can toggle Lightning Fast, Surprise and Keep Card, draw cards, pick Surprise cards, choose Lightning Fast cards and use Parry/Evade for any participant. Act and Wait still belong to the token's owner or the GM. Off: only the GM and a token's owner can.
- **Use Player Name**: rows show the token's name by default. Tick this to show the name of the player who controls the token instead. Falls back to the token's name for GM-created tokens or when that player isn't in the room. Also applies to Add Participants.

### Table Helpers

- **Turn highlight**: during a round, the active participant's token gets a gold ring on the map. Players never see it on tokens hidden from them.
- **Card order**: once everyone has a card, the list sorts lowest card first, before the round starts.
- **Status colours**: "Active" is purple, "Acted" dark gold, "Waited" teal.
- **Notifications** close by themselves after 15 seconds.
- The initiative window opens for every player when combat starts.
- Deleting a token from the map removes it from combat; switching scenes never does.
- Different tokens with the same name are numbered #1, #2, …

## Usage Guide

### For Game Masters

#### Starting Combat
1. Open the extension (toolbar title "Dragonbane Initiative")
2. Select the tokens on the map that will take part
3. Optionally tick **"Players can Alter Any Action"** and **"Use Player Name"**
4. Click **"Start Combat with N Combatants"** (the map selection is cleared afterwards)

#### Drawing Phase
- Tick **Lightning Fast** or **Surprise** (round 1) where needed
- Each player draws their own card by clicking **"Draw"** (or **"Draw 2"**) next to their character
- Use **"Draw All Cards"** to auto-assign cards to participants who haven't drawn
- Once everyone has a card, use **⇄** (swap two participants' cards) and **Set…** (set or clear a card) to fix mistakes
- Click **"Start Round"** once all cards are drawn

#### Managing Combat
- **Add Participants**: select new tokens and click "Add Participants" (drawing phase only, up to 20 participants)
- **Edit Names**: click a participant's name to rename it (drawing phase only)
- **Remove Participants**: click ✕ next to any participant (any time). This removes all of a monster's Ferocity entries too
- **Parry/Evade**: click it on any row that isn't active and hasn't acted
- **End Combat**: click "End Combat" to clear all combat state

#### Round Completion
When all participants have acted, click **"Draw New Round"** to start fresh draws. Anyone with **Keep Card** ticked keeps their card.

#### Ferocity (Multiple Turns)
Some monsters have the Ferocity ability, allowing them to take multiple turns per round. To handle this:

1. During the **drawing phase**, click **"+Ferocity"** next to a GM-controlled token
2. This creates a duplicate entry in the initiative list
3. Each entry draws its own initiative card and inherits Lightning Fast
4. A monster's entries share a coloured border and are labelled "Action 1", "Action 2", … in turn order
5. Click "+Ferocity" multiple times for Ferocity 3, 4, etc.

The duplicate entries share the same token on the map - only the initiative tracking is duplicated. If the token is removed from the map, or you click ✕ on any of its entries, all its Ferocity entries are removed.

### For Players

#### Drawing Phase
- Tick **Lightning Fast** first if your character has it, then click **"Draw 2"** and choose one card
- Otherwise click **"Draw"** next to your character to draw an initiative card
- If you have **Surprise**, pick any free card from the list before anyone else draws
- Wait for the GM to start the round

#### During the Round
When your character is highlighted as active:
- Click **"Act"** to complete your turn
- Click **"Wait"** to exchange initiative with another participant (see waiting rules above)

At any time during the round:
- Click **"Parry/Evade"** on your row to spend your action out of turn
- Tick **Keep Card** (Veteran) to keep your card for the next round

## Interface Guide

| Symbol | Meaning |
|--------|---------|
| Card with number | Initiative value (lower acts first) |
| Card with "?" | Card not yet drawn |
| "3 or 7" card | Lightning Fast participant choosing between two cards |
| Purple highlighted row, "Active" label | Currently active turn |
| Dimmed row, gold "Acted" label | Already acted this round (including Parry/Evade) |
| Teal left border, teal "Waited" label | Waited, cannot be a swap target |
| Coloured border, "Action N" | Ferocity entries of the same monster |
| Name with #1, #2 | Different tokens with the same name |
| Gold ring on the map | Token whose turn it is |

## Status Indicators

The header shows the round and phase, plus the deck size once combat has started:

- **No Combat** - No combat running
- **Round N - Drawing** - Participants are drawing initiative cards
- **Round N - Active** - Combat round in progress
- **Round N - Complete** - All participants have acted, ready for a new round
- **Deck 1-N** - Current deck size

---

## For Developers

### Tech Stack

- React 18 + TypeScript 6
- Vite 8
- Owlbear Rodeo SDK 3
- Vitest (unit tests for the combat rules) and ESLint

### Setup

```bash
# Clone the repository
git clone https://github.com/Mattorrsome/dragonbane-initiative-owlbearrodeo.git
cd dragonbane-initiative-owlbearrodeo

# Install dependencies (Node 20.19 or newer)
npm install

# Start development server
npm run dev
```

### Development

Run the dev server and add the extension to Owlbear Rodeo:

```
http://localhost:5173/manifest.json
```

If your browser blocks Owlbear Rodeo from loading `localhost`, expose the dev server through a tunnel (for example `npm run dev -- --host` and `cloudflared tunnel --url http://127.0.0.1:5173`) and add `<tunnel-url>/manifest.json` instead.

```bash
npm test       # Vitest unit tests for src/combat.ts
npm run lint   # ESLint
```

### Build

```bash
npm run build
```

Output will be in the `dist/` folder.

### Deployment

Deploy the `dist/` folder to any static hosting service:
- GitHub Pages
- Netlify
- Vercel
- Cloudflare Pages

Users install by adding your hosted manifest URL. The host must send `Access-Control-Allow-Origin: *` (see `netlify.toml`).

### Project Structure

```
├── index.html           # Landing page
├── extension.html       # Extension popover entry point
├── background.html      # Background page (runs on every client)
├── public/
│   ├── manifest.json    # Extension manifest
│   ├── icon.svg         # Extension icon
│   └── landing.css      # Landing page styles
├── src/
│   ├── App.tsx          # Extension UI: OBR wiring, actions, rendering
│   ├── App.css          # Extension styles
│   ├── combat.ts        # Combat rules as pure reducers
│   ├── combat.test.ts   # Unit tests for the combat rules
│   ├── background.ts    # Opens the popover on combat start, turn ring, toast auto-close
│   ├── main.tsx         # Extension entry point
│   └── types.ts         # Types, initial state, shared keys
├── netlify.toml
├── package.json
├── vite.config.ts
└── tsconfig.json
```

### Key APIs Used

| Feature | Owlbear Rodeo API |
|---------|-------------------|
| Role detection | `OBR.player.getRole()` |
| Token selection | `OBR.player.getSelection()` / `deselect()` |
| Player names | `OBR.party.getPlayers()` |
| State persistence | `OBR.room.setMetadata()` / `getMetadata()` |
| State sync | `OBR.room.onMetadataChange()` |
| Token deletion watch | `OBR.scene.items.onChange()` |
| Open popover for everyone | `OBR.action.open()` |
| Turn ring | `OBR.scene.local.addItems()` with `buildShape()` |
| Theme support | `OBR.theme.getTheme()` |
| Notifications | `OBR.notification.show()` / `close()`, `OBR.broadcast` |

### Data Storage

Combat state is stored in Room Metadata under the key `com.dragonbane-initiative/combat-state`. This persists across page refreshes and scene changes. The GM's "Players can Alter Any Action" and "Use Player Name" choices are kept in that browser's `localStorage`.

## Disclaimer

This project is not affiliated with, sponsored, or endorsed by Fria Ligan AB. This project was created under Fria Ligan AB's Dragonbane Third Party Supplement License.

## License

MIT, see [LICENSE](LICENSE). Copyright (c) 2026 Gabriel Aleixo and Matt Orr.

This project uses the [Owlbear Rodeo SDK](https://github.com/owlbear-rodeo/sdk), which is licensed under the MIT License.
