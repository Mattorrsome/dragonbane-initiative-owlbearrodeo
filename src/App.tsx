import { useEffect, useState, useCallback } from "react";
import OBR, { Player } from "@owlbear-rodeo/sdk";
import { CombatState, Participant, INITIAL_COMBAT_STATE, METADATA_KEY } from "./types";
import * as combat from "./combat";
import type { Ctx, Result } from "./combat";

type Role = "GM" | "PLAYER";
type Theme = "DARK" | "LIGHT";

function App() {
  const [isReady, setIsReady] = useState(false);
  const [role, setRole] = useState<Role>("PLAYER");
  const [playerId, setPlayerId] = useState<string>("");
  const [theme, setTheme] = useState<Theme>("DARK");
  const [combatState, setCombatState] = useState<CombatState>(INITIAL_COMBAT_STATE);
  const [swappingFrom, setSwappingFrom] = useState<string | null>(null);
  const [partyPlayers, setPartyPlayers] = useState<Player[]>([]);
  const [editingNameId, setEditingNameId] = useState<string | null>(null);
  const [editingNameValue, setEditingNameValue] = useState("");

  const ctx: Ctx = { role, playerId };

  // Re-read metadata, apply the reducer to the fresh state, write. Not atomic, but the
  // read-modify-write window is milliseconds instead of "whatever this client last saw".
  const dispatch = useCallback(
    async (reducer: (s: CombatState) => Result): Promise<boolean> => {
      const metadata = await OBR.room.getMetadata();
      const current = combat.normalizeState(metadata[METADATA_KEY]);
      const { state, error, notice } = reducer(current);
      if (error) {
        await OBR.notification.show(error, "WARNING");
        return false;
      }
      if (state !== current) await OBR.room.setMetadata({ [METADATA_KEY]: state });
      if (notice) await OBR.notification.show(notice);
      return true;
    },
    []
  );
  const run = (reducer: (s: CombatState, c: Ctx) => Result) =>
    dispatch((s) => reducer(s, ctx));

  // Initialize OBR SDK
  useEffect(() => {
    return OBR.onReady(async () => {
      const [playerRole, id, currentTheme, players] = await Promise.all([
        OBR.player.getRole(),
        OBR.player.getId(),
        OBR.theme.getTheme(),
        OBR.party.getPlayers(),
      ]);
      setRole(playerRole);
      setPlayerId(id);
      setTheme(currentTheme.mode);
      setPartyPlayers(players);
      setIsReady(true);

      const metadata = await OBR.room.getMetadata();
      setCombatState(combat.normalizeState(metadata[METADATA_KEY]));
    });
  }, []);

  // Subscribe to metadata changes
  useEffect(() => {
    if (!isReady) return;

    const unsubMetadata = OBR.room.onMetadataChange((metadata) => {
      setCombatState(combat.normalizeState(metadata[METADATA_KEY]));
    });
    const unsubTheme = OBR.theme.onChange((t) => setTheme(t.mode));
    const unsubParty = OBR.party.onChange((p) => setPartyPlayers(p));

    return () => {
      unsubMetadata();
      unsubTheme();
      unsubParty();
    };
  }, [isReady]);

  // Watch for deleted tokens (GM client only, created once, independent of combat state).
  // A token only counts as deleted if we saw it in the scene and it is now gone, so a
  // scene switch (items briefly empty or from another scene) never removes anyone.
  useEffect(() => {
    if (!isReady || role !== "GM") return;

    let sceneReady = false;
    let prevIds = new Set<string>();
    const gmCtx: Ctx = { role: "GM", playerId };

    const seed = async () => {
      const items = await OBR.scene.items.getItems();
      prevIds = new Set(items.map((i) => i.id));
    };

    OBR.scene.isReady().then(async (ready) => {
      sceneReady = ready;
      if (ready) await seed();
    });

    const unsubReady = OBR.scene.onReadyChange(async (ready) => {
      sceneReady = ready;
      prevIds = new Set();
      if (ready) await seed();
    });

    const unsubItems = OBR.scene.items.onChange((items) => {
      if (!sceneReady) return;
      const current = new Set(items.map((i) => i.id));
      const gone = [...prevIds].filter((id) => !current.has(id));
      prevIds = current;
      if (gone.length === 0) return;
      dispatch((s) =>
        combat.removeParticipants(s, { ids: combat.participantIdsForTokens(s, gone) }, gmCtx)
      );
    });

    return () => {
      unsubReady();
      unsubItems();
    };
  }, [isReady, role, playerId, dispatch]);

  const canControl = (participant: Participant): boolean => combat.canControl(participant, ctx);
  const getDisplayName = combat.displayName;

  // === ACTIONS ===

  const saveCustomName = async (participantId: string, newName: string) => {
    await run((s, c) => combat.setCustomName(s, { id: participantId, name: newName }, c));
    setEditingNameId(null);
  };

  const startCombat = async () => {
    const selection = await OBR.player.getSelection();
    if (!selection || selection.length === 0) {
      await OBR.notification.show("Select tokens to add to combat", "WARNING");
      return;
    }
    const items = await OBR.scene.items.getItems(selection);
    const participants = combat.buildParticipants(items, partyPlayers);
    await run((s, c) => combat.startCombat(s, { participants }, c));
  };

  const drawCard = (participantId: string) => {
    const p = combatState.participants.find((x) => x.id === participantId);
    return run((s, c) =>
      p?.lightningFast
        ? combat.drawTwo(s, { id: participantId }, c)
        : combat.drawCard(s, { id: participantId }, c)
    );
  };

  const drawAllCards = () => run((s, c) => combat.drawAll(s, c));
  const startRound = () => run((s, c) => combat.startRound(s, c));
  const act = () => run((s, c) => combat.act(s, c));
  const newRound = () => run((s, c) => combat.newRound(s, c));

  const initiateSwap = (participantId: string) => setSwappingFrom(participantId);
  const cancelSwap = () => setSwappingFrom(null);

  const executeSwap = async (targetId: string) => {
    await run((s, c) => combat.swap(s, { targetId }, c));
    setSwappingFrom(null);
  };

  const addFerocity = (participantId: string) =>
    run((s, c) =>
      combat.addFerocity(s, { id: participantId, newId: crypto.randomUUID() }, c)
    );

  const removeParticipant = (participantId: string) =>
    run((s, c) => combat.removeParticipants(s, { ids: [participantId] }, c));

  const endCombat = async () => {
    if (role !== "GM") return;
    await OBR.room.setMetadata({ [METADATA_KEY]: undefined });
    setCombatState(INITIAL_COMBAT_STATE);
    await OBR.notification.show("Combat ended");
  };

  const addParticipants = async () => {
    const selection = await OBR.player.getSelection();
    if (!selection || selection.length === 0) {
      await OBR.notification.show("Select tokens to add", "WARNING");
      return;
    }
    const items = await OBR.scene.items.getItems(selection);
    const participants = combat.buildParticipants(items, partyPlayers);
    await run((s, c) => combat.addParticipants(s, { participants }, c));
  };

  // === RENDER ===

  if (!isReady) {
    return <div className="loading">Loading...</div>;
  }

  const sorted = combat.sortedByCard(combatState.participants);
  const allDrawn = combatState.participants.every((p) => p.initiativeCard !== null);
  const currentParticipant = combat.activeParticipant(combatState);
  const validSwapTargets = combat.validSwapTargets(combatState);
  const isGM = role === "GM";

  const getStatusText = (): string => {
    if (!combatState.isActive) return "No Combat";
    if (combatState.phase === "DRAWING") return `Round ${combatState.roundNumber} - Drawing`;
    if (combatState.phase === "ROUND_COMPLETE") return `Round ${combatState.roundNumber} - Complete`;
    return `Round ${combatState.roundNumber} - Active`;
  };

  const getParticipantStatusText = (p: Participant): string => {
    if (p.status === "ACTIVE") return "Active";
    if (p.status === "ACTED") return "Acted";
    if (p.status === "WAITED") return "Waited";
    if (combatState.phase === "DRAWING" && p.initiativeCard === null) return "Draw card";
    return "";
  };

  // Determine display order
  const displayParticipants =
    combatState.phase === "DRAWING"
      ? combatState.participants
      : sorted.length > 0
      ? sorted
      : combatState.participants;

  return (
    <div className={`app ${theme.toLowerCase()}`}>
      {/* Header */}
      <div className="header">
        <h1>Draw Initiative</h1>
        <span className="status-badge">{getStatusText()}</span>
      </div>

      {/* No Combat State */}
      {!combatState.isActive && (
        <div className="empty-state">
          <p>No active combat</p>
          {isGM && (
            <button className="btn-primary" onClick={startCombat}>
              Start Combat
            </button>
          )}
          {!isGM && <p>Waiting for GM to start combat</p>}
        </div>
      )}

      {/* Combat Active */}
      {combatState.isActive && (
        <>
          <div className="scroll-area">
          {/* Participant List */}
          <div className="participant-list">
            {displayParticipants.map((p) => {
              const isActive = p.status === "ACTIVE" && combatState.phase === "ACTIVE";
              const canDraw =
                combatState.phase === "DRAWING" &&
                p.initiativeCard === null &&
                canControl(p);

              return (
                <div
                  key={p.id}
                  className={`participant-row ${isActive ? "active" : ""} ${
                    p.status === "ACTED" ? "acted" : ""
                  } ${p.status === "WAITED" ? "waited" : ""}`}
                >
                  {/* Initiative Card */}
                  <div className={`initiative-card ${p.initiativeCard === null ? "empty" : ""}`}>
                    {p.initiativeCard ?? "?"}
                  </div>

                  {/* Info */}
                  <div className="participant-info">
                    {isGM && combatState.phase === "DRAWING" && editingNameId === p.id ? (
                      <input
                        className="participant-name-input"
                        value={editingNameValue}
                        onChange={(e) => setEditingNameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveCustomName(p.id, editingNameValue);
                          if (e.key === "Escape") setEditingNameId(null);
                        }}
                        onBlur={() => saveCustomName(p.id, editingNameValue)}
                        autoFocus
                      />
                    ) : (
                      <div
                        className={`participant-name ${isGM && combatState.phase === "DRAWING" ? "editable" : ""}`}
                        onClick={() => {
                          if (isGM && combatState.phase === "DRAWING") {
                            setEditingNameId(p.id);
                            setEditingNameValue(getDisplayName(p));
                          }
                        }}
                      >
                        {getDisplayName(p)}
                      </div>
                    )}
                    <div className="participant-status">{getParticipantStatusText(p)}</div>
                  </div>

                  {/* Actions */}
                  <div className="participant-actions">
                    {isGM && combatState.phase === "DRAWING" && p.controlledBy === "GM" && (
                      <button
                        className="btn-secondary btn-small"
                        onClick={() => addFerocity(p.id)}
                        title="Add Ferocity"
                      >
                        +Ferocity
                      </button>
                    )}
                    {canDraw && (
                      <button className="btn-primary btn-small" onClick={() => drawCard(p.id)}>
                        Draw
                      </button>
                    )}

                    {isGM && (
                      <button
                        className="btn-danger btn-small"
                        onClick={() => removeParticipant(p.id)}
                        title="Remove"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Active Turn Actions */}
          {combatState.phase === "ACTIVE" && currentParticipant && canControl(currentParticipant) && (
            <div className="action-buttons sticky-actions">
              {swappingFrom === null ? (
                <>
                  <button className="btn-primary btn-full" onClick={act}>
                    Act
                  </button>
                  {validSwapTargets.length > 0 && (
                    <button
                      className="btn-secondary btn-full"
                      onClick={() => initiateSwap(currentParticipant.id)}
                    >
                      Wait
                    </button>
                  )}
                </>
              ) : (
                <div className="swap-targets">
                  <h4>Select swap target:</h4>
                  {validSwapTargets.map((t) => (
                    <button
                      key={t.id}
                      className="swap-target-btn btn-secondary"
                      onClick={() => executeSwap(t.id)}
                    >
                      <span className="initiative-card">{t.initiativeCard}</span>
                      <span>{getDisplayName(t)}</span>
                    </button>
                  ))}
                  <button className="btn-danger btn-full" onClick={cancelSwap}>
                    Cancel
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Phase-specific GM actions */}
          {isGM && combatState.phase === "DRAWING" && (
            <div className="action-buttons sticky-actions">
              <button className="btn-secondary btn-full" onClick={drawAllCards} disabled={allDrawn}>
                Draw All Cards
              </button>
              <button className="btn-primary btn-full" onClick={startRound} disabled={!allDrawn}>
                Start Round
              </button>
            </div>
          )}

          {isGM && combatState.phase === "ROUND_COMPLETE" && (
            <div className="action-buttons sticky-actions">
              <button className="btn-primary btn-full" onClick={newRound}>
                Draw New Round
              </button>
            </div>
          )}

          </div>

          {/* Footer */}
          <div className="footer">
            <div className="footer-buttons">
              {isGM && combatState.phase === "DRAWING" && (
                <button className="btn-secondary" onClick={addParticipants}>
                  Add Participants
                </button>
              )}
              {isGM && (
                <button className="btn-danger" onClick={endCombat}>
                  End Combat
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default App;
