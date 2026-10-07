# Draw Initiative for Dragonbane

An Owlbear Rodeo extension that implements the Dragonbane RPG initiative system. Manage combat turns using a card-based initiative mechanic where participants can act or swap their position in the turn order.

## Installation

1. Open Owlbear Rodeo and go to your profile
2. Click "Add Extension"
3. Enter the extension URL: `https://drawinitiative.gabrielaleixo.com/manifest.json`

## How It Works

The Dragonbane initiative system uses a virtual deck of 10 cards numbered 1-10:

- At the start of each round, participants draw cards from the deck
- Turn order goes from **lowest** (1) to **highest** (10)
- On your turn, you can **Act** (take your turn) or **Wait** (exchange cards with someone else)

### Waiting Rules

- You can only swap initiative cards with participants who haven't acted yet
- This means you can only swap initiative cards with participants who have a higher initiative number than you
- After waiting, you're marked as "Waited" and can no longer be a swap target
- NPCs/monsters (GM-controlled) can wait like any other participant; the GM controls them

### Abilities and GM tools

- **Lightning Fast**: toggle on a participant before drawing. They draw two cards and keep one.
- **Surprise** (GM, round 1 only): the participant picks any free card before anyone else draws.
- **Keep card next round** (Veteran): toggle at any time before "Draw New Round"; the participant keeps their final card.
- The extension does not check that a character actually has an ability.
- The GM can swap two participants' cards (⇄), toggle Wait without exchanging cards, and set or clear any card.
- The deck holds `min(20, max(10, participants + Lightning Fast participants))` cards; at 20 participants, adding more is disabled.
## Usage Guide

### For Game Masters

#### Starting Combat
1. Select tokens on the map that will participate in combat
2. Open the Dragonbane Initiative extension
3. Click **"Start Combat"**

#### Drawing Phase
- Each player draws their own card by clicking **"Draw"** next to their character
- Use **"Draw All Cards"** to auto-assign cards to participants who haven't drawn
- Click **"Start Round"** once all cards are drawn

#### Managing Combat
- **Add Participants**: Select new tokens and click "Add Participants" (only during drawing phase)
- **Remove Participants**: Click the ✕ button next to any participant (anytime)
- **End Combat**: Click "End Combat" to clear all combat state

#### Round Completion
When all participants have acted, click **"Draw New Round"** to start fresh draws.

#### Ferocity (Multiple Turns)
Some monsters have the Ferocity ability, allowing them to take multiple turns per round. To handle this:

1. During the **drawing phase**, click **"+Ferocity"** next to a GM-controlled token
2. This creates a duplicate entry in the initiative list
3. Each entry draws its own initiative card
4. Click "+Ferocity" multiple times for Ferocity 3, 4, etc.

The duplicate entries share the same token on the map - only the initiative tracking is duplicated. If the token is removed from the map, all its Ferocity entries are also removed.

### For Players

#### Drawing Phase
- Click **"Draw"** next to your character to draw an initiative card
- Wait for the GM to start the round

#### Your Turn
When your character is highlighted as active:
- Click **"Act"** to complete your turn
- Click **"Wait"** to exchange initiative with another participant (see swap rules above)

## Interface Guide

| Symbol | Meaning |
|--------|---------|
| Card with number | Initiative value (lower acts first) |
| Card with "?" | Card not yet drawn |
| Highlighted row | Currently active turn |
| Dimmed row | Already acted this round |
| Teal left border | "Waited" status (waited, cannot be wait target) |

## Status Indicators

- **Drawing** - Participants are drawing initiative cards
- **Active** - Combat round in progress
- **Complete** - All participants have acted, ready for new round

---

## For Developers

### Tech Stack

- React 18 + TypeScript
- Vite
- Owlbear Rodeo SDK

### Setup

```bash
# Clone the repository
git clone https://github.com/yourusername/dragonbane-initiative-owlbearrodeo.git
cd dragonbane-initiative-owlbearrodeo

# Install dependencies
npm install

# Start development server
npm run dev
```

### Development

Run the dev server and add the extension to Owlbear Rodeo:

```
http://localhost:5173/manifest.json
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

Users install by adding your hosted manifest URL.

### Project Structure

```
├── index.html           # Landing page
├── extension.html       # Extension entry point
├── public/
│   ├── manifest.json    # Extension manifest
│   ├── icon.svg         # Extension icon
│   └── landing.css      # Landing page styles
├── src/
│   ├── App.tsx          # Extension main component
│   ├── App.css          # Extension styles
│   ├── main.tsx         # Extension entry point
│   └── types.ts         # TypeScript interfaces
├── index.html
├── package.json
├── vite.config.ts
└── tsconfig.json
```

### Key APIs Used

| Feature | Owlbear Rodeo API |
|---------|-------------------|
| Role detection | `OBR.player.getRole()` |
| Token selection | `OBR.player.getSelection()` |
| State persistence | `OBR.room.setMetadata()` / `getMetadata()` |
| State sync | `OBR.room.onMetadataChange()` |
| Token deletion watch | `OBR.scene.items.onChange()` |
| Theme support | `OBR.theme.getTheme()` |
| Notifications | `OBR.notification.show()` |

### Data Storage

Combat state is stored in Room Metadata under the key `com.dragonbane-initiative/combat-state`. This persists across page refreshes and scene changes.

## Disclaimer

This project is not affiliated with, sponsored, or endorsed by Fria Ligan AB. This project was created under Fria Ligan AB's Dragonbane Third Party Supplement License.

## License

MIT

This project uses the [Owlbear Rodeo SDK](https://github.com/owlbear-rodeo/sdk), which is licensed under the MIT License.
