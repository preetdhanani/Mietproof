// parts.mjs — every static part of the citation line, painter's order handled by the assembler.
import * as k from "file:///Users/pritdhanani/.agents/skills/anatomy/kit/iso-kit.mjs";
import {
  P, at, S, L, D, W, byDepth, faceLine, topNeedle, panelNeedle, panelTicks,
  BENCH, BENCH_H, FOOT_H, RAIL_Y, RAIL_X0, RAIL_X1, RAIL_TOP,
  DIAL, DIAL_R, DIAL_Z, DIAL_TOP, DIAL_SPAN, DIAL_START, FLOOR_MARK,
  PANEL, PANEL_Z0, PANEL_Z1, PANEL_FACE_Y, DIALS, DIAL_R_P,
  CATALOG, CATALOG_TOP, DRAWER_Z, DRAWER_H, DRAWER_OUT, CARDS,
  PRESS, POST_L, POST_R, RAILBAR_Z,
  LEDGER, LEDGER_Z0, LEDGER_Z1, LEDGER_FACE_Y,
  BUS, TRAY_XY,
} from "./model.mjs";

// ── Base: plate, feet, screws, ruler strip ──────────────────────────────────
export function base() {
  const out = [`<path class="iso-halo" d="${k.haloOf(BENCH, -BENCH_H - FOOT_H, BENCH_H + FOOT_H, P)}"/>`];
  for (const [x, y] of byDepth(k.corners(BENCH, 16))) {
    out.push(S(k.cylinder(x, y, 7, -BENCH_H - FOOT_H, 1.6, P, 28), { tone: "lo" }));
    out.push(S(k.cylinder(x, y, 5.4, -BENCH_H - FOOT_H + 1.6, FOOT_H - 1.6, P, 28), { tone: "lo" }));
  }
  out.push(S(k.slabOf(BENCH, -BENCH_H, BENCH_H, P, 10, 1.6), { tone: "mid" }));
  out.push(L(k.planOutline(k.insetPlan(BENCH, 5), 0, P), { tone: "lo" }));
  const screws = k.corners(BENCH, 10);
  out.push(L(screws.map(([x, y]) => k.ring(x, y, 2.2, 0, P, 16)).join(""), { tone: "lo" }));
  out.push(D(screws.map(([x, y]) => at([x, y, 0])), { size: 0.5 }));
  const strip = { x: -140, y: BENCH.y + BENCH.d - 14, w: 284, d: 7, r: 1 };
  out.push(S(k.slabOf(strip, 0, 0.6, P, 3), { tone: "lo", crease: "none" }));
  const ticks = k.topTicks(strip.x + 4, strip.x + strip.w - 4, 4, 5, strip.y + 0.8, 0.6, [2, 3.6], P);
  out.push(L(ticks.minor, { tone: "lo" }), L(ticks.major, { tone: "mid" }));
  out.push(D([at([strip.x + 2, strip.y + 3.5, 0.6]), at([strip.x + strip.w - 2, strip.y + 3.5, 0.6])], { size: 0.45 }));
  return out.join("");
}

// ── Frame: two posts, top rail, panel hangers ───────────────────────────────
export function frame() {
  const out = [];
  for (const [x, y] of [POST_L, POST_R]) {
    out.push(S(k.cylinder(x, y, 3.2, 0, RAILBAR_Z - 4, P, 24), { tone: "mid", crease: "none" }));
    out.push(S(k.cylinder(x, y, 4.2, RAILBAR_Z - 4, 4, P, 24), { tone: "mid" }));
    out.push(D([at([x + 2.4, y + 2.4, RAILBAR_Z])], { size: 0.45 }));
  }
  out.push(S(k.slabOf({ x: -153, y: -33.5, w: 306, d: 7, r: 2 }, RAILBAR_Z, 4, P, 4, 0.5), { tone: "mid" }));
  out.push(L(k.planOutline(k.insetPlan({ x: -153, y: -33.5, w: 306, d: 7, r: 2 }, 1.2), RAILBAR_Z + 4, P, 4), { tone: "faint" }));
  for (const x of [44, 92]) {
    out.push(S(k.slabOf({ x: x - 1, y: PANEL.y + 2.5, w: 2, d: 3, r: 0.6 }, PANEL_Z1, RAILBAR_Z - PANEL_Z1, P, 2), { tone: "mid", crease: "none" }));
  }
  return out.join("");
}

