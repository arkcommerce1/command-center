"use client";

import * as React from "react";

import { Check, Circle, Clock } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export interface StageLadderProps {
  specApproved: boolean;
  fbaSheetUrl: string | null;
  factoryCount: number;
  onStage1Action: () => void;
  onStage2Action: () => void;
  onStage3Action: () => void;
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
      sub: props.specApproved ? "Spec approved" : "Draft spec",
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
      state: props.factoryCount > 0 ? "done" : "not-started",
      sub: `${props.factoryCount} factor${props.factoryCount === 1 ? "y" : "ies"} for this product`,
      action: props.onStage3Action,
      actionLabel: `Factories (${props.factoryCount})`,
    },
  ];

  // Determine current stage = first not-done
  const currentIdx = stages.findIndex((s) => s.state !== "done");
  if (currentIdx >= 0) stages[currentIdx].state = "current";

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
