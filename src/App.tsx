import { useEffect, useMemo, useState } from "react";
import {
  ArrowDownToLine,
  CircleDashed,
  CopyPlus,
  Eye,
  Flame,
  Hand,
  Layers,
  Loader2,
  RotateCcw,
  Shuffle,
  Sparkles,
  Swords,
  Trash2,
} from "lucide-react";
import { deckUrlsFromCode, expandDeck, normalizeDeckCode, parseDeckHtml } from "./deckParser";
import type { BattleStatus, Card, CardInstance, ZoneKey, Zones } from "./types";

const STORAGE_KEY = "pokeca-solo-practice-state-v1";
const CARD_BACK_URL = "./card-back.svg";
const FACE_DOWN_ZONES = new Set<ZoneKey>(["deck", "prizes"]);

const ZONE_LABELS: Record<ZoneKey, string> = {
  deck: "山札",
  hand: "手札",
  prizes: "サイド",
  battle: "バトル場",
  bench: "ベンチ",
  trash: "トラッシュ",
  lost: "ロスト",
};

const ZONE_ICONS: Record<ZoneKey, typeof Layers> = {
  deck: Layers,
  hand: Hand,
  prizes: Sparkles,
  battle: Swords,
  bench: CopyPlus,
  trash: Trash2,
  lost: CircleDashed,
};

const emptyZones = (): Zones => ({
  deck: [],
  hand: [],
  prizes: [],
  battle: [],
  bench: [],
  trash: [],
  lost: [],
});

const defaultStatus: BattleStatus = {
  poison: false,
  burn: false,
  sleep: false,
  paralysis: false,
  confusion: false,
};

type SavedState = {
  cards: Card[];
  zones: Zones;
  status: BattleStatus;
  loadedCode: string;
};

