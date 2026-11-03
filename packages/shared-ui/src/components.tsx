import type { PlatformBridge } from "./platform.js";
import type { RoomSummary } from "@spectra/contracts";

export const SHOWROOM_MODES = ["grid", "focus"] as const;
export type ShowroomMode = (typeof SHOWROOM_MODES)[number];

export type RoomCardModel = RoomSummary;

export interface RoomLobbyProps {
  rooms: RoomCardModel[];
  selectedRoomId?: string;
  favoriteRoomIds?: ReadonlySet<string>;
  ownedRoomIds?: ReadonlySet<string>;
  onSelectRoom?: (room: RoomCardModel) => void;
  onEnterRoom?: (room: RoomCardModel) => void;
  onCreateRoom?: () => void;
  onCopyRoomCode?: (roomCode: string) => void;
  onDeleteRoom?: (room: RoomCardModel) => void;
  onToggleFavorite?: (room: RoomCardModel) => void;
  platformBridge?: Pick<PlatformBridge, "copyToClipboard">;
}

export interface ShowroomPanelProps {
  room: RoomCardModel;
  mode: ShowroomMode;
  onToggleMode?: (mode: ShowroomMode) => void;
}

const styles = {
  shell: {
    display: "grid",
    gap: 20,
    gridTemplateColumns: "minmax(280px, 360px) minmax(0, 1fr)",
    padding: 20,
    minHeight: "100vh",
    background: "linear-gradient(180deg, #090b15 0%, #121726 100%)",
    color: "#edf2ff",
    fontFamily: "Inter, Segoe UI, sans-serif",
  } as const,
  sidebar: {
    background: "rgba(15, 23, 42, 0.88)",
    border: "1px solid rgba(148, 163, 184, 0.18)",
    borderRadius: 18,
    padding: 18,
    boxShadow: "0 24px 48px rgba(15, 23, 42, 0.32)",
  } as const,
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 14,
  } as const,
  logo: {
    fontSize: 12,
    letterSpacing: 2,
    textTransform: "uppercase" as const,
    color: "#7dd3fc",
    fontWeight: 700,
  },
  button: {
    background: "linear-gradient(135deg, #38bdf8 0%, #8b5cf6 100%)",
    color: "#f8fafc",
    border: "none",
    borderRadius: 12,
    padding: "10px 16px",
    fontWeight: 700,
    cursor: "pointer",
  } as const,
  roomList: {
    display: "grid",
    gap: 12,
    marginTop: 18,
  } as const,
  roomCard: (selected: boolean) => ({
    border: selected ? "1px solid rgba(56, 189, 248, 0.8)" : "1px solid rgba(148, 163, 184, 0.18)",
    borderRadius: 14,
    padding: 14,
    background: selected ? "rgba(14, 116, 144, 0.22)" : "rgba(15, 23, 42, 0.7)",
    cursor: "pointer",
    transition: "transform 160ms ease, border-color 160ms ease",
  }) as const,
  metaRow: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap" as const,
    marginTop: 8,
  } as const,
  pill: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
    padding: "4px 8px",
    background: "rgba(148, 163, 184, 0.12)",
    color: "#dbeafe",
    fontSize: 11,
    fontWeight: 700,
  } as const,
  showroom: {
    borderRadius: 20,
    background: "rgba(15, 23, 42, 0.8)",
    border: "1px solid rgba(148, 163, 184, 0.18)",
    padding: 20,
    boxShadow: "0 24px 48px rgba(15, 23, 42, 0.3)",
    display: "grid",
    gap: 16,
  } as const,
  canvas: {
    minHeight: 360,
    borderRadius: 18,
    background: "radial-gradient(circle at top, rgba(59,130,246,0.42), rgba(15,23,42,0.96) 48%)",
    border: "1px solid rgba(96, 165, 250, 0.25)",
    position: "relative" as const,
    overflow: "hidden",
    padding: 20,
  } as const,
  stageLayer: {
    position: "absolute" as const,
    inset: 0,
    background: "linear-gradient(180deg, rgba(15, 23, 42, 0.14), rgba(2, 6, 23, 0.84))",
  } as const,
  overlay: {
    position: "relative" as const,
    zIndex: 1,
    display: "grid",
    gap: 16,
    height: "100%",
  } as const,
  topBar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  } as const,
  modeSwitch: {
    display: "inline-flex",
    gap: 8,
    padding: 6,
    borderRadius: 999,
    background: "rgba(15, 23, 42, 0.82)",
    border: "1px solid rgba(148, 163, 184, 0.18)",
  } as const,
  modeButton: (active: boolean) => ({
    border: "none",
    borderRadius: 999,
    background: active ? "rgba(56, 189, 248, 0.18)" : "transparent",
    color: active ? "#e0f2fe" : "#cbd5e1",
    padding: "8px 12px",
    textTransform: "uppercase" as const,
    fontSize: 11,
    letterSpacing: 1,
    fontWeight: 700,
    cursor: "pointer",
  }) as const,
};

