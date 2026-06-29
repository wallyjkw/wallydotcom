/* WallyDotCom Uno
 * Single human player vs. rule-based bots on one device. Standard 108-card deck.
 * First player to empty their hand wins (single round).
 *
 * The pure engine functions (deck, legality, bot helpers) live at the top and are
 * exported for Node testing at the bottom. The browser game (state machine + UI)
 * is wrapped in a DOMContentLoaded block and skipped when required under Node.
 */

/* ------------------------------ Cards & deck ------------------------------ */

var COLORS = ["r", "y", "g", "b"];
var COLOR_NAME = { r: "Red", y: "Yellow", g: "Green", b: "Blue" };

// A card is { color, value }. color is "r"|"y"|"g"|"b" for coloured cards, or
// null for wilds. value is a number 0-9, or one of:
// "skip" | "reverse" | "draw2" | "wild" | "wild4".
function makeDeck() {
  var deck = [];
  COLORS.forEach(function (c) {
    deck.push({ color: c, value: 0 });                 // one 0 per colour
    for (var n = 1; n <= 9; n++) {                     // two each of 1-9
      deck.push({ color: c, value: n });
      deck.push({ color: c, value: n });
    }
    ["skip", "reverse", "draw2"].forEach(function (v) { // two of each action
      deck.push({ color: c, value: v });
      deck.push({ color: c, value: v });
    });
  });
  for (var w = 0; w < 4; w++) {                        // four Wild + four Wild Draw Four
    deck.push({ color: null, value: "wild" });
    deck.push({ color: null, value: "wild4" });
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

function isWild(card) { return card.value === "wild" || card.value === "wild4"; }

// What's drawn into the glyph / corners of a card.
function cardGlyph(card) {
  if (typeof card.value === "number") return String(card.value);
  if (card.value === "skip") return "⊘";      // ⊘
  if (card.value === "reverse") return "⇄";   // ⇄
  if (card.value === "draw2") return "+2";
  if (card.value === "wild") return "★";      // ★
  if (card.value === "wild4") return "+4";
  return "?";
}

/* ------------------------------ Legality ------------------------------ */

// Can `card` be played on top of `topCard` (active colour `topColor`)?
// With a pending +2/+4 penalty, the only legal play is stacking a matching
// penalty card (and only when the stacking house rule is on).
function canPlay(card, topCard, topColor, penalty, penaltyType, stacking) {
  if (penalty > 0) {
    return !!stacking && card.value === penaltyType;
  }
  if (card.value === "wild" || card.value === "wild4") return true;
  if (card.color === topColor) return true;
  if (card.value === topCard.value) return true;
  return false;
}

// Indices of every legal play in a hand.
function legalPlays(hand, topCard, topColor, penalty, penaltyType, stacking) {
  var out = [];
  for (var i = 0; i < hand.length; i++) {
    if (canPlay(hand[i], topCard, topColor, penalty, penaltyType, stacking)) out.push(i);
  }
  return out;
}

/* ------------------------------ Bot helpers ------------------------------ */

// Pick the colour a bot should declare for a wild: the colour it holds most of.
// Ties (and an all-wild hand) fall back to a stable-ish pick.
function chooseColor(hand) {
  var tally = { r: 0, y: 0, g: 0, b: 0 };
  hand.forEach(function (c) { if (c.color) tally[c.color]++; });
  var best = COLORS[0], bestN = -1;
  COLORS.forEach(function (c) { if (tally[c] > bestN) { bestN = tally[c]; best = c; } });
  if (bestN === 0) best = COLORS[Math.floor(Math.random() * 4)];
  return best;
}

// Choose which legal card a bot plays. Prefer shedding coloured cards (saving
// wilds for when they're stuck), and among those play action cards first.
function chooseBotCard(hand, plays) {
  var colored = plays.filter(function (i) { return !isWild(hand[i]); });
  if (colored.length) {
    var actions = colored.filter(function (i) { return typeof hand[i].value !== "number"; });
    return (actions.length ? actions : colored)[0];
  }
  // Only wilds are legal: spend a plain Wild before a Wild Draw Four.
  var plainWild = plays.filter(function (i) { return hand[i].value === "wild"; });
  return (plainWild.length ? plainWild : plays)[0];
}

/* =========================================================================
 * Browser game (state machine + UI). Skipped under Node.
 * ========================================================================= */
if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", function () {
    var BOT_NAMES = ["Ruby", "Sky", "Pip", "Mabel", "Otis", "Hazel", "Cleo", "Gus"];
    var BOT_DELAY = 900;

    var G = null;            // game state
    var botTimer = null;
    var pendingWild = -1;    // hand index of a wild awaiting the human's colour pick

    var el = {
      setup: document.getElementById("setup"),
      game: document.getElementById("game"),
      message: document.getElementById("message"),
      opponents: document.getElementById("opponents"),
      discard: document.getElementById("discard"),
      drawPile: document.getElementById("draw-pile"),
      colorDot: document.getElementById("color-dot"),
      dirArrow: document.getElementById("dir-arrow"),
      hand: document.getElementById("hand"),
      handCount: document.getElementById("hand-count"),
      drawBtn: document.getElementById("btn-draw"),
      passBtn: document.getElementById("btn-pass"),
      againBtn: document.getElementById("btn-again"),
      leaveBtn: document.getElementById("btn-leave"),
      colorPicker: document.getElementById("color-picker"),
      numPlayers: document.getElementById("num-players"),
      ruleStacking: document.getElementById("rule-stacking"),
      ruleDrawToPlay: document.getElementById("rule-drawtoplay"),
      ruleMustPlay: document.getElementById("rule-mustplay")
    };

    /* ------------------------------ helpers ------------------------------ */
    function top() { return G.discard[G.discard.length - 1]; }
    function human() { return G.players[0]; }
    function isHumanTurn() { return !G.over && G.current === 0; }
    // True only when the human may act right now: their turn, and no scheduled
    // transition (bot move / turn advance) is in flight. Guards against a fast
    // double-tap firing a second move during the ~900ms pacing delay.
    function actionable() { return isHumanTurn() && !G.busy; }

    function myLegalPlays(p) {
      return legalPlays(p.hand, top(), G.topColor, G.penalty, G.penaltyType, G.rules.stacking);
    }

    // Step `n` seats in the current play direction, wrapping around.
    function step(from, n) {
      var len = G.players.length;
      return ((from + n * G.dir) % len + len) % len;
    }

    // Draw one card, reshuffling the discard back into the pile if it's empty.
    function drawOne() {
      if (!G.drawPile.length) {
        if (G.discard.length <= 1) return null;       // nothing left anywhere
        var keep = G.discard.pop();
        G.drawPile = shuffle(G.discard);
        G.discard = [keep];
      }
      return G.drawPile.pop();
    }

    /* ----------------------------- lifecycle ----------------------------- */
    function startGame(numPlayers, rules) {
      var players = [{ name: "You", isHuman: true, hand: [] }];
      var names = BOT_NAMES.slice();
      for (var i = 1; i < numPlayers; i++) {
        var pick = names.splice(Math.floor(Math.random() * names.length), 1)[0];
        players.push({ name: pick, isHuman: false, hand: [] });
      }

      var deck = shuffle(makeDeck());
      players.forEach(function (p) {
        for (var c = 0; c < 7; c++) p.hand.push(deck.pop());
      });

      // Flip the starting card. Keep it simple: start on a plain number card so
      // there's no first-turn action/wild to resolve.
      var start;
      while (true) {
        start = deck.pop();
        if (typeof start.value === "number") break;
        deck.push(start);
        deck = shuffle(deck);
      }

      G = {
        players: players,
        drawPile: deck,
        discard: [start],
        topColor: start.color,
        dir: 1,
        current: 0,
        penalty: 0,
        penaltyType: null,
        phase: "play",      // "play" = start of turn, "postdraw" = drew one, may play it or pass
        drawnIndex: -1,      // hand index of the just-drawn card in postdraw phase
        busy: false,         // a scheduled transition is in flight; input is locked
        over: false,
        winner: null,
        rules: rules
      };

      el.setup.hidden = true;
      el.game.hidden = false;
      el.againBtn.hidden = true;
      el.message.textContent = "Game on — your turn.";
      beginTurn();
    }

    function beginTurn() {
      G.phase = "play";
      G.drawnIndex = -1;
      G.busy = false;
      var p = G.players[G.current];

      // A pending +2/+4 lands on whoever's turn it now is.
      if (G.penalty > 0) {
        var canStack = G.rules.stacking && p.hand.some(function (c) { return c.value === G.penaltyType; });
        if (!canStack) {
          // Can't (or rules don't allow) stacking — take the cards and lose the turn.
          var n = G.penalty;
          for (var d = 0; d < n; d++) { var c = drawOne(); if (c) p.hand.push(c); }
          G.penalty = 0; G.penaltyType = null;
          announce(p.name + (p.isHuman ? " draw " : " draws ") + n + " and " +
                   (p.isHuman ? "lose" : "loses") + " the turn.");
          render();
          schedule(function () { advance(false); });
          return;
        }
      }

      render();
      if (!p.isHuman) schedule(botTurn);
    }

    function advance(extraSkip) {
      G.current = step(G.current, extraSkip ? 2 : 1);
      beginTurn();
    }

    function schedule(fn) {
      G.busy = true;                       // lock input until the next beginTurn
      clearTimeout(botTimer);
      botTimer = setTimeout(fn, BOT_DELAY);
    }

    /* ------------------------------ playing ------------------------------ */
    // Remove card at handIndex from player pIdx and resolve its effect.
    function playCard(pIdx, handIndex, chosenColor) {
      var p = G.players[pIdx];
      var card = p.hand.splice(handIndex, 1)[0];
      G.discard.push(card);
      G.topColor = isWild(card) ? chosenColor : card.color;

      var who = p.isHuman ? "You" : p.name;
      var verb = p.isHuman ? "play" : "plays";
      announce(who + " " + verb + " " + describe(card, chosenColor) + ".");

      if (p.hand.length === 0) { declareWinner(p); return; }
      if (p.hand.length === 1) {
        announce(who + " " + (p.isHuman ? "have" : "has") + " UNO! 🃏");
      }

      var extraSkip = false;
      if (card.value === "reverse") {
        G.dir *= -1;
        if (G.players.length === 2) extraSkip = true;   // heads-up: reverse acts as a skip
      } else if (card.value === "skip") {
        extraSkip = true;
      } else if (card.value === "draw2") {
        G.penalty += 2; G.penaltyType = "draw2";
      } else if (card.value === "wild4") {
        G.penalty += 4; G.penaltyType = "wild4";
      }

      render();
      schedule(function () { advance(extraSkip); });
    }

    function describe(card, chosenColor) {
      if (card.value === "wild") return "a Wild (" + COLOR_NAME[chosenColor] + ")";
      if (card.value === "wild4") return "a Wild Draw Four (" + COLOR_NAME[chosenColor] + ")";
      var label = COLOR_NAME[card.color] + " ";
      if (card.value === "skip") return label + "Skip";
      if (card.value === "reverse") return label + "Reverse";
      if (card.value === "draw2") return label + "Draw Two";
      return label + card.value;
    }

    function declareWinner(p) {
      G.over = true;
      G.winner = p;
      announce((p.isHuman ? "You win! 🎉" : p.name + " wins.") + " Hand cleared.");
      render();
    }

    /* ------------------------------ bot turn ------------------------------ */
    function botTurn() {
      if (!G || G.over) return;
      var pIdx = G.current;
      var p = G.players[pIdx];

      // Facing a penalty here means the bot CAN stack (beginTurn auto-resolves the
      // can't-stack case). Pass it along.
      if (G.penalty > 0) {
        var si = p.hand.findIndex(function (c) { return c.value === G.penaltyType; });
        playCard(pIdx, si, isWild(p.hand[si]) ? chooseColor(p.hand) : null);
        return;
      }

      var plays = myLegalPlays(p);
      if (plays.length) {
        var idx = chooseBotCard(p.hand, plays);
        var color = isWild(p.hand[idx]) ? chooseColor(p.hand) : null;
        playCard(pIdx, idx, color);
        return;
      }

      // No play: draw (one, or until playable depending on the rule), then play
      // the drawn card if it's now legal, otherwise pass.
      var drawn = botDraw(p);
      if (drawn >= 0) {
        var col = isWild(p.hand[drawn]) ? chooseColor(p.hand) : null;
        schedule(function () { playCard(pIdx, drawn, col); });
      } else {
        announce(p.name + " draws and passes.");
        render();
        schedule(function () { advance(false); });
      }
    }

    // Draw for a bot with no play. Returns the hand index of a freshly drawn
    // playable card, or -1 if it ended up passing.
    function botDraw(p) {
      do {
        var c = drawOne();
        if (!c) return -1;
        p.hand.push(c);
        if (canPlay(c, top(), G.topColor, 0, null, G.rules.stacking)) return p.hand.length - 1;
      } while (G.rules.drawToPlay);
      return -1;
    }

    /* ------------------------------ rendering ------------------------------ */
    function announce(msg) { el.message.textContent = msg; }

    function cardFace(card) {
      var g = cardGlyph(card);
      return '<span class="corner tl">' + g + '</span>' +
             '<span class="oval"><span class="glyph">' + g + '</span></span>' +
             '<span class="corner br">' + g + '</span>';
    }
    function colorClass(card) { return isWild(card) ? "wild" : card.color; }

    function render() {
      // Opponents (seats 1..n), in play order.
      var html = "";
      for (var i = 1; i < G.players.length; i++) {
        var p = G.players[i];
        var backs = "";
        var shown = Math.min(p.hand.length, 5);
        for (var b = 0; b < shown; b++) backs += '<div class="ucard back"></div>';
        var cls = "opp" + (i === G.current && !G.over ? " active" : "") +
                  (G.over && G.winner === p ? " winner" : "");
        html += '<div class="' + cls + '">' +
          '<div class="opp-name">' + p.name + '</div>' +
          '<div class="opp-count">' + p.hand.length + ' card' + (p.hand.length === 1 ? '' : 's') + '</div>' +
          '<div class="opp-cards">' + backs + '</div>' +
          (p.hand.length === 1 ? '<span class="opp-uno">UNO</span>' : '') +
          '</div>';
      }
      el.opponents.innerHTML = html;

      // Center: discard top + active colour + direction.
      el.discard.innerHTML = '<div class="ucard big ' + colorClass(top()) + '">' + cardFace(top()) + '</div>';
      el.colorDot.className = "";
      el.colorDot.classList.add(G.topColor);
      el.dirArrow.textContent = G.dir === 1 ? "↻" : "↺";

      // Your hand.
      var p0 = human();
      el.handCount.textContent = p0.hand.length;
      var legal = G.over ? [] : myLegalPlays(p0);
      var legalSet = {};
      legal.forEach(function (i) { legalSet[i] = true; });

      var handHtml = p0.hand.map(function (card, i) {
        // In postdraw, only the just-drawn card is playable.
        var playable = actionable() &&
          (G.phase === "postdraw" ? (i === G.drawnIndex) : !!legalSet[i]);
        var cls = "ucard " + colorClass(card) + (playable ? " playable" : (actionable() ? " dim" : ""));
        return '<button class="' + cls + '" data-i="' + i + '"' + (playable ? "" : " disabled") + '>' +
          cardFace(card) + '</button>';
      }).join("");
      el.hand.innerHTML = handHtml;

      updateBar();
    }

    function updateBar() {
      var myTurn = actionable();
      var p0 = human();
      var hasPlay = myTurn && myLegalPlays(p0).length > 0;

      if (G.penalty > 0 && myTurn) {
        // Either stack a matching card from the hand, or take the cards.
        el.drawBtn.textContent = "Draw " + G.penalty;
        el.drawBtn.disabled = false;
        el.passBtn.disabled = true;
      } else if (G.phase === "postdraw" && myTurn) {
        el.drawBtn.textContent = "Draw";
        el.drawBtn.disabled = true;          // already drew this turn
        el.passBtn.disabled = false;
      } else {
        el.drawBtn.textContent = "Draw";
        // Must-play rule blocks a voluntary draw when you already hold a play.
        el.drawBtn.disabled = !myTurn || (G.rules.mustPlay && hasPlay);
        el.passBtn.disabled = true;
      }

      el.againBtn.hidden = !G.over;
      el.againBtn.disabled = !G.over;
    }

    // iOS Safari jumps to the top when a focused control is hidden after a tap.
    // Blur first, then pin the scroll position across the re-render.
    function preserveScroll(fn) {
      var y = window.pageYOffset;
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      fn();
      window.scrollTo(0, y);
      requestAnimationFrame(function () { window.scrollTo(0, y); });
      setTimeout(function () { window.scrollTo(0, y); }, 60);
    }

    /* ------------------------------ human input ------------------------------ */
    // Tap a card in your hand to play it.
    el.hand.addEventListener("click", function (e) {
      var btn = e.target.closest(".ucard");
      if (!btn || btn.disabled || !actionable()) return;
      var i = Number(btn.dataset.i);
      var card = human().hand[i];
      if (isWild(card)) {
        pendingWild = i;                 // ask for a colour first
        el.colorPicker.hidden = false;
        return;
      }
      preserveScroll(function () { playCard(0, i, null); });
    });

    // Colour chooser for a wild.
    el.colorPicker.addEventListener("click", function (e) {
      var btn = e.target.closest(".cp-btn");
      if (!btn) return;
      var color = btn.dataset.color;
      var i = pendingWild;
      pendingWild = -1;
      el.colorPicker.hidden = true;
      if (i >= 0) preserveScroll(function () { playCard(0, i, color); });
    });

    // Draw button / draw pile: take a penalty, or draw a card on a normal turn.
    function onDraw() {
      if (!actionable() || G.phase === "postdraw") return;  // can't draw twice in a turn

      if (G.penalty > 0) {                 // take the +2/+4 (can't or won't stack)
        preserveScroll(function () {
          var n = G.penalty;
          for (var d = 0; d < n; d++) { var c = drawOne(); if (c) human().hand.push(c); }
          G.penalty = 0; G.penaltyType = null;
          announce("You draw " + n + " and lose the turn.");
          render();
          schedule(function () { advance(false); });
        });
        return;
      }

      preserveScroll(function () { humanDraw(); });
    }
    el.drawBtn.addEventListener("click", onDraw);
    el.drawPile.addEventListener("click", onDraw);

    function humanDraw() {
      var p = human();
      var lastPlayable = -1;
      do {
        var c = drawOne();
        if (!c) break;
        p.hand.push(c);
        if (canPlay(c, top(), G.topColor, 0, null, G.rules.stacking)) {
          lastPlayable = p.hand.length - 1;
          break;
        }
      } while (G.rules.drawToPlay);

      if (lastPlayable >= 0) {
        G.phase = "postdraw";
        G.drawnIndex = lastPlayable;
        announce("You drew a card you can play — play it or pass.");
        render();
      } else {
        announce("You drew and passed.");
        render();
        schedule(function () { advance(false); });
      }
    }

    // Pass after drawing.
    el.passBtn.addEventListener("click", function () {
      if (!actionable() || G.phase !== "postdraw") return;
      preserveScroll(function () { advance(false); });
    });

    /* ------------------------------ setup wiring ------------------------------ */
    document.getElementById("start-game").addEventListener("click", function () {
      var n = Number(el.numPlayers.value);
      var rules = {
        stacking: el.ruleStacking.checked,
        drawToPlay: el.ruleDrawToPlay.checked,
        mustPlay: el.ruleMustPlay.checked
      };
      startGame(n, rules);
    });

    el.againBtn.addEventListener("click", function () {
      startGame(G.players.length, G.rules);
    });

    el.leaveBtn.addEventListener("click", function () {
      clearTimeout(botTimer);
      el.game.hidden = true;
      el.setup.hidden = false;
    });
  });
}

/* ------------------------------ Node exports ------------------------------ */
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    makeDeck: makeDeck, isWild: isWild, cardGlyph: cardGlyph,
    canPlay: canPlay, legalPlays: legalPlays,
    chooseColor: chooseColor, chooseBotCard: chooseBotCard
  };
}
