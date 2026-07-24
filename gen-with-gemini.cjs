#!/usr/bin/env node
// Generate truckstopsante.com — corporate health program landing (8 $/mois/employé sur Spruce).
// Copy source: C:\Users\insta\employer-bilan-qc\ad-fr.md (Carlos FINAL v3 + compliance rules).
'use strict';
const fs = require('fs'), https = require('https'), path = require('path');

function readKeys(){
  const envp = path.join(process.env.USERPROFILE, '.claude', '.env');
  const txt = fs.readFileSync(envp,'utf8');
  const keys = [];
  for(const name of ['GEMINI_API_KEY_AQ','GEMINI_API_KEY_2','GEMINI_API_KEY']){
    const m = txt.match(new RegExp('^'+name+'=(.+)$','m'));
    if(m) keys.push(m[1].trim());
  }
  if(!keys.length) throw new Error('no Gemini keys found in '+envp);
  return keys;
}
const KEYS = readKeys();
const MODELS = ['gemini-3.1-pro-preview','gemini-3-pro-preview','gemini-2.5-pro'];

const BRIEF = `You are a senior web designer and front-end engineer. Output ONE complete, self-contained, production-quality HTML file (inline <style>, no external CSS frameworks; Google Fonts allowed). No explanation, no markdown fences — RAW HTML only, starting with <!DOCTYPE html>. The ENTIRE site is in FRENCH (Québec French, informal "tu" in the hero hook exactly as dictated, "vous" everywhere else). lang="fr".

PROJECT: One-page B2B landing for **Truck Stop Santé** — truckstopsante.com. A Québec clinic selling ONE corporate product to employers (trucking fleets first, all companies welcome): **la couverture santé d'entreprise à 8 $/mois par employé, sur Spruce (télémédecine 100 % asynchrone). L'employé ne paie jamais rien.** The buyer is an employer / fleet owner / HR manager. This is NOT a patient site.

=== EXACT COPY (use verbatim where quoted — this wording is legally vetted, do not "improve" it) ===

HERO (the canonical ad, use this text):
Headline: « Ton camion a un garage attitré. »
Subheadline: « Mais tes camionneurs ont de la difficulté à trouver un service en santé. Donne-leur une clinique attitrée. »
Offer line (very prominent, price is the hero): « 8 $/mois par chauffeur. Le chauffeur ne paie jamais rien. »
Support line: « Service aux entreprises : sans-rendez-vous — urgences mineures ponctuelles en médecine familiale. Télémédecine et asynchrone, sur Spruce. »
Scarcity line (small, under CTA): « Capacité limitée : 10 000 chauffeurs. Les premières flottes gardent leur place. »
Primary CTA button: « Inscrire mes chauffeurs » → links to https://buy.stripe.com/7sY7sMa0Cgil5u84CjbMR0m
Secondary CTA button: « Écrire à la clinique » → mailto:cff@centremedicalfont.ca
Hero badge row (small pills): « 100 % asynchrone » · « Sur Spruce » · « Français · Español · English » · « Permis CMQ 16812 »

SECTION "Pourquoi ça marche" (the one canonical story — keep it to ONE story card):
« Un chauffeur, une infection urinaire, un mardi soir à Rivière-du-Loup. Évalué sur Spruce, prescription envoyée à la pharmacie la plus proche — traité sans quitter la route. Aucune journée perdue. »
Follow with one sentence: « Sans absence. Sans déplacement. Sans quitter la route. » (NEVER promise any turnaround time like "48 h" or "le soir même" — forbidden.)

SECTION "Inclus dans le 8 $/mois" (checklist grid, sans frais additionnels):
- Documents d'arrêt de travail (congés)
- Formulaires d'assurance
- Attestations d'aptitude
- Évaluations de retour au travail
- Références vers spécialistes
- Requêtes d'imagerie
- Prises de sang et laboratoires
- Suivis
Under the grid, one line: « L'employeur reçoit l'attestation — jamais le dossier médical. Confidentialité complète, conforme à la Loi 25. »

SECTION "Et les soins médicaux eux-mêmes?" (RAMQ separation — REQUIRED, short, factual):
« Les soins sont couverts par la RAMQ. Votre forfait couvre ce que la RAMQ ne couvre pas. »
Then: « La RAMQ paie les consultations, les traitements, les prescriptions et les suivis — aucun frais pour vous, aucun frais pour l'employé. Elle ne paie pas les attestations d'aptitude, les notes de retour au travail ni les formulaires d'assurance. C'est exactement ça que le forfait couvre. »

SECTION PRIX (single centered pricing card — ONE product only):
« Couverture santé d'entreprise » — 8 $ / mois / employé. « Service aux entreprises — l'employé ne paie jamais rien. Sans engagement. Quantité ajustable de 1 à 10 000 employés. »
CTA: « Inscrire ma flotte » → same Stripe link. Below: « Ou écrivez-nous : cff@centremedicalfont.ca — envoyez simplement votre liste d'employés. »

SECTION FAQ (accordion or simple list, these 5 items EXACTLY):
1. « Quels problèmes de santé sont couverts par le sans-rendez-vous? » → « Les urgences mineures ponctuelles en médecine familiale : infections, blessures mineures, renouvellements de médicaments stables, requêtes d'imagerie et de laboratoire, références. Sont exclus : les narcotiques, la santé mentale, les problèmes chroniques et la prise en charge en médecine familiale — ces suivis doivent se faire en présentiel. »
2. « En quelles langues? » → « Français, español, English — le médecin est hispanophone natif. Vos travailleurs étrangers sont servis directement dans leur langue, sans interprète. »
3. « Et les examens SAAQ des chauffeurs? » → « Service régulier de la clinique, hors forfait et sans frais — voir m28.ca. »
4. « Offrez-vous des examens de préembauche? » → « Non. La pratique est 100 % télémédecine asynchrone, sans examen physique. »
5. « Comment ça démarre? » → « Vous vous inscrivez, vous envoyez votre liste d'employés à cff@centremedicalfont.ca, et vos employés reçoivent leur invitation Spruce. C'est tout. »

FOOTER (compliance strip, muted, small):
« Les services assurés par la RAMQ (consultations, traitements, prescriptions, suivis) sont facturés à la RAMQ et ne font l'objet d'aucuns frais pour l'employeur ni pour l'employé. Le présent forfait couvre exclusivement des services non assurés. »
« Dr Carlos Font, médecin de famille — Truck Stop Santé — permis CMQ 16812 — cff@centremedicalfont.ca »
Small link: « Examens SAAQ : m28.ca »

=== HARD COPY RULES (violating any of these is a failure) ===
- NEVER the words « messagerie », « SMS », « texto », « chat » — say « sur Spruce », « télémédecine », « asynchrone ».
- NEVER « un médecin attitré » — always « une clinique attitrée ».
- NEVER any mention of AI, intelligence artificielle, automatisation.
- NEVER testimonials, star ratings, reviews, client logos, invented statistics or metrics.
- NEVER promise turnaround times (no « 48 h », « même jour », « en quelques heures »).
- NEVER « accès illimité à un médecin », « votre médecin de famille », « prise en charge ».
- NEVER mention CNESST anywhere.
- NEVER « carte soleil » in the hero/ad sections (RAMQ wording only in the dedicated RAMQ section and footer).
- Do not invent extra services, prices, or claims beyond the copy above.

=== DESIGN SYSTEM (use exactly) ===
- Fonts (Google Fonts): headings = "Barlow Condensed" (600/700, uppercase, tight tracking — highway-signage energy), body/UI = "Barlow" (400/500/700).
- Colors: background near-black asphalt #0B1220 for hero and footer; page body light #F6F8FB; primary navy #14264A; text on light #101828; muted #5B6779; ACCENT amber #F59E0B (CTAs, price, hook underline — the only accent, used decisively); surfaces #FFFFFF; borders #D9E0EA; success green #059669 for checklist checkmarks.
- Style: Trust & Authority. Dark hero like a highway at night — subtle horizontal "lane line" motif (thin dashed amber line as a divider element, tasteful, CSS only). Big bold condensed uppercase headlines. The « 8 $/mois » must be typographically huge in the hero and pricing card. Cards with subtle shadow (0 4px 6px rgba(16,24,40,.08)), 12px radius. Clean inline SVG icons only (truck, shield, document, checkmark, phone-less — NO emoji).
- Sticky top nav: brand "TRUCK STOP SANTÉ" left (condensed, amber "SANTÉ"), anchors: Le programme / Inclus / Prix / FAQ; right: amber CTA button « Inscrire mes chauffeurs ».
- Fully responsive (single column on mobile, nav anchors hidden on mobile, CTA stays). Smooth scroll. WCAG AA contrast. Tasteful hover transitions only — no scroll-jacking, no animation libraries.

Make it feel like a serious, confident Québec trucking-industry service — professional enough for an HR director, direct enough for a fleet owner. Return RAW HTML only.`;

