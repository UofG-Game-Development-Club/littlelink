/*
  Counts page views and button clicks for the stats page at /stats.
  No cookies, nothing personal: just which button, where the visitor came from,
  and the country/device Cloudflare already knows.

  Add ?src=insta (or ?src=qr, ?src=discord ...) to a shared link to see where
  visitors came from. It's removed from the address bar after the page loads.
  To give a button a fixed name in the stats, add data-track="name" to it.
*/
(function () {
  var params = new URLSearchParams(location.search);
  var src = params.get("src") || params.get("utm_source") || "";
  try {
    if (src) sessionStorage.setItem("gg_src", src);
    else src = sessionStorage.getItem("gg_src") || "";
  } catch (e) {}

  if (params.has("src") || params.has("utm_source")) {
    ["src", "utm_source", "utm_medium", "utm_campaign"].forEach(function (k) { params.delete(k); });
    var rest = params.toString();
    history.replaceState(null, "", location.pathname + (rest ? "?" + rest : "") + location.hash);
  }

  var ref = document.referrer;

  function send(data) {
    data.src = src;
    data.ref = ref;
    var body = JSON.stringify(data);
    if (navigator.sendBeacon && navigator.sendBeacon("/api/hit", body)) return;
    fetch("/api/hit", { method: "POST", body: body, keepalive: true }).catch(function () {});
  }

  send({ t: "view" });

  document.querySelectorAll(".button-stack a.button").forEach(function (a) {
    function clicked(e) {
      if (e.type === "auxclick" && e.button !== 1) return; // middle click opens a tab too
      send({ t: "click", label: a.getAttribute("data-track") || a.textContent, href: a.href });
    }
    a.addEventListener("click", clicked);
    a.addEventListener("auxclick", clicked);
  });
})();
