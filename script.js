"use strict";

/* Stockage local : toutes les clés de Funnelia commencent par « funnelia. ».
   Les sauvegardes des versions précédentes (anciens noms du jeu) sont reprises
   automatiquement au premier lancement ; les anciennes clés ne sont jamais
   effacées, pour qu'aucune progression ne puisse être perdue. */
const CLES_STOCKAGE = {
  langue: "funnelia.langue",
  parcours: "funnelia.parcours",
  ongletAccueil: "funnelia.onglet-accueil",
  demarre: "funnelia.demarre"                // sessionStorage : retour direct à l'accueil après un changement de langue
};
const ANCIENNES_CLES = {
  [CLES_STOCKAGE.langue]: ["for-distribution-langue"],
  [CLES_STOCKAGE.parcours]: ["veltis-academy-parcours-client"],
  [CLES_STOCKAGE.ongletAccueil]: ["for-distribution-onglet"]
};
(function migrerStockage() {
  try {
    Object.entries(ANCIENNES_CLES).forEach(([nouvelle, anciennes]) => {
      if (localStorage.getItem(nouvelle) !== null) return;
      const ancienne = anciennes.find(k => localStorage.getItem(k) !== null);
      if (ancienne) localStorage.setItem(nouvelle, localStorage.getItem(ancienne));
    });
  } catch (e) { /* stockage indisponible (navigation privée) : rien à migrer */ }
})();

/* Langue de l'interface (français ou anglais), choisie avant de lancer le jeu.
   Elle est fixée au chargement : changer de langue recharge la page. */
const CLE_LANGUE = CLES_STOCKAGE.langue;
const LANGUE = (() => { try { return localStorage.getItem(CLE_LANGUE) === "en" ? "en" : "fr"; } catch (e) { return "fr"; } })();
const EN = LANGUE === "en";
const LOCALE = EN ? "en-GB" : "fr-FR";
document.documentElement.lang = LANGUE;

/* Textes rangés dans le dossier textes/ (fichiers .js chargés avant celui-ci,
   sans module ni fetch : le jeu reste jouable en file://). Chaque texte
   { fr, en } y est remplacé par celui de la langue choisie. */
const TEXTES = window.FUNNELIA_TEXTES || {};
if (!TEXTES.catalogue) throw new Error("textes/catalogue.js n'est pas chargé : vérifiez la balise <script> dans index.html.");
function traduire(v) {
  if (Array.isArray(v)) return v.map(traduire);
  if (!v || typeof v !== "object") return v;
  const cles = Object.keys(v);
  if (cles.length === 2 && typeof v.fr === "string" && typeof v.en === "string") return v[LANGUE];
  return Object.fromEntries(cles.map(k => [k, traduire(v[k])]));
}
function traduireHTML() {
  if (!EN) return;
  document.title = "Funnelia – From prospect to customer";
  const meta = document.querySelector('meta[name="description"]');
  if (meta) meta.content = "Funnelia: a 3D B2B sales conversion simulator, in English and French. Move every contact through the funnel, from prospect to lead, opportunity and loyal customer, with team KPI dashboards.";
  document.querySelectorAll("[data-en]").forEach(el => { el.innerHTML = el.dataset.en; });
  [["data-en-title", "title"], ["data-en-placeholder", "placeholder"], ["data-en-aria-label", "aria-label"]].forEach(([source, cible]) =>
    document.querySelectorAll(`[${source}]`).forEach(el => el.setAttribute(cible, el.getAttribute(source))));
}
traduireHTML();

/* =====================================================================
   FUNNELIA · Du prospect au client (FR / EN)
   Simulateur 3D de conversion commerciale B2B
   ---------------------------------------------------------------------
   Univers : Veltis, éditeur du logiciel SaaS « Veltis One » (gestion
   commerciale des PME et ETI). Le participant incarne un commercial
   TERRAIN (rendez-vous en face à face dans les salons clients) ou SÉDENTAIRE
   (poste de travail, téléphone, visio) et fait avancer ses prospects
   dans le tunnel de conversion :
     1. Prospection    — inconnu → prospect qualifié
     2. Captation      — prospect → lead
     3. Qualification  — lead → opportunité
     4. Closing        — opportunité → client
     5. Fidélisation   — bonus : client → client fidèle (CLV)
   Fil rouge : le tunnel de conversion. La jauge de progression du
   participant suit les quatre étapes Prospect → Lead → Opportunité →
   Client ; elle avance quand ses décisions font convertir et recule
   quand elles freinent la conversion. Elle fixe aussi la durée de vie
   (donc la CLV) des clients qu'il signe. Chaque passage d'étape est
   mis en scène par une animation.
   Une mission est interrompue au bout de 5 erreurs.
   ---------------------------------------------------------------------
   Organisation du fichier
     PARTIE A — Moteur : outils, monde 3D, personnages, interface,
                temps simulé, journal et compétences
     PARTIE B — Données métier : offre, tarifs, comptes, méthodes, guide
     PARTIE C — Missions 1 et 2
     PARTIE D — Missions 3 et 4
     PARTIE E — Mission 5, déroulement, commandes et boucle principale
   Les tarifs, entreprises et personnes sont fictifs.
   ===================================================================== */

if (typeof THREE === "undefined") {
  const e = document.getElementById("ecran-accueil");
  if (e) e.innerHTML = (EN ? '<div class="carte-ecran"><h2>Unable to load</h2><p>The 3D engine (Three.js) could not be loaded. Check your internet connection, then reload the page.</p></div>' : '<div class="carte-ecran"><h2>Chargement impossible</h2><p>Le moteur 3D (Three.js) n\'a pas pu être chargé. Vérifiez la connexion internet, puis rechargez la page.</p></div>');
  throw new Error((EN ? "Three.js not loaded" : "Three.js non chargé"));
}

/* =====================================================================
   PARTIE A — MOTEUR
   ===================================================================== */

/* ---------- A1. Outils et constantes ---------- */
const MAX_ERREURS = 5;
const NB_ETAPES = 5;
const JOURNEE = 540;                       // journée de travail simulée : 9 h – 18 h
const JOURS = EN ? ["Mon.", "Tue.", "Wed.", "Thu.", "Fri."] : ["Lun.", "Mar.", "Mer.", "Jeu.", "Ven."];
const ECHELLE_METRES = 2;                  // 1 unité 3D ≈ 2 m (intérieur)
const POSTURE_DEPART = 8;                  // tout participant démarre à l'étape Prospect du tunnel
const ANCIENNES_PHASES = { "Notoriété": (EN ? "Prospecting" : "Prospection"), "Intérêt": (EN ? "Lead capture" : "Captation"), "Considération": "Qualification", "Décision": "Closing" };
// Libellés enregistrés par les versions précédentes → identifiants stables
const ID_PHASE = { "Notoriété": "notoriete", "Prospection": "notoriete", "Prospecting": "notoriete", "Intérêt": "interet", "Captation": "interet", "Lead capture": "interet",
  "Considération": "consideration", "Qualification": "consideration", "Décision": "decision", "Closing": "decision", "Fidélisation": "fidelisation", "Retention": "fidelisation" };
const ID_PROFIL = { "Terrain": "terrain", "Field": "terrain", "Sédentaire": "sedentaire", "Inside sales": "sedentaire" };
const ID_EXIGENCE = { "Standard": "standard", "Confirmé": "confirme", "Advanced": "confirme" };

const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const nombre = v => Math.round(v).toLocaleString(LOCALE);
const euros = v => (EN ? `€${nombre(v)}` : `${nombre(v)} €`);
const eurosPrecis = v => (EN ? `€${v.toFixed(2)}` : `${v.toFixed(2).replace(".", ",")} €`);
const pourcent = v => (EN ? `${Math.round(v)}%` : `${Math.round(v)} %`);
const pourcentPrecis = v => (EN ? `${v.toFixed(1)}%` : `${v.toFixed(1).replace(".", ",")} %`);
const guillemets = t => (EN ? `“${t}”` : `« ${t} »`);
const decimal = v => (EN ? String(v) : String(v).replace(".", ","));
const NIVEAUX_PERF = [(EN ? "Not acquired" : "Non acquis"), (EN ? "Acquired" : "Acquis"), (EN ? "Proficient" : "Maîtrise"), "Excellence"];
const etoilesTexte = n => NIVEAUX_PERF[clamp(n, 0, 3)];
const echapper = t => String(t ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const initiales = nom => String(nom).split(/\s+/).filter(Boolean).map(m => m[0]).join("").slice(0, 2).toUpperCase();
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const hex = c => `#${c.toString(16).padStart(6, "0")}`;
const majuscule = t => t.charAt(0).toUpperCase() + t.slice(1);

/* Aléa du scénario : un scénario différent à chaque partie. L'ordre
   d'affichage des réponses et les déplacements des personnages utilisent
   un aléa séparé (« visuel »). */
function hacher(texte) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < texte.length; i++) { h ^= texte.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function generateur(graine) {
  let a = graine >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let cleScenario = `libre-${Date.now()}`;
let rng = generateur(hacher(cleScenario));
function initialiserAlea(cle) { cleScenario = cle; rng = generateur(hacher(cle)); }
const tirage = cle => generateur(hacher(`${cleScenario}|${cle}`))();
const entierTirage = (cle, a, b) => a + Math.floor(tirage(cle) * (b - a + 1));
const choisir = t => t[Math.floor(rng() * t.length)];
const aleatoire = (a, b) => a + rng() * (b - a);
const entier = (a, b) => Math.floor(aleatoire(a, b + 1));
const aleatoireVisuel = (a, b) => a + Math.random() * (b - a);
function melanger(tableau, source = rng) {
  const t = tableau.slice();
  for (let i = t.length - 1; i > 0; i--) {
    const j = Math.floor(source() * (i + 1));
    [t[i], t[j]] = [t[j], t[i]];
  }
  return t;
}
const melangerChoix = tableau => melanger(tableau, Math.random);
function hasard(x, y, graine = 0) {
  const s = Math.sin(x * 127.1 + y * 311.7 + graine * 74.7) * 43758.5453;
  return s - Math.floor(s);
}
function dureeTexte(min) {
  if (min < 60) return `${Math.max(1, Math.round(min))} min`;
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return m ? `${h} h ${String(m).padStart(2, "0")}` : `${h} h`;
}
function ageTexte(min) {
  if (min < 1) return (EN ? "just now" : "à l'instant");
  if (min < JOURNEE) return (EN ? `${dureeTexte(min)} ago` : `il y a ${dureeTexte(min)}`);
  const j = Math.floor(min / JOURNEE);
  return (EN ? `${j} d ago` : `il y a ${j} j`);
}
function joursTexte(min) {
  const j = min / JOURNEE;
  return j < 1 ? dureeTexte(min) : `${Math.round(j)} j`;
}

/* ---------- A2. État global ---------- */
const touches = new Set();
const jeu = {
  mode: "menu", temps: 0, dureeReelle: 0,
  minutes: 0, debutMinutes: 0, finMinutes: 0, rythme: 1, acceleration: 1, affichage: "jour",
  niveauIndex: 0, def: null, n: null, p: null, profil: "terrain",
  focus: null, boutons: [], erreurs: 0, journal: [], competences: {},
  zoom: 1, modeAvantFenetre: "jeu", fenetreFermable: true, fenetreOnFermeture: null,
  selection: -1, focusPanneau: false, cleFocusPanneau: "", indexFocusPanneau: 0,
  aides: 0, fenetreNav: "grille", changerOnglet: null, imprevus: [], imprevuActif: null,
  posture: 0, postureDepart: 0, reflexesRequin: [], gestesPartenaire: 0
};

const CLE_SAUVEGARDE = CLES_STOCKAGE.parcours;
// Logo Funnelia : entonnoir en 4 bandes, une par étape du tunnel (Prospect, Lead, Opportunité, Client)
const LOGO_FUNNELIA = '<svg viewBox="0 0 48 48" role="img"><rect width="48" height="48" rx="11" fill="#0b1f3a"/><path d="M8 10h32l-3.2 6.5H11.2z" fill="#94a3b8"/><path d="M12.4 18.5h23.2l-3.2 6.5H15.6z" fill="#3b82f6"/><path d="M16.8 27h14.4l-3.2 6.5h-8z" fill="#8b5cf6"/><path d="M21 35.5h6l-1.2 4.5h-3.6z" fill="#22c55e"/></svg>';
function chargerResultats() {
  const vide = () => Array(NB_ETAPES).fill(0);
  const base = {
    nom: "", portefeuille: null, profil: "terrain", exigence: "standard", son: true,
    meilleurs: { terrain: vide(), sedentaire: vide() },
    etoiles: { terrain: vide(), sedentaire: vide() },
    tentatives: { terrain: vide(), sedentaire: vide() },
    posture: { terrain: POSTURE_DEPART, sedentaire: POSTURE_DEPART },
    trajectoire: { terrain: [], sedentaire: [] },
    tunnels: { terrain: Array(NB_ETAPES).fill(null), sedentaire: Array(NB_ETAPES).fill(null) },
    historique: []
  };
  try {
    const d = JSON.parse(localStorage.getItem(CLE_SAUVEGARDE));
    if (d && d.meilleurs && d.etoiles && d.tentatives) {
      const r = Object.assign(base, d);
      // Sauvegardes antérieures : anciens noms d'étapes du parcours client
      r.historique.forEach(h => {
        if (ANCIENNES_PHASES[h.etape]) h.etape = ANCIENNES_PHASES[h.etape];
        if (!h.etapeId) h.etapeId = ID_PHASE[h.etape] || "";
        if (!h.profilId) h.profilId = ID_PROFIL[h.profil] || "terrain";
        if (!h.exigenceId) h.exigenceId = ID_EXIGENCE[h.exigence] || "standard";
      });
      return r;
    }
  } catch (e) { /* stockage indisponible */ }
  return base;
}
function sauverResultats() {
  try { localStorage.setItem(CLE_SAUVEGARDE, JSON.stringify(resultats)); } catch (e) { /* ignoré */ }
}
const resultats = chargerResultats();
const estTerrain = () => jeu.profil === "terrain";

/* ---------- A3. Plan du R+1 (plateau commercial) de l'immeuble Veltis, 3 niveaux sur l'esplanade de La Défense ----------
   Tout le jeu se déroule dans les bureaux de Veltis : open space commercial,
   bureaux de direction, salons clients (les rendez-vous en face à face y sont
   reçus), forum événementiel, cafétéria, espace détente, accueil et
   ascenseurs. 1 unité 3D ≈ 2 m. Les clients sont des entreprises fictives. */
const LIMITES = { minX: -19, maxX: 19, minZ: -12.8, maxZ: 12.3 };
const FACADE = { minX: -19.45, maxX: 19.45, minZ: -13.25, maxZ: 12.75 };
const HAUTEUR_MUR = 3.0;                    // cloisons jusqu'au plafond (3,05 m)
const HAUTEUR_PLAFOND = 3.05;
const AXE = 1.6;                           // demi-largeur de l'allée centrale
const PLATEAU = { minX: -18.6, maxX: -4.6, minZ: -6.2, maxZ: 3.4 };
const POSTE = { x: -10.4, z: -1.0 };
const POINT_POSTE = { x: -10.4, z: 0.5 };
const ZONE_SALON = { minX: 3.9, maxX: 12.4, minZ: -5.3, maxZ: 4.4 };     // forum événementiel
const ENTREE_FORUM = { minX: 6.4, maxX: 9.9 };
const CAFETERIA = { minX: -7.6, maxX: -2.2, minZ: 4.4, maxZ: 12.3 };
const DETENTE = { minX: -18.6, maxX: -8.4, minZ: 5.0, maxZ: 12.3 };
const ACCUEIL = { minX: 3.4, maxX: 14.6, minZ: 5.4, maxZ: 12.3 };
const ESPACE_CS = { minX: 14.8, maxX: 19, minZ: 4.0, maxZ: 12.3 };

/* Pièces fermées. Rangée nord : porte au sud ; colonne est : porte à l'ouest. */
const SALLES = [
  { cle: "direction", nom: (EN ? "Sales Management" : "Direction commerciale"), type: "bureau", minX: -18.9, maxX: -14.3, minZ: -12.9, maxZ: -8.6, porte: "sud" },
  { cle: "dg", nom: (EN ? "Executive Office" : "Direction générale"), type: "bureau", minX: -14.1, maxX: -9.5, minZ: -12.9, maxZ: -8.6, porte: "sud" },
  { cle: "arche", nom: (EN ? "Arche Room" : "Salon Arche"), type: "client", minX: -9.3, maxX: -4.7, minZ: -12.9, maxZ: -8.6, porte: "sud" },
  { cle: "seine", nom: (EN ? "Seine Room" : "Salon Seine"), type: "client", minX: -4.5, maxX: 0.1, minZ: -12.9, maxZ: -8.6, porte: "sud" },
  { cle: "esplanade", nom: (EN ? "Esplanade Room" : "Salon Esplanade"), type: "client", minX: 0.3, maxX: 4.9, minZ: -12.9, maxZ: -8.6, porte: "sud" },
  { cle: "coupole", nom: (EN ? "Coupole Room" : "Salon Coupole"), type: "client", minX: 5.1, maxX: 9.7, minZ: -12.9, maxZ: -8.6, porte: "sud" },
  { cle: "neuilly", nom: (EN ? "Neuilly Room" : "Salon Neuilly"), type: "client", minX: 9.9, maxX: 14.5, minZ: -12.9, maxZ: -8.6, porte: "sud" },
  { cle: "courbevoie", nom: (EN ? "Courbevoie Room" : "Salon Courbevoie"), type: "client", minX: 14.7, maxX: 18.9, minZ: -12.9, maxZ: -8.6, porte: "sud" },
  { cle: "puteaux", nom: (EN ? "Puteaux Room" : "Salon Puteaux"), type: "client", minX: 14.8, maxX: 18.9, minZ: -6.6, maxZ: -2.2, porte: "ouest" },
  { cle: "agora", nom: (EN ? "Agora Room" : "Salle Agora"), type: "reunion", minX: 14.8, maxX: 18.9, minZ: -2.0, maxZ: 3.6, porte: "ouest" }
];
SALLES.forEach(s => {
  s.x = (s.minX + s.maxX) / 2;
  s.z = (s.minZ + s.maxZ) / 2;
  s.w = s.maxX - s.minX;
  s.d = s.maxZ - s.minZ;
  s.entree = s.porte === "sud" ? { x: s.x, z: s.maxZ + 0.9 } : { x: s.minX - 0.9, z: s.z };
});
const SALLE = Object.fromEntries(SALLES.map(s => [s.cle, s]));

/* Salons clients : chaque compte est reçu dans un salon de l'étage */
const SALON_DU_COMPTE = { batinord: "arche", medilys: "seine", fidelio: "esplanade", transalp: "coupole", optiwatt: "neuilly", larcher: "courbevoie", belvue: "puteaux" };
const ACCENTS = { batinord: 0xb45309, medilys: 0x0891b2, fidelio: 0x7c3aed, transalp: 0x0f766e, optiwatt: 0x65a30d, larcher: 0x9f1239, belvue: 0xbe185d };
const BATIMENTS = Object.fromEntries(Object.entries(SALON_DU_COMPTE).map(([cle, salle]) => {
  const s = SALLE[salle];
  const contact = s.porte === "sud" ? { x: s.x + 0.9, z: s.maxZ - 1.0 } : { x: s.minX + 1.0, z: s.z + 0.9 };
  return [cle, { salle: s, nom: s.nom, x: s.x, z: s.z, w: s.w, d: s.d, porte: s.entree, contact, accent: ACCENTS[cle] }];
}));

/* Collaborateurs de Veltis (personnes fictives). Les quatre premiers sont
   les collègues ressources des missions. */
const COLLEGUES_DEF = {
  manager: { nom: "Sandrine Morel", fonction: (EN ? "Sales Director" : "Directrice commerciale"), f: true, apparence: 1, couleur: "#1e293b", poste: { x: -16.6, z: -11.4 }, assiduite: 0.75 },
  avantVente: { nom: "Yanis Haddad", fonction: (EN ? "Pre-sales Engineer" : "Ingénieur avant-vente"), apparence: 2, couleur: "#334155", poste: { x: -15.6, z: -3.9 }, assiduite: 0.6 },
  marketing: { nom: "Léa Chevalier", fonction: (EN ? "Marketing Manager" : "Responsable marketing"), f: true, apparence: 3, couleur: "#475569", poste: { x: -15.6, z: -1.0 }, assiduite: 0.6 },
  success: { nom: "Inès Laurent", fonction: "Customer Success Manager", f: true, apparence: 6, couleur: "#0f766e", poste: { x: 16.4, z: 6.2 }, assiduite: 0.6 },
  dg: { nom: "Catherine Aubert", fonction: (EN ? "Chief Executive Officer" : "Directrice générale"), f: true, apparence: 7, couleur: "#1e293b", poste: { x: -11.8, z: -11.4 }, assiduite: 0.7 },
  thomas: { nom: "Thomas Renaudin", fonction: (EN ? "Field Sales Rep" : "Commercial terrain"), apparence: 0, couleur: "#1e3a8a", poste: { x: -10.4, z: -3.9 }, assiduite: 0.45 },
  sofia: { nom: "Sofia Mendes", fonction: (EN ? "Key Account Manager" : "Responsable grands comptes"), f: true, apparence: 3, couleur: "#1e3a8a", poste: { x: -7.8, z: -3.9 }, assiduite: 0.5 },
  maxime: { nom: "Maxime Duval", fonction: (EN ? "Sales Development Rep (SDR)" : "Chargé de prospection (SDR)"), apparence: 4, couleur: "#1e3a8a", poste: { x: -13.0, z: -3.9 }, assiduite: 0.55 },
  arthur: { nom: "Arthur Lenoir", fonction: (EN ? "Digital Marketing Specialist" : "Chargé de marketing digital"), apparence: 5, couleur: "#475569", poste: { x: -13.0, z: -1.0 }, assiduite: 0.5 },
  amelie: { nom: "Amélie Garcia", fonction: (EN ? "Inside Sales Rep" : "Commerciale sédentaire"), f: true, apparence: 1, couleur: "#1e3a8a", poste: { x: -7.8, z: -1.0 }, assiduite: 0.6 },
  samira: { nom: "Samira Ouali", fonction: (EN ? "Sales Administration" : "Administration des ventes"), f: true, apparence: 6, couleur: "#334155", poste: { x: -15.6, z: 1.9 }, assiduite: 0.65 },
  bastien: { nom: "Bastien Moreau", fonction: (EN ? "Business Developer" : "Business developer"), apparence: 2, couleur: "#1e3a8a", poste: { x: -13.0, z: 1.9 }, assiduite: 0.45 },
  gilles: { nom: "Gilles Bertin", fonction: (EN ? "Financial Controller" : "Contrôleur de gestion"), apparence: 5, couleur: "#334155", poste: { x: -10.4, z: 1.9 }, assiduite: 0.7 },
  adrien: { nom: "Adrien Chauvin", fonction: (EN ? "Integration Engineer" : "Ingénieur intégrations"), apparence: 0, couleur: "#334155", poste: { x: -7.8, z: 1.9 }, assiduite: 0.6 },
  fatou: { nom: "Fatou Diallo", fonction: "Customer Success Manager", f: true, apparence: 7, couleur: "#0f766e", poste: { x: 16.4, z: 9.2 }, assiduite: 0.6 },
  chloe: { nom: "Chloé Bernard", fonction: (EN ? "Office manager · reception" : "Office manager · accueil"), f: true, apparence: 4, couleur: "#475569", poste: { x: 8.15, z: 8.2 }, assiduite: 0.8, accueil: true }
};

/* Lieux de vie de l'étage : position, orientation (a) et posture */
const O = Math.PI;
const LIEUX = {
  machine: [{ x: -6.55, z: 5.4, a: -O / 2, pose: "debout" }, { x: -6.55, z: 6.4, a: -O / 2, pose: "debout" }],
  cafe: [
    { x: -5.0, z: 6.6, a: O / 2, pose: "debout" }, { x: -3.8, z: 6.6, a: -O / 2, pose: "debout" },
    { x: -4.4, z: 7.25, a: O, pose: "debout" }, { x: -5.0, z: 9.0, a: O / 2, pose: "debout" },
    { x: -3.8, z: 9.0, a: -O / 2, pose: "debout" }, { x: -4.4, z: 9.65, a: O, pose: "debout" },
    { x: -4.4, z: 5.95, a: 0, pose: "debout" }, { x: -4.4, z: 8.35, a: 0, pose: "debout" }
  ],
  detente: [
    { x: -15.2, z: 8.95, a: 0, pose: "assis" }, { x: -14.2, z: 8.95, a: 0, pose: "assis" },
    { x: -15.2, z: 10.85, a: O, pose: "assis" }, { x: -14.2, z: 10.85, a: O, pose: "assis" },
    { x: -10.8, z: 7.0, a: -O / 2, pose: "debout" }
  ],
  imprimante: [{ x: -3.55, z: -4.25, a: O, pose: "debout" }],
  fontaine: [{ x: -3.55, z: 2.2, a: O, pose: "debout" }],
  appel: [
    { x: -17.75, z: 10.1, a: -O / 2, pose: "tel" }, { x: -17.75, z: 11.6, a: -O / 2, pose: "tel" },
    { x: -18.5, z: 4.3, a: -O / 2, pose: "tel" }, { x: 18.5, z: -7.6, a: O / 2, pose: "tel" }
  ],
  agora: [
    { x: 16.0, z: -0.9, a: 0, pose: "assis" }, { x: 17.8, z: -0.9, a: 0, pose: "assis" },
    { x: 16.0, z: 2.5, a: O, pose: "assis" }, { x: 17.8, z: 2.5, a: O, pose: "assis" },
    { x: 15.3, z: 0.8, a: O / 2, pose: "assis" }, { x: 18.5, z: 0.8, a: -O / 2, pose: "assis" }
  ]
};

/* ---------- A4. Scène 3D ---------- */
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.92;
$("scene").appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xc9d3df);
scene.fog = new THREE.Fog(0xd9cfc4, 120, 900);

const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 900);
camera.position.set(0, 24, 32);
const regard = new THREE.Vector3();

const lumiereCiel = new THREE.HemisphereLight(0xf1f5fb, 0x9a8d7c, 0.75);
scene.add(lumiereCiel);
const soleil = new THREE.DirectionalLight(0xffd8a8, 1.35);
soleil.position.set(-34, 21, 16);
soleil.castShadow = true;
soleil.shadow.mapSize.set(2048, 2048);
Object.assign(soleil.shadow.camera, { left: -28, right: 28, top: 28, bottom: -28, near: 1, far: 110 });
soleil.shadow.bias = -0.0004;
soleil.shadow.camera.updateProjectionMatrix();
scene.add(soleil);

function redimensionner() {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", redimensionner);
redimensionner();

const materiaux = {};
function mat(couleur) {
  if (!materiaux[couleur]) {
    materiaux[couleur] = new THREE.MeshStandardMaterial({ color: couleur, roughness: 0.82, metalness: 0 });
    materiaux[couleur].userData.teinte = couleur;
  }
  return materiaux[couleur];
}
function maillage(geo, couleur, ombre = true) {
  const m = new THREE.Mesh(geo, typeof couleur === "number" ? mat(couleur) : couleur);
  m.castShadow = ombre;
  m.receiveShadow = true;
  return m;
}
// Géométries partagées : une seule géométrie par jeu de paramètres, réutilisée par tous les objets identiques
const cacheGeometries = new Map();
function geometriePartagee(cle, fabrique) {
  if (!cacheGeometries.has(cle)) cacheGeometries.set(cle, fabrique());
  return cacheGeometries.get(cle);
}
const geoBoite = (w, h, d) => geometriePartagee(`b|${w}|${h}|${d}`, () => new THREE.BoxGeometry(w, h, d));
const geoCylindre = (rh, rb, h, s) => geometriePartagee(`c|${rh}|${rb}|${h}|${s}`, () => new THREE.CylinderGeometry(rh, rb, h, s));
const geoSphere = (r, s) => geometriePartagee(`s|${r}|${s}`, () => new THREE.SphereGeometry(r, s, Math.round(s * 0.75)));
const geoPlan = (w, h) => geometriePartagee(`p|${w}|${h}`, () => new THREE.PlaneGeometry(w, h));
const boite = (w, h, d, c, ombre = true) => maillage(geoBoite(w, h, d), c, ombre);
const cylindre = (rh, rb, h, c, s = 12) => maillage(geoCylindre(rh, rb, h, s), c);
const sphere = (r, c, s = 16) => maillage(geoSphere(r, s), c);
function pos(obj, x, y, z) { obj.position.set(x, y, z); return obj; }
function plan(w, d, couleur, y = 0.02) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat(couleur));
  m.rotation.x = -Math.PI / 2;
  m.position.y = y;
  m.receiveShadow = true;
  return m;
}
function dalle(minX, maxX, minZ, maxZ, couleur, y = 0.02) {
  return pos(plan(maxX - minX, maxZ - minZ, couleur, y), (minX + maxX) / 2, y, (minZ + maxZ) / 2);
}
const materiauVerre = new THREE.MeshStandardMaterial({ color: 0xcfe0ee, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.16, depthWrite: false });

/* ---------- A5. Textures de texte (enseignes, écrans) ---------- */
function texteTexture(o) {
  const c = dessinerTexte(o);
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return t;
}
function dessinerTexte(o) {
  const L = o.largeur || 512, H = o.hauteur || 128;
  const c = document.createElement("canvas");
  c.width = L;
  c.height = H;
  const g = c.getContext("2d");
  if (o.fond) { g.fillStyle = o.fond; g.fillRect(0, 0, L, H); }
  if (o.bande) { g.fillStyle = o.bande; g.fillRect(0, 0, Math.round(H * 0.16), H); }
  if (o.bandeau) { g.fillStyle = o.bandeau; g.fillRect(0, 0, L, Math.round(H * 0.22)); }
  const lignes = o.lignes || [];
  const total = lignes.reduce((s, l) => s + l.taille * 1.2, 0);
  let y = o.y !== undefined ? o.y : (H - total) / 2;
  lignes.forEach(l => {
    g.font = `${l.gras || 700} ${l.taille}px Inter, "Segoe UI", Arial, sans-serif`;
    g.fillStyle = l.couleur || "#0f172a";
    g.textAlign = o.align || "center";
    g.textBaseline = "top";
    const x = o.align === "left" ? (o.bande ? H * 0.16 + 26 : 26) : L / 2;
    g.fillText(l.texte, x, y + l.taille * 0.1, L - 44);
    y += l.taille * 1.2;
  });
  return c;
}
/* Atlas des panneaux de texte : enseignes, plaques et écrans fixes sont dessinés dans
   quelques grandes textures partagées (2048 px). Tous les panneaux d'une même page
   partagent un matériau et peuvent donc être fusionnés en un seul appel de dessin. */
const TAILLE_ATLAS = 2048, MARGE_ATLAS = 4;
const pagesAtlas = [];
function placerDansPage(p, L, H) {
  const l = L + MARGE_ATLAS * 2, h = H + MARGE_ATLAS * 2;
  if (p.x + l > TAILLE_ATLAS) { p.x = 0; p.y += p.hLigne; p.hLigne = 0; }
  if (p.y + h > TAILLE_ATLAS) return null;
  const r = { page: p, x: p.x + MARGE_ATLAS, y: p.y + MARGE_ATLAS };
  p.x += l;
  p.hLigne = Math.max(p.hLigne, h);
  return r;
}
function emplacementAtlas(L, H, transparent) {
  if (L + MARGE_ATLAS * 2 > TAILLE_ATLAS || H + MARGE_ATLAS * 2 > TAILLE_ATLAS) return null;
  for (const p of pagesAtlas) if (p.transparent === transparent) { const r = placerDansPage(p, L, H); if (r) return r; }
  const c = document.createElement("canvas");
  c.width = c.height = TAILLE_ATLAS;
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const materiau = new THREE.MeshBasicMaterial({ map: t, transparent, toneMapped: false });
  materiau.userData.atlas = true;
  const p = { c, g: c.getContext("2d"), t, transparent, materiau, x: 0, y: 0, hLigne: 0 };
  pagesAtlas.push(p);
  return placerDansPage(p, L, H);
}
function panneauTexte(w, h, o) {
  const toile = dessinerTexte(o);
  const L = toile.width, H = toile.height;
  const r = emplacementAtlas(L, H, !o.fond);
  if (!r) return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(toile), transparent: !o.fond, toneMapped: false }));
  // Marge de la couleur du fond autour du panneau : pas de liseré aux distances moyennes (mipmaps)
  if (o.fond) { r.page.g.fillStyle = o.fond; r.page.g.fillRect(r.x - MARGE_ATLAS, r.y - MARGE_ATLAS, L + MARGE_ATLAS * 2, H + MARGE_ATLAS * 2); }
  r.page.g.drawImage(toile, r.x, r.y);
  r.page.t.needsUpdate = true;
  const geo = new THREE.PlaneGeometry(w, h);
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (r.x + uv.getX(i) * L) / TAILLE_ATLAS, 1 - (r.y + (1 - uv.getY(i)) * H) / TAILLE_ATLAS);
  return new THREE.Mesh(geo, r.page.materiau);
}

/* ---------- A6. Collisions ---------- */
const obstacles = [];
let obstaclesNiveau = [];
// Liste qui reçoit les obstacles du mobilier en cours de construction (celle du niveau construit)
let obstaclesConstruction = obstacles;
function obstacleCercle(x, z, r, liste = obstaclesConstruction) { liste.push({ x, z, r }); }
function obstacleBoite(x, z, dx, dz, liste = obstaclesConstruction) { liste.push({ minX: x - dx, maxX: x + dx, minZ: z - dz, maxZ: z + dz }); }

/* Niveaux de l'immeuble Veltis : RDC, R+1 (plateau commercial), R+2.
   Chaque niveau a son groupe 3D, ses obstacles et sa grille de navigation ;
   seul le niveau où se trouve le participant est affiché. */
const HAUTEUR_NIVEAU = 4;
const ETAGES = [
  { niveau: 0, code: EN ? "G" : "RDC", bouton: EN ? "G" : "0", nom: EN ? "Lobby & Showroom" : "Hall & Showroom", y: -HAUTEUR_NIVEAU, obstacles: [],
    resume: EN ? "Reception, access control, Café du Parvis, Veltis One showroom, auditorium, visitors' lounge" : "Accueil, contrôle d'accès, Café du Parvis, showroom Veltis One, auditorium, salon des visiteurs" },
  { niveau: 1, code: EN ? "L1" : "R+1", bouton: "1", nom: EN ? "Sales floor" : "Plateau commercial", y: 0, obstacles,
    resume: EN ? "Sales open space, client rooms, Forum, cafeteria, Agora Room, management offices" : "Open space commercial, salons clients, Forum, cafétéria, salle Agora, direction" },
  { niveau: 2, code: EN ? "L2" : "R+2", bouton: "2", nom: EN ? "Academy & Leadership" : "Academy & Direction", y: HAUTEUR_NIVEAU, obstacles: [],
    resume: EN ? "Veltis Academy, Board Room, Customer Care, Veltis Lab, library, Belvédère lounge" : "Veltis Academy, salle du Conseil, Service clients, Veltis Lab, bibliothèque, lounge Le Belvédère" }
];
ETAGES.forEach(e => {
  e.groupe = new THREE.Group();
  e.groupe.position.y = e.y;
  e.groupe.visible = e.niveau === 1;
  scene.add(e.groupe);
  e.nav = { pas: 0.25, rayon: 0.3, nx: 0, nz: 0, libre: null };
});
const groupeR1 = ETAGES[1].groupe;

function libre(x, z, r, etage = 1) {
  if (x < LIMITES.minX || x > LIMITES.maxX || z < LIMITES.minZ || z > LIMITES.maxZ) return false;
  for (const liste of etage === 1 ? [obstacles, obstaclesNiveau] : [ETAGES[etage].obstacles]) {
    for (const o of liste) {
      if (o.r !== undefined) {
        if (Math.hypot(x - o.x, z - o.z) < o.r + r) return false;
      } else {
        const px = clamp(x, o.minX, o.maxX), pz = clamp(z, o.minZ, o.maxZ);
        if (Math.hypot(x - px, z - pz) < r) return false;
      }
    }
  }
  return true;
}

/* ---------- A7. Décor : outils de construction ---------- */
const animesDecor = [];
const decor = new THREE.Group();

/* Fusion des maillages statiques de même matériau : divise le nombre
   d'appels de rendu par dix et garde le jeu fluide sur les PC portables. */
function fusionnerGeometries(geos) {
  let nbSommets = 0, nbIndices = 0;
  geos.forEach(g => {
    nbSommets += g.attributes.position.count;
    nbIndices += g.index ? g.index.count : g.attributes.position.count;
  });
  const positions = new Float32Array(nbSommets * 3);
  const normales = new Float32Array(nbSommets * 3);
  const avecUV = geos.every(g => g.attributes.uv);
  const uvs = avecUV ? new Float32Array(nbSommets * 2) : null;
  const indices = new Uint32Array(nbIndices);
  let os = 0, oi = 0;
  geos.forEach(g => {
    positions.set(g.attributes.position.array, os * 3);
    normales.set(g.attributes.normal.array, os * 3);
    if (avecUV) uvs.set(g.attributes.uv.array, os * 2);
    const n = g.attributes.position.count;
    if (g.index) {
      const ix = g.index.array;
      for (let k = 0; k < ix.length; k++) indices[oi + k] = ix[k] + os;
      oi += ix.length;
    } else {
      for (let k = 0; k < n; k++) indices[oi + k] = os + k;
      oi += n;
    }
    os += n;
  });
  const sortie = new THREE.BufferGeometry();
  sortie.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  sortie.setAttribute("normal", new THREE.BufferAttribute(normales, 3));
  if (avecUV) sortie.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  sortie.setIndex(new THREE.BufferAttribute(indices, 1));
  sortie.computeBoundingSphere();
  return sortie;
}
/* Personnages : toutes les pièces unies d'un même membre sont fusionnées en UN mesh,
   avec un matériau unique partagé par tous les personnages ; la couleur de chaque
   pièce est conservée dans la géométrie (couleurs par sommet). */
const materiauPersonnage = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.03 });
function fusionnerPersonnage(groupe) {
  const pieces = [];
  groupe.children.forEach(o => {
    if (!o.isMesh || o.userData.dynamique) return;
    const m = o.material;
    if (Array.isArray(m) || !m.isMeshStandardMaterial || m.map || m.transparent || m.bumpMap || m.vertexColors) return;
    pieces.push(o);
  });
  if (pieces.length < 1) return;
  const geos = [], couleurs = [];
  let ombre = false;
  pieces.forEach(o => {
    o.updateMatrix();
    const g = o.geometry.clone();
    g.applyMatrix4(o.matrix);
    geos.push(g);
    couleurs.push(o.material.color);
    ombre = ombre || o.castShadow;
    groupe.remove(o);
  });
  const geo = fusionnerGeometries(geos);
  const c = new Float32Array(geo.attributes.position.count * 3);
  let k = 0;
  geos.forEach((g, i) => { for (let v = 0; v < g.attributes.position.count; v++, k++) { c[k * 3] = couleurs[i].r; c[k * 3 + 1] = couleurs[i].g; c[k * 3 + 2] = couleurs[i].b; } });
  geo.setAttribute("color", new THREE.BufferAttribute(c, 3));
  const mesh = new THREE.Mesh(geo, materiauPersonnage);
  mesh.castShadow = ombre;
  mesh.receiveShadow = true;
  groupe.add(mesh);
}
// Objets mobiles (personnages et ce qu'ils portent) : pas d'ombre calculée, la carte d'ombres est statique
function sansOmbrePortee(objet) { objet.traverse(o => { if (o.isMesh) o.castShadow = false; }); return objet; }
function fusionnerEnfants(groupe) {
  const groupes = new Map();
  const aRetirer = [];
  groupe.children.forEach(o => {
    if (!o.isMesh) return;
    const m = o.material;
    if (Array.isArray(m) || m.map || m.transparent || m.bumpMap || m.vertexColors) return;
    o.updateMatrix();
    const cle = `${m.uuid}|${o.castShadow ? 1 : 0}`;
    if (!groupes.has(cle)) groupes.set(cle, { materiau: m, ombre: o.castShadow, geos: [] });
    const g = o.geometry.clone();
    g.applyMatrix4(o.matrix);
    groupes.get(cle).geos.push(g);
    aRetirer.push(o);
  });
  aRetirer.forEach(o => groupe.remove(o));
  groupes.forEach(({ materiau, ombre, geos }) => {
    const mesh = new THREE.Mesh(fusionnerGeometries(geos), materiau);
    mesh.castShadow = ombre;
    mesh.receiveShadow = true;
    groupe.add(mesh);
  });
}
/* Objets identiques répétés (même géométrie, même matériau) : un seul InstancedMesh
   par type, dessiné en un appel. Utilisé pour ce que la fusion ne peut pas regrouper :
   écrans d'ordinateur, pictogrammes… (objets texturés). */
function instancierRepetitions(racine, minimum = 3) {
  racine.updateMatrixWorld(true);
  const versRacine = new THREE.Matrix4().copy(racine.matrixWorld).invert();
  const familles = new Map();
  racine.traverse(o => {
    if (!o.isMesh || o.isInstancedMesh || o.userData.dynamique || Array.isArray(o.material)) return;
    const cle = `${o.geometry.uuid}|${o.material.uuid}|${o.castShadow ? 1 : 0}`;
    if (!familles.has(cle)) familles.set(cle, []);
    familles.get(cle).push(o);
  });
  let remplaces = 0;
  familles.forEach(liste => {
    if (liste.length < minimum) return;
    const modele = liste[0];
    const inst = new THREE.InstancedMesh(modele.geometry, modele.material, liste.length);
    liste.forEach((o, i) => {
      inst.setMatrixAt(i, new THREE.Matrix4().multiplyMatrices(versRacine, o.matrixWorld));
      o.parent.remove(o);
    });
    inst.instanceMatrix.needsUpdate = true;
    inst.castShadow = modele.castShadow;
    inst.receiveShadow = modele.receiveShadow;
    inst.frustumCulled = false;             // r128 ne tient pas compte de la position des instances pour le culling
    inst.renderOrder = modele.renderOrder;
    racine.add(inst);
    figer(inst);
    remplaces += liste.length;
  });
  return remplaces;
}
// Matériaux dont les objets peuvent être fusionnés sans changer le rendu
function fusionnable(m) {
  if (Array.isArray(m) || m.vertexColors) return false;
  if (m.isMeshLambertMaterial || m.isMeshStandardMaterial) return !m.map && (!m.transparent || m.depthWrite === false);
  if (m.isMeshBasicMaterial) return !m.map || !!m.userData.atlas;
  return false;
}
function figer(o) { o.updateMatrix(); o.matrixAutoUpdate = false; }
/* Décor : les objets d'une même matière (mat, brillant, métal, tissu) partagent un seul matériau,
   quelle que soit leur couleur ; la couleur est conservée dans la géométrie (couleurs par sommet).
   Un étage entier tient ainsi en quelques appels de dessin au lieu d'un par teinte. */
const materiauxDecor = new Map();
function proprietesTeinte(teinte) {
  const p = PROPRIETES_MATIERES[teinte] || {};
  const tissu = TEINTES_TISSU.has(teinte);
  return { roughness: tissu ? 0.95 : p.roughness ?? 0.82, metalness: p.metalness ?? 0, tissu };
}
function materiauDecor(teinte) {
  const p = proprietesTeinte(teinte);
  const cle = `${p.roughness}|${p.metalness}|${p.tissu}`;
  if (!materiauxDecor.has(cle)) {
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: p.roughness, metalness: p.metalness });
    if (p.tissu && TEXTURES.tissu) { m.bumpMap = texture(TEXTURES.tissu, 4, 4); m.bumpScale = 0.0025; }
    m.userData.decor = true;
    materiauxDecor.set(cle, m);
  }
  return materiauxDecor.get(cle);
}
function fusionnerDecor(racine) {
  racine.updateMatrixWorld(true);
  // Géométries exprimées dans le repère de la racine (les niveaux sont décalés en hauteur)
  const versRacine = new THREE.Matrix4().copy(racine.matrixWorld).invert();
  const groupes = new Map();
  const aRetirer = [];
  racine.traverse(o => {
    if (!o.isMesh || o.isInstancedMesh || o.userData.dynamique) return;
    const m = o.material;
    if (!fusionnable(m)) return;
    const materiau = m.userData.teinte !== undefined ? materiauDecor(m.userData.teinte) : m;
    const cle = `${materiau.uuid}|${o.castShadow ? 1 : 0}|${o.renderOrder}`;
    if (!groupes.has(cle)) groupes.set(cle, { materiau, ombre: o.castShadow, geos: [], couleurs: [] });
    const g = o.geometry.clone();
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(versRacine, o.matrixWorld));
    groupes.get(cle).geos.push(g);
    groupes.get(cle).couleurs.push(m.color);
    aRetirer.push(o);
  });
  aRetirer.forEach(o => o.parent.remove(o));
  groupes.forEach(({ materiau, ombre, geos, couleurs }) => {
    const geo = fusionnerGeometries(geos);
    if (materiau.userData.decor) {
      const c = new Float32Array(geo.attributes.position.count * 3);
      let k = 0;
      geos.forEach((g, i) => { for (let v = 0; v < g.attributes.position.count; v++, k++) { c[k * 3] = couleurs[i].r; c[k * 3 + 1] = couleurs[i].g; c[k * 3 + 2] = couleurs[i].b; } });
      geo.setAttribute("color", new THREE.BufferAttribute(c, 3));
    }
    const mesh = new THREE.Mesh(geo, materiau);
    mesh.castShadow = ombre;
    mesh.receiveShadow = true;
    racine.add(mesh);
    figer(mesh);
  });
}

/* ---------- A7 bis. Mobilier de bureau ---------- */
function creerPlante(grande = false) {
  const g = new THREE.Group();
  const k = grande ? 1.55 : 1;
  g.add(pos(cylindre(0.2 * k, 0.16 * k, 0.42 * k, 0x34312d, 24), 0, 0.21 * k, 0));
  g.add(pos(cylindre(0.205 * k, 0.205 * k, 0.03, 0x4a4640, 24), 0, 0.42 * k, 0));
  g.add(pos(cylindre(0.18 * k, 0.18 * k, 0.02, 0x3b2a1e, 20), 0, 0.425 * k, 0));
  const verts = [0x2f5a2e, 0x3d6b35, 0x4a7a3c, 0x356233];
  if (grande) {
    // Ficus : tronc fin et feuillage en grappes
    g.add(pos(cylindre(0.025, 0.035, 1.1, 0x5a4634, 8), 0, 0.95, 0));
    for (let i = 0; i < 14; i++) {
      const a = i * 2.4, r = 0.12 + hasard(i, 7) * 0.22, y = 1.15 + hasard(i, 3) * 0.75;
      const f = maillage(new THREE.SphereGeometry(0.16 + hasard(i, 5) * 0.08, 14, 10), verts[i % verts.length]);
      f.scale.set(1, 0.75, 1);
      g.add(pos(f, Math.cos(a) * r, y, Math.sin(a) * r));
    }
  } else {
    // Plante d'intérieur : feuilles allongées en éventail
    for (let i = 0; i < 12; i++) {
      const a = i * 2.39996, inc = 0.35 + hasard(i, 2) * 0.55, l = 0.32 + hasard(i, 4) * 0.18;
      const f = maillage(new THREE.SphereGeometry(1, 10, 8), verts[i % verts.length]);
      f.scale.set(0.055, l / 2, 0.018);
      const support = new THREE.Group();
      support.position.set(0, 0.44, 0);
      support.rotation.set(Math.sin(a) * inc, 0, Math.cos(a) * inc);
      f.position.y = l / 2;
      support.add(f);
      g.add(support);
    }
  }
  return g;
}
function planteEn(g, x, z, grande = false) {
  g.add(pos(creerPlante(grande), x, 0, z));
  obstacleCercle(x, z, grande ? 0.4 : 0.3);
}
function creerChaise(g, x, z, a = 0, couleur = 0x1f2937) {
  const c = new THREE.Group();
  c.add(pos(boite(0.46, 0.07, 0.46, couleur), 0, 0.48, 0));
  c.add(pos(boite(0.46, 0.5, 0.07, couleur), 0, 0.76, -0.22));
  c.add(pos(cylindre(0.035, 0.035, 0.44, 0x6b7280, 6), 0, 0.24, 0));
  c.add(pos(boite(0.5, 0.03, 0.5, 0x4b5563), 0, 0.03, 0));
  c.rotation.y = a;
  g.add(pos(c, x, 0, z));
}
function creerBureau(g, x, z, ecranTexte = "Veltis One", chaise = true) {
  g.add(pos(boite(1.7, 0.06, 0.8, 0xe7e2da), x, 0.76, z));
  g.add(pos(boite(1.7, 0.5, 0.04, 0xd6d3d1), x, 0.5, z - 0.38));
  [[-0.8, 0], [0.8, 0]].forEach(([dx]) => g.add(pos(boite(0.05, 0.74, 0.76, 0x9ca3af), x + dx, 0.37, z)));
  g.add(pos(boite(0.7, 0.42, 0.04, 0x111827), x, 1.08, z - 0.2));
  // Postes ordinaires : une application de travail ; postes particuliers : leur intitulé
  const ecran = ecranTexte === "Veltis One"
    ? new THREE.Mesh(geoPlan(0.62, 0.34), materiauAppli(APPLIS[Math.floor(hasard(x, z, 4) * APPLIS.length)]))
    : panneauTexte(0.62, 0.34, {
      largeur: 248, hauteur: 136, fond: "#f1f5f9", bandeau: "#1e3a8a",
      lignes: [{ texte: ecranTexte, taille: 22, gras: 700, couleur: "#1e3a8a" }, { texte: "▮▮▮▯  ▮▮▯▯  ▮▮▮▮", taille: 18, gras: 600, couleur: "#64748b" }], y: 48
    });
  ecran.position.set(x, 1.08, z - 0.177);
  g.add(ecran);
  g.add(pos(boite(0.06, 0.2, 0.06, 0x374151), x, 0.88, z - 0.24));
  g.add(pos(boite(0.42, 0.02, 0.16, 0x374151), x, 0.8, z + 0.12));
  g.add(pos(boite(0.24, 0.03, 0.3, 0xf8fafc, false), x - 0.5, 0.8, z + 0.05));
  g.add(pos(cylindre(0.04, 0.035, 0.1, 0xf5f5f4, 8), x + 0.6, 0.84, z - 0.05));
  if (chaise) creerChaise(g, x, z + 0.78, O);
  accessoiresBureau(g, x, z);
  obstacleBoite(x, z, 0.88, 0.42);
}
function creerTableReunion(g, x, z, w, d, chaises) {
  g.add(pos(boite(w, 0.07, d, 0xd6cfc4), x, 0.75, z));
  g.add(pos(boite(w * 0.6, 0.7, 0.12, 0x4b5563), x, 0.36, z));
  g.add(pos(boite(0.3, 0.03, 0.2, 0x111827, false), x, 0.8, z));
  chaises.forEach(([cx, cz, a]) => creerChaise(g, cx, cz, a, 0x374151));
  obstacleBoite(x, z, w / 2, d / 2);
}
function creerEcranMural(g, x, z, a, lignes) {
  const p = panneauTexte(1.9, 1.05, { largeur: 400, hauteur: 220, fond: "#0f172a", lignes });
  p.rotation.y = a;
  p.position.set(x, 1.55, z);
  g.add(p);
}
function creerCanape(g, x, z, a, couleur = 0x475569) {
  const c = new THREE.Group();
  c.add(pos(boite(1.9, 0.42, 0.8, couleur), 0, 0.21, 0));
  c.add(pos(boite(1.9, 0.5, 0.18, couleur), 0, 0.62, -0.34));
  [-1, 1].forEach(s => c.add(pos(boite(0.16, 0.56, 0.8, couleur), s * 0.95, 0.28, 0)));
  c.rotation.y = a;
  g.add(pos(c, x, 0, z));
  const vertical = Math.abs(Math.sin(a)) > 0.5;
  obstacleBoite(x, z, vertical ? 0.4 : 1.0, vertical ? 1.0 : 0.4);
}
function creerTableBasse(g, x, z) {
  g.add(pos(boite(1.3, 0.05, 0.7, 0xb59b7c), x, 0.4, z));
  g.add(pos(boite(1.1, 0.36, 0.5, 0x6b5b4b), x, 0.2, z));
  obstacleBoite(x, z, 0.65, 0.35);
}
function creerTableHaute(g, x, z) {
  g.add(pos(cylindre(0.42, 0.42, 0.05, 0xe7e2da, 18), x, 1.06, z));
  g.add(pos(cylindre(0.05, 0.05, 1.04, 0x374151, 8), x, 0.52, z));
  g.add(pos(cylindre(0.28, 0.28, 0.03, 0x374151, 14), x, 0.02, z));
  g.add(pos(cylindre(0.05, 0.04, 0.12, 0xf8fafc, 8), x + 0.12, 1.14, z + 0.08));
  obstacleCercle(x, z, 0.42);
}
function creerComptoirCafe(g) {
  g.add(pos(boite(0.62, 0.92, 3.6, 0xe7e2da), -7.22, 0.46, 6.2));
  g.add(pos(boite(0.66, 0.05, 3.64, 0x57534e), -7.22, 0.94, 6.2));
  g.add(pos(boite(0.45, 0.55, 0.45, 0x1f2937), -7.25, 1.24, 5.4));
  g.add(pos(boite(0.45, 0.55, 0.45, 0x27272a), -7.25, 1.24, 6.4));
  g.add(pos(boite(0.62, 1.9, 0.7, 0xd4d4d8), -7.22, 0.95, 8.4));
  g.add(pos(boite(0.05, 0.6, 1.4, 0x0f172a, false), -7.52, 1.7, 6.1));
  const carte = panneauTexte(1.3, 0.5, { largeur: 260, hauteur: 100, fond: "#0f172a", lignes: [{ texte: (EN ? "CAFETERIA" : "CAFÉTÉRIA"), taille: 34, gras: 800, couleur: "#ffffff" }, { texte: (EN ? "Coffee area · Level 1" : "Espace café · R+1"), taille: 18, gras: 500, couleur: "#cbd5e1" }] });
  carte.rotation.y = O / 2;
  carte.position.set(-7.49, 1.7, 6.1);
  g.add(carte);
  obstacleBoite(-7.22, 6.75, 0.34, 2.4);
}
function creerImprimante(g, x, z) {
  g.add(pos(boite(0.9, 0.9, 0.62, 0xe5e7eb), x, 0.45, z));
  g.add(pos(boite(0.8, 0.12, 0.5, 0x9ca3af), x, 0.96, z));
  g.add(pos(boite(0.3, 0.03, 0.2, 0x1e3a8a, false), x + 0.25, 0.91, z + 0.32));
  obstacleBoite(x, z, 0.47, 0.33);
}
function creerFontaineEau(g, x, z) {
  g.add(pos(boite(0.36, 1.0, 0.36, 0xe5e7eb), x, 0.5, z));
  g.add(pos(cylindre(0.15, 0.15, 0.36, 0x93c5fd, 12), x, 1.18, z));
  obstacleCercle(x, z, 0.25);
}
function creerEtagere(g, x, z, a, longueur = 1.8) {
  const e = new THREE.Group();
  e.add(pos(boite(longueur, 1.9, 0.38, 0xb59b7c), 0, 0.95, 0));
  const livres = [0x1e3a8a, 0x7c2d12, 0x334155, 0x0f766e, 0xa16207, 0x6b2140];
  for (let r = 0; r < 4; r++) {
    for (let i = 0; i < 7; i++) {
      const h = 0.22 + hasard(i, r, x) * 0.12;
      e.add(pos(boite(longueur / 9, h, 0.26, livres[(i + r * 2) % livres.length], false), -longueur / 2 + 0.2 + i * longueur / 8, 0.2 + r * 0.45 + h / 2, 0.04));
    }
  }
  e.rotation.y = a;
  g.add(pos(e, x, 0, z));
  const vertical = Math.abs(Math.sin(a)) > 0.5;
  obstacleBoite(x, z, vertical ? 0.22 : longueur / 2, vertical ? longueur / 2 : 0.22);
}
function creerRangement(g, x, z, longueur, vertical = false) {
  g.add(pos(boite(vertical ? 0.45 : longueur, 0.75, vertical ? longueur : 0.45, 0xd6d3d1), x, 0.375, z));
  g.add(pos(boite(vertical ? 0.47 : longueur + 0.02, 0.03, vertical ? longueur + 0.02 : 0.47, 0x9ca3af), x, 0.765, z));
  obstacleBoite(x, z, vertical ? 0.24 : longueur / 2, vertical ? longueur / 2 : 0.24);
}
function creerCabine(g, x1, x2, z1, z2) {
  const h = 2.3;
  g.add(dalle(x1, x2, z1, z2, 0x64748b, 0.03));
  [[x1, z1, x2, z1], [x1, z2, x2, z2], [x1, z1, x1, z2]].forEach(([a, b, c, d]) => murVitre(g, a, b, c, d, h, 0x334155));
  g.add(pos(boite(x2 - x1, 0.08, z2 - z1, 0x334155), (x1 + x2) / 2, h, (z1 + z2) / 2));
  g.add(pos(boite(0.4, 0.05, 0.5, 0xe7e2da), x1 + 0.35, 0.95, (z1 + z2) / 2));
}
function creerBanqueAccueil(g, x, z) {
  g.add(pos(boite(3.0, 1.1, 0.5, 0xe7e2da), x, 0.55, z));
  g.add(pos(boite(3.1, 0.06, 0.62, 0x57534e), x, 1.12, z));
  const logo = panneauTexte(1.6, 0.3, { largeur: 320, hauteur: 60, fond: "#0f172a", lignes: [{ texte: "VELTIS · ACCUEIL", taille: 30, gras: 800, couleur: "#ffffff" }] });
  logo.position.set(x, 0.6, z - 0.26);
  logo.rotation.y = O;
  g.add(logo);
  g.add(pos(boite(0.55, 0.36, 0.04, 0x111827), x + 0.6, 1.3, z + 0.1));
  creerChaise(g, x, z + 0.75, O);
  obstacleBoite(x, z, 1.55, 0.3);
}
function creerTableau(g, x, z, a, lignes) {
  const t = panneauTexte(2.6, 1.25, { largeur: 520, hauteur: 250, fond: "#ffffff", lignes });
  t.rotation.y = a;
  t.position.set(x, 1.55, z);
  g.add(t);
  const cadre = boite(2.75, 1.4, 0.05, 0x9ca3af);
  cadre.rotation.y = a;
  g.add(pos(cadre, x - Math.sin(a) * 0.03, 1.55, z - Math.cos(a) * 0.03));
  [-1.2, 1.2].forEach(dx => g.add(pos(boite(0.05, 0.85, 0.05, 0x6b7280), x + dx * Math.cos(a), 0.42, z - dx * Math.sin(a))));
  obstacleBoite(x, z, Math.abs(Math.cos(a)) * 1.35 + 0.1, Math.abs(Math.sin(a)) * 1.35 + 0.1);
}

/* ---------- A8. Cloisons, salles et étage Veltis ---------- */
const collegues = {};
// Cloison vitrée de x1,z1 à x2,z2 (segments horizontaux ou verticaux)
function murVitre(g, x1, z1, x2, z2, h = HAUTEUR_MUR, cadre = 0x1c1c1c) {
  const l = Math.hypot(x2 - x1, z2 - z1);
  if (l < 0.05) return;
  const vertical = Math.abs(x2 - x1) < 0.01;
  const cx = (x1 + x2) / 2, cz = (z1 + z2) / 2;
  const verre = new THREE.Mesh(new THREE.BoxGeometry(vertical ? 0.05 : l, h - 0.12, vertical ? l : 0.05), materiauVerre);
  verre.position.set(cx, h / 2, cz);
  g.add(verre);
  g.add(pos(boite(vertical ? 0.08 : l, 0.06, vertical ? l : 0.08, cadre), cx, h - 0.03, cz));
  g.add(pos(boite(vertical ? 0.08 : l, 0.08, vertical ? l : 0.08, cadre), cx, 0.04, cz));
  const n = Math.max(1, Math.round(l / 1.4));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    g.add(pos(boite(0.06, h, 0.06, cadre), x1 + (x2 - x1) * t, h / 2, z1 + (z2 - z1) * t));
  }
  obstacleBoite(cx, cz, vertical ? 0.08 : l / 2, vertical ? l / 2 : 0.08);
}
// Cloison avec une ouverture de largeur `porte` centrée en `centre`
function murAvecPorte(g, x1, z1, x2, z2, centre, porte = 1.4) {
  const vertical = Math.abs(x2 - x1) < 0.01;
  if (vertical) {
    murVitre(g, x1, z1, x1, centre - porte / 2);
    murVitre(g, x1, centre + porte / 2, x1, z2);
  } else {
    murVitre(g, x1, z1, centre - porte / 2, z1);
    murVitre(g, centre + porte / 2, z1, x2, z1);
  }
}
function plaqueSalle(g, s, sous) {
  const p = panneauTexte(1.5, 0.36, { largeur: 300, hauteur: 72, fond: "#0f172a", lignes: [{ texte: s.nom.toUpperCase(), taille: 26, gras: 800, couleur: "#ffffff" }, { texte: sous, taille: 17, gras: 500, couleur: "#cbd5e1" }] });
  if (s.porte === "sud") p.position.set(s.x + 1.6, 2.2, s.maxZ + 0.06);
  else { p.rotation.y = -O / 2; p.position.set(s.minX - 0.06, 2.2, s.z - 1.6); }
  g.add(p);
}
function construireSalle(g, s) {
  const sol = { client: 0x8f9bab, reunion: 0x8f9bab, bureau: 0xa8a29e }[s.type];
  g.add(solTexture(s.minX, s.maxX, s.minZ, s.maxZ, s.type === "bureau" ? "parquet" : "moquette", 0.03, s.type === "bureau" ? 0xffffff : 0x6f7a8c));
  if (s.porte === "sud") {
    murAvecPorte(g, s.minX, s.maxZ, s.maxX, s.maxZ, s.x);
    murVitre(g, s.minX, s.minZ, s.minX, s.maxZ);
    murVitre(g, s.maxX, s.minZ, s.maxX, s.maxZ);
  } else {
    murAvecPorte(g, s.minX, s.minZ, s.minX, s.maxZ, s.z);
    murVitre(g, s.minX, s.minZ, s.maxX, s.minZ);
    murVitre(g, s.minX, s.maxZ, s.maxX, s.maxZ);
  }
  if (s.type === "client") {
    const vertical = s.porte === "ouest";
    const tx = vertical ? s.x + 0.4 : s.x, tz = vertical ? s.z : s.z - 0.4;
    const w = vertical ? 1.2 : 2.4, d = vertical ? 2.4 : 1.2;
    const chaises = vertical
      ? [[tx - 0.9, tz - 0.6, O / 2], [tx - 0.9, tz + 0.6, O / 2], [tx + 0.9, tz - 0.6, -O / 2], [tx + 0.9, tz + 0.6, -O / 2]]
      : [[tx - 0.6, tz - 0.9, 0], [tx + 0.6, tz - 0.9, 0], [tx - 0.6, tz + 0.9, O], [tx + 0.6, tz + 0.9, O]];
    creerTableReunion(g, tx, tz, w, d, chaises);
    if (vertical) creerEcranMural(g, s.maxX - 0.08, s.z, -O / 2, [{ texte: "VELTIS ONE", taille: 40, gras: 800, couleur: "#ffffff" }, { texte: (EN ? "Client presentation" : "Présentation client"), taille: 22, gras: 500, couleur: "#94a3b8" }]);
    else creerEcranMural(g, s.x, s.minZ + 0.08, 0, [{ texte: "VELTIS ONE", taille: 40, gras: 800, couleur: "#ffffff" }, { texte: (EN ? "Client presentation" : "Présentation client"), taille: 22, gras: 500, couleur: "#94a3b8" }]);
    planteEn(g, vertical ? s.maxX - 0.4 : s.minX + 0.45, vertical ? s.minZ + 0.45 : s.minZ + 0.45);
    plaqueSalle(g, s, (EN ? "Client room" : "Salon client"));
  } else if (s.type === "reunion") {
    creerTableReunion(g, 16.9, 0.8, 2.6, 1.8, LIEUX.agora.map(l => [l.x, l.z, l.a]));
    creerEcranMural(g, s.maxX - 0.08, 0.8, -O / 2, [{ texte: (EN ? "PIPELINE REVIEW" : "REVUE DU PIPELINE"), taille: 30, gras: 800, couleur: "#ffffff" }, { texte: (EN ? "Prospects · Leads · Opportunities · Customers" : "Prospects · Leads · Opportunités · Clients"), taille: 17, gras: 500, couleur: "#94a3b8" }]);
    plaqueSalle(g, s, (EN ? "Team meetings" : "Réunions d'équipe"));
  } else {
    creerBureau(g, s.x, -11.4, s.cle === "dg" ? (EN ? "Management" : "Pilotage") : (EN ? "Team pipeline" : "Pipeline équipe"));
    creerChaise(g, s.x - 0.5, -12.35, 0, 0x57534e);
    creerChaise(g, s.x + 0.5, -12.35, 0, 0x57534e);
    creerEtagere(g, s.minX + 0.3, -10.8, O / 2, 1.6);
    planteEn(g, s.maxX - 0.45, -9.1);
    plaqueSalle(g, s, s.cle === "dg" ? "Catherine Aubert" : "Sandrine Morel");
  }
}

function construireEtage() {
  const g = new THREE.Group();
  // Sols : béton ciré, parquet de chêne dans les circulations, moquette en dalles dans les bureaux
  g.add(solTexture(FACADE.minX, FACADE.maxX, FACADE.minZ, FACADE.maxZ, "beton", 0.0, 0xb2aca3));
  const parquet = (minX, maxX, minZ, maxZ, y) => g.add(solTexture(minX, maxX, minZ, maxZ, "parquet", y));
  const moquette = (minX, maxX, minZ, maxZ, couleur, joint, y = 0.015) => g.add(solTexture(minX, maxX, minZ, maxZ, "moquette", y, couleur));
  moquette(PLATEAU.minX, PLATEAU.maxX, PLATEAU.minZ, PLATEAU.maxZ, 0x7a828e, 0);
  moquette(ESPACE_CS.minX, ESPACE_CS.maxX, ESPACE_CS.minZ, ESPACE_CS.maxZ, 0x7a828e, 0);
  moquette(ZONE_SALON.minX, ZONE_SALON.maxX, ZONE_SALON.minZ, ZONE_SALON.maxZ, 0x56637a, 0);
  g.add(solTexture(CAFETERIA.minX, CAFETERIA.maxX, CAFETERIA.minZ, CAFETERIA.maxZ, "terrazzo", 0.015));
  parquet(DETENTE.minX, DETENTE.maxX, DETENTE.minZ, DETENTE.maxZ, 0.015);
  parquet(-AXE, AXE, -8.6, FACADE.maxZ, 0.016);
  parquet(ACCUEIL.minX, ACCUEIL.maxX, ACCUEIL.minZ, ACCUEIL.maxZ, 0.014);
  g.add(dalle(-15.9, -13.5, 9.1, 10.7, 0x7c2d12, 0.025));

  // Façade vitrée toute hauteur : vue sur l'esplanade de La Défense
  const F = FACADE;
  const facade = (x1, z1, x2, z2, h) => {
    const vertical = Math.abs(x2 - x1) < 0.01, l = Math.hypot(x2 - x1, z2 - z1);
    const v = new THREE.Mesh(new THREE.BoxGeometry(vertical ? 0.04 : l, h, vertical ? l : 0.04), materiauVerre);
    v.position.set((x1 + x2) / 2, h / 2, (z1 + z2) / 2);
    g.add(v);
    for (let t = 0; t <= l; t += 1.5) g.add(pos(boite(0.07, h, 0.07, 0x1c1c1c), x1 + (x2 - x1) * t / l, h / 2, z1 + (z2 - z1) * t / l));
    g.add(pos(boite(vertical ? 0.1 : l, 0.08, vertical ? l : 0.1, 0x1c1c1c), (x1 + x2) / 2, h - 0.04, (z1 + z2) / 2));
    g.add(pos(boite(vertical ? 0.24 : l, 0.12, vertical ? l : 0.24, 0x2a2724), (x1 + x2) / 2, 0.06, (z1 + z2) / 2));
  };
  facade(F.minX, F.minZ, F.maxX, F.minZ, HAUTEUR_PLAFOND);
  facade(F.minX, F.minZ, F.minX, F.maxZ, HAUTEUR_PLAFOND);
  facade(F.maxX, F.minZ, F.maxX, F.maxZ, HAUTEUR_PLAFOND);
  facade(F.minX, F.maxZ, F.maxX, F.maxZ, HAUTEUR_PLAFOND);

  // Plafond et éclairage : dalles LED dans les bureaux, lignes lumineuses dans les circulations
  const plafond = new THREE.Mesh(new THREE.PlaneGeometry(F.maxX - F.minX, F.maxZ - F.minZ), new THREE.MeshStandardMaterial({ map: texture(TEXTURES.plafond, (F.maxX - F.minX) / 1.2, (F.maxZ - F.minZ) / 1.2), color: 0xffffff, roughness: 0.92, emissive: 0x3a3936 }));
  plafond.rotation.x = Math.PI / 2;
  plafond.position.set((F.minX + F.maxX) / 2, HAUTEUR_PLAFOND, (F.minZ + F.maxZ) / 2);
  plafond.userData.dynamique = true;
  groupeR1.add(plafond);
  const materiauLed = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 3.15, 3.05), toneMapped: false });
  const led = (x, z, w, d) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), materiauLed);
    m.rotation.x = Math.PI / 2;
    m.position.set(x, HAUTEUR_PLAFOND - 0.01, z);
    groupeR1.add(m);
  };
  [-15.6, -13.0, -10.4, -7.8].forEach(x => [-3.9, -1.0, 1.9].forEach(z => led(x, z + 0.2, 1.2, 0.3)));
  led(0, 1.8, 0.12, 20);
  led(0, -7.4, 30, 0.12);
  led(13.6, -1.5, 0.12, 12);
  [[-4.4, 6.6], [-4.4, 9.0], [-14.7, 9.9], [8.15, 8.2], [11.8, 10.6], [16.4, 7.0], [8.15, -2.0], [8.15, 1.6], [5.6, -0.5], [10.7, -0.5]].forEach(([x, z]) => led(x, z, 0.6, 0.6));
  SALLES.forEach(sa => led(sa.x, sa.z, 1.2, 0.3));
  // Lumières d'ambiance chaudes
  [[-4.4, 2.6, 7.8], [8.15, 2.6, 9.0], [-14.2, 2.6, 9.0], [8.15, 2.6, -0.5]].forEach(([x, y, z]) => {
    const l = new THREE.PointLight(0xffe0b5, 0.55, 14, 2);
    l.position.set(x, y, z);
    groupeR1.add(l);
  });

  // Poteaux en béton
  [[-4.7, -7.4], [5.0, -7.4], [13.6, -7.4], [-4.7, 4.05], [13.6, 4.8]].forEach(([x, z]) => {
    g.add(pos(cylindre(0.28, 0.28, HAUTEUR_PLAFOND, 0xbdb7ae, 20), x, HAUTEUR_PLAFOND / 2, z));
    obstacleCercle(x, z, 0.3);
  });

  // Mur de marque et panneaux acoustiques face à l'allée centrale
  panneauMarque(g, 1.89, 1.85, 7.4, -Math.PI / 2, 1.7, 0.74);
  [8.8, 9.8, 10.8].forEach((z, i) => g.add(pos(boite(0.04, 1.1, 0.8, [0x7c2d12, 0x334155, 0x0f766e][i]), 1.88, 1.6, z)));

  // Pièces fermées
  SALLES.forEach(s => construireSalle(g, s));

  // Open space commercial
  [-15.6, -13.0, -10.4, -7.8].forEach(x => [-3.9, -1.0, 1.9].forEach(z => {
    const estPoste = x === POSTE.x && z === POSTE.z;
    creerBureau(g, x, z, estPoste ? (EN ? "Your CRM" : "Votre CRM") : "Veltis One");
  }));
  creerTableau(g, -11.7, -5.85, 0, [
    { texte: (EN ? "QUARTERLY TARGETS" : "OBJECTIFS DU TRIMESTRE"), taille: 32, gras: 800 },
    { texte: "ARR +18 %   ·   NPS ≥ 45", taille: 26, gras: 600, couleur: "#1e3a8a" },
    { texte: "Churn < 5 %   ·   Cycle < 45 j", taille: 26, gras: 600, couleur: "#1e3a8a" }
  ]);
  creerRangement(g, -18.2, -1.0, 4.2, true);
  creerRangement(g, -6.0, -5.8, 2.0);
  planteEn(g, -18.1, -5.7, true);
  planteEn(g, -5.1, 3.0, true);
  planteEn(g, -18.1, 3.0, true);
  const enseigne = panneauTexte(3.2, 0.42, { largeur: 640, hauteur: 84, fond: "#0f172a", lignes: [{ texte: (EN ? "VELTIS · Sales open space" : "VELTIS · Open space commercial"), taille: 32, gras: 700, couleur: "#ffffff" }] });
  enseigne.position.set(-11.7, 2.7, 3.45);
  g.add(enseigne);

  // Services : imprimante, fontaine à eau
  creerImprimante(g, -3.55, -5.0);
  creerRangement(g, -3.55, -6.4, 1.2);
  creerFontaineEau(g, -3.55, 1.6);

  // Cafétéria
  creerComptoirCafe(g);
  creerTableHaute(g, -4.4, 6.6);
  creerTableHaute(g, -4.4, 9.0);
  creerCanape(g, -4.8, 11.6, O, 0x7c2d12);
  planteEn(g, -2.7, 4.9);
  planteEn(g, -2.7, 11.8);

  // Espace détente et bibliothèque, cabines téléphoniques
  creerCanape(g, -14.7, 8.9, 0, 0x475569);
  creerCanape(g, -14.7, 10.9, O, 0x475569);
  creerTableBasse(g, -14.7, 9.9);
  creerEtagere(g, -11.6, 7.0, -O / 2, 2.4);
  creerEtagere(g, -11.6, 10.6, -O / 2, 2.4);
  planteEn(g, -9.0, 5.6, true);
  planteEn(g, -12.6, 11.9);
  creerCabine(g, -18.95, -16.9, 9.3, 10.9);
  creerCabine(g, -18.95, -16.9, 10.9, 12.3);

  // Forum événementiel : cloisons vitrées, entrée au sud
  const Z = ZONE_SALON;
  murVitre(g, Z.minX, Z.minZ, Z.maxX, Z.minZ);
  murVitre(g, Z.minX, Z.minZ, Z.minX, Z.maxZ);
  murVitre(g, Z.maxX, Z.minZ, Z.maxX, Z.maxZ);
  murVitre(g, Z.minX, Z.maxZ, ENTREE_FORUM.minX, Z.maxZ);
  murVitre(g, ENTREE_FORUM.maxX, Z.maxZ, Z.maxX, Z.maxZ);
  const forum = panneauTexte(2.6, 0.42, { largeur: 520, hauteur: 84, fond: "#0f172a", lignes: [{ texte: (EN ? "VELTIS FORUM" : "FORUM VELTIS"), taille: 34, gras: 800, couleur: "#ffffff" }, { texte: (EN ? "Event space" : "Espace événementiel"), taille: 18, gras: 500, couleur: "#cbd5e1" }] });
  forum.position.set(5.2, 2.35, Z.maxZ + 0.06);
  g.add(forum);

  // Accueil et ascenseurs
  creerAscenseurs(g, 1);
  creerBanqueAccueil(g, 8.15, 7.6);
  creerCanape(g, 12.6, 10.6, -O / 2, 0x334155);
  creerTableBasse(g, 11.4, 10.6);
  planteEn(g, 4.2, 11.8, true);
  planteEn(g, 13.9, 6.0, true);

  // Espace Customer Success
  creerRangement(g, 18.6, 7.7, 3.0, true);
  planteEn(g, 15.2, 11.8);
  const cs = panneauTexte(2.2, 0.38, { largeur: 440, hauteur: 76, fond: "#0f172a", lignes: [{ texte: "CUSTOMER SUCCESS", taille: 30, gras: 800, couleur: "#ffffff" }] });
  cs.position.set(16.9, 2.5, 4.05);
  g.add(cs);
  creerBureau(g, COLLEGUES_DEF.success.poste.x, COLLEGUES_DEF.success.poste.z, (EN ? "Customer health" : "Santé clients"));
  creerBureau(g, COLLEGUES_DEF.fatou.poste.x, COLLEGUES_DEF.fatou.poste.z, (EN ? "Customer health" : "Santé clients"));
  bandeauNiveau(g);

  groupeR1.add(g);
}

function creerGrandeArche() {
  const g = new THREE.Group();
  const L = 17, H = 17, P = 5, e = 2.4;
  const marbre = 0xf1f5f9, vitre = 0x93aac2;
  g.add(pos(boite(L, e, P, marbre, false), 0, H - e / 2, 0));
  g.add(pos(boite(L, e * 0.6, P, marbre, false), 0, e * 0.3 + 1.6, 0));
  [-1, 1].forEach(s => {
    g.add(pos(boite(e, H, P, marbre, false), s * (L - e) / 2, H / 2, 0));
    g.add(pos(boite(0.08, H - 2 * e, P - 0.6, vitre, false), s * (L / 2 - e - 0.04), H / 2 + 0.4, 0));
  });
  for (let y = 4; y < H - e; y += 1.4) g.add(pos(boite(L - 2 * e, 0.08, 0.08, 0xcbd5e1, false), 0, y, P / 2));
  // « Nuage » sous l'arche
  const nuage = maillage(new THREE.BoxGeometry(L * 0.5, 0.25, P * 0.7), new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.75 }), false);
  g.add(pos(nuage, 0, 5.2, 0));
  // Marches monumentales
  for (let i = 0; i < 5; i++) g.add(pos(boite(L + 6, 0.32, 1.2, 0xc4beb2, false), 0, 0.16 + i * 0.32, P / 2 + 5 - i * 1.0));
  return g;
}
function creerVoute() {
  const g = new THREE.Group();
  const voute = maillage(new THREE.SphereGeometry(1, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2), 0xe7e5e4, false);
  voute.scale.set(9, 4.5, 7);
  g.add(voute);
  g.add(pos(boite(13, 2.2, 0.08, 0x93aac2, false), 0, 1.1, 6.2));
  return g;
}
function creerTour(x, z, h, couleur, forme) {
  const g = new THREE.Group();
  if (forme === "cylindre") {
    g.add(pos(cylindre(1.7, 1.7, h, couleur, 18), 0, h / 2, 0));
    for (let y = 1.2; y < h - 0.5; y += 1.5) g.add(pos(cylindre(1.73, 1.73, 0.12, 0xe2e8f0, 18), 0, y, 0));
  } else {
    g.add(pos(boite(3.2, h, 3.2, couleur, false), 0, h / 2, 0));
    for (let y = 1.2; y < h - 0.5; y += 1.5) g.add(pos(boite(3.24, 0.1, 3.24, 0xe2e8f0, false), 0, y, 0));
    if (forme === "biseau") {
      const toit = boite(3.2, 2.6, 2.4, couleur, false);
      toit.rotation.x = 0.55;
      g.add(pos(toit, 0, h + 0.4, -0.5));
    }
    if (forme === "antenne") g.add(pos(cylindre(0.08, 0.08, 3, 0xcbd5e1, 6), 0.6, h + 1.5, 0.4));
  }
  return pos(g, x, 0, z);
}
/* Vue depuis l'immeuble Veltis : tours de La Défense et Grande Arche */

function construireDecor() {
  construireEtage();
  construireNiveaux();
  construireVille();
  construireCoques();
  scene.add(decor);
  fusionnerDecor(decor);
  ETAGES.forEach(e => { fusionnerDecor(e.groupe); instancierRepetitions(e.groupe); });
}

/* ---------- A9. Personnages ---------- */
const APPARENCES = [
  { peau: 0xf1c7a3, cheveux: 0x2b1d14, coiffure: "courte", costume: 0x1e3a5f, cravate: 0xb91c1c },
  { peau: 0xe0ac82, cheveux: 0x5a3825, coiffure: "chignon", costume: 0x374151, cravate: 0x2563eb },
  { peau: 0x8d5524, cheveux: 0x111111, coiffure: "courte", costume: 0x1f2937, cravate: 0x15803d },
  { peau: 0xf6d5bd, cheveux: 0xd6b370, coiffure: "longue", costume: 0x475569, cravate: 0x7f1d1d },
  { peau: 0xc68642, cheveux: 0x2b1d14, coiffure: "courte", costume: 0x1e40af, cravate: 0xca8a04 },
  { peau: 0xf1c7a3, cheveux: 0x9ca3af, coiffure: "courte", costume: 0x27272a, cravate: 0xc2410c },
  { peau: 0xe0ac82, cheveux: 0x111111, coiffure: "longue", costume: 0x1e3a5f, cravate: 0x6d28d9 },
  { peau: 0xf6d5bd, cheveux: 0xa0522d, coiffure: "chignon", costume: 0x52525b, cravate: 0x0f766e }
];

/* ---------- A9 bis. Personnages réalistes ----------
   Corps tourné selon des profils anatomiques (homme ou femme), visage
   sculpté (arcades, pommettes, nez, lèvres, menton), yeux avec iris et
   paupières, mains à doigts, coiffures et barbes modelées sur le crâne.
   Articulations : hanches, genoux, épaules, coudes et cou. */

// Surface de révolution à partir d'un profil [rayon, hauteur] (hauteurs croissantes)
const tour = (points, segments = 22) => new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), segments);
const gauss = (v, s) => Math.exp(-(v * v) / (s * s));
const materiauTete = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0 });
// Grain de peau (pores), appliqué en relief très léger sur les visages
function grainPeau() {
  if (materiauTete.bumpMap) return;
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const x = c.getContext("2d");
  x.fillStyle = "#808080";
  x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 5000; i++) {
    x.fillStyle = Math.random() < 0.5 ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.22)";
    x.fillRect(Math.random() * 256, Math.random() * 256, 1 + Math.random(), 1 + Math.random());
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 3);
  materiauTete.bumpMap = t;
  materiauTete.bumpScale = 0.0007;
  materiauTete.needsUpdate = true;
}
const materiauReflet = new THREE.MeshBasicMaterial({ color: 0xffffff });
const materiauBouche = new THREE.MeshBasicMaterial({ color: 0x1c0909 });
// Ombre de contact douce sous les pieds (ancre les personnes au sol)
const geoOmbreContact = new THREE.PlaneGeometry(0.85, 0.65);
const materiauOmbreContact = (() => {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const x = c.getContext("2d");
  const d = x.createRadialGradient(64, 64, 4, 64, 64, 62);
  d.addColorStop(0, "rgba(0,0,0,0.55)");
  d.addColorStop(0.55, "rgba(0,0,0,0.22)");
  d.addColorStop(1, "rgba(0,0,0,0)");
  x.fillStyle = d;
  x.fillRect(0, 0, 128, 128);
  return new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, toneMapped: false });
})();
// Mèches : seconde couche de cheveux, découpée, qui casse le contour trop lisse de la coiffure
let textureMeches = null;
const materiauxMeches = {};
function matMeches(couleur) {
  if (!textureMeches) {
    const c = document.createElement("canvas");
    c.width = 256; c.height = 64;
    const x = c.getContext("2d");
    for (let i = 0; i < 520; i++) {
      x.fillStyle = `rgba(255,255,255,${0.35 + Math.random() * 0.65})`;
      const h = 20 + Math.random() * 44;
      x.fillRect(Math.random() * 256, 64 - h, 1, h);
    }
    textureMeches = new THREE.CanvasTexture(c);
    textureMeches.wrapS = THREE.RepeatWrapping;
    textureMeches.repeat.set(5, 1);
  }
  // Un seul matériau pour tous : la couleur de chaque chevelure est portée par sa géométrie
  if (!materiauxMeches.partage) materiauxMeches.partage = new THREE.MeshStandardMaterial({ color: new THREE.Color(1.12, 1.12, 1.12), vertexColors: true, map: textureMeches, alphaTest: 0.5, roughness: 0.6, side: THREE.DoubleSide });
  return materiauxMeches.partage;
}
// Copie d'une géométrie avec une couleur par sommet (permet de partager un seul matériau)
function colorier(geo, couleur) {
  const g = geo.clone();
  const c = new THREE.Color(couleur), n = g.attributes.position.count, tab = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { tab[i * 3] = c.r; tab[i * 3 + 1] = c.g; tab[i * 3 + 2] = c.b; }
  g.setAttribute("color", new THREE.BufferAttribute(tab, 3));
  return g;
}
let materiauCheveuxRelief = null;
function reliefCheveux() {
  if (materiauCheveuxRelief) return materiauCheveuxRelief;
  const c = document.createElement("canvas");
  c.width = 256; c.height = 64;
  const x = c.getContext("2d");
  x.fillStyle = "#888";
  x.fillRect(0, 0, 256, 64);
  for (let i = 0; i < 700; i++) {
    x.fillStyle = Math.random() < 0.5 ? "rgba(255,255,255,0.18)" : "rgba(0,0,0,0.22)";
    x.fillRect(Math.random() * 256, 0, 1, 64);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(6, 1);
  materiauCheveuxRelief = t;
  return t;
}
const materiauxCheveux = {};
function matCheveux() {
  if (!materiauxCheveux.partage) materiauxCheveux.partage = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.05, bumpMap: reliefCheveux(), bumpScale: 0.0015, side: THREE.DoubleSide });
  return materiauxCheveux.partage;
}

/* Tête : sphère déformée en visage, couleurs de peau, lèvres et joues par sommet */
const cacheTetes = {};
function geometrieTete(femme, peau, rase = false, basse = false) {
  const cle = `${femme ? "f" : "h"}|${peau}|${rase ? 1 : 0}|${basse ? "b" : "h"}`;
  if (cacheTetes[cle]) return cacheTetes[cle];
  // Version basse (personnages éloignés) : 10 fois moins de triangles, mêmes formes
  const geo = basse ? new THREE.SphereGeometry(0.1, 20, 15) : new THREE.SphereGeometry(0.1, 56, 42);
  const p = geo.attributes.position;
  const teinte = new THREE.Color(peau);
  const levres = teinte.clone().lerp(new THREE.Color(femme ? 0xb5505a : 0xa86058), femme ? 0.55 : 0.4);
  const joues = teinte.clone().lerp(new THREE.Color(0xd9786e), 0.16);
  const ombrePeau = teinte.clone().multiplyScalar(0.55);
  const ombreBarbe = teinte.clone().lerp(new THREE.Color(0x3b4250), 0.32);
  const nezRouge = teinte.clone().lerp(new THREE.Color(0xd9786e), 0.12);
  const couleurs = [];
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i) * (femme ? 0.77 : 0.8), y = p.getY(i) * 1.16, z = p.getZ(i) * 0.98;
    if (y > 0.03) x *= 1 - 0.07 * (y - 0.03) / 0.086;                                          // crâne moins large en haut
    // Mâchoire et menton
    if (y < 0) {
      const k = -y / 0.116;
      x *= 1 - (femme ? 0.28 : 0.13) * k * k * (femme ? 1 : k);
      if (z < 0) z *= 1 - 0.18 * k;
    }
    if (z > 0) {
      z *= 0.96;
      z += 0.006 * gauss(y - 0.036, 0.012) * gauss(x, 0.05);                                   // arcades
      [-1, 1].forEach(s => {
        z -= 0.0095 * gauss(Math.hypot(x - s * 0.034, y - 0.017), 0.016);                      // orbites
        z += 0.0045 * gauss(Math.hypot(x - s * 0.05, y + 0.004), 0.02);                        // pommettes
      });
      const nez = (femme ? 0.024 : 0.029) * gauss(x, 0.011) * gauss(y + 0.016, 0.021) + 0.004 * gauss(x, 0.007) * gauss(y - 0.012, 0.02);
      z += nez + 0.006 * gauss(x, 0.02) * gauss(y + 0.03, 0.008);                              // nez et ailes
      z += (femme ? 0.0075 : 0.0055) * gauss(y + 0.049, 0.0075) * gauss(x, 0.021);            // lèvres
      z += 0.006 * gauss(y + 0.09, 0.016) * gauss(x, 0.022);                                   // menton
    }
    p.setXYZ(i, x, y, z);
    c.copy(teinte);
    if (z > 0.05) {
      c.lerp(levres, clamp(gauss(y + 0.049, 0.008) * gauss(x, 0.02) * 2.2, 0, 1));
      [-1, 1].forEach(s => c.lerp(joues, gauss(Math.hypot(x - s * 0.048, y + 0.012), 0.02) * 0.8));
      [-1, 1].forEach(s => c.lerp(ombrePeau, gauss(Math.hypot(x - s * 0.0095, y + 0.036), 0.0045) * 0.75));
      c.lerp(ombrePeau, gauss(y + 0.064, 0.005) * gauss(x, 0.018) * 0.35);
      c.lerp(nezRouge, gauss(x, 0.008) * gauss(y + 0.02, 0.008) * 0.7);                                   // bout du nez
      [-1, 1].forEach(s => c.lerp(ombrePeau, gauss(Math.hypot(x - s * 0.031, y - 0.022), 0.009) * 0.18)); // creux des orbites
      if (rase) {
        // Barbe de quelques heures : mâchoire, menton et lèvre supérieure légèrement grisés
        const zone = clamp((-0.03 - y) / 0.025, 0, 1) * (1 - gauss(y + 0.049, 0.008) * gauss(x, 0.022)) + gauss(y + 0.04, 0.004) * gauss(x, 0.02) * 0.6;
        c.lerp(ombreBarbe, clamp(zone, 0, 1) * 0.45);
      }
    }
    couleurs.push(c.r, c.g, c.b);
  }
  geo.setAttribute("color", new THREE.Float32BufferAttribute(couleurs, 3));
  geo.computeVertexNormals();
  cacheTetes[cle] = geo;
  return geo;
}
/* Coiffure : coque épousant le crâne, limitée par une ligne d'implantation */
const STYLES_COIFFURE = {
  courte: { front: 0.074, cote: 0.022, dos: -0.06, volume: 1.06, dessus: 0.03 },
  degagee: { front: 0.078, cote: 0.04, dos: -0.035, volume: 1.04, dessus: 0.035 },
  degarnie: { front: 0.092, cote: 0.0, dos: -0.06, volume: 1.04, dessus: 0 },
  carre: { front: 0.07, cote: -0.085, dos: -0.105, volume: 1.1, dessus: 0.025 },
  longue: { front: 0.072, cote: -0.07, dos: -0.11, volume: 1.08, dessus: 0.022 },
  chignon: { front: 0.076, cote: 0.0, dos: -0.07, volume: 1.04, dessus: 0.012 }
};
const cacheCoiffures = {};
function geometrieCoiffure(style, basse = false) {
  const cleCache = `${style}|${basse ? "b" : "h"}`;
  if (cacheCoiffures[cleCache]) return cacheCoiffures[cleCache];
  const st = STYLES_COIFFURE[style];
  const geo = basse ? new THREE.SphereGeometry(0.1, 20, 14) : new THREE.SphereGeometry(0.1, 48, 36);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const nx = p.getX(i) / 0.1, ny = p.getY(i) / 0.1, nz = p.getZ(i) / 0.1;
    const face = Math.max(0, nz), dos = Math.max(0, -nz);
    // Ligne d'implantation : plus haute aux tempes
    const tempes = face * 0.036 * Math.abs(nx);
    const seuil = (st.cote * (1 - face - dos) + st.front * face + st.dos * dos + tempes) / 0.116;
    const dedans = ny < seuil;
    let k = dedans ? 0.9 : st.volume + st.dessus * Math.max(0, ny);
    if (!dedans && style === "carre" && ny < 0.2) k += 0.03 * (0.2 - ny);
    p.setXYZ(i, nx * 0.086 * k, ny * 0.116 * k, nz * 0.098 * k);
  }
  geo.computeVertexNormals();
  cacheCoiffures[cleCache] = geo;
  return geo;
}
let geoBarbe = null;
function geometrieBarbe() {
  if (geoBarbe) return geoBarbe;
  const geo = geometrieTete(false, 0x888888).clone();
  geo.deleteAttribute("color");
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    // Barbe courte taillée : joues sous la pommette, moustache fine, lèvres dégagées
    const bouche = Math.abs(x) < 0.02 && y > -0.058 && y < -0.043 && z > 0;
    const nez = Math.abs(x) < 0.024 && y > -0.039;
    const zone = y < -0.03 - 0.008 * gauss(x, 0.045) && z > -0.03 && !bouche && !nez;
    const k = zone ? 1.018 : 0.95;
    p.setXYZ(i, x * k, y * (zone ? 1.005 : 0.95), z * k);
  }
  geo.computeVertexNormals();
  geoBarbe = geo;
  return geo;
}

const COULEURS_YEUX = [0x4a3222, 0x2f4f6f, 0x3b5a3a, 0x5a3b22, 0x1f1a17, 0x6b4a2a];
function creerPersonnage(o) {
  const { peau, cheveux, costume = 0x1e293b, cravate = 0x1d4ed8, materiauCravate = null,
    mallette = false, tenue = "costume", haut = 0x64748b, bas = 0x334155, badge = false } = o;
  const femme = o.genre ? o.genre === "f" : ["longue", "chignon", "carre"].includes(o.coiffure);
  const variante = o.variante !== undefined ? o.variante : Math.floor(Math.random() * 1000);
  // Lot 3 : personnage glTF riggé (1 draw call) ; personnage construit en code si les modèles manquent
  if (!o.construit && personnagesGltfDisponibles()) {
    const g = creerPersonnageGltf(o, femme, variante);
    if (g) return g;
  }
  grainPeau();
  // Diversité : carrure, âge (cheveux grisonnants), coiffure, accessoires
  const carrure = 0.93 + ((variante * 37) % 9) * 0.022;
  const age = (variante * 13) % 10;
  const style = femme ? ["carre", "longue", "chignon", "queue"][variante % 4] : (age >= 8 ? "degarnie" : ["courte", "degagee", "courte", "degarnie"][variante % 4]);
  const barbe = !femme && variante % 5 === 1;
  const rase = !femme && !barbe && variante % 3 === 0;
  const lunettes = variante % 4 === 2 || (age >= 8 && variante % 2 === 0);
  const jupe = femme && tenue === "costume" && variante % 2 === 1;
  const montre = variante % 2 === 0;
  const boucles = femme && variante % 5 !== 3;
  const echelle = (femme ? 0.95 : 1.0) * (0.97 + (variante % 7) * 0.012);
  const teinteCheveux = new THREE.Color(cheveux).offsetHSL(0, 0, (((variante * 7) % 5) - 2) * 0.018);
  if (age >= 7) teinteCheveux.lerp(new THREE.Color(0xb9b5ae), age >= 9 ? 0.75 : 0.4);
  const cheveuxV = teinteCheveux.getHex();
  const g = new THREE.Group();
  const corps = new THREE.Group();
  g.add(corps);
  const vetementHaut = tenue === "costume" ? costume : haut;
  const vetementBas = tenue === "costume" ? costume : bas;
  const chemise = tenue === "costume" ? (femme ? 0xf1ede6 : 0xf8fafc) : haut;
  const chaussure = tenue === "costume" ? 0x161412 : 0xe5e7eb;
  const m = (geo, couleur, x = 0, y = 0, z = 0, ombre = true) => pos(maillage(geo, typeof couleur === "number" ? mat(couleur) : couleur, ombre), x, y, z);
  const ell = (mesh, sx, sy, sz) => { mesh.scale.set(sx, sy, sz); return mesh; };
  const sph = (r, s = 18) => new THREE.SphereGeometry(r, s, Math.round(s * 0.75));

  // Bassin et buste (profils masculin / féminin), aplatis d'avant en arrière
  const largeurHanches = (femme ? 0.175 : 0.16) * carrure, taille = (femme ? 0.128 : 0.15) * carrure, poitrine = (femme ? 0.158 : 0.178) * carrure, epaules = (femme ? 0.142 : 0.162) * (0.5 + carrure * 0.5);
  const profilTorse = [[0, 0.95], [largeurHanches * 0.95, 0.96], [taille, 1.06], [poitrine * 0.96, 1.18], [poitrine, 1.3], [poitrine * 0.98, 1.37], [epaules, 1.43], [epaules * 0.8, 1.47], [0.1, 1.5], [0.066, 1.525], [0, 1.535]];
  const aplati = femme ? 0.66 : 0.62;
  // Avant du buste à une hauteur donnée (pour poser boutons, poches, accessoires)
  const devant = y => { for (let k = 1; k < profilTorse.length; k++) { const [r1, y1] = profilTorse[k - 1], [r2, y2] = profilTorse[k]; if (y <= y2) return (r1 + (r2 - r1) * (y - y1) / (y2 - y1)) * aplati + 0.002; } return 0.1; };
  corps.add(ell(m(tour([[0, 0.84], [largeurHanches * 0.85, 0.85], [largeurHanches, 0.92], [largeurHanches * 0.97, 0.98], [0, 0.99]]), jupe ? vetementHaut : vetementBas), 1, 1, 0.66));
  corps.add(ell(m(tour(profilTorse), vetementHaut), 1, 1, aplati));
  [-1, 1].forEach(s => corps.add(ell(m(sph(0.06 * (0.6 + carrure * 0.4)), vetementHaut, s * (epaules + 0.008), 1.425, 0), 1, 0.82, 0.92)));
  if (tenue === "costume") {
    // Rabats de poches et couture centrale de la veste
    const teinteRabat = new THREE.Color(vetementHaut).multiplyScalar(0.78).getHex();
    [-1, 1].forEach(s => corps.add(pos(boite(0.1, 0.012, 0.008, teinteRabat, false), s * 0.085 * carrure, 1.07, devant(1.07) * 0.97)));
    if (!femme && variante % 3 === 1) corps.add(pos(boite(0.05, 0.022, 0.006, 0xf8fafc, false), 0.098 * carrure, 1.335, devant(1.335) * 0.98));
  } else {
    // Chemise : col, boutons, ceinture
    const teinteBouton = new THREE.Color(haut).multiplyScalar(0.7).getHex();
    [1.42, 1.32, 1.22, 1.12].forEach(y => corps.add(m(sph(0.0055, 6), teinteBouton, 0, y, devant(y), false)));
    [-1, 1].forEach(s => { const col = boite(0.06, 0.035, 0.012, haut, false); col.rotation.z = s * 0.55; corps.add(pos(col, s * 0.034, 1.5, 0.085)); });
    if (!jupe) {
      corps.add(ell(m(tour([[largeurHanches * 1.0, 0.94], [largeurHanches * 1.015, 0.955], [largeurHanches * 1.0, 0.97]]), 0x1c1917, 0, 0, 0, false), 1, 1, 0.67));
      corps.add(pos(boite(0.035, 0.026, 0.008, 0x9ca3af, false), 0, 0.955, largeurHanches * 0.67 + 0.006));
    }
  }
  if (jupe) corps.add(ell(m(tour([[0, 0.52], [0.17, 0.53], [0.185, 0.7], [largeurHanches * 1.02, 0.88], [0, 0.9]]), vetementBas), 1, 1, 0.7));
  if (tenue === "costume") {
    // Chemise ou chemisier dans l'encolure de la veste, col, cravate
    const encolure = new THREE.Mesh(new THREE.CircleGeometry(0.075, 3), mat(chemise));
    encolure.rotation.z = Math.PI / 2 * 3;
    encolure.scale.set(1.4, 0.8, 1);
    corps.add(pos(encolure, 0, 1.43, (femme ? 0.66 : 0.62) * poitrine * 0.98 + 0.002));
    [-1, 1].forEach(s => {
      const col = boite(0.05, 0.03, 0.012, chemise, false);
      col.rotation.z = s * 0.6;
      corps.add(pos(col, s * 0.03, 1.5, 0.09));
      const revers = boite(0.055, 0.2, 0.01, vetementHaut, false);
      revers.rotation.z = s * 0.28;
      corps.add(pos(revers, s * 0.055, 1.38, (femme ? 0.66 : 0.62) * poitrine + 0.004));
    });
    if (!femme) {
      const matCravate = materiauCravate || mat(cravate);
      corps.add(pos(new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.2, 0.008), matCravate), 0, 1.37, 0.118));
      corps.add(pos(new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.012), matCravate), 0, 1.485, 0.112));
    }
    [1.22, 1.13].forEach(y => corps.add(m(sph(0.007, 8), 0x111111, 0, y, (femme ? 0.66 : 0.62) * poitrine * 1.02, false)));
    corps.add(m(new THREE.CylinderGeometry(femme ? 0.058 : 0.065, femme ? 0.062 : 0.07, 0.062, 22, 1, true, Math.PI * 0.09, Math.PI * 1.82), mat(chemise), 0, 1.535, 0.004, false));
  } else {
    corps.add(m(tour([[0.062, 1.5], [0.07, 1.53], [0.06, 1.545]]), chemise, 0, 0, 0, false));
  }
  if (badge) {
    // Cordon et badge, posés sur le buste
    [-1, 1].forEach(s => { const c = boite(0.01, 0.2, 0.008, 0x1e3a8a, false); c.rotation.z = s * 0.12; corps.add(pos(c, s * 0.048, 1.39, devant(1.39) + 0.004)); });
    corps.add(pos(boite(0.075, 0.1, 0.006, 0xffffff, false), 0, 1.26, devant(1.26) + 0.006));
    corps.add(pos(boite(0.06, 0.018, 0.007, 0x1d4ed8, false), 0, 1.295, devant(1.295) + 0.008));
  }

  // Jambes : cuisse, genou, mollet, chaussure
  const genoux = [];
  const jambes = [-1, 1].map(s => {
    const pivot = pos(new THREE.Group(), s * (femme ? 0.085 : 0.09) * carrure, 0.9, 0);
    pivot.scale.set(0.9 + carrure * 0.1, 1, 0.9 + carrure * 0.1);
    pivot.add(m(tour([[0, -0.45], [0.055, -0.44], [0.06, -0.36], [0.07, -0.2], [0.08, -0.06], [0.082, 0], [0, 0.03]]), jupe ? peau : vetementBas));
    const genou = pos(new THREE.Group(), 0, -0.45, 0);
    genou.add(m(sph(0.056), jupe ? peau : vetementBas));
    genou.add(m(tour([[0, -0.425], [0.035, -0.42], [0.04, -0.36], [0.053, -0.21], [0.05, -0.08], [0.05, 0], [0, 0.02]]), jupe ? peau : vetementBas));
    // Chaussure : empeigne galbée et semelle
    genou.add(ell(m(sph(0.05), chaussure, 0, -0.445, 0.035), 0.9, 0.62, 1.95));
    genou.add(m(new THREE.BoxGeometry(0.085, 0.018, 0.24), femme && jupe ? 0x2a1d17 : 0x0e0d0c, 0, -0.473, 0.04));
    if (femme && jupe) genou.add(m(new THREE.BoxGeometry(0.02, 0.05, 0.02), 0x111111, 0, -0.455, -0.065));
    pivot.add(genou);
    genoux.push(genou);
    corps.add(pivot);
    return pivot;
  });

  // Bras : épaule, coude, avant-bras, main à doigts
  const coudes = [];
  const bras = [-1, 1].map((s, i) => {
    const pivot = pos(new THREE.Group(), s * (epaules + 0.022), 1.43, 0);
    pivot.add(m(tour([[0, -0.3], [0.04, -0.29], [0.045, -0.2], [0.052, -0.08], [0.056, 0], [0, 0.035]]), vetementHaut));
    const coude = pos(new THREE.Group(), 0, -0.3, 0);
    coude.add(m(sph(0.042), vetementHaut));
    coude.add(m(tour([[0, -0.255], [0.034, -0.25], [0.037, -0.16], [0.044, -0.05], [0.041, 0], [0, 0.02]]), vetementHaut));
    if (tenue === "costume") coude.add(m(tour([[0.035, -0.262], [0.036, -0.245]]), chemise, 0, 0, 0, false));
    if (montre && i === 0) {
      coude.add(m(new THREE.CylinderGeometry(0.037, 0.037, 0.016, 14, 1, true), 0x1c1917, 0, -0.236, 0, false));
      const cadran = m(new THREE.CylinderGeometry(0.014, 0.014, 0.006, 14), 0xd6d3d1, 0, -0.236, 0.037, false);
      cadran.rotation.x = Math.PI / 2;
      coude.add(cadran);
    }
    const main = pos(new THREE.Group(), 0, -0.27, 0);
    main.add(ell(m(sph(0.032), peau, 0, -0.035, 0.004), 1.05, 1.35, 0.5));
    for (let d = 0; d < 4; d++) {
      const doigt = m(new THREE.CylinderGeometry(0.0072, 0.0062, 0.06 - Math.abs(d - 1.5) * 0.008, 6), peau, (d - 1.5) * 0.0145, -0.098, 0.006);
      doigt.rotation.x = 0.18;
      main.add(doigt);
    }
    const pouce = m(new THREE.CylinderGeometry(0.008, 0.007, 0.045, 6), peau, s * -0.028, -0.05, 0.016);
    pouce.rotation.z = s * -0.6;
    main.add(pouce);
    if (mallette && i === 1) {
      main.add(pos(boite(0.09, 0.28, 0.4, 0x2b2118), 0.02, -0.25, 0));
      main.add(pos(boite(0.03, 0.05, 0.14, 0x1f1f1f), 0.02, -0.1, 0));
    }
    coude.add(main);
    pivot.add(coude);
    coudes.push(coude);
    corps.add(pivot);
    return pivot;
  });

  // Cou et tête
  corps.add(m(tour([[0, 1.49], [femme ? 0.054 : 0.062, 1.5], [femme ? 0.05 : 0.058, 1.56], [femme ? 0.047 : 0.054, 1.62], [0, 1.65]]), peau));
  const tete = pos(new THREE.Group(), 0, 1.605, 0.012);
  const fixe = new THREE.Group();
  const visage = new THREE.Mesh(geometrieTete(femme, peau, rase), materiauTete);
  visage.castShadow = true;
  visage.position.y = 0.11;
  tete.add(visage);
  const paupieres = [];
  const yeux = [];
  const sourcils = [];
  [-1, 1].forEach(s => {
    const oeil = pos(new THREE.Group(), s * 0.031, 0.128, 0.0705);
    oeil.add(m(sph(0.0118, 16), 0xf4f1ec, 0, 0, 0, false));
    oeil.add(pos(new THREE.Mesh(new THREE.SphereGeometry(0.0013, 6, 4), materiauReflet), -0.0025, 0.0025, 0.0121));
    oeil.add(ell(m(sph(0.0058, 14), COULEURS_YEUX[variante % COULEURS_YEUX.length], 0, 0, 0.0098, false), 1, 1, 0.45));
    oeil.add(ell(m(sph(0.0027, 10), 0x0a0a0a, 0, 0, 0.0118, false), 1, 1, 0.4));
    tete.add(oeil);
    yeux.push(oeil);
    // Paupière supérieure (coque de peau qui descend pour cligner)
    const paupiere = new THREE.Mesh(new THREE.SphereGeometry(0.0128, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.42), mat(peau));
    paupiere.position.set(s * 0.031, 0.128, 0.0705);
    paupiere.rotation.x = -0.05;
    if (femme) paupiere.add(pos(new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.0017, 0.0045), mat(0x1a1410)), 0, 0.0034, 0.0124));
    tete.add(paupiere);
    paupieres.push(paupiere);
    const paupiereBas = new THREE.Mesh(new THREE.SphereGeometry(0.0124, 16, 6, 0, Math.PI * 2, Math.PI * 0.76, Math.PI * 0.24), mat(peau));
    paupiereBas.position.set(s * 0.031, 0.128, 0.0705);
    paupiereBas.rotation.x = 0.1;
    fixe.add(paupiereBas);
    const sourcil = new THREE.Mesh(colorier(geoBoite(femme ? 0.023 : 0.026, femme ? 0.0026 : 0.0028 + (variante % 3) * 0.0006, 0.004), new THREE.Color(cheveuxV).multiplyScalar(0.7)), materiauPersonnage);
    sourcil.rotation.z = s * (femme ? -0.16 : -0.08);
    sourcil.userData.base = { y: 0.149, rz: sourcil.rotation.z, s };
    tete.add(pos(sourcil, s * 0.033, 0.149, 0.0935));
    sourcils.push(sourcil);
    fixe.add(ell(m(sph(0.016, 12), peau, s * 0.077, 0.108, -0.006), 0.4, 1.4, 0.9));
    if (boucles) fixe.add(m(sph(0.0045, 8), variante % 2 ? 0xd4a017 : 0xf5f5f4, s * 0.08, 0.087, -0.004, false));
  });
  const bouche = new THREE.Group();
  bouche.position.set(0, 0.0605, 0.0928);
  const courbe = new THREE.Group();
  const levre = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.0014, 4, 18, 0.9), mat(0x4a2220));
  levre.rotation.z = -Math.PI / 2 - 0.45;
  levre.position.y = 0.03;
  courbe.add(levre);
  courbe.scale.y = 0.35;
  bouche.add(courbe);
  const interieur = new THREE.Mesh(new THREE.CircleGeometry(0.011, 16), materiauBouche);
  interieur.position.z = -0.0012;
  interieur.scale.set(1.15, 0.05, 1);
  bouche.add(interieur);
  const dents = new THREE.Mesh(new THREE.BoxGeometry(0.0115, 0.0026, 0.002), mat(0xf1ede4));
  dents.position.set(0, 0.0022, -0.0008);
  dents.visible = false;
  bouche.add(dents);
  tete.add(bouche);
  const coiffure = new THREE.Mesh(colorier(geometrieCoiffure(style === "queue" ? "chignon" : style), cheveuxV), matCheveux());
  coiffure.castShadow = true;
  coiffure.position.y = 0.11;
  tete.add(coiffure);
  const meches = new THREE.Mesh(coiffure.geometry, matMeches());
  meches.scale.setScalar(1.028);
  meches.position.y = 0.108;
  tete.add(meches);
  if (style === "chignon") fixe.add(m(colorier(sph(0.042), cheveuxV), matCheveux(), 0, 0.17, -0.1));
  if (style === "queue") {
    // Queue de cheval attachée haut derrière la tête
    const queue = m(colorier(new THREE.CylinderGeometry(0.03, 0.01, 0.24, 12), cheveuxV), matCheveux(), 0, 0.075, -0.118);
    queue.rotation.x = 0.22;
    fixe.add(queue);
    fixe.add(m(new THREE.TorusGeometry(0.022, 0.006, 6, 12), 0x1c1917, 0, 0.19, -0.108, false));
  }
  if (style === "longue") {
    const meche = m(colorier(new THREE.CylinderGeometry(0.088, 0.075, 0.2, 20, 1, true, Math.PI * 0.55, Math.PI * 0.9), cheveuxV), matCheveux(), 0, 0.02, -0.012);
    fixe.add(meche);
  }
  if (barbe) {
    const b = new THREE.Mesh(colorier(geometrieBarbe(), cheveuxV), matCheveux());
    b.position.y = 0.11;
    tete.add(b);
  }
  if (lunettes) {
    [-1, 1].forEach(s => fixe.add(m(new THREE.TorusGeometry(0.0155, 0.0017, 6, 22), 0x1c1c1c, s * 0.032, 0.128, 0.092, false)));
    fixe.add(m(new THREE.BoxGeometry(0.018, 0.0025, 0.003), 0x1c1c1c, 0, 0.132, 0.095, false));
    [-1, 1].forEach(s => fixe.add(m(new THREE.BoxGeometry(0.003, 0.003, 0.09), 0x1c1c1c, s * 0.074, 0.13, 0.05, false)));
    [-1, 1].forEach(s => fixe.add(m(new THREE.BoxGeometry(0.026, 0.003, 0.003), 0x1c1c1c, s * 0.06, 0.13, 0.093, false)));
  }
  tete.add(fixe);
  corps.add(tete);

  fusionnerPersonnage(corps);
  jambes.forEach(fusionnerPersonnage);
  genoux.forEach(fusionnerPersonnage);
  bras.forEach(fusionnerPersonnage);
  coudes.forEach(c => { fusionnerPersonnage(c); c.children.forEach(enfant => { if (enfant.isGroup) fusionnerPersonnage(enfant); }); });
  fusionnerPersonnage(fixe);
  yeux.forEach(fusionnerPersonnage);
  sansOmbrePortee(g);
  const ombreContact = new THREE.Mesh(geoOmbreContact, materiauOmbreContact);
  ombreContact.rotation.x = -Math.PI / 2;
  ombreContact.position.y = 0.012;
  ombreContact.renderOrder = 2;
  g.add(ombreContact);
  g.scale.setScalar(echelle);
  // Détails du visage affichés seulement de près (fluidité)
  const details = [meches, bouche, ...sourcils, ...yeux, ...paupieres];
  const styleBase = style === "queue" ? "chignon" : style;
  const lod = { visage, coiffure, tete: [visage.geometry, geometrieTete(femme, peau, rase, true)], cheveux: [coiffure.geometry, colorier(geometrieCoiffure(styleBase, true), cheveuxV)] };
  g.userData = { corps, jambes, genoux, bras, coudes, mallette, tete, paupieres, bouche, femme, yeux, sourcils, details, lod, levres: courbe, interieur, dents, sourire: 0.35, expression: "neutre", gestuelle: 0.7 + ((variante * 11) % 7) * 0.1, clignement: Math.random() * 4, respiration: Math.random() * 6,
    attitude: "ballants", attitudeFin: 3 + Math.random() * 10, saccade: Math.random() * 2, regardYeux: { x: 0, y: 0 }, regardBas: 0, demarche: 0.9 + Math.random() * 0.2 };
  return g;
}

/* Vie du visage et du corps : respiration, clignements, regard, parole */
const frustumCamera = new THREE.Frustum();
const matriceFrustum = new THREE.Matrix4();
const sphereTemp = new THREE.Sphere();
function majFrustumCamera() {
  frustumCamera.setFromProjectionMatrix(matriceFrustum.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
}
const DISTANCE_DETAILS = 12;
// Niveau de détail : au-delà de 12 m, tête et cheveux simplifiés, traits fins masqués. Renvoie « proche ».
function majNiveauDetail(perso) {
  const u = perso.userData;
  perso.getWorldPosition(vecteurTemp);
  const proche = camera.position.distanceToSquared(vecteurTemp) < DISTANCE_DETAILS * DISTANCE_DETAILS;
  if (u.lod && u.lodProche !== proche) {
    u.lodProche = proche;
    u.lod.visage.geometry = u.lod.tete[proche ? 0 : 1];
    u.lod.coiffure.geometry = u.lod.cheveux[proche ? 0 : 1];
    u.details.forEach(d => { d.visible = proche; });
  }
  return proche;
}
function animerVivant(perso, dt, { parle = false, regarder = true } = {}) {
  const u = perso.userData;
  if (u.gltf) { animerVivantGltf(perso, dt, parle, regarder); return; }
  if (!u.tete) return;
  const proche = majNiveauDetail(perso);
  // Visage animé seulement de près et dans le champ de la caméra
  if (!proche || !frustumCamera.intersectsSphere(sphereTemp.set(vecteurTemp, 1.2))) return;
  u.respiration += dt;
  u.corps.scale.set(1, 1 + Math.sin(u.respiration * 1.6) * 0.006, 1);
  // Clignement des yeux toutes les 2 à 6 secondes
  u.clignement -= dt;
  const ferme = u.clignement < 0.12 && u.clignement > 0;
  if (u.clignement <= 0) u.clignement = 2 + Math.random() * 4;
  u.paupieres.forEach(p => { p.rotation.x = ferme ? 1.2 : -0.05; });
  // Lèvres qui bougent pendant la parole
  // Parole : ouverture de la bouche, dents visibles ; expression : sourire, concentration
  const ouverture = parle ? Math.abs(Math.sin(u.respiration * 11)) * (0.6 + 0.4 * Math.abs(Math.sin(u.respiration * 3.7))) : 0;
  if (u.interieur) {
    u.interieur.scale.y = 0.05 + ouverture * 0.55;
    u.interieur.position.y = -ouverture * 0.0018;
    u.dents.visible = ouverture > 0.5;
    const cible = parle ? 0.75 : u.expression === "sourire" ? 1.25 : u.expression === "concentre" ? 0.1 : 0.35;
    u.sourire += (cible - u.sourire) * Math.min(1, dt * 3);
    u.levres.scale.y = u.sourire;
    u.levres.position.y = -ouverture * 0.0035;
    u.sourcils.forEach(sc => {
      const b = sc.userData.base;
      const leve = parle ? Math.max(0, Math.sin(u.respiration * 2.3)) * 0.0028 : u.expression === "sourire" ? 0.0012 : 0;
      const fronce = u.expression === "concentre" ? 1 : 0;
      sc.position.y = b.y + leve - fronce * 0.0012;
      sc.rotation.z = b.rz - b.s * fronce * 0.12;
    });
  } else if (u.bouche) u.bouche.scale.y = parle ? 1 + Math.abs(Math.sin(u.respiration * 13)) * 3.2 : 1;
  const [lacet, tangage] = regardPersonnage(perso, u, parle, regarder);
  u.tete.rotation.y += (lacet - u.tete.rotation.y) * Math.min(1, dt * 4);
  u.tete.rotation.x += (tangage - u.tete.rotation.x) * Math.min(1, dt * 4);
  animerYeuxEtAttitude(u, dt, lacet);
}
// Orientation de la tête (lacet, tangage) : vers le joueur proche, sinon vers l'interlocuteur ; attitude debout
function regardPersonnage(perso, u, parle, regarder) {
  // Le regard se tourne vers le joueur quand il est proche et devant
  let lacet = 0, tangage = 0;
  if (regarder && jeu.mode !== "menu" && (u.etage ?? 1) === joueur.etage) {
    const p = perso.position;
    const d = Math.hypot(joueur.x - p.x, joueur.z - p.z);
    if (d < 4) {
      const vers = Math.atan2(joueur.x - p.x, joueur.z - p.z);
      const ecart = Math.atan2(Math.sin(vers - perso.rotation.y), Math.cos(vers - perso.rotation.y));
      if (Math.abs(ecart) < 1.6) { lacet = clamp(ecart, -0.9, 0.9); tangage = -0.08; }
    }
  }
  u.parleActif = parle;
  // Sans le participant à proximité : regard vers la personne avec qui l'on discute, hochements en écoutant
  if (!lacet && u.cibleRegard) {
    const p = perso.position, c = u.cibleRegard;
    const vers = Math.atan2(c.x - p.x, c.z - p.z);
    const ecart = Math.atan2(Math.sin(vers - perso.rotation.y), Math.cos(vers - perso.rotation.y));
    if (Math.abs(ecart) < 1.7) lacet = clamp(ecart, -0.85, 0.85);
  }
  if (u.ecoute && !parle) tangage += Math.max(0, Math.sin(u.respiration * 2.6)) * 0.06;
  if (!lacet) tangage += u.regardBas || 0;
  return [lacet, tangage];
}
function animerYeuxEtAttitude(u, dt, lacet) {
  // Mouvements des yeux (saccades) : le regard ne reste jamais figé
  if (u.yeux) {
    u.saccade -= dt;
    if (u.saccade <= 0) {
      u.saccade = 0.5 + Math.random() * 2.5;
      u.regardYeux = lacet ? { x: (Math.random() - 0.5) * 0.06, y: (Math.random() - 0.5) * 0.08 } : { x: (Math.random() - 0.5) * 0.25, y: (Math.random() - 0.5) * 0.4 };
    }
    u.yeux.forEach(o => {
      o.rotation.x += (u.regardYeux.x - o.rotation.x) * Math.min(1, dt * 18);
      o.rotation.y += (u.regardYeux.y - o.rotation.y) * Math.min(1, dt * 18);
    });
  }
  // Attitude debout : bras le long du corps, mains jointes, mains dans le dos, téléphone
  u.attitudeFin -= dt;
  if (u.attitudeFin <= 0) {
    const r = Math.random();
    u.attitude = r < 0.42 ? "ballants" : r < 0.62 ? "mains_devant" : r < 0.77 ? "mains_dos" : "telephone";
    u.attitudeFin = 6 + Math.random() * 12;
  }
}
const vecteurTemp = new THREE.Vector3();
// Regard social : on regarde le collègue proche qui parle (ou avec qui l'on discute)
function majRegardSocial(entite, liste, dt) {
  const u = entite.mesh.userData;
  entite.prochainRegard = (entite.prochainRegard || 0) - dt;
  if (entite.prochainRegard > 0) return;
  entite.prochainRegard = 0.8 + Math.random() * 0.8;
  const p = entite.mesh.position;
  let meilleur = null, dMin = 2.8;
  liste.forEach(o => {
    if (o === entite || o.etage !== entite.etage || !o.mesh.visible) return;
    const d = Math.hypot(o.mesh.position.x - p.x, o.mesh.position.z - p.z);
    const bonus = o.bulleFin > vie.temps ? 0.8 : 0;
    if (d - bonus < dMin) { dMin = d - bonus; meilleur = o; }
  });
  u.cibleRegard = meilleur ? meilleur.mesh.position : null;
  u.ecoute = !!(meilleur && meilleur.bulleFin > vie.temps);
}
// Téléphone en main (appel ou consultation)
function montrerTelephone(mesh, visible) {
  const u = mesh.userData;
  if (!u.coudes || (!visible && !u.telephone)) return;
  if (!u.telephone) {
    const t = new THREE.Group();
    t.add(pos(boite(0.072, 0.15, 0.009, 0x111827), 0, 0, 0));
    t.add(pos(new THREE.Mesh(new THREE.PlaneGeometry(0.064, 0.13), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.55, 0.7, 1.1), toneMapped: false })), 0, 0, 0.0051));
    t.position.set(0, -0.34, 0.03);
    t.rotation.x = -0.25;
    u.coudes[1].add(sansOmbrePortee(t));
    u.telephone = t;
  }
  u.telephone.visible = visible;
}

function animerMarche(perso, t, bouge) {
  if (perso.userData.gltf) { marcherGltf(perso, bouge); return; }
  const { corps, jambes, genoux, bras, coudes, mallette } = perso.userData;
  if (!bouge) { corps.rotation.y = 0; poser(perso, "debout", t); return; }
  t *= perso.userData.demarche || 1;
  montrerTelephone(perso, false);
  perso.userData.regardBas = 0;
  bras.forEach(b => { b.rotation.z = 0; });
  corps.rotation.z = 0;
  corps.rotation.x = 0;
  corps.rotation.y = Math.sin(t * 9) * 0.06;
  const a = bouge ? Math.sin(t * 9) * 0.42 : 0;
  if (coudes) coudes.forEach((c, i) => { c.rotation.x = bouge ? -0.3 - (i ? -a : a) * 0.15 : -0.12; });
  jambes[0].rotation.x = a;
  jambes[1].rotation.x = -a;
  if (genoux) {
    genoux[0].rotation.x = bouge ? Math.max(0, Math.sin(t * 9 - 0.6)) * 0.7 : 0;
    genoux[1].rotation.x = bouge ? Math.max(0, -Math.sin(t * 9 - 0.6)) * 0.7 : 0;
  }
  bras[0].rotation.x = -a * 0.7;
  bras[1].rotation.x = a * 0.7 * (mallette ? 0.4 : 1);
  corps.position.y = bouge ? Math.abs(Math.sin(t * 10)) * 0.012 : 0;
}

function tournerVers(mesh, angle, dt, vitesse = 10) {
  const d = Math.atan2(Math.sin(angle - mesh.rotation.y), Math.cos(angle - mesh.rotation.y));
  mesh.rotation.y += d * Math.min(1, dt * vitesse);
}

const materiauCravateJoueur = new THREE.MeshLambertMaterial({ color: 0x1d4ed8 });
const joueur = {
  x: POINT_POSTE.x, z: POINT_POSTE.z, rayon: 0.3, vitesse: 3.2, bouge: false, t: 0,
  mesh: creerPersonnage({ peau: 0xf1c7a3, cheveux: 0x3b2a1f, genre: "h", variante: 0, costume: 0x1e293b, materiauCravate: materiauCravateJoueur, mallette: true, construit: true })
};
scene.add(joueur.mesh);

/* Personnages des missions */
let groupeNiveau = new THREE.Group();
groupeR1.add(groupeNiveau);
const pnjs = [];

function ajouterPnj(mesh, x, z, zone = null, vitesse = 1.3) {
  mesh.position.set(x, 0, z);
  groupeNiveau.add(mesh);
  const p = { mesh, zone, vitesse, cible: null, attente: Math.random() * 2, fige: !zone, t: Math.random() * 10, regard: true };
  pnjs.push(p);
  return p;
}

function pointLibre(zone, rayon = 0.6) {
  for (let k = 0; k < 40; k++) {
    let x, z;
    if (zone.r !== undefined) {
      const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * zone.r;
      x = zone.x + Math.cos(a) * d;
      z = zone.z + Math.sin(a) * d;
    } else {
      x = aleatoireVisuel(zone.minX, zone.maxX);
      z = aleatoireVisuel(zone.minZ, zone.maxZ);
    }
    if (libre(x, z, rayon)) return { x, z };
  }
  return null;
}

function majPnjs(dt, actif) {
  pnjs.forEach(p => {
    p.t += dt;
    const m = p.mesh;
    if (!m.visible) return;
    let bouge = false;
    if (p.cibleForcee) {
      const dx = p.cibleForcee.x - m.position.x, dz = p.cibleForcee.z - m.position.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.2) {
        const fin = p.cibleForcee.fin;
        p.cibleForcee = null;
        if (fin) fin(p);
      } else if (actif) {
        const pas = Math.min(d, p.vitesse * 1.3 * dt);
        m.position.x += (dx / d) * pas;
        m.position.z += (dz / d) * pas;
        tournerVers(m, Math.atan2(dx, dz), dt);
        bouge = true;
      }
    } else if (p.fige || !actif) {
      if (p.regard && Math.hypot(joueur.x - m.position.x, joueur.z - m.position.z) < 6) {
        tournerVers(m, Math.atan2(joueur.x - m.position.x, joueur.z - m.position.z), dt, 5);
      }
    } else if (p.attente > 0) {
      p.attente -= dt;
    } else {
      if (!p.cible) p.cible = pointLibre(p.zone);
      if (p.cible) {
        const dx = p.cible.x - m.position.x, dz = p.cible.z - m.position.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.2) {
          p.cible = null;
          p.attente = 1.5 + Math.random() * 3;
        } else {
          const pas = Math.min(d, p.vitesse * dt);
          const nx = m.position.x + (dx / d) * pas, nz = m.position.z + (dz / d) * pas;
          const gene = Math.hypot(nx - joueur.x, nz - joueur.z) < 1.0 ||
            pnjs.some(o => o !== p && o.mesh.visible && Math.hypot(nx - o.mesh.position.x, nz - o.mesh.position.z) < 0.7);
          if (libre(nx, nz, 0.35) && !gene) {
            m.position.x = nx;
            m.position.z = nz;
            tournerVers(m, Math.atan2(dx, dz), dt);
            bouge = true;
          } else {
            p.cible = null;
            p.attente = 0.6;
          }
        }
      } else {
        p.attente = 1;
      }
    }
    animerMarche(m, p.t, bouge);
  });
}

/* ---------- A9 bis. Vie de l'étage : collaborateurs, routines, échanges ----------
   Chaque collaborateur a un poste et enchaîne des activités : travail, café,
   imprimante, appel en cabine, point avec un collègue, réunion d'équipe en
   salle Agora, pot à la cafétéria. Les déplacements suivent un graphe de
   navigation (A*) calculé sur le plan de l'étage. Le participant peut
   échanger avec chacun (touche E) : les échanges construisent son réseau
   interne, coûtent un peu de temps et apportent parfois un conseil utile. */

/* Navigation : grille de cellules libres et recherche de chemin A* */
const NAV = { pas: 0.25, rayon: 0.3, nx: 0, nz: 0, libre: null };
function libreStatique(x, z, r, liste = obstacles) {
  if (x < LIMITES.minX || x > LIMITES.maxX || z < LIMITES.minZ || z > LIMITES.maxZ) return false;
  for (const o of liste) {
    if (o.r !== undefined) { if (Math.hypot(x - o.x, z - o.z) < o.r + r) return false; }
    else {
      const px = clamp(x, o.minX, o.maxX), pz = clamp(z, o.minZ, o.maxZ);
      if (Math.hypot(x - px, z - pz) < r) return false;
    }
  }
  return true;
}
function construireNavigation(N = NAV, liste = obstacles) {
  N.nx = Math.floor((LIMITES.maxX - LIMITES.minX) / N.pas) + 1;
  N.nz = Math.floor((LIMITES.maxZ - LIMITES.minZ) / N.pas) + 1;
  N.libre = new Uint8Array(N.nx * N.nz);
  for (let j = 0; j < N.nz; j++) for (let i = 0; i < N.nx; i++) {
    N.libre[j * N.nx + i] = libreStatique(LIMITES.minX + i * N.pas, LIMITES.minZ + j * N.pas, N.rayon, liste) ? 1 : 0;
  }
}
const navCellule = (x, z, N = NAV) => [clamp(Math.round((x - LIMITES.minX) / N.pas), 0, N.nx - 1), clamp(Math.round((z - LIMITES.minZ) / N.pas), 0, N.nz - 1)];
const navPoint = (i, j, N = NAV) => ({ x: LIMITES.minX + i * N.pas, z: LIMITES.minZ + j * N.pas });
const navLibre = (i, j, N = NAV) => i >= 0 && j >= 0 && i < N.nx && j < N.nz && N.libre[j * N.nx + i] === 1;
function navCelluleLibre(x, z, N = NAV) {
  const [ci, cj] = navCellule(x, z, N);
  if (navLibre(ci, cj, N)) return [ci, cj];
  for (let r = 1; r < 12; r++) {
    let meilleur = null, dMin = Infinity;
    for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      if (Math.max(Math.abs(di), Math.abs(dj)) !== r || !navLibre(ci + di, cj + dj, N)) continue;
      const d = di * di + dj * dj;
      if (d < dMin) { dMin = d; meilleur = [ci + di, cj + dj]; }
    }
    if (meilleur) return meilleur;
  }
  return null;
}
function navVisible(a, b, N = NAV) {
  const d = Math.hypot(b.x - a.x, b.z - a.z), n = Math.ceil(d / 0.12);
  for (let k = 1; k < n; k++) {
    const [i, j] = navCellule(a.x + (b.x - a.x) * k / n, a.z + (b.z - a.z) * k / n, N);
    if (!navLibre(i, j, N)) return false;
  }
  return true;
}
function calculerChemin(depart, arrivee, NV = NAV) {
  const a = navCelluleLibre(depart.x, depart.z, NV), b = navCelluleLibre(arrivee.x, arrivee.z, NV);
  if (!a || !b) return [arrivee];
  const N = NV.nx * NV.nz, cible = b[1] * NV.nx + b[0], origine = a[1] * NV.nx + a[0];
  const g = new Float32Array(N).fill(Infinity), parent = new Int32Array(N).fill(-1), ferme = new Uint8Array(N);
  const tas = [];
  const pousser = (k, f) => {
    tas.push([f, k]);
    let i = tas.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (tas[p][0] <= tas[i][0]) break; [tas[p], tas[i]] = [tas[i], tas[p]]; i = p; }
  };
  const extraire = () => {
    const haut = tas[0], dernier = tas.pop();
    if (tas.length) {
      tas[0] = dernier;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < tas.length && tas[l][0] < tas[m][0]) m = l;
        if (r < tas.length && tas[r][0] < tas[m][0]) m = r;
        if (m === i) break;
        [tas[m], tas[i]] = [tas[i], tas[m]];
        i = m;
      }
    }
    return haut;
  };
  const h = k => Math.hypot((k % NV.nx) - b[0], Math.floor(k / NV.nx) - b[1]);
  g[origine] = 0;
  pousser(origine, h(origine));
  let trouve = false, iterations = 0;
  while (tas.length && iterations++ < 40000) {
    const [, k] = extraire();
    if (ferme[k]) continue;
    if (k === cible) { trouve = true; break; }
    ferme[k] = 1;
    const i = k % NV.nx, j = Math.floor(k / NV.nx);
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const ni = i + di, nj = j + dj;
      if (!navLibre(ni, nj, NV)) continue;
      if (di && dj && (!navLibre(i + di, j, NV) || !navLibre(i, j + dj, NV))) continue;
      const nk = nj * NV.nx + ni, cout = g[k] + (di && dj ? 1.414 : 1);
      if (cout < g[nk]) { g[nk] = cout; parent[nk] = k; pousser(nk, cout + h(nk)); }
    }
  }
  if (!trouve) return [arrivee];
  const brut = [];
  for (let k = cible; k !== -1; k = parent[k]) brut.push(navPoint(k % NV.nx, Math.floor(k / NV.nx), NV));
  brut.reverse();
  // Lissage : on ne garde que les points nécessaires
  const lisse = [];
  let ancre = { x: depart.x, z: depart.z };
  for (let k = 1; k < brut.length; k++) {
    if (!navVisible(ancre, brut[k], NV)) { lisse.push(brut[k - 1]); ancre = brut[k - 1]; }
  }
  lisse.push(brut[brut.length - 1]);
  lisse.push({ x: arrivee.x, z: arrivee.z });
  return lisse;
}

/* Postures du corps : assis au poste, debout, au téléphone */
// Articulations lissées : les changements de posture (s'asseoir, se lever…) se font en douceur
function articulations(u) {
  return [u.corps.position, "y", u.corps.rotation, "x", u.corps.rotation, "z"].concat(...u.bras.map(b => [b.rotation, "x", b.rotation, "z"]),
    ...u.jambes.map(j => [j.rotation, "x"]), ...(u.genoux || []).map(g => [g.rotation, "x"]), ...(u.coudes || []).map(c => [c.rotation, "x"]));
}
function poser(mesh, pose, t) {
  const u = mesh.userData;
  if (u.gltf) { poserGltf(mesh, pose); return; }
  if (!u.articulations) u.articulations = articulations(u);
  const avant = [];
  for (let k = 0; k < u.articulations.length; k += 2) avant.push(u.articulations[k][u.articulations[k + 1]]);
  poserCible(mesh, pose, t);
  const lissage = u.lissage ?? 0.2;
  for (let k = 0, i = 0; k < u.articulations.length; k += 2, i++) {
    const o = u.articulations[k], cle = u.articulations[k + 1];
    o[cle] = avant[i] + (o[cle] - avant[i]) * lissage;
  }
}
function poserCible(mesh, pose, t) {
  const { corps, jambes, genoux, bras, coudes } = mesh.userData;
  const u = mesh.userData;
  corps.rotation.y = 0;
  if (pose === "ecran") u.expression = "concentre";
  else if (pose === "parle") u.expression = u.expression === "concentre" ? "neutre" : u.expression;
  bras.forEach(b => { b.rotation.z = 0; });
  corps.rotation.z = 0;
  corps.rotation.x = 0;
  const tasse = !!(u.objetsMain && u.objetsMain.tasse.visible);
  const attitude = pose === "debout" && !u.parleActif ? (tasse && u.attitude === "telephone" ? "ballants" : u.attitude || "ballants") : null;
  montrerTelephone(mesh, pose === "tel" || attitude === "telephone");
  u.regardBas = pose === "ecran" ? 0.13 : attitude === "telephone" ? 0.4 : 0;
  const assis = pose === "assis" || pose === "ecran";
  if (genoux) genoux.forEach(g => { g.rotation.x = assis ? 1.5 : 0; });
  const coude = (i, v) => { if (coudes) coudes[i].rotation.x = v; };
  if (assis) {
    corps.position.y = -0.42;
    jambes.forEach(j => { j.rotation.x = -1.5; });
    const frappe = pose === "ecran" ? Math.sin(t * 11) * 0.05 : 0;
    corps.rotation.x = pose === "ecran" ? 0.04 : -0.05 + Math.sin(t * 0.3 + u.respiration) * 0.03;
    bras[0].rotation.x = pose === "ecran" ? -0.5 + frappe : -0.3;
    bras[1].rotation.x = pose === "ecran" ? -0.5 - frappe : -0.3;
    coude(0, pose === "ecran" ? -1.05 : -1.2);
    coude(1, pose === "ecran" ? -1.05 : -1.2);
  } else if (pose === "tel") {
    corps.position.y = 0;
    jambes.forEach(j => { j.rotation.x = 0; });
    bras[0].rotation.x = Math.sin(t * 1.3) * 0.05;
    coude(0, -0.15);
    bras[1].rotation.x = -0.45;
    bras[1].rotation.z = 0.32;
    coude(1, -2.35);
  } else if (pose === "parle") {
    corps.position.y = 0;
    jambes.forEach(j => { j.rotation.x = 0; });
    const gest = u.gestuelle || 1;
    bras[0].rotation.x = -0.18 + Math.sin(t * 2.2) * 0.12 * gest;
    bras[1].rotation.x = -0.1 + Math.sin(t * 1.7 + 1) * 0.08 * gest;
    coude(0, -0.7 - Math.sin(t * 2.2) * 0.35 * gest);
    coude(1, -0.35 - Math.sin(t * 1.7 + 1) * 0.2 * gest);
    corps.rotation.y = Math.sin(t * 0.9) * 0.04 * gest;
  } else {
    // Debout : transfert du poids d'une jambe à l'autre, attitude du moment
    corps.position.y = 0;
    jambes.forEach(j => { j.rotation.x = 0; });
    const poids = Math.sin(t * 0.4 + (u.respiration || 0) * 0.3);
    if (genoux) { genoux[0].rotation.x = Math.max(0, poids) * 0.14; genoux[1].rotation.x = Math.max(0, -poids) * 0.14; }
    corps.rotation.z = poids * 0.014;
    if (attitude === "mains_devant") {
      bras[0].rotation.x = -0.3; bras[1].rotation.x = -0.3;
      bras[0].rotation.z = -0.24; bras[1].rotation.z = 0.24;
      coude(0, -1.05); coude(1, -1.05);
    } else if (attitude === "mains_dos") {
      bras[0].rotation.x = 0.3; bras[1].rotation.x = 0.3;
      bras[0].rotation.z = -0.14; bras[1].rotation.z = 0.14;
      coude(0, -0.55); coude(1, -0.55);
    } else if (attitude === "telephone") {
      bras[0].rotation.x = Math.sin(t * 0.6) * 0.03; coude(0, -0.15);
      bras[1].rotation.x = -0.42; bras[1].rotation.z = 0.16;
      coude(1, -1.45 + Math.sin(t * 2.1) * 0.03);
    } else {
      bras[0].rotation.x = Math.sin(t * 0.5) * 0.025;
      bras[1].rotation.x = Math.sin(t * 0.5 + 1) * 0.025;
      coude(0, -0.12);
      coude(1, -0.12);
    }
  }
  // Une tasse à la main : tenue devant soi, une gorgée de temps en temps
  if (tasse && !["assis", "ecran", "tel"].includes(pose)) {
    const cycle = (t + (u.respiration || 0)) % 11;
    const gorgee = cycle < 1.6 ? Math.sin(cycle / 1.6 * Math.PI) : 0;
    bras[1].rotation.x = -0.32 - gorgee * 0.55;
    bras[1].rotation.z = 0.1 + gorgee * 0.12;
    coude(1, -1.3 - gorgee * 0.85);
    if (gorgee > 0.4) u.regardBas = -0.12;
  }
}

/* Contenus des échanges (professionnels et humains) */
const REPLIQUES = {
  travail: [(EN ? "I'm wrapping up a proposal for tonight." : "Je boucle une proposition pour ce soir."), (EN ? "I'm preparing tomorrow's pipeline review." : "Je prépare mon point pipeline de demain."), (EN ? "I'm working on a fairly complex quote." : "Je suis sur un devis un peu complexe."), (EN ? "I'm catching up on emails after a morning of meetings." : "Je rattrape mes mails après une matinée de rendez-vous."), (EN ? "I'm updating my opportunities in the CRM." : "Je mets à jour mes opportunités dans le CRM.")],
  ouverture: [(EN ? "Did you manage to unwind a bit this weekend?" : "Tu as pu souffler un peu ce week-end ?"), (EN ? "The RER A was packed again this morning…" : "Le RER A était encore bondé ce matin…"), (EN ? "Have you seen the light on the Grande Arche this morning?" : "Tu as vu la lumière sur la Grande Arche ce matin ?"), (EN ? "So, how is the new quarter starting for you?" : "Alors, ce nouveau trimestre, ça démarre comment pour toi ?"), (EN ? "Have you tried the new coffee? It's much better." : "Tu as goûté le nouveau café ? Il est nettement meilleur.")],
  vie: [(EN ? "My daughter is starting swimming lessons, Wednesdays are busy!" : "Ma fille commence la natation, les mercredis sont sportifs !"), (EN ? "I'm running the Paris half-marathon in March, I train at lunchtime." : "Je cours le semi-marathon de Paris en mars, je m'entraîne le midi."), (EN ? "We've just moved to Rueil, I'm discovering the neighbourhood." : "On vient d'emménager à Rueil, je découvre le quartier."), (EN ? "I'm taking Spanish classes again in the evening, it does me good." : "Je reprends des cours d'espagnol le soir, ça me fait du bien."), (EN ? "My football team finally won on Sunday, I'm in a good mood." : "Mon équipe de foot a enfin gagné dimanche, je suis de bonne humeur.")],
  discussion: [
    [(EN ? "Have you seen the new pipeline dashboard?" : "Tu as vu le nouveau tableau de bord du pipeline ?"), (EN ? "Yes, finally a clear view of the funnel stages." : "Oui, enfin une vue claire des étapes du tunnel.")],
    [(EN ? "Did Tuesday's client sign?" : "Le client de mardi a signé ?"), (EN ? "Not yet, he wants a second meeting with his CFO." : "Pas encore, il veut un deuxième rendez-vous avec son DAF.")],
    [(EN ? "Are you coming to the team meeting later?" : "Tu viens au point d'équipe tout à l'heure ?"), (EN ? "Yes, I'm bringing this week's figures." : "Oui, j'apporte les chiffres de la semaine.")],
    [(EN ? "Apparently we're hiring two sales reps." : "Il paraît qu'on recrute deux commerciaux."), (EN ? "Yes, Sandrine is interviewing next week." : "Oui, Sandrine fait les entretiens la semaine prochaine.")],
    [(EN ? "Any tips for follow-ups?" : "Tu as une astuce pour les relances ?"), (EN ? "Always bring new information, never “so, have you decided?”." : "Toujours apporter une information nouvelle, jamais « alors, vous avez décidé ? ».")],
    [(EN ? "Lovely view this morning, isn't it?" : "Belle vue ce matin, non ?"), (EN ? "From the Belvédère on level 2 it's even better." : "Depuis le Belvédère au R+2, c'est encore mieux.")],
    [(EN ? "Have you tried the new Coupole room?" : "Tu as testé la nouvelle salle Coupole ?"), (EN ? "Yes, the screen is great for demos." : "Oui, l'écran est top pour les démos.")]
  ],
  reunion: [(EN ? "Let's go through this week's pipeline." : "Passons au pipeline de la semaine."), (EN ? "What's our lead → opportunity conversion rate?" : "Quel est le taux de conversion lead → opportunité ?"), (EN ? "Who's taking over this account?" : "Qui prend le relais sur ce compte ?"), (EN ? "Let's review this quarter's renewals." : "On fait le point sur les renouvellements du trimestre."), (EN ? "Good news: two signatures this week." : "Bonne nouvelle : deux signatures cette semaine.")],
  appel: [(EN ? "Yes, I'll send you the proposal within the hour." : "Oui, je vous envoie la proposition dans l'heure."), (EN ? "Absolutely, we can schedule a demo on Thursday." : "Tout à fait, on peut caler une démo jeudi."), (EN ? "I understand, I'll get back to you with a precise answer." : "Je comprends, je reviens vers vous avec une réponse précise."), (EN ? "Thank you for your trust, we start on Monday." : "Merci pour votre confiance, on démarre lundi.")],
  pot: [(EN ? "Happy birthday!" : "Joyeux anniversaire !"), (EN ? "Welcome to the team!" : "Bienvenue dans l'équipe !"), (EN ? "Well done on the signature!" : "Bravo pour la signature !"), (EN ? "Is there any cake left?" : "Il reste du gâteau ?"), (EN ? "Cheers, to this quarter!" : "Santé, et à ce trimestre !")]
};
const BESOINS_METIER = {
  manager: (EN ? "Reliable forecasts: I prefer an honest pipeline to an inflated one." : "Des prévisions fiables : je préfère un pipeline honnête à un pipeline gonflé."),
  avantVente: (EN ? "Thorough discovery before the demo. Without the need, I end up showing the whole catalogue and we lose the client." : "Des découvertes complètes avant la démo. Sans le besoin, je montre tout le catalogue et on perd le client."),
  marketing: (EN ? "Your feedback on lead quality: it helps me fine-tune the campaigns." : "Vos retours sur la qualité des leads : ça m'aide à ajuster les campagnes."),
  success: (EN ? "Customers sold what they really need. The ones we over-equip leave at the first renewal." : "Des clients vendus au juste besoin. Ceux qu'on sur-équipe partent au premier renouvellement."),
  dg: (EN ? "Customers who stay. A customer loyal for five years is worth far more than one signed at a knock-down price." : "Des clients qui restent. Un client fidèle cinq ans vaut bien plus qu'un client signé à prix cassé."),
  thomas: (EN ? "Sharing more best practice between field and inside sales." : "Qu'on partage plus les bonnes pratiques entre terrain et sédentaires."),
  sofia: (EN ? "Time to prepare key accounts, not rushed last-minute follow-ups." : "Du temps pour préparer les grands comptes, pas des relances dans l'urgence."),
  maxime: (EN ? "Sales reps calling back the leads I qualify quickly." : "Que les commerciaux rappellent vite les leads que je qualifie."),
  arthur: (EN ? "Customer testimonials: nothing converts better than proof." : "Des témoignages clients : rien ne convertit mieux qu'une preuve."),
  amelie: (EN ? "Clear proposals, without jargon." : "Des propositions claires, sans jargon."),
  samira: (EN ? "Order forms that are complete first time, with the right plan and the right number of licences." : "Des bons de commande complets du premier coup, avec la bonne offre et le bon nombre de licences."),
  bastien: (EN ? "Introductions within your accounts: a happy customer often knows other prospects." : "Des introductions dans vos comptes : un client satisfait connaît souvent d'autres prospects."),
  gilles: (EN ? "Justified discounts: every point of discount comes straight out of the margin." : "Des remises justifiées : chaque point de remise se retrouve dans la marge."),
  adrien: (EN ? "Not promising integrations without asking me: I'd rather say yes knowing what we're selling." : "Qu'on ne promette pas d'intégration sans me demander : je préfère dire oui en sachant."),
  fatou: (EN ? "Being introduced to the customer as soon as they sign: the relationship starts on day one." : "Être présentée au client dès la signature : la relation se construit dès le premier jour."),
  chloe: (EN ? "Being told about client visits: I prepare the badge and the room." : "Qu'on me prévienne des visites clients : je prépare le badge et la salle.")
};
const CONSEILS_COLLEGUES = {
  manager: { decision: (EN ? "Before you ask for a discount, bring me something in return: a 3-year commitment or signature by a set date." : "Avant de demander une remise, apporte-moi une contrepartie : engagement de 3 ans ou signature à date."), defaut: (EN ? "A good salesperson gets the customer talking first. The numbers follow." : "Un bon commercial fait d'abord parler le client. Le chiffre suit.") },
  avantVente: { consideration: (EN ? "Note down the issues raised during the call: in the demo, that's all I show." : "Note les problématiques exprimées pendant l'appel : en démo, je ne montre que ça."), defaut: (EN ? "A successful demo is three well-chosen modules, not ten." : "Une démo réussie, c'est trois modules bien choisis, pas dix.") },
  marketing: { interet: (EN ? "Pricing pages viewed several times is a strong signal: call those leads back first." : "Les pages Tarifs vues plusieurs fois, c'est un signal fort : rappelle ces leads en priorité."), defaut: (EN ? "A downloaded white paper is curiosity, not a meeting request." : "Un livre blanc téléchargé, c'est de la curiosité, pas une demande de rendez-vous.") },
  success: { fidelisation: (EN ? "Prepare the business review at least a month before the renewal." : "Prépare la revue d'activité au moins un mois avant le renouvellement."), defaut: (EN ? "An over-equipped customer doesn't use their licences… and doesn't renew." : "Un client sur-équipé n'utilise pas ses licences… et ne renouvelle pas.") },
  dg: { defaut: (EN ? "What I look at is customer lifetime value: retention, expansion, referrals." : "Ce que je regarde, c'est la valeur vie client : rétention, développement, recommandations.") },
  thomas: { notoriete: (EN ? "At the trade show, read the badge before approaching: it saves you a lot of time." : "Au salon, lis le badge avant d'aborder : tu gagnes un temps fou."), defaut: (EN ? "Face to face, watch the signals: crossed arms, note-taking, eyes on the screen." : "En face à face, regarde les signaux : bras croisés, prise de notes, regard vers l'écran.") },
  sofia: { decision: (EN ? "On a key account, always lock in the decision date and the approval steps." : "Sur un grand compte, verrouille toujours la date de décision et les étapes de validation."), defaut: (EN ? "A key account is won over several meetings, not in one go." : "Un grand compte se gagne en plusieurs rendez-vous, pas en un coup.") },
  maxime: { consideration: (EN ? "Ask about budget simply: “Is there a budget set aside this year?”" : "Pose la question du budget simplement : « Une enveloppe est-elle prévue cette année ? »"), defaut: (EN ? "I qualify fast: need, decision-maker, budget, timing." : "Je qualifie vite : besoin, décideur, budget, échéance.") },
  arthur: { interet: (EN ? "Leads coming from comparison pages want proof: send them the case study." : "Les leads qui viennent des comparatifs veulent des preuves : envoie l'étude de cas."), defaut: (EN ? "Content matched to the prospect's maturity is the key to conversion." : "Le contenu adapté à la maturité du prospect, c'est la clé de la conversion.") },
  amelie: { defaut: (EN ? "On the phone, I always rephrase before answering an objection." : "Au téléphone, je reformule toujours avant de répondre à une objection.") },
  samira: { decision: (EN ? "Check the planned number of users before sending: an oversized proposal always comes back." : "Vérifie le nombre d'utilisateurs prévus avant d'envoyer : une proposition surdimensionnée revient toujours."), defaut: (EN ? "A properly filled-in order goes through in 24 hours." : "Une commande bien remplie passe en 24 h.") },
  bastien: { fidelisation: (EN ? "Ask your promoters for referrals, never an unhappy customer." : "Demande des recommandations à tes promoteurs, jamais à un client mécontent."), defaut: (EN ? "My best leads come from referrals." : "Mes meilleurs leads viennent de recommandations.") },
  gilles: { decision: (EN ? "Beyond 10% discount, the margin melts fast: aim for a longer commitment instead." : "Au-delà de 10 % de remise, la marge fond vite : vise plutôt l'engagement long."), defaut: (EN ? "I'd rather give 5% off with a 3-year commitment than 15% for nothing." : "Je préfère une remise de 5 % avec un engagement de 3 ans à 15 % sans rien.") },
  adrien: { defaut: (EN ? "If a customer mentions accounting integration, it's the Business plan at minimum." : "Si un client parle d'intégration comptable, c'est l'offre Business minimum.") },
  fatou: { fidelisation: (EN ? "A change of contact at a customer is the riskiest moment: meet the new person quickly." : "Un changement d'interlocuteur chez un client, c'est le moment le plus risqué : rencontre vite le nouveau."), defaut: (EN ? "Account health needs checking every week." : "La santé d'un compte, ça se suit chaque semaine.") },
  chloe: { defaut: (EN ? "Customers appreciate being greeted by name: let me know when they're arriving." : "Les clients apprécient d'être accueillis par leur nom : prévenez-moi de leur arrivée.") }
};
const STATUTS = { dejeuner: (EN ? "Lunch break" : "Pause déjeuner"), standup: (EN ? "Sales stand-up" : "Stand-up commercial"), depart: (EN ? "Gone for the day" : "Parti pour la journée"), arrivee: (EN ? "Arriving at the office" : "Arrive au bureau"), retour: (EN ? "Coming back up" : "Remonte au plateau"), sortie: (EN ? "Elsewhere in the building" : "Ailleurs dans l'immeuble"), demande: (EN ? "Wants to talk to you" : "Souhaite vous parler"), attente: (EN ? "Waiting for you" : "Vous attend"), travail: (EN ? "At their desk" : "Au poste"), machine: (EN ? "Coffee break" : "Pause café"), cafe: (EN ? "Coffee break" : "Pause café"), imprimante: (EN ? "At the printer" : "À l'imprimante"), fontaine: (EN ? "Water cooler" : "Fontaine à eau"), appel: (EN ? "On the phone" : "Au téléphone"), detente: (EN ? "Lounge area" : "Espace détente"), reunion: (EN ? "In a meeting" : "En réunion"), point: (EN ? "Catching up with a colleague" : "Point avec un collègue"), pot: (EN ? "Team drinks" : "Pot d'équipe"), trajet: (EN ? "On the move" : "En déplacement"), discussion: (EN ? "Chatting" : "En discussion") };

/* Collaborateurs */
const employes = [];
const vie = { prochaineReunion: 35, prochainPot: 150, prochaineDemande: 45, reunion: null, pot: null, demande: null, tache: null, temps: 0, echanges: 0, dernierBonjour: 0 };
const relation = cle => (resultats.relations && resultats.relations[cle] !== undefined ? resultats.relations[cle] : 50);
function creerCollaborateurs() {
  if (!resultats.relations) resultats.relations = {};
  Object.entries(COLLEGUES_DEF).forEach(([cle, def], i) => {
    const decontracte = { arthur: 0x93c5fd, adrien: 0xe2e8f0, maxime: 0xdbeafe, gilles: 0xfef3c7, samira: 0xf1f5f9 }[cle];
    const mesh = creerPersonnage(Object.assign({}, APPARENCES[def.apparence], { mallette: false, badge: true, genre: def.f ? "f" : "h", variante: i * 7 + 3 },
      decontracte ? { tenue: "ville", haut: decontracte, bas: 0x1f2937 } : {}));
    const siege = def.accueil ? { x: def.poste.x, z: def.poste.z + 0.15, a: O, pose: "ecran" } : { x: def.poste.x, z: def.poste.z + 0.78, a: O, pose: "ecran" };
    mesh.position.set(siege.x, 0, siege.z);
    mesh.rotation.y = O;
    groupeR1.add(mesh);
    const prenom = def.nom.split(" ")[0];
    const etiquette = document.createElement("div");
    etiquette.className = "etiquette etq-collaborateur";
    $("etiquettes").appendChild(etiquette);
    const bulle = document.createElement("div");
    bulle.className = "bulle";
    $("etiquettes").appendChild(bulle);
    const e = {
      cle, def, prenom, mesh, siege, t: Math.random() * 10, etat: "activite",
      activite: { type: "travail", lieu: siege, fin: 4 + Math.random() * 30 }, chemin: [], vitesse: 1.05 + Math.random() * 0.25,
      bloque: 0, bulle: "", bulleFin: 0, etiquette, bulleEl: bulle, enEchange: false, etiquetteMission: false, conseils: {}, etage: 1
    };
    employes.push(e);
    collegues[cle] = { mesh, def, employe: e };
  });
}
const lieuxOccupes = new Set();
const cleLieu = l => `${l.x.toFixed(2)}|${l.z.toFixed(2)}`;
function lieuLibre(liste) {
  const libres = liste.filter(l => !lieuxOccupes.has(cleLieu(l)));
  return libres.length ? libres[Math.floor(Math.random() * libres.length)] : null;
}
function libererLieu(e) {
  if (e.activite && e.activite.lieu && e.activite.lieu !== e.siege) lieuxOccupes.delete(cleLieu(e.activite.lieu));
}
function envoyer(e, type, lieu, duree) {
  libererLieu(e);
  if (lieu !== e.siege) lieuxOccupes.add(cleLieu(lieu));
  e.activite = { type, lieu, duree, fin: Infinity };
  e.etat = "trajet";
  e.chemin = calculerChemin(e.mesh.position, lieu, ETAGES[e.etage].nav);
  e.bloque = 0;
  poser(e.mesh, "debout", e.t);
}
function choisirActivite(e) {
  if (activiteDuMoment(e)) return;
  const r = Math.random();
  const a = e.def.assiduite;
  if (e.def.accueil) {
    if (r < 0.8) return envoyer(e, "travail", e.siege, 25 + Math.random() * 30);
  }
  if (r < a) return envoyer(e, "travail", e.siege, 25 + Math.random() * 45);
  const choix = [
    ["machine", 0.3], ["imprimante", 0.1], ["fontaine", 0.08], ["appel", 0.16], ["detente", 0.1], ["point", 0.26], ["sortie", 0.12]
  ];
  let x = Math.random() * choix.reduce((s, c) => s + c[1], 0);
  let type = choix[0][0];
  for (const [k, p] of choix) { if ((x -= p) <= 0) { type = k; break; } }
  if (type === "sortie") {
    if (peutSortir(e)) return envoyer(e, "sortie", pointAppel(Math.floor(Math.random() * CABINES.length)), 1);
    type = "machine";
  }
  if (type === "point") {
    const cibles = employes.filter(o => o !== e && o.etat === "activite" && o.activite.type === "travail" && !o.def.accueil && o.siege.z > -9 && !o.enEchange);
    const o = cibles[Math.floor(Math.random() * cibles.length)];
    if (o) {
      const lieu = { x: o.siege.x + 0.75, z: o.siege.z + 0.1, a: -O / 2, pose: "parle" };
      if (libreStatique(lieu.x, lieu.z, 0.2)) {
        envoyer(e, "point", lieu, 12 + Math.random() * 8);
        e.activite.avec = o;
        return;
      }
    }
    type = "machine";
  }
  const lieu = lieuLibre(LIEUX[type]);
  if (!lieu) return envoyer(e, "travail", e.siege, 15 + Math.random() * 20);
  const durees = { machine: 6, imprimante: 7, fontaine: 6, appel: 18, detente: 20 };
  envoyer(e, type, lieu, durees[type] + Math.random() * 10);
}
function arriver(e) {
  if (e.activite.type === "depart") {
    if (e.etage === 0) { e.absent = true; e.mesh.visible = false; e.etat = "absent"; return; }
    entrerCabineEmploye(e, 0);
    e.ascenseur.partir = true;
    return;
  }
  if (e.activite.type === "arrivee") { entrerCabineEmploye(e, 1); return; }
  if (e.activite.type === "sortie" && e.etage === 1) { partirEnSortie(e); return; }
  if (e.activite.type === "retour") { entrerCabineEmploye(e, 1); return; }
  const l = e.activite.lieu;
  e.mesh.position.set(l.x, 0, l.z);
  e.etat = "activite";
  e.activite.fin = vie.temps + e.activite.duree;
  if (e.activite.finGroupe) e.activite.fin = Math.max(vie.temps + 4, e.activite.finGroupe);
  const t = e.activite.type;
  if (t === "appel") {
    parler(e, choisirTexte(REPLIQUES.appel), 6);
    if (e.etage === joueur.etage && Math.hypot(e.mesh.position.x - joueur.x, e.mesh.position.z - joueur.z) < 9) son("sonnerie");
  }
  if (t === "point" && e.activite.avec) {
    const [q, rep] = REPLIQUES.discussion[Math.floor(Math.random() * REPLIQUES.discussion.length)];
    parler(e, q, 4.5);
    const o = e.activite.avec;
    setTimeout(() => { if (o.etat === "activite") parler(o, rep, 4.5); }, 2400);
  }
}
const choisirTexte = liste => liste[Math.floor(Math.random() * liste.length)];
function parler(e, texte, duree = 4) { e.bulle = texte; e.bulleFin = vie.temps + duree; }
function apresActivite(e) {
  if (e.etage !== 1) return retourSortie(e);
  if (occupeParJoueur(e)) { e.activite.fin = vie.temps + 5; return; }
  // Après un café, on reste volontiers discuter à une table haute
  if (e.activite.type === "machine" && Math.random() < 0.75) {
    const lieu = lieuLibre(LIEUX.cafe);
    if (lieu) return envoyer(e, "cafe", lieu, 14 + Math.random() * 12);
  }
  choisirActivite(e);
}

/* Moments collectifs : réunion d'équipe en salle Agora, pot à la cafétéria */
const occupeParJoueur = e => (vie.demande && vie.demande.employe === e) || (vie.tache && (vie.tache.employe === e || vie.tache.auteur === e));
function disponiblesPourGroupe(n, exclure = []) {
  return melanger(employes.filter(e => !e.def.accueil && !e.enEchange && e.etage === 1 && !occupeParJoueur(e) && !exclure.includes(e.cle) && !["reunion", "pot", "attente", "demande", "sortie"].includes(e.activite.type)), Math.random).slice(0, n);
}
function lancerReunion() {
  const sujets = [(EN ? "Pipeline review" : "Revue du pipeline"), (EN ? "Weekly team meeting" : "Point hebdomadaire de l'équipe"), (EN ? "Renewals preparation" : "Préparation des renouvellements"), (EN ? "Sharing discovery best practice" : "Partage des bonnes pratiques de découverte"), (EN ? "Monthly leads review" : "Bilan des leads du mois")];
  const participants = disponiblesPourGroupe(3 + Math.floor(Math.random() * 2), ["dg", "success", "fatou"]);
  const sieges = melanger(LIEUX.agora, Math.random);
  const fin = vie.temps + 50;
  participants.forEach((e, i) => {
    libererLieu(e);
    envoyer(e, "reunion", sieges[i], 40);
    e.activite.finGroupe = fin;
  });
  vie.reunion = { sujet: choisirTexte(sujets), fin, participants };
  if (jeu.def && jeu.mode === "jeu" && participants.length && Math.random() < 0.5) setTimeout(inviterReunion, 1500);
}
function lancerPot(motifImpose = null) {
  const fetes = employes.filter(e => !e.def.accueil && e.etage === 1 && e.etat !== "ascenseur");
  const heros = choisirTexte(fetes);
  const motifs = motifImpose ? [motifImpose] : [(EN ? `${heros.prenom}'s birthday` : `Anniversaire de ${heros.prenom}`), (EN ? `Welcome to the team, ${heros.prenom}` : `Bienvenue à ${heros.prenom} dans l'équipe`), (EN ? `${heros.prenom} is celebrating a great signature` : `${heros.prenom} fête une belle signature`), (EN ? "Friday team coffee" : "Café d'équipe du vendredi")];
  const participants = disponiblesPourGroupe(6, []);
  if (!motifImpose && !participants.includes(heros) && !heros.enEchange && !occupeParJoueur(heros)) participants[0] = heros;
  const fin = vie.temps + 45;
  const lieux = melanger(LIEUX.cafe.concat(LIEUX.machine), Math.random);
  participants.forEach((e, i) => {
    libererLieu(e);
    envoyer(e, "pot", lieux[i % lieux.length], 35);
    e.activite.finGroupe = fin;
  });
  vie.pot = { motif: choisirTexte(motifs), fin, participants };
}

/* Mise à jour de la vie de l'étage (temps réel) */
function majVie(dt) {
  if (jeu.mode === "pause") return;
  vie.temps += dt;
  majJournee(dt);
  if (vie.temps > vie.prochaineReunion && !vie.reunion) { lancerReunion(); vie.prochaineReunion = vie.temps + 90 + Math.random() * 50; }
  if (vie.reunion && vie.temps > vie.reunion.fin + 6) vie.reunion = null;
  if (vie.temps > vie.prochainPot && !vie.pot) { lancerPot(); vie.prochainPot = vie.temps + 210 + Math.random() * 90; }
  if (vie.pot && vie.temps > vie.pot.fin + 6) vie.pot = null;
  if (jeu.def && jeu.mode === "jeu" && joueur.etage === 1 && vie.temps > vie.prochaineDemande && !vie.demande && !vie.tache) { lancerDemande(); vie.prochaineDemande = vie.temps + 70 + Math.random() * 45; }
  majDemande(dt);
  majTache();
  majSalutations();

  employes.forEach(e => {
    e.t += dt;
    const m = e.mesh;
    if (e.etat === "absent") { majAbsent(e); return; }
    majObjetsPortes(e);
    m.userData.expression = e.etat === "activite" && ["cafe", "pot", "dejeuner", "detente", "machine", "point"].includes(e.activite.type) ? "sourire" : "neutre";
    if (e.etat === "activite" && e.etage === joueur.etage) majRegardSocial(e, employes, dt); else m.userData.cibleRegard = null;
    if (e.enEchange && jeu.mode !== "dialogue") e.enEchange = false;
    if (e.enEchange || (jeu.focus === m)) {
      const angle = Math.atan2(joueur.x - m.position.x, joueur.z - m.position.z);
      if (e.etat === "activite" && ["assis", "ecran"].includes(e.activite.lieu.pose)) poser(m, "assis", e.t);
      else { poser(m, "parle", e.t); tournerVers(m, angle, dt, 6); }
      return;
    }
    if (e.etat === "ascenseur") { majEmployeAscenseur(e, dt); return; }
    if (e.etat === "trajet") {
      const cible = e.chemin[0];
      if (!cible) { arriver(e); return; }
      const dx = cible.x - m.position.x, dz = cible.z - m.position.z, d = Math.hypot(dx, dz);
      if (d < 0.08) { e.chemin.shift(); return; }
      const pas = Math.min(d, e.vitesse * dt);
      const nx = m.position.x + dx / d * pas, nz = m.position.z + dz / d * pas;
      const gene = (jeu.mode !== "menu" && e.etage === joueur.etage && Math.hypot(nx - joueur.x, nz - joueur.z) < 0.75 && Math.hypot(nx - joueur.x, nz - joueur.z) < Math.hypot(m.position.x - joueur.x, m.position.z - joueur.z)) ||
        employes.some(o => o !== e && o.etat === "trajet" && o.etage === e.etage && Math.hypot(nx - o.mesh.position.x, nz - o.mesh.position.z) < 0.55 && Math.hypot(nx - o.mesh.position.x, nz - o.mesh.position.z) < Math.hypot(m.position.x - o.mesh.position.x, m.position.z - o.mesh.position.z));
      if (gene && e.bloque < 1.2) { e.bloque += dt; animerMarche(m, e.t, false); return; }
      e.bloque = gene ? e.bloque : 0;
      m.position.x = nx;
      m.position.z = nz;
      tournerVers(m, Math.atan2(dx, dz), dt, 9);
      animerMarche(m, e.t, true);
      return;
    }
    // Activité en cours
    const l = e.activite.lieu;
    if (e.activite.type === "demande") tournerVers(m, Math.atan2(joueur.x - m.position.x, joueur.z - m.position.z), dt, 6);
    else tournerVers(m, l.a, dt, 6);
    const enDiscussion = e.bulleFin > vie.temps && ["cafe", "pot", "point", "reunion", "machine", "detente", "dejeuner", "standup"].includes(e.activite.type);
    poser(m, l.pose === "ecran" || l.pose === "assis" ? l.pose : enDiscussion ? "parle" : l.pose, e.t);
    // Conversations spontanées entre collègues au même endroit
    if (e.activite.type === "standup" && vie.standup && Math.random() < dt * 0.15 && e.bulleFin < vie.temps) parler(e, choisirTexte(REPLIQUES_STANDUP), 4);
    if (["cafe", "pot", "detente", "dejeuner"].includes(e.activite.type) && e.bulleFin < vie.temps - 2 && Math.random() < dt * 0.25) {
      const voisin = employes.find(o => o !== e && o.etat === "activite" && !o.enEchange && o.etage === e.etage && Math.hypot(o.mesh.position.x - m.position.x, o.mesh.position.z - m.position.z) < 2.2 && o.bulleFin < vie.temps);
      if (voisin) {
        const [q, r] = e.activite.type === "pot" && Math.random() < 0.5 ? [choisirTexte(REPLIQUES.pot), choisirTexte(REPLIQUES.pot)] : choisirTexte(REPLIQUES.discussion);
        parler(e, q, 4.2);
        setTimeout(() => { if (!voisin.enEchange) parler(voisin, r, 4.2); }, 2300);
      }
    }
    if (e.activite.type === "reunion" && vie.reunion && Math.random() < dt * 0.12 && e.bulleFin < vie.temps) parler(e, choisirTexte(REPLIQUES.reunion), 4);
    if (e.activite.type === "appel" && e.bulleFin < vie.temps - 3 && Math.random() < dt * 0.2) parler(e, choisirTexte(REPLIQUES.appel), 5);
    if (vie.temps > e.activite.fin) apresActivite(e);
  });
}

/* Visages vivants des collaborateurs */
function animerVisagesCollaborateurs(dt) {
  employes.forEach(e => { e.mesh.userData.etage = e.etage; animerVivant(e.mesh, dt, { parle: e.bulleFin > vie.temps || jeu.focus === e.mesh, regarder: e.etat === "activite" || e.enEchange }); });
}

/* Étiquettes des collaborateurs : nom et statut à proximité, bulles de dialogue */
function majEtiquettesVie() {
  const v = new THREE.Vector3();
  const w = window.innerWidth, h = window.innerHeight;
  const bulles = [];
  const placer = (el, p, hauteur, empiler = false) => {
    v.set(p.x, hauteur, p.z).project(camera);
    if (v.z > 1 || Math.abs(v.x) > 1.1 || Math.abs(v.y) > 1.1) { ecrireStyle(el, "display", "none"); return; }
    const px = Math.round((v.x * 0.5 + 0.5) * w);
    let py = Math.round((-v.y * 0.5 + 0.5) * h);
    // Deux bulles voisines s'empilent au lieu de se chevaucher
    if (empiler) {
      for (let k = 0; k < 4 && bulles.some(b => Math.abs(b.x - px) < 200 && Math.abs(b.y - py) < 34); k++) py -= 36;
      bulles.push({ x: px, y: py });
    }
    ecrireStyle(el, "display", "flex");
    ecrireStyle(el, "transform", `translate(${px}px, ${py}px) translate(-50%, -100%)`);
  };
  const enJeu = !["menu", "briefing", "bilan"].includes(jeu.mode);
  employes.forEach(e => {
    const p = e.mesh.position;
    const d = e.etage === joueur.etage && e.mesh.visible ? Math.hypot(p.x - joueur.x, p.z - joueur.z) : Infinity;
    const statut = vie.demande && vie.demande.employe === e ? STATUTS.demande : vie.tache && vie.tache.employe === e ? STATUTS.attente : e.etat === "trajet" ? STATUTS.trajet : STATUTS[e.activite.type] || "";
    const montrerNom = enJeu && jeu.mode !== "dialogue" && d < 3.4 && !e.etiquetteMission;
    if (montrerNom) {
      const html = `<span class="c-nom">${echapper(e.def.nom)}</span><span class="c-info">${echapper(e.def.fonction)} · ${echapper(statut)}</span>`;
      if (e.etiquette.dataset.html !== html) { e.etiquette.innerHTML = html; e.etiquette.dataset.html = html; }
      placer(e.etiquette, p, (e.etat === "activite" && ["assis", "ecran"].includes(e.activite.lieu.pose) ? 1.85 : 2.2) + ETAGES[e.etage].y);
    } else ecrireStyle(e.etiquette, "display", "none");
    const montrerBulle = e.bulleFin > vie.temps && e.bulle && (enJeu ? d < 9 : e.etage === joueur.etage) && !e.enEchange && jeu.mode !== "dialogue";
    if (montrerBulle) {
      if (e.bulleEl.textContent !== e.bulle) e.bulleEl.textContent = e.bulle;
      placer(e.bulleEl, p, (e.etat === "activite" && ["assis", "ecran"].includes(e.activite.lieu.pose) ? 1.85 : 2.2) + (montrerNom ? 0.55 : 0) + ETAGES[e.etage].y, true);
    } else ecrireStyle(e.bulleEl, "display", "none");
  });
  // Bandeaux des moments collectifs
  [["standup", { x: -11.1, z: -5.0 }, () => vie.standup.sujet], ["reunion", SALLE.agora.entree, () => (EN ? `Agora Room · ${vie.reunion.sujet}` : `Salle Agora · ${vie.reunion.sujet}`)], ["pot", { x: -4.4, z: 7.8 }, () => (EN ? `Cafeteria · ${vie.pot.motif}` : `Cafétéria · ${vie.pot.motif}`)]].forEach(([cle, point, texte]) => {
    let el = $(`bandeau-${cle}`);
    if (!el) { el = document.createElement("div"); el.id = `bandeau-${cle}`; el.className = "etiquette etq-evenement"; $("etiquettes").appendChild(el); }
    const actif = vie[cle] && vie[cle].participants.some(e => e.etat === "activite" && e.activite.type === cle);
    if (!actif || !enJeu || joueur.etage !== 1) { ecrireStyle(el, "display", "none"); return; }
    const t = texte();
    if (el.textContent !== t) el.textContent = t;
    placer(el, point, 2.9);
  });
}

/* Échanges avec les collaborateurs (touche E) */
function collaborateurProche() {
  // Un collègue venu vous solliciter peut être écouté sans être visé
  const dm = vie.demande;
  if (dm && dm.etat === "attente" && !dm.employe.enEchange && dm.employe.etage === joueur.etage && Math.hypot(dm.employe.mesh.position.x - joueur.x, dm.employe.mesh.position.z - joueur.z) < 2.4) return dm.employe;
  let meilleur = null, dMin = Infinity;
  employes.forEach(e => {
    if (e.enEchange || e.etage !== joueur.etage || !e.mesh.visible) return;
    const d = Math.hypot(e.mesh.position.x - joueur.x, e.mesh.position.z - joueur.z);
    const a = angleVers(e.mesh.position);
    if (d > 2.4 || (a > 0.55 && d > 0.9)) return;
    const score = d * (1 + 2 * a);
    if (score < dMin) { dMin = score; meilleur = e; }
  });
  return meilleur;
}
function ajusterRelation(e, delta) {
  resultats.relations[e.cle] = clamp(relation(e.cle) + delta, 0, 100);
  sauverResultats();
  majPosture();
}
function reseauInterne() {
  const v = employes.map(e => relation(e.cle));
  return Math.round(v.reduce((s, x) => s + x, 0) / Math.max(1, v.length));
}
function contexteEchange(e) {
  if (e.etat === "trajet") return "passage";
  const t = e.activite.type;
  if (t === "reunion" || t === "standup") return "reunion";
  if (t === "appel") return "appel";
  if (t === "point") return "point";
  if (["machine", "cafe", "pot", "detente", "fontaine", "sortie", "dejeuner"].includes(t)) return "pause";
  return "travail";
}
/* Conclusion commune d'un échange : relation, journal, posture, conseil éventuel */
function conclureEchange(e, delta, journal, reponse, { posture = 0, conseil = false, temps = 4, reflexe = "", suite = null } = {}) {
  ajusterRelation(e, delta);
  vie.echanges++;
  if (journal) noter(delta > 0 ? "ok" : delta < 0 ? "neutre" : "info", (EN ? `Conversation with ${e.def.nom}: ${journal}` : `Échange avec ${e.def.nom} : ${journal}`));
  if (posture > 0) deplacerPosture(posture);
  if (posture < 0) deplacerPosture(posture, reflexe);
  if (jeu.def) avancerTemps(temps);
  let texte = `${guillemets(reponse)}`;
  const idMission = jeu.def ? jeu.def.id : "accueil";
  if (conseil && relation(e.cle) >= 58 && !e.conseils[idMission]) {
    const c = CONSEILS_COLLEGUES[e.cle];
    const astuce = c && (c[idMission] || c.defaut);
    if (astuce) {
      e.conseils[idMission] = true;
      texte += (EN ? `\n\nBy the way: “${astuce}”` : `\n\nAu fait : ${guillemets(astuce)}`);
      information((EN ? `Tip from ${e.def.nom}: ${astuce}` : `Conseil de ${e.def.nom} : ${astuce}`));
    }
  }
  ouvrirEntretien({
    interlocuteur: interlocuteurEmploye(e), canal: (EN ? "Informal chat" : "Échange informel"), confiance: relation(e.cle), focus: e.mesh, texte,
    choix: [{ label: suite ? suite.label : (EN ? "End the conversation" : "Terminer l'échange"), action: () => { fermerEntretien(); e.enEchange = false; if (suite) suite.action(); } }]
  });
  if (delta > 0) message((EN ? `Relationship with ${e.prenom}: ${relation(e.cle)}/100` : `Relation avec ${e.prenom} : ${relation(e.cle)}/100`), "ok", 2000);
  else if (delta < 0) message((EN ? `Relationship with ${e.prenom}: ${relation(e.cle)}/100` : `Relation avec ${e.prenom} : ${relation(e.cle)}/100`), "alerte", 2400);
}
const interlocuteurEmploye = e => ({ nom: e.def.nom, fonction: e.def.fonction, entreprise: "Veltis", couleur: e.def.couleur });
// Transforme une liste de choix déclaratifs en boutons d'entretien
const choixEchange = (e, liste) => liste.map(c => ({ label: c.label, action: () => { if (c.avant) c.avant(); conclureEchange(e, c.delta, c.journal, c.reponse, c); } }));

function discuter(e) {
  if (jeu.mode !== "jeu") return;
  if (vie.demande && vie.demande.employe === e) return traiterDemande(e);
  if (vie.tache && vie.tache.employe === e) return vie.tache.surContact(e);
  const ctx = contexteEchange(e);
  const r = relation(e.cle);
  const autre = choisirTexte(employes.filter(o => o !== e && !["manager", "dg"].includes(o.cle)));
  e.enEchange = true;
  let texte, choix;
  if (ctx === "reunion") {
    texte = (EN ? `Through the glass wall of the Agora Room, ${e.prenom} waves at you: the meeting is in progress.` : `À travers la paroi vitrée de la salle Agora, ${e.prenom} vous fait signe : la réunion est en cours.`);
    choix = [
      { label: (EN ? "Signal that you'll come back after the meeting." : "Lui faire signe que vous repasserez après la réunion."), delta: 2, journal: (EN ? "meeting respected." : "réunion respectée."), reponse: (EN ? "Thanks, I'll come and see you right after." : "Merci, je passe te voir juste après.") },
      { label: (EN ? "Go in to ask your question, it'll be quick." : "Entrer pour poser votre question, ce sera rapide."), delta: -6, journal: (EN ? "meeting interrupted." : "réunion interrompue."), reponse: (EN ? "We're in the middle of a team meeting… Let's talk afterwards, OK?" : "On est en plein point d'équipe… On en parle après, d'accord ?") }
    ];
  } else if (ctx === "appel") {
    texte = (EN ? `${e.prenom} is on the phone with a client and raises a finger to ask you to wait a moment.` : `${e.prenom} est au téléphone avec un client et lève un doigt pour vous demander un instant.`);
    choix = [
      { label: (EN ? "Wait discreetly until the call ends." : "Attendre la fin de l'appel en restant discret."), delta: 4, journal: (EN ? "client call respected." : "appel client respecté."), reponse: (EN ? `Thanks for waiting! ${choisirTexte(REPLIQUES.vie)}` : `Merci d'avoir attendu ! ${choisirTexte(REPLIQUES.vie)}`), conseil: true, temps: 6 },
      { label: (EN ? "Talk to them anyway: it's important." : "Lui parler quand même : c'est important."), delta: -6, journal: (EN ? "interruption during a client call." : "interruption pendant un appel client."), reponse: (EN ? "I was with a client… Come back in five minutes, please." : "J'étais avec un client… Repasse dans cinq minutes, s'il te plaît.") }
    ];
  } else if (ctx === "point" || ctx === "passage") {
    texte = ctx === "point" ? (EN ? "“We're finishing a catch-up on a file, I'll be with you in two minutes.”" : "« On termine un point sur un dossier, je suis à toi dans deux minutes. »") : (EN ? "“I'm off to my next meeting, shall we talk later?”" : "« Je file à mon prochain rendez-vous, on se parle plus tard ? »");
    choix = [
      { label: ctx === "point" ? (EN ? "“Take your time, I'll come back.”" : "« Prends ton temps, je repasse. »") : (EN ? "“Of course, good luck with your meeting!”" : "« Bien sûr, bon rendez-vous ! »"), delta: 2, journal: (EN ? "short and respectful exchange." : "échange bref et respectueux."), reponse: (EN ? "Thanks, see you later!" : "Merci, à tout à l'heure !") },
      { label: (EN ? "“Can you just sign this off for me, quickly?”" : "« Tu peux juste me valider ça, vite fait ? »"), delta: -3, journal: (EN ? "pushy request at the wrong time." : "demande pressante au mauvais moment."), reponse: (EN ? "I really don't have time right now, sorry." : "Là, je n'ai vraiment pas le temps, désolé.") }
    ];
  } else if (ctx === "travail") {
    texte = (EN ? `${e.prenom} is focused on their screen. “${choisirTexte(REPLIQUES.travail)}”` : `${e.prenom} est concentré${e.def.f ? "e" : ""} sur son écran. ${guillemets(choisirTexte(REPLIQUES.travail))}`);
    choix = [
      { label: (EN ? "“I won't disturb you. Coffee later?”" : "« Je ne te dérange pas. On se prend un café plus tard ? »"), delta: 4, journal: (EN ? "respecting a colleague's focus." : "respect de la concentration d'un collègue."), reponse: (EN ? "Happy to, around 4 pm?" : "Avec plaisir, vers 16 h ?") },
      { label: (EN ? "“Need a fresh pair of eyes? I can review it with you.”" : "« Besoin d'un regard extérieur ? Je peux relire avec toi. »"), delta: 6, journal: (EN ? "help offered to a colleague." : "aide proposée à un collègue."), reponse: (EN ? `Honestly, yes, thanks. You know what would really help me day to day? ${BESOINS_METIER[e.cle]}` : `Franchement, oui, merci. Tu sais ce qui m'aiderait vraiment au quotidien ? ${BESOINS_METIER[e.cle]}`), posture: 1, conseil: true, temps: 10 },
      r >= 60
        ? { label: (EN ? "“Got two minutes? I need you right now.”" : "« Tu as deux minutes ? J'ai besoin de toi tout de suite. »"), delta: 1, journal: (EN ? "request accepted." : "sollicitation acceptée."), reponse: (EN ? "Go on, I'm listening, but quickly then." : "Vas-y, je t'écoute, mais vite alors."), conseil: true }
        : { label: (EN ? "“Got two minutes? I need you right now.”" : "« Tu as deux minutes ? J'ai besoin de toi tout de suite. »"), delta: -4, journal: (EN ? "request at the wrong time." : "sollicitation au mauvais moment."), reponse: (EN ? "Not now, really… Come back later, OK?" : "Là, vraiment pas… Repasse plus tard, d'accord ?") },
      { label: (EN ? `“Have you seen ${autre.prenom}'s results? Not looking great…”` : `« Tu as vu les résultats de ${autre.prenom} ? Ça ne va pas fort… »`), delta: -8, journal: (EN ? "gossip about a colleague." : "commérage sur un collègue."), reponse: (EN ? "I'd rather not talk about people behind their backs." : "Je préfère ne pas parler des autres dans leur dos.") }
    ];
  } else {
    texte = `${guillemets(choisirTexte(REPLIQUES.ouverture))}`;
    choix = [
      { label: (EN ? "“Yes, thanks! And you, how are things at the moment?”" : "« Oui, merci ! Et toi, comment ça va en ce moment ? »"), delta: 6, journal: (EN ? "listening and genuine interest." : "écoute et intérêt sincère."), reponse: choisirTexte(REPLIQUES.vie), conseil: true },
      { label: (EN ? "“What would make your life easier when working with the sales team?”" : "« Qu'est-ce qui te faciliterait la vie avec les commerciaux ? »"), delta: 7, journal: (EN ? "interest in a colleague's job." : "intérêt pour le métier d'un collègue."), reponse: BESOINS_METIER[e.cle], posture: 1, conseil: true, temps: 6 },
      { label: (EN ? "“Sorry, no time, I've got three meetings waiting.”" : "« Désolé, pas le temps, j'ai trois rendez-vous qui m'attendent. »"), delta: -2, journal: (EN ? "conversation cut short." : "échange écourté."), reponse: (EN ? "No problem, off you go!" : "Pas de souci, file !") },
      { label: (EN ? "“This quarter I'm hitting my number, even if I have to slash prices.”" : "« Moi, ce trimestre, je fais mon chiffre, quitte à brader les remises. »"), delta: -5, journal: (EN ? "“numbers at any cost” attitude, a conversion blocker." : "attitude « chiffre à tout prix », frein à la conversion."), reponse: (EN ? "Hmm… Watch the renewals: we're the ones who get the unhappy discounted customers back." : "Hmm… Attention aux renouvellements : les clients bradés, c'est nous qui les récupérons mécontents."), posture: -2, reflexe: (EN ? "“Numbers at any cost” talk in front of a colleague." : "Discours « chiffre à tout prix » tenu devant un collègue.") }
    ];
  }
  const comparaison = ["travail", "pause"].includes(ctx) ? choixComparaison(e.cle) : null;
  if (comparaison) choix.push(comparaison);
  ouvrirEntretien({ interlocuteur: interlocuteurEmploye(e), canal: (EN ? "Informal chat" : "Échange informel"), confiance: r, focus: e.mesh, texte, choix: melangerChoix(choixEchange(e, choix)) });
}

/* ---------- A9 ter. Sollicitations, tâches, objets et réactions de l'équipe ---------- */

/* Demandes que les collègues viennent faire au participant */
const DEMANDES = [
  { de: "samira", accroche: (EN ? "Your last order form is incomplete: the number of licences is missing." : "Ton dernier bon de commande est incomplet : il manque le nombre de licences."), texte: (EN ? "“Without it, I can't start the onboarding. Can you bring it to my desk within the minute?”" : "« Sans ça, je ne peux pas lancer la mise en service. Tu peux me l'apporter à mon poste dans la minute ? »"),
    choix: e => [
      { label: (EN ? "“I'll check and bring it to you right away.”" : "« Je vérifie et je te l'apporte tout de suite. »"), tache: { titre: (EN ? "Bring the order details to Samira" : "Apporter les informations de commande à Samira"), employe: "samira", delai: 60,
        reussi: f => conclureEchange(f, 8, (EN ? "order form completed in time for Sales Admin." : "bon de commande complété à temps pour l'ADV."), (EN ? "Perfect, I'm starting the onboarding. Thanks for being so quick!" : "Parfait, je lance la mise en service. Merci pour ta réactivité !"), { posture: 1, conseil: true }) } },
      { label: (EN ? "“Make do with what you've got, the client has signed.”" : "« Débrouille-toi avec ce qu'il y a, le client a signé. »"), delta: -8, journal: (EN ? "sales admin process neglected." : "processus ADV négligé."), reponse: (EN ? "If the order is wrong, it's the client who'll be kept waiting… I'd rather we did it properly." : "Si la commande est fausse, c'est le client qui attendra… Je préfère qu'on la fasse bien.") }
    ] },
  { de: "maxime", accroche: (EN ? "I've qualified several leads for you this week." : "J'ai qualifié plusieurs leads pour toi cette semaine."), texte: (EN ? "“Can you give me honest feedback on their quality? It helps me target better.”" : "« Tu peux me faire un retour honnête sur leur qualité ? Ça m'aide à mieux cibler. »"),
    choix: e => [
      { label: (EN ? "“Yes: two were very ready, one lacked budget. Keep going with the pricing pages.”" : "« Oui : deux étaient très mûrs, un manquait de budget. Continue sur les pages Tarifs. »"), delta: 7, journal: (EN ? "precise feedback given to the SDR." : "retour précis donné au SDR."), reponse: (EN ? "Great, that's exactly the kind of feedback I need." : "Top, c'est exactement le genre de retour qu'il me faut."), posture: 1, conseil: true },
      { label: (EN ? "“Frankly, your leads are worthless.”" : "« Franchement, tes leads ne valent rien. »"), delta: -10, journal: (EN ? "harsh, unconstructive feedback." : "retour brutal et non constructif."), reponse: (EN ? "OK… I'll check with Léa, then." : "D'accord… Je vais voir avec Léa, alors.") },
      { label: (EN ? "“Later, I haven't looked yet.”" : "« Plus tard, je n'ai pas regardé. »"), delta: -1, journal: (EN ? "feedback postponed." : "retour reporté."), reponse: (EN ? "OK, don't forget, it matters to me." : "Ok, n'oublie pas, ça compte pour moi.") }
    ] },
  { de: "arthur", accroche: (EN ? "We're preparing a customer testimonial campaign." : "On prépare une campagne de témoignages clients."), texte: (EN ? "“Would you have a happy customer willing to give a testimonial?”" : "« Tu aurais un client satisfait qui accepterait de témoigner ? »"),
    choix: e => [
      { label: (EN ? "“I'll ask a promoter customer, with their written consent.”" : "« Je demande à un client promoteur, avec son accord écrit. »"), delta: 7, journal: (EN ? "customer testimonial obtained properly." : "témoignage client obtenu dans les règles."), reponse: (EN ? "Brilliant. Real proof converts better than any slogan." : "Génial. Une vraie preuve convertit mieux que n'importe quel slogan."), posture: 1, conseil: true },
      { label: (EN ? "“I'll write a testimonial myself, it'll be quicker.”" : "« Je rédige un témoignage moi-même, ce sera plus rapide. »"), delta: -6, journal: (EN ? "fake testimonial suggested." : "proposition de faux témoignage."), reponse: (EN ? "No, we only publish real, approved testimonials." : "Non, on ne publie que des témoignages réels et validés."), posture: -2, reflexe: (EN ? "Fake customer testimonial suggested to marketing." : "Faux témoignage client proposé au marketing.") },
      { label: (EN ? "“No time this week.”" : "« Pas le temps cette semaine. »"), delta: -2, journal: (EN ? "marketing request declined." : "demande du marketing déclinée."), reponse: (EN ? "Shame, maybe another time." : "Dommage, une autre fois peut-être.") }
    ] },
  { de: "chloe", accroche: (EN ? "A visitor has arrived at reception and is asking for you." : "Un visiteur se présente à l'accueil et demande à vous voir."), texte: (EN ? "“He's dropping off documents for one of your files. Could you come down to reception?”" : "« Il dépose des documents pour un de vos dossiers. Vous pouvez descendre à l'accueil ? »"),
    choix: e => [
      { label: (EN ? "“I'm coming to reception right away.”" : "« J'arrive tout de suite à l'accueil. »"), tache: { titre: (EN ? "Go to reception to meet the visitor" : "Rejoindre l'accueil pour recevoir le visiteur"), lieu: { x: 8.15, z: 6.4 }, delai: 50,
        reussi: () => { const f = employe("chloe"); conclureEchange(f, 6, (EN ? "visitor welcomed without being kept waiting." : "visiteur reçu sans le faire attendre."), (EN ? "Thanks for coming so quickly: he appreciated it. I've left his documents for you." : "Merci d'être venu vite : il a apprécié. Je vous ai laissé ses documents."), { posture: 1 }); } } },
      { label: (EN ? "“Tell him to leave them, I'll drop by.”" : "« Dites-lui de laisser ça, je passerai. »"), delta: -2, journal: (EN ? "visitor not received." : "visiteur non reçu."), reponse: (EN ? "Very well, I'll let him know." : "Très bien, je lui transmets.") }
    ] },
  { de: "dg", accroche: (EN ? "Come and see me in my office when you have a moment." : "Passe me voir dans mon bureau quand tu as un moment."), texte: (EN ? "“I'd like your view from the field on our customer strategy.”" : "« Je voudrais ton avis de terrain sur notre stratégie client. »"),
    choix: e => [
      { label: (EN ? "“With pleasure, I'll join you.”" : "« Avec plaisir, je vous rejoins. »"), tache: { titre: (EN ? "Join Catherine Aubert at the Executive Office" : "Rejoindre Catherine Aubert à la Direction générale"), employe: "dg", delai: 70, retourPoste: true,
        reussi: f => {
          f.enEchange = true;
          ouvrirEntretien({
            interlocuteur: interlocuteurEmploye(f), canal: (EN ? "Executive office" : "Bureau de la direction"), confiance: relation(f.cle), focus: f.mesh,
            texte: (EN ? "“We're torn between two priorities for next year: hiring more sales reps to sign more deals, or investing in customer follow-up. What would you do?”" : "« On hésite entre deux priorités pour l'an prochain : recruter plus de commerciaux pour signer davantage, ou investir dans le suivi client. Tu ferais quoi ? »"),
            choix: melangerChoix(choixEchange(f, [
              { label: (EN ? "“Invest in onboarding and follow-up: a customer who stays five years is worth three discounted ones.”" : "« Investir dans l'onboarding et le suivi : un client qui reste cinq ans vaut trois clients bradés. »"), delta: 8, journal: (EN ? "CLV vision shared with management." : "vision CLV partagée avec la direction."), reponse: (EN ? "That's my analysis too. I'll use your input at the board meeting." : "C'est aussi mon analyse. Je vais m'appuyer sur ton retour en comité."), posture: 2 },
              { label: (EN ? "“Hire hunters: we need to sign, sign, sign.”" : "« Recruter des chasseurs : il faut signer, signer, signer. »"), delta: -2, journal: (EN ? "short-term vision proposed." : "vision court terme proposée."), reponse: (EN ? "Signing without keeping is like filling a leaky bucket…" : "Signer sans garder, c'est remplir un seau percé…"), posture: -1, reflexe: (EN ? "“Volume above all” vision defended to management." : "Vision « volume avant tout » défendue auprès de la direction.") },
              { label: (EN ? "“Both, but measuring each sales rep's retention.”" : "« Les deux, mais en mesurant la rétention de chaque commercial. »"), delta: 6, journal: (EN ? "retention-based management suggested." : "proposition d'un pilotage par la rétention."), reponse: (EN ? "Interesting. Measuring retention per rep would change behaviours." : "Intéressant. Mesurer la rétention par commercial, ça changerait les comportements."), posture: 1 }
            ]))
          });
        } } },
      { label: (EN ? "“I'm swamped, can we look at it next week?”" : "« Je suis débordé, on peut voir ça la semaine prochaine ? »"), delta: -3, journal: (EN ? "management invitation postponed." : "invitation de la direction reportée."), reponse: (EN ? "Understood. Don't leave it too long." : "Entendu. Ne laisse pas passer trop de temps.") }
    ] },
  { de: "gilles", accroche: (EN ? "Your average discount worries me a little." : "Ta remise moyenne m'inquiète un peu."), texte: (EN ? "“Every point of discount comes straight out of the margin. Shall we talk for two minutes?”" : "« Chaque point de remise sort directement de la marge. On en parle deux minutes ? »"),
    choix: e => [
      { label: (EN ? "“You're right. I'll go for a 3-year commitment rather than a straight discount.”" : "« Tu as raison. Je vise l'engagement de 3 ans plutôt qu'une remise sèche. »"), delta: 7, journal: (EN ? "constructive exchange on margin." : "échange constructif sur la marge."), reponse: (EN ? "Exactly. Give and take: discount in exchange for duration." : "Voilà. Donnant-donnant : la remise contre de la durée."), posture: 1, conseil: true },
      { label: (EN ? "“Discounts are my problem, not yours.”" : "« Les remises, c'est mon problème, pas le tien. »"), delta: -8, journal: (EN ? "refusal to engage with financial control." : "refus d'échanger avec le contrôle de gestion."), reponse: (EN ? "It's the whole company's problem, actually." : "C'est le problème de toute l'entreprise, en fait."), posture: -1, reflexe: (EN ? "Discounts defended with no regard for margin." : "Remises défendues sans regard pour la marge.") }
    ] },
  { de: "adrien", accroche: (EN ? "A client told me about a custom integration you apparently promised them." : "Un client m'a parlé d'une intégration sur mesure que tu lui aurais promise."), texte: (EN ? "“I wasn't aware. How do we handle it?”" : "« Je n'étais pas au courant. On fait comment ? »"),
    choix: e => [
      { label: (EN ? "“I'll clarify with the client. From now on, I'll check with you before promising.”" : "« Je clarifie avec le client. À l'avenir, je te consulte avant de promettre. »"), delta: 7, journal: (EN ? "technical commitment clarified." : "engagement technique clarifié."), reponse: (EN ? "Thanks. I'd rather say yes knowing what we're selling." : "Merci. Je préfère dire oui en sachant ce qu'on vend."), posture: 1, conseil: true },
      { label: (EN ? "“It's sold, you sort it out.”" : "« C'est vendu, débrouille-toi. »"), delta: -10, journal: (EN ? "unapproved promise forced on the technical team." : "promesse non validée imposée à l'équipe technique."), reponse: (EN ? "That kind of promise, the client pays for it… and so do we." : "Ce genre de promesse, c'est le client qui la paie… et nous aussi."), posture: -2, reflexe: (EN ? "Technical promise made without approval." : "Promesse technique faite sans validation.") }
    ] },
  { de: "fatou", accroche: (EN ? "Shall we do the handover of a new customer together?" : "On fait la passation d'un nouveau client ensemble ?"), texte: (EN ? "“I'll wait for you in the Agora Room: tell me what you promised and what the client expects.”" : "« Je t'attends en salle Agora : tu me racontes ce que tu as promis et ce que le client attend. »"),
    choix: e => [
      { label: (EN ? "“Good idea, I'll meet you in the Agora Room.”" : "« Bonne idée, je te rejoins en salle Agora. »"), tache: { titre: (EN ? "Sales handover with Fatou in the Agora Room" : "Passation commerciale avec Fatou en salle Agora"), lieu: SALLE.agora.entree, delai: 70, aller: f => ({ x: SALLE.agora.minX + 0.9, z: SALLE.agora.z - 1.3, a: O / 2 }),
        reussi: () => { const f = employe("fatou"); conclureEchange(f, 9, (EN ? "sales handover completed with Customer Success." : "passation commerciale réalisée avec le Customer Success."), (EN ? "Great. The customer will be welcomed properly: that's where loyalty begins." : "Super. Le client sera accueilli comme il faut : c'est là que la fidélité commence."), { posture: 2, conseil: true }); } } },
      { label: (EN ? "“It's all in the CRM, read it.”" : "« Tout est dans le CRM, lis-le. »"), delta: -4, journal: (EN ? "sloppy handover." : "passation bâclée."), reponse: (EN ? "The CRM doesn't say everything… The client may well notice." : "Le CRM ne dit pas tout… Le client risque de s'en rendre compte.") }
    ] },
  { de: "sofia", accroche: (EN ? "I'm stuck on a price objection from a key account." : "Je bloque sur une objection prix d'un grand compte."), texte: (EN ? "“He says Salesbase is 20% cheaper. What would you do?”" : "« Il me dit que Salesbase est 20 % moins cher. Tu ferais quoi ? »"),
    choix: e => [
      { label: (EN ? "“Isolate the objection, then compare scopes and total cost over 3 years.”" : "« Isoler l'objection, puis comparer les périmètres et le coût total sur 3 ans. »"), delta: 6, journal: (EN ? "methodical advice shared with a colleague." : "conseil méthodique partagé avec une collègue."), reponse: (EN ? "Yes, back to value rather than price. Thanks!" : "Oui, revenir à la valeur plutôt qu'au prix. Merci !"), posture: 1 },
      { label: (EN ? "“Give him 25% off and sign, we'll see later.”" : "« Fais-lui -25 % et signe, on verra après. »"), delta: -4, journal: (EN ? "advice to give a massive discount." : "conseil de remise massive."), reponse: (EN ? "And at renewal, he'll demand another 25% off…" : "Et au renouvellement, il exigera encore -25 %…"), posture: -2, reflexe: (EN ? "Massive discount advised to sign at any cost." : "Remise massive conseillée pour signer à tout prix.") }
    ] },
  { de: "thomas", accroche: (EN ? "I have a discovery call in a moment." : "J'ai un appel de découverte dans un instant."), texte: (EN ? "“Do you want to listen in and give me feedback afterwards? We always learn from each other.”" : "« Tu veux m'écouter et me faire un retour ensuite ? On apprend toujours des autres. »"),
    choix: e => [
      { label: (EN ? "“Gladly, and I'll tell you what I do differently.”" : "« Volontiers, et je te dis ce que je fais différemment. »"), delta: 6, journal: (EN ? "practice sharing between sales reps." : "partage de pratiques entre commerciaux."), reponse: (EN ? "Thanks, your question about the impact of the problem was excellent, I'm keeping it." : "Merci, ta question sur l'impact du problème était excellente, je la garde."), posture: 1, temps: 12, conseil: true },
      { label: (EN ? "“I've got nothing to learn, thanks.”" : "« Je n'ai rien à apprendre, merci. »"), delta: -6, journal: (EN ? "refusal to share practices." : "refus de partager les pratiques."), reponse: (EN ? "As you like…" : "Comme tu veux…") }
    ] }
];
const employe = cle => employes.find(e => e.cle === cle);
const demandesFaites = new Set();

/* Marqueur de destination d'une tâche (faisceau ambre) */
const materiauTache = new THREE.MeshBasicMaterial({ color: 0xd97706, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide });
const materiauTacheAnneau = new THREE.MeshBasicMaterial({ color: 0xd97706, transparent: true, opacity: 0.65, depthWrite: false, side: THREE.DoubleSide });
let marqueurTache = null;
function obtenirMarqueur() {
  if (marqueurTache) return marqueurTache;
  marqueurTache = new THREE.Group();
  const f = new THREE.Mesh(geoBalise, materiauTache);
  f.position.y = 1.35;
  const a = new THREE.Mesh(geoAnneau, materiauTacheAnneau);
  a.rotation.x = -Math.PI / 2;
  a.position.y = 0.07;
  marqueurTache.add(f, a);
  groupeR1.add(marqueurTache);
  return marqueurTache;
}

function lancerDemande() {
  const candidates = DEMANDES.filter(d => !demandesFaites.has(d.de)).filter(d => {
    const e = employe(d.de);
    return e && !e.enEchange && e.etage === 1 && !["reunion", "pot", "appel", "sortie"].includes(e.activite.type) && !e.etiquetteMission;
  });
  if (!candidates.length) return;
  const d = choisirTexte(candidates);
  const e = employe(d.de);
  demandesFaites.add(d.de);
  vie.demande = { modele: d, employe: e, etat: "approche", debut: vie.temps };
  allerVersJoueur(e);
}
function allerVersJoueur(e) {
  const dx = e.mesh.position.x - joueur.x, dz = e.mesh.position.z - joueur.z, d = Math.hypot(dx, dz) || 1;
  const cible = { x: joueur.x + dx / d * 1.1, z: joueur.z + dz / d * 1.1, a: 0, pose: "parle" };
  envoyer(e, "demande", cible, 30);
  e.activite.versJoueur = { x: joueur.x, z: joueur.z };
}
function majDemande(dt) {
  const dm = vie.demande;
  if (!dm) return;
  const e = dm.employe;
  if (jeu.mode === "bilan" || !jeu.def || joueur.etage !== 1) { abandonnerDemande(false); return; }
  if (e.enEchange) return;
  const d = Math.hypot(e.mesh.position.x - joueur.x, e.mesh.position.z - joueur.z);
  if (dm.etat === "approche") {
    const v = e.activite.versJoueur;
    if (e.etat === "trajet" && v && Math.hypot(v.x - joueur.x, v.z - joueur.z) > 1.8 && vie.temps - (dm.dernierCalcul || 0) > 1.5) { dm.dernierCalcul = vie.temps; allerVersJoueur(e); }
    if (d < 1.9 || e.etat === "activite") {
      dm.etat = "attente";
      dm.debutAttente = vie.temps;
      parler(e, (EN ? `Got a minute? ${dm.modele.accroche}` : `Tu as une minute ? ${dm.modele.accroche}`), 30);
      if (jeu.mode === "jeu") message((EN ? `${e.def.nom} wants to talk to you (E key).` : `${e.def.nom} souhaite vous parler (touche E).`), "info", 3200);
    }
    if (vie.temps - dm.debut > 60) abandonnerDemande(true);
  } else if (dm.etat === "attente") {
    if (d > 4.5 && e.etat === "activite") { dm.etat = "approche"; allerVersJoueur(e); }
    if (vie.temps - dm.debutAttente > 35) abandonnerDemande(true);
  }
}
function abandonnerDemande(penalite) {
  const dm = vie.demande;
  if (!dm) return;
  vie.demande = null;
  const e = dm.employe;
  e.bulle = "";
  if (penalite && jeu.def && jeu.mode !== "bilan") {
    ajusterRelation(e, -3);
    noter("neutre", (EN ? `${e.def.nom} left without being able to talk to you.` : `${e.def.nom} est reparti${e.def.f ? "e" : ""} sans avoir pu vous parler.`));
    parler(e, (EN ? "Oh well, I'll come back…" : "Bon, tant pis, je reviendrai…"), 4);
  }
  if (!e.enEchange) choisirActivite(e);
}
function traiterDemande(e) {
  const dm = vie.demande;
  vie.demande = null;
  e.enEchange = true;
  e.bulle = "";
  const choix = dm.modele.choix(e).map(c => c.tache
    ? { label: c.label, action: () => { fermerEntretien(); e.enEchange = false; demarrerTache(c.tache, e); } }
    : { label: c.label, action: () => conclureEchange(e, c.delta, c.journal, c.reponse, c) });
  ouvrirEntretien({ interlocuteur: interlocuteurEmploye(e), canal: (EN ? "Request" : "Sollicitation"), confiance: relation(e.cle), focus: e.mesh, texte: `${guillemets(dm.modele.accroche)}\n\n${dm.modele.texte}`, choix: melangerChoix(choix) });
  choisirApres(e);
}
// L'auteur d'une demande reprend sa journée (ou rejoint le lieu de la tâche)
function choisirApres(e) {
  setTimeout(() => { if (!e.enEchange && !(vie.tache && vie.tache.employe === e)) choisirActivite(e); }, 50);
}

/* Tâches : rejoindre un lieu ou un collègue dans un délai */
function demarrerTache(t, auteur) {
  const cible = t.employe ? employe(t.employe) : null;
  if (cible) ramener(cible);
  vie.tache = {
    titre: t.titre, fin: vie.temps + t.delai, delai: t.delai, employe: cible, lieu: t.lieu || null, auteur,
    surContact: f => { terminerTache(); t.reussi(f); },
    surArrivee: () => { terminerTache(); t.reussi(); }
  };
  if (cible) {
    // Le collègue attend au poste (ou à la Direction générale)
    envoyer(cible, "attente", cible.siege, t.delai + 5);
  } else if (t.aller && auteur) {
    const lieu = t.aller(auteur);
    envoyer(auteur, "attente", { x: lieu.x, z: lieu.z, a: lieu.a, pose: "debout" }, t.delai + 5);
  }
  message((EN ? `New task: ${t.titre}.` : `Nouvelle tâche : ${t.titre}.`), "info", 3200);
  noter("info", (EN ? `Task accepted: ${t.titre}.` : `Tâche acceptée : ${t.titre}.`));
}
function terminerTache() {
  vie.tache = null;
  if (marqueurTache) marqueurTache.visible = false;
}
function majTache() {
  const t = vie.tache;
  const el = $("hud-taches");
  if (!t || !jeu.def || jeu.mode === "bilan") {
    if (t && (!jeu.def || jeu.mode === "bilan")) terminerTache();
    el.classList.add("cache");
    if (marqueurTache) marqueurTache.visible = false;
    return;
  }
  const point = t.employe ? t.employe.mesh.position : t.lieu;
  const marqueur = obtenirMarqueur();
  marqueur.visible = true;
  marqueur.position.set(point.x, 0, point.z);
  const reste = Math.max(0, t.fin - vie.temps);
  el.classList.remove("cache");
  const html = (EN ? `<span class="tache-titre">To do</span><span class="tache-texte">${echapper(t.titre)}</span><span class="tache-info">${Math.ceil(reste)} s · ${distanceMetres(point)} m</span>` : `<span class="tache-titre">À faire</span><span class="tache-texte">${echapper(t.titre)}</span><span class="tache-info">${Math.ceil(reste)} s · ${distanceMetres(point)} m</span>`);
  if (el.dataset.html !== html) { el.innerHTML = html; el.dataset.html = html; }
  el.classList.toggle("urgent", reste < 15);
  if (jeu.mode === "jeu" && t.lieu && joueur.etage === 1 && Math.hypot(joueur.x - t.lieu.x, joueur.z - t.lieu.z) < 1.6) { t.surArrivee(); return; }
  if (reste <= 0 && jeu.mode === "jeu") {
    const qui = t.employe || t.auteur;
    terminerTache();
    if (qui) {
      ajusterRelation(qui, -5);
      parler(qui, (EN ? "I was waiting for you…" : "Je t'ai attendu…"), 5);
      choisirActivite(qui);
    }
    noter("neutre", (EN ? `Task not completed on time: ${t.titre}.` : `Tâche non tenue dans les délais : ${t.titre}.`));
    message((EN ? `Task missed: ${t.titre}. ${qui ? (EN ? `${qui.prenom} was waiting for you.` : `${qui.prenom} vous a attendu.`) : ""}` : `Tâche manquée : ${t.titre}. ${qui ? (EN ? `${qui.prenom} was waiting for you.` : `${qui.prenom} vous a attendu.`) : ""}`), "alerte", 3600);
  }
}

/* Invitation à la réunion d'équipe */
function inviterReunion() {
  if (!jeu.def || jeu.mode !== "jeu" || vie.tache || !vie.reunion) return;
  const r = vie.reunion;
  const animateur = r.participants[0];
  if (!animateur) return;
  vie.tache = {
    titre: (EN ? `Join the team meeting in the Agora Room (${r.sujet})` : `Rejoindre la réunion d'équipe en salle Agora (${r.sujet})`), fin: vie.temps + 40, delai: 40, employe: null, lieu: SALLE.agora.entree, auteur: null,
    surContact: () => {},
    surArrivee: () => {
      terminerTache();
      animateur.enEchange = true;
      ouvrirEntretien({
        interlocuteur: interlocuteurEmploye(animateur), canal: (EN ? "Team meeting" : "Réunion d'équipe"), confiance: relation(animateur.cle), focus: animateur.mesh,
        texte: (EN ? `“Thanks for joining us. Round the table: what's your takeaway from this week?”` : `« Merci de nous rejoindre. Tour de table : qu'est-ce que tu retiens de ta semaine ? »`),
        choix: melangerChoix(choixEchange(animateur, [
          { label: (EN ? "Honestly share a mistake and what you learned from it." : "Partager honnêtement une erreur et ce que vous en avez appris."), delta: 5, journal: (EN ? "lessons learned shared in the meeting." : "retour d'expérience partagé en réunion."), reponse: (EN ? "Thanks for being so open, that's how we all improve." : "Merci pour cette transparence, c'est comme ça qu'on progresse tous."), posture: 1, avant: () => r.participants.forEach(p => p !== animateur && ajusterRelation(p, 3)) },
          { label: (EN ? "Present your most advanced prospects and where you need support." : "Présenter vos prospects les plus avancés et vos besoins de soutien."), delta: 4, journal: (EN ? "pipeline presented clearly in the meeting." : "pipeline présenté clairement en réunion."), reponse: (EN ? "Clear. Yanis, can you help with the demo?" : "Clair. Yanis, tu peux l'aider sur la démo ?"), conseil: true, avant: () => r.participants.forEach(p => p !== animateur && ajusterRelation(p, 2)) },
          { label: (EN ? "Brag about a customer signed thanks to a big discount." : "Vous vanter d'un client signé grâce à une grosse remise."), delta: -4, journal: (EN ? "massive discount showcased in the meeting." : "remise massive mise en avant en réunion."), reponse: (EN ? "We'll talk about it again at renewal…" : "On en reparlera au renouvellement…"), posture: -1, reflexe: (EN ? "Knock-down-price deal presented as a success." : "Signature à prix cassé présentée comme un succès.") },
          { label: (EN ? "Stay silent and check your emails." : "Rester silencieux et consulter vos mails."), delta: -3, journal: (EN ? "passive participation in the meeting." : "participation passive en réunion."), reponse: (EN ? "Right… Let's move on." : "Bon… On passe au suivant.") }
        ]))
      });
    }
  };
  message((EN ? `Team meeting in the Agora Room (${r.sujet}): you're expected.` : `Réunion d'équipe en salle Agora (${r.sujet}) : vous êtes attendu.`), "info", 3600);
}

/* Réactions de l'équipe aux actes du participant */
const SALUTATIONS = ["Bonjour !", (EN ? "Hi, how's it going?" : "Salut, ça va ?"), (EN ? "Have a good day!" : "Bonne journée !"), "Hello !", (EN ? "How are your files coming along?" : "Ça avance, tes dossiers ?")];
const REMARQUES_REQUIN = [(EN ? "Are you sure about that?" : "Tu es sûr de ton coup, là ?"), (EN ? "Careful, the customer will remember that at renewal…" : "Attention, le client s'en souviendra au renouvellement…"), (EN ? "Inès will have to fix that one." : "Ça, Inès va devoir le rattraper."), (EN ? "Not sure Sandrine will approve…" : "Pas sûr que Sandrine valide…")];
function reactionEquipe(type, detail = "") {
  if (!jeu.def) return;
  const proches = employes.filter(e => !e.enEchange && e.etage === joueur.etage && Math.hypot(e.mesh.position.x - joueur.x, e.mesh.position.z - joueur.z) < 8);
  if (type === "requin" && proches.length) {
    const qui = choisirTexte(proches);
    parler(qui, choisirTexte(REMARQUES_REQUIN.filter(r => !r.includes(qui.prenom))), 7);
  }
  if (type === "signature") {
    const s = employe("manager");
    parler(s, (EN ? `Well done on ${detail}!` : `Bravo pour ${detail} !`), 8);
    setTimeout(() => { if (!vie.pot) lancerPot(`Signature ${detail} : bravo !`); }, 2500);
  }
  if (type === "prospect" && proches.length && Math.random() < 0.5) parler(choisirTexte(proches), (EN ? "Great contact, well played!" : "Beau contact, bien joué !"), 5);
}
function majSalutations() {
  if (jeu.mode !== "jeu" || vie.temps - (vie.dernierBonjour || 0) < 5) return;
  const e = employes.find(x => !x.enEchange && x.etage === joueur.etage && x.bulleFin < vie.temps && vie.temps - (x.salue || -999) > 90 && Math.hypot(x.mesh.position.x - joueur.x, x.mesh.position.z - joueur.z) < 2.4 && !(vie.demande && vie.demande.employe === x));
  if (!e || !joueur.bouge) return;
  e.salue = vie.temps;
  vie.dernierBonjour = vie.temps;
  parler(e, choisirTexte(SALUTATIONS), 2.8);
}

/* Objets interactifs de l'étage */
const FICHES = [
  { titre: (EN ? "SPIN discovery" : "Découverte SPIN"), texte: (EN ? "<p><strong>Situation</strong>: how do you do it today? <strong>Problem</strong>: what difficulties? <strong>Implication</strong>: what impact on your business? <strong>Need-payoff</strong>: what would this change?</p><p>Implication questions make the value tangible: that's where the customer convinces themselves.</p>" : "<p><strong>Situation</strong> : comment faites-vous aujourd'hui ? <strong>Problème</strong> : quelles difficultés ? <strong>Implication</strong> : quel impact sur votre activité ? <strong>Need-payoff</strong> : qu'est-ce que cela changerait ?</p><p>Les questions d'implication font prendre conscience de la valeur : c'est là que le client se convainc lui-même.</p>") },
  { titre: (EN ? "BANT qualification" : "Qualification BANT"), texte: (EN ? "<p><strong>Budget</strong>, <strong>Authority</strong> (who decides?), <strong>Need</strong>, <strong>Timing</strong>. A lead is serious from 3 criteria out of 4, including need.</p><p>Qualifying honestly protects your time… and the customer's.</p>" : "<p><strong>Budget</strong>, <strong>Autorité</strong> (qui décide ?), <strong>Besoin</strong>, <strong>Timing</strong>. Un lead est sérieux à partir de 3 critères sur 4, dont le besoin.</p><p>Qualifier honnêtement, c'est protéger son temps… et celui du client.</p>") },
  { titre: (EN ? "SONCAS buying motives" : "Motivations SONCAS"), texte: (EN ? "<p>Security, Pride, Novelty, Comfort, Money, Sympathy (the French SONCAS model). Spot the dominant motive in the words and body language, then tailor your argument.</p>" : "<p>Sécurité, Orgueil, Nouveauté, Confort, Argent, Sympathie. Repérez la motivation dominante dans les mots et le non-verbal, puis adaptez l'argument.</p>") },
  { titre: (EN ? "Arguing with FAB" : "Argumenter avec CAP"), texte: (EN ? "<p><strong>Feature</strong> → <strong>Advantage</strong> for this customer → <strong>Benefit backed by proof</strong>. An argument unrelated to the stated need is just a product sheet.</p>" : "<p><strong>Caractéristique</strong> → <strong>Avantage</strong> pour ce client → <strong>Preuve</strong>. Un argument sans lien avec le besoin exprimé n'est qu'une fiche produit.</p>") },
  { titre: (EN ? "Handling an objection" : "Traiter une objection"), texte: (EN ? "<p>Listen without interrupting, rephrase, ask questions to isolate the objection, answer with proof, check the answer works. A price objection often hides poorly perceived value.</p>" : "<p>Écouter sans couper, reformuler, questionner pour isoler l'objection, répondre avec une preuve, vérifier que la réponse convient. Une objection prix cache souvent une valeur mal perçue.</p>") },
  { titre: (EN ? "Customer lifetime value (CLV)" : "La valeur vie client (CLV)"), texte: (EN ? `<p>CLV = ARR × gross margin × customer lifetime. A discounted customer who leaves after a year is worth far less than a fairly priced customer who stays five years.</p><p>A lasting conversion sells what the customer really needs, prepares the handover to Customer Success and stays involved at renewal.</p>` : `<p>CLV = ARR × marge brute × durée de vie du client. Un client bradé qui part au bout d'un an vaut bien moins qu'un client au juste prix qui reste cinq ans.</p><p>Une conversion durable vend au juste besoin, prépare la passation au Customer Success et reste présente au renouvellement.</p>`) },
  { titre: (EN ? "The four stages of the funnel" : "Les quatre étapes du tunnel"), texte: (EN ? "<p><strong>Prospect</strong>: a contact who matches the target. <strong>Lead</strong>: they have shown interest (content, request, event). <strong>Opportunity</strong>: need, decision-maker, budget and timing are qualified. <strong>Customer</strong>: they sign… and stay if the sale matched their real need.</p><p>Each stage multiplies the next: improve the weakest conversion rate first.</p>" : "<p><strong>Prospect</strong> : un contact qui correspond à la cible. <strong>Lead</strong> : il a manifesté un intérêt (contenu, demande, événement). <strong>Opportunité</strong> : besoin, décideur, budget et échéance sont qualifiés. <strong>Client</strong> : il signe… et reste si la vente a respecté son besoin réel.</p><p>Chaque étage multiplie le suivant : améliorez d'abord le taux de conversion le plus faible.</p>") }
];
let indexFiche = 0;
function ouvrirFiche() {
  const f = FICHES[indexFiche++ % FICHES.length];
  ouvrirFenetre({ titre: (EN ? `Library · ${f.titre}` : `Bibliothèque · ${f.titre}`), sousTitre: (EN ? "Veltis sales team method sheet" : "Fiche méthode de l'équipe commerciale Veltis"), corps: `<div class="fiche-methode">${f.texte}</div>`, navigation: "document", boutons: [{ label: (EN ? "Next sheet" : "Fiche suivante"), action: () => { fermerFenetre(); ouvrirFiche(); } }, { label: (EN ? "Close" : "Fermer"), classe: "btn-principal", action: fermerFenetre }] });
}
const OBJETS_ETAGE = [
  { x: -11.7, z: -5.1, rayon: 1.5, label: (EN ? "check the sales team board" : "consulter le tableau de l'équipe commerciale"), action: ouvrirTableauEquipe },
  { x: -10.7, z: 7.0, rayon: 1.4, label: (EN ? "read a method sheet in the library" : "consulter une fiche méthode à la bibliothèque"), action: ouvrirFiche },
  { x: -10.7, z: 10.6, rayon: 1.4, label: (EN ? "read a method sheet in the library" : "consulter une fiche méthode à la bibliothèque"), action: ouvrirFiche },
  { x: -6.4, z: 5.9, rayon: 1.3, label: (EN ? "grab a coffee" : "prendre un café"), action: () => {
    avancerTemps(5);
    const voisins = employes.filter(e => !e.enEchange && Math.hypot(e.mesh.position.x + 4.6, e.mesh.position.z - 7.6) < 3.5);
    message(voisins.length ? (EN ? `Coffee in hand. ${voisins.slice(0, 2).map(e => e.prenom).join((EN ? " and " : " et "))} nearby: a good chance to chat (E).` : `Café pris. ${voisins.slice(0, 2).map(e => e.prenom).join((EN ? " and " : " et "))} ${voisins.length > 1 ? "discutent" : "est"} à côté : l'occasion d'échanger (E).`) : (EN ? "Coffee in hand. A few minutes to breathe before what's next." : "Café pris. Quelques minutes pour souffler avant la suite."), "info", 3400);
  } },
  { x: -3.55, z: -4.3, rayon: 1.2, label: (EN ? "print your meeting materials" : "imprimer vos supports de rendez-vous"), action: () => { avancerTemps(3); message((EN ? "Materials printed: a clear proposal also reads well on paper." : "Supports imprimés : une proposition claire se relit aussi sur papier."), "info", 2800); } },
  { x: -18.0, z: 4.3, rayon: 1.4, label: (EN ? "look at the view over La Défense" : "regarder la vue sur La Défense"), action: () => message((EN ? "Below the windows, the Esplanade runs towards the Grande Arche between the towers of La Défense. A breather before the next call." : "Sous les fenêtres, l'Esplanade file vers la Grande Arche entre les tours de La Défense. Une respiration avant le prochain appel."), "info", 4200) }
];
function objetProche() {
  let meilleur = null, dMin = Infinity;
  OBJETS_ETAGE.forEach(o => {
    if ((o.etage ?? 1) !== joueur.etage || (o.actif && !o.actif())) return;
    const d = Math.hypot(o.x - joueur.x, o.z - joueur.z);
    if (d < o.rayon + 0.4 && angleVers(o) < 0.8 && d < dMin) { dMin = d; meilleur = o; }
  });
  return meilleur;
}

/* Organigramme : qui fait quoi, où, et la qualité de la relation */
function zoneDe(p) {
  const s = SALLES.find(x => p.x >= x.minX && p.x <= x.maxX && p.z >= x.minZ && p.z <= x.maxZ);
  if (s) return s.nom;
  const dans = r => p.x >= r.minX && p.x <= r.maxX && p.z >= r.minZ && p.z <= r.maxZ;
  if (dans(PLATEAU)) return "Open space";
  if (dans(CAFETERIA)) return (EN ? "Cafeteria" : "Cafétéria");
  if (dans(DETENTE)) return (EN ? "Lounge area" : "Espace détente");
  if (dans(ZONE_SALON)) return "Forum";
  if (dans(ESPACE_CS)) return "Customer Success";
  if (dans(ACCUEIL)) return (EN ? "Reception" : "Accueil");
  return (EN ? "Corridors" : "Circulations");
}
function ouvrirOrganigramme() {
  if (!["jeu", "pause"].includes(jeu.mode)) return;
  const idMission = jeu.def ? jeu.def.id : "";
  const lignes = employes.map(e => {
    const r = relation(e.cle);
    const statut = e.etat === "trajet" ? STATUTS.trajet : STATUTS[e.activite.type] || "";
    return `<tr><td><strong>${echapper(e.def.nom)}</strong><br><span class="cc-detail">${echapper(e.def.fonction)}</span></td><td>${echapper(statut)}</td><td>${echapper(e.etat === "absent" ? "—" : e.etage === 1 ? `${ETAGES[1].code} · ${zoneDe(e.mesh.position)}` : `${ETAGES[e.etage].code} · ${zoneNiveau(e.etage, e.mesh.position)}`)}</td>
      <td><div class="relation"><span class="relation-barre"><span style="width:${r}%;background:${couleurConfiance(r)}"></span></span><span>${r}</span></div></td><td>${e.conseils[idMission] ? (EN ? "Tip received" : "Conseil reçu") : "—"}</td></tr>`;
  }).join("");
  ouvrirFenetre({
    titre: (EN ? "Veltis team · Veltis building" : "Équipe Veltis · immeuble Veltis"), sousTitre: (EN ? `Internal network: ${reseauInterne()}/100 · ${vie.echanges} conversation(s) since you arrived` : `Réseau interne : ${reseauInterne()}/100 · ${vie.echanges} échange(s) depuis l'arrivée`),
    corps: (EN ? `<table class="guide-table"><thead><tr><th>Colleague</th><th>Activity</th><th>Where</th><th>Relationship</th><th>Current mission</th></tr></thead><tbody>${lignes}</tbody></table>
      ${filHTML()}<p class="cc-detail">A relationship above 58 unlocks a useful tip for the current mission. Respecting meetings and calls, helping, taking an interest in other people's jobs: a strong internal network speeds up every conversion.</p>` : `<table class="guide-table"><thead><tr><th>Collaborateur</th><th>Activité</th><th>Où</th><th>Relation</th><th>Mission en cours</th></tr></thead><tbody>${lignes}</tbody></table>
      ${filHTML()}<p class="cc-detail">Une relation supérieure à 58 permet d'obtenir un conseil utile pour la mission en cours. Respecter les réunions et les appels, aider, s'intéresser au métier des autres : un réseau interne solide accélère chaque conversion.</p>`),
    large: true, navigation: "document", boutons: [{ label: (EN ? "Close" : "Fermer"), classe: "btn-principal", action: fermerFenetre }]
  });
}

/* ---------- A10. Étiquettes, interactions, balises ---------- */
const etiquettes = [];
const interactifs = [];
const apparitions = [];

function creerEtiquette(cible, html, hauteur = 2.15, classe = "") {
  const el = document.createElement("div");
  el.className = `etiquette ${classe}`;
  el.innerHTML = html;
  $("etiquettes").appendChild(el);
  const e = { cible, el, hauteur, visible: true, html };
  etiquettes.push(e);
  return e;
}
function majEtiquette(e, texte, classe = "") {
  if (!e) return;
  const cle = `${classe}|${texte}`;
  if (e.cle === cle) return;
  e.cle = cle;
  e.el.textContent = texte;
  e.el.className = `etiquette ${classe}`;
}
function majEtiquetteHTML(e, html, classe = "") {
  if (!e) return;
  const cle = `${classe}|${html}`;
  if (e.cle === cle) return;
  e.cle = cle;
  e.el.innerHTML = html;
  e.el.className = `etiquette ${classe}`;
}
function majEtiquettes() {
  const v = new THREE.Vector3();
  const w = window.innerWidth, h = window.innerHeight;
  etiquettes.forEach(e => {
    const objet = e.cible.isObject3D ? e.cible : null;
    if (!e.visible || jeu.mode === "menu" || (objet && !objet.visible) || (e.etage ?? 1) !== joueur.etage) { ecrireStyle(e.el, "display", "none"); return; }
    const p = objet ? objet.position : e.cible;
    v.set(p.x, (p.y || 0) + e.hauteur + etageY(), p.z).project(camera);
    if (v.z > 1 || Math.abs(v.x) > 1.2 || Math.abs(v.y) > 1.2) { ecrireStyle(e.el, "display", "none"); return; }
    ecrireStyle(e.el, "display", "flex");
    ecrireStyle(e.el, "transform", `translate(${Math.round((v.x * 0.5 + 0.5) * w)}px, ${Math.round((-v.y * 0.5 + 0.5) * h)}px) translate(-50%, -100%)`);
  });
}

const materiauBalise = new THREE.MeshBasicMaterial({ color: 0x1d4ed8, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide });
const materiauAnneau = new THREE.MeshBasicMaterial({ color: 0x1d4ed8, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide });
const geoBalise = new THREE.CylinderGeometry(0.32, 0.32, 2.7, 16, 1, true);
const geoAnneau = new THREE.RingGeometry(0.55, 0.7, 32);

function ajouterInteractif(o) {
  const i = Object.assign({ actif: true, rayon: 2.2, balise: true }, o);
  if (i.balise) {
    const g = new THREE.Group();
    const faisceau = new THREE.Mesh(geoBalise, materiauBalise);
    faisceau.position.y = 1.35;
    const anneau = new THREE.Mesh(geoAnneau, materiauAnneau);
    anneau.rotation.x = -Math.PI / 2;
    anneau.position.y = 0.06;
    g.add(faisceau, anneau);
    groupeNiveau.add(g);
    i.baliseMesh = g;
  }
  interactifs.push(i);
  return i;
}
function positionInteractif(i) { return i.objet ? i.objet.position : i; }
// Écart (radians) entre la direction du regard et un point de l'étage
function angleVers(p) {
  const a = Math.atan2(p.x - joueur.x, p.z - joueur.z) - jeu.lacet;
  return Math.abs(Math.atan2(Math.sin(a), Math.cos(a)));
}
function interactifProche() {
  let meilleur = null, dMin = Infinity;
  interactifs.forEach(i => {
    if (!i.actif || (i.objet && !i.objet.visible) || etageInteractif(i) !== joueur.etage) return;
    const p = positionInteractif(i);
    const d = distance(p, joueur), a = angleVers(p);
    if (d >= i.rayon || (a > (i.objet ? 0.7 : 1.3) && d > 1.3)) return;
    const score = d * (1 + a);
    if (score < dMin) { dMin = score; meilleur = i; }
  });
  if (meilleur || jeu.mode !== "jeu") return meilleur;
  const e = collaborateurProche();
  const f = figurantProche();
  if (f) return { label: f.def.invite ? f.def.invite() : (EN ? `talk to ${f.prenom} (${f.def.fonction.toLowerCase()})` : `échanger avec ${f.prenom} (${f.def.fonction.toLowerCase()})`), action: () => parlerFigurant(f) };
  if (e) {
    const label = vie.demande && vie.demande.employe === e ? (EN ? `listen to ${e.prenom}, who wants to talk to you` : `écouter ${e.prenom}, qui souhaite vous parler`)
      : vie.tache && vie.tache.employe === e ? (EN ? `join ${e.prenom}, who is waiting for you` : `rejoindre ${e.prenom}, qui vous attend`)
      : (EN ? `talk to ${e.prenom} (${(e.etat === "trajet" ? STATUTS.trajet : STATUTS[e.activite.type]).toLowerCase()})` : `échanger avec ${e.prenom} (${(e.etat === "trajet" ? STATUTS.trajet : STATUTS[e.activite.type]).toLowerCase()})`);
    return { label, action: () => discuter(e) };
  }
  const o = objetProche();
  return o ? { label: o.label, action: o.action } : null;
}
function majBalises() {
  materiauBalise.opacity = 0.1 + Math.sin(jeu.temps * 3) * 0.05;
  materiauAnneau.opacity = 0.45 + Math.sin(jeu.temps * 3) * 0.2;
  interactifs.forEach(i => {
    if (!i.baliseMesh) return;
    const p = positionInteractif(i);
    i.baliseMesh.visible = i.actif && (!i.objet || i.objet.visible) && (i.baliseVisible ? i.baliseVisible() : true);
    i.baliseMesh.position.set(p.x, 0, p.z);
  });
}

function faireApparaitre(obj) {
  obj.scale.setScalar(0.01);
  apparitions.push({ obj, t: 0 });
}
function majApparitions(dt) {
  for (let i = apparitions.length - 1; i >= 0; i--) {
    const a = apparitions[i];
    a.t = Math.min(1, a.t + dt * 3);
    const c1 = 1.70158, c3 = c1 + 1, u = a.t - 1;
    a.obj.scale.setScalar(Math.max(0.01, 1 + c3 * u * u * u + c1 * u * u));
    if (a.t >= 1) apparitions.splice(i, 1);
  }
}

/* Aides de proximité */
const auPoste = () => joueur.etage === 1 && distance(joueur, POINT_POSTE) < 1.9;
const procheBatiment = cle => joueur.etage === 1 && distance(joueur, BATIMENTS[cle].porte) < 2.8;
const procheCollegue = cle => joueur.etage === collegues[cle].employe.etage && distance(joueur, collegues[cle].mesh.position) < 2.4;
const distanceMetres = point => Math.max(1, Math.round(distance(joueur, point) * ECHELLE_METRES));

/* ---------- A11. Sons (Web Audio, sans fichier externe) ---------- */
let contexteAudio = null;
function son(type) {
  if (!resultats.son) return;
  try {
    contexteAudio = contexteAudio || new (window.AudioContext || window.webkitAudioContext)();
    const c = contexteAudio;
    const partitions = {
      clic: [[700, 0.04]],
      notif: [[880, 0.06], [1175, 0.09]],
      succes: [[523, 0.09], [784, 0.16]],
      erreur: [[220, 0.12], [175, 0.2]],
      victoire: [[523, 0.1], [659, 0.1], [784, 0.1], [1047, 0.25]],
      echec: [[392, 0.15], [311, 0.15], [262, 0.3]],
      sonnerie: [[740, 0.08], [0, 0.05], [740, 0.08]],
      ding: [[1318, 0.22], [1046, 0.42]],
      badge: [[1568, 0.05], [2093, 0.06]],
      conversion: [[659, 0.06], [988, 0.12]],
      cloche: [[1046, 0.45], [1318, 0.8]]
    };
    let t = c.currentTime;
    (partitions[type] || []).forEach(([f, d]) => {
      if (f > 0) {
        const o = c.createOscillator(), g = c.createGain();
        o.type = type === "erreur" || type === "echec" ? "triangle" : "sine";
        o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.08, t + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t + d);
        o.connect(g);
        g.connect(c.destination);
        o.start(t);
        o.stop(t + d + 0.03);
      }
      t += d * 0.9;
    });
  } catch (e) { /* audio indisponible */ }
}


/* ---------- A12. HUD et messages ---------- */
function hudJauge(label, pct, valeur = "") {
  $("hud-jauge").classList.remove("cache");
  $("hud-jauge-label").textContent = label;
  $("hud-jauge-valeur").textContent = valeur;
  $("hud-jauge-rempli").style.width = `${clamp(pct, 0, 100)}%`;
}
let cacheKpis = "";
const kpisAffiches = { valeurs: {}, minuterie: null };
// Couche 2 : un KPI qui change s'affiche 4 s (mis en évidence) ; les KPI en alerte restent visibles
function hudKpis(liste) {
  const html = liste.map(k => `<span class="pastille${k.alerte ? " alerte" : ""}"><span class="k-label">${echapper(k.label)}</span><strong>${echapper(k.valeur)}</strong></span>`).join("");
  if (html === cacheKpis) return;
  const el = $("hud-kpis");
  el.innerHTML = html;
  $("pm-kpis").innerHTML = html;
  cacheKpis = html;
  [...el.children].forEach((c, i) => {
    const k = liste[i], avant = kpisAffiches.valeurs[k.label];
    if (avant !== undefined && avant !== String(k.valeur)) c.classList.add("change");
    kpisAffiches.valeurs[k.label] = String(k.valeur);
  });
  el.classList.add("flash");
  clearTimeout(kpisAffiches.minuterie);
  kpisAffiches.minuterie = setTimeout(() => { el.classList.remove("flash"); el.querySelectorAll(".change").forEach(c => c.classList.remove("change")); }, 4000);
}
/* Tunnel de conversion : chaque mission fait passer ses contacts d'un
   stade au suivant (ex. lead → opportunité). On affiche les volumes de
   chaque stade et le taux de transformation entre deux stades. */
const tauxEtape = (a, b) => (a ? b / a * 100 : 0);
const tauxTunnel = t => tauxEtape(t.etapes[0].valeur, t.etapes[t.etapes.length - 1].valeur);
function tunnelHTML(t) {
  const max = Math.max(1, ...t.etapes.map(e => e.valeur));
  return `<div class="tunnel">` + t.etapes.map((e, i) => {
    const taux = i ? (EN ? `<div class="tn-taux">↓ ${pourcent(tauxEtape(t.etapes[i - 1].valeur, e.valeur))} converted</div>` : `<div class="tn-taux">↓ ${pourcent(tauxEtape(t.etapes[i - 1].valeur, e.valeur))} transformés</div>`) : "";
    return `${taux}<div class="tn-etage${i === t.etapes.length - 1 ? " tn-sortie" : ""}"><span class="tn-barre" style="width:${Math.max(4, e.valeur / max * 100)}%"></span><span class="tn-label">${echapper(e.label)}</span><strong class="tn-valeur">${nombre(e.valeur)}</strong></div>`;
  }).join("") + (EN ? `<div class="tn-global">Conversion rate ${echapper(t.de)} → ${echapper(t.vers)}: <strong>${pourcent(tauxTunnel(t))}</strong></div></div>` : `<div class="tn-global">Taux de conversion ${echapper(t.de)} → ${echapper(t.vers)} : <strong>${pourcent(tauxTunnel(t))}</strong></div></div>`);
}
let cacheTunnel = "";
function hudTunnel(t) {
  const el = $("hud-tunnel");
  const html = t ? `<span class="tl-titre">${echapper(t.de)} → ${echapper(t.vers)}</span>` + t.etapes.map((e, i) =>
    `${i ? `<span class="tl-fleche">›</span>` : ""}<span class="tl-etape${i === t.etapes.length - 1 ? " tl-sortie" : ""}"><strong>${nombre(e.valeur)}</strong> ${echapper(e.court || e.label)}</span>`).join("") +
    `<span class="tl-taux">${pourcent(tauxTunnel(t))}</span>` : "";
  if (html !== cacheTunnel) { el.innerHTML = html; el.classList.toggle("cache", !t); cacheTunnel = html; }
}
function majPipsErreurs() {
  const zone = $("hud-erreurs");
  zone.innerHTML = "";
  for (let i = 0; i < MAX_ERREURS; i++) {
    const p = document.createElement("span");
    p.className = `pip${i < jeu.erreurs ? " on" : ""}`;
    zone.appendChild(p);
  }
}

/* ---------- A13. Panneau CRM ---------- */
let cachePanneau = "";
let panneauPresse = false;
function ouvrirPanneau(titre, sousTitre = "") {
  $("pm-titre").textContent = titre;
  $("pm-sous-titre").textContent = sousTitre;
  $("pm-contenu").innerHTML = "";
  $("panneau-mission").classList.remove("cache");
  document.body.classList.add("avec-panneau");
  cachePanneau = "";
  panneauPresse = false;
  majPanneau(true);
}
function fermerPanneau() {
  jeu.focusPanneau = false;
  $("panneau-mission").classList.remove("navigation");
  $("panneau-mission").classList.add("cache");
  document.body.classList.remove("avec-panneau");
  $("pm-contenu").innerHTML = "";
  cachePanneau = "";
}
function basculerPanneau() {
  const p = $("panneau-mission");
  if (p.classList.contains("cache")) return;
  p.classList.toggle("reduit");
  $("btn-panneau").textContent = p.classList.contains("reduit") ? "+" : "–";
}
function majPanneau(force = false) {
  if (panneauPresse && !force) return;
  if ($("panneau-mission").classList.contains("cache") || !jeu.def || !jeu.def.panneau || !jeu.n) return;
  const html = jeu.def.panneau(jeu.n);
  if (force || html !== cachePanneau) {
    const contenu = $("pm-contenu");
    const defilement = contenu.scrollTop;
    contenu.innerHTML = html;
    contenu.scrollTop = defilement;
    cachePanneau = html;
    if (jeu.focusPanneau) restaurerFocusPanneau();
  }
}
// Raccourcis du panneau : mêmes actions que les touches K, O, G, P, H
const ACTIONS_RACCOURCIS = { k: () => ouvrirTableauDeBord(), o: () => ouvrirOrganigramme(), g: () => ouvrirGuide(), p: () => ouvrirPlan(), h: () => ouvrirAide() };
document.querySelectorAll("[data-raccourci]").forEach(b => b.addEventListener("click", () => { if (jeu.mode !== "jeu") return; son("clic"); ACTIONS_RACCOURCIS[b.dataset.raccourci](); }));
$("pm-contenu").addEventListener("pointerdown", () => { panneauPresse = true; });
window.addEventListener("pointerup", () => { panneauPresse = false; });
$("pm-contenu").addEventListener("click", e => {
  const b = e.target.closest("[data-cmd]");
  if (!b || b.disabled) return;
  if (jeu.mode !== "jeu" || !jeu.def || !jeu.def.commande) return;
  son("clic");
  jeu.cleFocusPanneau = cleBouton(b);
  jeu.def.commande(jeu.n, b.dataset.cmd, b.dataset.id, b.dataset.val);
  majPanneau(true);
});

/* ---------- A13 bis. Navigation au clavier ---------- */
const SELECTEUR_NAV = 'button:not([disabled]), input[type="checkbox"]:not([disabled]), input[type="radio"]:not([disabled]), input[type="text"]:not([disabled])';
const cleBouton = el => `${el.dataset.cmd}|${el.dataset.id}|${el.dataset.val}`;
function estVisible(el) {
  if (el.closest(".cache")) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}
function elementsNav(racine) {
  if (!racine) return [];
  return [...racine.querySelectorAll(SELECTEUR_NAV)].filter(el => !el.hasAttribute("data-sans-nav") && el.tabIndex !== -1 && estVisible(el));
}
const cadreNav = el => (el.closest("label") || el);
function focaliser(el) {
  if (!el) return;
  el.focus({ preventScroll: true });
  cadreNav(el).scrollIntoView({ block: "nearest", inline: "nearest" });
  if (el.closest("#pm-contenu")) {
    jeu.cleFocusPanneau = cleBouton(el);
    jeu.indexFocusPanneau = elementsNav($("pm-contenu")).indexOf(el);
  }
}
function deplacerFocus(racine, dir) {
  const els = elementsNav(racine);
  if (!els.length) return false;
  const actuel = document.activeElement;
  if (!els.includes(actuel)) { focaliser(els[0]); return true; }
  const a = cadreNav(actuel).getBoundingClientRect();
  const ax = a.left + a.width / 2, ay = a.top + a.height / 2;
  let meilleur = null, score = Infinity;
  els.forEach(el => {
    if (el === actuel || cadreNav(el) === cadreNav(actuel)) return;
    const r = cadreNav(el).getBoundingClientRect();
    const dx = r.left + r.width / 2 - ax, dy = r.top + r.height / 2 - ay;
    let s;
    if (dir === "bas") { if (dy <= 3) return; s = dy + Math.abs(dx) * 1.5; }
    else if (dir === "haut") { if (dy >= -3) return; s = -dy + Math.abs(dx) * 1.5; }
    else if (dir === "droite") { if (dx <= 3) return; s = dx + Math.abs(dy) * 3; }
    else { if (dx >= -3) return; s = -dx + Math.abs(dy) * 3; }
    if (s < score) { score = s; meilleur = el; }
  });
  if (meilleur) { focaliser(meilleur); return true; }
  return false;
}
function focusSuivant(racine, sens = 1) {
  const els = elementsNav(racine);
  if (!els.length) return;
  const i = els.indexOf(document.activeElement);
  focaliser(els[(i + sens + els.length) % els.length]);
}
function activerFocus() {
  const el = document.activeElement;
  if (!el || el === document.body || !estVisible(el)) return false;
  if (el.tagName === "INPUT" && el.type === "text") return false;
  el.click();
  return true;
}
function liberer() {
  const el = document.activeElement;
  if (el && el !== document.body && el.blur) el.blur();
}
function focusInitial(racine, selecteur) {
  setTimeout(() => {
    if (!racine) return;
    const cible = selecteur ? racine.querySelector(selecteur) : null;
    if (cible && estVisible(cible) && !cible.disabled) focaliser(cible);
    else {
      const els = elementsNav(racine);
      if (els.length) focaliser(els[0]);
    }
  }, 40);
}
function defiler(el, delta) { if (el) el.scrollBy({ top: delta, behavior: "smooth" }); }

function entrerPanneau() {
  const p = $("panneau-mission");
  if (p.classList.contains("cache")) { message((EN ? "No CRM for this mission." : "Pas de CRM pour cette mission."), "info", 1600); return; }
  p.classList.remove("reduit");
  $("btn-panneau").textContent = "–";
  majPanneau(true);
  const els = elementsNav($("pm-contenu"));
  if (!els.length) { message((EN ? "No CRM action available at the moment." : "Aucune action disponible dans le CRM pour le moment."), "info", 2000); return; }
  jeu.focusPanneau = true;
  touches.clear();
  joueur.bouge = false;
  p.classList.add("navigation");
  focaliser(els.find(e => cleBouton(e) === jeu.cleFocusPanneau) || els[0]);
}
function quitterPanneau() {
  jeu.focusPanneau = false;
  $("panneau-mission").classList.remove("navigation");
  liberer();
}
function restaurerFocusPanneau() {
  if (!jeu.focusPanneau || jeu.mode !== "jeu") return;
  const els = elementsNav($("pm-contenu"));
  if (!els.length) { quitterPanneau(); return; }
  if (els.includes(document.activeElement)) return;
  const el = els.find(e => cleBouton(e) === jeu.cleFocusPanneau) || els[Math.min(Math.max(0, jeu.indexFocusPanneau), els.length - 1)];
  focaliser(el);
}
$("btn-panneau").addEventListener("click", basculerPanneau);

/* Générateur de boutons pour le panneau */
function boutonPm(label, cmd, id, { val = "", principal = false, desactive = false, titre = "" } = {}) {
  return `<button class="btn-action-pm${principal ? " principal" : ""}" data-cmd="${cmd}" data-id="${echapper(id)}" data-val="${echapper(val)}"${desactive ? " disabled" : ""}${titre ? ` title="${echapper(titre)}"` : ""}>${echapper(label)}</button>`;
}
const chip = (texte, type = "") => `<span class="chip${type ? " chip-" + type : ""}">${echapper(texte)}</span>`;

/* ---------- A14. Fenêtres (configurateurs, guide) ---------- */
function ouvrirFenetre({ titre, sousTitre = "", corps, boutons = [], large = false, fermable = true, onOuverture = null, onFermeture = null, navigation = "grille", focus = null }) {
  liberer();
  if (jeu.mode !== "fenetre") jeu.modeAvantFenetre = jeu.mode;
  jeu.fenetreNav = navigation;
  jeu.changerOnglet = null;
  jeu.mode = "fenetre";
  touches.clear();
  $("fenetre-titre").textContent = titre;
  $("fenetre-sous-titre").textContent = sousTitre;
  const ancienCorps = $("fenetre-corps");
  const nouveauCorps = ancienCorps.cloneNode(false);
  ancienCorps.replaceWith(nouveauCorps);
  $("fenetre-corps").innerHTML = corps;
  $("fenetre-corps").scrollTop = 0;
  $("fenetre-boite").classList.toggle("large", large);
  $("fenetre-fermer").classList.toggle("cache", !fermable);
  jeu.fenetreFermable = fermable;
  jeu.fenetreOnFermeture = onFermeture;
  const pied = $("fenetre-pied");
  pied.innerHTML = navigation === "document"
    ? (EN ? '<span class="fenetre-aide">↑ ↓ scroll · ← → switch tab · Enter or Esc: close</span>' : '<span class="fenetre-aide">↑ ↓ faire défiler · ← → changer d\'onglet · Entrée ou Échap : fermer</span>')
    : (EN ? `<span class="fenetre-aide">Arrows: navigate · Space or Enter: tick / confirm${fermable ? (EN ? " · Esc: close" : " · Échap : fermer") : ""}</span>` : `<span class="fenetre-aide">Flèches : naviguer · Espace ou Entrée : cocher / valider${fermable ? (EN ? " · Esc: close" : " · Échap : fermer") : ""}</span>`);
  boutons.forEach(b => {
    const el = document.createElement("button");
    el.className = b.classe || "btn-secondaire";
    el.textContent = b.label;
    if (b.id) el.id = b.id;
    el.addEventListener("click", () => { son("clic"); b.action(); });
    pied.appendChild(el);
  });
  $("fenetre").classList.remove("cache");
  if (onOuverture) onOuverture($("fenetre-corps"));
  if (navigation === "document") focusInitial($("fenetre-pied"), ".btn-principal");
  else focusInitial($("fenetre-boite"), focus);
}
function fermerFenetre() {
  $("fenetre").classList.add("cache");
  liberer();
  if (jeu.mode === "fenetre") jeu.mode = jeu.modeAvantFenetre || "jeu";
  const f = jeu.fenetreOnFermeture;
  jeu.fenetreOnFermeture = null;
  if (f) f();
  if (jeu.mode === "jeu") setTimeout(restaurerFocusPanneau, 0);
  else if (jeu.mode !== "dialogue") setTimeout(focusEcran, 0);
}
$("fenetre-fermer").addEventListener("click", () => { if (jeu.fenetreFermable) fermerFenetre(); });

/* Mise en évidence des cases cochées dans les fenêtres */
function lierCartesChoix(racine) {
  const maj = () => racine.querySelectorAll(".choix-carte, .segment-config label").forEach(l => {
    const input = l.querySelector("input");
    l.classList.toggle("coche", !!(input && input.checked));
  });
  racine.addEventListener("change", maj);
  maj();
}

/* ---------- A15. Entretiens ---------- */
function couleurConfiance(v) { return v < 35 ? "#b91c1c" : v < 60 ? "#d97706" : "#15803d"; }

function ouvrirEntretien({ interlocuteur = null, titre = "", canal = "", texte = "", choix = [], confiance = null, signal = null, focus = null }) {
  if (jeu.mode === "bilan") return;
  liberer();
  jeu.mode = "dialogue";
  touches.clear();
  jeu.focus = focus;
  const av = $("ent-avatar");
  if (interlocuteur) {
    av.textContent = initiales(interlocuteur.nom);
    av.style.background = interlocuteur.couleur || "#334155";
    av.classList.remove("cache");
    $("ent-nom").textContent = interlocuteur.nom;
    $("ent-role").textContent = [interlocuteur.fonction, interlocuteur.entreprise].filter(Boolean).join(" · ");
  } else {
    av.classList.add("cache");
    $("ent-nom").textContent = titre;
    $("ent-role").textContent = "";
  }
  const c = $("ent-canal");
  c.textContent = canal || "";
  c.classList.toggle("cache", !canal);
  const conf = $("ent-confiance");
  if (confiance === null || confiance === undefined) {
    conf.classList.add("cache");
  } else {
    conf.classList.remove("cache");
    const v = clamp(confiance, 0, 100);
    $("ent-confiance-rempli").style.width = `${v}%`;
    $("ent-confiance-rempli").style.background = couleurConfiance(v);
    $("ent-confiance-valeur").textContent = `${Math.round(v)}`;
  }
  const sig = $("ent-signal");
  if (signal) { sig.innerHTML = signal; sig.classList.remove("cache"); } else sig.classList.add("cache");
  $("ent-indicateurs").classList.toggle("cache", (confiance === null || confiance === undefined) && !signal);
  lancerFrappe($("dialogue-texte"), texte);
  const zone = $("dialogue-boutons");
  zone.innerHTML = "";
  const multiple = choix.length > 1;
  zone.classList.toggle("choix", multiple);
  choix.forEach((ch, i) => {
    const b = document.createElement("button");
    if (multiple) {
      const num = document.createElement("span");
      num.className = "num";
      num.textContent = `${i + 1}.`;
      b.appendChild(num);
      b.appendChild(document.createTextNode(` ${ch.label}`));
    } else {
      b.textContent = ch.label;
    }
    b.dataset.index = i;
    b.tabIndex = -1;
    b.addEventListener("click", () => { son("clic"); ch.action(); });
    zone.appendChild(b);
  });
  jeu.boutons = choix;
  jeu.selection = -1;
  $("dialogue-aide").textContent = multiple
    ? (EN ? `↑ ↓ choose · Enter confirm · or keys 1 to ${choix.length} · G: guide` : `↑ ↓ choisir · Entrée valider · ou touches 1 à ${choix.length} · G : guide`)
    : (EN ? "Enter: continue" : "Entrée : continuer");
  $("dialogue").classList.remove("cache");
  $("dialogue").scrollTop = 0;
}
function majSelection() {
  [...$("dialogue-boutons").children].forEach((b, i) => {
    const actif = i === jeu.selection;
    b.classList.toggle("selectionne", actif);
    if (actif) b.scrollIntoView({ block: "nearest" });
  });
}
function fermerEntretien() {
  terminerFrappe();
  $("dialogue").classList.add("cache");
  jeu.focus = null;
  jeu.boutons = [];
  jeu.selection = -1;
  if (jeu.mode === "dialogue") {
    jeu.mode = "jeu";
    liberer();
    setTimeout(restaurerFocusPanneau, 0);
  }
}
const ouvrirDialogue = o => ouvrirEntretien({ titre: o.nom, texte: o.texte, choix: o.choix, focus: o.focus || null });

/* ---------- A16. Temps simulé ---------- */
function formatHeure(m, mode = jeu.affichage) {
  const total = Math.max(0, m);
  const j = Math.floor(total / JOURNEE);
  const reste = total - j * JOURNEE;
  const h = 9 + Math.floor(reste / 60), mi = Math.floor(reste % 60);
  const jour = JOURS[j % 5], sem = Math.floor(j / 5) + 1;
  const heure = `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
  if (mode === "semaine") return EN ? `Wk ${sem} · ${jour}` : `Sem. ${sem} · ${jour}`;
  if (mode === "semaine-heure") return EN ? `W${sem} · ${jour} ${heure}` : `S${sem} · ${jour} ${heure}`;
  return `${jour} ${heure}`;
}
function formatFin(m, mode = jeu.affichage) {
  const j = Math.floor((m - 0.001) / JOURNEE);
  const reste = m - j * JOURNEE;
  const h = 9 + Math.floor(reste / 60), mi = Math.round(reste % 60);
  const jour = JOURS[j % 5], sem = Math.floor(j / 5) + 1;
  const heure = `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
  if (mode === "semaine") return (EN ? `end of week ${sem}` : `fin de la sem. ${sem}`);
  if (mode === "semaine-heure") return EN ? `W${sem} · ${jour} ${heure}` : `S${sem} · ${jour} ${heure}`;
  return `${jour} ${heure}`;
}
function avancerTemps(min) { jeu.minutes += min; }
const tempsEcouleMission = () => jeu.minutes - jeu.debutMinutes;

/* ---------- A17. Journal, erreurs, compétences ---------- */
const COMPETENCES = {
  ciblage: (EN ? "Targeting and qualification" : "Ciblage et qualification"),
  ecoute: (EN ? "Active listening" : "Écoute active"),
  questionnement: "Questionnement (SPIN, BANT)",
  argumentation: "Argumentation",
  objections: (EN ? "Objection handling" : "Traitement des objections"),
  negociation: (EN ? "Negotiation" : "Négociation"),
  closing: (EN ? "Closing and follow-up" : "Conclusion et relance"),
  organisation: (EN ? "Organisation and responsiveness" : "Organisation et réactivité"),
  produit: (EN ? "Product knowledge" : "Maîtrise de l'offre"),
  relation: (EN ? "Customer relationship" : "Relation client"),
  conformite: (EN ? "Compliance and ethics" : "Conformité et éthique")
};
const CONSEILS_COMPETENCES = {
  ciblage: (EN ? "Check the fit with the target (size, industry, role) and the BANT criteria before investing time." : "Vérifiez la correspondance avec la cible (taille, secteur, fonction) et les critères BANT avant d'investir du temps."),
  ecoute: (EN ? "Open with an open question and let the other person describe their context before presenting the offer." : "Ouvrez par une question ouverte et laissez l'interlocuteur exprimer son contexte avant de présenter l'offre."),
  questionnement: (EN ? "Structure your discovery: situation, problem, implication, then budget, decision-maker and timing." : "Structurez la découverte : situation, problème, implication, puis budget, décideur et échéance."),
  argumentation: (EN ? "Link each argument to the stated need and to the person's dominant buying motive (SONCAS)." : "Reliez chaque argument au besoin exprimé et à la motivation dominante (SONCAS) de l'interlocuteur."),
  objections: (EN ? "Listen, rephrase, ask questions to isolate the objection, then answer with proof and check." : "Écoutez, reformulez, questionnez pour isoler l'objection, puis répondez par une preuve et vérifiez."),
  negociation: (EN ? "Never concede without something in return, and stay within your discount authority." : "Ne concédez jamais sans contrepartie et restez dans votre délégation de remise."),
  closing: (EN ? "Lock in the next steps: decision date, approval stages, next dated action." : "Verrouillez la suite : date de décision, étapes de validation, prochaine action datée."),
  organisation: (EN ? "Handle what is urgent and high-value first; respect call-back times." : "Traitez d'abord ce qui est urgent et à forte valeur ; respectez les délais de rappel."),
  produit: (EN ? "Size the offer to the real need: no under-equipping, no over-selling." : "Dimensionnez l'offre au juste besoin : ni sous-équipement, ni sur-vente."),
  relation: (EN ? "Stay courteous and proactive: an informed, well-followed customer stays loyal." : "Restez courtois et proactif : un client informé et suivi reste fidèle."),
  conformite: (EN ? "Respect GDPR, pricing confidentiality and fairness towards competitors." : "Respectez le RGPD, la confidentialité tarifaire et la loyauté envers la concurrence.")
};

/* ---------- A17 bis. Progression dans le tunnel : du prospect au client ----------
   La jauge du participant suit les quatre étapes du tunnel de conversion.
   Chaque décision qui fait avancer un contact la fait progresser, chaque
   frein à la conversion (pression, fausse urgence, remise sans contrepartie,
   sur-vente, vente prématurée) la fait reculer. Elle est conservée d'une
   mission à l'autre et fixe la durée de vie (donc la CLV) des clients signés.
   (Les identifiants internes « posture » sont conservés pour la sauvegarde.) */
const POSTURES = [
  { min: 0, cle: "prospect", nom: "Prospect", icone: "1", devise: (EN ? "A contact still to win over." : "Un contact encore à convaincre."),
    description: (EN ? "Your approaches convert little: contacts listen but don't move forward. Too much pressure, not enough listening: they stay prospects." : "Vos approches convertissent peu : vos contacts écoutent, mais n'avancent pas. Trop de pression, pas assez d'écoute : ils restent des prospects.") },
  { min: 25, cle: "lead", nom: "Lead", icone: "2", devise: (EN ? "Interest is sparked." : "L'intérêt est éveillé."),
    description: (EN ? "You spark interest and generate leads, but qualification is still fragile: plenty of leads, few real opportunities." : "Vous suscitez de l'intérêt et générez des leads, mais la qualification reste fragile : beaucoup de leads, peu de vraies opportunités.") },
  { min: 50, cle: "opportunite", nom: (EN ? "Opportunity" : "Opportunité"), icone: "3", devise: (EN ? "A qualified need, a real project." : "Un besoin qualifié, un vrai projet."),
    description: (EN ? "You qualify honestly, size to the real need and turn your leads into solid opportunities." : "Vous qualifiez honnêtement, dimensionnez au juste besoin et transformez vos leads en opportunités solides.") },
  { min: 75, cle: "client", nom: (EN ? "Customer" : "Client"), icone: "4", devise: (EN ? "Signed, and here to stay." : "Signé, et fidèle."),
    description: (EN ? "Your prospects become customers who stay: conversion carries on into retention, expansion and referrals (high CLV)." : "Vos prospects deviennent des clients qui restent : la conversion se prolonge en fidélité, développement et recommandations (CLV élevée).") }
];
const REFLEXE_REQUIN = EN
  ? /% discount|discount raised|discount request|approved discount|discount conceded|discount granted|urgency|deadline|pressure|hard selling|over-sell|oversized|premature|catalogue|promis|fragile|disparag|unhappy|without discovery|confidential|GDPR|list of unknown/i
  : /remise de |de remise|remise portée|remise validée|urgence|échéance|pression|forc|sur-vente|surdimension|prématur|catalogue|promis|fragile|dénigr|insatisfait|sans découverte|confidenti|RGPD|fichier/i;
const posture = (v = jeu.posture) => POSTURES.slice().reverse().find(p => v >= p.min);
const ARR_REFERENCE = () => Object.values(COMPTES).reduce((s, c) => s + arrCatalogue(c), 0) / Object.keys(COMPTES).length;
// Durée de vie d'un client selon la posture du commercial qui l'a converti (années)
const dureeViePosture = v => Math.round((1 + v / 100 * 5) * 10) / 10;
const ansTexte = v => (EN ? `${v} year${v === 1 ? "" : "s"}` : `${String(v).replace(".", ",")} an${v >= 2 ? "s" : ""}`);
const clvPosture = v => ARR_REFERENCE() * MARGE_BRUTE * dureeViePosture(v);
function deplacerPosture(delta, texte = "") {
  if (!jeu.def) return;
  const avant = posture();
  jeu.posture = clamp(jeu.posture + delta, 0, 100);
  if (delta < 0 && texte) { jeu.reflexesRequin.push(texte); reactionEquipe("requin"); }
  if (delta > 0) jeu.gestesPartenaire++;
  const apres = posture();
  if (apres !== avant && jeu.mode !== "bilan") {
    noter(apres.min > avant.min ? "ok" : "ko", (EN ? `Funnel progress: ${avant.nom} → ${apres.nom}.` : `Progression dans le tunnel : ${avant.nom} → ${apres.nom}.`));
    setTimeout(() => animerPassageEtape(avant, apres), 700);
  }
  majPosture();
}
function majPosture() {
  const p = posture();
  const el = $("hud-posture");
  if (!el) return;
  el.innerHTML = `<span class="pst-icone" title="${T("Votre étape dans le tunnel de conversion", "Your stage in the conversion funnel")}">${p.icone}</span><span class="pst-nom">${p.nom}</span>` +
    `<span class="pst-barre"><span style="width:${jeu.posture}%"></span></span>` +
    `<span class="pst-clv" title="${T("Durée de vie projetée des clients que vous convertissez", "Projected lifetime of the customers you convert")}">CLV · ${ansTexte(dureeViePosture(jeu.posture))}</span>` +
    (EN ? `<span class="pst-clv" title="Quality of your relationships with colleagues">Network ${reseauInterne()}/100</span>` : `<span class="pst-clv" title="Qualité de vos relations avec vos collègues">Réseau ${reseauInterne()}/100</span>`);
  el.dataset.posture = p.cle;
}

function evaluer(tag, valeur) {
  if (!tag) return;
  const c = jeu.competences[tag] || (jeu.competences[tag] = { ok: 0, total: 0 });
  c.total++;
  c.ok += valeur;
}
function horodatage() { return formatHeure(jeu.minutes, jeu.affichage === "semaine" ? "semaine" : "jour"); }
function noter(type, texte) { jeu.journal.push({ type, texte, t: horodatage() }); }
function erreur(texte, tag = null) {
  if (jeu.mode === "bilan" || jeu.erreurs >= MAX_ERREURS) return;
  jeu.erreurs++;
  evaluer(tag, 0);
  const requin = tag === "negociation" || tag === "conformite" || REFLEXE_REQUIN.test(texte);
  noter("ko", requin ? (EN ? `Conversion blocker · ${texte}` : `Frein à la conversion · ${texte}`) : texte);
  deplacerPosture(requin ? -6 : -2, requin ? texte : "");
  majPipsErreurs();
  son("erreur");
  message((EN ? `Error ${jeu.erreurs}/${MAX_ERREURS} · ${texte}` : `Erreur ${jeu.erreurs}/${MAX_ERREURS} · ${texte}`), "ko", 3600);
  if (jeu.erreurs >= MAX_ERREURS) {
    setTimeout(() => { if (jeu.mode !== "bilan" && jeu.def && jeu.erreurs >= MAX_ERREURS) interrompreMission(); }, 700);
  }
}
function reussite(texte, tag = null, { silencieux = false, muet = false } = {}) {
  evaluer(tag, 1);
  noter("ok", texte);
  deplacerPosture(["organisation", "ciblage"].includes(tag) ? 1 : 2);
  if (!silencieux) son("succes");
  if (!muet) message(`✓ ${texte}`, "ok", 2800);
}
function concession(texte, tag = null, muet = false) {
  evaluer(tag, 0.5);
  noter("neutre", texte);
  if (tag === "negociation") deplacerPosture(-2, texte);
  if (!muet) message(`Concession · ${texte}`, "alerte", 3200);
}
function manque(texte, tag = null, muet = false) {
  evaluer(tag, 0);
  noter("neutre", texte);
  if (REFLEXE_REQUIN.test(texte)) deplacerPosture(-3, texte);
  if (!muet) message((EN ? `To review · ${texte}` : `À revoir · ${texte}`), "alerte", 3400);
}
function aideUtilisee(texte) {
  jeu.aides++;
  noter("info", (EN ? `Help used: ${texte} (−3 points)` : `Aide utilisée : ${texte} (−3 points)`));
}
function information(texte) { noter("info", texte); }
function limiteAtteinte() {
  if (jeu.erreurs >= MAX_ERREURS && jeu.mode !== "bilan") {
    interrompreMission();
    return true;
  }
  return false;
}
function moyenneCompetences() {
  const v = Object.values(jeu.competences).filter(c => c.total);
  if (!v.length) return 0.5;
  return v.reduce((s, c) => s + c.ok / c.total, 0) / v.length;
}
function calculerScore(statut, etoiles, erreurs) {
  const m = moyenneCompetences();
  if (statut === "reussi") return clamp(Math.round(45 + etoiles * 10 + m * 25 - erreurs * 4), 40, 100);
  if (statut === "echoue") return clamp(Math.round(10 + m * 30 - erreurs * 3), 0, 39);
  return clamp(Math.round(m * 20), 0, 20);
}

/* ---------- A18. Plan du quartier (mini-carte) ---------- */
const minimap = $("minimap");
const ctxCarte = minimap.getContext("2d");
// Écrit une propriété de style seulement si sa valeur change (moins de recalculs de la page)
function ecrireStyle(el, propriete, valeur) {
  const cle = `_${propriete}`;
  if (el[cle] === valeur) return;
  el[cle] = valeur;
  el.style[propriete] = valeur;
}
// Mini-carte redessinée 10 fois par seconde au plus
let minuterieMinimap = 0;
function majMinimap(dt = 1) {
  minuterieMinimap += dt;
  if (minuterieMinimap < 0.1) return;
  minuterieMinimap = 0;
  if (minimap.classList.contains("cache")) return;
  if (joueur.etage !== 1) { dessinerPlanNiveau(ctxCarte, minimap.width, minimap.height, joueur.etage, true); return; }
  dessinerPlanR1(ctxCarte, minimap.width, minimap.height, true);
}
function dessinerPlanR1(ctxCarte, W, H, avecJoueur) {
  const m = 12;
  const sx = x => m + ((x - LIMITES.minX + 0.5) / (LIMITES.maxX - LIMITES.minX + 1)) * (W - 2 * m);
  const sz = z => m + ((z - LIMITES.minZ + 0.5) / (LIMITES.maxZ - LIMITES.minZ + 1)) * (H - 2 * m);
  const rect = (x1, z1, x2, z2, c) => { ctxCarte.fillStyle = c; ctxCarte.fillRect(sx(x1), sz(z1), sx(x2) - sx(x1), sz(z2) - sz(z1)); };
  const texte = (t, x, z, c = "#475569", taille = 11) => { ctxCarte.fillStyle = c; ctxCarte.font = `700 ${taille}px Inter, Arial, sans-serif`; ctxCarte.fillText(t, sx(x), sz(z)); };
  ctxCarte.clearRect(0, 0, W, H);
  ctxCarte.textAlign = "center";
  ctxCarte.textBaseline = "middle";
  rect(LIMITES.minX, LIMITES.minZ, LIMITES.maxX, LIMITES.maxZ, "#ece9e3");
  rect(PLATEAU.minX, PLATEAU.minZ, PLATEAU.maxX, PLATEAU.maxZ, "#d5d9de");
  rect(CAFETERIA.minX, CAFETERIA.minZ, CAFETERIA.maxX, CAFETERIA.maxZ, "#e6d6bd");
  rect(DETENTE.minX, DETENTE.minZ, DETENTE.maxX, DETENTE.maxZ, "#e2d2b8");
  rect(ESPACE_CS.minX, ESPACE_CS.minZ, ESPACE_CS.maxX, ESPACE_CS.maxZ, "#d5d9de");
  rect(ZONE_SALON.minX, ZONE_SALON.minZ, ZONE_SALON.maxX, ZONE_SALON.maxZ, jeu.def && jeu.def.id === "notoriete" ? "#bfdbfe" : "#dde1e6");
  rect(1.9, 6.2, 3.36, 11.8, "#78716c");
  texte("OPEN SPACE", (PLATEAU.minX + PLATEAU.maxX) / 2, PLATEAU.minZ + 0.9);
  texte((EN ? "CAFE" : "CAFÉ"), (CAFETERIA.minX + CAFETERIA.maxX) / 2, 11.3);
  texte((EN ? "LOUNGE" : "DÉTENTE"), -13.5, 6.0);
  texte("FORUM", (ZONE_SALON.minX + ZONE_SALON.maxX) / 2, ZONE_SALON.minZ + 0.9);
  texte(EN ? "RECEPTION" : "ACCUEIL", 8.15, 11.3);
  texte("SUCCESS", 16.9, 11.3);
  const cibles = jeu.def && jeu.def.ciblesCarte ? jeu.def.ciblesCarte(jeu.n) : [];
  const salleCible = new Set(cibles.map(c => BATIMENTS[c] && BATIMENTS[c].salle.cle));
  SALLES.forEach(s => {
    const compte = Object.keys(SALON_DU_COMPTE).find(k => SALON_DU_COMPTE[k] === s.cle);
    const cible = salleCible.has(s.cle);
    rect(s.minX + 0.1, s.minZ + 0.1, s.maxX - 0.1, s.maxZ - 0.1, cible ? hex(BATIMENTS[compte].accent) : s.type === "client" ? "#94a3b8" : s.type === "reunion" ? "#64748b" : "#475569");
    const nom = s.type === "client" && compte ? COMPTES[compte].entreprise.replace("Groupe ", "").slice(0, 4).toUpperCase() : s.cle === "agora" ? "AGORA" : s.cle === "dg" ? (EN ? "CEO" : "DG") : (EN ? "SALES DIR." : "DIR. COM.");
    texte(nom, s.x, s.z, "#ffffff", 10);
  });
  employes.forEach(e => {
    if (e.etage !== 1) return;
    ctxCarte.fillStyle = "#64748b";
    ctxCarte.beginPath();
    ctxCarte.arc(sx(e.mesh.position.x), sz(e.mesh.position.z), 2.4, 0, Math.PI * 2);
    ctxCarte.fill();
  });
  const couleur = getComputedStyle(document.documentElement).getPropertyValue("--couleur-niveau").trim() || "#0f172a";
  const pulse = 6 + Math.sin(jeu.temps * 5) * 2;
  interactifs.forEach(i => {
    if (!i.actif || i.carte === false || (i.objet && !i.objet.visible)) return;
    if (i.baliseVisible && !i.baliseVisible()) return;
    const p = positionInteractif(i);
    ctxCarte.fillStyle = couleur;
    ctxCarte.globalAlpha = 0.85;
    ctxCarte.beginPath();
    ctxCarte.arc(sx(p.x), sz(p.z), pulse, 0, Math.PI * 2);
    ctxCarte.fill();
    ctxCarte.globalAlpha = 1;
  });
  if (vie.tache) {
    const p = vie.tache.employe ? vie.tache.employe.mesh.position : vie.tache.lieu;
    ctxCarte.fillStyle = "#d97706";
    ctxCarte.beginPath();
    ctxCarte.arc(sx(p.x), sz(p.z), pulse, 0, Math.PI * 2);
    ctxCarte.fill();
  }
  texte(EN ? "LIFTS" : "ASC.", 2.6, 9.0, "#ffffff", 9);
  marqueursCommuns(ctxCarte, sx, sz, 1, pulse);
  if (!avecJoueur || joueur.etage !== 1) return;
  ctxCarte.save();
  ctxCarte.translate(sx(joueur.x), sz(joueur.z));
  ctxCarte.rotate(-joueur.mesh.rotation.y + Math.PI);
  ctxCarte.scale(1.7, 1.7);
  ctxCarte.fillStyle = "#0f172a";
  ctxCarte.strokeStyle = "#ffffff";
  ctxCarte.lineWidth = 1.5;
  ctxCarte.beginPath();
  ctxCarte.moveTo(0, -9);
  ctxCarte.lineTo(6, 6);
  ctxCarte.lineTo(0, 3);
  ctxCarte.lineTo(-6, 6);
  ctxCarte.closePath();
  ctxCarte.stroke();
  ctxCarte.fill();
  ctxCarte.restore();
}

/* =====================================================================
   PARTIE B — DONNÉES MÉTIER (fictives)
   ===================================================================== */

const ENTREPRISE = { nom: "Veltis", produit: "Veltis One" };

/* ---------- B1. Offre et tarifs ---------- */
const OFFRES = traduire(TEXTES.catalogue.offres);
const ORDRE_OFFRES = ["essentiel", "business", "enterprise"];
const ENGAGEMENTS = traduire(TEXTES.catalogue.engagements);
const OPTIONS = traduire(TEXTES.catalogue.options);
const DELEGATION = { autonomie: 10, manager: 20 };
const COUT_HORAIRE = 75;
const COUT_DEPLACEMENT = 35;
const MARGE_BRUTE = 0.8;

function calculerProposition(pr) {
  const o = OFFRES[pr.offre];
  const prixUnitaire = o.prix * ENGAGEMENTS[pr.engagement].coef;
  const abonnement = pr.utilisateurs * prixUnitaire * 12;
  const premium = pr.options.premium ? abonnement * OPTIONS.premium.taux : 0;
  const brut = abonnement + premium;
  const arr = brut * (1 - pr.remise / 100);
  const miseEnService = o.miseEnService + (pr.options.migration ? OPTIONS.migration.prix : 0) + (pr.options.formation ? OPTIONS.formation.prix : 0);
  return { prixUnitaire, abonnement, premium, brut, arr, miseEnService, total: arr + miseEnService };
}

/* ---------- B2. Modules et problématiques ---------- */
const MODULES = traduire(TEXTES.catalogue.modules);
const PAINS = traduire(TEXTES.catalogue.pains);
const ROLE_MODULE = { dg: "reporting", daf: "facturation", dircom: "pipeline", dsi: "integrations", adv: "devis" };

/* ---------- B3. Motivations d'achat (SONCAS) ---------- */
const SONCAS = traduire(TEXTES.catalogue.soncas);

/* ---------- B4. Concurrence ---------- */
const CONCURRENTS = traduire(TEXTES.catalogue.concurrents);

/* ---------- B5. Comptes du territoire ---------- */
const COMPTES = traduire(TEXTES.catalogue.comptes);
Object.values(COMPTES).forEach(c => { c.batiment = BATIMENTS[c.id]; c.couleur = hex(BATIMENTS[c.id].accent); });

function offreRequise(c) {
  if (c.pains.includes("multisite")) return "enterprise";
  if (c.utilisateurs > OFFRES.essentiel.max || c.pains.some(p => ["facturation", "reporting", "ressaisies"].includes(p))) return "business";
  return "essentiel";
}
function raisonOffre(c) {
  const r = offreRequise(c);
  if (r === "enterprise") return (EN ? "several sites to consolidate (multi-site, permissions by entity)" : "plusieurs sites à consolider (multisite, droits par entité)");
  if (c.utilisateurs > OFFRES.essentiel.max) return (EN ? `${c.utilisateurs} users (Essential is limited to ${OFFRES.essentiel.max})` : `${c.utilisateurs} utilisateurs (Essentiel est limité à ${OFFRES.essentiel.max})`);
  if (r === "business") return (EN ? "needs invoicing, advanced reporting or accounting integration" : "besoin de facturation, de reporting avancé ou d'intégration comptable");
  return (EN ? "needs covered by the CRM, quotes and mobile app" : "besoins couverts par le CRM, les devis et l'application mobile");
}
const pronom = (c, majuscule = true) => EN
  ? (c.genre === "f" ? (majuscule ? "She" : "she") : (majuscule ? "He" : "he"))
  : (c.genre === "f" ? (majuscule ? (EN ? "She" : "Elle") : "elle") : (majuscule ? (EN ? "He" : "Il") : "il"));
const indiceSoncas = (c, canal) => SONCAS[c.soncas][canal === "presentiel" ? "presentiel" : "distance"].replace("{Il}", pronom(c));
const interlocuteurDe = c => ({ nom: c.contact, fonction: c.fonction, entreprise: c.entreprise, couleur: c.couleur });
const arrCatalogue = c => c.utilisateurs * OFFRES[offreRequise(c)].prix * 12;

/* ---------- B6. Cible idéale (ICP) ---------- */
const ICP = traduire(TEXTES.catalogue.icp);

/* ---------- B7. Guide du commercial ---------- */
function construireGuide() {
  const lignesOffres = ORDRE_OFFRES.map(k => {
    const o = OFFRES[k];
    return (EN ? `<tr><td><strong>${o.nom}</strong><br><span class="cc-detail">${o.cible}</span></td><td>€${o.prix} / user / month</td><td>${euros(o.miseEnService)}</td><td>${o.fonctions.join(", ")}</td></tr>` : `<tr><td><strong>${o.nom}</strong><br><span class="cc-detail">${o.cible}</span></td><td>${o.prix} € / utilisateur / mois</td><td>${euros(o.miseEnService)}</td><td>${o.fonctions.join(", ")}</td></tr>`);
  }).join("");
  const lignesSoncas = Object.values(SONCAS).map(s =>
    `<tr><td><strong>${s.nom}</strong></td><td>${s.note}</td><td>${s.argument}</td></tr>`).join("");
  const lignesConcurrents = Object.values(CONCURRENTS).map(c =>
    `<tr><td><strong>${c.nom}</strong><br><span class="cc-detail">${c.prix}</span></td><td>${c.forces}</td><td>${c.faiblesses}</td></tr>`).join("");
  const lignesModules = Object.values(MODULES).map(m => `<tr><td><strong>${m.nom}</strong></td><td>${m.detail}</td></tr>`).join("");
  return (EN ? `
  <div class="guide-onglets">
    <button data-onglet="posture" class="actif">Conversion funnel</button>
    <button data-onglet="offre">Offer and pricing</button>
    <button data-onglet="regles">Sales rules</button>
    <button data-onglet="methodes">Methods</button>
    <button data-onglet="soncas">SONCAS</button>
    <button data-onglet="concurrence">Competition</button>
    <button data-onglet="cible">Target and compliance</button>
  </div>
  <section class="guide-section actif" data-section="posture">
    <p><strong>The conversion funnel</strong> — Unknown → <strong>Prospect</strong> (prospecting) → <strong>Lead</strong> (lead capture) → <strong>Opportunity</strong> (qualification) → <strong>Customer</strong> (closing). The overall rate is the product of each stage's rate: one weak stage drags down the whole funnel.</p>
    <p><strong>Customer lifetime value (CLV)</strong> — CLV = ARR × gross margin (${pourcent(MARGE_BRUTE * 100)}) × customer lifetime. A signature obtained through a discount, false urgency or over-selling produces a customer who leaves at the first renewal: the conversion doesn't last and CLV collapses.</p>
    <table class="guide-table"><thead><tr><th>Stage</th><th>Conversion blocker</th><th>What makes contacts convert</th></tr></thead><tbody>
      <tr><td>Prospecting</td><td>Approach everyone, “trade-show special offer”, sell at first contact</td><td>Read the badge, listen, get a dated next step with the right target</td></tr>
      <tr><td>Lead capture</td><td>Call to sell to a prospect who is barely discovering the topic</td><td>Offer content matched to their maturity, call back quickly those who are ready</td></tr>
      <tr><td>Qualification</td><td>Inflate the pipeline, run through the whole catalogue</td><td>Qualify honestly (BANT), show what answers the stated problem</td></tr>
      <tr><td>Closing</td><td>Maximum discount, false urgency, extra licences</td><td>Right-sizing, give and take, value-adding follow-up</td></tr>
      <tr><td>Retention</td><td>Forget the signed customer, upsell at the wrong time</td><td>Monitor account health, grow satisfied customers, earn referrals</td></tr>
    </tbody></table>
    <p><strong>Your funnel progress</strong> — ${POSTURES.map(x => (EN ? `level ${x.icone} <strong>${x.nom}</strong> (from ${x.min}/100): ${x.devise}` : `niveau ${x.icone} <strong>${x.nom}</strong> (dès ${x.min}/100) : ${x.devise}`)).join(" · ")}. The further you progress in the funnel, the longer your customers' projected lifetime (from ${String(dureeViePosture(0)).replace(".", ",")} to ${ansTexte(dureeViePosture(100))}).</p>
  </section>
  <section class="guide-section" data-section="offre">
    <p><strong>Veltis One</strong> is the SaaS sales management platform for SMEs and mid-sized companies: CRM, quotes, invoicing and reporting in one place.</p>
    <table class="guide-table"><thead><tr><th>Plan</th><th>Subscription (annual commitment)</th><th>Set-up</th><th>Content</th></tr></thead><tbody>${lignesOffres}</tbody></table>
    <table class="guide-table"><thead><tr><th>Module</th><th>What it brings</th></tr></thead><tbody>${lignesModules}</tbody></table>
    <p><strong>Options:</strong> historical data migration (${euros(OPTIONS.migration.prix)}), on-site training (${euros(OPTIONS.formation.prix)}), 24/7 premium support (+15% of the subscription).</p>
  </section>
  <section class="guide-section" data-section="regles">
    <ul>
      <li><strong>Sizing:</strong> the plan and the number of licences must match the stated need. Essential is limited to 10 users; invoicing, advanced reporting and accounting integration require Business; multi-site requires Enterprise.</li>
      <li><strong>Discount authority:</strong> up to ${DELEGATION.autonomie}% on your own; from ${DELEGATION.autonomie + 1} to ${DELEGATION.manager}% with the approval of Sandrine Morel, Sales Director; beyond that, refused.</li>
      <li><strong>Give and take:</strong> a discount is granted in exchange for something (3-year commitment, testimonial, signature by a set date).</li>
      <li><strong>Commitment:</strong> monthly (+20%), annual (list price) or 3 years.</li>
      <li><strong>Call-back times:</strong> a demo request is called back within 2 business hours.</li>
      <li><strong>Pricing:</strong> no price change is planned this year. Any deadline mentioned to a customer must be real: false urgency is a sales misconduct.</li>
      <li><strong>Commitments:</strong> never promise a lead time, a free service or a contract clause without approval (support, sales management, legal).</li>
      <li><strong>Reference sales cost:</strong> ${COUT_HORAIRE} € per working hour, ${COUT_DEPLACEMENT} € per in-person meeting (reception, client room).</li>
    </ul>
  </section>
  <section class="guide-section" data-section="methodes">
    <p><strong>SPIN discovery</strong> — Situation (how do you do it today?), Problem (what difficulties?), Implication (what impact?), Need-payoff (what would this change?).</p>
    <p><strong>BANT qualification</strong> — Budget, Authority (who decides?), Need, Timing. A lead is serious from 3 criteria out of 4, including need.</p>
    <p><strong>FAB argumentation</strong> — Feature, Advantage for this customer, Benefit backed by proof.</p>
    <p><strong>Objection handling</strong> — Listen without interrupting, rephrase, ask questions to isolate the objection, answer with proof, check the answer works.</p>
    <p><strong>Closing</strong> — Spot buying signals, offer an alternative (“the 1st or the 15th?”), lock in the next steps (decision date, approval stages).</p>
    <p><strong>Retention</strong> — Quarterly business review (QBR) before each renewal, adoption tracking, NPS survey (promoters 9–10, passives 7–8, detractors 0–6), upselling only to satisfied accounts.</p>
  </section>
  <section class="guide-section" data-section="soncas">
    <p>Spot your contact's dominant motive and tailor your argument.</p>
    <table class="guide-table"><thead><tr><th>Motive</th><th>How to spot it</th><th>Tailored argument</th></tr></thead><tbody>${lignesSoncas}</tbody></table>
  </section>
  <section class="guide-section" data-section="concurrence">
    <table class="guide-table"><thead><tr><th>Competitor</th><th>Strengths</th><th>Limitations</th></tr></thead><tbody>${lignesConcurrents}</tbody></table>
    <p>Rule: compare scopes, never disparage a competitor and never spread unverified information.</p>
  </section>
  <section class="guide-section" data-section="cible">
    <ul>
      <li><strong>Size:</strong> ${ICP.effectif}.</li>
      <li><strong>Industries:</strong> ${ICP.secteurs}.</li>
      <li><strong>Contacts:</strong> ${ICP.decideurs}.</li>
      <li><strong>Out of target:</strong> students, freelancers without a sales team, job applicants, suppliers, competitors.</li>
    </ul>
    <p><strong>Compliance (GDPR, B2B prospecting)</strong> — Emailing professionals is allowed without prior consent if the message relates to their professional activity, the people have been informed and they can easily opt out. A list of unknown origin, without informing the people, must not be used.</p>
    <p><strong>Confidentiality</strong> — The discount grid and negotiated terms are confidential.</p>
  </section>` : `
  <div class="guide-onglets">
    <button data-onglet="posture" class="actif">Tunnel de conversion</button>
    <button data-onglet="offre">Offre et tarifs</button>
    <button data-onglet="regles">Règles commerciales</button>
    <button data-onglet="methodes">Méthodes</button>
    <button data-onglet="soncas">SONCAS</button>
    <button data-onglet="concurrence">Concurrence</button>
    <button data-onglet="cible">Cible et conformité</button>
  </div>
  <section class="guide-section actif" data-section="posture">
    <p><strong>Le tunnel de conversion</strong> — Inconnu → <strong>Prospect</strong> (prospection) → <strong>Lead</strong> (captation) → <strong>Opportunité</strong> (qualification) → <strong>Client</strong> (closing). Le taux global est le produit des taux de chaque étage : un étage faible pénalise tout le tunnel.</p>
    <p><strong>La valeur vie client (CLV)</strong> — CLV = ARR × marge brute (${pourcent(MARGE_BRUTE * 100)}) × durée de vie du client. Une signature obtenue au prix d'une remise, d'une fausse urgence ou d'une sur-vente produit un client qui part au premier renouvellement : la conversion ne tient pas et la CLV s'effondre.</p>
    <table class="guide-table"><thead><tr><th>Étape</th><th>Frein à la conversion</th><th>Ce qui fait convertir</th></tr></thead><tbody>
      <tr><td>Prospection</td><td>Aborder tout le monde, « offre spéciale salon », vendre au premier contact</td><td>Lire le badge, écouter, obtenir une prochaine étape datée avec la cible</td></tr>
      <tr><td>Captation</td><td>Appeler pour vendre un prospect qui découvre à peine le sujet</td><td>Proposer le contenu adapté à sa maturité, rappeler vite ceux qui sont prêts</td></tr>
      <tr><td>Qualification</td><td>Gonfler le pipe, dérouler tout le catalogue</td><td>Qualifier honnêtement (BANT), montrer ce qui répond au problème exprimé</td></tr>
      <tr><td>Closing</td><td>Remise maximale, fausse urgence, licences en trop</td><td>Juste besoin, donnant-donnant, relance à valeur ajoutée</td></tr>
      <tr><td>Fidélisation</td><td>Oublier le client signé, lui revendre au mauvais moment</td><td>Suivre la santé du compte, développer les clients satisfaits, obtenir des recommandations</td></tr>
    </tbody></table>
    <p><strong>Votre progression dans le tunnel</strong> — ${POSTURES.map(x => (EN ? `level ${x.icone} <strong>${x.nom}</strong> (from ${x.min}/100): ${x.devise}` : `niveau ${x.icone} <strong>${x.nom}</strong> (dès ${x.min}/100) : ${x.devise}`)).join(" · ")}. Plus vous progressez dans le tunnel, plus la durée de vie projetée de vos clients augmente (de ${String(dureeViePosture(0)).replace(".", ",")} à ${ansTexte(dureeViePosture(100))}).</p>
  </section>
  <section class="guide-section" data-section="offre">
    <p><strong>Veltis One</strong> est la plateforme SaaS de gestion commerciale des PME et ETI : CRM, devis, facturation et pilotage au même endroit.</p>
    <table class="guide-table"><thead><tr><th>Offre</th><th>Abonnement (engagement annuel)</th><th>Mise en service</th><th>Contenu</th></tr></thead><tbody>${lignesOffres}</tbody></table>
    <table class="guide-table"><thead><tr><th>Module</th><th>Ce qu'il apporte</th></tr></thead><tbody>${lignesModules}</tbody></table>
    <p><strong>Options :</strong> reprise des données historiques (${euros(OPTIONS.migration.prix)}), formation sur site (${euros(OPTIONS.formation.prix)}), support premium 7j/7 (+15 % de l'abonnement).</p>
  </section>
  <section class="guide-section" data-section="regles">
    <ul>
      <li><strong>Dimensionnement :</strong> l'offre et le nombre de licences doivent correspondre au besoin exprimé. Essentiel est limité à 10 utilisateurs ; la facturation, le reporting avancé et l'intégration comptable nécessitent Business ; le multisite nécessite Enterprise.</li>
      <li><strong>Délégation de remise :</strong> jusqu'à ${DELEGATION.autonomie} % en autonomie ; de ${DELEGATION.autonomie + 1} à ${DELEGATION.manager} % avec l'accord de Sandrine Morel, directrice commerciale ; au-delà, refus.</li>
      <li><strong>Donnant-donnant :</strong> une remise s'obtient contre une contrepartie (engagement de 3 ans, témoignage, signature à date).</li>
      <li><strong>Engagement :</strong> mensuel (+20 %), annuel (prix catalogue) ou 3 ans.</li>
      <li><strong>Délais de rappel :</strong> une demande de démonstration se rappelle dans les 2 heures ouvrées.</li>
      <li><strong>Prix :</strong> aucune évolution tarifaire n'est prévue cette année. Toute échéance invoquée auprès d'un client doit être réelle : une fausse urgence est une faute commerciale.</li>
      <li><strong>Engagements :</strong> on ne promet jamais un délai, une prestation gratuite ou une clause contractuelle sans validation (support, direction commerciale, juridique).</li>
      <li><strong>Coût commercial de référence :</strong> ${COUT_HORAIRE} € par heure de travail, ${COUT_DEPLACEMENT} € par rendez-vous présentiel (accueil, salon client).</li>
    </ul>
  </section>
  <section class="guide-section" data-section="methodes">
    <p><strong>Découverte SPIN</strong> — Situation (comment faites-vous aujourd'hui ?), Problème (quelles difficultés ?), Implication (quel impact ?), Need-payoff (qu'est-ce que cela changerait ?).</p>
    <p><strong>Qualification BANT</strong> — Budget, Autorité (qui décide ?), Need/Besoin, Timing. Un lead est sérieux à partir de 3 critères sur 4, dont le besoin.</p>
    <p><strong>Argumentation CAP</strong> — Caractéristique, Avantage pour ce client, Preuve.</p>
    <p><strong>Traitement des objections</strong> — Écouter sans couper, reformuler, questionner pour isoler l'objection, répondre avec une preuve, vérifier que la réponse convient.</p>
    <p><strong>Conclusion</strong> — Repérer les signaux d'achat, proposer une alternative (« le 1er ou le 15 ? »), verrouiller la suite (date de décision, étapes de validation).</p>
    <p><strong>Fidélisation</strong> — Revue d'activité (QBR) avant chaque renouvellement, suivi de l'adoption, enquête NPS (promoteurs 9–10, passifs 7–8, détracteurs 0–6), ventes additionnelles uniquement sur des comptes satisfaits.</p>
  </section>
  <section class="guide-section" data-section="soncas">
    <p>Repérez la motivation dominante de votre interlocuteur et adaptez l'argument.</p>
    <table class="guide-table"><thead><tr><th>Motivation</th><th>Comment la repérer</th><th>Argument adapté</th></tr></thead><tbody>${lignesSoncas}</tbody></table>
  </section>
  <section class="guide-section" data-section="concurrence">
    <table class="guide-table"><thead><tr><th>Concurrent</th><th>Ses atouts</th><th>Ses limites</th></tr></thead><tbody>${lignesConcurrents}</tbody></table>
    <p>Règle : on compare des périmètres, on ne dénigre jamais un concurrent et on ne diffuse pas d'information non vérifiée.</p>
  </section>
  <section class="guide-section" data-section="cible">
    <ul>
      <li><strong>Taille :</strong> ${ICP.effectif}.</li>
      <li><strong>Secteurs :</strong> ${ICP.secteurs}.</li>
      <li><strong>Interlocuteurs :</strong> ${ICP.decideurs}.</li>
      <li><strong>Hors cible :</strong> étudiants, indépendants sans équipe commerciale, candidats, fournisseurs, concurrents.</li>
    </ul>
    <p><strong>Conformité (RGPD, prospection B2B)</strong> — La prospection par e-mail de professionnels est possible sans consentement préalable si le message concerne leur activité professionnelle, que les personnes ont été informées et qu'elles peuvent s'opposer facilement. Un fichier d'origine inconnue, sans information des personnes, ne doit pas être utilisé.</p>
    <p><strong>Confidentialité</strong> — La grille de remises et les conditions négociées sont confidentielles.</p>
  </section>`);
}

function ouvrirGuide() {
  if (jeu.mode === "fenetre") return;
  ouvrirFenetre({
    titre: (EN ? "Sales guide" : "Guide du commercial"),
    sousTitre: (EN ? "Conversion funnel and CLV, Veltis One offer, sales rules, methods and competition" : "Tunnel de conversion et CLV, offre Veltis One, règles commerciales, méthodes et concurrence"),
    corps: construireGuide(),
    large: true,
    navigation: "document",
    boutons: [{ label: (EN ? "Close" : "Fermer"), classe: "btn-principal", action: fermerFenetre }],
    onOuverture: racine => {
      const onglets = [...racine.querySelectorAll(".guide-onglets button")];
      const afficher = b => {
        onglets.forEach(x => x.classList.toggle("actif", x === b));
        racine.querySelectorAll(".guide-section").forEach(s => s.classList.toggle("actif", s.dataset.section === b.dataset.onglet));
        racine.scrollTop = 0;
      };
      onglets.forEach(b => { b.tabIndex = -1; b.addEventListener("click", () => afficher(b)); });
      jeu.changerOnglet = sens => {
        const i = onglets.findIndex(b => b.classList.contains("actif"));
        afficher(onglets[(i + sens + onglets.length) % onglets.length]);
      };
    }
  });
}

/* ---------- B8. Aides communes aux missions ---------- */
function placerContact(c, { decalage = 1.3, etiquette = true } = {}) {
  const b = BATIMENTS[c.id];
  const app = Object.assign({}, APPARENCES[c.apparence % APPARENCES.length], { genre: c.genre === "f" ? "f" : "h", variante: hacher(c.id) % 97 });
  const mesh = creerPersonnage(app);
  const p = ajouterPnj(mesh, b.contact.x + (decalage - 1.3), b.contact.z, null);
  if (etiquette) p.etiquette = creerEtiquette(mesh, `${c.contact} · ${c.entreprise}`);
  p.compte = c;
  return p;
}

function activerCollegue(cle, label, action, { balise = true } = {}) {
  const c = collegues[cle];
  ramener(c.employe);
  const et = creerEtiquette(c.mesh, `${c.def.nom} · ${c.def.fonction}`, 2.2, "etq-collegue");
  c.employe.etiquetteMission = true;
  const inter = ajouterInteractif({ objet: c.mesh, label, action, rayon: 2.4, balise });
  return { etiquette: et, inter };
}

function interlocuteurCollegue(cle) {
  const d = COLLEGUES_DEF[cle];
  return { nom: d.nom, fonction: d.fonction, entreprise: "Veltis", couleur: d.couleur };
}

function canalContact() { return estTerrain() ? (EN ? "In person" : "Présentiel") : (EN ? "Video call" : "Visio"); }
function signalCanal(c, canal) {
  const presentiel = canal === (EN ? "In person" : "Présentiel");
  const etiquette = presentiel ? (EN ? "Body language" : "Non-verbal") : canal === (EN ? "Phone" : "Téléphone") ? (EN ? "Tone of voice" : "Ton de voix") : (EN ? "On screen" : "À l'écran");
  return `<strong>${etiquette} :</strong> ${echapper(indiceSoncas(c, presentiel ? "presentiel" : "distance"))}`;
}
function reactionCanal(c, canal, delta) {
  const presentiel = canal === (EN ? "In person" : "Présentiel");
  const il = pronom(c), lui = pronom(c, false);
  let texte;
  if (delta > 5) texte = presentiel ? (EN ? `${il} nods and takes notes.` : `${il} hoche la tête et prend des notes.`) : (EN ? `Their voice relaxes and they follow up with a question.` : `Sa voix se détend, ${lui} enchaîne avec une question.`);
  else if (delta < -5) texte = presentiel ? (EN ? `${il} crosses their arms and leans back slightly.` : `${il} croise les bras et se recule légèrement.`) : (EN ? `A silence, then a curter answer.` : `Un silence, puis une réponse plus sèche.`);
  else texte = presentiel ? (EN ? `${il} stays attentive, without any marked reaction.` : `${il} reste attentif, sans réaction marquée.`) : (EN ? `The tone stays neutral.` : `Le ton reste neutre.`);
  const etiquette = presentiel ? (EN ? "Body language" : "Non-verbal") : canal === (EN ? "Phone" : "Téléphone") ? (EN ? "Tone of voice" : "Ton de voix") : (EN ? "On screen" : "À l'écran");
  return `<strong>${etiquette} :</strong> ${echapper(texte)}`;
}

/* Vérifie que le commercial peut agir sur un compte à distance ou sur place */
function controleSedentaire() {
  if (!estTerrain() && !auPoste()) {
    message((EN ? "Go back to your workstation to contact your customers." : "Retournez à votre poste de travail pour contacter vos clients."), "info");
    return false;
  }
  return true;
}
function controleSurSite(c) {
  if (!procheBatiment(c.id)) {
    message((EN ? `${c.entreprise} is waiting for you in the ${BATIMENTS[c.id].nom} (${distanceMetres(BATIMENTS[c.id].porte)} m away) for this face-to-face meeting.` : `${c.entreprise} vous attend au ${BATIMENTS[c.id].nom} (à ${distanceMetres(BATIMENTS[c.id].porte)} m) pour cet entretien en face à face.`), "info");
    return false;
  }
  return true;
}

/* =====================================================================
   PARTIE C — MISSIONS 1 ET 2
   ===================================================================== */

/* ---------------------------------------------------------------------
   MISSION 1 · NOTORIÉTÉ (bleu)
   Plan de visibilité (budget, canaux, message) puis tenue du stand
   au salon « Solutions PME ». Mission commune aux deux profils.
   --------------------------------------------------------------------- */
const CANAUX = {
  linkedin: { nom: (EN ? "Targeted LinkedIn Ads" : "LinkedIn Ads ciblées"), detail: (EN ? "Managing directors and sales managers of SMEs with 20 to 250 employees, in the region." : "Dirigeants et managers commerciaux de PME de 20 à 250 salariés, dans la région."), cout: 2400, impressions: 55000, visites: 390, icp: 0.8 },
  google: { nom: (EN ? "Google Ads (search network)" : "Google Ads (réseau de recherche)"), detail: (EN ? "Keywords “SME CRM software”, “quote and invoice software”." : "Mots-clés « logiciel CRM PME », « logiciel devis facture »."), cout: 1800, impressions: 22000, visites: 880, icp: 0.6 },
  seo: { nom: (EN ? "SEO" : "Référencement naturel"), detail: (EN ? "Four optimised expert articles, published on the Veltis blog." : "Quatre articles d'expertise optimisés, publiés sur le blog Veltis."), cout: 1400, impressions: 28000, visites: 560, icp: 0.65 },
  social: { nom: "Social selling", detail: (EN ? "Regular LinkedIn posts by the sales team." : "Publications régulières de l'équipe commerciale sur LinkedIn."), cout: 300, impressions: 16000, visites: 210, icp: 0.75 },
  emailing: { nom: (EN ? "Emailing to business contacts" : "E-mailing aux contacts professionnels"), detail: (EN ? "Existing B2B contacts, message related to their role, one-click unsubscribe." : "Contacts B2B existants, message lié à leur fonction, désinscription en un clic."), cout: 400, impressions: 6000, visites: 300, icp: 0.7 },
  fichier: { nom: (EN ? "Buying a list of 20,000 emails" : "Achat d'un fichier de 20 000 e-mails"), detail: (EN ? "Unknown origin, people not informed about the data collection." : "Origine inconnue, aucune information des personnes sur la collecte."), cout: 900, impressions: 20000, visites: 150, icp: 0.15, erreur: "conformite" },
  affichage: { nom: (EN ? "Outdoor advertising" : "Affichage urbain"), detail: (EN ? "Posters in the metro and RER A corridors at La Défense for two weeks." : "Panneaux dans les couloirs du métro et du RER A à La Défense pendant deux semaines."), cout: 3200, impressions: 380000, visites: 70, icp: 0.04, erreur: "ciblage" },
  radio: { nom: (EN ? "Mass-market radio spot" : "Spot radio grand public"), detail: (EN ? "Regional station, 40 airings over two weeks." : "Station régionale, 40 passages en deux semaines."), cout: 3800, impressions: 240000, visites: 110, icp: 0.05, erreur: "ciblage" }
};
const MESSAGES_CAMPAGNE = {
  benefice: { texte: (EN ? "“Quotes, follow-ups and invoices in one place: your sales reps save five hours a week.”" : "« Devis, relances et factures au même endroit : vos commerciaux gagnent cinq heures par semaine. »"), coef: 1.15, verdict: "ok" },
  preuve: { texte: (EN ? "“More than 1,200 SMEs already run their sales with Veltis One. Find out how in 3 minutes.”" : "« Plus de 1 200 PME pilotent déjà leurs ventes avec Veltis One. Découvrez comment en 3 minutes. »"), coef: 1.08, verdict: "ok" },
  prix: { texte: (EN ? "“Veltis One from €29 per user: the cheapest sales management software on the market.”" : "« Veltis One dès 29 € par utilisateur : le logiciel de gestion commerciale le moins cher du marché. »"), coef: 0.75, verdict: "faux" },
  jargon: { texte: (EN ? "“Veltis One: multi-tenant SaaS CRM, REST API and real-time webhooks.”" : "« Veltis One : CRM SaaS multi-tenant, API REST et webhooks temps réel. »"), coef: 0.6, verdict: "flou" },
  superlatif: { texte: (EN ? "“Veltis One, simply the best sales management solution.”" : "« Veltis One, tout simplement la meilleure solution de gestion commerciale. »"), coef: 0.8, verdict: "flou" }
};
const COUT_STAND = 3000;
const IMPRESSIONS_SALON = 8000;

const VISITEURS_SALON = [
  { type: "icp", role: "dg", nom: "Philippe Garnier", fonction: (EN ? "Managing director" : "Dirigeant"), entreprise: "Menuiseries Garnier", effectif: 45 },
  { type: "icp", role: "daf", nom: "Nathalie Brun", fonction: (EN ? "Finance Director" : "Directrice financière"), entreprise: "Agrifrais", effectif: 120 },
  { type: "icp", role: "dircom", nom: "Thomas Leclerc", fonction: (EN ? "Sales Director" : "Directeur commercial"), entreprise: "Kinéo Équipements", effectif: 80 },
  { type: "icp", role: "dsi", nom: "Rachid Amrani", fonction: (EN ? "IT Manager" : "Responsable informatique"), entreprise: "Normandie Façades", effectif: 150 },
  { type: "icp", role: "adv", nom: "Céline Marchand", fonction: (EN ? "Sales Admin Manager" : "Responsable ADV"), entreprise: "Pharmadis", effectif: 70 },
  { type: "icp", role: "dg", nom: "Laurent Picard", fonction: (EN ? "Owner-manager" : "Gérant"), entreprise: "Picard Climatisation", effectif: 28 },
  { type: "icp", role: "dircom", nom: "Aurélie Vidal", fonction: (EN ? "Head of Sales" : "Directrice des ventes"), entreprise: "Studio Oreka", effectif: 35 },
  { type: "icp", role: "daf", nom: "Bruno Lemoine", fonction: (EN ? "Head of Administration and Finance" : "Responsable administratif et financier"), entreprise: "Transports Lemoine", effectif: 95 },
  { type: "icp", role: "dsi", nom: "Yasmine Belkacem", fonction: (EN ? "CIO" : "DSI"), entreprise: "Groupe Valmy Santé", effectif: 210 },
  { type: "icp", role: "adv", nom: "Sandra Petit", fonction: "Office manager", entreprise: "Cabinet Archi+", effectif: 22 },
  { type: "icp", role: "dg", nom: "Éric Bonnet", fonction: (EN ? "Managing Director" : "Directeur général"), entreprise: "Bonnet Logistique", effectif: 180 },
  { type: "etudiant", nom: "Lucas Morin", fonction: (EN ? "Business studies student" : "Étudiant en BTS NDRC"), entreprise: (EN ? "Jean-Monnet College" : "Lycée Jean-Monnet"), effectif: null, tenue: "casual" },
  { type: "tpe", nom: "Jean Dufour", fonction: (EN ? "Self-employed plumber" : "Artisan plombier"), entreprise: "Dufour Plomberie", effectif: 1, tenue: "casual" },
  { type: "fournisseur", nom: "Kevin Roussel", fonction: (EN ? "Account executive" : "Chargé d'affaires"), entreprise: "PrintExpress Goodies", effectif: 12 },
  { type: "candidat", nom: "Marine Colin", fonction: (EN ? "Job seeker" : "En recherche d'emploi"), entreprise: (EN ? "Individual visitor" : "Visiteuse individuelle"), effectif: null },
  { type: "concurrent", nom: "Damien Fabre", fonction: (EN ? "Market research analyst" : "Chargé d'études marché"), entreprise: "Kordis Solutions", effectif: 60 }
];
const PITCHS = {
  dg: (EN ? "“Steer your growth: a consolidated pipeline and reliable forecasts to decide faster.”" : "« Piloter votre croissance : un pipeline consolidé et des prévisions fiables pour décider plus vite. »"),
  daf: (EN ? "“Secure your revenue: quotes, invoices and payments connected, fewer errors and delays.”" : "« Sécuriser votre chiffre d'affaires : devis, factures et encaissements reliés, moins d'erreurs et de retards. »"),
  dircom: (EN ? "“More time to sell: automatic follow-ups and a pipeline shared by the whole team.”" : "« Plus de temps pour vendre : relances automatiques et pipeline partagé par toute l'équipe. »"),
  dsi: (EN ? "“A platform hosted in France, with SSO and open APIs, that integrates with your information system.”" : "« Une plateforme hébergée en France, avec SSO et API ouvertes, qui s'intègre à votre système d'information. »"),
  adv: (EN ? "“No more double entry: from quote to invoice in a few clicks.”" : "« Fini les ressaisies : du devis à la facture en quelques clics, sans double saisie. »")
};
const INTRO_VISITEUR = {
  dg: (EN ? "“I'm looking to manage our growth better. Today I have no clear view of what will sign in the coming months.”" : "« Je cherche à mieux piloter notre croissance. Aujourd'hui, je n'ai pas de vision claire de ce qui va se signer dans les prochains mois. »"),
  daf: (EN ? "“I'm looking at how to make our quote-to-invoice chain more reliable. We waste time and make too many mistakes.”" : "« Je regarde comment fiabiliser notre chaîne devis–facture. On perd du temps et on a trop d'erreurs. »"),
  dircom: (EN ? "“My sales reps spend too much time on admin and not enough selling. I'm looking at what's out there.”" : "« Mes commerciaux passent trop de temps dans l'administratif et pas assez à vendre. Je regarde ce qui existe. »"),
  dsi: (EN ? "“We're rationalising our tools. Any new software has to integrate cleanly with our information system.”" : "« On rationalise nos outils. Tout nouveau logiciel doit s'intégrer proprement à notre système d'information. »"),
  adv: (EN ? "“I prepare quotes and track orders. We re-enter everything several times, I'm looking for something simpler.”" : "« Je prépare les devis et le suivi des commandes. On ressaisit tout plusieurs fois, je cherche plus simple. »"),
  etudiant: (EN ? "“I'm a business student, preparing a report on sales management software. I'm collecting documentation.”" : "« Je suis étudiant en BTS, je prépare un dossier sur les logiciels de gestion commerciale. Je collecte de la documentation. »"),
  tpe: (EN ? "“I'm a tradesman, I work alone. I'm looking for a small tool to do my quotes from time to time.”" : "« Je suis artisan, je travaille seul. Je cherche un petit outil pour faire mes devis de temps en temps. »"),
  fournisseur: (EN ? "“Actually, I make custom promotional items. Would you need goodies for your next trade shows?”" : "« En fait, je fabrique des objets publicitaires personnalisés. Vous auriez besoin de goodies pour vos prochains salons ? »"),
  candidat: (EN ? "“I'm a saleswoman looking for a job. Is Veltis hiring at the moment?”" : "« Je suis commerciale, en recherche d'emploi. Est-ce que Veltis recrute en ce moment ? »"),
  concurrent: (EN ? "“I'm doing a market study. Could you give me your detailed price list and discount levels?”" : "« Je réalise une étude de marché. Vous pourriez me donner votre grille tarifaire détaillée et vos niveaux de remise ? »")
};
/* ok : bonne réponse · niveau "manque" : réponse discutable · sinon : erreur */
const OPTIONS_HORS_CIBLE = {
  etudiant: [
    { label: (EN ? "Point them to the online documentation and wish them luck, politely keeping it short." : "L'orienter vers la documentation en ligne et lui souhaiter bonne réussite, en écourtant poliment."), ok: true, tag: "ciblage", journal: (EN ? "Student pointed to the online documentation." : "Étudiant orienté vers la documentation en ligne.") },
    { label: (EN ? "Give them the full software demo (20 minutes)." : "Lui faire la démonstration complète du logiciel (20 minutes)."), ok: false, tag: "organisation", journal: (EN ? "Full demo given to a student: 20 minutes lost at peak time." : "Démonstration complète faite à un étudiant : 20 minutes perdues au moment de l'affluence."), temps: 20 },
    { label: (EN ? "Offer them a sales meeting next week." : "Lui proposer un rendez-vous commercial la semaine prochaine."), ok: false, tag: "ciblage", journal: (EN ? "Sales meeting offered to a student: the pipeline is polluted." : "Rendez-vous commercial proposé à un étudiant : le pipeline est pollué.") },
    { label: (EN ? "Scan their badge to add them to the prospect database: they may be a customer one day." : "Scanner son badge pour l'ajouter à la base prospects : il sera peut-être client un jour."), ok: false, niveau: "manque", tag: "ciblage", journal: (EN ? "Student added to the prospect database: the list quality deteriorates." : "Étudiant ajouté à la base prospects : la qualité du fichier se dégrade.") }
  ],
  tpe: [
    { label: (EN ? "Recommend a solution suited to freelancers and politely keep it short." : "Lui conseiller une solution adaptée aux indépendants et écourter poliment."), ok: true, tag: "ciblage", journal: (EN ? "Self-employed tradesman pointed to a suitable solution." : "Artisan indépendant orienté vers une solution adaptée.") },
    { label: (EN ? "Offer them the Essential plan for one user, with a 10% trade-show discount." : "Lui proposer l'offre Essentiel pour un utilisateur, avec 10 % de remise salon."), ok: false, tag: "ciblage", journal: (EN ? "Plan sold to a one-man business: €990 set-up fee out of proportion, out-of-target customer." : "Offre vendue à un artisan seul : mise en service de 990 € disproportionnée, client hors cible.") },
    { label: (EN ? "Give them the full demo (20 minutes)." : "Lui faire la démonstration complète (20 minutes)."), ok: false, tag: "organisation", journal: (EN ? "Full demo given to an out-of-target freelancer." : "Démonstration complète faite à un indépendant hors cible."), temps: 20 }
  ],
  fournisseur: [
    { label: (EN ? "Take their card, point them to the right contact (purchasing) and get back to your visitors." : "Prendre sa carte, lui indiquer le bon interlocuteur (achats) et revenir à vos visiteurs."), ok: true, tag: "organisation", journal: (EN ? "Supplier redirected to the purchasing department." : "Fournisseur réorienté vers le service achats.") },
    { label: (EN ? "Chat about their goodies for 20 minutes." : "Discuter de ses goodies pendant 20 minutes."), ok: false, tag: "organisation", journal: (EN ? "20 minutes spent with a supplier during the trade show." : "20 minutes passées avec un fournisseur pendant le salon."), temps: 20 },
    { label: (EN ? "Order a few goodies from them to keep the relationship going." : "Lui commander quelques goodies pour entretenir la relation."), ok: false, tag: "organisation", journal: (EN ? "Purchase committed without the role or the budget." : "Achat engagé sans en avoir le rôle ni le budget.") }
  ],
  candidat: [
    { label: (EN ? "Kindly direct her to the Careers page and the HR department." : "L'orienter avec courtoisie vers la page Carrières et le service RH."), ok: true, tag: "relation", journal: (EN ? "Applicant directed to the HR department." : "Candidate orientée vers le service RH.") },
    { label: (EN ? "Promise her an interview with your director." : "Lui promettre un entretien avec votre directrice."), ok: false, tag: "relation", journal: (EN ? "Interview promise you can't keep." : "Promesse d'entretien que vous ne pouvez pas tenir.") },
    { label: (EN ? "Describe your job and your bonuses for 20 minutes." : "Lui détailler votre poste et vos primes pendant 20 minutes."), ok: false, tag: "organisation", journal: (EN ? "20 minutes discussing recruitment at peak time." : "20 minutes de discussion sur le recrutement pendant l'affluence."), temps: 20 }
  ],
  concurrent: [
    { label: (EN ? "Stay courteous, present the public outline and refer them to the website." : "Rester courtois, présenter les grandes lignes publiques et renvoyer vers le site."), ok: true, tag: "conformite", journal: (EN ? "Competitor's request handled without disclosing confidential information." : "Demande d'un concurrent traitée sans divulguer d'information confidentielle.") },
    { label: (EN ? "Give them the price list and discount levels." : "Lui communiquer la grille tarifaire et les niveaux de remise."), ok: false, tag: "conformite", journal: (EN ? "Confidential discount grid disclosed to a competitor." : "Grille de remises confidentielle communiquée à un concurrent.") },
    { label: (EN ? "Refuse to answer and ask them to leave the stand." : "Refuser de lui répondre et lui demander de quitter le stand."), ok: false, niveau: "manque", tag: "relation", journal: (EN ? "Competitor turned away in front of other visitors: the stand's image suffers." : "Concurrent éconduit devant d'autres visiteurs : image du stand dégradée.") },
    { label: (EN ? "Give them the public prices and mention that “we easily go down 20%”." : "Lui donner les tarifs publics et préciser « qu'on descend facilement de 20 % »."), ok: false, tag: "conformite", journal: (EN ? "Discount policy revealed to a competitor." : "Politique de remise révélée à un concurrent.") }
  ]
};

function creerStand(nom, couleur, sousTitre) {
  const g = new THREE.Group();
  g.add(pos(boite(2.6, 0.06, 1.9, 0xf1f5f9), 0, 0.03, 0));
  g.add(pos(boite(2.6, 2.3, 0.1, couleur), 0, 1.15, -0.9));
  const visuel = panneauTexte(2.3, 0.72, {
    largeur: 690, hauteur: 216, fond: "#ffffff",
    lignes: [{ texte: nom, taille: 66, gras: 800, couleur: hex(couleur) }, { texte: sousTitre, taille: 28, gras: 600, couleur: "#475569" }]
  });
  visuel.position.set(0, 1.72, -0.84);
  g.add(visuel);
  g.add(pos(boite(1.3, 0.95, 0.5, 0xf8fafc), 0.35, 0.475, 0.2));
  g.add(pos(boite(1.32, 0.08, 0.52, couleur), 0.35, 0.96, 0.2));
  g.add(pos(boite(0.9, 0.55, 0.05, 0x111827), -0.75, 1.3, -0.78));
  g.add(pos(boite(0.8, 0.46, 0.01, 0x93c5fd, false), -0.75, 1.3, -0.75));
  g.add(pos(boite(0.5, 1.7, 0.04, couleur), -1.15, 0.85, 0.65));
  g.add(pos(boite(0.42, 0.5, 0.01, 0xffffff, false), -1.15, 1.3, 0.675));
  return g;
}
function placerStand(x, z, nom, couleur, sousTitre) {
  const s = creerStand(nom, couleur, sousTitre);
  s.position.set(x, 0, z);
  groupeNiveau.add(s);
  obstacleBoite(x, z - 0.9, 1.3, 0.12, obstaclesNiveau);
  obstacleBoite(x + 0.35, z + 0.2, 0.68, 0.28, obstaclesNiveau);
  obstacleCercle(x - 1.15, z + 0.65, 0.2, obstaclesNiveau);
}

function construireSalon() {
  placerStand(8.15, -4.0, "VELTIS", 0x1e3a8a, (EN ? "Veltis One · sales management" : "Veltis One · gestion commerciale"));
  placerStand(4.8, -4.0, "KORDIS CRM", 0x7c2d12, (EN ? "The simple, affordable CRM" : "Le CRM simple et abordable"));
  placerStand(11.5, -4.0, (EN ? "ATLAS BUSINESS BANK" : "ATLAS BANQUE PRO"), 0x134e4a, (EN ? "Financing SME growth" : "Financer la croissance des PME"));
  // Arche d'entrée
  [6.4, 9.9].forEach(x => {
    groupeNiveau.add(pos(boite(0.24, 2.8, 0.24, 0x1c1c1c), x, 1.4, 4.3));
    obstacleCercle(x, 4.3, 0.25, obstaclesNiveau);
  });
  const banniere = panneauTexte(3.8, 0.7, { largeur: 760, hauteur: 140, fond: "#1e293b", lignes: [{ texte: (EN ? "SME SOLUTIONS BREAKFAST" : "MATINALE SOLUTIONS PME"), taille: 50, gras: 800, couleur: "#ffffff" }, { texte: (EN ? "Veltis Forum · Level 1" : "Forum Veltis · R+1"), taille: 24, gras: 500, couleur: "#cbd5e1" }] });
  banniere.position.set(8.15, 2.45, 4.32);
  groupeNiveau.add(banniere);
  groupeNiveau.add(pos(boite(3.9, 0.1, 0.3, 0x1c1c1c), 8.15, 2.85, 4.3));
  // Espace networking
  [[6.2, 1.6], [10.1, 1.6]].forEach(([x, z]) => {
    groupeNiveau.add(pos(cylindre(0.35, 0.35, 0.05, 0xf8fafc, 16), x, 1.08, z));
    groupeNiveau.add(pos(cylindre(0.05, 0.05, 1.05, 0x374151, 8), x, 0.53, z));
    groupeNiveau.add(pos(cylindre(0.25, 0.25, 0.03, 0x374151, 12), x, 0.02, z));
    obstacleCercle(x, z, 0.4, obstaclesNiveau);
  });
}

const M1 = {
  id: "notoriete", phase: (EN ? "Prospecting" : "Prospection"), couleur: "#1e3a8a", texteCouleur: "#ffffff",
  transition: [(EN ? "Unknown" : "Inconnu"), "Prospect"],
  objectifTableau: (EN ? "Attract the target and spot qualified prospects" : "Attirer la cible et repérer des prospects qualifiés"),
  activitesTableau: (EN ? "Targeted media plan, trade show, badge reading, booking meetings" : "Plan média ciblé, salon, lecture des badges, prise de rendez-vous"),
  kpiTableau: (EN ? "Qualified prospects, conversation → prospect rate, cost per visitor" : "Prospects qualifiés, taux échange → prospect, coût par visiteur"),
  reflexeRequin: (EN ? "Approaching everyone with a “trade-show special offer” and trying to sell at first contact: nobody becomes a prospect. To convert, read the badge, listen, and only invest time in contacts with a real need." : "Aborder tout le monde avec une « offre spéciale salon » et vouloir vendre dès le premier contact : personne ne devient prospect. Pour convertir, lisez le badge, écoutez et n'investissez votre temps que sur les contacts qui ont un vrai besoin."),
  mode: { terrain: (EN ? "Trade show and media plan" : "Salon et plan média"), sedentaire: (EN ? "Trade show and media plan" : "Salon et plan média") },
  titre: (EN ? "Turn strangers into qualified prospects" : "Transformer des inconnus en prospects qualifiés"),
  contexte: (EN ? "Veltis occupies a three-level building on the Esplanade de La Défense (ground floor, levels 1 and 2). Sandrine Morel, your Sales Director, puts you in charge of this month's visibility plan and the Veltis stand at the “SME Solutions” breakfast event on Thursday, at the Veltis Forum: SME managers come up to the floor to discover the solutions on show. First stage of the funnel: fill the top of the funnel with the right prospects." : "Veltis occupe un immeuble de trois niveaux sur l'esplanade de La Défense (RDC, R+1, R+2). Sandrine Morel, votre directrice commerciale, vous confie le plan de visibilité du mois et la tenue du stand Veltis à la matinale « Solutions PME », jeudi, au Forum Veltis : des dirigeants de PME montent à l'étage pour découvrir les solutions exposées. Premier étage du tunnel : remplir le haut de l'entonnoir avec les bons prospects."),
  objectifBusiness: (EN ? "Bring target prospects into the funnel, identified and committed to a next step. Key activities: targeted media plan, trade show, opening line, booking meetings. KPIs: qualified prospects, conversation → prospect conversion rate, cost per visitor." : "Faire entrer dans le tunnel des prospects de la cible, identifiés et engagés sur une prochaine étape. Activités clés : plan média ciblé, salon, accroche, prise de rendez-vous. Indicateurs : prospects qualifiés, taux de transformation échange → prospect, coût par visiteur."),
  params: {
    standard: { budget: 5000, objectifVisiteurs: 1800, objectifContacts: 5, nbVisiteurs: 14 },
    confirme: { budget: 4500, objectifVisiteurs: 2000, objectifContacts: 7, nbVisiteurs: 16 }
  },
  periode: () => ({ debut: 3 * JOURNEE, fin: 3 * JOURNEE + 480, rythme: 2.2, affichage: "jour" }),
  depart: () => ({ x: 8.15, z: 1.9, angle: Math.PI }),
  mission: p => (EN ? `Build a ${euros(p.budget)} visibility plan, then run the trade-show stand: at least ${nombre(p.objectifVisiteurs)} visitors over the month and ${p.objectifContacts} qualified prospects at the show.` : `Construisez un plan de visibilité de ${euros(p.budget)}, puis tenez le stand du salon : au moins ${nombre(p.objectifVisiteurs)} visiteurs sur le mois et ${p.objectifContacts} prospects qualifiés au salon.`),
  consignes: p => [
    (EN ? `Visibility plan: split ${euros(p.budget)} across the channels and choose the campaign message. The stand (${euros(COUT_STAND)}) is already booked.` : `Plan de visibilité : répartissez ${euros(p.budget)} entre les leviers et choisissez le message de campagne. Le stand (${euros(COUT_STAND)}) est déjà réservé.`),
    (EN ? "Trade show (9 am to 5 pm): visitors come and go throughout the day. Read their badge as you approach, then talk to them (E key)." : "Salon (de 9 h à 17 h) : les visiteurs arrivent et repartent au fil de la journée. Lisez leur badge en vous approchant, puis abordez-les (touche E)."),
    (EN ? "With a target prospect: open question, argument suited to their role, then badge scan and meeting." : "Avec un prospect de la cible : accroche ouverte, argument adapté à sa fonction, puis scan du badge et rendez-vous."),
    (EN ? "With an out-of-target visitor: stay courteous and keep it short, your time is limited." : "Avec un visiteur hors cible : restez courtois et écourtez, votre temps est compté.")
  ],
  profilNote: () => (EN ? "Mission shared by field and inside sales profiles: both take part in the visibility plan and in running trade shows." : "Mission commune aux profils terrain et sédentaire : les deux participent au plan de visibilité et à la tenue des salons."),
  criteres: p => [
    (EN ? `Success: at least ${nombre(p.objectifVisiteurs)} visitors over the month and ${p.objectifContacts} qualified prospects at the show.` : `Réussite : au moins ${nombre(p.objectifVisiteurs)} visiteurs sur le mois et ${p.objectifContacts} prospects qualifiés au salon.`),
    (EN ? "Excellence: cost per visitor ≤ €3.40 and at least 62% of visitors on target · Proficient: cost per visitor ≤ €4.20." : "Excellence : coût par visiteur ≤ 3,40 € et au moins 62 % de visiteurs dans la cible · Maîtrise : coût par visiteur ≤ 4,20 €."),
    (EN ? "Errors: untargeted or GDPR-non-compliant channel, confidential information disclosed, time wasted with an out-of-target visitor, hard selling." : "Erreurs : canal non ciblé ou non conforme au RGPD, information confidentielle divulguée, temps perdu avec un visiteur hors cible, vente forcée.")
  ],
  aRetenir: (EN ? "The top of the funnel can be managed: channels where the target is, a message focused on customer benefit, and tracking of cost per visitor and share of qualified visitors. At a trade show, the badge is the first qualifying information: invest your time in the target, secure a dated next step, and politely keep the rest short. A prospect well targeted from the start is a future customer who will stay." : "Le haut du tunnel se pilote : des canaux où se trouve la cible, un message orienté bénéfice client, et un suivi du coût par visiteur et de la part de visiteurs qualifiés. Sur un salon, le badge est la première information de qualification : on investit son temps sur la cible, on obtient une prochaine étape datée, et on écourte poliment le reste. Un prospect bien ciblé dès le départ, c'est un futur client qui restera."),
  conseilEchec: (EN ? "Favour targeted, low-cost channels (SEO, social selling, compliant emailing, keywords) and a message centred on customer benefit. At the show, read the badge before approaching and tailor your argument to the visitor's role." : "Privilégiez les canaux ciblés et peu coûteux (référencement, social selling, e-mailing conforme, mots-clés) et un message centré sur le bénéfice client. Au salon, lisez le badge avant d'aborder et adaptez votre argument à la fonction du visiteur."),

  demarrer(n, p) {
    Object.assign(n, { p, plan: null, contacts: 0, tiedes: 0, rencontres: 0, echanges: [], visiteurs: [] });
    construireSalon();
    const ordre = melanger(VISITEURS_SALON.filter(v => v.type === "icp")).slice(0, p.nbVisiteurs - 5)
      .concat(VISITEURS_SALON.filter(v => v.type !== "icp"));
    const melange = melanger(ordre);
    const zone = { minX: 4.4, maxX: 11.9, minZ: -2.6, maxZ: 3.4 };
    melange.forEach((v, i) => {
      const app = Object.assign({}, APPARENCES[(i * 3 + 1) % APPARENCES.length], { badge: true, genre: ["Elle", "She"].includes(pronomVisiteur(v)) ? "f" : "h", variante: i * 5 + 2 });
      if (v.tenue === "casual") Object.assign(app, { tenue: "casual", haut: [0x0f766e, 0x9a3412, 0x4338ca][i % 3], bas: 0x1e3a5f });
      const mesh = creerPersonnage(app);
      const pnj = ajouterPnj(mesh, 8.15, 5.0, zone, 0.9 + Math.random() * 0.3);
      mesh.visible = false;
      pnj.v = v;
      pnj.etat = "attente";
      pnj.arrivee = Math.round((i / melange.length) * 300 + aleatoire(0, 25));
      pnj.depart = pnj.arrivee + entier(100, 170);
      pnj.etiquette = creerEtiquette(mesh, (EN ? "Visitor" : "Visiteur"), 2.1, "");
      pnj.inter = ajouterInteractif({ objet: mesh, label: `aborder ${v.nom}`, action: () => aborderVisiteur(n, pnj), rayon: 1.9, actif: false, balise: false });
      n.visiteurs.push(pnj);
    });
  },
  auDemarrage(n) { ouvrirPlanMedia(n); },

  maj(n) {
    const t = jeu.minutes - jeu.debutMinutes;
    n.visiteurs.forEach(p => {
      if (p.etat === "attente" && t >= p.arrivee) {
        p.etat = "present";
        p.mesh.visible = true;
        p.mesh.position.set(8.15 + aleatoireVisuel(-0.8, 0.8), 0, 4.9);
        p.cibleForcee = { x: 8.15 + aleatoireVisuel(-2, 2), z: 2.6 };
        p.inter.actif = true;
      }
      const actif = ["present"].includes(p.etat);
      if ((actif || ["contact", "tiede", "oriente", "parti"].includes(p.etat)) && t >= p.depart && !p.sortie && jeu.focus !== p.mesh) {
        p.sortie = true;
        p.inter.actif = false;
        if (p.etat === "present") { p.etat = "parti"; if (p.v.type === "icp") manque((EN ? `${p.v.nom} (${p.v.entreprise}) left the show without being approached.` : `${p.v.nom} (${p.v.entreprise}) a quitté le salon sans être abordé.`), "organisation"); }
        p.fige = false;
        p.cibleForcee = { x: 8.15, z: 5.4, fin: q => { q.mesh.visible = false; } };
      }
      if (p.mesh.visible && p.etat === "present") {
        const d = distance(joueur, p.mesh.position);
        if (d < 4.5) {
          const effectif = p.v.effectif ? ` · ${p.v.effectif} ${EN ? "empl." : "sal."}` : "";
          majEtiquetteHTML(p.etiquette, `<span class="b-nom">${echapper(p.v.nom)}</span><span class="b-info">${echapper(p.v.fonction)} · ${echapper(p.v.entreprise)}${effectif}</span>`, "etq-badge");
        } else {
          majEtiquette(p.etiquette, (EN ? "Visitor" : "Visiteur"), "");
        }
      }
    });
  },
  tunnel: n => ({
    de: (EN ? "Unknown" : "Inconnu"), vers: "Prospect",
    etapes: [
      { label: (EN ? "Visitors at the stand" : "Visiteurs passés au stand"), court: (EN ? "visitors" : "visiteurs"), valeur: n.visiteurs.filter(v => v.etat !== "attente").length },
      { label: (EN ? "Conversations held" : "Échanges menés"), court: (EN ? "conversations" : "échanges"), valeur: n.rencontres },
      { label: (EN ? "Qualified prospects (meeting booked)" : "Prospects qualifiés (RDV fixé)"), court: "prospects", valeur: n.contacts }
    ]
  }),
  hud(n) {
    const p = n.p;
    hudJauge((EN ? "Qualified prospects at the show" : "Prospects qualifiés au salon"), (n.contacts / p.objectifContacts) * 100, `${n.contacts} / ${p.objectifContacts}`);
    const presents = n.visiteurs.filter(v => v.etat === "present").length;
    hudKpis([
      { label: (EN ? "Media plan" : "Plan média"), valeur: n.plan ? euros(n.plan.cout) : (EN ? "to build" : "à construire") },
      { label: (EN ? "Visitors at the stand" : "Visiteurs sur le stand"), valeur: `${presents}` },
      { label: (EN ? "Conversations" : "Échanges"), valeur: `${n.rencontres}` }
    ]);
  },
  panneau(n) {
    const p = n.p;
    if (!n.plan) return (EN ? `<div class="pm-vide">The visibility plan is being prepared.</div>` : `<div class="pm-vide">Le plan de visibilité est en cours de préparation.</div>`);
    let h = (EN ? `<div class="pm-section">SME Solutions breakfast · Veltis Forum · Thursday</div>` : `<div class="pm-section">Matinale Solutions PME · Forum Veltis · jeudi</div>`);
    h += (EN ? `<div class="pm-note">Get closer to read the badge. Target: <strong>companies with 20 to 250 employees</strong>, decision-makers (managing director, CFO, sales director, CIO) and influencers (sales admin, office manager).</div>` : `<div class="pm-note">Approchez-vous pour lire le badge. Cible : <strong>entreprises de 20 à 250 salariés</strong>, décideurs (dirigeant, DAF, direction commerciale, DSI) et influenceurs (ADV, office manager).</div>`);
    h += (EN ? `<div class="fiche"><div class="fiche-entete"><span class="fiche-titre">Stand results</span></div>
      <div class="chips">${chip((EN ? `Qualified prospects ${n.contacts}/${p.objectifContacts}` : `Prospects qualifiés ${n.contacts}/${p.objectifContacts}`), n.contacts >= p.objectifContacts ? "ok" : "info")}${chip((EN ? `Lukewarm contacts ${n.tiedes}` : `Contacts tièdes ${n.tiedes}`), "neutre")}${chip((EN ? `Conversations ${n.rencontres}` : `Échanges ${n.rencontres}`), "neutre")}</div></div>` : `<div class="fiche"><div class="fiche-entete"><span class="fiche-titre">Résultats du stand</span></div>
      <div class="chips">${chip((EN ? `Qualified prospects ${n.contacts}/${p.objectifContacts}` : `Prospects qualifiés ${n.contacts}/${p.objectifContacts}`), n.contacts >= p.objectifContacts ? "ok" : "info")}${chip((EN ? `Lukewarm contacts ${n.tiedes}` : `Contacts tièdes ${n.tiedes}`), "neutre")}${chip((EN ? `Conversations ${n.rencontres}` : `Échanges ${n.rencontres}`), "neutre")}</div></div>`);
    h += (EN ? `<div class="pm-section">Visibility plan · 4 weeks</div><div class="fiche">` : `<div class="pm-section">Plan de visibilité · 4 semaines</div><div class="fiche">`);
    h += `<div class="chips">${n.plan.canaux.map(k => chip(CANAUX[k].nom, CANAUX[k].erreur ? "ko" : "")).join("")}</div>`;
    h += (EN ? `<div class="fiche-ligne">Budget committed: <strong>${euros(n.plan.cout)}</strong> + stand ${euros(COUT_STAND)}</div>` : `<div class="fiche-ligne">Budget engagé : <strong>${euros(n.plan.cout)}</strong> + stand ${euros(COUT_STAND)}</div>`);
    h += `<div class="fiche-citation">${echapper(MESSAGES_CAMPAGNE[n.plan.message].texte)}</div></div>`;
    if (n.echanges.length) {
      h += (EN ? `<div class="pm-section">Latest conversations</div>` : `<div class="pm-section">Derniers échanges</div>`);
      h += n.echanges.slice(-6).reverse().map(e => `<div class="fiche terminee"><div class="fiche-entete"><span class="fiche-titre">${echapper(e.nom)}</span>${chip(e.statut, e.type)}</div><div class="fiche-ligne">${echapper(e.detail)}</div></div>`).join("");
    }
    return h;
  },
  commande() {},
  resultats(n) {
    const plan = n.plan || { canaux: [], cout: 0, message: "benefice", alea: {} };
    let impressions = IMPRESSIONS_SALON, visites = 0, visitesCible = 0;
    plan.canaux.forEach(k => {
      const c = CANAUX[k];
      const coef = c.erreur ? 1 : MESSAGES_CAMPAGNE[plan.message].coef;
      const v = c.visites * coef * (plan.alea[k] || 1);
      impressions += c.impressions;
      visites += v;
      visitesCible += v * c.icp;
    });
    const visitesSalon = 120 + n.contacts * 30 + n.tiedes * 10;
    visites += visitesSalon;
    visitesCible += visitesSalon * 0.7;
    const cout = plan.cout + COUT_STAND;
    return { impressions, visiteurs: Math.round(visites), partCible: visites ? (visitesCible / visites) * 100 : 0, cout, cpv: visites ? cout / visites : Infinity };
  },
  kpis(n) {
    const r = M1.resultats(n), p = n.p;
    return [
      { nom: (EN ? "Impressions (campaign + show)" : "Impressions (campagne + salon)"), valeur: nombre(r.impressions), cible: "—", ok: null },
      { nom: (EN ? "Visitors (website and stand)" : "Visiteurs (site et stand)"), valeur: nombre(r.visiteurs), cible: `≥ ${nombre(p.objectifVisiteurs)}`, ok: r.visiteurs >= p.objectifVisiteurs },
      { nom: (EN ? "Share of on-target visitors" : "Part de visiteurs dans la cible"), valeur: pourcent(r.partCible), cible: "≥ 62 %", ok: r.partCible >= 62 },
      { nom: (EN ? "Cost per visitor" : "Coût par visiteur"), valeur: Number.isFinite(r.cpv) ? eurosPrecis(r.cpv) : "—", cible: (EN ? "≤ €3.40 for Excellence" : "≤ 3,40 € pour Excellence"), ok: r.cpv <= 3.4 },
      { nom: (EN ? "Qualified prospects at the show" : "Prospects qualifiés au salon"), valeur: `${n.contacts}`, cible: `≥ ${p.objectifContacts}`, ok: n.contacts >= p.objectifContacts }
    ];
  },
  finTemps(n) {
    const r = M1.resultats(n), p = n.p;
    information((EN ? `End of the show. 4-week campaign results: ${nombre(r.visiteurs)} visitors.` : `Fin du salon. Bilan de la campagne sur 4 semaines : ${nombre(r.visiteurs)} visiteurs.`));
    if (r.visiteurs >= p.objectifVisiteurs && n.contacts >= p.objectifContacts) {
      const etoiles = r.cpv <= 3.4 && r.partCible >= 62 ? 3 : r.cpv <= 4.2 ? 2 : 1;
      terminerNiveau(true, etoiles, (EN ? `Your plan and your trade show generated ${nombre(r.visiteurs)} visitors for ${euros(r.cout)} invested, and ${n.contacts} qualified prospects.` : `Votre plan et votre salon ont généré ${nombre(r.visiteurs)} visiteurs pour ${euros(r.cout)} investis, et ${n.contacts} prospects qualifiés.`));
    } else {
      const raisons = [];
      if (r.visiteurs < p.objectifVisiteurs) raisons.push((EN ? `${nombre(r.visiteurs)} visitors against a target of ${nombre(p.objectifVisiteurs)}` : `${nombre(r.visiteurs)} visiteurs pour un objectif de ${nombre(p.objectifVisiteurs)}`));
      if (n.contacts < p.objectifContacts) raisons.push((EN ? `${n.contacts} qualified prospects against a target of ${p.objectifContacts}` : `${n.contacts} prospects qualifiés pour un objectif de ${p.objectifContacts}`));
      terminerNiveau(false, 0, (EN ? `Target not reached: ${raisons.join((EN ? " and " : " et "))}.` : `Objectif non atteint : ${raisons.join((EN ? " and " : " et "))}.`));
    }
  }
};

function ouvrirPlanMedia(n) {
  const p = n.p;
  const cartes = Object.entries(CANAUX).map(([k, c]) => (EN ? `
    <label class="choix-carte"><input type="checkbox" name="canal" value="${k}">
      <span class="cc-corps"><span class="cc-titre">${c.nom}</span><span class="cc-detail">${c.detail}</span>
      <span class="cc-chiffres">Cost <strong>${euros(c.cout)}</strong> · ${nombre(c.impressions)} impressions · ≈ ${nombre(c.visites)} visits · ${Math.round(c.icp * 100)}% on target</span></span>
    </label>` : `
    <label class="choix-carte"><input type="checkbox" name="canal" value="${k}">
      <span class="cc-corps"><span class="cc-titre">${c.nom}</span><span class="cc-detail">${c.detail}</span>
      <span class="cc-chiffres">Coût <strong>${euros(c.cout)}</strong> · ${nombre(c.impressions)} impressions · ≈ ${nombre(c.visites)} visites · ${Math.round(c.icp * 100)} % dans la cible</span></span>
    </label>`)).join("");
  const messages = Object.entries(MESSAGES_CAMPAGNE).map(([k, m]) => `
    <label class="choix-carte"><input type="radio" name="message" value="${k}"><span class="cc-corps"><span class="cc-titre">${m.texte}</span></span></label>`).join("");
  ouvrirFenetre({
    titre: (EN ? "This month's visibility plan" : "Plan de visibilité du mois"),
    sousTitre: (EN ? "Prospecting · budget, channels and campaign message" : "Prospection · budget, canaux et message de campagne"),
    large: true,
    fermable: false,
    corps: (EN ? `
      <p class="fen-intro">Campaign budget: <strong>${euros(p.budget)}</strong> over 4 weeks. The trade-show stand (${euros(COUT_STAND)}) has already been booked by management. Target: managing directors, finance, sales and IT departments of companies with 20 to 250 employees.</p>
      <h4>Visibility channels</h4>
      <div class="choix-grille">${cartes}</div>
      <h4>Campaign message</h4>
      <div class="choix-grille">${messages}</div>
      <div class="budget">
        <div class="budget-ligne"><span>Budget committed</span><strong id="budget-engage">€0 / ${euros(p.budget)}</strong></div>
        <div class="jauge-fond"><div id="budget-barre" class="jauge-rempli"></div></div>
        <p id="budget-alerte" class="alerte-texte cache">Budget exceeded: remove a channel.</p>
        <p class="info-texte">Visits are average market estimates; they also depend on the quality of the message.</p>
      </div>` : `
      <p class="fen-intro">Budget de la campagne : <strong>${euros(p.budget)}</strong> sur 4 semaines. Le stand du salon (${euros(COUT_STAND)}) est déjà réservé par la direction. Cible : dirigeants, directions financières, commerciales et informatiques d'entreprises de 20 à 250 salariés.</p>
      <h4>Leviers de visibilité</h4>
      <div class="choix-grille">${cartes}</div>
      <h4>Message de campagne</h4>
      <div class="choix-grille">${messages}</div>
      <div class="budget">
        <div class="budget-ligne"><span>Budget engagé</span><strong id="budget-engage">0 € / ${euros(p.budget)}</strong></div>
        <div class="jauge-fond"><div id="budget-barre" class="jauge-rempli"></div></div>
        <p id="budget-alerte" class="alerte-texte cache">Budget dépassé : retirez un levier.</p>
        <p class="info-texte">Les visites sont des estimations moyennes du marché ; elles dépendent aussi de la qualité du message.</p>
      </div>`),
    boutons: [{ label: (EN ? "Confirm the plan and open the show" : "Valider le plan et ouvrir le salon"), classe: "btn-principal", id: "btn-valider-plan", action: () => validerPlanMedia(n) }],
    onOuverture: racine => {
      lierCartesChoix(racine);
      const maj = () => {
        const cout = [...racine.querySelectorAll('input[name="canal"]:checked')].reduce((s, i) => s + CANAUX[i.value].cout, 0);
        $("budget-engage").textContent = `${euros(cout)} / ${euros(p.budget)}`;
        $("budget-barre").style.width = `${clamp((cout / p.budget) * 100, 0, 100)}%`;
        $("budget-barre").style.background = cout > p.budget ? "#b91c1c" : "";
        $("budget-alerte").classList.toggle("cache", cout <= p.budget);
        const choixMessage = racine.querySelector('input[name="message"]:checked');
        $("btn-valider-plan").disabled = cout > p.budget || cout === 0 || !choixMessage;
      };
      racine.addEventListener("change", maj);
      maj();
    }
  });
}

function validerPlanMedia(n) {
  const racine = $("fenetre-corps");
  const canaux = [...racine.querySelectorAll('input[name="canal"]:checked')].map(i => i.value);
  const choixMessage = racine.querySelector('input[name="message"]:checked').value;
  const cout = canaux.reduce((s, k) => s + CANAUX[k].cout, 0);
  const alea = {};
  canaux.forEach(k => { alea[k] = 0.93 + tirage(`canal|${k}`) * 0.14; });
  n.plan = { canaux, message: choixMessage, cout, alea };
  fermerFenetre();
  const cibles = canaux.filter(k => !CANAUX[k].erreur);
  canaux.filter(k => CANAUX[k].erreur).forEach(k => {
    const c = CANAUX[k];
    if (c.erreur === "conformite") erreur((EN ? "Email list of unknown origin: prospecting not GDPR-compliant." : "Fichier d'e-mails d'origine inconnue : prospection non conforme au RGPD."), "conformite");
    else erreur((EN ? `${c.nom}: mass-market channel, only ${Math.round(c.icp * 100)}% of visitors on target.` : `${c.nom} : canal grand public, ${Math.round(c.icp * 100)} % seulement de visiteurs dans la cible.`), "ciblage");
  });
  if (cibles.length) reussite((EN ? `Visibility plan: ${cibles.map(k => CANAUX[k].nom).join(", ")}.` : `Plan de visibilité : ${cibles.map(k => CANAUX[k].nom).join(", ")}.`), "ciblage", { silencieux: true, muet: true });
  if (choixMessage === "benefice") reussite((EN ? "Campaign message focused on customer benefit." : "Message de campagne centré sur le bénéfice client."), "argumentation", { silencieux: true, muet: true });
  else if (choixMessage === "preuve") reussite((EN ? "Message backed by verifiable social proof." : "Message appuyé sur une preuve sociale vérifiable."), "argumentation", { silencieux: true, muet: true });
  else if (choixMessage === "prix") erreur((EN ? "False campaign message: Kordis CRM is cheaper (€19). A comparative claim must be accurate." : "Message de campagne faux : Kordis CRM est moins cher (19 €). Une allégation comparative doit être exacte."), "conformite");
  else if (choixMessage === "jargon") manque((EN ? "Campaign message too technical: decision-makers don't click." : "Message de campagne trop technique : les décideurs ne cliquent pas."), "argumentation", true);
  else manque((EN ? "Superlative message without proof: it barely convinces decision-makers." : "Message superlatif sans preuve : il convainc peu les décideurs."), "argumentation", true);
  if (cout < n.p.budget * 0.6) concession((EN ? `Budget under-used (${euros(cout)} out of ${euros(n.p.budget)}).` : `Budget sous-utilisé (${euros(cout)} sur ${euros(n.p.budget)}).`), "organisation", true);
  ouvrirPanneau((EN ? "SME Solutions breakfast · Veltis Forum" : "Matinale Solutions PME · Forum Veltis"), (EN ? "Veltis stand · Thursday 9 am to 5 pm" : "Stand Veltis · jeudi de 9 h à 17 h"));
  message((EN ? "The show opens its doors. The first visitors are arriving." : "Le salon ouvre ses portes. Les premiers visiteurs arrivent."), "info");
  if (limiteAtteinte()) return;
}

function aborderVisiteur(n, p) {
  if (p.etat !== "present") return;
  const v = p.v;
  p.fige = true;
  p.cibleForcee = null;
  const inter = { nom: v.nom, fonction: v.fonction, entreprise: v.entreprise + (v.effectif ? ` (${v.effectif} ${EN ? "empl." : "sal."})` : ""), couleur: v.type === "icp" ? "#1d4ed8" : "#64748b" };
  let confiance = 50;
  const finir = (etat, texteEtiquette, classe, statut, type, detail, temps = 12) => {
    p.etat = etat;
    p.inter.actif = false;
    p.fige = false;
    n.rencontres++;
    majEtiquette(p.etiquette, texteEtiquette, classe);
    n.echanges.push({ nom: `${v.nom} · ${v.entreprise}`, statut, type, detail });
    avancerTemps(temps);
    fermerEntretien();
  };
  const conclusion = () => ouvrirEntretien({
    interlocuteur: inter, canal: (EN ? "Trade show" : "Salon"), confiance, focus: p.mesh,
    signal: (EN ? `<strong>Body language:</strong> ${pronomVisiteur(v)} looks at the demo screen and takes out their phone to make notes.` : `<strong>Non-verbal :</strong> ${pronomVisiteur(v)} regarde l'écran de démonstration et sort son téléphone pour prendre des notes.`),
    texte: (EN ? "“That's exactly our issue. How do we take this further?”" : "« C'est exactement notre sujet. Comment fait-on pour aller plus loin ? »"),
    choix: melangerChoix([
      { label: (EN ? "Scan their badge and agree on a discovery meeting next week." : "Scanner son badge et convenir d'un rendez-vous de découverte la semaine prochaine."), action: () => {
        n.contacts++;
        reussite((EN ? `${v.nom} (${v.entreprise}): badge scanned, discovery meeting booked.` : `${v.nom} (${v.entreprise}) : badge scanné, rendez-vous de découverte fixé.`), "closing");
        finir("contact", (EN ? `Qualified prospect · ${v.nom}` : `Prospect qualifié · ${v.nom}`), "etq-ok", (EN ? "Qualified prospect" : "Prospect qualifié"), "ok", (EN ? "Discovery meeting booked." : "Rendez-vous de découverte fixé."));
      } },
      { label: (EN ? "Give them your business card hoping they call you back." : "Lui donner votre carte de visite en espérant qu'il vous rappelle."), action: () => {
        n.tiedes++;
        manque((EN ? `${v.nom} (${v.entreprise}): card handed over with no dated next step.` : `${v.nom} (${v.entreprise}) : carte remise sans prochaine étape datée.`), "closing");
        finir("tiede", (EN ? `Card handed over · ${v.nom}` : `Carte remise · ${v.nom}`), "etq-attente", (EN ? "Lukewarm contact" : "Contact tiède"), "alerte", (EN ? "No next step agreed." : "Aucune prochaine étape convenue."));
      } },
      { label: (EN ? "Send them a price proposal tonight to make the most of their interest." : "Lui envoyer une proposition tarifaire dès ce soir pour profiter de son intérêt."), action: () => {
        n.tiedes++;
        manque((EN ? `${v.nom}: proposal sent without discovering their need, it will go nowhere.` : `${v.nom} : proposition envoyée sans découverte de son besoin, elle restera sans suite.`), "closing");
        finir("tiede", (EN ? `Proposal sent · ${v.nom}` : `Proposition envoyée · ${v.nom}`), "etq-attente", (EN ? "Lukewarm contact" : "Contact tiède"), "alerte", (EN ? "Premature proposal, without discovery." : "Proposition prématurée, sans découverte."));
      } },
      { label: (EN ? "Present the trade-show special: 30% off if they commit before tonight." : "Lui présenter l'offre spéciale salon : −30 % s'il s'engage avant ce soir."), action: () => {
        erreur((EN ? "30% discount beyond your authority and false urgency at the show." : "Remise de 30 % hors délégation et fausse urgence sur le salon."), "negociation");
        finir("parti", `Parti · ${v.nom}`, "etq-ko", (EN ? "Hard selling" : "Vente forcée"), "ko", (EN ? "The visitor walks away, embarrassed." : "Le visiteur s'éloigne, gêné."));
      } }
    ])
  });
  const pitch = () => {
    const roles = melangerChoix(Object.keys(PITCHS).filter(r => r !== v.role)).slice(0, 3).concat([v.role]);
    ouvrirEntretien({
      interlocuteur: inter, canal: (EN ? "Trade show" : "Salon"), confiance, focus: p.mesh,
      texte: (EN ? `${INTRO_VISITEUR[v.role]}\n\nWhich argument do you put forward?` : `${INTRO_VISITEUR[v.role]}\n\nQuel argument mettez-vous en avant ?`),
      choix: melangerChoix(roles).map(r => ({
        label: PITCHS[r],
        action: () => {
          if (r === v.role) {
            confiance += 25;
            reussite((EN ? `Argument suited to ${v.nom}'s role (${v.fonction}).` : `Argument adapté à la fonction de ${v.nom} (${v.fonction}).`), "argumentation", { silencieux: true, muet: true });
          } else {
            confiance -= 15;
            manque((EN ? `Argument off-target for a ${v.fonction.toLowerCase()}.` : `Argument décalé pour un(e) ${v.fonction.toLowerCase()}.`), "argumentation");
          }
          if (confiance >= 55) conclusion();
          else {
            ouvrirEntretien({
              interlocuteur: inter, canal: (EN ? "Trade show" : "Salon"), confiance, focus: p.mesh,
              signal: (EN ? `<strong>Body language:</strong> ${pronomVisiteur(v)} glances towards the neighbouring stand.` : `<strong>Non-verbal :</strong> ${pronomVisiteur(v)} jette un œil vers le stand voisin.`),
              texte: (EN ? "“Hmm… that's not really my concern. I'll carry on with my visit, thanks.”" : "« Hmm… ce n'est pas vraiment ma préoccupation. Je vais continuer ma visite, merci. »"),
              choix: [{ label: (EN ? "Say goodbye and move on to the next visitor" : "Le saluer et passer au visiteur suivant"), action: () => finir("parti", `Parti · ${v.nom}`, "etq-faible", (EN ? "Not convinced" : "Non convaincu"), "alerte", (EN ? "Argument not suited to their role." : "Argument non adapté à sa fonction.")) }]
            });
          }
        }
      }))
    });
  };
  const horsCible = () => {
    ouvrirEntretien({
      interlocuteur: inter, canal: (EN ? "Trade show" : "Salon"), confiance: null, focus: p.mesh,
      texte: (EN ? `${INTRO_VISITEUR[v.type]}\n\nWhat do you do?` : `${INTRO_VISITEUR[v.type]}\n\nQue faites-vous ?`),
      choix: melangerChoix(OPTIONS_HORS_CIBLE[v.type]).map(o => ({
        label: o.label,
        action: () => {
          if (o.ok) {
            reussite(o.journal, o.tag);
            finir("oriente", (EN ? `Redirected · ${v.nom}` : `Orienté · ${v.nom}`), "etq-faible", (EN ? "Out of target, redirected" : "Hors cible orienté"), "neutre", o.journal, 6);
          } else if (o.niveau === "manque") {
            manque(o.journal, o.tag);
            finir("oriente", (EN ? `Out of target · ${v.nom}` : `Hors cible · ${v.nom}`), "etq-faible", (EN ? "To review" : "À revoir"), "alerte", o.journal, 10);
          } else {
            erreur(o.journal, o.tag);
            finir("oriente", (EN ? `Out of target · ${v.nom}` : `Hors cible · ${v.nom}`), "etq-ko", (EN ? "Error" : "Erreur"), "ko", o.journal, 12 + (o.temps || 0));
          }
        }
      }))
    });
  };
  const suite = ouverte => {
    if (ouverte) confiance += 10; else confiance -= 10;
    if (v.type === "icp") pitch(); else horsCible();
  };
  ouvrirEntretien({
    interlocuteur: inter, canal: (EN ? "Trade show" : "Salon"), confiance: v.type === "icp" ? confiance : null, focus: p.mesh,
    texte: (EN ? "This visitor stops in front of your stand. How do you approach them?" : "Ce visiteur s'arrête devant votre stand. Comment l'abordez-vous ?"),
    choix: melangerChoix([
      { label: (EN ? "“Hello! Do you already know Veltis One?”" : "« Bonjour ! Vous connaissez déjà Veltis One ? »"), action: () => { manque((EN ? "Opening with a closed question: the conversation fizzles out." : "Accroche par une question fermée : l'échange tourne court."), "ecoute"); suite(false); } },
      { label: (EN ? "“Hello! What brings you to the show today?”" : "« Bonjour ! Qu'est-ce qui vous amène sur le salon aujourd'hui ? »"), action: () => { reussite((EN ? "Open opening question." : "Accroche ouverte."), "ecoute", { silencieux: true, muet: true }); suite(true); } },
      { label: (EN ? "“Hello, let me introduce Veltis One, the sales management software for SMEs!”" : "« Bonjour, je vous présente Veltis One, le logiciel de gestion commerciale des PME ! »"), action: () => { manque((EN ? "Product pitch without discovery." : "Accroche produit sans découverte."), "ecoute"); suite(false); } },
      { label: (EN ? "“I'll leave you our brochure, enjoy your visit!”" : "« Je vous laisse notre plaquette, bonne visite ! »"), action: () => {
        if (v.type === "icp") {
          manque((EN ? `Brochure handed to ${v.nom} without a conversation, despite being on target: missed opportunity.` : `Plaquette remise sans échange à ${v.nom}, pourtant dans la cible : opportunité manquée.`), "ciblage");
          finir("parti", (EN ? `Brochure handed over · ${v.nom}` : `Plaquette remise · ${v.nom}`), "etq-faible", (EN ? "Missed opportunity" : "Opportunité manquée"), "alerte", (EN ? "Target prospect allowed to walk away." : "Prospect de la cible laissé repartir."), 3);
        } else {
          reussite((EN ? `${v.nom}, out of target, redirected quickly.` : `${v.nom}, hors cible, orienté rapidement.`), "ciblage", { silencieux: true });
          finir("oriente", (EN ? `Redirected · ${v.nom}` : `Orienté · ${v.nom}`), "etq-faible", (EN ? "Out of target, redirected" : "Hors cible orienté"), "neutre", (EN ? "Conversation politely kept short." : "Échange écourté poliment."), 3);
        }
      } }
    ])
  });
}
const pronomVisiteur = v => (/^(Nathalie|Céline|Aurélie|Yasmine|Sandra|Marine)/.test(v.nom) ? (EN ? "She" : "Elle") : (EN ? "He" : "Il"));

/* ---------------------------------------------------------------------
   MISSION 2 · INTÉRÊT (rouge)
   Paramétrage du dispositif de conversion puis traitement des leads
   entrants pendant quatre jours. Mission commune aux deux profils.
   --------------------------------------------------------------------- */
const FORMULAIRES = {
  court: { nom: (EN ? "Short form · 3 fields" : "Formulaire court · 3 champs"), detail: (EN ? "Name, business email, company. More conversions, but little information to qualify." : "Nom, e-mail professionnel, entreprise. Plus de conversions, mais peu d'informations pour qualifier."), taux: 0.032, infos: false, volume: 0 },
  equilibre: { nom: (EN ? "Balanced form · 6 fields" : "Formulaire équilibré · 6 champs"), detail: (EN ? "Name, business email, company, role, headcount, phone, message." : "Nom, e-mail professionnel, entreprise, fonction, effectif, téléphone, message."), taux: 0.024, infos: true, volume: 0 },
  long: { nom: (EN ? "Full form · 12 fields" : "Formulaire complet · 12 champs"), detail: (EN ? "All the information, including budget, current tools and timing. Lots of drop-offs." : "Toutes les informations, dont budget, outils actuels et délai. Beaucoup d'abandons."), taux: 0.011, infos: true, volume: -3 }
};
const CTAS = {
  gradues: { nom: (EN ? "Graduated content" : "Contenus gradués"), detail: (EN ? "Practical guide, case study, demo webinar and meeting request depending on maturity." : "Guide pratique, étude de cas, webinaire de démonstration et demande de rendez-vous selon la maturité."), coef: 1.25 },
  demo: { nom: (EN ? "“Request a demo” only" : "« Demander une démo » uniquement"), detail: (EN ? "A single call to action on every page." : "Un seul appel à l'action sur toutes les pages."), coef: 0.7 },
  contact: { nom: (EN ? "“Contact us”" : "« Contactez-nous »"), detail: (EN ? "A generic contact form at the bottom of the page." : "Un formulaire de contact générique en bas de page."), coef: 0.6 }
};
const REPONSES_LEAD = {
  guide: { nom: (EN ? "Practical guide" : "Guide pratique"), cout: 10 },
  etude: { nom: (EN ? "Case study with figures" : "Étude de cas chiffrée"), cout: 10 },
  webinaire: { nom: (EN ? "Demo webinar invitation" : "Invitation au webinaire démo"), cout: 10 },
  appel: { nom: (EN ? "Call" : "Appeler"), cout: 20 },
  disqualifier: { nom: (EN ? "Disqualify" : "Disqualifier"), cout: 5 }
};
const BON_GESTE = { decouverte: "guide", preuves: "etude", voir: "webinaire", demo: "appel", hors: "disqualifier" };
const VISITEURS_SITE = 2400;
const COUT_CONTENUS = 3700;

const LEADS_ENTRANTS = [
  { stade: "decouverte", nom: "Camille Rey", fonction: (EN ? "Executive Assistant" : "Assistante de direction"), entreprise: "Atelier Rey", effectif: 24, secteur: (EN ? "Furniture" : "Ameublement"), source: (EN ? "Article “5 mistakes that lose quotes”" : "Article « 5 erreurs qui font perdre des devis »"), signaux: [(EN ? "1st visit" : "1re visite"), "Blog ×2", (EN ? "No product page" : "Aucune page produit")], message: (EN ? "I'd like to understand better how to organise our follow-ups." : "J'aimerais mieux comprendre comment organiser nos relances.") },
  { stade: "decouverte", nom: "Hugo Marchetti", fonction: (EN ? "Sales Manager" : "Responsable commercial"), entreprise: "Marchetti TP", effectif: 60, secteur: (EN ? "Civil engineering" : "Travaux publics"), source: (EN ? "Checklist “Choosing the right CRM”" : "Checklist « Bien choisir son CRM »"), signaux: ["Blog ×3", "Newsletter"], message: (EN ? "We're starting to think about it, no rush." : "On commence à réfléchir au sujet, sans urgence.") },
  { stade: "decouverte", nom: "Inès Caron", fonction: (EN ? "Business Development Officer" : "Chargée de développement"), entreprise: "Sowell Services", effectif: 40, secteur: (EN ? "Business services" : "Services aux entreprises"), source: (EN ? "Newsletter sign-up" : "Inscription à la newsletter"), signaux: ["Blog ×1", (EN ? "Arrived via LinkedIn" : "Arrivée via LinkedIn")], message: (EN ? "I'm reading up on sales follow-up best practices." : "Je m'informe sur les bonnes pratiques de suivi commercial.") },
  { stade: "decouverte", nom: "Paul Renaud", fonction: (EN ? "Owner-manager" : "Gérant"), entreprise: "Renaud Électricité", effectif: 32, secteur: (EN ? "Electrical contracting" : "Électricité"), source: (EN ? "Article “Following up on a quote without being pushy”" : "Article « Relancer un devis sans être insistant »"), signaux: ["Blog ×2", (EN ? "4-minute read" : "Lecture de 4 min")], message: (EN ? "Interesting article, do you have any other tips?" : "Article intéressant, avez-vous d'autres conseils ?") },
  { stade: "decouverte", nom: "Sarah Benoît", fonction: "Office manager", entreprise: "Kalia Conseil", effectif: 26, secteur: (EN ? "Consulting" : "Conseil"), source: (EN ? "Guide “Organising your sales follow-up”" : "Guide « Organiser son suivi commercial »"), signaux: ["Blog ×1", "Guide ×1"], message: (EN ? "I'm discovering the topic for our small team." : "Je découvre le sujet pour notre petite équipe.") },
  { stade: "decouverte", nom: "Mathieu Girard", fonction: (EN ? "Inside Sales Rep" : "Commercial sédentaire"), entreprise: "Distrifroid", effectif: 85, secteur: (EN ? "Industrial refrigeration" : "Froid industriel"), source: (EN ? "Blog article" : "Article de blog"), signaux: ["Blog ×4", (EN ? "No product page" : "Aucune page produit")], message: (EN ? "I'm looking for ideas to organise my days better." : "Je cherche des idées pour mieux organiser mes journées.") },
  { stade: "preuves", nom: "Isabelle Martin", fonction: (EN ? "CFO" : "DAF"), entreprise: "Orion Santé", effectif: 190, secteur: (EN ? "Healthcare" : "Santé"), source: (EN ? "White paper “The hidden cost of double entry”" : "Livre blanc « Le coût caché des ressaisies »"), signaux: [(EN ? "White paper ×1" : "Livre blanc ×1"), (EN ? "Security page ×2" : "Page Sécurité ×2"), (EN ? "Customers page ×1" : "Page Clients ×1")], message: (EN ? "Do you have figures from companies our size?" : "Avez-vous des retours chiffrés d'entreprises de notre taille ?") },
  { stade: "preuves", nom: "Frédéric Collet", fonction: (EN ? "Managing Director" : "Directeur général"), entreprise: "Collet Industries", effectif: 130, secteur: (EN ? "Metalworking" : "Métallurgie"), source: (EN ? "ROI calculator" : "Calculateur de ROI"), signaux: [(EN ? "Pricing page ×1" : "Page Tarifs ×1"), (EN ? "Customers page ×2" : "Page Clients ×2")], message: (EN ? "I want to see concrete results before going further." : "Je veux voir des résultats concrets avant d'aller plus loin.") },
  { stade: "preuves", nom: "Nadia Haddou", fonction: (EN ? "Administrative Manager" : "Responsable administrative"), entreprise: "Clinivet", effectif: 55, secteur: (EN ? "Veterinary clinics" : "Cliniques vétérinaires"), source: (EN ? "Comparison downloaded" : "Comparatif téléchargé"), signaux: [(EN ? "Comparison ×1" : "Comparatif ×1"), (EN ? "Customers page ×1" : "Page Clients ×1")], message: (EN ? "I need factual evidence to convince my business partner." : "Il me faut des éléments factuels pour convaincre mon associé.") },
  { stade: "preuves", nom: "Olivier Ferrand", fonction: (EN ? "CIO" : "DSI"), entreprise: "Ferrand Automobiles", effectif: 140, secteur: (EN ? "Car dealerships" : "Distribution automobile"), source: (EN ? "Security sheet downloaded" : "Fiche sécurité téléchargée"), signaux: [(EN ? "Security page ×3" : "Page Sécurité ×3"), (EN ? "API documentation ×1" : "Documentation API ×1")], message: (EN ? "What references do you have in our sector?" : "Quelles références avez-vous dans notre secteur ?") },
  { stade: "preuves", nom: "Julie Lambert", fonction: (EN ? "Financial Controller" : "Contrôleuse de gestion"), entreprise: "Alpes Négoce", effectif: 110, secteur: (EN ? "Wholesale trade" : "Négoce"), source: (EN ? "White paper" : "Livre blanc"), signaux: [(EN ? "Reporting page ×2" : "Page Reporting ×2"), (EN ? "Customers page ×1" : "Page Clients ×1")], message: (EN ? "What gains have your customers measured on reporting?" : "Quels gains mesurés chez vos clients sur le reporting ?") },
  { stade: "voir", nom: "Antoine Perrin", fonction: (EN ? "Sales Director" : "Directeur commercial"), entreprise: "Perrin Médical", effectif: 70, secteur: (EN ? "Medical equipment" : "Matériel médical"), source: (EN ? "Guided product tour" : "Visite guidée du produit"), signaux: [(EN ? "Product video ×2" : "Vidéo produit ×2"), (EN ? "Features page ×3" : "Page Fonctionnalités ×3")], message: (EN ? "I'd like to see what it actually looks like." : "J'aimerais voir à quoi ça ressemble concrètement.") },
  { stade: "voir", nom: "Claire Dubois", fonction: (EN ? "Sales Admin Manager" : "Responsable ADV"), entreprise: "Logipro", effectif: 90, secteur: (EN ? "Logistics" : "Logistique"), source: (EN ? "Presentation video watched in full" : "Vidéo de présentation regardée en entier"), signaux: [(EN ? "Video ×1" : "Vidéo ×1"), (EN ? "Quotes page ×2" : "Page Devis ×2")], message: (EN ? "Can we see the tool in action with my team?" : "Peut-on voir l'outil en action avec mon équipe ?") },
  { stade: "voir", nom: "Stéphane Roux", fonction: (EN ? "Head of Sales" : "Directeur des ventes"), entreprise: "Hexa Sécurité", effectif: 120, secteur: (EN ? "Private security" : "Sécurité privée"), source: (EN ? "Video demo" : "Démonstration vidéo"), signaux: [(EN ? "Mobile page ×2" : "Page Mobile ×2"), (EN ? "Video ×1" : "Vidéo ×1")], message: (EN ? "My sales reps are on the road, I want to see the mobile app." : "Mes commerciaux sont sur la route, je veux voir l'application mobile.") },
  { stade: "voir", nom: "Lina Faure", fonction: (EN ? "Managing director" : "Gérante"), entreprise: "Faure Événements", effectif: 30, secteur: (EN ? "Events" : "Événementiel"), source: (EN ? "Registered for the last webinar (did not attend)" : "Inscrite au dernier webinaire (absente)"), signaux: [(EN ? "Features page ×2" : "Page Fonctionnalités ×2"), (EN ? "Replay not watched" : "Replay non vu")], message: (EN ? "I couldn't attend the last webinar." : "Je n'ai pas pu assister au dernier webinaire.") },
  { stade: "demo", nom: "Vincent Lefèvre", fonction: (EN ? "Managing Director" : "Directeur général"), entreprise: "Lefèvre Bâtiment", effectif: 95, secteur: "BTP", source: (EN ? "“Request a demo” form" : "Formulaire « Demander une démonstration »"), signaux: [(EN ? "Pricing page ×3" : "Page Tarifs ×3"), (EN ? "Comparison ×1" : "Comparatif ×1"), (EN ? "Demo form" : "Formulaire démo")], message: (EN ? "We need to choose a tool by the end of the month." : "Nous devons choisir un outil d'ici la fin du mois.") },
  { stade: "demo", nom: "Agnès Rivière", fonction: (EN ? "CFO" : "DAF"), entreprise: "Sanova", effectif: 150, secteur: (EN ? "Healthcare" : "Santé"), source: (EN ? "Quote request" : "Demande de chiffrage"), signaux: [(EN ? "Pricing page ×4" : "Page Tarifs ×4"), (EN ? "Invoicing page ×2" : "Page Facturation ×2")], message: (EN ? "Could you call me back for a quote?" : "Pouvez-vous me rappeler pour un chiffrage ?") },
  { stade: "demo", nom: "Benoît Charpentier", fonction: (EN ? "Sales Director" : "Directeur commercial"), entreprise: "Charpentier Industrie", effectif: 210, secteur: (EN ? "Industry" : "Industrie"), source: (EN ? "“Request a demo” form" : "Formulaire « Demander une démonstration »"), signaux: [(EN ? "Pricing page ×2" : "Page Tarifs ×2"), (EN ? "Integrations page ×2" : "Page Intégrations ×2")], message: (EN ? "Our current contract ends in two months." : "Notre contrat actuel se termine dans deux mois.") },
  { stade: "demo", nom: "Émilie Gauthier", fonction: (EN ? "Managing director" : "Gérante"), entreprise: "Gauthier Paysages", effectif: 45, secteur: (EN ? "Landscaping" : "Paysagisme"), source: (EN ? "Live chat" : "Chat en ligne"), signaux: [(EN ? "Mobile page ×2" : "Page Mobile ×2"), (EN ? "Pricing page ×1" : "Page Tarifs ×1"), "Chat"], message: (EN ? "I want a meeting quickly for my field teams." : "Je veux un rendez-vous rapidement pour mes équipes terrain.") },
  { stade: "demo", nom: "Rémi Blanchard", fonction: (EN ? "Sales Manager" : "Responsable des ventes"), entreprise: "Ovalis Distribution", effectif: 75, secteur: "Distribution", source: (EN ? "“Request a demo” form" : "Formulaire « Demander une démonstration »"), signaux: [(EN ? "Pricing page ×2" : "Page Tarifs ×2"), (EN ? "Case study ×1" : "Étude de cas ×1")], message: (EN ? "Available this week for a demo." : "Disponible cette semaine pour une démonstration.") },
  { stade: "hors", motif: (EN ? "student" : "étudiant"), nom: "Théo Martin", fonction: (EN ? "Student" : "Étudiant"), entreprise: (EN ? "University business school" : "IUT Techniques de commercialisation"), effectif: null, secteur: (EN ? "Education" : "Enseignement"), source: (EN ? "White paper" : "Livre blanc"), signaux: ["Blog ×1"], message: (EN ? "It's for my final-year dissertation." : "C'est pour mon mémoire de fin d'études.") },
  { stade: "hors", motif: "concurrent", nom: "Laura Vincent", fonction: (EN ? "Market watch analyst" : "Chargée de veille"), entreprise: "Kordis Solutions", effectif: 60, secteur: (EN ? "Software publisher" : "Éditeur de logiciels"), source: (EN ? "“Request a demo” form" : "Formulaire « Demander une démonstration »"), signaux: [(EN ? "Pricing page ×5" : "Page Tarifs ×5"), (EN ? "API documentation ×3" : "Documentation API ×3")], message: (EN ? "Please send me your full price list." : "Merci de m'envoyer votre grille tarifaire complète.") },
  { stade: "hors", motif: (EN ? "freelancer" : "indépendant"), nom: "Yann Le Goff", fonction: "Auto-entrepreneur", entreprise: "Le Goff Dépannage", effectif: 1, secteur: (EN ? "Repair services" : "Dépannage"), source: (EN ? "Quote request" : "Demande de devis"), signaux: [(EN ? "Pricing page ×1" : "Page Tarifs ×1")], message: (EN ? "I'm looking for free software to do three quotes a month." : "Je cherche un logiciel gratuit pour faire trois devis par mois.") },
  { stade: "hors", motif: "candidat", nom: "Sébastien Hamon", fonction: "Commercial (candidat)", entreprise: (EN ? "Private individual" : "Particulier"), effectif: null, secteur: "—", source: (EN ? "Contact form" : "Formulaire de contact"), signaux: [(EN ? "Careers page ×2" : "Page Carrières ×2")], message: (EN ? "I'd like to apply to Veltis." : "Je souhaite postuler chez Veltis.") }
];

const M2 = {
  id: "interet", phase: (EN ? "Lead capture" : "Captation"), couleur: "#0e7490", texteCouleur: "#ffffff",
  transition: ["Prospect", "Lead"],
  objectifTableau: (EN ? "Turn prospects into engaged leads" : "Transformer les prospects en leads engagés"),
  activitesTableau: (EN ? "Forms, content, webinars, fast call-back" : "Formulaires, contenus, webinaires, rappel rapide"),
  kpiTableau: (EN ? "Qualified leads, lead → meeting rate, call-back time, CPL" : "Leads qualifiés, taux lead → RDV, délai de rappel, CPL"),
  reflexeRequin: (EN ? "Calling everyone to “push” a proposal, even those barely discovering the topic: they unsubscribe and never become leads. To convert, nurture each prospect with content matched to their maturity and call back those who are ready without delay." : "Appeler tout le monde pour « placer » une proposition, même ceux qui découvrent à peine le sujet : ils se désabonnent et ne deviennent jamais des leads. Pour convertir, nourrissez chaque prospect avec le contenu adapté à sa maturité et rappelez sans délai ceux qui sont prêts."),
  mode: { terrain: (EN ? "Inbound leads" : "Leads entrants"), sedentaire: (EN ? "Inbound leads" : "Leads entrants") },
  titre: (EN ? "Turn prospects into leads" : "Transformer les prospects en leads"),
  contexte: (EN ? "This month's campaign brought 2,400 visitors to the Veltis website. Léa Chevalier, Marketing Manager, asks you to set up the conversion system and then handle inbound leads, from Monday to Thursday." : "La campagne du mois a amené 2 400 visiteurs sur le site Veltis. Léa Chevalier, responsable marketing, vous demande de paramétrer le dispositif de conversion puis de prendre en charge les leads entrants, du lundi au jeudi."),
  objectifBusiness: (EN ? "Second stage of the funnel: turn prospects into leads, i.e. identified and engaged contacts, without burning those who aren't ready yet. Key activities: content, white papers, webinars, forms. KPIs: number of leads, cost per lead (CPL), visitor → lead conversion rate." : "Deuxième étage du tunnel : transformer les prospects en leads, c'est-à-dire en contacts identifiés et engagés, sans brûler ceux qui ne sont pas encore prêts. Activités clés : contenus, livres blancs, webinaires, formulaires. Indicateurs : nombre de leads, coût par lead (CPL), taux de conversion visiteur → lead."),
  params: {
    standard: { objectif: 8, sla: 120, volume: { decouverte: 4, preuves: 3, voir: 2, demo: 3, hors: 2 } },
    confirme: { objectif: 10, sla: 60, volume: { decouverte: 4, preuves: 3, voir: 3, demo: 4, hors: 2 } }
  },
  periode: () => ({ debut: 0, fin: 4 * JOURNEE, rythme: 5.5, affichage: "jour" }),
  depart: () => ({ x: POINT_POSTE.x, z: POINT_POSTE.z, angle: Math.PI }),
  mission: p => (EN ? `Set up the conversion system, then qualify at least ${p.objectif} inbound leads by Thursday evening, calling back every demo request within ${p.sla / 60} business hour${p.sla > 60 ? "s" : ""}.` : `Paramétrez le dispositif de conversion, puis qualifiez au moins ${p.objectif} leads entrants d'ici jeudi soir, en rappelant chaque demande de démonstration sous ${p.sla / 60} h ouvrée${p.sla > 60 ? "s" : ""}.`),
  consignes: p => [
    (EN ? "Set-up: choose the form length and the type of calls to action on the website." : "Paramétrage : choisissez la longueur du formulaire et le type d'appels à l'action du site."),
    (EN ? "Leads arrive in your CRM (right-hand panel). Analyse the source, pages viewed and message to estimate their maturity." : "Les leads arrivent dans votre CRM (panneau de droite). Analysez la source, les pages consultées et le message pour estimer la maturité."),
    (EN ? "Discovery → practical guide · Needs proof → case study with figures · Wants to see the product → demo webinar · Project close to decision → call to book a meeting · Out of target → disqualify." : "Découverte → guide pratique · Besoin de preuves → étude de cas chiffrée · Envie de voir le produit → webinaire de démonstration · Projet proche de la décision → appel pour un rendez-vous · Hors cible → disqualification."),
    (EN ? `A demo request not called back within ${p.sla / 60} business hour${p.sla > 60 ? "s" : ""} is lost. A lead not handled within 24 business hours goes cold.` : `Une demande de démonstration non rappelée sous ${p.sla / 60} h ouvrée${p.sla > 60 ? "s" : ""} est perdue. Un lead non traité sous 24 h ouvrées refroidit.`),
    (EN ? "Léa (marketing) can give you pointers on reading the signals." : "Léa (marketing) peut vous donner des repères de lecture des signaux.")
  ],
  profilNote: () => (EN ? "Mission shared by field and inside sales profiles: everyone handles their inbound leads from the CRM, at the office or on the move." : "Mission commune aux profils terrain et sédentaire : chacun traite ses leads entrants depuis le CRM, au bureau ou en mobilité."),
  criteres: p => [
    (EN ? `Success: at least ${p.objectif} qualified leads by Thursday 6 pm.` : `Réussite : au moins ${p.objectif} leads qualifiés d'ici jeudi 18 h.`),
    (EN ? "Excellence: visitor → lead conversion rate ≥ 2.5%, all demo requests called back on time and turned into meetings · Proficient: conversion rate ≥ 2%." : "Excellence : taux de conversion visiteur → lead ≥ 2,5 %, toutes les demandes de démonstration rappelées à temps et transformées en rendez-vous · Maîtrise : taux de conversion ≥ 2 %."),
    (EN ? "Errors: out-of-target contact treated as a prospect, prospect wrongly disqualified, demo request not called back on time or not converted, premature sales call." : "Erreurs : contact hors cible traité comme un prospect, prospect disqualifié à tort, demande de démonstration non rappelée à temps ou non transformée, appel commercial prématuré.")
  ],
  aRetenir: (EN ? "A visitor becomes a lead when offered the right content at the right time. The form trades off volume against information quality; behavioural signals (pages viewed, content downloaded) reveal maturity. Demo requests must be called back fast: responsiveness is a competitive advantage." : "Un visiteur devient un lead quand on lui propose le bon contenu au bon moment. Le formulaire arbitre entre volume et qualité d'information ; les signaux de comportement (pages vues, contenus téléchargés) révèlent la maturité. Les demandes de démonstration se rappellent vite : la réactivité est un avantage concurrentiel."),
  conseilEchec: (EN ? "Read the signals: blog and guides = discovery; Customers, Security and comparison pages = need for proof; videos and features = wants to see; repeated Pricing pages and demo form = decision is close. Call the latter back immediately." : "Lisez les signaux : blog et guides = découverte ; pages Clients, Sécurité, comparatifs = besoin de preuves ; vidéos et fonctionnalités = envie de voir ; pages Tarifs répétées et formulaire de démonstration = décision proche. Rappelez ces derniers immédiatement."),

  demarrer(n, p) {
    Object.assign(n, { p, form: null, cta: null, leads: [], qualifies: 0, rdv: 0, delais: [], conseilLea: false, leadsGeneres: 0 });
    activerCollegue("marketing", (EN ? "ask Léa for pointers" : "demander des repères à Léa"), () => conseilLea(n));
  },
  auDemarrage(n) { ouvrirParametrage(n); },
  ciblesCarte: () => [],
  maj(n) {
    const t = jeu.minutes - jeu.debutMinutes;
    n.leads.forEach(l => {
      if (l.etat === "attente" && t >= l.arrivee) {
        l.etat = "nouveau";
        son("notif");
        message((EN ? `New lead · ${l.entreprise} — ${l.source}` : `Nouveau lead · ${l.entreprise} — ${l.source}`), "info", 2600);
      }
      if (l.etat !== "nouveau") return;
      const age = t - l.arrivee;
      if (l.stade === "demo" && age > n.p.sla) {
        l.etat = "perdu";
        l.resultat = (EN ? "Call-back time exceeded" : "Délai de rappel dépassé");
        erreur((EN ? `Demo request from ${l.entreprise} not called back within ${n.p.sla / 60} h: the prospect booked a meeting with a competitor.` : `Demande de démonstration de ${l.entreprise} non rappelée sous ${n.p.sla / 60} h : le prospect a pris rendez-vous avec un concurrent.`), "organisation");
      } else if (l.stade !== "demo" && age > JOURNEE) {
        l.etat = "refroidi";
        l.resultat = (EN ? "Not handled within 24 h" : "Non traité sous 24 h");
        manque((EN ? `${l.entreprise}: lead not handled within 24 business hours, it's going cold.` : `${l.entreprise} : lead non traité sous 24 h ouvrées, il refroidit.`), "organisation");
      }
    });
  },
  tunnel: n => ({
    de: "Prospect", vers: "Lead",
    etapes: [
      { label: (EN ? "Inbound prospects (forms)" : "Prospects entrants (formulaires)"), court: (EN ? "inbound" : "entrants"), valeur: n.leads.filter(l => l.etat !== "attente").length },
      { label: (EN ? "Qualified leads" : "Leads qualifiés"), court: "leads", valeur: n.qualifies },
      { label: (EN ? "Leads committed to a meeting" : "Leads engagés en rendez-vous"), court: (EN ? "meetings" : "RDV"), valeur: n.rdv }
    ]
  }),
  hud(n) {
    const p = n.p;
    hudJauge((EN ? "Qualified leads" : "Leads qualifiés"), (n.qualifies / p.objectif) * 100, `${n.qualifies} / ${p.objectif}`);
    const enAttente = n.leads.filter(l => l.etat === "nouveau").length;
    const delai = n.delais.length ? n.delais.reduce((a, b) => a + b, 0) / n.delais.length : null;
    hudKpis([
      { label: (EN ? "To handle" : "À traiter"), valeur: `${enAttente}`, alerte: enAttente >= 4 },
      { label: (EN ? "Meetings booked" : "RDV obtenus"), valeur: `${n.rdv}` },
      { label: (EN ? "Average call-back time" : "Délai moyen de rappel"), valeur: delai === null ? "—" : dureeTexte(delai) }
    ]);
  },
  panneau(n) {
    if (!n.form) return (EN ? `<div class="pm-vide">Setting up the conversion system.</div>` : `<div class="pm-vide">Paramétrage du dispositif de conversion en cours.</div>`);
    const t = jeu.minutes - jeu.debutMinutes;
    const nouveaux = n.leads.filter(l => l.etat === "nouveau").sort((a, b) => a.arrivee - b.arrivee);
    const traites = n.leads.filter(l => ["traite", "perdu", "refroidi", "disqualifie"].includes(l.etat));
    let h = (EN ? `<div class="pm-note">Form: <strong>${FORMULAIRES[n.form].nom}</strong> · Calls to action: <strong>${CTAS[n.cta].nom}</strong></div>` : `<div class="pm-note">Formulaire : <strong>${FORMULAIRES[n.form].nom}</strong> · Appels à l'action : <strong>${CTAS[n.cta].nom}</strong></div>`);
    h += (EN ? `<div class="pm-section">Leads to handle (${nouveaux.length})</div>` : `<div class="pm-section">Leads à traiter (${nouveaux.length})</div>`);
    if (!nouveaux.length) h += (EN ? `<div class="pm-vide">No leads waiting. New leads will appear here.</div>` : `<div class="pm-vide">Aucun lead en attente. Les nouveaux leads s'afficheront ici.</div>`);
    nouveaux.forEach(l => {
      const age = t - l.arrivee;
      const infos = FORMULAIRES[n.form].infos;
      const contact = infos ? `${l.nom} · ${l.fonction}` : (EN ? `${l.nom} · role not provided` : `${l.nom} · fonction non renseignée`);
      const taille = infos ? `${l.secteur}${l.effectif ? ` · ${l.effectif} ${EN ? "empl." : "sal."}` : ""}` : (EN ? "Industry and headcount not provided" : "Secteur et effectif non renseignés");
      h += `<div class="fiche${age > 90 ? " prioritaire" : ""}">
        <div class="fiche-entete"><span class="fiche-titre">${echapper(l.entreprise)}</span><span class="fiche-age${age > 90 ? " urgent" : ""}">${ageTexte(age)}</span></div>
        <div class="fiche-ligne"><strong>${echapper(contact)}</strong></div>
        <div class="fiche-ligne">${echapper(taille)}</div>
        <div class="fiche-ligne">Source : ${echapper(l.source)}</div>
        <div class="chips">${l.signaux.map(s => chip(s)).join("")}</div>
        ${infos ? `<div class="fiche-citation">${guillemets(echapper(l.message))}</div>` : ""}
        <div class="pm-actions">
          ${boutonPm("Guide", "repondre", l.id, { val: "guide" })}
          ${boutonPm((EN ? "Case study" : "Étude de cas"), "repondre", l.id, { val: "etude" })}
          ${boutonPm((EN ? "Webinar" : "Webinaire"), "repondre", l.id, { val: "webinaire" })}
          ${boutonPm((EN ? "Call" : "Appeler"), "repondre", l.id, { val: "appel", principal: true })}
          ${boutonPm((EN ? "Disqualify" : "Disqualifier"), "repondre", l.id, { val: "disqualifier" })}
        </div></div>`;
    });
    if (traites.length) {
      h += (EN ? `<div class="pm-section">Handled (${traites.length})</div>` : `<div class="pm-section">Traités (${traites.length})</div>`);
      traites.slice().reverse().forEach(l => {
        const type = l.etat === "traite" ? "ok" : l.etat === "disqualifie" ? "neutre" : "ko";
        h += `<div class="fiche terminee"><div class="fiche-entete"><span class="fiche-titre">${echapper(l.entreprise)}</span>${chip(l.resultat, type)}</div></div>`;
      });
    }
    return h;
  },
  commande(n, cmd, id, val) {
    if (cmd !== "repondre") return;
    const l = n.leads.find(x => x.id === id);
    if (!l || l.etat !== "nouveau") return;
    traiterLead(n, l, val);
  },
  calculs(n) {
    const conversion = n.leadsGeneres / VISITEURS_SITE * 100;
    const cpl = n.leadsGeneres ? COUT_CONTENUS / n.leadsGeneres : Infinity;
    const delai = n.delais.length ? n.delais.reduce((a, b) => a + b, 0) / n.delais.length : null;
    const demos = n.leads.filter(l => l.stade === "demo" && l.etat !== "attente");
    return { conversion, cpl, delai, demos };
  },
  kpis(n) {
    const r = M2.calculs(n), p = n.p;
    return [
      { nom: (EN ? "Number of leads generated (forms filled in)" : "Nombre de leads générés (formulaires remplis)"), valeur: nombre(n.leadsGeneres), cible: "—", ok: null },
      { nom: (EN ? "Visitor → lead conversion rate" : "Taux de conversion visiteur → lead"), valeur: pourcentPrecis(r.conversion), cible: (EN ? "≥ 2.5% for Excellence" : "≥ 2,5 % pour Excellence"), ok: r.conversion >= 2.5 },
      { nom: (EN ? "Cost per lead (CPL)" : "Coût par lead (CPL)"), valeur: Number.isFinite(r.cpl) ? euros(r.cpl) : "—", cible: "≤ 60 €", ok: r.cpl <= 60 },
      { nom: (EN ? "Leads qualified by the sales rep" : "Leads qualifiés par le commercial"), valeur: `${n.qualifies}`, cible: `≥ ${p.objectif}`, ok: n.qualifies >= p.objectif },
      { nom: (EN ? "Average call-back time for demo requests" : "Délai moyen de rappel des demandes de démo"), valeur: r.delai === null ? "—" : dureeTexte(r.delai), cible: `≤ ${p.sla / 60} h`, ok: r.delai !== null && r.delai <= p.sla },
      { nom: (EN ? "Meetings booked" : "Rendez-vous obtenus"), valeur: `${n.rdv}`, cible: (EN ? `${r.demos.length} demo request(s)` : `${r.demos.length} demande(s) de démo`), ok: n.rdv >= r.demos.length && r.demos.length > 0 }
    ];
  },
  finTemps(n) {
    const r = M2.calculs(n), p = n.p;
    if (n.qualifies >= p.objectif) {
      const toutesDemos = r.demos.length > 0 && r.demos.every(l => l.etat === "traite" && l.rdv);
      const etoiles = r.conversion >= 2.5 && toutesDemos ? 3 : r.conversion >= 2 ? 2 : 1;
      terminerNiveau(true, etoiles, (EN ? `${n.qualifies} qualified leads and ${n.rdv} meetings booked. Website conversion rate: ${pourcentPrecis(r.conversion)}.` : `${n.qualifies} leads qualifiés et ${n.rdv} rendez-vous obtenus. Taux de conversion du site : ${pourcentPrecis(r.conversion)}.`));
    } else {
      terminerNiveau(false, 0, (EN ? `${n.qualifies} qualified leads by Thursday evening, against a target of ${p.objectif}.` : `${n.qualifies} leads qualifiés d'ici jeudi soir, pour un objectif de ${p.objectif}.`));
    }
  }
};

function ouvrirParametrage(n) {
  const forms = Object.entries(FORMULAIRES).map(([k, f]) => (EN ? `
    <label class="choix-carte"><input type="radio" name="form" value="${k}"><span class="cc-corps"><span class="cc-titre">${f.nom}</span><span class="cc-detail">${f.detail}</span><span class="cc-chiffres">Observed completion rate: <strong>${pourcentPrecis(f.taux * 100)}</strong></span></span></label>` : `
    <label class="choix-carte"><input type="radio" name="form" value="${k}"><span class="cc-corps"><span class="cc-titre">${f.nom}</span><span class="cc-detail">${f.detail}</span><span class="cc-chiffres">Taux de remplissage observé : <strong>${pourcentPrecis(f.taux * 100)}</strong></span></span></label>`)).join("");
  const ctas = Object.entries(CTAS).map(([k, c]) => `
    <label class="choix-carte"><input type="radio" name="cta" value="${k}"><span class="cc-corps"><span class="cc-titre">${c.nom}</span><span class="cc-detail">${c.detail}</span></span></label>`).join("");
  ouvrirFenetre({
    titre: (EN ? "Conversion system set-up" : "Paramétrage du dispositif de conversion"),
    sousTitre: (EN ? "Lead capture · website forms and calls to action" : "Intérêt · formulaires et appels à l'action du site"),
    large: true,
    fermable: false,
    corps: (EN ? `
      <p class="fen-intro">${nombre(VISITEURS_SITE)} visitors are expected on the website this month. Content production budget (guide, white paper, case study, webinar): ${euros(COUT_CONTENUS)}.</p>
      <h4>Download form</h4><div class="choix-grille trois">${forms}</div>
      <h4>Website calls to action</h4><div class="choix-grille trois">${ctas}</div>` : `
      <p class="fen-intro">${nombre(VISITEURS_SITE)} visiteurs sont attendus sur le site ce mois-ci. Budget de production des contenus (guide, livre blanc, étude de cas, webinaire) : ${euros(COUT_CONTENUS)}.</p>
      <h4>Formulaire de téléchargement</h4><div class="choix-grille trois">${forms}</div>
      <h4>Appels à l'action du site</h4><div class="choix-grille trois">${ctas}</div>`),
    boutons: [{ label: (EN ? "Confirm and open the CRM" : "Valider et ouvrir le CRM"), classe: "btn-principal", id: "btn-valider-param", action: () => validerParametrage(n) }],
    onOuverture: racine => {
      lierCartesChoix(racine);
      const maj = () => { $("btn-valider-param").disabled = !(racine.querySelector('input[name="form"]:checked') && racine.querySelector('input[name="cta"]:checked')); };
      racine.addEventListener("change", maj);
      maj();
    }
  });
}

function validerParametrage(n) {
  const racine = $("fenetre-corps");
  n.form = racine.querySelector('input[name="form"]:checked').value;
  n.cta = racine.querySelector('input[name="cta"]:checked').value;
  fermerFenetre();
  const f = FORMULAIRES[n.form], c = CTAS[n.cta];
  n.leadsGeneres = Math.round(VISITEURS_SITE * f.taux * c.coef);
  if (n.form === "equilibre") reussite((EN ? "Balanced form: good compromise between volume and qualification." : "Formulaire équilibré : bon compromis entre volume et qualification."), "ciblage", { silencieux: true, muet: true });
  else if (n.form === "court") concession((EN ? "Short form: more leads, but little information to qualify them." : "Formulaire court : plus de leads, mais peu d'informations pour les qualifier."), "ciblage", true);
  else manque((EN ? "12-field form: lots of drop-offs, few leads." : "Formulaire de 12 champs : beaucoup d'abandons, peu de leads."), "ciblage", true);
  if (n.cta === "gradues") reussite((EN ? "Graduated content: every visitor finds an entry point suited to their maturity." : "Contenus gradués : chaque visiteur trouve une porte d'entrée adaptée à sa maturité."), "argumentation", { silencieux: true, muet: true });
  else manque((EN ? "Single call to action: visitors discovering the topic leave without leaving their details." : "Un seul appel à l'action : les visiteurs qui découvrent le sujet repartent sans laisser leurs coordonnées."), "argumentation", true);

  // Construction de la file de leads
  const v = n.p.volume;
  const choisis = [];
  Object.entries(v).forEach(([stade, nb]) => {
    let k = nb;
    if (f.volume < 0 && stade !== "demo" && stade !== "hors") k = Math.max(1, nb - 1);
    choisis.push(...melanger(LEADS_ENTRANTS.filter(l => l.stade === stade)).slice(0, k));
  });
  const ordre = melanger(choisis);
  const fin = 4 * JOURNEE - 360;
  const instants = ordre.map((l, i) => Math.round(15 + (i / ordre.length) * fin + aleatoire(0, fin / ordre.length * 0.8))).sort((a, b) => a - b);
  n.leads = ordre.map((l, i) => Object.assign({}, l, { id: `L${i}`, arrivee: instants[i], etat: "attente", resultat: "" }));
  ouvrirPanneau((EN ? "CRM · Inbound leads" : "CRM · Leads entrants"), (EN ? "Monday 9 am to Thursday 6 pm" : "Du lundi 9 h au jeudi 18 h"));
  message((EN ? "The CRM is open: the first leads are about to arrive." : "Le CRM est ouvert : les premiers leads vont arriver."), "info");
}

function conseilLea(n, confirme = false) {
  const inter = interlocuteurCollegue("marketing");
  if (!n.conseilLea && !confirme) {
    ouvrirEntretien({ interlocuteur: inter, canal: (EN ? "Sales floor" : "Plateau"), texte: (EN ? "“Do you want my pointers for reading lead signals?”\n\nUsing help costs 3 points on the mission score." : "« Tu veux mes repères pour lire les signaux des leads ? »\n\nUtiliser une aide coûte 3 points au score de la mission."), choix: [
      { label: (EN ? "Yes, I'll take Léa's advice (−3 points)" : "Oui, je prends les conseils de Léa (−3 points)"), action: () => conseilLea(n, true) },
      { label: (EN ? "No thanks, I'll manage" : "Non merci, je me débrouille"), action: fermerEntretien }
    ] });
    return;
  }
  if (n.conseilLea) {
    ouvrirEntretien({ interlocuteur: inter, canal: (EN ? "Sales floor" : "Plateau"), texte: (EN ? "“I gave you my pointers this morning. Trust the behavioural signals, they're reliable.”" : "« Je t'ai donné mes repères ce matin. Fie-toi aux signaux de comportement, ils sont fiables. »"), choix: [{ label: (EN ? "Thanks" : "Merci"), action: fermerEntretien }] });
    return;
  }
  n.conseilLea = true;
  avancerTemps(15);
  aideUtilisee((EN ? "Léa's (marketing) pointers on reading signals" : "repères de Léa (marketing) sur la lecture des signaux"));
  ouvrirEntretien({
    interlocuteur: inter, canal: (EN ? "Sales floor" : "Plateau"),
    texte: (EN ? "“Here's what we see on our leads:\n• Blog, guides and newsletter: they're discovering the topic, a practical guide is enough.\n• Customers, Security, comparison pages, ROI calculator: they want proof, send a case study with figures.\n• Videos and Features pages: they want to see the product, invite them to the webinar.\n• Repeated Pricing pages, demo form, chat: they're close to a decision, call them right away.\n• And watch out for competitors, students and job applicants filling in our forms.”" : "« Voilà ce qu'on observe sur nos leads :\n• Blog, guides et newsletter : ils découvrent le sujet, un guide pratique suffit.\n• Pages Clients, Sécurité, comparatifs, calculateur de ROI : ils veulent des preuves, envoie une étude de cas chiffrée.\n• Vidéos et pages Fonctionnalités : ils veulent voir le produit, invite-les au webinaire.\n• Pages Tarifs répétées, formulaire de démo, chat : ils sont proches de la décision, appelle-les tout de suite.\n• Et méfie-toi des concurrents, étudiants et candidats qui remplissent nos formulaires. »"),
    choix: [{ label: (EN ? "Thanks Léa, that's very clear" : "Merci Léa, c'est très clair"), action: fermerEntretien }]
  });
}

function traiterLead(n, l, action) {
  const t = jeu.minutes - jeu.debutMinutes;
  const bon = BON_GESTE[l.stade];
  avancerTemps(REPONSES_LEAD[action].cout);
  const conclure = (etat, resultat) => { l.etat = etat; l.resultat = resultat; };
  if (action === "appel") {
    if (l.stade === "demo") { appelLeadChaud(n, l, t - l.arrivee); return; }
    if (l.stade === "hors") {
      conclure("perdu", (EN ? "Out-of-target call" : "Appel hors cible"));
      erreur((EN ? `Sales call to ${l.nom} (${l.entreprise}), out of target (${l.motif}).` : `Appel commercial à ${l.nom} (${l.entreprise}), hors cible (${l.motif}).`), "ciblage");
      return;
    }
    if (l.stade === "decouverte") {
      conclure("perdu", (EN ? "Premature call" : "Appel prématuré"));
      erreur((EN ? `Premature sales call: ${l.nom} was only discovering the topic and unsubscribes.` : `Appel commercial prématuré : ${l.nom} ne faisait que découvrir le sujet et se désabonne.`), "ecoute");
      return;
    }
    n.qualifies++;
    conclure("traite", (EN ? "Qualified (call a bit early)" : "Qualifié (appel un peu tôt)"));
    concession((EN ? `${l.nom} agrees to receive ${REPONSES_LEAD[bon].nom.toLowerCase()}, but the call was premature.` : `${l.nom} accepte de recevoir ${REPONSES_LEAD[bon].nom.toLowerCase()}, mais l'appel était prématuré.`), "ecoute");
    return;
  }
  if (action === "disqualifier") {
    if (l.stade === "hors") {
      conclure("disqualifie", (EN ? "Rightly disqualified" : "Disqualifié à juste titre"));
      reussite((EN ? `${l.entreprise} disqualified (${l.motif}).` : `${l.entreprise} disqualifié (${l.motif}).`), "ciblage");
    } else {
      conclure("perdu", (EN ? "Wrongly disqualified" : "Disqualifié à tort"));
      erreur((EN ? `${l.nom} (${l.entreprise}) wrongly disqualified: they were a target prospect.` : `${l.nom} (${l.entreprise}) disqualifié à tort : c'était un prospect de la cible.`), "ciblage");
    }
    return;
  }
  // Envoi d'un contenu
  if (l.stade === "hors") {
    conclure("perdu", (EN ? "Out-of-target nurtured" : "Hors cible nourri"));
    erreur((EN ? `${l.entreprise} (${l.motif}) added to the prospect journey: the pipeline is polluted.` : `${l.entreprise} (${l.motif}) intégré au parcours prospect : le pipeline est pollué.`), "ciblage");
    return;
  }
  if (l.stade === "demo") {
    conclure("perdu", (EN ? "Was expecting a call" : "Attendait un appel"));
    erreur((EN ? `${l.nom} was asking for a meeting: just sending content isn't enough, the prospect turns to a competitor.` : `${l.nom} demandait un rendez-vous : un simple envoi de contenu ne suffit pas, le prospect se tourne vers un concurrent.`), "closing");
    return;
  }
  if (action === bon) {
    n.qualifies++;
    conclure("traite", (EN ? `Qualified · ${REPONSES_LEAD[action].nom}` : `Qualifié · ${REPONSES_LEAD[action].nom}`));
    reussite((EN ? `${l.nom} (${l.entreprise}): suitable ${REPONSES_LEAD[action].nom.toLowerCase()}, lead qualified.` : `${l.nom} (${l.entreprise}) : ${REPONSES_LEAD[action].nom.toLowerCase()} adapté, lead qualifié.`), "ecoute");
  } else {
    conclure("perdu", (EN ? "Unsuitable content" : "Contenu inadapté"));
    manque((EN ? `${l.nom} (${l.entreprise}): ${REPONSES_LEAD[action].nom.toLowerCase()} sent, ${REPONSES_LEAD[bon].nom.toLowerCase()} expected. The lead does not convert.` : `${l.nom} (${l.entreprise}) : ${REPONSES_LEAD[action].nom.toLowerCase()} envoyé, ${REPONSES_LEAD[bon].nom.toLowerCase()} attendu. Le lead ne convertit pas.`), "ecoute");
  }
}

function appelLeadChaud(n, l, delai) {
  const prenom = l.nom.split(" ")[0];
  const inter = { nom: l.nom, fonction: l.fonction, entreprise: l.entreprise, couleur: "#dc2626" };
  let confiance = 60;
  n.delais.push(delai);
  const rendezVous = texteIntro => ouvrirEntretien({
    interlocuteur: inter, canal: (EN ? "Phone" : "Téléphone"), confiance,
    texte: (EN ? `${texteIntro}\n\n“${l.message}”\n\nHow do you close the call?` : `${texteIntro}\n\n${guillemets(l.message)}\n\nComment concluez-vous l'appel ?`),
    choix: melangerChoix([
      { label: (EN ? "“I'll prepare a priced proposal and send it to you this afternoon.”" : "« Je vous prépare une proposition chiffrée et je vous l'envoie cet après-midi. »"), action: () => {
        n.qualifies++;
        l.etat = "traite"; l.resultat = (EN ? "Pricing without discovery" : "Chiffrage sans découverte");
        manque((EN ? `${l.entreprise}: priced proposal without discovery or meeting.` : `${l.entreprise} : proposition chiffrée sans découverte ni rendez-vous.`), "closing");
        fermerEntretien();
      } },
      { label: (EN ? "“How about Tuesday at 10 am or Thursday at 2 pm for a demo: which suits you best?”" : "« Je vous propose mardi à 10 h ou jeudi à 14 h pour une démonstration : qu'est-ce qui vous convient le mieux ? »"), action: () => {
        n.qualifies++; n.rdv++; l.rdv = true;
        l.etat = "traite"; l.resultat = (EN ? "Meeting booked" : "Rendez-vous fixé");
        reussite((EN ? `${l.entreprise} called back in ${dureeTexte(delai)}: demo meeting booked.` : `${l.entreprise} rappelé en ${dureeTexte(delai)} : rendez-vous de démonstration fixé.`), "closing");
        fermerEntretien();
      } },
      { label: (EN ? "“I'll email you all our plans, let me know what you think.”" : "« Je vous envoie toutes nos offres par e-mail, vous me direz ce que vous en pensez. »"), action: () => {
        n.qualifies++;
        l.etat = "traite"; l.resultat = (EN ? "Qualified without a meeting" : "Qualifié sans rendez-vous");
        concession((EN ? `${l.entreprise}: lead qualified, but no meeting booked.` : `${l.entreprise} : lead qualifié, mais aucun rendez-vous fixé.`), "closing");
        fermerEntretien();
      } },
      { label: (EN ? "“Call me back when you've made progress on your side.”" : "« Rappelez-moi quand vous aurez avancé de votre côté. »"), action: () => {
        l.etat = "perdu"; l.resultat = (EN ? "No next step" : "Pas de prochaine étape");
        erreur((EN ? `${l.entreprise}: demo request not turned into a meeting.` : `${l.entreprise} : demande de démonstration non transformée en rendez-vous.`), "closing");
        fermerEntretien();
      } }
    ])
  });
  ouvrirEntretien({
    interlocuteur: inter, canal: (EN ? "Phone" : "Téléphone"), confiance,
    signal: (EN ? `<strong>Tone of voice:</strong> ${prenom} answers quickly, sounding busy but interested.` : `<strong>Ton de voix :</strong> ${prenom} répond rapidement, d'un ton pressé mais intéressé.`),
    texte: (EN ? `${prenom} picks up: “Yes, hello?”\n\nHow do you introduce the purpose of your call?` : `${prenom} décroche : « Oui, bonjour ? »\n\nComment présentez-vous l'objet de votre appel ?`),
    choix: melangerChoix([
      { label: (EN ? "“You requested a demo of Veltis One: I'm calling to understand your context and suggest a suitable meeting.”" : "« Vous avez demandé une démonstration de Veltis One : je vous appelle pour comprendre votre contexte et vous proposer un rendez-vous adapté. »"), action: () => {
        confiance += 15;
        reussite((EN ? "Opening focused on the prospect's request." : "Accroche centrée sur la demande du prospect."), "ecoute", { silencieux: true, muet: true });
        rendezVous((EN ? "“Yes, thanks for calling back so quickly. Let me explain.”" : "« Oui, merci de me rappeler si vite. Je vous explique. »"));
      } },
      { label: (EN ? "“I'm calling to present our prices and current discounts.”" : "« Je vous appelle pour vous présenter nos tarifs et nos remises du moment. »"), action: () => {
        confiance -= 15;
        manque((EN ? "Price mentioned before understanding the need." : "Prix évoqué avant de comprendre le besoin."), "ecoute");
        rendezVous((EN ? "“Before prices, I mostly want to know whether your tool meets our needs.”" : "« Avant les prix, j'aimerais surtout savoir si votre outil répond à notre besoin. »"));
      } },
      { label: (EN ? "“I wanted to know if you were still interested in our software.”" : "« Je voulais savoir si vous étiez toujours intéressé par notre logiciel. »"), action: () => {
        confiance -= 5;
        manque((EN ? "Closed question to open the call." : "Question fermée en ouverture d'appel."), "ecoute");
        rendezVous((EN ? "“Yes… that's why I filled in the form.”" : "« Oui… c'est pour ça que j'ai rempli le formulaire. »"));
      } }
    ])
  });
}

/* =====================================================================
   PARTIE D — MISSIONS 3 ET 4
   ===================================================================== */

/* ---------------------------------------------------------------------
   MISSION 3 · CONSIDÉRATION (vert)
   Appels de qualification (SPIN, BANT), scoring, démonstrations
   personnalisées. Terrain : démonstration en salon client. Sédentaire :
   appels et démonstrations en visio depuis le poste, plus de volume.
   --------------------------------------------------------------------- */
/* Les questions ne sont pas étiquetées : au commercial de reconnaître
   celles qui font progresser la découverte (SPIN puis BANT). */
const QUESTIONS = {
  situation: { label: (EN ? "“How do you currently manage your quotes and sales follow-up?”" : "« Comment gérez-vous aujourd'hui vos devis et votre suivi commercial ? »"), bonne: true },
  probleme: { label: (EN ? "“What causes you the most difficulty in the way you work?”" : "« Qu'est-ce qui vous pose le plus de difficultés dans ce fonctionnement ? »"), bonne: true },
  implication: { label: (EN ? "“What impact does that have on your revenue or your organisation?”" : "« Quel impact cela a-t-il sur votre chiffre d'affaires ou votre organisation ? »"), bonne: true },
  budget: { label: (EN ? "“Is there a budget set aside for this project this year?”" : "« Une enveloppe est-elle prévue pour ce projet cette année ? »"), bonne: true },
  autorite: { label: (EN ? "“Who will be involved in choosing the solution?”" : "« Qui sera impliqué dans le choix de la solution ? »"), bonne: true },
  echeance: { label: (EN ? "“By what date do you want to be up and running?”" : "« À quelle date souhaitez-vous être opérationnels ? »"), bonne: true },
  fermee: { label: (EN ? "“Would you be interested in a solution like ours?”" : "« Vous seriez intéressé par une solution comme la nôtre ? »"), bonne: false, defaut: (EN ? "closed question, no useful information" : "question fermée, sans information utile") },
  suggestive: { label: (EN ? "“You must be losing a lot of deals for lack of follow-up, right?”" : "« Vous perdez sûrement beaucoup d'affaires faute de relances, non ? »"), bonne: false, defaut: (EN ? "leading question: the answer is worthless" : "question orientée : la réponse ne vaut rien") },
  tarifs: { label: (EN ? "“Shall I go straight to our prices?”" : "« Voulez-vous que je vous présente directement nos tarifs ? »"), bonne: false, defaut: (EN ? "prices mentioned before discovery" : "tarifs évoqués avant la découverte") }
};
const CRITERES_BANT = [
  { cle: "budget", nom: "Budget", oui: [(EN ? "Yes, there's a budget for this year." : "Oui, une enveloppe est prévue cette année."), (EN ? "The budget was approved by the management committee last month." : "Le budget a été validé en comité de direction le mois dernier.")], non: [(EN ? "No, nothing is budgeted for now." : "Non, rien n'est budgété pour l'instant."), (EN ? "Honestly, we're looking, but no spending is planned." : "Honnêtement, on regarde, mais aucune dépense n'est prévue.")] },
  { cle: "autorite", nom: (EN ? "Decision-maker" : "Décideur"), oui: [(EN ? "I decide, with the agreement of our CFO." : "C'est moi qui décide, avec l'accord de notre DAF."), (EN ? "I'm leading the project and I'm the one who signs." : "Je pilote le projet et c'est moi qui signe.")], non: [(EN ? "I'm doing research for my management, I'm not the one who decides." : "Je me renseigne pour ma direction, ce n'est pas moi qui décide."), (EN ? "I'll pass it on to my manager, they'll decide." : "Je transmettrai à mon responsable, c'est lui qui tranchera.")] },
  { cle: "besoin", nom: (EN ? "Need" : "Besoin"), oui: [(EN ? "It's become a real obstacle: we reckon we lose several deals a month." : "C'est devenu un vrai frein : on estime perdre plusieurs affaires par mois."), (EN ? "It's costing us time and revenue, we need to act." : "Ça nous coûte du temps et du chiffre d'affaires, il faut agir.")], non: [(EN ? "Honestly, it's still manageable, it's not a priority." : "Honnêtement, ça reste gérable, ce n'est pas une priorité."), (EN ? "We're coping, it's more curiosity." : "On s'en sort, c'est plutôt de la curiosité.")] },
  { cle: "echeance", nom: (EN ? "Timing" : "Échéance"), oui: [(EN ? "We want to be up and running within three months." : "Nous voulons être opérationnels d'ici trois mois."), (EN ? "The project must start before the end of next quarter." : "Le projet doit démarrer avant la fin du trimestre prochain.")], non: [(EN ? "Maybe next year, nothing is scheduled." : "Peut-être l'année prochaine, rien n'est calé."), (EN ? "No deadline for now." : "Aucune échéance pour le moment.")] }
];
const PROFILS_SERIEUX = [[1, 1, 1, 1], [1, 1, 1, 0], [0, 1, 1, 1], [1, 0, 1, 1]];
const PROFILS_FAIBLES = [[0, 0, 1, 0], [1, 0, 0, 1], [0, 0, 0, 0], [0, 1, 1, 0], [1, 0, 0, 0]];
const ETATS_M3 = {
  a_appeler: [(EN ? "To call" : "À appeler"), "neutre"], message: [(EN ? "Message left" : "Message laissé"), "alerte"], sql: [(EN ? "SQL · demo to do" : "SQL · démo à faire"), "info"],
  nurturing: ["Nurturing", "neutre"], disqualifie: [(EN ? "Disqualified" : "Disqualifié"), "neutre"], refus: [(EN ? "Demo declined" : "Démo refusée"), "ko"],
  rdv: [(EN ? "Successful demo · meeting" : "Démo réussie · RDV"), "ok"], demo_ko: [(EN ? "Demo with no follow-up" : "Démo sans suite"), "ko"]
};

const M3 = {
  id: "consideration", phase: "Qualification", couleur: "#047857", texteCouleur: "#ffffff",
  transition: ["Lead", (EN ? "Opportunity" : "Opportunité")],
  objectifTableau: (EN ? "Turn serious leads into opportunities" : "Transformer les leads sérieux en opportunités"),
  activitesTableau: (EN ? "Discovery calls (SPIN, BANT), scoring, demos" : "Appels de découverte (SPIN, BANT), scoring, démonstrations"),
  kpiTableau: (EN ? "Lead → opportunity rate, scoring reliability, successful demos" : "Taux lead → opportunité, fiabilité du scoring, démos réussies"),
  reflexeRequin: (EN ? "Running through the whole catalogue at every demo and pushing leads with no project: the pipeline swells… and never signs. To convert leads into opportunities, qualify honestly and only show what answers the stated problem." : "Dérouler tout le catalogue à chaque démonstration et pousser les leads sans projet : le pipe gonfle… et ne signe jamais. Pour transformer un lead en opportunité, qualifiez honnêtement et ne montrez que ce qui répond au problème exprimé."),
  mode: { terrain: (EN ? "Calls + demos in a client room" : "Appels + démos en salon client"), sedentaire: (EN ? "Calls + video demos" : "Appels + démos en visio") },
  titre: (EN ? "Turn serious leads into opportunities" : "Transformer les leads sérieux en opportunités"),
  contexte: (EN ? "Marketing has passed you leads from the trade show and the website. Your mission, Monday to Wednesday: qualify them by phone, spot those with a real project and land successful demos." : "Le marketing vous a transmis des leads issus du salon et du site. Votre mission, du lundi au mercredi : les qualifier par téléphone, repérer ceux qui portent un vrai projet et décrocher des démonstrations réussies."),
  objectifBusiness: (EN ? "Third stage of the funnel: identify, among the leads, those with a real project and turn them into opportunities through a tailored demo. Key activities: qualification calls, demos, scoring. KPIs: qualification rate, meetings booked." : "Troisième étage du tunnel : identifier, parmi les leads, ceux qui portent un projet réel et en faire des opportunités grâce à une démonstration personnalisée. Activités clés : appels de qualification, démonstrations, scoring. Indicateurs : taux de qualification, rendez-vous obtenus."),
  params: {
    standard: { nb: 5, serieux: 3, objectif: 2, questions: 5 },
    confirme: { nb: 6, serieux: 3, objectif: 3, questions: 4 }
  },
  periode: () => ({ debut: 0, fin: 3 * JOURNEE, rythme: 5, affichage: "jour" }),
  depart: () => ({ x: POINT_POSTE.x, z: POINT_POSTE.z, angle: Math.PI }),
  mission: p => (EN ? `Qualify your leads by Wednesday evening and turn at least ${p.objectif} serious leads into opportunities (successful demo).` : `Qualifiez vos leads d'ici mercredi soir et transformez au moins ${p.objectif} leads sérieux en opportunités (démonstration réussie).`),
  consignes: p => [
    (EN ? `Call each lead from the CRM. You have ${p.questions} questions per call: choose them to uncover the need, the issues and the BANT criteria.` : `Appelez chaque lead depuis le CRM. Vous disposez de ${p.questions} questions par appel : choisissez-les pour connaître le besoin, les problématiques et les critères BANT.`),
    (EN ? "Scoring rule: a lead is serious (SQL) if it meets at least 3 criteria out of 4 (budget, decision-maker, need, timing), including need." : "Règle de scoring : un lead est sérieux (SQL) s'il valide au moins 3 critères sur 4 (budget, décideur, besoin, échéance), dont le besoin."),
    (EN ? "Offer a demo to serious leads, put the others into nurturing or disqualify them if they have no project." : "Proposez une démonstration aux leads sérieux, placez les autres en nurturing ou disqualifiez-les s'ils n'ont aucun projet."),
    (EN ? "Demo: show the modules that answer the stated issues, without running through the whole catalogue. Yanis (pre-sales) can help you prepare it." : "Démonstration : montrez les modules qui répondent aux problématiques exprimées, sans dérouler tout le catalogue. Yanis (avant-vente) peut vous aider à la préparer.")
  ],
  profilNote: () => estTerrain()
    ? (EN ? "Field profile: you call your leads from your mobile, wherever you are on the floor, but demos take place face to face: the client is received in a client room. Join the room: face to face lets you show up to 4 modules and read body language. Each in-person meeting takes time." : "Profil terrain : vous appelez vos leads depuis votre mobile, où que vous soyez dans l'étage, mais les démonstrations ont lieu en face à face : le client est reçu dans un salon client. Rejoignez la salle : le face à face permet de montrer jusqu'à 4 modules et de lire le non-verbal. Chaque rendez-vous présentiel prend du temps.")
    : (EN ? "Inside sales profile: you work from your desk (calls and video demos), with a larger portfolio. Video limits the demo to 3 modules to keep attention. Watch out for switchboards and voicemail." : "Profil sédentaire : vous travaillez depuis votre poste (appels et démonstrations en visio), avec un portefeuille plus large. La visio limite la démonstration à 3 modules pour garder l'attention. Attention aux standards et aux messageries."),
  criteres: p => [
    (EN ? `Success: at least ${p.objectif} successful demos with serious leads by Wednesday 6 pm.` : `Réussite : au moins ${p.objectif} démonstrations réussies avec des leads sérieux d'ici mercredi 18 h.`),
    (EN ? "Excellence: 100% reliable scoring and at least 3 BANT criteria known on average per lead · Proficient: 80% reliable scoring." : "Excellence : scoring 100 % fiable et au moins 3 critères BANT connus en moyenne par lead · Maîtrise : scoring fiable à 80 %."),
    (EN ? "Errors: serious lead dismissed, demo scheduled for a lead with no project, demo ignoring the stated need, dishonest way past a switchboard." : "Erreurs : lead sérieux écarté, démonstration planifiée pour un lead sans projet, démonstration qui ignore le besoin exprimé, contournement mensonger d'un standard.")
  ],
  aRetenir: (EN ? "Qualifying means focusing sales time on leads with a need, a budget, a decision-maker and a timeline. A structured discovery (SPIN then BANT) gives both the score and the material for a tailored demo: show what answers the stated problem, not the whole catalogue." : "Qualifier, c'est concentrer le temps commercial sur les leads qui ont un besoin, un budget, un décideur et une échéance. Une découverte structurée (SPIN puis BANT) donne à la fois le score et la matière d'une démonstration personnalisée : on montre ce qui répond au problème exprimé, pas tout le catalogue."),
  conseilEchec: (EN ? "Ask first the questions that reveal the need and the issues (situation, problem, implication), then budget, decision-maker and timing. Count the criteria before deciding, and build the demo around the issues you heard." : "Posez d'abord les questions qui révèlent le besoin et les problématiques (situation, problème, implication), puis budget, décideur et échéance. Comptez les critères avant de décider, et construisez la démonstration autour des problématiques entendues."),

  demarrer(n, p) {
    const pp = Object.assign({}, p);
    if (!estTerrain()) { pp.nb += 1; pp.serieux += 1; pp.objectif += 1; }
    n.p = pp;
    Object.assign(n, { comptes: [], rdv: 0, decisions: 0, justes: 0, couverture: [] });
    const cles = melanger(Object.keys(COMPTES)).slice(0, Math.min(pp.nb, 7));
    cles.forEach((cle, i) => {
      const c = COMPTES[cle];
      const serieux = i < pp.serieux;
      const bant = (serieux ? choisir(PROFILS_SERIEUX) : choisir(PROFILS_FAIBLES)).slice();
      const a = {
        id: cle, c, bant, serieux, score: bant.reduce((s, x) => s + x, 0), etat: "a_appeler",
        revele: {}, painsReveles: [], messageLaisse: false, barragePasse: false, conseil: false, variante: entier(0, 1)
      };
      a.pnj = placerContact(c);
      a.inter = ajouterInteractif({
        x: c.batiment.porte.x, z: c.batiment.porte.z, rayon: 2.6, label: (EN ? `demo with ${c.entreprise} (${c.batiment.nom})` : `démonstration avec ${c.entreprise} (${c.batiment.nom})`),
        action: () => demonstration(n, a), actif: false
      });
      n.comptes.push(a);
    });
    n.comptes = melanger(n.comptes);
    activerCollegue("avantVente", (EN ? "prepare a demo with Yanis" : "préparer une démonstration avec Yanis"), () => conseilYanis(n));
  },
  auDemarrage() {
    ouvrirPanneau((EN ? "CRM · Leads to qualify" : "CRM · Leads à qualifier"), estTerrain() ? (EN ? "Calls from your mobile · demos in a client room" : "Appels depuis votre mobile · démos en salon client") : (EN ? "Calls and video demos from your desk" : "Appels et démos en visio depuis votre poste"));
  },
  ciblesCarte: n => n.comptes.filter(a => a.etat === "sql").map(a => a.id),
  maj(n) {
    n.comptes.forEach(a => {
      a.inter.actif = estTerrain() && a.etat === "sql";
      const [texte, type] = ETATS_M3[a.etat];
      majEtiquette(a.pnj.etiquette, `${a.c.contact} · ${a.c.entreprise} · ${texte}`, a.etat === "sql" && estTerrain() ? "etq-cible" : type === "ok" ? "etq-ok" : type === "ko" ? "etq-ko" : "");
    });
  },
  tunnel: n => ({
    de: "Lead", vers: (EN ? "Opportunity" : "Opportunité"),
    etapes: [
      { label: (EN ? "Leads to qualify" : "Leads à qualifier"), court: "leads", valeur: n.comptes.length },
      { label: (EN ? "Discovery calls held" : "Découvertes menées"), court: (EN ? "discovery calls" : "découvertes"), valeur: n.comptes.filter(a => !["a_appeler", "message"].includes(a.etat)).length },
      { label: (EN ? "Serious leads (SQL)" : "Leads sérieux (SQL)"), court: "SQL", valeur: n.comptes.filter(a => a.decision === "sql").length },
      { label: (EN ? "Opportunities (successful demo)" : "Opportunités (démo réussie)"), court: (EN ? "opportunities" : "opportunités"), valeur: n.rdv }
    ]
  }),
  hud(n) {
    const p = n.p;
    hudJauge((EN ? "Opportunities created (successful demos)" : "Opportunités créées (démos réussies)"), (n.rdv / p.objectif) * 100, `${n.rdv} / ${p.objectif}`);
    const appeles = n.comptes.filter(a => !["a_appeler", "message"].includes(a.etat)).length;
    hudKpis([
      { label: (EN ? "Qualified leads" : "Leads qualifiés"), valeur: `${appeles} / ${n.comptes.length}` },
      { label: (EN ? "Accurate scoring" : "Scoring juste"), valeur: n.decisions ? pourcent(n.justes / n.decisions * 100) : "—" },
      { label: (EN ? "SQLs awaiting demo" : "SQL en attente de démo"), valeur: `${n.comptes.filter(a => a.etat === "sql").length}` }
    ]);
  },
  panneau(n) {
    let h = (EN ? `<div class="pm-note">Scoring: <strong>SQL</strong> if at least <strong>3 BANT criteria out of 4</strong>, including need. ${estTerrain() ? (EN ? "Demos <strong>in a client room</strong>." : "Démonstrations <strong>en salon client</strong>.") : (EN ? "Demos <strong>by video call</strong> from your desk." : "Démonstrations <strong>en visio</strong> depuis votre poste.")}</div>` : `<div class="pm-note">Scoring : <strong>SQL</strong> si au moins <strong>3 critères BANT sur 4</strong>, dont le besoin. ${estTerrain() ? (EN ? "Demos <strong>in a client room</strong>." : "Démonstrations <strong>en salon client</strong>.") : (EN ? "Demos <strong>by video call</strong> from your desk." : "Démonstrations <strong>en visio</strong> depuis votre poste.")}</div>`);
    const actifs = n.comptes.filter(a => ["a_appeler", "message", "sql"].includes(a.etat));
    const finis = n.comptes.filter(a => !["a_appeler", "message", "sql"].includes(a.etat));
    h += (EN ? `<div class="pm-section">To handle (${actifs.length})</div>` : `<div class="pm-section">À traiter (${actifs.length})</div>`);
    if (!actifs.length) h += (EN ? `<div class="pm-vide">All your leads have been handled.</div>` : `<div class="pm-vide">Tous vos leads ont été traités.</div>`);
    actifs.concat(finis).forEach((a, idx) => {
      if (idx === actifs.length && finis.length) h += (EN ? `<div class="pm-section">Handled (${finis.length})</div>` : `<div class="pm-section">Traités (${finis.length})</div>`);
      const c = a.c;
      const [etat, type] = ETATS_M3[a.etat];
      const bant = CRITERES_BANT.map((k, i) => {
        const v = a.revele[k.cle];
        return chip(`${k.nom}${EN ? "" : " "}${v === undefined ? "?" : v ? " ✓" : " ✕"}`, v === undefined ? "neutre" : v ? "ok" : "ko");
      }).join("");
      const pains = a.painsReveles.map(p => chip(PAINS[p].court, "info")).join("");
      let actions = "";
      if (a.etat === "a_appeler" || a.etat === "message") {
        actions = boutonPm(a.etat === "message" ? (EN ? "Call back" : "Rappeler") : (EN ? "Call" : "Appeler"), "appeler", a.id, { principal: true, desactive: !estTerrain() && !auPoste(), titre: !estTerrain() && !auPoste() ? (EN ? "Go back to your desk" : "Retournez à votre poste") : "" });
      } else if (a.etat === "sql") {
        if (estTerrain()) {
          const proche = procheBatiment(a.id);
          actions = boutonPm(proche ? (EN ? "Face-to-face demo" : "Démonstration en face à face") : (EN ? `Go to the ${c.batiment.nom} · ${distanceMetres(c.batiment.porte)} m` : `Rejoindre le ${c.batiment.nom} · ${distanceMetres(c.batiment.porte)} m`), "demo", a.id, { principal: true, desactive: !proche });
        } else {
          actions = boutonPm((EN ? "Video demo" : "Démonstration en visio"), "demo", a.id, { principal: true, desactive: !auPoste(), titre: !auPoste() ? (EN ? "Go back to your desk" : "Retournez à votre poste") : "" });
        }
      }
      h += (EN ? `<div class="fiche${a.etat === "sql" ? " active" : ""}${!actions ? " terminee" : ""}">
        <div class="fiche-entete"><span class="fiche-titre">${echapper(c.entreprise)}</span>${chip(etat, type)}</div>
        <div class="fiche-ligne"><strong>${echapper(c.contact)}</strong> · ${echapper(c.fonction)}</div>
        <div class="fiche-ligne">${echapper(c.secteur)} · ${c.effectif} employees</div>
        <div class="chips">${bant}</div>
        ${pains ? `<div class="chips">${pains}</div>` : ""}
        ${actions ? `<div class="pm-actions">${actions}</div>` : ""}</div>` : `<div class="fiche${a.etat === "sql" ? " active" : ""}${!actions ? " terminee" : ""}">
        <div class="fiche-entete"><span class="fiche-titre">${echapper(c.entreprise)}</span>${chip(etat, type)}</div>
        <div class="fiche-ligne"><strong>${echapper(c.contact)}</strong> · ${echapper(c.fonction)}</div>
        <div class="fiche-ligne">${echapper(c.secteur)} · ${c.effectif} salariés</div>
        <div class="chips">${bant}</div>
        ${pains ? `<div class="chips">${pains}</div>` : ""}
        ${actions ? `<div class="pm-actions">${actions}</div>` : ""}</div>`);
    });
    return h;
  },
  commande(n, cmd, id) {
    const a = n.comptes.find(x => x.id === id);
    if (!a) return;
    if (cmd === "appeler") appelerLead(n, a);
    if (cmd === "demo") demonstration(n, a);
  },
  kpis(n) {
    const p = n.p;
    const traites = n.comptes.filter(a => !["a_appeler", "message"].includes(a.etat));
    const sql = n.comptes.filter(a => a.decision === "sql").length;
    const couverture = n.couverture.length ? n.couverture.reduce((a, b) => a + b, 0) / n.couverture.length : 0;
    return [
      { nom: (EN ? "Leads qualified (calls completed)" : "Leads qualifiés (appels aboutis)"), valeur: `${traites.length} / ${n.comptes.length}`, cible: "tous", ok: traites.length === n.comptes.length },
      { nom: (EN ? "Qualification rate (SQL / qualified leads)" : "Taux de qualification (SQL / leads qualifiés)"), valeur: traites.length ? pourcent(sql / traites.length * 100) : "—", cible: (EN ? `${p.serieux} serious leads out of ${n.comptes.length}` : `${p.serieux} leads sérieux sur ${n.comptes.length}`), ok: null },
      { nom: (EN ? "Meetings booked (successful demos)" : "Rendez-vous obtenus (démos réussies)"), valeur: `${n.rdv}`, cible: `≥ ${p.objectif}`, ok: n.rdv >= p.objectif },
      { nom: (EN ? "Scoring reliability" : "Fiabilité du scoring"), valeur: n.decisions ? pourcent(n.justes / n.decisions * 100) : "—", cible: (EN ? "100% for Excellence" : "100 % pour Excellence"), ok: n.decisions > 0 && n.justes === n.decisions },
      { nom: (EN ? "BANT criteria known per lead" : "Critères BANT connus par lead"), valeur: n.couverture.length ? `${decimal(couverture.toFixed(1))} / 4` : "—", cible: "≥ 3", ok: couverture >= 3 }
    ];
  },
  finTemps(n) {
    const p = n.p;
    const couverture = n.couverture.length ? n.couverture.reduce((a, b) => a + b, 0) / n.couverture.length : 0;
    const fiabilite = n.decisions ? n.justes / n.decisions : 0;
    if (n.rdv >= p.objectif) {
      const etoiles = fiabilite === 1 && couverture >= 3 ? 3 : fiabilite >= 0.8 ? 2 : 1;
      terminerNiveau(true, etoiles, (EN ? `${n.rdv} successful demos. Scoring reliability: ${pourcent(fiabilite * 100)}.` : `${n.rdv} démonstrations réussies. Fiabilité du scoring : ${pourcent(fiabilite * 100)}.`));
    } else {
      terminerNiveau(false, 0, (EN ? `${n.rdv} successful demo(s) by Wednesday evening, against a target of ${p.objectif}.` : `${n.rdv} démonstration(s) réussie(s) d'ici mercredi soir, pour un objectif de ${p.objectif}.`));
    }
  }
};

function verifierFinM3(n) {
  if (jeu.mode === "bilan") return;
  const restants = n.comptes.filter(a => ["a_appeler", "message", "sql"].includes(a.etat));
  if (!restants.length) M3.finTemps(n);
}

function appelerLead(n, a) {
  if (!controleSedentaire()) return;
  const c = a.c;
  const nomJoueur = resultats.nom || (EN ? "your name" : "votre nom");
  avancerTemps(5);
  a.tentatives = (a.tentatives || 0) + 1;
  const joignable = tirage(`${a.id}|appel|${a.tentatives}`) < (a.messageLaisse ? 0.9 : 0.6);
  if (!joignable) {
    ouvrirEntretien({
      titre: (EN ? `${c.contact}'s voicemail` : `Messagerie de ${c.contact}`), canal: (EN ? "Phone" : "Téléphone"),
      texte: (EN ? `“Hello, you've reached the voicemail of ${c.contact}, ${c.entreprise}. Leave me a message and I'll call you back.”` : `« Bonjour, vous êtes bien sur la messagerie de ${c.contact}, ${c.entreprise}. Laissez-moi un message, je vous rappellerai. »`),
      choix: [
        { label: (EN ? "Leave a short message (reason and call-back slot) and send a follow-up email." : "Laisser un message court (motif et créneau de rappel) et envoyer un e-mail de suivi."), action: () => {
          a.messageLaisse = true;
          a.etat = "message";
          evaluer("organisation", 1);
          information((EN ? `${c.entreprise}: voicemail and follow-up email left.` : `${c.entreprise} : message vocal et e-mail de suivi laissés.`));
          fermerEntretien();
          message((EN ? `Message left for ${c.contact}. Call back a little later.` : `Message laissé à ${c.contact}. Rappelez un peu plus tard.`), "info");
        } },
        { label: (EN ? "Hang up without leaving a message and call back later." : "Raccrocher sans laisser de message et rappeler plus tard."), action: () => {
          manque((EN ? `${c.entreprise}: call without a message, the contact doesn't know why you're calling.` : `${c.entreprise} : appel sans message, le contact ne sait pas pourquoi vous appelez.`), "organisation");
          fermerEntretien();
        } }
      ]
    });
    return;
  }
  const lancer = (confiance = 50) => qualification(n, a, confiance);
  if (["dg", "daf"].includes(c.role) && !a.barragePasse && tirage(`${a.id}|standard`) < 0.6) {
    const titre = c.genre === "f" ? (EN ? "Ms" : "Mme") : "M.";
    ouvrirEntretien({
      interlocuteur: { nom: (EN ? "Reception" : "Accueil"), fonction: "Standard", entreprise: c.entreprise, couleur: "#64748b" }, canal: (EN ? "Phone" : "Téléphone"),
      texte: (EN ? `“${c.entreprise}, good morning. What is it regarding?”` : `« ${c.entreprise}, bonjour. C'est à quel sujet ? »`),
      choix: melangerChoix([
        { label: (EN ? `“Hello, this is ${nomJoueur} from Veltis. I'm calling for ${c.contact.split(" ")[1]} about the sales tool project mentioned in their request. When is the best time to reach them?”` : `« Bonjour, ${nomJoueur}, de Veltis. J'appelle ${titre} ${c.contact.split(" ")[1]} au sujet du projet d'outil commercial évoqué lors de sa demande. À quel moment est-${pronom(c, false)} le plus joignable ? »`), action: () => {
          a.barragePasse = true;
          reussite((EN ? `${c.entreprise}: switchboard handled transparently.` : `${c.entreprise} : standard franchi avec transparence.`), "conformite", { silencieux: true, muet: true });
          lancer(55);
        } },
        { label: (EN ? `“${pronom(c)} is expecting my call, could you put me through?”` : `« ${pronom(c)} attend mon appel, pouvez-vous me ${pronom(c, false) === "elle" ? "la" : "le"} passer ? »`), action: () => {
          a.barragePasse = true;
          erreur((EN ? `${c.entreprise}: lie to the switchboard (the contact wasn't expecting your call).` : `${c.entreprise} : mensonge au standard (le contact n'attendait pas votre appel).`), "conformite");
          lancer(30);
        } },
        { label: (EN ? "“Could you put me through to purchasing instead?”" : "« Pouvez-vous plutôt me passer le service achats ? »"), action: () => {
          manque((EN ? `${c.entreprise}: call diverted to purchasing, not involved at this stage.` : `${c.entreprise} : appel détourné vers les achats, non concernés à ce stade.`), "ciblage");
          fermerEntretien();
        } }
      ])
    });
    return;
  }
  lancer();
}

function qualification(n, a, confianceDepart) {
  const c = a.c;
  let confiance = confianceDepart;
  let restantes = n.p.questions;
  const posees = new Set();
  const notes = [];
  const reponse = (k) => {
    const v = a.variante;
    switch (k) {
      case "situation":
        if (!a.painsReveles.includes(c.pains[0])) a.painsReveles.push(c.pains[0]);
        confiance += 5;
        return PAINS[c.pains[0]].texte;
      case "probleme":
        if (!a.painsReveles.includes(c.pains[1])) a.painsReveles.push(c.pains[1]);
        confiance += 5;
        return PAINS[c.pains[1]].texte;
      case "implication":
        a.revele.besoin = !!a.bant[2];
        confiance += 6;
        return a.bant[2] ? CRITERES_BANT[2].oui[v] : CRITERES_BANT[2].non[v];
      case "budget":
        a.revele.budget = !!a.bant[0];
        return a.bant[0] ? CRITERES_BANT[0].oui[v] : CRITERES_BANT[0].non[v];
      case "autorite":
        a.revele.autorite = !!a.bant[1];
        return a.bant[1] ? CRITERES_BANT[1].oui[v] : CRITERES_BANT[1].non[v];
      case "echeance":
        a.revele.echeance = !!a.bant[3];
        return a.bant[3] ? CRITERES_BANT[3].oui[v] : CRITERES_BANT[3].non[v];
      case "fermee":
        confiance -= 8;
        return (EN ? "Er… maybe, it depends on what you're offering." : "Euh… peut-être, ça dépend de ce que vous proposez.");
      case "suggestive":
        confiance -= 6;
        return (EN ? "Er… yes, probably, like everyone I suppose." : "Euh… oui, sûrement, comme tout le monde j'imagine.");
      default:
        confiance -= 12;
        return (EN ? "I'd rather know first whether you've understood our need…" : "Je préférerais d'abord savoir si vous avez compris notre besoin…");
    }
  };
  const ordre = melangerChoix(Object.keys(QUESTIONS));
  const etape = texte => {
    const choix = ordre.filter(k => !posees.has(k)).map(k => ({ label: QUESTIONS[k].label, action: () => poser(k) }));
    if (posees.size) choix.push({ label: (EN ? "End the call and qualify the lead" : "Conclure l'appel et qualifier le lead"), action: decision });
    ouvrirEntretien({
      interlocuteur: interlocuteurDe(c), canal: (EN ? "Phone" : "Téléphone"), confiance,
      signal: (EN ? `<strong>Questions left:</strong> ${restantes} · <strong>Notes:</strong> ${notes.length ? echapper(notes.join(" · ")) : "aucune"}` : `<strong>Questions restantes :</strong> ${restantes} · <strong>Notes :</strong> ${notes.length ? echapper(notes.join(" · ")) : "aucune"}`),
      texte, choix
    });
  };
  const poser = k => {
    posees.add(k);
    restantes--;
    const r = reponse(k);
    evaluer("questionnement", QUESTIONS[k].bonne ? 1 : 0);
    if (!QUESTIONS[k].bonne) manque(`${c.entreprise} : ${QUESTIONS[k].defaut}.`, null, false);
    const libelles = { situation: "situation", probleme: (EN ? "problem" : "problème"), implication: "besoin", budget: "budget", autorite: (EN ? "decision-maker" : "décideur"), echeance: (EN ? "timing" : "échéance") };
    if (libelles[k]) notes.push(libelles[k]);
    if (restantes <= 0) decision(`${guillemets(r)}`);
    else etape(`${guillemets(r)}`);
  };
  const decision = (dernier = "") => {
    avancerTemps(20);
    const r = a.revele;
    const ligne = (nom, v, oui, non) => `• ${nom} : ${v === undefined ? (EN ? "not covered" : "non abordé") : v ? oui : non}`;
    const resume = [
      ligne("Budget", r.budget, (EN ? "planned" : "prévu"), (EN ? "not planned" : "non prévu")),
      ligne((EN ? "Decision-maker" : "Décideur"), r.autorite, (EN ? "your contact decides" : "votre interlocuteur décide"), (EN ? "is not the decision-maker" : "n'est pas le décideur")),
      ligne((EN ? "Need" : "Besoin"), r.besoin, "fort", "faible"),
      ligne((EN ? "Timing" : "Échéance"), r.echeance, (EN ? "under 6 months" : "moins de 6 mois"), (EN ? "distant or unknown" : "lointaine ou inconnue")),
      (EN ? `• Issues: ${a.painsReveles.length ? a.painsReveles.map(p => PAINS[p].court.toLowerCase()).join(", ") : (EN ? "not identified" : "non identifiées")}` : `• Problématiques : ${a.painsReveles.length ? a.painsReveles.map(p => PAINS[p].court.toLowerCase()).join(", ") : (EN ? "not identified" : "non identifiées")}`)
    ].join("\n");
    const couverture = ["budget", "autorite", "besoin", "echeance"].filter(k => r[k] !== undefined).length;
    ouvrirEntretien({
      interlocuteur: interlocuteurDe(c), canal: (EN ? "Phone" : "Téléphone"), confiance,
      texte: (EN ? `${dernier ? dernier + "\n\n" : ""}What you learned:\n${resume}\n\nHow do you qualify this lead?` : `${dernier ? dernier + "\n\n" : ""}Ce que vous avez appris :\n${resume}\n\nComment qualifiez-vous ce lead ?`),
      choix: [
        { label: (EN ? "Serious lead (SQL): offer a demo" : "Lead sérieux (SQL) : proposer une démonstration"), action: () => decider("sql", couverture) },
        { label: (EN ? "Lead to nurture: put it into nurturing" : "Lead à mûrir : le placer en nurturing"), action: () => decider("nurturing", couverture) },
        { label: (EN ? "No project: disqualify it" : "Sans projet : le disqualifier"), action: () => decider("disqualifie", couverture) }
      ]
    });
  };
  const decider = (choix, couverture) => {
    a.decision = choix;
    n.decisions++;
    n.couverture.push(couverture);
    if (couverture < 3) manque((EN ? `${c.entreprise}: incomplete qualification (${couverture} BANT criteria out of 4).` : `${c.entreprise} : qualification incomplète (${couverture} critère(s) BANT sur 4).`), "questionnement");
    const sansProjet = a.score <= 1 && !a.bant[2];
    let juste;
    if (choix === "sql") {
      juste = a.serieux;
      if (juste) reussite((EN ? `${c.entreprise} qualified as SQL (score ${a.score}/4).` : `${c.entreprise} qualifié SQL (score ${a.score}/4).`), "ciblage");
      else erreur((EN ? `${c.entreprise} overrated: demo scheduled for a lead with no real project (score ${a.score}/4).` : `${c.entreprise} surévalué : démonstration planifiée pour un lead sans projet réel (score ${a.score}/4).`), "ciblage");
    } else if (choix === "nurturing") {
      juste = !a.serieux;
      if (juste) reussite((EN ? `${c.entreprise} put into nurturing (score ${a.score}/4).` : `${c.entreprise} placé en nurturing (score ${a.score}/4).`), "ciblage");
      else erreur((EN ? `${c.entreprise} underrated: it was a serious lead (score ${a.score}/4).` : `${c.entreprise} sous-évalué : c'était un lead sérieux (score ${a.score}/4).`), "ciblage");
    } else {
      juste = !a.serieux;
      if (a.serieux) erreur((EN ? `${c.entreprise} wrongly disqualified: it was a serious lead (score ${a.score}/4).` : `${c.entreprise} disqualifié à tort : c'était un lead sérieux (score ${a.score}/4).`), "ciblage");
      else if (sansProjet) reussite((EN ? `${c.entreprise} disqualified: no project (score ${a.score}/4).` : `${c.entreprise} disqualifié : aucun projet (score ${a.score}/4).`), "ciblage");
      else concession((EN ? `${c.entreprise} disqualified a bit too quickly: nurturing was preferable (score ${a.score}/4).` : `${c.entreprise} disqualifié un peu vite : le nurturing était préférable (score ${a.score}/4).`), "ciblage");
    }
    if (juste) n.justes++;
    if (choix === "sql") {
      if (confiance < 40) {
        a.etat = "refus";
        manque((EN ? `${c.entreprise} declines the demo: trust was not established.` : `${c.entreprise} décline la démonstration : la confiance n'a pas été établie.`), "relation");
        ouvrirEntretien({ interlocuteur: interlocuteurDe(c), canal: (EN ? "Phone" : "Téléphone"), confiance, texte: (EN ? "“I'm not sure it's the right time. Send me some documentation instead.”" : "« Je ne suis pas sûr que ce soit le bon moment. Envoyez-moi plutôt une documentation. »"), choix: [{ label: (EN ? "Hang up" : "Raccrocher"), action: () => { fermerEntretien(); verifierFinM3(n); } }] });
        return;
      }
      a.etat = "sql";
      ouvrirEntretien({
        interlocuteur: interlocuteurDe(c), canal: (EN ? "Phone" : "Téléphone"), confiance,
        texte: estTerrain()
          ? (EN ? `“Very well, come and show us at our offices.”\n\nFace-to-face demo: ${c.entreprise} will be received in the ${c.batiment.nom}.` : `« Très bien, venez nous montrer ça dans nos locaux. »\n\nDémonstration à mener en face à face : ${c.entreprise} sera reçu au ${c.batiment.nom}.`)
          : (EN ? "“Very well, show me on a video call.”\n\nVideo demo to run from your desk." : "« Très bien, montrez-moi ça en visio. »\n\nDémonstration à mener en visio depuis votre poste."),
        choix: [{ label: (EN ? "Hang up and prepare the demo" : "Raccrocher et préparer la démonstration"), action: () => { fermerEntretien(); verifierFinM3(n); } }]
      });
    } else {
      a.etat = choix;
      fermerEntretien();
      verifierFinM3(n);
    }
  };
  etape((EN ? `${c.contact} picks up. “Yes, hello?”\n\nYou introduce yourself and recall the context of their request. Which question do you ask?` : `${c.contact} décroche. « Oui, bonjour ? »\n\nVous vous présentez et rappelez le contexte de sa demande. Quelle question posez-vous ?`));
}

function conseilYanis(n) {
  const inter = interlocuteurCollegue("avantVente");
  const sql = n.comptes.filter(a => a.etat === "sql" && !a.conseil);
  if (!sql.length) {
    ouvrirEntretien({ interlocuteur: inter, canal: (EN ? "Sales floor" : "Plateau"), texte: (EN ? "“As soon as you have an SQL-qualified lead, come and see me: we'll prepare the demo together.”" : "« Dès que tu as un lead qualifié SQL, passe me voir : on préparera la démonstration ensemble. »"), choix: [{ label: "D'accord", action: fermerEntretien }] });
    return;
  }
  ouvrirEntretien({
    interlocuteur: inter, canal: (EN ? "Sales floor" : "Plateau"),
    texte: (EN ? "“Which account do you want to prepare the demo for?”\n\nUsing help costs 3 points on the mission score." : "« Pour quel compte veux-tu préparer la démonstration ? »\n\nUtiliser une aide coûte 3 points au score de la mission."),
    choix: sql.map(a => ({
      label: `${a.c.entreprise} · ${a.c.contact} (${a.c.fonction}) · −3 points`,
      action: () => {
        a.conseil = true;
        avancerTemps(20);
        aideUtilisee((EN ? `demo preparation ${a.c.entreprise} with Yanis` : `préparation de la démonstration ${a.c.entreprise} avec Yanis`));
        ouvrirEntretien({
          interlocuteur: inter, canal: (EN ? "Sales floor" : "Plateau"),
          texte: (EN ? `“For a ${a.c.fonction.toLowerCase()} profile, also show the ${MODULES[ROLE_MODULE[a.c.role]].nom.toLowerCase()} module: that's what speaks to this kind of contact. And above all, build the demo around the problems they told you about, not around the catalogue.”` : `« Pour un profil ${a.c.fonction.toLowerCase()}, montre aussi le module ${MODULES[ROLE_MODULE[a.c.role]].nom.toLowerCase()} : c'est ce qui parle à ce type d'interlocuteur. Et surtout, construis la démo autour des problèmes qu'il t'a exprimés, pas autour du catalogue. »`),
          choix: [{ label: (EN ? "Thanks Yanis" : "Merci Yanis"), action: fermerEntretien }]
        });
      }
    })).concat([{ label: (EN ? "Nothing for now" : "Rien pour l'instant"), action: fermerEntretien }])
  });
}

function demonstration(n, a) {
  const c = a.c;
  if (a.etat !== "sql") return;
  if (estTerrain()) { if (!controleSurSite(c)) return; } else if (!controleSedentaire()) return;
  const max = estTerrain() ? 4 : 3;
  const canal = estTerrain() ? (EN ? "In person" : "Présentiel") : (EN ? "Video call" : "Visio");
  const pains = a.painsReveles.length ? a.painsReveles.map(p => PAINS[p].court).join(", ") : (EN ? "no issue identified during the call" : "aucune problématique identifiée pendant l'appel");
  const cartes = Object.entries(MODULES).map(([k, m]) => `
    <label class="choix-carte"><input type="checkbox" name="module" value="${k}"><span class="cc-corps"><span class="cc-titre">${m.nom}</span><span class="cc-detail">${m.detail}</span></span></label>`).join("");
  ouvrirFenetre({
    titre: (EN ? `Demo · ${c.entreprise}` : `Démonstration · ${c.entreprise}`),
    sousTitre: `${canal === (EN ? "In person" : "Présentiel") ? (EN ? "Face to face" : "Sur site") : (EN ? "Video call" : "En visio")} · ${c.contact}, ${c.fonction} · ${max} modules maximum`,
    large: true,
    fermable: true,
    corps: (EN ? `
      <div class="fiche-client"><strong>Qualification notes</strong><br>
        Issues raised: ${echapper(pains)}<br>
        Contact: ${echapper(c.fonction)} · ${c.effectif} employees · ${echapper(c.secteur)}
        ${a.conseil ? (EN ? `<br>Yanis's tip: also show “${echapper(MODULES[ROLE_MODULE[c.role]].nom)}”.` : `<br>Conseil de Yanis : montrer aussi ${guillemets(echapper(MODULES[ROLE_MODULE[c.role]].nom))}.`) : ""}</div>
      <h4>Modules to present (${max} maximum)</h4>
      <div class="choix-grille">${cartes}</div>
      <p id="demo-alerte" class="alerte-texte cache">You can't present more than ${max} modules ${canal === (EN ? "Video call" : "Visio") ? (EN ? "by video call" : "en visio") : (EN ? "in one session" : "en une séance")}.</p>` : `
      <div class="fiche-client"><strong>Notes de qualification</strong><br>
        Problématiques exprimées : ${echapper(pains)}<br>
        Interlocuteur : ${echapper(c.fonction)} · ${c.effectif} salariés · ${echapper(c.secteur)}
        ${a.conseil ? (EN ? `<br>Yanis's tip: also show “${echapper(MODULES[ROLE_MODULE[c.role]].nom)}”.` : `<br>Conseil de Yanis : montrer aussi ${guillemets(echapper(MODULES[ROLE_MODULE[c.role]].nom))}.`) : ""}</div>
      <h4>Modules à présenter (${max} maximum)</h4>
      <div class="choix-grille">${cartes}</div>
      <p id="demo-alerte" class="alerte-texte cache">Vous ne pouvez pas présenter plus de ${max} modules ${canal === (EN ? "Video call" : "Visio") ? (EN ? "by video call" : "en visio") : (EN ? "in one session" : "en une séance")}.</p>`),
    boutons: [
      { label: (EN ? "Cancel" : "Annuler"), action: fermerFenetre },
      { label: (EN ? "Start the demo" : "Lancer la démonstration"), classe: "btn-principal", id: "btn-lancer-demo", action: () => {
        const choisis = [...$("fenetre-corps").querySelectorAll('input[name="module"]:checked')].map(i => i.value);
        fermerFenetre();
        evaluerDemonstration(n, a, choisis, canal);
      } }
    ],
    onOuverture: racine => {
      lierCartesChoix(racine);
      const maj = () => {
        const nb = racine.querySelectorAll('input[name="module"]:checked').length;
        $("demo-alerte").classList.toggle("cache", nb <= max);
        $("btn-lancer-demo").disabled = nb === 0 || nb > max;
      };
      racine.addEventListener("change", maj);
      maj();
    }
  });
}

function evaluerDemonstration(n, a, choisis, canal) {
  const c = a.c;
  avancerTemps(60);
  const besoins = c.pains.map(p => PAINS[p].module);
  const moduleRole = ROLE_MODULE[c.role];
  const couverts = besoins.filter(m => choisis.includes(m));
  const horsSujet = choisis.filter(m => !besoins.includes(m) && m !== moduleRole);
  const connusNonMontres = a.painsReveles.filter(p => !choisis.includes(PAINS[p].module));
  let texte, signal, resultat;
  const il = pronom(c);
  if (!a.serieux) {
    resultat = "demo_ko";
    texte = (EN ? "“It's interesting, but honestly we're not ready to start a project. Get back to us next year.”" : "« C'est intéressant, mais honnêtement nous ne sommes pas prêts à lancer un projet. Recontactez-nous l'an prochain. »");
    signal = canal === (EN ? "In person" : "Présentiel") ? (EN ? `<strong>Body language:</strong> ${il} listens politely but takes no notes.` : `<strong>Non-verbal :</strong> ${il} écoute poliment mais ne prend aucune note.`) : (EN ? "<strong>On screen:</strong> looking elsewhere, camera switched off halfway through." : "<strong>À l'écran :</strong> regard ailleurs, caméra coupée à mi-parcours.");
    manque((EN ? `${c.entreprise}: demo with no follow-up, no real project.` : `${c.entreprise} : démonstration sans suite, pas de projet réel.`), "ciblage");
  } else if (couverts.length === besoins.length) {
    resultat = "rdv";
    n.rdv++;
    texte = (EN ? "“That's exactly what we need. Send us a proposal, let's meet next week to discuss it.”" : "« C'est exactement ce dont nous avons besoin. Envoyez-nous une proposition, on se revoit la semaine prochaine pour en parler. »");
    signal = canal === (EN ? "In person" : "Présentiel") ? (EN ? `<strong>Body language:</strong> ${il} leans towards the screen and calls a colleague over to show them.` : `<strong>Non-verbal :</strong> ${il} se penche vers l'écran et appelle un collègue pour lui montrer.`) : (EN ? "<strong>On screen:</strong> smiles, note-taking, questions about the roll-out." : "<strong>À l'écran :</strong> sourire, prise de notes, questions sur le déploiement.");
    reussite((EN ? `${c.entreprise}: successful tailored demo, proposal meeting secured.` : `${c.entreprise} : démonstration personnalisée réussie, rendez-vous de proposition obtenu.`), "argumentation", { muet: true });
    if (choisis.includes(moduleRole)) evaluer("ecoute", 1);
    if (horsSujet.length >= 2) concession((EN ? `${c.entreprise}: demo a bit long (${horsSujet.length} off-topic modules).` : `${c.entreprise} : démonstration un peu longue (${horsSujet.length} modules hors sujet).`), "ecoute");
  } else {
    resultat = "demo_ko";
    const manquant = c.pains.find(p => !choisis.includes(PAINS[p].module));
    texte = (EN ? `“Interesting… but I still don't see how it solves our problem: ${PAINS[manquant].court.toLowerCase()}.”` : `« Intéressant… mais je ne vois toujours pas comment ça règle notre problème : ${PAINS[manquant].court.toLowerCase()}. »`);
    signal = canal === (EN ? "In person" : "Présentiel") ? (EN ? `<strong>Body language:</strong> ${il} checks their watch and crosses their arms.` : `<strong>Non-verbal :</strong> ${il} regarde sa montre et croise les bras.`) : (EN ? "<strong>On screen:</strong> you're asked to speed up, another meeting is waiting." : "<strong>À l'écran :</strong> on vous demande d'accélérer, un autre rendez-vous attend.");
    if (connusNonMontres.length) erreur((EN ? `${c.entreprise}: catalogue demo, the stated need (${connusNonMontres.map(p => PAINS[p].court.toLowerCase()).join(", ")}) wasn't shown.` : `${c.entreprise} : démonstration catalogue, le besoin exprimé (${connusNonMontres.map(p => PAINS[p].court.toLowerCase()).join(", ")}) n'a pas été montré.`), "argumentation");
    else manque((EN ? `${c.entreprise}: issue not identified during discovery, the demo misses the point.` : `${c.entreprise} : problématique non identifiée pendant la découverte, la démonstration tombe à côté.`), "questionnement");
  }
  a.etat = resultat;
  ouvrirEntretien({
    interlocuteur: interlocuteurDe(c), canal, signal, texte,
    choix: [{ label: (EN ? "End the demo" : "Terminer la démonstration"), action: () => { fermerEntretien(); verifierFinM3(n); } }]
  });
}

/* ---------------------------------------------------------------------
   MISSION 4 · DÉCISION (jaune)
   Proposition (configurateur et délégation de remise), soutenance et
   négociation, relance jusqu'à la signature.
   --------------------------------------------------------------------- */
const ETATS_M4 = {
  proposition: [(EN ? "Proposal to build" : "Proposition à construire"), "neutre"], soutenance: [(EN ? "Presentation to deliver" : "Soutenance à mener"), "info"],
  reflexion: [(EN ? "Thinking it over" : "En réflexion"), "alerte"], relance: [(EN ? "To follow up" : "À relancer"), "ko"], signe: [(EN ? "Signed" : "Signé"), "ok"], perdu: [(EN ? "Lost" : "Perdu"), "ko"]
};

const M4 = {
  id: "decision", phase: "Closing", couleur: "#92400e", texteCouleur: "#ffffff",
  transition: [(EN ? "Opportunity" : "Opportunité"), (EN ? "Customer" : "Client")],
  objectifTableau: (EN ? "Convert opportunities into lasting customers" : "Convertir les opportunités en clients durables"),
  activitesTableau: (EN ? "Right-sized proposal, negotiation, follow-ups" : "Proposition au juste besoin, négociation, relances"),
  kpiTableau: (EN ? "Closing rate, projected CLV, average discount, CPA" : "Taux de closing, CLV projetée, remise moyenne, CPA"),
  reflexeRequin: (EN ? "Forcing the signature with a maximum discount, false urgency and extra licences: the customer signs… and leaves at the first renewal. A lasting conversion sizes to the real need, concedes only in exchange for something and signs a customer who stays for years." : "Forcer la signature à coups de remise maximale, de fausse urgence et de licences en trop : le client signe… et part au premier renouvellement. Une conversion durable dimensionne au juste besoin, ne concède que contre contrepartie et signe un client qui reste des années."),
  mode: { terrain: (EN ? "Presentations in a client room" : "Soutenances en salon client"), sedentaire: (EN ? "Video presentations" : "Soutenances en visio") },
  titre: (EN ? "Convert opportunities into customers" : "Convertir les opportunités en clients"),
  contexte: (EN ? "End of quarter. Three opportunities have passed the demo stage and are waiting for a proposal. You have eight business days to build your proposals, present them, negotiate and follow up until signature." : "Fin de trimestre. Trois opportunités ont passé l'étape de la démonstration et attendent une proposition. Vous avez huit jours ouvrés pour construire vos propositions, les soutenir, négocier et relancer jusqu'à la signature."),
  objectifBusiness: (EN ? "Last stage of the funnel: turn opportunities into customers, with a signature that sets up a lasting relationship (CLV is decided from the proposal onwards). Key activities: proposal, negotiation, follow-ups. KPIs: closing rate, customer acquisition cost (CPA), sales cycle, average deal size." : "Dernier étage du tunnel : transformer les opportunités en clients, avec une signature qui prépare une relation durable (la CLV se joue dès la proposition). Activités clés : proposition, négociation, relances. Indicateurs : taux de closing, coût d'acquisition (CPA), cycle de vente, panier moyen."),
  params: {
    standard: { objectif: 2, fenetre: 900, objections: 2, nb: 3 },
    confirme: { objectif: 3, fenetre: 600, objections: 3, nb: 4 }
  },
  periode: () => ({ debut: 0, fin: 8 * JOURNEE, rythme: 14, affichage: "semaine-heure" }),
  depart: () => ({ x: POINT_POSTE.x, z: POINT_POSTE.z, angle: Math.PI }),
  mission: p => (EN ? `Convert at least ${p.objectif} of ${p.nb} opportunities into customers within eight business days, without exceeding your discount authority: aim for customers who will stay (CLV).` : `Convertissez au moins ${p.objectif} opportunités sur ${p.nb} en clients en huit jours ouvrés, sans sortir de votre délégation de remise : visez des clients qui resteront (CLV).`),
  consignes: p => [
    (EN ? "Build each proposal in the configurator: plan, number of licences, commitment, options and discount. Size to the real need." : "Construisez chaque proposition dans le configurateur : offre, nombre de licences, engagement, options et remise. Dimensionnez au juste besoin."),
    (EN ? `Authority: up to ${DELEGATION.autonomie}% discount on your own. Beyond that, go and see Sandrine Morel (Sales Director) in her office with a solid trade-off.` : `Délégation : jusqu'à ${DELEGATION.autonomie} % de remise en autonomie. Au-delà, allez voir Sandrine Morel (directrice commerciale) au plateau avec une contrepartie solide.`),
    (EN ? "Presentation: recall the stakes, choose the argument that matches the customer's dominant motive (SONCAS), handle their objections, lock in the next steps." : "Soutenance : rappelez les enjeux, choisissez l'argument qui correspond à la motivation dominante (SONCAS) du client, traitez ses objections, verrouillez la suite."),
    (EN ? `After the presentation, the customer thinks it over: follow up as soon as they are “To follow up”, within ${joursTexte(p.fenetre)}, otherwise the competition signs.` : `Après la soutenance, le client réfléchit : relancez-le dès qu'il est « À relancer », dans un délai de ${joursTexte(p.fenetre)}, sinon la concurrence signe.`)
  ],
  profilNote: () => estTerrain()
    ? (EN ? "Field profile: presentations take place face to face, in the client rooms on the floor. Face to face gives you access to body language, but each in-person meeting takes time and increases acquisition cost. Your follow-ups can be done by phone." : "Profil terrain : les soutenances ont lieu en face à face, dans les salons clients de l'étage. Le face à face vous donne accès au non-verbal, mais chaque rendez-vous présentiel mobilise du temps et augmente le coût d'acquisition. Vos relances peuvent se faire par téléphone.")
    : (EN ? "Inside sales profile: you build, present and follow up your proposals from your desk (video and phone). Signals are subtler: listen to the tone and the on-screen reactions." : "Profil sédentaire : vous construisez, soutenez et relancez vos propositions depuis votre poste (visio et téléphone). Les signaux sont plus discrets : écoutez le ton et les réactions à l'écran."),
  criteres: p => [
    (EN ? `Success: at least ${p.objectif} signatures out of ${p.nb} opportunities.` : `Réussite : au moins ${p.objectif} signatures sur ${p.nb} opportunités.`),
    (EN ? "Excellence: all opportunities signed, average discount ≤ 10% and at most one error · Proficient: target reached with an average discount ≤ 12%." : "Excellence : toutes les opportunités signées, remise moyenne ≤ 10 % et au plus une erreur · Maîtrise : objectif atteint avec une remise moyenne ≤ 12 %."),
    (EN ? "Errors: wrongly sized plan or licences, discount beyond authority or trade-off not honoured, disparagement or false information, false urgency, pressure, forgotten follow-up." : "Erreurs : offre ou licences mal dimensionnées, remise hors délégation ou contrepartie non respectée, dénigrement ou fausse information, fausse urgence, pression, relance oubliée.")
  ],
  aRetenir: (EN ? "Signing means proposing the plan that fits the need, arguing according to the customer's motive, handling objections with questions and proof, and conceding only in exchange for something. A value-adding follow-up at the right time makes the difference. Every discount reduces the average deal size; every lost day lengthens the sales cycle." : "Signer, c'est proposer l'offre qui correspond au besoin, argumenter selon la motivation du client, traiter les objections par le questionnement et la preuve, et concéder uniquement contre une contrepartie. Une relance à valeur ajoutée, au bon moment, fait la différence. Chaque remise réduit le panier moyen ; chaque jour perdu allonge le cycle de vente."),
  conseilEchec: (EN ? "Check the sizing before sending, stay within your authority (or get your director's approval with a trade-off), answer objections with a question then proof, and keep an eye on follow-ups." : "Vérifiez le dimensionnement avant d'envoyer, restez dans votre délégation (ou obtenez l'accord de votre directrice avec une contrepartie), répondez aux objections par une question puis une preuve, et surveillez les relances."),

  demarrer(n, p) {
    Object.assign(n, { p, opps: [] });
    const petits = melanger(["fidelio", "belvue"]);
    const moyens = melanger(["batinord", "medilys", "optiwatt", "transalp"]);
    const cles = [petits[0], moyens[0], "larcher"];
    if (p.nb > 3) cles.push(moyens[1]);
    cles.forEach(cle => {
      const c = COMPTES[cle];
      const o = {
        id: cle, c, etat: "proposition", proposition: null, calc: null, approbation: 0, condition: null,
        confiance: 50, age: entier(18, 32), debut: null, heures: 0, deplacements: 0, minuteur: 0, signature: null, relanceLongue: false
      };
      o.pnj = placerContact(c);
      o.inter = ajouterInteractif({
        x: c.batiment.porte.x, z: c.batiment.porte.z, rayon: 2.6, label: (EN ? `presentation with ${c.entreprise} (${c.batiment.nom})` : `soutenance avec ${c.entreprise} (${c.batiment.nom})`),
        action: () => soutenance(n, o), actif: false
      });
      n.opps.push(o);
    });
    activerCollegue("manager", (EN ? "ask Sandrine to approve a discount" : "demander une validation de remise à Sandrine"), () => demanderValidation(n));
  },
  auDemarrage() {
    ouvrirPanneau((EN ? "CRM · Opportunities at decision stage" : "CRM · Opportunités en phase de décision"), estTerrain() ? (EN ? "Presentations in a client room · follow-ups by phone" : "Soutenances en salon client · relances par téléphone") : (EN ? "Video presentations from your desk" : "Soutenances en visio depuis votre poste"));
  },
  ciblesCarte: n => n.opps.filter(o => o.etat === "soutenance").map(o => o.id),
  maj(n, dt, dmin) {
    n.opps.forEach(o => {
      o.inter.actif = estTerrain() && o.etat === "soutenance";
      if (o.etat === "reflexion") {
        o.minuteur -= dmin;
        if (o.minuteur <= 0) {
          o.etat = "relance";
          o.minuteur = n.p.fenetre;
          son("sonnerie");
          message((EN ? `${o.c.contact} (${o.c.entreprise}) is waiting for your follow-up.` : `${o.c.contact} (${o.c.entreprise}) attend votre relance.`), "info");
        }
      } else if (o.etat === "relance") {
        o.minuteur -= dmin;
        if (o.minuteur <= 0) {
          o.etat = "perdu";
          erreur((EN ? `Forgotten follow-up: ${o.c.entreprise} signs with ${CONCURRENTS[o.c.concurrent].nom}.` : `Relance oubliée : ${o.c.entreprise} signe avec ${CONCURRENTS[o.c.concurrent].nom}.`), "closing");
          verifierFinM4(n);
        }
      }
      const [texte, type] = ETATS_M4[o.etat];
      majEtiquette(o.pnj.etiquette, `${o.c.contact} · ${o.c.entreprise} · ${texte}`, o.etat === "soutenance" && estTerrain() ? "etq-cible" : type === "ok" ? "etq-ok" : type === "ko" ? "etq-ko" : "");
    });
  },
  stats(n) {
    const signes = n.opps.filter(o => o.etat === "signe");
    const ca = signes.reduce((s, o) => s + o.signature.arr, 0);
    const remises = signes.map(o => o.proposition.remise);
    const coutCommercial = n.opps.reduce((s, o) => s + o.heures * COUT_HORAIRE + o.deplacements * COUT_DEPLACEMENT, 0);
    return {
      signes, ca,
      clv: signes.reduce((t, o) => t + o.signature.arr * MARGE_BRUTE * o.signature.duree, 0),
      duree: signes.length ? signes.reduce((t, o) => t + o.signature.duree, 0) / signes.length : 0,
      panier: signes.length ? ca / signes.length : 0,
      remise: remises.length ? remises.reduce((a, b) => a + b, 0) / remises.length : 0,
      cycle: signes.length ? signes.reduce((s, o) => s + o.signature.cycle, 0) / signes.length : 0,
      cpa: signes.length ? coutCommercial / signes.length : Infinity,
      catalogue: signes.length ? signes.reduce((s, o) => s + o.calc.brut, 0) / signes.length : 0
    };
  },
  tunnel: n => ({
    de: (EN ? "Opportunity" : "Opportunité"), vers: (EN ? "Customer" : "Client"),
    etapes: [
      { label: (EN ? "Opportunities" : "Opportunités"), court: (EN ? "opportunities" : "opportunités"), valeur: n.opps.length },
      { label: (EN ? "Proposals sent" : "Propositions envoyées"), court: (EN ? "proposals" : "propositions"), valeur: n.opps.filter(o => o.calc).length },
      { label: (EN ? "Presentations delivered" : "Soutenances menées"), court: (EN ? "presentations" : "soutenances"), valeur: n.opps.filter(o => o.soutenue).length },
      { label: (EN ? "Customers signed" : "Clients signés"), court: (EN ? "customers" : "clients"), valeur: n.opps.filter(o => o.etat === "signe").length }
    ]
  }),
  hud(n) {
    const p = n.p, s = M4.stats(n);
    hudJauge((EN ? "Customers signed" : "Clients signés"), (s.signes.length / p.objectif) * 100, `${s.signes.length} / ${p.objectif}`);
    hudKpis([
      { label: (EN ? "Signed ARR" : "ARR signé"), valeur: euros(s.ca) },
      { label: (EN ? "Projected CLV" : "CLV projetée"), valeur: s.signes.length ? euros(s.clv) : "—" },
      { label: (EN ? "Average discount" : "Remise moyenne"), valeur: s.signes.length ? pourcent(s.remise) : "—", alerte: s.remise > 10 },
      { label: (EN ? "To follow up" : "À relancer"), valeur: `${n.opps.filter(o => o.etat === "relance").length}`, alerte: n.opps.some(o => o.etat === "relance") }
    ]);
  },
  panneau(n) {
    let h = (EN ? `<div class="pm-note">Authority: <strong>${DELEGATION.autonomie}%</strong> on your own, up to <strong>${DELEGATION.manager}%</strong> with Sandrine Morel's approval. The guide (G) recaps the offer and the SONCAS method.</div>` : `<div class="pm-note">Délégation : <strong>${DELEGATION.autonomie} %</strong> en autonomie, jusqu'à <strong>${DELEGATION.manager} %</strong> avec l'accord de Sandrine Morel. Le guide (G) rappelle l'offre et la méthode SONCAS.</div>`);
    n.opps.forEach(o => {
      const c = o.c;
      const [etat, type] = ETATS_M4[o.etat];
      let actions = "", infoEtat = "";
      const pasAuPoste = !estTerrain() && !auPoste();
      if (o.etat === "proposition") {
        actions = boutonPm((EN ? "Build the proposal" : "Construire la proposition"), "proposer", o.id, { principal: true, desactive: pasAuPoste, titre: pasAuPoste ? (EN ? "Go back to your desk" : "Retournez à votre poste") : "" });
      } else if (o.etat === "soutenance") {
        if (estTerrain()) {
          const proche = procheBatiment(o.id);
          actions = boutonPm(proche ? (EN ? "Deliver the presentation" : "Mener la soutenance") : (EN ? `Go to the ${c.batiment.nom} · ${distanceMetres(c.batiment.porte)} m` : `Rejoindre le ${c.batiment.nom} · ${distanceMetres(c.batiment.porte)} m`), "soutenir", o.id, { principal: true, desactive: !proche });
        } else {
          actions = boutonPm((EN ? "Video presentation" : "Soutenance en visio"), "soutenir", o.id, { principal: true, desactive: pasAuPoste, titre: pasAuPoste ? (EN ? "Go back to your desk" : "Retournez à votre poste") : "" });
        }
      } else if (o.etat === "reflexion") {
        infoEtat = (EN ? `<div class="fiche-ligne">Follow-up possible in <strong>${joursTexte(Math.max(0, o.minuteur))}</strong></div>` : `<div class="fiche-ligne">Relance possible dans <strong>${joursTexte(Math.max(0, o.minuteur))}</strong></div>`);
      } else if (o.etat === "relance") {
        infoEtat = (EN ? `<div class="fiche-ligne">Follow up before <strong>${joursTexte(Math.max(0, o.minuteur))}</strong></div>` : `<div class="fiche-ligne">À relancer avant <strong>${joursTexte(Math.max(0, o.minuteur))}</strong></div>`);
        actions = boutonPm((EN ? "Follow up by phone" : "Relancer par téléphone"), "relancer", o.id, { principal: true, desactive: pasAuPoste, titre: pasAuPoste ? (EN ? "Go back to your desk" : "Retournez à votre poste") : "" });
      } else if (o.etat === "signe") {
        infoEtat = (EN ? `<div class="fiche-ligne">Signed ARR: <strong>${euros(o.signature.arr)}</strong> · ${o.signature.cycle}-day cycle · projected CLV <strong>${euros(o.signature.arr * MARGE_BRUTE * o.signature.duree)}</strong></div>` : `<div class="fiche-ligne">ARR signé : <strong>${euros(o.signature.arr)}</strong> · cycle de ${o.signature.cycle} jours · CLV projetée <strong>${euros(o.signature.arr * MARGE_BRUTE * o.signature.duree)}</strong></div>`);
      }
      const prop = o.calc ? (EN ? `<div class="fiche-ligne">Proposal: <strong>${OFFRES[o.proposition.offre].nom}</strong>, ${o.proposition.utilisateurs} licences, ${ENGAGEMENTS[o.proposition.engagement].nom.toLowerCase()}, discount ${o.proposition.remise}% → <strong>${euros(o.calc.arr)}/year</strong></div>` : `<div class="fiche-ligne">Proposition : <strong>${OFFRES[o.proposition.offre].nom}</strong>, ${o.proposition.utilisateurs} licences, ${ENGAGEMENTS[o.proposition.engagement].nom.toLowerCase()}, remise ${o.proposition.remise} % → <strong>${euros(o.calc.arr)}/an</strong></div>`) : "";
      h += (EN ? `<div class="fiche${["soutenance", "relance"].includes(o.etat) ? " active" : ""}${["signe", "perdu"].includes(o.etat) ? " terminee" : ""}">
        <div class="fiche-entete"><span class="fiche-titre">${echapper(c.entreprise)}</span>${chip(etat, type)}</div>
        <div class="fiche-ligne"><strong>${echapper(c.contact)}</strong> · ${echapper(c.fonction)}</div>
        <div class="fiche-ligne">${echapper(c.secteur)} · ${c.effectif} employees · <strong>${c.utilisateurs} users</strong> planned</div>
        <div class="chips">${c.pains.map(p => chip(PAINS[p].court, "info")).join("")}</div>
        <div class="fiche-ligne">Current tool: ${echapper(c.existant)} · Competitor in the running: <strong>${CONCURRENTS[c.concurrent].nom}</strong></div>
        <div class="fiche-ligne">Indicative budget: <strong>≈ ${euros(c.budget)}/year</strong> · Opportunity opened ${o.age} days ago</div>
        <div class="fiche-citation">Discovery notes: ${echapper(SONCAS[c.soncas].note)}</div>
        ${o.approbation ? (EN ? `<div class="fiche-ligne">Discount approved by Sandrine: <strong>${o.approbation}%</strong>${o.condition === "triennal" ? (EN ? " (against a 3-year commitment)" : " (contre engagement 3 ans)") : ""}</div>` : `<div class="fiche-ligne">Remise validée par Sandrine : <strong>${o.approbation} %</strong>${o.condition === "triennal" ? (EN ? " (against a 3-year commitment)" : " (contre engagement 3 ans)") : ""}</div>`) : ""}
        ${prop}${infoEtat}
        ${actions ? `<div class="pm-actions">${actions}</div>` : ""}</div>` : `<div class="fiche${["soutenance", "relance"].includes(o.etat) ? " active" : ""}${["signe", "perdu"].includes(o.etat) ? " terminee" : ""}">
        <div class="fiche-entete"><span class="fiche-titre">${echapper(c.entreprise)}</span>${chip(etat, type)}</div>
        <div class="fiche-ligne"><strong>${echapper(c.contact)}</strong> · ${echapper(c.fonction)}</div>
        <div class="fiche-ligne">${echapper(c.secteur)} · ${c.effectif} salariés · <strong>${c.utilisateurs} utilisateurs</strong> prévus</div>
        <div class="chips">${c.pains.map(p => chip(PAINS[p].court, "info")).join("")}</div>
        <div class="fiche-ligne">Existant : ${echapper(c.existant)} · Concurrent en lice : <strong>${CONCURRENTS[c.concurrent].nom}</strong></div>
        <div class="fiche-ligne">Budget indicatif : <strong>≈ ${euros(c.budget)}/an</strong> · Opportunité ouverte il y a ${o.age} jours</div>
        <div class="fiche-citation">Notes de découverte : ${echapper(SONCAS[c.soncas].note)}</div>
        ${o.approbation ? (EN ? `<div class="fiche-ligne">Discount approved by Sandrine: <strong>${o.approbation}%</strong>${o.condition === "triennal" ? (EN ? " (against a 3-year commitment)" : " (contre engagement 3 ans)") : ""}</div>` : `<div class="fiche-ligne">Remise validée par Sandrine : <strong>${o.approbation} %</strong>${o.condition === "triennal" ? (EN ? " (against a 3-year commitment)" : " (contre engagement 3 ans)") : ""}</div>`) : ""}
        ${prop}${infoEtat}
        ${actions ? `<div class="pm-actions">${actions}</div>` : ""}</div>`);
    });
    return h;
  },
  commande(n, cmd, id) {
    const o = n.opps.find(x => x.id === id);
    if (!o) return;
    if (cmd === "proposer") ouvrirConfigurateur(n, o);
    if (cmd === "soutenir") soutenance(n, o);
    if (cmd === "relancer") relance(n, o);
  },
  kpis(n) {
    const p = n.p, s = M4.stats(n);
    return [
      { nom: (EN ? "Closing rate (opportunity → customer)" : "Taux de closing (opportunité → client)"), valeur: pourcent(s.signes.length / n.opps.length * 100), cible: `≥ ${pourcent(p.objectif / n.opps.length * 100)}`, ok: s.signes.length >= p.objectif },
      { nom: (EN ? "Projected CLV of signed customers" : "CLV projetée des clients signés"), valeur: s.signes.length ? euros(s.clv) : "—", cible: s.signes.length ? (EN ? `average lifetime ${ansTexte(Math.round(s.duree * 10) / 10)}` : `durée de vie moyenne ${ansTexte(Math.round(s.duree * 10) / 10)}`) : (EN ? "ARR × margin × lifetime" : "ARR × marge × durée de vie"), ok: s.signes.length ? s.duree >= 4 : null },
      { nom: (EN ? "Average deal size (ARR per contract)" : "Panier moyen (ARR par contrat)"), valeur: s.signes.length ? euros(s.panier) : "—", cible: s.signes.length ? (EN ? `${euros(s.catalogue)} at list price` : `${euros(s.catalogue)} au catalogue`) : "—", ok: s.signes.length ? s.panier >= s.catalogue * 0.9 : null },
      { nom: (EN ? "Average discount granted" : "Remise moyenne accordée"), valeur: s.signes.length ? pourcent(s.remise) : "—", cible: `≤ ${DELEGATION.autonomie} %`, ok: s.signes.length ? s.remise <= DELEGATION.autonomie : null },
      { nom: (EN ? "Average sales cycle" : "Cycle de vente moyen"), valeur: s.signes.length ? (EN ? `${Math.round(s.cycle)} days` : `${Math.round(s.cycle)} jours`) : "—", cible: (EN ? "≤ 45 days" : "≤ 45 jours"), ok: s.signes.length ? s.cycle <= 45 : null },
      { nom: (EN ? "Customer acquisition cost (CPA)" : "Coût d'acquisition (CPA)"), valeur: Number.isFinite(s.cpa) ? euros(s.cpa) : "—", cible: "≤ 600 €", ok: s.cpa <= 600 }
    ];
  },
  finTemps(n) {
    n.opps.forEach(o => { if (!["signe", "perdu"].includes(o.etat)) { o.etat = "perdu"; manque((EN ? `${o.c.entreprise}: no decision before the end of the period.` : `${o.c.entreprise} : pas de décision avant la fin de période.`), "closing"); } });
    const p = n.p, s = M4.stats(n);
    if (s.signes.length >= p.objectif) {
      const etoiles = s.signes.length === n.opps.length && s.remise <= 10 && jeu.erreurs <= 1 ? 3 : s.remise <= 12 ? 2 : 1;
      terminerNiveau(true, etoiles, (EN ? `${s.signes.length} opportunit(ies) converted into customers for ${euros(s.ca)} ARR (projected CLV ${euros(s.clv)}), with an average discount of ${pourcent(s.remise)}.` : `${s.signes.length} opportunité(s) convertie(s) en clients pour ${euros(s.ca)} d'ARR (CLV projetée ${euros(s.clv)}), avec une remise moyenne de ${pourcent(s.remise)}.`));
    } else {
      terminerNiveau(false, 0, (EN ? `${s.signes.length} contract(s) signed: at least ${p.objectif} were needed.` : `${s.signes.length} contrat(s) signé(s) : il en fallait au moins ${p.objectif}.`));
    }
  }
};

function verifierFinM4(n) {
  if (jeu.mode === "bilan") return;
  if (n.opps.every(o => ["signe", "perdu"].includes(o.etat))) {
    if (jeu.mode === "dialogue" || jeu.mode === "fenetre") return;
    M4.finTemps(n);
  }
}

function ouvrirConfigurateur(n, o) {
  if (!controleSedentaire()) return;
  const c = o.c;
  const pr = o.proposition ? JSON.parse(JSON.stringify(o.proposition)) : { offre: null, utilisateurs: c.utilisateurs, engagement: "annuel", options: { migration: false, formation: false, premium: false }, remise: 0 };
  const offres = ORDRE_OFFRES.map(k => {
    const of = OFFRES[k];
    return (EN ? `<label class="choix-carte"><input type="radio" name="offre" value="${k}"${pr.offre === k ? " checked" : ""}><span class="cc-corps"><span class="cc-titre">${of.nom} · €${of.prix}/user/month</span><span class="cc-detail">${of.fonctions.join(" · ")}</span><span class="cc-chiffres">Set-up ${euros(of.miseEnService)}${of.max < 1000 ? (EN ? ` · up to ${of.max} users` : ` · jusqu'à ${of.max} utilisateurs`) : ""}</span></span></label>` : `<label class="choix-carte"><input type="radio" name="offre" value="${k}"${pr.offre === k ? " checked" : ""}><span class="cc-corps"><span class="cc-titre">${of.nom} · ${of.prix} €/utilisateur/mois</span><span class="cc-detail">${of.fonctions.join(" · ")}</span><span class="cc-chiffres">Mise en service ${euros(of.miseEnService)}${of.max < 1000 ? (EN ? ` · up to ${of.max} users` : ` · jusqu'à ${of.max} utilisateurs`) : ""}</span></span></label>`);
  }).join("");
  const engagements = Object.entries(ENGAGEMENTS).map(([k, e]) => `<label><input type="radio" name="engagement" value="${k}"${pr.engagement === k ? " checked" : ""}>${e.nom} <span class="cc-detail">(${e.detail})</span></label>`).join("");
  const options = Object.entries(OPTIONS).map(([k, op]) => `<label class="choix-carte"><input type="checkbox" name="option" value="${k}"${pr.options[k] ? " checked" : ""}><span class="cc-corps"><span class="cc-titre">${op.nom}</span><span class="cc-detail">${op.detail}${op.prix ? ` · ${euros(op.prix)}` : ""}</span></span></label>`).join("");
  const remises = [0, 5, 10, 15, 20, 25].map(r => `<label><input type="radio" name="remise" value="${r}"${pr.remise === r ? " checked" : ""}>${r} %</label>`).join("");
  ouvrirFenetre({
    titre: (EN ? `Sales proposal · ${c.entreprise}` : `Proposition commerciale · ${c.entreprise}`),
    sousTitre: (EN ? `${c.contact}, ${c.fonction} · indicative budget ≈ ${euros(c.budget)}/year` : `${c.contact}, ${c.fonction} · budget indicatif ≈ ${euros(c.budget)}/an`),
    large: true,
    corps: (EN ? `
      <div class="fiche-client"><strong>Stated need</strong>: ${c.utilisateurs} users · ${c.pains.map(p => PAINS[p].court.toLowerCase()).join(", ")} · current tool: ${echapper(c.existant.toLowerCase())}.</div>
      <div class="config">
        <div>
          <div class="config-champ"><span class="config-label">Plan</span><div class="choix-liste">${offres}</div></div>
          <div class="config-champ"><span class="config-label">Number of licences</span>
            <div class="stepper"><button type="button" data-pas="-1">−</button><input id="cfg-utilisateurs" type="number" min="1" max="300" value="${pr.utilisateurs}"><button type="button" data-pas="1">+</button></div></div>
          <div class="config-champ"><span class="config-label">Commitment</span><div class="segment-config">${engagements}</div></div>
          <div class="config-champ"><span class="config-label">Options</span><div class="choix-grille">${options}</div></div>
          <div class="config-champ"><span class="config-label">Subscription discount</span><div class="segment-config">${remises}</div></div>
        </div>
        <div>
          <div class="recap" id="cfg-recap"></div>
          <p id="cfg-delegation" class="info-texte"></p>
        </div>
      </div>` : `
      <div class="fiche-client"><strong>Besoin exprimé</strong> : ${c.utilisateurs} utilisateurs · ${c.pains.map(p => PAINS[p].court.toLowerCase()).join(", ")} · existant : ${echapper(c.existant.toLowerCase())}.</div>
      <div class="config">
        <div>
          <div class="config-champ"><span class="config-label">Offre</span><div class="choix-liste">${offres}</div></div>
          <div class="config-champ"><span class="config-label">Nombre de licences</span>
            <div class="stepper"><button type="button" data-pas="-1">−</button><input id="cfg-utilisateurs" type="number" min="1" max="300" value="${pr.utilisateurs}"><button type="button" data-pas="1">+</button></div></div>
          <div class="config-champ"><span class="config-label">Engagement</span><div class="segment-config">${engagements}</div></div>
          <div class="config-champ"><span class="config-label">Options</span><div class="choix-grille">${options}</div></div>
          <div class="config-champ"><span class="config-label">Remise sur l'abonnement</span><div class="segment-config">${remises}</div></div>
        </div>
        <div>
          <div class="recap" id="cfg-recap"></div>
          <p id="cfg-delegation" class="info-texte"></p>
        </div>
      </div>`),
    boutons: [
      { label: (EN ? "Cancel" : "Annuler"), action: fermerFenetre },
      { label: (EN ? "Send the proposal" : "Envoyer la proposition"), classe: "btn-principal", id: "btn-envoyer-proposition", action: () => { const p = lireConfigurateur(); if (p.offre) envoyerProposition(n, o, p); } }
    ],
    onOuverture: racine => {
      lierCartesChoix(racine);
      racine.querySelectorAll(".stepper button").forEach(b => b.addEventListener("click", () => {
        const input = $("cfg-utilisateurs");
        input.value = clamp((parseInt(input.value, 10) || 1) + parseInt(b.dataset.pas, 10), 1, 300);
        majRecap();
      }));
      racine.addEventListener("change", majRecap);
      racine.addEventListener("input", majRecap);
      majRecap();
    }
  });
  function lireConfigurateur() {
    const r = $("fenetre-corps");
    const opts = {};
    Object.keys(OPTIONS).forEach(k => { opts[k] = !!r.querySelector(`input[name="option"][value="${k}"]:checked`); });
    const offre = r.querySelector('input[name="offre"]:checked');
    return {
      offre: offre ? offre.value : null,
      utilisateurs: clamp(parseInt($("cfg-utilisateurs").value, 10) || 1, 1, 300),
      engagement: r.querySelector('input[name="engagement"]:checked').value,
      options: opts,
      remise: parseInt(r.querySelector('input[name="remise"]:checked').value, 10)
    };
  }
  function majRecap() {
    const p = lireConfigurateur();
    $("btn-envoyer-proposition").disabled = !p.offre;
    if (!p.offre) {
      $("cfg-recap").innerHTML = (EN ? '<p class="pm-vide">Choose the plan that fits the customer\'s need to calculate the proposal.</p>' : '<p class="pm-vide">Choisissez l\'offre adaptée au besoin du client pour calculer la proposition.</p>');
      $("cfg-delegation").textContent = "";
      return;
    }
    const k = calculerProposition(p);
    $("cfg-recap").innerHTML = (EN ? `<table>
      <tr><td>Unit price (${ENGAGEMENTS[p.engagement].nom.toLowerCase()})</td><td>${eurosPrecis(k.prixUnitaire)} /month</td></tr>
      <tr><td>Annual subscription (${p.utilisateurs} licences)</td><td>${euros(k.abonnement)}</td></tr>
      ${k.premium ? (EN ? `<tr><td>Premium support</td><td>${euros(k.premium)}</td></tr>` : `<tr><td>Support premium</td><td>${euros(k.premium)}</td></tr>`) : ""}
      <tr><td>Discount (${p.remise}%)</td><td>− ${euros(k.brut - k.arr)}</td></tr>
      <tr class="total"><td>ARR (annual recurring revenue)</td><td>${euros(k.arr)}</td></tr>
      <tr><td>Set-up and options</td><td>${euros(k.miseEnService)}</td></tr>
      <tr class="total"><td>First-year total</td><td>${euros(k.total)}</td></tr></table>` : `<table>
      <tr><td>Prix unitaire (${ENGAGEMENTS[p.engagement].nom.toLowerCase()})</td><td>${eurosPrecis(k.prixUnitaire)} /mois</td></tr>
      <tr><td>Abonnement annuel (${p.utilisateurs} licences)</td><td>${euros(k.abonnement)}</td></tr>
      ${k.premium ? (EN ? `<tr><td>Premium support</td><td>${euros(k.premium)}</td></tr>` : `<tr><td>Support premium</td><td>${euros(k.premium)}</td></tr>`) : ""}
      <tr><td>Remise (${p.remise} %)</td><td>− ${euros(k.brut - k.arr)}</td></tr>
      <tr class="total"><td>ARR (revenu annuel récurrent)</td><td>${euros(k.arr)}</td></tr>
      <tr><td>Mise en service et options</td><td>${euros(k.miseEnService)}</td></tr>
      <tr class="total"><td>Total première année</td><td>${euros(k.total)}</td></tr></table>`);
    const d = $("cfg-delegation");
    if (p.remise > DELEGATION.manager) d.innerHTML = (EN ? `<span class="alerte-texte">Beyond ${DELEGATION.manager}%, the discount is outside the sales policy.</span>` : `<span class="alerte-texte">Au-delà de ${DELEGATION.manager} %, la remise est hors politique commerciale.</span>`);
    else if (p.remise > DELEGATION.autonomie) d.innerHTML = o.approbation >= p.remise ? (EN ? `Discount approved by Sandrine Morel up to ${o.approbation}%${o.condition === "triennal" ? (EN ? ", against a 3-year commitment" : ", contre un engagement de 3 ans") : ""}.` : `Remise validée par Sandrine Morel jusqu'à ${o.approbation} %${o.condition === "triennal" ? (EN ? ", against a 3-year commitment" : ", contre un engagement de 3 ans") : ""}.`) : (EN ? `<span class="alerte-texte">Discount above ${DELEGATION.autonomie}%: Sandrine Morel's approval required before sending.</span>` : `<span class="alerte-texte">Remise supérieure à ${DELEGATION.autonomie} % : accord de Sandrine Morel requis avant l'envoi.</span>`);
    else d.textContent = (EN ? `Discount within your authority (≤ ${DELEGATION.autonomie}%).` : `Remise dans votre délégation (≤ ${DELEGATION.autonomie} %).`);
  }
}

function envoyerProposition(n, o, pr) {
  const c = o.c;
  const req = offreRequise(c);
  const idx = k => ORDRE_OFFRES.indexOf(k);
  if (pr.remise > DELEGATION.autonomie && (pr.remise > o.approbation)) {
    erreur((EN ? `${pr.remise}% discount beyond your authority for ${c.entreprise}: your director's approval is required.` : `Remise de ${pr.remise} % hors délégation pour ${c.entreprise} : l'accord de votre directrice est requis.`), "negociation");
    return;
  }
  if (pr.remise > DELEGATION.autonomie && o.condition === "triennal" && pr.engagement !== "triennal") {
    erreur((EN ? `${c.entreprise}: the approved discount was conditional on a 3-year commitment.` : `${c.entreprise} : la remise validée était conditionnée à un engagement de 3 ans.`), "negociation");
    return;
  }
  if (idx(pr.offre) < idx(req)) {
    erreur((EN ? `${OFFRES[pr.offre].nom} plan undersized for ${c.entreprise}: ${raisonOffre(c)}.` : `Offre ${OFFRES[pr.offre].nom} sous-dimensionnée pour ${c.entreprise} : ${raisonOffre(c)}.`), "produit");
    return;
  }
  if (idx(pr.offre) > idx(req)) {
    erreur((EN ? `${OFFRES[pr.offre].nom} plan oversized for ${c.entreprise}: the ${OFFRES[req].nom} plan is enough (${raisonOffre(c)}).` : `Offre ${OFFRES[pr.offre].nom} surdimensionnée pour ${c.entreprise} : l'offre ${OFFRES[req].nom} suffit (${raisonOffre(c)}).`), "produit");
    return;
  }
  if (pr.utilisateurs < c.utilisateurs) {
    erreur((EN ? `${c.entreprise}: ${pr.utilisateurs} licences for ${c.utilisateurs} planned users, the proposal is undersized.` : `${c.entreprise} : ${pr.utilisateurs} licences pour ${c.utilisateurs} utilisateurs prévus, la proposition est sous-dimensionnée.`), "produit");
    return;
  }
  if (pr.utilisateurs > Math.ceil(c.utilisateurs * 1.2)) {
    erreur((EN ? `${c.entreprise}: ${pr.utilisateurs} licences for ${c.utilisateurs} planned users, the proposal is oversized.` : `${c.entreprise} : ${pr.utilisateurs} licences pour ${c.utilisateurs} utilisateurs prévus, la proposition est surdimensionnée.`), "produit");
    return;
  }
  fermerFenetre();
  o.proposition = pr;
  o.calc = calculerProposition(pr);
  o.etat = "soutenance";
  o.heures += 1.5;
  if (o.debut === null) o.debut = jeu.minutes;
  avancerTemps(90);
  reussite((EN ? `${c.entreprise}: ${OFFRES[pr.offre].nom} proposal sized to the real need (${euros(o.calc.arr)}/year).` : `${c.entreprise} : proposition ${OFFRES[pr.offre].nom} dimensionnée au juste besoin (${euros(o.calc.arr)}/an).`), "produit", { silencieux: true, muet: true });
  if (pr.options.premium && req === "essentiel") concession((EN ? `${c.entreprise}: premium support unnecessary for a small team.` : `${c.entreprise} : support premium superflu pour une petite équipe.`), "produit", true);
  if (c.migration && pr.options.migration) evaluer("produit", 1);
  if (pr.remise > 0 && pr.engagement !== "triennal") concession((EN ? `${c.entreprise}: ${pr.remise}% discount granted upfront, with nothing in return.` : `${c.entreprise} : remise de ${pr.remise} % accordée d'emblée, sans contrepartie.`), "negociation", true);
  message((EN ? `Proposal sent to ${c.contact}. ${estTerrain() ? (EN ? `Go to the ${c.batiment.nom} for the presentation.` : `Rejoignez le ${c.batiment.nom} pour la soutenance.`) : (EN ? "Schedule the video presentation." : "Planifiez la soutenance en visio.")}` : `Proposition envoyée à ${c.contact}. ${estTerrain() ? (EN ? `Go to the ${c.batiment.nom} for the presentation.` : `Rejoignez le ${c.batiment.nom} pour la soutenance.`) : (EN ? "Schedule the video presentation." : "Planifiez la soutenance en visio.")}`), "ok");
}

function demanderValidation(n) {
  const inter = interlocuteurCollegue("manager");
  const eligibles = n.opps.filter(o => ["proposition", "soutenance"].includes(o.etat));
  if (!eligibles.length) {
    ouvrirEntretien({ interlocuteur: inter, canal: (EN ? "Sales floor" : "Plateau"), texte: (EN ? "“You don't have a proposal in progress. Focus on your follow-ups!”" : "« Tu n'as pas de proposition en cours de construction. Concentre-toi sur tes relances ! »"), choix: [{ label: (EN ? "Got it" : "Bien reçu"), action: fermerEntretien }] });
    return;
  }
  const justifier = (o, niveau) => ouvrirEntretien({
    interlocuteur: inter, canal: (EN ? "Sales floor" : "Plateau"),
    texte: (EN ? `“${niveau}% for ${o.c.entreprise}? What justifies it?”` : `« ${niveau} % pour ${o.c.entreprise} ? Qu'est-ce qui le justifie ? »`),
    choix: melangerChoix([
      { label: (EN ? "“In exchange for a 3-year commitment and a customer testimonial.”" : "« En contrepartie d'un engagement de 3 ans et d'un témoignage client. »"), action: () => {
        avancerTemps(15);
        if (niveau > DELEGATION.manager) {
          manque((EN ? `${niveau}% request refused: outside the sales policy.` : `Demande de ${niveau} % refusée : hors politique commerciale.`), "negociation");
          ouvrirEntretien({ interlocuteur: inter, canal: (EN ? "Sales floor" : "Plateau"), texte: (EN ? `“Beyond ${DELEGATION.manager}%, it's no, even with a commitment. It's outside our sales policy.”` : `« Au-delà de ${DELEGATION.manager} %, c'est non, même avec un engagement. C'est hors de notre politique commerciale. »`), choix: [{ label: (EN ? "Understood" : "Compris"), action: fermerEntretien }] });
        } else {
          o.approbation = niveau;
          o.condition = "triennal";
          reussite((EN ? `${niveau}% discount approved for ${o.c.entreprise}, against a 3-year commitment.` : `Remise de ${niveau} % validée pour ${o.c.entreprise}, contre un engagement de 3 ans.`), "negociation", { silencieux: true, muet: true });
          ouvrirEntretien({ interlocuteur: inter, canal: (EN ? "Sales floor" : "Plateau"), texte: (EN ? `“OK for ${niveau}%, provided the 3-year commitment is clearly in the proposal.”` : `« D'accord pour ${niveau} %, à condition que l'engagement de 3 ans figure bien dans la proposition. »`), choix: [{ label: (EN ? "Thanks Sandrine" : "Merci Sandrine"), action: fermerEntretien }] });
        }
      } },
      { label: (EN ? "“The customer thinks it's too expensive.”" : "« Le client trouve que c'est trop cher. »"), action: () => {
        avancerTemps(15);
        manque((EN ? `Discount request with nothing in return refused (${o.c.entreprise}).` : `Demande de remise sans contrepartie refusée (${o.c.entreprise}).`), "negociation");
        ouvrirEntretien({ interlocuteur: inter, canal: (EN ? "Sales floor" : "Plateau"), texte: (EN ? "“Without something in return, I won't approve it. Did you dig into the objection? Come back with a commitment in exchange.”" : "« Sans contrepartie, je ne valide pas. As-tu creusé l'objection ? Reviens avec un engagement en échange. »"), choix: [{ label: (EN ? "Understood" : "Compris"), action: fermerEntretien }] });
      } },
      { label: (EN ? "“Otherwise we'll lose the deal to the competition.”" : "« Sinon, nous allons perdre l'affaire face à la concurrence. »"), action: () => {
        avancerTemps(15);
        manque((EN ? `Discount request refused for lack of arguments (${o.c.entreprise}).` : `Demande de remise refusée faute d'argumentation (${o.c.entreprise}).`), "negociation");
        ouvrirEntretien({ interlocuteur: inter, canal: (EN ? "Sales floor" : "Plateau"), texte: (EN ? "“Have you really demonstrated the value? Compare scopes with the competition sheet before slashing the price.”" : "« As-tu vraiment démontré la valeur ? Compare les périmètres avec la fiche concurrence avant de brader le prix. »"), choix: [{ label: (EN ? "Understood" : "Compris"), action: fermerEntretien }] });
      } }
    ])
  });
  ouvrirEntretien({
    interlocuteur: inter, canal: (EN ? "Sales floor" : "Plateau"),
    texte: (EN ? "“You want a discount approved? For which deal, and at what level?”" : "« Tu veux une validation de remise ? Pour quel dossier, et à quel niveau ? »"),
    choix: eligibles.flatMap(o => [15, 20, 25].map(niv => ({ label: `${o.c.entreprise} · ${niv} %`, action: () => justifier(o, niv) })))
      .concat([{ label: "Finalement, rien", action: fermerEntretien }])
  });
}

const OBJECTIONS = {
  budget: o => ({
    texte: (EN ? `“It's above the budget we had planned: we had around ${euros(o.c.budget)} a year.”` : `« C'est au-dessus de l'enveloppe que nous avions prévue : nous avions environ ${euros(o.c.budget)} par an. »`),
    choix: [
      { label: (EN ? "Explore: “How far above are you, and what could we adjust together?”" : "Explorer : « De combien êtes-vous au-dessus, et quels éléments pourrions-nous ajuster ensemble ? »"), effet: 10, tag: "objections", type: "ok", journal: (EN ? "Budget objection explored through questions." : "Objection budget explorée par le questionnement.") },
      { label: (EN ? "Offer a 10% discount in exchange for a 3-year commitment." : "Proposer 10 % de remise en contrepartie d'un engagement de 3 ans."), effet: 12, tag: "negociation", type: "ok", journal: (EN ? "10% discount obtained against a 3-year commitment." : "Remise de 10 % obtenue contre un engagement de 3 ans."), applique: p => { p.remise = Math.max(p.remise, 10); p.engagement = "triennal"; } },
      { label: (EN ? "Grant a 15% discount with nothing in return." : "Accorder 15 % de remise sans contrepartie."), effet: 5, tag: "negociation", type: "remise15", journal: (EN ? "15% discount granted with nothing in return." : "Remise de 15 % accordée sans contrepartie.") },
      { label: (EN ? "Remove the set-up and training to fit the budget." : "Retirer la mise en service et la formation pour rentrer dans le budget."), effet: -6, tag: "produit", type: "manque", journal: (EN ? "Set-up and training removed: the roll-out is weakened." : "Mise en service et formation supprimées : le déploiement est fragilisé.") }
    ]
  }),
  kordis: () => ({
    texte: (EN ? "“Kordis is offering us a tool at €19 per user. Why pay more?”" : "« Kordis nous propose un outil à 19 € par utilisateur. Pourquoi payer davantage ? »"),
    choix: [
      { label: (EN ? "Isolate and rephrase: “If the price were the same, which would you choose?”, then compare the actual scope: invoicing, accounting integration, support." : "Isoler et reformuler : « Si le prix était identique, lequel choisiriez-vous ? », puis comparer le périmètre réel : facturation, intégration comptable, support."), effet: 12, tag: "objections", type: "ok", journal: (EN ? "Price objection isolated then handled by comparing scopes." : "Objection prix isolée puis traitée par la comparaison des périmètres.") },
      { label: (EN ? "Present a comparable customer case: 9% of lost quotes recovered in the first year." : "Présenter un cas client comparable : 9 % de devis perdus récupérés dès la première année."), effet: 10, tag: "argumentation", type: "ok", journal: (EN ? "Competitor objection handled with customer proof." : "Objection concurrente traitée par une preuve client.") },
      { label: (EN ? "Immediately offer a 10% discount to get closer to their price." : "Proposer immédiatement 10 % de remise pour se rapprocher de leur prix."), effet: 3, tag: "negociation", type: "remise10", journal: (EN ? "10% discount conceded against a cheaper competitor." : "Remise de 10 % concédée face à un concurrent moins cher.") },
      { label: (EN ? "“Several customers joined us after being disappointed by Kordis's support.”" : "« Plusieurs clients nous ont rejoints après avoir été déçus par le support de Kordis. »"), effet: -10, tag: "conformite", type: "erreur", journal: (EN ? "Disparaging a competitor, without verifiable proof." : "Dénigrement d'un concurrent, sans preuve vérifiable.") }
    ]
  }),
  salesbase: () => ({
    texte: (EN ? "“Salesbase seems more comprehensive. What guarantees that Veltis One will be enough?”" : "« Salesbase semble plus complet. Qu'est-ce qui nous garantit que Veltis One suffira ? »"),
    choix: [
      { label: (EN ? "Ask: “Which Salesbase features would you actually use?”, then show your needs are covered in 3 weeks instead of 4 to 6 months." : "Questionner : « Quelles fonctions de Salesbase utiliseriez-vous réellement ? », puis montrer que vos besoins sont couverts en 3 semaines au lieu de 4 à 6 mois."), effet: 12, tag: "objections", type: "ok", journal: (EN ? "“More comprehensive” objection handled with questions and the roll-out time." : "Objection « plus complet » traitée par le questionnement et le délai de déploiement.") },
      { label: (EN ? "Offer a conversation with a customer of comparable size who left Salesbase." : "Proposer un échange avec un client de taille comparable qui a quitté Salesbase."), effet: 10, tag: "argumentation", type: "ok", journal: (EN ? "Objection handled with a customer reference." : "Objection traitée par une référence client.") },
      { label: (EN ? "Offer premium support free of charge to compensate." : "Offrir gratuitement le support premium pour compenser."), effet: 3, tag: "negociation", type: "concession", journal: (EN ? "Premium support given away with nothing in return." : "Support premium offert sans contrepartie.") },
      { label: (EN ? "“From what we hear, Salesbase is going to raise its prices by 30% next year.”" : "« D'après nos informations, Salesbase va augmenter ses prix de 30 % l'an prochain. »"), effet: -10, tag: "conformite", type: "erreur", journal: (EN ? "Unverified rumour spread about a competitor." : "Rumeur non vérifiée diffusée sur un concurrent.") }
    ]
  }),
  tableur: () => ({
    texte: (EN ? "“Honestly, our spreadsheets work. Why change?”" : "« Honnêtement, nos tableurs fonctionnent. Pourquoi changer ? »"),
    choix: [
      { label: (EN ? "Get them to put a figure on the current cost: “How many hours a month do you spend re-entering and consolidating?”" : "Faire chiffrer le coût actuel : « Combien d'heures par mois passez-vous à ressaisir et à consolider ? »"), effet: 12, tag: "objections", type: "ok", journal: (EN ? "Status quo challenged by quantifying the current cost." : "Statu quo challengé en faisant chiffrer le coût actuel.") },
      { label: (EN ? "Recall the two difficulties raised during discovery and their impact on revenue." : "Rappeler les deux difficultés exprimées en découverte et leur impact sur le chiffre d'affaires."), effet: 10, tag: "ecoute", type: "ok", journal: (EN ? "Status quo handled by restating the stakes." : "Statu quo traité par la reformulation des enjeux.") },
      { label: (EN ? "Offer a 10% discount to make the decision easier." : "Proposer 10 % de remise pour faciliter la décision."), effet: 3, tag: "negociation", type: "remise10", journal: (EN ? "10% discount conceded with nothing in return." : "Remise de 10 % concédée sans contrepartie.") },
      { label: (EN ? "“Almost all your competitors are equipped: you risk falling behind.”" : "« Vos concurrents sont presque tous équipés : vous risquez de prendre du retard. »"), effet: -8, tag: "argumentation", type: "manque", journal: (EN ? "Unproven generalisation used as pressure." : "Généralisation non prouvée utilisée comme pression.") }
    ]
  }),
  migration: () => ({
    texte: (EN ? "“And migrating our current data? I don't want to re-enter everything.”" : "« Et la reprise de nos données actuelles ? Je ne veux pas tout ressaisir. »"),
    choix: [
      { label: (EN ? "Add historical data migration to the proposal, explaining the method and the schedule." : "Ajouter la reprise des données historiques à la proposition, en expliquant la méthode et le planning."), effet: 12, tag: "produit", type: "ok", journal: (EN ? "Data migration added to the proposal." : "Reprise des données ajoutée à la proposition."), applique: p => { p.options.migration = true; } },
      { label: (EN ? "Advise them to gradually re-enter the important data." : "Lui conseiller de ressaisir progressivement les données importantes."), effet: -6, tag: "produit", type: "manque", journal: (EN ? "Data migration left to the customer." : "Reprise des données laissée à la charge du client.") },
      { label: (EN ? "Promise that migration is included free of charge." : "Promettre que la reprise est incluse gratuitement."), effet: 4, tag: "conformite", type: "erreur", journal: (EN ? "Promise of a service not included in the contract." : "Promesse d'une prestation non prévue au contrat.") }
    ]
  }),
  validation: () => ({
    texte: (EN ? "“I have to present the file to our management committee before committing.”" : "« Je dois présenter le dossier à notre comité de direction avant de m'engager. »"),
    choix: [
      { label: (EN ? "Offer to prepare the business case together and to take part in the committee presentation." : "Proposer de préparer ensemble le business case et de participer à la présentation au comité."), effet: 12, tag: "closing", type: "ok", journal: (EN ? "Decision process secured: business case built together." : "Processus de décision sécurisé : business case co-construit.") },
      { label: (EN ? "Send them the brochure to pass on to the committee." : "Lui envoyer la plaquette pour qu'il la transmette au comité."), effet: 0, tag: "closing", type: "manque", journal: (EN ? "Management committee left without a tailored business case." : "Comité de direction laissé sans argumentaire adapté.") },
      { label: (EN ? "“Your management trusts you: sign, and tell them afterwards.”" : "« Votre direction vous fait confiance : signez, vous l'informerez ensuite. »"), effet: -15, tag: "closing", type: "erreur", journal: (EN ? "Encouraging the customer to bypass their decision process." : "Incitation à contourner le processus de décision du client.") }
    ]
  })
};

function soutenance(n, o) {
  const c = o.c;
  if (o.etat !== "soutenance") return;
  const canal = estTerrain() ? (EN ? "In person" : "Présentiel") : (EN ? "Video call" : "Visio");
  if (estTerrain()) { if (!controleSurSite(c)) return; o.deplacements++; } else if (!controleSedentaire()) return;
  avancerTemps(90);
  o.heures += 1.5;
  let conf = 45 + (o.calc.arr <= c.budget ? 8 : -8);
  let signal = signalCanal(c, canal);
  const pr = o.proposition;
  const ajuster = delta => { conf = clamp(conf + delta, 0, 100); signal = reactionCanal(c, canal, delta); };
  const recalculer = () => { o.calc = calculerProposition(pr); };
  const liste = [];
  if (o.calc.arr > c.budget * 1.05) liste.push("budget");
  if (c.migration && !pr.options.migration) liste.push("migration");
  liste.push(c.concurrent);
  if (c.role === "daf" || pr.offre === "enterprise") liste.push("validation");
  const objections = liste.slice(0, n.p.objections);
  const etapes = [];
  const suivant = i => (i < etapes.length ? etapes[i](i) : conclureSoutenance());
  const inter = interlocuteurDe(c);

  etapes.push(i => ouvrirEntretien({
    interlocuteur: inter, canal, confiance: conf, signal,
    texte: (EN ? `You present your proposal to ${c.contact}: ${OFFRES[pr.offre].nom} plan, ${pr.utilisateurs} licences, ${euros(o.calc.arr)} per year.\n\nHow do you start?` : `Vous présentez votre proposition à ${c.contact} : offre ${OFFRES[pr.offre].nom}, ${pr.utilisateurs} licences, ${euros(o.calc.arr)} par an.\n\nPar quoi commencez-vous ?`),
    choix: melangerChoix([
      { label: (EN ? `Recall the stakes they raised (${c.pains.map(p => PAINS[p].court.toLowerCase()).join(", ")}), then present the chosen solution and the investment.` : `Rappeler les enjeux exprimés (${c.pains.map(p => PAINS[p].court.toLowerCase()).join(", ")}), puis présenter la solution retenue et l'investissement.`), action: () => { ajuster(12); reussite((EN ? "Presentation opened on the customer's stakes." : "Soutenance ouverte sur les enjeux du client."), "ecoute", { silencieux: true, muet: true }); suivant(i + 1); } },
      { label: (EN ? "Present Veltis first: history, key figures and references, then the proposal." : "Présenter d'abord Veltis : histoire, chiffres clés et références, puis la proposition."), action: () => { ajuster(-6); manque((EN ? "Presentation centred on Veltis rather than on the customer." : "Soutenance centrée sur Veltis plutôt que sur le client."), "ecoute"); suivant(i + 1); } },
      { label: (EN ? "Announce the price and the discount you're ready to give right away." : "Annoncer d'emblée le prix et la remise que vous êtes prêt à faire."), action: () => { ajuster(-10); manque((EN ? "Presentation opened on price and discount." : "Soutenance ouverte sur le prix et la remise."), "negociation"); suivant(i + 1); } },
      { label: (EN ? "Run through the full platform presentation, module by module." : "Dérouler la présentation complète de la plateforme, module par module."), action: () => { ajuster(-8); manque((EN ? "Catalogue presentation unrelated to the customer's stakes." : "Présentation catalogue sans lien avec les enjeux du client."), "ecoute"); suivant(i + 1); } }
    ])
  }));

  etapes.push(i => {
    const autres = melanger(Object.keys(SONCAS).filter(k => k !== c.soncas)).slice(0, 3);
    ouvrirEntretien({
      interlocuteur: inter, canal, confiance: conf, signal: signalCanal(c, canal),
      texte: (EN ? `${c.contact} is listening. Which argument do you put forward?` : `${c.contact} vous écoute. Quel argument mettez-vous en avant ?`),
      choix: melangerChoix(autres.concat([c.soncas])).map(k => ({
        label: SONCAS[k].argument,
        action: () => {
          if (k === c.soncas) { ajuster(15); reussite((EN ? `Argument suited to ${c.contact}'s dominant motive (${SONCAS[k].nom}).` : `Argument adapté à la motivation dominante de ${c.contact} (${SONCAS[k].nom}).`), "argumentation", { silencieux: true, muet: true }); }
          else { ajuster(-8); manque((EN ? `“${SONCAS[k].nom}” argument off-target for ${c.contact}, who is sensitive to “${SONCAS[c.soncas].nom}”.` : `Argument ${guillemets(SONCAS[k].nom)} décalé pour ${c.contact}, sensible à ${guillemets(SONCAS[c.soncas].nom)}.`), "argumentation"); }
          suivant(i + 1);
        }
      }))
    });
  });

  objections.forEach(cle => etapes.push(i => {
    const obj = OBJECTIONS[cle](o);
    ouvrirEntretien({
      interlocuteur: inter, canal, confiance: conf, signal,
      texte: (EN ? `${obj.texte}\n\nHow do you respond?` : `${obj.texte}\n\nComment répondez-vous ?`),
      choix: melangerChoix(obj.choix).map(ch => ({
        label: ch.label,
        action: () => {
          if (ch.type === "ok") { reussite(`${c.entreprise} : ${ch.journal}`, ch.tag, { silencieux: true, muet: true }); if (ch.applique) { ch.applique(pr); recalculer(); } ajuster(ch.effet); }
          else if (ch.type === "erreur") { erreur(`${c.entreprise} : ${ch.journal}`, ch.tag); ajuster(ch.effet); }
          else if (ch.type === "manque") { manque(`${c.entreprise} : ${ch.journal}`, ch.tag); ajuster(ch.effet); }
          else if (ch.type === "concession") { concession(`${c.entreprise} : ${ch.journal}`, ch.tag); ajuster(ch.effet); }
          else if (ch.type === "remise10") { pr.remise = Math.max(pr.remise, 10); recalculer(); concession(`${c.entreprise} : ${ch.journal}`, ch.tag); ajuster(ch.effet); }
          else if (ch.type === "remise15") {
            if (o.approbation >= 15) { pr.remise = Math.max(pr.remise, 15); recalculer(); concession(`${c.entreprise} : ${ch.journal}`, ch.tag); ajuster(ch.effet); }
            else { erreur((EN ? `${c.entreprise}: 15% discount promised beyond your authority, without your director's approval.` : `${c.entreprise} : remise de 15 % promise hors délégation, sans accord de votre directrice.`), "negociation"); ajuster(-5); }
          }
          if (jeu.mode === "bilan") return;
          suivant(i + 1);
        }
      }))
    });
  }));

  etapes.push(i => ouvrirEntretien({
    interlocuteur: inter, canal, confiance: conf, signal,
    texte: (EN ? "The presentation is coming to an end. How do you close?" : "La soutenance touche à sa fin. Comment concluez-vous ?"),
    choix: melangerChoix([
      { label: (EN ? "Lock in the next steps: decision date, approval stages and target start date." : "Verrouiller la suite : date de décision, étapes de validation et date de démarrage visée."), action: () => { ajuster(10); reussite((EN ? `${c.entreprise}: next steps locked in (decision date and stages).` : `${c.entreprise} : suite verrouillée (date de décision et étapes).`), "closing", { silencieux: true, muet: true }); suivant(i + 1); } },
      { label: (EN ? "Alternative question: “Would you prefer to start on the 1st or the 15th of next month?”" : "Question alternative : « Préférez-vous démarrer le 1er ou le 15 du mois prochain ? »"), action: () => {
        if (conf >= 60) { ajuster(8); reussite((EN ? `${c.entreprise}: alternative close at the right moment.` : `${c.entreprise} : conclusion par l'alternative au bon moment.`), "closing", { silencieux: true, muet: true }); }
        else { ajuster(-4); concession((EN ? `${c.entreprise}: alternative offered while the customer wasn't yet convinced.` : `${c.entreprise} : alternative proposée alors que le client n'était pas encore convaincu.`), "closing"); }
        suivant(i + 1);
      } },
      { label: (EN ? "“I'll let you think it over, call me whenever you like.”" : "« Je vous laisse réfléchir, rappelez-moi quand vous voulez. »"), action: () => { ajuster(-5); o.relanceLongue = true; manque((EN ? `${c.entreprise}: no next step agreed.` : `${c.entreprise} : aucune prochaine étape convenue.`), "closing"); suivant(i + 1); } },
      { label: (EN ? "“Our prices change on 1 January: it would be a shame to wait.”" : "« Nos tarifs évoluent au 1er janvier : il serait dommage d'attendre. »"), action: () => { ajuster(-12); erreur((EN ? `${c.entreprise}: false urgency (no price increase is planned).` : `${c.entreprise} : fausse urgence (aucune hausse tarifaire n'est prévue).`), "conformite"); if (jeu.mode !== "bilan") suivant(i + 1); } }
    ])
  }));

  const conclureSoutenance = () => {
    o.confiance = conf;
    o.soutenue = true;
    o.etat = "reflexion";
    o.minuteur = (conf >= 70 ? 360 : conf >= 50 ? 720 : 1080) + (o.relanceLongue ? 360 : 0);
    ouvrirEntretien({
      interlocuteur: inter, canal, confiance: conf, signal,
      texte: (EN ? `“Thank you for this presentation. Give us time to discuss it internally.”\n\nThe final proposal comes to ${euros(o.calc.arr)} per year (${pr.remise}% discount). Follow-up possible in ${joursTexte(o.minuteur)}.` : `« Merci pour cette présentation. Laissez-nous le temps d'en discuter en interne. »\n\nLa proposition finale s'élève à ${euros(o.calc.arr)} par an (remise ${pr.remise} %). Relance possible dans ${joursTexte(o.minuteur)}.`),
      choix: [{ label: (EN ? "Take your leave" : "Prendre congé"), action: () => { fermerEntretien(); verifierFinM4(n); } }]
    });
  };
  suivant(0);
}

function relance(n, o) {
  if (!controleSedentaire()) return;
  const c = o.c;
  if (o.etat !== "relance") return;
  avancerTemps(15);
  o.heures += 0.25;
  let conf = o.confiance;
  const inter = interlocuteurDe(c);
  const issue = () => {
    if (conf >= 55) {
      const ecoule = Math.max(1, Math.round((jeu.minutes - o.debut) / JOURNEE * 1.4));
      o.etat = "signe";
      // La durée de vie projetée dépend de la confiance du client et de la posture du commercial
      const duree = dureeViePosture((clamp(conf, 0, 100) + jeu.posture) / 2);
      o.signature = { arr: o.calc.arr, cycle: o.age + ecoule, duree };
      reussite((EN ? `${c.entreprise} becomes a customer: ${euros(o.calc.arr)} ARR, projected CLV ${euros(o.calc.arr * MARGE_BRUTE * duree)} (${ansTexte(duree)}).` : `${c.entreprise} devient client : ${euros(o.calc.arr)} d'ARR, CLV projetée ${euros(o.calc.arr * MARGE_BRUTE * duree)} (${ansTexte(duree)}).`), "closing");
      reactionEquipe("signature", c.entreprise);
      ouvrirEntretien({ interlocuteur: inter, canal: (EN ? "Phone" : "Téléphone"), confiance: conf, texte: (EN ? "“We agree, we're signing. Send us the contract, we'll return it signed this week.”" : "« C'est d'accord, nous signons. Envoyez-nous le contrat, nous le retournerons signé cette semaine. »"), choix: [{ label: (EN ? "Thank them and send the contract" : "Remercier et envoyer le contrat"), action: () => { fermerEntretien(); verifierFinM4(n); } }] });
    } else {
      o.etat = "perdu";
      manque((EN ? `${c.entreprise} chooses ${CONCURRENTS[c.concurrent].nom} (insufficient trust: ${Math.round(conf)}/100).` : `${c.entreprise} choisit ${CONCURRENTS[c.concurrent].nom} (confiance insuffisante : ${Math.round(conf)}/100).`), "closing");
      ouvrirEntretien({ interlocuteur: inter, canal: (EN ? "Phone" : "Téléphone"), confiance: conf, texte: (EN ? `“Thank you for your follow-up, but in the end we chose ${CONCURRENTS[c.concurrent].nom}.”` : `« Merci pour votre suivi, mais nous avons finalement retenu ${CONCURRENTS[c.concurrent].nom}. »`), choix: [{ label: (EN ? "Thank them and ask for the reasons behind the choice" : "Remercier et demander les raisons du choix"), action: () => { fermerEntretien(); verifierFinM4(n); } }] });
    }
  };
  ouvrirEntretien({
    interlocuteur: inter, canal: (EN ? "Phone" : "Téléphone"), confiance: conf,
    signal: (EN ? `<strong>Tone of voice:</strong> ${conf >= 55 ? (EN ? `warm, ${pronom(c, false)} was expecting your call.` : "accueillant, " + pronom(c, false) + (EN ? " was expecting your call." : " attendait votre appel.")) : (EN ? "reserved, a little distant." : "réservé, un peu distant.")}` : `<strong>Ton de voix :</strong> ${conf >= 55 ? (EN ? `warm, ${pronom(c, false)} was expecting your call.` : "accueillant, " + pronom(c, false) + (EN ? " was expecting your call." : " attendait votre appel.")) : (EN ? "reserved, a little distant." : "réservé, un peu distant.")}`),
    texte: (EN ? `${c.contact} picks up. How do you follow up?` : `${c.contact} décroche. Comment relancez-vous ?`),
    choix: melangerChoix([
      { label: (EN ? "“As agreed, I'm getting back to you with the elements for your decision. Which points remain to be resolved?”" : "« Comme convenu, je reviens vers vous avec les éléments pour votre décision. Quels points restent à lever ? »"), action: () => { conf += 12; reussite((EN ? `${c.entreprise}: value-adding follow-up.` : `${c.entreprise} : relance à valeur ajoutée.`), "closing", { silencieux: true, muet: true }); issue(); } },
      { label: (EN ? "“I'll offer you an extra 5% discount if we sign this week.”" : "« Je vous propose 5 % de remise supplémentaire si nous signons cette semaine. »"), action: () => { conf += 4; o.proposition.remise = Math.min(o.proposition.remise + 5, 25); o.calc = calculerProposition(o.proposition); if (o.proposition.remise > Math.max(DELEGATION.autonomie, o.approbation)) { erreur((EN ? `${c.entreprise}: discount raised to ${o.proposition.remise}% beyond your authority during the follow-up.` : `${c.entreprise} : remise portée à ${o.proposition.remise} % hors délégation lors de la relance.`), "negociation"); } else concession((EN ? `${c.entreprise}: extra discount conceded during the follow-up.` : `${c.entreprise} : remise supplémentaire concédée à la relance.`), "negociation"); if (jeu.mode !== "bilan") issue(); } },
      { label: (EN ? "“So, have you made your decision?”" : "« Alors, avez-vous pris votre décision ? »"), action: () => { manque((EN ? `${c.entreprise}: follow-up with no added value.` : `${c.entreprise} : relance sans valeur ajoutée.`), "closing"); issue(); } },
      { label: (EN ? "“I can still guarantee you this price until Friday.”" : "« Je peux encore vous garantir ce prix jusqu'à vendredi. »"), action: () => { conf -= 15; erreur((EN ? `${c.entreprise}: false deadline invoked during the follow-up.` : `${c.entreprise} : fausse échéance invoquée lors de la relance.`), "conformite"); if (jeu.mode !== "bilan") issue(); } }
    ])
  });
}

/* =====================================================================
   PARTIE E — MISSION 5, DÉROULEMENT, COMMANDES ET BOUCLE PRINCIPALE
   ===================================================================== */

/* ---------------------------------------------------------------------
   MISSION 5 · FIDÉLISATION (orange)
   Portefeuille de clients sur un trimestre : incidents, adoption,
   renouvellements (QBR), ventes additionnelles, changement de sponsor,
   enquête NPS, recommandations.
   --------------------------------------------------------------------- */
const SEMAINE = 5 * JOURNEE;
const TYPES_EVENEMENTS = {
  incident: { nom: (EN ? "Critical incident" : "Incident critique"), delai: 4 * JOURNEE, presentiel: false },
  adoption: { nom: (EN ? "Drop in usage" : "Baisse d'utilisation"), delai: 8 * JOURNEE, presentiel: false },
  renouvellement: { nom: (EN ? "Renewal to prepare" : "Renouvellement à préparer"), delai: null, presentiel: true },
  upsell: { nom: (EN ? "Expansion opportunity" : "Opportunité de développement"), delai: 8 * JOURNEE, presentiel: false },
  sponsor: { nom: (EN ? "Change of contact" : "Changement d'interlocuteur"), delai: 6 * JOURNEE, presentiel: true },
  enquete: { nom: (EN ? "Quarterly satisfaction survey" : "Enquête de satisfaction trimestrielle"), delai: 5 * JOURNEE, presentiel: false },
  recommandation: { nom: (EN ? "Very satisfied customer" : "Client très satisfait"), delai: 8 * JOURNEE, presentiel: false }
};
const SUCCESSEURS = ["Nicolas Perrin", "Élodie Marchand", "Romain Lefort", "Clara Besson", "Mehdi Aït-Ali"];
const couleurSante = s => (s < 45 ? "#b91c1c" : s < 65 ? "#d97706" : "#15803d");
const dureeVie = s => (s >= 80 ? 6 : s >= 65 ? 4 : s >= 50 ? 2.5 : 1);

const M5 = {
  id: "fidelisation", phase: (EN ? "Retention" : "Fidélisation"), couleur: "#6b2140", texteCouleur: "#ffffff", bonus: true,
  transition: [(EN ? "Customer" : "Client"), (EN ? "Loyal customer" : "Client fidèle")],
  reflexeRequin: (EN ? "Forgetting customers once signed, or upselling them anything at the wrong time: the customer never becomes loyal. Looking after account health is the last stage of conversion: that's where CLV is won or lost." : "Oublier ses clients une fois signés, ou leur revendre n'importe quoi au mauvais moment : le client ne devient jamais fidèle. Entretenir la santé du compte, c'est la dernière étape de la conversion : c'est là que la CLV se gagne ou se perd."),
  objectifTableau: (EN ? "Keep, grow, earn referrals" : "Garder, développer, faire recommander"),
  activitesTableau: (EN ? "Customer onboarding, follow-up, surveys, sales" : "Accueil client, suivi, enquêtes, ventes"),
  kpiTableau: (EN ? "Retention, churn, CLV, NPS" : "Rétention, churn, CLV, NPS"),
  mode: { terrain: (EN ? "Portfolio · meetings in client rooms" : "Portefeuille · rendez-vous en salon client"), sedentaire: (EN ? "Portfolio · remote follow-up" : "Portefeuille · suivi à distance") },
  titre: (EN ? "Keep, grow, earn referrals" : "Garder, développer, faire recommander"),
  contexte: (EN ? "You're taking over a portfolio of Veltis One customers for the quarter. Several contracts are coming up for renewal. Inès Laurent, Customer Success Manager, supports you on technical matters." : "Vous reprenez un portefeuille de clients Veltis One pour le trimestre. Plusieurs contrats arrivent à renouvellement. Inès Laurent, Customer Success Manager, vous épaule sur les sujets techniques."),
  objectifBusiness: (EN ? "Keep customers, grow revenue with them and turn them into advocates. Key activities: customer onboarding, follow-up, surveys, upselling. KPIs: retention, churn, customer lifetime value (CLV), NPS." : "Conserver les clients, développer le chiffre d'affaires avec eux et en faire des prescripteurs. Activités clés : accueil client, suivi, enquêtes, ventes additionnelles. Indicateurs : rétention, churn, valeur vie client (CLV), NPS."),
  affichageCarte: true,
  params: {
    standard: { nb: 5, churnMax: 1, intervalle: [1700, 2500] },
    confirme: { nb: 6, churnMax: 0, intervalle: [1300, 2000] }
  },
  periode: () => ({ debut: 0, fin: 12 * SEMAINE, rythme: 80, affichage: "semaine" }),
  depart: () => ({ x: POINT_POSTE.x, z: POINT_POSTE.z, angle: Math.PI }),
  mission: p => (EN ? `Over 12 weeks, keep your portfolio (${p.churnMax === 0 ? (EN ? "no customer lost" : "aucun départ") : (EN ? `${p.churnMax} customer lost at most` : `${p.churnMax} départ au maximum`)}), grow it and measure your customers' satisfaction.` : `Sur 12 semaines, conservez votre portefeuille (${p.churnMax === 0 ? (EN ? "no customer lost" : "aucun départ") : (EN ? `${p.churnMax} customer lost at most` : `${p.churnMax} départ au maximum`)}), développez-le et mesurez la satisfaction de vos clients.`),
  consignes: () => [
    (EN ? "Events arrive in your CRM: incidents, drops in usage, renewals, opportunities, changes of contact. Handle them before their deadline." : "Les événements arrivent dans votre CRM : incidents, baisses d'utilisation, renouvellements, opportunités, changements d'interlocuteur. Traitez-les avant leur échéance."),
    (EN ? "Before each renewal, hold a business review (QBR). A customer whose health falls below 60 without a QBR may leave." : "Avant chaque renouvellement, organisez une revue d'activité (QBR). Un client dont la santé passe sous 60 sans QBR risque de partir."),
    (EN ? "Only offer an upsell to a satisfied customer; ask your promoters for referrals." : "Ne proposez une vente additionnelle qu'à un client satisfait ; demandez des recommandations à vos promoteurs."),
    (EN ? "In week 6, launch the quarterly satisfaction survey and call back the detractors." : "En semaine 6, lancez l'enquête de satisfaction trimestrielle et rappelez les détracteurs."),
    (EN ? "Check-ins: use them to nurture the relationship, at most once a week per customer." : "Points de suivi : utilisez-les pour entretenir la relation, au plus une fois par semaine et par client.")
  ],
  profilNote: () => estTerrain()
    ? (EN ? "Field profile: business reviews and meetings with a new contact are more effective face to face, in a client room (+7 health points), but each in-person meeting takes about a day to organise. Other topics are handled remotely." : "Profil terrain : les revues d'activité et les rencontres avec un nouvel interlocuteur sont plus efficaces en face à face, en salon client (+7 points de santé), mais chaque rendez-vous présentiel prend environ une journée d'organisation. Les autres sujets se traitent à distance.")
    : (EN ? "Inside sales profile: you follow a larger portfolio from your desk (video, phone, email). Stay at your desk to act quickly." : "Profil sédentaire : vous suivez un portefeuille plus large depuis votre poste (visio, téléphone, e-mail). Restez à votre poste pour agir rapidement."),
  criteres: p => [
    (EN ? `Success: ${p.churnMax === 0 ? (EN ? "no customer lost" : "aucun client perdu") : (EN ? `at most ${p.churnMax} customer lost` : `au plus ${p.churnMax} client perdu`)} at the end of the quarter.` : `Réussite : ${p.churnMax === 0 ? (EN ? "no customer lost" : "aucun client perdu") : (EN ? `at most ${p.churnMax} customer lost` : `au plus ${p.churnMax} client perdu`)} à la fin du trimestre.`),
    (EN ? "Excellence: no churn, NPS ≥ +30 and net revenue retention ≥ 105% · Proficient: no churn." : "Excellence : aucun départ, NPS ≥ +30 et rétention nette du revenu ≥ 105 % · Maîtrise : aucun départ."),
    (EN ? "Errors: incident or change of contact ignored, upsell to a fragile account, over-selling, biased survey, referral asked from an unhappy customer, renewal pressure, customer lost." : "Erreurs : incident ou changement d'interlocuteur ignoré, vente additionnelle sur un compte fragile, sur-vente, enquête biaisée, recommandation demandée à un client insatisfait, pression au renouvellement, client perdu.")
  ],
  aRetenir: (EN ? "Retaining costs less than acquiring. Account health can be managed: responsiveness on incidents, adoption support, business review before each renewal, attention to changes of contact. Grow satisfied customers, measure satisfaction without bias, and promoters become advocates who feed awareness again." : "Fidéliser coûte moins cher que conquérir. La santé d'un compte se pilote : réactivité sur les incidents, accompagnement de l'adoption, revue d'activité avant chaque renouvellement, attention aux changements d'interlocuteur. On développe les clients satisfaits, on mesure la satisfaction sans biais, et les promoteurs deviennent des prescripteurs qui alimentent à nouveau la notoriété."),
  conseilEchec: (EN ? "Handle incidents and changes of contact first, prepare QBRs well ahead of renewals, and don't try to sell to a fragile customer: repair the relationship first." : "Traitez d'abord les incidents et les changements d'interlocuteur, préparez les QBR bien avant les renouvellements, et n'essayez pas de vendre à un client fragile : réparez d'abord la relation."),

  demarrer(n, p) {
    const pp = Object.assign({}, p);
    if (!estTerrain()) pp.nb += 1;
    n.p = pp;
    Object.assign(n, { clients: [], evenements: [], prochain: entier(400, 900), recos: 0, notes: [], biais: false, enqueteLancee: false, ventes: 0, compteur: 0, successeurs: melanger(SUCCESSEURS) });
    const santes = melanger([entier(48, 55), entier(58, 66), entier(66, 74), entier(80, 88), entier(72, 80), entier(62, 70), entier(54, 60)]);
    const semaines = melanger([3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    melanger(Object.keys(COMPTES)).slice(0, Math.min(pp.nb, 7)).forEach((cle, i) => {
      const c = COMPTES[cle];
      const arr = arrCatalogue(c);
      const sante = santes[i];
      const cl = {
        id: cle, c, contact: c.contact, arr, arrInitial: arr, licences: c.utilisateurs,
        sante, adoption: clamp(sante + entier(-12, 6), 30, 95),
        renouvellement: (semaines[i] - 1) * SEMAINE + entier(1, 4) * JOURNEE,
        qbr: false, parti: false, renouvele: false, reco: false, upsell: false, sponsorChange: false, dernierSuivi: -Infinity
      };
      cl.pnj = placerContact(c);
      cl.inter = ajouterInteractif({ x: c.batiment.porte.x, z: c.batiment.porte.z, rayon: 2.6, label: (EN ? `meeting with ${c.entreprise} (${c.batiment.nom})` : `rendez-vous avec ${c.entreprise} (${c.batiment.nom})`), action: () => visiteSurSite(n, cl), actif: false });
      n.clients.push(cl);
      const annonce = Math.max(0, cl.renouvellement - 5 * SEMAINE);
      creerEvenement(n, cl, "renouvellement", annonce, cl.renouvellement);
    });
    creerEvenement(n, null, "enquete", 5 * SEMAINE, 5 * SEMAINE + TYPES_EVENEMENTS.enquete.delai);
    activerCollegue("success", (EN ? "check in with Inès (Customer Success)" : "faire un point avec Inès (Customer Success)"), () => pointInes(n));
  },
  auDemarrage() {
    ouvrirPanneau((EN ? "CRM · Customer portfolio" : "CRM · Portefeuille clients"), estTerrain() ? (EN ? "Quarter · meetings in client rooms possible" : "Trimestre · rendez-vous en salon client possibles") : (EN ? "Quarter · follow-up from your desk" : "Trimestre · suivi depuis votre poste"));
  },
  ciblesCarte: n => n.evenements.filter(e => e.etat === "ouvert" && e.client && TYPES_EVENEMENTS[e.type].presentiel && jeu.minutes >= e.debut).map(e => e.client.id),
  maj(n, dt, dmin) {
    const t = jeu.minutes;
    // Dérive naturelle de la santé et de l'usage
    n.clients.forEach(cl => {
      if (cl.parti) return;
      cl.sante = clamp(cl.sante - 0.5 * dmin / JOURNEE, 0, 100);
      cl.adoption = clamp(cl.adoption - 0.3 * dmin / JOURNEE, 10, 100);
      if (cl.sante <= 0) perdreClient(n, cl, (EN ? `${cl.c.entreprise} cancels their contract: the relationship has deteriorated.` : `${cl.c.entreprise} résilie son contrat : la relation s'est dégradée.`));
    });
    // Nouveaux événements
    if (t >= n.prochain) {
      n.prochain = t + aleatoire(n.p.intervalle[0], n.p.intervalle[1]);
      genererEvenement(n);
    }
    // Échéances
    n.evenements.forEach(ev => {
      if (ev.etat !== "ouvert") return;
      if (!ev.annonce && t >= ev.debut) {
        ev.annonce = true;
        son("notif");
        message(`${TYPES_EVENEMENTS[ev.type].nom}${ev.client ? ` · ${ev.client.c.entreprise}` : ""}`, "info", 2400);
      }
      if (ev.client && ev.client.parti) { ev.etat = "clos"; return; }
      if (t >= ev.echeance) expirerEvenement(n, ev);
    });
    // Renouvellements
    n.clients.forEach(cl => {
      if (cl.parti || cl.renouvele || t < cl.renouvellement) return;
      const ok = cl.sante >= 60 || (cl.sante >= 45 && cl.qbr);
      if (ok) {
        cl.renouvele = true;
        reussite((EN ? `${cl.c.entreprise} renews their contract (${euros(cl.arr)}/year).` : `${cl.c.entreprise} renouvelle son contrat (${euros(cl.arr)}/an).`), "closing");
      } else {
        perdreClient(n, cl, (EN ? `${cl.c.entreprise} doesn't renew and moves to ${CONCURRENTS[cl.c.concurrent].nom}.` : `${cl.c.entreprise} ne renouvelle pas et part chez ${CONCURRENTS[cl.c.concurrent].nom}.`));
      }
    });
    n.clients.forEach(cl => {
      cl.inter.actif = estTerrain() && !cl.parti && n.evenements.some(e => e.client === cl && e.etat === "ouvert" && t >= e.debut && TYPES_EVENEMENTS[e.type].presentiel);
      const texte = cl.parti ? (EN ? `${cl.c.entreprise} · customer lost` : `${cl.c.entreprise} · client perdu`) : (EN ? `${cl.contact} · ${cl.c.entreprise} · health ${Math.round(cl.sante)}` : `${cl.contact} · ${cl.c.entreprise} · santé ${Math.round(cl.sante)}`);
      majEtiquette(cl.pnj.etiquette, texte, cl.parti ? "etq-ko" : cl.inter.actif ? "etq-cible" : cl.sante < 45 ? "etq-alerte" : "");
    });
    const perdus = n.clients.filter(c => c.parti).length;
    if (perdus > n.p.churnMax && jeu.mode === "jeu") M5.finTemps(n, true);
  },
  tunnel: n => ({
    de: (EN ? "Customer" : "Client"), vers: (EN ? "Advocate" : "Prescripteur"),
    etapes: [
      { label: (EN ? "Customers in portfolio" : "Clients en portefeuille"), court: (EN ? "customers" : "clients"), valeur: n.clients.length },
      { label: (EN ? "Customers retained" : "Clients conservés"), court: (EN ? "retained" : "conservés"), valeur: n.clients.filter(c => !c.parti).length },
      { label: (EN ? "Advocate customers (referral)" : "Clients prescripteurs (recommandation)"), court: (EN ? "advocates" : "prescripteurs"), valeur: n.recos }
    ]
  }),
  hud(n) {
    const actifs = n.clients.filter(c => !c.parti);
    const sante = actifs.length ? actifs.reduce((s, c) => s + c.sante, 0) / actifs.length : 0;
    hudJauge((EN ? "Average portfolio health" : "Santé moyenne du portefeuille"), sante, `${Math.round(sante)} / 100`);
    const ouverts = n.evenements.filter(e => e.etat === "ouvert" && jeu.minutes >= e.debut).length;
    hudKpis([
      { label: (EN ? "Active customers" : "Clients actifs"), valeur: `${actifs.length} / ${n.clients.length}`, alerte: actifs.length < n.clients.length },
      { label: "ARR", valeur: euros(actifs.reduce((s, c) => s + c.arr, 0)) },
      { label: (EN ? "To handle" : "À traiter"), valeur: `${ouverts}`, alerte: ouverts >= 3 },
      { label: (EN ? "Referrals" : "Recommandations"), valeur: `${n.recos}` }
    ]);
  },
  panneau(n) {
    const t = jeu.minutes;
    const pasAuPoste = !estTerrain() && !auPoste();
    const ouverts = n.evenements.filter(e => e.etat === "ouvert" && t >= e.debut).sort((a, b) => a.echeance - b.echeance);
    let h = (EN ? `<div class="pm-section">To handle (${ouverts.length})</div>` : `<div class="pm-section">À traiter (${ouverts.length})</div>`);
    if (!ouverts.length) h += (EN ? `<div class="pm-vide">Nothing pending. Use the time for a check-in with a fragile customer.</div>` : `<div class="pm-vide">Aucun sujet en attente. Profitez-en pour faire un point de suivi avec un client fragile.</div>`);
    ouverts.forEach(ev => {
      const reste = ev.echeance - t;
      const type = TYPES_EVENEMENTS[ev.type];
      const urgent = reste < 2 * JOURNEE;
      let actions = "";
      if (type.presentiel && estTerrain()) {
        const proche = procheBatiment(ev.client.id);
        actions += boutonPm(proche ? (EN ? "Face-to-face meeting" : "Rendez-vous en face à face") : `${ev.client.c.batiment.nom} · ${distanceMetres(ev.client.c.batiment.porte)} m`, "evenement", ev.id, { val: "site", principal: true, desactive: !proche });
        actions += boutonPm((EN ? "Video call" : "En visio"), "evenement", ev.id, { val: "distance" });
      } else {
        actions += boutonPm((EN ? "Handle" : "Traiter"), "evenement", ev.id, { val: "distance", principal: true, desactive: pasAuPoste, titre: pasAuPoste ? (EN ? "Go back to your desk" : "Retournez à votre poste") : "" });
      }
      h += `<div class="fiche${urgent ? " prioritaire" : " active"}">
        <div class="fiche-entete"><span class="fiche-titre">${echapper(type.nom)}</span><span class="fiche-age${urgent ? " urgent" : ""}">${EN ? `${ev.type === "renouvellement" ? "renewal" : "due"} in ${joursTexte(Math.max(0, reste))}` : `${ev.type === "renouvellement" ? "renouvellement" : (EN ? "timing" : "échéance")} dans ${joursTexte(Math.max(0, reste))}`}</span></div>
        <div class="fiche-ligne"><strong>${ev.client ? echapper(ev.client.c.entreprise) : (EN ? "Whole portfolio" : "Tout le portefeuille")}</strong>${ev.client ? ` · ${echapper(ev.client.contact)}` : ""}</div>
        <div class="fiche-ligne">${echapper(descriptionEvenement(ev))}</div>
        <div class="pm-actions">${actions}</div></div>`;
    });
    h += (EN ? `<div class="pm-section">Portfolio (${n.clients.filter(c => !c.parti).length} active customers)</div>` : `<div class="pm-section">Portefeuille (${n.clients.filter(c => !c.parti).length} clients actifs)</div>`);
    n.clients.forEach(cl => {
      const c = cl.c;
      if (cl.parti) {
        h += `<div class="fiche terminee"><div class="fiche-entete"><span class="fiche-titre">${echapper(c.entreprise)}</span>${chip((EN ? "Lost" : "Perdu"), "ko")}</div></div>`;
        return;
      }
      const suiviPossible = t - cl.dernierSuivi >= SEMAINE;
      const statut = cl.renouvele ? chip((EN ? "Renewed" : "Renouvelé"), "ok") : chip((EN ? `Renewal ${formatHeure(cl.renouvellement, "semaine")}` : `Renouvellement ${formatHeure(cl.renouvellement, "semaine")}`), cl.renouvellement - t < 3 * SEMAINE ? "alerte" : "neutre");
      h += (EN ? `<div class="fiche">
        <div class="fiche-entete"><span class="fiche-titre">${echapper(c.entreprise)}</span>${statut}</div>
        <div class="fiche-ligne"><strong>${echapper(cl.contact)}</strong> · ${OFFRES[offreRequise(c)].nom} · ${cl.licences} licences · <strong>${euros(cl.arr)}/year</strong></div>
        <div class="sante"><span>Health</span><span class="sante-barre"><span style="width:${cl.sante}%;background:${couleurSante(cl.sante)}"></span></span><span>${Math.round(cl.sante)}</span></div>
        <div class="sante"><span>Usage</span><span class="sante-barre"><span style="width:${cl.adoption}%;background:#64748b"></span></span><span>${Math.round(cl.adoption)}%</span></div>
        <div class="chips">${cl.qbr ? chip((EN ? "QBR done" : "QBR faite"), "ok") : ""}${cl.reco ? chip((EN ? "Referral obtained" : "Recommandation obtenue"), "ok") : ""}${cl.upsell ? chip((EN ? "Expansion signed" : "Extension signée"), "ok") : ""}</div>
        <div class="pm-actions">
          ${boutonPm(suiviPossible ? (EN ? "Check-in" : "Point de suivi") : (EN ? "Recent check-in" : "Suivi récent"), "suivi", cl.id, { desactive: !suiviPossible || pasAuPoste })}
          ${boutonPm((EN ? "Ask for a referral" : "Demander une recommandation"), "reco", cl.id, { desactive: cl.reco || pasAuPoste })}
        </div></div>` : `<div class="fiche">
        <div class="fiche-entete"><span class="fiche-titre">${echapper(c.entreprise)}</span>${statut}</div>
        <div class="fiche-ligne"><strong>${echapper(cl.contact)}</strong> · ${OFFRES[offreRequise(c)].nom} · ${cl.licences} licences · <strong>${euros(cl.arr)}/an</strong></div>
        <div class="sante"><span>Santé</span><span class="sante-barre"><span style="width:${cl.sante}%;background:${couleurSante(cl.sante)}"></span></span><span>${Math.round(cl.sante)}</span></div>
        <div class="sante"><span>Utilisation</span><span class="sante-barre"><span style="width:${cl.adoption}%;background:#64748b"></span></span><span>${Math.round(cl.adoption)} %</span></div>
        <div class="chips">${cl.qbr ? chip((EN ? "QBR done" : "QBR faite"), "ok") : ""}${cl.reco ? chip((EN ? "Referral obtained" : "Recommandation obtenue"), "ok") : ""}${cl.upsell ? chip((EN ? "Expansion signed" : "Extension signée"), "ok") : ""}</div>
        <div class="pm-actions">
          ${boutonPm(suiviPossible ? (EN ? "Check-in" : "Point de suivi") : (EN ? "Recent check-in" : "Suivi récent"), "suivi", cl.id, { desactive: !suiviPossible || pasAuPoste })}
          ${boutonPm((EN ? "Ask for a referral" : "Demander une recommandation"), "reco", cl.id, { desactive: cl.reco || pasAuPoste })}
        </div></div>`);
    });
    return h;
  },
  commande(n, cmd, id, val) {
    if (cmd === "evenement") {
      const ev = n.evenements.find(e => e.id === id);
      if (!ev || ev.etat !== "ouvert") return;
      if (val === "site") { if (!controleSurSite(ev.client.c)) return; traiterEvenement(n, ev, true); }
      else { if (!controleSedentaire()) return; traiterEvenement(n, ev, false); }
    }
    const cl = n.clients.find(c => c.id === id);
    if (!cl || cl.parti) return;
    if (cmd === "suivi") { if (!controleSedentaire()) return; pointDeSuivi(n, cl, false); }
    if (cmd === "reco") { if (!controleSedentaire()) return; demanderRecommandation(n, cl); }
  },
  calculs(n) {
    const actifs = n.clients.filter(c => !c.parti);
    const retention = actifs.length / n.clients.length * 100;
    const arrInitial = n.clients.reduce((s, c) => s + c.arrInitial, 0);
    const nrr = actifs.reduce((s, c) => s + c.arr, 0) / arrInitial * 100;
    const clv = actifs.length ? actifs.reduce((s, c) => s + c.arr * MARGE_BRUTE * dureeVie(c.sante), 0) / actifs.length : 0;
    let nps = null;
    if (n.notes.length) {
      const pro = n.notes.filter(x => x >= 9).length, det = n.notes.filter(x => x <= 6).length;
      nps = Math.round((pro - det) / n.notes.length * 100);
    }
    return { actifs, retention, nrr, clv, nps };
  },
  kpis(n) {
    const r = M5.calculs(n), p = n.p;
    const seuil = (n.clients.length - p.churnMax) / n.clients.length * 100;
    return [
      { nom: (EN ? "Retention (customers retained)" : "Rétention (clients conservés)"), valeur: pourcent(r.retention), cible: `≥ ${pourcent(seuil)}`, ok: r.retention >= seuil - 0.01 },
      { nom: (EN ? "Churn (customers lost)" : "Churn (clients perdus)"), valeur: pourcent(100 - r.retention), cible: `≤ ${pourcent(100 - seuil)}`, ok: 100 - r.retention <= 100 - seuil + 0.01 },
      { nom: (EN ? "Net revenue retention (NRR)" : "Rétention nette du revenu (NRR)"), valeur: pourcent(r.nrr), cible: (EN ? "≥ 105% for Excellence" : "≥ 105 % pour Excellence"), ok: r.nrr >= 105 },
      { nom: (EN ? "Estimated average CLV" : "CLV moyenne estimée"), valeur: euros(r.clv), cible: (EN ? "ARR × margin × lifetime" : "ARR × marge × durée de vie"), ok: null },
      { nom: "NPS", valeur: r.nps === null ? (EN ? "not measured" : "non mesuré") : `${r.nps > 0 ? "+" : ""}${r.nps}${n.biais ? (EN ? " (biased)" : " (biaisé)") : ""}`, cible: (EN ? "≥ +30 for Excellence" : "≥ +30 pour Excellence"), ok: r.nps !== null && !n.biais && r.nps >= 30 },
      { nom: (EN ? "Referrals obtained" : "Recommandations obtenues"), valeur: `${n.recos}`, cible: "bonus", ok: n.recos > 0 ? true : null }
    ];
  },
  finTemps(n, anticipe = false) {
    const r = M5.calculs(n), p = n.p;
    const perdus = n.clients.length - r.actifs.length;
    if (!anticipe && perdus <= p.churnMax) {
      const etoiles = perdus === 0 && r.nps !== null && !n.biais && r.nps >= 30 && r.nrr >= 105 ? 3 : perdus === 0 ? 2 : 1;
      terminerNiveau(true, etoiles, (EN ? `${r.actifs.length} of ${n.clients.length} customers retained, net revenue retention of ${pourcent(r.nrr)}.` : `${r.actifs.length} clients sur ${n.clients.length} conservés, rétention nette du revenu de ${pourcent(r.nrr)}.`));
    } else {
      terminerNiveau(false, 0, (EN ? `${perdus} customer(s) lost: the allowed threshold (${p.churnMax}) is exceeded.` : `${perdus} client(s) perdu(s) : le seuil autorisé (${p.churnMax}) est dépassé.`));
    }
  }
};

function creerEvenement(n, client, type, debut, echeance) {
  const ev = { id: `E${n.compteur++}`, client, type, debut, echeance, etat: "ouvert", annonce: false };
  if (type === "sponsor") ev.successeur = n.successeurs.pop() || (EN ? "New contact" : "Nouvel interlocuteur");
  if (type === "upsell") ev.extension = Math.max(2, Math.round(client.licences * 0.3));
  n.evenements.push(ev);
  return ev;
}
const evenementOuvert = (n, cl, type) => n.evenements.some(e => e.client === cl && e.type === type && e.etat === "ouvert");

function genererEvenement(n) {
  const t = jeu.minutes;
  const candidats = [];
  n.clients.filter(c => !c.parti).forEach(cl => {
    if (!evenementOuvert(n, cl, "incident")) candidats.push([cl, "incident", 3]);
    if (cl.adoption < 72 && !evenementOuvert(n, cl, "adoption")) candidats.push([cl, "adoption", 3]);
    if (cl.sante >= 72 && !cl.upsell && !evenementOuvert(n, cl, "upsell")) candidats.push([cl, "upsell", 2]);
    if (!cl.sponsorChange && !n.evenements.some(e => e.type === "sponsor")) candidats.push([cl, "sponsor", 1]);
    if (cl.sante >= 85 && !cl.reco && !evenementOuvert(n, cl, "recommandation")) candidats.push([cl, "recommandation", 2]);
  });
  if (!candidats.length) return;
  const total = candidats.reduce((s, c) => s + c[2], 0);
  let r = Math.random() * total;
  const choisi = candidats.find(c => (r -= c[2]) <= 0) || candidats[0];
  const [cl, type] = choisi;
  if (type === "sponsor") cl.sponsorChange = true;
  creerEvenement(n, cl, type, t, t + TYPES_EVENEMENTS[type].delai);
}

function descriptionEvenement(ev) {
  const cl = ev.client;
  switch (ev.type) {
    case "incident": return (EN ? "Synchronisation with accounting has been down for 48 hours; the customer has opened an urgent ticket." : "La synchronisation avec la comptabilité est interrompue depuis 48 h ; le client a ouvert un ticket urgent.");
    case "adoption": return (EN ? `Only ${Math.round(cl.adoption)}% of users log in each week.` : `Seuls ${Math.round(cl.adoption)} % des utilisateurs se connectent chaque semaine.`);
    case "renouvellement": {
      const jour = Math.floor(cl.renouvellement / JOURNEE);
      return (EN ? `${euros(cl.arr)}/year contract, renewal due in week ${Math.floor(jour / 5) + 1} (${JOURS[jour % 5]}) · current health ${Math.round(cl.sante)}/100.` : `Contrat de ${euros(cl.arr)}/an, renouvellement prévu en semaine ${Math.floor(jour / 5) + 1} (${JOURS[jour % 5]}) · santé actuelle ${Math.round(cl.sante)}/100.`);
    }
    case "upsell": return (EN ? `${cl.c.entreprise} is hiring and opening a new sales team: about ${ev.extension} additional users.` : `${cl.c.entreprise} recrute et ouvre une nouvelle équipe commerciale : environ ${ev.extension} utilisateurs supplémentaires.`);
    case "sponsor": return (EN ? `${cl.contact} is leaving the company. ${ev.successeur} is taking over the account and doesn't know Veltis One.` : `${cl.contact} quitte l'entreprise. ${ev.successeur} reprend le dossier et ne connaît pas Veltis One.`);
    case "enquete": return (EN ? "Time to measure your customers' satisfaction (NPS)." : "C'est le moment de mesurer la satisfaction de vos clients (NPS).");
    case "recommandation": return (EN ? `${cl.contact} has just congratulated you on the roll-out: health ${Math.round(cl.sante)}/100.` : `${cl.contact} vient de vous féliciter pour le déploiement : santé ${Math.round(cl.sante)}/100.`);
    default: return "";
  }
}

function expirerEvenement(n, ev) {
  ev.etat = "expire";
  const cl = ev.client;
  switch (ev.type) {
    case "incident":
      cl.sante -= 25;
      erreur((EN ? `Critical incident not handled at ${cl.c.entreprise}: the relationship deteriorates sharply.` : `Incident critique non traité chez ${cl.c.entreprise} : forte dégradation de la relation.`), "organisation");
      break;
    case "adoption":
      cl.sante -= 10;
      manque((EN ? `${cl.c.entreprise}: drop in usage not addressed.` : `${cl.c.entreprise} : baisse d'utilisation non accompagnée.`), "organisation");
      break;
    case "upsell":
      manque((EN ? `${cl.c.entreprise}: expansion opportunity not seized.` : `${cl.c.entreprise} : opportunité de développement non saisie.`), "closing");
      break;
    case "sponsor":
      cl.sante -= 20;
      cl.contact = ev.successeur;
      erreur((EN ? `${cl.c.entreprise}: change of contact not managed, the new decision-maker questions the contract.` : `${cl.c.entreprise} : changement d'interlocuteur non accompagné, le nouveau décideur remet le contrat en question.`), "relation");
      break;
    case "enquete":
      manque((EN ? "Satisfaction survey not launched: NPS not measured this quarter." : "Enquête de satisfaction non lancée : NPS non mesuré ce trimestre."), "organisation");
      break;
    case "recommandation":
      manque((EN ? `${cl.c.entreprise}: very satisfied customer, no referral requested.` : `${cl.c.entreprise} : client très satisfait, aucune recommandation sollicitée.`), "relation");
      break;
    case "renouvellement":
      if (!cl.qbr) manque((EN ? `${cl.c.entreprise}: renewal handled without a business review.` : `${cl.c.entreprise} : renouvellement abordé sans revue d'activité.`), "relation");
      break;
  }
}

function perdreClient(n, cl, texte) {
  if (cl.parti) return;
  cl.parti = true;
  erreur(texte, "relation");
}

function interlocuteurClient(cl) {
  return { nom: cl.contact, fonction: cl.contact === cl.c.contact ? cl.c.fonction : (EN ? "New contact" : "Nouvel interlocuteur"), entreprise: cl.c.entreprise, couleur: cl.c.couleur };
}

function traiterEvenement(n, ev, surSite) {
  const cl = ev.client;
  const canal = surSite ? (EN ? "In person" : "Présentiel") : ev.type === "enquete" ? "E-mail" : ev.type === "renouvellement" || ev.type === "sponsor" ? (EN ? "Video call" : "Visio") : (EN ? "Phone" : "Téléphone");
  if (surSite) avancerTemps(120); else avancerTemps(45);
  const clore = () => { ev.etat = "traite"; };
  const fin = () => fermerEntretien();
  const bonusSite = surSite ? 7 : 0;
  const options = [];
  switch (ev.type) {
    case "incident":
      options.push(
        { label: (EN ? "Escalate to level-2 support with Inès, call the customer to explain the action plan and keep them informed until resolution." : "Escalader au support niveau 2 avec Inès, appeler le client pour expliquer le plan d'action et le tenir informé jusqu'à la résolution."), action: () => { cl.sante += 10; clore(); reussite((EN ? `${cl.c.entreprise}: incident taken in hand and customer kept informed.` : `${cl.c.entreprise} : incident pris en main et client tenu informé.`), "relation"); fin(); } },
        { label: (EN ? "Forward the ticket to support and wait for resolution." : "Transférer le ticket au support et attendre la résolution."), action: () => { cl.sante -= 5; clore(); manque((EN ? `${cl.c.entreprise}: incident forwarded without supporting the customer.` : `${cl.c.entreprise} : incident transféré sans accompagnement du client.`), "relation"); fin(); } },
        { label: (EN ? "Offer a free month's subscription, without addressing the cause." : "Proposer un mois d'abonnement offert, sans traiter la cause."), action: () => { cl.sante += 2; cl.arr -= cl.arr / 12; clore(); concession((EN ? `${cl.c.entreprise}: commercial gesture without solving the problem.` : `${cl.c.entreprise} : geste commercial sans résolution du problème.`), "negociation"); fin(); } },
        { label: (EN ? "Reassure the customer by promising a fix within 24 hours." : "Rassurer le client en lui promettant une résolution sous 24 heures."), action: () => { cl.sante -= 10; clore(); erreur((EN ? `${cl.c.entreprise}: resolution time promised without support's approval.` : `${cl.c.entreprise} : délai de résolution promis sans validation du support.`), "relation"); fin(); } }
      );
      break;
    case "adoption":
      options.push(
        { label: (EN ? "Organise a training session and an adoption plan with the internal champion." : "Organiser une session de formation et un plan d'adoption avec le référent interne."), action: () => { cl.sante += 12; cl.adoption += 22; clore(); reussite((EN ? `${cl.c.entreprise}: adoption plan launched with the champion.` : `${cl.c.entreprise} : plan d'adoption lancé avec le référent.`), "relation"); fin(); } },
        { label: (EN ? "Send the link to the online help centre." : "Envoyer le lien vers le centre d'aide en ligne."), action: () => { cl.sante += 2; cl.adoption += 4; clore(); manque((EN ? `${cl.c.entreprise}: drop in usage handled with a mere link.` : `${cl.c.entreprise} : baisse d'utilisation traitée par un simple lien.`), "relation"); fin(); } },
        { label: (EN ? "Offer the advanced reporting module as an upsell." : "Proposer le module de reporting avancé en vente additionnelle."), action: () => { cl.sante -= 8; clore(); erreur((EN ? `${cl.c.entreprise}: upsell offered to an account that doesn't use the tool.` : `${cl.c.entreprise} : vente additionnelle proposée à un compte qui n'utilise pas l'outil.`), "ciblage"); fin(); } },
        { label: (EN ? "Plan to reduce the number of licences at renewal, without telling the customer." : "Prévoir de réduire le nombre de licences au renouvellement, sans en parler au client."), action: () => { cl.sante -= 5; clore(); manque((EN ? `${cl.c.entreprise}: unilateral decision, without dialogue with the customer.` : `${cl.c.entreprise} : décision unilatérale, sans dialogue avec le client.`), "relation"); fin(); } }
      );
      break;
    case "renouvellement":
      options.push(
        { label: (EN ? "Prepare a business review (QBR): results achieved, usage, objectives for the year ahead." : "Préparer une revue d'activité (QBR) : résultats obtenus, utilisation, objectifs de l'année à venir."), action: () => { cl.qbr = true; cl.sante += 15 + bonusSite; clore(); reussite((EN ? `${cl.c.entreprise}: business review held${surSite ? (EN ? " face to face" : " en face à face") : ""}.` : `${cl.c.entreprise} : revue d'activité menée${surSite ? (EN ? " face to face" : " en face à face") : ""}.`), "relation"); fin(); } },
        { label: (EN ? "Send the renewal contract for e-signature, with a summary of new features." : "Envoyer le contrat de renouvellement en signature électronique, avec un récapitulatif des nouveautés."), action: () => { clore(); manque((EN ? `${cl.c.entreprise}: renewal handled administratively, without a business review.` : `${cl.c.entreprise} : renouvellement traité administrativement, sans revue d'activité.`), "closing"); fin(); } },
        { label: (EN ? "Offer a 10% discount upfront to secure the renewal." : "Proposer d'emblée 10 % de remise pour sécuriser le renouvellement."), action: () => { cl.sante += 5; cl.arr *= 0.9; clore(); concession((EN ? `${cl.c.entreprise}: 10% discount conceded with nothing in return.` : `${cl.c.entreprise} : remise de 10 % concédée sans contrepartie.`), "negociation"); fin(); } },
        { label: (EN ? "Use the renewal to propose an upgrade to the higher plan." : "Profiter du renouvellement pour proposer le passage à l'offre supérieure."), action: () => { cl.sante -= cl.sante < 70 ? 10 : 2; clore(); if (cl.sante < 70) erreur((EN ? `${cl.c.entreprise}: upgrade offered to a fragile customer.` : `${cl.c.entreprise} : montée en gamme proposée à un client fragile.`), "produit"); else manque((EN ? `${cl.c.entreprise}: upgrade offered with no stated need.` : `${cl.c.entreprise} : montée en gamme proposée sans besoin exprimé.`), "produit"); fin(); } }
      );
      break;
    case "upsell": {
      const ext = ev.extension;
      const surVente = offreRequise(cl.c) !== "enterprise";
      options.push(
        { label: (EN ? `Offer a suitable expansion: ${ext} additional licences for the new team.` : `Proposer une extension adaptée : ${ext} licences supplémentaires pour la nouvelle équipe.`), action: () => {
          const prix = OFFRES[offreRequise(cl.c)].prix * 12 * ext;
          cl.licences += ext; cl.arr += prix; cl.upsell = true; cl.sante += 3; n.ventes++; clore();
          reussite((EN ? `${cl.c.entreprise}: expansion of ${ext} licences signed (+${euros(prix)}/year).` : `${cl.c.entreprise} : extension de ${ext} licences signée (+${euros(prix)}/an).`), "produit"); fin();
        } },
        { label: surVente ? (EN ? "Propose moving to the full Enterprise plan." : "Proposer de passer à l'offre Enterprise complète.") : (EN ? "Propose adding premium support to every site, with no stated need." : "Proposer d'ajouter le support premium à tous les sites, sans besoin exprimé."), action: () => { cl.sante -= 8; clore(); erreur((EN ? `${cl.c.entreprise}: over-selling, proposal unrelated to the stated need.` : `${cl.c.entreprise} : sur-vente, proposition sans lien avec le besoin exprimé.`), "produit"); fin(); } },
        { label: (EN ? "Wait for the customer to bring it up themselves." : "Attendre que le client en parle de lui-même."), action: () => { clore(); manque((EN ? `${cl.c.entreprise}: expansion opportunity left aside.` : `${cl.c.entreprise} : opportunité de développement laissée de côté.`), "closing"); fin(); } }
      );
      break;
    }
    case "sponsor":
      options.push(
        { label: (EN ? `Quickly meet ${ev.successeur} to present the results achieved and understand their stakes.` : `Rencontrer rapidement ${ev.successeur} pour présenter les résultats obtenus et comprendre ses enjeux.`), action: () => { cl.contact = ev.successeur; cl.sante += 10 + bonusSite; clore(); reussite((EN ? `${cl.c.entreprise}: new contact met${surSite ? (EN ? " face to face" : " en face à face") : ""} and brought on board.` : `${cl.c.entreprise} : nouvel interlocuteur rencontré${surSite ? (EN ? " face to face" : " en face à face") : ""} et embarqué.`), "relation"); fin(); } },
        { label: (EN ? "Send a generic introduction email." : "Envoyer un e-mail de présentation générique."), action: () => { cl.contact = ev.successeur; cl.sante -= 5; clore(); manque((EN ? `${cl.c.entreprise}: new contact welcomed with a generic email.` : `${cl.c.entreprise} : nouvel interlocuteur accueilli par un e-mail générique.`), "relation"); fin(); } },
        { label: (EN ? "Wait until they've settled into the role so as not to disturb them." : "Attendre la fin de sa période de prise de poste pour ne pas le déranger."), action: () => { cl.contact = ev.successeur; cl.sante -= 20; clore(); erreur((EN ? `${cl.c.entreprise}: change of contact left unmanaged.` : `${cl.c.entreprise} : changement d'interlocuteur laissé sans accompagnement.`), "relation"); fin(); } }
      );
      break;
    case "enquete":
      options.push(
        { label: (EN ? "Send the survey to all customers and personally call back each detractor." : "Envoyer l'enquête à tous les clients et rappeler personnellement chaque détracteur."), action: () => {
          clore(); n.enqueteLancee = true;
          n.notes = n.clients.filter(c => !c.parti).map(c => (c.sante >= 80 ? entierTirage(`${c.id}|nps`, 9, 10) : c.sante >= 62 ? entierTirage(`${c.id}|nps`, 7, 8) : entierTirage(`${c.id}|nps`, 3, 6)));
          n.clients.filter(c => !c.parti && c.sante < 62).forEach(c => { c.sante += 6; });
          const r = M5.calculs(n);
          reussite((EN ? `NPS survey carried out across the whole portfolio (NPS ${r.nps > 0 ? "+" : ""}${r.nps}), detractors called back.` : `Enquête NPS menée auprès de tout le portefeuille (NPS ${r.nps > 0 ? "+" : ""}${r.nps}), détracteurs rappelés.`), "conformite"); fin();
        } },
        { label: (EN ? "Send the survey only to satisfied customers." : "Envoyer l'enquête uniquement aux clients satisfaits."), action: () => {
          clore(); n.enqueteLancee = true; n.biais = true;
          n.notes = n.clients.filter(c => !c.parti && c.sante >= 70).map(c => entierTirage(`${c.id}|nps`, 9, 10));
          erreur((EN ? "Biased satisfaction survey: only satisfied customers were asked." : "Enquête de satisfaction biaisée : seuls les clients satisfaits ont été interrogés."), "conformite"); fin();
        } },
        { label: (EN ? "Postpone the survey to next quarter, after the renewals." : "Reporter l'enquête au trimestre prochain, après les renouvellements."), action: () => { clore(); manque((EN ? "Satisfaction survey postponed: NPS not measured." : "Enquête de satisfaction reportée : NPS non mesuré."), "organisation"); fin(); } },
        { label: (EN ? "Survey only customers whose renewal is coming up." : "Interroger uniquement les clients dont le renouvellement approche."), action: () => {
          clore(); n.enqueteLancee = true; n.biais = true;
          n.notes = n.clients.filter(c => !c.parti && c.renouvellement - jeu.minutes < 4 * SEMAINE).map(c => (c.sante >= 80 ? entierTirage(`${c.id}|nps`, 9, 10) : c.sante >= 62 ? entierTirage(`${c.id}|nps`, 7, 8) : entierTirage(`${c.id}|nps`, 3, 6)));
          manque((EN ? "Partial survey sample: the NPS isn't representative of the portfolio." : "Échantillon d'enquête partiel : le NPS n'est pas représentatif du portefeuille."), "conformite"); fin();
        } }
      );
      break;
    case "recommandation":
      options.push(
        { label: (EN ? "Ask them for a testimonial or a referral within their network." : "Lui demander un témoignage ou une recommandation auprès de son réseau."), action: () => { cl.reco = true; n.recos++; cl.sante += 2; clore(); reussite((EN ? `${cl.c.entreprise}: referral obtained, a new prospect enters the funnel.` : `${cl.c.entreprise} : recommandation obtenue, un nouveau prospect entre dans le parcours.`), "relation"); fin(); } },
        { label: (EN ? "Ask nothing so as not to bother them." : "Ne rien demander pour ne pas déranger."), action: () => { clore(); manque((EN ? `${cl.c.entreprise}: promoter not approached.` : `${cl.c.entreprise} : promoteur non sollicité.`), "relation"); fin(); } },
        { label: (EN ? "Offer them a free month in exchange for a 5-star online review." : "Lui proposer un mois offert en échange d'un avis 5 étoiles en ligne."), action: () => { clore(); erreur((EN ? `${cl.c.entreprise}: customer review bought, a misleading practice.` : `${cl.c.entreprise} : avis client acheté, pratique trompeuse.`), "conformite"); fin(); } }
      );
      break;
  }
  ouvrirEntretien({
    interlocuteur: cl ? interlocuteurClient(cl) : null, titre: cl ? "" : (EN ? "Customer portfolio" : "Portefeuille clients"), canal,
    confiance: cl ? cl.sante : null,
    signal: cl ? (EN ? `<strong>Account health:</strong> ${Math.round(cl.sante)}/100 · <strong>Usage:</strong> ${Math.round(cl.adoption)}%` : `<strong>Santé du compte :</strong> ${Math.round(cl.sante)}/100 · <strong>Utilisation :</strong> ${Math.round(cl.adoption)} %`) : null,
    focus: surSite && cl ? cl.pnj.mesh : null,
    texte: (EN ? `${TYPES_EVENEMENTS[ev.type].nom}. ${descriptionEvenement(ev)}\n\nWhat do you do?` : `${TYPES_EVENEMENTS[ev.type].nom}. ${descriptionEvenement(ev)}\n\nQue faites-vous ?`),
    choix: melangerChoix(options)
  });
}

function visiteSurSite(n, cl) {
  const ev = n.evenements.filter(e => e.client === cl && e.etat === "ouvert" && jeu.minutes >= e.debut && TYPES_EVENEMENTS[e.type].presentiel).sort((a, b) => a.echeance - b.echeance)[0];
  if (ev) traiterEvenement(n, ev, true);
}

function pointDeSuivi(n, cl) {
  avancerTemps(45);
  cl.dernierSuivi = jeu.minutes;
  cl.sante = clamp(cl.sante + 6, 0, 100);
  cl.adoption = clamp(cl.adoption + 3, 0, 100);
  evaluer("relation", 1);
  information((EN ? `Check-in with ${cl.c.entreprise}.` : `Point de suivi avec ${cl.c.entreprise}.`));
  message((EN ? `Check-in with ${cl.contact} (${cl.c.entreprise}): relationship maintained.` : `Point de suivi avec ${cl.contact} (${cl.c.entreprise}) : relation entretenue.`), "ok");
}

function demanderRecommandation(n, cl) {
  avancerTemps(20);
  if (cl.sante >= 80) {
    cl.reco = true;
    n.recos++;
    n.evenements.filter(e => e.client === cl && e.type === "recommandation" && e.etat === "ouvert").forEach(e => { e.etat = "traite"; });
    reussite((EN ? `${cl.c.entreprise} agrees to recommend you.` : `${cl.c.entreprise} accepte de vous recommander.`), "relation");
  } else if (cl.sante >= 70) {
    manque((EN ? `${cl.c.entreprise} prefers to wait before recommending you.` : `${cl.c.entreprise} préfère attendre avant de vous recommander.`), "relation");
    message((EN ? `${cl.contact} prefers to wait until they have more perspective.` : `${cl.contact} préfère attendre d'avoir plus de recul.`), "info");
  } else {
    cl.sante -= 5;
    erreur((EN ? `Referral asked from ${cl.c.entreprise}, an unhappy customer.` : `Recommandation demandée à ${cl.c.entreprise}, client insatisfait.`), "relation");
  }
}

function pointInes(n, confirme = false) {
  const inter = interlocuteurCollegue("success");
  if (!confirme) {
    ouvrirEntretien({ interlocuteur: inter, canal: (EN ? "Sales floor" : "Plateau"), texte: (EN ? "“Do you want me to tell you which accounts to watch first?”\n\nUsing help costs 3 points on the mission score." : "« Tu veux que je te dise quels comptes surveiller en priorité ? »\n\nUtiliser une aide coûte 3 points au score de la mission."), choix: [
      { label: (EN ? "Yes, thanks Inès (−3 points)" : "Oui, merci Inès (−3 points)"), action: () => pointInes(n, true) },
      { label: (EN ? "No, I'll manage my portfolio" : "Non, je gère mon portefeuille"), action: fermerEntretien }
    ] });
    return;
  }
  const fragiles = n.clients.filter(c => !c.parti).sort((a, b) => a.sante - b.sante).slice(0, 2);
  avancerTemps(20);
  aideUtilisee((EN ? "check-in with Inès (Customer Success) on fragile accounts" : "point avec Inès (Customer Success) sur les comptes fragiles"));
  ouvrirEntretien({
    interlocuteur: inter, canal: (EN ? "Sales floor" : "Plateau"),
    texte: (EN ? `“The accounts to watch first: ${fragiles.map(c => (EN ? `${c.c.entreprise} (health ${Math.round(c.sante)}, usage ${Math.round(c.adoption)}%)` : `${c.c.entreprise} (santé ${Math.round(c.sante)}, utilisation ${Math.round(c.adoption)} %)`)).join((EN ? " and " : " et "))}. A customer whose health falls below 60 without a business review almost never renews. And don't offer anything more to a customer who doesn't use what they already have.”` : `« Les comptes à surveiller en priorité : ${fragiles.map(c => (EN ? `${c.c.entreprise} (health ${Math.round(c.sante)}, usage ${Math.round(c.adoption)}%)` : `${c.c.entreprise} (santé ${Math.round(c.sante)}, utilisation ${Math.round(c.adoption)} %)`)).join((EN ? " and " : " et "))}. Un client dont la santé passe sous 60 sans revue d'activité ne renouvelle presque jamais. Et ne propose rien de plus à un client qui n'utilise pas ce qu'il a déjà. »`),
    choix: [{ label: (EN ? "Thanks Inès" : "Merci Inès"), action: fermerEntretien }]
  });
}


/* =====================================================================
   PARTIE F — IMPRÉVUS, DÉROULEMENT, MODE DÉFI, CLAVIER, BOUCLE
   ===================================================================== */

/* ---------- F1. Imprévus : mises en situation en cours de mission ----------
   Chaque mission en compte deux. Plusieurs réponses peuvent être justes ;
   les pièges ressemblent à des réflexes courants sur le terrain. */
const IMPREVUS = {
  notoriete: [
    {
      interlocuteur: { nom: "Julie Mercier", fonction: (EN ? "Journalist" : "Journaliste"), entreprise: "L'Éco Normand", couleur: "#475569" }, canal: (EN ? "Trade show" : "Salon"),
      texte: (EN ? "A journalist from the regional business press stops at the stand: “Can you give me your number of customers and your revenue in the region?”" : "Une journaliste de la presse économique régionale s'arrête au stand : « Vous pouvez me donner votre nombre de clients et votre chiffre d'affaires dans la région ? »"),
      choix: [
        { label: (EN ? "Give the public information (more than 1,200 SME customers) and refer her to Léa in marketing for an interview." : "Donner les informations publiques (plus de 1 200 PME clientes) et l'orienter vers Léa, au marketing, pour une interview."), type: "ok", tag: "conformite", journal: (EN ? "Journalist referred to marketing with public information." : "Journaliste orientée vers le marketing avec des informations publiques.") },
        { label: (EN ? "Give her an estimate of regional revenue to get a nice article." : "Lui donner une estimation du chiffre d'affaires régional pour obtenir un bel article."), type: "ko", tag: "conformite", journal: (EN ? "Unapproved revenue figure given to the press." : "Chiffre d'affaires non validé communiqué à la presse.") },
        { label: (EN ? "Name your three biggest local customers and their amounts as an illustration." : "Lui citer vos trois plus gros clients locaux et leurs montants pour illustrer."), type: "ko", tag: "conformite", journal: (EN ? "Confidential customer information given to the press." : "Informations confidentielles de clients communiquées à la presse.") },
        { label: (EN ? "Refuse to answer: only executives speak to the press." : "Refuser de répondre : seuls les dirigeants parlent à la presse."), type: "manque", tag: "relation", journal: (EN ? "Missed media visibility opportunity." : "Occasion de visibilité médiatique manquée.") }
      ]
    },
    {
      interlocuteur: { nom: "Léa Chevalier", fonction: (EN ? "Marketing Manager" : "Responsable marketing"), entreprise: "Veltis", couleur: "#475569" }, canal: "Message",
      texte: (EN ? "Léa writes to you: “The team's LinkedIn post is getting 40% more clicks than expected, but 85% of visitors leave the site without viewing anything. What do you think?”" : "Léa vous écrit : « Le post LinkedIn de l'équipe fait 40 % de clics en plus que prévu, mais 85 % des visiteurs quittent le site sans rien consulter. Qu'en penses-tu ? »"),
      choix: [
        { label: (EN ? "Check that the landing page delivers on the post's promise and adjust it." : "Vérifier que la page d'arrivée tient la promesse du post et l'ajuster."), type: "ok", tag: "ciblage", journal: (EN ? "Consistency between the post and the landing page checked." : "Cohérence entre le post et la page d'arrivée vérifiée.") },
        { label: (EN ? "Analyse where the visitors who leave come from and who they are before deciding." : "Analyser la provenance et le profil des visiteurs qui repartent avant de décider."), type: "ok", tag: "ciblage", journal: (EN ? "Visitor analysis before deciding." : "Analyse des visiteurs avant décision.") },
        { label: (EN ? "Double the budget for this post, since it generates lots of clicks." : "Doubler le budget de ce post, puisqu'il génère beaucoup de clics."), type: "manque", tag: "ciblage", journal: (EN ? "Budget increased on a volume metric, without looking at quality." : "Budget augmenté sur un indicateur de volume, sans regarder la qualité.") },
        { label: (EN ? "Stop LinkedIn: the channel doesn't work." : "Arrêter LinkedIn : le canal ne fonctionne pas."), type: "manque", tag: "ciblage", journal: (EN ? "Channel dropped on a hasty conclusion." : "Canal abandonné sur une conclusion hâtive.") }
      ]
    }
  ],
  interet: [
    {
      interlocuteur: { nom: "Didier Lemaire", fonction: (EN ? "Owner-manager" : "Gérant"), entreprise: "Lemaire Transports", couleur: "#dc2626" }, canal: (EN ? "Phone" : "Téléphone"),
      texte: (EN ? "A lead calls you: “Before going any further, I want a free three-month trial.”" : "Un lead vous appelle : « Avant d'aller plus loin, je veux un essai gratuit de trois mois. »"),
      choix: [
        { label: (EN ? "Ask what they want to check during the trial, so you can offer the most useful demo." : "Lui demander ce qu'il veut vérifier pendant l'essai, pour lui proposer la démonstration la plus utile."), type: "ok", tag: "questionnement", journal: (EN ? "Trial objective clarified through questions." : "Objectif de l'essai clarifié par le questionnement.") },
        { label: (EN ? "Offer a structured 14-day trial, with objectives set together and a mid-point review." : "Proposer un essai encadré de 14 jours, avec des objectifs fixés ensemble et un point à mi-parcours."), type: "ok", tag: "negociation", journal: (EN ? "Structured, time-limited, managed trial." : "Essai encadré, limité dans le temps et piloté.") },
        { label: (EN ? "Accept the three months so as not to lose the lead." : "Accepter les trois mois pour ne pas perdre le lead."), type: "manque", tag: "negociation", journal: (EN ? "Three-month trial with no commitment: longer sales cycle." : "Essai de trois mois sans engagement : cycle de vente allongé.") },
        { label: (EN ? "Refuse: Veltis doesn't offer trials." : "Refuser : Veltis ne propose pas d'essai."), type: "manque", tag: "relation", journal: (EN ? "Request refused without looking for the need behind it." : "Demande refusée sans chercher le besoin derrière.") },
        { label: (EN ? "Open a full three-month account for them right away, you'll sort it out with your director later." : "Lui ouvrir tout de suite un compte complet de trois mois, vous régulariserez avec votre directrice ensuite."), type: "ko", tag: "conformite", journal: (EN ? "Commitment made without management approval." : "Engagement pris sans validation hiérarchique.") }
      ]
    },
    {
      interlocuteur: { nom: "Léa Chevalier", fonction: (EN ? "Marketing Manager" : "Responsable marketing"), entreprise: "Veltis", couleur: "#475569" }, canal: (EN ? "Sales floor" : "Plateau"),
      texte: (EN ? "Léa: “The field sales reps can only call back a few leads this week. Which ones do you pass to them first?”" : "Léa : « Les commerciaux terrain ne peuvent rappeler que quelques leads cette semaine. Lesquels leur transmets-tu en priorité ? »"),
      choix: [
        { label: (EN ? "Demo requests and visitors who regularly check the Pricing page." : "Les demandes de démonstration et les visiteurs qui consultent régulièrement la page Tarifs."), type: "ok", tag: "ciblage", journal: (EN ? "Priority given to leads close to a decision." : "Priorité donnée aux leads proches de la décision.") },
        { label: (EN ? "Those who downloaded the most blog content." : "Ceux qui ont téléchargé le plus de contenus du blog."), type: "manque", tag: "ciblage", journal: (EN ? "Priority given to reading volume rather than buying intent." : "Priorité donnée au volume de lecture plutôt qu'à l'intention d'achat.") },
        { label: (EN ? "The largest companies, whatever their behaviour." : "Les plus grandes entreprises, quel que soit leur comportement."), type: "manque", tag: "ciblage", journal: (EN ? "Priority given to size without considering maturity." : "Priorité donnée à la taille sans tenir compte de la maturité.") },
        { label: (EN ? "All of them, in order of arrival, to be fair." : "Tous, dans l'ordre d'arrivée, pour être équitable."), type: "manque", tag: "organisation", journal: (EN ? "No lead prioritisation." : "Aucune priorisation des leads.") }
      ]
    }
  ],
  consideration: [
    {
      interlocuteur: { nom: "Bertrand Joly", fonction: (EN ? "Administrative Director" : "Directeur administratif"), entreprise: "Joly Emballages", couleur: "#16a34a" }, canal: (EN ? "Phone" : "Téléphone"),
      texte: (EN ? "A prospect calls you back: “Just give me your price, I'll compare with the others.”" : "Un prospect vous rappelle : « Donnez-moi juste votre prix, je comparerai avec les autres. »"),
      choix: [
        { label: (EN ? "Give the public range (€29 to €89 per user), then ask what exactly they want to compare." : "Donner la fourchette publique (de 29 à 89 € par utilisateur), puis lui demander ce qu'il souhaite comparer exactement."), type: "ok", tag: "questionnement", journal: (EN ? "Public price given, then questions on the comparison criteria." : "Prix public donné, puis questionnement sur les critères de comparaison.") },
        { label: (EN ? "Send them the cheapest plan right away to stay in the race." : "Lui envoyer tout de suite l'offre la moins chère pour rester dans la course."), type: "manque", tag: "produit", journal: (EN ? "Offer sent without knowing the need." : "Offre envoyée sans connaître le besoin.") },
        { label: (EN ? "Refuse to give a price before a meeting." : "Refuser de donner un prix avant un rendez-vous."), type: "manque", tag: "relation", journal: (EN ? "Refusal perceived as a lack of transparency." : "Refus perçu comme un manque de transparence.") },
        { label: (EN ? "Announce a 15% discount for any signature this month." : "Lui annoncer 15 % de remise pour toute signature ce mois-ci."), type: "ko", tag: "negociation", journal: (EN ? "Discount beyond authority announced before any discovery." : "Remise hors délégation annoncée avant toute découverte.") }
      ]
    },
    {
      interlocuteur: { nom: "Yanis Haddad", fonction: (EN ? "Pre-sales Engineer" : "Ingénieur avant-vente"), entreprise: "Veltis", couleur: "#334155" }, canal: (EN ? "Sales floor" : "Plateau"),
      texte: (EN ? "Yanis: “For your demo tomorrow, the client wants to see seven modules in 45 minutes. How do we do it?”" : "Yanis : « Pour ta démonstration de demain, le client veut voir sept modules en 45 minutes. On fait comment ? »"),
      choix: [
        { label: (EN ? "Call the client back to prioritise with them the two or three topics that matter most." : "Rappeler le client pour prioriser avec lui les deux ou trois sujets qui comptent le plus."), type: "ok", tag: "ecoute", journal: (EN ? "Demo refocused with the client on their priorities." : "Démonstration recentrée avec le client sur ses priorités.") },
        { label: (EN ? "Offer two sessions: their priority issues tomorrow, the rest with their teams afterwards." : "Proposer deux temps : ses enjeux prioritaires demain, le reste avec ses équipes ensuite."), type: "ok", tag: "organisation", journal: (EN ? "Demo split into two sessions." : "Démonstration découpée en deux temps.") },
        { label: (EN ? "Show everything at high speed, that's what they asked for." : "Tout montrer en accéléré, c'est ce qu'il a demandé."), type: "manque", tag: "ecoute", journal: (EN ? "Fast-forward catalogue demo." : "Démonstration catalogue en accéléré.") },
        { label: (EN ? "Plan two hours instead of 45 minutes, without telling them." : "Prévoir deux heures au lieu de 45 minutes, sans le prévenir."), type: "manque", tag: "organisation", journal: (EN ? "Format imposed on the client without agreement." : "Format imposé au client sans accord.") }
      ]
    }
  ],
  decision: [
    {
      interlocuteur: { nom: (EN ? "Purchasing department" : "Service achats"), fonction: (EN ? "Buyer" : "Acheteuse"), entreprise: "Groupe Larcher", couleur: "#9f1239" }, canal: "E-mail",
      texte: (EN ? "Groupe Larcher's purchasing department writes to you: “Our policy requires a 25% discount from any new supplier.”" : "Le service achats de Groupe Larcher vous écrit : « Notre politique impose 25 % de remise à tout nouveau fournisseur. »"),
      choix: [
        { label: (EN ? "Ask for a meeting with the buyer to understand her criteria and defend the value, together with your operational contact." : "Demander un échange avec l'acheteuse pour comprendre ses critères et défendre la valeur, avec votre contact opérationnel."), type: "ok", tag: "negociation", journal: (EN ? "Meeting requested with purchasing to defend the value." : "Échange demandé avec les achats pour défendre la valeur.") },
        { label: (EN ? "Offer trade-offs without touching the unit price: 3-year commitment, annual payment in advance." : "Proposer des contreparties sans toucher au prix unitaire : engagement de 3 ans, paiement annuel d'avance."), type: "ok", tag: "negociation", journal: (EN ? "Trade-offs offered without lowering the unit price." : "Contreparties proposées sans baisser le prix unitaire.") },
        { label: (EN ? "Accept: it's their policy, you have no choice." : "Accepter : c'est leur politique, vous n'avez pas le choix."), type: "ko", tag: "negociation", journal: (EN ? "25% discount accepted, beyond your authority." : "Remise de 25 % acceptée, hors délégation.") },
        { label: (EN ? "Bypass purchasing and get the Chief Operating Officer to sign directly." : "Contourner les achats et faire signer directement le directeur des opérations."), type: "ko", tag: "conformite", journal: (EN ? "Attempt to bypass the customer's purchasing process." : "Tentative de contourner le processus d'achat du client.") }
      ]
    },
    {
      interlocuteur: { nom: "Nina Girard", fonction: (EN ? "Administrative Director" : "Directrice administrative"), entreprise: (EN ? "Customer in negotiation" : "Client en négociation"), couleur: "#b45309" }, canal: (EN ? "Phone" : "Téléphone"),
      texte: (EN ? "A customer asks to add a clause to the contract allowing termination at any time, without notice." : "Un client demande d'ajouter au contrat une clause de résiliation possible à tout moment, sans préavis."),
      choix: [
        { label: (EN ? "Understand the fear behind this request, then offer a structured reversibility period." : "Comprendre la crainte derrière cette demande, puis proposer une période de réversibilité encadrée."), type: "ok", tag: "objections", journal: (EN ? "Customer's fear addressed with structured reversibility." : "Crainte du client traitée par une réversibilité encadrée.") },
        { label: (EN ? "Have the request approved by your director and legal before answering." : "Faire valider la demande par votre directrice et le juridique avant de répondre."), type: "ok", tag: "conformite", journal: (EN ? "Clause submitted for approval before any answer." : "Clause soumise à validation avant toute réponse.") },
        { label: (EN ? "Accept in writing so as not to block the signature." : "Accepter par écrit pour ne pas bloquer la signature."), type: "ko", tag: "conformite", journal: (EN ? "Contract clause granted without approval." : "Clause contractuelle accordée sans validation.") },
        { label: (EN ? "Refuse firmly: our terms and conditions are not negotiable." : "Refuser fermement : nos conditions générales ne se négocient pas."), type: "manque", tag: "relation", journal: (EN ? "Refusal without looking for the customer's fear." : "Refus sans chercher la crainte du client.") }
      ]
    }
  ],
  fidelisation: [
    {
      interlocuteur: { nom: (EN ? "Online reputation alert" : "Alerte e-réputation"), fonction: (EN ? "Monitoring" : "Veille"), entreprise: "Veltis", couleur: "#ea580c" }, canal: "Notification",
      texte: (EN ? "One of your customers posts a negative review on a professional review site: “Slow support, we regret our choice.”" : "Un de vos clients publie un avis négatif sur un site d'avis professionnels : « Support lent, on regrette notre choix. »"),
      choix: [
        { label: (EN ? "Contact them quickly, understand and fix the problem, then reply publicly and factually." : "Le contacter rapidement, comprendre et régler le problème, puis répondre publiquement de façon factuelle."), type: "ok", tag: "relation", journal: (EN ? "Negative review handled: direct contact, resolution, public reply." : "Avis négatif traité : contact direct, résolution, réponse publique.") },
        { label: (EN ? "Ask satisfied customers to post positive reviews to drown out the negative one." : "Demander à des clients satisfaits de publier des avis positifs pour noyer l'avis négatif."), type: "ko", tag: "conformite", journal: (EN ? "Positive reviews solicited to hide a criticism." : "Avis positifs sollicités pour masquer une critique.") },
        { label: (EN ? "Reply publicly that the customer didn't follow the training offered." : "Répondre publiquement que le client n'a pas suivi la formation proposée."), type: "ko", tag: "relation", journal: (EN ? "Customer publicly blamed." : "Client mis en cause publiquement.") },
        { label: (EN ? "Don't reply: a reply would give the review more visibility." : "Ne pas répondre : une réponse donnerait plus de visibilité à l'avis."), type: "manque", tag: "relation", journal: (EN ? "Negative review left unanswered." : "Avis négatif laissé sans réponse.") }
      ]
    },
    {
      interlocuteur: { nom: (EN ? "Finance department" : "Direction financière"), fonction: (EN ? "CFO" : "DAF"), entreprise: (EN ? "Portfolio customer" : "Client du portefeuille"), couleur: "#ea580c" }, canal: (EN ? "Video call" : "Visio"),
      texte: (EN ? "A customer's finance director wants to cut 30% of licences mid-contract to reduce costs." : "La directrice financière d'un client veut supprimer 30 % des licences en cours de contrat pour réduire ses coûts."),
      choix: [
        { label: (EN ? "Analyse actual licence usage with her and propose an adoption plan or an adjustment at renewal." : "Analyser avec elle l'utilisation réelle des licences et proposer un plan d'adoption ou un ajustement au renouvellement."), type: "ok", tag: "relation", journal: (EN ? "Usage analysed, adjustment planned at renewal." : "Utilisation analysée, ajustement prévu au renouvellement.") },
        { label: (EN ? "Present the gains achieved with the tool and identify users who need retraining." : "Lui présenter les gains obtenus grâce à l'outil et identifier les utilisateurs à reformer."), type: "ok", tag: "produit", journal: (EN ? "Value demonstrated and users to retrain identified." : "Valeur démontrée et utilisateurs à reformer identifiés.") },
        { label: (EN ? "Immediately accept the reduction to preserve the relationship." : "Accepter immédiatement la réduction pour préserver la relation."), type: "manque", tag: "negociation", journal: (EN ? "Contract reduction granted without analysis." : "Réduction de contrat accordée sans analyse.") },
        { label: (EN ? "Remind her that the contract is binding and refuse any discussion." : "Lui rappeler que le contrat l'engage et refuser toute discussion."), type: "manque", tag: "relation", journal: (EN ? "Refusal without dialogue in the face of a budget constraint." : "Refus sans dialogue face à une contrainte budgétaire.") }
      ]
    }
  ]
};

function preparerImprevus(def) {
  const liste = IMPREVUS[def.id] || [];
  const duree = jeu.finMinutes - jeu.debutMinutes;
  jeu.imprevus = liste.map((imp, i) => ({ imp, instant: jeu.debutMinutes + duree * (i === 0 ? 0.3 : 0.62), decisions: i === 0 ? 3 : 8, fait: false }));
}
/* Un imprévu survient à un moment donné de la mission, ou plus tôt si le
   commercial a déjà pris un certain nombre de décisions (missions courtes). */
function verifierImprevus() {
  if (jeu.mode !== "jeu" || !jeu.imprevus) return;
  const decisions = jeu.journal.filter(j => j.type !== "info").length;
  const prochain = jeu.imprevus.find(x => !x.fait && (jeu.minutes >= x.instant || decisions >= x.decisions));
  if (!prochain) return;
  prochain.fait = true;
  lancerImprevu(prochain.imp);
}
function lancerImprevu(imp) {
  jeu.imprevuActif = imp;
  if (jeu.focusPanneau) quitterPanneau();
  son("sonnerie");
  noter("info", (EN ? `Unexpected event: ${imp.texte.split(":")[0]}.` : `Imprévu : ${imp.texte.split(":")[0]}.`));
  ouvrirEntretien({
    interlocuteur: imp.interlocuteur, canal: (EN ? `Unexpected event · ${imp.canal}` : `Imprévu · ${imp.canal}`),
    texte: (EN ? `${imp.texte}\n\nWhat do you do?` : `${imp.texte}\n\nQue faites-vous ?`),
    choix: melangerChoix(imp.choix).map(ch => ({
      label: ch.label,
      action: () => {
        jeu.imprevuActif = null;
        fermerEntretien();
        if (ch.type === "ok") reussite((EN ? `Unexpected event · ${ch.journal}` : `Imprévu · ${ch.journal}`), ch.tag);
        else if (ch.type === "ko") erreur((EN ? `Unexpected event · ${ch.journal}` : `Imprévu · ${ch.journal}`), ch.tag);
        else manque((EN ? `Unexpected event · ${ch.journal}` : `Imprévu · ${ch.journal}`), ch.tag);
      }
    }))
  });
}

/* ---------- F2. Déroulement : accueil, briefing, mission, bilan ---------- */
const NIVEAUX = [M1, M2, M3, M4, M5];
const PROFILS = {
  terrain: { nom: (EN ? "Field" : "Terrain"), description: (EN ? "Field sales rep: you meet your customers face to face in the client rooms on the floor (demos, presentations, business reviews). You read body language, but each in-person meeting takes time and a room." : "Commercial terrain : vous recevez vos clients en face à face dans les salons clients de l'étage (démonstrations, soutenances, revues d'activité). Vous lisez le non-verbal, mais chaque rendez-vous présentiel mobilise du temps et une salle.") },
  sedentaire: { nom: (EN ? "Inside sales" : "Sédentaire"), description: (EN ? "Inside sales rep: you work from your desk in the sales open space (phone, video, email). You handle more volume, with subtler signals, switchboards to get past and voicemails." : "Commercial sédentaire : vous travaillez depuis votre poste de l'open space commercial (téléphone, visio, e-mail). Vous gérez plus de volume, avec des signaux plus discrets, des standards à franchir et des messageries.") }
};
const ECRANS = ["ecran-demarrage", "ecran-accueil", "ecran-briefing", "ecran-bilan", "ecran-pause"];
function afficherEcran(id) {
  ECRANS.forEach(e => $(e).classList.toggle("cache", e !== id));
  liberer();
  if (id) setTimeout(focusEcran, 0);
}
function focusEcran() {
  if (jeu.mode === "menu" && demarrageVisible()) focusInitial($("ecran-demarrage"), "#btn-commencer");
  else if (jeu.mode === "menu") focusInitial($("ecran-accueil"), "#btn-hero");
  else if (jeu.mode === "briefing") focusInitial($("ecran-briefing"), "#btn-demarrer");
  else if (jeu.mode === "bilan") focusInitial($("bilan-boutons"), ".btn-principal");
  else if (jeu.mode === "pause") focusInitial($("ecran-pause"), "#btn-reprendre");
}
// Nombre de clients du portefeuille du participant. Sans saisie, une valeur par défaut
// permet de jouer tout de suite ; elle est signalée partout où elle sert (bilan, CSV).
// La sauvegarde garde null tant que le joueur n'a rien saisi : aucune migration nécessaire.
const PORTEFEUILLE_DEFAUT = 50;
const portefeuilleSaisi = () => { const v = parseInt(resultats.portefeuille, 10); return v > 0 ? v : null; };
const portefeuilleParDefaut = () => !portefeuilleSaisi();
const portefeuille = () => portefeuilleSaisi() || PORTEFEUILLE_DEFAUT;
const libelleExigence = () => (resultats.exigence === "confirme" ? (EN ? "Advanced" : "Confirmé") : "Standard");

function appliquerCouleurNiveau(def) {
  const r = document.documentElement.style;
  r.setProperty("--couleur-niveau", def.couleur);
  r.setProperty("--texte-niveau", def.texteCouleur);
  materiauCravateJoueur.color.set(def.couleur);
  materiauBalise.color.set(def.couleur);
  materiauAnneau.color.set(def.couleur);
}

function viderNiveau() {
  groupeR1.remove(groupeNiveau);
  groupeNiveau = new THREE.Group();
  groupeR1.add(groupeNiveau);
  etiquettes.forEach(e => e.el.remove());
  etiquettes.length = 0;
  employes.forEach(e => { e.etiquetteMission = false; });
  if (vie.tache) terminerTache();
  if (vie.demande) abandonnerDemande(false);
  vie.prochaineDemande = vie.temps + 40;
  interactifs.length = 0;
  pnjs.length = 0;
  apparitions.length = 0;
  obstaclesNiveau = [];
  jeu.destination = null;
  $("fenetre").classList.add("cache");
  jeu.fenetreOnFermeture = null;
  jeu.imprevus = [];
  jeu.imprevuActif = null;
  fermerEntretien();
  fermerPanneau();
  $("panneau-mission").classList.remove("reduit");
  $("btn-panneau").textContent = "–";
  $("hud-jauge").classList.add("cache");
  cacheKpis = "";
  kpisAffiches.valeurs = {};
  $("hud-kpis").innerHTML = "";
  $("pm-kpis").innerHTML = "";
}

function majReglages() {
  document.querySelectorAll("[data-profil]").forEach(b => b.classList.toggle("actif", b.dataset.profil === resultats.profil));
  if (jeu.mode === "menu" && $("trajectoire-posture")) afficherTrajectoire();
  document.querySelectorAll("[data-exigence]").forEach(b => b.classList.toggle("actif", b.dataset.exigence === resultats.exigence));
  $("case-son").checked = !!resultats.son;
  $("btn-son").textContent = resultats.son ? T("Son : activé (M)", "Sound: on (M)") : T("Son : coupé (M)", "Sound: off (M)");
  $("profil-description").textContent = PROFILS[resultats.profil].description;
  afficherProfilResume();
  const nb = portefeuille();
  const desc = $("portefeuille-description");
  desc.classList.toggle("par-defaut", portefeuilleParDefaut());
  desc.innerHTML = !portefeuilleParDefaut()
    ? (EN ? `<strong>Your real portfolio: ${nombre(nb)} customer${nb > 1 ? "s" : ""}.</strong> At your current funnel stage (${posture(resultats.posture[resultats.profil]).nom}), its projected lifetime value is <strong>${euros(nb * clvPosture(resultats.posture[resultats.profil]))}</strong>; at the Customer stage, it would reach <strong>${euros(nb * clvPosture(100))}</strong>.` : `<strong>Votre portefeuille réel : ${nombre(nb)} client${nb > 1 ? "s" : ""}.</strong> À votre étape actuelle du tunnel (${posture(resultats.posture[resultats.profil]).nom}), sa valeur vie projetée est de <strong>${euros(nb * clvPosture(resultats.posture[resultats.profil]))}</strong> ; à l'étape Client, elle atteindrait <strong>${euros(nb * clvPosture(100))}</strong>.`)
    : (EN ? `<strong>Default value: ${nombre(nb)} customers.</strong> Enter the number of customers in your real portfolio to measure what your funnel progress is worth in CLV on your own customers. Until then, results state that the default value was used.` : `<strong>Valeur par défaut : ${nombre(nb)} clients.</strong> Indiquez le nombre de clients de votre portefeuille réel pour mesurer ce que votre progression dans le tunnel vaut en CLV sur vos propres clients. D'ici là, les résultats précisent que la valeur par défaut a été utilisée.`);
}

// Accueil : profil résumé en une ligne ; « Modifier » déplie la carte de réglages
const accueil = { profilOuvert: false };
function afficherProfilResume() {
  const nb = portefeuille();
  const tag = (t, classe = "") => `<span class="tag ${classe}">${t}</span>`;
  $("profil-resume").innerHTML = `<span class="pr-label">${T("Votre profil :", "Your profile:")}</span>` +
    (resultats.nom ? tag(echapper(resultats.nom)) : "") + tag(PROFILS[resultats.profil].nom) + tag(libelleExigence()) +
    (portefeuilleParDefaut() ? tag(T(`${nombre(nb)} clients · par défaut`, `${nombre(nb)} customers · default`), "tag-defaut") : tag(T(`${nombre(nb)} client${nb > 1 ? "s" : ""}`, `${nombre(nb)} customer${nb > 1 ? "s" : ""}`))) +
    `<button type="button" id="btn-profil" class="btn-lien" aria-expanded="${accueil.profilOuvert}" aria-controls="profil-carte">${accueil.profilOuvert ? T("Masquer", "Hide") : T("Modifier", "Edit")}</button>`;
  $("btn-profil").addEventListener("click", () => {
    son("clic");
    accueil.profilOuvert = !accueil.profilOuvert;
    $("profil-carte").classList.toggle("cache", !accueil.profilOuvert);
    afficherProfilResume();
    if (accueil.profilOuvert) focaliser($("nom-participant")); else focaliser($("btn-profil"));
  });
}

/* ---------- F3. Classement ---------- */
function entreesDefi(profil = resultats.profil, exigence = resultats.exigence) {
  return resultats.historique.filter(h => h.nom && h.profilId === profil && h.exigenceId === exigence);
}
const comparerResultats = (a, b) => b.score - a.score || a.erreurs - b.erreurs || (a.dureeSec || 0) - (b.dureeSec || 0);
function meilleurParParticipant(entrees) {
  const m = new Map();
  entrees.forEach(h => {
    const cle = h.nom.trim().toLowerCase();
    if (!m.has(cle) || comparerResultats(h, m.get(cle)) < 0) m.set(cle, h);
  });
  return [...m.values()].sort(comparerResultats);
}
function afficherClassement() {
  $("classement-titre").textContent = `Classement · ${PROFILS[resultats.profil].nom} · ${libelleExigence()}`;
  const entrees = entreesDefi();
  const noms = new Map();
  entrees.forEach(h => {
    const cle = h.nom.trim().toLowerCase();
    if (!noms.has(cle)) noms.set(cle, { nom: h.nom, etapes: Array(NB_ETAPES).fill(null) });
    const i = NIVEAUX.findIndex(d => d.id === h.etapeId);
    const actuel = noms.get(cle).etapes[i];
    if (i >= 0 && (!actuel || comparerResultats(h, actuel) < 0)) noms.get(cle).etapes[i] = h;
  });
  const lignes = [...noms.values()].map(p => ({
    nom: p.nom, etapes: p.etapes,
    total: p.etapes.reduce((s, h) => s + (h ? h.score : 0), 0),
    erreurs: p.etapes.reduce((s, h) => s + (h ? h.erreurs : 0), 0),
    nb: p.etapes.filter(Boolean).length
  })).sort((a, b) => b.total - a.total || a.erreurs - b.erreurs || b.nb - a.nb);
  const zone = $("classement-contenu");
  if (!lignes.length) {
    zone.innerHTML = (EN ? '<p class="vide">No participants ranked yet. Enter your name to appear in the ranking.</p>' : '<p class="vide">Aucun participant classé pour l\'instant. Renseignez votre nom pour apparaître au classement.</p>');
    return;
  }
  zone.innerHTML = (EN ? `<table class="tableau-historique"><thead><tr><th>Rank</th><th>Participant</th>${NIVEAUX.map(d => `<th><span class="pastille-etape" style="background:${d.couleur}"></span>${d.phase}</th>`).join("")}<th>Total</th><th>Errors</th></tr></thead><tbody>` : `<table class="tableau-historique"><thead><tr><th>Rang</th><th>Participant</th>${NIVEAUX.map(d => `<th><span class="pastille-etape" style="background:${d.couleur}"></span>${d.phase}</th>`).join("")}<th>Total</th><th>Erreurs</th></tr></thead><tbody>`) +
    lignes.slice(0, 10).map((l, i) => `<tr${l.nom.trim().toLowerCase() === (resultats.nom || "").trim().toLowerCase() ? ' class="ligne-moi"' : ""}><td class="rang">${i + 1}</td><td>${echapper(l.nom)}</td>${l.etapes.map(h => `<td>${h ? h.score : "—"}</td>`).join("")}<td class="fort">${l.total}/${NB_ETAPES * 100}</td><td>${l.erreurs}</td></tr>`).join("") +
    "</tbody></table>";
}

/* Trajectoire du participant : posture commerciale et tunnel complet
   (produit des taux de conversion des quatre étapes du tunnel). */
function afficherTrajectoire() {
  const profil = resultats.profil;
  const v = resultats.posture[profil];
  const p = posture(v);
  const echelle = POSTURES.map(x => `<span class="pst-niveau${x === p ? " actif" : ""}" data-posture="${x.cle}"><span class="pst-icone">${x.icone}</span><span><strong>${x.nom}</strong><small>${echapper(x.devise)}</small></span></span>`).join("");
  const traj = resultats.trajectoire[profil].slice(-6);
  $("trajectoire-posture").innerHTML =
    `<div class="pst-echelle">${echelle}</div>` +
    `<div class="pst-jauge"><span style="width:${v}%"></span><i style="left:${v}%"></i></div>` +
    (EN ? `<p class="pst-texte"><strong>Stage ${p.icone} · “${p.nom}” (${v}/100).</strong> ${echapper(p.description)} Projected lifetime of your customers: <strong>${ansTexte(dureeViePosture(v))}</strong> · CLV of a typical customer: <strong>${euros(clvPosture(v))}</strong> (versus ${euros(clvPosture(100))} at the Customer stage)${portefeuille() ? (EN ? `. On your portfolio of ${nombre(portefeuille())} customers: <strong>${euros(portefeuille() * clvPosture(v))}</strong>` : `. Sur votre portefeuille de ${nombre(portefeuille())} clients : <strong>${euros(portefeuille() * clvPosture(v))}</strong>`) : ""}.</p>` : `<p class="pst-texte"><strong>Étape ${p.icone} · ${guillemets(p.nom)} (${v}/100).</strong> ${echapper(p.description)} Durée de vie projetée de vos clients : <strong>${ansTexte(dureeViePosture(v))}</strong> · CLV d'un client type : <strong>${euros(clvPosture(v))}</strong> (contre ${euros(clvPosture(100))} à l'étape Client)${portefeuille() ? (EN ? `. On your portfolio of ${nombre(portefeuille())} customers: <strong>${euros(portefeuille() * clvPosture(v))}</strong>` : `. Sur votre portefeuille de ${nombre(portefeuille())} clients : <strong>${euros(portefeuille() * clvPosture(v))}</strong>`) : ""}.</p>`) +
    (traj.length ? (EN ? `<p class="pst-histo">Latest missions: ${traj.map(t => `${echapper((NIVEAUX.find(d => d.id === (t.etapeId || ID_PHASE[t.etape])) || { phase: t.etape }).phase)} ${t.avant}→${t.apres}`).join(" · ")}</p>` : `<p class="pst-histo">Dernières missions : ${traj.map(t => `${echapper((NIVEAUX.find(d => d.id === (t.etapeId || ID_PHASE[t.etape])) || { phase: t.etape }).phase)} ${t.avant}→${t.apres}`).join(" · ")}</p>`) : "");
  const etapes = NIVEAUX.map((d, i) => ({ d, t: resultats.tunnels[profil][i] })).filter(x => !x.d.bonus);
  const complets = etapes.every(x => x.t);
  const global = complets ? etapes.reduce((acc, x) => acc * x.t.taux / 100, 1) : null;
  $("trajectoire-tunnel").innerHTML =
    `<div class="tunnel-global">${etapes.map(x => `<div class="tg-etape" style="--couleur:${x.d.couleur}"><span class="tg-de">${x.d.transition[0]} → ${x.d.transition[1]}</span><strong>${x.t ? pourcent(x.t.taux) : "—"}</strong><span class="tg-nom">${x.d.phase}</span></div>`).join('<span class="tg-fleche">×</span>')}</div>` +
    `<p class="pst-texte">${complets
      ? (EN ? `Your full funnel: out of <strong>1,000 strangers</strong> approached, <strong>${nombre(global * 1000)}</strong> become customers (${pourcentPrecis(global * 100)}). Each stage multiplies the next: improve the weakest one.` : `Votre tunnel complet : sur <strong>1 000 inconnus</strong> abordés, <strong>${nombre(global * 1000)}</strong> deviennent clients (${pourcentPrecis(global * 100)}). Chaque étage multiplie le suivant : améliorez l'étape la plus faible.`)
      : (EN ? "Play the four funnel stages to calculate your overall conversion rate, from stranger to customer." : "Jouez les quatre étapes du tunnel pour calculer votre taux de conversion global, d'inconnu à client.")}</p>`;
}

function afficherHistorique() {
  const zone = $("historique-contenu");
  const h = resultats.historique.slice(-6).reverse();
  if (!h.length) {
    zone.innerHTML = (EN ? '<p class="vide">No missions completed on this device yet.</p>' : '<p class="vide">Aucune mission réalisée sur ce poste pour le moment.</p>');
    return;
  }
  zone.innerHTML = (EN ? `<table class="tableau-historique"><thead><tr><th>Date</th><th>Participant</th><th>Portfolio</th><th>Profile</th><th>Stage</th><th>Status</th><th>Score</th><th>Errors</th><th>Result code</th></tr></thead><tbody>` : `<table class="tableau-historique"><thead><tr><th>Date</th><th>Participant</th><th>Portefeuille</th><th>Profil</th><th>Étape</th><th>Statut</th><th>Score</th><th>Erreurs</th><th>Code résultat</th></tr></thead><tbody>`) +
    h.map(x => {
      const def = NIVEAUX.find(d => d.id === x.etapeId);
      const classe = x.statut === "reussi" ? "statut-ok" : x.statut === "interrompu" ? "statut-stop" : "statut-ko";
      return `<tr><td>${echapper(x.date)}</td><td>${echapper(x.nom || "—")}</td><td>${x.portefeuille ? nombre(x.portefeuille) : "—"}</td><td>${echapper(PROFILS[x.profilId] ? PROFILS[x.profilId].nom : x.profil)}</td>` +
        `<td><span class="pastille-etape" style="background:${def ? def.couleur : "#999"}"></span>${echapper(def ? def.phase : x.etape)}</td>` +
        `<td class="statut ${classe}">${echapper(x.statutTexte)}</td><td>${x.score}/100</td><td>${x.erreurs}/${MAX_ERREURS}</td><td class="code">${echapper(x.signature || "—")}</td></tr>`;
    }).join("") + "</tbody></table>";
}

function afficherAccueil() {
  viderNiveau();
  jeu.mode = "menu";
  jeu.def = null;
  jeu.n = null;
  ["hud", "manette", "indice", "minimap", "rappel-touches"].forEach(id => $(id).classList.add("cache"));
  $("nom-participant").value = resultats.nom || "";
  $("portefeuille").value = portefeuilleSaisi() || "";
  majReglages();
  $("profil-carte").classList.toggle("cache", !accueil.profilOuvert);
  const profil = resultats.profil;
  const grille = $("grille-etapes");
  grille.innerHTML = "";
  NIVEAUX.forEach((def, i) => {
    const carte = document.createElement("button");
    carte.className = "carte-etape";
    carte.dataset.index = i;
    carte.style.setProperty("--couleur", def.couleur);
    carte.style.setProperty("--couleur-texte", def.couleur);
    const tentatives = resultats.tentatives[profil][i];
    const score = tentatives
      ? (EN ? `<span>Device record: ${resultats.meilleurs[profil][i]}/100</span><span class="etoiles-mini">${resultats.etoiles[profil][i] ? etoilesTexte(resultats.etoiles[profil][i]) : ""}</span>` : `<span>Record du poste : ${resultats.meilleurs[profil][i]}/100</span><span class="etoiles-mini">${resultats.etoiles[profil][i] ? etoilesTexte(resultats.etoiles[profil][i]) : ""}</span>`)
      : (EN ? "<span>Not played</span><span></span>" : "<span>Non réalisée</span><span></span>");
    if (def.bonus) carte.classList.add("carte-bonus");
    const tn = resultats.tunnels[profil][i];
    carte.title = def.objectifTableau;
    carte.innerHTML =
      `<span class="num">${def.bonus ? "Bonus" : (EN ? `Stage ${i + 1}` : `Étape ${i + 1}`)}</span>` +
      `<span class="nom">${def.phase}</span>` +
      `<span class="transition">${def.transition[0]} <span>→</span> ${def.transition[1]}</span>` +
      (tn ? (EN ? `<span class="ligne-petite">Latest conversion: ${pourcent(tn.taux)}</span>` : `<span class="ligne-petite">Dernière conversion : ${pourcent(tn.taux)}</span>`) : "") +
      `<span class="score">${score}</span>`;
    carte.addEventListener("click", () => { son("clic"); lancerNiveau(i); });
    grille.appendChild(carte);
  });
  afficherTrajectoire();
  afficherClassement();
  afficherHistorique();
  verifierBadges();
  afficherBadges();
  afficherHero();
  afficherOngletAccueil(ongletAccueil);
  majBoutonsLangue();
  afficherEcran("ecran-accueil");
}

function placerJoueur(x, z, angle = 0, etage = 1) {
  if (joueur.etage !== etage) changerEtage(etage);
  joueur.x = x;
  joueur.z = z;
  joueur.mesh.position.set(x, 0, z);
  joueur.mesh.rotation.y = angle;
  jeu.lacet = angle;
  jeu.tangage = -0.05;
}

function lancerNiveau(i) {
  viderNiveau();
  const def = NIVEAUX[i];
  const p = def.params[resultats.exigence] || def.params.standard;
  jeu.profil = resultats.profil;
  initialiserAlea(`libre|${def.id}|${Date.now()}|${Math.random()}`);
  const per = def.periode(p);
  Object.assign(jeu, {
    niveauIndex: i, def, n: {}, p, erreurs: 0, journal: [], competences: {}, dureeReelle: 0, acceleration: 1, aides: 0,
    minutes: per.debut, debutMinutes: per.debut, finMinutes: per.fin, rythme: per.rythme, affichage: per.affichage, zoom: reglages().zoom,
    focusPanneau: false, cleFocusPanneau: "", indexFocusPanneau: 0,
    posture: resultats.posture[resultats.profil], postureDepart: resultats.posture[resultats.profil], reflexesRequin: [], gestesPartenaire: 0,
    echangesDepart: vie.echanges, reseauDepart: reseauInterne()
  });
  appliquerCouleurNiveau(def);
  const d = def.depart();
  placerJoueur(d.x, d.z, d.angle || 0);
  jeu.tunnelPrec = null;
  def.demarrer(jeu.n, p);
  if (!jeu.n.p) jeu.n.p = p;
  appliquerMatieres();
  preparerImprevus(def);
  const pp = jeu.n.p;
  majPipsErreurs();
  $("hud-pastille").textContent = def.bonus ? "Bonus" : (EN ? `Stage ${i + 1}` : `Étape ${i + 1}`);
  cacheTunnel = "";
  majPosture();
  $("hud-niveau").textContent = `${def.phase} · ${def.transition.join(" → ")}`;
  $("hud-mission").textContent = def.mission(pp);
  $("hud-mission").title = def.mission(pp);
  $("btn-accelerer").classList.remove("actif");

  $("briefing-bandeau").style.background = def.couleur;
  $("briefing-badge").textContent = `${def.bonus ? "Bonus" : (EN ? `Stage ${i + 1}` : `Étape ${i + 1}`)} · ${def.transition.join(" → ")} · ${PROFILS[jeu.profil].nom} · ${libelleExigence()}`;
  $("briefing-badge").style.background = def.couleur;
  $("briefing-badge").style.color = def.texteCouleur;
  $("briefing-titre").textContent = def.titre;
  $("briefing-contexte").textContent = def.contexte;
  $("briefing-business").textContent = def.objectifBusiness;
  $("briefing-mission").textContent = def.mission(pp);
  $("briefing-consignes").innerHTML = def.consignes(pp).map(c => `<li>${echapper(c)}</li>`).join("");
  $("briefing-profil-titre").textContent = (EN ? `Your profile · ${PROFILS[jeu.profil].nom}` : `Votre profil · ${PROFILS[jeu.profil].nom}`);
  $("briefing-profil").textContent = def.profilNote();
  const pst = posture();
  $("briefing-posture").innerHTML = frisePassage(def) + (EN ? `<p>Your funnel progress: <strong>stage ${pst.icone} · ${pst.nom}</strong> (${Math.round(jeu.posture)}/100) — ${echapper(pst.description)}</p>` : `<p>Votre progression dans le tunnel : <strong>étape ${pst.icone} · ${pst.nom}</strong> (${Math.round(jeu.posture)}/100) — ${echapper(pst.description)}</p>`) +
    (EN ? `<p><strong>The conversion blocker to avoid:</strong> ${echapper(def.reflexeRequin)}</p>` : `<p><strong>Le frein à la conversion à éviter :</strong> ${echapper(def.reflexeRequin)}</p>`) +
    (EN ? `<p>Every decision that moves a contact forward advances your funnel progress; every conversion blocker (pressure, false urgency, discount with nothing in return, over-selling, premature selling) sets it back. The further you progress, the longer your customers stay: current projected lifetime <strong>${ansTexte(dureeViePosture(jeu.posture))}</strong>, i.e. a CLV of <strong>${euros(clvPosture(jeu.posture))}</strong> for a typical customer.</p>` : `<p>Chaque décision qui fait avancer un contact fait progresser votre jauge ; chaque frein à la conversion (pression, fausse urgence, remise sans contrepartie, sur-vente, vente prématurée) la fait reculer. Plus vous progressez, plus vos clients restent longtemps : durée de vie projetée actuelle <strong>${ansTexte(dureeViePosture(jeu.posture))}</strong>, soit une CLV de <strong>${euros(clvPosture(jeu.posture))}</strong> pour un client type.</p>`);
  $("briefing-criteres").innerHTML = def.criteres(pp).concat([
    (EN ? `Limit: the mission stops at ${MAX_ERREURS} errors.` : `Limite : la mission est interrompue à ${MAX_ERREURS} erreurs.`),
    (EN ? "Two unexpected events will occur during the mission: several answers may be right, others are common traps." : "Deux imprévus surviendront pendant la mission : plusieurs réponses peuvent être justes, d'autres sont des pièges courants."),
    (EN ? "Colleagues' tips are aids: each one costs 3 points. The sales guide (G key) is free to use." : "Les conseils des collègues sont des aides : chacune coûte 3 points au score. Le guide du commercial (touche G) est libre d'accès."),
    (EN ? "Time is simulated: it moves forward when you walk and with each action. It stops during conversations and windows." : "Le temps est simulé : il avance quand vous vous déplacez et à chaque action. Il s'arrête pendant les entretiens et les fenêtres.")
  ]).map(c => `<li>${echapper(c)}</li>`).join("");
  $("briefing-details").open = false;
  majBoutonDetails();
  jeu.mode = "briefing";
  $("hud").classList.remove("cache");
  afficherEcran("ecran-briefing");
}

function commencerNiveau() {
  if (jeu.mode !== "briefing") return;
  afficherEcran(null);
  $("manette").classList.remove("cache");
  $("rappel-touches").classList.toggle("cache", resultats.historique.length > 0);
  jeu.mode = "jeu";
  noter("info", (EN ? "Mission started." : "Début de la mission."));
  // 60 premières secondes : une consigne à la fois. Le didacticiel suit l'animation d'étape ;
  // l'astuce « Tab » est portée par le didacticiel et le rappel des touches.
  const mission = jeu.def;
  animerDebutEtape(jeu.def, jeu.niveauIndex, () => { if (jeu.def === mission) lancerDidacticiel(); });
  if (jeu.def.auDemarrage) jeu.def.auDemarrage(jeu.n);
  majPanneau(true);
}

function interrompreMission() {
  son("echec");
  terminerNiveau(false, 0, (EN ? `You have reached the limit of ${MAX_ERREURS} errors. Review the mission log below, then restart the mission.` : `Vous avez atteint la limite de ${MAX_ERREURS} erreurs. Analysez le journal de mission ci-dessous, puis recommencez la mission.`), { interrompu: true });
}

function terminerNiveau(succes, etoiles, texte, options = {}) {
  if (jeu.mode === "bilan" || !jeu.def) return;
  if (!options.interrompu && jeu.erreurs >= MAX_ERREURS) {
    options = { interrompu: true };
    succes = false;
    etoiles = 0;
    texte = (EN ? `You have reached the limit of ${MAX_ERREURS} errors. Review the mission log below, then restart the mission.` : `Vous avez atteint la limite de ${MAX_ERREURS} erreurs. Analysez le journal de mission ci-dessous, puis recommencez la mission.`);
  }
  $("fenetre").classList.add("cache");
  jeu.fenetreOnFermeture = null;
  jeu.imprevuActif = null;
  fermerEntretien();
  jeu.mode = "bilan";
  touches.clear();
  ["manette", "indice", "rappel-touches"].forEach(id => $(id).classList.add("cache"));
  fermerPanneau();
  const i = jeu.niveauIndex, def = jeu.def, n = jeu.n;
  const statut = options.interrompu ? "interrompu" : succes ? "reussi" : "echoue";
  const statutTexte = { reussi: (EN ? "Target reached" : "Objectif atteint"), echoue: (EN ? "Target not reached" : "Objectif non atteint"), interrompu: (EN ? "Stopped (5 errors)" : "Interrompue (5 erreurs)") }[statut];
  const score = clamp(calculerScore(statut, etoiles, jeu.erreurs) - jeu.aides * 3, 0, 100);
  let kpis = [];
  try { kpis = def.kpis(n); } catch (e) { kpis = []; }
  son(options.interrompu ? "echec" : succes ? "victoire" : "echec");
  noter(succes ? "ok" : "ko", (EN ? `End of mission: ${statutTexte.toLowerCase()}.` : `Fin de mission : ${statutTexte.toLowerCase()}.`));

  const profil = jeu.profil;
  const nbClients = portefeuille();
  resultats.tentatives[profil][i] += 1;
  if (succes) resultats.etoiles[profil][i] = Math.max(resultats.etoiles[profil][i], etoiles);
  resultats.meilleurs[profil][i] = Math.max(resultats.meilleurs[profil][i], score);
  const tunnel = def.tunnel ? def.tunnel(n) : null;
  if (tunnel) resultats.tunnels[profil][i] = { taux: tauxTunnel(tunnel), entree: tunnel.etapes[0].valeur, sortie: tunnel.etapes[tunnel.etapes.length - 1].valeur };
  resultats.posture[profil] = Math.round(jeu.posture);
  resultats.trajectoire[profil].push({ etape: def.phase, etapeId: def.id, avant: Math.round(jeu.postureDepart), apres: Math.round(jeu.posture) });
  if (resultats.trajectoire[profil].length > 30) resultats.trajectoire[profil].shift();
  const date = new Date();
  const dureeSec = Math.round(jeu.dureeReelle);
  const duree = `${Math.floor(dureeSec / 60)} min ${String(dureeSec % 60).padStart(2, "0")} s`;
  const signature = (hacher(`${(resultats.nom || "").trim().toLowerCase()}|${nbClients}|${def.id}|${profil}|${resultats.exigence}|${score}|${jeu.erreurs}|${dureeSec}|veltis`) % 2176782336).toString(36).toUpperCase().padStart(6, "0");
  const competences = Object.entries(jeu.competences).filter(([, c]) => c.total).map(([k, c]) => ({ cle: k, nom: COMPETENCES[k], pct: Math.round(c.ok / c.total * 100) }));
  const entree = {
    date: date.toLocaleString(LOCALE, { dateStyle: "short", timeStyle: "short" }),
    nom: resultats.nom, portefeuille: nbClients, portefeuilleDefaut: portefeuilleParDefaut(), profil: PROFILS[profil].nom, etape: def.phase, exigence: libelleExigence(),
    etapeId: def.id, profilId: profil, exigenceId: resultats.exigence,
    statut, statutTexte, etoiles: succes ? etoiles : 0, score, erreurs: jeu.erreurs, aides: jeu.aides, duree, dureeSec, signature,
    conversion: tunnel ? Math.round(tauxTunnel(tunnel)) : null, posture: posture().nom, reflexesRequin: jeu.reflexesRequin.length,
    kpis: kpis.map(k => `${k.nom} : ${k.valeur}`).join(" | "),
    competences: competences.map(c => `${c.nom} : ${c.pct} %`).join(" | ")
  };
  resultats.historique.push(entree);
  if (resultats.historique.length > 500) resultats.historique.splice(0, resultats.historique.length - 500);
  sauverResultats();

  $("bilan-bandeau").style.background = options.interrompu ? "#b91c1c" : def.couleur;
  $("bilan-participant").textContent = (EN ? `${resultats.nom ? resultats.nom + " · " : ""}${PROFILS[profil].nom} · ${def.bonus ? "Bonus" : (EN ? `Stage ${i + 1}` : `Étape ${i + 1}`)} · ${def.phase} (${def.transition.join(" → ")}) · ${libelleExigence()} · Portfolio of ${nombre(nbClients)} customers${portefeuilleParDefaut() ? " (default value)" : ""} · ${date.toLocaleDateString(LOCALE, { day: "2-digit", month: "long", year: "numeric" })}` : `${resultats.nom ? resultats.nom + " · " : ""}${PROFILS[profil].nom} · ${def.bonus ? "Bonus" : (EN ? `Stage ${i + 1}` : `Étape ${i + 1}`)} · ${def.phase} (${def.transition.join(" → ")}) · ${libelleExigence()} · Portefeuille de ${nombre(nbClients)} clients${portefeuilleParDefaut() ? " (valeur par défaut)" : ""} · ${date.toLocaleDateString(LOCALE, { day: "2-digit", month: "long", year: "numeric" })}`);
  $("bilan-titre").textContent = options.interrompu ? (EN ? "Mission stopped" : "Mission interrompue") : statutTexte;
  $("bilan-etoiles").textContent = etoilesTexte(succes ? etoiles : 0);
  $("bilan-score").textContent = `${score}/100`;
  $("bilan-erreurs").textContent = `${jeu.erreurs}/${MAX_ERREURS}`;
  $("bilan-erreurs").style.color = jeu.erreurs >= MAX_ERREURS ? "#b91c1c" : jeu.erreurs ? "#b45309" : "#15803d";
  $("bilan-duree").textContent = duree;
  $("bilan-texte").textContent = texte + (jeu.aides ? (EN ? ` Aids used: ${jeu.aides} (−${jeu.aides * 3} points).` : ` Aides utilisées : ${jeu.aides} (−${jeu.aides * 3} points).`) : "");

  // Classement de l'étape
  const classes = meilleurParParticipant(entreesDefi(profil, resultats.exigence).filter(h => h.etapeId === def.id));
  const moi = (resultats.nom || "").trim().toLowerCase();
  const rang = classes.findIndex(h => h.nom.trim().toLowerCase() === moi) + 1;
  $("bilan-rang").textContent = !resultats.nom
    ? (EN ? "Enter your name on the home screen to appear in the ranking." : "Renseignez votre nom sur l'écran d'accueil pour apparaître au classement.")
    : (EN ? `Your best result ranks you ${EN ? `#${rang}` : rang === 1 ? "1er" : `${rang}e`} out of ${classes.length} participant${classes.length > 1 ? "s" : ""} for this stage.` : `Votre meilleur résultat vous place ${EN ? `#${rang}` : rang === 1 ? "1er" : `${rang}e`} sur ${classes.length} participant${classes.length > 1 ? "s" : ""} pour cette étape.`);
  $("bilan-classement").innerHTML = classes.length
    ? (EN ? `<table class="tableau-historique"><thead><tr><th>Rank</th><th>Participant</th><th>Score</th><th>Errors</th><th>Time</th></tr></thead><tbody>` : `<table class="tableau-historique"><thead><tr><th>Rang</th><th>Participant</th><th>Score</th><th>Erreurs</th><th>Durée</th></tr></thead><tbody>`) +
      classes.slice(0, 5).map((h, k) => `<tr${h.nom.trim().toLowerCase() === moi ? ' class="ligne-moi"' : ""}><td class="rang">${k + 1}</td><td>${echapper(h.nom)}</td><td class="fort">${h.score}/100</td><td>${h.erreurs}</td><td>${echapper(h.duree || "—")}</td></tr>`).join("") +
      "</tbody></table>"
    : "";
  $("bilan-code").innerHTML = (EN ? `Result code: <strong class="code">${signature}</strong> — give it to the facilitator to compare scores across devices.` : `Code résultat : <strong class="code">${signature}</strong> — à transmettre à l'animateur pour comparer les scores entre plusieurs postes.`);

  $("bilan-tunnel").innerHTML = tunnel ? tunnelHTML(tunnel) : "";
  bilanConversion(def, tunnel, succes);
  $("bilan-tunnel-bloc").classList.toggle("cache", !tunnel);
  const pAvant = posture(jeu.postureDepart), pApres = posture(jeu.posture);
  const ecart = Math.round(jeu.posture - jeu.postureDepart);
  $("bilan-posture").innerHTML =
    (EN ? `<div class="pst-evolution"><span class="pst-carte" data-posture="${pAvant.cle}">${pAvant.nom}<small>stage ${pAvant.icone} · ${Math.round(jeu.postureDepart)}/100</small></span>` : `<div class="pst-evolution"><span class="pst-carte" data-posture="${pAvant.cle}">${pAvant.nom}<small>étape ${pAvant.icone} · ${Math.round(jeu.postureDepart)}/100</small></span>`) +
    `<span class="pst-fleche">${ecart >= 0 ? "→" : "↘"}<small>${ecart >= 0 ? "+" : ""}${ecart}</small></span>` +
    (EN ? `<span class="pst-carte" data-posture="${pApres.cle}">${pApres.nom}<small>stage ${pApres.icone} · ${Math.round(jeu.posture)}/100</small></span></div>` : `<span class="pst-carte" data-posture="${pApres.cle}">${pApres.nom}<small>étape ${pApres.icone} · ${Math.round(jeu.posture)}/100</small></span></div>`) +
    `<p>${echapper(pApres.description)}</p>` +
    (EN ? `<p>Impact on customer lifetime value: projected lifetime of a converted customer <strong>${decimal(dureeViePosture(jeu.postureDepart))} → ${ansTexte(dureeViePosture(jeu.posture))}</strong>, CLV of a typical customer <strong>${euros(clvPosture(jeu.postureDepart))} → ${euros(clvPosture(jeu.posture))}</strong>. Applied to your real portfolio of ${nombre(nbClients)} customers: <strong>${euros(nbClients * clvPosture(jeu.postureDepart))} → ${euros(nbClients * clvPosture(jeu.posture))}</strong>.</p>` : `<p>Impact sur la valeur vie client : durée de vie projetée d'un client converti <strong>${decimal(dureeViePosture(jeu.postureDepart))} → ${ansTexte(dureeViePosture(jeu.posture))}</strong>, CLV d'un client type <strong>${euros(clvPosture(jeu.postureDepart))} → ${euros(clvPosture(jeu.posture))}</strong>. Rapporté à votre portefeuille réel de ${nombre(nbClients)} clients : <strong>${euros(nbClients * clvPosture(jeu.postureDepart))} → ${euros(nbClients * clvPosture(jeu.posture))}</strong>.</p>`) +
    (jeu.reflexesRequin.length
      ? (EN ? `<p><strong>Conversion blockers detected (${jeu.reflexesRequin.length}):</strong></p><ul class="liste">${jeu.reflexesRequin.slice(0, 6).map(t => `<li>${echapper(t)}</li>`).join("")}</ul>` : `<p><strong>Freins à la conversion relevés (${jeu.reflexesRequin.length}) :</strong></p><ul class="liste">${jeu.reflexesRequin.slice(0, 6).map(t => `<li>${echapper(t)}</li>`).join("")}</ul>`)
      : (EN ? `<p><strong>No conversion blocker in this mission</strong>: ${jeu.gestesPartenaire} decisions that moved contacts forward.</p>` : `<p><strong>Aucun frein à la conversion sur cette mission</strong> : ${jeu.gestesPartenaire} décisions qui ont fait avancer vos contacts.</p>`)) +
    (EN ? `<p><strong>Team life:</strong> ${vie.echanges - jeu.echangesDepart} conversation(s) with your colleagues during the mission · internal network ${jeu.reseauDepart} → ${reseauInterne()}/100.</p>` : `<p><strong>Vie d'équipe :</strong> ${vie.echanges - jeu.echangesDepart} échange(s) avec vos collègues pendant la mission · réseau interne ${jeu.reseauDepart} → ${reseauInterne()}/100.</p>`);
  $("bilan-kpis").innerHTML = kpis.length
    ? (EN ? `<table class="kpis"><thead><tr><th>Indicator</th><th>Result</th><th>Benchmark</th></tr></thead><tbody>` : `<table class="kpis"><thead><tr><th>Indicateur</th><th>Résultat</th><th>Repère</th></tr></thead><tbody>`) +
      kpis.map(k => `<tr><td>${echapper(k.nom)}</td><td class="${k.ok === null ? "kpi-neutre" : k.ok ? "kpi-ok" : "kpi-ko"}">${echapper(k.valeur)}</td><td>${echapper(k.cible || "")}</td></tr>`).join("") +
      "</tbody></table>"
    : "";
  $("bilan-competences").innerHTML = competences.length
    ? competences.map(c => `<div class="competence"><div class="competence-ligne"><span>${echapper(c.nom)}</span><span>${c.pct} %</span></div><div class="competence-barre"><span style="width:${c.pct}%;background:${c.pct >= 75 ? "#15803d" : c.pct >= 50 ? "#d97706" : "#b91c1c"}"></span></div></div>`).join("")
    : (EN ? '<p class="vide">Not enough decisions to assess skills.</p>' : '<p class="vide">Pas assez de décisions pour évaluer les compétences.</p>');
  const forces = competences.filter(c => c.pct >= 75).sort((a, b) => b.pct - a.pct).slice(0, 3);
  const axes = competences.filter(c => c.pct < 60).sort((a, b) => a.pct - b.pct).slice(0, 3);
  $("bilan-forces").innerHTML = forces.length ? forces.map(c => (EN ? `<li><strong>${echapper(c.nom)}</strong>: ${c.pct}% correct decisions.</li>` : `<li><strong>${echapper(c.nom)}</strong> : ${c.pct} % de décisions justes.</li>`)).join("") : (EN ? "<li>No skill exceeds 75% correct decisions yet.</li>" : "<li>Aucune compétence ne dépasse encore 75 % de décisions justes.</li>");
  $("bilan-axes").innerHTML = axes.length ? axes.map(c => `<li><strong>${echapper(c.nom)}</strong> (${c.pct} %) — ${echapper(CONSEILS_COMPETENCES[c.cle])}</li>`).join("") : (EN ? "<li>No major area for improvement in this mission.</li>" : "<li>Aucun axe de progrès majeur relevé sur cette mission.</li>");
  $("bilan-retenir-titre").textContent = succes ? (EN ? "Key takeaway" : "À retenir") : (EN ? "To succeed next time" : "Pour réussir la prochaine fois");
  $("bilan-retenir-texte").textContent = succes ? def.aRetenir : def.conseilEchec;
  $("bilan-journal").innerHTML = jeu.journal.map(j => {
    const ico = { ok: ["ico-ok", "✓"], ko: ["ico-ko", "✕"], neutre: ["ico-neutre", "•"], info: ["ico-info", "i"] }[j.type] || ["ico-info", "i"];
    return `<li><span class="ico ${ico[0]}">${ico[1]}</span><span>${echapper(j.texte)}</span><span class="temps">${echapper(j.t)}</span></li>`;
  }).join("");

  const zone = $("bilan-boutons");
  zone.innerHTML = "";
  const bouton = (label, classe, action) => {
    const b = document.createElement("button");
    b.className = classe;
    b.textContent = label;
    b.addEventListener("click", () => { son("clic"); action(); });
    zone.appendChild(b);
  };
  const nouveauxBadges = verifierBadges();
  $("bilan-badges").classList.toggle("cache", !nouveauxBadges.length);
  $("bilan-badges").innerHTML = nouveauxBadges.length ? `<strong>${T("Nouveaux badges :", "New badges:")}</strong> ${nouveauxBadges.map(d => `<span class="badge-puce">★ ${d.nom}</span>`).join("")}` : "";
  nouveauxBadges.forEach((d, k) => setTimeout(() => message(`${T("Badge débloqué : ", "Badge unlocked: ")}${d.nom}`, "badge", 3600), 600 + k * 700));
  bouton((EN ? "Print the report" : "Imprimer le bilan"), "btn-secondaire", () => window.print());
  bouton((EN ? "Change stage" : "Changer d'étape"), "btn-secondaire", afficherAccueil);
  bouton(succes ? (EN ? "Replay the mission" : "Rejouer la mission") : (EN ? "Restart the mission" : "Recommencer la mission"), "btn-principal", () => lancerNiveau(i));
  $("ecran-bilan").querySelector(".carte-ecran").scrollTop = 0;
  afficherEcran("ecran-bilan");
}

function mettreEnPause() {
  if (jeu.mode !== "jeu") return;
  if (jeu.focusPanneau) quitterPanneau();
  jeu.mode = "pause";
  touches.clear();
  $("pause-resume").textContent = `${jeu.def.phase} · ${formatHeure(jeu.minutes)} · ${T("erreurs", "errors")} ${jeu.erreurs}/${MAX_ERREURS} · ${T("tunnel", "funnel")} ${posture().nom}`;
  statistiquesPause();
  afficherEcran("ecran-pause");
}
function reprendre() {
  if (jeu.mode !== "pause") return;
  afficherEcran(null);
  jeu.mode = "jeu";
}
function basculerAcceleration() {
  if (!["jeu", "dialogue", "fenetre"].includes(jeu.mode)) return;
  jeu.acceleration = jeu.acceleration === 1 ? 3 : 1;
  $("btn-accelerer").classList.toggle("actif", jeu.acceleration > 1);
  message(jeu.acceleration > 1 ? (EN ? "Time accelerated (×3)" : "Temps accéléré (×3)") : (EN ? "Normal time" : "Temps normal"), "info", 1400);
}
function basculerSon() {
  resultats.son = !resultats.son;
  sauverResultats();
  majReglages();
  message(resultats.son ? (EN ? "Sound effects on" : "Effets sonores activés") : (EN ? "Sound effects off" : "Effets sonores coupés"), "info", 1400);
}

function exporterCSV() {
  const entete = ["Date", "Participant", (EN ? "Customers in portfolio" : "Clients en portefeuille"), (EN ? "Portfolio value" : "Valeur du portefeuille"), (EN ? "Profile" : "Profil"), (EN ? "Stage" : "Étape"), (EN ? "Difficulty" : "Exigence"), (EN ? "Status" : "Statut"), (EN ? "Level" : "Niveau"), "Score", (EN ? "Errors" : "Erreurs"), (EN ? "Aids" : "Aides"), (EN ? "Time" : "Durée"), (EN ? "Result code" : "Code résultat"), (EN ? "Conversion rate" : "Taux de conversion"), (EN ? "Funnel stage reached" : "Étape atteinte dans le tunnel"), (EN ? "Conversion blockers" : "Freins à la conversion"), (EN ? "Indicators" : "Indicateurs"), (EN ? "Skills" : "Compétences")];
  const lignes = resultats.historique.map(h => [h.date, h.nom, h.portefeuille || "", h.portefeuille ? (h.portefeuilleDefaut ? (EN ? "default" : "par défaut") : (EN ? "real" : "réelle")) : "", h.profil, h.etape, h.exigence, h.statutTexte, h.etoiles, h.score, h.erreurs, h.aides || 0, h.duree, h.signature || "", h.conversion ?? "", h.posture || "", h.reflexesRequin ?? "", h.kpis, h.competences]);
  const csv = [entete, ...lignes].map(l => l.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(";")).join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const lien = document.createElement("a");
  lien.href = URL.createObjectURL(blob);
  lien.download = `funnelia-${EN ? "results" : "resultats"}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(lien);
  lien.click();
  lien.remove();
  setTimeout(() => URL.revokeObjectURL(lien.href), 1000);
}

/* ---------- Événements de l'interface ---------- */
$("nom-participant").addEventListener("input", e => { resultats.nom = e.target.value.trim(); sauverResultats(); afficherClassement(); });
$("portefeuille").addEventListener("input", e => {
  const chiffres = e.target.value.replace(/\D/g, "").replace(/^0+/, "").slice(0, 4);
  if (e.target.value !== chiffres) e.target.value = chiffres;
  resultats.portefeuille = chiffres ? Number(chiffres) : null;
  sauverResultats();
  majReglages();
});
document.querySelectorAll("[data-profil]").forEach(b => b.addEventListener("click", () => {
  resultats.profil = b.dataset.profil;
  sauverResultats();
  son("clic");
  majReglages();
  const focus = document.activeElement;
  afficherAccueil();
  setTimeout(() => focaliser(document.querySelector(`[data-profil="${b.dataset.profil}"]`) || focus), 60);
}));
document.querySelectorAll("[data-exigence]").forEach(b => b.addEventListener("click", () => {
  resultats.exigence = b.dataset.exigence;
  sauverResultats();
  majReglages();
  afficherClassement();
  son("clic");
}));
$("case-son").addEventListener("change", e => { resultats.son = e.target.checked; sauverResultats(); majReglages(); son("clic"); });
$("btn-son").addEventListener("click", basculerSon);
$("btn-pause-equipe").addEventListener("click", () => ouvrirOrganigramme());
$("btn-pause-kpi").addEventListener("click", () => ouvrirTableauDeBord());
$("btn-kpi-accueil").addEventListener("click", () => ouvrirTableauDeBord());
$("btn-guide-accueil").addEventListener("click", ouvrirGuide);
$("btn-briefing-guide").addEventListener("click", ouvrirGuide);
// Briefing : « Détails » déplie objectif, tunnel, profil et critères (souris ou clavier ← →)
function majBoutonDetails() {
  const ouvert = $("briefing-details").open;
  $("btn-briefing-details").textContent = ouvert ? T("Masquer les détails", "Hide details") : T("Détails", "Details");
  $("btn-briefing-details").setAttribute("aria-expanded", String(ouvert));
}
$("briefing-details").addEventListener("toggle", majBoutonDetails);
$("btn-briefing-details").addEventListener("click", () => { son("clic"); $("briefing-details").open = !$("briefing-details").open; });
$("btn-pause-guide").addEventListener("click", ouvrirGuide);
$("btn-accelerer").addEventListener("click", basculerAcceleration);
$("btn-demarrer").addEventListener("click", commencerNiveau);
$("btn-briefing-retour").addEventListener("click", afficherAccueil);
$("btn-pause").addEventListener("click", mettreEnPause);
$("btn-reprendre").addEventListener("click", reprendre);
$("btn-recommencer").addEventListener("click", () => lancerNiveau(jeu.niveauIndex));
$("btn-pause-accueil").addEventListener("click", afficherAccueil);
$("btn-exporter").addEventListener("click", () => {
  if (!resultats.historique.length) { alert((EN ? "No results to export yet." : "Aucun résultat à exporter pour le moment.")); return; }
  exporterCSV();
});
$("btn-reinitialiser").addEventListener("click", () => {
  if (!confirm((EN ? "Clear the history, ranking and results saved on this device?" : "Effacer l'historique, le classement et les résultats enregistrés sur ce poste ?"))) return;
  const vide = () => Array(NB_ETAPES).fill(0);
  Object.assign(resultats, {
    meilleurs: { terrain: vide(), sedentaire: vide() },
    etoiles: { terrain: vide(), sedentaire: vide() },
    tentatives: { terrain: vide(), sedentaire: vide() },
    posture: { terrain: POSTURE_DEPART, sedentaire: POSTURE_DEPART },
    trajectoire: { terrain: [], sedentaire: [] },
    tunnels: { terrain: Array(NB_ETAPES).fill(null), sedentaire: Array(NB_ETAPES).fill(null) },
    historique: []
  });
  sauverResultats();
  afficherAccueil();
});

/* =====================================================================
   F4. COMMANDES : 100 % CLAVIER
   ---------------------------------------------------------------------
   Déplacement      Z Q S D ou flèches
   Agir / parler    E, Espace ou Entrée
   CRM              Tab pour y entrer et en sortir, flèches, Entrée
   Entretien        ↑ ↓ choisir, Entrée valider, ou touches 1 à 9
   Écrans/fenêtres  flèches, Entrée ou Espace, Échap pour fermer
   Raccourcis       G guide · F accélérer · M son · Échap pause
   ===================================================================== */
const DEPLACEMENTS = {
  arrowup: "haut", z: "haut", w: "haut",
  arrowdown: "bas", s: "bas",
  q: "gauche", a: "gauche", d: "droite",
  arrowleft: "gauche", arrowright: "droite"
};
const FLECHES = { arrowup: "haut", arrowdown: "bas", arrowleft: "gauche", arrowright: "droite" };
const VALIDER = [" ", "enter"];

function agir() {
  if (jeu.mode !== "jeu") return;
  const i = interactifProche();
  if (i) { son("clic"); i.action(); }
}

function clavierEntretien(e, cle) {
  if (frappe.minuterie && (VALIDER.includes(cle) || cle === "e")) { e.preventDefault(); terminerFrappe(); return; }
  const n = jeu.boutons.length;
  const dir = DEPLACEMENTS[cle];
  e.preventDefault();
  if ((dir === "haut" || dir === "bas") && n > 1) {
    if (dir === "bas") jeu.selection = (jeu.selection + 1) % n;
    else jeu.selection = jeu.selection <= 0 ? n - 1 : jeu.selection - 1;
    son("clic");
    majSelection();
    return;
  }
  if (e.repeat) return;
  if (/^[1-9]$/.test(cle) && n > 1) {
    const k = Number(cle) - 1;
    if (k < n) { jeu.selection = k; majSelection(); son("clic"); jeu.boutons[k].action(); }
    return;
  }
  if (VALIDER.includes(cle) || cle === "e") {
    if (n === 1) { son("clic"); jeu.boutons[0].action(); }
    else if (jeu.selection >= 0 && jeu.selection < n) { son("clic"); jeu.boutons[jeu.selection].action(); }
    else message((EN ? `Choose an answer with ↑ ↓, then Enter (or press 1 to ${n}).` : `Choisissez une réponse avec ↑ ↓, puis Entrée (ou tapez 1 à ${n}).`), "info", 2000);
    return;
  }
  if (cle === "g") ouvrirGuide();
  else if (cle === "f") basculerAcceleration();
  else if (cle === "m") basculerSon();
}

function clavierFenetre(e, cle) {
  if (cle === "escape") { e.preventDefault(); if (jeu.fenetreFermable) fermerFenetre(); return; }
  const dir = FLECHES[cle];
  if (jeu.fenetreNav === "document") {
    e.preventDefault();
    if (dir === "haut" || dir === "bas") defiler($("fenetre-corps"), dir === "bas" ? 120 : -120);
    else if ((dir === "gauche" || dir === "droite") && jeu.changerOnglet) jeu.changerOnglet(dir === "droite" ? 1 : -1);
    else if (VALIDER.includes(cle) && !e.repeat) fermerFenetre();
    return;
  }
  if (dir) {
    e.preventDefault();
    if (!deplacerFocus($("fenetre-boite"), dir) && (dir === "haut" || dir === "bas")) defiler($("fenetre-corps"), dir === "bas" ? 100 : -100);
    return;
  }
  if (cle === "tab") { e.preventDefault(); focusSuivant($("fenetre-boite"), e.shiftKey ? -1 : 1); return; }
  if (VALIDER.includes(cle)) { e.preventDefault(); if (!e.repeat) activerFocus(); }
}

function clavierDocument(e, cle, ecran, barre) {
  const dir = FLECHES[cle];
  const carte = ecran.querySelector(".carte-ecran");
  if (dir === "haut" || dir === "bas") { e.preventDefault(); defiler(carte, dir === "bas" ? 140 : -140); return true; }
  if (dir) { e.preventDefault(); if (!barre.contains(document.activeElement)) focusInitial(barre, ".btn-principal"); else deplacerFocus(barre, dir); return true; }
  if (cle === "tab") { e.preventDefault(); focusSuivant(barre, e.shiftKey ? -1 : 1); return true; }
  if (VALIDER.includes(cle)) {
    e.preventDefault();
    if (e.repeat) return true;
    if (!barre.contains(document.activeElement)) { const p = barre.querySelector(".btn-principal"); if (p) p.click(); }
    else activerFocus();
    return true;
  }
  return false;
}

function clavierGrille(e, cle, racine) {
  const dir = FLECHES[cle];
  if (dir) {
    e.preventDefault();
    if (!deplacerFocus(racine, dir) && (dir === "haut" || dir === "bas")) defiler(racine.querySelector(".carte-ecran") || racine, dir === "bas" ? 120 : -120);
    return true;
  }
  if (cle === "tab") { e.preventDefault(); focusSuivant(racine, e.shiftKey ? -1 : 1); return true; }
  if (VALIDER.includes(cle)) { e.preventDefault(); if (!e.repeat) activerFocus(); return true; }
  return false;
}

document.addEventListener("keydown", e => {
  document.body.classList.add("clavier");
  const cle = e.key.toLowerCase();
  const actif = document.activeElement;

  // Saisie de texte (nom du participant, portefeuille)
  if (actif && actif.tagName === "INPUT" && actif.type === "text") {
    if (["arrowup", "arrowdown", "tab", "enter", "escape"].includes(cle)) {
      e.preventDefault();
      const racine = actif.closest(".ecran") || document.body;
      if (cle === "tab") focusSuivant(racine, e.shiftKey ? -1 : 1);
      else if (cle === "arrowup") deplacerFocus(racine, "haut");
      else deplacerFocus(racine, "bas");
    }
    return;
  }

  switch (jeu.mode) {
    case "fenetre": clavierFenetre(e, cle); return;
    case "dialogue": clavierEntretien(e, cle); return;
    case "menu":
      if (cle === "g" && !e.repeat && !demarrageVisible()) { ouvrirGuide(); return; }
      if (cle === "h" && !e.repeat && !demarrageVisible()) { ouvrirAide(); return; }
      if (cle === "k" && !e.repeat && !demarrageVisible()) { ouvrirTableauDeBord(); return; }
      clavierGrille(e, cle, demarrageVisible() ? $("ecran-demarrage") : $("ecran-accueil"));
      return;
    case "pause":
      if (cle === "escape") { e.preventDefault(); reprendre(); return; }
      if (cle === "g" && !e.repeat) { ouvrirGuide(); return; }
      if (cle === "h" && !e.repeat) { ouvrirAide(); return; }
      if (cle === "p" && !e.repeat) { ouvrirPlan(); return; }
      if (cle === "k" && !e.repeat) { ouvrirTableauDeBord(); return; }
      clavierGrille(e, cle, $("ecran-pause"));
      return;
    case "briefing":
      if (cle === "escape") { e.preventDefault(); afficherAccueil(); return; }
      if (cle === "g" && !e.repeat) { ouvrirGuide(); return; }
      clavierDocument(e, cle, $("ecran-briefing"), $("ecran-briefing").querySelector(".boutons-ligne"));
      return;
    case "bilan":
      clavierDocument(e, cle, $("ecran-bilan"), $("bilan-boutons"));
      return;
    case "ascenseur": clavierAscenseur(e, cle); return;
    case "jeu": break;
    default: return;
  }

  // Mission en cours
  if (cle === "escape") { e.preventDefault(); if (jeu.focusPanneau) quitterPanneau(); else mettreEnPause(); return; }
  if (cle === "tab") { e.preventDefault(); if (!e.repeat) { if (jeu.focusPanneau) quitterPanneau(); else entrerPanneau(); } return; }
  if (cle === "g" && !e.repeat) { ouvrirGuide(); return; }
  if (cle === "o" && !e.repeat) { ouvrirOrganigramme(); return; }
  if (cle === "p" && !e.repeat) { ouvrirPlan(); return; }
  if (cle === "k" && !e.repeat) { ouvrirTableauDeBord(); return; }
  if (cle === "h" && !e.repeat) { ouvrirAide(); return; }
  if (cle === "f" && !e.repeat) { basculerAcceleration(); return; }
  if (cle === "m" && !e.repeat) { basculerSon(); return; }
  const dir = DEPLACEMENTS[cle];
  if (jeu.focusPanneau) {
    if (dir) { e.preventDefault(); deplacerFocus($("pm-contenu"), dir); return; }
    if (VALIDER.includes(cle) || cle === "e") { e.preventDefault(); if (!e.repeat) activerFocus(); }
    return;
  }
  if (dir) {
    e.preventDefault();
    touches.add(directionFleche(cle, dir, e.shiftKey));
    if (!e.shiftKey && FLECHES_TOURNANTES[cle]) touches.add(FLECHES_TOURNANTES[cle][2]);
    return;
  }
  if (cle === "shift") basculerFlechesTournantes(true);
  if (VALIDER.includes(cle) || cle === "e") { e.preventDefault(); if (!e.repeat) agir(); }
});
document.addEventListener("keyup", e => {
  const cle = e.key.toLowerCase();
  const dir = DEPLACEMENTS[cle];
  if (dir) touches.delete(dir);
  if (cle === "arrowleft") { touches.delete("tourneG"); touches.delete("orienteG"); }
  if (cle === "arrowright") { touches.delete("tourneD"); touches.delete("orienteD"); }
  if (cle === "shift") basculerFlechesTournantes(false);
});
// ← → : pas de côté, la vue s'oriente progressivement dans la direction du déplacement ; Maj + ← → : tourner la vue sur place
const FLECHES_TOURNANTES = { arrowleft: ["gauche", "tourneG", "orienteG"], arrowright: ["droite", "tourneD", "orienteD"] };
function directionFleche(cle, dir, maj) {
  return maj && FLECHES_TOURNANTES[cle] ? FLECHES_TOURNANTES[cle][1] : dir;
}
// Maj pressée ou relâchée pendant qu'une flèche est maintenue : on passe du pas de côté à la rotation (et inversement)
const flechesTenues = new Set();
document.addEventListener("keydown", e => { if (FLECHES_TOURNANTES[e.key.toLowerCase()]) flechesTenues.add(e.key.toLowerCase()); });
document.addEventListener("keyup", e => flechesTenues.delete(e.key.toLowerCase()));
window.addEventListener("blur", () => flechesTenues.clear());
function basculerFlechesTournantes(maj) {
  flechesTenues.forEach(cle => {
    const [pas, tour, oriente] = FLECHES_TOURNANTES[cle];
    if (maj) { touches.delete(pas); touches.delete(oriente); touches.add(tour); }
    else { touches.delete(tour); touches.add(pas); touches.add(oriente); }
  });
}
document.addEventListener("mousedown", () => document.body.classList.remove("clavier"));
window.addEventListener("blur", () => touches.clear());
document.addEventListener("keydown", e => {
  if (jeu.mode !== "jeu" || jeu.focusPanneau) return;
  const r = reglages();
  if (e.key === "+" || e.key === "=") { r.fov = clamp((r.fov || 70) - 5, 55, 90); sauverResultats(); }
  if (e.key === "-") { r.fov = clamp((r.fov || 70) + 5, 55, 90); sauverResultats(); }
});

document.querySelectorAll(".fleche").forEach(btn => {
  const dir = btn.dataset.dir;
  const oriente = { gauche: "orienteG", droite: "orienteD" }[dir];
  btn.addEventListener("pointerdown", e => { e.preventDefault(); if (jeu.mode === "jeu") { touches.add(dir); if (oriente) touches.add(oriente); } });
  ["pointerup", "pointerleave", "pointercancel"].forEach(ev => btn.addEventListener(ev, () => { touches.delete(dir); if (oriente) touches.delete(oriente); }));
});
$("btn-action").addEventListener("click", () => {
  if (jeu.mode === "dialogue" && jeu.boutons.length === 1) jeu.boutons[0].action();
  else agir();
});

/* =====================================================================
   F5. BOUCLE PRINCIPALE
   ===================================================================== */
function deplacerJoueur(dt) {
  const tour = (touches.has("tourneD") ? 1 : 0) - (touches.has("tourneG") ? 1 : 0);
  if (tour) jeu.lacet -= tour * 2.1 * dt;
  // Flèches ← → : la vue pivote vers la direction du pas de côté
  const oriente = (touches.has("orienteD") ? 1 : 0) - (touches.has("orienteG") ? 1 : 0);
  if (oriente) jeu.lacet -= oriente * 1.5 * dt;
  const avance = (touches.has("haut") ? 1 : 0) - (touches.has("bas") ? 1 : 0);
  const cote = (touches.has("droite") ? 1 : 0) - (touches.has("gauche") ? 1 : 0);
  if (!avance && !cote) { joueur.bouge = false; return; }
  // Repère de la vue : devant (fx, fz), droite (-fz, fx)
  const fx = Math.sin(jeu.lacet), fz = Math.cos(jeu.lacet);
  let dx = fx * avance - fz * cote, dz = fz * avance + fx * cote;
  const l = Math.hypot(dx, dz);
  dx /= l;
  dz /= l;
  const pas = joueur.vitesse * (avance < 0 ? 0.7 : 1) * dt;
  const essai = (x, z) => {
    if (!libre(x, z, joueur.rayon, joueur.etage)) return false;
    return !(joueur.etage === 1 ? pnjs : []).concat(employes, figurants).some(p => {
      if (!p.mesh.visible || (p.etage !== undefined && p.etage !== joueur.etage)) return false;
      const avant = Math.hypot(p.mesh.position.x - joueur.x, p.mesh.position.z - joueur.z);
      const apres = Math.hypot(p.mesh.position.x - x, p.mesh.position.z - z);
      return apres < 0.6 && apres < avant;
    });
  };
  if (essai(joueur.x + dx * pas, joueur.z)) joueur.x += dx * pas;
  if (essai(joueur.x, joueur.z + dz * pas)) joueur.z += dz * pas;
  joueur.mesh.position.set(joueur.x, 0, joueur.z);
  joueur.bouge = true;
}

const cibleCamera = new THREE.Vector3();
const positionCamera = new THREE.Vector3();
const HAUTEUR_YEUX = 1.62;
function majCamera(dt) {
  const fov = reglages().fov || 70;
  if (camera.fov !== fov) { camera.fov = fov; camera.updateProjectionMatrix(); }
  if (jeu.mode === "menu") {
    // Visite lente de l'étage depuis l'allée centrale
    if (joueur.etage !== 1) changerEtage(1);
    const t = jeu.temps;
    const lacet = Math.PI + Math.sin(t * 0.07) * 1.15;
    camera.position.set(Math.sin(t * 0.05) * 0.5, 1.7, 10.6);
    regard.set(camera.position.x + Math.sin(lacet), 1.6, camera.position.z + Math.cos(lacet));
    camera.lookAt(regard);
    return;
  }
  if (jeu.focus) {
    // Pendant un entretien, le regard se tourne vers l'interlocuteur
    const f = jeu.focus.position;
    const d = Math.max(0.6, Math.hypot(f.x - joueur.x, f.z - joueur.z));
    const cible = Math.atan2(f.x - joueur.x, f.z - joueur.z);
    const k = 1 - Math.exp(-dt * 5);
    jeu.lacet += Math.atan2(Math.sin(cible - jeu.lacet), Math.cos(cible - jeu.lacet)) * k;
    jeu.tangage += (Math.atan2(1.5 - HAUTEUR_YEUX, d) - jeu.tangage) * k;
  }
  const balancement = joueur.bouge && reglages().balancement !== false ? Math.sin(joueur.t * 9) * 0.022 : 0;
  const base = etageY() + immeuble.secousse;
  camera.position.set(joueur.x, base + HAUTEUR_YEUX + balancement, joueur.z);
  const c = Math.cos(jeu.tangage);
  regard.set(joueur.x + Math.sin(jeu.lacet) * c, base + HAUTEUR_YEUX + balancement + Math.sin(jeu.tangage), joueur.z + Math.cos(jeu.lacet) * c);
  camera.lookAt(regard);
  joueur.mesh.rotation.y = jeu.lacet;
}

/* Regard à la souris (verrouillage du pointeur), au doigt sur écran tactile */
jeu.lacet = Math.PI;
jeu.tangage = 0;
const vueGlissee = { actif: false, x: 0, y: 0 };
const sensibiliteSouris = () => 0.0022 * (reglages().sensibilite || 1);
const vueVerrouillee = () => document.pointerLockElement === renderer.domElement;
function regarder(dx, dy) {
  jeu.lacet -= dx * sensibiliteSouris();
  jeu.tangage = clamp(jeu.tangage - dy * sensibiliteSouris() * (reglages().inverser ? -1 : 1), -1.15, 1.15);
}
function libererSouris() {
  if (vueVerrouillee() && document.exitPointerLock) document.exitPointerLock();
}
renderer.domElement.addEventListener("click", () => {
  if (jeu.mode === "jeu" && !jeu.focusPanneau && !vueVerrouillee() && renderer.domElement.requestPointerLock) renderer.domElement.requestPointerLock();
});
document.addEventListener("mousemove", e => {
  if (jeu.mode === "jeu" && vueVerrouillee()) regarder(e.movementX, e.movementY);
});
renderer.domElement.addEventListener("pointerdown", e => {
  if (e.pointerType === "mouse") return;
  vueGlissee.actif = true;
  vueGlissee.x = e.clientX;
  vueGlissee.y = e.clientY;
});
window.addEventListener("pointermove", e => {
  if (!vueGlissee.actif || jeu.mode !== "jeu") return;
  regarder((e.clientX - vueGlissee.x) * 1.8, (e.clientY - vueGlissee.y) * 1.8);
  vueGlissee.x = e.clientX;
  vueGlissee.y = e.clientY;
});
window.addEventListener("pointerup", () => { vueGlissee.actif = false; });

let cacheIndice = "";
function indice(html) {
  const el = $("indice");
  if (!html) { el.classList.add("cache"); cacheIndice = ""; return; }
  if (html !== cacheIndice) { el.innerHTML = html; cacheIndice = html; }
  el.classList.remove("cache");
}
function majInterface() {
  const horlogeEl = $("hud-horloge");
  if (jeu.mode !== "menu" && jeu.def) {
    const restant = jeu.finMinutes - jeu.minutes;
    const texteHorloge = `${formatHeure(jeu.minutes)} · ${jeu.affichage === "semaine" ? formatFin(jeu.finMinutes) : (EN ? `ends ${formatFin(jeu.finMinutes)}` : `fin ${formatFin(jeu.finMinutes)}`)}`;
    if (horlogeEl.textContent !== texteHorloge) horlogeEl.textContent = texteHorloge;
    horlogeEl.classList.toggle("urgent", restant < (jeu.finMinutes - jeu.debutMinutes) * 0.1);
  }
  const viseur = $("viseur");
  viseur.classList.toggle("cache", !(jeu.mode === "jeu" && jeu.def && !jeu.focusPanneau));
  if (jeu.mode !== "jeu" || !jeu.def) { indice(null); majInvite(null); return; }
  if (jeu.focusPanneau) { majInvite(null); indice((EN ? "<kbd>↑</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd> navigate the CRM · <kbd>Enter</kbd> confirm · <kbd>Tab</kbd> back to moving" : "<kbd>↑</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd> naviguer dans le CRM · <kbd>Entrée</kbd> valider · <kbd>Tab</kbd> revenir au déplacement")); return; }
  const proche = interactifProche();
  viseur.classList.toggle("actif", !!proche);
  majInvite(proche);
  if (proche) { indice(null); return; }
  if (!vueVerrouillee() && window.matchMedia && window.matchMedia("(pointer: fine)").matches) {
    indice(T("<kbd>Clic</kbd> regarder à la souris · <kbd>Z Q S D</kbd> / <kbd>W A S D</kbd> se déplacer · <kbd>Tab</kbd> CRM", "<kbd>Click</kbd> look with the mouse · <kbd>W A S D</kbd> / <kbd>Z Q S D</kbd> move · <kbd>Tab</kbd> CRM"));
    return;
  }
  if (!estTerrain() && jeu.def.id !== "notoriete" && !auPoste()) { indice((EN ? "Your workstation is in the sales open space (blue beacon)." : "Votre poste de travail est dans l'open space commercial (balise bleue).")); return; }
  const crm = !$("panneau-mission").classList.contains("cache") && elementsNav($("pm-contenu")).length;
  indice(crm ? (EN ? "<kbd>Tab</kbd> drive the CRM with the keyboard · <kbd>G</kbd> guide · <kbd>Esc</kbd> pause" : "<kbd>Tab</kbd> piloter le CRM au clavier · <kbd>G</kbd> guide · <kbd>Échap</kbd> pause") : null);
}

const horloge = new THREE.Clock();
let compteurPanneau = 0;
function boucle() {
  requestAnimationFrame(boucle);
  const dt = Math.min(0.05, horloge.getDelta());
  jeu.temps += dt;
  debugDebutImage();
  if (bancTest.actif) { executerBanc(); debugFinImage(); return; }
  majFrustumCamera();

  if (jeu.mode === "jeu" && jeu.def) {
    jeu.dureeReelle += dt;
    if (!jeu.focusPanneau) deplacerJoueur(dt); else joueur.bouge = false;
    const dmin = dt * jeu.rythme * jeu.acceleration;
    jeu.minutes += dmin;
    jeu.def.maj(jeu.n, dt, dmin);
    if (jeu.mode === "jeu" && jeu.minutes >= jeu.finMinutes) {
      jeu.minutes = jeu.finMinutes;
      jeu.def.finTemps(jeu.n);
    }
    if (jeu.mode === "jeu") limiteAtteinte();
    verifierImprevus();
  } else {
    joueur.bouge = false;
    if (["dialogue", "fenetre"].includes(jeu.mode)) jeu.dureeReelle += dt;
  }

  if (jeu.def && jeu.n && ["jeu", "dialogue", "fenetre", "pause", "briefing"].includes(jeu.mode) && jeu.def.hud) {
    jeu.def.hud(jeu.n);
    hudTunnel(jeu.def.tunnel ? jeu.def.tunnel(jeu.n) : null);
    surveillerTunnel();
  }
  compteurPanneau += dt;
  if (compteurPanneau > 0.25) { compteurPanneau = 0; majPanneau(); }

  majPnjs(dt, jeu.mode === "jeu");
  majVie(dt);
  majFigurants(dt);
  majAscenseur(dt);
  majPortesAscenseurs(dt);
  majPortiques(dt);
  majPassants(dt);
  majLieu(dt);
  majDestination();
  animerVisagesCollaborateurs(dt);
  animerVisagesFigurants(dt);
  majEntreprise(dt);
  pnjs.forEach(p => { if (p.mesh.visible) animerVivant(p.mesh, dt, { parle: jeu.focus === p.mesh && jeu.mode === "dialogue" }); });
  majPersonnagesGltf(dt);
  majDidacticiel();
  joueur.t += dt;
  animerMarche(joueur.mesh, joueur.t, joueur.bouge);
  joueur.mesh.visible = false;
  if (jeu.mode !== "jeu" || jeu.focusPanneau) libererSouris();
  animesDecor.forEach(f => f(jeu.temps));
  majApparitions(dt);
  majBalises();
  majCamera(dt);
  majInterface();
  majEtiquettes();
  majEtiquettesVie();
  majEtiquettesFigurants();
  majMinimap(dt);
  rendre();
  majInterfaceJeu(dt);
  debugFinImage();
}

/* Poste de travail : balise pour les profils sédentaires */
function ajouterBalisePoste() {
  ajouterInteractif({
    x: POINT_POSTE.x, z: POINT_POSTE.z, rayon: 1.6, label: (EN ? "you're at your desk: press Tab to drive the CRM" : "vous êtes à votre poste : touche Tab pour piloter le CRM"), carte: true,
    action: () => entrerPanneau(),
    baliseVisible: () => !auPoste()
  });
}
const demarrerOrigine = NIVEAUX.map(d => d.demarrer);
NIVEAUX.forEach((d, i) => {
  if (d.id === "notoriete") return;
  d.demarrer = function (n, p) {
    demarrerOrigine[i].call(d, n, p);
    if (!estTerrain() || d.id === "interet") ajouterBalisePoste();
  };
});

/* =====================================================================
   PARTIE G — INTERFACE FOR DISTRIBUTION
   Démarrage et langue, paramètres, aide, notifications, mission
   recommandée, badges, certificat et didacticiel.
   ===================================================================== */
const T = (fr, en) => (EN ? en : fr);

/* ---------- G1. Langue ---------- */
function choisirLangue(langue) {
  if (langue !== LANGUE && jeu.def && jeu.mode !== "bilan" && !confirm(T("Changer de langue recharge le jeu et interrompt la mission en cours. Continuer ?", "Changing language reloads the game and ends the current mission. Continue?"))) { majBoutonsLangue(); return; }
  try { localStorage.setItem(CLE_LANGUE, langue); } catch (e) { /* stockage indisponible */ }
  if (langue !== LANGUE) {
    try { sessionStorage.setItem(CLES_STOCKAGE.demarre, "1"); } catch (e) { /* ignoré */ }
    location.reload();
  } else majBoutonsLangue();
}
function majBoutonsLangue() {
  document.querySelectorAll("[data-langue]").forEach(b => {
    const actif = b.dataset.langue === LANGUE;
    b.classList.toggle("actif", actif);
    b.setAttribute("aria-checked", actif ? "true" : "false");
  });
}
function afficherDemarrage() {
  jeu.mode = "menu";
  ["hud", "manette", "indice", "minimap", "rappel-touches"].forEach(id => $(id).classList.add("cache"));
  majBoutonsLangue();
  afficherEcran("ecran-demarrage");
}
const demarrageVisible = () => !$("ecran-demarrage").classList.contains("cache");

/* ---------- G2. Paramètres d'affichage et de confort ---------- */
function reglages() {
  if (!resultats.reglages) resultats.reglages = { texte: "normal", animations: true };
  const r = resultats.reglages;
  if (!r.fov) r.fov = 70;
  if (!r.sensibilite) r.sensibilite = 1;
  if (r.boussole === undefined) r.boussole = true;
  if (r.balancement === undefined) r.balancement = true;
  if (r.qualiteAuto === undefined) r.qualiteAuto = true;
  return resultats.reglages;
}
function appliquerReglages() {
  const r = reglages();
  document.body.classList.toggle("texte-grand", r.texte === "grand");
  document.body.classList.toggle("sans-animation", !r.animations);
}
function ouvrirReglages() {
  if (!["menu", "pause", "jeu"].includes(jeu.mode)) return;
  const r = reglages();
  const segment = (nom, valeur, options) => `<div class="segment-config">${options.map(([v, l]) =>
    `<label class="${String(valeur) === String(v) ? "coche" : ""}"><input type="radio" name="${nom}" value="${v}"${String(valeur) === String(v) ? " checked" : ""}> ${l}</label>`).join("")}</div>`;
  const corps = `
    <div class="reglages-grille">
      <div class="config-champ"><span class="config-label">${T("Langue du jeu", "Game language")}</span>${segment("langue", LANGUE, [["fr", "Français"], ["en", "English"]])}
        <p class="info-texte">${T("Changer de langue recharge le jeu ; vos résultats sont conservés.", "Changing language reloads the game; your results are kept.")}</p></div>
      <div class="config-champ"><span class="config-label">${T("Qualité graphique", "Graphics quality")}</span>${segment("graphismes", qualiteActive(), [["faible", T("Faible", "Low")], ["moyen", T("Moyen", "Medium")], ["eleve", T("Élevé", "High")], ["ultra", "Ultra"]])}
        <p class="info-texte">${T("Moyen convient à la plupart des ordinateurs. Élevé affine la résolution et les ombres ; Ultra ajoute l'occlusion ambiante (plus exigeant).", "Medium suits most computers. High sharpens resolution and shadows; Ultra adds ambient occlusion (more demanding).")}</p></div>
      <div class="config-champ"><span class="config-label">${T("Allègement automatique", "Automatic lightening")}</span>${segment("qualiteAuto", r.qualiteAuto ? "oui" : "non", [["oui", T("Activé", "On")], ["non", T("Désactivé", "Off")]])}
        <p class="info-texte" id="etat-allegement">${T("Si l'image ralentit, le jeu baisse la résolution, puis le halo, puis les ombres.", "If the picture slows down, the game lowers the resolution, then the bloom, then the shadows.")} ${T("État actuel", "Current state")} : <strong>${ALLEGEMENTS[rendu.allegement || 0]}</strong>.</p>
        ${rendu.allegement ? `<button type="button" id="btn-retablir-rendu" class="btn-secondaire btn-petit">${T("Rétablir l'image complète", "Restore the full picture")}</button>` : ""}</div>
      <div class="config-champ"><span class="config-label">${T("Affichage en jeu", "In-game display")}</span>${segment("boussole", r.boussole ? "oui" : "non", [["oui", T("Boussole visible", "Compass on")], ["non", T("Boussole masquée", "Compass off")]])}${segment("fps", r.fps ? "oui" : "non", [["non", T("FPS masqués", "FPS hidden")], ["oui", T("Afficher les FPS", "Show FPS")]])}</div>
      <div class="config-champ"><span class="config-label">${T("Vue", "View")}</span>${segment("balancement", r.balancement ? "oui" : "non", [["oui", T("Balancement de la marche", "Head bob on")], ["non", T("Vue stable", "Head bob off")]])}${segment("inverser", r.inverser ? "oui" : "non", [["non", T("Axe vertical normal", "Normal vertical axis")], ["oui", T("Axe vertical inversé", "Inverted vertical axis")]])}</div>
      <div class="config-champ"><span class="config-label">${T("Taille du texte", "Text size")}</span>${segment("texte", r.texte, [["normal", T("Normale", "Normal")], ["grand", T("Grande", "Large")]])}</div>
      <div class="config-champ"><span class="config-label">${T("Animations de l'interface", "Interface animations")}</span>${segment("animations", r.animations ? "oui" : "non", [["oui", T("Activées", "On")], ["non", T("Réduites", "Reduced")]])}</div>
      <div class="config-champ"><span class="config-label">${T("Champ de vision", "Field of view")}</span>${segment("fov", r.fov, [[60, T("Étroit · 60°", "Narrow · 60°")], [70, T("Standard · 70°", "Standard · 70°")], [80, T("Large · 80°", "Wide · 80°")]])}
        <p class="info-texte">${T("En mission, les touches + et − ajustent aussi le champ de vision.", "During a mission, the + and − keys also adjust the field of view.")}</p></div>
      <div class="config-champ"><span class="config-label">${T("Sensibilité de la souris", "Mouse sensitivity")}</span>${segment("sensibilite", r.sensibilite, [[0.6, T("Faible", "Low")], [1, T("Normale", "Normal")], [1.6, T("Élevée", "High")]])}</div>
      <div class="config-champ"><span class="config-label">${T("Effets sonores", "Sound effects")}</span>${segment("son", resultats.son ? "oui" : "non", [["oui", T("Activés", "On")], ["non", T("Coupés", "Off")]])}</div>
      <div class="config-champ"><span class="config-label">${T("Didacticiel", "Tutorial")}</span>
        <button type="button" id="btn-relancer-didacticiel" class="btn-secondaire btn-petit">${T("Revoir le didacticiel à la prochaine mission", "Show the tutorial again on the next mission")}</button></div>
    </div>`;
  ouvrirFenetre({
    titre: T("Paramètres", "Settings"), sousTitre: T("Langue, lisibilité et confort de jeu", "Language, readability and comfort"), corps,
    boutons: [{ label: T("Fermer", "Close"), classe: "btn-principal", action: fermerFenetre }],
    onOuverture: racine => {
      racine.querySelectorAll("input[type=radio]").forEach(inp => inp.addEventListener("change", () => {
        racine.querySelectorAll(`input[name="${inp.name}"]`).forEach(x => x.parentElement.classList.toggle("coche", x.checked));
        const v = inp.value;
        if (inp.name === "langue") return choisirLangue(v);
        if (inp.name === "texte") r.texte = v;
        if (inp.name === "animations") r.animations = v === "oui";
        if (inp.name === "fov") r.fov = Number(v);
        if (inp.name === "graphismes") { r.graphismes = v; rendu.allegement = 0; sauverResultats(); configurerRendu(); }
        if (inp.name === "qualiteAuto") r.qualiteAuto = v === "oui";
        if (["boussole", "fps", "balancement", "inverser"].includes(inp.name)) r[inp.name] = v === "oui";
        if (inp.name === "sensibilite") r.sensibilite = Number(v);
        if (inp.name === "son") { resultats.son = v === "oui"; majReglages(); }
        sauverResultats();
        appliquerReglages();
      }));
      const retablir = racine.querySelector("#btn-retablir-rendu");
      if (retablir) retablir.addEventListener("click", () => { retablirRendu(); retablir.remove(); racine.querySelector("#etat-allegement strong").textContent = ALLEGEMENTS[0]; });
      const b = racine.querySelector("#btn-relancer-didacticiel");
      b.addEventListener("click", () => { resultats.didacticiel = false; sauverResultats(); b.disabled = true; b.textContent = T("Le didacticiel sera proposé à la prochaine mission.", "The tutorial will be offered on the next mission."); });
    }
  });
}

/* ---------- G3. Aide et commandes ---------- */
function ouvrirAide() {
  if (!["menu", "pause", "jeu"].includes(jeu.mode)) return;
  const touche = (k, t) => `<div class="aide-touche"><span class="aide-kbd">${k}</span><span>${t}</span></div>`;
  const corps = `
    <div class="aide-contexte">
      <p>${T("Vous êtes commercial chez <strong>Veltis</strong>, éditeur du logiciel SaaS <strong>Veltis One</strong>, dans son <strong>immeuble de trois niveaux sur l'esplanade de La Défense</strong>. Tout se joue dans les bureaux : hall et showroom au RDC, plateau commercial au R+1, Academy et direction au R+2, reliés par les ascenseurs. Une quinzaine de collègues y travaillent, prennent un café, se réunissent, téléphonent : <strong>échangez avec eux</strong> (touche E) pour construire votre réseau interne.", "You are a sales rep at <strong>Veltis</strong>, publisher of the SaaS sales management software <strong>Veltis One</strong>, in its <strong>three-level building on the Esplanade de La Défense</strong>. Everything happens at the office: lobby and showroom on the ground floor, sales floor on level 1, Academy and leadership on level 2, linked by lifts. Around fifteen colleagues work, have coffee, meet and make calls there: <strong>talk to them</strong> (E key) to build your internal network.")}</p>
      <p>${T("<strong>Votre fil rouge : le tunnel de conversion.</strong> Chaque mission fait avancer vos contacts d'une étape : <strong>Prospect → Lead → Opportunité → Client</strong>. Votre jauge progresse quand vos décisions font convertir et recule quand elles freinent la conversion. Le <strong>tableau de bord</strong> compare votre CA, votre prévisionnel, votre marge et votre rentabilité à ceux des autres commerciaux.", "<strong>Your common thread: the conversion funnel.</strong> Each mission moves your contacts one stage further: <strong>Prospect → Lead → Opportunity → Customer</strong>. Your funnel gauge moves forward when your decisions make contacts convert and back when they block conversion. The <strong>dashboard</strong> compares your revenue, forecast, margin and profitability with the other sales reps.")}</p>
    </div>
    <div class="aide-boucle">
      <div><span class="aide-num">1</span><strong>${T("Explorez l'immeuble", "Explore the building")}</strong><p>${T("Trois niveaux reliés par les ascenseurs : RDC (hall, café, showroom), R+1 (plateau commercial), R+2 (Academy, direction, service clients).", "Three levels linked by lifts: ground floor (lobby, café, showroom), level 1 (sales floor), level 2 (Academy, leadership, customer care).")}</p></div>
      <div><span class="aide-num">2</span><strong>${T("Convertissez", "Convert")}</strong><p>${T("Chaque mission fait avancer vos contacts d'un étage du tunnel : prospect, lead, opportunité, client.", "Each mission moves your contacts one stage down the funnel: prospect, lead, opportunity, customer.")}</p></div>
      <div><span class="aide-num">3</span><strong>${T("Mesurez et comparez", "Measure and compare")}</strong><p>${T("Tableau de bord (touche K) : CA, prévisionnel, marge et rentabilité, comparés à ceux des autres commerciaux.", "Dashboard (K key): revenue, forecast, margin and profitability, compared with the other sales reps.")}</p></div>
    </div>
    <h4>${T("Commandes", "Controls")}</h4>
    <div class="aide-touches">
      ${touche(T("Souris (cliquez sur la vue)", "Mouse (click the view)"), T("Regarder autour de vous", "Look around"))}
      ${touche("Z Q S D · W A S D · ↑ ↓", T("Avancer, reculer, pas de côté", "Walk forward, back, sideways"))}
      ${touche("← →", T("Aller à gauche ou à droite, la vue s'orientant dans cette direction", "Move left or right, the view turning towards that direction"))}
      ${touche(T("Maj + ← →", "Shift + ← →"), T("Tourner la vue", "Turn the view"))}
      ${touche(T("E · Entrée", "E · Enter"), T("Agir, parler, échanger avec un collègue", "Act, talk, chat with a colleague"))}
      ${touche("Tab", T("Piloter le CRM au clavier", "Drive the CRM with the keyboard"))}
      ${touche("1 – 9 · ↑ ↓", T("Choisir une réponse en entretien", "Choose an answer in a conversation"))}
      ${touche("O", T("Équipe : qui fait quoi, où, et vos relations", "Team: who does what, where, and your relationships"))}
      ${touche("K", T("Tableau de bord commercial : CA, prévisionnel, marge, rentabilité, comparaison avec l'équipe", "Sales dashboard: revenue, forecast, margin, profitability, team comparison"))}
      ${touche("P", T("Plan de l'immeuble : niveaux, lieux, destination, carnet d'adresses", "Building map: levels, places, destination, contacts book"))}
      ${touche(T("E devant un ascenseur", "E at a lift"), T("Appeler l'ascenseur, puis 0 · 1 · 2 ou ↑ ↓ et Entrée pour choisir l'étage", "Call the lift, then 0 · 1 · 2 or ↑ ↓ and Enter to choose the floor"))}
      ${touche("G", T("Guide du commercial", "Sales guide"))}
      ${touche("F", T("Accélérer le temps", "Speed up time"))}
      ${touche("+ / −", T("Champ de vision", "Field of view"))}
      ${touche("M", T("Couper ou rétablir le son", "Mute or unmute"))}
      ${touche("H", T("Afficher cette aide", "Show this help"))}
      ${touche(T("Échap", "Esc"), T("Pause", "Pause"))}
    </div>
    <h4>${T("Repères à l'écran", "On-screen cues")}</h4>
    <ul class="liste">
      <li>${T("Boussole en haut de l'écran : direction et distance de vos objectifs (losange bleu : mission, orange : tâche, rond jaune : collègue qui vous cherche, vert : destination choisie sur le plan). Un objectif situé à un autre étage pointe vers les ascenseurs, avec le niveau à rejoindre.", "Compass at the top of the screen: direction and distance of your objectives (blue diamond: mission, orange: task, yellow dot: colleague looking for you, green: destination chosen on the map). An objective on another floor points to the lifts, with the level to reach.")}</li>
      <li>${T("Indicateur d'étage en bas à gauche : le niveau où vous êtes ; son bouton Plan (touche P) ouvre le plan de l'immeuble. Le nom de chaque lieu s'affiche quand vous y entrez.", "Floor indicator at the bottom left: the level you're on; its Map button (P key) opens the building map. Each place's name appears when you walk in.")}</li>
      <li>${T("Viseur au centre : il s'éclaire quand vous regardez quelque chose d'utilisable ; l'action s'affiche juste en dessous.", "Crosshair in the centre: it lights up when you look at something usable; the action appears just below it.")}</li>
      <li>${T("Faisceau bleu : action de mission (client à rencontrer, poste de travail).", "Blue beam: mission action (customer to meet, workstation).")}</li>
      <li>${T("Faisceau orange : tâche demandée par un collègue, avec son délai dans le bloc « À faire ».", "Orange beam: task requested by a colleague, with its deadline in the “To do” block.")}</li>
      <li>${T("Bulles : conversations de l'équipe. Approchez-vous pour voir le nom et l'activité de chacun.", "Bubbles: team conversations. Get closer to see each person's name and activity.")}</li>
      <li>${T("Jauge du tunnel : Prospect → Lead → Opportunité → Client. Chaque passage d'étape est animé ; elle fixe aussi la durée de vie projetée de vos clients.", "Funnel gauge: Prospect → Lead → Opportunity → Customer. Every stage change is animated; it also sets your customers' projected lifetime.")}</li>
      <li>${T("Chaque contact qui passe d'une étape à la suivante pendant une mission (prospect → lead → opportunité → client) est signalé par une animation.", "Every contact moving from one stage to the next during a mission (prospect → lead → opportunity → customer) is highlighted by an animation.")}</li>
    </ul>`;
  ouvrirFenetre({ titre: jeu.mode === "menu" ? T("Comment ça marche ?", "How does it work?") : T("Aide et commandes", "Help and controls"), sousTitre: "Funnelia", corps, large: true, navigation: "document", boutons: [{ label: T("Fermer", "Close"), classe: "btn-principal", action: fermerFenetre }] });
}

/* ---------- G4. Notifications empilées ---------- */
const ICONES_TOAST = { ok: "✓", ko: "!", alerte: "•", info: "i", badge: "★" };
function message(texte, type = "", duree = 2800) {
  const zone = $("toasts");
  const existant = [...zone.children].find(t => t.dataset.texte === texte);
  if (existant) { existant.remove(); }
  const el = document.createElement("div");
  el.className = `toast toast-${type || "info"}`;
  el.dataset.texte = texte;
  el.innerHTML = `<span class="toast-icone">${ICONES_TOAST[type] || "i"}</span><span class="toast-texte">${echapper(texte)}</span>`;
  zone.appendChild(el);
  while (zone.children.length > 2) zone.firstElementChild.remove();
  setTimeout(() => { el.classList.add("sortie"); setTimeout(() => el.remove(), 300); }, duree);
}

/* ---------- G5. Mission recommandée et onglets de l'accueil ---------- */
function etapeRecommandee() {
  const profil = resultats.profil;
  for (let i = 0; i < 4; i++) if (!resultats.etoiles[profil][i]) return i;
  if (!resultats.etoiles[profil][4]) return 4;
  let pire = 0;
  for (let i = 1; i < NB_ETAPES; i++) if (resultats.meilleurs[profil][i] < resultats.meilleurs[profil][pire]) pire = i;
  return pire;
}
function afficherHero() {
  const profil = resultats.profil;
  const i = etapeRecommandee();
  const def = NIVEAUX[i];
  const reussies = resultats.etoiles[profil].filter(Boolean).length;
  const v = resultats.posture[profil];
  const p = posture(v);
  const toutFait = reussies === NB_ETAPES;
  $("hero-action").innerHTML = `
    <div class="hero-reco" style="--couleur:${def.couleur}">
      <span class="hero-reco-label">${toutFait ? T("Pour progresser", "To improve") : T("Étape recommandée", "Recommended stage")} · ${def.bonus ? "Bonus" : `${i + 1} / 4`}</span>
      <strong>${def.phase}</strong>
      <span>${def.transition.join(" → ")}</span>
    </div>
    <button type="button" id="btn-hero" class="btn-principal btn-grand">${T("Jouer", "Play")}</button>
    <p class="hero-etat">${T("Missions réussies :", "Missions passed:")} <strong>${reussies}/${NB_ETAPES}</strong> · ${T("tunnel :", "funnel:")} <strong style="color:var(--pst)" data-posture="${p.cle}">${p.nom} ${v}/100</strong></p>`;
  $("btn-hero").addEventListener("click", () => { son("clic"); lancerNiveau(i); });
  document.querySelectorAll(".carte-etape").forEach(c => {
    c.classList.toggle("recommandee", Number(c.dataset.index) === i);
    c.dataset.reco = T("Recommandée", "Recommended");
  });
}
let ongletAccueil = (() => { try { return localStorage.getItem(CLES_STOCKAGE.ongletAccueil) || "progression"; } catch (e) { return "progression"; } })();
function afficherOngletAccueil(nom) {
  ongletAccueil = nom;
  try { localStorage.setItem(CLES_STOCKAGE.ongletAccueil, nom); } catch (e) { /* ignoré */ }
  document.querySelectorAll("[data-onglet-accueil]").forEach(b => {
    const actif = b.dataset.ongletAccueil === nom;
    b.classList.toggle("actif", actif);
    b.setAttribute("aria-selected", actif ? "true" : "false");
  });
  document.querySelectorAll("[data-panneau-accueil]").forEach(p => p.classList.toggle("cache", p.dataset.panneauAccueil !== nom));
}

/* ---------- G6. Badges et certificat ---------- */
const BADGES = [
  { id: "premier", nom: T("Premiers pas", "First steps"), detail: T("Terminer une première mission.", "Finish a first mission.") },
  { id: "prospecteur", nom: T("Prospecteur", "Prospector"), detail: T("Réussir l'étape Prospection.", "Pass the Prospecting stage."), etape: 0 },
  { id: "capteur", nom: T("Capteur de leads", "Lead catcher"), detail: T("Réussir l'étape Captation.", "Pass the Lead capture stage."), etape: 1 },
  { id: "qualificateur", nom: T("Qualificateur", "Qualifier"), detail: T("Réussir l'étape Qualification.", "Pass the Qualification stage."), etape: 2 },
  { id: "closer", nom: "Closer", detail: T("Réussir l'étape Closing.", "Pass the Closing stage."), etape: 3 },
  { id: "fidelisateur", nom: T("Gardien de la CLV", "CLV keeper"), detail: T("Réussir la mission bonus Fidélisation.", "Pass the Retention bonus mission."), etape: 4 },
  { id: "tunnel", nom: T("Tunnel complet", "Full funnel"), detail: T("Réussir les quatre étapes du tunnel.", "Pass all four funnel stages.") },
  { id: "excellence", nom: "Excellence", detail: T("Obtenir le niveau Excellence sur une mission.", "Reach Excellence level on a mission.") },
  { id: "sans_requin", nom: T("Conversion fluide", "Smooth conversion"), detail: T("Réussir une mission sans aucun frein à la conversion.", "Pass a mission without a single conversion blocker.") },
  { id: "conseiller", nom: T("Étape Opportunité", "Opportunity stage"), detail: T("Atteindre l'étape Opportunité du tunnel (50/100).", "Reach the Opportunity stage of the funnel (50/100).") },
  { id: "partenaire", nom: T("Étape Client", "Customer stage"), detail: T("Atteindre l'étape Client du tunnel (75/100).", "Reach the Customer stage of the funnel (75/100).") },
  { id: "reseau", nom: T("Réseau solide", "Strong network"), detail: T("Atteindre un réseau interne de 65/100.", "Reach an internal network of 65/100.") }
];
function badgesObtenus() {
  if (!resultats.badges) resultats.badges = {};
  return resultats.badges;
}
function verifierBadges(entree = null) {
  const b = badgesObtenus();
  const profil = resultats.profil;
  const reussi = i => ["terrain", "sedentaire"].some(pr => resultats.etoiles[pr][i] > 0);
  const conditions = {
    premier: resultats.historique.length > 0,
    tunnel: [0, 1, 2, 3].every(reussi),
    excellence: ["terrain", "sedentaire"].some(pr => resultats.etoiles[pr].some(e => e >= 3)),
    sans_requin: resultats.historique.some(h => h.statut === "reussi" && h.reflexesRequin === 0),
    conseiller: Math.max(resultats.posture.terrain, resultats.posture.sedentaire) >= 50,
    partenaire: Math.max(resultats.posture.terrain, resultats.posture.sedentaire) >= 75,
    reseau: reseauInterne() >= 65
  };
  BADGES.forEach(d => { if (d.etape !== undefined) conditions[d.id] = reussi(d.etape); });
  const nouveaux = BADGES.filter(d => conditions[d.id] && !b[d.id]);
  const date = new Date().toLocaleDateString(LOCALE);
  nouveaux.forEach(d => { b[d.id] = date; });
  if (nouveaux.length) sauverResultats();
  return nouveaux;
}
function afficherBadges() {
  const b = badgesObtenus();
  const n = BADGES.filter(d => b[d.id]).length;
  const certificat = b.tunnel;
  $("badges-contenu").innerHTML = `
    <div class="badges-entete">
      <p><strong>${n}/${BADGES.length}</strong> ${T("badges obtenus sur ce poste.", "badges earned on this device.")}</p>
      <button type="button" id="btn-certificat" class="${certificat ? "btn-principal" : "btn-secondaire"} btn-petit"${certificat ? "" : " disabled"}>${certificat ? T("Voir mon certificat", "View my certificate") : T("Certificat : réussir les 4 étapes du tunnel", "Certificate: pass the 4 funnel stages")}</button>
    </div>
    <div class="badges-grille">${BADGES.map(d => `
      <div class="badge-carte${b[d.id] ? " obtenu" : ""}">
        <span class="badge-medaille" aria-hidden="true">${b[d.id] ? "★" : "☆"}</span>
        <span class="badge-nom">${d.nom}</span>
        <span class="badge-detail">${d.detail}</span>
        <span class="badge-date">${b[d.id] ? `${T("Obtenu le", "Earned on")} ${b[d.id]}` : T("À débloquer", "Locked")}</span>
      </div>`).join("")}</div>`;
  if (certificat) $("btn-certificat").addEventListener("click", ouvrirCertificat);
}
function ouvrirCertificat() {
  const profil = resultats.profil;
  const v = resultats.posture[profil];
  const p = posture(v);
  const lignes = NIVEAUX.map((d, i) => `<tr><td>${d.phase}</td><td>${d.transition.join(" → ")}</td><td>${resultats.meilleurs[profil][i] ? `${resultats.meilleurs[profil][i]}/100` : "—"}</td><td>${resultats.etoiles[profil][i] ? etoilesTexte(resultats.etoiles[profil][i]) : "—"}</td></tr>`).join("");
  const nb = portefeuille();
  const corps = `
    <div class="certificat">
      <div class="marque"><span class="marque-logo" aria-hidden="true">${LOGO_FUNNELIA}</span><div><p class="marque-nom">Funnelia</p><p class="marque-devise">${T("Simulateur de conversion commerciale", "Sales conversion simulator")}</p></div></div>
      <p class="certificat-titre">${T("Certificat de parcours", "Certificate of completion")}</p>
      <p class="certificat-nom">${echapper(resultats.nom || T("Participant", "Participant"))}</p>
      <p class="certificat-texte">${T("a parcouru l'ensemble du tunnel de conversion, de l'inconnu au client signé, en profil", "has completed the whole conversion funnel, from stranger to signed customer, as a")} <strong>${PROFILS[profil].nom}</strong> (${libelleExigence()}).</p>
      <div class="certificat-chiffres">
        <div><span>${T("Étape atteinte dans le tunnel", "Funnel stage reached")}</span><strong>${p.nom} · ${v}/100</strong></div>
        <div><span>${T("Durée de vie projetée des clients", "Projected customer lifetime")}</span><strong>${ansTexte(dureeViePosture(v))}</strong></div>
        <div><span>${T("Réseau interne", "Internal network")}</span><strong>${reseauInterne()}/100</strong></div>
        ${nb ? `<div><span>${T("Valeur vie projetée du portefeuille", "Projected portfolio lifetime value")}</span><strong>${euros(nb * clvPosture(v))}</strong></div>` : ""}
      </div>
      <table class="guide-table"><thead><tr><th>${T("Étape", "Stage")}</th><th>${T("Conversion", "Conversion")}</th><th>${T("Meilleur score", "Best score")}</th><th>${T("Niveau", "Level")}</th></tr></thead><tbody>${lignes}</tbody></table>
      <p class="certificat-date">${T("Délivré le", "Issued on")} ${new Date().toLocaleDateString(LOCALE, { day: "2-digit", month: "long", year: "numeric" })}</p>
    </div>`;
  ouvrirFenetre({
    titre: T("Certificat Funnelia", "Funnelia certificate"), sousTitre: T("À imprimer ou à enregistrer en PDF", "Print it or save it as a PDF"), corps, large: true, navigation: "document",
    boutons: [{ label: T("Imprimer", "Print"), action: () => { document.body.classList.add("impression-certificat"); window.print(); document.body.classList.remove("impression-certificat"); } }, { label: T("Fermer", "Close"), classe: "btn-principal", action: fermerFenetre }]
  });
}

/* ---------- G7. Didacticiel de la première mission ---------- */
const ETAPES_DIDACTICIEL = [
  { texte: () => T("Cliquez sur la vue pour regarder à la souris, puis déplacez-vous avec <kbd>Z Q S D</kbd> ou <kbd>W A S D</kbd>.", "Click the view to look around with the mouse, then move with <kbd>W A S D</kbd> or <kbd>Z Q S D</kbd>."), fait: c => Math.hypot(joueur.x - c.x0, joueur.z - c.z0) > 2.5 },
  { texte: () => T("Approchez-vous d'un collègue et appuyez sur <kbd>E</kbd> pour échanger avec lui.", "Walk up to a colleague and press <kbd>E</kbd> to talk to them."), fait: c => vie.echanges > c.echanges || jeu.mode === "dialogue" },
  { texte: () => T("Appuyez sur <kbd>Tab</kbd> pour piloter le CRM de la mission (panneau de droite).", "Press <kbd>Tab</kbd> to drive the mission CRM (right-hand panel)."), fait: () => jeu.focusPanneau || $("panneau-mission").classList.contains("cache") },
  { texte: () => T("Appuyez sur <kbd>O</kbd> pour voir l'équipe, puis <kbd>G</kbd> pour le guide du commercial. Bonne mission !", "Press <kbd>O</kbd> to see the team, then <kbd>G</kbd> for the sales guide. Enjoy the mission!"), fait: c => c.fenetres > 0 }
];
const didacticiel = { actif: false, etape: 0, contexte: null };
function lancerDidacticiel() {
  if (resultats.didacticiel) return;
  didacticiel.actif = true;
  didacticiel.etape = 0;
  didacticiel.contexte = { x0: joueur.x, z0: joueur.z, echanges: vie.echanges, fenetres: 0 };
  afficherCoach();
}
function afficherCoach() {
  const el = $("coach");
  if (!didacticiel.actif) { el.classList.add("cache"); return; }
  const e = ETAPES_DIDACTICIEL[didacticiel.etape];
  el.innerHTML = `<div class="coach-entete"><span>${T("Didacticiel", "Tutorial")} · ${didacticiel.etape + 1}/${ETAPES_DIDACTICIEL.length}</span><button type="button" id="btn-coach-passer" class="btn-lien" tabindex="-1">${T("Passer", "Skip")}</button></div><p>${e.texte()}</p>
    <div class="coach-points">${ETAPES_DIDACTICIEL.map((x, i) => `<span class="${i < didacticiel.etape ? "fait" : i === didacticiel.etape ? "actuel" : ""}"></span>`).join("")}</div>`;
  el.classList.remove("cache");
  $("btn-coach-passer").addEventListener("click", terminerDidacticiel);
}
function terminerDidacticiel() {
  didacticiel.actif = false;
  resultats.didacticiel = true;
  sauverResultats();
  afficherCoach();
}
function majDidacticiel() {
  if (!didacticiel.actif) return;
  if (!jeu.def || jeu.mode === "bilan") { didacticiel.actif = false; afficherCoach(); return; }
  if (jeu.mode === "fenetre") didacticiel.contexte.fenetres++;
  if (ETAPES_DIDACTICIEL[didacticiel.etape].fait(didacticiel.contexte)) {
    didacticiel.etape++;
    son("notif");
    if (didacticiel.etape >= ETAPES_DIDACTICIEL.length) { terminerDidacticiel(); message(T("Didacticiel terminé : à vous de jouer !", "Tutorial complete: over to you!"), "ok", 3000); return; }
    didacticiel.contexte.fenetres = 0;
    afficherCoach();
  }
}

/* ---------- G8. Liaisons de l'interface ---------- */
document.querySelectorAll("[data-langue]").forEach(b => b.addEventListener("click", () => { son("clic"); choisirLangue(b.dataset.langue); }));
document.querySelectorAll("[data-onglet-accueil]").forEach(b => b.addEventListener("click", () => { son("clic"); afficherOngletAccueil(b.dataset.ongletAccueil); }));
$("btn-commencer").addEventListener("click", () => { son("clic"); afficherAccueil(); });
$("btn-aide-accueil").addEventListener("click", () => ouvrirAide());
$("btn-reglages-accueil").addEventListener("click", () => ouvrirReglages());
$("btn-pause-aide").addEventListener("click", () => ouvrirAide());
$("btn-pause-reglages").addEventListener("click", () => ouvrirReglages());

/* =====================================================================
   PARTIE H — RENDU RÉALISTE
   Textures procédurales (aucun fichier externe), propriétés physiques des
   matériaux, reflets de l'environnement, ciel et ville de La Défense,
   chaîne de post-traitement HDR : occlusion ambiante, halo lumineux,
   tone mapping filmique, étalonnage, vignettage et anticrénelage.
   ===================================================================== */

/* ---------- H1. Outils de texture ---------- */
let graineTexture = 7;
const aleaTex = () => { graineTexture = (graineTexture * 16807) % 2147483647; return (graineTexture - 1) / 2147483646; };
function toile(l, h) {
  const c = document.createElement("canvas");
  c.width = l;
  c.height = h;
  return [c, c.getContext("2d")];
}
function texture(canvas, rx = 1, ry = 1) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return t;
}
// Bruit fin en niveaux de gris, ajouté à une toile existante
function bruit(ctx, l, h, amplitude, base = null) {
  const img = ctx.getImageData(0, 0, l, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (aleaTex() - 0.5) * amplitude;
    const b = base === null ? 0 : base;
    d[i] = clamp((base === null ? d[i] : b) + n, 0, 255);
    d[i + 1] = clamp((base === null ? d[i + 1] : b) + n, 0, 255);
    d[i + 2] = clamp((base === null ? d[i + 2] : b) + n, 0, 255);
  }
  ctx.putImageData(img, 0, 0);
}
function taches(ctx, l, h, nombre, couleur, rayonMax, alphaMax) {
  for (let i = 0; i < nombre; i++) {
    const x = aleaTex() * l, y = aleaTex() * h, r = 10 + aleaTex() * rayonMax;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, couleur.replace("A", (aleaTex() * alphaMax).toFixed(3)));
    g.addColorStop(1, couleur.replace("A", "0"));
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
}

/* ---------- H2. Textures du bâtiment ---------- */
const TEXTURES = {};
function texturesParquet() {
  const [c, x] = toile(1024, 1024);
  const [cb, xb] = toile(1024, 1024);
  xb.fillStyle = "#9a9a9a";
  xb.fillRect(0, 0, 1024, 1024);
  const lames = 8, lw = 1024 / lames;                       // 1 texture = 2 m, lames de 25 cm
  for (let i = 0; i < lames; i++) {
    let y = -aleaTex() * 700;
    while (y < 1024) {
      const l = 360 + aleaTex() * 460;
      x.fillStyle = `hsl(${28 + aleaTex() * 7}, ${36 + aleaTex() * 12}%, ${43 + aleaTex() * 11}%)`;
      x.fillRect(i * lw, y, lw, l);
      for (let k = 0; k < 30; k++) {
        x.strokeStyle = `rgba(${60 + aleaTex() * 30},${38 + aleaTex() * 18},18,${0.04 + aleaTex() * 0.09})`;
        x.lineWidth = 0.6 + aleaTex() * 1.8;
        x.beginPath();
        const px = i * lw + aleaTex() * lw, phase = aleaTex() * 6, amp = 1 + aleaTex() * 5;
        x.moveTo(px, y);
        for (let t = 0; t <= l; t += 24) x.lineTo(px + Math.sin(t / 70 + phase) * amp, y + t);
        x.stroke();
      }
      if (aleaTex() < 0.25) {
        const nx = i * lw + 15 + aleaTex() * (lw - 30), ny = y + aleaTex() * l;
        const g = x.createRadialGradient(nx, ny, 0, nx, ny, 9);
        g.addColorStop(0, "rgba(60,35,15,0.55)");
        g.addColorStop(1, "rgba(60,35,15,0)");
        x.fillStyle = g;
        x.fillRect(nx - 12, ny - 12, 24, 24);
      }
      x.fillStyle = "rgba(35,22,10,0.6)";
      x.fillRect(i * lw, y, lw, 2);
      x.fillRect(i * lw, y, 2, l);
      xb.fillStyle = "#3c3c3c";
      xb.fillRect(i * lw, y, lw, 3);
      xb.fillRect(i * lw, y, 3, l);
      y += l;
    }
  }
  bruit(x, 1024, 1024, 10);
  return { map: c, bump: cb };
}
function textureMoquette() {
  const [c, x] = toile(512, 512);                           // 1 texture = 1 dalle de 60 cm
  x.fillStyle = "#c8c8c8";
  x.fillRect(0, 0, 512, 512);
  bruit(x, 512, 512, 70, 200);
  for (let i = 0; i < 2400; i++) {
    x.fillStyle = `rgba(${aleaTex() < 0.5 ? "255,255,255" : "40,40,40"},${0.05 + aleaTex() * 0.1})`;
    x.fillRect(aleaTex() * 512, aleaTex() * 512, 1 + aleaTex() * 2, 3 + aleaTex() * 5);
  }
  x.strokeStyle = "rgba(0,0,0,0.25)";
  x.lineWidth = 3;
  x.strokeRect(0, 0, 512, 512);
  return c;
}
function textureBeton() {
  const [c, x] = toile(1024, 1024);                         // 1 texture = 3 m
  x.fillStyle = "#c4c4c4";
  x.fillRect(0, 0, 1024, 1024);
  taches(x, 1024, 1024, 160, "rgba(90,90,90,A)", 160, 0.12);
  taches(x, 1024, 1024, 120, "rgba(255,255,255,A)", 120, 0.1);
  bruit(x, 1024, 1024, 18);
  return c;
}
function textureTerrazzo() {
  const [c, x] = toile(1024, 1024);                         // 1 texture = 2 m
  x.fillStyle = "#e3ddd2";
  x.fillRect(0, 0, 1024, 1024);
  const eclats = ["#b9b1a3", "#8f8a80", "#c9a98a", "#6f7478", "#a39a8c", "#f5f1ea"];
  for (let i = 0; i < 2600; i++) {
    x.fillStyle = eclats[Math.floor(aleaTex() * eclats.length)];
    x.beginPath();
    x.ellipse(aleaTex() * 1024, aleaTex() * 1024, 1.5 + aleaTex() * 6, 1 + aleaTex() * 4, aleaTex() * 3, 0, Math.PI * 2);
    x.fill();
  }
  bruit(x, 1024, 1024, 8);
  return c;
}
function texturePlafond() {
  const [c, x] = toile(512, 512);                           // 1 texture = 2 dalles de 60 cm
  x.fillStyle = "#f3f2ef";
  x.fillRect(0, 0, 512, 512);
  bruit(x, 512, 512, 14);
  for (let i = 0; i < 900; i++) {
    x.fillStyle = `rgba(120,120,120,${0.05 + aleaTex() * 0.08})`;
    x.fillRect(aleaTex() * 512, aleaTex() * 512, 2, 2);
  }
  x.fillStyle = "#c9c7c2";
  [0, 256].forEach(v => { x.fillRect(v, 0, 3, 512); x.fillRect(0, v, 512, 3); });
  return c;
}
function textureTissu() {
  const [c, x] = toile(256, 256);
  x.fillStyle = "#d0d0d0";
  x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 256; i += 4) {
    x.fillStyle = "rgba(0,0,0,0.07)";
    x.fillRect(i, 0, 2, 256);
    x.fillStyle = "rgba(255,255,255,0.06)";
    x.fillRect(0, i, 256, 2);
  }
  bruit(x, 256, 256, 26);
  return c;
}
function preparerTextures() {
  const p = texturesParquet();
  TEXTURES.parquet = p.map;
  TEXTURES.parquetRelief = p.bump;
  TEXTURES.moquette = textureMoquette();
  TEXTURES.beton = textureBeton();
  TEXTURES.terrazzo = textureTerrazzo();
  TEXTURES.plafond = texturePlafond();
  TEXTURES.tissu = textureTissu();
}

/* Sol texturé : la répétition suit la taille réelle du motif */
const MOTIFS_SOL = {
  parquet: { taille: 2, rugosite: 0.36, relief: 0.012 },
  moquette: { taille: 0.6, rugosite: 0.97, relief: 0.004 },
  beton: { taille: 3, rugosite: 0.5, relief: 0.003 },
  terrazzo: { taille: 2, rugosite: 0.28, relief: 0 }
};
const materiauxSol = {};
function solTexture(minX, maxX, minZ, maxZ, type, y = 0.015, teinte = 0xffffff) {
  const cle = `${type}|${teinte}`;
  const motif = MOTIFS_SOL[type];
  if (!materiauxSol[cle]) {
    const map = texture(TEXTURES[type]);
    const options = { map, color: teinte, roughness: motif.rugosite, metalness: 0 };
    if (motif.relief) { options.bumpMap = type === "parquet" ? texture(TEXTURES.parquetRelief) : map; options.bumpScale = motif.relief; }
    materiauxSol[cle] = new THREE.MeshStandardMaterial(options);
  }
  const l = maxX - minX, p = maxZ - minZ;
  const geo = new THREE.PlaneGeometry(l, p);
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * l / motif.taille + minX / motif.taille, uv.getY(i) * p / motif.taille + minZ / motif.taille);
  const m = new THREE.Mesh(geo, materiauxSol[cle]);
  m.rotation.x = -Math.PI / 2;
  m.position.set((minX + maxX) / 2, y, (minZ + maxZ) / 2);
  m.receiveShadow = true;
  return m;
}

/* ---------- H3. Propriétés physiques par teinte (métal, laque, bois…) ---------- */
const PROPRIETES_MATIERES = {
  0x9ca3af: { metalness: 0.85, roughness: 0.32 }, 0x6b7280: { metalness: 0.9, roughness: 0.28 }, 0x4b5563: { metalness: 0.8, roughness: 0.35 },
  0x1c1c1c: { metalness: 0.65, roughness: 0.38 }, 0x1f1f1f: { metalness: 0.6, roughness: 0.4 }, 0x111827: { metalness: 0.25, roughness: 0.22 },
  0xe7e2da: { roughness: 0.42 }, 0xd6cfc4: { roughness: 0.3 }, 0xd6d3d1: { roughness: 0.5 }, 0x57534e: { roughness: 0.26, metalness: 0.1 },
  0xbdb7ae: { roughness: 0.92 }, 0x161412: { roughness: 0.28, metalness: 0.15 }, 0x34312d: { roughness: 0.35 }, 0x2a2724: { roughness: 0.5 },
  0xe5e7eb: { roughness: 0.4, metalness: 0.2 }, 0xb59b7c: { roughness: 0.55 }, 0x6b5b4b: { roughness: 0.6 }, 0xf8fafc: { roughness: 0.6 }
};
APPARENCES.forEach(a => { PROPRIETES_MATIERES[a.peau] = { roughness: 0.52 }; PROPRIETES_MATIERES[a.cheveux] = { roughness: 0.58 }; });
const TEINTES_TISSU = new Set([0x1f2937, 0x374151, 0x475569, 0x334155, 0x7c2d12, 0x57534e]);
function appliquerMatieres() {
  Object.entries(materiaux).forEach(([cle, m]) => {
    const p = PROPRIETES_MATIERES[Number(cle)];
    if (p) Object.assign(m, p);
    if (TEINTES_TISSU.has(Number(cle)) && TEXTURES.tissu && !m.bumpMap) {
      m.bumpMap = texture(TEXTURES.tissu, 4, 4);
      m.bumpScale = 0.0025;
      m.roughness = 0.95;
    }
    m.envMapIntensity = 0.5;
    m.needsUpdate = true;
  });
  Object.values(materiauxSol).forEach(m => { m.envMapIntensity = 0.65; m.needsUpdate = true; });
  MATERIAUX_FACADES.forEach(m => { m.envMapIntensity = 0.8; });
  materiauVerre.envMapIntensity = 1.3;
  materiauPersonnage.envMapIntensity = 0.5;
  materiauPersonnage.needsUpdate = true;
  if (materiauGltf) { materiauGltf.envMapIntensity = 0.5; materiauGltf.needsUpdate = true; }
  materiauxDecor.forEach(m => { m.envMapIntensity = 0.5; m.needsUpdate = true; });
}

/* ---------- H4. Ciel de fin de journée, soleil et ville ---------- */
function textureCiel() {
  const [c, x] = toile(2048, 1024);
  const g = x.createLinearGradient(0, 0, 0, 1024);
  g.addColorStop(0, "#2f4f80");
  g.addColorStop(0.32, "#6f8fb8");
  g.addColorStop(0.46, "#e8b98d");
  g.addColorStop(0.5, "#f6cf9e");
  g.addColorStop(0.53, "#b9b2a8");
  g.addColorStop(1, "#777c84");
  x.fillStyle = g;
  x.fillRect(0, 0, 2048, 1024);
  // Halo du soleil, dans la direction de la lumière principale
  const d = soleil.position.clone().normalize();
  const u = ((Math.atan2(d.z, -d.x) / (Math.PI * 2)) + 1) % 1, v = Math.acos(d.y) / Math.PI;
  [-1, 0, 1].forEach(k => {
    const sx = (u + k) * 2048, sy = v * 1024;
    const h = x.createRadialGradient(sx, sy, 0, sx, sy, 520);
    h.addColorStop(0, "rgba(255,236,200,0.95)");
    h.addColorStop(0.08, "rgba(255,214,160,0.55)");
    h.addColorStop(1, "rgba(255,190,130,0)");
    x.fillStyle = h;
    x.fillRect(sx - 520, sy - 520, 1040, 1040);
  });
  // Nuages étirés au-dessus de l'horizon
  for (let i = 0; i < 260; i++) {
    const cx = aleaTex() * 2048, cy = 250 + aleaTex() * 230, rx = 60 + aleaTex() * 220, ry = 6 + aleaTex() * 22;
    const proche = Math.min(Math.abs(cx / 2048 - u), 1 - Math.abs(cx / 2048 - u)) < 0.12;
    x.fillStyle = proche ? `rgba(255,220,180,${0.05 + aleaTex() * 0.12})` : `rgba(255,255,255,${0.04 + aleaTex() * 0.1})`;
    x.beginPath();
    x.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    x.fill();
  }
  return c;
}
const MATERIAUX_FACADES = [];
function textureFacade(schema, graine) {
  graineTexture = 100 + graine * 37;
  const [c, x] = toile(512, 1024);                          // 1 texture = 16 m × 32 m
  const [ce, xe] = toile(512, 1024);
  x.fillStyle = schema.cadre;
  x.fillRect(0, 0, 512, 1024);
  xe.fillStyle = "#000";
  xe.fillRect(0, 0, 512, 1024);
  const cols = 8, rangs = 9, cw = 512 / cols, rh = 1024 / rangs;
  for (let r = 0; r < rangs; r++) for (let k = 0; k < cols; k++) {
    const gx = k * cw + 4, gy = r * rh + 6, gw = cw - 8, gh = rh - 18;
    const g = x.createLinearGradient(0, gy, 0, gy + gh);
    g.addColorStop(0, schema.haut);
    g.addColorStop(1, schema.bas);
    x.fillStyle = g;
    x.fillRect(gx, gy, gw, gh);
    if (aleaTex() < schema.allume) {
      const chaud = aleaTex() < 0.75;
      x.fillStyle = chaud ? "rgba(255,214,150,0.85)" : "rgba(210,230,255,0.8)";
      x.fillRect(gx + 2, gy + 2, gw - 4, gh - 4);
      xe.fillStyle = chaud ? `rgba(255,210,150,${0.6 + aleaTex() * 0.4})` : `rgba(200,225,255,${0.5 + aleaTex() * 0.4})`;
      xe.fillRect(gx + 2, gy + 2, gw - 4, gh - 4);
    }
  }
  return { map: c, emissif: ce };
}
function preparerFacades() {
  const schemas = [
    { cadre: "#2c3440", haut: "#7f97b4", bas: "#3d4f66", allume: 0.22 },
    { cadre: "#3a3f45", haut: "#9eb3c4", bas: "#56697c", allume: 0.18 },
    { cadre: "#1f2a33", haut: "#5d7d8f", bas: "#22323e", allume: 0.28 },
    { cadre: "#8a8379", haut: "#a9b6c1", bas: "#5d6670", allume: 0.15 }
  ];
  schemas.forEach((sc, i) => {
    const t = textureFacade(sc, i);
    MATERIAUX_FACADES.push(new THREE.MeshStandardMaterial({ map: texture(t.map), emissiveMap: texture(t.emissif), emissive: 0xffffff, emissiveIntensity: 1.4, roughness: 0.22, metalness: 0.55 }));
  });
}
function tourVille(groupe, x, z, l, p, h, materiau, cylindrique) {
  const geo = cylindrique ? new THREE.CylinderGeometry(l / 2, l / 2, h, 28, 1) : new THREE.BoxGeometry(l, h, p);
  const uv = geo.attributes.uv;
  if (cylindrique) {
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.PI * l / 16, uv.getY(i) * h / 32);
  } else {
    for (let f = 0; f < 6; f++) {
      const largeur = f < 2 ? p : l, hauteur = f === 2 || f === 3 ? p : h;
      for (let k = 0; k < 4; k++) { const i = f * 4 + k; uv.setXY(i, uv.getX(i) * largeur / 16, uv.getY(i) * hauteur / 32); }
    }
  }
  const toit = mat(0x41454b);
  const m = new THREE.Mesh(geo, cylindrique ? [materiau, toit, toit] : [materiau, materiau, toit, toit, materiau, materiau]);
  m.position.set(x, h / 2, z);
  groupe.add(m);
  if (h > 110) {
    const feu = new THREE.Mesh(new THREE.SphereGeometry(0.9, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.4, 0.3) }));
    feu.position.set(x, h + 1.5, z);
    groupe.add(feu);
  }
}
function textureSolVille() {
  const [c, x] = toile(1024, 1024);                         // 1 texture = 200 m
  x.fillStyle = "#3b3d40";
  x.fillRect(0, 0, 1024, 1024);
  for (let i = 0; i < 1024; i += 128) for (let j = 0; j < 1024; j += 128) {
    x.fillStyle = aleaTex() < 0.25 ? "#4c5a43" : `hsl(30, 6%, ${32 + aleaTex() * 10}%)`;
    x.fillRect(i + 14, j + 14, 100, 100);
  }
  bruit(x, 1024, 1024, 20);
  return c;
}
function construireVille() {
  preparerFacades();
  const ville = new THREE.Group();
  ville.position.y = NIVEAU_SOL;
  const sol = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600), new THREE.MeshStandardMaterial({ map: texture(textureSolVille(), 8, 8), roughness: 0.9 }));
  sol.rotation.x = -Math.PI / 2;
  ville.add(sol);
  const arche = pos(creerGrandeArche(), 0, 0, -300);
  arche.scale.setScalar(6.5);
  ville.add(arche);
  const voute = pos(creerVoute(), -170, 0, -280);
  voute.scale.setScalar(5);
  ville.add(voute);
  graineTexture = 4242;
  for (let i = 0; i < 80; i++) {
    const angle = aleaTex() * Math.PI * 2;
    const dist = 75 + aleaTex() * 360;
    const x = Math.sin(angle) * dist, z = Math.cos(angle) * dist;
    if (Math.abs(x) < 45 && z < -180 && z > -360) continue;       // dégagement vers la Grande Arche
    const h = 45 + aleaTex() * 150, l = 22 + aleaTex() * 30, p = 20 + aleaTex() * 30;
    tourVille(ville, x, z, l, p, h, MATERIAUX_FACADES[i % MATERIAUX_FACADES.length], aleaTex() < 0.18);
  }
  ville.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
  construireParvis(ville);
  decor.add(ville);
  // Dôme céleste et disque solaire (assez lumineux pour produire un halo)
  const ciel = new THREE.Mesh(new THREE.SphereGeometry(700, 48, 24), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(textureCiel()), side: THREE.BackSide, fog: false, depthWrite: false }));
  ciel.userData.dynamique = true;
  scene.add(ciel);
  const disque = new THREE.Mesh(new THREE.SphereGeometry(14, 24, 16), new THREE.MeshBasicMaterial({ color: new THREE.Color(9, 7.2, 5.2), fog: false }));
  disque.position.copy(soleil.position.clone().normalize().multiplyScalar(650));
  disque.userData.dynamique = true;
  scene.add(disque);
}

/* ---------- H5. Reflets : l'étage se reflète dans le verre, les sols vernis et le métal ---------- */
function genererReflets() {
  if (!renderer.capabilities.isWebGL2 && reglages().graphismes === "faible") return;
  const cible = new THREE.WebGLCubeRenderTarget(256, { type: renderer.capabilities.isWebGL2 ? THREE.HalfFloatType : THREE.UnsignedByteType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
  const cubeCam = new THREE.CubeCamera(0.1, 900, cible);
  cubeCam.position.set(-2, 1.6, 1);
  scene.add(cubeCam);
  const tm = renderer.toneMapping;
  renderer.toneMapping = THREE.NoToneMapping;
  cubeCam.update(renderer, scene);
  renderer.toneMapping = tm;
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromCubemap(cible.texture).texture;
  pmrem.dispose();
  scene.remove(cubeCam);
  lumiereCiel.intensity = 0.3;
}

/* ---------- H6. Post-traitement HDR et qualité graphique ---------- */
const SHADER_FINAL = {
  uniforms: { tDiffuse: { value: null }, exposition: { value: 0.66 }, vignettage: { value: 0.38 }, saturation: { value: 1.06 }, contraste: { value: 1.05 } },
  vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float exposition, vignettage, saturation, contraste; varying vec2 vUv;
    vec3 rrt(vec3 v) { vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
    vec3 aces(vec3 c) {
      const mat3 entree = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
      const mat3 sortie = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
      c *= exposition / 0.6; c = entree * c; c = rrt(c); c = sortie * c; return clamp(c, 0.0, 1.0);
    }
    void main() {
      vec3 c = aces(texture2D(tDiffuse, vUv).rgb);
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, saturation);
      c = (c - 0.5) * contraste + 0.5;
      c *= vec3(1.02, 1.0, 0.975);
      float d = distance(vUv, vec2(0.5));
      c *= mix(1.0, smoothstep(0.92, 0.32, d), vignettage);
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }`
};
const rendu = { composeur: null, ssao: null, halo: null, fxaa: null, qualite: null };
const QUALITES = {
  faible: { ratio: 1, ombres: 0, ssao: false, halo: false, post: false },
  moyen: { ratio: 1.25, ombres: 1024, ssao: false, halo: true, post: true },
  eleve: { ratio: 1.5, ombres: 2048, ssao: false, halo: true, post: true },
  ultra: { ratio: 2, ombres: 4096, ssao: true, halo: true, post: true }
};
function qualiteParDefaut() {
  const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
  if (mobile) return "faible";
  return "moyen";
}
function qualiteActive() { return reglages().graphismes || qualiteParDefaut(); }
function configurerRendu() {
  const nom = qualiteActive();
  const q = QUALITES[nom] || QUALITES.eleve;
  rendu.qualite = nom;
  const largeur = window.innerWidth, hauteur = window.innerHeight;
  // Allègement automatique (0 à 4) : résolution réduite, puis halo, puis ombres désactivés
  const allegement = rendu.allegement || 0;
  const ratio = Math.max(0.6, Math.min(window.devicePixelRatio || 1, q.ratio) * [1, 0.85, 0.7, 0.7, 0.7][allegement]);
  const ombres = allegement >= 4 ? 0 : q.ombres, halo = q.halo && allegement < 3;
  renderer.setPixelRatio(ratio);
  renderer.setSize(largeur, hauteur);
  // Ombres
  renderer.shadowMap.enabled = ombres > 0;
  // Le soleil et le décor sont fixes : ombres calculées une fois (ici, puis à chaque changement d'étage)
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
  soleil.castShadow = ombres > 0;
  if (ombres && soleil.shadow.mapSize.x !== ombres) {
    soleil.shadow.mapSize.set(ombres, ombres);
    if (soleil.shadow.map) { soleil.shadow.map.dispose(); soleil.shadow.map = null; }
  }
  scene.traverse(o => { if (o.material && o.material.needsUpdate !== undefined && o.isMesh) o.material.needsUpdate = true; });
  // Chaîne de post-traitement
  const disponible = !!(THREE.EffectComposer && THREE.RenderPass && THREE.ShaderPass);
  // Libère toute l'ancienne chaîne (cibles du SSAO et du halo comprises) : plus de fuite de textures
  if (rendu.composeur) {
    rendu.composeur.passes.forEach(p => {
      if (p.dispose) p.dispose();
      if (p.fsQuad && p.fsQuad.dispose) p.fsQuad.dispose();
      if (p.material && p.material.dispose) p.material.dispose();
    });
    rendu.composeur.renderTarget1.dispose();
    rendu.composeur.renderTarget2.dispose();
  }
  rendu.composeur = rendu.ssao = rendu.halo = rendu.fxaa = null;
  if (!q.post || !disponible) {
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = scene.environment ? 0.72 : 0.92;
    return;
  }
  renderer.toneMapping = THREE.NoToneMapping;
  const hdr = renderer.capabilities.isWebGL2 ? THREE.HalfFloatType : THREE.UnsignedByteType;
  const cible = new THREE.WebGLRenderTarget(largeur * ratio, hauteur * ratio, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat, type: hdr });
  const composeur = new THREE.EffectComposer(renderer, cible);
  composeur.setPixelRatio(ratio);
  composeur.setSize(largeur, hauteur);
  if (q.ssao && THREE.SSAOPass && THREE.SSAOShader) {
    const ssao = new THREE.SSAOPass(scene, camera, largeur, hauteur);
    ssao.beautyRenderTarget.texture.type = hdr;
    ssao.kernelRadius = 0.45;
    ssao.minDistance = 0.00002;
    ssao.maxDistance = 0.0012;
    composeur.addPass(ssao);
    rendu.ssao = ssao;
  } else composeur.addPass(new THREE.RenderPass(scene, camera));
  if (halo && THREE.UnrealBloomPass) {
    rendu.halo = new THREE.UnrealBloomPass(new THREE.Vector2(largeur, hauteur), 0.42, 0.55, 1.0);
    composeur.addPass(rendu.halo);
  }
  composeur.addPass(new THREE.ShaderPass(SHADER_FINAL));
  if (THREE.FXAAShader) {
    rendu.fxaa = new THREE.ShaderPass(THREE.FXAAShader);
    rendu.fxaa.uniforms.resolution.value.set(1 / (largeur * ratio), 1 / (hauteur * ratio));
    composeur.addPass(rendu.fxaa);
  }
  rendu.composeur = composeur;
}
function rendre() {
  if (rendu.composeur) rendu.composeur.render();
  else renderer.render(scene, camera);
}
function redimensionnerRendu() {
  if (!rendu.composeur) return;
  const l = window.innerWidth, h = window.innerHeight, r = renderer.getPixelRatio();
  rendu.composeur.setSize(l, h);
  if (rendu.ssao) rendu.ssao.setSize(l * r, h * r);
  if (rendu.fxaa) rendu.fxaa.uniforms.resolution.value.set(1 / (l * r), 1 / (h * r));
}
window.addEventListener("resize", redimensionnerRendu);

/* =====================================================================
   PARTIE I — INTERFACE DE JEU À LA PREMIÈRE PERSONNE
   Boussole d'objectifs, invite d'action sous le viseur, mise en scène des
   dialogues, texte progressif, compteur d'images, statistiques de pause.
   ===================================================================== */

/* ---------- I1. Boussole : cap et objectifs ---------- */
// Cap en radians : 0 = nord (vers la Grande Arche, z négatif), sens horaire
const cap = (dx, dz) => Math.atan2(dx, -dz);
const CARDINAUX = () => (EN ? ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] : ["N", "NE", "E", "SE", "S", "SO", "O", "NO"]);
const boussole = { graduations: [], derniere: "" };
function preparerBoussole() {
  const bande = $("boussole-bande");
  bande.innerHTML = "";
  for (let deg = 0; deg < 360; deg += 15) {
    const el = document.createElement("span");
    const cardinal = deg % 45 === 0;
    el.className = `grad${cardinal ? " cardinal" : ""}`;
    el.textContent = cardinal ? CARDINAUX()[deg / 45] : "";
    bande.appendChild(el);
    boussole.graduations.push({ el, angle: deg * Math.PI / 180 });
  }
}
function objectifsBoussole() {
  const liste = [];
  interactifs.forEach(i => {
    if (!i.baliseMesh || !i.baliseMesh.visible) return;
    const p = positionInteractif(i);
    liste.push({ x: p.x, z: p.z, type: "mission", label: majuscule(i.label), etage: etageInteractif(i) });
  });
  if (vie.tache) {
    const p = vie.tache.employe ? vie.tache.employe.mesh.position : vie.tache.lieu;
    liste.push({ x: p.x, z: p.z, type: "tache", label: vie.tache.titre, etage: vie.tache.employe ? vie.tache.employe.etage : 1 });
  }
  if (vie.demande && vie.demande.etat === "attente") {
    const p = vie.demande.employe.mesh.position;
    liste.push({ x: p.x, z: p.z, type: "demande", label: vie.demande.employe.def.nom, etage: vie.demande.employe.etage });
  }
  if (jeu.destination) liste.push({ x: jeu.destination.x, z: jeu.destination.z, type: "destination", label: jeu.destination.label, etage: jeu.destination.etage });
  // Didacticiel « parlez à un collègue » : la boussole désigne le collègue le plus proche
  if (didacticiel.actif && didacticiel.etape === 1) {
    let proche = null, dMin = Infinity;
    employes.forEach(e => {
      if (e.etage !== joueur.etage || !e.mesh.visible) return;
      const d = Math.hypot(e.mesh.position.x - joueur.x, e.mesh.position.z - joueur.z);
      if (d < dMin) { dMin = d; proche = e; }
    });
    if (proche) liste.push({ x: proche.mesh.position.x, z: proche.mesh.position.z, type: "demande", label: proche.def.nom, etage: joueur.etage });
  }
  // Un objectif situé à un autre niveau se signale sur les ascenseurs du niveau courant
  const vus = new Set();
  return liste.map(o => (o.etage === joueur.etage ? o : { x: 3.9, z: 9.0, type: o.type, label: EN ? `Lift → ${ETAGES[o.etage].code} · ${o.label}` : `Ascenseur → ${ETAGES[o.etage].code} · ${o.label}`, etage: joueur.etage, ailleurs: ETAGES[o.etage].code }))
    .filter(o => { if (!o.ailleurs) return true; const k = `${o.type}|${o.ailleurs}`; if (vus.has(k)) return false; vus.add(k); return true; });
}
function majBoussole() {
  const el = $("boussole");
  // Couche 2 : la boussole n'apparaît que lorsqu'il y a un objectif à indiquer
  const objectifs = jeu.mode === "jeu" && jeu.def && reglages().boussole !== false ? objectifsBoussole() : [];
  const visible = objectifs.length > 0;
  el.classList.toggle("cache", !visible);
  if (!visible) return;
  const largeur = el.clientWidth || 460, champ = Math.PI * 2 / 3;
  const vue = cap(Math.sin(jeu.lacet), Math.cos(jeu.lacet));
  const ecart = a => Math.atan2(Math.sin(a - vue), Math.cos(a - vue));
  boussole.graduations.forEach(g => {
    const e = ecart(g.angle);
    const visibleG = Math.abs(e) < champ / 2;
    ecrireStyle(g.el, "display", visibleG ? "block" : "none");
    if (visibleG) ecrireStyle(g.el, "left", `${(0.5 + e / champ) * largeur}px`);
  });
  const marques = objectifs.map(o => {
    const e = ecart(cap(o.x - joueur.x, o.z - joueur.z));
    const d = distanceMetres(o);
    const bord = Math.abs(e) > champ / 2;
    const x = (0.5 + clamp(e, -champ / 2, champ / 2) / champ) * largeur;
    const centre = Math.abs(e) < 0.12;
    return `<span class="repere repere-${o.type}${bord ? " bord" : ""}${o.ailleurs ? " ailleurs" : ""}" style="left:${x.toFixed(0)}px"><i></i><b>${o.ailleurs ? `${o.ailleurs} · ` : ""}${d} m</b>${centre ? `<em>${echapper(o.label)}</em>` : ""}</span>`;
  }).join("");
  if (marques !== boussole.derniere) { $("boussole-reperes").innerHTML = marques; boussole.derniere = marques; }
}

/* ---------- I2. Invite d'action sous le viseur ---------- */
let derniereInvite = "";
function majInvite(proche) {
  const el = $("invite");
  const html = proche && jeu.mode === "jeu" && !jeu.focusPanneau ? `<kbd>E</kbd><span>${echapper(majuscule(proche.label))}</span>` : "";
  if (html !== derniereInvite) { el.innerHTML = html; el.classList.toggle("cache", !html); derniereInvite = html; }
}

/* ---------- I3. Mise en scène des dialogues et texte progressif ---------- */
const frappe = { minuterie: null, texte: "", el: null };
function lancerFrappe(el, texte) {
  clearInterval(frappe.minuterie);
  frappe.el = el;
  frappe.texte = texte;
  if (!reglages().animations || texte.length < 12) { el.textContent = texte; frappe.minuterie = null; return; }
  let n = 0;
  el.textContent = "";
  el.classList.add("en-frappe");
  frappe.minuterie = setInterval(() => {
    n = Math.min(texte.length, n + 3);
    el.textContent = texte.slice(0, n);
    if (n >= texte.length) terminerFrappe();
  }, 16);
}
function terminerFrappe() {
  if (!frappe.minuterie) return false;
  clearInterval(frappe.minuterie);
  frappe.minuterie = null;
  frappe.el.textContent = frappe.texte;
  frappe.el.classList.remove("en-frappe");
  return true;
}
$("dialogue-texte").addEventListener("click", terminerFrappe);

/* ---------- I4. Compteur d'images et adaptation de la qualité ---------- */
const performance_ = { images: 0, depuis: 0, moyenne: 60, lentes: 0, suggere: false };
function majPerformances(dt) {
  performance_.images++;
  performance_.depuis += dt;
  if (performance_.depuis < 1) return;
  performance_.moyenne = performance_.images / performance_.depuis;
  performance_.images = 0;
  performance_.depuis = 0;
  const el = $("fps");
  el.classList.toggle("cache", !reglages().fps);
  if (reglages().fps) el.textContent = `${Math.round(performance_.moyenne)} FPS · ${T({ faible: "Faible", moyen: "Moyen", eleve: "Élevé", ultra: "Ultra" }[rendu.qualite] || "", { faible: "Low", moyen: "Medium", eleve: "High", ultra: "Ultra" }[rendu.qualite] || "")}`;
  // Image lente pendant 4 secondes : on allège d'un cran (au plus 4 crans), puis on laisse le temps de remesurer
  if (jeu.mode === "jeu" && reglages().qualiteAuto !== false && (rendu.allegement || 0) < ALLEGEMENTS.length - 1) {
    performance_.lentes = performance_.moyenne < SEUIL_FPS_ALLEGEMENT ? performance_.lentes + 1 : Math.min(0, performance_.lentes + 1);
    if (performance_.lentes >= 4) { performance_.lentes = -4; allegerRendu(); }
  }
}
const SEUIL_FPS_ALLEGEMENT = 40;
const ALLEGEMENTS = [
  T("Image complète", "Full picture"), T("Résolution réduite", "Lower resolution"), T("Résolution réduite davantage", "Even lower resolution"),
  T("Résolution réduite, halo lumineux coupé", "Lower resolution, light bloom off"), T("Résolution réduite, halo et ombres coupés", "Lower resolution, bloom and shadows off")
];
function allegerRendu() {
  rendu.allegement = (rendu.allegement || 0) + 1;
  configurerRendu();
  message(T(`Image allégée pour rester fluide : ${ALLEGEMENTS[rendu.allegement].toLowerCase()}. Paramètres pour revenir en arrière.`, `Picture lightened to stay smooth: ${ALLEGEMENTS[rendu.allegement].toLowerCase()}. Settings to undo.`), "info", 5000);
}
function retablirRendu() {
  rendu.allegement = 0;
  performance_.lentes = -8;
  configurerRendu();
}

/* ---------- I5. Statistiques affichées en pause ---------- */
function statistiquesPause() {
  const t = jeu.def && jeu.def.tunnel ? jeu.def.tunnel(jeu.n) : null;
  const carte = (label, valeur) => `<div class="stat"><span>${label}</span><strong>${valeur}</strong></div>`;
  $("pause-stats").innerHTML = [
    carte(T("Temps de jeu", "Play time"), `${Math.floor(jeu.dureeReelle / 60)} min ${String(Math.round(jeu.dureeReelle % 60)).padStart(2, "0")} s`),
    carte(T("Erreurs", "Errors"), `${jeu.erreurs}/${MAX_ERREURS}`),
    carte(T("Tunnel", "Funnel"), `${posture().nom} · ${Math.round(jeu.posture)}/100`),
    carte(T("Réseau interne", "Internal network"), `${reseauInterne()}/100`),
    t ? carte(`${t.de} → ${t.vers}`, pourcent(tauxTunnel(t))) : "",
    carte(T("Niveau", "Floor"), `${ETAGES[joueur.etage].code} · ${zoneNiveau(joueur.etage, joueur)}`),
    carte(T("Cartes de visite", "Business cards"), `${(resultats.reseauExterne || []).length}`)
  ].join("");
}

/* ---------- I6. Mise à jour à chaque image ---------- */
function majInterfaceJeu(dt, proche) {
  majBoussole();
  majInvite(proche);
  majPerformances(dt);
  document.body.classList.toggle("mode-dialogue", jeu.mode === "dialogue");
  document.body.classList.toggle("mode-ascenseur", jeu.mode === "ascenseur");
  document.body.classList.toggle("en-exploration", jeu.mode === "jeu" && !!jeu.def);
}

/* ---------- I7. Chargement progressif du jeu ---------- */
// Les tests automatisés chargent le jeu d'un seul tenant (window.CHARGEMENT_SYNCHRONE)
const prochaineImage = () => (window.CHARGEMENT_SYNCHRONE ? Promise.resolve() : new Promise(r => requestAnimationFrame(() => r())));
async function etapeChargement(texte, part, action) {
  $("chargement-texte").textContent = texte;
  $("chargement-barre").style.width = `${Math.round(part * 100)}%`;
  await prochaineImage();
  await prochaineImage();
  await action();
}

/* =====================================================================
   PARTIE J — L'IMMEUBLE VELTIS : TROIS NIVEAUX, ASCENSEURS, VIE DES ÉTAGES
   ---------------------------------------------------------------------
   RDC : hall d'accueil, contrôle d'accès, Café du Parvis, showroom
         Veltis One, auditorium, salon des visiteurs.
   R+1 : plateau commercial (open space, salons clients, Forum…).
   R+2 : Veltis Academy, salle du Conseil, Service clients, Veltis Lab,
         bibliothèque, lounge panoramique Le Belvédère.
   Un seul niveau est affiché à la fois : l'ascenseur fait passer de l'un
   à l'autre (portes palières, cabine, choix de l'étage, trajet).
   ===================================================================== */

/* ---------- J1. Niveau courant ---------- */
const NIVEAU_SOL = -HAUTEUR_NIVEAU - 0.06;          // esplanade, juste sous le sol du RDC
const immeuble = { secousse: 0, coques: [], bandeauFin: 0 };
joueur.etage = 1;
ETAGES[1].nav = NAV;
const etageY = (n = joueur.etage) => ETAGES[n].y;
scene.add(soleil.target);
// Niveau d'un objet 3D : celui du groupe d'étage qui le contient
function etageDe(objet) {
  for (let o = objet; o; o = o.parent) {
    const e = ETAGES.find(x => x.groupe === o);
    if (e) return e.niveau;
  }
  return 1;
}
const etageInteractif = i => i.etage ?? (i.objet ? etageDe(i.objet) : 1);
function afficherNiveau(n) {
  ETAGES.forEach(e => { e.groupe.visible = e.niveau === n; });
  immeuble.coques.forEach((c, i) => { c.visible = i !== n; });
  // L'ombre du soleil suit le niveau affiché
  soleil.position.set(-34, 21 + ETAGES[n].y, 16);
  soleil.target.position.set(0, ETAGES[n].y, 0);
  soleil.target.updateMatrixWorld();
  // Ombres statiques : la carte d'ombres n'est recalculée qu'au changement d'étage
  renderer.shadowMap.needsUpdate = true;
}
function changerEtage(n) {
  joueur.etage = n;
  afficherNiveau(n);
  lieuCourant.cle = null;
  majIndicateurEtage();
}

/* ---------- J2. Ascenseurs : noyau, cabines, portes palières ---------- */
const CABINES = [7.2, 9.0, 10.8];
const pointAppel = i => ({ x: 4.15, z: CABINES[i], a: -O / 2, pose: "debout" });
const portesAscenseur = ETAGES.map(() => []);
const materiauInox = new THREE.MeshStandardMaterial({ color: 0xc3c7cc, metalness: 0.92, roughness: 0.26 });
const materiauMiroir = new THREE.MeshStandardMaterial({ color: 0xdfe5ea, metalness: 1, roughness: 0.05 });
const materiauVoyant = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 1.6, 0.55), toneMapped: false });
const materiauLedCabine = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.7, 2.65, 2.5), toneMapped: false });
function creerAscenseurs(g, niveau) {
  const H = HAUTEUR_PLAFOND, e = ETAGES[niveau];
  const bloc = (x1, x2, y1, y2, z1, z2, m = 0x6b655d) => {
    const b = maillage(new THREE.BoxGeometry(x2 - x1, y2 - y1, z2 - z1), typeof m === "number" ? mat(m) : m);
    b.position.set((x1 + x2) / 2, (y1 + y2) / 2, (z1 + z2) / 2);
    g.add(b);
    return b;
  };
  const voyant = (x, y, z, a, r = 0.014) => {
    const v = new THREE.Mesh(new THREE.CircleGeometry(r, 14), materiauVoyant);
    v.rotation.y = a;
    v.position.set(x, y, z);
    g.add(v);
  };
  // Noyau béton habillé de pierre : fond, refends entre les cabines, linteau
  bloc(1.9, 1.98, 0, H, 6.2, 11.8);
  [[6.2, 6.65], [7.75, 8.45], [9.55, 10.25], [11.35, 11.8]].forEach(([a, b]) => bloc(1.98, 3.36, 0, H, a, b));
  bloc(1.98, 3.36, 2.24, H, 6.65, 11.35);
  CABINES.forEach(zc => {
    // Cabine : sol de pierre sombre, plafond lumineux, miroir, parois inox, main courante, boutons
    bloc(1.98, 3.24, 0, 0.03, zc - 0.55, zc + 0.55, 0x2f2b28);
    bloc(1.98, 3.24, 2.2, 2.24, zc - 0.55, zc + 0.55, 0xd6d3d1);
    const led = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.72), materiauLedCabine);
    led.rotation.x = Math.PI / 2;
    led.position.set(2.6, 2.195, zc);
    g.add(led);
    const miroir = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 1.4), materiauMiroir);
    miroir.rotation.y = O / 2;
    miroir.position.set(1.985, 1.35, zc);
    g.add(miroir);
    bloc(1.98, 3.24, 0, 2.2, zc - 0.555, zc - 0.545, materiauInox);
    bloc(1.98, 3.24, 0, 2.2, zc + 0.545, zc + 0.555, materiauInox);
    bloc(2.02, 2.05, 0.92, 0.95, zc - 0.45, zc + 0.45, materiauInox);
    bloc(3.2, 3.235, 0.98, 1.46, zc + 0.36, zc + 0.5, materiauInox);
    [1.06, 1.16, 1.26, 1.36].forEach((y, k) => voyant(3.195, y, zc + 0.43, -O / 2, k === niveau + 1 ? 0.016 : 0.011));
    // Encadrement de la baie et indicateur d'étage
    bloc(3.36, 3.4, 0, 2.27, zc - 0.57, zc - 0.5, materiauInox);
    bloc(3.36, 3.4, 0, 2.27, zc + 0.5, zc + 0.57, materiauInox);
    bloc(3.36, 3.4, 2.2, 2.27, zc - 0.57, zc + 0.57, materiauInox);
    const ind = panneauTexte(0.34, 0.14, { largeur: 136, hauteur: 56, fond: "#0b0b0c", lignes: [{ texte: e.code, taille: 34, gras: 800, couleur: "#fbbf24" }] });
    ind.rotation.y = O / 2;
    ind.position.set(3.405, 2.43, zc);
    g.add(ind);
    // Portes palières : deux vantaux qui coulissent dans les refends
    const vantail = s => {
      const v = new THREE.Mesh(new THREE.BoxGeometry(0.03, 2.2, 0.52), materiauInox);
      v.position.set(3.3, 1.1, zc + s * 0.26);
      v.castShadow = true;
      v.userData.dynamique = true;
      g.add(v);
      return v;
    };
    portesAscenseur[niveau].push({ zc, gauche: vantail(-1), droite: vantail(1), ouverture: 0, cible: 0, fin: 0 });
  });
  // Boutons d'appel entre les baies
  [8.1, 9.9].forEach(z => {
    bloc(3.36, 3.38, 1.04, 1.36, z - 0.055, z + 0.055, materiauInox);
    voyant(3.385, 1.27, z, O / 2);
    voyant(3.385, 1.13, z, O / 2);
  });
  const autres = ETAGES.filter(x => x.niveau !== niveau).map(x => `${x.code} ${x.nom}`).join(" · ");
  const p = panneauTexte(1.6, 0.36, { largeur: 400, hauteur: 90, fond: "#0f172a", lignes: [{ texte: EN ? `LIFTS · ${e.code}` : `ASCENSEURS · ${e.code}`, taille: 30, gras: 800, couleur: "#ffffff" }, { texte: autres, taille: 15, gras: 500, couleur: "#cbd5e1" }] });
  p.rotation.y = O / 2;
  p.position.set(3.405, 2.74, 9.0);
  g.add(p);
  obstacleBoite(2.66, 9.0, 0.76, 2.82);
}
function ouvrirPortes(n, i, duree = 4) {
  const p = portesAscenseur[n][i];
  if (!p) return;
  if (p.cible === 0 && n === joueur.etage && Math.hypot(joueur.x - 3.3, joueur.z - p.zc) < 10) son("ding");
  p.cible = 1;
  p.fin = duree === Infinity ? 0 : jeu.temps + duree;
}
function fermerPortes(n, i) {
  const p = portesAscenseur[n][i];
  p.cible = 0;
  p.fin = 0;
}
function majPortesAscenseurs(dt) {
  portesAscenseur.forEach(liste => liste.forEach(p => {
    if (p.fin && jeu.temps > p.fin) { p.cible = 0; p.fin = 0; }
    const avant = p.ouverture;
    p.ouverture = clamp(p.ouverture + clamp(p.cible - p.ouverture, -dt * 1.4, dt * 1.4), 0, 1);
    if (p.ouverture === avant) return;
    const k = p.ouverture * p.ouverture * (3 - 2 * p.ouverture);
    p.gauche.position.z = p.zc - 0.26 - 0.47 * k;
    p.droite.position.z = p.zc + 0.26 + 0.47 * k;
  }));
}

/* ---------- J3. Trajet en ascenseur ---------- */
const trajet = { actif: false, phase: "", t: 0, cabine: 0, depart: 1, arrivee: 1, x0: 0, z0: 0, l0: 0, choix: 1 };
const lisser = t => t * t * (3 - 2 * t);
const ecartAngle = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
const etapeTrajet = phase => { trajet.phase = phase; trajet.t = 0; };
function entrerAscenseur(i) {
  if (jeu.mode !== "jeu" || trajet.actif) return;
  const objectifs = objectifsParNiveau();
  const utile = [0, 1, 2].find(n => n !== joueur.etage && (objectifs[n].mission || objectifs[n].tache || objectifs[n].destination));
  Object.assign(trajet, { actif: true, t: 0, cabine: i, depart: joueur.etage, arrivee: joueur.etage, x0: joueur.x, z0: joueur.z, l0: jeu.lacet, choix: utile ?? (joueur.etage === 2 ? 1 : joueur.etage + 1) });
  etapeTrajet("appel");
  jeu.mode = "ascenseur";
  touches.clear();
  libererSouris();
  ouvrirPortes(joueur.etage, i, Infinity);
}
function majAscenseur(dt) {
  if (!trajet.actif) return;
  trajet.t += dt;
  const zc = CABINES[trajet.cabine];
  if (trajet.phase === "appel") {
    jeu.lacet += ecartAngle(jeu.lacet, Math.atan2(2.6 - joueur.x, zc - joueur.z)) * Math.min(1, dt * 5);
    if (trajet.t > 0.6) { trajet.x0 = joueur.x; trajet.z0 = joueur.z; trajet.l0 = jeu.lacet; etapeTrajet("entree"); }
  } else if (trajet.phase === "entree") {
    // On entre dans la cabine, puis on se retourne face aux portes
    const k = lisser(clamp(trajet.t / 1.5, 0, 1));
    joueur.x = trajet.x0 + (2.55 - trajet.x0) * k;
    joueur.z = trajet.z0 + (zc - trajet.z0) * k;
    const versCabine = Math.atan2(2.55 - trajet.x0, zc - trajet.z0);
    const a1 = trajet.l0 + ecartAngle(trajet.l0, versCabine) * lisser(clamp(trajet.t / 0.45, 0, 1));
    jeu.lacet = a1 + ecartAngle(a1, O / 2) * lisser(clamp((trajet.t - 0.85) / 0.65, 0, 1));
    jeu.tangage += (-0.05 - jeu.tangage) * Math.min(1, dt * 4);
    joueur.bouge = k < 0.92;
    if (trajet.t >= 1.5) { joueur.bouge = false; etapeTrajet("choix"); afficherPanneauAscenseur(); }
  } else if (trajet.phase === "fermeture") {
    if (trajet.t > 1.05) etapeTrajet("deplacement");
  } else if (trajet.phase === "deplacement") {
    const ecart = Math.abs(trajet.arrivee - trajet.depart);
    const duree = 1.5 + 1.1 * ecart;
    const k = clamp(trajet.t / duree, 0, 1);
    // Légère vibration de la cabine pendant le trajet
    immeuble.secousse = Math.sin(trajet.t * 37) * 0.003 * Math.sin(k * Math.PI);
    majEcranAscenseur(Math.round(trajet.depart + (trajet.arrivee - trajet.depart) * k), Math.sign(trajet.arrivee - trajet.depart));
    if (k >= 0.5 && joueur.etage !== trajet.arrivee) { changerEtage(trajet.arrivee); joueur.x = 2.55; joueur.z = zc; }
    if (k >= 1) {
      immeuble.secousse = 0;
      majEcranAscenseur(trajet.arrivee, 0);
      ouvrirPortes(trajet.arrivee, trajet.cabine, Infinity);
      son("ding");
      etapeTrajet("ouverture");
    }
  } else if (trajet.phase === "ouverture") {
    if (trajet.t > 0.95) { masquerPanneauAscenseur(); etapeTrajet("sortie"); }
  } else if (trajet.phase === "sortie") {
    const k = lisser(clamp(trajet.t / 1.25, 0, 1));
    joueur.x = 2.55 + (4.3 - 2.55) * k;
    joueur.z = zc;
    jeu.lacet += ecartAngle(jeu.lacet, O / 2) * Math.min(1, dt * 5);
    joueur.bouge = k < 0.92;
    if (trajet.t >= 1.25) terminerTrajet();
  }
  joueur.mesh.position.set(joueur.x, 0, joueur.z);
}
function choisirNiveau(n) {
  if (!trajet.actif || trajet.phase !== "choix" || !ETAGES[n]) return;
  son("clic");
  trajet.choix = n;
  if (n === trajet.depart) { masquerPanneauAscenseur(); etapeTrajet("sortie"); return; }
  trajet.arrivee = n;
  fermerPortes(trajet.depart, trajet.cabine);
  etapeTrajet("fermeture");
  majPanneauAscenseur();
  if (jeu.def) avancerTemps(1 + Math.abs(n - trajet.depart));
}
function terminerTrajet() {
  const p = portesAscenseur[joueur.etage][trajet.cabine];
  p.fin = jeu.temps + 1.6;
  trajet.actif = false;
  joueur.bouge = false;
  immeuble.secousse = 0;
  masquerPanneauAscenseur();
  if (jeu.mode === "ascenseur") jeu.mode = "jeu";
  if (trajet.arrivee !== trajet.depart) annoncerNiveau(joueur.etage);
}
function clavierAscenseur(e, cle) {
  e.preventDefault();
  if (trajet.phase !== "choix" || e.repeat) return;
  const dir = DEPLACEMENTS[cle];
  if (dir === "haut" || dir === "bas") {
    trajet.choix = clamp(trajet.choix + (dir === "haut" ? 1 : -1), 0, 2);
    son("clic");
    majPanneauAscenseur();
  } else if (["0", "1", "2"].includes(cle)) choisirNiveau(Number(cle));
  else if (EN && cle === "g") choisirNiveau(0);
  else if (VALIDER.includes(cle) || cle === "e") choisirNiveau(trajet.choix);
  else if (cle === "escape") choisirNiveau(trajet.depart);
}

/* Tableau de commande de la cabine */
function objectifsParNiveau() {
  const r = [0, 1, 2].map(() => ({ mission: false, tache: false, destination: false }));
  interactifs.forEach(i => {
    if (!i.actif || (i.objet && !i.objet.visible) || (i.baliseVisible && !i.baliseVisible()) || i.carte === false) return;
    r[etageInteractif(i)].mission = true;
  });
  if (vie.tache) r[vie.tache.employe ? vie.tache.employe.etage : 1].tache = true;
  if (vie.demande) r[vie.demande.employe.etage].tache = true;
  if (jeu.destination) r[jeu.destination.etage].destination = true;
  return r;
}
function presenceNiveau(n) {
  const c = employes.filter(e => e.etage === n && e.mesh.visible).length;
  const v = figurants.filter(f => f.etage === n).length;
  const morceaux = [];
  if (c) morceaux.push(EN ? `${c} colleague${c > 1 ? "s" : ""}` : `${c} collègue${c > 1 ? "s" : ""}`);
  if (v) morceaux.push(EN ? `${v} other${v > 1 ? "s" : ""}` : `${v} autre${v > 1 ? "s" : ""} personne${v > 1 ? "s" : ""}`);
  return morceaux.join(" · ");
}
function afficherPanneauAscenseur() {
  $("ascenseur").classList.remove("cache");
  majPanneauAscenseur();
}
function masquerPanneauAscenseur() { $("ascenseur").classList.add("cache"); }
function majPanneauAscenseur() {
  const objectifs = objectifsParNiveau();
  const enRoute = trajet.phase !== "choix";
  $("asc-boutons").innerHTML = [2, 1, 0].map(n => {
    const e = ETAGES[n];
    const tags = [];
    if (n === trajet.depart) tags.push(`<em class="asc-ici">${T("Vous êtes ici", "You are here")}</em>`);
    if (objectifs[n].mission) tags.push(`<em class="asc-mission">${T("Objectif de mission", "Mission objective")}</em>`);
    if (objectifs[n].tache) tags.push(`<em class="asc-tache">${T("Tâche en cours", "Task in progress")}</em>`);
    if (objectifs[n].destination) tags.push(`<em class="asc-dest">${T("Destination", "Destination")}</em>`);
    const presence = presenceNiveau(n);
    if (presence) tags.push(`<em>${echapper(presence)}</em>`);
    const etat = enRoute ? (n === trajet.arrivee ? " actif" : " eteint") : (n === trajet.choix ? " selection" : "");
    return `<button class="asc-bouton${etat}" data-niveau="${n}" tabindex="-1"><span class="asc-rond">${e.bouton}</span><span class="asc-texte"><strong>${e.code} · ${echapper(e.nom)}</strong><small>${echapper(e.resume)}</small><span class="asc-tags">${tags.join("")}</span></span></button>`;
  }).join("");
  $("asc-titre").textContent = enRoute ? T("Fermeture des portes…", "Doors closing…") : T("Choisissez un étage", "Choose a floor");
  if (!enRoute) majEcranAscenseur(trajet.depart, 0);
}
function majEcranAscenseur(n, sens) {
  const code = ETAGES[clamp(n, 0, 2)].code;
  if ($("asc-niveau").textContent !== code) $("asc-niveau").textContent = code;
  $("asc-fleche").textContent = sens > 0 ? "▲" : sens < 0 ? "▼" : "";
  if (trajet.phase === "deplacement") $("asc-titre").textContent = sens > 0 ? T("Montée…", "Going up…") : T("Descente…", "Going down…");
}
$("btn-plan").addEventListener("click", () => ouvrirPlan());
$("asc-boutons").addEventListener("click", ev => {
  const b = ev.target.closest("[data-niveau]");
  if (b) choisirNiveau(Number(b.dataset.niveau));
});
$("asc-boutons").addEventListener("pointerover", ev => {
  const b = ev.target.closest("[data-niveau]");
  if (!b || trajet.phase !== "choix" || Number(b.dataset.niveau) === trajet.choix) return;
  trajet.choix = Number(b.dataset.niveau);
  majPanneauAscenseur();
});

/* ---------- J4. Repères : indicateur d'étage, nom des lieux, destination ---------- */
const lieuCourant = { cle: null, depuis: 0, candidat: null };
function majIndicateurEtage() {
  const el = $("etage-chip");
  if (!el) return;
  const e = ETAGES[joueur.etage];
  el.querySelector(".ec-code").textContent = e.code;
  el.querySelector(".ec-nom").textContent = e.nom;
  el.querySelectorAll(".ec-pile i").forEach(i => i.classList.toggle("actif", Number(i.dataset.n) === joueur.etage));
}
function zoneNiveau(n, p) {
  if (n === 1) return zoneDe(p);
  const z = ZONES_NIVEAU[n].find(r => p.x >= r.minX && p.x <= r.maxX && p.z >= r.minZ && p.z <= r.maxZ);
  return z ? z.nom : T("Circulations", "Corridors");
}
function afficherBandeauLieu(code, nom, detail = "", grand = false) {
  const el = $("lieu");
  el.className = `lieu${grand ? " grand" : ""}`;
  el.innerHTML = `<span class="lieu-etage">${echapper(code)}</span><span class="lieu-texte"><strong>${echapper(nom)}</strong>${detail ? `<small>${echapper(detail)}</small>` : ""}</span>`;
  clearTimeout(afficherBandeauLieu.sortie);
  clearTimeout(afficherBandeauLieu.cache);
  afficherBandeauLieu.sortie = setTimeout(() => el.classList.add("sortie"), grand ? 3800 : 2300);
  afficherBandeauLieu.cache = setTimeout(() => el.classList.add("cache"), grand ? 4300 : 2800);
}
function annoncerNiveau(n) {
  const e = ETAGES[n];
  immeuble.bandeauFin = jeu.temps + 4.5;
  lieuCourant.cle = `${n}|${zoneNiveau(n, joueur)}`;
  afficherBandeauLieu(e.code, e.nom, e.resume, true);
}
function majLieu(dt) {
  const chip = $("etage-chip");
  chip.classList.toggle("cache", !(jeu.def && ["jeu", "dialogue", "fenetre", "ascenseur"].includes(jeu.mode)));
  if (jeu.mode !== "jeu" || !jeu.def) return;
  const nom = zoneNiveau(joueur.etage, joueur);
  const cle = `${joueur.etage}|${nom}`;
  if (cle === lieuCourant.cle) { lieuCourant.candidat = null; return; }
  if (lieuCourant.candidat !== cle) { lieuCourant.candidat = cle; lieuCourant.depuis = 0; }
  lieuCourant.depuis += dt;
  if (lieuCourant.depuis < 0.5) return;
  const premiere = lieuCourant.cle === null;
  lieuCourant.cle = cle;
  lieuCourant.candidat = null;
  if (!premiere && nom !== T("Circulations", "Corridors") && jeu.temps > immeuble.bandeauFin) afficherBandeauLieu(ETAGES[joueur.etage].code, nom);
}

/* Destination choisie sur le plan de l'immeuble (repère vert) */
jeu.destination = null;
function definirDestination(d) {
  jeu.destination = d;
  message(EN ? `Destination set: ${d.label} (${ETAGES[d.etage].code}). Follow the green marker on the compass.` : `Destination : ${d.label} (${ETAGES[d.etage].code}). Suivez le repère vert de la boussole.`, "info", 3400);
}
function majDestination() {
  const d = jeu.destination;
  if (!d || jeu.mode !== "jeu") return;
  if (!jeu.def) { jeu.destination = null; return; }
  if (d.etage === joueur.etage && Math.hypot(d.x - joueur.x, d.z - joueur.z) < 1.7) {
    jeu.destination = null;
    son("notif");
    message(EN ? `You have arrived: ${d.label}.` : `Vous êtes arrivé : ${d.label}.`, "ok", 2400);
  }
}

/* ---------- J5. Plans des niveaux (mini-carte et plan de l'immeuble) ---------- */
function dessinerFlecheJoueur(ctx, x, y) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-joueur.mesh.rotation.y + Math.PI);
  ctx.scale(1.7, 1.7);
  ctx.fillStyle = "#0f172a";
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, -9);
  ctx.lineTo(6, 6);
  ctx.lineTo(0, 3);
  ctx.lineTo(-6, 6);
  ctx.closePath();
  ctx.stroke();
  ctx.fill();
  ctx.restore();
}
// Repères communs à tous les niveaux : destination, objectifs situés à un autre étage
function marqueursCommuns(ctx, sx, sz, n, pulse) {
  const d = jeu.destination;
  if (d && d.etage === n) {
    ctx.fillStyle = "#16a34a";
    ctx.beginPath();
    ctx.arc(sx(d.x), sz(d.z), pulse * 0.9, 0, Math.PI * 2);
    ctx.fill();
  }
  if (n !== joueur.etage) return;
  const objectifs = objectifsParNiveau();
  const ailleurs = [0, 1, 2].filter(k => k !== n && (objectifs[k].mission || objectifs[k].tache || objectifs[k].destination));
  if (!ailleurs.length) return;
  ctx.fillStyle = "#1d4ed8";
  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  ctx.arc(sx(3.9), sz(9.0), pulse + 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#ffffff";
  ctx.font = "800 10px Inter, Arial, sans-serif";
  ctx.fillText(ailleurs.map(k => ETAGES[k].code).join(" "), sx(3.9), sz(9.0));
}
function dessinerPlanNiveau(ctx, W, H, n, avecJoueur) {
  const m = 12;
  const sx = x => m + ((x - LIMITES.minX + 0.5) / (LIMITES.maxX - LIMITES.minX + 1)) * (W - 2 * m);
  const sz = z => m + ((z - LIMITES.minZ + 0.5) / (LIMITES.maxZ - LIMITES.minZ + 1)) * (H - 2 * m);
  const rect = (x1, z1, x2, z2, c) => { ctx.fillStyle = c; ctx.fillRect(sx(x1), sz(z1), sx(x2) - sx(x1), sz(z2) - sz(z1)); };
  const texte = (t, x, z, c = "#475569", taille = 11) => { ctx.fillStyle = c; ctx.font = `700 ${taille}px Inter, Arial, sans-serif`; ctx.fillText(t, sx(x), sz(z)); };
  ctx.clearRect(0, 0, W, H);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  rect(LIMITES.minX, LIMITES.minZ, LIMITES.maxX, LIMITES.maxZ, "#ece9e3");
  ZONES_NIVEAU[n].forEach(z => {
    rect(z.minX + 0.08, z.minZ + 0.08, z.maxX - 0.08, z.maxZ - 0.08, z.couleur);
    if (z.court) texte(z.court, (z.minX + z.maxX) / 2, (z.minZ + z.maxZ) / 2, z.fonce ? "#ffffff" : "#475569", 10);
  });
  rect(1.9, 6.2, 3.36, 11.8, "#78716c");
  texte(EN ? "LIFTS" : "ASC.", 2.6, 9.0, "#ffffff", 9);
  figurants.forEach(f => {
    if (f.etage !== n) return;
    ctx.fillStyle = "#a8a29e";
    ctx.beginPath();
    ctx.arc(sx(f.mesh.position.x), sz(f.mesh.position.z), 2.2, 0, Math.PI * 2);
    ctx.fill();
  });
  employes.forEach(e => {
    if (e.etage !== n || !e.mesh.visible) return;
    ctx.fillStyle = "#475569";
    ctx.beginPath();
    ctx.arc(sx(e.mesh.position.x), sz(e.mesh.position.z), 2.6, 0, Math.PI * 2);
    ctx.fill();
  });
  const pulse = 6 + Math.sin(jeu.temps * 5) * 2;
  marqueursCommuns(ctx, sx, sz, n, pulse);
  if (avecJoueur && joueur.etage === n) dessinerFlecheJoueur(ctx, sx(joueur.x), sz(joueur.z));
}

/* Plan de l'immeuble (touche P) : trois niveaux, lieux et destination */
function lieuxDuPlan(n) {
  if (n === 1) {
    return [
      { label: T("Votre poste (open space)", "Your desk (open space)"), x: POINT_POSTE.x, z: POINT_POSTE.z },
      { label: T("Cafétéria", "Cafeteria"), x: -4.4, z: 5.4 },
      { label: T("Espace détente", "Lounge area"), x: -12.6, z: 7.6 },
      { label: T("Forum Veltis", "Veltis Forum"), x: 8.15, z: 5.0 },
      { label: T("Accueil du plateau", "Floor reception"), x: 8.15, z: 9.2 },
      { label: "Customer Success", x: 16.4, z: 7.6 },
      { label: SALLE.agora.nom, x: SALLE.agora.entree.x, z: SALLE.agora.entree.z },
      { label: SALLE.direction.nom, x: SALLE.direction.entree.x, z: SALLE.direction.entree.z },
      { label: SALLE.dg.nom, x: SALLE.dg.entree.x, z: SALLE.dg.entree.z }
    ].concat(SALLES.filter(s => s.type === "client").map(s => ({ label: s.nom, x: s.entree.x, z: s.entree.z })));
  }
  return ZONES_NIVEAU[n].filter(z => z.acces).map(z => ({ label: z.nom, x: z.acces.x, z: z.acces.z }));
}
function ouvrirPlan() {
  if (!["jeu", "pause"].includes(jeu.mode) || !jeu.def) return;
  const objectifs = objectifsParNiveau();
  const blocs = [2, 1, 0].map(n => {
    const e = ETAGES[n];
    const tags = [];
    if (n === joueur.etage) tags.push(`<span class="plan-tag ici">${T("Vous êtes ici", "You are here")}</span>`);
    if (objectifs[n].mission) tags.push(`<span class="plan-tag mission">${T("Objectif de mission", "Mission objective")}</span>`);
    if (objectifs[n].tache) tags.push(`<span class="plan-tag tache">${T("Tâche", "Task")}</span>`);
    const lieux = lieuxDuPlan(n).map((l, k) => `<button class="btn-secondaire btn-petit plan-lieu${jeu.destination && jeu.destination.etage === n && jeu.destination.label === l.label ? " actif" : ""}" data-niveau="${n}" data-k="${k}">${echapper(l.label)}</button>`).join("");
    return `<section class="plan-niveau">
      <header><span class="plan-code">${e.code}</span><div><strong>${echapper(e.nom)}</strong><small>${echapper(presenceNiveau(n))}</small></div><div class="plan-tags">${tags.join("")}</div></header>
      <div class="plan-corps"><canvas data-plan="${n}" width="440" height="300" aria-label="${echapper(`${e.code} · ${e.nom}`)}"></canvas>
      <div class="plan-lieux"><span class="plan-aide">${T("Choisir une destination :", "Choose a destination:")}</span>${lieux}</div></div>
    </section>`;
  }).join("");
  const cartes = (resultats.reseauExterne || []).map(id => CONTACTS_EXTERNES[id]).filter(Boolean);
  const carnet = cartes.length
    ? `<ul class="carnet">${cartes.map(c => `<li><strong>${echapper(c.nom)}</strong> · ${echapper(c.fonction)}, ${echapper(c.entreprise)}<br><span class="cc-detail">${echapper(c.note)}</span></li>`).join("")}</ul>`
    : `<p class="cc-detail">${T("Aucune carte de visite pour l'instant : les visiteurs du Café du Parvis et du salon d'accueil (RDC) sont des rencontres possibles.", "No business cards yet: visitors at the Café du Parvis and in the visitors' lounge (ground floor) are people you can meet.")}</p>`;
  ouvrirFenetre({
    titre: T("Plan de l'immeuble Veltis", "Veltis building map"),
    sousTitre: T("Esplanade de La Défense · 3 niveaux · ascenseurs au centre de chaque niveau", "Esplanade de La Défense · 3 levels · lifts in the middle of each level"),
    corps: `<div class="plan-immeuble">${blocs}</div>
      <div class="plan-legende"><span><i class="lg-joueur"></i>${T("Vous", "You")}</span><span><i class="lg-collegue"></i>${T("Collègues", "Colleagues")}</span><span><i class="lg-autre"></i>${T("Visiteurs et autres équipes", "Visitors and other teams")}</span><span><i class="lg-mission"></i>${T("Objectif", "Objective")}</span><span><i class="lg-dest"></i>${T("Destination", "Destination")}</span></div>
      <h4>${T("Carnet d'adresses", "Contacts book")} · ${cartes.length}</h4>${carnet}`,
    large: true,
    boutons: [
      { label: T("Effacer la destination", "Clear destination"), action: () => { jeu.destination = null; fermerFenetre(); } },
      { label: T("Fermer", "Close"), classe: "btn-principal", action: fermerFenetre }
    ],
    onOuverture: corps => {
      corps.querySelectorAll("canvas[data-plan]").forEach(c => {
        const n = Number(c.dataset.plan);
        const ctx = c.getContext("2d");
        if (n === 1) dessinerPlanR1(ctx, c.width, c.height, true); else dessinerPlanNiveau(ctx, c.width, c.height, n, true);
      });
      corps.querySelectorAll(".plan-lieu").forEach(b => b.addEventListener("click", () => {
        const n = Number(b.dataset.niveau);
        const l = lieuxDuPlan(n)[Number(b.dataset.k)];
        fermerFenetre();
        definirDestination({ etage: n, x: l.x, z: l.z, label: l.label });
      }));
    }
  });
}

/* ---------- J6. Zones des niveaux (plans, noms des lieux, destinations) ---------- */
const ZONES_NIVEAU = {
  0: [
    { nom: T("Hall des ascenseurs", "Lift lobby"), court: "", minX: 3.36, maxX: 5.3, minZ: 5.5, maxZ: 12.3, couleur: "#d6d3d1" },
    { nom: T("Hall d'accueil", "Main lobby"), court: T("HALL", "LOBBY"), minX: 6.3, maxX: 14.6, minZ: 3.1, maxZ: 12.3, couleur: "#e8e1d4", acces: { x: 10.4, z: 7.6 } },
    { nom: T("Salon des visiteurs", "Visitors' lounge"), court: T("SALON", "LOUNGE"), minX: 14.6, maxX: 19, minZ: 3.1, maxZ: 12.3, couleur: "#ddd3c2", acces: { x: 16.6, z: 9.4 } },
    { nom: T("Showroom Veltis One", "Veltis One showroom"), court: "SHOWROOM", minX: 6.3, maxX: 19, minZ: -12.8, maxZ: 0.8, couleur: "#c7d2fe", acces: { x: 12.6, z: -1.6 } },
    { nom: "Café du Parvis", court: "CAFÉ", minX: -18.6, maxX: -6.6, minZ: 1.4, maxZ: 12.3, couleur: "#e6d6bd", acces: { x: -10.5, z: 5.6 } },
    { nom: T("Auditorium Grande Arche", "Grande Arche auditorium"), court: "AUDITORIUM", minX: -18.6, maxX: -6.6, minZ: -12.8, maxZ: -1.4, couleur: "#cbd5e1", acces: { x: -8.0, z: -4.0 } },
    { nom: "Atrium", court: "ATRIUM", minX: -6.6, maxX: 1.9, minZ: -12.8, maxZ: 12.3, couleur: "#ebe7df", acces: { x: -1.6, z: 2.4 } },
    { nom: T("Galerie", "Gallery"), court: "", minX: 1.9, maxX: 6.3, minZ: -12.8, maxZ: 5.5, couleur: "#ebe7df" },
    { nom: T("Galerie", "Gallery"), court: "", minX: 6.3, maxX: 19, minZ: 0.8, maxZ: 3.1, couleur: "#ebe7df" }
  ],
  2: [
    { nom: T("Hall des ascenseurs", "Lift lobby"), court: "", minX: 3.36, maxX: 6.3, minZ: 5.5, maxZ: 12.3, couleur: "#d6d3d1" },
    { nom: "Le Belvédère", court: T("BELVÉDÈRE", "BELVÉDÈRE"), minX: 6.3, maxX: 19, minZ: 3.6, maxZ: 12.3, couleur: "#e6d6bd", acces: { x: 11.2, z: 8.0 } },
    { nom: "Veltis Lab", court: "LAB", minX: 6.3, maxX: 19, minZ: -12.8, maxZ: -1.6, couleur: "#bae6fd", acces: { x: 12.6, z: -0.6 } },
    { nom: T("Salle du Conseil", "Board Room"), court: T("CONSEIL", "BOARD"), minX: -4.4, maxX: 4.6, minZ: -12.8, maxZ: -6.6, couleur: "#475569", fonce: true, acces: { x: 0.1, z: -5.6 } },
    { nom: "Veltis Academy", court: "ACADEMY", minX: -18.6, maxX: -6.6, minZ: -12.8, maxZ: -2.6, couleur: "#c7d2fe", acces: { x: -12.6, z: -1.7 } },
    { nom: T("Service clients", "Customer Care"), court: T("SERVICE CLIENTS", "CUSTOMER CARE"), minX: -18.6, maxX: -6.6, minZ: -1.4, maxZ: 6.4, couleur: "#d5d9de", acces: { x: -8.2, z: 2.2 } },
    { nom: T("Bibliothèque", "Library"), court: T("BIBLIO.", "LIBRARY"), minX: -18.6, maxX: -6.6, minZ: 7.6, maxZ: 12.3, couleur: "#e2d2b8", acces: { x: -10.0, z: 9.2 } },
    { nom: T("Pôle grands comptes", "Key accounts area"), court: T("GRANDS COMPTES", "KEY ACC."), minX: -1.2, maxX: 1.9, minZ: 2.0, maxZ: 7.4, couleur: "#dbe4f0", acces: { x: -1.6, z: 4.4 } },
    { nom: T("Espace collaboratif", "Collaboration space"), court: "", minX: -6.6, maxX: 1.9, minZ: -6.6, maxZ: 12.3, couleur: "#ebe7df", acces: { x: -2.0, z: -4.4 } },
    { nom: T("Galerie", "Gallery"), court: "", minX: 1.9, maxX: 6.3, minZ: -6.6, maxZ: 5.5, couleur: "#ebe7df" },
    { nom: T("Galerie", "Gallery"), court: "", minX: 6.3, maxX: 19, minZ: -1.6, maxZ: 3.6, couleur: "#ebe7df" }
  ]
};

/* ---------- J7. Enveloppe d'un niveau : sol, façades, plafond, éclairage ---------- */
const materiauVitrageExterieur = new THREE.MeshStandardMaterial({ color: 0x3b4a5a, metalness: 0.75, roughness: 0.12 });
const materiauLedNiveaux = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 3.15, 3.05), toneMapped: false });
let materiauPlafondNiveaux = null;
function facadeVitree(g, x1, z1, x2, z2, h = HAUTEUR_PLAFOND) {
  const vertical = Math.abs(x2 - x1) < 0.01, l = Math.hypot(x2 - x1, z2 - z1);
  if (l < 0.05) return;
  const v = new THREE.Mesh(new THREE.BoxGeometry(vertical ? 0.04 : l, h, vertical ? l : 0.04), materiauVerre);
  v.position.set((x1 + x2) / 2, h / 2, (z1 + z2) / 2);
  g.add(v);
  for (let t = 0; t <= l + 0.01; t += 1.5) g.add(pos(boite(0.07, h, 0.07, 0x1c1c1c), x1 + (x2 - x1) * Math.min(1, t / l), h / 2, z1 + (z2 - z1) * Math.min(1, t / l)));
  g.add(pos(boite(vertical ? 0.1 : l, 0.08, vertical ? l : 0.1, 0x1c1c1c), (x1 + x2) / 2, h - 0.04, (z1 + z2) / 2));
  g.add(pos(boite(vertical ? 0.24 : l, 0.12, vertical ? l : 0.24, 0x2a2724), (x1 + x2) / 2, 0.06, (z1 + z2) / 2));
}
// Allège opaque entre le plafond d'un niveau et le plancher du suivant (vue depuis les fenêtres)
function bandeauNiveau(g) {
  const F = FACADE, h = HAUTEUR_NIVEAU - HAUTEUR_PLAFOND + 0.05, y = HAUTEUR_PLAFOND + h / 2 - 0.02;
  [[(F.minX + F.maxX) / 2, F.minZ - 0.09, F.maxX - F.minX + 0.36, 0.1], [(F.minX + F.maxX) / 2, F.maxZ + 0.09, F.maxX - F.minX + 0.36, 0.1],
    [F.minX - 0.09, (F.minZ + F.maxZ) / 2, 0.1, F.maxZ - F.minZ + 0.36], [F.maxX + 0.09, (F.minZ + F.maxZ) / 2, 0.1, F.maxZ - F.minZ + 0.36]]
    .forEach(([x, z, w, d]) => g.add(pos(boite(w, h, d, 0x2b2a29, false), x, y, z)));
}
function enveloppeNiveau(g, { sol = 0xb2aca3, entree = null, leds = [], lumieres = [] } = {}) {
  const F = FACADE;
  g.add(solTexture(F.minX, F.maxX, F.minZ, F.maxZ, "beton", 0.0, sol));
  facadeVitree(g, F.minX, F.minZ, F.maxX, F.minZ);
  facadeVitree(g, F.minX, F.minZ, F.minX, F.maxZ);
  facadeVitree(g, F.maxX, F.minZ, F.maxX, F.maxZ);
  if (entree) {
    facadeVitree(g, F.minX, F.maxZ, entree.minX, F.maxZ);
    facadeVitree(g, entree.maxX, F.maxZ, F.maxX, F.maxZ);
  } else facadeVitree(g, F.minX, F.maxZ, F.maxX, F.maxZ);
  if (!materiauPlafondNiveaux) materiauPlafondNiveaux = new THREE.MeshStandardMaterial({ map: texture(TEXTURES.plafond, (F.maxX - F.minX) / 1.2, (F.maxZ - F.minZ) / 1.2), color: 0xffffff, roughness: 0.92, emissive: 0x3a3936 });
  const plafond = new THREE.Mesh(new THREE.PlaneGeometry(F.maxX - F.minX, F.maxZ - F.minZ), materiauPlafondNiveaux);
  plafond.rotation.x = Math.PI / 2;
  plafond.position.set((F.minX + F.maxX) / 2, HAUTEUR_PLAFOND, (F.minZ + F.maxZ) / 2);
  plafond.userData.dynamique = true;
  g.add(plafond);
  leds.forEach(([x, z, w, d]) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), materiauLedNiveaux);
    m.rotation.x = Math.PI / 2;
    m.position.set(x, HAUTEUR_PLAFOND - 0.01, z);
    g.add(m);
  });
  // Quatre lumières d'ambiance par niveau (même nombre partout : pas de recompilation des matériaux)
  lumieres.slice(0, 4).forEach(([x, z, c = 0xffe0b5]) => {
    const l = new THREE.PointLight(c, 0.55, 14, 2);
    l.position.set(x, 2.6, z);
    g.add(l);
  });
  [[-4.7, -7.4], [5.0, -7.4], [13.6, -7.4], [-4.7, 4.05], [13.6, 4.8]].forEach(([x, z]) => {
    g.add(pos(cylindre(0.28, 0.28, HAUTEUR_PLAFOND, 0xbdb7ae, 20), x, HAUTEUR_PLAFOND / 2, z));
    obstacleCercle(x, z, 0.3);
  });
  bandeauNiveau(g);
}

/* ---------- J8. Mobilier des niveaux RDC et R+2 ---------- */
function comptoir(g, x, z, longueur, vertical, { corps = 0xe7e2da, plateau = 0x57534e, h = 1.05, p = 0.6 } = {}) {
  const w = vertical ? p : longueur, d = vertical ? longueur : p;
  g.add(pos(boite(w, h, d, corps), x, h / 2, z));
  g.add(pos(boite(w + 0.06, 0.05, d + 0.06, plateau), x, h + 0.02, z));
  obstacleBoite(x, z, w / 2 + 0.03, d / 2 + 0.03);
}
function enseigne(g, x, y, z, a, w, h, lignes, fond = "#0f172a") {
  const p = panneauTexte(w, h, { largeur: Math.round(w * 220), hauteur: Math.round(h * 220), fond, lignes });
  p.rotation.y = a;
  p.position.set(x, y, z);
  g.add(p);
  return p;
}
function tableBistrot(g, x, z, couleur = 0xd6cfc4) {
  g.add(pos(cylindre(0.36, 0.36, 0.04, couleur, 18), x, 0.74, z));
  g.add(pos(cylindre(0.04, 0.04, 0.72, 0x374151, 8), x, 0.37, z));
  g.add(pos(cylindre(0.22, 0.22, 0.03, 0x374151, 14), x, 0.02, z));
  g.add(pos(cylindre(0.045, 0.04, 0.1, 0xf8fafc, 8), x + 0.1, 0.81, z + 0.06));
  creerChaise(g, x - 0.58, z, O / 2, 0x57534e);
  creerChaise(g, x + 0.58, z, -O / 2, 0x57534e);
  obstacleCercle(x, z, 0.4);
}
const placesBistrot = (x, z) => [{ x: x - 0.58, z, a: O / 2, pose: "assis" }, { x: x + 0.58, z, a: -O / 2, pose: "assis" }];
function fauteuil(g, x, z, a, couleur = 0x7c2d12) {
  const c = new THREE.Group();
  c.add(pos(boite(0.8, 0.42, 0.78, couleur), 0, 0.21, 0));
  c.add(pos(boite(0.8, 0.5, 0.16, couleur), 0, 0.62, -0.31));
  [-1, 1].forEach(s => c.add(pos(boite(0.14, 0.58, 0.78, couleur), s * 0.38, 0.29, 0)));
  c.rotation.y = a;
  g.add(pos(c, x, 0, z));
  obstacleCercle(x, z, 0.42);
}
function borne(g, x, z, titre, sous) {
  g.add(pos(boite(0.55, 1.0, 0.4, 0x1f2937), x, 0.5, z));
  g.add(pos(boite(0.6, 0.04, 0.45, 0x9ca3af), x, 1.02, z));
  const e = panneauTexte(0.62, 0.42, { largeur: 248, hauteur: 168, fond: "#0b1f3a", bandeau: "#1d4ed8", lignes: [{ texte: titre, taille: 26, gras: 800, couleur: "#ffffff" }, { texte: sous, taille: 17, gras: 500, couleur: "#93c5fd" }], y: 52 });
  e.rotation.x = -0.5;
  e.position.set(x, 1.22, z + 0.06);
  g.add(e);
  obstacleBoite(x, z, 0.3, 0.22);
}
function banc(g, x, z, vertical, longueur = 1.8) {
  g.add(pos(boite(vertical ? 0.5 : longueur, 0.08, vertical ? longueur : 0.5, 0xb59b7c), x, 0.45, z));
  [-1, 1].forEach(s => g.add(pos(boite(vertical ? 0.42 : 0.08, 0.42, vertical ? 0.08 : 0.42, 0x374151), x + (vertical ? 0 : s * (longueur / 2 - 0.15)), 0.21, z + (vertical ? s * (longueur / 2 - 0.15) : 0))));
  obstacleBoite(x, z, vertical ? 0.26 : longueur / 2, vertical ? longueur / 2 : 0.26);
}
function rangeeChaises(g, x1, x2, z, a, couleur = 0x334155) {
  for (let x = x1; x <= x2 + 0.01; x += 0.95) creerChaise(g, x, z, a, couleur);
  obstacleBoite((x1 + x2) / 2, z, (x2 - x1) / 2 + 0.25, 0.26);
}
// Portiques de contrôle d'accès (RDC) : volets vitrés qui s'ouvrent au passage
const materiauVolet = new THREE.MeshStandardMaterial({ color: 0xbfd6e6, metalness: 0.1, roughness: 0.05, transparent: true, opacity: 0.45 });
const portiques = [];
const portesEntree = { gauche: null, droite: null, ouverture: 0 };
function creerPortiques(g) {
  [[5.55, 6.75], [7.65, 8.55], [9.45, 10.35], [11.25, 12.3]].forEach(([a, b]) => {
    g.add(pos(boite(1.0, 1.0, b - a, 0xa8adb3), 5.8, 0.5, (a + b) / 2));
    g.add(pos(boite(1.02, 0.03, b - a + 0.02, 0x111827), 5.8, 1.015, (a + b) / 2));
    obstacleBoite(5.8, (a + b) / 2, 0.5, (b - a) / 2);
  });
  CABINES.forEach(zc => {
    [-1, 1].forEach(s => {
      const lecteur = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.08), materiauVoyant);
      lecteur.rotation.x = -Math.PI / 2;
      lecteur.position.set(6.1, 1.035, zc + s * 0.55);
      g.add(lecteur);
    });
    const pivots = [-1, 1].map(s => {
      const piv = new THREE.Group();
      piv.position.set(5.8, 0, zc + s * 0.45);
      const volet = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.8, 0.43), materiauVolet);
      volet.position.set(0, 0.62, -s * 0.215);
      volet.userData.dynamique = true;
      piv.add(volet);
      g.add(piv);
      return { piv, s };
    });
    portiques.push({ zc, pivots, ouverture: 0, ouvert: false });
  });
}
function majPortiques(dt) {
  if (joueur.etage !== 0) return;
  const proches = [{ x: joueur.x, z: joueur.z, joueur: true }].concat(figurants.filter(f => f.etage === 0).map(f => f.mesh.position));
  portiques.forEach(p => {
    const ouvrir = proches.some(q => Math.abs(q.x - 5.8) < 1.25 && Math.abs(q.z - p.zc) < 0.5);
    if (ouvrir && !p.ouvert && Math.abs(joueur.x - 5.8) < 1.25 && Math.abs(joueur.z - p.zc) < 0.5) son("badge");
    p.ouvert = ouvrir;
    p.ouverture = clamp(p.ouverture + (ouvrir ? dt : -dt) * 3.2, 0, 1);
    p.pivots.forEach(({ piv, s }) => { piv.rotation.y = -s * lisser(p.ouverture) * 1.45; });
  });
  if (portesEntree.gauche) {
    const pres = proches.some(q => Math.abs(q.x - 10.2) < 1.8 && q.z > 9.6);
    portesEntree.ouverture = clamp(portesEntree.ouverture + (pres ? dt : -dt) * 1.6, 0, 1);
    const k = lisser(portesEntree.ouverture) * 0.95;
    portesEntree.gauche.position.x = 9.7 - k;
    portesEntree.droite.position.x = 10.7 + k;
  }
}

/* ---------- J9. RDC : hall, accueil, café, showroom, auditorium ---------- */
function construireRDC(g) {
  enveloppeNiveau(g, {
    sol: 0xa9a39a, entree: { minX: 9.2, maxX: 11.2 },
    leds: [[10.4, 8.4, 6, 0.12], [-12.6, 7.0, 0.12, 9], [12.6, -6.0, 9, 0.12], [-12.6, -7.0, 8, 0.12], [-2.4, 0, 0.12, 22], [16.8, 8.0, 0.6, 0.6], [4.4, 9.0, 0.12, 5.5]],
    lumieres: [[10.4, 8.0], [-12.6, 7.0], [12.6, -6.0], [-12.6, -7.0, 0xdbe4ff]]
  });
  // Sols : terrazzo dans le hall et l'atrium, parquet au café, moquette à l'auditorium
  g.add(solTexture(-6.6, 19, 0.8, 12.3, "terrazzo", 0.012));
  g.add(solTexture(-6.6, 1.9, -12.8, 0.8, "terrazzo", 0.012));
  g.add(solTexture(-18.6, -6.6, 1.4, 12.3, "parquet", 0.014));
  g.add(solTexture(-18.6, -6.6, -12.8, -1.4, "moquette", 0.014, 0x5b6476));
  g.add(solTexture(6.3, 19, -12.8, 0.8, "beton", 0.012, 0x77726b));
  g.add(dalle(9.0, 11.4, 11.0, 12.3, 0x3f3a35, 0.02));
  creerAscenseurs(g, 0);

  // Hall des ascenseurs fermé par une cloison vitrée et la ligne de portiques
  murVitre(g, 1.98, 5.5, 6.3, 5.5);
  creerPortiques(g);
  // Entrée principale : portes automatiques sur l'esplanade
  [-1, 1].forEach(s => {
    const v = new THREE.Mesh(new THREE.BoxGeometry(1.0, 2.6, 0.04), materiauVerre);
    v.position.set(10.2 + s * 0.5, 1.3, FACADE.maxZ);
    v.userData.dynamique = true;
    g.add(v);
    if (s < 0) portesEntree.gauche = v; else portesEntree.droite = v;
  });
  g.add(pos(boite(2.2, 0.35, 0.3, 0x1c1c1c), 10.2, 2.83, FACADE.maxZ));
  enseigne(g, 10.2, 2.83, FACADE.maxZ - 0.17, O, 1.6, 0.26, [{ texte: T("ENTRÉE · ESPLANADE", "ENTRANCE · ESPLANADE"), taille: 30, gras: 800, couleur: "#ffffff" }]);

  // Accueil : banque, mur de marque, écran d'actualités
  comptoir(g, 10.4, 6.1, 3.4, false, { corps: 0xe7e2da, plateau: 0x57534e });
  g.add(pos(boite(0.6, 0.36, 0.04, 0x111827), 9.6, 1.3, 5.95));
  g.add(pos(boite(0.6, 0.36, 0.04, 0x111827), 11.2, 1.3, 5.95));
  enseigne(g, 10.4, 0.6, 6.42, 0, 1.8, 0.3, [{ texte: "VELTIS · ACCUEIL", taille: 30, gras: 800, couleur: "#ffffff" }]);
  g.add(pos(boite(7.0, HAUTEUR_PLAFOND, 0.22, 0x4a4540), 10.4, HAUTEUR_PLAFOND / 2, 3.0));
  obstacleBoite(10.4, 3.0, 3.5, 0.13);
  panneauMarque(g, 9.0, 1.95, 3.12, 0, 2.6, 1.0);
  planteEn(g, 7.0, 4.0, true);
  planteEn(g, 13.9, 11.8, true);
  planteEn(g, 6.8, 11.8);
  // Agent de sûreté : pupitre près des portiques
  comptoir(g, 7.0, 6.4, 0.7, true, { corps: 0x4b5563, plateau: 0x1f2937, h: 1.0, p: 0.45 });

  // Salon des visiteurs
  creerCanape(g, 17.9, 7.6, -O / 2, 0x334155);
  creerCanape(g, 15.3, 7.6, O / 2, 0x334155);
  creerTableBasse(g, 16.6, 7.6);
  creerCanape(g, 16.6, 11.0, O, 0x475569);
  fauteuil(g, 15.2, 4.6, 0, 0x7c2d12);
  fauteuil(g, 16.6, 4.6, 0, 0x7c2d12);
  planteEn(g, 18.5, 4.0, true);
  planteEn(g, 15.0, 11.8);
  enseigne(g, 18.95, 1.7, 9.5, -O / 2, 1.7, 0.95, [{ texte: T("BIENVENUE", "WELCOME"), taille: 44, gras: 800, couleur: "#ffffff" }, { texte: T("Merci de vous présenter à l'accueil", "Please check in at reception"), taille: 20, gras: 500, couleur: "#cbd5e1" }]);

  // Showroom Veltis One : bornes de démonstration, table de démo, mur LED
  murVitre(g, 6.3, -12.8, 6.3, 0.8);
  murAvecPorte(g, 6.3, 0.8, 19, 0.8, 12.6, 1.9);
  [[8.8, -9.2, "PIPELINE", T("Prévisions en temps réel", "Real-time forecasts")], [12.6, -10.2, T("DEVIS", "QUOTES"), T("Relances automatiques", "Automatic follow-ups")],
    [16.4, -9.2, T("FACTURATION", "INVOICING"), T("Du devis à l'encaissement", "From quote to cash")], [8.8, -4.6, "REPORTING", T("Tableaux de bord", "Dashboards")],
    [16.4, -4.6, "MOBILE", T("En rendez-vous", "In meetings")]].forEach(([x, z, t, s]) => borne(g, x, z, t, s));
  creerTableReunion(g, 12.6, -4.4, 2.4, 1.1, []);
  [[11.9, -4.45], [13.3, -4.45]].forEach(([x, z]) => { g.add(pos(boite(0.36, 0.02, 0.26, 0x374151), x, 0.8, z)); const e = boite(0.36, 0.24, 0.02, 0x111827); e.rotation.x = -0.25; g.add(pos(e, x, 0.92, z - 0.13)); });
  enseigne(g, 6.38, 1.75, -6.0, O / 2, 3.4, 1.6, [{ texte: "VELTIS ONE", taille: 92, gras: 800, couleur: "#ffffff" }, { texte: T("La gestion commerciale des PME et ETI", "Sales management for SMEs and mid-caps"), taille: 30, gras: 500, couleur: "#93c5fd" }, { texte: T("Pipeline · Devis · Facturation · Reporting", "Pipeline · Quotes · Invoicing · Reporting"), taille: 24, gras: 600, couleur: "#fdba74" }], "#0b1f3a");
  enseigne(g, 12.6 + 1.8, 2.3, 0.86, 0, 1.6, 0.34, [{ texte: "SHOWROOM", taille: 32, gras: 800, couleur: "#ffffff" }, { texte: "Veltis One", taille: 18, gras: 500, couleur: "#cbd5e1" }]);
  planteEn(g, 18.4, -12.2, true);
  planteEn(g, 7.0, -12.2, true);

  // Café du Parvis : comptoir, vitrine, tables bistrot, ardoise
  comptoir(g, -16.8, 5.6, 5.2, true, { corps: 0x6b4f3a, plateau: 0x2a2724, h: 1.05, p: 0.65 });
  g.add(pos(boite(0.5, 0.4, 1.2, 0xe5e7eb), -16.8, 1.28, 4.0));
  g.add(pos(boite(0.46, 0.5, 0.46, 0x1f2937), -16.8, 1.33, 6.6));
  g.add(pos(boite(0.62, 1.9, 2.0, 0x4a4540), -18.3, 0.95, 5.6));
  enseigne(g, -17.98, 2.2, 5.6, O / 2, 1.8, 0.9, [{ texte: "CAFÉ DU PARVIS", taille: 36, gras: 800, couleur: "#fde68a" }, { texte: T("Espresso 1,80 · Cappuccino 2,90", "Espresso €1.80 · Cappuccino €2.90"), taille: 20, gras: 500, couleur: "#e7e5e4" }, { texte: T("Viennoiseries · Salades · Wraps", "Pastries · Salads · Wraps"), taille: 20, gras: 500, couleur: "#e7e5e4" }], "#1c1917");
  TABLES_CAFE_RDC.forEach(([x, z]) => tableBistrot(g, x, z));
  creerCanape(g, -12.0, 11.7, O, 0x7c2d12);
  planteEn(g, -7.2, 2.0, true);
  planteEn(g, -7.2, 11.8, true);
  planteEn(g, -18.2, 11.8);

  // Auditorium Grande Arche : scène, écran, rangées de fauteuils
  murAvecPorte(g, -6.6, -12.8, -6.6, -1.4, -4.0, 1.6);
  murVitre(g, -18.6, -1.4, -6.6, -1.4);
  g.add(pos(boite(11.6, 0.25, 2.2, 0x2a2724), -12.6, 0.125, -11.6));
  obstacleBoite(-12.6, -11.6, 5.8, 1.1);
  enseigne(g, -12.6, 1.9, -12.6, 0, 4.4, 1.6, [{ texte: "KEYNOTE VELTIS", taille: 84, gras: 800, couleur: "#ffffff" }, { texte: T("Du prospect au client : la valeur vie client", "From prospect to customer: customer lifetime value"), taille: 30, gras: 500, couleur: "#fdba74" }], "#0b1f3a");
  g.add(pos(boite(0.6, 1.1, 0.5, 0x374151), -9.6, 0.8, -10.9));
  RANGEES_AUDITORIUM.forEach(z => rangeeChaises(g, -16.4, -8.8, z, O));
  enseigne(g, -6.54, 2.25, -6.0, O / 2, 1.7, 0.36, [{ texte: "AUDITORIUM", taille: 32, gras: 800, couleur: "#ffffff" }, { texte: "Grande Arche · 120 places", taille: 18, gras: 500, couleur: "#cbd5e1" }]);

  // Atrium : bancs, grandes plantes, totem du plan de l'immeuble, tables hautes
  banc(g, -2.6, 7.8, true);
  banc(g, -2.6, -9.6, true);
  creerTableHaute(g, -2.4, -2.4);
  creerTableHaute(g, -2.4, 0.9);
  planteEn(g, -0.2, 11.8, true);
  planteEn(g, -6.0, -12.2, true);
  planteEn(g, 1.3, -12.2, true);
  g.add(pos(boite(0.5, 2.0, 0.16, 0x1f2937), 1.2, 1.0, 4.2));
  obstacleBoite(1.2, 4.2, 0.28, 0.12);
  enseigne(g, 1.2, 1.25, 4.29, 0, 0.44, 1.5, [{ texte: "VELTIS", taille: 26, gras: 800, couleur: "#ffffff" }, { texte: ETAGES[2].code, taille: 22, gras: 700, couleur: "#fdba74" }, { texte: "Academy", taille: 15, gras: 500, couleur: "#cbd5e1" }, { texte: ETAGES[1].code, taille: 22, gras: 700, couleur: "#fdba74" }, { texte: T("Commercial", "Sales"), taille: 15, gras: 500, couleur: "#cbd5e1" }, { texte: ETAGES[0].code, taille: 22, gras: 700, couleur: "#fdba74" }, { texte: T("Hall", "Lobby"), taille: 15, gras: 500, couleur: "#cbd5e1" }]);
}
const TABLES_CAFE_RDC = [[-14.2, 3.4], [-11.6, 3.4], [-9.0, 3.4], [-14.2, 6.4], [-11.6, 6.4], [-9.0, 6.4], [-14.2, 9.4], [-11.6, 9.4], [-9.0, 9.4]];
const RANGEES_AUDITORIUM = [-8.8, -7.4, -6.0, -4.6, -3.2];

/* ---------- J10. R+2 : Academy, Conseil, Service clients, Lab, Belvédère ---------- */
const DESKS_SERVICE = [[-15.6, 0.4], [-12.6, 0.4], [-9.6, 0.4], [-15.6, 3.6], [-12.6, 3.6], [-9.6, 3.6]];
const TABLES_ACADEMY = [[-15.4, -9.2], [-9.8, -9.2], [-15.4, -7.0], [-9.8, -7.0], [-15.4, -4.8], [-9.8, -4.8]];
function construireR2(g) {
  enveloppeNiveau(g, {
    sol: 0xb2aca3,
    leds: [[-12.6, -7.0, 8, 0.12], [0.1, -9.6, 6, 0.12], [-12.6, 2.0, 8, 0.12], [12.6, -7.0, 9, 0.12], [12.6, 8.0, 10, 0.12], [-2.4, 3.0, 0.12, 16], [4.4, 9.0, 0.12, 5.5]],
    lumieres: [[12.6, 8.0], [-12.6, -7.0, 0xdbe4ff], [0.1, -9.6], [-12.0, 9.6]]
  });
  g.add(solTexture(-6.6, 19, -1.6, 12.3, "parquet", 0.014));
  g.add(solTexture(-18.6, -6.6, -12.8, -2.6, "moquette", 0.014, 0x56637a));
  g.add(solTexture(-18.6, -6.6, -1.4, 6.4, "moquette", 0.014, 0x7a828e));
  g.add(solTexture(-18.6, -6.6, 7.6, 12.3, "parquet", 0.014));
  g.add(solTexture(-4.4, 4.6, -12.8, -6.6, "moquette", 0.016, 0x4b5563));
  g.add(solTexture(6.3, 19, -12.8, -1.6, "beton", 0.014, 0x9c968c));
  creerAscenseurs(g, 2);

  // Veltis Academy : salle de formation vitrée
  murAvecPorte(g, -18.6, -2.6, -6.6, -2.6, -12.6, 1.6);
  murVitre(g, -6.6, -12.8, -6.6, -2.6);
  g.add(pos(boite(3.2, 1.8, 0.08, 0x111827), -12.6, 1.55, -12.25));
  g.add(pos(boite(0.1, 0.6, 0.1, 0x6b7280), -12.6, 0.3, -12.25));
  obstacleBoite(-12.6, -12.25, 1.65, 0.12);
  enseigne(g, -12.6, 1.6, -12.2, 0, 3.0, 1.6, [{ texte: "VELTIS ACADEMY", taille: 70, gras: 800, couleur: "#ffffff" }, { texte: T("Formation flash : du prospect au client", "Quick course: from prospect to customer"), taille: 28, gras: 500, couleur: "#93c5fd" }, { texte: T("Tunnel · BANT · SPIN · CLV", "Funnel · BANT · SPIN · CLV"), taille: 26, gras: 600, couleur: "#fdba74" }], "#0b1f3a");
  TABLES_ACADEMY.forEach(([x, z]) => creerTableReunion(g, x, z, 2.4, 0.7, [[x - 0.6, z + 0.6, O], [x + 0.6, z + 0.6, O]]));
  creerEtagere(g, -18.3, -8.0, O / 2, 2.4);
  enseigne(g, -6.54, 2.25, -9.0, O / 2, 1.7, 0.36, [{ texte: "VELTIS ACADEMY", taille: 30, gras: 800, couleur: "#ffffff" }, { texte: T("Formation des équipes", "Team training"), taille: 18, gras: 500, couleur: "#cbd5e1" }]);

  // Salle du Conseil
  murVitre(g, -4.4, -12.8, -4.4, -6.6);
  murVitre(g, 4.6, -12.8, 4.6, -6.6);
  murAvecPorte(g, -4.4, -6.6, 4.6, -6.6, 0.1, 1.5);
  const sieges = [];
  [-1.9, -0.9, 0.1, 1.1, 2.1].forEach(x => { sieges.push([x, -10.95, 0]); sieges.push([x, -8.65, O]); });
  creerTableReunion(g, 0.1, -9.8, 5.2, 1.5, sieges);
  creerEcranMural(g, 4.52, -9.8, -O / 2, [{ texte: T("COMITÉ DE DIRECTION", "LEADERSHIP COMMITTEE"), taille: 28, gras: 800, couleur: "#ffffff" }, { texte: "ARR · Churn · NPS · CLV", taille: 22, gras: 500, couleur: "#94a3b8" }]);
  planteEn(g, -3.9, -12.2);
  enseigne(g, 1.8, 2.25, -6.54, 0, 1.6, 0.36, [{ texte: T("SALLE DU CONSEIL", "BOARD ROOM"), taille: 30, gras: 800, couleur: "#ffffff" }, { texte: T("Direction générale", "Executive team"), taille: 18, gras: 500, couleur: "#cbd5e1" }]);

  // Service clients : open space, écran de satisfaction
  DESKS_SERVICE.forEach(([x, z]) => creerBureau(g, x, z, T("Tickets clients", "Customer tickets")));
  g.add(pos(boite(2.4, 1.3, 0.08, 0x111827), -18.2, 1.6, 2.0));
  enseigne(g, -18.12, 1.6, 2.0, O / 2, 2.3, 1.2, [{ texte: T("SATISFACTION CLIENTS", "CUSTOMER SATISFACTION"), taille: 30, gras: 800, couleur: "#ffffff" }, { texte: "NPS 47 · CSAT 92 %", taille: 34, gras: 800, couleur: "#86efac" }, { texte: T("Délai de réponse : 2 h 10", "Response time: 2 h 10"), taille: 22, gras: 500, couleur: "#cbd5e1" }]);
  obstacleBoite(-18.2, 2.0, 0.1, 1.2);
  enseigne(g, -12.6, 2.7, 6.3, O, 2.8, 0.38, [{ texte: T("SERVICE CLIENTS · CUSTOMER CARE", "CUSTOMER CARE"), taille: 28, gras: 700, couleur: "#ffffff" }]);
  planteEn(g, -7.1, -0.9, true);

  // Bibliothèque et salle calme
  creerEtagere(g, -15.6, 12.0, O, 2.4);
  creerEtagere(g, -12.6, 12.0, O, 2.4);
  creerEtagere(g, -9.6, 12.0, O, 2.4);
  fauteuil(g, -15.0, 9.2, O / 2, 0x0f766e);
  fauteuil(g, -12.6, 8.6, 0, 0x0f766e);
  fauteuil(g, -10.0, 9.2, -O / 2, 0x0f766e);
  creerTableBasse(g, -12.6, 9.8);
  planteEn(g, -18.2, 8.0);

  // Pôle grands comptes : deux commerciaux de l'équipe
  creerBureau(g, 0.2, 3.0, T("Prévisionnel", "Forecast"));
  creerBureau(g, 0.2, 5.8, T("Grands comptes", "Key accounts"));
  enseigne(g, 1.85, 2.4, 4.4, -O / 2, 2.0, 0.38, [{ texte: T("PÔLE GRANDS COMPTES", "KEY ACCOUNTS"), taille: 28, gras: 800, couleur: "#ffffff" }, { texte: T("Équipe commerciale", "Sales team"), taille: 18, gras: 500, couleur: "#cbd5e1" }]);
  // Espace collaboratif : tables hautes, mur de la valeur client
  creerTableHaute(g, -3.2, 2.0);
  creerTableHaute(g, -3.2, 6.0);
  creerTableHaute(g, 0.4, 9.6);
  creerTableau(g, -2.0, -5.7, 0, [
    { texte: T("MUR DE LA VALEUR CLIENT", "CUSTOMER VALUE WALL"), taille: 30, gras: 800 },
    { texte: T("CLV = ARR × marge × durée de vie", "CLV = ARR × margin × lifetime"), taille: 24, gras: 600, couleur: "#1e3a8a" },
    { texte: T("Classement de l'équipe par CLV signée", "Team ranking by signed CLV"), taille: 22, gras: 500, couleur: "#475569" }
  ]);
  planteEn(g, -6.0, 11.8, true);
  planteEn(g, 1.3, -6.0, true);

  // Veltis Lab : innovation produit
  murVitre(g, 6.3, -12.8, 6.3, -1.6);
  murAvecPorte(g, 6.3, -1.6, 19, -1.6, 12.6, 1.8);
  creerTableau(g, 12.6, -12.2, 0, [
    { texte: T("FEUILLE DE ROUTE VELTIS ONE", "VELTIS ONE ROADMAP"), taille: 28, gras: 800 },
    { texte: T("T3 : connecteur e-commerce", "Q3: e-commerce connector"), taille: 22, gras: 600, couleur: "#1e3a8a" },
    { texte: T("T4 : prévisions assistées · à confirmer", "Q4: assisted forecasting · to be confirmed"), taille: 22, gras: 600, couleur: "#b45309" }
  ]);
  creerTableReunion(g, 9.6, -7.0, 2.4, 1.2, [[9.0, -6.1, O], [10.2, -6.1, O]]);
  creerTableReunion(g, 15.6, -7.0, 2.4, 1.2, [[15.0, -6.1, O], [16.2, -6.1, O]]);
  [[9.2, -7.05], [10.0, -7.05], [15.2, -7.05], [16.0, -7.05]].forEach(([x, z]) => { g.add(pos(boite(0.34, 0.02, 0.24, 0x374151), x, 0.8, z)); const e = boite(0.34, 0.22, 0.02, 0x111827); e.rotation.x = -0.25; g.add(pos(e, x, 0.91, z - 0.12)); });
  g.add(pos(boite(1.9, 1.05, 0.08, 0x111827), 18.9, 1.6, -7.0));
  enseigne(g, 18.84, 1.6, -7.0, -O / 2, 1.8, 1.0, [{ texte: "VELTIS LAB", taille: 50, gras: 800, couleur: "#ffffff" }, { texte: T("Prototypes et tests clients", "Prototypes and customer testing"), taille: 22, gras: 500, couleur: "#93c5fd" }]);
  planteEn(g, 7.0, -12.2, true);
  enseigne(g, 14.4, 2.3, -1.54, 0, 1.5, 0.34, [{ texte: "VELTIS LAB", taille: 32, gras: 800, couleur: "#ffffff" }, { texte: T("Innovation produit", "Product innovation"), taille: 18, gras: 500, couleur: "#cbd5e1" }]);

  // Le Belvédère : lounge panoramique, bar libre-service, canapés, tables hautes
  comptoir(g, 17.9, 8.0, 4.0, true, { corps: 0x2a2724, plateau: 0xd6cfc4, h: 1.05, p: 0.6 });
  g.add(pos(boite(0.45, 0.55, 0.45, 0x1f2937), 17.9, 1.35, 7.0));
  creerCanape(g, 9.4, 7.4, O / 2, 0x475569);
  creerCanape(g, 12.4, 7.4, -O / 2, 0x475569);
  creerTableBasse(g, 10.9, 7.4);
  creerCanape(g, 10.9, 11.0, O, 0x7c2d12);
  creerTableHaute(g, 14.6, 10.6);
  creerTableHaute(g, 14.6, 5.4);
  fauteuil(g, 8.0, 10.6, O / 2 + 0.4, 0x334155);
  planteEn(g, 18.5, 4.2, true);
  planteEn(g, 7.0, 4.4, true);
  planteEn(g, 18.5, 11.8, true);
  enseigne(g, 12.6, 2.7, 3.64, O, 2.4, 0.4, [{ texte: "LE BELVÉDÈRE", taille: 34, gras: 800, couleur: "#ffffff" }, { texte: T("Lounge panoramique", "Panoramic lounge"), taille: 18, gras: 500, couleur: "#cbd5e1" }]);
}

function construireNiveaux() {
  [[0, construireRDC], [2, construireR2]].forEach(([n, construire]) => {
    obstaclesConstruction = ETAGES[n].obstacles;
    const g = new THREE.Group();
    construire(g);
    ETAGES[n].groupe.add(g);
  });
  obstaclesConstruction = obstacles;
}
function construireNavigations() {
  construireNavigation();
  [0, 2].forEach(n => construireNavigation(ETAGES[n].nav, ETAGES[n].obstacles));
}

/* ---------- J11. Extérieur : enveloppe vitrée des autres niveaux, esplanade, passants ---------- */
function construireCoques() {
  const F = FACADE, d = 0.17, h = HAUTEUR_PLAFOND;
  ETAGES.forEach((e, n) => {
    const c = new THREE.Group();
    const y = e.y + h / 2;
    [[(F.minX + F.maxX) / 2, F.minZ - d, F.maxX - F.minX + 2 * d, 0.04], [(F.minX + F.maxX) / 2, F.maxZ + d, F.maxX - F.minX + 2 * d, 0.04],
      [F.minX - d, (F.minZ + F.maxZ) / 2, 0.04, F.maxZ - F.minZ + 2 * d], [F.maxX + d, (F.minZ + F.maxZ) / 2, 0.04, F.maxZ - F.minZ + 2 * d]]
      .forEach(([x, z, w, p]) => c.add(pos(maillage(new THREE.BoxGeometry(w, h, p), materiauVitrageExterieur, false), x, y, z)));
    // Allège opaque entre ce niveau et le suivant
    const hb = HAUTEUR_NIVEAU - h, yb = e.y + h + hb / 2;
    [[(F.minX + F.maxX) / 2, F.minZ - d, F.maxX - F.minX + 2 * d + 0.1, 0.08], [(F.minX + F.maxX) / 2, F.maxZ + d, F.maxX - F.minX + 2 * d + 0.1, 0.08],
      [F.minX - d, (F.minZ + F.maxZ) / 2, 0.08, F.maxZ - F.minZ + 2 * d + 0.1], [F.maxX + d, (F.minZ + F.maxZ) / 2, 0.08, F.maxZ - F.minZ + 2 * d + 0.1]]
      .forEach(([x, z, w, p]) => c.add(pos(boite(w, hb, p, 0x2b2a29, false), x, yb, z)));
    for (let x = F.minX; x <= F.maxX + 0.01; x += 1.5) [F.minZ - d - 0.04, F.maxZ + d + 0.04].forEach(z => c.add(pos(boite(0.08, h, 0.06, 0x1c1c1c, false), x, y, z)));
    for (let z = F.minZ; z <= F.maxZ + 0.01; z += 1.5) [F.minX - d - 0.04, F.maxX + d + 0.04].forEach(x => c.add(pos(boite(0.06, h, 0.08, 0x1c1c1c, false), x, y, z)));
    c.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
    fusionnerEnfants(c);
    c.traverse(o => { if (o.isMesh) o.castShadow = false; });
    c.visible = n !== joueur.etage;
    scene.add(c);
    immeuble.coques.push(c);
  });
}
function arbre(v, x, z, k = 1) {
  v.add(pos(boite(2.0, 0.5, 2.0, 0x6b665e, false), x, 0.25, z));
  v.add(pos(cylindre(0.14 * k, 0.2 * k, 3.2 * k, 0x4a3b2c, 8), x, 1.6 * k + 0.4, z));
  [[0, 3.9, 0, 1.6], [0.7, 3.4, 0.4, 1.2], [-0.6, 3.5, -0.4, 1.25], [0.1, 4.6, -0.2, 1.1]].forEach(([dx, y, dz, r], i) =>
    v.add(pos(sphere(r * k, [0x4d6b3a, 0x5b7a43, 0x456236, 0x617f45][i], 12), x + dx * k, y * k + 0.3, z + dz * k)));
}
function construireParvis(v) {
  // Dalles de l'esplanade autour de l'immeuble et allée vers la Grande Arche
  v.add(solTexture(-90, 90, -60, 60, "beton", 0.02, 0x8f8a82));
  v.add(solTexture(-9, 9, -175, -60, "beton", 0.025, 0xa39d93));
  [-28, 28].forEach(x => { for (let z = -36; z <= 36; z += 12) arbre(v, x, z, 1 + hasard(x, z) * 0.25); });
  for (let x = -20; x <= 20; x += 10) if (Math.abs(x - 10) > 4) arbre(v, x, 24, 0.95);
  for (let x = -20; x <= 20; x += 10) arbre(v, x, -24, 1);
  [[-14, 21.5], [2, 21.5], [-14, -21.5], [6, -21.5]].forEach(([x, z]) => {
    v.add(pos(boite(2.2, 0.1, 0.55, 0xb59b7c, false), x, 0.46, z));
    v.add(pos(boite(2.0, 0.42, 0.4, 0x374151, false), x, 0.21, z));
  });
  for (let x = -36; x <= 36; x += 16) [-20.5, 21].forEach(z => {
    v.add(pos(cylindre(0.07, 0.09, 4.6, 0x2a2724, 8), x, 2.3, z));
    v.add(pos(boite(0.5, 0.12, 0.5, 0x1f2937, false), x, 4.62, z));
  });
  // Auvent de l'entrée principale
  v.add(pos(boite(5.0, 0.2, 3.0, 0x2a2724, false), 10.2, 3.35, 14.4));
  [-2.3, 2.3].forEach(dx => v.add(pos(cylindre(0.06, 0.06, 3.3, 0x1c1c1c, 8), 10.2 + dx, 1.65, 15.7)));
}
const passants = [];
function construirePassants() {
  const g = new THREE.Group();
  g.position.y = NIVEAU_SOL;
  scene.add(g);
  const lignes = [[[-44, 17], [44, 17]], [[44, 19.5], [-44, 19.5]], [[-23.5, -44], [-23.5, 44]], [[23.5, 44], [23.5, -44]], [[-44, -18], [44, -18]], [[-60, 32], [60, 32]], [[5, 17.5], [10.2, 13.6]], [[-44, -18.8], [30, -18.8]]];
  const hauts = [0x7c2d12, 0x1e3a8a, 0x3f6212, 0x57534e, 0x9f1239];
  lignes.forEach((l, i) => {
    const mesh = creerPersonnage(Object.assign({}, APPARENCES[(i * 3) % APPARENCES.length], { genre: i % 2 ? "f" : "h", variante: 300 + i * 13, tenue: i % 3 === 0 ? "ville" : "costume", haut: hauts[i % hauts.length], bas: 0x1f2937, mallette: i % 4 === 1 }));
    g.add(mesh);
    passants.push({ mesh, a: l[0], b: l[1], k: Math.random(), sens: i % 2 ? 1 : -1, vitesse: 1.05 + Math.random() * 0.35, t: Math.random() * 10, pause: 0 });
  });
}
function majPassants(dt) {
  passants.forEach(p => {
    p.t += dt;
    const dx = p.b[0] - p.a[0], dz = p.b[1] - p.a[1], L = Math.hypot(dx, dz);
    if (p.pause > 0) { p.pause -= dt; animerMarche(p.mesh, p.t, false); return; }
    p.k += p.sens * p.vitesse * dt / L;
    if (p.k > 1 || p.k < 0) { p.k = clamp(p.k, 0, 1); p.sens *= -1; p.pause = 1 + Math.random() * 3; }
    p.mesh.position.set(p.a[0] + dx * p.k, 0, p.a[1] + dz * p.k);
    p.mesh.rotation.y = Math.atan2(dx * p.sens, dz * p.sens);
    animerMarche(p.mesh, p.t, true);
    majNiveauDetail(p.mesh);
  });
}

/* ---------- J12. Lieux de vie des niveaux RDC et R+2 ---------- */
const LIEUX_NIVEAU = {
  0: {
    cafe: TABLES_CAFE_RDC.flatMap(([x, z]) => placesBistrot(x, z)),
    comptoir: [3.6, 4.8, 6.0, 7.2].map(z => ({ x: -16.05, z, a: -O / 2, pose: "debout" })),
    salon: [{ x: 17.8, z: 7.1, a: -O / 2, pose: "assis" }, { x: 17.8, z: 8.1, a: -O / 2, pose: "assis" }, { x: 15.4, z: 7.1, a: O / 2, pose: "assis" }, { x: 15.4, z: 8.1, a: O / 2, pose: "assis" },
      { x: 16.1, z: 10.95, a: O, pose: "assis" }, { x: 17.1, z: 10.95, a: O, pose: "assis" }, { x: 15.2, z: 4.65, a: 0, pose: "assis" }, { x: 16.6, z: 4.65, a: 0, pose: "assis" }],
    hall: [{ x: 9.6, z: 7.0, a: O, pose: "debout" }, { x: 11.2, z: 7.0, a: O, pose: "debout" }, { x: 8.2, z: 9.6, a: O / 2, pose: "debout" }, { x: 12.8, z: 10.0, a: -O / 2, pose: "debout" }],
    showroom: [[8.8, -9.2], [12.6, -10.2], [16.4, -9.2], [8.8, -4.6], [16.4, -4.6]].map(([x, z]) => ({ x, z: z + 0.7, a: O, pose: "debout" })).concat([{ x: 12.1, z: -3.45, a: O, pose: "debout" }, { x: 13.1, z: -3.45, a: O, pose: "debout" }]),
    atrium: [{ x: -1.8, z: -2.4, a: -O / 2, pose: "debout" }, { x: -3.0, z: -2.4, a: O / 2, pose: "debout" }, { x: -1.8, z: 0.9, a: -O / 2, pose: "debout" }, { x: -3.0, z: 0.9, a: O / 2, pose: "debout" },
      { x: -2.5, z: 7.4, a: O / 2, pose: "assis" }, { x: -2.5, z: 8.2, a: O / 2, pose: "assis" }],
    auditorium: RANGEES_AUDITORIUM.slice(1, 4).flatMap(z => [-14.5, -12.6, -11.65].map(x => ({ x, z, a: O, pose: "assis" }))),
    scene: [{ x: -10.6, z: -10.1, a: 0, pose: "debout" }, { x: -14.6, z: -10.1, a: 0, pose: "debout" }]
  },
  2: {
    academy: TABLES_ACADEMY.flatMap(([x, z]) => [{ x: x - 0.6, z: z + 0.6, a: O, pose: "assis" }, { x: x + 0.6, z: z + 0.6, a: O, pose: "assis" }]),
    conseil: [-1.9, -0.9, 0.1, 1.1, 2.1].flatMap(x => [{ x, z: -10.95, a: 0, pose: "assis" }, { x, z: -8.65, a: O, pose: "assis" }]),
    service: DESKS_SERVICE.map(([x, z]) => ({ x, z: z + 0.78, a: O, pose: "ecran" })),
    belvedere: [{ x: 9.5, z: 6.9, a: O / 2, pose: "assis" }, { x: 9.5, z: 7.9, a: O / 2, pose: "assis" }, { x: 12.3, z: 6.9, a: -O / 2, pose: "assis" }, { x: 12.3, z: 7.9, a: -O / 2, pose: "assis" },
      { x: 10.4, z: 10.95, a: O, pose: "assis" }, { x: 11.4, z: 10.95, a: O, pose: "assis" }, { x: 14.0, z: 10.6, a: O / 2, pose: "debout" }, { x: 15.2, z: 10.6, a: -O / 2, pose: "debout" }, { x: 14.0, z: 5.4, a: O / 2, pose: "debout" }],
    bar: [{ x: 17.25, z: 7.4, a: O / 2, pose: "debout" }, { x: 17.25, z: 8.7, a: O / 2, pose: "debout" }],
    lab: [{ x: 12.0, z: -11.4, a: O, pose: "debout" }, { x: 13.2, z: -11.4, a: O, pose: "debout" }, { x: 9.0, z: -6.1, a: O, pose: "assis" }, { x: 10.2, z: -6.1, a: O, pose: "assis" }, { x: 15.0, z: -6.1, a: O, pose: "assis" }, { x: 16.2, z: -6.1, a: O, pose: "assis" }],
    biblio: [{ x: -14.95, z: 9.2, a: O / 2, pose: "assis" }, { x: -12.6, z: 8.65, a: 0, pose: "assis" }, { x: -10.05, z: 9.2, a: -O / 2, pose: "assis" }],
    collab: [{ x: -2.6, z: 2.0, a: -O / 2, pose: "debout" }, { x: -3.8, z: 2.0, a: O / 2, pose: "debout" }, { x: -2.6, z: 6.0, a: -O / 2, pose: "debout" }, { x: 1.0, z: 9.6, a: -O / 2, pose: "debout" }, { x: -0.2, z: 9.6, a: O / 2, pose: "debout" }]
  }
};
const cleLieuN = (n, l) => `${n}#${l.x.toFixed(2)}|${l.z.toFixed(2)}`;
function lieuLibreNiveau(n, categories) {
  const liste = [].concat(...categories.map(c => LIEUX_NIVEAU[n][c] || []));
  const libres = liste.filter(l => !lieuxOccupes.has(cleLieuN(n, l)));
  return libres.length ? libres[Math.floor(Math.random() * libres.length)] : null;
}

/* ---------- J13. Collègues qui changent d'étage (pause au Café du Parvis, au Belvédère…) ---------- */
const SANS_SORTIE = ["manager", "avantVente", "marketing", "success", "dg", "chloe"];
const peutSortir = e => !SANS_SORTIE.includes(e.cle) && !e.etiquetteMission && !occupeParJoueur(e) && e.etage === 1;
const cabineProche = z => CABINES.reduce((m, zc, k) => (Math.abs(zc - z) < Math.abs(CABINES[m] - z) ? k : m), 0);
function teleporterEmploye(e, n, x, z) {
  ETAGES[n].groupe.add(e.mesh);
  e.mesh.position.set(x, 0, z);
  e.etage = n;
}
function entrerCabineEmploye(e, vers) {
  const i = cabineProche(e.mesh.position.z);
  ouvrirPortes(e.etage, i, 3.4);
  e.etat = "ascenseur";
  e.ascenseur = { cabine: i, t: 0, vers, dedans: 0 };
}
function partirEnSortie(e) {
  const vers = e.sortieVers ?? (Math.random() < 0.55 ? 0 : 2);
  e.sortieVers = undefined;
  entrerCabineEmploye(e, vers);
}
function retourSortie(e) {
  libererLieu(e);
  envoyer(e, "retour", pointAppel(cabineProche(e.mesh.position.z)), 1);
}
function majEmployeAscenseur(e, dt) {
  const a = e.ascenseur, m = e.mesh, zc = CABINES[a.cabine];
  a.t += dt;
  if (a.t < 0.7) { tournerVers(m, -O / 2, dt, 8); animerMarche(m, e.t, false); return; }
  const dx = 2.55 - m.position.x, dz = zc - m.position.z, d = Math.hypot(dx, dz);
  if (d > 0.08 && !a.dedans) {
    const pas = Math.min(d, e.vitesse * dt);
    m.position.x += dx / d * pas;
    m.position.z += dz / d * pas;
    tournerVers(m, Math.atan2(dx, dz), dt, 9);
    animerMarche(m, e.t, true);
    return;
  }
  a.dedans += dt;
  tournerVers(m, O / 2, dt, 6);
  poser(m, "debout", e.t);
  if (a.dedans < 4.2) return;
  // Arrivée à l'étage demandé
  const n = a.vers;
  teleporterEmploye(e, n, 2.55, zc);
  m.rotation.y = O / 2;
  ouvrirPortes(n, a.cabine, 3.4);
  e.ascenseur = null;
  if (n === 1) {
    e.etat = "activite";
    e.activite = { type: "travail", lieu: { x: 4.3, z: zc, a: O / 2, pose: "debout" }, fin: 0 };
    choisirActivite(e);
    return;
  }
  if (a.partir) {
    // Fin de journée : sortie de l'immeuble par l'entrée de l'esplanade
    e.activite = { type: "depart", lieu: { x: 10.2, z: 11.6, a: 0, pose: "debout" }, duree: 0, fin: Infinity };
    e.etat = "trajet";
    e.chemin = calculerChemin(m.position, e.activite.lieu, ETAGES[n].nav);
    return;
  }
  const lieu = lieuLibreNiveau(n, n === 0 ? ["cafe", "comptoir", "atrium", "salon"] : ["belvedere", "bar", "collab", "biblio"]) || pointAppel(a.cabine);
  lieuxOccupes.add(cleLieu(lieu));
  e.activite = { type: "sortie", lieu, duree: 45 + Math.random() * 60, fin: Infinity };
  e.etat = "trajet";
  e.chemin = calculerChemin(m.position, lieu, ETAGES[n].nav);
}
// Un collègue nécessaire à une mission ou à une tâche revient aussitôt sur le plateau
function ramener(e) {
  if (!e || (e.etage === 1 && e.etat !== "ascenseur")) return;
  libererLieu(e);
  e.absent = false;
  e.mesh.visible = true;
  const i = e.ascenseur ? e.ascenseur.cabine : cabineProche(e.mesh.position.z);
  e.ascenseur = null;
  teleporterEmploye(e, 1, pointAppel(i).x, pointAppel(i).z);
  e.etat = "activite";
  e.activite = { type: "travail", lieu: e.siege, fin: 0 };
  envoyer(e, "travail", e.siege, 20 + Math.random() * 20);
}

/* ---------- J14. Personnes des autres niveaux (accueil, café, Academy, service clients…) ---------- */
const CONTACTS_EXTERNES = {
  marchal: { nom: "Julien Marchal", fonction: T("Directeur administratif et financier", "Chief Financial Officer"), entreprise: "Arvel Logistique", cible: true,
    secteur: T("transport et logistique, 180 salariés", "transport and logistics, 180 employees"),
    besoin: T("« Nos factures sont refaites à la main à partir des devis. Résultat : trois semaines de retard sur les encaissements, et mon banquier qui s'inquiète. »", "“Our invoices are re-typed by hand from the quotes. Result: three weeks' delay on payments, and my banker is getting worried.”"),
    note: T("Facturation manuelle, encaissements lents. Profil cible (ETI). À recontacter après sa clôture trimestrielle.", "Manual invoicing, slow collections. Target profile (mid-cap). Follow up after his quarterly close.") },
  lemaire: { nom: "Sophie Lemaire", fonction: T("Directrice commerciale", "Sales Director"), entreprise: "Nordia Équipements", cible: true,
    secteur: T("distribution industrielle, 90 salariés", "industrial distribution, 90 employees"),
    besoin: T("« Chacun de mes commerciaux a son propre fichier Excel. Je n'ai aucune vision du pipeline avant la fin du mois. »", "“Each of my sales reps has their own Excel file. I have no view of the pipeline until the end of the month.”"),
    note: T("Aucune visibilité sur le pipeline. Profil cible (PME). Intéressée par un retour d'expérience client.", "No pipeline visibility. Target profile (SME). Interested in a customer case study.") },
  benslimane: { nom: "Karim Benslimane", fonction: T("Fondateur", "Founder"), entreprise: "Studio Kairos", cible: false,
    secteur: T("agence de création digitale, 8 personnes", "digital design studio, 8 people"),
    besoin: T("« On est huit, on gère tout dans un tableur partagé, et franchement ça nous suffit pour l'instant. »", "“There are eight of us, we run everything in a shared spreadsheet, and honestly that's enough for now.”"),
    note: T("Très petite structure, besoin couvert par un tableur : hors cible pour l'instant. Contact sympathique, à garder sans relance.", "Very small business, need covered by a spreadsheet: not a target for now. Friendly contact, keep without follow-up.") },
  vasseur: { nom: "Hélène Vasseur", fonction: T("Directrice des systèmes d'information", "Chief Information Officer"), entreprise: "Groupe Maréval", cible: true,
    secteur: T("agroalimentaire, 6 sites, 420 salariés", "food industry, 6 sites, 420 employees"),
    besoin: T("« Six sites, trois outils commerciaux différents. Consolider l'activité prend une semaine à mon équipe chaque mois. »", "“Six sites, three different sales tools. Consolidating activity takes my team a week every month.”"),
    note: T("Multisite, consolidation impossible. Profil cible (ETI). Sensible à la sécurité et aux intégrations.", "Multi-site, impossible to consolidate. Target profile (mid-cap). Cares about security and integrations.") },
  ngata: { nom: "Thomas Ngata", fonction: T("Responsable administration des ventes", "Sales Administration Manager"), entreprise: "Cobalt Industries", cible: true,
    secteur: T("fabrication de pièces techniques, 140 salariés", "technical parts manufacturing, 140 employees"),
    besoin: T("« Nos devis partent par mail et personne ne les relance. On a perdu deux belles affaires le trimestre dernier sans même s'en rendre compte. »", "“Our quotes go out by email and nobody follows them up. We lost two good deals last quarter without even noticing.”"),
    note: T("Devis non relancés. Profil cible (PME). Décideur : son directeur commercial.", "Quotes not followed up. Target profile (SME). Decision-maker: his sales director.") },
  dumont: { nom: "Claire Dumont", fonction: T("Consultante RH indépendante", "Independent HR consultant"), entreprise: "Dumont Conseil", cible: false,
    secteur: T("conseil en recrutement, indépendante", "recruitment consulting, self-employed"),
    besoin: T("« Je viens rencontrer votre DRH pour un recrutement. Moi, je n'ai pas vraiment de logiciel commercial à acheter ! »", "“I'm here to meet your HR director about a hire. I don't really have any sales software to buy!”"),
    note: T("Hors cible (pas de besoin logiciel). Peut recommander Veltis auprès de ses clients PME.", "Not a target (no software need). Could recommend Veltis to her SME clients.") }
};
const FIGURANTS_DEF = [
  { cle: "nadia", etage: 0, nom: "Nadia Benali", fonction: T("Hôtesse d'accueil", "Receptionist"), entreprise: "Veltis", type: "accueil", apparence: 3, genre: "f", variante: 41, fixe: { x: 10.4, z: 5.45, a: 0, pose: "debout" }, couleur: "#475569" },
  { cle: "karim", etage: 0, nom: "Karim Haddou", fonction: T("Agent de sûreté", "Security officer"), entreprise: "Veltis", type: "surete", apparence: 2, genre: "h", variante: 52, costume: 0x111827, cravate: 0x111827, fixe: { x: 7.55, z: 6.4, a: -O / 2, pose: "debout" }, couleur: "#111827" },
  { cle: "hugo", etage: 0, nom: "Hugo Lambert", fonction: "Barista", entreprise: "Café du Parvis", type: "barista", apparence: 0, genre: "h", variante: 63, tenue: "ville", haut: 0x3f3f46, bas: 0x1f2937, fixe: { x: -17.55, z: 5.2, a: O / 2, pose: "debout" }, couleur: "#78350f" },
  { cle: "lucas", etage: 0, nom: "Lucas Meyer", fonction: T("Spécialiste produit", "Product specialist"), entreprise: "Veltis", type: "produit", apparence: 4, genre: "h", variante: 74, lieux: ["showroom"], couleur: "#1e3a8a" },
  { cle: "emilie", etage: 0, nom: "Émilie Roux", fonction: T("Responsable événements", "Events manager"), entreprise: "Veltis", type: "evenement", apparence: 1, genre: "f", variante: 85, lieux: ["scene", "atrium", "hall"], couleur: "#9f1239" },
  { cle: "marchal", etage: 0, contact: "marchal", type: "visiteur", apparence: 5, genre: "h", variante: 91, badge: true, lieux: ["cafe", "comptoir", "salon", "atrium"] },
  { cle: "lemaire", etage: 0, contact: "lemaire", type: "visiteur", apparence: 3, genre: "f", variante: 13, badge: true, lieux: ["salon", "cafe", "showroom", "hall"] },
  { cle: "benslimane", etage: 0, contact: "benslimane", type: "visiteur", apparence: 2, genre: "h", variante: 27, badge: true, tenue: "ville", haut: 0x3f6212, bas: 0x1f2937, lieux: ["cafe", "comptoir", "atrium", "auditorium"] },
  { cle: "vasseur", etage: 0, contact: "vasseur", type: "visiteur", apparence: 6, genre: "f", variante: 38, badge: true, lieux: ["showroom", "salon", "cafe", "auditorium"] },
  { cle: "ngata", etage: 0, contact: "ngata", type: "visiteur", apparence: 2, genre: "h", variante: 49, badge: true, lieux: ["cafe", "hall", "salon", "showroom"] },
  { cle: "dumont", etage: 0, contact: "dumont", type: "visiteur", apparence: 7, genre: "f", variante: 56, badge: true, lieux: ["salon", "cafe", "comptoir", "atrium"] },
  { cle: "claire", etage: 2, nom: "Claire Fontaine", fonction: T("Responsable de la Veltis Academy", "Head of Veltis Academy"), entreprise: "Veltis", type: "formateur", apparence: 1, genre: "f", variante: 22, fixe: { x: -12.6, z: -11.2, a: 0, pose: "debout" }, couleur: "#1d4ed8" },
  { cle: "mathis", etage: 2, nom: "Mathis Robert", fonction: T("Commercial en formation", "Sales rep in training"), entreprise: "Veltis", type: "apprenant", apparence: 0, genre: "h", variante: 33, lieux: ["academy"], couleur: "#1e3a8a" },
  { cle: "camille", etage: 2, nom: "Camille Leroy", fonction: T("Commerciale en formation", "Sales rep in training"), entreprise: "Veltis", type: "apprenant", apparence: 6, genre: "f", variante: 44, lieux: ["academy"], couleur: "#1e3a8a" },
  { cle: "leo", etage: 2, nom: "Léo Martin", fonction: T("Conseiller service clients", "Customer care advisor"), entreprise: "Veltis", type: "support", apparence: 4, genre: "h", variante: 55, lieux: ["service"], couleur: "#0f766e" },
  { cle: "aicha", etage: 2, nom: "Aïcha Traoré", fonction: T("Conseillère service clients", "Customer care advisor"), entreprise: "Veltis", type: "support", apparence: 7, genre: "f", variante: 66, lieux: ["service"], couleur: "#0f766e" },
  { cle: "jonas", etage: 2, nom: "Jonas Weber", fonction: T("Responsable service clients", "Customer care manager"), entreprise: "Veltis", type: "support", apparence: 5, genre: "h", variante: 77, lieux: ["service", "collab"], couleur: "#0f766e" },
  { cle: "marc", etage: 2, nom: "Marc Delaunay", fonction: T("Directeur administratif et financier", "Chief Financial Officer"), entreprise: "Veltis", type: "daf", apparence: 5, genre: "h", variante: 88, lieux: ["conseil", "belvedere", "collab"], couleur: "#334155" },
  { cle: "pauline", etage: 2, nom: "Pauline Girard", fonction: T("Directrice des ressources humaines", "HR Director"), entreprise: "Veltis", type: "drh", apparence: 3, genre: "f", variante: 99, lieux: ["conseil", "belvedere", "biblio"], couleur: "#7c2d12" },
  { cle: "emma", etage: 2, nom: "Emma Rousseau", fonction: "Product Manager", entreprise: "Veltis", type: "pm", apparence: 1, genre: "f", variante: 15, lieux: ["lab"], couleur: "#0369a1" },
  { cle: "antoine", etage: 2, nom: "Antoine Leclerc", fonction: T("Responsable grands comptes", "Key Account Manager"), entreprise: "Veltis", type: "commercial", apparence: 0, genre: "h", variante: 61, fixe: { x: 0.2, z: 3.78, a: O, pose: "ecran" }, couleur: "#1e3a8a" },
  { cle: "nora", etage: 2, nom: "Nora Benamar", fonction: T("Commerciale terrain", "Field Sales Rep"), entreprise: "Veltis", type: "commercial", apparence: 6, genre: "f", variante: 72, fixe: { x: 0.2, z: 6.58, a: O, pose: "ecran" }, couleur: "#1e3a8a" },
  { cle: "nicolas", etage: 2, nom: "Nicolas Faure", fonction: T("Développeur", "Developer"), entreprise: "Veltis", type: "dev", apparence: 0, genre: "h", variante: 26, tenue: "ville", haut: 0x1e3a8a, bas: 0x1f2937, lieux: ["lab", "bar", "collab"], couleur: "#0369a1" }
];
FIGURANTS_DEF.forEach(d => {
  if (!d.contact) return;
  const c = CONTACTS_EXTERNES[d.contact];
  Object.assign(d, { nom: c.nom, fonction: c.fonction, entreprise: c.entreprise, couleur: "#57534e" });
});
const REPLIQUES_FIGURANTS = {
  visiteur: [T("Mon rendez-vous a un peu de retard…", "My meeting is running a bit late…"), T("Belle vue sur l'esplanade, non ?", "Lovely view of the Esplanade, isn't it?"), T("Leur café est vraiment bon ici.", "Their coffee is really good here."), T("Je relis mes notes avant la réunion.", "I'm going over my notes before the meeting."), T("Vous savez où est le salon Seine ?", "Do you know where the Seine Room is?")],
  accueil: [T("Bonjour, vous avez rendez-vous ?", "Hello, do you have an appointment?"), T("Je vous prépare un badge visiteur.", "I'll prepare a visitor badge for you."), T("Votre interlocuteur arrive, installez-vous.", "Your contact is on the way, please take a seat.")],
  surete: [T("Bonjour, badge à présenter devant le lecteur.", "Hello, please hold your badge to the reader."), T("Bonne journée !", "Have a good day!")],
  barista: [T("Un cappuccino, ça marche !", "One cappuccino, coming up!"), T("Et un allongé pour la table trois.", "And a long black for table three."), T("Les croissants sortent du four.", "The croissants are fresh out of the oven.")],
  produit: [T("Le module de relance des devis plaît beaucoup.", "The quote follow-up module is very popular."), T("Je prépare la démo de 15 h.", "I'm preparing the 3 pm demo.")],
  evenement: [T("Test micro… un, deux.", "Mic check… one, two."), T("Il faudra quarante chaises de plus pour la matinale.", "We'll need forty more chairs for the breakfast event.")],
  formateur: [T("Qui peut me donner un exemple de question d'implication ?", "Who can give me an example of an implication question?"), T("Rappelez-vous : on qualifie avant de chiffrer.", "Remember: qualify before you quote."), T("La CLV, c'est toute la relation, pas la signature.", "CLV is the whole relationship, not the signature.")],
  apprenant: [T("Situation, Problème, Implication…", "Situation, Problem, Implication…"), T("Je n'avais jamais calculé une CLV.", "I'd never calculated a CLV before.")],
  support: [T("Service clients Veltis, bonjour !", "Veltis customer care, good morning!"), T("Je vous envoie le tutoriel tout de suite.", "I'll send you the tutorial right away."), T("Votre ticket est résolu, bonne journée.", "Your ticket is resolved, have a good day.")],
  daf: [T("La marge brute du trimestre tient bien.", "This quarter's gross margin is holding up well."), T("Encore une remise à 20 % ?", "Another 20% discount?")],
  drh: [T("Deux recrutements de commerciaux ce mois-ci.", "Two sales hires this month."), T("Le séminaire d'équipe est calé en juin.", "The team off-site is booked for June.")],
  commercial: [T("Mon prévisionnel est à jour pour le trimestre.", "My forecast is up to date for the quarter."), T("Je relance mes opportunités de la semaine.", "I'm following up this week's opportunities."), T("Deux signatures attendues vendredi.", "Two signatures expected on Friday.")],
  pm: [T("Ce retour client change nos priorités.", "This customer feedback changes our priorities."), T("On teste la nouvelle vue pipeline vendredi.", "We're testing the new pipeline view on Friday.")],
  dev: [T("Le connecteur passe les tests.", "The connector passes the tests."), T("Encore un café et je livre.", "One more coffee and I'll ship it.")],
  reponse: [T("Tout à fait.", "Absolutely."), T("C'est vrai.", "That's true."), T("Bonne idée !", "Good idea!"), T("Je vois.", "I see."), T("Ah oui ?", "Oh really?")]
};
const figurants = [];
const gestesFigurants = new Set();
function creerFigurants() {
  FIGURANTS_DEF.forEach(def => {
    const app = Object.assign({}, APPARENCES[def.apparence % APPARENCES.length], { genre: def.genre, variante: def.variante, badge: !!def.badge },
      def.tenue ? { tenue: def.tenue, haut: def.haut, bas: def.bas } : {}, def.costume ? { costume: def.costume, cravate: def.cravate } : {});
    const mesh = creerPersonnage(app);
    const n = def.etage;
    const lieu = def.fixe || lieuLibreNiveau(n, def.lieux) || { x: 10, z: 8, a: 0, pose: "debout" };
    if (!def.fixe) lieuxOccupes.add(cleLieuN(n, lieu));
    mesh.position.set(lieu.x, 0, lieu.z);
    mesh.rotation.y = lieu.a;
    mesh.userData.etage = n;
    ETAGES[n].groupe.add(mesh);
    const etiquette = document.createElement("div");
    etiquette.className = "etiquette etq-collaborateur etq-figurant";
    $("etiquettes").appendChild(etiquette);
    const bulle = document.createElement("div");
    bulle.className = "bulle";
    $("etiquettes").appendChild(bulle);
    figurants.push({ def, mesh, etage: n, prenom: def.nom.split(" ")[0], lieu, etat: "activite", fin: 10 + Math.random() * 40, chemin: [], t: Math.random() * 10,
      vitesse: 0.95 + Math.random() * 0.25, bulle: "", bulleFin: 0, etiquette, bulleEl: bulle, enEchange: false, bloque: 0 });
  });
}
function parlerBulleFigurant(f, texte, duree = 4) { f.bulle = texte; f.bulleFin = vie.temps + duree; }
function prochaineActiviteFigurant(f) {
  const lieu = lieuLibreNiveau(f.etage, f.def.lieux);
  if (!lieu) { f.fin = vie.temps + 8; return; }
  lieuxOccupes.delete(cleLieuN(f.etage, f.lieu));
  lieuxOccupes.add(cleLieuN(f.etage, lieu));
  f.lieu = lieu;
  f.etat = "trajet";
  f.chemin = calculerChemin(f.mesh.position, lieu, ETAGES[f.etage].nav);
  poser(f.mesh, "debout", f.t);
}
function majFigurants(dt) {
  if (jeu.mode === "pause") return;
  figurants.forEach(f => {
    f.t += dt;
    const m = f.mesh;
    if (f.enEchange && jeu.mode !== "dialogue") f.enEchange = false;
    if (f.enEchange || jeu.focus === m) {
      if (f.etat === "activite" && ["assis", "ecran"].includes(f.lieu.pose)) poser(m, "assis", f.t);
      else { poser(m, "parle", f.t); tournerVers(m, Math.atan2(joueur.x - m.position.x, joueur.z - m.position.z), dt, 6); }
      return;
    }
    if (f.etat === "trajet") {
      const cible = f.chemin[0];
      if (!cible) { f.etat = "activite"; m.position.set(f.lieu.x, 0, f.lieu.z); f.fin = vie.temps + 25 + Math.random() * 45; return; }
      const dx = cible.x - m.position.x, dz = cible.z - m.position.z, d = Math.hypot(dx, dz);
      if (d < 0.08) { f.chemin.shift(); return; }
      const pas = Math.min(d, f.vitesse * dt);
      const nx = m.position.x + dx / d * pas, nz = m.position.z + dz / d * pas;
      const dj = Math.hypot(nx - joueur.x, nz - joueur.z);
      const gene = f.etage === joueur.etage && jeu.mode !== "menu" && dj < 0.75 && dj < Math.hypot(m.position.x - joueur.x, m.position.z - joueur.z);
      if (gene && f.bloque < 1.2) { f.bloque += dt; animerMarche(m, f.t, false); return; }
      f.bloque = gene ? f.bloque : 0;
      m.position.x = nx;
      m.position.z = nz;
      tournerVers(m, Math.atan2(dx, dz), dt, 9);
      animerMarche(m, f.t, true);
      return;
    }
    tournerVers(m, f.lieu.a, dt, 6);
    m.userData.expression = ["visiteur", "barista", "accueil"].includes(f.def.type) ? "sourire" : "neutre";
    if (f.etage === joueur.etage) majRegardSocial(f, figurants, dt);
    const parle = f.bulleFin > vie.temps;
    poser(m, ["assis", "ecran", "tel"].includes(f.lieu.pose) ? f.lieu.pose : parle ? "parle" : f.lieu.pose, f.t);
    if (f.bulleFin < vie.temps - 5 && Math.random() < dt * 0.045) {
      parlerBulleFigurant(f, choisirTexte(REPLIQUES_FIGURANTS[f.def.type] || REPLIQUES_FIGURANTS.visiteur), 4.5);
      const voisin = figurants.find(o => o !== f && o.etage === f.etage && o.etat === "activite" && !o.enEchange && o.bulleFin < vie.temps && Math.hypot(o.mesh.position.x - m.position.x, o.mesh.position.z - m.position.z) < 2.4);
      if (voisin) setTimeout(() => { if (!voisin.enEchange) parlerBulleFigurant(voisin, choisirTexte(REPLIQUES_FIGURANTS.reponse), 3.2); }, 2300);
    }
    if (!f.def.fixe && vie.temps > f.fin) prochaineActiviteFigurant(f);
  });
}
function animerVisagesFigurants(dt) {
  figurants.forEach(f => { if (f.etage === joueur.etage) animerVivant(f.mesh, dt, { parle: f.bulleFin > vie.temps || jeu.focus === f.mesh, regarder: f.etat === "activite" || f.enEchange }); });
}
function majEtiquettesFigurants() {
  const v = new THREE.Vector3();
  const w = window.innerWidth, h = window.innerHeight;
  const placer = (el, p, hauteur) => {
    v.set(p.x, hauteur, p.z).project(camera);
    if (v.z > 1 || Math.abs(v.x) > 1.1 || Math.abs(v.y) > 1.1) { ecrireStyle(el, "display", "none"); return; }
    ecrireStyle(el, "display", "flex");
    ecrireStyle(el, "transform", `translate(${Math.round((v.x * 0.5 + 0.5) * w)}px, ${Math.round((-v.y * 0.5 + 0.5) * h)}px) translate(-50%, -100%)`);
  };
  const visible = !["menu", "briefing", "bilan"].includes(jeu.mode);
  figurants.forEach(f => {
    const p = f.mesh.position;
    const d = visible && f.etage === joueur.etage ? Math.hypot(p.x - joueur.x, p.z - joueur.z) : Infinity;
    const assis = f.etat === "activite" && ["assis", "ecran"].includes(f.lieu.pose);
    const base = (assis ? 1.85 : 2.2) + ETAGES[f.etage].y;
    const montrerNom = jeu.mode === "jeu" && d < 3.4;
    if (montrerNom) {
      const deja = f.def.contact && (resultats.reseauExterne || []).includes(f.def.contact);
      const html = `<span class="c-nom">${echapper(f.def.nom)}${deja ? " ·  ✓" : ""}</span><span class="c-info">${echapper(f.def.fonction)} · ${echapper(f.def.entreprise)}</span>`;
      if (f.etiquette.dataset.html !== html) { f.etiquette.innerHTML = html; f.etiquette.dataset.html = html; }
      placer(f.etiquette, p, base);
    } else ecrireStyle(f.etiquette, "display", "none");
    if (f.bulleFin > vie.temps && f.bulle && d < 9 && !f.enEchange && jeu.mode !== "dialogue") {
      if (f.bulleEl.textContent !== f.bulle) f.bulleEl.textContent = f.bulle;
      placer(f.bulleEl, p, base + (montrerNom ? 0.55 : 0));
    } else ecrireStyle(f.bulleEl, "display", "none");
  });
}
function figurantProche() {
  let meilleur = null, dMin = Infinity;
  figurants.forEach(f => {
    if (f.enEchange || f.etage !== joueur.etage) return;
    const d = Math.hypot(f.mesh.position.x - joueur.x, f.mesh.position.z - joueur.z);
    const a = angleVers(f.mesh.position);
    if (d > 2.4 || (a > 0.55 && d > 0.9)) return;
    const score = d * (1 + 2 * a);
    if (score < dMin) { dMin = score; meilleur = f; }
  });
  return meilleur;
}

/* ---------- J15. Échanges avec les personnes des autres niveaux ---------- */
const interlocuteurFigurant = f => ({ nom: f.def.nom, fonction: f.def.fonction, entreprise: f.def.entreprise, couleur: f.def.couleur || "#334155" });
function finEchangeFigurant(f, suite) {
  fermerEntretien();
  f.enEchange = false;
  if (suite) suite();
}
function dialogueFigurant(f, texte, choix, canal = T("Échange informel", "Informal chat")) {
  f.enEchange = true;
  ouvrirEntretien({
    interlocuteur: interlocuteurFigurant(f), canal, focus: f.mesh, texte,
    choix: choix.map(c => ({ label: c.label, action: () => (c.action ? c.action() : reponseFigurant(f, c, canal)) }))
  });
}
function reponseFigurant(f, c, canal) {
  const id = jeu.def ? jeu.def.id : "libre";
  if (c.posture < 0) deplacerPosture(c.posture, c.reflexe || "");
  else if (c.posture > 0) {
    const cle = `${f.def.cle}|${id}`;
    if (!gestesFigurants.has(cle)) { gestesFigurants.add(cle); deplacerPosture(c.posture); }
  }
  if (c.journal) noter(c.posture > 0 ? "ok" : c.posture < 0 ? "ko" : "info", `${f.def.nom} : ${c.journal}`);
  if (c.temps && jeu.def) avancerTemps(c.temps);
  if (c.avant) c.avant();
  const reponse = typeof c.reponse === "function" ? c.reponse() : c.reponse;
  ouvrirEntretien({
    interlocuteur: interlocuteurFigurant(f), canal, focus: f.mesh,
    texte: (reponse.startsWith("«") || reponse.startsWith("“") ? reponse : guillemets(reponse)) + (c.complement ? `\n\n${typeof c.complement === "function" ? c.complement() : c.complement}` : ""),
    choix: [{ label: c.suiteLabel || T("Terminer l'échange", "End the conversation"), action: () => finEchangeFigurant(f, c.suite) }]
  });
}
function parlerFigurant(f) {
  if (jeu.mode !== "jeu") return;
  const t = f.def.type;
  if (t === "visiteur") return rencontreVisiteur(f);
  if (t === "formateur") return accueilAcademy(f);
  const visiteursPresents = () => figurants.filter(x => x.def.type === "visiteur" && x.etage === 0).map(x => x.def.nom);
  const D = {
    accueil: [T("« Bonjour ! Je peux vous aider ? »", "“Hello! Can I help you?”"), [
      { label: T("Demander qui est attendu aujourd'hui.", "Ask who is expected today."), reponse: () => (EN ? `“We have ${visiteursPresents().length} visitors in the building: ${visiteursPresents().join(", ")}. Most are waiting in the lounge or at the café.”` : `« Nous avons ${visiteursPresents().length} visiteurs dans l'immeuble : ${visiteursPresents().join(", ")}. La plupart patientent au salon ou au café. »`), complement: T("Un visiteur qui attend est souvent disponible pour échanger quelques minutes, sans pression.", "A visitor who is waiting is often happy to chat for a few minutes, without pressure.") },
      { label: T("Lui demander ce qui aide le plus l'accueil quand un client arrive.", "Ask what helps reception most when a customer arrives."), reponse: T("Être prévenue la veille : je prépare le badge et la salle, et j'accueille le client par son nom. La première impression, ça compte.", "Being told the day before: I prepare the badge and the room, and greet the customer by name. First impressions matter."), journal: T("intérêt pour le métier de l'accueil.", "interest in the receptionist's job.") },
      { label: T("Prendre le plan de l'immeuble.", "Take a building map."), action: () => { fermerEntretien(); f.enEchange = false; ouvrirPlan(); } }
    ]],
    surete: [T("« Bonjour. Les portiques s'ouvrent avec votre badge, il suffit d'approcher. »", "“Hello. The gates open with your badge, just walk up to them.”"), [
      { label: T("Lui demander comment se passe sa journée.", "Ask how his day is going."), reponse: T("Calme. Le rush, c'est le matin : trois cents badges entre 8 h 30 et 9 h 15. Et vous, beaucoup de rendez-vous ?", "Quiet. The rush is in the morning: three hundred badges between 8:30 and 9:15. And you, lots of meetings?") },
      { label: T("Le prévenir qu'un client arrive tout à l'heure.", "Let him know a customer is arriving later."), reponse: T("Noté, je préviens Nadia. Il aura son badge visiteur à l'arrivée.", "Noted, I'll tell Nadia. They'll have a visitor badge on arrival."), journal: T("visite client annoncée à l'accueil.", "customer visit announced at reception.") }
    ]],
    barista: [T("« Bonjour ! Qu'est-ce que je vous sers ? »", "“Hello! What can I get you?”"), [
      { label: T("Un espresso, merci.", "An espresso, please."), temps: 4, reponse: T("Et voilà ! Un espresso serré.", "Here you go! A short espresso."), complement: () => (visiteursPresents().length ? T("Autour de vous, des visiteurs patientent avant leur rendez-vous.", "Around you, visitors are waiting for their meetings.") : "") },
      { label: T("Un cappuccino, et deux minutes de pause.", "A cappuccino, and a two-minute break."), temps: 7, reponse: T("Bonne pause ! Prenez le temps, ça aide à bien repartir.", "Enjoy your break! Taking a moment helps you go again.") },
      { label: T("Lui demander qui vient le plus au café.", "Ask who comes to the café most."), reponse: T("Les visiteurs qui attendent un rendez-vous. Les gens se confient plus volontiers autour d'un café qu'en salle de réunion !", "Visitors waiting for a meeting. People open up much more over a coffee than in a meeting room!") }
    ], "Café du Parvis"],
    produit: [T("« Je prépare une démo pour un groupe de visiteurs. Tu veux revoir les modules ? »", "“I'm preparing a demo for a group of visitors. Want to go over the modules again?”"), [
      { label: T("Revoir les modules de Veltis One.", "Go over the Veltis One modules."), action: () => { fermerEntretien(); f.enEchange = false; ouvrirShowroom(); } },
      { label: T("Lui demander ce que les clients regardent en premier.", "Ask what customers look at first."), reponse: T("Le pipeline et la relance des devis. Mais ce qui fait signer, c'est quand on part de leur problème, pas de l'écran.", "The pipeline and quote follow-ups. But what gets them to sign is starting from their problem, not from the screen."), journal: T("conseil de démonstration reçu au showroom.", "demo tip received at the showroom.") }
    ]],
    evenement: [T("« On prépare la prochaine matinale et la keynote de fin de trimestre. »", "“We're preparing the next breakfast event and the end-of-quarter keynote.”"), [
      { label: T("Lui demander ce qui fait une matinale réussie.", "Ask what makes a breakfast event successful."), reponse: T("Les bons profils dans la salle. Cent personnes qui ne décident de rien, ça ne sert à rien ; vingt dirigeants de PME, c'est un succès.", "The right people in the room. A hundred people who decide nothing is pointless; twenty SME leaders is a success.") },
      { label: T("Proposer d'inviter vos prospects qualifiés.", "Offer to invite your qualified prospects."), reponse: T("Avec plaisir ! Envoie-moi la liste, je leur réserve des places au premier rang.", "Gladly! Send me the list, I'll save them front-row seats."), journal: T("prospects qualifiés proposés pour un événement.", "qualified prospects suggested for an event.") }
    ]],
    apprenant: [T("« On est en formation aujourd'hui : la découverte SPIN. »", "“We're in training today: SPIN discovery.”"), [
      { label: T("Partager un conseil de terrain.", "Share a tip from the field."), reponse: T("Merci ! Je note : la question d'implication, c'est celle qui fait parler le client.", "Thanks! Noted: the implication question is the one that gets the customer talking."), journal: T("conseil partagé avec un nouveau commercial.", "tip shared with a new sales rep.") },
      { label: T("Leur dire que la méthode, c'est de la théorie : seul le chiffre compte.", "Tell them method is just theory: only the numbers count."), posture: -1, reflexe: T("Discours « chiffre à tout prix » tenu devant des commerciaux en formation.", "“Numbers at any cost” talk in front of sales reps in training."), reponse: T("Ah… Ce n'est pas ce que Claire nous explique.", "Oh… That's not what Claire is teaching us.") }
    ], "Veltis Academy"],
    support: [T("« Le téléphone sonne beaucoup aujourd'hui. »", "“The phone is ringing a lot today.”"), [
      { label: T("Demander les principaux motifs d'appel des nouveaux clients.", "Ask why new customers call most often."), posture: 1, journal: T("intérêt pour l'après-vente et la satisfaction client.", "interest in after-sales and customer satisfaction."), reponse: T("Surtout des clients sur-équipés : trop de licences, des modules qu'ils n'utilisent pas. Ceux-là, on les perd souvent au renouvellement.", "Mostly over-equipped customers: too many licences, modules they don't use. We often lose those at renewal."), complement: T("Vendre au juste besoin, c'est aussi protéger la CLV.", "Selling to the real need also protects CLV.") },
      { label: T("Leur dire que l'après-vente, ce n'est pas votre sujet.", "Tell them after-sales isn't your problem."), posture: -1, reflexe: T("Désintérêt affiché pour l'après-vente.", "Open lack of interest in after-sales."), reponse: T("Pourtant, ce sont tes clients qui nous appellent…", "And yet it's your customers who call us…") }
    ], T("Service clients", "Customer Care")],
    daf: [T("« Je relis les marges du trimestre. »", "“I'm going over this quarter's margins.”"), [
      { label: T("Lui demander ce qu'il regarde en priorité dans une affaire.", "Ask what he looks at first in a deal."), posture: 1, journal: T("échange sur la marge et la valeur d'une affaire.", "discussion about margin and deal value."), reponse: T("La remise et la durée d'engagement. Quinze pour cent sans contrepartie, c'est presque une année de marge qui s'envole.", "The discount and the commitment period. Fifteen percent with nothing in return is almost a year's margin gone.") },
      { label: T("Lui demander de valider une grosse remise pour signer vite.", "Ask him to approve a big discount to sign fast."), posture: -1, reflexe: T("Remise demandée sans contrepartie au DAF.", "Discount requested from the CFO with nothing in return."), reponse: T("Pas sans contrepartie. Reviens avec un engagement de trois ans ou un volume ferme.", "Not without something in return. Come back with a three-year commitment or a firm volume.") }
    ]],
    drh: [T("« On prépare l'intégration des deux nouveaux commerciaux. »", "“We're preparing the onboarding of the two new sales reps.”"), [
      { label: T("Lui demander ce qui fait réussir un commercial chez Veltis.", "Ask what makes a sales rep succeed at Veltis."), reponse: T("La curiosité et la constance. Ceux qui durent sont ceux que leurs clients rappellent d'eux-mêmes.", "Curiosity and consistency. The ones who last are the ones customers call back of their own accord.") },
      { label: T("Proposer de parrainer un nouveau commercial.", "Offer to mentor a new sales rep."), reponse: T("Merveilleux, je t'associe à Mathis. Il est à l'Academy en ce moment.", "Wonderful, I'll pair you with Mathis. He's at the Academy right now."), journal: T("parrainage proposé à un nouveau commercial.", "mentoring offered to a new sales rep.") }
    ]],
    pm: [T("« Tu as des retours terrain pour nous ? »", "“Do you have any feedback from the field for us?”"), [
      { label: T("Partager un besoin client réel entendu en rendez-vous.", "Share a real customer need you heard in a meeting."), posture: 1, journal: T("retour client transmis à l'équipe produit.", "customer feedback passed on to the product team."), reponse: T("Précieux, merci. C'est exactement ce qui fait évoluer la feuille de route.", "Precious, thank you. That's exactly what shapes the roadmap.") },
      { label: T("Annoncer que vous promettez déjà la fonction « à confirmer » du T4 à vos clients.", "Say you're already promising customers the Q4 “to be confirmed” feature."), posture: -1, reflexe: T("Promesse d'une fonctionnalité non validée.", "Promise of an unconfirmed feature."), reponse: T("Surtout pas ! Rien n'est validé. Une promesse non tenue, c'est un client perdu au renouvellement.", "Please don't! Nothing is confirmed. A broken promise is a customer lost at renewal.") },
      { label: T("Lire la feuille de route produit.", "Read the product roadmap."), action: () => { fermerEntretien(); f.enEchange = false; ouvrirFeuilleRoute(); } }
    ], "Veltis Lab"],
    commercial: [T("« Je finalise mon prévisionnel du trimestre. »", "“I'm finalising my forecast for the quarter.”"), [
      Object.assign(choixComparaison(f.def.cle) || {}, { suiteLabel: T("Ouvrir le tableau de bord", "Open the dashboard"), suite: () => ouvrirTableauDeBord("synthese") }),
      { label: T("Lui demander comment elle ou il fait avancer ses opportunités.", "Ask how they move their opportunities forward."), reponse: () => (COMMERCIAUX.find(x => x.cle === f.def.cle) || {}).conseil || "", journal: T("bonne pratique de conversion partagée par un commercial.", "conversion best practice shared by a sales rep.") }
    ], T("Pôle grands comptes", "Key accounts")],
    dev: [T("« On teste le connecteur e-commerce avec trois clients pilotes. »", "“We're testing the e-commerce connector with three pilot customers.”"), [
      { label: T("Lui demander comment se passent les tests.", "Ask how the tests are going."), reponse: T("Bien ! Les clients pilotes nous remontent des cas qu'on n'aurait jamais imaginés. Le terrain a toujours raison.", "Well! The pilot customers report cases we'd never have imagined. The field is always right.") },
      { label: T("Lui proposer un café au bar.", "Offer him a coffee at the bar."), temps: 4, reponse: T("Volontiers, cinq minutes et j'y retourne.", "Gladly, five minutes and then back to it.") }
    ], "Veltis Lab"]
  };
  const d = D[t] || (DIALOGUES_SERVICE[t] && DIALOGUES_SERVICE[t]());
  if (!d) return;
  dialogueFigurant(f, d[0], d[1], d[2]);
}

/* Rencontres au RDC : écouter avant de vendre */
function rencontreVisiteur(f) {
  const c = CONTACTS_EXTERNES[f.def.contact];
  if (!resultats.reseauExterne) resultats.reseauExterne = [];
  const connu = resultats.reseauExterne.includes(f.def.contact);
  const lieu = zoneNiveau(0, f.mesh.position);
  if (f.froid && f.froid === (jeu.def ? jeu.def.id : "")) {
    dialogueFigurant(f, EN ? `${f.prenom} nods politely but keeps their distance after your last exchange.` : `${f.prenom} vous salue poliment, mais reste sur la réserve après votre dernier échange.`,
      [{ label: T("Lui souhaiter une bonne journée.", "Wish them a good day."), reponse: T("Merci, à vous aussi.", "Thanks, you too.") }], T("Rencontre", "Encounter"));
    return;
  }
  if (connu) {
    dialogueFigurant(f, EN ? `“Oh, hello again! Nice to see you.” ${c.nom} remembers your last conversation.` : `« Tiens, re-bonjour ! Ravi${f.def.genre === "f" ? "e" : ""} de vous recroiser. » ${c.nom} se souvient de votre dernier échange.`, [
      { label: T("Lui proposer de faire un point dans quelques semaines.", "Suggest catching up in a few weeks."), reponse: c.cible ? T("Avec plaisir. Envoyez-moi deux créneaux, je regarderai.", "With pleasure. Send me two time slots, I'll have a look.") : T("Volontiers pour un café, mais je n'aurai pas de projet logiciel, vous savez !", "Happy to have a coffee, but I won't have a software project, you know!"), journal: c.cible ? T("relance douce proposée à un contact cible.", "gentle follow-up suggested to a target contact.") : T("contact hors cible entretenu sans pression.", "non-target contact kept warm without pressure.") },
      { label: T("Échanger quelques mots et lui souhaiter un bon rendez-vous.", "Exchange a few words and wish them a good meeting."), reponse: T("Merci, bonne journée à vous !", "Thanks, have a good day!") }
    ], T("Rencontre", "Encounter"));
    return;
  }
  const intro = EN
    ? `${lieu}. ${c.nom} (${c.fonction}, ${c.entreprise}) is waiting for a meeting elsewhere in the building. Your eyes meet; they smile.`
    : `${lieu}. ${c.nom} (${c.fonction}, ${c.entreprise}) attend un rendez-vous dans l'immeuble. Vos regards se croisent, ${f.def.genre === "f" ? "elle" : "il"} vous sourit.`;
  const ajouterCarte = () => {
    if (!resultats.reseauExterne.includes(f.def.contact)) resultats.reseauExterne.push(f.def.contact);
    sauverResultats();
    son("succes");
    message(EN ? `Business card added to your contacts book (${resultats.reseauExterne.length}) · P key: building map` : `Carte de visite ajoutée à votre carnet (${resultats.reseauExterne.length}) · touche P : plan de l'immeuble`, "ok", 3600);
  };
  dialogueFigurant(f, intro, melangerChoix([
    { label: T("Engager la conversation et vous intéresser à son activité.", "Start a conversation and take an interest in their work."), posture: 1, journal: T("écoute avant de parler de soi.", "listening before talking about yourself."),
      reponse: () => c.besoin,
      complement: () => `${c.entreprise} · ${c.secteur}.\n\n` + (c.cible ? T("Vous écoutez sans pitcher. Avant de partir, elle ou il vous tend sa carte : « Appelez-moi, ça m'intéresse d'en parler. » Bonne piste : profil conforme à la cible Veltis.", "You listen without pitching. Before leaving, they hand you their card: “Call me, I'd like to talk about it.” Good lead: matches the Veltis target profile.")
        : T("Vous écoutez sans pitcher et échangez vos cartes. Contact sympathique, mais hors cible : inutile de le relancer commercialement.", "You listen without pitching and swap cards. Friendly contact, but not a target: no point in a sales follow-up.")),
      avant: ajouterCarte },
    { label: T("Lui présenter Veltis One en détail, plaquette à l'appui.", "Present Veltis One in detail, brochure in hand."), posture: -1, reflexe: T("Pitch produit imposé à un inconnu au café.", "Product pitch forced on a stranger at the café."), journal: T("pitch imposé sans découverte.", "pitch forced without discovery."),
      reponse: T("Euh… merci, mais je ne suis pas vraiment venu pour ça.", "Er… thanks, but that's not really why I'm here."), avant: () => { f.froid = jeu.def ? jeu.def.id : "libre"; f.fin = vie.temps + 2; } },
    { label: T("Lui demander directement son budget logiciel de l'année.", "Ask straight away about their software budget for the year."), posture: -1, reflexe: T("Question de budget posée avant toute relation.", "Budget question asked before any relationship."), journal: T("question budget prématurée.", "premature budget question."),
      reponse: T("C'est un peu direct, non ? On se connaît depuis deux minutes…", "That's a bit direct, isn't it? We've known each other for two minutes…"), avant: () => { f.froid = jeu.def ? jeu.def.id : "libre"; f.fin = vie.temps + 2; } },
    { label: T("Lui adresser un sourire et lui souhaiter un bon rendez-vous.", "Smile and wish them a good meeting."), reponse: T("Merci, c'est gentil. Bonne journée !", "Thanks, that's kind. Have a good day!") }
  ]), T("Rencontre", "Encounter"));
}

/* Veltis Academy : formation flash de trois questions */
const QUESTIONS_ACADEMY = [
  { q: T("Un contact a téléchargé un livre blanc. C'est…", "A contact downloaded a white paper. They are…"), r: [[T("un lead à qualifier", "a lead to qualify"), true], [T("une opportunité à chiffrer", "an opportunity to quote"), false], [T("un client prêt à signer", "a customer ready to sign"), false]], e: T("Un téléchargement, c'est de la curiosité : il faut d'abord qualifier (besoin, décideur, budget, échéance).", "A download is curiosity: you need to qualify first (need, decision-maker, budget, timing).") },
  { q: T("Avec BANT, un lead est sérieux à partir de…", "With BANT, a lead is serious from…"), r: [[T("3 critères sur 4, dont le besoin", "3 criteria out of 4, including need"), true], [T("dès qu'il a un budget", "as soon as they have a budget"), false], [T("dès qu'il accepte un rendez-vous", "as soon as they accept a meeting"), false]], e: T("Sans besoin réel, il n'y a pas d'affaire, même avec un budget.", "Without a real need there's no deal, even with a budget.") },
  { q: T("Quel client crée le plus de valeur ?", "Which customer creates the most value?"), r: [[T("20 k€ par an, fidèle 5 ans", "€20k a year, loyal for 5 years"), true], [T("35 k€ signé à −25 %, parti après un an", "€35k signed at −25%, gone after a year"), false], [T("Les deux se valent", "They're worth the same"), false]], e: T("CLV = ARR × marge × durée de vie : la durée de la relation pèse plus que la signature.", "CLV = ARR × margin × lifetime: how long the relationship lasts weighs more than the signature.") },
  { q: T("Les questions d'implication (SPIN) servent à…", "Implication questions (SPIN) are used to…"), r: [[T("faire mesurer au client l'impact de son problème", "make the customer measure the impact of their problem"), true], [T("présenter le produit", "present the product"), false], [T("négocier le prix", "negotiate the price"), false]], e: T("C'est là que le client prend conscience de la valeur : il se convainc lui-même.", "That's where the customer realises the value: they convince themselves.") },
  { q: T("Le client demande 15 % de remise. La réponse qui fait signer durablement :", "The customer asks for a 15% discount. The answer that signs for the long term:"), r: [[T("demander une contrepartie (engagement, volume, date)", "ask for something in return (commitment, volume, date)"), true], [T("accorder pour signer ce mois-ci", "grant it to sign this month"), false], [T("refuser sans discuter", "refuse without discussion"), false]], e: T("Donnant-donnant : une concession n'est jamais gratuite.", "Give and take: a concession is never free.") },
  { q: T("Une objection sur le prix cache souvent…", "A price objection often hides…"), r: [[T("une valeur mal perçue", "poorly perceived value"), true], [T("un client de mauvaise foi", "a customer acting in bad faith"), false], [T("un concurrent qu'il faut dénigrer", "a competitor you should disparage"), false]], e: T("Reformulez, questionnez, puis prouvez la valeur avec un exemple concret.", "Rephrase, ask questions, then prove the value with a concrete example.") },
  { q: T("Juste après la signature, le bon commercial…", "Right after signing, a good sales rep…"), r: [[T("présente le Customer Success et suit le démarrage", "introduces Customer Success and follows the start-up"), true], [T("passe au prospect suivant", "moves on to the next prospect"), false], [T("propose aussitôt une montée en gamme", "immediately offers an upgrade"), false]], e: T("La relation commence à la signature : une passation soignée protège le renouvellement.", "The relationship starts at signature: a careful handover protects the renewal.") },
  { q: T("Vendre 80 licences à un client qui en utilisera 40…", "Selling 80 licences to a customer who will use 40…"), r: [[T("augmente le risque de départ au renouvellement", "increases the risk of churn at renewal"), true], [T("maximise la CLV", "maximises CLV"), false], [T("n'a aucun effet", "has no effect"), false]], e: T("Un client sur-équipé n'utilise pas ce qu'il paie… et ne renouvelle pas.", "An over-equipped customer doesn't use what they pay for… and doesn't renew.") }
];
const academyFaite = new Set();
function accueilAcademy(f) {
  const meilleur = resultats.academy ? resultats.academy.meilleur : null;
  dialogueFigurant(f, EN ? `“Welcome to the Veltis Academy! I run a quick 3-question course on the funnel and customer value. It takes about ten minutes.”${meilleur !== null ? ` Your best score: ${meilleur}/3.` : ""}` : `« Bienvenue à la Veltis Academy ! Je propose une formation flash de trois questions sur le tunnel et la valeur client. Comptez une dizaine de minutes. »${meilleur !== null ? ` Votre meilleur score : ${meilleur}/3.` : ""}`, [
    { label: T("Suivre la formation flash (3 questions).", "Take the quick course (3 questions)."), action: () => lancerQuiz(f) },
    { label: T("Lui demander ce que les nouveaux commerciaux trouvent le plus difficile.", "Ask what new sales reps find hardest."), reponse: T("Se taire et écouter. Tout le monde veut présenter le produit ; les meilleurs posent d'abord des questions.", "Keeping quiet and listening. Everyone wants to present the product; the best ask questions first.") },
    { label: T("Revenir plus tard.", "Come back later."), reponse: T("La porte est toujours ouverte !", "The door is always open!") }
  ], "Veltis Academy");
}
function lancerQuiz(f) {
  if (jeu.def) avancerTemps(10);
  const questions = melanger(QUESTIONS_ACADEMY, Math.random).slice(0, 3);
  let score = 0;
  const poser_ = k => {
    const q = questions[k];
    ouvrirEntretien({
      interlocuteur: interlocuteurFigurant(f), canal: "Veltis Academy", focus: f.mesh,
      texte: `${T("Question", "Question")} ${k + 1}/3 — ${q.q}`,
      choix: melangerChoix(q.r.map(([label, juste]) => ({ label, action: () => {
        if (juste) { score++; son("succes"); } else son("erreur");
        ouvrirEntretien({
          interlocuteur: interlocuteurFigurant(f), canal: "Veltis Academy", focus: f.mesh,
          texte: `${juste ? T("Exact !", "Correct!") : T("Pas tout à fait.", "Not quite.")} ${q.e}`,
          choix: [{ label: k < 2 ? T("Question suivante", "Next question") : T("Voir le résultat", "See the result"), action: () => (k < 2 ? poser_(k + 1) : finQuiz(f, score)) }]
        });
      } })))
    });
  };
  poser_(0);
}
function finQuiz(f, score) {
  resultats.academy = resultats.academy || { meilleur: 0, sessions: 0 };
  resultats.academy.sessions++;
  resultats.academy.meilleur = Math.max(resultats.academy.meilleur, score);
  sauverResultats();
  const id = jeu.def ? jeu.def.id : "libre";
  let bonus = "";
  if (!academyFaite.has(id) && score >= 2) {
    academyFaite.add(id);
    deplacerPosture(score === 3 ? 2 : 1);
    bonus = score === 3 ? T("Vous progressez dans le tunnel : vous appliquerez ces réflexes en rendez-vous.", "You move forward in the funnel: you'll apply these reflexes in meetings.") : T("Vous progressez un peu dans le tunnel.", "You move forward a little in the funnel.");
  }
  noter(score >= 2 ? "ok" : "info", EN ? `Veltis Academy: quick course passed with ${score}/3.` : `Veltis Academy : formation flash réussie à ${score}/3.`);
  ouvrirEntretien({
    interlocuteur: interlocuteurFigurant(f), canal: "Veltis Academy", focus: f.mesh,
    texte: `${EN ? `“${score}/3. ${score === 3 ? "Perfect, you've mastered the conversion funnel!" : score === 2 ? "Well done, just one point to review." : "Let's go over these points again together."}”` : `« ${score}/3. ${score === 3 ? "Parfait, vous maîtrisez le tunnel de conversion !" : score === 2 ? "Bravo, un seul point à revoir." : "On reprendra ces points ensemble."} »`}${bonus ? `\n\n${bonus}` : ""}`,
    choix: [{ label: T("Remercier et repartir", "Say thanks and leave"), action: () => finEchangeFigurant(f) }]
  });
}

/* ---------- J16. Documents consultables dans l'immeuble ---------- */
function ouvrirShowroom() {
  const lignes = Object.values(PAINS).map(p => `<tr><td>${echapper(p.court)}</td><td><strong>${echapper(MODULES[p.module].nom)}</strong><br><span class="cc-detail">${echapper(MODULES[p.module].detail)}</span></td></tr>`).join("");
  ouvrirFenetre({
    titre: T("Showroom · Veltis One", "Showroom · Veltis One"), sousTitre: T("Borne de démonstration · du problème client au module", "Demo kiosk · from customer problem to module"),
    corps: `<p>${T("Chaque module répond à un problème précis. En rendez-vous, partez du problème exprimé par le client et ne montrez que les modules qui y répondent.", "Each module solves a specific problem. In a meeting, start from the problem the customer expressed and only show the modules that address it.")}</p>
      <table class="guide-table"><thead><tr><th>${T("Problème exprimé", "Problem expressed")}</th><th>${T("Module qui y répond", "Module that addresses it")}</th></tr></thead><tbody>${lignes}</tbody></table>`,
    large: true, navigation: "document", boutons: [{ label: T("Fermer", "Close"), classe: "btn-principal", action: fermerFenetre }]
  });
}
function ouvrirActualites() {
  const derniers = resultats.historique.slice(-4).reverse();
  const vos = derniers.length
    ? `<ul class="liste">${derniers.map(h => `<li><strong>${echapper(h.etape)}</strong> · ${echapper(h.statut || "")} · ${echapper(String(h.score ?? ""))}/100</li>`).join("")}</ul>`
    : `<p class="cc-detail">${T("Vos premiers résultats de mission apparaîtront ici.", "Your first mission results will appear here.")}</p>`;
  ouvrirFenetre({
    titre: T("Actualités Veltis", "Veltis news"), sousTitre: T("Écran du hall d'accueil", "Main lobby screen"),
    corps: `<ul class="liste">
        <li>${T("<strong>Signature</strong> · Batinord renouvelle pour 3 ans grâce au suivi de son Customer Success Manager.", "<strong>Deal</strong> · Batinord renews for 3 years thanks to its Customer Success Manager's follow-up.")}</li>
        <li>${T("<strong>Satisfaction</strong> · NPS à 47 ce trimestre, churn à 4,1 % (objectif : moins de 5 %).", "<strong>Satisfaction</strong> · NPS at 47 this quarter, churn at 4.1% (target: under 5%).")}</li>
        <li>${T("<strong>Événement</strong> · Matinale « Solutions PME » jeudi au Forum Veltis (R+1).", "<strong>Event</strong> · “SME Solutions” breakfast on Thursday at the Veltis Forum (level 1).")}</li>
        <li>${T("<strong>Academy</strong> · Formation flash « Du prospect au client » au R+2 avec Claire Fontaine.", "<strong>Academy</strong> · Quick course “From prospect to customer” on level 2 with Claire Fontaine.")}</li>
      </ul><h4>${T("Vos dernières missions", "Your latest missions")}</h4>${vos}`,
    navigation: "document", boutons: [{ label: T("Fermer", "Close"), classe: "btn-principal", action: fermerFenetre }]
  });
}
function ouvrirSatisfaction() {
  const lignes = POSTURES.map(p => { const v = p.min + 12; return `<tr><td><strong>${p.icone} · ${echapper(p.nom)}</strong></td><td>${ansTexte(dureeViePosture(v))}</td><td>${euros(clvPosture(v))}</td></tr>`; }).join("");
  ouvrirFenetre({
    titre: T("Satisfaction et fidélité clients", "Customer satisfaction and loyalty"), sousTitre: T("Service clients · R+2", "Customer Care · level 2"),
    corps: `<p>${T("Le service clients voit arriver les conséquences de chaque vente : un client bien conseillé appelle pour progresser, un client sur-équipé appelle pour se plaindre.", "Customer Care sees the consequences of every sale: a well-advised customer calls to make progress, an over-equipped customer calls to complain.")}</p>
      <table class="guide-table"><thead><tr><th>${T("Étape atteinte dans le tunnel", "Funnel stage reached")}</th><th>${T("Durée de vie client projetée", "Projected customer lifetime")}</th><th>${T("CLV d'un client type", "CLV of a typical customer")}</th></tr></thead><tbody>${lignes}</tbody></table>
      <p class="cc-detail">${T("Votre étape actuelle", "Your current stage")} : <strong>${echapper(posture().nom)}</strong> · ${ansTexte(dureeViePosture(jeu.posture))}.</p>`,
    large: true, navigation: "document", boutons: [{ label: T("Fermer", "Close"), classe: "btn-principal", action: fermerFenetre }]
  });
}
function ouvrirFeuilleRoute() {
  const items = [
    [T("Relances automatiques des devis", "Automatic quote follow-ups"), T("Disponible", "Available"), "ok"],
    [T("Application mobile hors connexion", "Offline mobile app"), T("Disponible", "Available"), "ok"],
    [T("Connecteur e-commerce", "E-commerce connector"), T("En test avec 3 clients pilotes (T3)", "Testing with 3 pilot customers (Q3)"), "alerte"],
    [T("Prévisions assistées", "Assisted forecasting"), T("À confirmer (T4)", "To be confirmed (Q4)"), "ko"]
  ];
  ouvrirFenetre({
    titre: T("Feuille de route Veltis One", "Veltis One roadmap"), sousTitre: "Veltis Lab · R+2",
    corps: `<table class="guide-table"><thead><tr><th>${T("Fonction", "Feature")}</th><th>${T("Statut", "Status")}</th></tr></thead><tbody>${items.map(([a, b, c]) => `<tr><td>${echapper(a)}</td><td><span class="statut-${c}">${echapper(b)}</span></td></tr>`).join("")}</tbody></table>
      <p>${T("Règle d'or : on ne vend que ce qui est disponible. Une fonction « à confirmer » ne se promet jamais à un client : elle se mentionne, au mieux, comme une piste, avec l'accord de l'équipe produit.", "Golden rule: you only sell what is available. A “to be confirmed” feature is never promised to a customer: at most it's mentioned as a possibility, with the product team's agreement.")}</p>`,
    navigation: "document", boutons: [{ label: T("Fermer", "Close"), classe: "btn-principal", action: fermerFenetre }]
  });
}

/* Objets interactifs des trois niveaux (ascenseurs, bornes, écrans…) */
function ajouterObjetsImmeuble() {
  ETAGES.forEach(e => CABINES.forEach((zc, i) => OBJETS_ETAGE.push({ etage: e.niveau, x: 3.95, z: zc, rayon: 1.25, label: T("prendre l'ascenseur", "take the lift"), action: () => entrerAscenseur(i) })));
  OBJETS_ETAGE.push(
    { etage: 0, x: 10.2, z: 11.9, rayon: 1.5, label: T("sortir sur l'esplanade", "go out onto the Esplanade"), action: () => message(T("La journée n'est pas finie : vos prospects vous attendent dans l'immeuble.", "The day isn't over: your prospects are waiting for you in the building."), "info", 3000) },
    { etage: 0, x: 12.4, z: 3.8, rayon: 1.6, label: T("lire les actualités Veltis", "read the Veltis news"), action: ouvrirActualites },
    { etage: 0, x: 1.2, z: 4.75, rayon: 1.4, label: T("consulter le plan de l'immeuble", "check the building map"), action: ouvrirPlan },
    { etage: 0, x: -12.6, z: -10.0, rayon: 1.8, label: T("lire le programme de l'auditorium", "read the auditorium programme"), action: () => message(T("Programme : matinale « Solutions PME » jeudi 8 h 30 · keynote de fin de trimestre vendredi 17 h.", "Programme: “SME Solutions” breakfast Thursday 8:30 · end-of-quarter keynote Friday 5 pm."), "info", 4200) },
    { etage: 2, x: -2.0, z: -5.0, rayon: 1.6, label: T("consulter le mur de la valeur client", "check the customer value wall"), action: ouvrirTableauEquipe },
    { etage: 2, x: -17.5, z: 2.0, rayon: 1.6, label: T("lire les indicateurs de satisfaction", "read the satisfaction indicators"), action: ouvrirSatisfaction },
    { etage: 2, x: -12.6, z: 11.3, rayon: 1.5, label: T("consulter une fiche méthode", "read a method sheet"), action: ouvrirFiche },
    { etage: 2, x: 12.6, z: -11.5, rayon: 1.5, label: T("lire la feuille de route produit", "read the product roadmap"), action: ouvrirFeuilleRoute },
    { etage: 2, x: 17.2, z: 8.0, rayon: 1.3, label: T("prendre un café au bar", "grab a coffee at the bar"), action: () => { avancerTemps(4); message(T("Café pris au Belvédère. Vue imprenable sur l'esplanade et la Grande Arche.", "Coffee at the Belvédère. A stunning view of the Esplanade and the Grande Arche."), "info", 3000); } },
    { etage: 2, x: 9.0, z: 12.0, rayon: 1.5, label: T("admirer la vue depuis le Belvédère", "enjoy the view from the Belvédère"), action: () => message(T("Les tours de La Défense se reflètent les unes dans les autres ; au bout de l'esplanade, la Grande Arche. Une respiration avant la suite.", "The towers of La Défense reflect in one another; at the end of the Esplanade, the Grande Arche. A breather before what's next."), "info", 4200) }
  );
  [[8.8, -9.2], [12.6, -10.2], [16.4, -9.2], [8.8, -4.6], [16.4, -4.6]].forEach(([x, z]) => OBJETS_ETAGE.push({ etage: 0, x, z: z + 0.55, rayon: 1.2, label: T("consulter la borne Veltis One", "use the Veltis One kiosk"), action: ouvrirShowroom }));
}


/* =====================================================================
   PARTIE K — ÉQUIPE COMMERCIALE, TABLEAU DE BORD ET ANIMATIONS DU TUNNEL
   ---------------------------------------------------------------------
   Sept commerciaux de Veltis (plateau R+1 et pôle grands comptes du R+2)
   servent de points de comparaison. Leurs chiffres suivent le même modèle
   que ceux du participant : volume de prospects × taux de conversion de
   chaque étape × panier moyen × (1 − remise). Le tableau de bord (touche K)
   compare CA, CA prévisionnel, marge, rentabilité et conversion.
   ===================================================================== */

/* ---------- K1. Commerciaux et modèle de calcul ---------- */
const COMMERCIAUX = [
  { cle: "thomas", volume: 110, taux: [0.30, 0.45, 0.42], remise: 0.18, retention: 0.62, panier: 1.0, cout: 28500, cycle: 52, objectif: 6, saison: [0.9, 1.05, 0.95, 1.12, 1.0, 1.15],
    conseil: T("Je fais du volume, mais mes remises me coûtent cher au renouvellement.", "I do volume, but my discounts cost me dearly at renewal.") },
  { cle: "sofia", volume: 45, taux: [0.40, 0.55, 0.50], remise: 0.06, retention: 0.96, panier: 2.4, cout: 33000, cycle: 74, objectif: 4, saison: [0.85, 0.9, 1.0, 1.05, 1.1, 1.2],
    conseil: T("Peu de comptes, mais je verrouille la date de décision et toutes les étapes de validation.", "Few accounts, but I lock in the decision date and every approval step.") },
  { cle: "amelie", volume: 160, taux: [0.25, 0.40, 0.38], remise: 0.09, retention: 0.90, panier: 0.8, cout: 21600, cycle: 38, objectif: 6, saison: [1.0, 1.0, 1.05, 0.95, 1.1, 1.1],
    conseil: T("Au téléphone, je reformule toujours le besoin avant de proposer quoi que ce soit.", "On the phone, I always rephrase the need before proposing anything.") },
  { cle: "bastien", volume: 130, taux: [0.28, 0.42, 0.40], remise: 0.12, retention: 0.80, panier: 1.0, cout: 24600, cycle: 47, objectif: 6, saison: [0.95, 1.0, 1.1, 0.9, 1.05, 1.0],
    conseil: T("Mes meilleures opportunités viennent des recommandations de clients satisfaits.", "My best opportunities come from satisfied customers' referrals.") },
  { cle: "maxime", volume: 260, taux: [0.32, 0.35, 0.08], remise: 0.10, retention: 0.82, panier: 0.9, cout: 16800, cycle: 30, objectif: 2, saison: [1.0, 1.1, 0.95, 1.05, 1.0, 1.05],
    conseil: T("Je qualifie vite (besoin, décideur, budget, échéance) et je passe les opportunités aux commerciaux.", "I qualify fast (need, decision-maker, budget, timing) and hand opportunities to the reps.") },
  { cle: "antoine", nom: "Antoine Leclerc", fonction: T("Responsable grands comptes", "Key Account Manager"), ou: "R+2", volume: 40, taux: [0.42, 0.50, 0.48], remise: 0.10, retention: 0.88, panier: 2.6, cout: 34500, cycle: 80, objectif: 4, saison: [1.1, 0.8, 1.0, 1.2, 0.9, 1.15],
    conseil: T("Sur un grand compte, je ne présente rien avant d'avoir rencontré le décideur et le DAF.", "On a key account, I present nothing before meeting the decision-maker and the CFO.") },
  { cle: "nora", nom: "Nora Benamar", fonction: T("Commerciale terrain", "Field Sales Rep"), ou: "R+2", volume: 120, taux: [0.31, 0.47, 0.44], remise: 0.07, retention: 0.93, panier: 1.1, cout: 27000, cycle: 45, objectif: 6, saison: [0.92, 1.0, 1.04, 1.08, 1.1, 1.14],
    conseil: T("Je ne concède jamais une remise sans contrepartie : engagement, volume ou date.", "I never concede a discount without something in return: commitment, volume or date.") }
];
COMMERCIAUX.forEach(c => {
  const d = COLLEGUES_DEF[c.cle];
  if (d) Object.assign(c, { nom: d.nom, fonction: d.fonction, ou: "R+1" });
});
const MOIS_TABLEAU = (() => {
  const maintenant = new Date();
  return [5, 4, 3, 2, 1, 0].map(k => new Date(maintenant.getFullYear(), maintenant.getMonth() - k, 1).toLocaleDateString(LOCALE, { month: "short" }).replace(".", ""));
})();
const dureeRetention = r => Math.min(8, 1 / Math.max(0.125, 1 - r));
// Indicateurs d'un commercial à partir de son volume, de ses taux, de son panier et de ses remises
function indicateurs(c) {
  const arr = ARR_REFERENCE() * c.panier;
  const [t1, t2, t3] = c.taux;
  const mensuel = c.saison.map((k, m) => {
    const q = c.qualite ? c.qualite[m] : 1;
    const remise = c.remises ? c.remises[m] : c.remise;
    const clients = c.volume * t1 * t2 * t3 * k * q;
    return { clients, ca: clients * arr * (1 - remise), brut: clients * arr };
  });
  const signees = (vie.signatures || []).filter(x => x.cle === c.cle).reduce((s, x) => s + x.montant, 0);
  if (signees) { mensuel[5].ca += signees; mensuel[5].brut += signees; mensuel[5].clients += signees / arr; }
  const ca = mensuel.reduce((s, x) => s + x.ca, 0);
  const brut = mensuel.reduce((s, x) => s + x.brut, 0);
  const clients = mensuel.reduce((s, x) => s + x.clients, 0);
  const t1er = mensuel.slice(0, 3).reduce((s, x) => s + x.ca, 0), t2e = mensuel.slice(3).reduce((s, x) => s + x.ca, 0);
  const remiseFinale = c.remises ? c.remises[5] : c.remise;
  const tendance = c.saison[5] * (c.qualite ? c.qualite[5] : 1);
  const opportunites = c.volume * t1 * t2;
  const previsionnel = 3 * opportunites * t3 * arr * (1 - remiseFinale) * tendance;
  const objectifTrimestre = 3 * c.objectif * arr;
  const marge = ca * MARGE_BRUTE;
  const couts = c.cout * 6;
  return Object.assign({}, c, {
    arr, mensuel, ca, clients, evolution: t1er ? (t2e - t1er) / t1er * 100 : 0, previsionnel, objectifTrimestre,
    couverture: previsionnel / objectifTrimestre * 100, atteinte: t2e / objectifTrimestre * 100,
    marge, remisesPerdues: brut - ca, couts, contribution: marge - couts, rentabilite: (marge - couts) / couts * 100,
    conversion: t1 * t2 * t3 * 100, opportunites, leads: c.volume * t1, clientsMois: c.volume * t1 * t2 * t3,
    clv: ca * MARGE_BRUTE * dureeRetention(c.retention), remiseMoyenne: (c.remises ? c.remises.reduce((s, x) => s + x, 0) / 6 : c.remise) * 100
  });
}
// Le participant : taux mesurés dans ses missions, progression dans le tunnel pour la qualité et les remises
function commercialJoueur() {
  const profil = resultats.profil;
  const tn = resultats.tunnels[profil];
  const defauts = [0.22, 0.35, 0.30];
  const mesures = [1, 2, 3].map(i => (tn[i] && tn[i].entree ? tn[i].taux / 100 : null));
  const taux = mesures.map((t, i) => clamp(t ?? defauts[i], 0.03, 0.9));
  const volume = tn[0] && tn[0].entree ? clamp(Math.round(400 * tn[0].taux / 100), 40, 240) : 120;
  const traj = resultats.trajectoire[profil].map(t => t.apres);
  const valeurs = Array(6).fill(POSTURE_DEPART).concat(traj).slice(-6);
  return {
    cle: "moi", moi: true, nom: resultats.nom || T("Vous", "You"), fonction: PROFILS[profil].nom, ou: T("votre poste", "your desk"),
    volume, taux, estime: mesures.map(t => t === null), panier: 1.0, cout: 23400, cycle: 50, objectif: 5,
    saison: [1, 1, 1, 1, 1, 1], qualite: valeurs.map(v => 0.7 + 0.3 * v / 100), remises: valeurs.map(v => 0.18 - 0.13 * v / 100),
    retention: 0.55 + 0.4 * resultats.posture[profil] / 100, remise: 0.18 - 0.13 * resultats.posture[profil] / 100,
    conseil: ""
  };
}
function donneesEquipe() {
  const liste = COMMERCIAUX.map(indicateurs).concat([indicateurs(commercialJoueur())]);
  const moyenne = cle => liste.filter(x => !x.moi).reduce((s, x) => s + x[cle], 0) / (liste.length - 1);
  return { liste, moyenne, moi: liste.find(x => x.moi) };
}
const keuros = v => (Math.abs(v) >= 1e6 ? (EN ? `€${decimal((v / 1e6).toFixed(2))}m` : `${decimal((v / 1e6).toFixed(2))} M€`) : (EN ? `€${nombre(v / 1000)}k` : `${nombre(v / 1000)} k€`));
const signe = v => `${v >= 0 ? "+" : "−"}${pourcent(Math.abs(v))}`;

/* ---------- K2. Graphiques (SVG, info-bulles au survol, valeurs écrites) ---------- */
const COULEURS_KPI = { moi: "#2a78d6", autre: "#b6bfcc", moyenne: "#eb6834", meilleur: "#1baf7a", objectif: "#0b0b0b" };
function barresH(lignes, format, { cible = null, legendeCible = "" } = {}) {
  const L = 640, gauche = 150, droite = 92, h = 26, haut = 8;
  const max = Math.max(...lignes.map(l => Math.abs(l.valeur)), cible || 0) || 1;
  const min = Math.min(0, ...lignes.map(l => l.valeur));
  const plage = max - min || 1;
  const x = v => gauche + (v - min) / plage * (L - gauche - droite);
  const H = haut * 2 + lignes.length * h;
  const barres = lignes.map((l, i) => {
    const y = haut + i * h;
    const x0 = x(Math.min(0, l.valeur)), x1 = x(Math.max(0, l.valeur));
    const larg = Math.max(2, x1 - x0);
    return `<g class="kpi-ligne${l.moi ? " moi" : ""}"><title>${echapper(l.label)} : ${echapper(format(l.valeur))}</title>
      <rect class="kpi-cible-survol" x="0" y="${y}" width="${L}" height="${h}" fill="transparent"></rect>
      <text x="${gauche - 10}" y="${y + h / 2 + 4}" text-anchor="end" class="kpi-label">${echapper(l.label)}</text>
      <rect x="${x0}" y="${y + 5}" width="${larg}" height="${h - 10}" rx="4" fill="${l.moi ? COULEURS_KPI.moi : COULEURS_KPI.autre}"></rect>
      <text x="${x1 + 6}" y="${y + h / 2 + 4}" class="kpi-valeur">${echapper(format(l.valeur))}</text></g>`;
  }).join("");
  const zero = min < 0 ? `<line x1="${x(0)}" x2="${x(0)}" y1="${haut}" y2="${H - haut}" class="kpi-axe"></line>` : "";
  const ligneCible = cible ? `<line x1="${x(cible)}" x2="${x(cible)}" y1="${haut - 4}" y2="${H - haut + 4}" class="kpi-objectif"><title>${echapper(legendeCible)}</title></line>` : "";
  return `<svg class="kpi-svg" viewBox="0 0 ${L} ${H}" role="img" preserveAspectRatio="xMinYMin meet">${zero}${barres}${ligneCible}</svg>`;
}
function courbes(series, etiquettes, format) {
  const L = 640, H = 240, g = 64, d = 118, h = 18, b = 30;
  const toutes = series.flatMap(s => s.valeurs);
  const max = Math.max(...toutes) * 1.1 || 1;
  const x = i => g + i / (etiquettes.length - 1) * (L - g - d);
  const y = v => H - b - v / max * (H - b - h);
  const grille = [0, 0.5, 1].map(k => `<line x1="${g}" x2="${L - d}" y1="${y(max * k / 1.1)}" y2="${y(max * k / 1.1)}" class="kpi-grille"></line><text x="${g - 8}" y="${y(max * k / 1.1) + 4}" text-anchor="end" class="kpi-axe-texte">${echapper(format(max * k / 1.1))}</text>`).join("");
  const axeX = etiquettes.map((e, i) => `<text x="${x(i)}" y="${H - 10}" text-anchor="middle" class="kpi-axe-texte">${echapper(e)}</text>`).join("");
  const traces = series.map(s => {
    const pts = s.valeurs.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
    const marques = s.valeurs.map((v, i) => `<circle cx="${x(i)}" cy="${y(v)}" r="${s.epais ? 5 : 4}" fill="${s.couleur}" stroke="#ffffff" stroke-width="2"><title>${echapper(s.nom)} · ${echapper(etiquettes[i])} : ${echapper(format(v))}</title></circle>`).join("");
    const fin = s.valeurs[s.valeurs.length - 1];
    return `<polyline points="${pts}" fill="none" stroke="${s.couleur}" stroke-width="${s.epais ? 3 : 2}" stroke-linejoin="round"></polyline>${marques}
      <text x="${x(etiquettes.length - 1) + 10}" y="${y(fin) + 4}" class="kpi-label-fin">${echapper(s.nom)}</text>`;
  }).join("");
  const legende = `<div class="kpi-legende">${series.map(s => `<span><i style="background:${s.couleur}"></i>${echapper(s.nom)}</span>`).join("")}</div>`;
  return `${legende}<svg class="kpi-svg" viewBox="0 0 ${L} ${H}" role="img" preserveAspectRatio="xMinYMin meet">${grille}${axeX}${traces}</svg>`;
}
const tuileKpi = (label, valeur, detail, ton = "") => `<div class="kpi-tuile ${ton}"><span class="kpi-tuile-label">${echapper(label)}</span><strong>${echapper(valeur)}</strong><small>${detail}</small></div>`;

/* ---------- K3. Tableau de bord commercial ---------- */
const ONGLETS_KPI = [
  ["synthese", T("Synthèse", "Overview")], ["ca", T("Évolution du CA", "Revenue trend")], ["previsionnel", T("CA prévisionnel", "Forecast")],
  ["marge", T("Marge et rentabilité", "Margin and profitability")], ["tunnel", T("Tunnel de conversion", "Conversion funnel")]
];
function contenuKpi(onglet) {
  const { liste, moyenne, moi } = donneesEquipe();
  const tri = cle => liste.slice().sort((a, b) => b[cle] - a[cle]);
  const lignes = (cle, l = tri(cle)) => l.map(x => ({ label: x.moi ? T("Vous", "You") : x.nom, valeur: x[cle], moi: x.moi }));
  const rang = cle => tri(cle).findIndex(x => x.moi) + 1;
  const compare = (v, m, fmt) => `${T("Moy. équipe", "Team avg.")} ${fmt(m)} · <span class="${v >= m ? "kpi-plus" : "kpi-moins"}">${v >= m ? "▲" : "▼"} ${fmt(Math.abs(v - m))}</span>`;
  const note = `<p class="cc-detail kpi-note">${T("Vos chiffres sont projetés à partir de vos taux de conversion mesurés en mission (étapes non jouées : valeurs de débutant, marquées *) et de votre progression dans le tunnel, qui fixe vos remises et la qualité de vos signatures. CA = nouveaux contrats signés (ARR), sur les six derniers mois.", "Your figures are projected from the conversion rates measured in your missions (stages not yet played: beginner values, marked *) and from your funnel progress, which sets your discounts and the quality of your signatures. Revenue = new contracts signed (ARR) over the last six months.")}</p>`;
  if (onglet === "synthese") {
    const tableau = tri("ca").map((x, i) => `<tr${x.moi ? ' class="ligne-moi"' : ""}><td class="rang">${i + 1}</td><td><strong>${echapper(x.moi ? T("Vous", "You") : x.nom)}</strong><br><span class="cc-detail">${echapper(x.fonction)} · ${echapper(x.ou)}</span></td>
      <td>${keuros(x.ca)}</td><td class="${x.evolution >= 0 ? "kpi-plus" : "kpi-moins"}">${signe(x.evolution)}</td><td>${keuros(x.previsionnel)}</td><td>${pourcent(x.atteinte)}</td><td>${keuros(x.marge)}</td><td class="${x.rentabilite >= 0 ? "kpi-plus" : "kpi-moins"}">${signe(x.rentabilite)}</td><td>${pourcentPrecis(x.conversion)}</td><td>${pourcent(x.remiseMoyenne)}</td><td>${pourcent(x.retention * 100)}</td></tr>`).join("");
    return `<div class="kpi-tuiles">
        ${tuileKpi(T("CA signé · 6 mois", "Revenue signed · 6 months"), keuros(moi.ca), compare(moi.ca, moyenne("ca"), keuros), moi.ca >= moyenne("ca") ? "bon" : "")}
        ${tuileKpi(T("Évolution du CA", "Revenue trend"), signe(moi.evolution), T("3 derniers mois vs 3 précédents", "last 3 months vs previous 3"), moi.evolution >= 0 ? "bon" : "faible")}
        ${tuileKpi(T("CA prévisionnel · trimestre", "Forecast · quarter"), keuros(moi.previsionnel), compare(moi.previsionnel, moyenne("previsionnel"), keuros))}
        ${tuileKpi(T("Marge brute · 6 mois", "Gross margin · 6 months"), keuros(moi.marge), `${T("taux", "rate")} ${pourcent(MARGE_BRUTE * 100)} · ${T("remises", "discounts")} −${keuros(moi.remisesPerdues)}`)}
        ${tuileKpi(T("Rentabilité commerciale", "Sales profitability"), signe(moi.rentabilite), T("(marge − coût commercial complet) / coût", "(margin − full sales cost) / cost"), moi.rentabilite >= moyenne("rentabilite") ? "bon" : "faible")}
        ${tuileKpi(T("Conversion prospect → client", "Prospect → customer conversion"), pourcentPrecis(moi.conversion), compare(moi.conversion, moyenne("conversion"), v => pourcentPrecis(v)))}
        ${tuileKpi(T("Rang dans l'équipe (CA)", "Team rank (revenue)"), `${rang("ca")} / ${liste.length}`, `${T("rentabilité", "profitability")} : ${rang("rentabilite")} / ${liste.length}`)}
      </div>
      <div class="kpi-defile"><table class="guide-table kpi-table"><thead><tr><th>#</th><th>${T("Commercial", "Sales rep")}</th><th>${T("CA 6 mois", "Revenue 6 m")}</th><th>${T("Évolution", "Trend")}</th><th>${T("Prévisionnel", "Forecast")}</th><th>${T("Objectif atteint", "Target reached")}</th><th>${T("Marge brute", "Gross margin")}</th><th>${T("Rentabilité", "Profitability")}</th><th>${T("Conversion", "Conversion")}</th><th>${T("Remise moy.", "Avg. discount")}</th><th>${T("Rétention", "Retention")}</th></tr></thead><tbody>${tableau}</tbody></table></div>${note}`;
  }
  if (onglet === "ca") {
    const meilleur = tri("ca").find(x => !x.moi);
    const moyMois = [0, 1, 2, 3, 4, 5].map(m => liste.filter(x => !x.moi).reduce((s, x) => s + x.mensuel[m].ca, 0) / (liste.length - 1));
    const lignesMois = liste.map(x => `<tr${x.moi ? ' class="ligne-moi"' : ""}><td><strong>${echapper(x.moi ? T("Vous", "You") : x.nom)}</strong></td>${x.mensuel.map(m => `<td>${keuros(m.ca)}</td>`).join("")}<td class="${x.evolution >= 0 ? "kpi-plus" : "kpi-moins"}">${signe(x.evolution)}</td></tr>`).join("");
    return `<h4>${T("CA signé par mois", "Revenue signed per month")}</h4>
      ${courbes([{ nom: T("Vous", "You"), couleur: COULEURS_KPI.moi, valeurs: moi.mensuel.map(m => m.ca), epais: true }, { nom: T("Moyenne équipe", "Team average"), couleur: COULEURS_KPI.moyenne, valeurs: moyMois }, { nom: meilleur.nom.split(" ")[0], couleur: COULEURS_KPI.meilleur, valeurs: meilleur.mensuel.map(m => m.ca) }], MOIS_TABLEAU, keuros)}
      <h4>${T("CA cumulé sur six mois", "Revenue over six months")}</h4>${barresH(lignes("ca"), keuros)}
      <div class="kpi-defile"><table class="guide-table kpi-table"><thead><tr><th>${T("Commercial", "Sales rep")}</th>${MOIS_TABLEAU.map(m => `<th>${echapper(m)}</th>`).join("")}<th>${T("Évolution", "Trend")}</th></tr></thead><tbody>${lignesMois}</tbody></table></div>${note}`;
  }
  if (onglet === "previsionnel") {
    const lignesPrev = tri("previsionnel").map(x => `<tr${x.moi ? ' class="ligne-moi"' : ""}><td><strong>${echapper(x.moi ? T("Vous", "You") : x.nom)}</strong></td><td>${nombre(x.opportunites * 3)}</td><td>${pourcent(x.taux[2] * 100)}${x.estime && x.estime[2] ? "*" : ""}</td><td>${keuros(x.previsionnel)}</td><td>${keuros(x.objectifTrimestre)}</td><td class="${x.couverture >= 100 ? "kpi-plus" : "kpi-moins"}">${pourcent(x.couverture)}</td><td>${x.cycle} ${T("j", "d")}</td></tr>`).join("");
    return `<p>${T("Le CA prévisionnel du trimestre pondère chaque opportunité en cours par le taux de closing du commercial. La couverture compare ce prévisionnel à l'objectif du trimestre.", "The quarter's forecast weights every open opportunity by the rep's closing rate. Coverage compares this forecast with the quarterly target.")}</p>
      <h4>${T("CA prévisionnel du trimestre", "Forecast for the quarter")}</h4>${barresH(lignes("previsionnel"), keuros)}
      <h4>${T("Couverture de l'objectif", "Target coverage")}</h4>${barresH(lignes("couverture"), v => pourcent(v), { cible: 100, legendeCible: T("Objectif : 100 %", "Target: 100%") })}
      <div class="kpi-defile"><table class="guide-table kpi-table"><thead><tr><th>${T("Commercial", "Sales rep")}</th><th>${T("Opportunités (trim.)", "Opportunities (qtr)")}</th><th>${T("Taux de closing", "Closing rate")}</th><th>${T("Prévisionnel", "Forecast")}</th><th>${T("Objectif", "Target")}</th><th>${T("Couverture", "Coverage")}</th><th>${T("Cycle de vente", "Sales cycle")}</th></tr></thead><tbody>${lignesPrev}</tbody></table></div>${note}`;
  }
  if (onglet === "marge") {
    const plusRemise = tri("remisesPerdues").find(x => !x.moi), plusRentable = tri("rentabilite").find(x => !x.moi);
    return `<p>${EN ? `<strong>${echapper(plusRemise.nom)}</strong> gives away the most in discounts (${keuros(plusRemise.remisesPerdues)} over six months), while <strong>${echapper(plusRentable.nom)}</strong> is the most profitable rep. Volume isn't enough: each discount point comes straight out of the margin.` : `<strong>${echapper(plusRemise.nom)}</strong> concède le plus de remises (${keuros(plusRemise.remisesPerdues)} sur six mois), tandis que <strong>${echapper(plusRentable.nom)}</strong> est le commercial le plus rentable. Le volume ne suffit pas : chaque point de remise sort directement de la marge.`}</p>
      <h4>${T("Marge brute sur six mois", "Gross margin over six months")}</h4>${barresH(lignes("marge"), keuros)}
      <h4>${T("Rentabilité commerciale : (marge − coût complet du commercial : salaire, commissions, avant-vente, marketing) / coût", "Sales profitability: (margin − full rep cost: salary, commissions, pre-sales, marketing) / cost")}</h4>${barresH(lignes("rentabilite"), signe)}
      <h4>${T("Marge perdue en remises", "Margin lost to discounts")}</h4>${barresH(lignes("remisesPerdues"), keuros)}
      <h4>${T("Valeur vie des clients signés (CLV)", "Lifetime value of signed customers (CLV)")}</h4>${barresH(lignes("clv"), keuros)}${note}`;
  }
  // Tunnel de conversion
  const faible = [0, 1, 2].map(i => ({ i, ecart: moi.taux[i] - liste.filter(x => !x.moi).reduce((s, x) => s + x.taux[i], 0) / (liste.length - 1) })).sort((a, b) => a.ecart - b.ecart)[0];
  const noms = [T("Prospect → Lead", "Prospect → Lead"), T("Lead → Opportunité", "Lead → Opportunity"), T("Opportunité → Client", "Opportunity → Customer")];
  const lignesTunnel = tri("conversion").map(x => `<tr${x.moi ? ' class="ligne-moi"' : ""}><td><strong>${echapper(x.moi ? T("Vous", "You") : x.nom)}</strong></td><td>${nombre(x.volume)}</td>${x.taux.map((t, i) => `<td>${pourcent(t * 100)}${x.estime && x.estime[i] ? "*" : ""}</td>`).join("")}<td>${decimal(x.clientsMois.toFixed(1))}</td><td><strong>${pourcentPrecis(x.conversion)}</strong></td></tr>`).join("");
  return `<p>${EN ? `Your weakest stage compared with the team: <strong>${noms[faible.i]}</strong> (${pourcent(moi.taux[faible.i] * 100)}, ${faible.ecart >= 0 ? "above" : `${pourcent(Math.abs(faible.ecart) * 100)} below`} the average). Each stage multiplies the next: that's where to progress first.` : `Votre étape la plus faible par rapport à l'équipe : <strong>${noms[faible.i]}</strong> (${pourcent(moi.taux[faible.i] * 100)}, ${faible.ecart >= 0 ? "au-dessus de" : `${pourcent(Math.abs(faible.ecart) * 100)} sous`} la moyenne). Chaque étage multiplie le suivant : c'est là qu'il faut progresser d'abord.`}</p>
    ${noms.map((n, i) => `<h4>${n}</h4>${barresH(liste.slice().sort((a, b) => b.taux[i] - a.taux[i]).map(x => ({ label: x.moi ? T("Vous", "You") : x.nom, valeur: x.taux[i] * 100, moi: x.moi })), v => pourcent(v))}`).join("")}
    <div class="kpi-defile"><table class="guide-table kpi-table"><thead><tr><th>${T("Commercial", "Sales rep")}</th><th>${T("Prospects / mois", "Prospects / month")}</th>${noms.map(n => `<th>${n}</th>`).join("")}<th>${T("Clients / mois", "Customers / month")}</th><th>${T("Conversion globale", "Overall conversion")}</th></tr></thead><tbody>${lignesTunnel}</tbody></table></div>${note}`;
}
function ouvrirTableauDeBord(onglet = "synthese") {
  if (!["jeu", "pause", "menu", "fenetre"].includes(jeu.mode)) return;
  let actuel = ONGLETS_KPI.findIndex(o => o[0] === onglet);
  const rendre_ = corps => {
    corps.querySelector(".kpi-onglets").innerHTML = ONGLETS_KPI.map(([cle, nom], i) => `<button class="kpi-onglet${i === actuel ? " actif" : ""}" data-kpi="${i}" tabindex="-1">${echapper(nom)}</button>`).join("");
    const zone = corps.querySelector(".kpi-contenu");
    zone.innerHTML = contenuKpi(ONGLETS_KPI[actuel][0]);
    zone.classList.remove("kpi-entree");
    void zone.offsetWidth;
    zone.classList.add("kpi-entree");
  };
  ouvrirFenetre({
    titre: T("Tableau de bord commercial", "Sales dashboard"),
    sousTitre: T(`Équipe Veltis · ${COMMERCIAUX.length} commerciaux et vous · six derniers mois`, `Veltis team · ${COMMERCIAUX.length} sales reps and you · last six months`),
    corps: `<div class="kpi-onglets" role="tablist"></div><div class="kpi-contenu"></div>`,
    large: true, navigation: "document",
    boutons: [{ label: T("Fermer", "Close"), classe: "btn-principal", action: fermerFenetre }],
    onOuverture: corps => {
      rendre_(corps);
      corps.addEventListener("click", e => {
        const b = e.target.closest("[data-kpi]");
        if (!b) return;
        actuel = Number(b.dataset.kpi);
        son("clic");
        rendre_(corps);
      });
      jeu.changerOnglet = sens => { actuel = (actuel + sens + ONGLETS_KPI.length) % ONGLETS_KPI.length; rendre_(corps); };
    }
  });
}
function ouvrirTableauEquipe() { ouvrirTableauDeBord("synthese"); }
// Échange avec un commercial : comparer ses chiffres
function choixComparaison(cle) {
  const c = COMMERCIAUX.find(x => x.cle === cle);
  if (!c) return null;
  const k = indicateurs(c);
  return {
    label: T("« On compare nos chiffres du trimestre ? »", "“Shall we compare our numbers for the quarter?”"), delta: 2,
    journal: T("comparaison des résultats commerciaux avec un collègue.", "sales results compared with a colleague."),
    reponse: EN ? `Sure! Over six months: ${keuros(k.ca)} signed (${signe(k.evolution)}), ${keuros(k.previsionnel)} forecast for the quarter, profitability ${signe(k.rentabilite)}. ${c.conseil}` : `Bien sûr ! Sur six mois : ${keuros(k.ca)} signés (${signe(k.evolution)}), ${keuros(k.previsionnel)} de prévisionnel sur le trimestre, rentabilité ${signe(k.rentabilite)}. ${c.conseil}`,
    suite: { label: T("Ouvrir le tableau de bord", "Open the dashboard"), action: () => ouvrirTableauDeBord("synthese") }
  };
}

/* ---------- K4. Animations du tunnel de conversion ---------- */
const ETAPES_TUNNEL = () => POSTURES.map(p => p.nom);
// Frise des étapes du tunnel, l'étape de la mission mise en avant
function frisePassage(def) {
  const etapes = [T("Inconnu", "Unknown"), "Prospect", "Lead", T("Opportunité", "Opportunity"), T("Client", "Customer"), T("Client fidèle", "Loyal customer")];
  const de = etapes.indexOf(def.transition[0]);
  return `<div class="frise-tunnel" style="--c:${def.couleur}">${etapes.map((e, i) => `<span class="ft-etape${i === de ? " de" : ""}${i === de + 1 ? " vers" : ""}${i < de ? " passee" : ""}">${echapper(e)}</span>`).join('<span class="ft-fleche">›</span>')}</div>`;
}
const fileConversions = [];
let animationConversion = null;
function annoncerConversion(de, vers, n, couleur) {
  const dernier = fileConversions[fileConversions.length - 1];
  if (dernier && dernier.de === de && dernier.vers === vers) { dernier.n += n; return; }
  fileConversions.push({ de, vers, n, couleur });
}
function majAnimationsConversion() {
  if (animationConversion || !fileConversions.length) return;
  const c = fileConversions.shift();
  const el = $("anim-conversion");
  el.style.setProperty("--c", c.couleur || "#2a78d6");
  el.innerHTML = `<span class="ac-plus">+${nombre(c.n)}</span><span class="ac-chip ac-de">${echapper(c.de)}</span><span class="ac-trajet"><i></i><i></i><i></i></span><span class="ac-chip ac-vers">${echapper(c.vers)}</span>`;
  el.classList.remove("cache", "ac-anim");
  void el.offsetWidth;
  el.classList.add("ac-anim");
  son("conversion");
  animationConversion = setTimeout(() => { el.classList.add("cache"); animationConversion = null; majAnimationsConversion(); }, 2100);
}
// Surveille le tunnel de la mission : chaque contact qui change d'étape est mis en avant
function surveillerTunnel() {
  if (!jeu.def || !jeu.n || !jeu.def.tunnel || !["jeu", "dialogue", "fenetre"].includes(jeu.mode)) return;
  const t = jeu.def.tunnel(jeu.n);
  if (!t) return;
  const valeurs = t.etapes.map(e => e.valeur);
  const prec = jeu.tunnelPrec;
  jeu.tunnelPrec = valeurs;
  if (!prec || prec.length !== valeurs.length) return;
  valeurs.forEach((v, i) => {
    if (v <= prec[i]) return;
    const chip = document.querySelectorAll("#hud-tunnel .tl-etape")[i];
    if (chip) { chip.classList.remove("bump"); void chip.offsetWidth; chip.classList.add("bump"); }
    if (i === 0) annoncerConversion(T("Contacts", "Contacts"), t.etapes[0].court || t.etapes[0].label, v - prec[0], jeu.def.couleur);
    else annoncerConversion(t.etapes[i - 1].court || t.etapes[i - 1].label, t.etapes[i].court || t.etapes[i].label, v - prec[i], jeu.def.couleur);
  });
  majAnimationsConversion();
}
// Grande animation : passage d'une étape du tunnel à une autre (jauge du participant)
function scenePassage({ titre, sousTitre, etapes, de, vers, couleur, recul = false, ensuite = null, passable = false }) {
  const el = $("anim-etape");
  el.style.setProperty("--c", couleur || "#2a78d6");
  el.className = `anim-etape${recul ? " recul" : ""}`;
  const pas = etapes.length - 1;
  el.innerHTML = `<div class="ae-carte"><p class="ae-titre">${echapper(titre)}</p>
    <div class="ae-piste" style="--de:${de / pas * 100}%;--vers:${vers / pas * 100}%"><span class="ae-rempli"></span>
      ${etapes.map((e, i) => `<span class="ae-noeud${i === vers ? " cible" : ""}${i < Math.max(de, vers) && i !== vers ? " acquis" : ""}" style="left:${i / pas * 100}%"><b>${i + 1}</b><em>${echapper(e)}</em></span>`).join("")}
    </div><p class="ae-sous">${sousTitre}</p></div>`;
  void el.offsetWidth;
  el.classList.add("ae-anim");
  clearTimeout(scenePassage.minuterie);
  terminerScene.ensuite = ensuite;
  terminerScene.passable = passable;
  scenePassage.minuterie = setTimeout(terminerScene, 3600);
}
// Fin de l'animation (au bout de 3,6 s, ou plus tôt par une touche ou un clic) puis action suivante
function terminerScene() {
  clearTimeout(scenePassage.minuterie);
  $("anim-etape").classList.add("cache");
  const suite = terminerScene.ensuite;
  terminerScene.ensuite = null;
  if (suite) suite();
}
// Seule l'animation de début de mission se passe : celles qui surviennent en jouant restent visibles
const scenePassable = () => terminerScene.passable && !$("anim-etape").classList.contains("cache");
window.addEventListener("keydown", e => { if (scenePassable() && !e.repeat && !["Shift", "Control", "Alt", "Meta"].includes(e.key)) terminerScene(); }, true);
window.addEventListener("pointerdown", () => { if (scenePassable()) terminerScene(); }, true);
function animerPassageEtape(avant, apres) {
  const i = POSTURES.indexOf(avant), j = POSTURES.indexOf(apres);
  const progres = j > i;
  son(progres ? "victoire" : "erreur");
  scenePassage({
    titre: progres ? T("Nouvelle étape franchie", "New stage reached") : T("Recul dans le tunnel", "Moving back in the funnel"),
    sousTitre: `<strong>${echapper(avant.nom)} → ${echapper(apres.nom)}</strong> · ${echapper(apres.devise)}`,
    etapes: ETAPES_TUNNEL(), de: i, vers: j, couleur: progres ? "#15803d" : "#b91c1c", recul: !progres
  });
}
function animerDebutEtape(def, index, ensuite = null) {
  const etapes = [T("Inconnu", "Unknown"), "Prospect", "Lead", T("Opportunité", "Opportunity"), T("Client", "Customer"), T("Client fidèle", "Loyal customer")];
  const de = Math.max(0, etapes.indexOf(def.transition[0]));
  scenePassage({
    titre: `${def.bonus ? "Bonus" : T(`Étape ${index + 1}`, `Stage ${index + 1}`)} · ${def.phase}`,
    sousTitre: T(`Objectif : faire passer vos contacts de <strong>${echapper(def.transition[0])}</strong> à <strong>${echapper(def.transition[1])}</strong>.`, `Goal: move your contacts from <strong>${echapper(def.transition[0])}</strong> to <strong>${echapper(def.transition[1])}</strong>.`),
    etapes, de, vers: Math.min(etapes.length - 1, de + 1), couleur: def.couleur, ensuite, passable: true
  });
}
// Bilan : passage de l'étape de la mission, compteur animé des contacts convertis
function bilanConversion(def, tunnel, succes) {
  const el = $("bilan-conversion");
  if (!tunnel) { el.innerHTML = ""; return; }
  const sortie = tunnel.etapes[tunnel.etapes.length - 1].valeur, entree = tunnel.etapes[0].valeur;
  el.style.setProperty("--c", def.couleur);
  el.innerHTML = `<div class="bc-ligne${succes ? " reussi" : ""}"><span class="bc-chip">${echapper(def.transition[0])}<small>${nombre(entree)}</small></span>
    <span class="bc-fleche"><i></i></span>
    <span class="bc-chip bc-vers">${echapper(def.transition[1])}<small data-compte="${sortie}">0</small></span>
    <span class="bc-taux">${T("Taux de conversion", "Conversion rate")}<strong>${pourcent(tauxTunnel(tunnel))}</strong></span></div>`;
  const compteur = el.querySelector("[data-compte]");
  const debut = performance.now();
  const anim = t => {
    const k = clamp((t - debut) / 1400, 0, 1);
    compteur.textContent = nombre(sortie * (1 - Math.pow(1 - k, 3)));
    if (k < 1) requestAnimationFrame(anim);
  };
  setTimeout(() => requestAnimationFrame(anim), 500);
}


/* =====================================================================
   PARTIE L — UNE VRAIE ENTREPRISE : IDENTITÉ VISUELLE ET VIE QUOTIDIENNE
   ---------------------------------------------------------------------
   Identité Veltis (logo, affiches, art), postes de travail équipés,
   écrans d'applications, horloges à l'heure du jeu, sécurité incendie,
   panneaux de réservation des salles, écrans de ventes en direct.
   Rythme de la journée (stand-up, déjeuner, départs et arrivées, afterwork
   du vendredi), signatures annoncées en direct, fil d'actualité interne,
   personnel de service, objets portés par les collègues.
   ===================================================================== */

/* ---------- L1. Identité visuelle Veltis ---------- */
const MARQUE = { marine: "#0b1f3a", orange: "#f97316", peche: "#fdba74", ardoise: "#334155", clair: "#e2e8f0" };
// Logo : monogramme (carré marine, chevron orange) et nom
function dessinerLogo(x, cx, cy, taille, clair = true) {
  const r = taille * 0.18;
  x.save();
  x.fillStyle = clair ? MARQUE.orange : MARQUE.marine;
  x.beginPath();
  x.moveTo(cx + r, cy); x.lineTo(cx + taille - r, cy); x.quadraticCurveTo(cx + taille, cy, cx + taille, cy + r);
  x.lineTo(cx + taille, cy + taille - r); x.quadraticCurveTo(cx + taille, cy + taille, cx + taille - r, cy + taille);
  x.lineTo(cx + r, cy + taille); x.quadraticCurveTo(cx, cy + taille, cx, cy + taille - r); x.lineTo(cx, cy + r); x.quadraticCurveTo(cx, cy, cx + r, cy);
  x.fill();
  x.strokeStyle = "#ffffff";
  x.lineWidth = taille * 0.13;
  x.lineCap = "round";
  x.lineJoin = "round";
  x.beginPath();
  x.moveTo(cx + taille * 0.26, cy + taille * 0.3);
  x.lineTo(cx + taille * 0.5, cy + taille * 0.72);
  x.lineTo(cx + taille * 0.74, cy + taille * 0.3);
  x.stroke();
  x.fillStyle = clair ? "#ffffff" : MARQUE.marine;
  x.font = `800 ${Math.round(taille * 0.78)}px Inter, "Segoe UI", Arial, sans-serif`;
  x.textBaseline = "middle";
  x.textAlign = "left";
  x.fillText("VELTIS", cx + taille * 1.28, cy + taille * 0.54);
  x.restore();
}
const cacheTexturesL = {};
function textureCanvas(cle, L, H, dessin) {
  if (cacheTexturesL[cle]) return cacheTexturesL[cle];
  const c = document.createElement("canvas");
  c.width = L; c.height = H;
  dessin(c.getContext("2d"), L, H);
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  cacheTexturesL[cle] = t;
  return t;
}
const materiauxImages = new Map();
function panneauImage(w, h, texture, opaque = true) {
  const cle = `${texture.uuid}|${opaque}`;
  if (!materiauxImages.has(cle)) materiauxImages.set(cle, new THREE.MeshBasicMaterial({ map: texture, transparent: !opaque, toneMapped: false }));
  return new THREE.Mesh(geoPlan(w, h), materiauxImages.get(cle));
}
function placer_(g, m, x, y, z, a) { m.position.set(x, y, z); m.rotation.y = a; g.add(m); return m; }
// Mur de marque : logo, signature
function panneauMarque(g, x, y, z, a, w = 2.2, h = 0.95, signature = T("Vendre, c'est construire une relation", "Selling is building a relationship")) {
  const t = textureCanvas(`marque|${signature}|${w}`, 880, Math.round(880 * h / w), (c, L, H) => {
    const fond = c.createLinearGradient(0, 0, L, H);
    fond.addColorStop(0, "#0b1f3a"); fond.addColorStop(1, "#13315c");
    c.fillStyle = fond; c.fillRect(0, 0, L, H);
    c.fillStyle = "rgba(249,115,22,0.9)"; c.fillRect(0, H - 10, L, 10);
    dessinerLogo(c, L * 0.12, H * 0.2, H * 0.4);
    c.fillStyle = MARQUE.peche;
    c.font = `500 ${Math.round(H * 0.11)}px Inter, Arial, sans-serif`;
    c.fillText(signature, L * 0.12, H * 0.8);
  });
  return placer_(g, panneauImage(w, h, t), x, y, z, a);
}
// Œuvre abstraite générée (aplats aux couleurs de la marque et tons neutres)
function tableauArt(g, x, y, z, a, w, h, graine) {
  const t = textureCanvas(`art|${graine}`, 512, Math.round(512 * h / w), (c, L, H) => {
    let s = graine * 9301 + 49297;
    const alea = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
    c.fillStyle = ["#efe9df", "#e6e2da", "#1f2a37"][graine % 3]; c.fillRect(0, 0, L, H);
    const teintes = ["#0b1f3a", "#f97316", "#fdba74", "#64748b", "#c2410c", "#e2e8f0", "#0f766e", "#a8a29e"];
    for (let i = 0; i < 9; i++) {
      c.globalAlpha = 0.55 + alea() * 0.45;
      c.fillStyle = teintes[Math.floor(alea() * teintes.length)];
      if (alea() < 0.5) { c.beginPath(); c.arc(alea() * L, alea() * H, 20 + alea() * L * 0.28, 0, Math.PI * 2); c.fill(); }
      else c.fillRect(alea() * L * 0.8, alea() * H * 0.8, 30 + alea() * L * 0.4, 12 + alea() * H * 0.35);
    }
    c.globalAlpha = 1;
  });
  const cadre = boite(w + 0.08, h + 0.08, 0.04, 0x1c1c1c);
  cadre.rotation.y = a;
  g.add(pos(cadre, x - Math.sin(a) * 0.015, y, z - Math.cos(a) * 0.015));
  return placer_(g, panneauImage(w, h, t), x + Math.sin(a) * 0.012, y, z + Math.cos(a) * 0.012, a);
}
// Affiche des valeurs de l'entreprise
function afficheValeurs(g, x, y, z, a) {
  const t = textureCanvas("valeurs", 600, 840, (c, L, H) => {
    c.fillStyle = "#fbfaf7"; c.fillRect(0, 0, L, H);
    c.fillStyle = MARQUE.marine; c.fillRect(0, 0, L, 150);
    dessinerLogo(c, 50, 45, 60);
    c.fillStyle = MARQUE.marine;
    c.font = "800 44px Inter, Arial, sans-serif";
    c.fillText(T("Nos valeurs", "Our values"), 50, 220);
    const valeurs = [[T("Écouter avant de vendre", "Listen before selling"), T("Le besoin du client d'abord.", "The customer's need comes first.")],
      [T("Dire ce que l'on fait", "Say what we do"), T("Aucune promesse non validée.", "No unconfirmed promise.")],
      [T("Faire ce que l'on dit", "Do what we say"), T("Chaque engagement est tenu.", "Every commitment is kept.")],
      [T("Construire dans la durée", "Build for the long term"), T("Un client fidèle vaut dix signatures.", "A loyal customer is worth ten signatures.")]];
    valeurs.forEach(([titre, sous], i) => {
      const y0 = 300 + i * 132;
      c.fillStyle = MARQUE.orange; c.fillRect(50, y0 - 30, 8, 80);
      c.fillStyle = MARQUE.marine; c.font = "700 32px Inter, Arial, sans-serif"; c.fillText(titre, 80, y0);
      c.fillStyle = "#475569"; c.font = "400 24px Inter, Arial, sans-serif"; c.fillText(sous, 80, y0 + 38);
    });
  });
  const cadre = boite(0.78, 1.08, 0.03, 0xd6d3d1);
  cadre.rotation.y = a;
  g.add(pos(cadre, x - Math.sin(a) * 0.015, y, z - Math.cos(a) * 0.015));
  return placer_(g, panneauImage(0.72, 1.0, t), x + Math.sin(a) * 0.006, y, z + Math.cos(a) * 0.006, a);
}

/* ---------- L2. Écrans d'applications et postes de travail équipés ---------- */
const APPLIS = ["crm", "mail", "tableau", "tableur", "visio"];
function textureAppli(type) {
  return textureCanvas(`appli|${type}`, 320, 180, (c, L, H) => {
    c.fillStyle = "#f8fafc"; c.fillRect(0, 0, L, H);
    c.fillStyle = MARQUE.marine; c.fillRect(0, 0, L, 18);
    c.fillStyle = "#ffffff"; c.font = "700 11px Inter, Arial, sans-serif"; c.fillText({ crm: "Veltis One · Pipeline", mail: T("Messagerie", "Mail"), tableau: T("Tableau de bord", "Dashboard"), tableur: T("Prévisions T3.xlsx", "Forecast Q3.xlsx"), visio: T("Visio · Point client", "Video · Customer call") }[type], 8, 13);
    c.fillStyle = "#e2e8f0"; c.fillRect(0, 18, 46, H - 18);
    for (let i = 0; i < 6; i++) { c.fillStyle = i === 1 ? "#93c5fd" : "#cbd5e1"; c.fillRect(8, 28 + i * 18, 30, 7); }
    if (type === "crm") {
      ["#93c5fd", "#a5b4fc", "#fdba74", "#86efac"].forEach((col, k) => {
        const x0 = 54 + k * 66;
        c.fillStyle = "#e2e8f0"; c.fillRect(x0, 26, 60, H - 34);
        for (let j = 0; j < 4 - (k > 1 ? 1 : 0); j++) { c.fillStyle = "#ffffff"; c.fillRect(x0 + 4, 34 + j * 30, 52, 24); c.fillStyle = col; c.fillRect(x0 + 4, 34 + j * 30, 4, 24); c.fillStyle = "#94a3b8"; c.fillRect(x0 + 12, 40 + j * 30, 34, 4); c.fillRect(x0 + 12, 48 + j * 30, 22, 4); }
      });
    } else if (type === "mail") {
      for (let j = 0; j < 7; j++) { c.fillStyle = j === 0 ? "#dbeafe" : "#ffffff"; c.fillRect(54, 26 + j * 21, 110, 18); c.fillStyle = "#475569"; c.fillRect(60, 30 + j * 21, 50, 4); c.fillStyle = "#94a3b8"; c.fillRect(60, 37 + j * 21, 90, 3); }
      c.fillStyle = "#ffffff"; c.fillRect(170, 26, 142, H - 34);
      for (let j = 0; j < 9; j++) { c.fillStyle = "#cbd5e1"; c.fillRect(178, 36 + j * 13, 120 - (j % 3) * 18, 4); }
    } else if (type === "tableau") {
      [[54, 26], [186, 26]].forEach(([x0, y0]) => { c.fillStyle = "#ffffff"; c.fillRect(x0, y0, 126, 40); c.fillStyle = "#0f172a"; c.font = "800 15px Inter, Arial"; c.fillText(x0 < 100 ? "412 k€" : "+12 %", x0 + 8, y0 + 26); });
      c.fillStyle = "#ffffff"; c.fillRect(54, 72, 258, 100);
      [40, 55, 48, 66, 72, 61, 80, 88].forEach((v, i) => { c.fillStyle = i === 7 ? "#2a78d6" : "#93c5fd"; c.fillRect(66 + i * 30, 166 - v, 18, v); });
    } else if (type === "tableur") {
      c.fillStyle = "#ffffff"; c.fillRect(54, 24, 258, H - 30);
      c.strokeStyle = "#cbd5e1"; c.lineWidth = 1;
      for (let i = 0; i <= 8; i++) { c.beginPath(); c.moveTo(54, 24 + i * 18.5); c.lineTo(312, 24 + i * 18.5); c.stroke(); }
      for (let i = 0; i <= 5; i++) { c.beginPath(); c.moveTo(54 + i * 51.6, 24); c.lineTo(54 + i * 51.6, H - 6); c.stroke(); }
      c.fillStyle = "#16a34a"; c.fillRect(54, 24, 258, 18);
      for (let r = 1; r < 8; r++) for (let k = 0; k < 5; k++) { c.fillStyle = "#64748b"; c.fillRect(60 + k * 51.6, 31 + r * 18.5, 26 + ((r * 7 + k * 3) % 14), 4); }
    } else {
      [["#7c6a5a", "#f1c7a3"], ["#3b4a5a", "#8d5524"], ["#5b4636", "#e0ac82"], ["#2f3d4d", "#f6d5bd"]].forEach(([fond, peau], k) => {
        const x0 = 54 + (k % 2) * 130, y0 = 24 + Math.floor(k / 2) * 76;
        c.fillStyle = fond; c.fillRect(x0, y0, 126, 72);
        c.fillStyle = peau; c.beginPath(); c.arc(x0 + 63, y0 + 32, 14, 0, Math.PI * 2); c.fill();
        c.fillStyle = "#1f2937"; c.fillRect(x0 + 43, y0 + 50, 40, 22);
      });
    }
  });
}
const materiauxAppli = {};
function materiauAppli(type) {
  if (!materiauxAppli[type]) materiauxAppli[type] = new THREE.MeshBasicMaterial({ map: textureAppli(type), toneMapped: false });
  return materiauxAppli[type];
}
// Accessoires variés sur chaque poste (choisis selon l'emplacement)
function accessoiresBureau(g, x, z) {
  const h = k => hasard(x * 3.1 + k, z * 1.7 - k, 11);
  if (h(1) < 0.4) {
    g.add(pos(boite(0.58, 0.34, 0.03, 0x111827), x - 0.62, 1.04, z - 0.16));
    const e = new THREE.Mesh(geoPlan(0.54, 0.3), materiauAppli(APPLIS[Math.floor(h(2) * APPLIS.length)]));
    g.add(pos(e, x - 0.62, 1.04, z - 0.143));
    g.add(pos(boite(0.05, 0.16, 0.05, 0x374151), x - 0.62, 0.86, z - 0.2));
  } else if (h(3) < 0.6) {
    g.add(pos(boite(0.34, 0.016, 0.24, 0x9ca3af), x - 0.55, 0.795, z + 0.02));
    const ecran = boite(0.34, 0.22, 0.012, 0x6b7280);
    ecran.rotation.x = -0.32;
    g.add(pos(ecran, x - 0.55, 0.9, z - 0.13));
  }
  if (h(4) < 0.65) { g.add(pos(boite(0.2, 0.05, 0.18, 0x1f2937), x + 0.66, 0.815, z + 0.18)); g.add(pos(boite(0.05, 0.03, 0.17, 0x111827), x + 0.6, 0.85, z + 0.18)); }
  if (h(5) < 0.55) { g.add(pos(boite(0.18, 0.015, 0.24, [0x1e3a8a, 0x7c2d12, 0x0f766e][Math.floor(h(6) * 3)]), x + 0.28, 0.795, z + 0.18)); g.add(pos(cylindre(0.004, 0.004, 0.14, 0x111827, 6), x + 0.32, 0.808, z + 0.16)); }
  if (h(7) < 0.35) { const cadre = boite(0.12, 0.15, 0.015, 0x57534e); cadre.rotation.x = -0.2; g.add(pos(cadre, x + 0.78, 0.86, z - 0.3)); }
  if (h(8) < 0.3) { g.add(pos(cylindre(0.05, 0.04, 0.08, 0xe7e2da, 10), x - 0.8, 0.83, z - 0.28)); g.add(pos(sphere(0.07, 0x4d7c3a, 10), x - 0.8, 0.92, z - 0.28)); }
  if (h(9) < 0.3) { const casque = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.012, 6, 14, Math.PI), mat(0x111827)); casque.castShadow = true; g.add(pos(casque, x + 0.05, 0.8, z + 0.28)); }
  g.add(pos(cylindre(0.03, 0.03, 0.09, 0x374151, 8), x + 0.8, 0.835, z - 0.05));
}

/* ---------- L3. Équipements : sécurité, issue de secours, horloges, cuisine, tri ---------- */
const texturePictoSortie = () => textureCanvas("sortie", 256, 96, (c, L, H) => {
  c.fillStyle = "#15803d"; c.fillRect(0, 0, L, H);
  c.fillStyle = "#ffffff";
  c.beginPath(); c.arc(54, 22, 9, 0, Math.PI * 2); c.fill();
  c.lineWidth = 9; c.strokeStyle = "#ffffff"; c.lineCap = "round";
  c.beginPath(); c.moveTo(52, 34); c.lineTo(42, 58); c.lineTo(28, 78); c.moveTo(42, 58); c.lineTo(62, 70); c.lineTo(62, 86); c.moveTo(50, 40); c.lineTo(70, 50); c.moveTo(50, 40); c.lineTo(30, 46); c.stroke();
  c.fillRect(88, 14, 34, 68);
  c.font = "800 30px Inter, Arial, sans-serif"; c.fillText(T("SORTIE", "EXIT"), 132, 60);
});
const texturePictoExtincteur = () => textureCanvas("extincteur", 96, 96, (c, L, H) => {
  c.fillStyle = "#dc2626"; c.fillRect(0, 0, L, H);
  c.fillStyle = "#ffffff"; c.fillRect(38, 26, 20, 56); c.fillRect(30, 18, 30, 8); c.fillRect(58, 20, 16, 5);
  c.fillStyle = "#dc2626"; c.fillRect(42, 40, 12, 3);
});
// Poteaux : extincteur et signalétique, sur tous les niveaux
function equiperPoteaux(g) {
  [[-4.7, -7.4], [5.0, -7.4], [13.6, -7.4], [-4.7, 4.05], [13.6, 4.8]].forEach(([x, z], i) => {
    if (i % 2) return;
    g.add(pos(cylindre(0.075, 0.075, 0.42, 0xb91c1c, 12), x + 0.36, 0.42, z));
    g.add(pos(cylindre(0.03, 0.03, 0.08, 0x111827, 8), x + 0.36, 0.67, z));
    placer_(g, panneauImage(0.16, 0.16, texturePictoExtincteur()), x + 0.285, 1.25, z, O / 2);
  });
}
// Face nord du noyau : porte de l'escalier de secours, signalétique, horloge
function faceNordNoyau(g) {
  g.add(pos(boite(0.95, 2.12, 0.04, 0x9a948b), 2.63, 1.06, 6.18));
  g.add(pos(boite(0.04, 0.04, 0.2, 0x6b7280), 2.32, 1.02, 6.12));
  placer_(g, panneauImage(0.5, 0.19, texturePictoSortie()), 2.63, 2.35, 6.17, O);
  const plaque = panneauTexte(0.5, 0.12, { largeur: 250, hauteur: 60, fond: "#f8fafc", lignes: [{ texte: T("ESCALIER · ISSUE DE SECOURS", "STAIRS · EMERGENCY EXIT"), taille: 18, gras: 800, couleur: "#15803d" }] });
  placer_(g, plaque, 2.63, 1.65, 6.155, O);
  creerHorloge(g, 2.63, 2.72, 6.16, O, 0.2);
}
const horloges = [];
const textureCadran = () => textureCanvas("cadran", 256, 256, (c, L) => {
  c.fillStyle = "#ffffff"; c.beginPath(); c.arc(L / 2, L / 2, L / 2, 0, Math.PI * 2); c.fill();
  c.strokeStyle = "#0f172a";
  for (let i = 0; i < 60; i++) {
    const a = i / 60 * Math.PI * 2, long = i % 5 === 0;
    c.lineWidth = long ? 7 : 2;
    c.beginPath(); c.moveTo(L / 2 + Math.sin(a) * L * (long ? 0.36 : 0.41), L / 2 - Math.cos(a) * L * (long ? 0.36 : 0.41)); c.lineTo(L / 2 + Math.sin(a) * L * 0.46, L / 2 - Math.cos(a) * L * 0.46); c.stroke();
  }
  dessinerLogo(c, L * 0.36, L * 0.62, 18, false);
});
function creerHorloge(g, x, y, z, a, r = 0.22) {
  const h = new THREE.Group();
  h.position.set(x, y, z);
  h.rotation.y = a;
  const cadran = new THREE.Mesh(new THREE.CircleGeometry(r, 40), new THREE.MeshBasicMaterial({ map: textureCadran(), toneMapped: false }));
  cadran.userData.dynamique = true;
  h.add(cadran);
  const bord = new THREE.Mesh(new THREE.TorusGeometry(r, r * 0.07, 8, 40), mat(0x1c1c1c));
  bord.userData.dynamique = true;
  h.add(bord);
  const aiguille = (l, e) => {
    const piv = new THREE.Group();
    piv.position.z = 0.012;
    const m = new THREE.Mesh(new THREE.BoxGeometry(e, l, 0.006), mat(0x0f172a));
    m.position.y = l / 2 - l * 0.12;
    m.userData.dynamique = true;
    piv.add(m);
    h.add(piv);
    return piv;
  };
  const heures = aiguille(r * 0.55, r * 0.07), minutes = aiguille(r * 0.82, r * 0.045);
  g.add(h);
  horloges.push({ heures, minutes });
}

/* Heure de l'entreprise : celle de la mission en cours (9 h – 18 h), 10 h 30 hors mission */
function horaire() {
  if (!jeu.def) return { actif: false, m: 90, jour: 0, heure: 10.5 };
  const total = Math.max(0, jeu.minutes);
  const m = total % JOURNEE;
  return { actif: true, m, jour: Math.floor(total / JOURNEE), semaine: Math.floor(total / JOURNEE) % 5, heure: 9 + m / 60 };
}
function majHorloges() {
  const h = horaire().heure;
  horloges.forEach(o => {
    o.heures.rotation.z = -((h % 12) / 12) * Math.PI * 2;
    o.minutes.rotation.z = -((h % 1)) * Math.PI * 2;
  });
}
// Cuisine de la cafétéria (R+1), tri sélectif, porte-manteaux
function equipementsR1(g) {
  g.add(pos(boite(0.72, 1.9, 0.7, 0xc3c7cc), -7.22, 0.95, 9.65));
  g.add(pos(boite(0.02, 0.5, 0.03, 0x6b7280), -6.85, 1.25, 9.4));
  obstacleBoite(-7.22, 9.65, 0.38, 0.37);
  g.add(pos(boite(0.42, 0.26, 0.34, 0x1f2937), -7.25, 1.1, 7.45));
  g.add(pos(boite(0.02, 0.18, 0.24, 0x0b0b0b), -7.03, 1.1, 7.45));
  [[0x2563eb, -0.32], [0xeab308, 0], [0x16a34a, 0.32]].forEach(([c, dz]) => {
    g.add(pos(boite(0.28, 0.62, 0.28, c), -5.95, 0.31, 4.65 + dz));
    g.add(pos(boite(0.3, 0.03, 0.3, 0x1f2937), -5.95, 0.63, 4.65 + dz));
  });
  obstacleBoite(-5.95, 4.65, 0.16, 0.48);
  const plaque = panneauTexte(0.9, 0.16, { largeur: 360, hauteur: 64, fond: "#f8fafc", lignes: [{ texte: T("Papier · Emballages · Verre", "Paper · Packaging · Glass"), taille: 22, gras: 700, couleur: "#0f172a" }] });
  placer_(g, plaque, -5.79, 0.9, 4.65, O / 2);
  // Porte-manteaux avec vestes
  [[-18.3, 2.2], [-5.3, -6.6]].forEach(([x, z], i) => {
    g.add(pos(cylindre(0.025, 0.025, 1.75, 0x1c1c1c, 8), x, 0.875, z));
    g.add(pos(cylindre(0.2, 0.22, 0.03, 0x1c1c1c, 14), x, 0.015, z));
    [[0x1e293b, 0], [0x7c2d12, 2.1], [0x475569, 4.2]].slice(0, 2 + i).forEach(([c, a]) => {
      const veste = boite(0.34, 0.62, 0.12, c);
      veste.rotation.y = a;
      g.add(pos(veste, x + Math.sin(a) * 0.1, 1.38, z + Math.cos(a) * 0.1));
    });
    obstacleCercle(x, z, 0.28);
  });
}

/* ---------- L4. Écrans dynamiques : ventes en direct, actualités, réservation des salles ---------- */
const ecransDynamiques = [];
function ecranDynamique(g, x, y, z, a, w, h, L, H, dessin, cadre = true) {
  const c = document.createElement("canvas");
  c.width = L; c.height = H;
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const m = panneauImage(w, h, t);
  m.userData.dynamique = true;
  if (cadre) {
    const b = boite(w + 0.06, h + 0.06, 0.05, 0x111827);
    b.rotation.y = a;
    g.add(pos(b, x - Math.sin(a) * 0.03, y, z - Math.cos(a) * 0.03));
  }
  placer_(g, m, x, y, z, a);
  const e = { c, x: c.getContext("2d"), t, dessin, signature: "" };
  ecransDynamiques.push(e);
  return e;
}
function majEcransDynamiques() {
  ecransDynamiques.forEach(e => {
    const signature = e.dessin(e.x, e.c.width, e.c.height, true);
    if (signature === e.signature) return;
    e.signature = signature;
    e.dessin(e.x, e.c.width, e.c.height, false);
    e.t.needsUpdate = true;
  });
}
const heureTexte = () => { const h = horaire(); return `${String(Math.floor(h.heure)).padStart(2, "0")}:${String(Math.floor((h.heure % 1) * 60)).padStart(2, "0")}`; };
// Classement des ventes du mois, signatures du jour (open space R+1)
function dessinVentes(c, L, H, test) {
  const { liste } = donneesEquipe();
  const mois = liste.map(x => ({ nom: x.moi ? T("Vous", "You") : x.nom.split(" ")[0], v: x.mensuel[5].ca, moi: x.moi })).sort((a, b) => b.v - a.v).slice(0, 7);
  const derniere = vie.signatures[vie.signatures.length - 1];
  const sig = `${mois.map(m => Math.round(m.v / 1000)).join(",")}|${vie.signatures.length}|${heureTexte()}`;
  if (test) return sig;
  c.fillStyle = "#0b1f3a"; c.fillRect(0, 0, L, H);
  c.fillStyle = "#13315c"; c.fillRect(0, 0, L, 58);
  dessinerLogo(c, 20, 13, 32);
  c.fillStyle = "#ffffff"; c.font = "800 24px Inter, Arial"; c.textAlign = "left";
  c.fillText(T("VENTES DU MOIS", "SALES THIS MONTH"), 200, 38);
  c.textAlign = "right"; c.fillStyle = MARQUE.peche; c.fillText(heureTexte(), L - 20, 38);
  const max = Math.max(...mois.map(m => m.v)) || 1;
  mois.forEach((m, i) => {
    const y = 80 + i * 34;
    c.textAlign = "right"; c.fillStyle = m.moi ? MARQUE.peche : "#e2e8f0"; c.font = `${m.moi ? 800 : 600} 18px Inter, Arial`;
    c.fillText(m.nom, 150, y + 18);
    c.fillStyle = m.moi ? "#2a78d6" : "#64748b";
    const w = (L - 300) * m.v / max;
    c.fillRect(162, y + 4, Math.max(4, w), 20);
    c.textAlign = "left"; c.fillStyle = "#ffffff"; c.font = "700 16px Inter, Arial";
    c.fillText(keuros(m.v), 170 + w, y + 20);
  });
  c.fillStyle = MARQUE.orange; c.fillRect(0, H - 44, L, 44);
  c.fillStyle = "#0b1f3a"; c.font = "800 18px Inter, Arial"; c.textAlign = "left";
  c.fillText(derniere ? `${T("DERNIÈRE SIGNATURE", "LATEST DEAL")} · ${derniere.qui} · ${derniere.client} · ${keuros(derniere.montant)}` : T("Objectif du mois : chaque client signé doit rester.", "This month's goal: every customer signed should stay."), 20, H - 16);
  return sig;
}
// Actualités du hall (RDC)
function dessinActualites(c, L, H, test) {
  const fil = vie.fil.slice(-3).reverse();
  const sig = `${fil.map(f => f.texte).join("|")}|${heureTexte()}`;
  if (test) return sig;
  c.fillStyle = "#0b1f3a"; c.fillRect(0, 0, L, H);
  dessinerLogo(c, 22, 18, 30);
  c.fillStyle = "#ffffff"; c.font = "800 22px Inter, Arial"; c.textAlign = "right"; c.fillText(heureTexte(), L - 22, 42);
  c.textAlign = "left"; c.fillStyle = MARQUE.peche; c.font = "800 18px Inter, Arial"; c.fillText(T("ACTUALITÉS", "NEWS"), 22, 86);
  const lignes = fil.length ? fil : [{ auteur: "Veltis", texte: T("NPS 47 · churn 4,1 % ce trimestre", "NPS 47 · churn 4.1% this quarter") }];
  lignes.forEach((f, i) => {
    const y = 118 + i * 58;
    c.fillStyle = "#13315c"; c.fillRect(18, y - 22, L - 36, 50);
    c.fillStyle = "#93c5fd"; c.font = "700 14px Inter, Arial"; c.fillText(f.auteur, 30, y - 4);
    c.fillStyle = "#ffffff"; c.font = "500 15px Inter, Arial";
    c.fillText(f.texte.length > 64 ? `${f.texte.slice(0, 62)}…` : f.texte, 30, y + 17);
  });
  return sig;
}
// Panneau de réservation à la porte de chaque salle (R+1)
const AGENDA_SALLES = [T("Point équipe", "Team catch-up"), T("Démo client", "Customer demo"), T("Revue de compte", "Account review"), T("Entretien", "Interview"), T("Visio partenaire", "Partner video call"), T("Formation", "Training")];
function etatSalle(s) {
  const dans = p => p.x >= s.minX && p.x <= s.maxX && p.z >= s.minZ && p.z <= s.maxZ;
  if (s.cle === "agora" && vie.reunion && vie.reunion.participants.some(e => e.etat === "activite" && e.activite.type === "reunion")) return { occupe: true, titre: vie.reunion.sujet };
  if (pnjs.some(p => p.mesh.visible && dans(p.mesh.position))) return { occupe: true, titre: T("Rendez-vous client", "Customer meeting") };
  const present = employes.find(e => e.etage === 1 && e.mesh.visible && dans(e.mesh.position));
  if (present) return { occupe: true, titre: s.type === "bureau" ? present.def.nom : T("Réunion interne", "Internal meeting") };
  return { occupe: false };
}
function panneauReservation(g, s) {
  const sud = s.porte === "sud";
  const x = sud ? s.x + 1.15 : s.minX - 0.07, z = sud ? s.maxZ + 0.07 : s.z + 1.15, a = sud ? 0 : -O / 2;
  ecranDynamique(g, x, 1.45, z, a, 0.36, 0.22, 288, 176, (c, L, H, test) => {
    const e = etatSalle(s);
    const h = horaire();
    const prochain = 10 + Math.floor(hasard(s.x, h.jour, 3) * 7) + (h.heure > 15 ? 1 : 0);
    const resa = `${String(Math.max(Math.ceil(h.heure + 0.5), Math.min(17, prochain))).padStart(2, "0")}:00 · ${AGENDA_SALLES[Math.floor(hasard(s.z, h.jour, 5) * AGENDA_SALLES.length)]}`;
    const sig = `${e.occupe}|${e.titre || ""}|${resa}`;
    if (test) return sig;
    c.fillStyle = "#0f172a"; c.fillRect(0, 0, L, H);
    c.fillStyle = e.occupe ? "#dc2626" : "#16a34a"; c.fillRect(0, 0, L, 64);
    c.fillStyle = "#ffffff"; c.font = "800 30px Inter, Arial"; c.textAlign = "left";
    c.fillText(e.occupe ? T("OCCUPÉ", "BUSY") : T("LIBRE", "FREE"), 16, 44);
    c.font = "600 17px Inter, Arial"; c.fillStyle = "#e2e8f0";
    const t = e.occupe ? e.titre : T("Disponible maintenant", "Available now");
    c.fillText(t.length > 26 ? `${t.slice(0, 25)}…` : t, 16, 96);
    c.fillStyle = "#94a3b8"; c.font = "500 15px Inter, Arial";
    c.fillText(`${T("Ensuite", "Next")} : ${resa}`, 16, 132);
    return sig;
  }, false);
}

/* ---------- L5. Fil d'actualité interne ---------- */
const DEBUT_SANS_FIL = 45;
vie.fil = [];
vie.signatures = [];
function publier(auteur, texte, { couleur = "#334155", type = "info" } = {}) {
  const heure = heureTexte();
  vie.fil.push({ auteur, texte, couleur, type, heure });
  if (vie.fil.length > 40) vie.fil.shift();
  if (!jeu.def || !["jeu", "dialogue", "fenetre", "ascenseur"].includes(jeu.mode)) return;
  // Le fil reste silencieux pendant les 45 premières secondes de la mission (il est conservé dans vie.fil)
  if (jeu.dureeReelle < DEBUT_SANS_FIL) return;
  const zone = $("fil");
  const el = document.createElement("div");
  el.className = `fil-post fil-${type}`;
  el.innerHTML = `<span class="fil-avatar" style="background:${couleur}">${echapper(initiales(auteur))}</span><span class="fil-corps"><span class="fil-tete"><strong>${echapper(auteur)}</strong><time>${heure}</time></span><span class="fil-texte">${echapper(texte)}</span></span>`;
  zone.appendChild(el);
  // Pile unique : un seul message du fil à la fois, sous les notifications
  while (zone.children.length > 1) zone.firstChild.remove();
  setTimeout(() => el.classList.add("sortie"), 7500);
  setTimeout(() => el.remove(), 8100);
}
const FIL_DIVERS = [
  () => ["Pauline Girard", T("Rappel : les entretiens annuels sont à planifier avant vendredi.", "Reminder: annual reviews must be scheduled before Friday."), "#7c2d12"],
  () => ["Léa Chevalier", T("Le livre blanc « Le coût caché de la double saisie » a été téléchargé 48 fois cette semaine.", "The white paper “The hidden cost of double entry” was downloaded 48 times this week."), "#475569"],
  () => ["Sébastien Roy", T("Maintenance terminée : l'imprimante du R+1 refonctionne.", "Maintenance done: the level 1 printer is working again."), "#0369a1"],
  () => ["Café du Parvis", T("Plat du jour : risotto aux champignons, tarte aux pommes en dessert.", "Today's special: mushroom risotto, apple tart for dessert."), "#78350f"],
  () => ["Sandrine Morel", T("Pensez à mettre à jour vos opportunités avant la revue du pipeline.", "Remember to update your opportunities before the pipeline review."), "#1e293b"],
  () => ["Catherine Aubert", T("Bravo à toutes et à tous : NPS à 47 ce trimestre, notre meilleur score.", "Well done everyone: NPS at 47 this quarter, our best score."), "#1e293b"],
  () => ["Chloé Bernard", T("Deux visiteurs sont arrivés à l'accueil du RDC pour le salon Coupole.", "Two visitors have arrived at ground-floor reception for the Coupole Room."), "#475569"],
  () => ["Inès Laurent", T("Batinord est passé en santé « verte » : merci pour la passation soignée.", "Batinord's account health is now “green”: thanks for the careful handover."), "#0f766e"],
  () => ["Claire Fontaine", T("Nouvelle session de formation flash à l'Academy (R+2) cet après-midi.", "New quick-course session at the Academy (level 2) this afternoon."), "#1d4ed8"],
  () => ["Nadia Benali", T("Livraison de colis au RDC : pensez à récupérer les vôtres à l'accueil.", "Parcels delivered on the ground floor: pick yours up at reception."), "#475569"]
];

/* ---------- L6. Signatures des autres commerciaux, en direct ---------- */
const CLIENTS_SIGNES = ["Altarys", "Brévalis Industrie", "Clinique du Val Fleuri", "Transports Kerval", "Nexalia", "Groupe Morvane", "Laboratoires Elvira", "Menuiseries Delorme", "Quadrance Conseil", "Hôtels Saint-Clair", "Agrivia", "Optéo Services"];
function signatureCommerciale() {
  const candidats = COMMERCIAUX.filter(c => {
    const e = employes.find(x => x.cle === c.cle);
    if (e) return e.mesh.visible && !e.enEchange && e.etat === "activite";
    return figurants.some(f => f.def.cle === c.cle);
  });
  if (!candidats.length) return;
  const c = choisirTexte(candidats);
  const montant = Math.round(ARR_REFERENCE() * c.panier * (0.65 + Math.random() * 0.8) / 100) * 100;
  const client = choisirTexte(CLIENTS_SIGNES);
  vie.signatures.push({ cle: c.cle, qui: c.nom, client, montant });
  publier(c.nom, EN ? `Signed: ${client} · ${keuros(montant)} per year 🎉` : `Signé : ${client} · ${keuros(montant)} par an 🎉`, { couleur: "#15803d", type: "signature" });
  const e = employes.find(x => x.cle === c.cle);
  const f = figurants.find(x => x.def.cle === c.cle);
  const auteur = e ? e.mesh : f ? f.mesh : null;
  const etage = e ? e.etage : f ? f.etage : 1;
  if (e) parler(e, EN ? `Signed with ${client}!` : `Signé avec ${client} !`, 5);
  if (f) parlerBulleFigurant(f, EN ? `Signed with ${client}!` : `Signé avec ${client} !`, 5);
  if (etage === joueur.etage) son("cloche");
  // Les collègues proches applaudissent
  if (auteur) employes.forEach(o => {
    if (o.cle === c.cle || o.etage !== etage || o.enEchange || !o.mesh.visible) return;
    if (Math.hypot(o.mesh.position.x - auteur.position.x, o.mesh.position.z - auteur.position.z) < 7 && Math.random() < 0.7)
      setTimeout(() => parler(o, choisirTexte([T("Bravo !", "Well done!"), T("Bien joué !", "Nice one!"), T("Super, félicitations !", "Great, congratulations!"), T("Belle signature !", "Great deal!")]), 3), 900 + Math.random() * 1500);
  });
}

/* ---------- L7. Rythme de la journée ---------- */
const COMMERCIAUX_STANDUP = ["thomas", "sofia", "amelie", "bastien", "maxime"];
LIEUX.standup = [-12.6, -11.6, -10.6, -9.6, -8.6].map(x => ({ x, z: -4.85, a: O, pose: "debout" }));
LIEUX.standupAnimateur = [{ x: -13.7, z: -5.15, a: O / 2, pose: "parle" }];
const REPLIQUES_STANDUP = [T("Hier : deux démos. Aujourd'hui : relances Medilys.", "Yesterday: two demos. Today: Medilys follow-ups."), T("J'ai trois opportunités à qualifier cette semaine.", "I've got three opportunities to qualify this week."), T("Signature attendue jeudi chez un client industriel.", "Signature expected Thursday with an industrial customer."), T("Besoin de Yanis pour une démo vendredi.", "I need Yanis for a demo on Friday."), T("Aucun blocage de mon côté.", "No blockers on my side.")];
function lancerStandup() {
  const participants = COMMERCIAUX_STANDUP.map(employe).filter(e => e && e.etage === 1 && e.mesh.visible && !e.enEchange && !occupeParJoueur(e) && !["reunion", "pot", "demande", "attente"].includes(e.activite.type));
  const animateur = employe("manager");
  if (participants.length < 2) return;
  const fin = vie.temps + 45;
  participants.forEach((e, i) => { libererLieu(e); envoyer(e, "standup", LIEUX.standup[i], 35); e.activite.finGroupe = fin; });
  if (animateur && !animateur.enEchange && !occupeParJoueur(animateur)) { envoyer(animateur, "standup", LIEUX.standupAnimateur[0], 35); animateur.activite.finGroupe = fin; participants.push(animateur); }
  vie.standup = { fin, participants, sujet: T("Stand-up commercial", "Sales stand-up") };
  publier("Sandrine Morel", T("Stand-up commercial devant le tableau des objectifs : 10 minutes, debout !", "Sales stand-up by the targets board: 10 minutes, standing!"), { couleur: "#1e293b" });
}
// Planning de la journée : appelé à chaque image depuis la vie de l'étage
function majJournee(dt) {
  const h = horaire();
  if (vie.standup && vie.temps > vie.standup.fin + 6) vie.standup = null;
  if (!h.actif || jeu.mode === "pause") return;
  if (h.m >= 25 && h.m < 50 && vie.standupJour !== h.jour && !vie.reunion) { vie.standupJour = h.jour; lancerStandup(); }
  if (h.m >= 190 && h.m < 200 && vie.midiJour !== h.jour) { vie.midiJour = h.jour; publier("Café du Parvis", T("Le service du midi commence au RDC : plat du jour, salades et wraps.", "Lunch service starts on the ground floor: dish of the day, salads and wraps."), { couleur: "#78350f" }); }
  if (h.semaine === 4 && h.m >= 480 && vie.afterworkJour !== h.jour && !vie.pot) { vie.afterworkJour = h.jour; lancerPot(T("Afterwork du vendredi", "Friday afterwork")); publier("Catherine Aubert", T("Afterwork à la cafétéria du R+1 : merci pour cette semaine !", "Afterwork at the level 1 cafeteria: thanks for this week!"), { couleur: "#1e293b" }); }
  if (h.m < 20) vie.departsJour = null;
  if (vie.temps > (vie.prochaineSignature || 60) && h.m < 500) { vie.prochaineSignature = vie.temps + 140 + Math.random() * 120; signatureCommerciale(); }
  if (vie.temps > (vie.prochainFil || 40)) { vie.prochainFil = vie.temps + 80 + Math.random() * 70; const [a, t, c] = choisirTexte(FIL_DIVERS)(); publier(a, t, { couleur: c }); }
}
const enPauseDejeuner = () => { const h = horaire(); return h.actif && h.m >= 195 && h.m < 285; };
const heureDepart = e => 505 + (hacher(e.cle) % 30);
const heureArrivee = e => (hacher(e.cle) % 25);
const restePresent = e => SANS_SORTIE.includes(e.cle) || e.etiquetteMission || occupeParJoueur(e);
// Choix d'activité selon le moment de la journée (sinon : choix habituel)
function activiteDuMoment(e) {
  const h = horaire();
  if (!h.actif || e.def.accueil) return false;
  if (h.m >= heureDepart(e) && !restePresent(e)) {
    envoyer(e, "depart", pointAppel(cabineProche(e.mesh.position.z)), 1);
    return true;
  }
  if (enPauseDejeuner() && e.dejeuner !== h.jour) {
    e.dejeuner = h.jour;
    if (peutSortir(e) && Math.random() < 0.6) { e.sortieVers = 0; envoyer(e, "sortie", pointAppel(cabineProche(e.mesh.position.z)), 1); return true; }
    const lieu = lieuLibre(LIEUX.cafe);
    if (lieu) { envoyer(e, "dejeuner", lieu, 40 + Math.random() * 30); return true; }
  }
  return false;
}
// Arrivée le matin : depuis l'entrée du RDC jusqu'au poste
function majAbsent(e) {
  const h = horaire();
  if (!h.actif) { ramener(e); return; }
  if (h.m >= heureDepart(e) || h.m < heureArrivee(e)) return;
  e.absent = false;
  e.mesh.visible = true;
  teleporterEmploye(e, 0, 10.2, 11.6);
  e.etat = "activite";
  e.activite = { type: "travail", lieu: e.siege, fin: 0 };
  libererLieu(e);
  envoyer(e, "arrivee", pointAppel(Math.floor(Math.random() * CABINES.length)), 1);
}

/* ---------- L8. Personnel de service et objets portés ---------- */
LIEUX_NIVEAU[1] = {
  imprimante: [{ x: -4.35, z: -5.0, a: O / 2, pose: "debout" }, { x: -4.4, z: -6.4, a: O / 2, pose: "debout" }],
  bureaux: [-13.0, -10.4, -7.8].flatMap(x => [-3.9, 1.9].map(z => ({ x: x - 1.2, z: z + 0.15, a: O / 2, pose: "debout" }))),
  couloir: [{ x: 0.2, z: -5.2, a: 0, pose: "debout" }, { x: -0.2, z: 1.6, a: O, pose: "debout" }, { x: 0.3, z: 9.6, a: O, pose: "debout" }, { x: -2.6, z: -7.6, a: 0, pose: "debout" }],
  cafeteria: [{ x: -3.0, z: 10.7, a: O / 2, pose: "debout" }, { x: -5.9, z: 10.4, a: -O / 2, pose: "debout" }, { x: -3.0, z: 5.6, a: O / 2, pose: "debout" }],
  detente: [{ x: -12.2, z: 9.9, a: O / 2, pose: "debout" }, { x: -16.6, z: 7.6, a: 0, pose: "debout" }]
};
LIEUX_NIVEAU[0].livraison = [{ x: 9.4, z: 7.0, a: O, pose: "debout" }, { x: 10.2, z: 10.8, a: O, pose: "debout" }, { x: 13.0, z: 9.0, a: -O / 2, pose: "debout" }];
FIGURANTS_DEF.push(
  { cle: "sebastien", etage: 1, nom: "Sébastien Roy", fonction: T("Technicien informatique", "IT technician"), entreprise: "Veltis", type: "it", apparence: 4, genre: "h", variante: 83, tenue: "ville", haut: 0x0369a1, bas: 0x1f2937, badge: true, lieux: ["imprimante", "bureaux", "couloir"], couleur: "#0369a1", objet: "portable" },
  { cle: "maria", etage: 1, nom: "Maria Lopes", fonction: T("Agente d'entretien", "Cleaning staff"), entreprise: T("Services généraux", "Facilities"), type: "entretien", apparence: 7, genre: "f", variante: 94, tenue: "ville", haut: 0x0f766e, bas: 0x334155, lieux: ["couloir", "cafeteria", "detente"], couleur: "#0f766e", objet: "chariot" },
  { cle: "kevin", etage: 0, nom: "Kévin Martin", fonction: T("Coursier", "Courier"), entreprise: "Express Défense", type: "coursier", apparence: 2, genre: "h", variante: 17, tenue: "ville", haut: 0x1f2937, bas: 0x1f2937, lieux: ["livraison", "hall"], couleur: "#1f2937", objet: "diable" }
);
REPLIQUES_FIGURANTS.it = [T("Encore un bourrage papier…", "Another paper jam…"), T("Je redémarre le point d'accès Wi-Fi.", "I'm restarting the Wi-Fi access point."), T("Ton poste est à jour, tu peux y aller.", "Your computer is up to date, you're good to go.")];
REPLIQUES_FIGURANTS.entretien = [T("Attention, sol mouillé.", "Careful, wet floor."), T("Bonne journée !", "Have a good day!")];
REPLIQUES_FIGURANTS.coursier = [T("Une livraison pour Veltis.", "A delivery for Veltis."), T("Signature ici, s'il vous plaît.", "Sign here, please.")];
// Accessoires qui accompagnent une personne (chariot, diable)
function equiperFigurant(f) {
  const o = f.def.objet;
  if (o === "chariot") {
    const c = new THREE.Group();
    c.add(pos(boite(0.5, 0.5, 0.4, 0x0f766e), 0, 0.42, 0));
    c.add(pos(boite(0.5, 0.03, 0.42, 0x1f2937), 0, 0.68, 0));
    c.add(pos(cylindre(0.12, 0.12, 0.3, 0xfacc15, 10), 0.12, 0.85, 0));
    c.add(pos(cylindre(0.012, 0.012, 1.0, 0x9ca3af, 6), -0.18, 1.0, 0.1));
    [-0.2, 0.2].forEach(dx => [-0.15, 0.15].forEach(dz => c.add(pos(cylindre(0.04, 0.04, 0.03, 0x111827, 8), dx, 0.05, dz))));
    f.mesh.add(pos(sansOmbrePortee(c), 0, 0, 0.62));
  } else if (o === "diable") {
    const c = new THREE.Group();
    c.add(pos(boite(0.42, 0.34, 0.32, 0xb59b7c), 0, 0.3, 0));
    c.add(pos(boite(0.36, 0.26, 0.28, 0xc8ad8a), 0, 0.6, 0));
    c.add(pos(boite(0.04, 1.1, 0.04, 0x374151), -0.2, 0.6, -0.18));
    c.add(pos(boite(0.04, 1.1, 0.04, 0x374151), 0.2, 0.6, -0.18));
    f.mesh.add(pos(sansOmbrePortee(c), 0, 0, 0.55));
  }
  if (o) f.mesh.userData.objetsPortes = true;
}
// Objets en main : tasse, ordinateur portable, dossier
function objetsMain(mesh) {
  if (mesh.userData.objetsMain) return mesh.userData.objetsMain;
  const gltf = !!mesh.userData.gltf;
  const coude = gltf ? null : mesh.userData.coudes[1];
  const tasse = new THREE.Group();
  tasse.add(pos(cylindre(0.035, 0.03, 0.09, 0xf8fafc, 10), 0, 0, 0));
  tasse.add(pos(cylindre(0.033, 0.033, 0.005, 0x3b2a1e, 10), 0, 0.044, 0));
  const portable = pos(boite(0.3, 0.025, 0.22, 0x6b7280), 0, 0.02, 0.02);
  portable.rotation.x = 1.25;
  const dossier = pos(boite(0.24, 0.02, 0.31, 0x1e3a8a), 0, 0, 0.02);
  dossier.rotation.x = 1.3;
  const o = { tasse: pos(tasse, 0, -0.33, 0.06), portable: pos(portable, 0.03, -0.3, 0.08), dossier: pos(dossier, 0.03, -0.3, 0.08), actuel: null };
  if (gltf) { o.tasse.position.set(0, 0.06, 0.04); o.portable.position.set(0, 0.04, 0.12); o.dossier.position.set(0, 0.04, 0.1); }
  [o.tasse, o.portable, o.dossier].forEach(m => { m.visible = false; sansOmbrePortee(m); if (gltf) attacherMain(mesh, m); else coude.add(m); });
  mesh.userData.objetsMain = o;
  return o;
}
function majObjetsPortes(e) {
  const t = e.activite.type;
  let p = e.porte || null;
  if (e.etat === "activite") {
    if (["machine", "cafe", "pot", "dejeuner"].includes(t)) p = "tasse";
    else if (t === "imprimante") p = "dossier";
    else if (["travail", "appel", "detente", "standup"].includes(t)) p = t === "standup" ? "portable" : null;
  } else if (e.etat === "trajet" && ["reunion", "standup"].includes(t)) p = "portable";
  else if (e.etat === "trajet" && ["depart", "arrivee"].includes(t)) p = null;
  if (p === e.porte && e.mesh.userData.objetsMain) return;
  e.porte = p;
  const o = objetsMain(e.mesh);
  ["tasse", "portable", "dossier"].forEach(k => { o[k].visible = k === p; });
}

/* ---------- L9. Installation dans les niveaux ---------- */
function installerEntreprise() {
  const R1 = ETAGES[1].groupe, R0 = ETAGES[0].groupe, R2 = ETAGES[2].groupe;
  const etage = (n, f) => { obstaclesConstruction = ETAGES[n].obstacles; const g = new THREE.Group(); f(g); ETAGES[n].groupe.add(g); obstaclesConstruction = obstacles; fusionnerDecor(g); instancierRepetitions(g); return g; };
  etage(1, g => {
    faceNordNoyau(g);
    equiperPoteaux(g);
    equipementsR1(g);
    creerHorloge(g, 1.87, 2.62, 7.4, -O / 2, 0.22);
    // Classement des ventes en direct, face à l'open space
    g.add(pos(boite(0.1, 1.0, 0.1, 0x374151), -5.15, 0.5, -1.0));
    g.add(pos(boite(0.6, 0.04, 0.5, 0x374151), -5.15, 0.02, -1.0));
    obstacleBoite(-5.15, -1.0, 0.3, 0.25);
    ecranDynamique(g, -5.2, 1.62, -1.0, -O / 2, 1.6, 0.9, 640, 360, dessinVentes);
    SALLES.forEach(s => panneauReservation(g, s));
  });
  etage(0, g => {
    faceNordNoyau(g);
    equiperPoteaux(g);
    panneauMarque(g, 1.86, 1.75, 8.0, -O / 2, 2.2, 0.95);
    tableauArt(g, 1.86, 1.65, 10.6, -O / 2, 1.0, 1.3, 7);
    afficheValeurs(g, 8.0, 1.55, 2.88, O);
    tableauArt(g, 12.2, 1.65, 2.88, O, 1.3, 1.0, 3);
    ecranDynamique(g, 12.4, 1.85, 3.13, 0, 1.7, 1.0, 480, 290, dessinActualites);
  });
  etage(2, g => {
    faceNordNoyau(g);
    equiperPoteaux(g);
    afficheValeurs(g, 1.86, 1.55, 7.8, -O / 2);
    tableauArt(g, 1.86, 1.65, 10.2, -O / 2, 1.0, 1.3, 11);
    creerHorloge(g, -12.6, 2.65, -12.2, 0, 0.2);
  });
  figurants.forEach(f => { if (f.def.objet === "chariot" || f.def.objet === "diable") equiperFigurant(f); });
}

/* Échanges avec le personnel de service */
const DIALOGUES_SERVICE = {
  it: () => [T("« Je dépanne l'imprimante du R+1. Un souci avec ton poste ? »", "“I'm fixing the level 1 printer. Any trouble with your computer?”"), [
    { label: T("Lui signaler que le CRM est lent ce matin.", "Tell him the CRM is slow this morning."), reponse: T("Je regarde tout de suite, c'est sûrement la synchronisation. Merci de me prévenir plutôt que de contourner le problème !", "I'll look right away, it's probably the sync. Thanks for telling me rather than working around it!"), journal: T("incident informatique signalé au support.", "IT issue reported to support.") },
    { label: T("Le remercier pour son aide de la semaine dernière.", "Thank him for his help last week."), reponse: T("Ça fait plaisir, on ne nous remercie pas souvent !", "That's nice to hear, we don't often get thanked!") }
  ], T("Support informatique", "IT support")],
  entretien: () => [T("« Bonjour ! Attention, le sol est encore humide près de la cafétéria. »", "“Hello! Careful, the floor is still wet near the cafeteria.”"), [
    { label: T("La remercier et lui souhaiter une bonne journée.", "Thank her and wish her a good day."), reponse: T("Merci, vous aussi !", "Thanks, you too!") },
    { label: T("Lui demander depuis combien de temps elle travaille ici.", "Ask how long she's worked here."), reponse: T("Six ans ! Je connais tout le monde, même ceux qui oublient leur tasse sur le bureau…", "Six years! I know everyone, even the ones who leave their mug on the desk…") }
  ]],
  coursier: () => [T("« Un colis pour Veltis. C'est bien ici, l'accueil ? »", "“A parcel for Veltis. Is this reception?”"), [
    { label: T("Lui indiquer l'accueil, juste devant.", "Point him to reception, just ahead."), reponse: T("Merci, bonne journée !", "Thanks, have a good day!") },
    { label: T("Lui demander s'il livre souvent à La Défense.", "Ask if he often delivers in La Défense."), reponse: T("Tous les jours, une quarantaine de tours. Ici, au moins, l'accueil est souriant !", "Every day, about forty towers. Here, at least, reception is friendly!") }
  ]]
};
let minuterieEcrans = 0;
function majEntreprise(dt) {
  majHorloges();
  minuterieEcrans += dt;
  if (minuterieEcrans > 0.5) { minuterieEcrans = 0; majEcransDynamiques(); }
}

function filHTML() {
  const fil = vie.fil.slice(-12).reverse();
  if (!fil.length) return "";
  return `<h4>${T("Fil de l'entreprise", "Company feed")}</h4><ul class="fil-liste">${fil.map(f => `<li><span class="fil-avatar" style="background:${f.couleur}">${echapper(initiales(f.auteur))}</span><span><strong>${echapper(f.auteur)}</strong> <time>${echapper(f.heure)}</time><br>${echapper(f.texte)}</span></li>`).join("")}</ul>`;
}

/* =====================================================================
   PARTIE M — OUTIL DE MESURE DES PERFORMANCES (DEBUG)
   ---------------------------------------------------------------------
   F3        : affiche / masque le panneau (masqué par défaut).
   Maj + F3  : banc de test automatique, chaque qualité × chaque étage.
   Les compteurs de rendu (renderer.info) sont cumulés sur TOUTES les
   passes du composeur : remise à zéro manuelle une fois par image.
   ===================================================================== */
renderer.info.autoReset = false;
const debugPerf = { visible: false, el: null, images: 0, temps: 0, cpu: 0, derniere: performance.now(), debutCpu: 0, maj: 0, scene: null, sceneMaj: 0, rendu: null };

// Comptages de la scène : objets réellement affichables (groupes masqués exclus)
function compterScene() {
  const r = { meshes: 0, triangles: 0, ombres: 0, geometries: new Set(), materiaux: new Set(), geometriesTotal: new Set(), materiauxTotal: new Set(), meshesTotal: 0 };
  const triangles = m => {
    const g = m.geometry;
    if (!g || !g.attributes || !g.attributes.position) return 0;
    const n = (g.index ? g.index.count : g.attributes.position.count) / 3;
    return n * (m.isInstancedMesh ? m.count : 1);
  };
  scene.traverse(o => {
    if (!o.isMesh) return;
    r.meshesTotal++;
    r.geometriesTotal.add(o.geometry.uuid);
    [].concat(o.material).forEach(m => r.materiauxTotal.add(m.uuid));
  });
  scene.traverseVisible(o => {
    if (!o.isMesh) return;
    r.meshes++;
    r.triangles += triangles(o);
    if (o.castShadow) r.ombres++;
    r.geometries.add(o.geometry.uuid);
    [].concat(o.material).forEach(m => r.materiaux.add(m.uuid));
  });
  return { meshes: r.meshes, triangles: Math.round(r.triangles), ombres: r.ombres, geometries: r.geometries.size, materiaux: r.materiaux.size,
    meshesTotal: r.meshesTotal, geometriesTotal: r.geometriesTotal.size, materiauxTotal: r.materiauxTotal.size };
}
// Compteurs de rendu de l'image courante (toutes passes confondues)
const releveRendu = () => ({
  appels: renderer.info.render.calls, triangles: renderer.info.render.triangles,
  geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, programmes: (renderer.info.programs || []).length
});
// Appelé au début et à la fin de chaque image par la boucle principale
function debugDebutImage() {
  renderer.info.reset();
  debugPerf.debutCpu = performance.now();
}
function debugFinImage() {
  const maintenant = performance.now();
  debugPerf.cpu += maintenant - debugPerf.debutCpu;
  debugPerf.temps += maintenant - debugPerf.derniere;
  debugPerf.derniere = maintenant;
  debugPerf.images++;
  debugPerf.rendu = releveRendu();
  if (!debugPerf.visible || bancTest.actif) return;
  if (maintenant - debugPerf.maj < 250) return;
  debugPerf.maj = maintenant;
  if (maintenant - debugPerf.sceneMaj > 1000 || !debugPerf.scene) { debugPerf.scene = compterScene(); debugPerf.sceneMaj = maintenant; }
  const fps = debugPerf.images / (debugPerf.temps / 1000), ms = debugPerf.temps / debugPerf.images, cpu = debugPerf.cpu / debugPerf.images;
  debugPerf.images = 0; debugPerf.temps = 0; debugPerf.cpu = 0;
  afficherPanneauDebug(fps, ms, cpu);
}
const fmt = v => Math.round(v).toLocaleString("fr-FR");
function afficherPanneauDebug(fps, ms, cpu) {
  const r = debugPerf.rendu, s = debugPerf.scene;
  debugPerf.el.querySelector(".dbg-direct").innerHTML = `
    <tr><th>FPS</th><td class="${fps < 30 ? "dbg-mauvais" : fps < 50 ? "dbg-moyen" : "dbg-bon"}">${fps.toFixed(1)}</td></tr>
    <tr><th>ms / image</th><td>${ms.toFixed(1)}</td></tr>
    <tr><th>ms CPU (boucle)</th><td>${cpu.toFixed(1)}</td></tr>
    <tr><th>Qualité · étage</th><td>${rendu.qualite} · ${ETAGES[joueur.etage].code}${rendu.ssao ? " · SSAO" : ""}</td></tr>
    <tr class="dbg-sep"><th>Draw calls (toutes passes)</th><td>${fmt(r.appels)}</td></tr>
    <tr><th>Triangles (toutes passes)</th><td>${fmt(r.triangles)}</td></tr>
    <tr><th>Géométries en mémoire</th><td>${fmt(r.geometries)}</td></tr>
    <tr><th>Textures en mémoire</th><td>${fmt(r.textures)}</td></tr>
    <tr><th>Programmes (shaders)</th><td>${fmt(r.programmes)}</td></tr>
    <tr class="dbg-sep"><th>Meshes visibles</th><td>${fmt(s.meshes)} <small>/ ${fmt(s.meshesTotal)}</small></td></tr>
    <tr><th>Triangles visibles</th><td>${fmt(s.triangles)}</td></tr>
    <tr><th>Meshes castShadow</th><td>${fmt(s.ombres)}</td></tr>
    <tr><th>Géométries uniques</th><td>${fmt(s.geometries)} <small>/ ${fmt(s.geometriesTotal)}</small></td></tr>
    <tr><th>Matériaux uniques</th><td>${fmt(s.materiaux)} <small>/ ${fmt(s.materiauxTotal)}</small></td></tr>`;
}
function basculerPanneauDebug(force) {
  debugPerf.visible = force ?? !debugPerf.visible;
  if (!debugPerf.el) {
    const el = document.createElement("div");
    el.id = "debug-perf";
    el.className = "debug-perf";
    el.innerHTML = `<div class="dbg-titre">Mesures · F3 masquer · Maj+F3 banc de test</div><table class="dbg-direct"></table><div class="dbg-banc"></div>`;
    document.body.appendChild(el);
    debugPerf.el = el;
  }
  debugPerf.el.classList.toggle("cache", !debugPerf.visible);
  debugPerf.images = 0; debugPerf.temps = 0; debugPerf.cpu = 0; debugPerf.maj = 0; debugPerf.sceneMaj = 0;
}

/* Banc de test : chaque qualité × chaque étage, caméra en rotation lente au centre de l'étage */
const bancTest = { actif: false, file: [], i: -1, t: 0, acc: null, resultats: [], etat: null, derniere: 0 };
const DUREE_BANC = { chauffe: 0.8, mesure: 2.5 };
function lancerBanc() {
  if (bancTest.actif) return;
  basculerPanneauDebug(true);
  bancTest.etat = { qualite: reglages().graphismes, etage: joueur.etage, allegement: rendu.allegement || 0 };
  rendu.allegement = 0;
  bancTest.file = [];
  ["faible", "moyen", "eleve", "ultra"].forEach(q => [0, 1, 2].forEach(n => bancTest.file.push({ q, n })));
  bancTest.resultats = [];
  bancTest.i = -1;
  bancTest.actif = true;
  debugPerf.el.querySelector(".dbg-banc").innerHTML = `<p>Banc en cours… (${bancTest.file.length} configurations, environ ${Math.round(bancTest.file.length * (DUREE_BANC.chauffe + DUREE_BANC.mesure))} s)</p>`;
  bancSuivant();
}
function bancSuivant() {
  bancTest.i++;
  if (bancTest.i >= bancTest.file.length) { finirBanc(); return; }
  const { q, n } = bancTest.file[bancTest.i];
  reglages().graphismes = q;
  configurerRendu();
  afficherNiveau(n);
  bancTest.t = 0;
  bancTest.derniere = performance.now();
  bancTest.acc = { images: 0, temps: 0, cpu: 0, appels: 0, triangles: 0 };
}
// Remplace la boucle de jeu pendant le banc : uniquement caméra + rendu
function executerBanc() {
  const maintenant = performance.now();
  const dt = (maintenant - bancTest.derniere) / 1000;
  bancTest.derniere = maintenant;
  bancTest.t += dt;
  const c = bancTest.file[bancTest.i];
  const angle = bancTest.t / DUREE_BANC.mesure * Math.PI * 2;
  camera.position.set(0.5, ETAGES[c.n].y + HAUTEUR_YEUX, 1.5);
  camera.lookAt(camera.position.x + Math.sin(angle), camera.position.y - 0.05, camera.position.z + Math.cos(angle));
  const debut = performance.now();
  renderer.info.reset();
  rendre();
  const cpu = performance.now() - debut;
  if (bancTest.t > DUREE_BANC.chauffe) {
    const a = bancTest.acc;
    a.images++; a.temps += dt; a.cpu += cpu;
    a.appels += renderer.info.render.calls; a.triangles += renderer.info.render.triangles;
  }
  if (bancTest.t > DUREE_BANC.chauffe + DUREE_BANC.mesure) {
    const a = bancTest.acc, r = releveRendu(), s = compterScene();
    bancTest.resultats.push({
      qualite: c.q, etage: ETAGES[c.n].code, ssao: !!rendu.ssao, fps: a.images / a.temps, ms: a.temps / a.images * 1000, cpuRendu: a.cpu / a.images,
      appels: a.appels / a.images, triangles: a.triangles / a.images, geometriesMemoire: r.geometries, textures: r.textures, programmes: r.programmes,
      meshes: s.meshes, trianglesScene: s.triangles, ombres: s.ombres, geometries: s.geometries, materiaux: s.materiaux
    });
    bancSuivant();
  }
}
function finirBanc() {
  bancTest.actif = false;
  if (bancTest.etat.qualite === undefined) delete reglages().graphismes; else reglages().graphismes = bancTest.etat.qualite;
  rendu.allegement = bancTest.etat.allegement;
  configurerRendu();
  afficherNiveau(joueur.etage);
  window.mesuresBanc = bancTest.resultats;
  const lignes = bancTest.resultats.map(m => `| ${m.qualite}${m.ssao ? " (SSAO)" : ""} | ${m.etage} | ${m.fps.toFixed(1)} | ${m.ms.toFixed(1)} | ${Math.round(m.appels)} | ${fmt(m.triangles)} | ${m.meshes} | ${fmt(m.trianglesScene)} | ${m.ombres} | ${m.geometries} | ${m.materiaux} | ${m.textures} | ${m.programmes} |`);
  const tableau = ["| Qualité | Étage | FPS | ms/image | Draw calls | Triangles rendus | Meshes visibles | Triangles visibles | castShadow | Géométries uniques | Matériaux uniques | Textures | Programmes |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|---|"].concat(lignes).join("\n");
  console.table(bancTest.resultats);
  debugPerf.el.querySelector(".dbg-banc").innerHTML = `<p>Banc terminé · ${navigator.userAgent.match(/(Chrome|Firefox|Safari)\/[\d.]+/)?.[0] || ""} · ${window.innerWidth}×${window.innerHeight} · pixel ratio ${window.devicePixelRatio}</p>
    <p>Tableau à copier (Markdown) :</p><textarea readonly rows="8">${tableau}</textarea>`;
}
document.addEventListener("keydown", e => {
  if (e.key !== "F3") return;
  e.preventDefault();
  e.stopImmediatePropagation();
  if (e.repeat) return;
  if (e.shiftKey) lancerBanc(); else basculerPanneauDebug();
}, true);

/* =====================================================================
   PARTIE N — PERSONNAGES glTF (LOT 3)
   ---------------------------------------------------------------------
   Modèles riggés CC0 (voir CREDITS.md), embarqués en base64 dans
   assets/personnages/*.js : chargés par <script>, donc compatibles file://.
   Au chargement, les zones de couleur d'un modèle sont fusionnées en un
   seul maillage (1 draw call) ; la couleur est portée par les sommets,
   ce qui permet d'habiller chaque personnage sans nouveau matériau.
   Le corps est animé par AnimationMixer (repos, assis, marche) ; la tête
   reste pilotée par le jeu (regard vers le joueur ou l'interlocuteur).
   ===================================================================== */
const modelesGltf = {};
const personnagesGltf = [];
// Un modèle de référence par genre porte les animations ; les autres les réutilisent (même squelette)
const MODELES_PERSONNAGES = {
  h: { reference: "homme-costume", costume: ["homme-costume", "homme-costume", "homme-costume", "homme-chemise"], ville: ["homme-chemise"] },
  f: { reference: "femme-veste", costume: ["femme-veste", "femme-veste", "femme-robe"], ville: ["femme-decontractee", "femme-robe"] }
};
const HAUTEUR_GLTF = { h: 1.76, f: 1.66 };
const DISTANCE_ANIMATION = 30;
let materiauGltf = null;

function base64VersTampon(texte) {
  const brut = atob(texte), octets = new Uint8Array(brut.length);
  for (let i = 0; i < brut.length; i++) octets[i] = brut.charCodeAt(i);
  return octets.buffer;
}
// Décode un modèle embarqué ; en cas d'absence ou d'erreur, le jeu garde les personnages d'origine
function chargerModele(nom) {
  const donnees = window.MODELES_FUNNELIA && window.MODELES_FUNNELIA[nom];
  if (!donnees || !THREE.GLTFLoader || !THREE.SkeletonUtils) return Promise.resolve(null);
  return new Promise(resolve => {
    try {
      new THREE.GLTFLoader().parse(base64VersTampon(donnees), "", gltf => {
        modelesGltf[nom] = preparerModele(gltf);
        resolve(modelesGltf[nom]);
      }, erreur => { console.warn("Modèle " + nom + " illisible", erreur); resolve(null); });
    } catch (erreur) { console.warn("Modèle " + nom + " illisible", erreur); resolve(null); }
  });
}
async function chargerPersonnagesGltf() {
  for (const genre of ["h", "f"]) {
    const m = MODELES_PERSONNAGES[genre];
    const noms = [...new Set([m.reference, ...m.costume, ...m.ville])];
    for (const nom of noms) await chargerModele(nom);
    const ref = modelesGltf[m.reference];
    noms.forEach(nom => { if (modelesGltf[nom] && ref && !modelesGltf[nom].animations.length) modelesGltf[nom].animations = ref.animations; });
  }
}
const personnagesGltfDisponibles = () => ["h", "f"].every(g => { const r = modelesGltf[MODELES_PERSONNAGES[g].reference]; return r && r.animations.length; });

// Fusionne les primitives (une par matériau) en un seul maillage à couleurs par sommet
function preparerModele(gltf) {
  const morceaux = [];
  gltf.scene.traverse(o => { if (o.isSkinnedMesh) morceaux.push(o); });
  const attributs = ["position", "normal", "skinIndex", "skinWeight"];
  const tableaux = { position: [], normal: [], skinIndex: [], skinWeight: [], color: [] }, index = [], zones = [];
  let decalage = 0;
  morceaux.forEach(m => {
    const g = m.geometry, n = g.attributes.position.count;
    attributs.forEach(a => { for (let i = 0; i < n * g.attributes[a].itemSize; i++) tableaux[a].push(g.attributes[a].array[i]); });
    // glTF stocke des couleurs linéaires ; le jeu travaille en sRGB
    const c = m.material.color.clone().convertLinearToSRGB();
    zones.push({ nom: m.material.name, debut: decalage, nombre: n });
    for (let i = 0; i < n; i++) tableaux.color.push(c.r, c.g, c.b);
    const idx = g.index ? g.index.array : [...Array(n).keys()];
    for (let i = 0; i < idx.length; i++) index.push(idx[i] + decalage);
    decalage += n;
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(tableaux.position, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(tableaux.normal, 3));
  geo.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(tableaux.skinIndex, 4));
  geo.setAttribute("skinWeight", new THREE.Float32BufferAttribute(tableaux.skinWeight, 4));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(tableaux.color, 3));
  geo.setIndex(index);
  // Sphère englobante élargie : le personnage reste visible quand l'animation le déforme (assis, bras levés)
  geo.computeBoundingSphere();
  geo.boundingSphere.radius *= 1.4;
  if (!materiauGltf) materiauGltf = new THREE.MeshStandardMaterial({ vertexColors: true, skinning: true, roughness: 0.72, metalness: 0.03 });
  // Le premier morceau garde le squelette et reçoit tout ; les autres disparaissent
  const principal = morceaux[0];
  principal.geometry = geo;
  principal.material = materiauGltf;
  morceaux.slice(1).forEach(m => m.parent.remove(m));
  gltf.scene.updateMatrixWorld(true);
  const boite = new THREE.Box3().setFromObject(gltf.scene);
  return { scene: gltf.scene, animations: gltf.animations, geometrie: geo, zones, hauteur: boite.max.y - boite.min.y, variantes: {} };
}
// Géométrie recolorée, partagée entre personnages de même tenue : { Shirt: 0x1f2937, Skin: ... }
function geometrieTenue(modele, couleurs) {
  const cle = JSON.stringify(couleurs);
  if (modele.variantes[cle]) return modele.variantes[cle];
  const geo = modele.geometrie.clone(), tab = geo.attributes.color.array;
  geo.boundingSphere = modele.geometrie.boundingSphere;
  modele.zones.forEach(z => {
    if (couleurs[z.nom] === undefined) return;
    const c = new THREE.Color(couleurs[z.nom]);
    for (let i = z.debut; i < z.debut + z.nombre; i++) { tab[i * 3] = c.r; tab[i * 3 + 1] = c.g; tab[i * 3 + 2] = c.b; }
  });
  modele.variantes[cle] = geo;
  return geo;
}
// Traduit l'apparence d'un personnage du jeu (peau, cheveux, tenue) en modèle + couleurs de zones
function tenueGltf(o, femme, variante) {
  const genre = femme ? "f" : "h";
  const tenue = o.tenue === "ville" ? "ville" : "costume";
  const liste = MODELES_PERSONNAGES[genre][tenue];
  const nom = liste[variante % liste.length];
  const age = (variante * 13) % 10;
  const cheveux = new THREE.Color(o.cheveux ?? 0x3b2a1f).offsetHSL(0, 0, (((variante * 7) % 5) - 2) * 0.018);
  if (age >= 7) cheveux.lerp(new THREE.Color(0xb9b5ae), age >= 9 ? 0.75 : 0.4);
  const costume = o.costume ?? 0x1e293b, haut = o.haut ?? 0x64748b, bas = o.bas ?? 0x334155;
  const chemise = femme ? 0xf1ede6 : [0xf8fafc, 0xdbeafe, 0xf8fafc, 0xe2e8f0][variante % 4];
  const c = { Skin: o.peau ?? 0xd8a47f, Hair: cheveux.getHex(), HairBase: cheveux.clone().multiplyScalar(0.8).getHex(), Eyebrows: cheveux.clone().multiplyScalar(0.7).getHex(), Eyes: 0x1f1a17 };
  if (nom === "homme-costume") Object.assign(c, { Shirt: costume, Pants: costume, TieTexture: chemise });
  else if (nom === "femme-veste") Object.assign(c, { Jacket: costume, LightJacket: costume, Shirt: chemise, Pants: costume });
  else if (nom === "femme-robe") Object.assign(c, { Dress: tenue === "costume" ? costume : haut });
  else Object.assign(c, { Shirt: tenue === "costume" ? chemise : haut, Pants: tenue === "costume" ? costume : bas });
  return { nom, couleurs: c };
}
// Personnage glTF avec la même interface que creerPersonnage : un groupe dont userData sert à l'animation
function creerPersonnageGltf(o, femme, variante) {
  const { nom, couleurs } = tenueGltf(o, femme, variante);
  const modele = modelesGltf[nom];
  if (!modele) return null;
  const racine = THREE.SkeletonUtils.clone(modele.scene);
  const taille = HAUTEUR_GLTF[femme ? "f" : "h"] * (0.97 + (variante % 7) * 0.012);
  racine.scale.multiplyScalar(taille / modele.hauteur);
  let tete = null, main = null;
  racine.traverse(n => {
    if (n.isSkinnedMesh) { n.geometry = geometrieTenue(modele, couleurs); n.castShadow = false; n.receiveShadow = true; }
    if (n.isBone && n.name === "Head") tete = n;
    if (n.isBone && n.name === "MiddleHandR") main = n; // GLTFLoader retire les points des noms
  });
  const g = new THREE.Group();
  g.add(racine);
  const mixer = new THREE.AnimationMixer(racine);
  const actions = {};
  modele.animations.forEach(clip => { actions[clip.name] = mixer.clipAction(clip); });
  // Position de repos de la tête : certains clips ne l'animent pas, le regard doit repartir de là à chaque image
  const perso = { groupe: g, mixer, actions, courante: null, tete, teteRepos: tete ? tete.quaternion.clone() : null, main, attente: 0 };
  g.userData = { gltf: perso, femme, expression: "neutre", respiration: Math.random() * 6, attitude: "ballants", attitudeFin: 3 + Math.random() * 10,
    regardBas: 0, demarche: 0.9 + Math.random() * 0.2, teteLacet: 0, teteTangage: 0 };
  jouerAnimation(perso, "Idle", 0);
  // Départ décalé : deux personnages voisins ne bougent pas en même temps
  mixer.update(Math.random() * 3);
  personnagesGltf.push(perso);
  return g;
}
function jouerAnimation(perso, nom, fondu = 0.3) {
  const suivante = perso.actions[nom];
  if (!suivante || perso.courante === suivante) return;
  suivante.reset().play();
  if (perso.courante && fondu > 0) perso.courante.crossFadeTo(suivante, fondu, false);
  else if (perso.courante) perso.courante.stop();
  perso.courante = suivante;
}
// Équivalents glTF de poser / animerMarche / animerVivant
function poserGltf(mesh, pose) {
  const u = mesh.userData;
  if (pose === "ecran") u.expression = "concentre";
  else if (pose === "parle") u.expression = u.expression === "concentre" ? "neutre" : u.expression;
  u.regardBas = pose === "ecran" ? 0.13 : pose === "tel" ? 0.4 : 0;
  const p = u.gltf;
  jouerAnimation(p, pose === "assis" || pose === "ecran" ? "Sitting" : "Idle", 0.35);
  if (p.courante) p.courante.timeScale = 1;
}
function marcherGltf(mesh, bouge) {
  const u = mesh.userData;
  if (!bouge) { poserGltf(mesh, "debout"); return; }
  u.regardBas = 0;
  jouerAnimation(u.gltf, "Walk", 0.25);
  u.gltf.courante.timeScale = u.demarche;
}
function animerVivantGltf(perso, dt, parle, regarder) {
  const u = perso.userData;
  u.respiration += dt;
  u.parleActif = parle;
  const [lacet, tangage] = regardPersonnage(perso, u, parle, regarder);
  u.teteLacet += (lacet - u.teteLacet) * Math.min(1, dt * 4);
  u.teteTangage += (tangage - u.teteTangage) * Math.min(1, dt * 4);
  animerYeuxEtAttitude(u, dt, lacet);
}
// Visible si tous ses parents le sont (étage affiché)
function estAffiche(o) {
  for (; o; o = o.parent) if (!o.visible) return false;
  return true;
}
const quaternionTemp = new THREE.Quaternion(), quaternionParent = new THREE.Quaternion(), axeTemp = new THREE.Vector3();
// Tourne la tête autour d'un axe exprimé dans le repère du monde
function tournerTete(tete, axeMonde, angle) {
  if (Math.abs(angle) < 0.001) return;
  tete.parent.getWorldQuaternion(quaternionParent).invert();
  axeTemp.copy(axeMonde).applyQuaternion(quaternionParent).normalize();
  tete.quaternion.premultiply(quaternionTemp.setFromAxisAngle(axeTemp, angle));
}
const AXE_Y = new THREE.Vector3(0, 1, 0), axeDroite = new THREE.Vector3();
// Animations : seulement pour les personnages affichés, proches et dans le champ ; les lointains à 20 images/s
function majPersonnagesGltf(dt) {
  personnagesGltf.forEach(p => {
    const g = p.groupe;
    if (!estAffiche(g)) return;
    g.getWorldPosition(vecteurTemp);
    const d2 = camera.position.distanceToSquared(vecteurTemp);
    if (d2 > DISTANCE_ANIMATION * DISTANCE_ANIMATION || !frustumCamera.intersectsSphere(sphereTemp.set(vecteurTemp.setY(vecteurTemp.y + 0.9), 1.2))) { p.attente += dt; return; }
    p.attente += dt;
    if (d2 > 144 && p.attente < 0.05) return;
    if (p.tete) p.tete.quaternion.copy(p.teteRepos);
    p.mixer.update(p.attente);
    p.attente = 0;
    const u = g.userData;
    if (p.tete && (u.teteLacet || u.teteTangage)) {
      const angle = g.rotation.y + (g.parent ? g.parent.rotation.y : 0);
      tournerTete(p.tete, AXE_Y, u.teteLacet);
      tournerTete(p.tete, axeDroite.set(Math.cos(angle), 0, -Math.sin(angle)), u.teteTangage);
    }
  });
}
// Objets en main : accrochés à l'os de la main droite, en compensant l'échelle du squelette
function attacherMain(mesh, objet) {
  const main = mesh.userData.gltf.main;
  mesh.updateMatrixWorld(true);
  const echelle = main.getWorldScale(new THREE.Vector3()).x / (mesh.getWorldScale(new THREE.Vector3()).x || 1);
  objet.scale.multiplyScalar(1 / echelle);
  objet.position.multiplyScalar(1 / echelle);
  main.add(objet);
}

/* =====================================================================
   INITIALISATION
   ===================================================================== */
// Les enseignes et écrans 3D sont dessinés avec la police Inter : on attend qu'elle soit prête (2 s maximum)
function policePrete() {
  if (!document.fonts || !document.fonts.load) return Promise.resolve();
  return Promise.race([Promise.all([document.fonts.load("400 16px Inter"), document.fonts.load("800 16px Inter")]), new Promise(r => setTimeout(r, 2000))]).catch(() => {});
}
async function initialiser() {
  await policePrete();
  await etapeChargement(T("Préparation des matériaux…", "Preparing materials…"), 0.08, preparerTextures);
  await etapeChargement(T("Construction de l'immeuble…", "Building the offices…"), 0.25, construireDecor);
  await etapeChargement(T("Calcul des déplacements…", "Computing walking paths…"), 0.5, construireNavigations);
  await etapeChargement(T("Arrivée des collaborateurs…", "Colleagues arriving…"), 0.56, chargerPersonnagesGltf);
  await etapeChargement(T("Arrivée des collaborateurs…", "Colleagues arriving…"), 0.62, () => { creerCollaborateurs(); creerFigurants(); construirePassants(); ajouterObjetsImmeuble(); installerEntreprise(); majEcransDynamiques(); changerEtage(1); });
  await etapeChargement(T("Réglage des matières…", "Tuning materials…"), 0.72, appliquerMatieres);
  await etapeChargement(T("Calcul des reflets…", "Computing reflections…"), 0.84, genererReflets);
  await etapeChargement(T("Réglage de l'image…", "Tuning the picture…"), 0.95, configurerRendu);
  appliquerReglages();
  verifierBadges();
  preparerBoussole();
  // Après un changement de langue, on revient directement à l'accueil
  let direct = false;
  try { direct = sessionStorage.getItem(CLES_STOCKAGE.demarre) === "1"; sessionStorage.removeItem(CLES_STOCKAGE.demarre); } catch (e) { /* ignoré */ }
  if (direct) afficherAccueil(); else afficherDemarrage();
  boucle();
  $("chargement-barre").style.width = "100%";
  const ecran = $("ecran-chargement");
  ecran.classList.add("termine");
  setTimeout(() => ecran.classList.add("cache"), 600);
}
window.jeuPret = initialiser();
