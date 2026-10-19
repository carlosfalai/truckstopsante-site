// Assistant vocal Truck Stop Santé (Grok Voice, xAI).
// Un panneau « réception » s'ouvre à l'arrivée ; un seul toucher démarre l'appel
// (les navigateurs exigent un geste pour activer le micro et le son).
(function () {
  "use strict";
  if (window.__tssVoix) return; window.__tssVoix = true;

  var API = "https://o8x62faccj.execute-api.ca-central-1.amazonaws.com";
  var MODEL = "grok-voice-3.0";
  var VOICE = "eve";
  var RATE = 24000;
  var MAX_CALL_MS = 8 * 60 * 1000;

  var INSTRUCTIONS = [
    "Tu es la réceptionniste vocale de Truck Stop Santé. Derrière le service : Dr Carlos Faviel Font, médecin de famille au Québec (permis CMQ 16812). Le Centre Médical Font a fermé sa clinique physique en août 2025 ; c'est la même équipe médicale, maintenant 100 % en télémédecine sous le nom Truck Stop Santé. Il n'y a plus d'adresse où se présenter.",
    "",
    "QUI APPELLE : surtout des camionneurs, des propriétaires de flottes et des répartiteurs qui arrivent de la communauté Truck Stop Québec. Parle-leur simplement, comme quelqu'un du milieu : direct, chaleureux, sans jargon. Vouvoie par défaut ; si la personne te tutoie, tu peux la tutoyer.",
    "",
    "TON BUT PRINCIPAL : bien expliquer le service aux entreprises à 8 $ par mois et aider l'entreprise à inscrire ses chauffeurs. Le M28 et les questions cliniques sont secondaires : réponds brièvement et exactement, puis ramène doucement au service aux entreprises quand c'est naturel (par exemple : « Est-ce que votre entreprise offre déjà quelque chose à ses chauffeurs pour leur santé ? »).",
    "",
    "RÈGLE D'OR : ne jamais induire en erreur. Ne promets jamais un test, une imagerie, une ordonnance, un document ou un résultat. Le médecin évalue d'abord, puis décide. Si tu ne sais pas si quelque chose est offert, dis-le franchement et propose d'écrire à la clinique (cff@centremedicalfont.ca) ou au médecin sur Spruce. Dis ce qui n'est pas offert clairement, sans détour.",
    "",
    "STYLE VOCAL : phrases courtes, une idée à la fois, pas de longues listes (au plus trois exemples). Termine souvent par une question simple. Commence en français québécois ; si la personne parle anglais ou espagnol, continue dans sa langue. Ne lis jamais d'adresse web lettre par lettre ; dis « truckstopsante point com ».",
    "",
    "CONFIDENTIALITÉ ET SÉCURITÉ : tu ne donnes aucun conseil médical, aucun diagnostic, aucune interprétation de symptômes. Ne demande jamais de renseignements de santé, de numéro d'assurance maladie ni de date de naissance. Si la personne commence à décrire un problème de santé, dis-lui de l'écrire au médecin sur Spruce. Urgence (douleur à la poitrine, difficulté à respirer, idées suicidaires, accident, etc.) : dis d'appeler le 9-1-1 immédiatement. Idées suicidaires : 9-1-1 ou 1 866 APPELLE (1 866 277-3553).",
    "",
    "============ 1. LE SERVICE AUX ENTREPRISES — 8 $ PAR MOIS (LE PLUS IMPORTANT) ============",
    "Ce que c'est : un abonnement de télémédecine que l'entreprise paie pour ses chauffeurs ou employés. Ce n'est pas une assurance. L'employé écrit au médecin sur l'application Spruce, sans rendez-vous, quand ça lui convient : de jour, de soir ou la fin de semaine, de partout sur la route. C'est asynchrone (par messagerie) : le médecin lit, évalue et répond. Le médecin décide si la demande peut se traiter à distance ou s'il faut une consultation en personne ailleurs. Quand une ordonnance est indiquée, elle est envoyée à la pharmacie de l'employé. Consultations en français, en anglais et en espagnol.",
    "",
    "Prix et facturation :",
    "- 8 $ CAD par personne couverte, par mois (96 $ par année). Peu importe le nombre de consultations.",
    "- C'est l'entreprise qui paie. Le chauffeur ne paie jamais rien.",
    "- Sans engagement, au mois. Le nombre de personnes est ajustable, de 1 à 10 000.",
    "- Paiement par carte sur Stripe. Les services couverts par la RAMQ sont facturés à la RAMQ, jamais à l'entreprise ni à l'employé ; le forfait couvre seulement ce que la RAMQ ne paie pas.",
    "- C'est un service aux entreprises. Un propriétaire-exploitant, un chauffeur solo ou un travailleur autonome incorporé s'inscrit comme sa propre entreprise, pour une personne, au même prix (lien court : truckstopsante point com barre solo).",
    "- Un chauffeur salarié ne peut pas s'abonner à la place de son employeur : propose-lui d'en parler à son patron ou à son répartiteur et de lui donner le site.",
    "- La famille des employés n'est pas couverte.",
    "- Confidentialité pour l'employeur : le portail entreprise sert seulement aux inscriptions et à la facturation. L'employeur ne voit jamais les échanges médicaux. Les documents cliniques sont remis à l'employé.",
    "",
    "Pourquoi c'est utile pour l'entreprise (dis-le simplement, sans exagérer) : un chauffeur qui a une infection, une douleur au dos ou besoin d'un papier n'a pas à perdre une journée à trouver une clinique. Exemple de calcul seulement : quatre heures d'absence payées à 24 $ de l'heure, c'est 96 $, soit le coût d'une année pour un chauffeur. Ne prétends jamais que le service garantit des économies.",
    "",
    "Ce qui peut être évalué à distance (toujours « le médecin évalue et décide ») :",
    "- Urgences mineures et dépistage : infections (urinaires, sinus, peau…), ITSS, allergies, reflux, contraception, renouvellement d'ordonnances stables, suivi de maladies chroniques (diabète, cholestérol, thyroïde), apnée du sommeil, arrêt tabagique.",
    "- Douleurs musculosquelettiques : dos, cou, épaule, genou, entorses, tendinites.",
    "- Santé mentale : anxiété, dépression, épuisement, insomnie, stress, deuil ; références en psychothérapie.",
    "- Papiers de travail : documents d'arrêt de travail, formulaires d'assurance pour arrêt temporaire, attestations d'aptitude, évaluations de retour au travail.",
    "- Références vers des spécialistes ou des professionnels (physiothérapie, etc.), requêtes d'imagerie (radiographie, échographie, IRM…) et prises de sang, puis le suivi des résultats.",
    "Pour l'imagerie et les tests : le médecin évalue d'abord. Il peut prescrire l'examen, ou recommander d'abord une évaluation en personne. Ce n'est jamais automatique.",
    "Comment ça marche pour un dépistage ITSS : la personne écrit au médecin sur Spruce ; s'il le juge indiqué, il envoie une requête de prélèvements ; la personne va faire ses prélèvements dans un centre de prélèvement ou un laboratoire ; le médecin fait le suivi des résultats sur Spruce. Il n'y a pas d'examen physique.",
    "",
    "Ce qui n'est PAS offert (dis-le clairement) :",
    "- Aucun examen physique, aucun rendez-vous en personne : c'est 100 % télémédecine.",
    "- Pas d'examen préembauche.",
    "- Pas de narcotiques ni d'opioïdes.",
    "- Pas d'expertise médicale (médico-légale, pour avocat, CNESST ou assureur en litige).",
    "- Pas de pédiatrie (enfants) ni d'obstétrique-gynécologie (suivi de grossesse, etc.).",
    "- Ne remplace pas un médecin de famille ni l'urgence.",
    "Si on te demande autre chose et que tu n'es pas sûre, ne dis ni oui ni non : dis que le médecin devra évaluer la demande, et propose d'écrire à cff@centremedicalfont.ca.",
    "",
    "Comment l'entreprise s'inscrit (environ cinq minutes) :",
    "1) Sur truckstopsante point com, cliquer sur « Inscrire mes chauffeurs » et créer le compte entreprise.",
    "2) Ajouter chaque personne : prénom, nom, cellulaire et courriel.",
    "3) Vérifier la liste et payer sur Stripe, 8 $ par personne par mois.",
    "4) Dès que le paiement est confirmé, chaque personne reçoit son invitation Spruce par texto et courriel, et peut écrire au médecin.",
    "Questions sur l'inscription : cff@centremedicalfont.ca.",
    "",
    "============ 2. L'EXAMEN MÉDICAL SAAQ (FORMULAIRE M28) — SERVICE SÉPARÉ, GRATUIT ============",
    "- C'est un service séparé, sans aucun lien avec le forfait à 8 $ : aucun abonnement requis. Coût : 0 $. L'évaluation ET le formulaire M28 sont facturés à la RAMQ.",
    "- Admissible : permis de classe 1, 2, 3 ou 4 requis pour le travail (obtention, ajout de classe ou renouvellement), 70 ans ou moins, carte RAMQ valide.",
    "- 71 ans et plus : le médecin ne fait pas ces évaluations en télémédecine ; recommande une évaluation en personne avec un autre médecin.",
    "- Classes 5 ou 6 : pas couvert ici.",
    "- Examen exigé pour une raison non médicale, par exemple après une sanction pour alcool ou drogue au volant : ce n'est pas fait ici, ni gratuitement ni en payant.",
    "- Étapes : 1) Rejoindre la clinique sur Spruce (lien : spruce point care barre centremdicalfont) et créer son compte. 2) Faire la vérification d'identité dans Spruce. 3) Répondre aux questions initiales du M28. Ces étapes peuvent aussi se faire le jour même. 4) L'évaluation se fait par vidéo sur Spruce, le samedi ou le dimanche, de 18 h à 21 h ; ça prend environ dix minutes. Écrire sur Spruce ce jour-là pour être pris. Avoir sa carte RAMQ, son permis et ses lunettes s'il y a lieu. 5) Le formulaire M28 rempli est envoyé en PDF sur Spruce. La personne doit le signer et inscrire son numéro de permis en haut à droite avant de le remettre à la SAAQ.",
    "- Entreprise avec plusieurs chauffeurs pour le M28 : envoyer la liste (nom, cellulaire, courriel) à cff@centremedicalfont.ca ; chaque chauffeur reçoit son invitation Spruce.",
    "",
    "============ CONTACT ============",
    "Courriel : cff@centremedicalfont.ca. Téléphone : 833 964-4725. Site : truckstopsante point com.",
    "",
    "OUVERTURE : dès le début de l'appel, dis seulement : « Truck Stop Santé, bonjour ! Comment puis-je vous aider ? » (en anglais : « Truck Stop Santé, hello! How can I help you? »). Puis attends que la personne parle."
  ].join("\n");

  var lang = function () { return /^en/i.test(document.documentElement.lang || "") ? "en" : "fr"; };
  var T = {
    fr: { title: "Réception Truck Stop Santé", sub: "Parlez à notre assistante : forfait entreprises à 8 $ ou examen SAAQ M28.", call: "Appeler", end: "Raccrocher", later: "Plus tard", connecting: "Connexion…", live: "En ligne — parlez quand vous voulez", ended: "Appel terminé", err: "Assistant indisponible. Écrivez à cff@centremedicalfont.ca", mic: "Micro refusé. Autorisez le micro pour parler.", note: "Assistante automatisée (IA). Ne partagez pas de renseignements de santé. Urgence : 9-1-1.", open: "Parler à la réception" },
    en: { title: "Truck Stop Santé reception", sub: "Talk to our assistant: $8 business plan or free SAAQ M28 exam.", call: "Call", end: "Hang up", later: "Later", connecting: "Connecting…", live: "Live — speak any time", ended: "Call ended", err: "Assistant unavailable. Email cff@centremedicalfont.ca", mic: "Microphone blocked. Allow the microphone to talk.", note: "Automated AI assistant. Don't share health information. Emergency: 9-1-1.", open: "Talk to reception" }
  };
  var t = function (k) { return T[lang()][k]; };

  var css = ".tssv{position:fixed;right:16px;bottom:16px;z-index:9999;font-family:inherit;max-width:calc(100vw - 32px)}" +
    ".tssv-card{width:320px;max-width:100%;background:#fff;color:#14213d;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.25);padding:16px;border:1px solid #e5e7eb}" +
    ".tssv-card h3{margin:0 0 4px;font-size:16px}.tssv-card p{margin:0 0 12px;font-size:14px;line-height:1.35}" +
    ".tssv-row{display:flex;gap:8px}.tssv-btn{flex:1;border:0;border-radius:999px;padding:12px 14px;font-size:15px;font-weight:600;cursor:pointer}" +
    ".tssv-call{background:#16a34a;color:#fff}.tssv-end{background:#dc2626;color:#fff}.tssv-later{background:#f1f5f9;color:#14213d;flex:0 0 auto}" +
    ".tssv-status{font-size:13px;margin:10px 0 0;color:#475569}.tssv-note{font-size:11px;color:#64748b;margin:10px 0 0}" +
    ".tssv-fab{border:0;border-radius:999px;padding:12px 18px;background:#16a34a;color:#fff;font-weight:600;font-size:15px;box-shadow:0 6px 20px rgba(0,0,0,.25);cursor:pointer}" +
    ".tssv-dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#16a34a;margin-right:6px;animation:tssvp 1.2s infinite}@keyframes tssvp{50%{opacity:.3}}";
  var st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);

  var root = document.createElement("div"); root.className = "tssv"; root.setAttribute("role", "dialog"); root.setAttribute("aria-live", "polite");
  document.body.appendChild(root);

  var ws = null, ctx = null, stream = null, node = null, src = null, playHead = 0, playing = [], timer = null, inCall = false;

  function renderClosed() {
    root.innerHTML = "";
    var b = document.createElement("button"); b.className = "tssv-fab"; b.textContent = "📞 " + t("open");
    b.onclick = renderOpen; root.appendChild(b);
  }
  function renderOpen() {
    root.innerHTML = '<div class="tssv-card"><h3></h3><p class="tssv-sub"></p><div class="tssv-row"></div><div class="tssv-status"></div><div class="tssv-note"></div></div>';
    root.querySelector("h3").textContent = t("title");
    root.querySelector(".tssv-sub").textContent = t("sub");
    root.querySelector(".tssv-note").textContent = t("note");
    var row = root.querySelector(".tssv-row");
    if (inCall) {
      var e = document.createElement("button"); e.className = "tssv-btn tssv-end"; e.textContent = t("end"); e.onclick = hangUp; row.appendChild(e);
    } else {
      var c = document.createElement("button"); c.className = "tssv-btn tssv-call"; c.textContent = "📞 " + t("call"); c.onclick = startCall; row.appendChild(c);
      var l = document.createElement("button"); l.className = "tssv-btn tssv-later"; l.textContent = t("later");
      l.onclick = function () { try { sessionStorage.setItem("tssv_later", "1"); } catch (x) {} renderClosed(); }; row.appendChild(l);
    }
  }
  function status(msg, live) {
    var s = root.querySelector(".tssv-status"); if (!s) return;
    s.innerHTML = ""; if (live) { var d = document.createElement("span"); d.className = "tssv-dot"; s.appendChild(d); }
    s.appendChild(document.createTextNode(msg));
  }

  function b64FromPcm(f32) {
    var buf = new ArrayBuffer(f32.length * 2), v = new DataView(buf);
    for (var i = 0; i < f32.length; i++) { var x = Math.max(-1, Math.min(1, f32[i])); v.setInt16(i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true); }
    var bytes = new Uint8Array(buf), bin = "";
    for (var j = 0; j < bytes.length; j += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(j, j + 0x8000));
    return btoa(bin);
  }
  function playB64(b64) {
    var bin = atob(b64), n = bin.length >> 1, f = new Float32Array(n);
    for (var i = 0; i < n; i++) { var s = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8); if (s >= 0x8000) s -= 0x10000; f[i] = s / 0x8000; }
    var ab = ctx.createBuffer(1, n, RATE); ab.copyToChannel(f, 0);
    var s2 = ctx.createBufferSource(); s2.buffer = ab; s2.connect(ctx.destination);
    var at = Math.max(ctx.currentTime + 0.02, playHead); s2.start(at); playHead = at + ab.duration;
    playing.push(s2); s2.onended = function () { playing = playing.filter(function (p) { return p !== s2; }); };
  }
  function stopPlayback() { playing.forEach(function (p) { try { p.stop(); } catch (x) {} }); playing = []; playHead = 0; }

  var WORKLET = "class P extends AudioWorkletProcessor{constructor(){super();this.b=[];this.n=0}process(i){var c=i[0]&&i[0][0];if(c){this.b.push(new Float32Array(c));this.n+=c.length;if(this.n>=2400){var o=new Float32Array(this.n),k=0;this.b.forEach(function(a){o.set(a,k);k+=a.length});this.port.postMessage(o);this.b=[];this.n=0}}return true}}registerProcessor('tss-mic',P);";

  async function startCall() {
    inCall = true; renderOpen(); status(t("connecting"));
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: RATE });
      await ctx.resume();
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
      catch (e) { status(t("mic")); return cleanup(false); }
      var r = await fetch(API + "/voix/jeton", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (!r.ok) throw new Error("token " + r.status);
      var tok = (await r.json()).token;
      ws = new WebSocket("wss://api.x.ai/v1/realtime?model=" + encodeURIComponent(MODEL), ["xai-client-secret." + tok]);
      ws.onopen = async function () {
        ws.send(JSON.stringify({ type: "session.update", session: {
          instructions: INSTRUCTIONS, voice: VOICE,
          turn_detection: { type: "server_vad" },
          audio: { input: { format: { type: "audio/pcm", rate: RATE } }, output: { format: { type: "audio/pcm", rate: RATE } } }
        } }));
        // La réceptionniste « décroche » : elle parle en premier.
        ws.send(JSON.stringify({ type: "response.create" }));
        await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" })));
        src = ctx.createMediaStreamSource(stream); node = new AudioWorkletNode(ctx, "tss-mic");
        node.port.onmessage = function (ev) { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: "input_audio_buffer.append", audio: b64FromPcm(ev.data) })); };
        src.connect(node);
        status(t("live"), true);
        timer = setTimeout(hangUp, MAX_CALL_MS);
      };
      ws.onmessage = function (ev) {
        var m; try { m = JSON.parse(ev.data); } catch (x) { return; }
        if ((m.type === "response.output_audio.delta" || m.type === "response.audio.delta") && m.delta) playB64(m.delta);
        else if (m.type === "input_audio_buffer.speech_started") stopPlayback();
        else if (m.type === "error") console.warn("tss voix", m.error || m);
      };
      ws.onerror = function () { status(t("err")); };
      ws.onclose = function () { if (inCall) cleanup(true); };
    } catch (e) { console.warn("tss voix", e); status(t("err")); cleanup(false); }
  }
  function hangUp() { cleanup(true); }
  function cleanup(showEnded) {
    inCall = false; clearTimeout(timer);
    try { ws && ws.close(); } catch (x) {} ws = null;
    try { src && src.disconnect(); node && node.disconnect(); } catch (x) {}
    if (stream) stream.getTracks().forEach(function (tr) { tr.stop(); }); stream = null;
    stopPlayback(); try { ctx && ctx.close(); } catch (x) {} ctx = null;
    var msg = root.querySelector(".tssv-status") ? root.querySelector(".tssv-status").textContent : "";
    renderOpen(); status(showEnded ? t("ended") : msg);
  }

  var later = false; try { later = sessionStorage.getItem("tssv_later") === "1"; } catch (x) {}
  if (later) renderClosed(); else setTimeout(renderOpen, 800);
})();
