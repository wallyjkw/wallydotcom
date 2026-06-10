/* WallyDotCom Poker — Phase 1
 * Single human player vs. rule-based bots. No Limit Texas Hold'em, cash game.
 * Everything runs in the browser. The pure engine functions (card eval, side
 * pots, bot logic) are also exported for Node testing at the bottom of the file.
 */

/* ----------------------------- Cards & evaluation ----------------------------- */

var SUITS = ["s", "h", "d", "c"];
var SUIT_SYMBOL = { s: "♠", h: "♥", d: "♦", c: "♣" };

function makeDeck() {
  var deck = [];
  for (var r = 2; r <= 14; r++) {
    for (var s = 0; s < 4; s++) deck.push({ r: r, s: SUITS[s] });
  }
  return deck;
}

function shuffle(deck) {
  for (var i = deck.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var t = deck[i]; deck[i] = deck[j]; deck[j] = t;
  }
  return deck;
}

function rankLabel(r) {
  if (r === 14) return "A";
  if (r === 13) return "K";
  if (r === 12) return "Q";
  if (r === 11) return "J";
  if (r === 10) return "10";
  return String(r);
}

// Compare two score arrays lexicographically. Positive => a is better.
function cmp(a, b) {
  var len = Math.max(a.length, b.length);
  for (var i = 0; i < len; i++) {
    var x = a[i] || 0, y = b[i] || 0;
    if (x !== y) return x - y;
  }
  return 0;
}

// Score a 5-card hand: [category, ...tiebreakers]. Higher is better.
function evaluate5(cards) {
  var ranks = cards.map(function (c) { return c.r; }).sort(function (a, b) { return b - a; });
  var suits = cards.map(function (c) { return c.s; });
  var isFlush = suits.every(function (s) { return s === suits[0]; });

  var cnt = {};
  ranks.forEach(function (r) { cnt[r] = (cnt[r] || 0) + 1; });
  var groups = Object.keys(cnt).map(Number).sort(function (a, b) {
    return cnt[b] - cnt[a] || b - a;
  });

  var uniq = ranks.filter(function (v, i) { return ranks.indexOf(v) === i; });
  var straightHigh = 0;
  if (uniq.length === 5) {
    if (uniq[0] - uniq[4] === 4) straightHigh = uniq[0];
    else if (uniq[0] === 14 && uniq[1] === 5 && uniq[4] === 2) straightHigh = 5; // A-2-3-4-5 wheel
  }
  var isStraight = straightHigh > 0;

  if (isStraight && isFlush) return [8, straightHigh];
  if (cnt[groups[0]] === 4) return [7, groups[0], groups[1]];
  if (cnt[groups[0]] === 3 && cnt[groups[1]] === 2) return [6, groups[0], groups[1]];
  if (isFlush) return [5].concat(ranks);
  if (isStraight) return [4, straightHigh];
  if (cnt[groups[0]] === 3) {
    return [3, groups[0]].concat(ranks.filter(function (r) { return r !== groups[0]; }));
  }
  if (cnt[groups[0]] === 2 && cnt[groups[1]] === 2) {
    var hp = Math.max(groups[0], groups[1]), lp = Math.min(groups[0], groups[1]);
    var kick = ranks.filter(function (r) { return r !== hp && r !== lp; })[0];
    return [2, hp, lp, kick];
  }
  if (cnt[groups[0]] === 2) {
    return [1, groups[0]].concat(ranks.filter(function (r) { return r !== groups[0]; }));
  }
  return [0].concat(ranks);
}

// Best 5-of-7 score.
function evaluate7(cards) {
  var best = null;
  for (var i = 0; i < cards.length; i++) {
    for (var j = i + 1; j < cards.length; j++) {
      var five = cards.filter(function (_, k) { return k !== i && k !== j; });
      var sc = evaluate5(five);
      if (!best || cmp(sc, best) > 0) best = sc;
    }
  }
  return best;
}

var HAND_NAMES = [
  "high card", "a pair", "two pair", "three of a kind", "a straight",
  "a flush", "a full house", "four of a kind", "a straight flush"
];
function handName(score) { return HAND_NAMES[score[0]]; }

