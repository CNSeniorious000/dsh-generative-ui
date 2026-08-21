import { useCallback, useMemo, useRef, useState } from "react";

type FieldKey = "minute" | "hour" | "dom" | "month" | "dow";

type Parsed = { values: number[]; isStar: boolean; step: number | null; raw: string };

const MONTH_NAMES = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const DOW_NAMES = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const DOW_CN = ["日", "一", "二", "三", "四", "五", "六"];

const SPECS: { key: FieldKey; label: string; min: number; max: number; names: string[] | null; presets: { v: string; t: string }[] }[] = [
  { key: "minute", label: "分钟", min: 0, max: 59, names: null, presets: [{ v: "*", t: "每分钟" }, { v: "0", t: "整点" }, { v: "0,30", t: "0/30 分" }, { v: "*/5", t: "每 5 分钟" }, { v: "*/15", t: "每 15 分钟" }, { v: "*/17", t: "每 17 分钟" }] },
  { key: "hour", label: "小时", min: 0, max: 23, names: null, presets: [{ v: "*", t: "每小时" }, { v: "0", t: "午夜" }, { v: "9", t: "上午 9 点" }, { v: "3-5", t: "凌晨 3-5 点" }, { v: "9-18", t: "工作时段" }, { v: "*/6", t: "每 6 小时" }] },
  { key: "dom", label: "日 (DOM)", min: 1, max: 31, names: null, presets: [{ v: "*", t: "每天" }, { v: "1", t: "每月 1 号" }, { v: "15", t: "每月 15 号" }, { v: "1,15", t: "1 号和 15 号" }, { v: "*/2", t: "每隔一天" }] },
  { key: "month", label: "月", min: 1, max: 12, names: MONTH_NAMES, presets: [{ v: "*", t: "每月" }, { v: "1", t: "一月" }, { v: "*/3", t: "每季度" }, { v: "6,12", t: "半年度" }] },
  { key: "dow", label: "星期 (DOW)", min: 0, max: 7, names: DOW_NAMES, presets: [{ v: "*", t: "每天" }, { v: "1-5", t: "工作日" }, { v: "0,6", t: "周末" }, { v: "1", t: "每周一" }, { v: "2", t: "每周二" }] },
];

function parseField(raw: string, min: number, max: number, names: string[] | null): Parsed {
  const src = raw.trim();
  if (!src) throw new Error("字段不能为空");
  const toNum = (tok: string): number => {
    const t = tok.trim();
    if (names) {
      const i = names.indexOf(t.toUpperCase());
      if (i >= 0) return names === MONTH_NAMES ? i + 1 : i;
    }
    if (!/^\d+$/.test(t)) throw new Error(`无法识别的值「${t}」`);
    const n = Number(t);
    if (n < min || n > max) throw new Error(`「${t}」超出范围 ${min}-${max}`);
    return n;
  };
  const set = new Set<number>();
  let onlyStep: number | null = null;
  let starCount = 0;
  const chunks = src.split(",");
  for (const part of chunks) {
    const slash = part.split("/");
    if (slash.length > 2) throw new Error(`「${part}」里有多个 /`);
    const step = slash.length === 2 ? Number(slash[1].trim()) : 1;
    if (!Number.isInteger(step) || step < 1) throw new Error(`步长「${slash[1]}」无效`);
    const body = slash[0].trim();
    let lo: number, hi: number;
    if (body === "*") { lo = min; hi = max; starCount++; }
    else {
      const seg = body.split("-");
      if (seg.length === 1) { lo = toNum(seg[0]); hi = slash.length === 2 ? max : lo; }
      else if (seg.length === 2) { lo = toNum(seg[0]); hi = toNum(seg[1]); }
      else throw new Error(`「${body}」不是合法区间`);
    }
    if (hi < lo) throw new Error(`区间「${body}」的起点大于终点`);
    for (let v = lo; v <= hi; v += step) set.add(v === 7 && max === 7 ? 0 : v);
    if (chunks.length === 1 && slash.length === 2) onlyStep = step;
  }
  if (set.size === 0) throw new Error("该字段匹配不到任何值");
  return { values: [...set].sort((a, b) => a - b), isStar: starCount === chunks.length && onlyStep === null, step: onlyStep, raw: src };
}

