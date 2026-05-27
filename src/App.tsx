import { useEffect, useMemo, useState } from "react";
import {
  ArrowDownToLine,
  Eye,
  Hand,
  Layers,
  Menu,
  RotateCcw,
  Shuffle,
  Sparkles,
  Swords,
  Trash2,
} from "lucide-react";
import { deckUrlsFromCode, expandDeck, normalizeDeckCode, parseDeckHtml } from "./deckParser";
import type { Card, CardInstance } from "./types";
import "./online.css";

type PrivateZone = "deck" | "hand" | "prizes";
type PublicZone = "active" | "bench" | "discard" | "lostZone" | "stadium";
type AnyZone = PrivateZone | PublicZone;
type MoveDestination = AnyZone | "activeFaceDown" | "benchFaceDown" | "revealActive";
type ListViewer = "discard" | "lostZone" | null;

type PublicCard = Pick<CardInstance, "uid" | "id" | "name" | "imageUrl" | "category" | "role"> & {
  faceDown?: boolean;
};

type PrivateState = {
  deck: CardInstance[];
  hand: CardInstance[];
  prizes: CardInstance[];
  faceDownPublicCards: Record<string, CardInstance>;
};

type BoardState = {
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
};

type SelectedCard = {
  card: CardInstance | PublicCard;
  sourceCard?: PublicCard;
  zone: AnyZone;
  privateCard: boolean;
  readOnly?: boolean;
};

type TargetCandidate = {
  card: PublicCard;
  displayCard: PublicCard;
  zone: "active" | "bench";
  index: number;
  label: string;
  attachedCards: PublicCard[];
  attachedDisplayCards: PublicCard[];
};

const STORAGE_KEY = "pokewan-solo-board-v2";
const CARD_BACK_URL = "./card-back.svg";
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

const emptyPrivate = (): PrivateState => ({
  deck: [],
  hand: [],
  prizes: [],
  faceDownPublicCards: {},
});

const emptyBoard = (): BoardState => ({
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
});

type SavedSoloState = {
  privateState: PrivateState;
  boardState: BoardState;
  status: Record<string, boolean>;
  deckCode: string;
  deckHtml: string;
  deckSummary: string;
};

const STATUS_LABELS = {
  poison: "どく",
  burn: "やけど",
  sleep: "ねむり",
  paralysis: "マヒ",
  confusion: "こんらん",
};