// ── Ingestion press: C-frame, handwheel, ram, law book, Stand-date plate ────
export function press() {
  const out = [];
  out.push(S(k.slabOf(PRESS, 0, 4, P, 6, 0.8), { tone: "mid", inner: k.lineSvg(k.planOutline(k.insetPlan(PRESS, 2.5), 4, P, 6), { tone: "faint" }) }));
  out.push(S(k.slabOf({ x: PRESS.x + 2, y: PRESS.y + 2, w: 7, d: PRESS.d - 4, r: 2 }, 4, 30, P, 4, 0.6), { tone: "mid" }));
  out.push(S(k.slabOf({ x: PRESS.x + 2, y: PRESS.y + 2, w: PRESS.w - 4, d: 7, r: 2 }, 30, 7, P, 4, 0.6), { tone: "mid" }));
  out.push(S(k.cylinder(-127, -31, 3.4, 22, 18, P, 20), { tone: "mid", crease: "none" }));
  out.push(S(k.cylinder(-127, -31, 5, 18, 4, P, 24), { tone: "mid" }));
  out.push(L(k.sideArc(-127, -31, 5, 19, P, 24), { tone: "faint" }));
  const wheel = [-133, -31];
  out.push(S(k.cylinder(wheel[0], wheel[1], 7.5, 37, 4.5, P, 40, 0.6), { tone: "hi", crease: "lo" }));
  out.push(L(k.knurl(wheel[0], wheel[1], 7.5, 37.6, 41, 40, P, 0.3), { tone: "lo" }));
  out.push(L(k.ring(wheel[0], wheel[1], 2.2, 41.5, P, 20), { tone: "lo" }));
  out.push(D([at([wheel[0], wheel[1], 41.5])], { size: 0.5 }));
  for (const a of [0.5, 2.6, 4.7]) {
    out.push(L(faceLine(
      [wheel[0] + Math.cos(a) * 2.2, wheel[1] + Math.sin(a) * 2.2, 41.5],
      [wheel[0] + Math.cos(a) * 7.3, wheel[1] + Math.sin(a) * 7.3, 41.5],
    ), { tone: "lo" }));
  }
  const plate = { x: PRESS.x + 4, y: PRESS.y + PRESS.d - 8, w: 13, d: 5, r: 0.8 };
  out.push(S(k.slabOf(plate, 4, 1, P, 2), { tone: "lo", crease: "none" }));
  out.push(L(k.planOutline(k.insetPlan(plate, 0.9), 5, P, 2), { tone: "faint" }));
  out.push(L(k.lineOnTop([plate.x + 1.6, plate.y + 1.4], [plate.x + plate.w - 1.6, plate.y + 1.4], 5, P), { tone: "mid", free: true }));
  out.push(L(k.lineOnTop([plate.x + 1.6, plate.y + 2.5], [plate.x + plate.w - 2.6, plate.y + 2.5], 5, P), { tone: "mid", free: true }));
  out.push(L(k.lineOnTop([plate.x + 1.6, plate.y + 3.6], [plate.x + plate.w - 1.6, plate.y + 3.6], 5, P), { tone: "mid", free: true }));
  const book = { x: -110, y: -40, w: 15, d: 24, r: 1.5 };
  out.push(S(k.slabOf(book, 0, 7.5, P, 3, 0.5), { tone: "mid" }));
  out.push(S(k.slabOf(k.insetPlan(book, 1.2), 1.2, 5.4, P, 3), { tone: "hi", crease: "none" }));
  const pageFace = [];
  for (let z = 1.8; z <= 6.2; z += 0.75) {
    pageFace.push(faceLine([book.x + book.w, book.y + 0.3, z], [book.x + book.w, book.y + book.d - 0.3, z]));
  }
  out.push(L(pageFace.join(""), { tone: "lo" }));
  out.push(L(k.planOutline(k.insetPlan(book, 3), 7.5, P, 3), { tone: "faint" }));
  return out.join("");
}

