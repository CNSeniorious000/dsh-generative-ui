// NOT a duplicate, and the shape that made a first version of DUPLICATE-STYLE-KEY report three
// cards instead of one: a spread with an override after it, and a nested object inside the
// style. Both are correct, and this card must stay clean.
const base = { padding: 8, background: "var(--dsw-alias-bg-layer-1)" };

export default function Answer() {
  return (
    <div style={{ ...base, background: "var(--dsw-alias-bg-layer-2)" }}>
      <span style={{ color: "var(--dsw-alias-label-primary)", transition: "background .2s" }}>ok</span>
    </div>
  );
}