/** 把本地墙上时间转成瞬时点，同时判断该墙上时间是否不存在（春季跳钟）或出现两次（秋季回拨）。 */
function resolveWall(y: number, mo: number, d: number, h: number, mi: number) {
  const first = new Date(y, mo, d, h, mi, 0, 0);
  const exists = first.getFullYear() === y && first.getMonth() === mo && first.getDate() === d && first.getHours() === h && first.getMinutes() === mi;
  const later = new Date(first.getTime() + 3600_000);
  const twice = exists && later.getHours() === h && later.getMinutes() === mi && later.getDate() === d;
  return { date: first, exists, twice };
}

function pad(n: number) { return n < 10 ? `0${n}` : String(n); }

function humanGap(ms: number) {
  if (ms < 0) return "已过去";
  const m = Math.round(ms / 60000);
  if (m < 1) return "不到 1 分钟后";
  if (m < 60) return `${m} 分钟后`;
  const h = Math.floor(m / 60), rm = m % 60;
  if (h < 24) return rm ? `${h} 小时 ${rm} 分后` : `${h} 小时后`;
  const d = Math.floor(h / 24), rh = h % 24;
  return rh ? `${d} 天 ${rh} 小时后` : `${d} 天后`;
}

function listCn(values: number[], suffix: string, mapper?: (n: number) => string) {
  const shown = values.slice(0, 6).map(v => (mapper ? mapper(v) : String(v)));
  return shown.join("、") + (values.length > 6 ? ` 等 ${values.length} 个` : "") + suffix;
}

function hourBand(h: number) {
  if (h < 5) return "凌晨";
  if (h < 9) return "早上";
  if (h < 12) return "上午";
  if (h < 13) return "中午";
  if (h < 18) return "下午";
  return "晚上";
}

function describe(f: Record<FieldKey, Parsed>) {
  const parts: string[] = [];
  if (!f.month.isStar) parts.push(listCn(f.month.values, "月"));

  const domFree = f.dom.isStar, dowFree = f.dow.isStar;
  const domText = f.dom.step ? `每隔 ${f.dom.step} 天` : listCn(f.dom.values, "号", n => `${n}`);
  const dowText = f.dow.values.length === 7 ? "每天" : `每周${f.dow.values.map(n => DOW_CN[n]).join("、")}`;
  if (domFree && dowFree) parts.push("每天");
  else if (!domFree && !dowFree) parts.push(`每月${domText} 或 ${dowText}（两者满足其一即触发）`);
  else if (!domFree) parts.push(`每月${domText}`);
  else parts.push(dowText);

  let hourText: string;
  if (f.hour.isStar) hourText = "全天每小时";
  else if (f.hour.step) hourText = `每 ${f.hour.step} 小时`;
  else if (f.hour.values.length > 1 && f.hour.values[f.hour.values.length - 1] - f.hour.values[0] === f.hour.values.length - 1)
    hourText = `${hourBand(f.hour.values[0])} ${f.hour.values[0]} 点到 ${f.hour.values[f.hour.values.length - 1]} 点`;
  else hourText = listCn(f.hour.values, " 点", n => `${hourBand(n)} ${n}`);
  parts.push(hourText);

  if (f.minute.isStar) parts.push("每分钟一次");
  else if (f.minute.step) parts.push(`每 ${f.minute.step} 分钟一次`);
  else parts.push(listCn(f.minute.values, " 分", n => `第 ${n}`));

  return parts.join("，");
}

const HORIZON_DAYS = 30;
const MAX_TICKS = 4000;