// ── Intake arch + quota meter ───────────────────────────────────────────────
export function intake() {
  const out = [];
  for (const y of [RAIL_Y - 6, RAIL_Y + 6]) {
    out.push(S(k.cylinder(-102, y, 1.8, 0, 13, P, 16), { tone: "mid", crease: "none" }));
  }
  out.push(S(k.slabOf({ x: -104, y: 5, w: 4, d: 20, r: 1 }, 13, 3.5, P, 2, 0.4), { tone: "mid" }));
  out.push(S(k.slabOf({ x: -105, y: 10, w: 6, d: 8, r: 1 }, 0, 1.4, P, 2), { tone: "lo", crease: "none" }));
  out.push(L(k.planOutline(k.insetPlan({ x: -105, y: 10, w: 6, d: 8, r: 1 }, 1.4), 1.4, P, 2), { tone: "faint" }));
  const meter = { x: -99, y: -40, w: 17, d: 24, r: 2 };
  out.push(S(k.slabOf(meter, 0, 17, P, 4, 0.7), { tone: "mid", inner: k.lineSvg(k.sideSeam(meter, 8.5, P, 4), { tone: "faint" }) }));
  out.push(L(k.planOutline(k.insetPlan(meter, 2), 17, P, 4), { tone: "faint" }));
  out.push(S(k.cylinder(-90.5, -28, 4.6, 17, 4.5, P, 28, 0.5), { tone: "hi", crease: "lo" }));
  out.push(L(k.knurl(-90.5, -28, 4.6, 17.6, 21, 26, P, 0.3), { tone: "lo" }));
  out.push(L(k.ring(-90.5, -28, 3, 21.5, P, 24), { tone: "lo" }));
  out.push(D([at([-90.5, -28, 21.5])], { size: 0.45 }));
  out.push(`<text data-part="meterText" transform="${k.topMatrix([-90.5, -24.5], 21.5, P, "x")}" text-anchor="middle" class="iso-face" style="font-size:2.6px">01/10</text>`);
  out.push(L(k.lineOnTop([-95.5, -31.5], [-85.5, -31.5], 21.5, P), { tone: "lo", free: true }));
  return out.join("");
}

// ── Weighbridge: platform, column, dial with floor mark ─────────────────────
export function scale() {
  const out = [];
  out.push(S(k.slabOf({ x: -71, y: 1, w: 26, d: 26, r: 2 }, 0, RAIL_TOP, P, 4, 0.4), { tone: "mid" }));
  out.push(L(k.planOutline(k.insetPlan({ x: -71, y: 1, w: 26, d: 26, r: 2 }, 1.6), RAIL_TOP, P, 4), { tone: "faint" }));
  out.push(S(k.cylinder(DIAL[0], DIAL[1], 2.6, RAIL_TOP, DIAL_Z - RAIL_TOP, P, 18), { tone: "mid", crease: "none" }));
  out.push(S(k.cylinder(DIAL[0], DIAL[1], DIAL_R, DIAL_Z, DIAL_TOP - DIAL_Z, P, 48, 0.7), { tone: "hi", crease: "lo" }));
  out.push(L(k.knurl(DIAL[0], DIAL[1], DIAL_R, DIAL_TOP - 2.6, DIAL_TOP, 60, P, 0.3), { tone: "lo" }));
  out.push(L(k.ring(DIAL[0], DIAL[1], DIAL_R - 1.8, DIAL_TOP, P, 48), { tone: "lo" }));
  const ticks = k.radialTicks(DIAL[0], DIAL[1], DIAL_R - 1.9, 24, 6, DIAL_TOP, [1.1, 2.2], P, DIAL_START, DIAL_SPAN);
  out.push(L(ticks.minor, { tone: "lo" }), L(ticks.major, { tone: "mid" }));
  out.push(L(topNeedle(DIAL[0], DIAL[1], DIAL_TOP + 0.2, 1.2, DIAL_R - 3.4, FLOOR_MARK, DIAL_SPAN, DIAL_START), { tone: "hi", free: "start" }));
  out.push(S(k.cylinder(DIAL[0] + 7.5, DIAL[1] - 6, 2.2, DIAL_Z + 1, 6, P, 16), { tone: "mid" }));
  out.push(L(k.knurl(DIAL[0] + 7.5, DIAL[1] - 6, 2.2, DIAL_Z + 4, DIAL_Z + 7, 14, P, 0.25), { tone: "lo" }));
  return out.join("");
}

