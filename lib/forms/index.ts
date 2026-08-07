/** Runtime form assembly. Every evaluation screen renders from getEvaluationForm. */

export { assembleQuestions } from "./assemble";
export { snapshotEvaluation, type SnapshotOutcome } from "./snapshot";
export { getEvaluationForm } from "./get-form";
export { matchesDependency, resolveVisibility, type ConditionRow } from "./conditions";
export * from "./types";
