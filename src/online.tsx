import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowDownToLine,
  Copy,
  Eye,
  Hand,
  Layers,
  LogIn,
  RefreshCw,
  RotateCcw,
  Shuffle,
  Sparkles,
  Swords,
  Trash2,
} from "lucide-react";
import { deckUrlsFromCode, expandDeck, normalizeDeckCode, parseDeckHtml } from "./deckParser";
import type { Card, CardInstance } from "./types";
import "./online.css";

declare global {
  interface Window {
    POKEWAN_FIREBASE_CONFIG?: {
      databaseURL?: string;
    };
  }
}

type PlayerId = "A" | "B";
type PrivateZone = "deck" | "hand" | "prizes";
type PublicZone = "active" | "bench" | "discard" | "lostZone" | "stadium";
type AnyZone = PrivateZone | PublicZone;

type PublicCard = Pick<CardInstance, "uid" | "id" | "name" | "imageUrl" | "category">;

type PrivatePlayerState = {
  deck: CardInstance[];
  hand: CardInstance[];
  prizes: CardInstance[];
};

type PublicPlayerState = {
  active: PublicCard[];
  bench: PublicCard[];
  discard: PublicCard[];
  lostZone: PublicCard[];
  stadium: PublicCard[];
  attachedCards: Record<string, PublicCard[]>;
  deckCount: number;
  handCount: number;
  prizeCount: number;
  status: {
    poison: boolean;
    burn: boolean;
    sleep: boolean;
    paralysis: boolean;
    confusion: boolean;
  };
};

type PublicRoomState = {
  roomId: string;
  players: Partial<Record<PlayerId, { name: string; seatedAt: number }>>;
  turnPlayer: PlayerId;
  updatedAt: number;
  playerStates: Record<PlayerId, PublicPlayerState>;
};

type SelectedCard = {
  card: CardInstance | PublicCard;
  zone: AnyZone;
  owner: PlayerId;
  privateCard: boolean;
};

const CARD_BACK_URL = "./card-back.svg";
const PRIVATE_STORAGE_PREFIX = "pokewan-online-private";
const LOCAL_PUBLIC_PREFIX = "pokewan-online-public";
const POLL_MS = 1400;

const PRIVATE_ZONE_LABELS: Record<PrivateZone, string> = {
  deck: "山札",
  hand: "手札",
  prizes: "サイド",
};

const PUBLIC_ZONE_LABELS: Record<PublicZone, string> = {
  active: "バトル場",
  bench: "ベンチ",
  discard: "トラッシュ",
  lostZone: "ロスト",
  stadium: "スタジアム",
};

const PLAYER_LABELS: Record<PlayerId, string> = {
  A: "プレイヤーA",
  B: "プレイヤーB",
};

const emptyPrivate = (): PrivatePlayerState => ({
  deck: [],
  hand: [],
  prizes: [],
});

const emptyPublicPlayer = (): PublicPlayerState => ({
  active: [],
  bench: [],
  discard: [],
  lostZone: [],
  stadium: [],
  attachedCards: {},
  deckCount: 0,
  handCount: 0,
  prizeCount: 0,
  status: {
    poison: false,
    burn: false,
    sleep: false,
    paralysis: false,
    confusion: false,
  },
});

function emptyRoom(roomId: string): PublicRoomState {
  return {
    roomId,
    players: {},
    turnPlayer: "A",
    updatedAt: Date.now(),
    playerStates: {
      A: emptyPublicPlayer(),
      B: emptyPublicPlayer(),
    },
  };
}

function normalizePublicPlayer(value?: Partial<PublicPlayerState> | null): PublicPlayerState {
  const fallback = emptyPublicPlayer();
  return {
    ...fallback,
    ...value,
    active: Array.isArray(value?.active) ? value.active : [],
    bench: Array.isArray(value?.bench) ? value.bench : [],
    discard: Array.isArray(value?.discard) ? value.discard : [],
    lostZone: Array.isArray(value?.lostZone) ? value.lostZone : [],
    stadium: Array.isArray(value?.stadium) ? value.stadium : [],
    attachedCards: value?.attachedCards || {},
    deckCount: Number(value?.deckCount || 0),
    handCount: Number(value?.handCount || 0),
    prizeCount: Number(value?.prizeCount || 0),
    status: {
      ...fallback.status,
      ...(value?.status || {}),
    },
  };
}

