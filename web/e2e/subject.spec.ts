import { test, expect } from "@playwright/test";

/**
 * Subject tidying, checked against the real shapes on these lists.
 *
 * Runs under Playwright rather than `bun test` only because `lib/` sits in the
 * web workspace; there is no browser involved.
 */
import { cleanSubject, tidySubject } from "../lib/graph-model";

const REAL = [
  // Every one of these is a subject observed on agent2agent.
  ["[agent2agent] Soliciting comments on AI Agent Protocols strawman charter",
   "Soliciting comments on AI Agent Protocols strawman charter"],
  ["[agent2agent] Re: 回复: Re: Soliciting comments on AI Agent Protocols strawman charter",
   "Soliciting comments on AI Agent Protocols strawman charter"],
  ["[agent2agent] 回复：回复：Re: Charter Convergence Call - Next Week",
   "Charter Convergence Call - Next Week"],
  ["[agent2agent] Charter options (Was: Re: Meeting link and agenda)", "Charter options"],
  ["[Agentproto] Re: an attempt at charter simplification",
   "an attempt at charter simplification"],
];

test("tidySubject strips list tags, stacked reply prefixes and rename notes", () => {
  for (const [raw, expected] of REAL) {
    expect(tidySubject(raw!), raw).toBe(expected!);
  }
});

test("a subject that is only prefixes keeps its original text", () => {
  // Never return an empty label: an empty node is worse than an ugly one.
  expect(tidySubject("[agent2agent] Re: Re:")).toBe("[agent2agent] Re: Re:");
});

test("a fullwidth colon is stripped like an ASCII one", () => {
  expect(tidySubject("回复：Protocol view of agents")).toBe("Protocol view of agents");
});

test("cleanSubject tidies first, then cuts — so the cut is of real words", () => {
  const label = cleanSubject(
    "[agent2agent] Re: 回复：Re: Securing Agent-to-Agent Trust: New EAT Profile for AI Agents",
  );
  expect(label.startsWith("Securing Agent-to-Agent Trust")).toBe(true);
  expect(label.length).toBeLessThanOrEqual(46);
});

test("a subject with no decoration is returned unchanged", () => {
  expect(tidySubject("Protocol view of agents")).toBe("Protocol view of agents");
});