/* ------------------------------- Side pots ------------------------------- */
// Given players with .totalBet and .folded, return [{amount, eligible:[player]}].
function buildPots(players) {
  var levels = players
    .map(function (p) { return p.totalBet; })
    .filter(function (v) { return v > 0; });
  levels = levels.filter(function (v, i) { return levels.indexOf(v) === i; })
    .sort(function (a, b) { return a - b; });

  var pots = [];
  var prev = 0;
  levels.forEach(function (level) {
    var layer = level - prev;
    var contributors = players.filter(function (p) { return p.totalBet >= level; });
    var amount = layer * contributors.length;
    var eligible = contributors.filter(function (p) { return !p.folded; });
    if (amount > 0) pots.push({ amount: amount, eligible: eligible });
    prev = level;
  });
  return pots;
}

/* ------------------------------- Bot logic ------------------------------- */

function preflopStrength(hole) {
  var rs = hole.map(function (c) { return c.r; }).sort(function (a, b) { return b - a; });
  var hi = rs[0], lo = rs[1];
  var suited = hole[0].s === hole[1].s;
  var pair = hi === lo;
  var s;
  if (pair) {
    s = 0.5 + (hi - 2) / 12 * 0.5;
  } else {
    s = (hi - 2) / 12 * 0.5 + (lo - 2) / 12 * 0.2;
    if (suited) s += 0.07;
    var gap = hi - lo;
    if (gap === 1) s += 0.05;
    else if (gap === 2) s += 0.02;
    else if (gap >= 4) s -= 0.05;
  }
  return Math.max(0, Math.min(1, s));
}

var CATEGORY_STRENGTH = [0.18, 0.42, 0.62, 0.75, 0.85, 0.9, 0.95, 0.98, 1];
function postflopStrength(hole, board) {
  var score = evaluate7(hole.concat(board));
  return CATEGORY_STRENGTH[score[0]];
}

// Decide a bot action. state has currentBet, minRaise, pot+bets via potNow.
function botDecision(state, p, potNow) {
  var toCall = state.currentBet - p.bet;
  var strength = state.board.length
    ? postflopStrength(p.hole, state.board)
    : preflopStrength(p.hole);
  var eff = Math.max(0, Math.min(1, strength + (Math.random() - 0.5) * 0.15));

  function raiseTo(frac) {
    var target = state.currentBet + Math.max(state.minRaise, Math.round(potNow * frac));
    return Math.min(p.bet + p.stack, target); // cap at all-in
  }

  if (toCall <= 0) {
    if (eff > 0.6 && Math.random() < 0.7) return { type: "raise", to: raiseTo(0.6) };
    if (eff < 0.3 && Math.random() < 0.12) return { type: "raise", to: raiseTo(0.5) }; // bluff
    return { type: "check" };
  }

  var potOdds = toCall / (potNow + toCall);
  if (eff > 0.72 && Math.random() < 0.55 && p.stack > toCall) {
    return { type: "raise", to: raiseTo(0.7) };
  }
  if (eff > potOdds + 0.08) return { type: "call" };
  if (toCall < potNow * 0.15 && Math.random() < 0.5) return { type: "call" };
  return { type: "fold" };
}

/* =========================================================================
 * Everything below is the browser game (state machine + UI). Skipped in Node.
 * ========================================================================= */
