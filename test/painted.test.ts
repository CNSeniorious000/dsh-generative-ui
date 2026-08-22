/**
 * `isPaintedText` is the text half of `hasPainted`, which decides when the host's own code block is hidden behind a rendered card.
 *
 * The case that matters is the one it used to get wrong: partial-react's error boundary
 * renders a bare `ERROR: …` text node, which is text, so the source block was hidden at
 * exactly the moment the reader most needs to see what the model wrote. See CLAUDE.md §4's
 * table — an empty mount and an `ERROR:` mount are both zero-children and want opposite
 * responses.
 */
import { describe, expect, test } from "bun:test";
import { isPaintedText } from "../src/client/runtime/inline-fence.ts";

describe("isPaintedText", () => {
  test("a rendered card counts", () => {
    expect(isPaintedText(("月供 4890.17 元"))).toBe(true);
  });

  test("the error boundary's output does not", () => {
    expect(isPaintedText(("ERROR: item.difficulty is undefined"))).toBe(false);
    expect(isPaintedText(("ERROR"))).toBe(false);
  });

  test("a card whose own text opens with ERROR still counts", () => {
    // `^ERROR(:|$)` and not `startsWith("ERROR")`: a log viewer is a real card.
    expect(isPaintedText(("ERROR 404 是什么意思？共 12 条日志"))).toBe(true);
  });

  test("an empty mount does not", () => {
    expect(isPaintedText((""))).toBe(false);
  });
});
