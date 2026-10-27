// In-page links (Request a visit, See how he works) scroll smoothly and move focus to the section heading.
(function () {
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function goTo(target) {
    target.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    var heading = target.querySelector("h2[tabindex]");
    if (heading) heading.focus({ preventScroll: true });
  }

  document.querySelectorAll('a[href^="#"]').forEach(function (link) {
    var id = link.getAttribute("href").slice(1);
    var target = id && document.getElementById(id);
    if (!target) return;
    link.addEventListener("click", function (e) {
      e.preventDefault();
      goTo(target);
      if (history.replaceState) history.replaceState(null, "", id === "top" ? location.pathname : "#" + id);
    });
  });
})();