if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", function () {
    var BOT_NAMES = ["Doyle", "Phil", "Stu", "Annie", "Daniel", "Vanessa",
      "Chris", "Johnny", "Liv", "Maria"];

    var G = null;        // game state
    var pendingTimer = null;

    var el = {
      setup: document.getElementById("setup"),
      game: document.getElementById("game"),
      table: document.getElementById("table"),
      message: document.getElementById("message"),
      controls: document.getElementById("controls"),
      waiting: document.getElementById("waiting"),
      afterHand: document.getElementById("after-hand"),
      dealNext: document.getElementById("deal-next"),
      rebuy: document.getElementById("rebuy"),
      fold: document.getElementById("btn-fold"),
      callBtn: document.getElementById("btn-call"),
      raiseBtn: document.getElementById("btn-raise"),
      slider: document.getElementById("raise-slider"),
      raiseAmt: document.getElementById("raise-amt"),
      quick: document.getElementById("quick"),
      numPlayers: document.getElementById("num-players"),
      startStack: document.getElementById("start-stack"),
      sb: document.getElementById("sb"),
      bb: document.getElementById("bb")
    };

    /* ----------------------------- helpers ----------------------------- */
    function sumBets() {
      return G.players.reduce(function (a, p) { return a + p.bet; }, 0);
    }
    function potNow() { return G.pot + sumBets(); }
    function activePlayers() { return G.players.filter(function (p) { return !p.folded; }); }
    function canStillBet() {
      return G.players.filter(function (p) { return !p.folded && !p.allIn; }).length >= 2;
    }
    // First seat after `afterIdx` that still needs to act this round.
    function nextToAct(afterIdx) {
      for (var k = 1; k <= G.players.length; k++) {
        var i = (afterIdx + k) % G.players.length;
        var p = G.players[i];
        if (!p.folded && !p.allIn && (!p.acted || p.bet < G.currentBet)) return i;
      }
      return -1;
    }

    /* --------------------------- hand lifecycle --------------------------- */
    function startHand() {
      el.message.textContent = "";
      el.dealNext.hidden = true;
      el.rebuy.hidden = true;

      // Cash game: bots that busted buy back in to the starting stack.
      G.players.forEach(function (p) {
        if (!p.isHuman && p.stack <= 0) p.stack = G.startStack;
      });

      // Move button to the next player who has chips.
      do { G.button = (G.button + 1) % G.players.length; }
      while (G.players[G.button].stack <= 0);

      G.deck = shuffle(makeDeck());
      G.board = [];
      G.pot = 0;
      G.street = "preflop";
      G.currentBet = 0;
      G.minRaise = G.bb;
      G.revealAll = false;

      G.players.forEach(function (p) {
        p.hole = []; p.bet = 0; p.totalBet = 0;
        p.folded = p.stack <= 0; // no chips => sit this hand out
        p.allIn = false; p.acted = false; p.peeked = false;
      });

      // Deal two cards each (only to players in the hand).
      for (var d = 0; d < 2; d++) {
        G.players.forEach(function (p) { if (!p.folded) p.hole.push(G.deck.pop()); });
      }

      var n = G.players.length;
      var inHand = G.players.filter(function (p) { return !p.folded; });
      var sbIdx, bbIdx, firstPre;
      if (inHand.length === 2) {
        sbIdx = G.button;
        bbIdx = nextOccupied(G.button);
        firstPre = G.button;            // heads-up: button (SB) acts first preflop
      } else {
        sbIdx = nextOccupied(G.button);
        bbIdx = nextOccupied(sbIdx);
        firstPre = nextOccupied(bbIdx);  // UTG
      }
      postBlind(sbIdx, G.sb);
      postBlind(bbIdx, G.bb);
      G.currentBet = G.bb;
      G.minRaise = G.bb;

      G.currentToAct = playableFrom(firstPre);
      continuePlay();
    }

    function nextOccupied(idx) {
      for (var k = 1; k <= G.players.length; k++) {
        var i = (idx + k) % G.players.length;
        if (!G.players[i].folded) return i;
      }
      return idx;
    }
    // Start at idx; return idx if it can act, else the next who can.
    function playableFrom(idx) {
      var p = G.players[idx];
      if (!p.folded && !p.allIn) return idx;
      return nextToAct(idx);
    }

    function postBlind(idx, amount) {
      var p = G.players[idx];
      var a = Math.min(amount, p.stack);
      p.stack -= a; p.bet += a; p.totalBet += a;
      if (p.stack === 0) p.allIn = true;
    }

    /* ------------------------------ actions ------------------------------ */
    function applyAction(idx, action) {
      var p = G.players[idx];
      var toCall = G.currentBet - p.bet;

      if (action.type === "fold") {
        p.folded = true;
      } else if (action.type === "check") {
        // legal only when toCall === 0
      } else if (action.type === "call") {
        var amt = Math.min(toCall, p.stack);
        p.stack -= amt; p.bet += amt; p.totalBet += amt;
        if (p.stack === 0) p.allIn = true;
      } else if (action.type === "raise") {
        var added = Math.min(action.to - p.bet, p.stack);
        var oldCurrent = G.currentBet;
        p.stack -= added; p.bet += added; p.totalBet += added;
        if (p.bet > oldCurrent) {
          var raiseSize = p.bet - oldCurrent;
          if (raiseSize >= G.minRaise) {
            // Full raise: reopens the betting for everyone else.
            G.minRaise = raiseSize;
            G.players.forEach(function (o, oi) {
              if (oi !== idx && !o.folded && !o.allIn) o.acted = false;
            });
          }
          G.currentBet = p.bet;
        }
        if (p.stack === 0) p.allIn = true;
      }
      p.acted = true;

      // Only one player left? Hand is over, award immediately.
      if (activePlayers().length === 1) { endByFold(); return; }

      var nxt = nextToAct(idx);
      if (nxt === -1) advanceStreet();
      else { G.currentToAct = nxt; continuePlay(); }
    }

    function advanceStreet() {
      // Sweep this street's bets into the pot.
      G.pot += sumBets();
      G.players.forEach(function (p) { p.bet = 0; if (!p.folded && !p.allIn) p.acted = false; });
      G.currentBet = 0;
      G.minRaise = G.bb;

      if (G.street === "river") { showdown(); return; }
      if (G.street === "preflop") { G.board.push(G.deck.pop(), G.deck.pop(), G.deck.pop()); G.street = "flop"; }
      else if (G.street === "flop") { G.board.push(G.deck.pop()); G.street = "turn"; }
      else if (G.street === "turn") { G.board.push(G.deck.pop()); G.street = "river"; }

      // If nobody can bet anymore (all but one all-in), run out the rest.
      if (!canStillBet()) { render(); advanceStreet(); return; }

      G.currentToAct = playableFrom(nextOccupied(G.button));
      continuePlay();
    }

    /* ----------------------------- showdowns ----------------------------- */
    function endByFold() {
      G.pot += sumBets();
      G.players.forEach(function (p) { p.bet = 0; });
      var winner = activePlayers()[0];
      winner.stack += G.pot;
      el.message.textContent = winner.name + " wins " + money(G.pot) + " (everyone folded).";
      G.pot = 0;
      finishHand();
    }

    function showdown() {
      G.revealAll = true;
      var pots = buildPots(G.players);
      var lines = [];

      // Precompute each contender's best hand.
      var scores = {};
      G.players.forEach(function (p, i) {
        if (!p.folded) scores[i] = evaluate7(p.hole.concat(G.board));
      });

      pots.forEach(function (pot, pi) {
        var best = null, winners = [];
        pot.eligible.forEach(function (p) {
          var i = G.players.indexOf(p);
          var sc = scores[i];
          if (!best || cmp(sc, best) > 0) { best = sc; winners = [p]; }
          else if (cmp(sc, best) === 0) winners.push(p);
        });
        // Split, awarding any odd chip to the earliest seat left of the button.
        var share = Math.floor(pot.amount / winners.length);
        var remainder = pot.amount - share * winners.length;
        winners.forEach(function (w) { w.stack += share; });
        for (var r = 0; r < remainder; r++) {
          winners[r % winners.length].stack += 1;
        }
        var label = pots.length > 1 ? (pi === 0 ? "Main pot" : "Side pot " + pi) : "Pot";
        lines.push(label + ": " + winners.map(function (w) { return w.name; }).join(", ") +
          " win" + (winners.length > 1 ? " (split)" : "") + " " + money(pot.amount) +
          " with " + handName(best) + ".");
      });

      G.pot = 0;
      el.message.innerHTML = lines.join("<br>");
      finishHand();
    }

    function finishHand() {
      G.handOver = true;
      hideControls();
      el.waiting.hidden = true;
      el.afterHand.hidden = false;     // show deal/rebuy/leave
      render();
      var human = G.players[0];
      if (human.stack <= 0) {
        el.rebuy.hidden = false;       // busted — offer a top-up
        el.dealNext.hidden = true;
      } else {
        el.dealNext.hidden = false;
        el.rebuy.hidden = true;
      }
    }

    /* ------------------------------- driver ------------------------------- */
    function continuePlay() {
      G.handOver = false;
      render();
      var p = G.players[G.currentToAct];
      if (p.isHuman) {
        showControls();
      } else {
        hideControls();
        el.waiting.hidden = false;     // bots are acting
        el.afterHand.hidden = true;
        clearTimeout(pendingTimer);
        pendingTimer = setTimeout(function () {
          var action = botDecision(G, p, potNow());
          applyAction(G.currentToAct, action);
        }, 750);
      }
    }

    /* ----------------------------- rendering ----------------------------- */
    function money(n) { return "$" + n.toLocaleString(); }

    function cardHTML(card, faceDown) {
      if (faceDown) return '<span class="pcard back"></span>';
      var red = card.s === "h" || card.s === "d";
      return '<span class="pcard' + (red ? " red" : "") + '">' +
        rankLabel(card.r) + SUIT_SYMBOL[card.s] + "</span>";
    }

    function buildSeats() {
      el.table.innerHTML =
        '<div id="board"></div><div id="pot-label"></div><div id="dealer-btn">D</div>';
      var n = G.players.length;
      G.players.forEach(function (p, i) {
        var angle = (90 + i * 360 / n) * Math.PI / 180; // seat 0 (human) at bottom
        var left = 50 + 40 * Math.cos(angle);
        var top = 50 + 42 * Math.sin(angle);
        var seat = document.createElement("div");
        seat.className = "seat";
        seat.id = "seat-" + i;
        seat.style.left = left + "%";
        seat.style.top = top + "%";
        el.table.appendChild(seat);
      });
    }

    function render() {
      if (!document.getElementById("seat-0")) buildSeats();

      document.getElementById("board").innerHTML =
        G.board.map(function (c) { return cardHTML(c, false); }).join("") || "&nbsp;";
      document.getElementById("pot-label").textContent = "Pot: " + money(G.pot + sumBets());

      G.players.forEach(function (p, i) {
        var seat = document.getElementById("seat-" + i);
        var isTurn = (i === G.currentToAct) && !G.handOver;
        // Cards are face-up for you, for non-folders at showdown, or for any
        // bot you've chosen to peek at once the hand is over.
        var reveal = p.isHuman || (G.handOver && p.peeked) || (G.revealAll && !p.folded);
        var hasCards = p.hole.length > 0;
        var showPeek = G.handOver && !p.isHuman && !reveal && hasCards;

        var cards;
        if (!hasCards) cards = "";
        else if (reveal) cards = p.hole.map(function (c) { return cardHTML(c, false); }).join("");
        else if (p.folded) cards = '<span class="folded-label">folded</span>';
        else cards = p.hole.map(function (c) { return cardHTML(c, true); }).join("");

        seat.className = "seat" + (isTurn ? " active" : "") + (p.folded ? " folded" : "") +
          (p.isHuman ? " human" : "");
        seat.innerHTML =
          '<div class="seat-cards">' + cards + "</div>" +
          '<div class="seat-name">' + p.name + (p.allIn ? " (all-in)" : "") + "</div>" +
          '<div class="seat-stack">' + money(p.stack) + "</div>" +
          (p.bet > 0 ? '<div class="seat-bet">' + money(p.bet) + "</div>" : "") +
          (showPeek ? '<button class="peek-btn" data-peek="' + i + '">👁 cards</button>' : "") +
          (reveal && p.folded && G.handOver ? '<div class="peek-note">folded</div>' : "");
      });

      // Position the dealer button between the button player's seat and the
      // center of the table, so it sits on the felt and is clearly visible.
      var dbtn = document.getElementById("dealer-btn");
      if (dbtn) {
        var n = G.players.length;
        var angle = (90 + G.button * 360 / n) * Math.PI / 180;
        var seatLeft = 50 + 40 * Math.cos(angle);
        var seatTop = 50 + 42 * Math.sin(angle);
        dbtn.style.left = (seatLeft + (50 - seatLeft) * 0.38) + "%";
        dbtn.style.top = (seatTop + (50 - seatTop) * 0.38) + "%";
      }
    }

    /* --------------------------- human controls --------------------------- */
    function showControls() {
      var p = G.players[0];
      var toCall = G.currentBet - p.bet;
      el.waiting.hidden = true;
      el.afterHand.hidden = true;
      el.controls.hidden = false;

      el.callBtn.textContent = toCall <= 0 ? "Check" : "Call " + money(Math.min(toCall, p.stack));

      // Raise/bet range: min is a full raise (or all-in if short); max is all-in.
      var minTo = Math.min(p.bet + p.stack, G.currentBet + G.minRaise);
      var maxTo = p.bet + p.stack;
      var canRaise = maxTo > G.currentBet; // has chips beyond a call
      el.slider.disabled = !canRaise;
      el.raiseBtn.disabled = !canRaise;
      el.quick.style.display = canRaise ? "" : "none";
      if (canRaise) {
        el.slider.min = minTo;
        el.slider.max = maxTo;
        el.slider.step = 1;
        el.slider.value = Math.min(maxTo, Math.max(minTo, Math.round(potNow() * 0.6) + G.currentBet));
        updateRaiseLabel();
      }
    }
    function hideControls() { el.controls.hidden = true; }

    // iOS Safari scrolls to the top when the focused button gets hidden after
    // you act. Blur it first, then pin the scroll position across the re-render.
    function preserveScroll(fn) {
      var y = window.pageYOffset;
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      fn();
      window.scrollTo(0, y);
      requestAnimationFrame(function () { window.scrollTo(0, y); });
      setTimeout(function () { window.scrollTo(0, y); }, 60);
    }

    function updateRaiseLabel() {
      var p = G.players[0];
      var to = Number(el.slider.value);
      var verb = G.currentBet === 0 ? "Bet " : "Raise to ";
      el.raiseBtn.textContent = (to >= p.bet + p.stack ? "All-in " : verb) + money(to);
      el.raiseAmt.textContent = money(to);
    }

    el.slider.addEventListener("input", updateRaiseLabel);

    // Tap a seat's 👁 button after a hand to reveal what that player held.
    el.table.addEventListener("click", function (e) {
      var btn = e.target.closest(".peek-btn");
      if (!btn || !G || !G.handOver) return;
      var idx = Number(btn.dataset.peek);
      preserveScroll(function () { G.players[idx].peeked = true; render(); });
    });

    el.fold.addEventListener("click", function () {
      if (G.players[G.currentToAct].isHuman) preserveScroll(function () { applyAction(0, { type: "fold" }); });
    });
    el.callBtn.addEventListener("click", function () {
      if (!G.players[G.currentToAct].isHuman) return;
      var toCall = G.currentBet - G.players[0].bet;
      preserveScroll(function () { applyAction(0, { type: toCall <= 0 ? "check" : "call" }); });
    });
    el.raiseBtn.addEventListener("click", function () {
      if (!G.players[G.currentToAct].isHuman) return;
      preserveScroll(function () { applyAction(0, { type: "raise", to: Number(el.slider.value) }); });
    });
    el.quick.addEventListener("click", function (e) {
      var btn = e.target.closest("button");
      if (!btn) return;
      var p = G.players[0];
      var maxTo = p.bet + p.stack;
      var to;
      if (btn.dataset.frac === "allin") to = maxTo;
      else to = G.currentBet + Math.round(potNow() * Number(btn.dataset.frac));
      el.slider.value = Math.min(maxTo, Math.max(Number(el.slider.min), to));
      updateRaiseLabel();
    });

    el.dealNext.addEventListener("click", function () {
      preserveScroll(startHand);
    });
    el.rebuy.addEventListener("click", function () {
      preserveScroll(function () { G.players[0].stack = G.startStack; startHand(); });
    });

    /* ------------------------------- setup ------------------------------- */
    document.getElementById("start-game").addEventListener("click", function () {
      var n = Number(el.numPlayers.value);
      var startStack = Math.max(1, Number(el.startStack.value) || 0);
      var sb = Math.max(1, Number(el.sb.value) || 0);
      var bb = Math.max(sb, Number(el.bb.value) || 0);

      var players = [{ name: "You", isHuman: true, stack: startStack }];
      var names = BOT_NAMES.slice();
      for (var i = 1; i < n; i++) {
        var pick = names.splice(Math.floor(Math.random() * names.length), 1)[0];
        players.push({ name: pick, isHuman: false, stack: startStack });
      }

      G = {
        players: players, startStack: startStack, sb: sb, bb: bb,
        button: Math.floor(Math.random() * n), board: [], pot: 0,
        deck: [], street: "preflop", currentBet: 0, minRaise: bb,
        currentToAct: 0, revealAll: false, handOver: false
      };

      el.setup.hidden = true;
      el.game.hidden = false;
      el.table.innerHTML = "";
      startHand();
    });

    document.getElementById("new-game").addEventListener("click", function () {
      clearTimeout(pendingTimer);
      el.game.hidden = true;
      el.setup.hidden = false;
    });
  });
}

/* ------------------------------ Node exports ------------------------------ */
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    makeDeck: makeDeck, evaluate5: evaluate5, evaluate7: evaluate7, cmp: cmp,
    buildPots: buildPots, handName: handName, preflopStrength: preflopStrength,
    postflopStrength: postflopStrength, botDecision: botDecision, rankLabel: rankLabel
  };
}
