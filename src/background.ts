import OBR from "@owlbear-rodeo/sdk";
import { METADATA_KEY } from "./types";

// Runs for every client even while the popover is closed: open it for everyone when combat starts.
OBR.onReady(async () => {
  const isActive = (m: Record<string, unknown>) =>
    !!(m[METADATA_KEY] as { isActive?: boolean } | undefined)?.isActive;

  let wasActive = isActive(await OBR.room.getMetadata());
  OBR.room.onMetadataChange((metadata) => {
    const active = isActive(metadata);
    if (active && !wasActive) OBR.action.open().catch(console.error);
    wasActive = active;
  });
});
