/* Funnelia – textes du mode démo (5 minutes, pour une présentation).
   Contenu sous licence CC BY-SA 4.0 (voir LICENSE-CONTENUS).

   Chaque chapitre a une durée (en secondes) et des légendes qui apparaissent
   à un instant donné du chapitre (« a », en secondes). Les actions jouées par
   la démo sont dans script.js (section G9), sous le même identifiant. */
window.FUNNELIA_TEXTES = window.FUNNELIA_TEXTES || {};
window.FUNNELIA_TEXTES.demo = {
  bouton: { fr: "Démo (5 min)", en: "Demo (5 min)" },
  etiquette: { fr: "Démo", en: "Demo" },
  aide: { fr: "→ suivant · ← reprendre · Espace pause · Échap quitter", en: "→ next · ← replay · Space pause · Esc quit" },
  pause: { fr: "Pause", en: "Pause" },
  reprendre: { fr: "Reprendre", en: "Resume" },
  precedent: { fr: "Chapitre précédent", en: "Previous chapter" },
  suivant: { fr: "Chapitre suivant", en: "Next chapter" },
  quitter: { fr: "Quitter la démo", en: "Quit the demo" },
  rejouer: { fr: "Revoir la démo", en: "Watch again" },
  jouer: { fr: "Jouer", en: "Play" },
  // Réponses choisies dans les dialogues du salon (recherchées dans le texte des boutons)
  reponses: {
    accroche: { fr: "Qu'est-ce qui vous amène", en: "What brings you" },
    conclusion: { fr: "Scanner son badge", en: "Scan their badge" }
  },
  chapitres: [
    {
      id: "accueil", duree: 35,
      titre: { fr: "Le défi", en: "The challenge" },
      legendes: [
        { a: 0, texte: { fr: "Funnelia est un simulateur 3D de conversion commerciale B2B. Le joueur est commercial chez Veltis, un éditeur de logiciel fictif.", en: "Funnelia is a 3D B2B sales conversion simulator. The player is a sales rep at Veltis, a fictional software company." } },
        { a: 9, texte: { fr: "Quatre étapes du tunnel, de l'inconnu au client, puis une mission bonus de fidélisation.", en: "Four funnel stages, from stranger to customer, then a retention bonus mission." } },
        { a: 27, texte: { fr: "Un seul bouton pour commencer : la mission recommandée.", en: "A single button to start: the recommended mission." } }
      ]
    },
    {
      id: "briefing", duree: 25,
      titre: { fr: "Le briefing", en: "The briefing" },
      legendes: [
        { a: 0, texte: { fr: "Chaque mission commence par un briefing court : la situation et un objectif chiffré.", en: "Each mission starts with a short briefing: the situation and a measurable goal." } },
        { a: 10, texte: { fr: "Les détails restent à portée de main : critères de réussite et d'excellence, et le frein à la conversion à éviter.", en: "Details stay within reach: success and excellence criteria, and the conversion blocker to avoid." } }
      ]
    },
    {
      id: "prospection", duree: 80,
      titre: { fr: "Prospection", en: "Prospecting" },
      legendes: [
        { a: 0, texte: { fr: "Mission 1 : faire passer des inconnus au stade de prospect.", en: "Mission 1: turn strangers into prospects." } },
        { a: 5, texte: { fr: "D'abord, un plan de visibilité : les canaux où se trouve la cible, dans le budget.", en: "First, a visibility plan: the channels where the target is, within budget." } },
        { a: 14, texte: { fr: "Un message centré sur le bénéfice client, puis on ouvre le salon.", en: "A message focused on customer benefit, then the trade show opens." } },
        { a: 20, texte: { fr: "Au salon, on lit le badge avant d'aborder : ce contact est dans la cible.", en: "At the show, read the badge before approaching: this contact is on target." } },
        { a: 27, texte: { fr: "Une question ouverte plutôt qu'un discours : le contact parle de son besoin.", en: "An open question rather than a pitch: the contact talks about their need." } },
        { a: 35, texte: { fr: "L'argument s'adapte à sa fonction : la confiance monte.", en: "The argument fits their role: trust goes up." } },
        { a: 44, texte: { fr: "On conclut par une prochaine étape datée : le contact devient un prospect qualifié.", en: "Close with a dated next step: the contact becomes a qualified prospect." } },
        { a: 63, texte: { fr: "En haut, l'objectif de la mission ; à droite, le CRM garde la trace de chaque échange.", en: "At the top, the mission goal; on the right, the CRM keeps track of every conversation." } }
      ]
    },
    {
      id: "closing", duree: 55,
      titre: { fr: "Closing", en: "Closing" },
      legendes: [
        { a: 0, texte: { fr: "Mission 4 : convertir des opportunités en clients qui restent.", en: "Mission 4: convert opportunities into customers who stay." } },
        { a: 8, texte: { fr: "Le CRM présente chaque opportunité : besoin, budget, concurrent, motivation d'achat.", en: "The CRM shows each opportunity: need, budget, competitor, buying motive." } },
        { a: 16, texte: { fr: "On dimensionne l'offre au juste besoin du client…", en: "The offer is sized to the customer's actual need…" } },
        { a: 25, texte: { fr: "… et la remise reste dans la délégation : on ne concède que contre une contrepartie.", en: "… and the discount stays within authority: concede only in exchange for something." } },
        { a: 37, texte: { fr: "Proposition envoyée : le mini-tunnel de la mission avance d'une marche.", en: "Proposal sent: the mission's mini-funnel moves up one step." } }
      ]
    },
    {
      id: "pilotage", duree: 45,
      titre: { fr: "Mesurer", en: "Measure" },
      legendes: [
        { a: 0, texte: { fr: "Le tableau de bord compare le joueur à l'équipe commerciale : chiffre d'affaires, prévisionnel, marge, rentabilité.", en: "The dashboard compares the player with the sales team: revenue, forecast, margin, profitability." } },
        { a: 16, texte: { fr: "Chaque geste commercial se relie à un indicateur que l'entreprise suit vraiment.", en: "Every sales action links to an indicator the company really tracks." } },
        { a: 31, texte: { fr: "Le tunnel de conversion montre à quelle étape l'équipe perd ses contacts.", en: "The conversion funnel shows at which stage the team loses its contacts." } }
      ]
    },
    {
      id: "bilan", duree: 45,
      titre: { fr: "Le bilan", en: "The debrief" },
      legendes: [
        { a: 0, texte: { fr: "En fin de mission, le bilan donne le score, les indicateurs et les compétences travaillées.", en: "At the end of a mission, the debrief gives the score, the indicators and the skills practised." } },
        { a: 16, texte: { fr: "Chaque erreur est expliquée, avec ce qu'il faut retenir.", en: "Every mistake is explained, with the key takeaway." } },
        { a: 31, texte: { fr: "Les résultats s'exportent en CSV pour le formateur.", en: "Results can be exported as CSV for the trainer." } }
      ]
    },
    {
      id: "fin", duree: 15,
      titre: { fr: "Fin", en: "End" },
      legendes: [
        { a: 0, texte: { fr: "Funnelia se joue dans le navigateur, sans installation, en français et en anglais. Code ouvert (MIT), contenus partagés (CC BY-SA).", en: "Funnelia runs in the browser, with no installation, in French and English. Open code (MIT), shared content (CC BY-SA)." } }
      ]
    }
  ]
};
