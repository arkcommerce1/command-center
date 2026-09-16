"use client";

import * as React from "react";

import { Check, Circle, Clock } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export interface StageLadderProps {
  specApproved: boolean;
  specNeedsInput: number; // count of fields with empty values
  fbaSheetUrl: string | null;
  factoryCount: number;
  factoriesWithStep1: number;
  factoriesWithStep3: number;
  factoriesWithStep4: number;
  samplesPassedChina: number;
  samplesArrivedNY: number;
  samplesApproved: number;
  onStage1Action: () => void;
  onStage2Action: () => void;
  onStage3Action: () => void;
  onStage4Action: (factoryId: string) => void;
  onStage5Action: (factoryId: string) => void;
  onStage6Action: () => void;
  onStage7Action: () => void;
  onStage8Action: () => void;
  factories: Array<{ id: string; name: string; fstage: string }>;
}

type StageState = "done" | "current" | "not-started";

function stageIcon(state: StageState) {
  if (state === "done") return <Check className="h-4 w-4 text-emerald-600" />;
  if (state === "current") return <Clock className="h-4 w-4 text-blue-600" />;
  return <Circle className="h-4 w-4 text-muted-foreground" />;
}

function stageColor(state: StageState) {
  if (state === "done") return "border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30";
  if (state === "current") return "border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/30";
  return "border-border bg-card";
}

export function StageLadder(props: StageLadderProps) {
  const stages: Array<{
    n: number;
    label: string;
    state: StageState;
    sub: string;
    action?: () => void;
    actionLabel: string;
  }> = [
    {
      n: 1,
      label: "Spec approved",
      state: props.specApproved ? "done" : "not-started",
      sub: props.specApproved
        ? "Spec approved"
        : props.specNeedsInput > 0
          ? `${props.specNeedsInput} fields need input`
          : "Draft spec",
      action: props.onStage1Action,
      actionLabel: props.specApproved ? "Edit spec" : "AI Spec Draft",
    },
    {
      n: 2,
      label: "FBA numbers saved",
      state: props.fbaSheetUrl ? "done" : "not-started",
      sub: props.fbaSheetUrl ? "FBA sheet linked" : "No FBA sheet",
      action: props.onStage2Action,
      actionLabel: "Open FBA calculator",
    },
    {
      n: 3,
      label: "Factories contacted",
      state: props.factoriesWithStep1 > 0 ? "done" : "not-started",
      sub: `${props.factoryCount} factor${props.factoryCount === 1 ? "y" : "ies"} for this product`,
      action: props.onStage3Action,
      actionLabel: `Factories (${props.factoryCount})`,
    },
    {
      n: 4,
      label: "Spec agreed with a factory",
      state: props.factoriesWithStep3 > 0 ? "done" : "not-started",
      sub: props.factoriesWithStep3 > 0 ? "Spec agreed" : "No spec agreement yet",
      actionLabel: "Open factory",
    },
    {
      n: 5,
      label: "Sample committed",
      state: props.factoriesWithStep4 > 0 ? "done" : "not-started",
      sub: props.factoriesWithStep4 > 0 ? "Sample committed" : "No sample yet",
      actionLabel: "Open factory",
    },
    {
      n: 6,
      label: "Passed China check",
      state: props.samplesPassedChina > 0 ? "done" : "not-started",
      sub: props.samplesPassedChina > 0 ? `${props.samplesPassedChina} passed` : "No samples checked",
      action: props.onStage6Action,
      actionLabel: "Samples, China tab",
    },
    {
      n: 7,
      label: "Arrived in New York",
      state: props.samplesArrivedNY > 0 ? "done" : "not-started",
      sub: props.samplesArrivedNY > 0 ? `${props.samplesArrivedNY} arrived` : "No NY arrivals",
      action: props.onStage7Action,
      actionLabel: "Samples, New York tab",
    },
    {
      n: 8,
      label: "Sample approved",
      state: props.samplesApproved > 0 ? "done" : "not-started",
      sub: props.samplesApproved > 0 ? `${props.samplesApproved} approved` : "No approvals",
      action: props.onStage8Action,
      actionLabel: "Open sample",
    },
  ];

  // Determine current stage = first not-done
  const currentIdx = stages.findIndex((s) => s.state !== "done");
  if (currentIdx >= 0) stages[currentIdx].state = "current";

  // For stages 4 and 5, wire the action to the first factory that qualifies
  const factoryForStep3 = props.factories.find(
    (f) =>
      f.fstage === "sample_requested" ||
      f.fstage === "sample_yiwu" ||
      f.fstage === "sample_ny" ||
      f.fstage === "sample_confirmed" ||
      f.fstage === "quoted" ||
      f.fstage === "negotiating" ||
      f.fstage === "ordered",
  );
  const factoryForStep4 = props.factories.find(
    (f) =>
      f.fstage === "sample_yiwu" ||
      f.fstage === "sample_ny" ||
      f.fstage === "sample_confirmed" ||
      f.fstage === "quoted" ||
      f.fstage === "negotiating" ||
      f.fstage === "ordered",
  );

  if (stages[3].state !== "done" && factoryForStep3) {
    stages[3].action = () => props.onStage4Action(factoryForStep3.id);
  } else if (stages[3].state === "done" && factoryForStep3) {
    stages[3].action = () => props.onStage4Action(factoryForStep3.id);
  }
  if (stages[4].state !== "done" && factoryForStep4) {
    stages[4].action = () => props.onStage5Action(factoryForStep4.id);
  } else if (stages[4].state === "done" && factoryForStep4) {
    stages[4].action = () => props.onStage5Action(factoryForStep4.id);
  }

  return (
    <Card data-testid="stage-ladder">
      <CardHeader>
        <CardTitle>Pipeline ladder</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-1">
          {stages.map((s, i) => (
            <div key={s.n} className="flex items-stretch gap-2">
              {/* connector + icon */}
              <div className="flex flex-col items-center pt-1">
                <div
                  className={`flex h-7 w-7 items-center justify-center rounded-full border-2 ${stageColor(s.state)}`}
                >
                  {stageIcon(s.state)}
                </div>
                {i < stages.length - 1 && (
                  <div className={`mt-0.5 w-px flex-1 ${s.state === "done" ? "bg-emerald-200" : "bg-border"}`} />
                )}
              </div>
              {/* content */}
              <div className="flex flex-1 flex-wrap items-center gap-2 pb-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">
                      <span className="text-muted-foreground">{s.n}. </span>
                      {s.label}
                    </span>
                    {s.state === "current" && (
                      <Badge variant="secondary" className="text-[10px]" data-testid={`stage-current-${s.n}`}>
                        Current
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">{s.sub}</p>
                </div>
                {s.action && (
                  <Button
                    size="sm"
                    variant={s.state === "done" ? "outline" : "default"}
                    onClick={s.action}
                    data-testid={`stage-action-${s.n}`}
                  >
                    {s.actionLabel}
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
