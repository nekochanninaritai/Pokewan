export type Card = {
  id: string;
  name: string;
  imageUrl: string;
  count: number;
  category?: "pokemon" | "trainer" | "energy";
  role?: "pokemonTool";
};

export type CardInstance = Omit<Card, "count"> & {
  uid: string;
  originalCount: number;
};

export type ZoneKey =
  | "deck"
  | "hand"
  | "prizes"
  | "battle"
  | "bench"
  | "trash"
  | "lost";

export type Zones = Record<ZoneKey, CardInstance[]>;

export type BattleStatus = {
  poison: boolean;
  burn: boolean;
  sleep: boolean;
  paralysis: boolean;
  confusion: boolean;
};
