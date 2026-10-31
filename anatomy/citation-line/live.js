// live.js — page script for the citation line. The kit is inlined before this,
// so translateAlong, lineOnTop and segment are in scope.
const P = __P__;
const DIAL = __DIAL__;
const DIAL_R = __DIAL_R__, DIAL_TOP = __DIAL_TOP__, DIAL_SPAN = __DIAL_SPAN__, DIAL_START = __DIAL_START__;
const PANEL_FACE_Y = __PANEL_FACE_Y__;
const DIAL_R_P = __DIAL_R_P__;
const LEDGER = __LEDGER__;
const LEDGER_FACE_Y = __LEDGER_FACE_Y__;
const LEDGER_Z1 = __LEDGER_Z1__;
const METER_MAX = __METER_MAX__;
const SCALE_VALUE_PASS = __SCALE_VALUE_PASS__;
const SCALE_VALUE_DIVERT = __SCALE_VALUE_DIVERT__;
const DRAWER_OUT = __DRAWER_OUT__;
const STATIONS = __STATIONS__;
const SLIP_X0 = __SLIP_X0__;
const TRAY = __TRAY__;
const RAIL_Y = __RAIL_Y__;

const stage = document.querySelector(".iso-stage");
const svg = stage.querySelector("svg");
const q = (part) => svg.querySelector('[data-part="' + part + '"]');
const slip = q("slip"), drawer = q("drawer"), stamp = q("stamp"), tape = q("tape");
const arm = q("arm"), scaleNeedle = q("scaleNeedle"), sweep = q("sweep"), pen = q("pen"), flag = q("flag");
const lampPass = q("lampPass"), lampReject = q("lampReject"), meterText = q("meterText");
const readout = document.querySelector("[data-readout]");
const still = matchMedia("(prefers-reduced-motion: reduce)");
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const lerp = (a, b, t) => a + (b - a) * t;

let slipX = SLIP_X0, slipTarget = slipX, slipY = RAIL_Y, slipYTarget = slipY;
let drawerY = 0, drawerTarget = 0;
let stampZ = 0, stampTarget = 0, tapeY = 0, tapeTarget = 0;
let armAngle = 0, armTarget = 0;
let scaleValue = SCALE_VALUE_PASS, scaleTarget = SCALE_VALUE_PASS;
let sweepValue = 0, sweepTarget = 0;
let penSwing = 0, flagUp = 0, flagTarget = 0;
let meterCount = 1, lampState = "off";
let queue = [], qi = 0, qt = 0, touring = false, visible = false, idleTimer = 0, frame = 0, last = 0;
let tourIndex = 0;
let slipFrom = [slipX, slipY];

const ease = (cur, target, dt, rate) => cur + (target - cur) * (1 - Math.exp(-dt * rate));
const settle = (cur, target, eps) => (Math.abs(target - cur) < eps ? target : cur);

function topNeedle(cx, cy, z, r0, r1, value, span, start) {
  const angle = start + value * span;
  return lineOnTop(
    [cx - Math.sin(angle) * r0, cy + Math.cos(angle) * r0],
    [cx + Math.sin(angle) * r1, cy - Math.cos(angle) * r1],
    z, P,
  );
}
function panelNeedle(cx, cz, r0, r1, value, span, start) {
  const angle = start + value * span;
  return segment(
    [cx - Math.cos(angle) * r0, PANEL_FACE_Y, cz + Math.sin(angle) * r0],
    [cx + Math.cos(angle) * r1, PANEL_FACE_Y, cz - Math.sin(angle) * r1],
    P,
  );
}
function faceLine(a, b) {
  return segment([a[0], a[1], a[2]], [b[0], b[1], b[2]], P);
}

const BACKENDS = ["bm25", "dense", "hybrid"];
const stageText = (i, extra) => {
  const s = STATIONS[i];
  return "stage " + (i + 1) + "/6 · " + s.name + (extra ? " · " + extra : "");
};