// ── Semaphore signal post at the junction ───────────────────────────────────
export function signalPost() {
  const out = [];
  out.push(S(k.cylinder(-44, 3, 1.8, 0, 15, P, 16), { tone: "mid", crease: "none" }));
  out.push(S(k.cylinder(-44, 3, 2.6, 0, 1.6, P, 16), { tone: "mid" }));
  out.push(S(k.slabOf({ x: -46.5, y: 0.5, w: 5, d: 5, r: 1 }, 15, 2, P, 2, 0.4), { tone: "mid" }));
  return out.join("");
}

// ── Siding rail + out-of-scope tray ─────────────────────────────────────────
export function siding() {
  const out = [];
  out.push(S(k.slabOf({ x: -47, y: 12, w: 5, d: 30, r: 1 }, 0, 2.4, P, 2, 0.3), { tone: "mid" }));
  out.push(D([at([-45, 16, 2.4]), at([-43.5, 38, 2.4])], { size: 0.4 }));
  const tray = { x: TRAY_XY[0] - 12, y: TRAY_XY[1] - 10, w: 24, d: 20, r: 2 };
  out.push(S(k.slabOf(tray, 0, 2.6, P, 4, 0.4), { tone: "mid" }));
  out.push(S(k.extrude(k.ringOf(k.insetPlan(tray, -1.4), 4), 2.6, 3.4, P, { convex: true }), { tone: "mid" }));
  out.push(L(k.planOutline(k.insetPlan(tray, 2), 2.6, P, 4), { tone: "faint" }));
  out.push(S(k.slabOf({ x: tray.x + 4, y: tray.y + 5, w: 15, d: 10, r: 0.8 }, 2.6, 1, P, 2), { tone: "hi", crease: "none" }));
  out.push(L(k.lineOnTop([tray.x + 5.5, tray.y + 7], [tray.x + 17.5, tray.y + 7], 3.6, P), { tone: "lo", free: true }));
  out.push(L(k.lineOnTop([tray.x + 5.5, tray.y + 9], [tray.x + 15, tray.y + 9], 3.6, P), { tone: "lo", free: true }));
  out.push(L(k.lineOnTop([tray.x + 5.5, tray.y + 11], [tray.x + 16.5, tray.y + 11], 3.6, P), { tone: "lo", free: true }));
  return out.join("");
}

