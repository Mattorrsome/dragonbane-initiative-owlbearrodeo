import OBR from "@owlbear-rodeo/sdk";
import { METADATA_KEY } from "./types";

const RESTORE_WINDOW_MS = 1500;

OBR.onReady(async () => {
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