export function App() {
  const [deckCode, setDeckCode] = useState("");
  const [html, setHtml] = useState("");
  const [cards, setCards] = useState<Card[]>([]);
  const [zones, setZones] = useState<Zones>(emptyZones);
  const [selected, setSelected] = useState<{ card: CardInstance; zone: ZoneKey } | null>(null);
  const [dragging, setDragging] = useState<{ uid: string; zone: ZoneKey } | null>(null);
  const [status, setStatus] = useState<BattleStatus>(defaultStatus);
  const [message, setMessage] = useState("デッキコードか公式ページHTMLを読み込んでください。");
  const [isLoading, setIsLoading] = useState(false);
  const [loadedCode, setLoadedCode] = useState("");
  const [deckRevealed, setDeckRevealed] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved) as SavedState;
      setCards(parsed.cards || []);
      setZones(parsed.zones || emptyZones());
      setStatus(parsed.status || defaultStatus);
      setLoadedCode(parsed.loadedCode || "");
      setMessage("前回の練習状態を復元しました。");
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ cards, zones, status, loadedCode }));
  }, [cards, loadedCode, status, zones]);

  const totalCards = useMemo(() => cards.reduce((sum, card) => sum + card.count, 0), [cards]);
  const zoneTotals = useMemo(
    () => Object.values(zones).reduce((sum, zone) => sum + zone.length, 0),
    [zones],
  );

  async function loadFromDeckCode() {
    const code = normalizeDeckCode(deckCode);
    if (!code) {
      setMessage("デッキコードかURLを入力してください。");
      return;
    }

    setIsLoading(true);
    setMessage("公式ページを直接読み込み中です。CORSで失敗した場合はHTML貼り付けを使えます。");

    for (const url of deckUrlsFromCode(code)) {
      try {
        const response = await fetch(url, { mode: "cors" });
        if (!response.ok) continue;
        const text = await response.text();
        const parsed = parseDeckHtml(text);
        if (parsed.length) {
          applyCards(parsed, code);
          setHtml(text);
          setMessage(`${parsed.reduce((sum, card) => sum + card.count, 0)}枚を読み込みました。`);
          setIsLoading(false);
          return;
        }
      } catch {
        // Static hosting fallback: use pasted official page HTML.
      }
    }

    setIsLoading(false);
    setMessage("直接読み込みできませんでした。公式デッキ表示ページのHTMLを貼り付けてください。");
  }

  function loadFromHtml() {
    const parsed = parseDeckHtml(html);
    if (!parsed.length) {
      setMessage("カード情報を見つけられませんでした。公式デッキ表示ページ全体のHTMLを貼り付けてください。");
      return;
    }
    applyCards(parsed, normalizeDeckCode(deckCode));
    setMessage(`${parsed.reduce((sum, card) => sum + card.count, 0)}枚をHTMLから読み込みました。`);
  }

  function applyCards(parsedCards: Card[], code: string) {
    const expanded = expandDeck(parsedCards);
    setCards(parsedCards);
    setZones({ ...emptyZones(), deck: shuffleCards(expanded) });
    setStatus(defaultStatus);
    setLoadedCode(code);
    setDeckRevealed(false);
    setSelected(null);
  }

  function moveCard(uid: string, from: ZoneKey, to: ZoneKey) {
    if (from === to) return;
    setZones((current) => {
      const card = current[from].find((item) => item.uid === uid);
      if (!card) return current;
      return {
        ...current,
        [from]: current[from].filter((item) => item.uid !== uid),
        [to]: [card, ...current[to]],
      };
    });
    setSelected(null);
  }

  function draw(count: number) {
    setZones((current) => {
      const drawn = current.deck.slice(0, count);
      return {
        ...current,
        deck: current.deck.slice(count),
        hand: [...current.hand, ...drawn],
      };
    });
  }

  function setupOpeningHand() {
    setZones((current) => {
      const source = shuffleCards([...current.deck, ...current.hand]);
      return {
        ...current,
        deck: source.slice(7),
        hand: source.slice(0, 7),
      };
    });
  }

  function setupPrizes() {
    setZones((current) => ({
      ...current,
      deck: current.deck.slice(6),
      prizes: [...current.prizes, ...current.deck.slice(0, 6)],
    }));
  }

  function shuffleDeck() {
    setZones((current) => ({ ...current, deck: shuffleCards(current.deck) }));
    setDeckRevealed(false);
  }

  function revealDeck() {
    setDeckRevealed(true);
  }

  function closeDeckReveal() {
    setZones((current) => ({ ...current, deck: shuffleCards(current.deck) }));
    setDeckRevealed(false);
  }

  function resetBoard() {
    setZones({ ...emptyZones(), deck: shuffleCards(expandDeck(cards)) });
    setStatus(defaultStatus);
    setDeckRevealed(false);
    setSelected(null);
    setMessage("盤面をリセットして山札に戻しました。");
  }

  function clearAll() {
    localStorage.removeItem(STORAGE_KEY);
    setCards([]);
    setZones(emptyZones());
    setStatus(defaultStatus);
    setLoadedCode("");
    setDeckRevealed(false);
    setSelected(null);
    setMessage("保存データを消去しました。");
  }

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <p className="eyebrow">Pokemon Card Solo Practice</p>
          <h1>ポケカ一人回し</h1>
        </div>
        <div className="topbar-actions">
          <a className="page-link" href="./online.html">二人対戦へ</a>
          <div className="deck-summary">
            <span>{totalCards || zoneTotals}枚</span>
            {loadedCode && <small>deckID: {loadedCode}</small>}
          </div>
        </div>
      </header>

      <main>
        <section className="loader-panel" aria-label="デッキ読み込み">
          <div className="input-row">
            <label>
              <span>デッキコード / 公式URL</span>
              <input
                value={deckCode}
                onChange={(event) => setDeckCode(event.target.value)}
                placeholder="例: https://www.pokemon-card.com/deck/confirm.html/deckID/5F5ddk-lQut00-bVkvk1"
              />
            </label>
            <button className="primary" onClick={loadFromDeckCode} disabled={isLoading}>
              {isLoading ? <Loader2 className="spin" /> : <ArrowDownToLine />}
              読み込み
            </button>
          </div>

          <details>
            <summary>公式ページHTMLを貼り付けて読み込む</summary>
            <textarea
              value={html}
              onChange={(event) => setHtml(event.target.value)}
              placeholder="公式デッキ表示ページのHTMLをここに貼り付け"
            />
            <button onClick={loadFromHtml}>
              <ArrowDownToLine />
              HTMLから読み込み
            </button>
          </details>

          <p className={`message ${totalCards > 0 && totalCards !== 60 ? "warn" : ""}`}>
            {message}
            {totalCards > 0 && totalCards !== 60 && ` 現在 ${totalCards}枚です。公式の60枚デッキHTMLか確認してください。`}
          </p>
        </section>

        <section className="controls" aria-label="操作">
          <button onClick={shuffleDeck} disabled={!zones.deck.length}>
            <Shuffle />
            山札シャッフル
          </button>
          <button onClick={setupOpeningHand} disabled={zoneTotals < 7}>
            <Hand />
            初手7枚
          </button>
          <button onClick={() => draw(1)} disabled={!zones.deck.length}>
            <ArrowDownToLine />
            1枚ドロー
          </button>
          <button onClick={setupPrizes} disabled={zones.deck.length < 6}>
            <Sparkles />
            サイド6枚
          </button>
          <button onClick={resetBoard} disabled={!cards.length}>
            <RotateCcw />
            リセット
          </button>
          <button onClick={clearAll}>
            <Trash2 />
            保存消去
          </button>
        </section>

        <section className="status-panel" aria-label="状態異常">
          <span>バトル場</span>
          {Object.entries({
            poison: "どく",
            burn: "やけど",
            sleep: "ねむり",
            paralysis: "マヒ",
            confusion: "こんらん",
          } satisfies Record<keyof BattleStatus, string>).map(([key, label]) => (
            <button
              className={status[key as keyof BattleStatus] ? "status active" : "status"}
              key={key}
              onClick={() =>
                setStatus((current) => ({
                  ...current,
                  [key]: !current[key as keyof BattleStatus],
                }))
              }
            >
              <Flame />
              {label}
            </button>
          ))}
        </section>

        <section className="board">
          {(Object.keys(ZONE_LABELS) as ZoneKey[]).map((zone) => (
            <Zone
              key={zone}
              zone={zone}
              cards={zones[zone]}
              deckRevealed={deckRevealed}
              onRevealDeck={revealDeck}
              onCloseDeckReveal={closeDeckReveal}
              onCardClick={(card) => setSelected({ card, zone })}
              onDragStart={(uid) => setDragging({ uid, zone })}
              onDrop={() => {
                if (dragging) moveCard(dragging.uid, dragging.zone, zone);
                setDragging(null);
              }}
            />
          ))}
        </section>
      </main>

      {selected && (
        <CardModal
          selected={selected}
          deckRevealed={deckRevealed}
          onClose={() => setSelected(null)}
          onMove={(to) => moveCard(selected.card.uid, selected.zone, to)}
        />
      )}
    </div>
  );
}

