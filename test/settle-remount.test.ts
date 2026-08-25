import { test, expect } from "bun:test";
import { parseUi4aSegments } from "../src/client/runtime/segments.ts";
import { deliveryFor } from "../src/client/runtime/GenUISurface.tsx";

const body = 'const App = () => <div>hi</div>\nexport default App';
const settle = (streamed: string, settled: string) =>
  deliveryFor(parseUi4aSegments(settled)[0].code, parseUi4aSegments(streamed)[0].code, false).do;

test("the closing fence alone does not re-deliver", () => {
  expect(settle('```ui4a/tsx\n' + body, '```ui4a/tsx\n' + body + '\n```')).toBe("nothing");
});
test("prose after the fence does not re-deliver either", () => {
  expect(settle('```ui4a/tsx\n' + body, '```ui4a/tsx\n' + body + '\n```\n\nEcco!')).toBe("nothing");
});
test("a real last token still re-delivers", () => {
  expect(settle('```ui4a/tsx\n' + body, '```ui4a/tsx\n' + body + '\nexport const x = 1\n```')).toBe("replace");
});
