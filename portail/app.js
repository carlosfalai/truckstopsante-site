// Portail entreprise Truck Stop Santé — logique client. L'API est définie dans config.js (window.TSS_API).
(function () {
  var API = window.TSS_API || "";
  var KEY = "tss_portail";
  function session() { try { return JSON.parse(sessionStorage.getItem(KEY) || localStorage.getItem(KEY) || "null"); } catch (e) { return null; } }
  function saveSession(s, remember) { var v = JSON.stringify(s); sessionStorage.setItem(KEY, v); if (remember) localStorage.setItem(KEY, v); }
  function clearSession() { sessionStorage.removeItem(KEY); localStorage.removeItem(KEY); }
  function api(path, body, method) {
    var s = session();
    var opts = { method: method || (body ? "POST" : "GET"), headers: { "Content-Type": "application/json" } };
    var url = API + path;
    if (opts.method === "GET") url += (url.indexOf("?") > -1 ? "&" : "?") + "code=" + encodeURIComponent((s && s.code) || "");
    else opts.body = JSON.stringify(Object.assign({ code: (s && s.code) || "" }, body || {}));
    return fetch(url, opts).then(function (r) { return r.json().then(function (j) { j._status = r.status; return j; }); });
  }
  function requireSession() { var s = session(); if (!s || !s.code) { window.location.href = "index.html"; return null; } return s; }
  function fmtPhone(p) { var d = String(p || "").replace(/\D/g, ""); if (d.length === 11 && d[0] === "1") d = d.slice(1); return d.length === 10 ? d.slice(0, 3) + " " + d.slice(3, 6) + "-" + d.slice(6) : p; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function sinceLabel(m) { if (!m.created_at) return "–"; var d = new Date(m.created_at); var date = d.toLocaleDateString("fr-CA", { day: "numeric", month: "short", year: "numeric" }); return date + (m.months_covered ? " (" + m.months_covered + " mois)" : " (ce mois-ci)"); }
  function spruceTag(m) {
    if (m.status === "pause") return '<span class="tag grace">En pause (grâce 90 j)</span>';
    if (m.status === "retire") return '<span class="tag grace">Retiré</span>';
    if (m.spruce === "compte") return '<span class="tag ok">Actif sur Spruce</span>';
    if (m.spruce === "invite") return '<span class="tag wait">Invité, en attente</span>';
    return '<span class="tag wait">Invitation à envoyer</span>';
  }
  // Free-text parser: phones (SMS-able Canadian formats), emails, the rest is the name. (Subscription time is computed by us, never typed by the company.)
  function parseList(text) {
    var people = [];
    text.split(/\n|;/).map(function (s) { return s.trim(); }).filter(Boolean).forEach(function (line) {
      var email = (line.match(/[\w.+-]+@[\w-]+\.[\w.-]+/) || [""])[0];
      var phone = (line.match(/(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/) || [""])[0];
      var months = 0;
      var m = line.match(/(\d+)\s*(mois|ans?)/i);
      if (m) months = /an/i.test(m[2]) ? parseInt(m[1], 10) * 12 : parseInt(m[1], 10);
      if (/nouveau|nouvelle|new/i.test(line)) months = 0;
      var rest = line.replace(email, " ").replace(phone, " ").replace(/depuis|since|nouveau|nouvelle|new|\d+\s*(mois|ans?)/gi, " ").replace(/[,()\t]/g, " ").replace(/\s+/g, " ").trim();
      var parts = rest.split(" ").filter(Boolean);
      var given = parts.shift() || "";
      var family = parts.join(" ");
      if (given || phone || email) people.push({ first_name: given, last_name: family, phone: fmtPhone(phone), email: email });
    });
    return people;
  }
  window.TSS = { API: API, session: session, saveSession: saveSession, clearSession: clearSession, api: api, requireSession: requireSession, fmtPhone: fmtPhone, esc: esc, sinceLabel: sinceLabel, spruceTag: spruceTag, parseList: parseList };
})();
