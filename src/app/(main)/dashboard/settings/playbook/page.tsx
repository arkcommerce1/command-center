"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";

interface PlaybookPerson {
  name: string;
  role: string;
  location: string;
  whatsapp: string;
  email: string;
}

interface PlaybookHoliday {
  name: string;
  startDate: string;
  endDate: string;
}

interface PlaybookSettings {
  sampleAskTiming: "after_layer_2" | "after_layer_3";
  nudgeLimit: number;
  sampleFeeRule: string;
  boxScheduleDay: string;
  boxScheduleCutoffTime: string;
  yiwuAddress: string;
  approachADisclosures: string;
  ourPeople: PlaybookPerson[];
  holidays: PlaybookHoliday[];
}

const DEFAULT_SETTINGS: PlaybookSettings = {
  sampleAskTiming: "after_layer_3",
  nudgeLimit: 2,
  sampleFeeRule: "always_ask",
  boxScheduleDay: "",
  boxScheduleCutoffTime: "",
  yiwuAddress: "",
  approachADisclosures: "",
  ourPeople: [],
  holidays: [{ name: "National Day Golden Week", startDate: "2026-10-01", endDate: "2026-10-07" }],
};

export default function PlaybookSettingsPage() {
  const [settings, setSettings] = React.useState<PlaybookSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [savedAt, setSavedAt] = React.useState<number | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/settings");
      if (r.ok) setSettings(await r.json());
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  async function save() {
    setBusy(true);
    try {
      const r = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (r.ok) {
        setSettings(await r.json());
        setSavedAt(Date.now());
      }
    } finally {
      setBusy(false);
    }
  }

  function updatePerson(i: number, patch: Partial<PlaybookPerson>) {
    setSettings((s) => ({
      ...s,
      ourPeople: s.ourPeople.map((p, idx) => (idx === i ? { ...p, ...patch } : p)),
    }));
  }

  function addPerson() {
    setSettings((s) => ({ ...s, ourPeople: [...s.ourPeople, { name: "", role: "", location: "", whatsapp: "", email: "" }] }));
  }

  function removePerson(i: number) {
    setSettings((s) => ({ ...s, ourPeople: s.ourPeople.filter((_, idx) => idx !== i) }));
  }

  function updateHoliday(i: number, patch: Partial<PlaybookHoliday>) {
    setSettings((s) => ({
      ...s,
      holidays: s.holidays.map((h, idx) => (idx === i ? { ...h, ...patch } : h)),
    }));
  }

  function addHoliday() {
    setSettings((s) => ({ ...s, holidays: [...s.holidays, { name: "", startDate: "", endDate: "" }] }));
  }

  function removeHoliday(i: number) {
    setSettings((s) => ({ ...s, holidays: s.holidays.filter((_, idx) => idx !== i) }));
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl tracking-tight">Settings — Playbook</h2>
          <p className="text-muted-foreground">
            Durable rules and defaults Donna follows — sampling, boxes, disclosures, people, holidays.
          </p>
        </div>
        <Button onClick={save} disabled={busy || loading}>
          {busy ? "Saving…" : "Save"}
        </Button>
      </div>

      {savedAt && <p className="text-sm text-muted-foreground">Saved.</p>}

      <Card>
        <CardHeader>
          <CardTitle>Sampling & fees</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sampleAskTiming">Sample ask timing</Label>
            <NativeSelect
              id="sampleAskTiming"
              value={settings.sampleAskTiming}
              onChange={(e) =>
                setSettings({ ...settings, sampleAskTiming: e.target.value as PlaybookSettings["sampleAskTiming"] })
              }
            >
              <NativeSelectOption value="after_layer_2">After layer 2</NativeSelectOption>
              <NativeSelectOption value="after_layer_3">After layer 3</NativeSelectOption>
            </NativeSelect>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="nudgeLimit">Nudge limit</Label>
            <Input
              id="nudgeLimit"
              type="number"
              min={0}
              value={settings.nudgeLimit}
              onChange={(e) => setSettings({ ...settings, nudgeLimit: Number(e.target.value) || 0 })}
            />
          </div>
          <div className="col-span-2 flex flex-col gap-1.5">
            <Label htmlFor="sampleFeeRule">Sample fee rule</Label>
            <Input
              id="sampleFeeRule"
              value={settings.sampleFeeRule}
              onChange={(e) => setSettings({ ...settings, sampleFeeRule: e.target.value })}
              placeholder="e.g. always_ask"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Box schedule & Yiwu</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="boxScheduleDay">Box schedule day</Label>
            <Input
              id="boxScheduleDay"
              value={settings.boxScheduleDay}
              onChange={(e) => setSettings({ ...settings, boxScheduleDay: e.target.value })}
              placeholder="e.g. Friday"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="boxScheduleCutoffTime">Box schedule cutoff time</Label>
            <Input
              id="boxScheduleCutoffTime"
              value={settings.boxScheduleCutoffTime}
              onChange={(e) => setSettings({ ...settings, boxScheduleCutoffTime: e.target.value })}
              placeholder="e.g. 18:00 CST"
            />
          </div>
          <div className="col-span-2 flex flex-col gap-1.5">
            <Label htmlFor="yiwuAddress">Yiwu address</Label>
            <Input
              id="yiwuAddress"
              value={settings.yiwuAddress}
              onChange={(e) => setSettings({ ...settings, yiwuAddress: e.target.value })}
              placeholder="Warehouse / consolidator address in Yiwu"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Approach A disclosures</CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            value={settings.approachADisclosures}
            onChange={(e) => setSettings({ ...settings, approachADisclosures: e.target.value })}
            rows={3}
            placeholder="What Donna discloses to factories about how/where we sell"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Our people</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {settings.ourPeople.map((p, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_1fr_1fr_1fr_auto] gap-2">
              <Input
                value={p.name}
                onChange={(e) => updatePerson(i, { name: e.target.value })}
                placeholder="Name"
              />
              <Input
                value={p.role}
                onChange={(e) => updatePerson(i, { role: e.target.value })}
                placeholder="Role"
              />
              <Input
                value={p.location}
                onChange={(e) => updatePerson(i, { location: e.target.value })}
                placeholder="Location"
              />
              <Input
                value={p.whatsapp}
                onChange={(e) => updatePerson(i, { whatsapp: e.target.value })}
                placeholder="WhatsApp # (with country code)"
              />
              <Input
                value={p.email}
                onChange={(e) => updatePerson(i, { email: e.target.value })}
                placeholder="Email (optional)"
              />
              <Button variant="ghost" onClick={() => removePerson(i)}>
                ✕
              </Button>
            </div>
          ))}
          {settings.ourPeople.some((p) => p.name.toLowerCase() === "yuki" && !p.whatsapp) && (
            <p className="text-sm text-amber-600">Add Yuki's WhatsApp number.</p>
          )}
          <Button variant="outline" size="sm" className="w-fit" onClick={addPerson}>
            + Person
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Holidays</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {settings.holidays.map((h, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2">
              <Input
                value={h.name}
                onChange={(e) => updateHoliday(i, { name: e.target.value })}
                placeholder="Holiday name"
              />
              <Input
                type="date"
                value={h.startDate}
                onChange={(e) => updateHoliday(i, { startDate: e.target.value })}
              />
              <Input
                type="date"
                value={h.endDate}
                onChange={(e) => updateHoliday(i, { endDate: e.target.value })}
              />
              <Button variant="ghost" onClick={() => removeHoliday(i)}>
                ✕
              </Button>
            </div>
          ))}
          <Button variant="outline" size="sm" className="w-fit" onClick={addHoliday}>
            + Holiday
          </Button>
        </CardContent>
      </Card>

      <div>
        <Button onClick={save} disabled={busy || loading}>
          {busy ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}
