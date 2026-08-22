import { useState, useRef, useEffect } from "react";

type Dir = "up" | "down" | "left" | "right";

interface Tile {
  id: number;
  value: number;
  row: number;
  col: number;
  slideValue?: number; // the value to display while the slide animation runs
  dying?: boolean; // absorbed by a merge, removed after the slide
  merged?: boolean; // survivor of a merge this move (pop animation)
  justSpawned?: boolean; // brand-new random tile (appear animation)
}

const SLIDE_MS = 120;
const DELAYS: Record<"slow" | "normal" | "fast", number> = {
  slow: 1000,
  normal: 520,
  fast: 300,
};

// Flat-board helpers for the auto-play AI. Cells hold tile values (0 = empty).
const DIRS: Dir[] = ["left", "up", "right", "down"];
const FLAT_LINES: Record<Dir, number[][]> = {
  left: [[0, 1, 2, 3], [4, 5, 6, 7], [8, 9, 10, 11], [12, 13, 14, 15]],
  right: [[3, 2, 1, 0], [7, 6, 5, 4], [11, 10, 9, 8], [15, 14, 13, 12]],
  up: [[0, 4, 8, 12], [1, 5, 9, 13], [2, 6, 10, 14], [3, 7, 11, 15]],
  down: [[12, 8, 4, 0], [13, 9, 5, 1], [14, 10, 6, 2], [15, 11, 7, 3]],
};

let nextId = 2;

function getLines(dir: Dir): { row: number; col: number }[][] {
  const lines: { row: number; col: number }[][] = [];
  if (dir === "left") for (let r = 0; r < 4; r++) lines.push([0, 1, 2, 3].map((c) => ({ row: r, col: c })));
  if (dir === "right") for (let r = 0; r < 4; r++) lines.push([3, 2, 1, 0].map((c) => ({ row: r, col: c })));
  if (dir === "up") for (let c = 0; c < 4; c++) lines.push([0, 1, 2, 3].map((r) => ({ row: r, col: c })));
  if (dir === "down") for (let c = 0; c < 4; c++) lines.push([3, 2, 1, 0].map((r) => ({ row: r, col: c })));
  return lines;
}

function computeMove(tiles: Tile[], dir: Dir) {
  const active = tiles.filter((t) => !t.dying);
  const index = new Map<number, Tile>();
  for (const t of active) index.set(t.row * 4 + t.col, t);

  const result: Tile[] = [];
  let moved = false;
  let gained = 0;

  for (const line of getLines(dir)) {
    const inLine: Tile[] = [];
    for (const { row, col } of line) {
      const t = index.get(row * 4 + col);
      if (t) inLine.push(t);
    }
    let outCount = 0;
    let i = 0;
    while (i < inLine.length) {
      const t = inLine[i];
      const nxt = inLine[i + 1];
      if (nxt && nxt.value === t.value) {
        const target = line[outCount];
        result.push({ ...t, row: target.row, col: target.col, value: t.value * 2, slideValue: t.value, merged: true });
        result.push({ ...nxt, row: target.row, col: target.col, dying: true });
        gained += t.value * 2;
        moved = true;
        outCount++;
        i += 2;
      } else {
        const target = line[outCount];
        result.push({ ...t, row: target.row, col: target.col });
        if (t.row !== target.row || t.col !== target.col) moved = true;
        outCount++;
        i += 1;
      }
    }
  }
  return { tiles: result, moved, gained };
}

function applyMoveFlat(board: number[], dir: Dir): number[] | null {
  const b = board.slice();
  let moved = false;
  for (const line of FLAT_LINES[dir]) {
    let w = 0;
    let prev = 0;
    for (let k = 0; k < 4; k++) {
      const v = b[line[k]];
      if (!v) continue;
      if (prev === v) {
        b[line[w - 1]] = v * 2;
        prev = 0;
        moved = true;
      } else {
        b[line[w]] = v;
        w++;
        prev = v;
        if (line[k] !== line[w - 1]) moved = true;
      }
    }
    for (let k = w; k < 4; k++) b[line[k]] = 0;
  }
  return moved ? b : null;
}

