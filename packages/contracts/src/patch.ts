export interface EditProposal {
  id: string;
  docRelPath: string;
  anchor: string;
  replace: string;
  why: string;
  source: "tool-call" | "text-block";
  createdAt: string;
}

export type ProposalDecision =
  "accept-once" | "accept-session" | "accept-prefix" | "deny-with-guidance" | "cancel";
