// Sanity tests for the poker engine's pure functions. Run: node scripts/test-poker.js
const P = require("../public/poker.js");
let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.error("FAIL:", msg); } }

function H(str) { // "As Kd" -> [{r,s}]
  return str.split(" ").map(function (t) {
    var rank = t.slice(0, -1), suit = t.slice(-1);
    var map = { A: 14, K: 13, Q: 12, J: 11, T: 10 };
    return { r: map[rank] || Number(rank), s: suit };
  });
}
function cat(cards) { return P.evaluate7(cards)[0]; }

// --- category detection (7-card) ---
ok(cat(H("As Ks Qs Js Ts 2c 7d")) === 8, "royal/straight flush");
ok(cat(H("9h 9d 9s 9c 2h 3d 4c")) === 7, "four of a kind");
ok(cat(H("Kh Kd Ks 2c 2d 7h 9s")) === 6, "full house");
ok(cat(H("2h 5h 8h Jh Kh 3d 4c")) === 5, "flush");
ok(cat(H("As 2d 3h 4c 5s 9d Kh")) === 4, "wheel straight A-2-3-4-5");
ok(cat(H("9s Td Jh Qc Kd 2h 2s")) === 4, "straight");
ok(cat(H("7s 7d 7h 2c 9d Jh Ks")) === 3, "trips");
ok(cat(H("As Ad Ks Kd 2h 5c 9s")) === 2, "two pair");
ok(cat(H("As Ad 2h 5c 9s Jd 4c")) === 1, "one pair");
ok(cat(H("As Qd 9h 5c 3s 2d 7c")) === 0, "high card");

// --- comparisons ---
ok(P.cmp(P.evaluate5(H("As Ad Ac Kd Qs")), P.evaluate5(H("Ks Kd Kc Ad Qs"))) > 0,
  "trip aces beat trip kings");
ok(P.cmp(P.evaluate5(H("As Ks Qs Js Ts")), P.evaluate5(H("Ks Qs Js Ts 9s"))) > 0,
  "higher straight flush wins");
ok(P.cmp(P.evaluate5(H("As Ad Kd Qc Js")), P.evaluate5(H("As Ad Kd Qc 9s"))) > 0,
  "kicker breaks a tie");
ok(P.cmp(P.evaluate5(H("As Ad Kd Qc Js")), P.evaluate5(H("Ac Ah Kc Qd Jh"))) === 0,
  "identical ranks split");

// --- side pots ---
// Short stack all-in 100, two others to 300. Short can only win the main pot.
var players = [
  { name: "short", totalBet: 100, folded: false },
  { name: "mid", totalBet: 300, folded: false },
  { name: "big", totalBet: 300, folded: false }
];
var pots = P.buildPots(players);
ok(pots.length === 2, "two pots formed");
ok(pots[0].amount === 300 && pots[0].eligible.length === 3, "main pot 300, all 3 eligible");
ok(pots[1].amount === 400 && pots[1].eligible.length === 2, "side pot 400, 2 eligible");

// Folded contributor's chips stay in the pot but they can't win.
var p2 = [
  { name: "folded", totalBet: 50, folded: true },
  { name: "a", totalBet: 200, folded: false },
  { name: "b", totalBet: 200, folded: false }
];
var pots2 = P.buildPots(p2);
var total2 = pots2.reduce(function (s, p) { return s + p.amount; }, 0);
ok(total2 === 450, "folded chips still counted (50+200+200)");
ok(pots2.every(function (pot) {
  return pot.eligible.every(function (e) { return !e.folded; });
}), "folded player never eligible");

// --- chip conservation across a buildPots distribution ---
var p3 = [
  { name: "x", totalBet: 75, folded: false },
  { name: "y", totalBet: 150, folded: false },
  { name: "z", totalBet: 150, folded: true }
];
var total3 = P.buildPots(p3).reduce(function (s, p) { return s + p.amount; }, 0);
ok(total3 === 375, "all contributed chips accounted for");

console.log("\n" + pass + " passed, " + fail + " failed.");
process.exit(fail ? 1 : 0);