function evalFlat(board: number[]): number {
  let empty = 0;
  for (let i = 0; i < 16; i++) if (!board[i]) empty++;

  const mono = [0, 0, 0, 0];
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      const cur = board[r * 4 + c];
      if (c < 3) {
        const n = board[r * 4 + c + 1];
        if (cur && n) {
          if (cur >= n) mono[0]++;
          else mono[0]--;
          if (cur <= n) mono[1]++;
          else mono[1]--;
        }
      }
      if (r < 3) {
        const n = board[(r + 1) * 4 + c];
        if (cur && n) {
          if (cur >= n) mono[2]++;
          else mono[2]--;
          if (cur <= n) mono[3]++;
          else mono[3]--;
        }
      }
    }
  }
  const monoScore = Math.max(mono[0], mono[1], mono[2], mono[3]);

  let smooth = 0;
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      const cur = board[r * 4 + c];
      if (!cur) continue;
      if (c < 3) {
        const n = board[r * 4 + c + 1];
        if (n) smooth += Math.abs(Math.log2(cur) - Math.log2(n));
      }
      if (r < 3) {
        const n = board[(r + 1) * 4 + c];
        if (n) smooth += Math.abs(Math.log2(cur) - Math.log2(n));
      }
    }
  }

  let maxv = 0;
  for (let i = 0; i < 16; i++) if (board[i] > maxv) maxv = board[i];
  let cornerMax = 0;
  if (board[0] === maxv || board[3] === maxv || board[12] === maxv || board[15] === maxv) cornerMax = Math.log2(maxv);

  return empty * 270 + monoScore * 47 - smooth + cornerMax * 30;
}

// Expectimax: the player picks a move, then the game drops a random tile (0.9 two / 0.1 four).
function expectimax(board: number[], depth: number): number {
  if (depth === 0) return evalFlat(board);
  let best = -Infinity;
  let any = false;
  for (const dir of DIRS) {
    const nb = applyMoveFlat(board, dir);
    if (!nb) continue;
    any = true;
    const v = chanceFlat(nb, depth);
    if (v > best) best = v;
  }
  return any ? best : evalFlat(board);
}

function chanceFlat(board: number[], depth: number): number {
  const empties: number[] = [];
  for (let i = 0; i < 16; i++) if (!board[i]) empties.push(i);
  if (empties.length === 0) return evalFlat(board);
  let total = 0;
  for (const i of empties) {
    const b2 = board.slice();
    b2[i] = 2;
    const b4 = board.slice();
    b4[i] = 4;
    total += 0.9 * expectimax(b2, depth - 1) + 0.1 * expectimax(b4, depth - 1);
  }
  return total / empties.length;
}

function bestMove(tiles: Tile[]): Dir | null {
  const board = new Array(16).fill(0);
  for (const t of tiles) if (!t.dying) board[t.row * 4 + t.col] = t.value;

  let empties = 0;
  for (let i = 0; i < 16; i++) if (!board[i]) empties++;
  // Early on the board is open and cheap shallow search is plenty; deepen as it fills.
  const depth = empties >= 10 ? 2 : 3;

  let best: Dir | null = null;
  let bestScore = -Infinity;
  for (const dir of DIRS) {
    const nb = applyMoveFlat(board, dir);
    if (!nb) continue;
    const v = chanceFlat(nb, depth);
    if (v > bestScore) {
      bestScore = v;
      best = dir;
    }
  }
  return best;
}

function hasAnyMove(tiles: Tile[]): boolean {
  return (["left", "right", "up", "down"] as Dir[]).some((d) => computeMove(tiles, d).moved);
}

function addRandomTile(tiles: Tile[]): Tile[] {
  const occupied = new Set(tiles.map((t) => t.row * 4 + t.col));
  const empty: { row: number; col: number }[] = [];
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) if (!occupied.has(r * 4 + c)) empty.push({ row: r, col: c });
  if (empty.length === 0) return tiles;
  const { row, col } = empty[Math.floor(Math.random() * empty.length)];
  const value = Math.random() < 0.9 ? 2 : 4;
  return [...tiles, { id: nextId++, value, row, col, justSpawned: true }];
}

function freshBoard(): Tile[] {
  let t: Tile[] = [];
  t = addRandomTile(t);
  t = addRandomTile(t);
  return t;
}

const TILE_COLORS: Record<number, { bg: string; fg: string }> = {
  2: { bg: "#eee4da", fg: "#776e65" },
  4: { bg: "#ede0c8", fg: "#776e65" },
  8: { bg: "#f2b179", fg: "#f9f6f2" },
  16: { bg: "#f59563", fg: "#f9f6f2" },
  32: { bg: "#f67c5f", fg: "#f9f6f2" },
  64: { bg: "#f65e3b", fg: "#f9f6f2" },
  128: { bg: "#edcf72", fg: "#f9f6f2" },
  256: { bg: "#edcc61", fg: "#f9f6f2" },
  512: { bg: "#edc850", fg: "#f9f6f2" },
  1024: { bg: "#edc53f", fg: "#f9f6f2" },
  2048: { bg: "#edc22e", fg: "#f9f6f2" },
};

