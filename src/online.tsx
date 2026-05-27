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
type CoinResult = "heads" | "tails";
type ListViewer = { playerId: PlayerId; zone: "discard" | "lostZone" } | null;

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
  damageCounters: Record<string, number>;
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
  coinFlip?: {
    result: CoinResult;
    flippedBy: PlayerId;
    flippedAt: number;
  };
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
const COIN_IMAGE_URL =
  "https://www.pokemoncenter-online.com/a/img/item/4521329404073/L/e9edcb343f3d56f0fc68321cc06fd7e29dd9b313905ed1a92a1f7de42f53f478.jpg";
const PRIVATE_STORAGE_PREFIX = "pokewan-online-private";
const LOCAL_PUBLIC_PREFIX = "pokewan-online-public";
const POLL_MS = 1400;
const PRIVATE_ZONES: PrivateZone[] = ["deck", "hand", "prizes"];
const PUBLIC_ZONES: PublicZone[] = ["active", "bench", "discard", "lostZone", "stadium"];

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

const STATUS_LABELS: Record<keyof PublicPlayerState["status"], string> = {
  poison: "どく",
  burn: "やけど",
  sleep: "ねむり",
  paralysis: "マヒ",
  confusion: "こんらん",
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
  damageCounters: {},
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
    damageCounters: value?.damageCounters || {},
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
    coinFlip: value.coinFlip,
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
  const [isMoving, setIsMoving] = useState(false);
  const [deckPeekOpen, setDeckPeekOpen] = useState(false);
  const [listViewer, setListViewer] = useState<ListViewer>(null);
  const [message, setMessage] = useState("ルームを作成、またはルームIDで参加してください。");

  const firebase = useMemo(() => createFirebaseClient(), []);
  const opponentId: PlayerId = playerId === "A" ? "B" : "A";
  const myPublic = publicRoom?.playerStates[playerId] || emptyPublicPlayer();

  useEffect(() => {
    if (!connected || !roomId) return;
    setPrivateState(loadPrivate(roomId, playerId));
    setDeckPeekOpen(false);
    setListViewer(null);
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
        // 公式ページはブラウザからの直接取得がCORSで止まることがあります。
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

  function drawPrize() {
    const picked = privateState.prizes.slice(0, 1);
    if (!picked.length) return;
    updatePrivate({
      ...privateState,
      prizes: privateState.prizes.slice(1),
      hand: [...privateState.hand, ...picked],
    });
  }

  function returnHandToDeck() {
    if (!privateState.hand.length) return;
    updatePrivate({
      ...privateState,
      deck: shuffleCards([...privateState.deck, ...privateState.hand]),
      hand: [],
    });
    setDeckPeekOpen(false);
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

  function flipCoin() {
    if (!publicRoom) return;
    publish({
      ...publicRoom,
      coinFlip: {
        result: Math.random() < 0.5 ? "heads" : "tails",
        flippedBy: playerId,
        flippedAt: Date.now(),
      },
    });
  }

  async function moveSelected(to: AnyZone) {
    if (!selected || selected.owner !== playerId || isMoving) return;
    if (!publicRoom) return;

    setIsMoving(true);
    try {
      const next = atomicMoveSelectedCard({
        selected,
        to,
        privateState,
        publicRoom,
        playerId,
      });

      if (!next) {
        setMessage("カードの現在位置が変わっています。再選択してください。");
        setSelected(null);
        return;
      }

      setPrivateState(next.privateState);
      await publish(next.publicRoom);
      setSelected(null);
    } finally {
      setIsMoving(false);
    }
  }

  function adjustSelectedDamage(delta: number) {
    if (!selected || selected.owner !== playerId || selected.privateCard) return;
    const card = selected.card as PublicCard;
    updateMyPublic((current) => {
      const currentDamage = current.damageCounters[card.uid] || 0;
      const nextValue = Math.max(0, currentDamage + delta);
      const damageCounters = { ...current.damageCounters };
      if (nextValue === 0) {
        delete damageCounters[card.uid];
      } else {
        damageCounters[card.uid] = nextValue;
      }
      return { ...current, damageCounters };
    });
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

  const listCards = listViewer && publicRoom ? publicRoom.playerStates[listViewer.playerId][listViewer.zone] : [];

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
          {message} {firebase.enabled ? "Firebase同期: 有効" : "Firebase同期: 未設定。設定するまでは同じブラウザ内の確認用です。"}
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
            <button className="coin-button" onClick={flipCoin}>
              <img src={COIN_IMAGE_URL} alt="コイントス" />
              コイントス
            </button>
            {publicRoom.coinFlip && (
              <span className="coin-result">
                {PLAYER_LABELS[publicRoom.coinFlip.flippedBy]}: {publicRoom.coinFlip.result === "heads" ? "オモテ" : "ウラ"}
              </span>
            )}
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
              <textarea
                value={deckHtml}
                onChange={(event) => setDeckHtml(event.target.value)}
                placeholder="直接読み込みできない場合は、公式デッキ表示ページのHTMLを貼り付け"
              />
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
            <button onClick={returnHandToDeck} disabled={!privateState.hand.length}>
              <Hand />
              手札を山札へ
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
            <button onClick={() => setDeckPeekOpen(true)} disabled={!privateState.deck.length}>
              <Eye />
              自分だけ山札確認
            </button>
            <button onClick={resetLocalPrivate}>
              <RotateCcw />
              自分の非公開情報リセット
            </button>
          </section>

          <div className="players-grid fixed-seats">
            {(["A", "B"] as PlayerId[]).map((seat) => {
              const isMine = seat === playerId;
              return (
                <PlayerBoard
                  key={seat}
                  title={`${PLAYER_LABELS[seat]}${isMine ? "（自分）" : "（相手）"}`}
                  publicState={isMine ? myPublic : publicRoom.playerStates[seat]}
                  privateState={isMine ? privateState : null}
                  playerId={seat}
                  viewerId={playerId}
                  onDeckDraw={isMine ? () => draw(1) : undefined}
                  onPrizeDraw={isMine ? drawPrize : undefined}
                  onSelect={setSelected}
                  onOpenList={setListViewer}
                  onToggleStatus={isMine ? toggleStatus : undefined}
                />
              );
            })}
          </div>
        </>
      )}

      {deckPeekOpen && (
        <CardListModal
          title={`山札 (${privateState.deck.length}枚)`}
          cards={privateState.deck}
          onClose={() => setDeckPeekOpen(false)}
          onSelect={(card) => {
            setDeckPeekOpen(false);
            setSelected({ card, zone: "deck", owner: playerId, privateCard: true });
          }}
        />
      )}

      {listViewer && publicRoom && (
        <CardListModal
          title={`${PLAYER_LABELS[listViewer.playerId]}の${PUBLIC_ZONE_LABELS[listViewer.zone]} (${listCards.length}枚)`}
          cards={listCards}
          emptyText={`${PUBLIC_ZONE_LABELS[listViewer.zone]}にカードはありません。`}
          onClose={() => setListViewer(null)}
          onSelect={(card) => {
            const viewer = listViewer;
            setListViewer(null);
            setSelected({ card, zone: viewer.zone, owner: viewer.playerId, privateCard: false });
          }}
        />
      )}

      {selected && (
        <MoveDialog
          selected={selected}
          canMove={selected.owner === playerId}
          isMoving={isMoving}
          damage={selected.privateCard ? 0 : myPublic.damageCounters[(selected.card as PublicCard).uid] || 0}
          onAdjustDamage={adjustSelectedDamage}
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
  onDeckDraw,
  onPrizeDraw,
  onSelect,
  onOpenList,
  onToggleStatus,
}: {
  title: string;
  publicState: PublicPlayerState;
  privateState: PrivatePlayerState | null;
  playerId: PlayerId;
  viewerId: PlayerId;
  onDeckDraw?: () => void;
  onPrizeDraw?: () => void;
  onSelect: (selected: SelectedCard) => void;
  onOpenList: (viewer: Exclude<ListViewer, null>) => void;
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
        {Object.entries(STATUS_LABELS).map(([key, label]) => (
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

      <div className="zone-layout board-layout">
        <HiddenZone
          title="サイド"
          count={publicState.prizeCount}
          cards={null}
          playerId={playerId}
          zone="prizes"
          className="zone-prizes"
          action={isMine && publicState.prizeCount > 0 ? { label: "1枚ドロー", onClick: onPrizeDraw } : undefined}
          onSelect={onSelect}
        />
        <PublicZoneView title="バトル場" zone="active" cards={publicState.active} owner={playerId} damageCounters={publicState.damageCounters} onSelect={onSelect} />
        <PublicZoneView title="スタジアム" zone="stadium" cards={publicState.stadium} owner={playerId} damageCounters={publicState.damageCounters} onSelect={onSelect} />
        <HiddenZone
          title="山札"
          count={publicState.deckCount}
          cards={null}
          playerId={playerId}
          zone="deck"
          className="zone-deck"
          action={isMine && publicState.deckCount > 0 ? { label: "1枚ドロー", onClick: onDeckDraw } : undefined}
          onSelect={onSelect}
        />
        <PublicZoneView title="ベンチ" zone="bench" cards={publicState.bench} owner={playerId} damageCounters={publicState.damageCounters} onSelect={onSelect} />
        <PublicZoneView
          title="トラッシュ"
          zone="discard"
          cards={publicState.discard}
          owner={playerId}
          damageCounters={publicState.damageCounters}
          compactLatest
          onOpenList={() => onOpenList({ playerId, zone: "discard" })}
          onSelect={onSelect}
        />
        <HiddenZone
          title="手札"
          count={publicState.handCount}
          cards={isMine && privateState ? privateState.hand : null}
          playerId={playerId}
          zone="hand"
          className="zone-hand"
          onSelect={onSelect}
        />
        <PublicZoneView
          title="ロスト"
          zone="lostZone"
          cards={publicState.lostZone}
          owner={playerId}
          damageCounters={publicState.damageCounters}
          compactLatest
          onOpenList={() => onOpenList({ playerId, zone: "lostZone" })}
          onSelect={onSelect}
        />
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
  className,
  onSelect,
}: {
  title: string;
  count: number;
  cards: CardInstance[] | null;
  playerId: PlayerId;
  zone: PrivateZone;
  action?: { label: string; onClick?: () => void };
  className?: string;
  onSelect: (selected: SelectedCard) => void;
}) {
  return (
    <article className={`zone hidden-zone ${className || ""}`}>
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
      {cards ? (
        <div className="card-grid">
          {cards.map((card) => (
            <CardButton
              key={card.uid}
              card={card}
              faceDown={false}
              onClick={() => onSelect({ card, zone, owner: playerId, privateCard: true })}
            />
          ))}
        </div>
      ) : zone === "deck" ? (
        <DeckStack count={count} />
      ) : (
        <div className={zone === "prizes" ? "card-grid prize-grid" : "card-grid"}>
          {Array.from({ length: Math.min(count, zone === "prizes" ? 6 : 12) }, (_, index) => (
            <button className="card-tile is-face-down" key={`${title}-${index}`} aria-label={`${title}の裏向きカード`}>
              <img src={CARD_BACK_URL} alt="裏向きカード" />
              <span>裏向き</span>
            </button>
          ))}
        </div>
      )}
    </article>
  );
}

function DeckStack({ count }: { count: number }) {
  return (
    <div className="deck-stack-wrap" aria-label={`山札 ${count}枚`}>
      {count > 0 ? (
        <div className="deck-stack" aria-hidden="true">
          <img className="deck-stack-card" src={CARD_BACK_URL} alt="" />
          <img className="deck-stack-card" src={CARD_BACK_URL} alt="" />
          <img className="deck-stack-card" src={CARD_BACK_URL} alt="" />
        </div>
      ) : (
        <p className="empty-list">山札なし</p>
      )}
      <p className="deck-stack-count">{count}枚</p>
    </div>
  );
}

function PublicZoneView({
  title,
  zone,
  cards,
  owner,
  damageCounters,
  compactLatest = false,
  onOpenList,
  onSelect,
}: {
  title: string;
  zone: PublicZone;
  cards: PublicCard[];
  owner: PlayerId;
  damageCounters: Record<string, number>;
  compactLatest?: boolean;
  onOpenList?: () => void;
  onSelect: (selected: SelectedCard) => void;
}) {
  const visibleCards = compactLatest ? cards.slice(0, 1) : cards;
  return (
    <article className={`zone public-zone zone-${zone}`}>
      <header>
        <h3>
          {zone === "active" ? <Swords /> : zone === "discard" ? <Trash2 /> : <Layers />}
          {title}
        </h3>
        <div className="zone-tools">
          {onOpenList && (
            <button className="mini-action" onClick={onOpenList}>
              {title}を確認
            </button>
          )}
          <span>{cards.length}</span>
        </div>
      </header>
      <div className="card-grid">
        {visibleCards.map((card) => (
          <CardButton
            key={card.uid}
            card={card}
            faceDown={false}
            damage={damageCounters[card.uid] || 0}
            onClick={() => onSelect({ card, zone, owner, privateCard: false })}
          />
        ))}
        {compactLatest && cards.length === 0 && <p className="empty-list">なし</p>}
      </div>
    </article>
  );
}

function CardButton({
  card,
  faceDown,
  damage = 0,
  onClick,
}: {
  card: PublicCard | CardInstance;
  faceDown: boolean;
  damage?: number;
  onClick: () => void;
}) {
  return (
    <button className={`card-tile ${faceDown ? "is-face-down" : ""}`} onClick={onClick}>
      <span className="card-image-wrap">
        <img src={faceDown ? CARD_BACK_URL : card.imageUrl} alt={faceDown ? "裏向きカード" : card.name} loading="lazy" />
        {damage > 0 && <strong className="damage-badge">{damage}</strong>}
      </span>
      <span>{faceDown ? "裏向き" : card.name}</span>
    </button>
  );
}

function CardListModal({
  title,
  cards,
  emptyText = "カードはありません。",
  onClose,
  onSelect,
}: {
  title: string;
  cards: Array<CardInstance | PublicCard>;
  emptyText?: string;
  onClose: () => void;
  onSelect: (card: CardInstance | PublicCard) => void;
}) {
  return (
    <div className="modal-backdrop deck-peek-backdrop" onClick={onClose} role="presentation">
      <dialog className="deck-peek-modal" open onClick={(event) => event.stopPropagation()}>
        <header>
          <h2>{title}</h2>
          <button className="close-button" onClick={onClose} aria-label="閉じる">×</button>
        </header>
        {cards.length ? (
          <div className="deck-peek-grid">
            {cards.map((card) => (
              <CardButton key={card.uid} card={card} faceDown={false} onClick={() => onSelect(card)} />
            ))}
          </div>
        ) : (
          <p className="empty-list modal-empty">{emptyText}</p>
        )}
      </dialog>
    </div>
  );
}

function MoveDialog({
  selected,
  canMove,
  isMoving,
  damage,
  onAdjustDamage,
  onClose,
  onMove,
}: {
  selected: SelectedCard;
  canMove: boolean;
  isMoving: boolean;
  damage: number;
  onAdjustDamage: (delta: number) => void;
  onClose: () => void;
  onMove: (zone: AnyZone) => void;
}) {
  const imageUrl = selected.card.imageUrl;
  const name = selected.card.name;
  const destinations: AnyZone[] = ["hand", "deck", "prizes", "active", "bench", "discard", "lostZone", "stadium"];
  const canEditDamage = canMove && !selected.privateCard && (selected.zone === "active" || selected.zone === "bench");

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <dialog className="move-modal" open onClick={(event) => event.stopPropagation()}>
        <img src={imageUrl} alt={name} />
        <div className="modal-actions">
          <p>{zoneLabel(selected.zone)}</p>
          <h3>{name}</h3>
          {canEditDamage && (
            <div className="damage-controls">
              <strong>ダメカン: {damage}</strong>
              <button onClick={() => onAdjustDamage(-10)} disabled={isMoving}>-10</button>
              <button onClick={() => onAdjustDamage(10)} disabled={isMoving}>+10</button>
              <button onClick={() => onAdjustDamage(50)} disabled={isMoving}>+50</button>
              <button onClick={() => onAdjustDamage(-damage)} disabled={isMoving}>0</button>
            </div>
          )}
          {canMove ? (
            <div className="move-grid">
              {destinations.map((zone) => (
                <button key={zone} disabled={isMoving || zone === selected.zone} onClick={() => onMove(zone)}>
                  {zoneLabel(zone)}へ
                </button>
              ))}
            </div>
          ) : (
            <p className="message">相手のカードは移動できません。</p>
          )}
          <button onClick={onClose} disabled={isMoving}>閉じる</button>
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

function publicToPrivate(card: PublicCard): CardInstance {
  return {
    ...card,
    originalCount: 1,
  };
}

function removeFromPrivateZones(state: PrivatePlayerState, uid: string): PrivatePlayerState {
  return PRIVATE_ZONES.reduce(
    (next, zone) => ({
      ...next,
      [zone]: next[zone].filter((card) => card.uid !== uid),
    }),
    { ...state },
  );
}

function removeFromPublicZones(state: PublicPlayerState, uid: string): PublicPlayerState {
  return PUBLIC_ZONES.reduce(
    (next, zone) => ({
      ...next,
      [zone]: next[zone].filter((card) => card.uid !== uid),
    }),
    { ...state },
  );
}

function addToPrivateZone(state: PrivatePlayerState, zone: PrivateZone, card: CardInstance): PrivatePlayerState {
  const deduped = removeFromPrivateZones(state, card.uid);
  return {
    ...deduped,
    [zone]: [card, ...deduped[zone]],
  };
}

function addToPublicZone(state: PublicPlayerState, zone: PublicZone, card: PublicCard): PublicPlayerState {
  const deduped = removeFromPublicZones(state, card.uid);
  return {
    ...deduped,
    [zone]: [card, ...deduped[zone]],
  };
}

function atomicMoveSelectedCard({
  selected,
  to,
  privateState,
  publicRoom,
  playerId,
}: {
  selected: SelectedCard;
  to: AnyZone;
  privateState: PrivatePlayerState;
  publicRoom: PublicRoomState;
  playerId: PlayerId;
}): { privateState: PrivatePlayerState; publicRoom: PublicRoomState } | null {
  const uid = selected.card.uid;
  const from = selected.zone;
  const currentPublic = publicRoom.playerStates[playerId];
  const existsInSource = selected.privateCard
    ? isPrivateZone(from) && privateState[from].some((card) => card.uid === uid)
    : !isPrivateZone(from) && currentPublic[from].some((card) => card.uid === uid);

  if (!existsInSource) return null;

  let nextPrivate = removeFromPrivateZones(privateState, uid);
  let nextPublic = removeFromPublicZones(currentPublic, uid);
  const damageCounters = { ...nextPublic.damageCounters };
  if (isPrivateZone(to) || to === "discard" || to === "lostZone" || to === "stadium") {
    delete damageCounters[uid];
  }
  nextPublic = { ...nextPublic, damageCounters };

  if (isPrivateZone(to)) {
    const privateCard = selected.privateCard ? (selected.card as CardInstance) : publicToPrivate(selected.card as PublicCard);
    nextPrivate = addToPrivateZone(nextPrivate, to, privateCard);
  } else {
    const publicCard = selected.privateCard ? toPublicCard(selected.card as CardInstance) : (selected.card as PublicCard);
    nextPublic = addToPublicZone(nextPublic, to, publicCard);
  }

  nextPublic = syncCounts(nextPublic, nextPrivate);

  return {
    privateState: nextPrivate,
    publicRoom: {
      ...publicRoom,
      playerStates: {
        ...publicRoom.playerStates,
        [playerId]: nextPublic,
      },
    },
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
