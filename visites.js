// Compteur de visites de truckstopsante.com, respectueux de la vie privée.
// Envoie seulement le chemin de la page et un drapeau "nouvelle visite" (première page de la session de navigation).
// Aucun témoin (cookie), aucune adresse IP conservée, aucun identifiant, aucun suivi entre sites. Les pages d'administration ne comptent pas.
(function () {
  try {
    if (/^\/(cmf|portail\/admin)/.test(location.pathname)) return;
    if (navigator.webdriver) return; // robots et outils d'automatisation
    var nouveau = false;
    try { if (!sessionStorage.getItem("tss_visite")) { sessionStorage.setItem("tss_visite", "1"); nouveau = true; } } catch (e) { nouveau = true; }
    var page = location.pathname.replace(/\/index\.html$/, "/");
    var body = JSON.stringify({ page: page, nouveau: nouveau });
    var url = "https://o8x62faccj.execute-api.ca-central-1.amazonaws.com/hit";
    if (navigator.sendBeacon) { navigator.sendBeacon(url, new Blob([body], { type: "application/json" })); }
    else { fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body, keepalive: true }).catch(function () {}); }
  } catch (e) {}
})();
