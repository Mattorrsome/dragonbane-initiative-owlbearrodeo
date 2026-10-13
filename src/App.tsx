import { useEffect, useState, useCallback, useRef } from "react";
import OBR, { Player } from "@owlbear-rodeo/sdk";
import { CombatState, Participant, INITIAL_COMBAT_STATE, METADATA_KEY } from "./types";
import * as combat from "./combat";
import type { Ctx, Result } from "./combat";

type Role = "GM" | "PLAYER";
type Theme = "DARK" | "LIGHT";

const ANY_EDIT_KEY = "com.dragonbane-initiative/any-player-can-edit";

const FEROCITY_COLORS = ["#ff7043", "#42a5f5", "#66bb6a", "#ffca28", "#ec407a", "#26c6da"];

function App() {
  const [isReady, setIsReady] = useState(false);
  const [role, setRole] = useState<Role>("PLAYER");
  const [playerId, setPlayerId] = useState<string>("");
  const [theme, setTheme] = useState<Theme>("DARK");
  const [combatState, setCombatState] = useState<CombatState>(INITIAL_COMBAT_STATE);
  // Swap pickers remember the table they were opened on; any turn/phase change closes them.
  const [swapKey, setSwapKey] = useState<string | null>(null);
  const [gmSwapPick, setGmSwapPick] = useState<{ id: string; key: string } | null>(null);
  const [partyPlayers, setPartyPlayers] = useState<Player[]>([]);
  const [selectionCount, setSelectionCount] = useState(0);
  const [editingNameId, setEditingNameId] = useState<string | null>(null);
  const [editingNameValue, setEditingNameValue] = useState("");
  // GM preference, remembered per browser and copied into combat state at start.
  const [anyPlayerCanEdit, setAnyPlayerCanEdit] = useState(() => localStorage.getItem(ANY_EDIT_KEY) === "true");

  const combatRef = useRef(combatState);
  useEffect(() => {
    combatRef.current = combatState;
  });

  const ctx: Ctx = { role, playerId };

  // Re-read metadata, apply the reducer to the fresh state, write. Not atomic, but the
  // read-modify-write window is milliseconds instead of "whatever this client last saw".
  const dispatch = useCallback(
    async (reducer: (s: CombatState) => Result): Promise<boolean> => {
      try {
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
      } catch (e) {
        console.error(e);
        await OBR.notification.show("Couldn't update combat, try again", "ERROR").catch(() => {});
        return false;
      }
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

  // Track the local player's token selection (initial value + live updates).
  useEffect(() => {
    if (!isReady) return;
    OBR.player.getSelection().then((sel) => setSelectionCount(sel?.length ?? 0)).catch(console.error);
    return OBR.player.onChange((p) => setSelectionCount(p.selection?.length ?? 0));
  }, [isReady]);

  // Subscribe to metadata changes
  useEffect(() => {
    if (!isReady) return;

    // Tell non-GM clients when combat starts/ends (the acting GM already gets a local toast).
    const unsubMetadata = OBR.room.onMetadataChange((metadata) => {
      const next = combat.normalizeState(metadata[METADATA_KEY]);
      if (role !== "GM" && next.isActive !== combatRef.current.isActive) {
        OBR.notification.show(next.isActive ? "Combat started" : "Combat ended").catch(console.error);
      }
      setCombatState(next);
    });
    const unsubTheme = OBR.theme.onChange((t) => setTheme(t.mode));
    const unsubParty = OBR.party.onChange((p) => setPartyPlayers(p));

    return () => {
      unsubMetadata();
      unsubTheme();
      unsubParty();
    };
  }, [isReady, role]);

  // Watch for deleted tokens (GM client only, created once, independent of combat state).
  // A token only counts as deleted if we saw it in the scene and it is now gone, so a
  // scene switch (items briefly empty or from another scene) never removes anyone.
  useEffect(() => {
    if (!isReady || role !== "GM") return;

    let sceneReady = false;
    let prevIds = new Set<string>();
    let queue: Promise<unknown> = Promise.resolve(); // serialize dispatches (no concurrent read-modify-write)
    let gen = 0; // bumped on every scene change/cleanup so stale async results are dropped
    const gmCtx: Ctx = { role: "GM", playerId };

    const seed = async (my: number) => {
      const items = await OBR.scene.items.getItems();
      if (my === gen) prevIds = new Set(items.map((i) => i.id));
    };

    const my0 = ++gen;
    OBR.scene
      .isReady()
      .then(async (ready) => {
        if (my0 !== gen) return;
        sceneReady = ready;
        if (ready) await seed(my0);
      })
      .catch(console.error);

    const unsubReady = OBR.scene.onReadyChange(async (ready) => {
      const my = ++gen;
      sceneReady = ready;
      prevIds = new Set();
      try {
        if (ready) await seed(my);
      } catch (e) {
        console.error(e);
      }
    });

    const unsubItems = OBR.scene.items.onChange((items) => {
      if (!sceneReady) return;
      const current = new Set(items.map((i) => i.id));
      const gone = [...prevIds].filter((id) => !current.has(id));
      // Scene teardown can emit an empty/new list before onReadyChange(false): if every
      // previously seen id vanished at once, treat it as a scene swap, not deletions.
      const swap = prevIds.size > 0 && gone.length === prevIds.size;
      prevIds = current;
      if (gone.length === 0 || swap) return;
      queue = queue
        .then(() =>
          dispatch((s) =>
            combat.removeParticipants(s, { ids: combat.participantIdsForTokens(s, gone) }, gmCtx)
          )
        )
        .catch(console.error);
    });

    return () => {
      gen++;
      unsubReady();
      unsubItems();
    };
  }, [isReady, role, playerId, dispatch]);

  const canControl = (participant: Participant): boolean => combat.canControl(participant, ctx);
  const turnKey = `${combat.activeParticipant(combatState)?.id}|${combatState.phase}`;
  const swapping = swapKey === turnKey;
  const tableKey = `${combatState.phase}|${combatState.roundNumber}|${combatState.participants.length}`;
  const gmSwapFirst =
    gmSwapPick?.key === tableKey && combatState.participants.some((p) => p.id === gmSwapPick.id)
      ? gmSwapPick.id
      : null;

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
    if (await run((s, c) => combat.startCombat(s, { participants, anyPlayerCanEdit }, c)))
      await OBR.player.deselect();
  };

  // Decide on the fresh state: Lightning Fast may have been toggled on another client.
  const drawCard = (participantId: string) =>
    run((s, c) =>
      combat.findP(s, participantId)?.lightningFast
        ? combat.drawTwo(s, { id: participantId }, c)
        : combat.drawCard(s, { id: participantId }, c)
    );

  const drawAllCards = () => run((s, c) => combat.drawAll(s, c));
  const startRound = () => run((s, c) => combat.startRound(s, c));
  const act = () => run((s, c) => combat.act(s, c));
  const newRound = () => run((s, c) => combat.newRound(s, c));

  const initiateSwap = () => setSwapKey(turnKey);
  const cancelSwap = () => setSwapKey(null);

  const executeSwap = async (targetId: string) => {
    await run((s, c) => combat.swap(s, { targetId }, c));
    setSwapKey(null);
  };

  const addFerocity = (participantId: string) =>
    run((s, c) =>
      combat.addFerocity(s, { id: participantId, newId: crypto.randomUUID() }, c)
    );

  // Removes every row of the token, so Ferocity duplicates go with it.
  const removeToken = (tokenId: string) =>
    run((s, c) => combat.removeParticipants(s, { ids: combat.participantIdsForTokens(s, [tokenId]) }, c));

  const endCombat = () => run((s, c) => combat.endCombat(s, c));

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

  const setLightningFast = (id: string, value: boolean) =>
    run((s, c) => combat.setLightningFast(s, { id, value }, c));
  const setSurprise = (id: string, value: boolean) =>
    run((s, c) => combat.setSurprise(s, { id, value }, c));
  const setRetainNext = (id: string, value: boolean) =>
    run((s, c) => combat.setRetainNext(s, { id, value }, c));
  const chooseCard = (id: string, card: number) =>
    run((s, c) => combat.chooseOne(s, { id, card }, c));
  const pickSurprise = (id: string, card: number) =>
    run((s, c) => combat.pickSurpriseCard(s, { id, card }, c));
  const gmWait = (id: string) => run((s, c) => combat.gmToggleWait(s, { id }, c));
  const gmSetCard = (id: string, card: number | null) =>
    run((s, c) => combat.gmSetCard(s, { id, card }, c));
  const gmSwapClick = async (id: string) => {
    if (gmSwapFirst === null) return setGmSwapPick({ id, key: tableKey });
    if (gmSwapFirst === id) return setGmSwapPick(null);
    const first = gmSwapFirst;
    setGmSwapPick(null);
    await run((s, c) => combat.gmSwapCards(s, { first, second: id }, c));
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

  const surpriseOutstanding = combat.waitingOnSurprise(combatState);

  const getParticipantStatusText = (p: Participant): string => {
    if (p.status === "ACTIVE") return "Active";
    if (p.status === "ACTED") return "Acted";
    if (p.status === "WAITED") return "Waited";
    if (combatState.phase === "DRAWING" && p.initiativeCard === null) {
      if (p.pendingCards) return "Choosing...";
      if (p.surprise) return "Surprise: pick a card";
      if (surpriseOutstanding) return "Waiting for surprise picks";
      return p.lightningFast ? "Draw two cards" : "Draw card";
    }
    return "";
  };

  // Determine display order
  const displayParticipants =
    combatState.phase === "DRAWING"
      ? combatState.participants
      : [...sorted, ...combatState.participants.filter((p) => p.initiativeCard === null)];

  // Ferocity rows (same token) share a border colour and are numbered by turn-order position.
  const ferocity = new Map<string, { color: number; n: number }>();
  {
    const byToken = new Map<string, string[]>();
    for (const p of displayParticipants)
      byToken.set(p.tokenId, [...(byToken.get(p.tokenId) ?? []), p.id]);
    let color = 0;
    for (const ids of byToken.values()) {
      if (ids.length < 2) continue;
      ids.forEach((id, i) => ferocity.set(id, { color, n: i + 1 }));
      color++;
    }
  }

  // Different tokens with the same name get "#1", "#2" in the order they were added.
  const sameName = new Map<string, number>();
  {
    const tokensByName = new Map<string, string[]>();
    for (const p of combatState.participants) {
      const n = combat.displayName(p);
      const t = tokensByName.get(n) ?? [];
      if (!t.includes(p.tokenId)) tokensByName.set(n, [...t, p.tokenId]);
    }
    const dupes = new Map<string, number>();
    for (const [n, t] of tokensByName) if (t.length > 1) t.forEach((tok, i) => dupes.set(`${n}|${tok}`, i + 1));
    for (const p of combatState.participants) {
      const k = `${combat.displayName(p)}|${p.tokenId}`;
      if (dupes.has(k)) sameName.set(p.id, dupes.get(k)!);
    }
  }

  return (
    <div className={`app ${theme.toLowerCase()}`}>
      {/* Header */}
      <div className="header">
        <h1>Dragonbane Initiative</h1>
        <span className="status-badge">
          {getStatusText()}
          {combatState.isActive && ` · Deck 1-${combatState.deckSize}`}
        </span>
      </div>

      {/* No Combat State */}
      {!combatState.isActive && (
        <div className="empty-state">
          <p>No active combat</p>
          {isGM && (
            <label
              className="toggle"
              style={{ paddingBottom: "2em" }}
              title="When checked, every player can toggle Lightning Fast, Surprise and Keep (Veteran), draw cards, pick Surprise cards and choose Lightning Fast cards for any participant, even tokens not assigned to them. Otherwise only the GM and a token's owner can. Remembered on this browser for future combats."
            >
              <input
                type="checkbox"
                checked={anyPlayerCanEdit}
                onChange={(e) => {
                  setAnyPlayerCanEdit(e.target.checked);
                  localStorage.setItem(ANY_EDIT_KEY, String(e.target.checked));
                }}
              />
              Any player can edit
            </label>
          )}
          {isGM && (
            <button className="btn-primary" onClick={startCombat} disabled={selectionCount === 0}>
              {selectionCount > 0
                ? `Start Combat with ${selectionCount} Combatant${selectionCount === 1 ? "" : "s"}`
                : "Select tokens to start combat"}
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
          {combatState.phase === "DRAWING" && combatState.lastDraw && (
            <div className="last-draw">
              {(() => {
                const who = combatState.participants.find(
                  (p) => p.id === combatState.lastDraw!.participantId
                );
                return who ? `${combat.displayName(who)} drew #${combatState.lastDraw.card}` : null;
              })()}
            </div>
          )}
          <div className="participant-list">
            {displayParticipants.map((p) => {
              const isActive = p.status === "ACTIVE" && combatState.phase === "ACTIVE";
              const canDraw =
                combatState.phase === "DRAWING" &&
                p.initiativeCard === null &&
                !p.pendingCards &&
                !p.surprise &&
                (canControl(p) || combatState.anyPlayerCanEdit);
              const drawing = combatState.phase === "DRAWING";
              const unheld = p.initiativeCard === null && !p.pendingCards;
              const pair = p.pendingCards ? [...p.pendingCards].sort((a, b) => a - b) : null;
              const mine = canControl(p);
              const editable = mine || combatState.anyPlayerCanEdit;
              const free = combat.freeCards(combatState);
              const atCap = combatState.participants.length >= combat.MAX_PARTICIPANTS;
              const fer = ferocity.get(p.id);

              return (
                <div
                  key={p.id}
                  style={fer ? ({ "--fer": FEROCITY_COLORS[fer.color % FEROCITY_COLORS.length] } as React.CSSProperties) : undefined}
                  className={`participant-row ${isActive ? "active" : ""} ${
                    p.status === "ACTED" ? "acted" : ""
                  } ${p.status === "WAITED" ? "waited" : ""} ${fer ? "ferocity" : ""}`}
                >
                  {/* Initiative Card */}
                  <div
                    className={`initiative-card ${p.initiativeCard === null ? "empty" : ""} ${
                      pair ? "pending" : ""
                    }`}
                  >
                    {pair ? `${pair[0]} or ${pair[1]}` : p.initiativeCard ?? "?"}
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
                            setEditingNameValue(combat.displayName(p));
                          }
                        }}
                      >
                        {combat.displayName(p)}
                        {sameName.has(p.id) && ` #${sameName.get(p.id)}`}
                        {fer && ` - Action ${fer.n}`}
                      </div>
                    )}
                    <div className="participant-status">{getParticipantStatusText(p)}</div>
                    <div className="toggle-row">
                      {drawing && unheld && editable && (
                        <label className="toggle">
                          <input
                            type="checkbox"
                            checked={p.lightningFast}
                            onChange={(e) => setLightningFast(p.id, e.target.checked)}
                          />
                          Lightning Fast
                        </label>
                      )}
                      {(isGM || combatState.anyPlayerCanEdit) && drawing && unheld && combatState.roundNumber === 1 && (
                        <label className="toggle">
                          <input
                            type="checkbox"
                            checked={p.surprise}
                            onChange={(e) => setSurprise(p.id, e.target.checked)}
                          />
                          Surprise
                        </label>
                      )}
                      {editable && combatState.phase !== "DRAWING" && (
                        <label className="toggle">
                          <input
                            type="checkbox"
                            checked={p.retainNext}
                            onChange={(e) => setRetainNext(p.id, e.target.checked)}
                          />
                          Keep
                        </label>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="participant-actions">
                    {isGM && drawing && p.controlledBy === "GM" && (
                      <button
                        className="btn-secondary btn-small"
                        onClick={() => addFerocity(p.id)}
                        disabled={atCap}
                        title={atCap ? "Maximum 20 participants" : "Add Ferocity"}
                      >
                        +Ferocity
                      </button>
                    )}
                    {canDraw && (
                      <button
                        className="btn-primary btn-small"
                        onClick={() => drawCard(p.id)}
                        disabled={surpriseOutstanding}
                      >
                        {p.lightningFast ? "Draw 2" : "Draw"}
                      </button>
                    )}
                    {p.pendingCards && editable && (
                      <>
                        {pair!.map((card) => (
                          <button
                            key={card}
                            className="btn-primary btn-small"
                            onClick={() => chooseCard(p.id, card)}
                          >
                            #{card}
                          </button>
                        ))}
                      </>
                    )}
                    {p.surprise && p.initiativeCard === null && editable && (
                      <select
                        className="card-select"
                        value=""
                        onChange={(e) => e.target.value && pickSurprise(p.id, Number(e.target.value))}
                      >
                        <option value="">Pick…</option>
                        {free.map((card) => (
                          <option key={card} value={card}>
                            {card}
                          </option>
                        ))}
                      </select>
                    )}

                    {isGM && combatState.phase === "ACTIVE" && p.status !== "ACTED" && (
                      <button
                        className="btn-secondary btn-small"
                        onClick={() => gmWait(p.id)}
                        title="Toggle Wait without exchanging cards"
                      >
                        {p.status === "WAITED" ? "Unwait" : "Wait"}
                      </button>
                    )}
                    {isGM && drawing && allDrawn && (
                      <>
                        <button
                          className={`btn-secondary btn-small ${gmSwapFirst === p.id ? "selected" : ""}`}
                          onClick={() => gmSwapClick(p.id)}
                          title={gmSwapFirst ? "Swap cards with this participant" : "Swap cards (pick two)"}
                        >
                          ⇄
                        </button>
                        {!p.pendingCards && (
                          <select
                            className="card-select"
                            value=""
                            onChange={(e) => {
                              if (e.target.value === "") return;
                              gmSetCard(p.id, e.target.value === "none" ? null : Number(e.target.value));
                            }}
                            title="Set or clear card"
                          >
                            <option value="">Set…</option>
                            {p.initiativeCard !== null && <option value="none">Clear</option>}
                            {free.map((card) => (
                              <option key={card} value={card}>
                                {card}
                              </option>
                            ))}
                          </select>
                        )}
                      </>
                    )}

                    {isGM && (
                      <button
                        className="btn-danger btn-small"
                        onClick={() => removeToken(p.tokenId)}
                        title={fer ? "Remove (all Ferocity actions)" : "Remove"}
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
              {!swapping ? (
                <>
                  <button className="btn-primary btn-full" onClick={act}>
                    Act
                  </button>
                  {validSwapTargets.length > 0 && (
                    <button
                      className="btn-secondary btn-full"
                      onClick={initiateSwap}
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
                      <span>{combat.displayName(t)}</span>
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
              <button
                className="btn-secondary btn-full"
                onClick={drawAllCards}
                disabled={allDrawn || surpriseOutstanding}
                title={surpriseOutstanding ? "Waiting for surprise picks" : undefined}
              >
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
                <button
                  className="btn-secondary"
                  onClick={addParticipants}
                  disabled={combatState.participants.length >= combat.MAX_PARTICIPANTS}
                >
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
