export type InvestigationState = {
  caseId: string | null;
  focusedEvidenceId: string | null;
  mode: "casebook" | "notebook" | "evidence";
};

type ToolSummary = { id: string; outcome: "success" | "failure" | "unknown" };

export function beginInvestigation(): InvestigationState {
  return { caseId: null, focusedEvidenceId: null, mode: "casebook" };
}

export function openCase(
  _state: InvestigationState,
  caseId: string,
): InvestigationState {
  return { caseId, focusedEvidenceId: null, mode: "notebook" };
}

export function revealFirstFailure(
  state: InvestigationState,
  evidence: { tools: ToolSummary[] },
): InvestigationState {
  const failure = evidence.tools.find(({ outcome }) => outcome === "failure");
  return failure
    ? { ...state, focusedEvidenceId: failure.id, mode: "evidence" }
    : state;
}
