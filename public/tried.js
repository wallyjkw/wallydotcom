/* Wally's personal "tried it" tracker — the toggle on a cocktail's page.
 * Injected by the Worker onto recipe detail pages. Only COCKTAILS get the
 * toggle (the cocktail slug list is /cocktail-slugs.json); food recipes don't.
 * Anyone can SEE the mark (read is public); changing it needs the passcode,
 * asked once per device and then remembered.
 * (The Cocktails index page does its own ✓ marking + filtering.)
 */
(function () {
  var PASS_KEY = "wally-tried-passcode";
  var path = location.pathname.replace(/\/+$/, "");
  var detail = path.match(/^\/recipes\/([a-z0-9-]+)(?:\.html)?$/);
  if (!detail) return;                    // only recipe detail pages
  var slug = detail[1];

  // Only show the toggle on cocktails.
  fetch("/cocktail-slugs.json")
    .then(function (r) { return r.json(); })
    .then(function (slugs) {
      if (slugs.indexOf(slug) === -1) return;   // not a cocktail — no toggle
      return fetch("/api/tried")
        .then(function (r) { return r.json(); })
        .then(function (data) { renderToggle((data.tried || []).indexOf(slug) !== -1); })
        .catch(function () { renderToggle(false); });
    })
    .catch(function () { /* if the list can't load, show nothing */ });

  function renderToggle(isTried) {
    var h1 = document.querySelector("h1");
    if (!h1) return;

    var label = document.createElement("label");
    label.className = "tried-toggle" + (isTried ? " is-tried" : "");
    var box = document.createElement("input");
    box.type = "checkbox";
    box.checked = isTried;
    var text = document.createElement("span");
    text.textContent = isTried ? "Tried it ✓" : "Tried it?";
    label.appendChild(box);
    label.appendChild(text);
    h1.insertAdjacentElement("afterend", label);

    box.addEventListener("change", function () {
      var want = box.checked;
      var pass = getPass();
      if (pass === null) { box.checked = !want; return; }   // cancelled prompt

      box.disabled = true;
      fetch("/api/tried", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug: slug, tried: want, passcode: pass }),
      })
        .then(function (r) {
          if (r.status === 401) {
            localStorage.removeItem(PASS_KEY);   // wrong code — forget it, ask again next time
            window.alert("That passcode didn't work — try again.");
            box.checked = !want;
            return null;
          }
          return r.json();
        })
        .then(function (data) {
          if (!data) return;
          var now = (data.tried || []).indexOf(slug) !== -1;
          box.checked = now;
          text.textContent = now ? "Tried it ✓" : "Tried it?";
          label.classList.toggle("is-tried", now);
        })
        .catch(function () {
          box.checked = !want;
          window.alert("Couldn't save just now — check your connection.");
        })
        .then(function () { box.disabled = false; });
    });
  }

  function getPass() {
    var p = localStorage.getItem(PASS_KEY);
    if (p) return p;
    p = window.prompt("Enter your passcode to update “tried it”:");
    if (p === null) return null;                 // cancelled
    p = p.trim();
    if (!p) return null;
    localStorage.setItem(PASS_KEY, p);
    return p;
  }
})();
