import type { Card, CardInstance } from "./types";

const OFFICIAL_ORIGIN = "https://www.pokemon-card.com";

const DECK_FIELDS: Array<{ field: string; category?: Card["category"] }> = [
  { field: "deck_pke", category: "pokemon" },
  { field: "deck_gds", category: "trainer" },
  { field: "deck_tool", category: "trainer" },
  { field: "deck_tech", category: "trainer" },
  { field: "deck_sup", category: "trainer" },
  { field: "deck_sta", category: "trainer" },
  { field: "deck_ene", category: "energy" },
  { field: "deck_ajs" },
];

const CARD_IMAGE_HINTS = [
  "assets/images/card_images",
  "/card_images/",
  "images/card/",
  "card_image",
];

export function normalizeDeckCode(input: string) {
  const trimmed = input.trim();
  const deckIdMatch = trimmed.match(/deckID[=/]([A-Za-z0-9-]+)/);
  if (deckIdMatch) return deckIdMatch[1];
  return trimmed.replace(/^deckID[=/]/, "").replace(/\/+$/, "");
}

export function deckUrlsFromCode(input: string) {
  const code = normalizeDeckCode(input);
  return [
    `${OFFICIAL_ORIGIN}/deck/confirm.html/deckID/${code}`,
    `${OFFICIAL_ORIGIN}/deck/confirm.html/deckID/${code}/`,
  ];
}

export function parseDeckHtml(html: string): Card[] {
  const doc = new DOMParser().parseFromString(html, "text/html");

  const officialCards = cardsFromOfficialConfirmPage(doc, html);
  if (officialCards.length) return sortCards(officialCards);

  const fromImages = cardsFromImages(doc);
  if (fromImages.length) return sortCards(mergeCards(fromImages));

  return sortCards(mergeCards(cardsFromScripts(html)));
}

export function expandDeck(cards: Card[]): CardInstance[] {
  return cards.flatMap((card) =>
    Array.from({ length: card.count }, (_, index) => ({
      id: card.id,
      name: card.name,
      imageUrl: card.imageUrl,
      category: card.category,
      originalCount: card.count,
      uid: `${card.id}-${index + 1}-${crypto.randomUUID()}`,
    })),
  );
}

function cardsFromOfficialConfirmPage(doc: Document, html: string): Card[] {
  const names = parseOfficialMap(html, "searchItemNameAlt");
  const fallbackNames = parseOfficialMap(html, "searchItemName");
  const pictures = parseOfficialMap(html, "searchItemCardPict");
  const cards: Card[] = [];

  for (const { field, category } of DECK_FIELDS) {
    const value = doc.querySelector<HTMLInputElement>(`#${field}, input[name="${field}"]`)?.value || "";
    for (const entry of parseDeckField(value)) {
      const name = cleanName(names.get(entry.id) || fallbackNames.get(entry.id) || `カード ${entry.id}`);
      const imageUrl = absolutizeUrl(pictures.get(entry.id) || "");
      if (!imageUrl) continue;
      cards.push({
        id: entry.id,
        name,
        imageUrl,
        count: entry.count,
        category,
      });
    }
  }

  return mergeCards(cards);
}

function parseDeckField(value: string) {
  return value
    .split("-")
    .map((part) => {
      const [id, count] = part.split("_");
      return { id, count: Number(count) };
    })
    .filter((entry) => entry.id && entry.count > 0 && entry.count <= 60);
}

function parseOfficialMap(html: string, key: "searchItemName" | "searchItemNameAlt" | "searchItemCardPict") {
  const map = new Map<string, string>();
  const pattern = new RegExp(
    `PCGDECK\\.${key}\\[(\\d+)\\]\\s*=\\s*(['"])((?:\\\\.|(?!\\2).)*)\\2`,
    "g",
  );
  for (const match of html.matchAll(pattern)) {
    map.set(match[1], unescapeScriptString(match[3]));
  }
  return map;
}

function cardsFromImages(doc: Document): Card[] {
  const images = Array.from(doc.querySelectorAll("img"));
  const candidates = images.filter((image) => {
    const src = absolutizeUrl(image.getAttribute("src") || image.getAttribute("data-src") || "");
    const alt = image.getAttribute("alt") || "";
    return CARD_IMAGE_HINTS.some((hint) => src.includes(hint)) || /ポケモン|エネルギー|グッズ|サポート|スタジアム/.test(alt);
  });

  return candidates.map((image, index) => {
    const src = absolutizeUrl(image.getAttribute("src") || image.getAttribute("data-src") || "");
    const parentText = closestUsefulText(image);
    const name =
      cleanName(image.getAttribute("alt")) ||
      cleanName(image.getAttribute("title")) ||
      cleanName(parentText.replace(/[x×＊*]?\s*\d+\s*枚?/g, "")) ||
      `カード ${index + 1}`;
    const count = countNearImage(image) || countFromText(parentText) || 1;
    return {
      id: stableId(name, src),
      name,
      imageUrl: src,
      count,
      category: inferCategory(`${name} ${parentText}`),
    };
  });
}