function draw() {
  slip.setAttribute("transform", translateAlong(P, [slipX - slipFrom[0] + slipFrom[0] * 0, 0, 0]));
  slip.setAttribute("transform", translateAlong(P, [slipX, slipY - RAIL_Y, 0]));
  drawer.setAttribute("transform", translateAlong(P, [0, drawerY, 0]));
  stamp.setAttribute("transform", translateAlong(P, [0, 0, stampZ]));
  tape.setAttribute("transform", translateAlong(P, [0, tapeY, 0]));
  arm.querySelector("path").setAttribute("d", faceLine([-44, 3, 13], [-44 + Math.cos(armAngle) * 10, 3, 13 + Math.sin(armAngle) * 10]));
  const armTip = iso([-44 + Math.cos(armAngle) * 10, 3, 13 + Math.sin(armAngle) * 10], P);
  const armLamp = q("armLamp");
  armLamp.setAttribute("cx", armTip[0]);
  armLamp.setAttribute("cy", armTip[1]);
  scaleNeedle.querySelector("path").setAttribute("d", topNeedle(DIAL[0], DIAL[1], DIAL_TOP + 0.2, 1.2, DIAL_R - 3.4, scaleValue, DIAL_SPAN, DIAL_START));
  sweep.querySelector("path").setAttribute("d", panelNeedle(87, 63, 0.8, DIAL_R_P - 2.2, sweepValue, Math.PI * 1.5, Math.PI * 0.75));
  pen.setAttribute("d", faceLine([LEDGER.x + 30 + penSwing * 4, LEDGER_FACE_Y, LEDGER_Z1 - 1], [LEDGER.x + 30 + penSwing * 4, LEDGER_FACE_Y - 3.5, LEDGER_Z1 - 5]));
  flag.setAttribute("d", faceLine([95.5, PANEL_FACE_Y, 61], [95.5, PANEL_FACE_Y, 61 + flagUp * 7]));
  lampPass.setAttribute("opacity", lampState === "pass" ? "1" : "0.35");
  lampPass.setAttribute("fill", lampState === "pass" ? "var(--anatomy-lit)" : "var(--anatomy-lo)");
  lampReject.setAttribute("opacity", lampState === "reject" ? "1" : "0.35");
  lampReject.setAttribute("fill", lampState === "reject" ? "var(--anatomy-lit)" : "var(--anatomy-lo)");
}

function step(dur, tickFn) { return { dur, tickFn }; }

function buildTour(divert) {
  const steps = [];
  const push = (dur, fn) => steps.push(step(dur, fn));
  push(0.01, () => { slipFrom = [slipX, slipY]; slipX = SLIP_X0; slipY = RAIL_Y; slipTarget = slipX; slipYTarget = slipY; });
  push(0.55, () => { slipTarget = -95; slipYTarget = RAIL_Y; });
  push(0.55, (t) => { if (t > 0.9 && meterCount < METER_MAX) meterCount++; });
  push(0.65, () => { slipTarget = -58; });
  push(0.95, (t) => {
    scaleTarget = divert ? SCALE_VALUE_DIVERT : SCALE_VALUE_PASS;
    if (divert && t > 0.55) armTarget = 1.1;
  });
  if (divert) {
    push(1.15, () => { slipTarget = TRAY[0] + 2; slipYTarget = TRAY[1] - 4; });
    push(1.35, () => {});
    push(1.05, (t) => { slipTarget = SLIP_X0; slipYTarget = RAIL_Y; if (t > 0.7) armTarget = 0; });
    return steps;
  }
  push(0.75, () => { slipTarget = -6; });
  push(0.5, () => { drawerTarget = DRAWER_OUT; });
  push(0.5, () => { drawerTarget = DRAWER_OUT + 4.5; });
  push(1.15, () => {});
  push(0.4, () => { drawerTarget = DRAWER_OUT; });
  push(0.4, () => { drawerTarget = 0; });
  push(0.65, () => { slipTarget = 52; });
  push(1.25, (t) => { tapeTarget = t * 7; });
  push(0.65, () => { slipTarget = 90; });
  push(0.45, () => { stampTarget = -12; });
  push(0.5, (t) => { if (t > 0.5) lampState = "pass"; });
  push(0.45, () => { stampTarget = 0; });
  push(0.85, (t) => { sweepTarget = t; flagTarget = 1; });
  push(0.75, () => { slipTarget = 124; });
  push(1.05, () => {});
  push(0.6, (t) => { if (t > 0.5) { lampState = "off"; flagTarget = 0; sweepTarget = 0; tapeTarget = 0; } });
  return steps;
}

function say(text) {
  if (readout.textContent !== text) readout.textContent = text;
  stage.setAttribute("aria-valuetext", text);
}

