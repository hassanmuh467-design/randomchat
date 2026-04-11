// M & G age gate — blocking 18+ modal. Persists choice via localStorage.
(function () {
  "use strict";

  var STORAGE_KEY = "randomchat_age_ok";

  try {
    if (window.localStorage && localStorage.getItem(STORAGE_KEY) === "1") {
      return;
    }
  } catch (e) {
    // localStorage unavailable — still show the gate
  }

  function init() {
    // Prevent double-injection
    if (document.getElementById("ag-backdrop")) return;

    var backdrop = document.createElement("div");
    backdrop.id = "ag-backdrop";
    backdrop.className = "ag-backdrop";
    backdrop.setAttribute("role", "dialog");
    backdrop.setAttribute("aria-modal", "true");
    backdrop.setAttribute("aria-labelledby", "ag-title");
    backdrop.setAttribute("aria-describedby", "ag-body");

    var card = document.createElement("div");
    card.className = "ag-card";

    var title = document.createElement("h2");
    title.id = "ag-title";
    title.className = "ag-title";
    title.textContent = "You must be 18+";

    var body = document.createElement("p");
    body.id = "ag-body";
    body.className = "ag-body";
    body.textContent =
      "M & G is an adults-only space. By continuing, you confirm you are at least 18 years old and agree to be kind. Harassment, nudity involving minors, and illegal content are strictly prohibited and reported to authorities.";

    var actions = document.createElement("div");
    actions.className = "ag-actions";

    var btnYes = document.createElement("button");
    btnYes.type = "button";
    btnYes.className = "ag-btn ag-btn-primary";
    btnYes.textContent = "I'm 18+ — Continue";

    var btnNo = document.createElement("button");
    btnNo.type = "button";
    btnNo.className = "ag-btn ag-btn-ghost";
    btnNo.textContent = "I'm under 18";

    actions.appendChild(btnYes);
    actions.appendChild(btnNo);

    var footer = document.createElement("div");
    footer.className = "ag-footer";

    var termsLink = document.createElement("a");
    termsLink.href = "/legal/terms.html";
    termsLink.target = "_blank";
    termsLink.rel = "noopener";
    termsLink.textContent = "Terms";

    var privacyLink = document.createElement("a");
    privacyLink.href = "/legal/privacy.html";
    privacyLink.target = "_blank";
    privacyLink.rel = "noopener";
    privacyLink.textContent = "Privacy";

    footer.appendChild(termsLink);
    footer.appendChild(privacyLink);

    card.appendChild(title);
    card.appendChild(body);
    card.appendChild(actions);
    card.appendChild(footer);
    backdrop.appendChild(card);

    // Block interaction with page behind
    var prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    document.body.appendChild(backdrop);

    // Focus trap
    var focusables = [btnYes, btnNo, termsLink, privacyLink];
    var firstFocusable = focusables[0];
    var lastFocusable = focusables[focusables.length - 1];

    // Focus primary on open
    setTimeout(function () { btnYes.focus(); }, 0);

    function onKeydown(e) {
      // Block ESC (must actively choose)
      if (e.key === "Escape" || e.keyCode === 27) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (e.key === "Tab" || e.keyCode === 9) {
        // Trap focus inside modal
        var active = document.activeElement;
        if (e.shiftKey) {
          if (active === firstFocusable || !backdrop.contains(active)) {
            e.preventDefault();
            lastFocusable.focus();
          }
        } else {
          if (active === lastFocusable || !backdrop.contains(active)) {
            e.preventDefault();
            firstFocusable.focus();
          }
        }
      }
    }
    document.addEventListener("keydown", onKeydown, true);

    // Block backdrop click from doing anything (must actively choose)
    backdrop.addEventListener("click", function (e) {
      if (e.target === backdrop) {
        e.preventDefault();
        e.stopPropagation();
      }
    });

    btnYes.addEventListener("click", function () {
      try { localStorage.setItem(STORAGE_KEY, "1"); } catch (e) {}
      document.removeEventListener("keydown", onKeydown, true);
      document.body.style.overflow = prevOverflow;
      if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
    });

    btnNo.addEventListener("click", function () {
      window.location.href = "https://www.google.com";
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