// ── Card catalog: body, lid, three drawer fronts, selection dial ────────────
export function catalog() {
  const out = [];
  out.push(S(k.slabOf(CATALOG, 0, CATALOG_TOP, P, 6, 0.8), { tone: "mid", inner: k.lineSvg(k.sideSeam(CATALOG, 14, P, 6), { tone: "faint" }) }));
  out.push(S(k.slabOf(k.insetPlan(CATALOG, -1.5), CATALOG_TOP, 2.2, P, 6, 0.5), { tone: "mid" }));
  out.push(L(k.planOutline(k.insetPlan(k.insetPlan(CATALOG, -1.5), 2), CATALOG_TOP + 2.2, P, 6), { tone: "faint" }));
  for (let i = 0; i < 3; i++) {
    const front = { x: CATALOG.x + 4, y: CATALOG.y + CATALOG.d - 2.5, w: CATALOG.w - 8, d: 2.5, r: 1 };
    const z = DRAWER_Z[i];
    out.push(S(k.slabOf(front, z, DRAWER_H - 1, P, 3, 0.5), { tone: "mid" }));
    out.push(L(k.planOutline(k.insetPlan(front, 1), z + DRAWER_H - 1, P, 3), { tone: "faint" }));
    out.push(S(k.cylinder(CATALOG.x + CATALOG.w / 2, CATALOG.y + CATALOG.d + 0.6, 1.1, z + 2, 2.2, P, 12), { tone: "hi", crease: "none" }));
  }
  out.push(L(k.lineOnTop([CATALOG.x + 3, CATALOG.y + CATALOG.d], [CATALOG.x + CATALOG.w - 3, CATALOG.y + CATALOG.d], 0.01, P), { tone: "faint" }));
  out.push(S(k.cylinder(CATALOG.x + 8, CATALOG.y + 8, 4.6, CATALOG_TOP + 2.2, 4, P, 28, 0.5), { tone: "hi", crease: "lo" }));
  out.push(L(k.knurl(CATALOG.x + 8, CATALOG.y + 8, 4.6, CATALOG_TOP + 2.8, CATALOG_TOP + 6.2, 30, P, 0.3), { tone: "lo" }));
  const ticks = k.radialTicks(CATALOG.x + 8, CATALOG.y + 8, 3.4, 3, 1, CATALOG_TOP + 6.2, [1.6, 1.6], P);
  out.push(L(ticks.major, { tone: "mid" }));
  out.push(L(topNeedle(CATALOG.x + 8, CATALOG.y + 8, CATALOG_TOP + 6.4, 0.8, 3, 0.5, (Math.PI * 2) / 3, Math.PI / 2), { tone: "hi", free: "start" }));
  return out.join("");
}

// The open middle drawer with five index cards (k=5), built at rest (closed).
export function drawerOpen() {
  const out = [];
  const box = { x: CATALOG.x + 4, y: CATALOG.y + CATALOG.d - 2.5, w: CATALOG.w - 8, d: 12, r: 1 };
  out.push(S(k.slabOf(box, DRAWER_Z[1], DRAWER_H - 1, P, 3, 0.5), { tone: "mid" }));
  out.push(S(k.slabOf(k.insetPlan(box, 1.2), DRAWER_Z[1] + DRAWER_H - 1, 1, P, 3), { tone: "lo", crease: "none" }));
  out.push(L(k.planOutline(k.insetPlan(box, 1.2), DRAWER_Z[1] + DRAWER_H, P, 3), { tone: "faint" }));
  const cardW = (CATALOG.w - 8 - 4) / CARDS;
  for (let i = 0; i < CARDS; i++) {
    const card = { x: box.x + 2 + i * cardW + 0.6, y: box.y + 2.5, w: cardW - 1.2, d: 7, r: 0.5 };
    out.push(S(k.slabOf(card, DRAWER_Z[1] + DRAWER_H, 5.5, P, 2, 0.3), { tone: "hi", crease: "lo" }));
    out.push(L(k.lineOnTop([card.x + 1, card.y + 2], [card.x + card.w - 1, card.y + 2], DRAWER_Z[1] + DRAWER_H + 5.5, P), { tone: "lo", free: true }));
    out.push(L(k.lineOnTop([card.x + 1, card.y + 3.6], [card.x + card.w - 1.8, card.y + 3.6], DRAWER_Z[1] + DRAWER_H + 5.5, P), { tone: "lo", free: true }));
  }
  return out.join("");
}

