/* Wally's personal "tried it" tracker.
 * Injected by the Worker onto recipe pages.
 *   - Recipe detail page: shows a "Tried it" toggle under the title.
 *   - Recipes index: puts a ✓ next to recipes already tried.
 * Anyone can SEE the marks (read is public); changing one requires the passcode,
 * which is asked once per device and then remembered in the browser.
 */
(function () {
  var PASS_KEY = "wally-tried-passcode";
  var path = location.pathname.replace(/\/+$/, "");
  if (path === "") path = "/";

  var detail = path.match(/^\/recipes\/([a-z0-9-]+)(?:\.html)?$/);
  var slug = detail ? detail[1] : null;
  var isIndex = path === "/recipes" || path === "/recipes.html";
  if (!slug && !isIndex) return;

  fetch("/api/tried")
    .then(function (r) { return r.json(); })
    .then(function (data) {
      var tried = (data && data.tried) || [];
      if (slug) renderToggle(tried.indexOf(slug) !== -1);
      else markIndex(tried);
    })
    .catch(function () { /* offline or error — just show no marks */ });

  /* ---- Recipe detail: the toggle ---- */
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

  /* ---- Index: mark the recipes already tried ---- */
  function markIndex(tried) {
    if (!tried.length) return;
    var set = {};
    tried.forEach(function (s) { set[s] = true; });
    var links = document.querySelectorAll('.recipe-links a[href^="/recipes/"]');
    Array.prototype.forEach.call(links, function (a) {
      var m = a.getAttribute("href").match(/^\/recipes\/([a-z0-9-]+)$/);
      if (m && set[m[1]] && !a.querySelector(".tried-check")) {
        var mark = document.createElement("span");
        mark.className = "tried-check";
        mark.textContent = "✓";
        a.appendChild(mark);
      }
    });
  }
})();
