"use client";
// "What happens when you tap Dibs": a doodle sequence diagram in inline SVG. The resting CSS is the final
// drawn state; the build-up runs only inside prefers-reduced-motion: no-preference, once per Replay.
import { useState } from "react";
import { Button } from "@/components/ui";

const CSS = `
.td text { font-family: inherit; fill: var(--color-ink); }
.td .box { stroke: var(--color-ink); stroke-width: 2.5; }
.td .ln { fill: none; stroke: var(--color-ink); stroke-width: 2.5; stroke-linecap: round; stroke-linejoin: round; }
.td .num { fill: var(--color-ink); }
@media (prefers-reduced-motion: no-preference) {
  .td .st { animation: td-in 0.45s cubic-bezier(0.2, 0.8, 0.2, 1) calc(var(--i) * 0.7s) both; transform-box: fill-box; transform-origin: center; }
  .td .ln { stroke-dasharray: 1; animation: td-draw 0.45s ease-out calc(var(--i) * 0.7s - 0.3s) both; }
  @keyframes td-in { from { opacity: 0; transform: translateY(8px) scale(0.97); } to { opacity: 1; transform: none; } }
  @keyframes td-draw { from { stroke-dashoffset: 1; } to { stroke-dashoffset: 0; } }
}
`;

type Step = { i: number; y: number; h: number; fill: string; title: string; sub: string; light?: boolean };
const STEPS: Step[] = [
  { i: 1, y: 8, h: 54, fill: "var(--color-card)", title: "Your browser", sub: "you tap Dibs!" },
  { i: 2, y: 94, h: 54, fill: "var(--color-sky)", title: "API route", sub: "POST /api/claims" },
  { i: 4, y: 404, h: 54, fill: "var(--color-peach)", title: "Outbox", sub: "sent right away, retried if it fails" },
  { i: 5, y: 490, h: 54, fill: "var(--color-ink)", title: "Nexconn open channel", sub: "sale room · a DB:Sold card", light: true },
];

// Arrow between boxes: [from y, to y, step it belongs to]
const ARROWS: [number, number, number][] = [[62, 94, 2], [148, 180, 3], [372, 404, 4], [458, 490, 5], [544, 574, 6]];
const INNER = ["Lock the drop and the stock row", "First in wins; the rest queue in order", "Write the claim and an outbox row"];

export function TapDiagram() {
  const [run, setRun] = useState(0);
  return (
    <div>
      <style>{CSS}</style>
      <svg key={run} className="td mx-auto block w-full max-w-[360px]" viewBox="0 0 340 640" role="img"
        aria-label="Sequence: your browser sends the tap to an API route, which runs one Postgres transaction that locks the stock row, picks the first tap and writes an outbox row. The outbox sends a card to the Nexconn open channel, which delivers it to every browser.">
        {STEPS.map((s) => (
          <g key={s.i} className="st" style={{ "--i": s.i } as React.CSSProperties}>
            <rect className="box" x={10} y={s.y} width={320} height={s.h} rx={14} fill={s.fill} />
            <text x={26} y={s.y + 23} fontSize={16} fontWeight={800} style={s.light ? { fill: "var(--color-lime)" } : undefined}>{s.title}</text>
            <text x={26} y={s.y + 42} fontSize={13.5} style={s.light ? { fill: "var(--color-paper)" } : undefined}>{s.sub}</text>
            <circle className="box" cx={308} cy={s.y + 27} r={13} fill="var(--color-lime)" />
            <text x={308} y={s.y + 32} fontSize={14} fontWeight={800} textAnchor="middle">{s.i}</text>
          </g>
        ))}

        {/* 3: the transaction */}
        <g className="st" style={{ "--i": 3 } as React.CSSProperties}>
          <rect className="box" x={10} y={180} width={320} height={192} rx={14} fill="var(--color-mint)" />
          <text x={26} y={205} fontSize={16} fontWeight={800}>One Postgres transaction</text>
          <circle className="box" cx={308} cy={206} r={13} fill="var(--color-lime)" />
          <text x={308} y={211} fontSize={14} fontWeight={800} textAnchor="middle">3</text>
          {INNER.map((t, k) => (
            <g key={t}>
              <rect className="box" x={26} y={222 + k * 46} width={288} height={36} rx={9} fill="var(--color-card)" />
              <text x={38} y={245 + k * 46} fontSize={14}>{t}</text>
              {k < 2 && <path className="ln" pathLength={1} d={`M170 ${258 + k * 46} L170 ${268 + k * 46}`} />}
            </g>
          ))}
        </g>

        {ARROWS.map(([a, b, i]) => (
          <g key={i} style={{ "--i": i } as React.CSSProperties}>
            <path className="ln" pathLength={1} d={`M170 ${a} L170 ${b - 2}`} />
            <path className="ln" d={`M162 ${b - 10} L170 ${b - 1} L178 ${b - 10}`} />
          </g>
        ))}

        {/* 6: every browser */}
        <g className="st" style={{ "--i": 6 } as React.CSSProperties}>
          {[["Buyer", 10], ["You", 125], ["Seller", 240]].map(([t, x]) => (
            <g key={t as string}>
              <rect className="box" x={x as number} y={576} width={90} height={56} rx={12} fill={t === "You" ? "var(--color-lime)" : "var(--color-card)"} />
              <text x={(x as number) + 45} y={600} fontSize={14} fontWeight={800} textAnchor="middle">{t}</text>
              <text x={(x as number) + 45} y={619} fontSize={12.5} textAnchor="middle">sees SOLD</text>
            </g>
          ))}
        </g>
      </svg>
      <div className="mt-3 flex justify-center">
        <Button variant="ghost" size="sm" icon="arrowRight" onClick={() => setRun((r) => r + 1)}>Replay the animation</Button>
      </div>
    </div>
  );
}
