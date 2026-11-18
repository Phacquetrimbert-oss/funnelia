/* Funnelia – textes du catalogue commercial (offre, modules, motivations SONCAS,
   concurrence, comptes du territoire, cible idéale).
   Contenu sous licence CC BY-SA 4.0 (voir LICENSE-CONTENUS).

   Chaque texte affiché s'écrit { fr: "…", en: "…" } : les deux langues restent
   côte à côte, une traduction ne peut pas être oubliée sans que
   outils/verifier-textes.py le signale. Les autres valeurs (prix, identifiants,
   effectifs) ne dépendent pas de la langue.
   Fichier chargé par une simple balise <script> avant script.js : il fonctionne
   en ouvrant index.html directement (file://), sans serveur. */
window.FUNNELIA_TEXTES = window.FUNNELIA_TEXTES || {};
window.FUNNELIA_TEXTES.catalogue = {
  offres: {
    essentiel: {
      id: "essentiel", nom: { fr: "Essentiel", en: "Essential" }, prix: 29, miseEnService: 990, max: 10,
      fonctions: [{ fr: "CRM et pipeline", en: "CRM and pipeline" }, { fr: "Devis et relances automatiques", en: "Quotes and automatic follow-ups" }, { fr: "Application mobile", en: "Mobile app" }],
      cible: { fr: "Petites équipes commerciales (jusqu'à 10 utilisateurs)", en: "Small sales teams (up to 10 users)" }
    },
    business: {
      id: "business", nom: "Business", prix: 59, miseEnService: 2900, max: 150,
      fonctions: [{ fr: "Tout Essentiel", en: "Everything in Essential" }, { fr: "Facturation et suivi des paiements", en: "Invoicing and payment tracking" }, { fr: "Reporting avancé", en: "Advanced reporting" }, { fr: "Intégrations comptabilité et messagerie", en: "Accounting and email integrations" }, { fr: "Support prioritaire", en: "Priority support" }],
      cible: { fr: "PME qui relient vente, facturation et comptabilité", en: "SMEs connecting sales, invoicing and accounting" }
    },
    enterprise: {
      id: "enterprise", nom: "Enterprise", prix: 89, miseEnService: 7900, max: 9999,
      fonctions: [{ fr: "Tout Business", en: "Everything in Business" }, { fr: "Multisite et multi-entités", en: "Multi-site and multi-entity" }, { fr: "SSO et droits avancés", en: "SSO and advanced permissions" }, { fr: "API ouverte", en: "Open API" }, { fr: "CSM dédié, SLA 99,9 %", en: "Dedicated CSM, 99.9% SLA" }],
      cible: { fr: "ETI et groupes multisites", en: "Mid-sized companies and multi-site groups" }
    }
  },

  engagements: {
    mensuel: { nom: { fr: "Mensuel", en: "Monthly" }, detail: { fr: "sans engagement, +20 %", en: "no commitment, +20%" }, coef: 1.2 },
    annuel: { nom: { fr: "Annuel", en: "Annual" }, detail: { fr: "prix catalogue", en: "list price" }, coef: 1 },
    triennal: { nom: { fr: "3 ans", en: "3 years" }, detail: { fr: "contrepartie possible à une remise", en: "possible trade-off for a discount" }, coef: 1 }
  },

  options: {
    migration: { nom: { fr: "Reprise des données historiques", en: "Historical data migration" }, prix: 1800, detail: { fr: "Import des contacts, affaires et historiques depuis l'outil actuel.", en: "Import of contacts, deals and history from the current tool." } },
    formation: { nom: { fr: "Formation complémentaire sur site", en: "Additional on-site training" }, prix: 1200, detail: { fr: "Une journée de formation des équipes dans vos locaux.", en: "A day of team training at your premises." } },
    premium: { nom: { fr: "Support premium 7j/7", en: "24/7 premium support" }, taux: 0.15, detail: { fr: "+15 % de l'abonnement annuel.", en: "+15% of the annual subscription." } }
  },

  modules: {
    pipeline: { nom: { fr: "Pipeline et prévisions", en: "Pipeline and forecasting" }, detail: { fr: "Suivi des affaires par étape, prévisions de chiffre d'affaires.", en: "Deal tracking by stage, revenue forecasts." } },
    devis: { nom: { fr: "Devis et relances automatiques", en: "Quotes and automatic follow-ups" }, detail: { fr: "Modèles de devis, signature électronique, relances programmées.", en: "Quote templates, e-signature, scheduled follow-ups." } },
    facturation: { nom: { fr: "Facturation et paiements", en: "Invoicing and payments" }, detail: { fr: "Transformation du devis en facture, suivi des encaissements.", en: "Turn quotes into invoices, track collections." } },
    reporting: { nom: { fr: "Tableaux de bord", en: "Dashboards" }, detail: { fr: "Indicateurs en temps réel pour la direction.", en: "Real-time indicators for management." } },
    integrations: { nom: { fr: "Intégrations et API", en: "Integrations and API" }, detail: { fr: "Connexion comptabilité, messagerie, SSO, API ouverte.", en: "Accounting, email and SSO connections, open API." } },
    mobile: { nom: { fr: "Application mobile", en: "Mobile app" }, detail: { fr: "Fiches clients, devis et comptes rendus en rendez-vous.", en: "Customer records, quotes and meeting reports on the go." } },
    multisite: { nom: { fr: "Multisite et droits", en: "Multi-site and permissions" }, detail: { fr: "Consolidation de plusieurs sites, droits par entité.", en: "Consolidation of several sites, permissions by entity." } }
  },

  pains: {
    relances: { module: "devis", court: { fr: "Devis non relancés", en: "Quotes not followed up" }, texte: { fr: "Nos devis partent par e-mail et personne ne les relance de façon systématique. On perd des affaires sans même le savoir.", en: "Our quotes go out by email and nobody follows them up systematically. We lose deals without even knowing it." } },
    visibilite: { module: "pipeline", court: { fr: "Aucune visibilité sur le pipeline", en: "No pipeline visibility" }, texte: { fr: "Chaque commercial a son propre fichier : je n'ai aucune vision consolidée du pipeline ni des prévisions.", en: "Each sales rep has their own file: I have no consolidated view of the pipeline or the forecasts." } },
    facturation: { module: "facturation", court: { fr: "Facturation manuelle", en: "Manual invoicing" }, texte: { fr: "La facturation est refaite à la main à partir des devis : erreurs, retards, impayés relancés au cas par cas.", en: "Invoices are re-typed by hand from the quotes: errors, delays, unpaid invoices chased case by case." } },
    reporting: { module: "reporting", court: { fr: "Reporting chronophage", en: "Time-consuming reporting" }, texte: { fr: "On passe deux jours par mois à compiler des tableaux pour le comité de direction.", en: "We spend two days a month compiling tables for the management committee." } },
    ressaisies: { module: "integrations", court: { fr: "Ressaisies en comptabilité", en: "Double entry in accounting" }, texte: { fr: "Rien n'est connecté : tout est ressaisi dans le logiciel comptable, avec les erreurs qui vont avec.", en: "Nothing is connected: everything is re-keyed into the accounting software, with all the errors that come with it." } },
    terrain: { module: "mobile", court: { fr: "Équipes terrain sans données", en: "Field teams without data" }, texte: { fr: "Nos équipes sur le terrain n'ont pas accès aux informations clients pendant leurs rendez-vous.", en: "Our field teams have no access to customer information during their meetings." } },
    multisite: { module: "multisite", court: { fr: "Sites impossibles à consolider", en: "Sites impossible to consolidate" }, texte: { fr: "Avec nos six sites et trois outils différents, impossible de consolider l'activité commerciale en temps réel.", en: "With our six sites and three different tools, it's impossible to consolidate sales activity in real time." } }
  },

  soncas: {
    securite: {
      nom: { fr: "Sécurité", en: "Security" },
      presentiel: { fr: "{Il} prend des notes, demande des garanties et fronce les sourcils dès qu'on évoque un changement.", en: "{Il} takes notes, asks for guarantees and frowns whenever change is mentioned." },
      distance: { fr: "{Il} revient plusieurs fois sur les risques et demande des garanties écrites.", en: "{Il} keeps coming back to the risks and asks for written guarantees." },
      note: { fr: "Très attentif aux garanties, aux références et à la continuité de service.", en: "Very focused on guarantees, references and service continuity." },
      argument: { fr: "Hébergement en France, sauvegardes quotidiennes, SLA contractuel et plus de 1 200 PME clientes : le risque est maîtrisé.", en: "Hosted in France, daily backups, contractual SLA and more than 1,200 SME customers: the risk is under control." }
    },
    orgueil: {
      nom: { fr: "Orgueil", en: "Pride" },
      presentiel: { fr: "{Il} évoque volontiers la réussite de son entreprise et sa position face aux concurrents.", en: "{Il} readily talks about the company's success and its position against competitors." },
      distance: { fr: "{Il} parle beaucoup de l'image de son entreprise et de ses concurrents directs.", en: "{Il} talks a lot about the company's image and its direct competitors." },
      note: { fr: "Fier de la croissance de l'entreprise, sensible à l'image et au positionnement.", en: "Proud of the company's growth, sensitive to image and positioning." },
      argument: { fr: "Les entreprises les plus performantes de votre secteur pilotent déjà leur croissance avec Veltis One : vous gardez une longueur d'avance.", en: "The best-performing companies in your sector already run their growth with Veltis One: you stay one step ahead." }
    },
    nouveaute: {
      nom: { fr: "Nouveauté", en: "Novelty" },
      presentiel: { fr: "{Il} s'anime dès qu'on parle des dernières fonctionnalités et demande la feuille de route.", en: "{Il} lights up when the latest features come up and asks for the roadmap." },
      distance: { fr: "{Il} pose beaucoup de questions sur les nouveautés et la feuille de route produit.", en: "{Il} asks lots of questions about new features and the product roadmap." },
      note: { fr: "Curieux, attiré par l'innovation et les outils modernes.", en: "Curious, drawn to innovation and modern tools." },
      argument: { fr: "Prévisions assistées par l'analyse prédictive, nouvelles fonctionnalités chaque mois : vos équipes travaillent avec les outils les plus récents.", en: "Forecasts powered by predictive analytics, new features every month: your teams work with the latest tools." }
    },
    confort: {
      nom: { fr: "Confort", en: "Comfort" },
      presentiel: { fr: "{Il} insiste sur la simplicité d'utilisation et redoute une charge de travail supplémentaire.", en: "{Il} stresses ease of use and fears extra workload." },
      distance: { fr: "{Il} demande à plusieurs reprises combien de temps prendra la mise en place.", en: "{Il} asks several times how long the set-up will take." },
      note: { fr: "Veut une solution simple, sans surcharge pour l'équipe pendant le déploiement.", en: "Wants a simple solution, with no extra burden on the team during roll-out." },
      argument: { fr: "Mise en service clé en main en trois semaines, formation incluse : vos équipes sont autonomes dès le premier mois, sans charge supplémentaire.", en: "Turnkey set-up in three weeks, training included: your teams are autonomous from the first month, with no extra workload." }
    },
    argent: {
      nom: { fr: "Argent", en: "Money" },
      presentiel: { fr: "{Il} ramène chaque sujet aux coûts et calcule pendant que vous parlez.", en: "{Il} brings every topic back to cost and calculates while you speak." },
      distance: { fr: "{Il} demande rapidement le coût total et le délai de retour sur investissement.", en: "{Il} quickly asks for the total cost and the payback period." },
      note: { fr: "Raisonne en coût total et en retour sur investissement.", en: "Thinks in terms of total cost and return on investment." },
      argument: { fr: "Sur la base de vos chiffres, la baisse des devis perdus et des ressaisies rembourse l'abonnement en moins de huit mois.", en: "Based on your figures, fewer lost quotes and less double entry pay back the subscription in under eight months." }
    },
    sympathie: {
      nom: { fr: "Sympathie", en: "Sympathy" },
      presentiel: { fr: "{Il} est chaleureux, pose des questions personnelles et accorde beaucoup d'importance à la relation.", en: "{Il} is warm, asks personal questions and places great importance on the relationship." },
      distance: { fr: "{Il} prend le temps d'échanger et insiste sur la qualité de la relation.", en: "{Il} takes time to chat and stresses the quality of the relationship." },
      note: { fr: "Accorde une grande importance à la relation et à la proximité.", en: "Places great importance on the relationship and on closeness." },
      argument: { fr: "Vous aurez un interlocuteur dédié du démarrage au suivi quotidien : nous construisons une relation dans la durée.", en: "You'll have a dedicated contact from start-up to day-to-day follow-up: we build a long-term relationship." }
    }
  },

  concurrents: {
    kordis: { nom: "Kordis CRM", prix: { fr: "19 € par utilisateur et par mois", en: "€19 per user per month" }, forces: { fr: "Prix d'appel bas, prise en main rapide.", en: "Low entry price, quick to get started." }, faiblesses: { fr: "Pas de facturation ni d'intégration comptable native, support uniquement par e-mail, reporting limité.", en: "No native invoicing or accounting integration, email-only support, limited reporting." } },
    salesbase: { nom: "Salesbase", prix: { fr: "environ 120 € par utilisateur et par mois", en: "about €120 per user per month" }, forces: { fr: "Très complet, image de grand éditeur international.", en: "Very comprehensive, big international vendor image." }, faiblesses: { fr: "Déploiement de 4 à 6 mois, paramétrage complexe, support en anglais, coût total élevé.", en: "4 to 6 months to deploy, complex configuration, English-only support, high total cost." } },
    tableur: { nom: { fr: "Tableurs et e-mails", en: "Spreadsheets and emails" }, prix: { fr: "gratuit en apparence", en: "free on the face of it" }, forces: { fr: "Connu de tous, aucune dépense visible.", en: "Familiar to everyone, no visible cost." }, faiblesses: { fr: "Ressaisies, erreurs, aucune visibilité en temps réel, dépendance aux personnes.", en: "Double entry, errors, no real-time visibility, dependence on individuals." } }
  },

  comptes: {
    batinord: { id: "batinord", entreprise: "Batinord", secteur: "BTP", effectif: 140, contact: "Marc Delaunay", genre: "m", fonction: { fr: "Directeur général", en: "Managing Director" }, role: "dg", soncas: "orgueil", utilisateurs: 18, pains: ["relances", "terrain"], budget: 14000, concurrent: "kordis", existant: { fr: "Kordis CRM en période d'essai", en: "Kordis CRM on trial" }, migration: false, apparence: 0 },
    medilys: { id: "medilys", entreprise: "Médilys", secteur: { fr: "Laboratoires d'analyses", en: "Medical laboratories" }, effectif: 60, contact: "Isabelle Roche", genre: "f", fonction: { fr: "Directrice administrative et financière", en: "Chief Financial and Administrative Officer" }, role: "daf", soncas: "argent", utilisateurs: 8, pains: ["facturation", "ressaisies"], budget: 6800, concurrent: "tableur", existant: { fr: "Tableurs et logiciel comptable", en: "Spreadsheets and accounting software" }, migration: false, apparence: 3 },
    fidelio: { id: "fidelio", entreprise: "Fidelio", secteur: { fr: "Expertise comptable", en: "Accounting firm" }, effectif: 35, contact: "Hélène Vasseur", genre: "f", fonction: { fr: "Associée", en: "Partner" }, role: "dg", soncas: "sympathie", utilisateurs: 5, pains: ["relances", "visibilite"], budget: 2400, concurrent: "kordis", existant: { fr: "Tableurs partagés", en: "Shared spreadsheets" }, migration: false, apparence: 1 },
    transalp: { id: "transalp", entreprise: "Transalp", secteur: { fr: "Transport et logistique", en: "Transport and logistics" }, effectif: 220, contact: "Karim Benali", genre: "m", fonction: { fr: "Directeur commercial", en: "Sales Director" }, role: "dircom", soncas: "nouveaute", utilisateurs: 25, pains: ["visibilite", "reporting"], budget: 19500, concurrent: "salesbase", existant: { fr: "Ancien CRM développé en interne", en: "Legacy in-house CRM" }, migration: true, apparence: 4 },
    optiwatt: { id: "optiwatt", entreprise: "Optiwatt", secteur: { fr: "Services énergétiques", en: "Energy services" }, effectif: 90, contact: "Julien Marchal", genre: "m", fonction: { fr: "Directeur des systèmes d'information", en: "Chief Information Officer" }, role: "dsi", soncas: "securite", utilisateurs: 12, pains: ["ressaisies", "reporting"], budget: 9500, concurrent: "salesbase", existant: { fr: "Salesbase (fin de contrat)", en: "Salesbase (contract ending)" }, migration: true, apparence: 2 },
    larcher: { id: "larcher", entreprise: "Groupe Larcher", secteur: { fr: "Négoce de matériaux", en: "Building materials trading" }, effectif: 400, contact: "Oscar Mercier", genre: "m", fonction: { fr: "Directeur des opérations", en: "Chief Operating Officer" }, role: "dg", soncas: "argent", utilisateurs: 45, pains: ["multisite", "visibilite"], budget: 52000, concurrent: "salesbase", existant: { fr: "Trois outils différents selon les sites", en: "Three different tools depending on the site" }, migration: true, apparence: 5 },
    belvue: { id: "belvue", entreprise: "Belvue", secteur: { fr: "Hôtellerie et séminaires", en: "Hotels and seminars" }, effectif: 80, contact: "Sophie Nguyen", genre: "f", fonction: { fr: "Directrice commerciale", en: "Sales Director" }, role: "dircom", soncas: "confort", utilisateurs: 6, pains: ["relances", "terrain"], budget: 2600, concurrent: "kordis", existant: { fr: "Carnet de contacts et e-mails", en: "Contact book and emails" }, migration: false, apparence: 7 }
  },

  icp: {
    effectif: { fr: "20 à 250 salariés (au-delà : offre Enterprise)", en: "20 to 250 employees (above that: Enterprise plan)" },
    secteurs: { fr: "Entreprises B2B avec une équipe commerciale : services, industrie, BTP, distribution, transport", en: "B2B companies with a sales team: services, industry, construction, distribution, transport" },
    decideurs: { fr: "Dirigeant, directeur commercial, DAF, DSI ; influenceurs : ADV, office manager", en: "Managing director, sales director, CFO, CIO; influencers: sales admin, office manager" }
  }
};
