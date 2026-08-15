// cytoscape-fcose ships no types. It is a Cytoscape extension registered via
// cytoscape.use(); its layout options are validated by Cytoscape at run time.
declare module "cytoscape-fcose" {
  import type { Ext } from "cytoscape";
  const ext: Ext;
  export default ext;
}