// ── Writer: body, spool, key knob ───────────────────────────────────────────
export function writer() {
  const out = [];
  const body = { x: 40, y: -40, w: 24, d: 26, r: 3 };
  out.push(S(k.slabOf(body, 0, 17, P, 4, 0.7), { tone: "mid", inner: k.lineSvg(k.sideSeam(body, 8.5, P, 4), { tone: "faint" }) }));
  out.push(L(k.planOutline(k.insetPlan(body, 2), 17, P, 4), { tone: "faint" }));
  out.push(S(k.slabOf({ x: 44, y: -19, w: 16, d: 7, r: 2.5 }, 12, 6, P, 4, 0.5), { tone: "hi", crease: "lo" }));
  out.push(L(k.planOutline(k.insetPlan({ x: 44, y: -19, w: 16, d: 7, r: 2.5 }, 1), 18, P, 4), { tone: "faint" }));
  out.push(S(k.cylinder(46, -33, 2.4, 17, 3.4, P, 18), { tone: "hi", crease: "lo" }));
  out.push(L(k.knurl(46, -33, 2.4, 17.6, 20.4, 16, P, 0.25), { tone: "lo" }));
  out.push(S(k.cylinder(58, -33, 1.6, 17, 5, P, 14), { tone: "mid", crease: "none" }));
  return out.join("");
}

// The printed tape, built at rest; the live script slides it forward.
export function tape() {
  const out = [];
  const t = { x: 48, y: -12, w: 8, d: 19, r: 0.5 };
  out.push(S(k.slabOf(t, 0, 0.7, P, 2), { tone: "hi", crease: "none" }));
  for (const [dy, wEnd] of [[3, 1], [5.5, 2.5], [8, 1], [10.5, 3.5], [13, 1], [15.5, 2]]) {
    out.push(L(k.lineOnTop([t.x + 1, t.y + dy], [t.x + t.w - wEnd, t.y + dy], 0.7, P), { tone: "lo", free: true }));
  }
  return out.join("");
}

// ── Verifier: pad, post, arm, reject tray, lamp bracket ─────────────────────
export function verifier() {
  const out = [];
  out.push(S(k.slabOf({ x: 82, y: 7, w: 16, d: 14, r: 2 }, 0, 2, P, 4, 0.4), { tone: "mid" }));
  out.push(L(k.planOutline(k.insetPlan({ x: 82, y: 7, w: 16, d: 14, r: 2 }, 1.4), 2, P, 4), { tone: "faint" }));
  out.push(S(k.cylinder(90, -4, 2.4, 0, 30, P, 18), { tone: "mid", crease: "none" }));
  out.push(S(k.slabOf({ x: 85, y: -9, w: 10, d: 13, r: 2 }, 26, 4, P, 3, 0.5), { tone: "mid" }));
  out.push(S(k.slabOf({ x: 102, y: -38, w: 13, d: 13, r: 2 }, 0, 2.6, P, 4, 0.4), { tone: "mid" }));
  out.push(S(k.extrude(k.ringOf(k.insetPlan({ x: 102, y: -38, w: 13, d: 13, r: 2 }, -1.2), 4), 2.6, 3, P, { convex: true }), { tone: "mid" }));
  out.push(S(k.slabOf({ x: 104, y: -35, w: 9, d: 7, r: 0.7 }, 2.6, 0.9, P, 2), { tone: "hi", crease: "none" }));
  out.push(L(k.lineOnTop([105, -33.5], [112, -33.5], 3.5, P), { tone: "lo", free: true }));
  out.push(S(k.slabOf({ x: 92.6, y: -6.4, w: 3, d: 4.4, r: 0.8 }, 22, 2.2, P, 2), { tone: "mid", crease: "none" }));
  return out.join("");
}

// The stamp head, built at rest (up); the live script presses it down.
export function stampHead() {
  const out = [];
  out.push(S(k.slabOf({ x: 84, y: 5, w: 12, d: 11, r: 2 }, 16, 6, P, 3, 0.5), { tone: "mid" }));
  out.push(S(k.slabOf(k.insetPlan({ x: 84, y: 5, w: 12, d: 11, r: 2 }, 1.4), 10, 6, P, 3, 0.4), { tone: "hi", crease: "lo" }));
  out.push(L(k.planOutline(k.insetPlan({ x: 84, y: 5, w: 12, d: 11, r: 2 }, 1.4), 10, P, 3), { tone: "faint" }));
  out.push(S(k.cylinder(90, 10.5, 2, 22, 4.5, P, 16), { tone: "mid", crease: "none" }));
  out.push(L(k.knurl(90, 10.5, 2, 22.6, 26.5, 14, P, 0.25), { tone: "lo" }));
  return out.join("");
}