function normalizePublicRoom(value: Partial<PublicRoomState> | null | undefined, roomId: string): PublicRoomState | null {
  if (!value) return null;
  return {
    roomId: value.roomId || roomId,
    players: value.players || {},
    turnPlayer: value.turnPlayer === "B" ? "B" : "A",
    updatedAt: Number(value.updatedAt || Date.now()),
    playerStates: {
      A: normalizePublicPlayer(value.playerStates?.A),
      B: normalizePublicPlayer(value.playerStates?.B),
    },
  };
}

function OnlineBattleApp() {
  const [roomId, setRoomId] = useState("");
  const [joinRoomId, setJoinRoomId] = useState("");
  const [playerId, setPlayerId] = useState<PlayerId>("A");
  const [connected, setConnected] = useState(false);
  const [publicRoom, setPublicRoom] = useState<PublicRoomState | null>(null);
  const [privateState, setPrivateState] = useState<PrivatePlayerState>(emptyPrivate);
  const [deckCode, setDeckCode] = useState("");
  const [deckHtml, setDeckHtml] = useState("");
  const [deckSummary, setDeckSummary] = useState("デッキコード、公式URL、または公式ページHTMLから読み込めます。");
  const [deckLoading, setDeckLoading] = useState(false);
  const [selected, setSelected] = useState<SelectedCard | null>(null);
  const [deckPeekOpen, setDeckPeekOpen] = useState(false);
  const [message, setMessage] = useState("ルームを作成、またはルームIDで参加してください。");

  const firebase = useMemo(() => createFirebaseClient(), []);
  const opponentId: PlayerId = playerId === "A" ? "B" : "A";
  const myPublic = publicRoom?.playerStates?.[playerId] || emptyPublicPlayer();
  const opponentPublic = publicRoom?.playerStates?.[opponentId] || emptyPublicPlayer();

  useEffect(() => {
    if (!connected || !roomId) return;
    const saved = localStorage.getItem(privateStorageKey(roomId, playerId));
    setPrivateState(saved ? JSON.parse(saved) : emptyPrivate());
    setDeckPeekOpen(false);
  }, [connected, playerId, roomId]);

  useEffect(() => {
    if (!connected || !roomId) return;
    localStorage.setItem(privateStorageKey(roomId, playerId), JSON.stringify(privateState));
  }, [connected, privateState, playerId, roomId]);

  useEffect(() => {
    if (!connected || !roomId) return;
    let cancelled = false;

    async function sync() {
      const latest = await loadPublicRoom(roomId, firebase);
      if (!cancelled && latest) setPublicRoom(latest);
    }

    sync();
    const id = window.setInterval(sync, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [connected, firebase, roomId]);

  async function createRoom() {
    const nextRoomId = randomRoomId();
    const nextRoom = emptyRoom(nextRoomId);
    nextRoom.players.A = { name: PLAYER_LABELS.A, seatedAt: Date.now() };
    setRoomId(nextRoomId);
    setJoinRoomId(nextRoomId);
    setPlayerId("A");
    setPublicRoom(nextRoom);
    setPrivateState(emptyPrivate());
    setConnected(true);
    await savePublicRoom(nextRoom, firebase);
    setMessage(`ルーム ${nextRoomId} を作成しました。友人にこのIDを共有してください。`);
  }

  async function joinRoom(requestedPlayer?: PlayerId) {
    const normalized = joinRoomId.trim();
    if (!normalized) {
      setMessage("ルームIDを入力してください。");
      return;
    }
    const existing = (await loadPublicRoom(normalized, firebase)) || emptyRoom(normalized);
    const seat = requestedPlayer || (!existing.players.A ? "A" : !existing.players.B ? "B" : "B");
    existing.players[seat] = existing.players[seat] || { name: PLAYER_LABELS[seat], seatedAt: Date.now() };
    existing.updatedAt = Date.now();
    setRoomId(normalized);
    setPlayerId(seat);
    setPublicRoom(existing);
    setPrivateState(loadPrivate(normalized, seat));
    setConnected(true);
    await savePublicRoom(existing, firebase);
    setMessage(`${PLAYER_LABELS[seat]} としてルームに参加しました。`);
  }

  async function publish(nextRoom: PublicRoomState) {
    const stamped = { ...nextRoom, updatedAt: Date.now() };
    setPublicRoom(stamped);
    await savePublicRoom(stamped, firebase);
  }

  async function updateMyPublic(updater: (current: PublicPlayerState) => PublicPlayerState) {
    if (!publicRoom) return;
    await publish({
      ...publicRoom,
      playerStates: {
        ...publicRoom.playerStates,
        [playerId]: updater(publicRoom.playerStates[playerId]),
      },
    });
  }

  async function updatePrivate(nextPrivate: PrivatePlayerState, roomOverride = publicRoom) {
    setPrivateState(nextPrivate);
    if (!roomOverride) return;
    await publish({
      ...roomOverride,
      playerStates: {
        ...roomOverride.playerStates,
        [playerId]: syncCounts(roomOverride.playerStates[playerId], nextPrivate),
      },
    });
  }

  async function loadDeckFromCode() {
    const code = normalizeDeckCode(deckCode);
    if (!code) {
      setDeckSummary("デッキコード、または公式デッキURLを入力してください。");
      return;
    }

    setDeckLoading(true);
    setDeckSummary("公式ページを読み込み中です。CORSで失敗した場合はHTML貼り付けを使ってください。");
    for (const url of deckUrlsFromCode(code)) {
      try {
        const response = await fetch(url, { mode: "cors" });
        if (!response.ok) continue;
        const text = await response.text();
        const parsed = parseDeckHtml(text);
        if (parsed.length) {
          setDeckHtml(text);
          await applyDeckCards(parsed, "デッキコード");
          setDeckLoading(false);
          return;
        }
      } catch {
        // Static hosting fallback: official pages may block browser fetch by CORS.
      }
    }

    setDeckLoading(false);
    setDeckSummary("直接読み込みできませんでした。公式デッキ表示ページを開き、ページHTMLを貼り付けてください。");
  }

  function loadDeckFromHtml() {
    const parsed = parseDeckHtml(deckHtml);
    if (!parsed.length) {
      setDeckSummary("カード情報を見つけられませんでした。公式デッキ表示ページ全体のHTMLを貼り付けてください。");
      return;
    }
    applyDeckCards(parsed, "HTML");
  }

  async function applyDeckCards(parsed: Card[], source: string) {
    const total = parsed.reduce((sum, card) => sum + card.count, 0);
    const expanded = shuffleCards(expandDeck(parsed));
    await updatePrivate({ deck: expanded, hand: [], prizes: [] });
    setDeckPeekOpen(false);
    setDeckSummary(`${source}から${total}枚のデッキを読み込みました。非公開情報はこのブラウザだけに保存されます。`);
  }

  function draw(count = 1) {
    const drawn = privateState.deck.slice(0, count);
    updatePrivate({
      ...privateState,
      deck: privateState.deck.slice(count),
      hand: [...privateState.hand, ...drawn],
    });
  }

  function setupOpeningHand() {
    const source = shuffleCards([...privateState.deck, ...privateState.hand]);
    updatePrivate({
      ...privateState,
      deck: source.slice(7),
      hand: source.slice(0, 7),
    });
  }

  function setupPrizes() {
    updatePrivate({
      ...privateState,
      deck: privateState.deck.slice(6),
      prizes: [...privateState.prizes, ...privateState.deck.slice(0, 6)],
    });
  }

  function shuffleDeck() {
    updatePrivate({ ...privateState, deck: shuffleCards(privateState.deck) });
    setDeckPeekOpen(false);
  }

  function passTurn() {
    if (!publicRoom) return;
    publish({ ...publicRoom, turnPlayer: opponentId });
  }

  function movePrivateCard(card: CardInstance, from: PrivateZone, to: AnyZone) {
    const removed = {
      ...privateState,
      [from]: privateState[from].filter((item) => item.uid !== card.uid),
    };
    if (isPrivateZone(to)) {
      updatePrivate({ ...removed, [to]: [card, ...removed[to]] });
      return;
    }
    updatePrivate(removed);
    updateMyPublic((current) => ({
      ...current,
      [to]: [toPublicCard(card), ...current[to]],
    }));
  }

  function movePublicCard(card: PublicCard, from: PublicZone, to: AnyZone) {
    updateMyPublic((current) => ({
      ...current,
      [from]: current[from].filter((item) => item.uid !== card.uid),
      ...(isPrivateZone(to) ? {} : { [to]: [card, ...current[to]] }),
    }));
    if (isPrivateZone(to)) {
      updatePrivate({ ...privateState, [to]: [card as CardInstance, ...privateState[to]] });
    }
  }

  function moveSelected(to: AnyZone) {
    if (!selected || selected.owner !== playerId) return;
    if (selected.privateCard) {
      movePrivateCard(selected.card as CardInstance, selected.zone as PrivateZone, to);
    } else {
      movePublicCard(selected.card as PublicCard, selected.zone as PublicZone, to);
    }
    setSelected(null);
  }

  function toggleStatus(key: keyof PublicPlayerState["status"]) {
    updateMyPublic((current) => ({
      ...current,
      status: {
        ...current.status,
        [key]: !current.status[key],
      },
    }));
  }

  function resetLocalPrivate() {
    updatePrivate(emptyPrivate());
    setDeckPeekOpen(false);
  }

  return (
    <div className="online-app">
      <header className="online-topbar">
        <div>
          <p className="eyebrow">Pokewan Online Battle</p>
          <h1>二人対戦</h1>
        </div>
        <a href="./" className="home-link">一人回しへ</a>
      </header>

      <section className="room-panel">
        <div className="room-actions">
          <button onClick={createRoom}>
            <Sparkles />
            ルーム作成
          </button>
          <label>
            <span>ルームID</span>
            <input value={joinRoomId} onChange={(event) => setJoinRoomId(event.target.value)} placeholder="例: AB12CD34" />
          </label>
          <button onClick={() => joinRoom()}>
            <LogIn />
            参加
          </button>
          <button onClick={() => joinRoom("A")}>Aで入る</button>
          <button onClick={() => joinRoom("B")}>Bで入る</button>
        </div>
        <p className="message">
          {message} {firebase.enabled ? "Firebase同期: 有効" : "Firebase同期: 未設定。設定するまで同一ブラウザ内の確認用です。"}
        </p>
        {connected && (
          <div className="room-id">
            <span>Room: {roomId}</span>
            <span>{PLAYER_LABELS[playerId]}</span>
            <button onClick={() => navigator.clipboard?.writeText(roomId)}>
              <Copy />
              コピー
            </button>
          </div>
        )}
      </section>

      {connected && publicRoom && (
        <>
          <section className="battle-controls">
            <span className={publicRoom.turnPlayer === playerId ? "turn mine" : "turn"}>
              現在の番: {PLAYER_LABELS[publicRoom.turnPlayer]}
            </span>
            <button onClick={passTurn}>
              <RefreshCw />
              番を渡す
            </button>
          </section>

          <section className="deck-loader">
            <div>
              <h2>デッキ読み込み</h2>
              <p>手札・山札・サイドはFirebaseへ送信しません。</p>
            </div>
            <div className="deck-load-fields">
              <div className="deck-code-row">
                <input
                  value={deckCode}
                  onChange={(event) => setDeckCode(event.target.value)}
                  placeholder="デッキコード、または公式URL"
                />
                <button onClick={loadDeckFromCode} disabled={deckLoading}>
                  <ArrowDownToLine />
                  コードから読み込み
                </button>
              </div>
              <textarea value={deckHtml} onChange={(event) => setDeckHtml(event.target.value)} placeholder="直接読み込みできない場合は、公式デッキ表示ページのHTMLを貼り付け" />
            </div>
            <button onClick={loadDeckFromHtml} disabled={deckLoading}>
              <ArrowDownToLine />
              HTMLから読み込み
            </button>
            <p className="message">{deckSummary}</p>
          </section>

          <section className="quick-controls">
            <button onClick={() => draw(1)} disabled={!privateState.deck.length}>
              <ArrowDownToLine />
              1枚ドロー
            </button>
            <button onClick={setupOpeningHand} disabled={privateState.deck.length + privateState.hand.length < 7}>
              <Hand />
              初手7枚
            </button>
            <button onClick={setupPrizes} disabled={privateState.deck.length < 6}>
              <Sparkles />
              サイド6枚
            </button>
            <button onClick={shuffleDeck} disabled={!privateState.deck.length}>
              <Shuffle />
              山札シャッフル
            </button>
            <button onClick={() => setDeckPeekOpen((open) => !open)} disabled={!privateState.deck.length}>
              <Eye />
              {deckPeekOpen ? "山札確認を閉じる" : "自分だけ山札確認"}
            </button>
            <button onClick={resetLocalPrivate}>
              <RotateCcw />
              自分の非公開情報リセット
            </button>
          </section>

          <div className="players-grid fixed-seats">
            {(["B", "A"] as PlayerId[]).map((seat) => {
              const isMine = seat === playerId;
              return (
                <PlayerBoard
                  key={seat}
                  title={`${PLAYER_LABELS[seat]}${isMine ? "（自分）" : "（相手）"}`}
                  publicState={isMine ? myPublic : publicRoom.playerStates[seat]}
                  privateState={isMine ? privateState : null}
                  playerId={seat}
                  viewerId={playerId}
                  deckPeekOpen={isMine ? deckPeekOpen : false}
                  onDraw={isMine ? () => draw(1) : undefined}
                  onSelect={setSelected}
                  onToggleStatus={isMine ? toggleStatus : undefined}
                />
              );
            })}
          </div>
        </>
      )}

      {selected && (
        <MoveDialog
          selected={selected}
          canMove={selected.owner === playerId}
          onClose={() => setSelected(null)}
          onMove={moveSelected}
        />
      )}
    </div>
  );
}

function PlayerBoard({
  title,
  publicState,
  privateState,
  playerId,
  viewerId,
  deckPeekOpen,
  onDraw,
  onSelect,
  onToggleStatus,
}: {
  title: string;
  publicState: PublicPlayerState;
  privateState: PrivatePlayerState | null;
  playerId: PlayerId;
  viewerId: PlayerId;
  deckPeekOpen: boolean;
  onDraw?: () => void;
  onSelect: (selected: SelectedCard) => void;
  onToggleStatus?: (key: keyof PublicPlayerState["status"]) => void;
}) {
  const isMine = playerId === viewerId;

  return (
    <section className={`player-board ${isMine ? "mine" : "opponent"}`}>
      <header>
        <h2>{title}</h2>
        <div className="counts">
          <span>山札 {publicState.deckCount}</span>
          <span>手札 {publicState.handCount}</span>
          <span>サイド {publicState.prizeCount}</span>
        </div>
      </header>

      <div className="status-row">
        {Object.entries({
          poison: "どく",
          burn: "やけど",
          sleep: "ねむり",
          paralysis: "マヒ",
          confusion: "こんらん",
        } satisfies Record<keyof PublicPlayerState["status"], string>).map(([key, label]) => (
          <button
            key={key}
            className={publicState.status[key as keyof PublicPlayerState["status"]] ? "status active" : "status"}
            disabled={!isMine}
            onClick={() => onToggleStatus?.(key as keyof PublicPlayerState["status"])}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="zone-layout">
        <HiddenZone
          title="山札"
          count={publicState.deckCount}
          cards={isMine && deckPeekOpen && privateState ? privateState.deck : null}
          playerId={playerId}
          zone="deck"
          action={isMine && publicState.deckCount > 0 ? { label: "1枚ドロー", onClick: onDraw } : undefined}
          onSelect={onSelect}
        />
        <HiddenZone
          title="手札"
          count={publicState.handCount}
          cards={isMine && privateState ? privateState.hand : null}
          playerId={playerId}
          zone="hand"
          onSelect={onSelect}
        />
        <HiddenZone
          title="サイド"
          count={publicState.prizeCount}
          cards={null}
          playerId={playerId}
          zone="prizes"
          onSelect={onSelect}
        />
        <PublicZoneView title="バトル場" zone="active" cards={publicState.active} owner={playerId} onSelect={onSelect} />
        <PublicZoneView title="ベンチ" zone="bench" cards={publicState.bench} owner={playerId} onSelect={onSelect} />
        <PublicZoneView title="スタジアム" zone="stadium" cards={publicState.stadium} owner={playerId} onSelect={onSelect} />
        <PublicZoneView title="トラッシュ" zone="discard" cards={publicState.discard} owner={playerId} onSelect={onSelect} />
        <PublicZoneView title="ロスト" zone="lostZone" cards={publicState.lostZone} owner={playerId} onSelect={onSelect} />
      </div>
    </section>
  );
}

function HiddenZone({
  title,
  count,
  cards,
  playerId,
  zone,
  action,
  onSelect,
}: {
  title: string;
  count: number;
  cards: CardInstance[] | null;
  playerId: PlayerId;
  zone: PrivateZone;
  action?: { label: string; onClick?: () => void };
  onSelect: (selected: SelectedCard) => void;
}) {
  return (
    <article className="zone hidden-zone">
      <header>
        <h3>
          <Layers />
          {title}
        </h3>
        <div className="zone-tools">
          {action?.onClick && (
            <button className="mini-action" onClick={action.onClick}>
              {action.label}
            </button>
          )}
          <span>{count}</span>
        </div>
      </header>
      <div className="card-grid">
        {cards
          ? cards.map((card) => (
              <CardButton
                key={card.uid}
                card={card}
                faceDown={false}
                onClick={() => onSelect({ card, zone, owner: playerId, privateCard: true })}
              />
            ))
          : Array.from({ length: Math.min(count, 12) }, (_, index) => (
              <button className="card-tile is-face-down" key={`${title}-${index}`} aria-label={`${title}の裏向きカード`}>
                <img src={CARD_BACK_URL} alt="裏向きカード" />
                <span>裏向き</span>
              </button>
            ))}
      </div>
    </article>
  );
}

function PublicZoneView({
  title,
  zone,
  cards,
  owner,
  onSelect,
}: {
  title: string;
  zone: PublicZone;
  cards: PublicCard[];
  owner: PlayerId;
  onSelect: (selected: SelectedCard) => void;
}) {
  return (
    <article className={`zone public-zone zone-${zone}`}>
      <header>
        <h3>
          {zone === "active" ? <Swords /> : zone === "discard" ? <Trash2 /> : <Layers />}
          {title}
        </h3>
        <span>{cards.length}</span>
      </header>
      <div className="card-grid">
        {cards.map((card) => (
          <CardButton
            key={card.uid}
            card={card}
            faceDown={false}
            onClick={() => onSelect({ card, zone, owner, privateCard: false })}
          />
        ))}
      </div>
    </article>
  );
}

function CardButton({ card, faceDown, onClick }: { card: PublicCard | CardInstance; faceDown: boolean; onClick: () => void }) {
  return (
    <button className={`card-tile ${faceDown ? "is-face-down" : ""}`} onClick={onClick}>
      <img src={faceDown ? CARD_BACK_URL : card.imageUrl} alt={faceDown ? "裏向きカード" : card.name} loading="lazy" />
      <span>{faceDown ? "裏向き" : card.name}</span>
    </button>
  );
}

function MoveDialog({
  selected,
  canMove,
  onClose,
  onMove,
}: {
  selected: SelectedCard;
  canMove: boolean;
  onClose: () => void;
  onMove: (zone: AnyZone) => void;
}) {
  const isPrivate = selected.privateCard;
  const imageUrl = isPrivate ? (selected.card as CardInstance).imageUrl : (selected.card as PublicCard).imageUrl;
  const name = selected.card.name;
  const destinations: AnyZone[] = ["hand", "deck", "prizes", "active", "bench", "discard", "lostZone", "stadium"];

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <dialog className="move-modal" open onClick={(event) => event.stopPropagation()}>
        <img src={imageUrl} alt={name} />
        <div className="modal-actions">
          <p>{isPrivate ? PRIVATE_ZONE_LABELS[selected.zone as PrivateZone] : PUBLIC_ZONE_LABELS[selected.zone as PublicZone]}</p>
          <h3>{name}</h3>
          {canMove ? (
            <div className="move-grid">
              {destinations.map((zone) => (
                <button key={zone} disabled={zone === selected.zone} onClick={() => onMove(zone)}>
                  {zoneLabel(zone)}へ
                </button>
              ))}
            </div>
          ) : (
            <p className="message">相手のカードは移動できません。</p>
          )}
          <button onClick={onClose}>閉じる</button>
        </div>
      </dialog>
    </div>
  );
}

function zoneLabel(zone: AnyZone) {
  return isPrivateZone(zone) ? PRIVATE_ZONE_LABELS[zone] : PUBLIC_ZONE_LABELS[zone];
}

function isPrivateZone(zone: AnyZone): zone is PrivateZone {
  return zone === "deck" || zone === "hand" || zone === "prizes";
}

function syncCounts(publicState: PublicPlayerState, privateState: PrivatePlayerState): PublicPlayerState {
  return {
    ...publicState,
    deckCount: privateState.deck.length,
    handCount: privateState.hand.length,
    prizeCount: privateState.prizes.length,
  };
}

function toPublicCard(card: CardInstance): PublicCard {
  return {
    uid: card.uid,
    id: card.id,
    name: card.name,
    imageUrl: card.imageUrl,
    category: card.category,
  };
}

function loadPrivate(roomId: string, playerId: PlayerId) {
  const saved = localStorage.getItem(privateStorageKey(roomId, playerId));
  return saved ? (JSON.parse(saved) as PrivatePlayerState) : emptyPrivate();
}

function privateStorageKey(roomId: string, playerId: PlayerId) {
  return `${PRIVATE_STORAGE_PREFIX}:${roomId}:${playerId}`;
}

function randomRoomId() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (byte) => byte.toString(36).padStart(2, "0")).join("").slice(0, 10).toUpperCase();
}

function shuffleCards<T>(items: T[]) {
  const copied = [...items];
  for (let index = copied.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1));
    [copied[index], copied[target]] = [copied[target], copied[index]];
  }
  return copied;
}

