"use client";

/** Every appraise component, in every state. This page is the regression check. */

import { useState } from "react";

import { AutosaveIndicator } from "@/components/appraise/autosave-indicator";
import {
  CHART_COLORS,
  ChartLegend,
  CompletionBarChart,
  ordinalStep,
  StatusDonutChart,
  TrendAreaChart,
} from "@/components/appraise/charts";
import { DashboardCard, MetricWidget } from "@/components/appraise/metric-widget";
import { Input } from "@/components/ui/input";
import { ProgressRail } from "@/components/appraise/progress-rail";
import { RatingScale } from "@/components/appraise/rating-scale";
import { QuestionRow, SectionCard } from "@/components/appraise/section-card";
import { DeltaChip, ScoreStat } from "@/components/appraise/score-stat";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/appraise/states";
import { StatusChip, type ChipStatus } from "@/components/appraise/status-chip";
import { TickScale } from "@/components/appraise/tick-scale";
import { TierBadge, TierLegend } from "@/components/appraise/tier-badge";
import type { Tick3Value, Tier } from "@/components/appraise/tier";
import { Button } from "@/components/ui/button";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2 border-b border-rule py-5 last:border-b-0">
      <p className="type-label text-ink-faint">{label}</p>
      {children}
    </div>
  );
}

const ALL_STATUSES: ChipStatus[] = [
  "DRAFT",
  "CYCLE_ACTIVE",
  "SELF_SUBMITTED",
  "LEAD_REVIEWED",
  "MD_FINALIZED",
  "CLOSED",
  "RETURNED",
  "OVERDUE",
];

