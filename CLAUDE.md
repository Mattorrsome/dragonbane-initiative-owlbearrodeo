# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

An Owlbear Rodeo extension that implements the Dragonbane RPG initiative system — a card-based combat turn tracker where participants draw from a virtual deck of 10 cards and can Act or Swap positions in turn order.

**Live URL**: `https://drawinitiative.gabrielaleixo.com/manifest.json`

## Commands

- `npm run dev` — Start Vite dev server (add `http://localhost:5173/manifest.json` to Owlbear Rodeo to test)
- `npm run build` — TypeScript check + Vite build (output in `dist/`)
- `npm run preview` — Preview production build
- `npm test` — Run Vitest unit tests for `src/combat.ts`. No linter is configured.

## Architecture

### Dual entry-point Vite setup

The build produces two HTML entry points (configured in `vite.config.ts`):
- **`index.html`** — Public landing page (static, no React)
- **`extension.html`** — The actual Owlbear Rodeo extension UI (React app)

### Single-component React app

All extension logic lives in `src/App.tsx` — a single component handling:
- OBR SDK initialization and subscriptions
- Combat state management (phases: DRAWING → ACTIVE → ROUND_COMPLETE)
- All user actions (draw cards, act, swap, ferocity, add/remove participants)
- Rendering for both GM and Player roles

Combat rules live in `src/combat.ts` as pure reducers (`(state, args, ctx) => Result`); `App.tsx` applies them via `dispatch` (re-read metadata, reduce, write).

### State management via Owlbear Rodeo Room Metadata

- Combat state is stored in OBR Room Metadata under key `com.dragonbane-initiative/combat-state` (defined as `METADATA_KEY` in `src/types.ts`)
- All state sync happens through `OBR.room.setMetadata()` / `OBR.room.onMetadataChange()` — no local state management library
- State persists across page refreshes and scene changes
- Token deletion is watched by one GM-client `OBR.scene.items.onChange` subscription that only removes tokens it previously saw (scene switches never remove participants)

### Types

`src/types.ts` defines `CombatState`, `Participant`, their status enums, and `INITIAL_COMBAT_STATE`.

### Key domain rules (Dragonbane initiative)

- Deck of min(20, max(10, participants + Lightning Fast participants)) cards, drawn randomly without replacement per round
- Turn order: lowest card number acts first
- Swap: exchange cards with someone who hasn't acted and has a higher number; swapper is marked "WAITED" and can no longer be a swap target
- NPCs/monsters (controlledBy === "GM") can Wait and be Wait targets; the GM controls them
- Ferocity: GM can duplicate a participant entry during drawing phase for monsters with multiple turns

## Deployment

Deployed to Netlify (`netlify.toml`). CORS headers (`Access-Control-Allow-Origin: *`) are required for Owlbear Rodeo to load the extension via iframe.

## Reference docs

- `REQUIREMENTS.md` — Full product requirements and acceptance criteria
- `OWLBEAR_RODEO_EXTENSION_GUIDE.md` — Comprehensive OBR SDK API reference and extension development patterns