function createFirebaseClient() {
  const databaseURL = window.POKEWAN_FIREBASE_CONFIG?.databaseURL?.replace(/\/$/, "");
  return {
    enabled: Boolean(databaseURL),
    databaseURL,
  };
}

async function loadPublicRoom(roomId: string, firebase: ReturnType<typeof createFirebaseClient>) {
  if (!firebase.enabled || !firebase.databaseURL) {
    const saved = localStorage.getItem(`${LOCAL_PUBLIC_PREFIX}:${roomId}`);
    return saved ? normalizePublicRoom(JSON.parse(saved) as Partial<PublicRoomState>, roomId) : null;
  }
  const response = await fetch(`${firebase.databaseURL}/rooms/${encodeURIComponent(roomId)}/publicState.json`);
  if (!response.ok) return null;
  return normalizePublicRoom((await response.json()) as Partial<PublicRoomState> | null, roomId);
}

async function savePublicRoom(room: PublicRoomState, firebase: ReturnType<typeof createFirebaseClient>) {
  if (!firebase.enabled || !firebase.databaseURL) {
    localStorage.setItem(`${LOCAL_PUBLIC_PREFIX}:${room.roomId}`, JSON.stringify(room));
    return;
  }
  await fetch(`${firebase.databaseURL}/rooms/${encodeURIComponent(room.roomId)}/publicState.json`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(room),
  });
}

createRoot(document.getElementById("online-root")!).render(
  <StrictMode>
    <OnlineBattleApp />
  </StrictMode>,
);