// ── Dispatch tray with the finished answer ──────────────────────────────────
export function dispatch() {
  const out = [];
  const tray = { x: 114, y: 3, w: 24, d: 22, r: 2 };
  out.push(S(k.slabOf(tray, 0, 2.4, P, 4, 0.4), { tone: "mid" }));
  out.push(S(k.extrude(k.ringOf(k.insetPlan(tray, -1.4), 4), 2.4, 3.6, P, { convex: true }), { tone: "mid" }));
  out.push(L(k.planOutline(k.insetPlan(tray, 2), 2.4, P, 4), { tone: "faint" }));
  out.push(S(k.slabOf({ x: 117, y: 8, w: 15, d: 11, r: 0.8 }, 2.4, 1, P, 2), { tone: "hi", crease: "none" }));
  for (let i = 0; i < 3; i++) {
    const tag = { x: 118.5 + i * 4.4, y: 16.4, w: 3, d: 2.2, r: 0.5 };
    out.push(S(k.slabOf(tag, 3.4, 1.6, P, 2), { tone: "hi", crease: "none" }));
    out.push(D([at([tag.x + tag.w / 2, tag.y + tag.d / 2, 5])], { size: 0.4, tone: "mid" }));
  }
  out.push(L(k.lineOnTop([118.5, 10], [130.5, 10], 3.4, P), { tone: "lo", free: true }));
  out.push(L(k.lineOnTop([118.5, 12.5], [128, 12.5], 3.4, P), { tone: "lo", free: true }));
  out.push(L(k.lineOnTop([118.5, 15], [129.5, 15], 3.4, P), { tone: "lo", free: true }));
  return out.join("");
}

// ── Ledger recorder under the bench ─────────────────────────────────────────
export function ledger() {
  const out = [];
  out.push(S(k.slabOf(LEDGER, LEDGER_Z0, LEDGER_Z1 - LEDGER_Z0, P, 4, 0.6), { tone: "mid" }));
  out.push(L(k.planOutline(k.insetPlan(LEDGER, 2), LEDGER_Z1, P, 4), { tone: "faint" }));
  const grid = [];
  for (let x = LEDGER.x + 6; x <= LEDGER.x + LEDGER.w - 6; x += 6.5) {
    grid.push(faceLine([x, LEDGER_FACE_Y, LEDGER_Z0 + 3], [x, LEDGER_FACE_Y, LEDGER_Z1 - 3]));
  }
  for (let z = LEDGER_Z0 + 3; z <= LEDGER_Z1 - 3; z += 3.6) {
    grid.push(faceLine([LEDGER.x + 6, LEDGER_FACE_Y, z], [LEDGER.x + LEDGER.w - 6, LEDGER_FACE_Y, z]));
  }
  out.push(L(grid.join(""), { tone: "faint", free: true }));
  out.push(S(k.slabOf({ x: LEDGER.x + 3, y: LEDGER.y + 6, w: 7, d: 12, r: 1.5 }, LEDGER_Z0 + 5, 9, P, 3, 0.4), { tone: "hi", crease: "lo" }));
  out.push(L(k.ring(LEDGER.x + 6.5, LEDGER.y + 12, 2.4, LEDGER_Z1, P, 20), { tone: "lo" }));
  out.push(D([at([LEDGER.x + 6.5, LEDGER.y + 12, LEDGER_Z1])], { size: 0.45 }));
  out.push(L(k.ring(LEDGER.x + 6.5, LEDGER.y + 12, 1.2, LEDGER_Z1 - 0.01, P, 16), { tone: "mid" }));
  return out.join("");
}

