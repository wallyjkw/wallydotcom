// Sanity tests for the Uno engine's pure functions. Run: node scripts/test-uno.js
const U = require("../public/uno.js");
let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.error("FAIL:", msg); } }

// --- deck composition ---
var deck = U.makeDeck();
ok(deck.length === 108, "deck has 108 cards");

function count(fn) { return deck.filter(fn).length; }
ok(count(function (c) { return c.value === 0; }) === 4, "four 0s (one per colour)");
ok(count(function (c) { return c.value === 7; }) === 8, "eight 7s (two per colour)");
ok(count(function (c) { return c.value === "skip"; }) === 8, "eight Skips");
ok(count(function (c) { return c.value === "draw2"; }) === 8, "eight Draw Twos");
ok(count(function (c) { return c.value === "wild"; }) === 4, "four Wilds");
ok(count(function (c) { return c.value === "wild4"; }) === 4, "four Wild Draw Fours");
ok(count(function (c) { return c.color === "r"; }) === 25, "25 red cards");

// --- glyphs ---
ok(U.cardGlyph({ color: "r", value: 5 }) === "5", "number glyph");
ok(U.cardGlyph({ color: "g", value: "draw2" }) === "+2", "draw2 glyph");
ok(U.cardGlyph({ color: null, value: "wild4" }) === "+4", "wild4 glyph");

// --- canPlay: normal turn (no penalty) ---
var top = { color: "r", value: 5 };
ok(U.canPlay({ color: "r", value: 9 }, top, "r", 0, null, true), "match by colour");
ok(U.canPlay({ color: "b", value: 5 }, top, "r", 0, null, true), "match by number");
ok(!U.canPlay({ color: "b", value: 9 }, top, "r", 0, null, true), "no match → illegal");
ok(U.canPlay({ color: null, value: "wild" }, top, "r", 0, null, true), "wild always legal");
ok(U.canPlay({ color: null, value: "wild4" }, top, "r", 0, null, true), "wild4 always legal");

// active colour comes from topColor, not the wild card's (null) colour
var wildTop = { color: null, value: "wild" };
ok(U.canPlay({ color: "g", value: 3 }, wildTop, "g", 0, null, true), "match chosen colour on a wild top");
ok(!U.canPlay({ color: "b", value: 3 }, wildTop, "g", 0, null, true), "wrong colour on a wild top → illegal");

// match action by symbol across colours
var skipTop = { color: "r", value: "skip" };
ok(U.canPlay({ color: "b", value: "skip" }, skipTop, "r", 0, null, true), "skip matches skip across colours");

// --- canPlay: pending penalty (stacking) ---
var d2 = { color: "r", value: "draw2" };
ok(U.canPlay({ color: "b", value: "draw2" }, d2, "r", 2, "draw2", true), "stack draw2 on draw2");
ok(!U.canPlay({ color: "r", value: 5 }, d2, "r", 2, "draw2", true), "number can't answer a penalty");
ok(!U.canPlay({ color: null, value: "wild4" }, d2, "r", 2, "draw2", true), "wild4 doesn't stack on draw2");
ok(!U.canPlay({ color: "b", value: "draw2" }, d2, "r", 2, "draw2", false), "stacking off → must draw");
var d4 = { color: null, value: "wild4" };
ok(U.canPlay({ color: null, value: "wild4" }, d4, "g", 4, "wild4", true), "stack wild4 on wild4");

// --- legalPlays ---
var hand = [
  { color: "r", value: 5 },     // 0: colour match
  { color: "b", value: 9 },     // 1: no match
  { color: null, value: "wild" } // 2: wild
];
var lp = U.legalPlays(hand, top, "r", 0, null, true);
ok(lp.length === 2 && lp.indexOf(0) !== -1 && lp.indexOf(2) !== -1 && lp.indexOf(1) === -1,
  "legalPlays finds colour match + wild, not the dead card");

// --- chooseColor: most common colour in hand ---
var h = [
  { color: "b", value: 1 }, { color: "b", value: 4 }, { color: "b", value: "skip" },
  { color: "r", value: 2 }, { color: null, value: "wild" }
];
ok(U.chooseColor(h) === "b", "chooseColor picks the majority colour");

// --- chooseBotCard: shed coloured cards before wilds; actions first ---
var bh = [
  { color: null, value: "wild" },   // 0
  { color: "r", value: 7 },          // 1: coloured number
  { color: "r", value: "skip" }      // 2: coloured action
];
ok(U.chooseBotCard(bh, [0, 1, 2]) === 2, "bot prefers a coloured action over number/wild");
var bh2 = [{ color: null, value: "wild4" }, { color: null, value: "wild" }];
ok(U.chooseBotCard(bh2, [0, 1]) === 1, "bot spends plain Wild before Wild Draw Four");

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
