import { CRMStage } from "@/types";

export interface StageMeta {
  stage: CRMStage;
  label: string;
  color: string;
  isQuizStage: boolean;
}

export const STAGES: StageMeta[] = [
  { stage: "quiz_started",    label: "Quiz started",    color: "bg-indigo-50 text-indigo-700",   isQuizStage: true },
  { stage: "quiz_completed",  label: "Quiz completed",  color: "bg-indigo-50 text-indigo-700",   isQuizStage: true },
  { stage: "snapshot_viewed", label: "Snapshot viewed", color: "bg-indigo-50 text-indigo-700",   isQuizStage: true },
  { stage: "new",             label: "New",             color: "bg-blue-50 text-blue-700",       isQuizStage: false },
  { stage: "qualification",   label: "Qualification",   color: "bg-amber-50 text-amber-700",     isQuizStage: false },
  { stage: "engaged",         label: "Engaged",         color: "bg-purple-50 text-purple-700",   isQuizStage: false },
  { stage: "proposal",        label: "Proposal",        color: "bg-orange-50 text-brand-orange", isQuizStage: false },
  { stage: "won",             label: "Won",             color: "bg-green-50 text-green-700",     isQuizStage: false },
  { stage: "lost",            label: "Lost",            color: "bg-gray-100 text-gray-500",      isQuizStage: false },
];

export function stageMeta(stage: CRMStage): StageMeta | undefined {
  return STAGES.find(s => s.stage === stage);
}