export default function CronNextFires() {
  const [fields, setFields] = useState<Record<FieldKey, string>>({ minute: "*/17", hour: "3-5", dom: "*", month: "*", dow: "2" });
  const [hover, setHover] = useState<{ x: number; time: number } | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const now = useMemo(() => Date.now(), []);

  const setField = useCallback((k: FieldKey, v: string) => setFields(prev => ({ ...prev, [k]: v })), []);

  const result = useMemo(() => {
    const parsed: Partial<Record<FieldKey, Parsed>> = {};
    const errors: Partial<Record<FieldKey, string>> = {};
    for (const s of SPECS) {
      try { parsed[s.key] = parseField(fields[s.key], s.min, s.max, s.names); }
      catch (e) { errors[s.key] = e instanceof Error ? e.message : String(e); }
    }
    if (Object.keys(errors).length) return { ok: false as const, errors };
    const f = parsed as Record<FieldKey, Parsed>;

    const months = new Set(f.month.values), doms = new Set(f.dom.values), dows = new Set(f.dow.values);
    const domFree = f.dom.isStar, dowFree = f.dow.isStar;

    const start = new Date(now);
    const fires: number[] = [];
    const skipped: string[] = [];
    const doubled: string[] = [];
    let truncated = false;

    outer: for (let dayOffset = 0; dayOffset < HORIZON_DAYS; dayOffset++) {
      const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + dayOffset);
      if (!months.has(day.getMonth() + 1)) continue;
      const dayMatch = domFree && dowFree ? true
        : domFree ? dows.has(day.getDay())
        : dowFree ? doms.has(day.getDate())
        : doms.has(day.getDate()) || dows.has(day.getDay());
      if (!dayMatch) continue;
      for (const h of f.hour.values) {
        for (const mi of f.minute.values) {
          const { date, exists, twice } = resolveWall(day.getFullYear(), day.getMonth(), day.getDate(), h, mi);
          const stamp = `${day.getMonth() + 1}/${day.getDate()} ${pad(h)}:${pad(mi)}`;
          if (!exists) { if (skipped.length < 4) skipped.push(stamp); continue; }
          const t = date.getTime();
          if (t < now) continue;
          if (twice && doubled.length < 4) doubled.push(stamp);
          fires.push(t);
          if (twice) fires.push(t + 3600_000);
          if (fires.length >= MAX_TICKS) { truncated = true; break outer; }
        }
      }
    }
    fires.sort((a, b) => a - b);
    return { ok: true as const, fields: f, fires, skipped, doubled, truncated, sentence: describe(f) };
  }, [fields, now]);

  const spanStart = now;
  const spanEnd = now + HORIZON_DAYS * 86400_000;

  const onTrackMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!result.ok || result.fires.length === 0) return;
    const box = trackRef.current?.getBoundingClientRect();
    if (!box) return;
    const ratio = (e.clientX - box.left) / box.width;
    const target = spanStart + ratio * (spanEnd - spanStart);
    let best = result.fires[0];
    for (const t of result.fires) if (Math.abs(t - target) < Math.abs(best - target)) best = t;
    const bestRatio = (best - spanStart) / (spanEnd - spanStart);
    if (Math.abs(bestRatio * box.width - (e.clientX - box.left)) > 24) { setHover(null); return; }
    setHover({ x: bestRatio * box.width, time: best });
  }, [result, spanStart, spanEnd]);

  const dayTicks = Array.from({ length: HORIZON_DAYS + 1 }, (_, i) => i);

  return (
    <div className="cnf-root">
      <style>{`
        .cnf-root { container-type: inline-size; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary);
          font: 14px/1.5 ui-sans-serif, -apple-system, "PingFang SC", system-ui, sans-serif; padding: 16px; border-radius: 12px; }
        .cnf-title { font-size: 12px; letter-spacing: .08em; text-transform: uppercase; color: var(--dsw-alias-label-secondary); margin-bottom: 8px; }
        .cnf-sentence { background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1); border-left: 3px solid var(--dsw-alias-state-business-primary);
          border-radius: 8px; padding: 12px 14px; font-size: 16px; line-height: 1.6; }
        .cnf-sentence.err { border-left-color: var(--dsw-alias-state-error-primary); color: var(--dsw-alias-state-error-primary); }
        .cnf-count { display: block; margin-top: 6px; font-size: 13px; color: var(--dsw-alias-label-secondary); }
        .cnf-grid { display: grid; grid-template-columns: 1fr; gap: 10px; margin: 14px 0; }
        @container (min-width: 420px) { .cnf-grid { grid-template-columns: 1fr 1fr; } }
        @container (min-width: 720px) { .cnf-grid { grid-template-columns: repeat(5, 1fr); } }
        .cnf-field { background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; padding: 8px 10px; }
        .cnf-field.bad { border-color: var(--dsw-alias-state-error-primary); }
        .cnf-flabel { font-size: 11px; color: var(--dsw-alias-label-secondary); display: block; margin-bottom: 4px; }
        .cnf-input { width: 100%; box-sizing: border-box; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary);
          border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px; padding: 6px 8px; font: 500 14px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; }
        .cnf-input:focus { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: -1px; }
        .cnf-select { width: 100%; box-sizing: border-box; margin-top: 6px; background: transparent; color: var(--dsw-alias-label-secondary);
          border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px; padding: 4px 6px; font-size: 12px; }
        .cnf-select:hover { background: var(--dsw-alias-interactive-bg-hover); }
        .cnf-ferr { margin-top: 6px; font-size: 12px; color: var(--dsw-alias-state-error-primary); }
        .cnf-expr { font: 500 13px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--dsw-alias-label-secondary); word-break: break-all; }
        .cnf-track-wrap { position: relative; margin-top: 18px; }
        .cnf-track { position: relative; height: 68px; background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1);
          border-radius: 8px; overflow: hidden; cursor: crosshair; }
        .cnf-day { position: absolute; top: 0; bottom: 0; width: 1px; background: var(--dsw-alias-border-l1); }
        .cnf-day.week { background: var(--dsw-alias-border-l2); }
        .cnf-tick { position: absolute; top: 12px; bottom: 12px; width: 2px; margin-left: -1px; background: var(--dsw-alias-state-business-primary); opacity: .85; border-radius: 1px; }
        .cnf-cursor { position: absolute; top: 0; bottom: 0; width: 2px; margin-left: -1px; background: var(--dsw-alias-label-primary); opacity: .5; }
        .cnf-tip { position: absolute; bottom: calc(100% + 8px); transform: translateX(-50%); background: var(--dsw-alias-bg-layer-2);
          border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px; padding: 6px 9px; font-size: 12px; white-space: nowrap; pointer-events: none; z-index: 2; }
        .cnf-tip b { font-weight: 600; display: block; }
        .cnf-tip span { color: var(--dsw-alias-label-secondary); }
        .cnf-axis { display: flex; justify-content: space-between; margin-top: 6px; font-size: 11px; color: var(--dsw-alias-label-secondary); }
        .cnf-empty { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 13px; color: var(--dsw-alias-label-secondary); }
        .cnf-warn { margin-top: 12px; border-radius: 8px; padding: 10px 12px; font-size: 13px; line-height: 1.6;
          background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-state-error-primary); color: var(--dsw-alias-state-error-primary); }
        .cnf-ok { border-color: var(--dsw-alias-state-success-primary); color: var(--dsw-alias-state-success-primary); }
        .cnf-list { margin-top: 14px; display: grid; grid-template-columns: 1fr; gap: 6px; }
        @container (min-width: 520px) { .cnf-list { grid-template-columns: 1fr 1fr; } }
        .cnf-row { display: flex; justify-content: space-between; gap: 12px; background: var(--dsw-alias-bg-layer-1);
          border: 1px solid var(--dsw-alias-border-l1); border-radius: 6px; padding: 6px 10px; font-size: 13px; }
        .cnf-row span { color: var(--dsw-alias-label-secondary); }
      `}</style>

      <div className="cnf-title">Cron 下一次触发</div>

      {result.ok ? (
        <div className="cnf-sentence">
          {result.sentence}
          <em className="cnf-count" style={{ fontStyle: "normal" }}>
            未来 {HORIZON_DAYS} 天共 {result.fires.length}{result.truncated ? "+" : ""} 次
            {result.fires.length > 0 ? `，下一次 ${new Date(result.fires[0]).toLocaleString()}（${humanGap(result.fires[0] - now)}）` : "，这段时间内不会触发"}
          </em>
        </div>
      ) : (
        <div className="cnf-sentence err">表达式有误：{Object.values(result.errors!).filter(Boolean)[0]}</div>
      )}

      <div className="cnf-grid">
        {SPECS.map(s => {
          const err = result.ok ? undefined : result.errors![s.key];
          return (
            <div key={s.key} className={err ? "cnf-field bad" : "cnf-field"}>
              <label className="cnf-flabel" htmlFor={`cnf-${s.key}`}>{s.label} · {s.min}-{s.max}</label>
              <input id={`cnf-${s.key}`} className="cnf-input" value={fields[s.key]} spellCheck={false}
                onChange={e => setField(s.key, e.target.value)} />
              <select className="cnf-select" value={s.presets.some(p => p.v === fields[s.key]) ? fields[s.key] : ""}
                onChange={e => e.target.value && setField(s.key, e.target.value)}>
                <option value="">常用值…</option>
                {s.presets.map(p => <option key={p.v} value={p.v}>{p.t} — {p.v}</option>)}
              </select>
              {err ? <div className="cnf-ferr">{err}</div> : null}
            </div>
          );
        })}
      </div>

      <div className="cnf-expr">{SPECS.map(s => fields[s.key].trim() || "?").join(" ")}</div>

      <div className="cnf-track-wrap">
        <div ref={trackRef} className="cnf-track" onMouseMove={onTrackMove} onMouseLeave={() => setHover(null)}>
          {dayTicks.map(i => (
            <div key={i} className={new Date(now + i * 86400_000).getDay() === 1 ? "cnf-day week" : "cnf-day"} style={{ left: `${(i / HORIZON_DAYS) * 100}%` }} />
          ))}
          {result.ok && result.fires.map((t, i) => (
            <div key={`${t}-${i}`} className="cnf-tick" style={{ left: `${((t - spanStart) / (spanEnd - spanStart)) * 100}%` }} />
          ))}
          {result.ok && result.fires.length === 0 ? <div className="cnf-empty">未来 30 天内没有任何触发</div> : null}
          {hover ? <div className="cnf-cursor" style={{ left: hover.x }} /> : null}
        </div>
        {hover ? (
          <div className="cnf-tip" style={{ left: hover.x }}>
            <b>{new Date(hover.time).toLocaleString()}</b>
            <span>{humanGap(hover.time - now)}</span>
          </div>
        ) : null}
        <div className="cnf-axis">
          <span>现在</span>
          <span>{new Date(now + 15 * 86400_000).toLocaleDateString()}</span>
          <span>{new Date(spanEnd).toLocaleDateString()}</span>
        </div>
      </div>

      {result.ok && result.skipped.length > 0 ? (
        <div className="cnf-warn">夏令时跳钟：{result.skipped.join("、")} 这些本地时刻在当天并不存在，届时不会触发。</div>
      ) : null}
      {result.ok && result.doubled.length > 0 ? (
        <div className="cnf-warn">夏令时回拨：{result.doubled.join("、")} 这些本地时刻在当天出现两次，会触发两遍。</div>
      ) : null}

      {result.ok && result.fires.length > 0 ? (
        <div className="cnf-list">
          {result.fires.slice(0, 6).map((t, i) => (
            <div className="cnf-row" key={`${t}-${i}`}>
              <b style={{ fontWeight: 500 }}>{new Date(t).toLocaleString()}</b>
              <span>{humanGap(t - now)}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
