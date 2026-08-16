import { NodeSquareProgram } from "@sigma/node-square";

/**
 * A diamond node, for the topic tier.
 *
 * sigma ships a circle; `@sigma/node-square` adds a square; there is no
 * diamond package. There does not need to be — a diamond *is* the square
 * rotated an eighth turn, and the square program places its six vertices from
 * a constant list of angles. Adding π/4 to each is the whole implementation.
 *
 * Shape carries the kind of thing a node is — circle for a person, square for
 * a thread, diamond for a topic — so colour is free to carry a score and the
 * tiers survive greyscale and colour-blindness without help.
 */
export class NodeDiamondProgram extends NodeSquareProgram {
  getDefinition() {
    const square = super.getDefinition();
    const quarter = Math.PI / 4;
    return {
      ...square,
      CONSTANT_DATA: (square.CONSTANT_DATA as number[][]).map(([angle]) => [angle! + quarter]),
    };
  }
}