export function App() {
  const [deckCode, setDeckCode] = useState("");
  const [deckHtml, setDeckHtml] = useState("");
  const [deckSummary, setDeckSummary] = useState("デッキコード、公式URL、または公式ページHTMLから読み込めます。");
  const [deckLoading, setDeckLoading] = useState(false);
  const [privateState, setPrivateState] = useState<PrivateState>(emptyPrivate);
  const [boardState, setBoardState] = useState<BoardState>(emptyBoard);
  const [selected, setSelected] = useState<SelectedCard | null>(null);
  const [deckPeekOpen, setDeckPeekOpen] = useState(false);
  const [listViewer, setListViewer] = useState<ListViewer>(null);
  const [message, setMessage] = useState("");
  const [isMoving, setIsMoving] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [status, setStatus] = useState<Record<string, boolean>>({
    poison: false,
    burn: false,
    sleep: false,
    paralysis: false,
    confusion: false,
  });

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) {
      setHydrated(true);
      return;
    }
    try {
      const parsed = JSON.parse(saved) as Partial<SavedSoloState>;
      setPrivateState(normalizePrivate(parsed.privateState));
      setBoardState(normalizeBoard(parsed.boardState));
      setDeckCode(parsed.deckCode || "");
      setDeckHtml(parsed.deckHtml || "");
      setDeckSummary(parsed.deckSummary || "保存された盤面を読み込みました。");
      setStatus({ ...status, ...(parsed.status || {}) });
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const saved: SavedSoloState = {
      privateState,
      boardState,
      status,
      deckCode,
      deckHtml,
      deckSummary,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  }, [privateState, boardState, status, deckCode, deckHtml, deckSummary, hydrated]);

  const listCards = listViewer ? boardState[listViewer] : [];
  const hasRevealableBench = boardState.bench.some((card) => card.faceDown && privateState.faceDownPublicCards[card.uid]);

  function updatePrivate(nextPrivate: PrivateState, nextBoard = boardState) {
    setPrivateState(nextPrivate);
    setBoardState(syncCounts(nextBoard, nextPrivate));
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
          applyDeckCards(parsed, "デッキコード");
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

  async function startBattleSetup() {
    if (deckCode.trim()) {
      await loadDeckFromCode();
      return;
    }
    if (deckHtml.trim()) {
      loadDeckFromHtml();
      return;
    }
    setDeckSummary("デッキコード、公式URL、または公式ページHTMLを入力してください。");
  }

  function applyDeckCards(parsed: Card[], source: string) {
    const total = parsed.reduce((sum, card) => sum + card.count, 0);
    const expanded = shuffleCards(expandDeck(parsed));
    updatePrivate({ deck: expanded, hand: [], prizes: [], faceDownPublicCards: {} }, emptyBoard());
    setDeckPeekOpen(false);
    setSelected(null);
    setDeckSummary(`${source}から${total}枚のデッキを読み込みました。`);
  }

  function draw(count = 1) {
    const drawn = privateState.deck.slice(0, count);
    if (!drawn.length) return;
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
  }

  async function moveSelected(to: MoveDestination) {
    if (!selected || isMoving) return;
    setIsMoving(true);
    try {
      const next = atomicMoveSelectedCard({ selected, to, privateState, boardState });
      if (!next) {
        setMessage("カードの現在位置が変わっています。再選択してください。");
        setSelected(null);
        return;
      }
      setPrivateState(next.privateState);
      setBoardState(next.boardState);
      setSelected(null);
    } finally {
      setIsMoving(false);
    }
  }

  async function attachSelected(targetUid: string) {
    if (!selected || isMoving) return;
    setIsMoving(true);
    try {
      const next = atomicAttachSelectedCard({ selected, targetUid, privateState, boardState });
      if (!next) {
        setMessage("カードの現在位置が変わっています。再選択してください。");
        setSelected(null);
        return;
      }
      setPrivateState(next.privateState);
      setBoardState(next.boardState);
      setSelected(null);
    } finally {
      setIsMoving(false);
    }
  }

  function adjustSelectedDamage(delta: number) {
    if (!selected || selected.privateCard) return;
    const card = (selected.sourceCard ?? selected.card) as PublicCard;
    setBoardState((current) => {
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

  function revealBenchFaceDownCards() {
    const next = atomicRevealBenchFaceDownCards({ privateState, boardState });
    if (!next) {
      setMessage("表面にできるベンチの裏向きカードがありません。");
      return;
    }
    setPrivateState(next.privateState);
    setBoardState(next.boardState);
  }

  function resetAll() {
    localStorage.removeItem(STORAGE_KEY);
    setPrivateState(emptyPrivate());
    setBoardState(emptyBoard());
    setStatus({ poison: false, burn: false, sleep: false, paralysis: false, confusion: false });
    setSelected(null);
    setDeckPeekOpen(false);
    setListViewer(null);
    setMessage("盤面をリセットしました。");
  }

  return (
    <div className="online-app solo-app">
      <header className="online-topbar">
        <div>
          <p className="eyebrow">Pokewan Solo Practice</p>
          <h1>一人回し</h1>
        </div>
        <div className="solo-header-actions">
          <button type="button" aria-label="メニュー">
            <Menu />
            <span>メニュー</span>
          </button>
          <button type="button" onClick={resetAll}>
            <RotateCcw />
            <span>リセット</span>
          </button>
        </div>
      </header>

      <section className="solo-info-bar" aria-label="カード枚数">
        <span><Hand />手札 <strong>{boardState.handCount}枚</strong></span>
        <span><Sparkles />サイド <strong>{boardState.prizeCount}枚</strong></span>
        <span><Layers />山札 <strong>{boardState.deckCount}枚</strong></span>
        <span><Trash2 />トラッシュ <strong>{boardState.discard.length}枚</strong></span>
      </section>

      <section className="deck-loader">
        <div>
          <h2>デッキ読み込み</h2>
          <p>状態はこのブラウザに保存されます。</p>
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
        <div className="quick-control-group">
          <span>バトル開始時</span>
          <button onClick={startBattleSetup} disabled={deckLoading}>
            <ArrowDownToLine />
            開始
          </button>
          <button onClick={setupOpeningHand} disabled={privateState.deck.length + privateState.hand.length < 7}>
            <Hand />
            初手7枚
          </button>
          <button onClick={setupPrizes} disabled={privateState.deck.length < 6}>
            <Sparkles />
            サイド6枚
          </button>
          <button onClick={revealBenchFaceDownCards} disabled={!hasRevealableBench || isMoving}>
            <Eye />
            ベンチを表面にする
          </button>
        </div>
        <div className="quick-control-group">
          <span>バトル中</span>
          <button onClick={() => draw(1)} disabled={!privateState.deck.length}>
            <ArrowDownToLine />
            1枚ドロー
          </button>
          <button onClick={returnHandToDeck} disabled={!privateState.hand.length}>
            <Hand />
            手札を山札へ
          </button>
          <button onClick={shuffleDeck} disabled={!privateState.deck.length}>
            <Shuffle />
            山札シャッフル
          </button>
          <button onClick={() => setDeckPeekOpen(true)} disabled={!privateState.deck.length}>
            <Eye />
            自分だけ山札確認
          </button>
        </div>
        <div className="quick-control-group">
          <span>そのほか</span>
          <button onClick={resetAll}>
            <RotateCcw />
            リセット
          </button>
        </div>
      </section>

      <section className="solo-status-panel">
        <h2>バトル場に出す</h2>
        <button className={status.poison ? "status active" : "status"} onClick={() => setStatus((current) => ({ ...current, poison: !current.poison }))}>
          {STATUS_LABELS.poison}
        </button>
        <div>
          {(["burn", "sleep", "paralysis"] as const).map((key) => (
            <button key={key} className={status[key] ? "status active" : "status"} onClick={() => setStatus((current) => ({ ...current, [key]: !current[key] }))}>
              {STATUS_LABELS[key]}
            </button>
          ))}
        </div>
        <button className={status.confusion ? "status active" : "status"} onClick={() => setStatus((current) => ({ ...current, confusion: !current.confusion }))}>
          {STATUS_LABELS.confusion}
        </button>
      </section>

      {message && <p className="message">{message}</p>}

      <PlayerBoard
        title="プレイヤー"
        boardState={boardState}
        privateState={privateState}
        onDeckDraw={() => draw(1)}
        onDeckPeek={() => setDeckPeekOpen(true)}
        onPrizeDraw={drawPrize}
        onReturnHandToDeck={returnHandToDeck}
        onOpenList={setListViewer}
        onSelect={setSelected}
      />

      {deckPeekOpen && (
        <CardListModal
          title={`山札 (${privateState.deck.length}枚)`}
          cards={privateState.deck}
          onClose={() => setDeckPeekOpen(false)}
          onSelect={(card) => {
            setDeckPeekOpen(false);
            setSelected({ card, zone: "deck", privateCard: true });
          }}
        />
      )}

      {listViewer && (
        <CardListModal
          title={`${PUBLIC_ZONE_LABELS[listViewer]} (${listCards.length}枚)`}
          cards={listCards}
          emptyText={`${PUBLIC_ZONE_LABELS[listViewer]}にカードはありません。`}
          onClose={() => setListViewer(null)}
          onSelect={(card) => {
            const zone = listViewer;
            setListViewer(null);
            if (zone) setSelected({ card, zone, privateCard: false });
          }}
        />
      )}

      {selected && (
        <MoveDialog
          selected={selected}
          canMove={!selected.readOnly}
          canRevealFaceDown={
            !selected.privateCard &&
            selected.zone === "active" &&
            Boolean((selected.card as PublicCard).faceDown && privateState.faceDownPublicCards[(selected.card as PublicCard).uid])
          }
          isMoving={isMoving}
          targetCandidates={selected.sourceCard ? [] : buildTargetCandidates(boardState, selected.card.uid)}
          damage={selected.privateCard ? 0 : boardState.damageCounters[((selected.sourceCard ?? selected.card) as PublicCard).uid] || 0}
          onAdjustDamage={adjustSelectedDamage}
          onAttach={attachSelected}
          onClose={() => setSelected(null)}
          onMove={moveSelected}
        />
      )}
    </div>
  );
}

function PlayerBoard({
  title,
  boardState,
  privateState,
  onDeckDraw,
  onDeckPeek,
  onPrizeDraw,
  onReturnHandToDeck,
  onOpenList,
  onSelect,
}: {
  title: string;
  boardState: BoardState;
  privateState: PrivateState;
  onDeckDraw: () => void;
  onDeckPeek: () => void;
  onPrizeDraw: () => void;
  onReturnHandToDeck: () => void;
  onOpenList: (viewer: Exclude<ListViewer, null>) => void;
  onSelect: (selected: SelectedCard) => void;
}) {
  return (
    <section className="player-board mine">
      <header>
        <h2>{title}</h2>
        <div className="counts">
          <span>山札 {boardState.deckCount}</span>
          <span>手札 {boardState.handCount}</span>
          <span>サイド {boardState.prizeCount}</span>
        </div>
      </header>

      <div className="zone-layout board-layout">
        <HiddenZone
          title="サイド"
          count={boardState.prizeCount}
          cards={null}
          zone="prizes"
          className="zone-prizes"
          action={boardState.prizeCount > 0 ? { label: "1枚ドロー", onClick: onPrizeDraw } : undefined}
          onSelect={onSelect}
        />
        <PublicZoneView
          title="バトル場"
          zone="active"
          cards={boardState.active}
          attachedCards={boardState.attachedCards}
          damageCounters={boardState.damageCounters}
          onSelect={onSelect}
        />
        <PublicZoneView title="スタジアム" zone="stadium" cards={boardState.stadium} damageCounters={boardState.damageCounters} onSelect={onSelect} />
        <HiddenZone
          title="山札"
          count={boardState.deckCount}
          cards={null}
          zone="deck"
          className="zone-deck"
          action={boardState.deckCount > 0 ? { label: "1枚ドロー", onClick: onDeckDraw } : undefined}
          onDeckPeek={onDeckPeek}
          onSelect={onSelect}
        />
        <PublicZoneView
          title="ベンチ"
          zone="bench"
          cards={boardState.bench}
          attachedCards={boardState.attachedCards}
          damageCounters={boardState.damageCounters}
          onSelect={onSelect}
        />
        <PublicZoneView
          title="トラッシュ"
          zone="discard"
          cards={boardState.discard}
          damageCounters={boardState.damageCounters}
          compactLatest
          onOpenList={() => onOpenList("discard")}
          onSelect={onSelect}
        />
        <HiddenZone
          title="手札"
          count={boardState.handCount}
          cards={privateState.hand}
          zone="hand"
          className="zone-hand"
          action={boardState.handCount > 0 ? { label: "手札を山札へ", onClick: onReturnHandToDeck } : undefined}
          onSelect={onSelect}
        />
        <PublicZoneView
          title="ロスト"
          zone="lostZone"
          cards={boardState.lostZone}
          damageCounters={boardState.damageCounters}
          compactLatest
          onOpenList={() => onOpenList("lostZone")}
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
  zone,
  action,
  className,
  onDeckPeek,
  onSelect,
}: {
  title: string;
  count: number;
  cards: CardInstance[] | null;
  zone: PrivateZone;
  action?: { label: string; onClick?: () => void };
  className?: string;
  onDeckPeek?: () => void;
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
              onClick={() => onSelect({ card, zone, privateCard: true })}
            />
          ))}
        </div>
      ) : zone === "deck" ? (
        <DeckStack count={count} onClick={onDeckPeek} />
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

function DeckStack({ count, onClick }: { count: number; onClick?: () => void }) {
  const content = (
    <>
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
    </>
  );
  return (
    <div className="deck-stack-wrap" aria-label={`山札 ${count}枚`}>
      {onClick && count > 0 ? (
        <button className="deck-stack-button" onClick={onClick} aria-label="自分だけ山札確認">
          {content}
        </button>
      ) : (
        content
      )}
    </div>
  );
}

function PublicZoneView({
  title,
  zone,
  cards,
  attachedCards = {},
  damageCounters,
  compactLatest = false,
  onOpenList,
  onSelect,
}: {
  title: string;
  zone: PublicZone;
  cards: PublicCard[];
  attachedCards?: Record<string, PublicCard[]>;
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
        {visibleCards.map((card) =>
          zone === "active" || zone === "bench" ? (
            <BattleCardStack
              key={card.uid}
              card={card}
              attachedCards={attachedCards[card.uid] || []}
              damage={damageCounters[card.uid] || 0}
              onSelect={(selectedCard, readOnly = false, sourceCard) =>
                onSelect({ card: selectedCard, sourceCard, zone, privateCard: false, readOnly })
              }
            />
          ) : (
            <CardButton
              key={card.uid}
              card={card}
              faceDown={false}
              damage={damageCounters[card.uid] || 0}
              onClick={() => onSelect({ card, zone, privateCard: false })}
            />
          ),
        )}
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
  const isFaceDown = faceDown || Boolean((card as PublicCard).faceDown);
  return (
    <button className={`card-tile ${isFaceDown ? "is-face-down" : ""}`} onClick={onClick}>
      <span className="card-image-wrap">
        <img src={isFaceDown ? CARD_BACK_URL : card.imageUrl} alt={isFaceDown ? "裏向きカード" : card.name} loading="lazy" />
        {damage > 0 && <strong className="damage-badge">{damage}</strong>}
      </span>
      <span>{isFaceDown ? "裏向き" : card.name}</span>
    </button>
  );
}

function BattleCardStack({
  card,
  attachedCards,
  damage,
  onSelect,
}: {
  card: PublicCard;
  attachedCards: PublicCard[];
  damage: number;
  onSelect: (card: PublicCard, readOnly?: boolean, sourceCard?: PublicCard) => void;
}) {
  const evolutionCards = attachedCards.filter(isPokemonCard);
  const toolCards = attachedCards.filter(isPokemonToolCard);
  const supportCards = attachedCards.filter((attached) => !isPokemonCard(attached) && !isPokemonToolCard(attached));
  const evolutionLine = [card, ...evolutionCards];
  const topCard = evolutionLine[evolutionLine.length - 1];
  const baseCards = evolutionLine.slice(0, -1);

  return (
    <div className="battle-card-stack">
      <div className={`evolution-stack ${evolutionCards.length > 0 ? "has-evolution" : ""}`}>
        {baseCards.map((baseCard, index) => (
          <button
            key={baseCard.uid}
            className="evolution-underlay"
            style={{ "--evolution-offset": `${Math.min(index + 1, 3) * 7}px` } as React.CSSProperties}
            title={baseCard.name}
            onClick={() => onSelect(baseCard, true)}
          >
            <img src={baseCard.imageUrl} alt={baseCard.name} loading="lazy" />
          </button>
        ))}
        <CardButton
          card={topCard}
          faceDown={false}
          damage={damage}
          onClick={() => onSelect(topCard, false, topCard.uid === card.uid ? undefined : card)}
        />
        {toolCards.length > 0 && (
          <div className="tool-overlays" aria-label={`${topCard.name}についているポケモンのどうぐ`}>
            {toolCards.map((tool, index) => (
              <button
                key={tool.uid}
                className="tool-overlay-card"
                style={{ "--tool-offset": `${index * 10}px` } as React.CSSProperties}
                title={tool.name}
                onClick={() => onSelect(tool, true)}
              >
                <img src={tool.imageUrl} alt={tool.name} loading="lazy" />
              </button>
            ))}
          </div>
        )}
      </div>
      {evolutionCards.length > 0 && (
        <div className="evolution-history" aria-label={`${card.name}の進化元`}>
          {baseCards.map((baseCard) => (
            <button
              key={baseCard.uid}
              className="evolution-history-card"
              title={baseCard.name}
              onClick={() => onSelect(baseCard, true)}
            >
              <img src={baseCard.imageUrl} alt={baseCard.name} loading="lazy" />
            </button>
          ))}
        </div>
      )}
      {supportCards.length > 0 && (
        <div className="attached-cards" aria-label={`${card.name}についているカード`}>
          {supportCards.map((attached) => (
            <button
              key={attached.uid}
              className="attached-card-button"
              title={attached.name}
              onClick={() => onSelect(attached, true)}
            >
              <img className="attached-card" src={attached.imageUrl} alt={attached.name} loading="lazy" />
            </button>
          ))}
        </div>
      )}
    </div>
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
          <button onClick={onClose}>×</button>
        </header>
        {cards.length > 0 ? (
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
  canRevealFaceDown,
  isMoving,
  targetCandidates,
  damage,
  onAdjustDamage,
  onAttach,
  onClose,
  onMove,
}: {
  selected: SelectedCard;
  canMove: boolean;
  canRevealFaceDown: boolean;
  isMoving: boolean;
  targetCandidates: TargetCandidate[];
  damage: number;
  onAdjustDamage: (delta: number) => void;
  onAttach: (targetUid: string) => void;
  onClose: () => void;
  onMove: (zone: MoveDestination) => void;
}) {
  const imageUrl = selected.card.imageUrl;
  const name = selected.card.name;
  const destinations: AnyZone[] = ["hand", "deck", "prizes", "active", "bench", "discard", "lostZone", "stadium"];
  const canEditDamage = canMove && !selected.privateCard && (selected.zone === "active" || selected.zone === "bench");
  const attachAction = isPokemonCard(selected.card) ? "進化" : "付ける";
  const activeCandidates = targetCandidates.filter((candidate) => candidate.zone === "active");
  const benchCandidates = targetCandidates.filter((candidate) => candidate.zone === "bench");
  const categoryLabel = selected.card.category === "pokemon" ? "ポケモン" : selected.card.category === "energy" ? "エネルギー" : selected.card.category === "trainer" ? "トレーナーズ" : "不明";
  const count = "originalCount" in selected.card ? selected.card.originalCount : 1;

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <dialog className="move-modal" open onClick={(event) => event.stopPropagation()}>
        <img src={imageUrl} alt={name} />
        <div className="modal-actions">
          <p>{zoneLabel(selected.zone)}</p>
          <h3>{name}</h3>
          <p className="message">種別: {categoryLabel} / 枚数: {count}</p>
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
            <>
              {targetCandidates.length > 0 && (
                <div className="target-candidate-list">
                  <p className="target-candidate-title">このカードをどのポケモンに使いますか？</p>
                  <TargetCandidateGroup title="バトル場" candidates={activeCandidates} action={attachAction} isMoving={isMoving} onAttach={onAttach} />
                  <TargetCandidateGroup title="ベンチ" candidates={benchCandidates} action={attachAction} isMoving={isMoving} onAttach={onAttach} />
                </div>
              )}
              {selected.privateCard && (
                <div className="face-down-action-grid">
                  <button className="face-down-action" disabled={isMoving} onClick={() => onMove("activeFaceDown")}>
                    バトル場へ（裏面）
                  </button>
                  <button className="face-down-action" disabled={isMoving} onClick={() => onMove("benchFaceDown")}>
                    ベンチへ（裏面）
                  </button>
                </div>
              )}
              {canRevealFaceDown && (
                <button className="face-down-action" disabled={isMoving} onClick={() => onMove("revealActive")}>
                  表面にする
                </button>
              )}
              <div className="move-grid">
                {destinations.map((zone) => (
                  <button key={zone} disabled={isMoving || zone === selected.zone} onClick={() => onMove(zone)}>
                    {zoneLabel(zone)}へ
                  </button>
                ))}
              </div>
            </>
          ) : (
            <p className="message">このカードは詳細表示中です。</p>
          )}
          <button onClick={onClose} disabled={isMoving}>閉じる</button>
        </div>
      </dialog>
    </div>
  );
}

function TargetCandidateGroup({
  title,
  candidates,
  action,
  isMoving,
  onAttach,
}: {
  title: string;
  candidates: TargetCandidate[];
  action: "進化" | "付ける";
  isMoving: boolean;
  onAttach: (targetUid: string) => void;
}) {
  if (!candidates.length) return null;
  return (
    <div className="target-candidate-group">
      <h4>{title}</h4>
      {candidates.map((candidate) => (
        <button key={candidate.card.uid} className="target-candidate-button" disabled={isMoving} onClick={() => onAttach(candidate.card.uid)}>
          <img
            className="target-candidate-thumb"
            src={candidate.displayCard.faceDown ? CARD_BACK_URL : candidate.displayCard.imageUrl}
            alt={candidate.displayCard.faceDown ? "裏向きカード" : candidate.displayCard.name}
            loading="lazy"
          />
          <span className="target-candidate-meta">
            <strong>{candidate.displayCard.faceDown ? "裏向きカード" : candidate.displayCard.name}</strong>
            <span>
              <b>{candidate.label}</b>
              <em>付いているカード {candidate.attachedCards.length}枚</em>
            </span>
            <small>個体ID: {shortUid(candidate.card.uid)}</small>
            {candidate.attachedDisplayCards.length > 0 && (
              <span className="target-candidate-attached">
                {candidate.attachedDisplayCards.map((attached) => (
                  <img
                    key={attached.uid}
                    src={attached.faceDown ? CARD_BACK_URL : attached.imageUrl}
                    alt={attached.faceDown ? "裏向きカード" : attached.name}
                    title={attached.faceDown ? "裏向きカード" : attached.name}
                    loading="lazy"
                  />
                ))}
              </span>
            )}
            <span className="target-candidate-action">
              {candidate.label}の{candidate.displayCard.faceDown ? "裏向きカード" : candidate.displayCard.name}に{action === "進化" ? "進化する" : "付ける"}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

function zoneLabel(zone: AnyZone) {
  return isPrivateZone(zone) ? PRIVATE_ZONE_LABELS[zone] : PUBLIC_ZONE_LABELS[zone];
}

function isPrivateZone(zone: AnyZone): zone is PrivateZone {
  return zone === "deck" || zone === "hand" || zone === "prizes";
}

function syncCounts(boardState: BoardState, privateState: PrivateState): BoardState {
  return {
    ...boardState,
    deckCount: privateState.deck.length,
    handCount: privateState.hand.length,
    prizeCount: privateState.prizes.length,
  };
}

function toPublicCard(card: CardInstance, options?: { faceDown?: boolean }): PublicCard {
  if (options?.faceDown) {
    return {
      uid: card.uid,
      id: `face-down-${card.uid}`,
      name: "裏向きカード",
      imageUrl: CARD_BACK_URL,
      faceDown: true,
    };
  }
  return {
    uid: card.uid,
    id: card.id,
    name: card.name,
    imageUrl: card.imageUrl,
    category: card.category,
    role: card.role,
  };
}

function publicToPrivate(card: PublicCard): CardInstance {
  return {
    ...card,
    originalCount: 1,
  };
}

function isPokemonCard(card: CardInstance | PublicCard) {
  return card.category === "pokemon";
}

function isPokemonToolCard(card: CardInstance | PublicCard) {
  return card.role === "pokemonTool";
}

function publicCardForMove(card: PublicCard, privateFaceDownCard?: CardInstance) {
  return privateFaceDownCard ? toPublicCard(privateFaceDownCard) : card;
}

function removeFromPrivateZones(state: PrivateState, uid: string): PrivateState {
  return PRIVATE_ZONES.reduce(
    (next, zone) => ({
      ...next,
      [zone]: next[zone].filter((card) => card.uid !== uid),
    }),
    state,
  );
}

function removeFromPublicZones(state: BoardState, uid: string): BoardState {
  const withoutPublicZones = PUBLIC_ZONES.reduce(
    (next, zone) => ({
      ...next,
      [zone]: next[zone].filter((card) => card.uid !== uid),
    }),
    state,
  );
  const attachedCards = Object.fromEntries(
    Object.entries(withoutPublicZones.attachedCards || {})
      .filter(([targetUid]) => targetUid !== uid)
      .map(([targetUid, cards]) => [targetUid, cards.filter((card) => card.uid !== uid)]),
  );
  return { ...withoutPublicZones, attachedCards };
}

function addToPrivateZone(state: PrivateState, zone: PrivateZone, card: CardInstance): PrivateState {
  const deduped = removeFromPrivateZones(state, card.uid);
  return {
    ...deduped,
    [zone]: [card, ...deduped[zone]],
  };
}

function addToPublicZone(state: BoardState, zone: PublicZone, card: PublicCard): BoardState {
  const deduped = removeFromPublicZones(state, card.uid);
  return {
    ...deduped,
    [zone]: [card, ...deduped[zone]],
  };
}

function buildTargetCandidates(boardState: BoardState, selectedUid: string): TargetCandidate[] {
  const activeCandidates = boardState.active
    .filter((card) => card.uid !== selectedUid)
    .map((card) => buildTargetCandidate(card, boardState.attachedCards[card.uid] || [], "active", 0, "バトル場"));
  const benchCandidates = boardState.bench
    .filter((card) => card.uid !== selectedUid)
    .map((card, index) => buildTargetCandidate(card, boardState.attachedCards[card.uid] || [], "bench", index, `ベンチ${index + 1}`));
  return [...activeCandidates, ...benchCandidates];
}

function buildTargetCandidate(
  card: PublicCard,
  attachedCards: PublicCard[],
  zone: "active" | "bench",
  index: number,
  label: string,
): TargetCandidate {
  return {
    card,
    displayCard: topDisplayCard(card, attachedCards),
    zone,
    index,
    label,
    attachedCards,
    attachedDisplayCards: targetAttachedDisplayCards(card, attachedCards),
  };
}

function topDisplayCard(card: PublicCard, attachedCards: PublicCard[]) {
  const evolutionCards = attachedCards.filter(isPokemonCard);
  return evolutionCards[evolutionCards.length - 1] || card;
}

function targetAttachedDisplayCards(card: PublicCard, attachedCards: PublicCard[]) {
  const evolutionCards = attachedCards.filter(isPokemonCard);
  const evolutionSources = evolutionCards.length > 0 ? [card, ...evolutionCards.slice(0, -1)] : [];
  const supportCards = attachedCards.filter((attached) => !isPokemonCard(attached));
  return [...evolutionSources, ...supportCards];
}

function shortUid(uid: string) {
  return uid.replace(/[^a-zA-Z0-9]/g, "").slice(-4) || uid.slice(-4);
}

function atomicMoveSelectedCard({
  selected,
  to,
  privateState,
  boardState,
}: {
  selected: SelectedCard;
  to: MoveDestination;
  privateState: PrivateState;
  boardState: BoardState;
}): { privateState: PrivateState; boardState: BoardState } | null {
  const sourceCard = selected.sourceCard ?? selected.card;
  const uid = sourceCard.uid;
  const from = selected.zone;
  const toZone: AnyZone =
    to === "activeFaceDown" || to === "revealActive" ? "active" : to === "benchFaceDown" ? "bench" : to;
  const attachedToMovedCard = boardState.attachedCards?.[uid] || [];
  const faceDownPrivateCard = !selected.privateCard && (sourceCard as PublicCard).faceDown
    ? privateState.faceDownPublicCards?.[uid]
    : undefined;
  const existsInSource = selected.privateCard
    ? isPrivateZone(from) && privateState[from].some((card) => card.uid === uid)
    : !isPrivateZone(from) && boardState[from].some((card) => card.uid === uid);

  if (!existsInSource) return null;

  let nextPrivate = removeFromPrivateZones(privateState, uid);
  let nextBoard = removeFromPublicZones(boardState, uid);
  const faceDownPublicCards = { ...(nextPrivate.faceDownPublicCards || {}) };
  if (!selected.privateCard && faceDownPrivateCard) {
    delete faceDownPublicCards[uid];
  }
  nextPrivate = { ...nextPrivate, faceDownPublicCards };
  const damageCounters = { ...nextBoard.damageCounters };
  if (isPrivateZone(toZone) || toZone === "discard" || toZone === "lostZone" || toZone === "stadium") {
    delete damageCounters[uid];
  }
  nextBoard = { ...nextBoard, damageCounters };

  if (to === "revealActive" && !selected.privateCard) {
    if (!faceDownPrivateCard) return null;
    nextBoard = addToPublicZone(nextBoard, "active", toPublicCard(faceDownPrivateCard));
    if (attachedToMovedCard.length > 0) {
      nextBoard = {
        ...nextBoard,
        attachedCards: {
          ...nextBoard.attachedCards,
          [uid]: attachedToMovedCard,
        },
      };
    }
  } else if ((to === "activeFaceDown" || to === "benchFaceDown") && selected.privateCard) {
    const privateCard = sourceCard as CardInstance;
    nextPrivate = {
      ...nextPrivate,
      faceDownPublicCards: {
        ...(nextPrivate.faceDownPublicCards || {}),
        [uid]: privateCard,
      },
    };
    nextBoard = addToPublicZone(nextBoard, to === "activeFaceDown" ? "active" : "bench", toPublicCard(privateCard, { faceDown: true }));
  } else if (!selected.privateCard && attachedToMovedCard.length > 0 && toZone === "discard") {
    nextBoard = {
      ...nextBoard,
      discard: [publicCardForMove(sourceCard as PublicCard, faceDownPrivateCard), ...attachedToMovedCard, ...nextBoard.discard],
    };
  } else if (!selected.privateCard && attachedToMovedCard.length > 0 && toZone === "lostZone") {
    nextBoard = {
      ...nextBoard,
      lostZone: [publicCardForMove(sourceCard as PublicCard, faceDownPrivateCard), ...attachedToMovedCard, ...nextBoard.lostZone],
    };
  } else if (!selected.privateCard && attachedToMovedCard.length > 0 && isPrivateZone(toZone)) {
    nextPrivate = addToPrivateZone(nextPrivate, toZone, faceDownPrivateCard || publicToPrivate(sourceCard as PublicCard));
    nextBoard = {
      ...nextBoard,
      discard: [...attachedToMovedCard, ...nextBoard.discard],
    };
  } else if (!selected.privateCard && attachedToMovedCard.length > 0 && (toZone === "active" || toZone === "bench")) {
    nextBoard = addToPublicZone(nextBoard, toZone, publicCardForMove(sourceCard as PublicCard, faceDownPrivateCard));
    nextBoard = {
      ...nextBoard,
      attachedCards: {
        ...nextBoard.attachedCards,
        [uid]: attachedToMovedCard,
      },
    };
  } else if (!selected.privateCard && attachedToMovedCard.length > 0) {
    nextBoard = addToPublicZone(nextBoard, toZone as PublicZone, publicCardForMove(sourceCard as PublicCard, faceDownPrivateCard));
    nextBoard = {
      ...nextBoard,
      discard: [...attachedToMovedCard, ...nextBoard.discard],
    };
  } else if (isPrivateZone(toZone)) {
    const privateCard = selected.privateCard ? (sourceCard as CardInstance) : faceDownPrivateCard || publicToPrivate(sourceCard as PublicCard);
    nextPrivate = addToPrivateZone(nextPrivate, toZone, privateCard);
  } else {
    const publicCard = selected.privateCard
      ? toPublicCard(sourceCard as CardInstance)
      : publicCardForMove(sourceCard as PublicCard, faceDownPrivateCard);
    nextBoard = addToPublicZone(nextBoard, toZone, publicCard);
  }

  nextBoard = syncCounts(nextBoard, nextPrivate);
  return { privateState: nextPrivate, boardState: nextBoard };
}

function atomicRevealBenchFaceDownCards({
  privateState,
  boardState,
}: {
  privateState: PrivateState;
  boardState: BoardState;
}): { privateState: PrivateState; boardState: BoardState } | null {
  const faceDownPublicCards = { ...(privateState.faceDownPublicCards || {}) };
  let changed = false;
  const bench = boardState.bench.map((card) => {
    if (!card.faceDown) return card;
    const privateCard = faceDownPublicCards[card.uid];
    if (!privateCard) return card;
    changed = true;
    delete faceDownPublicCards[card.uid];
    return toPublicCard(privateCard);
  });
  if (!changed) return null;
  return {
    privateState: { ...privateState, faceDownPublicCards },
    boardState: { ...boardState, bench },
  };
}

function atomicAttachSelectedCard({
  selected,
  targetUid,
  privateState,
  boardState,
}: {
  selected: SelectedCard;
  targetUid: string;
  privateState: PrivateState;
  boardState: BoardState;
}): { privateState: PrivateState; boardState: BoardState } | null {
  const uid = selected.card.uid;
  const from = selected.zone;
  const targetExists = [...boardState.active, ...boardState.bench].some((card) => card.uid === targetUid);
  const existsInSource = selected.privateCard
    ? isPrivateZone(from) && privateState[from].some((card) => card.uid === uid)
    : !isPrivateZone(from) && boardState[from].some((card) => card.uid === uid);
  if (!targetExists || !existsInSource || uid === targetUid) return null;

  const nextPrivate = removeFromPrivateZones(privateState, uid);
  let nextBoard = removeFromPublicZones(boardState, uid);
  const publicCard = selected.privateCard ? toPublicCard(selected.card as CardInstance) : (selected.card as PublicCard);
  const currentAttached = nextBoard.attachedCards[targetUid] || [];
  nextBoard = {
    ...nextBoard,
    attachedCards: {
      ...nextBoard.attachedCards,
      [targetUid]: [...currentAttached.filter((card) => card.uid !== uid), publicCard],
    },
  };
  nextBoard = syncCounts(nextBoard, nextPrivate);
  return { privateState: nextPrivate, boardState: nextBoard };
}

function normalizePrivate(value?: Partial<PrivateState> | null): PrivateState {
  return {
    deck: Array.isArray(value?.deck) ? value.deck : [],
    hand: Array.isArray(value?.hand) ? value.hand : [],
    prizes: Array.isArray(value?.prizes) ? value.prizes : [],
    faceDownPublicCards: value?.faceDownPublicCards || {},
  };
}

function normalizeBoard(value?: Partial<BoardState> | null): BoardState {
  const fallback = emptyBoard();
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
  };
}

function shuffleCards<T>(cards: T[]) {
  return [...cards].sort(() => Math.random() - 0.5);
}