// ── Inspector panel: plate, four dials with needles, flag bracket ───────────
export function panel() {
  const out = [];
  out.push(S(k.slabOf(PANEL, PANEL_Z0, PANEL_Z1 - PANEL_Z0, P, 3, 0.5), { tone: "mid" }));
  out.push(L(k.planOutline(k.insetPlan({ x: PANEL.x, y: PANEL.y, w: PANEL.w, d: PANEL.d, r: 2 }, 1.2), PANEL_FACE_Y, P, 3), { tone: "faint" }));
  DIALS.forEach(([cx, cz], i) => {
    out.push(L(k.sideRing([cx, PANEL_FACE_Y, cz], DIAL_R_P, "y", P, 40), { tone: "lo" }));
    const t = panelTicks(cx, cz, DIAL_R_P - 0.15, 12, 4, 1.5);
    out.push(L(t.minor.join(""), { tone: "lo" }));
    out.push(L(t.major.join(""), { tone: "mid" }));
    out.push(L(panelNeedle(cx, cz, 0.8, DIAL_R_P - 2.2, 0.9, Math.PI * 1.5, Math.PI * 0.75), { tone: "mid", free: true }));
    out.push(D([[cx, PANEL_FACE_Y, cz]].map((p) => at(p)), { size: 0.45 }));
  });
  out.push(S(k.slabOf({ x: 94, y: PANEL_FACE_Y - 0.6, w: 3, d: 1.2, r: 0.4 }, 60, 2, P, 2), { tone: "mid", crease: "none" }));
  return out.join("");
}

// ── Trace bus + drop wires ──────────────────────────────────────────────────
export function bus() {
  const out = [];
  out.push(S(k.slabOf(BUS, 1.4, 1.4, P, 2, 0.3), { tone: "lo", crease: "none" }));
  const drops = [
    [[-10, -48.2, 2.8], [-10, -42, 12]],
    [[52, -48.2, 2.8], [52, -40, 15]],
    [[90, -48.2, 2.8], [90, -6, 24]],
    [[-59, -48.2, 2.8], [-59, -10, 20]],
  ];
  for (const [from, to] of drops) {
    out.push(W(from, to, { via: [[from[0], (from[1] + to[1]) / 2, from[2]]], tone: "lo", size: 1 }));
  }
  out.push(W([-60, -48.2, 2.8], [-64, -49, 1.2], { tone: "lo", size: 1 }));
  return out.join("");
}

// ── Rail and slip (drawn late: they sit in front of the stations) ───────────
export function rail() {
  const out = [];
  out.push(S(k.slabOf({ x: RAIL_X0, y: RAIL_Y - 2.5, w: RAIL_X1 - RAIL_X0, d: 5, r: 1 }, 0, RAIL_TOP, P, 3, 0.4), { tone: "mid" }));
  out.push(L(k.lineOnTop([RAIL_X0 + 2, RAIL_Y], [RAIL_X1 - 2, RAIL_Y], RAIL_TOP, P), { tone: "faint" }));
  for (const x of [RAIL_X0 - 3, RAIL_X1 + 1]) {
    out.push(S(k.slabOf({ x, y: RAIL_Y - 4, w: 3, d: 8, r: 0.8 }, 0, 6.5, P, 2, 0.4), { tone: "mid" }));
    out.push(D([at([x + 1.5, RAIL_Y, 6.5])], { size: 0.4 }));
  }
  return out.join("");
}

export function slip() {
  const out = [];
  out.push(S(k.slabOf({ x: -5, y: -4, w: 10, d: 8, r: 1 }, RAIL_TOP, 3, P, 2, 0.4), { tone: "mid" }));
  out.push(S(k.slabOf({ x: -4, y: -3, w: 8, d: 6, r: 0.5 }, RAIL_TOP + 3, 1.2, P, 2), { tone: "hi", lit: true }));
  out.push(L(k.lineOnTop([-2.6, -1], [2.6, -1], RAIL_TOP + 4.2, P), { tone: "lo", free: true }));
  out.push(L(k.lineOnTop([-2.6, 0.4], [1.8, 0.4], RAIL_TOP + 4.2, P), { tone: "lo", free: true }));
  out.push(L(k.lineOnTop([-2.6, 1.8], [2.2, 1.8], RAIL_TOP + 4.2, P), { tone: "lo", free: true }));
  return out.join("");
}
