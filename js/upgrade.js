/* FindIt upgrade layer — loads after app.js and only enhances it (delete this file + upgrade.css to roll back). */
(function () {
  "use strict";
  const PAGE = 9;
  let limit = PAGE, savedOnly = false, deepLinked = false, busy = false, savedBtn = null;
  const grid = document.querySelector("#items");
  if (!grid) return;
  const $q = (s) => document.querySelector(s);

  /* ---------- saved items (this device only) ---------- */
  function getSaved() { try { const v = JSON.parse(localStorage.getItem("finditSaved") || "[]"); return Array.isArray(v) ? v : []; } catch (e) { return []; } }
  function setSaved(list) { try { localStorage.setItem("finditSaved", JSON.stringify(list)); } catch (e) { /* storage blocked */ } }

  /* ---------- toast that hides itself ---------- */
  if (typeof notify === "function") {
    const baseNotify = notify; let t;
    notify = function (message) { baseNotify(message); clearTimeout(t); t = setTimeout(() => { try { clearNotice(); } catch (e) {} }, 4500); };
  }

  function timeAgo(iso) {
    const s = Math.max(1, (Date.now() - new Date(iso)) / 1000);
    const units = [["y", 31536000], ["mo", 2592000], ["d", 86400], ["h", 3600], ["m", 60]];
    for (const [u, n] of units) if (s >= n) return Math.floor(s / n) + u + " ago";
    return "just now";
  }

  function skeletons() {
    return Array.from({ length: 6 }, () => '<div class="skeleton-card" aria-hidden="true"><div class="sk img"></div><div class="sk l1"></div><div class="sk l2"></div><div class="sk l3"></div></div>').join("");
  }

  function copyLink(id) {
    const url = location.origin + location.pathname + "?item=" + encodeURIComponent(id);
    const done = () => notify("Link copied. Share it with your classmates!");
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(url).then(done, () => window.prompt("Copy this link:", url));
    else window.prompt("Copy this link:", url);
  }

  /* ---------- filter summary chips ---------- */
  function filterBar() {
    let bar = $q("#filterBar");
    if (!bar) { bar = document.createElement("div"); bar.id = "filterBar"; bar.className = "filter-bar"; grid.parentNode.insertBefore(bar, grid); }
    const chips = [];
    if (filter !== "All") chips.push(filter === "lost" ? "Lost items" : "Found items");
    if (categoryFilter !== "All") chips.push(categoryFilter);
    if ($q("#search")?.value.trim()) chips.push("“" + $q("#search").value.trim() + "”");
    if ($q("#dateFilter")?.value) chips.push($q("#dateFilter").value);
    if ($q("#buildingFilter")?.value.trim()) chips.push($q("#buildingFilter").value.trim());
    if (savedOnly) chips.push("♡ Saved");
    bar.innerHTML = chips.length ? chips.map((c) => '<span class="chip"></span>').join("") + '<button type="button" class="chip-clear">Clear all</button>' : "";
    bar.querySelectorAll(".chip").forEach((el, i) => { el.textContent = chips[i]; });
    bar.querySelector(".chip-clear")?.addEventListener("click", clearAll);
  }
  function clearAll() {
    $q("#search").value = ""; filter = "All"; categoryFilter = "All"; savedOnly = false; limit = PAGE;
    ["#dateFilter", "#buildingFilter"].forEach((s) => { if ($q(s)) $q(s).value = ""; });
    if ($q("#categoryFilter")) $q("#categoryFilter").value = "All";
    document.querySelectorAll(".filter").forEach((b) => b.classList.toggle("active", b.dataset.filter === "All"));
    syncSavedBtn(); render();
  }

  /* ---------- the main enhancer (idempotent) ---------- */
  function enhance() {
    if (busy) return; busy = true;
    try {
      if (grid.querySelector(".loading, .loading-state")) { grid.innerHTML = skeletons(); return; }
      if (grid.querySelector(".skeleton-card")) return;
      const saved = getSaved();
      const cards = Array.from(grid.querySelectorAll(".card"));
      cards.forEach((card) => {
        const id = card.querySelector("[data-view]")?.dataset.view; if (!id) return;
        card.dataset.id = id;
        if (!card.querySelector(".card-tools")) {
          const tools = document.createElement("div"); tools.className = "card-tools";
          tools.innerHTML = '<button type="button" class="share-btn" aria-label="Copy link to this listing" title="Copy link">↗</button><button type="button" class="save-btn" aria-label="Save listing" title="Save"></button>';
          card.appendChild(tools);
          const item = allItems.find((i) => i.id === id);
          const meta = card.querySelector(".meta");
          if (item && meta) { const age = document.createElement("span"); age.className = "age"; age.textContent = timeAgo(item.created_at); meta.appendChild(age); }
          if (item?.status === "claimed") { const pill = document.createElement("span"); pill.className = "status-pill"; pill.textContent = "CLAIM IN PROGRESS"; card.querySelector(".visual")?.appendChild(pill); }
        }
        const on = saved.includes(id), btn = card.querySelector(".save-btn");
        btn.classList.toggle("on", on); btn.textContent = on ? "♥" : "♡"; btn.setAttribute("aria-pressed", on);
      });
      const pool = savedOnly ? cards.filter((c) => saved.includes(c.dataset.id)) : cards;
      cards.forEach((c) => { c.hidden = true; });
      pool.slice(0, limit).forEach((c) => { c.hidden = false; });

      let soft = $q("#softEmpty");
      if (!soft) { soft = document.createElement("div"); soft.id = "softEmpty"; grid.after(soft); }
      soft.innerHTML = savedOnly && !pool.length ? '<div class="soft-empty"><b>Nothing saved yet</b>Tap the ♡ on any listing to keep it here.</div>' : "";

      let wrap = $q("#loadMoreWrap");
      if (!wrap) { wrap = document.createElement("div"); wrap.id = "loadMoreWrap"; wrap.className = "load-more-wrap"; grid.after(wrap); }
      const remaining = pool.length - limit;
      wrap.innerHTML = remaining > 0 ? '<button type="button" class="load-more">Show ' + Math.min(PAGE, remaining) + " more · " + remaining + " left</button>" : "";
      wrap.querySelector(".load-more")?.addEventListener("click", () => { limit += PAGE; enhance(); });

      if (cards.length && $q("#count")) $q("#count").textContent = Math.min(limit, pool.length) + " OF " + pool.length + " ITEMS";
      syncSavedBtn(); filterBar();

      if (!deepLinked && cards.length) {
        deepLinked = true;
        const id = new URLSearchParams(location.search).get("item");
        if (id && typeof openItemDetails === "function") setTimeout(() => openItemDetails(id), 250);
      }
    } finally { busy = false; }
  }
  new MutationObserver(() => enhance()).observe(grid, { childList: true });
  enhance();

  /* card buttons (event delegation survives re-renders) */
  grid.addEventListener("click", (e) => {
    const share = e.target.closest(".share-btn"), save = e.target.closest(".save-btn");
    if (share) { e.stopPropagation(); copyLink(share.closest(".card").dataset.id); }
    if (save) {
      e.stopPropagation();
      const id = save.closest(".card").dataset.id, list = getSaved(), i = list.indexOf(id);
      if (i >= 0) list.splice(i, 1); else list.push(id);
      setSaved(list); notify(i >= 0 ? "Removed from saved." : "Saved to this device."); enhance();
    }
  });

  /* ---------- Saved filter button ---------- */
  const group = $q(".filter-group");
  if (group) {
    savedBtn = document.createElement("button");
    savedBtn.type = "button"; savedBtn.className = "saved-filter";
    group.after(savedBtn);
    savedBtn.addEventListener("click", () => { savedOnly = !savedOnly; limit = PAGE; enhance(); });
  }
  function syncSavedBtn() {
    if (!savedBtn) return;
    savedBtn.classList.toggle("active", savedOnly);
    savedBtn.innerHTML = '♡ Saved listings <span class="n">' + getSaved().length + "</span>";
    document.querySelectorAll(".mobile-bar .saved").forEach((b) => b.classList.toggle("on", savedOnly));
  }
  /* any other filter change resets paging */
  document.querySelectorAll(".filter").forEach((b) => b.addEventListener("click", () => { limit = PAGE; savedOnly = false; setTimeout(enhance, 0); }));
  ["#search", "#dateFilter", "#buildingFilter", "#categoryFilter", "#sortOrder"].forEach((s) => {
    $q(s)?.addEventListener("input", () => { limit = PAGE; setTimeout(enhance, 0); });
    $q(s)?.addEventListener("change", () => { limit = PAGE; setTimeout(enhance, 0); });
  });

  /* ---------- stats count-up ---------- */
  ["#statTotal", "#statLost", "#statFound", "#statReturned"].forEach((s) => {
    const el = $q(s); if (!el) return;
    new MutationObserver(() => {
      if (el._anim) return;
      const end = Number(el.textContent); if (!Number.isFinite(end) || end <= 0 || el.dataset.done === String(end)) return;
      el.dataset.done = String(end); el._anim = true;
      const start = performance.now(), dur = 900;
      (function tick(now) {
        const p = Math.min(1, (now - start) / dur);
        el.textContent = Math.round(end * (1 - Math.pow(1 - p, 3)));
        if (p < 1) requestAnimationFrame(tick); else setTimeout(() => { el._anim = false; }, 50);
      })(start);
    }).observe(el, { childList: true, characterData: true, subtree: true });
  });

  /* ---------- header shadow, back-to-top, keyboard ---------- */
  const header = $q(".site-header");
  const top = document.createElement("button");
  top.className = "to-top"; top.type = "button"; top.setAttribute("aria-label", "Back to top"); top.textContent = "↑";
  top.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
  document.body.appendChild(top);
  window.addEventListener("scroll", () => { header?.classList.toggle("scrolled", scrollY > 8); top.classList.toggle("show", scrollY > 700); }, { passive: true });
  document.addEventListener("keydown", (e) => {
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || "");
    if (e.key === "/" && !typing && !document.querySelector("dialog[open]")) { e.preventDefault(); $q("#search")?.focus(); $q("#browse")?.scrollIntoView({ behavior: "smooth" }); }
    if (e.key === "Escape" && document.activeElement === $q("#search")) document.activeElement.blur();
  });

  /* ---------- mobile bottom bar ---------- */
  const bar = document.createElement("nav");
  bar.className = "mobile-bar"; bar.setAttribute("aria-label", "Quick navigation");
  bar.innerHTML = '<button type="button" data-a="home"><span>⌂</span>Home</button><button type="button" data-a="browse"><span>⌕</span>Browse</button><button type="button" class="main" data-a="post" aria-label="Post an item"><span>＋</span>Post</button><button type="button" class="saved" data-a="saved"><span>♡</span>Saved</button><button type="button" data-a="me"><span>☺</span>Me</button>';
  bar.addEventListener("click", (e) => {
    const a = e.target.closest("button")?.dataset.a;
    if (a === "home") window.scrollTo({ top: 0, behavior: "smooth" });
    if (a === "browse") $q("#browse")?.scrollIntoView({ behavior: "smooth" });
    if (a === "post") $q("#post")?.click();
    if (a === "saved") { savedOnly = !savedOnly; limit = PAGE; enhance(); $q("#browse")?.scrollIntoView({ behavior: "smooth" }); }
    if (a === "me") { const acc = $q("#account"); (acc && !acc.hidden ? acc : $q("#login"))?.click(); }
  });
  document.body.appendChild(bar);

  /* ---------- post form polish ---------- */
  const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const dateInput = $q("#itemDate");
  if (dateInput) { dateInput.max = today; if (!dateInput.value) dateInput.value = today; }
  const desc = $q("#itemDescription");
  if (desc) {
    const c = document.createElement("span"); c.className = "counter"; desc.after(c);
    const upd = () => { c.textContent = desc.value.length + " / " + desc.maxLength; };
    desc.addEventListener("input", upd); upd();
    $q("#postForm")?.addEventListener("reset", () => setTimeout(upd, 0));
  }
  const photos = $q("#itemPhoto");
  photos?.addEventListener("change", () => {
    const files = Array.from(photos.files || []);
    if (files.length > 5) notify("Only the first 5 photos will be shown.");
    if (files.some((f) => f.size > 5242880)) notify("One or more photos are over 5 MB and will be rejected.");
  });
})();