function callGemini(model, key){
  return new Promise((resolve,reject)=>{
    const body = JSON.stringify({
      contents:[{role:'user',parts:[{text:BRIEF}]}],
      generationConfig:{ temperature:0.7, maxOutputTokens:60000, topP:0.95 }
    });
    const req = https.request({
      method:'POST',
      hostname:'generativelanguage.googleapis.com',
      path:`/v1beta/models/${model}:generateContent`,
      headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body),'x-goog-api-key':key}
    }, res=>{
      let d=''; res.on('data',c=>d+=c); res.on('end',()=>{
        let j; try{ j=JSON.parse(d); }catch(e){ return reject(new Error('parse '+res.statusCode+' '+d.slice(0,200))); }
        if(res.statusCode!==200) return reject(new Error(`HTTP ${res.statusCode} ${model}: ${JSON.stringify(j).slice(0,300)}`));
        const txt = j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts &&
                    j.candidates[0].content.parts.map(p=>p.text||'').join('');
        if(!txt) return reject(new Error('no text: '+JSON.stringify(j).slice(0,300)));
        resolve(txt);
      });
    });
    req.on('error',reject); req.write(body); req.end();
  });
}

function clean(html){
  let h = html.trim();
  h = h.replace(/^```html\s*/i,'').replace(/^```\s*/,'').replace(/```\s*$/,'');
  const i = h.indexOf('<!DOCTYPE');
  if(i>0) h = h.slice(i);
  return h.trim();
}

(async ()=>{
  let lastErr;
  for(const [ki,key] of KEYS.entries()) for(const model of MODELS){
    try{
      process.stderr.write(`trying ${model} (key ${ki+1}/${KEYS.length})...\n`);
      const txt = await callGemini(model, key);
      const html = clean(txt);
      if(html.length < 1500 || !/<\/html>/i.test(html)) throw new Error('output too short / incomplete ('+html.length+' chars)');
      const out = path.join(__dirname,'index.html');
      fs.writeFileSync(out, html, 'utf8');
      console.log(`OK model=${model} bytes=${html.length} -> ${out}`);
      process.exit(0);
    }catch(e){ lastErr=e; process.stderr.write('  fail: '+e.message+'\n'); }
  }
  console.error('ALL MODELS FAILED. last: '+(lastErr&&lastErr.message));
  process.exit(1);
})();