export function ComponentGallery() {
  const [self, setSelf] = useState<number | null>(4);
  const [lead, setLead] = useState<number | null>(3);
  const [final, setFinal] = useState<number | null>(null);
  const [blank, setBlank] = useState<number | null>(null);
  const [tick, setTick] = useState<Tick3Value | null>("SATISFACTORY");
  const [tickBlank, setTickBlank] = useState<Tick3Value | null>(null);

  return (
    <div className="space-y-16">
      {/* ---------- RatingScale ---------- */}
      <section className="space-y-6">
        <div className="space-y-2">
          <h2 className="section-header">RatingScale · SCALE_0_5</h2>
          <p className="max-w-form font-sans text-body-sm text-ink-muted">
            The most important component in the product. One Tab stop; arrow keys move between
            ratings, Home and End jump to the ends. Tier decides the fill. Resize to 375px to see
            the 3×2 grid and the permanent legend.
          </p>
        </div>

        <SectionCard title="Every tier, interactive" description="Try the keyboard on each.">
          <Row label="Self · amber — the employee filling in their own form">
            <RatingScale tier="self" value={self} onChange={setSelf} label="Delivery Efficiency" />
          </Row>
          <Row label="Lead · blue — the HOD rating a report">
            <RatingScale tier="lead" value={lead} onChange={setLead} label="Delivery Efficiency" />
          </Row>
          <Row label="Final · emerald — the MD override, with the lead's score as a ghost">
            <RatingScale
              tier="final"
              value={final}
              onChange={setFinal}
              showGhost
              ghostValue={lead}
              label="Delivery Efficiency"
            />
          </Row>
        </SectionCard>

        <SectionCard title="States">
          <Row label="Unanswered">
            <RatingScale tier="self" value={blank} onChange={setBlank} label="Not yet rated" />
          </Row>
          <Row label="Error — a required rating left blank after a submit attempt">
            <RatingScale
              tier="self"
              value={null}
              onChange={() => {}}
              error="Choose a rating before submitting."
              label="Accuracy & Compliance"
            />
          </Row>
          <Row label="Read-only — a submitted layer, locked downstream (§8)">
            <RatingScale tier="lead" value={4} readOnly label="Technical Competence" />
          </Row>
        </SectionCard>
      </section>

      {/* ---------- TickScale ---------- */}
      <section className="space-y-6">
        <div className="space-y-2">
          <h2 className="section-header">TickScale · TICK_3</h2>
          <p className="max-w-form font-sans text-body-sm text-ink-muted">
            The worker track. Never renders a number — the 5 / 3 / 1 mapping is for analytics only,
            and the form stays a tick sheet.
          </p>
        </div>

        <SectionCard title="Every state">
          <Row label="Lead · answered">
            <TickScale tier="lead" value={tick} onChange={setTick} label="Work Quality" />
          </Row>
          <Row label="Unanswered">
            <TickScale tier="lead" value={tickBlank} onChange={setTickBlank} label="Work Speed" />
          </Row>
          <Row label="Error">
            <TickScale
              tier="lead"
              value={null}
              onChange={() => {}}
              error="Tick one before submitting."
              label="Workplace Safety"
            />
          </Row>
          <Row label="Read-only">
            <TickScale tier="final" value="EXCELLENT" readOnly label="Overall Performance" />
          </Row>
        </SectionCard>
      </section>

      {/* ---------- Tier identity ---------- */}
      <section className="space-y-6">
        <h2 className="section-header">TierBadge and TierLegend</h2>
        <SectionCard title="Tier identity" description="Appears once at the top of any multi-tier screen.">
          <Row label="Individual badges">
            <div className="flex flex-wrap gap-2">
              {(["self", "lead", "final"] as Tier[]).map((tier) => (
                <TierBadge key={tier} tier={tier} />
              ))}
            </div>
          </Row>
          <Row label="Full legend — the collision view">
            <TierLegend />
          </Row>
          <Row label="Subset — the HOD review screen has no emerald on it">
            <TierLegend tiers={["self", "lead"]} />
          </Row>
        </SectionCard>
      </section>

      {/* ---------- StatusChip ---------- */}
      <section className="space-y-6">
        <div className="space-y-2">
          <h2 className="section-header">StatusChip</h2>
          <p className="max-w-form font-sans text-body-sm text-ink-muted">
            Fixed mapping. The employee vocabulary differs on purpose — §8 forbids showing an
            employee a raw status enum.
          </p>
        </div>

        <SectionCard title="Both audiences">
          <Row label="Internal — HR, leads and the MD">
            <div className="flex flex-wrap gap-2">
              {ALL_STATUSES.map((status) => (
                <StatusChip key={status} status={status} />
              ))}
            </div>
          </Row>
          <Row label="Employee-facing — In progress · Submitted · Under review · Completed">
            <div className="flex flex-wrap gap-2">
              {ALL_STATUSES.map((status) => (
                <StatusChip key={status} status={status} audience="employee" />
              ))}
            </div>
          </Row>
        </SectionCard>
      </section>

      {/* ---------- ProgressRail ---------- */}
      <section className="space-y-6">
        <h2 className="section-header">ProgressRail</h2>
        <SectionCard title="Five nodes, tracking the state machine">
          {(["CYCLE_ACTIVE", "SELF_SUBMITTED", "LEAD_REVIEWED", "MD_FINALIZED", "CLOSED"] as ChipStatus[]).map(
            (status) => (
              <Row key={status} label={status}>
                <ProgressRail
                  status={status}
                  holderName="Nikita Dhawade"
                  holderSince="2026-08-12T09:00:00+05:30"
                />
              </Row>
            ),
          )}
          <Row label="Employee audience — no enum wording anywhere">
            <ProgressRail status="MD_FINALIZED" audience="employee" holderName="Your reviewer" />
          </Row>
        </SectionCard>
      </section>

      {/* ---------- Scores ---------- */}
      <section className="space-y-6">
        <h2 className="section-header">ScoreStat and DeltaChip</h2>
        <SectionCard title="Numerals" description="Every number is mono and tabular so columns align.">
          <Row label="Three tiers side by side — the collision summary">
            <div className="grid gap-4 sm:grid-cols-3">
              <ScoreStat label="Self" value={3.8} tier="self" caption="of 5" />
              <ScoreStat label="Lead" value={4.25} tier="lead" caption="of 5" />
              <ScoreStat label="Final" value={4.1} tier="final" caption="of 5" />
            </div>
          </Row>
          <Row label="Untinted, and an absent score — an em dash, never 0.00">
            <div className="grid gap-4 sm:grid-cols-3">
              <ScoreStat label="Questions" value="28" raw caption="in this form" />
              <ScoreStat label="Completion" value="64%" raw caption="of the department" />
              <ScoreStat label="Final" value={null} caption="not yet finalised" />
            </div>
          </Row>
          <Row label="Variance — warning at |Δ| ≥ 2, critical at ≥ 3">
            <div className="flex flex-wrap items-center gap-3">
              <DeltaChip delta={0} />
              <DeltaChip delta={1} />
              <DeltaChip delta={2} />
              <DeltaChip delta={-3} />
              <DeltaChip delta={null} />
            </div>
          </Row>
        </SectionCard>
      </section>

      {/* ---------- Autosave ---------- */}
      <section className="space-y-6">
        <h2 className="section-header">AutosaveIndicator</h2>
        <SectionCard title="Three states" description="Never lose a half-filled form.">
          <Row label="idle · saving · saved · error">
            <div className="flex flex-wrap items-center gap-6">
              <AutosaveIndicator state="idle" />
              <AutosaveIndicator state="saving" />
              <AutosaveIndicator state="saved" savedAt="2026-08-12T14:32:00+05:30" />
              <AutosaveIndicator state="error" />
            </div>
          </Row>
        </SectionCard>
      </section>

      {/* ---------- SectionCard + QuestionRow ---------- */}
      <section className="space-y-6">
        <h2 className="section-header">SectionCard and QuestionRow</h2>
        <SectionCard
          title="Core performance"
          description="The visual unit of the whole product."
          action={<StatusChip status="CYCLE_ACTIVE" />}
        >
          <QuestionRow
            label="Delivery Efficiency"
            helpText="Ability to complete assignments within timelines without compromising quality"
            required
          >
            <RatingScale tier="self" value={4} onChange={() => {}} label="Delivery Efficiency" />
          </QuestionRow>
          <QuestionRow label="Support required from management (if any)">
            <p className="font-sans text-body text-ink-faint">A textarea goes here.</p>
          </QuestionRow>
        </SectionCard>
      </section>

      {/* ---------- Metric widgets ---------- */}
      <section className="space-y-6">
        <div className="space-y-2">
          <h2 className="section-header">MetricWidget</h2>
          <p className="max-w-form text-body-sm text-ink-muted">
            The dashboard tile: label, a large tabular number, and a trend pill. Green up, red
            down — the one place green means &ldquo;positive&rdquo;, which is why it is not a tier
            colour.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricWidget label="People" value={128} accent="primary" trend={{ value: 4.23, caption: "vs last cycle" }} />
          <MetricWidget label="Submitted" value={"64%"} accent="cyan" trend={{ value: -1.5 }} />
          <MetricWidget label="Departments" value={5} accent="pink" caption="all mapped" />
          <MetricWidget label="Final" value={"—"} accent="green" caption="not yet finalised" />
        </div>
      </section>

      {/* ---------- Charts ---------- */}
      <section className="space-y-6">
        <div className="space-y-2">
          <h2 className="section-header">Data visualisations</h2>
          <p className="max-w-form text-body-sm text-ink-muted">
            Smooth splines with gradient fills, rounded bar tops, and a donut with a central
            number. Tier colours are deliberately absent — a series tinted like a tier would claim
            to mean &ldquo;who said this&rdquo;.
          </p>
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <DashboardCard title="Evaluation activity" className="lg:col-span-2">
            <TrendAreaChart
              data={[
                { period: "Apr", submitted: 12, reviewed: 4 },
                { period: "May", submitted: 28, reviewed: 17 },
                { period: "Jun", submitted: 41, reviewed: 33 },
                { period: "Jul", submitted: 37, reviewed: 35 },
              ]}
              xKey="period"
              series={[
                { key: "submitted", label: "Self submitted", color: "cyan" },
                { key: "reviewed", label: "Lead reviewed", color: "pink" },
              ]}
            />
            <ChartLegend
              className="pt-2"
              items={[
                { label: "Self submitted", fill: CHART_COLORS.cyan },
                { label: "Lead reviewed", fill: CHART_COLORS.pink },
              ]}
            />
          </DashboardCard>

          <DashboardCard title="By stage">
            {/* Ordinal, not categorical: these are positions in one funnel, so
                the ramp carries the order. */}
            <StatusDonutChart
              data={[
                { name: "In progress", value: 18, fill: ordinalStep(0) },
                { name: "Submitted", value: 24, fill: ordinalStep(1) },
                { name: "Reviewed", value: 11, fill: ordinalStep(2) },
                { name: "Closed", value: 7, fill: ordinalStep(3) },
              ]}
              centerValue="60"
              centerLabel="evaluations"
            />
          </DashboardCard>

          <DashboardCard title="Questions by department" className="lg:col-span-3">
            <CompletionBarChart
              data={[
                { name: "MIS", questions: 3 },
                { name: "Sales", questions: 3 },
                { name: "Operations", questions: 3 },
                { name: "Designs", questions: 3 },
                { name: "Accounts", questions: 2 },
              ]}
              xKey="name"
              valueKey="questions"
            />
          </DashboardCard>
        </div>
      </section>

      {/* ---------- Buttons and inputs, every state ---------- */}
      <section className="space-y-6">
        <h2 className="section-header">Buttons and inputs · every state</h2>
        <DashboardCard title="Buttons">
          <div className="space-y-4">
            <Row label="Variants">
              <div className="flex flex-wrap items-center gap-3">
                <Button>Primary</Button>
                <Button variant="secondary">Secondary</Button>
                <Button variant="outline">Outline</Button>
                <Button variant="ghost">Ghost</Button>
                <Button variant="destructive">Destructive</Button>
                <Button variant="link">Link</Button>
              </div>
            </Row>
            <Row label="Disabled">
              <div className="flex flex-wrap items-center gap-3">
                <Button disabled>Primary</Button>
                <Button variant="outline" disabled>
                  Outline
                </Button>
                <Button variant="ghost" disabled>
                  Ghost
                </Button>
              </div>
            </Row>
            <Row label="Sizes">
              <div className="flex flex-wrap items-center gap-3">
                <Button size="sm">Small</Button>
                <Button>Default</Button>
                <Button size="lg">Large</Button>
              </div>
            </Row>
          </div>
        </DashboardCard>

        <DashboardCard title="Inputs">
          <div className="grid max-w-form gap-4">
            <Row label="Default — tab in to see the accent focus ring">
              <Input placeholder="Aarti Shah" />
            </Row>
            <Row label="Filled">
              <Input defaultValue="Aarti Shah" />
            </Row>
            <Row label="Error">
              <div className="space-y-1">
                <Input aria-invalid defaultValue="not-an-email" className="border-critical" />
                <p className="text-body-sm text-critical">Enter a valid email address.</p>
              </div>
            </Row>
            <Row label="Disabled">
              <Input disabled placeholder="Locked after submit" />
            </Row>
          </div>
        </DashboardCard>
      </section>

      {/* ---------- States ---------- */}
      <section className="space-y-6">
        <h2 className="section-header">EmptyState, ErrorState and TableSkeleton</h2>
        <div className="space-y-4">
          <EmptyState
            title="No evaluations are open for you right now"
            body="You will get a WhatsApp message when the next cycle starts."
          />
          <ErrorState
            body="We could not load your evaluation. Refresh the page, and tell HR if it keeps happening."
            detail="Reference: EVAL-LOAD-503"
            action={
              <Button variant="outline" size="sm">
                Try again
              </Button>
            }
          />
          <TableSkeleton rows={4} columns={5} />
        </div>
      </section>
    </div>
  );
}
