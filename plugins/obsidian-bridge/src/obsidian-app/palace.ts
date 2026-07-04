import type { RoomCard } from "../shared/protocol.ts";

const SECTION_TITLES: Record<keyof RoomCard, RegExp> = {
  trigger: /^##\s*触发场景/m,
  mustRead: /^##\s*必读(（按顺序）|\(按顺序\))?/m,
  conditionalRead: /^##\s*条件读/m,
  outputLocation: /^##\s*输出位置/m,
  pitfalls: /^##\s*坑\s*\/\s*禁区/m,
};

function splitList(block: string): string[] {
  return block
    .split("\n")
    .map((l) => l.replace(/^\s*[-*]\s*/, "").trim())
    .filter(Boolean);
}

export function parseRoomCard(markdown: string): RoomCard {
  const card: RoomCard = {
    trigger: "",
    mustRead: [],
    conditionalRead: [],
    outputLocation: "",
    pitfalls: [],
  };
  const keys = Object.keys(SECTION_TITLES) as (keyof RoomCard)[];
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const startMatch = markdown.match(SECTION_TITLES[key]);
    if (!startMatch || startMatch.index === undefined) continue;
    const start = startMatch.index + startMatch[0].length;
    const nextIdx = keys
      .slice(i + 1)
      .map((k) => markdown.slice(start).match(SECTION_TITLES[k]))
      .find((m) => m && m.index !== undefined);
    const end =
      nextIdx && nextIdx.index !== undefined ? start + nextIdx.index : markdown.length;
    const block = markdown.slice(start, end).trim();
    if (key === "trigger" || key === "outputLocation") {
      (card[key] as string) = block;
    } else {
      (card[key] as string[]) = splitList(block);
    }
  }
  return card;
}
