import * as d3 from "d3";
import { epochDay } from "./data";

interface TimelineOpts {
  container: HTMLElement;
  byMonth: Record<string, number>;
  dateMin: string;
  dateMax: string;
  initial?: [string, string]; // optional starting window (ISO dates); default = last 90 days
  onChange: (minDay: number, maxDay: number) => void;
}

const MARGIN = { top: 6, right: 8, bottom: 18, left: 8 };
const HEIGHT = 64;

export class Timeline {
  private opts: TimelineOpts;
  private x: d3.ScaleTime<number, number>;
  private bars: { date: Date; count: number }[];
  private brush!: d3.BrushBehavior<unknown>;
  private gBrush!: d3.Selection<SVGGElement, unknown, null, undefined>;
  private svg!: d3.Selection<SVGSVGElement, unknown, null, undefined>;
  private width = 0;
  private selection: [Date, Date];

  constructor(opts: TimelineOpts) {
    this.opts = opts;
    this.bars = Object.entries(opts.byMonth)
      .map(([ym, count]) => ({ date: new Date(ym + "-01T00:00:00Z"), count }))
      .sort((a, b) => +a.date - +b.date);

    const t0 = new Date(opts.dateMin + "T00:00:00Z");
    const t1 = new Date(opts.dateMax + "T00:00:00Z");
    this.x = d3.scaleTime().domain([t0, t1]);

    const clamp = (d: Date) => (d < t0 ? t0 : d > t1 ? t1 : d);
    if (opts.initial) {
      // Restore a shared window from the URL.
      this.selection = [clamp(new Date(opts.initial[0] + "T00:00:00Z")), clamp(new Date(opts.initial[1] + "T00:00:00Z"))];
    } else {
      // Default window: last 90 days of available data.
      const start = new Date(t1);
      start.setUTCDate(start.getUTCDate() - 90);
      this.selection = [clamp(start), t1];
    }

    this.render();
    window.addEventListener("resize", () => this.render());
  }

  private render() {
    const { container } = this.opts;
    this.width = container.clientWidth;
    const innerW = this.width - MARGIN.left - MARGIN.right;
    const innerH = HEIGHT - MARGIN.top - MARGIN.bottom;
    this.x.range([0, innerW]);

    container.querySelector("svg")?.remove();
    this.svg = d3
      .select(container)
      .append("svg")
      .attr("width", this.width)
      .attr("height", HEIGHT)
      .style("display", "block");

    const g = this.svg.append("g").attr("transform", `translate(${MARGIN.left},${MARGIN.top})`);
    const maxCount = d3.max(this.bars, (b) => b.count) ?? 1;
    const y = d3.scaleLinear().domain([0, maxCount]).range([innerH, 0]);
    const barW = Math.max(1, innerW / Math.max(this.bars.length, 1) - 1);

    // Histogram backdrop.
    g.selectAll("rect.bar")
      .data(this.bars)
      .join("rect")
      .attr("class", "bar")
      .attr("x", (b) => this.x(b.date))
      .attr("y", (b) => y(b.count))
      .attr("width", barW)
      .attr("height", (b) => innerH - y(b.count))
      .attr("fill", "#1B4179");

    // Axis ticks (years).
    const axis = d3.axisBottom(this.x).ticks(d3.timeYear.every(1)).tickFormat(d3.timeFormat("%Y") as any).tickSizeOuter(0);
    g.append("g")
      .attr("transform", `translate(0,${innerH})`)
      .call(axis)
      .call((sel) => {
        sel.select(".domain").attr("stroke", "#123059");
        sel.selectAll(".tick line").attr("stroke", "#123059");
        sel.selectAll(".tick text").attr("fill", "#9DB0C4").attr("font-size", 10).attr("font-family", "JetBrains Mono, monospace");
      });

    // Brush.
    this.brush = d3
      .brushX()
      .extent([[0, 0], [innerW, innerH]])
      .on("brush end", (ev) => this.onBrush(ev));

    this.gBrush = g.append("g").attr("class", "brush").call(this.brush as any);
    this.styleBrush();

    // Apply current selection.
    this.gBrush.call(this.brush.move as any, this.selection.map((d) => this.x(d)));
  }

  private styleBrush() {
    this.gBrush.selectAll(".selection").attr("fill", "#3DB9D8").attr("fill-opacity", 0.14).attr("stroke", "#3DB9D8").attr("stroke-opacity", 0.5);
    this.gBrush.selectAll(".handle").attr("fill", "#3DB9D8").attr("rx", 2);
  }

  private onBrush(ev: d3.D3BrushEvent<unknown>) {
    if (!ev.selection) return;
    const [x0, x1] = ev.selection as [number, number];
    const d0 = this.x.invert(x0);
    const d1 = this.x.invert(x1);
    this.selection = [d0, d1];
    this.styleBrush();

    // Recolor bars inside the window.
    this.svg
      .selectAll<SVGRectElement, { date: Date; count: number }>("rect.bar")
      .attr("fill", (b) => {
        const bx = this.x(b.date);
        return bx >= x0 - 0.5 && bx <= x1 ? "#3DB9D8" : "#1B4179";
      });

    this.opts.onChange(epochDay(iso(d0)), epochDay(iso(d1)));
  }

  get current(): [number, number] {
    return [epochDay(iso(this.selection[0])), epochDay(iso(this.selection[1]))];
  }
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}
