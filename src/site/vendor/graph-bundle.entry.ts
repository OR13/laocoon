// Bundle entry: Cytoscape plus the fCoSE layout, exposed on window.
// Bundled offline into the private view so the page needs no network at all —
// PROBLEM.md section 9's local-only rule covers the tooling, not just the models.
import cytoscape from "cytoscape";
import fcose from "cytoscape-fcose";

cytoscape.use(fcose);
(globalThis as unknown as { cytoscape: unknown }).cytoscape = cytoscape;
