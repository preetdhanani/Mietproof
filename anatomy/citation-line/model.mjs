// model.mjs — constants, projection, shared helpers. Every number is true to the bgb-rag design.
import * as k from "file:///Users/pritdhanani/.agents/skills/anatomy/kit/iso-kit.mjs";

export const WIDTH = 980;
export const HEIGHT = 560;

export const BENCH = { x: -150, y: -52, w: 304, d: 104, r: 6 };
export const BENCH_H = 22;
export const FOOT_H = 6;
export const RAIL_Y = 14;
export const RAIL_X0 = -104;
export const RAIL_X1 = 122;
export const RAIL_TOP = 3;

export const STATIONS = [
  { key: "intake", x: -95, name: "intake + quota meter", fact: "POST /ask · meter counts against 10 queries/hour" },
  { key: "scale", x: -58, name: "confidence weighbridge", fact: "floor calibrated per backend · committed as floor.json" },
  { key: "catalog", x: -6, name: "card catalog (retrieval)", fact: "3 backends · k=5 · hybrid expected to win" },
  { key: "writer", x: 52, name: "writer (generation)", fact: "session: last 3 exchanges · 30 min TTL" },
  { key: "verifier", x: 90, name: "verification stamp", fact: "every cited § checked · 1 rewrite, then refuse" },
  { key: "dispatch", x: 124, name: "dispatch tray", fact: "200 OK · answer + citations + Stand date" },
];

export const SLIP_X0 = -100;
export const SCALE_VALUE_PASS = 0.62;
export const SCALE_VALUE_DIVERT = 0.18;
export const FLOOR_MARK = 0.35;
export const TRAY_XY = [-34, 40];
export const METER_MAX = 10;

export const DIAL = [-59, -8];
export const DIAL_R = 9;
export const DIAL_Z = 22;
export const DIAL_TOP = 26;
export const DIAL_SPAN = Math.PI * 1.5;
export const DIAL_START = Math.PI * 0.75;

export const PANEL = { x: 40, y: -33, w: 58, d: 8, r: 2 };
export const PANEL_Z0 = 52;
export const PANEL_Z1 = 74;
export const PANEL_FACE_Y = PANEL.y + PANEL.d;
export const DIALS = [48, 61, 74, 87].map((x) => [x, 63]);
export const DIAL_R_P = 5.2;

export const CATALOG = { x: -18, y: -44, w: 48, d: 36, r: 3 };
export const CATALOG_TOP = 28;
export const DRAWER_Z = [4, 12, 20];
export const DRAWER_H = 7;
export const DRAWER_OUT = 11;
export const CARDS = 5;

export const PRESS = { x: -148, y: -46, w: 34, d: 30, r: 3 };
export const POST_L = [-150, -30];
export const POST_R = [146, -30];
export const RAILBAR_Z = 78;

export const LEDGER = { x: 8, y: 22, w: 56, d: 24, r: 3 };
export const LEDGER_Z0 = -22;
export const LEDGER_Z1 = -4;
export const LEDGER_FACE_Y = LEDGER.y + LEDGER.d;

export const BUS = { x: -60, y: -49.5, w: 152, d: 2.6, r: 1 };

export const P = k.fitProjection(
  [
    ...k.boxCorners(BENCH, -BENCH_H - FOOT_H, 0),
    [-152, -33, RAILBAR_Z + 4], [152, -33, RAILBAR_Z + 4],
    [-133, -31, 46], [90, -2, 36],
    [PANEL.x, PANEL.y, PANEL_Z1], [PANEL.x + PANEL.w, PANEL.y + PANEL.d, PANEL_Z1],
    [TRAY_XY[0] + 12, TRAY_XY[1] + 12, 6],
    [LEDGER.x, LEDGER_FACE_Y, LEDGER_Z0], [LEDGER.x + LEDGER.w, LEDGER_FACE_Y, LEDGER_Z1],
  ],
  WIDTH, HEIGHT, { pad: 30, azimuth: 38, elevation: 30 },
);

export const at = (point) => k.iso(point, P);
export const S = (paths, style) => k.solidSvg(paths, style);
export const L = (d, style) => k.lineSvg(d, style);
export const D = (points, style) => k.dotsSvg(points, style);
export const W = (from, to, style = {}) =>
  k.wireSvg(at(from), at(to), { ...style, via: (style.via ?? []).map((p) => at(p)) });
export const byDepth = (points) =>
  [...points].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P));
export const faceLine = (a, b) => k.segment([a[0], a[1], a[2]], [b[0], b[1], b[2]], P);

// A needle on a horizontal dial face (top plane), rebuilt per frame.
export function topNeedle(cx, cy, z, r0, r1, value, span, start) {
  const angle = start + value * span;
  return k.lineOnTop(
    [cx - Math.sin(angle) * r0, cy + Math.cos(angle) * r0],
    [cx + Math.sin(angle) * r1, cy - Math.cos(angle) * r1],
    z, P,
  );
}

// A needle on the inspector panel's vertical face (plane y = PANEL_FACE_Y).
export function panelNeedle(cx, cz, r0, r1, value, span, start) {
  const angle = start + value * span;
  return faceLine(
    [cx - Math.cos(angle) * r0, PANEL_FACE_Y, cz + Math.sin(angle) * r0],
    [cx + Math.cos(angle) * r1, PANEL_FACE_Y, cz - Math.sin(angle) * r1],
  );
}

export function panelTicks(cx, cz, r, count, every, len) {
  const minor = [], major = [];
  const start = Math.PI * 0.75;
  const span = Math.PI * 1.5;
  for (let i = 0; i < count; i++) {
    const angle = start + (i / (count - 1)) * span;
    const dir = [Math.cos(angle), Math.sin(angle)];
    const inner = [cx - dir[0] * r, PANEL_FACE_Y, cz + dir[1] * r];
    const outer = [
      cx - dir[0] * (r + (i % every === 0 ? len : len * 0.55)),
      PANEL_FACE_Y,
      cz + dir[1] * (r + (i % every === 0 ? len : len * 0.55)),
    ];
    (i % every === 0 ? major : minor).push(faceLine(inner, outer));
  }
  return { minor, major };
}