export function RoomLobby({
  rooms,
  selectedRoomId,
  favoriteRoomIds,
  ownedRoomIds,
  onSelectRoom,
  onEnterRoom,
  onCreateRoom,
  onCopyRoomCode,
  onDeleteRoom,
  onToggleFavorite,
  platformBridge,
}: RoomLobbyProps) {
  return (
    <section className="room-lobby" aria-labelledby="room-lobby-title">
      <div className="room-grid">
        {rooms.map((room) => {
          const selected = room.id === selectedRoomId;
          const favorite = favoriteRoomIds?.has(room.slug) ?? false;
          const owned = room.is_owner ?? ownedRoomIds?.has(room.slug) ?? false;
          return (
            <article
              key={room.id}
              className={`room-card${selected ? " is-selected" : ""}${room.is_active ? " is-active" : ""}`}
              onMouseEnter={() => onSelectRoom?.(room)}
            >
              <div className="room-card-topline">
                <span className={`room-state${room.is_active ? " live" : ""}`}>
                  <i aria-hidden="true" />{room.is_active ? "Ao vivo" : "Pronta para entrar"}
                </span>
                <button
                  className={`icon-button favorite-button${favorite ? " is-favorite" : ""}`}
                  type="button"
                  aria-label={favorite ? `Remover ${room.name} dos favoritos` : `Adicionar ${room.name} aos favoritos`}
                  aria-pressed={favorite}
                  onClick={() => onToggleFavorite?.(room)}
                >{favorite ? "★" : "☆"}</button>
              </div>
              <button className="room-card-select" type="button" onClick={() => onSelectRoom?.(room)}>
                <span className="room-card-name">{room.name}</span>
                <span className="room-card-code">Código {room.room_code}</span>
              </button>
              <div className="room-card-details">
                <span className="room-visibility">{room.visibility === "private" ? "Privada" : "Pública"}</span>
                {owned && <span className="owner-badge">♛ Sua sala</span>}
                <span>{room.active_streams} transmitindo</span>
                <span>{room.participants} na sala</span>
              </div>
              <div className="room-card-footer">
                <span>Host · {room.owner_display_name}</span>
                <button
                  className="text-button"
                  type="button"
                  onClick={() => {
                    if (onCopyRoomCode !== undefined) onCopyRoomCode(room.room_code);
                    else if (platformBridge !== undefined) void platformBridge.copyToClipboard(room.room_code);
                  }}
                >Copiar link</button>
                {owned && (
                  <button
                    className="text-button delete-room-button"
                    type="button"
                    onClick={() => onDeleteRoom?.(room)}
                  >Excluir sala</button>
                )}
              </div>
              <button className="room-enter-button" type="button" onClick={() => onEnterRoom?.(room)}>
                Entrar na sala <span aria-hidden="true">→</span>
              </button>
            </article>
          );
        })}
      </div>
      {rooms.length === 0 && (
        <div className="empty-rooms">
          <div className="empty-rooms-icon" aria-hidden="true">⌂</div>
          <h3 id="room-lobby-title">Você ainda não entrou em nenhuma sala</h3>
          <p>Crie uma sala ou entre usando um link ou código para ela aparecer aqui.</p>
        </div>
      )}
    </section>
  );
}

export function ShowroomPanel({ room, mode, onToggleMode }: ShowroomPanelProps) {
  const canFocus = room.is_active || room.active_streams > 0;

  return (
    <section style={styles.showroom}>
      <div style={styles.topBar}>
        <div>
          <div style={styles.logo}>Sala</div>
          <h1 style={{ margin: 0, fontSize: 36 }}>{room.name}</h1>
        </div>

        <div style={styles.modeSwitch}>
          {SHOWROOM_MODES.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => onToggleMode?.(option)}
              style={styles.modeButton(mode === option)}
            >
              {option}
            </button>
          ))}
        </div>
      </div>

      <div style={styles.canvas}>
        <div style={styles.stageLayer} />
        <div style={styles.overlay}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
            <div>
              <div style={{ color: "#e2e8f0", fontSize: 12, letterSpacing: 1.4, textTransform: "uppercase" }}>
                Sala fixa
              </div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{room.owner_display_name}</div>
            </div>
            <div style={{ ...styles.pill, background: room.is_active ? "rgba(34,197,94,0.18)" : "rgba(148,163,184,0.12)" }}>
              {room.is_active ? "ao vivo" : "hibernada"}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(110px, 1fr))", gap: 12, alignSelf: "end" }}>
            <Metric label="Participantes" value={String(room.participants)} />
            <Metric label="Streams" value={String(room.active_streams)} />
            <Metric label="Layout" value={room.layout_preset === "rpg_theater" ? "teatro" : "grid"} />
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ color: "#dbeafe", fontSize: 14 }}>Código {room.room_code}</div>
            <div style={{ color: "#bfdbfe", fontSize: 12 }}>
              {canFocus ? "modo foco disponível" : "modo foco com fila em espera"}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        background: "rgba(15, 23, 42, 0.7)",
        borderRadius: 14,
        border: "1px solid rgba(148, 163, 184, 0.16)",
        padding: "10px 12px",
      }}
    >
      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1.2, color: "#94a3b8" }}>{label}</div>
      <strong style={{ display: "block", marginTop: 4, fontSize: 22 }}>{value}</strong>
    </div>
  );
}