function tick(now) {
  const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
  last = now;
  const calm = still.matches;
  if (queue.length) {
    const s = queue[qi];
    if (s.tickFn) s.tickFn(clamp(qt / s.dur, 0, 1));
    qt += dt;
    if (qt >= s.dur) {
      qi++; qt = 0;
      if (qi >= queue.length) {
        queue = []; touring = false;
        idleTimer = setTimeout(startTour, 2600);
      }
    }
  }
  const rate = calm ? 100 : 3.2;
  slipX = settle(ease(slipX, slipTarget, dt, rate), slipTarget, 0.02);
  slipY = settle(ease(slipY, slipYTarget, dt, rate), slipYTarget, 0.02);
  drawerY = settle(ease(drawerY, drawerTarget, dt, 5.5), drawerTarget, 0.02);
  stampZ = settle(ease(stampZ, stampTarget, dt, 7), stampTarget, 0.02);
  tapeY = settle(ease(tapeY, tapeTarget, dt, 6), tapeTarget, 0.02);
  armAngle = settle(ease(armAngle, armTarget, dt, 6), armTarget, 0.01);
  scaleValue = settle(ease(scaleValue, scaleTarget, dt, 6), scaleTarget, 0.002);
  sweepValue = settle(ease(sweepValue, sweepTarget, dt, 4), sweepTarget, 0.004);
  penSwing = Math.sin(now / 900) * (touring ? 1 : 0.25);
  flagUp = settle(ease(flagUp, flagTarget, dt, 6), flagTarget, 0.01);
  meterText.textContent = String(meterCount).padStart(2, "0") + "/" + METER_MAX;
  const stageNow = queue.length ? stageText(stageIndex(), queue.length ? liveFact() : "") : idleText();
  say(stageNow);
  draw();
  const busy = queue.length > 0 || Math.abs(slipTarget - slipX) > 0.02 || Math.abs(drawerTarget - drawerY) > 0.02 || Math.abs(stampTarget - stampZ) > 0.02;
  frame = visible && (busy || touring) && !calm ? requestAnimationFrame(tick) : 0;
}

let currentStage = -1;
function stageIndex() {
  let best = 0, bestD = 1e9;
  STATIONS.forEach((s, i) => { const d = Math.abs(slipTarget - s.x); if (d < bestD) { bestD = d; best = i; } });
  return best;
}
function liveFact() {
  const i = stageIndex();
  if (i === 1) return "confidence " + scaleValue.toFixed(2) + (scaleValue < 0.35 ? " < floor 0.35" : " ≥ floor 0.35");
  if (i === 2) return "drawer: " + BACKENDS[tourIndex % 3] + " · k=5";
  if (i === 4) return "citations verified · rewrites 0/1";
  return "";
}
function idleText() {
  return "idle · press space to run a question · hover a station";
}

function startTour() {
  if (touring || !visible) return;
  touring = true;
  tourIndex++;
  const divert = tourIndex % 3 === 0;
  queue = buildTour(divert);
  qi = 0; qt = 0;
  if (frame) cancelAnimationFrame(frame);
  last = 0;
  frame = requestAnimationFrame(tick);
}

const run = () => { if (!frame && visible) { last = 0; frame = requestAnimationFrame(tick); } };

new IntersectionObserver((entries) => {
  visible = entries[entries.length - 1].isIntersecting;
  if (visible) { run(); if (!touring && !still.matches) idleTimer = setTimeout(startTour, 1200); }
}, { rootMargin: "120px 0px" }).observe(stage);

if (still.matches) { touring = false; }

stage.addEventListener("pointermove", (event) => {
  if (touring) return;
  const box = svg.getBoundingClientRect();
  const wx = ((event.clientX - box.left) / box.width - 0.5) * 2 * 340;
  let best = 0, bestD = 1e9;
  STATIONS.forEach((s, i) => { const d = Math.abs(s.x - wx); if (d < bestD) { bestD = d; best = i; } });
  say(stageText(best, STATIONS[best].fact));
});
stage.addEventListener("pointerleave", () => { if (!touring) say(idleText()); });
stage.addEventListener("keydown", (event) => {
  if (event.key === " " || event.key === "Enter") {
    event.preventDefault();
    if (!touring) startTour();
    return;
  }
  if (touring) return;
  let to = null;
  if (event.key === "ArrowRight" || event.key === "ArrowUp") to = Math.min(STATIONS.length - 1, (focusStation + 1));
  if (event.key === "ArrowLeft" || event.key === "ArrowDown") to = Math.max(0, (focusStation - 1));
  if (to === null) return;
  event.preventDefault();
  focusStation = to;
  say(stageText(to, STATIONS[to].fact));
});
let focusStation = 0;

draw();
say(idleText());
