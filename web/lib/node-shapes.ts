import { NodeSquareProgram } from "@sigma/node-square";

/**
 * Square and diamond nodes that respect the theme when they draw a label box.
 *
 * Two things are going on here.
 *
 * **The diamond.** sigma ships a circle, `@sigma/node-square` adds a square,
 * and there is no diamond package. There does not need to be: a diamond *is*
 * the square rotated an eighth turn, and the square program places its six
 * vertices from a constant list of angles. Adding π/4 to each is the whole
 * implementation.
 *
 * **The label box.** `defaultDrawNodeHover` is only the *default*: a node
 * program that defines its own `drawHover` wins, and the square program's
 * hard-codes `context.fillStyle = "#FFF"`. On the dark theme that put a white
 * box behind near-white text, so hovering a thread or a topic made its own
 * name vanish — the same defect as before, arriving by a different route.
 *
 * Shape carries the kind of thing a node is, so colour is free to carry a
 * score and the tiers survive greyscale and colour-blindness without help.
 */

const cssVar = (n: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(n).trim();

/** Themed label box. Hex tokens only — canvas silently ignores an oklch(). */
export function drawThemedHover(
  context: CanvasRenderingContext2D,
  data: { x: number; y: number; size: number; label?: string | null },
): void {
  if (!data.label) return;
  const size = 13;
  context.font = `${size}px ui-sans-serif, system-ui, sans-serif`;
  const width = context.measureText(data.label).width + 16;
  const height = size + 12;
  const x = data.x + data.size + 4;
  const y = data.y - height / 2;

  context.beginPath();
  context.fillStyle = cssVar("--cy-halo") || "#ffffff";
  context.strokeStyle = cssVar("--thread-line") || "#c3c2bb";
  context.lineWidth = 1;
  context.roundRect(x, y, width, height, 4);
  context.fill();
  context.stroke();

  context.fillStyle = cssVar("--cy-ink") || "#1c1917";
  context.textBaseline = "middle";
  context.fillText(data.label, x + 8, data.y);
}

export class ThemedSquareProgram extends NodeSquareProgram {
  drawHover = drawThemedHover;
}

export class NodeDiamondProgram extends NodeSquareProgram {
  drawHover = drawThemedHover;

  getDefinition() {
    const square = super.getDefinition();
    const quarter = Math.PI / 4;
    return {
      ...square,
      CONSTANT_DATA: (square.CONSTANT_DATA as number[][]).map(([angle]) => [angle! + quarter]),
    };
  }
}