function tileStyle(v: number) {
  if (v > 2048) return { bg: "#3c3a32", fg: "#f9f6f2" };
  return TILE_COLORS[v] ?? { bg: "#cdc1b4", fg: "#f9f6f2" };
}

function fontSize(v: number): string {
  const n = String(v).length;
  if (n >= 5) return "4.6cqi";
  if (n === 4) return "6cqi";
  if (n === 3) return "6.8cqi";
  return "8.4cqi";
}

export default function Answer() {
  const tilesRef = useRef<Tile[]>([]);
  const scoreRef = useRef(0);
  const bestRef = useRef(0);
  const statusRef = useRef<"playing" | "won" | "over">("playing");
  const demoOnRef = useRef(false);
  const speedRef = useRef<"slow" | "normal" | "fast">("normal");
  const animatingRef = useRef(false);
  const wonOnceRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mergeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchRef = useRef<{ x: number; y: number } | null>(null);
  const doMoveRef = useRef<(dir: Dir) => boolean>(() => false);

  const [tiles, setTiles] = useState<Tile[]>(() => freshBoard());
  const [score, setScore] = useState(0);
  const [best, setBest] = useState<number>(() => {
    try {
      return Number(localStorage.getItem("dsh-2048-best")) || 0;
    } catch {
      return 0;
    }
  });
  const [status, setStatus] = useState<"playing" | "won" | "over">("playing");
  const [demoOn, setDemoOn] = useState(false);
  const [speed, setSpeed] = useState<"slow" | "normal" | "fast">("normal");

  statusRef.current = status;
  demoOnRef.current = demoOn;
  speedRef.current = speed;
  bestRef.current = best;

  useEffect(() => {
    tilesRef.current = tiles;
  }, [tiles]);

  function commit(next: Tile[]) {
    tilesRef.current = next;
    setTiles(next);
  }

  function addScore(gained: number) {
    scoreRef.current += gained;
    setScore(scoreRef.current);
    if (scoreRef.current > bestRef.current) {
      bestRef.current = scoreRef.current;
      setBest(scoreRef.current);
      try {
        localStorage.setItem("dsh-2048-best", String(scoreRef.current));
      } catch {}
    }
  }

  function doMove(dir: Dir): boolean {
    if (animatingRef.current) return false;
    const base = tilesRef.current.map((t) => ({ ...t, merged: false, justSpawned: false }));
    const res = computeMove(base, dir);
    if (!res.moved) return false;

    animatingRef.current = true;
    commit(res.tiles);

    if (mergeTimerRef.current) clearTimeout(mergeTimerRef.current);
    mergeTimerRef.current = setTimeout(() => {
      let next: Tile[] = tilesRef.current.filter((t) => !t.dying).map((t) => ({ ...t, slideValue: undefined }));
      next = addRandomTile(next);
      commit(next);
      animatingRef.current = false;
      addScore(res.gained);

      if (next.some((t) => t.value >= 2048) && !wonOnceRef.current) {
        wonOnceRef.current = true;
        setStatus("won");
        setDemoOn(false);
      } else if (!hasAnyMove(next)) {
        setStatus("over");
        setDemoOn(false);
      }
    }, SLIDE_MS);
    return true;
  }
  doMoveRef.current = doMove;

  function newGame() {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (mergeTimerRef.current) clearTimeout(mergeTimerRef.current);
    animatingRef.current = false;
    wonOnceRef.current = false;
    scoreRef.current = 0;
    setScore(0);
    setStatus("playing");
    setDemoOn(false);
    commit(freshBoard());
  }

  function press(dir: Dir) {
    if (statusRef.current !== "playing" || animatingRef.current) return;
    if (demoOnRef.current) setDemoOn(false);
    doMoveRef.current(dir);
  }

  function toggleDemo() {
    if (demoOnRef.current) {
      setDemoOn(false);
      return;
    }
    if (statusRef.current !== "playing") newGame();
    setDemoOn(true);
  }

  // Keyboard controls.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const map: Record<string, Dir> = {
        ArrowUp: "up",
        ArrowDown: "down",
        ArrowLeft: "left",
        ArrowRight: "right",
        w: "up",
        s: "down",
        a: "left",
        d: "right",
      };
      const dir = map[e.key];
      if (!dir) return;
      e.preventDefault();
      if (statusRef.current !== "playing" || animatingRef.current) return;
      if (demoOnRef.current) setDemoOn(false);
      doMoveRef.current(dir);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Auto-play demo loop.
  useEffect(() => {
    if (!demoOn) return;
    let cancelled = false;
    function tick() {
      if (cancelled) return;
      if (statusRef.current !== "playing") {
        setDemoOn(false);
        return;
      }
      const dir = bestMove(tilesRef.current);
      if (!dir) {
        setDemoOn(false);
        setStatus("over");
        return;
      }
      doMoveRef.current(dir);
      timerRef.current = setTimeout(tick, DELAYS[speedRef.current]);
    }
    timerRef.current = setTimeout(tick, 350);
    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [demoOn]);

  // Clean up on unmount.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (mergeTimerRef.current) clearTimeout(mergeTimerRef.current);
    };
  }, []);

  // Touch swipe.
  function onTouchStart(e: React.TouchEvent) {
    const t = e.touches[0];
    touchRef.current = { x: t.clientX, y: t.clientY };
  }
  function onTouchEnd(e: React.TouchEvent) {
    if (!touchRef.current) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchRef.current.x;
    const dy = t.clientY - touchRef.current.y;
    touchRef.current = null;
    if (Math.abs(dx) < 20 && Math.abs(dy) < 20) return;
    if (Math.abs(dx) > Math.abs(dy)) press(dx > 0 ? "right" : "left");
    else press(dy > 0 ? "down" : "up");
  }

  const overlay =
    status === "over"
      ? { title: "游戏结束", sub: `本局得分 ${score}`, actions: [{ label: "再来一局", fn: newGame }] }
      : status === "won"
      ? {
          title: "你赢了！",
          sub: "拼出了 2048，还可以继续",
          actions: [
            { label: "继续游戏", fn: () => setStatus("playing") },
            { label: "重新开始", fn: newGame },
          ],
        }
      : null;

  return (
    <div className="wrap">
      <div className="inner">
        <header className="header">
          <h1 className="title">2048</h1>
          <div className="scores">
            <div className="score-box">
              <span className="slabel">分数</span>
              <span className="snum">{score}</span>
            </div>
            <div className="score-box">
              <span className="slabel">最高</span>
              <span className="snum">{best}</span>
            </div>
          </div>
        </header>

        <div className="board-wrap">
          <div className="board" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
            <div className="cell-grid">
              {Array.from({ length: 16 }).map((_, i) => (
                <div key={i} className="cell" />
              ))}
            </div>

            {tiles.map((t) => {
              const dv = t.slideValue ?? t.value;
              const st = tileStyle(dv);
              const anim = t.justSpawned ? "appear" : t.merged ? "pop" : "";
              return (
                <div
                  key={t.id}
                  className={`tile-pos ${t.dying ? "dying" : ""}`}
                  style={{ left: `${2 + t.col * 24.5}%`, top: `${2 + t.row * 24.5}%` }}
                >
                  <div
                    key={dv}
                    className={`tile ${anim}`}
                    style={{ background: st.bg, color: st.fg, fontSize: fontSize(dv) }}
                  >
                    {dv}
                  </div>
                </div>
              );
            })}

            {overlay && (
              <div className="overlay">
                <div className="overlay-card">
                  <div className="overlay-title">{overlay.title}</div>
                  <div className="overlay-sub">{overlay.sub}</div>
                  <div className="overlay-actions">
                    {overlay.actions.map((a) => (
                      <button key={a.label} className="btn primary" onClick={a.fn}>
                        {a.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <p className="hint">
          {demoOn ? "● 自动演示中 — 点「暂停演示」即可打断" : "方向键 / WASD / 滑动 操作"}
        </p>

        <div className="controls">
          <button className="btn" onClick={newGame}>
            重新开始
          </button>
          <button className={`btn primary ${demoOn ? "paused" : ""}`} onClick={toggleDemo}>
            {demoOn ? "暂停演示" : "自动演示"}
          </button>
          <div className="seg" role="group" aria-label="演示速度">
            {(["slow", "normal", "fast"] as const).map((s) => (
              <button key={s} className={`seg-btn ${speed === s ? "on" : ""}`} onClick={() => setSpeed(s)}>
                {s === "slow" ? "慢" : s === "normal" ? "中" : "快"}
              </button>
            ))}
          </div>
        </div>
      </div>

      <style>{`
        .wrap {
          height: 100%;
          overflow: auto;
          display: flex;
          box-sizing: border-box;
        }
        .inner {
          margin: auto;
          width: 100%;
          max-width: 420px;
          display: flex;
          flex-direction: column;
          gap: 14px;
          padding: 20px 16px;
          box-sizing: border-box;
        }
        .header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }
        .title {
          margin: 0;
          font-size: 34px;
          font-weight: 800;
          letter-spacing: 0.5px;
          color: var(--dsw-alias-label-primary);
        }
        .scores {
          display: flex;
          gap: 8px;
        }
        .score-box {
          min-width: 64px;
          padding: 8px 12px;
          border-radius: 10px;
          background: var(--dsw-alias-bg-layer-1);
          border: 1px solid var(--dsw-alias-border-l1);
          display: flex;
          flex-direction: column;
          align-items: center;
        }
        .slabel {
          font-size: 11px;
          color: var(--dsw-alias-label-secondary);
        }
        .snum {
          font-size: 18px;
          font-weight: 700;
          color: var(--dsw-alias-label-primary);
          font-variant-numeric: tabular-nums;
        }

        .board-wrap {
          width: 100%;
        }
        .board {
          position: relative;
          width: 100%;
          aspect-ratio: 1 / 1;
          background: rgba(127, 127, 127, 0.06);
          border: 1px solid var(--dsw-alias-border-l1);
          border-radius: 14px;
          container-type: inline-size;
          touch-action: none;
        }
        .cell-grid {
          position: absolute;
          inset: 0;
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          grid-template-rows: repeat(4, 1fr);
          gap: 2%;
          padding: 2%;
        }
        .cell {
          background: rgba(127, 127, 127, 0.12);
          border-radius: 8px;
        }

        .tile-pos {
          position: absolute;
          width: 22.5%;
          height: 22.5%;
          transition: left ${SLIDE_MS}ms ease, top ${SLIDE_MS}ms ease;
        }
        .tile-pos.dying {
          z-index: 0;
        }
        .tile {
          width: 100%;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 8px;
          font-weight: 800;
          line-height: 1;
        }
        .tile.appear {
          animation: appear 160ms ease-out;
        }
        .tile.pop {
          animation: pop 180ms ease;
        }
        @keyframes appear {
          from { transform: scale(0); }
          to { transform: scale(1); }
        }
        @keyframes pop {
          0% { transform: scale(1); }
          50% { transform: scale(1.18); }
          100% { transform: scale(1); }
        }

        .hint {
          margin: 0;
          text-align: center;
          font-size: 13px;
          color: var(--dsw-alias-label-secondary);
        }

        .controls {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          flex-wrap: wrap;
        }
        .btn {
          padding: 8px 14px;
          border-radius: 10px;
          border: 1px solid var(--dsw-alias-border-l1);
          background: var(--dsw-alias-bg-layer-1);
          color: var(--dsw-alias-label-primary);
          font-size: 14px;
          cursor: pointer;
          transition: background 120ms ease;
        }
        .btn:hover {
          background: var(--dsw-alias-interactive-bg-hover);
        }
        .btn.primary {
          background: var(--dsw-alias-state-business-primary);
          border-color: transparent;
          color: #fff;
        }
        .btn.primary:hover {
          filter: brightness(1.06);
        }
        .btn.primary.paused {
          background: var(--dsw-alias-state-warn-primary);
        }

        .seg {
          display: flex;
          border: 1px solid var(--dsw-alias-border-l1);
          border-radius: 10px;
          overflow: hidden;
        }
        .seg-btn {
          padding: 8px 12px;
          border: none;
          background: var(--dsw-alias-bg-layer-1);
          color: var(--dsw-alias-label-secondary);
          font-size: 14px;
          cursor: pointer;
        }
        .seg-btn + .seg-btn {
          border-left: 1px solid var(--dsw-alias-border-l1);
        }
        .seg-btn.on {
          background: var(--dsw-alias-state-business-primary);
          color: #fff;
        }

        .overlay {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(0, 0, 0, 0.35);
          border-radius: 14px;
          z-index: 5;
        }
        .overlay-card {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 10px;
          padding: 22px 26px;
          border-radius: 14px;
          background: var(--dsw-alias-bg-layer-1);
          border: 1px solid var(--dsw-alias-border-l1);
          box-shadow: 0 8px 30px rgba(0, 0, 0, 0.2);
        }
        .overlay-title {
          font-size: 22px;
          font-weight: 800;
          color: var(--dsw-alias-label-primary);
        }
        .overlay-sub {
          font-size: 14px;
          color: var(--dsw-alias-label-secondary);
        }
        .overlay-actions {
          display: flex;
          gap: 8px;
        }

        @media (prefers-reduced-motion: reduce) {
          .tile-pos { transition: none; }
          .tile.appear, .tile.pop { animation: none; }
        }
      `}</style>
    </div>
  );
}