function cardsFromScripts(html: string): Card[] {
  const imageRegex = /https?:\\?\/\\?\/www\.pokemon-card\.com\\?\/assets\\?\/images\\?\/card_images\\?\/[^"'\\\s<]+|\\?\/assets\\?\/images\\?\/card_images\\?\/[^"'\\\s<]+/g;
  const images = Array.from(new Set(html.match(imageRegex) || [])).map((url) => absolutizeUrl(url.replaceAll("\\/", "/")));
  return images.map((imageUrl, index) => {
    const nearby = html.slice(Math.max(0, html.indexOf(imageUrl) - 500), html.indexOf(imageUrl) + 500);
    const name =
      cleanName(matchFirst(nearby, /"card_name"\s*:\s*"([^"]+)"/)) ||
      cleanName(matchFirst(nearby, /"name"\s*:\s*"([^"]+)"/)) ||
      cleanName(matchFirst(nearby, /alt=["']([^"']+)["']/)) ||
      `カード ${index + 1}`;
    const count =
      Number(matchFirst(nearby, /"num"\s*:\s*"?(\d+)"?/)) ||
      Number(matchFirst(nearby, /"count"\s*:\s*"?(\d+)"?/)) ||
      countFromText(nearby) ||
      1;
    return {
      id: stableId(name, imageUrl),
      name,
      imageUrl,
      count,
      category: inferCategory(nearby),
    };
  });
}

function mergeCards(cards: Card[]) {
  const byId = new Map<string, Card>();
  for (const card of cards) {
    if (!card.imageUrl) continue;
    const existing = byId.get(card.id);
    if (!existing) {
      byId.set(card.id, { ...card });
      continue;
    }
    existing.count = Math.max(existing.count, card.count);
    existing.name = existing.name.startsWith("カード ") ? card.name : existing.name;
    existing.category ||= card.category;
  }
  return Array.from(byId.values());
}

function countNearImage(image: HTMLImageElement) {
  const selectors = ["input", "select", "[data-count]", ".num", ".count"];
  for (const selector of selectors) {
    const element = image.closest("li, tr, .card, .deck, div")?.querySelector(selector);
    const value = element?.getAttribute("value") || element?.getAttribute("data-count") || element?.textContent || "";
    const count = Number(value.match(/\d+/)?.[0]);
    if (count > 0 && count <= 60) return count;
  }
  return 0;
}

function closestUsefulText(element: Element) {
  const parent = element.closest("li, tr, article, .card, .deckCard, .List, div");
  return normalizeSpaces(parent?.textContent || "");
}

function countFromText(text: string) {
  const normalized = normalizeSpaces(text);
  const match = normalized.match(/(?:[x×*]\s*|枚数[:：]?\s*|num["']?\s*[:=]\s*["']?)(\d{1,2})|(\d{1,2})\s*枚/);
  const count = Number(match?.[1] || match?.[2] || 0);
  return count > 0 && count <= 60 ? count : 0;
}

function inferCategory(text: string): Card["category"] {
  if (/エネルギー|基本[^\s]*エネルギー|特殊[^\s]*エネルギー|_E_/i.test(text)) return "energy";
  if (/グッズ|サポート|スタジアム|ポケモンのどうぐ|トレーナーズ|trainer|_T_/i.test(text)) return "trainer";
  if (/ポケモン|ex|VSTAR|VMAX|GX|たね|進化|_P_/i.test(text)) return "pokemon";
  return undefined;
}

function sortCards(cards: Card[]) {
  return cards.sort((a, b) => categoryRank(a) - categoryRank(b) || a.name.localeCompare(b.name, "ja"));
}

function categoryRank(card: Card) {
  if (card.category === "pokemon") return 0;
  if (card.category === "trainer") return 1;
  if (card.category === "energy") return 2;
  return 3;
}

function absolutizeUrl(url: string) {
  if (!url) return "";
  const cleaned = url.replaceAll("\\/", "/");
  if (cleaned.startsWith("//")) return `https:${cleaned}`;
  if (cleaned.startsWith("/")) return `${OFFICIAL_ORIGIN}${cleaned}`;
  return cleaned;
}

function cleanName(value: string | null | undefined) {
  return normalizeSpaces(value || "")
    .replace(/^画像[:：]?\s*/, "")
    .replace(/\s*(?:カード画像|画像)$/g, "")
    .trim();
}

function normalizeSpaces(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function stableId(name: string, imageUrl: string) {
  const file = imageUrl.split("/").pop()?.replace(/\W+/g, "-") || "";
  return `${name}-${file}`.replace(/\s+/g, "-");
}

function matchFirst(value: string, regex: RegExp) {
  return value.match(regex)?.[1];
}

function unescapeScriptString(value: string) {
  return value
    .replace(/\\(['"\\])/g, "$1")
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, code) => String.fromCharCode(parseInt(code, 16)));
}