function Zone({
  zone,
  cards,
  deckRevealed,
  onRevealDeck,
  onCloseDeckReveal,
  onCardClick,
  onDragStart,
  onDrop,
}: {
  zone: ZoneKey;
  cards: CardInstance[];
  deckRevealed: boolean;
  onRevealDeck: () => void;
  onCloseDeckReveal: () => void;
  onCardClick: (card: CardInstance) => void;
  onDragStart: (uid: string) => void;
  onDrop: () => void;
}) {
  const Icon = ZONE_ICONS[zone];
  const isFaceDown = FACE_DOWN_ZONES.has(zone) && !(zone === "deck" && deckRevealed);

  return (
    <article
      className={`zone zone-${zone}`}
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
    >
      <header>
        <h2>
          <Icon />
          {ZONE_LABELS[zone]}
        </h2>
        <div className="zone-header-actions">
          {zone === "deck" && cards.length > 0 && (
            deckRevealed ? (
              <button className="zone-action" onClick={onCloseDeckReveal}>
                閉じる
              </button>
            ) : (
              <button className="zone-action" onClick={onRevealDeck}>
                全展開
              </button>
            )
          )}
          <span>{cards.length}</span>
        </div>
      </header>
      <div className="card-grid">
        {cards.map((card) => (
          <button
            className={`card-tile ${isFaceDown ? "is-face-down" : ""}`}
            key={card.uid}
            draggable
            onDragStart={() => onDragStart(card.uid)}
            onClick={() => onCardClick(card)}
            aria-label={isFaceDown ? `${ZONE_LABELS[zone]}の裏向きカード` : card.name}
          >
            <img
              src={isFaceDown ? CARD_BACK_URL : card.imageUrl}
              alt={isFaceDown ? "ポケモンカード裏面" : card.name}
              loading="lazy"
            />
            <span>{isFaceDown ? "裏向き" : card.name}</span>
          </button>
        ))}
      </div>
    </article>
  );
}

function CardModal({
  selected,
  deckRevealed,
  onClose,
  onMove,
}: {
  selected: { card: CardInstance; zone: ZoneKey };
  deckRevealed: boolean;
  onClose: () => void;
  onMove: (to: ZoneKey) => void;
}) {
  const isFaceDown = FACE_DOWN_ZONES.has(selected.zone) && !(selected.zone === "deck" && deckRevealed);
  const displayName = isFaceDown ? "裏向きカード" : selected.card.name;

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <dialog className="card-modal" open onClick={(event) => event.stopPropagation()}>
        <div className="modal-image">
          <img
            src={isFaceDown ? CARD_BACK_URL : selected.card.imageUrl}
            alt={isFaceDown ? "ポケモンカード裏面" : selected.card.name}
          />
        </div>
        <div className="modal-actions">
          <div>
            <p>{ZONE_LABELS[selected.zone]}</p>
            <h3>{displayName}</h3>
          </div>
          <div className="move-grid">
            {(Object.keys(ZONE_LABELS) as ZoneKey[]).map((zone) => {
              const Icon = ZONE_ICONS[zone];
              return (
                <button
                  key={zone}
                  disabled={zone === selected.zone}
                  onClick={() => onMove(zone)}
                >
                  <Icon />
                  {ZONE_LABELS[zone]}へ
                </button>
              );
            })}
          </div>
          <button className="ghost" onClick={onClose}>
            <Eye />
            閉じる
          </button>
        </div>
      </dialog>
    </div>
  );
}

function shuffleCards<T>(items: T[]) {
  const copied = [...items];
  for (let index = copied.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1));
    [copied[index], copied[target]] = [copied[target], copied[index]];
  }
  return copied;
}
