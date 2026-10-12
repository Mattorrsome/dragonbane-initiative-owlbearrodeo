---
title: Draw Initiative for Dragonbane
description: Initiative tracker using the Dragonbane RPG card-based system
author: Gabe A.
image: https://raw.githubusercontent.com/gabriel-aleixo/dragonbane-initiative-owlbearrodeo/master/docs/images/hero.jpg
icon: https://cardinitiativefordragonbane.netlify.app/icon.svg
tags:
  - combat
manifest: https://cardinitiativefordragonbane.netlify.app/manifest.json
learn-more: https://cardinitiativefordragonbane.netlify.app
---

# Draw Initiative for Dragonbane

An Owlbear Rodeo extension that implements the Dragonbane RPG initiative system. Manage combat turns using a card-based initiative mechanic where participants can act or swap their position in the turn order.

## How It Works

In the Dragonbane RPG, initiative is determined by drawing numbered cards from a shared deck (1–10, growing up to 20 with larger tables). Each participant draws one card per round, and turns proceed from lowest number to highest. Players can wait and swap cards with others to take their turn strategically. This extension automates the entire system directly inside Owlbear Rodeo.

## Features

### Starting Combat

The GM opens the initiative tracker extension and selects one or more tokens on the battle map. The GM clicks **"Start Combat"** button and all selected tokens are added as combat participants. At this point, the GM can edit the names of the participants, add or remove participants, duplicate participants for Ferocity (see below), and start the drawing phase.

![Starting Combat](https://raw.githubusercontent.com/gabriel-aleixo/dragonbane-initiative-owlbearrodeo/master/docs/images/starting-combat.jpg)

#### Ferocity

Some monsters have a Ferocity score, allowing them to take multiple turns per round. To handle this, the GM can click **"+Ferocity"** next to a participant to create a duplicate entry in the initiative list. Each entry draws its own initiative card. The GM can click "+Ferocity" multiple times for Ferocity 3, 4, etc.


### Drawing Phase

Each round begins with participants drawing cards from the deck. The GM controls when drawing starts, and each player draws their own card. The GM also has the ability to draw all cards for all participants at once. Once all cards are drawn, the GM clicks **"Start Round"** to start the round.

![Drawing Phase](https://raw.githubusercontent.com/gabriel-aleixo/dragonbane-initiative-owlbearrodeo/master/docs/images/drawing-phase.jpg)

### Active Round

Once the round starts, the participants are sorted by initiative number (ascending: 1 first, then 2, etc.). The participant with the lowest number is highlighted as the **active turn**. The active participant can click **"Act"** to complete their turn and advance to the next number, or click **"Wait"** to swap their initiative card with another participant who has a higher card number and hasn't acted yet. The swapper is marked as "waited" and can no longer be targeted for swaps.

![Active Round](https://raw.githubusercontent.com/gabriel-aleixo/dragonbane-initiative-owlbearrodeo/master/docs/images/active-round.jpg)

### GM and Player Roles

The GM sees full controls — add/remove participants, start rounds, and manage all combatants. Players see only their own participant with relevant action buttons.

![GM View](https://raw.githubusercontent.com/gabriel-aleixo/dragonbane-initiative-owlbearrodeo/master/docs/images/gm-view.jpg)

### Abilities and GM Tools

Toggle **Lightning Fast** (draw two cards, keep one), **Surprise** (GM, round 1: pick any free card first) and **Keep** (Veteran: keep your card into the next round) per participant; the GM can also swap cards, toggle Wait, and set or clear any card. The extension does not check that a character has an ability.

### Real-Time Sync

All combat state is synced in real time through Owlbear Rodeo's room metadata. State persists across page refreshes and scene changes — no data is lost if someone disconnects. *Note*: every action re-reads the latest shared state before applying, so simultaneous clicks are safe in normal use; writes are last-writer-wins, so if two clients act within the same few milliseconds one action may be silently lost (not rejected) and can simply be repeated.

## Installation

1. Copy the manifest URL: `https://cardinitiativefordragonbane.netlify.app/manifest.json`
2. In Owlbear Rodeo, open the extensions menu
3. Paste the manifest URL and add the extension

## Support

Found a bug or have a feature request? Open an issue on [GitHub](https://github.com/gabriel-aleixo/dragonbane-initiative-owlbearrodeo/issues).
