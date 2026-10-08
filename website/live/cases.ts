/**
 * The four sessions the stage plays, one per selling point in the UI4A brief. Each card is a real
 * `.tsx` file next to this one, loaded as text and streamed into partial-react — what you see on the
 * page is the plugin's pipeline running, not a recording of it.
 */
import budget from "../cards/budget.tsx?raw";
import orbit from "../cards/orbit.tsx?raw";
import breakout from "../cards/breakout.tsx?raw";
import interest from "../cards/interest.tsx?raw";
import { centerOf, type Cursor } from "./cursor.ts";
import type { Clock } from "./clock.ts";
import type { IconName } from "../ui/icons.tsx";

export type Ctx = { clock: Clock; cursor: Cursor; q: (selector: string, text?: string) => HTMLElement | null };

export type Case = {
  id: string;
  /** The tab label under the stage, and which point of the brief it proves. */
  tab: string;
  point: string;
  session: string;
  prompt: string;
  tools: [IconName, string, string][];
  lead: string;
  file: string;
  source: string;
  surface: "inline" | "canvas";
  /** What the cursor does — started when streaming starts, so it acts on a card still being written. */
  play: (ctx: Ctx) => Promise<void>;
};

/** React Aria nests the range input in a visually-hidden div inside the thumb; the thumb is two levels up. */
const thumb = (q: Ctx["q"]) => () => q("input[type=range]")?.parentElement?.parentElement ?? null;
/** A point `f` of the way along the knob's track — where a drag should end. */
const along = (knob: () => HTMLElement | null, f: number) => () => {
  const t = knob()?.parentElement?.getBoundingClientRect();
  return t ? { x: t.left + t.width * f, y: t.top + t.height / 2 } : null;
};

export const CASES: Case[] = [
  {
    id: "breakout",
    tab: "Playable while streaming",
    point: "The board, then the paddle, then the bricks row by row, then physics — it is a game from the third line on.",
    session: "Something fun",
    prompt: "bored. make me a tiny game",
    tools: [["skill", "Skill", "generative-ui"]],
    lead: "Breakout — move inside the board to steer.",
    file: "breakout.ui4a.tsx",
    source: breakout,
    surface: "inline",
    async play({ clock, cursor, q }) {
      await clock.until(() => q("[data-board]"));
      const board = () => q("[data-board]");
      const ball = () => q("[data-ball]");
      await cursor.glide(centerOf(board, 0.5, 0.88));
      await clock.until(() => ball(), 50);
      await cursor.follow(() => {
        const b = ball()?.getBoundingClientRect();
        const r = board()?.getBoundingClientRect();
        return r ? { x: b ? b.left + b.width / 2 : r.left + r.width / 2, y: r.top + r.height * 0.9 } : null;
      }, 9000);
    },
  },
  {
    id: "budget",
    tab: "Interact mid-stream",
    point: "The slider works before the card is finished — the model is still typing the totals below it.",
    session: "Tokyo trip budget",
    prompt: "how much is 4 nights in Tokyo?",
    tools: [["context", "Context injection", "skill-catalog"], ["skill", "Skill", "generative-ui"]],
    lead: "Depends on where you sleep — drag it and see:",
    file: "budget.ui4a.tsx",
    source: budget,
    surface: "inline",
    async play({ clock, cursor, q }) {
      await clock.until(() => q("input[type=range]"));
      const knob = thumb(q);
      await cursor.drag(centerOf(knob), along(knob, 0.72), () => knob()?.parentElement ?? null);
      await clock.until(() => q("button", "ryokan"));
      await cursor.click(centerOf(() => q("button", "ryokan")));
      await clock.wait(500);
      await cursor.click(centerOf(() => q("button", "hostel")));
    },
  },
  {
    id: "orbit",
    tab: "Declarative 3D",
    point: "`@react-three/fiber` from esm.sh, no install. A whole file in the canvas panel, not a reply.",
    session: "Earth–Moon model",
    prompt: "make me a little earth–moon model I can keep open",
    tools: [["skill", "Skill", "generative-ui"], ["edit", "Write", ".dsh/ui4a/canvases/orbit.ui4a.tsx"]],
    lead: "Opened it in the canvas — it stays there while we talk.",
    file: "orbit.ui4a.tsx",
    source: orbit,
    surface: "canvas",
    async play({ clock, cursor, q }) {
      await clock.until(() => q("canvas") && q("input[type=range]"));
      const knob = thumb(q);
      await cursor.drag(centerOf(knob), along(knob, 0.9), () => knob()?.parentElement ?? null);
      await clock.until(() => q("label", "Orbit"));
      await clock.wait(900);
      await cursor.click(centerOf(() => q("label", "Orbit"), 0.2));
      await clock.wait(700);
      await cursor.click(centerOf(() => q("label", "Orbit"), 0.2));
    },
  },
  {
    id: "interest",
    tab: "Any npm package, wired to the host",
    point: "KaTeX and NumberFlow straight from npm; the answer persists, and one click starts the next turn.",
    session: "Savings, then a trip",
    prompt: "what does 2k at 5% become?",
    tools: [["skill", "Skill", "generative-ui"]],
    lead: "Here's the curve — the button hands the result back to me.",
    file: "interest.ui4a.tsx",
    source: interest,
    surface: "inline",
    async play({ clock, cursor, q }) {
      await clock.until(() => q("input[type=range]"));
      const knob = thumb(q);
      await cursor.drag(centerOf(knob), along(knob, 0.62), () => knob()?.parentElement ?? null);
      await clock.until(() => q("button", "Spend the interest"));
      await clock.wait(600);
      await cursor.click(centerOf(() => q("button", "Spend the interest")));
    },
  },
];
