import OBR, { buildShape, Item } from "@owlbear-rodeo/sdk";
import { METADATA_KEY, TOAST_CHANNEL, TOAST_MS } from "./types";
import { activeParticipant, normalizeState } from "./combat";

const RESTORE_WINDOW_MS = 1500;
const RING_ID = "com.dragonbane-initiative/turn-ring";
const RING_COLOR = "#ffca28";

/**
 * Ring the active participant's token on this client only (local item: never synced, saved
 * or undoable). Every client derives the same ring from the shared combat state.
 */
async function startTurnRing() {
  let role = await OBR.player.getRole();
  let tokenId: string | null = null; // active participant's token, from room metadata
  let drawn = ""; // what the current ring represents ("" = no ring)
  let queue: Promise<unknown> = Promise.resolve();

  const draw = async (items?: Item[]) => {
    const want = tokenId && (await OBR.scene.isReady()) ? tokenId : null;
    const token = want ? (items ?? (await OBR.scene.items.getItems([want]))).find((i) => i.id === want) : undefined;
    // Never reveal a token the GM has hidden from players.
    const show = token && (token.visible || role === "GM");
    const key = show ? `${token.id}|${token.scale.x}|${token.scale.y}` : "";
    if (key === drawn) return;
    if (drawn) await OBR.scene.local.deleteItems([RING_ID]).catch(() => {});
    drawn = "";
    if (!show) return;
    const b = await OBR.scene.items.getItemBounds([token.id]);
    const size = Math.max(b.width, b.height) * 1.2;
    const ring = buildShape()
      .id(RING_ID)
      .shapeType("CIRCLE")
      .width(size)
      .height(size)
      .position(b.center)
      .fillOpacity(0)
      .strokeColor(RING_COLOR)
      .strokeOpacity(1)
      .strokeWidth(size * 0.02)
      .attachedTo(token.id)
      .disableAttachmentBehavior(["VISIBLE", "SCALE"]) // GM still sees it on hidden tokens; sized from bounds
      .layer("ATTACHMENT")
      .locked(true)
      .disableHit(true)
      .build();
    await OBR.scene.local.addItems([ring]);
    drawn = key;
  };
  // Serialize: metadata, item and scene events can arrive together.
  const redraw = (items?: Item[]) => {
    queue = queue.then(() => draw(items)).catch(console.error);
  };

  const fromMetadata = (m: Record<string, unknown>) => {
    const s = normalizeState(m[METADATA_KEY]);
    tokenId = (s.isActive && s.phase === "ACTIVE" && activeParticipant(s)?.tokenId) || null;
  };
  fromMetadata(await OBR.room.getMetadata());
  redraw();

  OBR.room.onMetadataChange((m) => {
    fromMetadata(m);
    redraw();
  });
  // Token hidden/shown, rescaled or deleted.
  OBR.scene.items.onChange((items) => redraw(items));
  // Local items vanish with the scene; draw again once the new one is ready.
  OBR.scene.onReadyChange(() => {
    drawn = "";
    redraw();
  });
  OBR.player.onChange((p) => {
    if (p.role === role) return;
    role = p.role;
    redraw();
  });
}

OBR.onReady(async () => {
  startTurnRing().catch(console.error);

  OBR.broadcast.onMessage(TOAST_CHANNEL, ({ data }) => {
    setTimeout(() => OBR.notification.close(data as string).catch(() => {}), TOAST_MS);
  });

  const isActive = (m: Record<string, unknown>) =>
    !!(m[METADATA_KEY] as { isActive?: boolean } | undefined)?.isActive;

  // Runs for every client even while the popover is closed: open it for everyone when combat starts.
  let wasActive = isActive(await OBR.room.getMetadata());
  OBR.room.onMetadataChange((metadata) => {
    const active = isActive(metadata);
    if (active && !wasActive) {
      last = []; // Start Combat deselects on purpose; don't restore it
      OBR.action.open().catch(console.error);
    }
    wasActive = active;
  });

  // Owlbear can clear the token selection when the popover opens. Remember the last non-empty
  // selection and put it back if it empties right around an open (not on a deliberate deselect).
  let last: string[] = (await OBR.player.getSelection()) ?? [];
  let clearedAt = 0;
  let openedAt = 0;
  const recent = (t: number) => Date.now() - t < RESTORE_WINDOW_MS;
  const restore = () => {
    if (last.length) OBR.player.select(last).catch(console.error);
  };

  OBR.player.onChange((p) => {
    const sel = p.selection ?? [];
    if (sel.length) {
      last = sel;
      clearedAt = 0;
    } else if (last.length) {
      clearedAt = Date.now();
      if (recent(openedAt)) restore();
    }
  });
  OBR.action.onOpenChange((open) => {
    if (!open) return;
    openedAt = Date.now();
    if (recent(clearedAt)) restore(); // clear landed just before the open event
  });
});
