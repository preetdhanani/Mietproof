// build.mjs — assembles the citation-line page. Run: node build.mjs [--light]
import { writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as k from "file:///Users/pritdhanani/.agents/skills/anatomy/kit/iso-kit.mjs";
import { kitScript } from "file:///Users/pritdhanani/.agents/skills/anatomy/scripts/inline-kit.mjs";
import * as M from "./model.mjs";
import * as parts from "./parts.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const theme = process.argv.includes("--light") ? "light" : "dark";

const moving = (part, inner) => `<g data-part="${part}">${inner}</g>`;

const svg = k.figureSvg({
  width: M.WIDTH,
  height: M.HEIGHT,
  label:
    "The citation line: a bench-top production line that turns a question into a verified answer. A slip rides the rail past a quota meter, a confidence weighbridge with a semaphore divert, a three-drawer card catalog, a tape writer and a verification stamp into the dispatch tray, while a chart-recorder ledger under the bench traces every move and a four-dial inspector panel hangs above.",
  body: [
    parts.base(),
    parts.ledger(),
    parts.bus(),
    parts.press(),
    parts.intake(),
    parts.scale(),
    parts.signalPost(),
    parts.catalog(),
    parts.writer(),
    moving("tape", parts.tape()),
    parts.verifier(),
    parts.panel(),
    parts.frame(),
    parts.siding(),
    moving("drawer", parts.drawerOpen()),
    `<g data-part="arm"><path class="iso-line" data-tone="mid" data-free="start" d="${M.faceLine([-44, 3, 13], [-34, 3, 13])}" style="stroke-width:1.6"/><circle data-part="armLamp" cx="${M.at([-34, 3, 13])[0]}" cy="${M.at([-34, 3, 13])[1]}" r="1.1" fill="var(--anatomy-mid)"/></g>`,
    `<g data-part="scaleNeedle"><path class="iso-line" data-tone="hi" data-free="start" d="${M.topNeedle(M.DIAL[0], M.DIAL[1], M.DIAL_TOP + 0.2, 1.2, M.DIAL_R - 3.4, M.SCALE_VALUE_PASS, M.DIAL_SPAN, M.DIAL_START)}" style="stroke-width:1.1"/></g>`,
    `<g data-part="sweep"><path class="iso-line" data-tone="lit" data-free="start" d="${M.panelNeedle(87, 63, 0.8, M.DIAL_R_P - 2.2, 0, Math.PI * 1.5, Math.PI * 0.75)}" style="stroke-width:1"/></g>`,
    `<g data-part="pen"><path class="iso-line" data-tone="mid" data-free="start" d="${M.faceLine([M.LEDGER.x + 30, M.LEDGER_FACE_Y, M.LEDGER_Z1 - 1], [M.LEDGER.x + 30, M.LEDGER_FACE_Y - 3.5, M.LEDGER_Z1 - 5])}" style="stroke-width:1.2"/></g>`,
    `<g data-part="flag"><path class="iso-line" data-tone="mid" data-free="" d="${M.faceLine([95.5, M.PANEL_FACE_Y, 60], [95.5, M.PANEL_FACE_Y, 68])}" style="stroke-width:1.6"/><circle cx="${M.at([95.5, M.PANEL_FACE_Y, 60])[0]}" cy="${M.at([95.5, M.PANEL_FACE_Y, 60])[1]}" r="0.9" fill="var(--anatomy-mid)"/></g>`,
    `<g data-part="lamps"><circle data-part="lampPass" cx="${M.at([90, -1.2, 25])[0]}" cy="${M.at([90, -1.2, 25])[1]}" r="1.5" fill="var(--anatomy-lo)" opacity="0.35"/><circle data-part="lampReject" cx="${M.at([90, -1.2, 21.5])[0]}" cy="${M.at([90, -1.2, 21.5])[1]}" r="1.5" fill="var(--anatomy-lo)" opacity="0.35"/></g>`,
    `<g data-part="rail">${parts.rail()}</g>`,
    moving("slip", parts.slip()),
    moving("stamp", parts.stampHead()),
  ],
});

const live = readFileSync(join(HERE, "live.js"), "utf8")
  .replace("__P__", JSON.stringify(M.P))
  .replace("__DIAL__", JSON.stringify(M.DIAL))
  .replace("__DIAL_R__", String(M.DIAL_R))
  .replace("__DIAL_TOP__", String(M.DIAL_TOP))
  .replace("__DIAL_SPAN__", String(M.DIAL_SPAN))
  .replace("__DIAL_START__", String(M.DIAL_START))
  .replace("__PANEL_FACE_Y__", JSON.stringify(M.PANEL_FACE_Y))
  .replace("__DIAL_R_P__", String(M.DIAL_R_P))
  .replace("__LEDGER__", JSON.stringify(M.LEDGER))
  .replace("__LEDGER_FACE_Y__", JSON.stringify(M.LEDGER_FACE_Y))
  .replace("__LEDGER_Z1__", String(M.LEDGER_Z1))
  .replace("__METER_MAX__", String(M.METER_MAX))
  .replace("__SCALE_VALUE_PASS__", String(M.SCALE_VALUE_PASS))
  .replace("__SCALE_VALUE_DIVERT__", String(M.SCALE_VALUE_DIVERT))
  .replace("__DRAWER_OUT__", String(M.DRAWER_OUT))
  .replace("__STATIONS__", JSON.stringify(M.STATIONS))
  .replace("__SLIP_X0__", String(M.SLIP_X0))
  .replace("__TRAY__", JSON.stringify(M.TRAY_XY))
  .replace("__RAIL_Y__", String(M.RAIL_Y));

const body = k.plateHtml({
  fig: "Fig 1",
  title: "The citation line — a RAG pipeline as a machine",
  hint: "Space runs a question · hover a station · arrows step",
  readout: "idle · press space to run a question · hover a station",
  keys: [
    { mark: "lit", label: "The question slip on its carrier — what the pipeline moves" },
    { mark: "raised", label: "Five index cards in the open drawer: k=5 retrieved chunks" },
    { mark: "edge", label: "Semaphore + siding: the confidence floor diverting out-of-scope questions" },
    { mark: "dim", label: "Ledger under the bench: the trace recorder; panel above: the four-check CI gate" },
  ],
  caption:
    "A question slip rides the rail. The meter counts it against the hourly quota (10/h). The weighbridge reads the retrieval confidence against the calibrated floor — below it, the semaphore lifts and the slip takes the siding to the covered-topics tray. The catalog's three drawers are the retrieval backends; the open drawer shows the five chunks (k=5) the answer may cite. The writer drafts from them; the stamp checks every cited paragraph against the corpus — one rewrite, then the reject chute — and only a stamped slip reaches dispatch. Under the bench the ledger traces each span; above, the inspector's four dials are the CI gate that holds the thresholds.",
  body: `<div class="iso-stage" tabindex="0" role="group" aria-label="The citation line: press space to run a question through the pipeline, arrow keys to step between stations">${svg}</div>`,
});

const file = join(HERE, theme === "light" ? "citation-line-light.html" : "citation-line.html");
writeFileSync(file, k.pageHtml({ title: "The citation line", theme, body, script: kitScript() + live, width: 1020 }));
console.log("wrote", file);

// ── Standalone SVG for README embedding: a working pose, styles embedded ────
if (process.argv.includes("--svg")) {
  const lit = (on) => `fill="var(--anatomy-lit)" opacity="${on ? "1" : "0.35"}"`;
  const poseBody = [
    parts.base(),
    parts.ledger(),
    parts.bus(),
    parts.press(),
    parts.intake(),
    `<text data-part="meterText" transform="${k.topMatrix([-90.5, -24.5], 21.5, M.P, "x")}" text-anchor="middle" class="iso-face" style="font-size:2.6px">04/10</text>`,
    parts.scale(),
    parts.signalPost(),
    parts.catalog(),
    parts.writer(),
    `<g data-part="tape" transform="${k.translateAlong(M.P, [0, 7, 0])}">${parts.tape()}</g>`,
    parts.verifier(),
    parts.panel(),
    parts.frame(),
    parts.siding(),
    `<g data-part="drawer" transform="${k.translateAlong(M.P, [0, M.DRAWER_OUT + 4.5, 0])}">${parts.drawerOpen()}</g>`,
    `<g data-part="arm"><path class="iso-line" data-tone="mid" data-free="start" d="${M.faceLine([-44, 3, 13], [-34, 3, 13])}" style="stroke-width:1.6"/><circle data-part="armLamp" cx="${M.at([-34, 3, 13])[0]}" cy="${M.at([-34, 3, 13])[1]}" r="1.1" fill="var(--anatomy-mid)"/></g>`,
    `<g data-part="scaleNeedle"><path class="iso-line" data-tone="hi" data-free="start" d="${M.topNeedle(M.DIAL[0], M.DIAL[1], M.DIAL_TOP + 0.2, 1.2, M.DIAL_R - 3.4, M.SCALE_VALUE_PASS, M.DIAL_SPAN, M.DIAL_START)}" style="stroke-width:1.1"/></g>`,
    `<g data-part="sweep"><path class="iso-line" data-tone="lit" data-free="start" d="${M.panelNeedle(87, 63, 0.8, M.DIAL_R_P - 2.2, 0.5, Math.PI * 1.5, Math.PI * 0.75)}" style="stroke-width:1"/></g>`,
    `<g data-part="pen"><path class="iso-line" data-tone="mid" data-free="start" d="${M.faceLine([M.LEDGER.x + 30, M.LEDGER_FACE_Y, M.LEDGER_Z1 - 1], [M.LEDGER.x + 30, M.LEDGER_FACE_Y - 3.5, M.LEDGER_Z1 - 5])}" style="stroke-width:1.2"/></g>`,
    `<g data-part="flag"><path class="iso-line" data-tone="mid" data-free="" d="${M.faceLine([95.5, M.PANEL_FACE_Y, 60], [95.5, M.PANEL_FACE_Y, 68])}" style="stroke-width:1.6"/><circle cx="${M.at([95.5, M.PANEL_FACE_Y, 60])[0]}" cy="${M.at([95.5, M.PANEL_FACE_Y, 60])[1]}" r="0.9" fill="var(--anatomy-mid)"/></g>`,
    `<g data-part="lamps"><circle data-part="lampPass" cx="${M.at([90, -1.2, 25])[0]}" cy="${M.at([90, -1.2, 25])[1]}" r="1.5" ${lit(true)}/><circle data-part="lampReject" cx="${M.at([90, -1.2, 21.5])[0]}" cy="${M.at([90, -1.2, 21.5])[1]}" r="1.5" fill="var(--anatomy-lo)" opacity="0.35"/></g>`,
    `<g data-part="rail">${parts.rail()}</g>`,
    `<g data-part="slip" transform="${k.translateAlong(M.P, [90, 0, 0])}">${parts.slip()}</g>`,
    `<g data-part="stamp" transform="${k.translateAlong(M.P, [0, 0, -12])}">${parts.stampHead()}</g>`,
  ];
  const stand = k.figureSvg({
    width: M.WIDTH,
    height: M.HEIGHT,
    label:
      "The citation line: a bench-top production line that turns a question into a verified answer. A slip rides the rail past a quota meter, a confidence weighbridge, a three-drawer card catalog, a tape writer and a verification stamp into the dispatch tray, while a chart-recorder ledger under the bench traces every move and a four-dial inspector panel hangs above.",
    body: poseBody,
    standalone: theme,
  });
  const svgFile = join(HERE, theme === "light" ? "citation-line-light.svg" : "citation-line.svg");
  writeFileSync(svgFile, stand);
  console.log("wrote", svgFile);
}
