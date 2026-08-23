// MISSING-REACT-IMPORT, the hook arm. A card that opens with its data and calls `useState`
// further down throws `useState is not defined` at render: it compiles, it mounts, it paints a
// blank rectangle. Zero of 378 corpus cards did this and TWO of the first 17 generated after
// this session's prompt edits did — the screen knew only `Fragment|StrictMode|Suspense|memo|
// forwardRef` and could not see it.
const LENGTH = { mm: 0.001, cm: 0.01, m: 1 };

export default function Convert() {
  const [unit, setUnit] = useState<keyof typeof LENGTH>("m");
  return <button onClick={() => setUnit("cm")}>{String(LENGTH[unit])}</button>;
}
