// zoneExtract.ts
//
// Les cartes de série (une carte par série, avec ses statistiques
// Extrait / Transformé) ont été déplacées vers l'accueil, dans la
// partie TEF (voir zoneAccueilTef.ts) : chaque page CE/CO/EE/EO de la
// navigation moderne y affiche désormais directement les cartes des
// séries possédant ce type, sans passer par ce panel.
//
// Ce panel "Extraction" reste initialisé (au cas où il serait rouvert
// plus tard pour un autre usage). Chaque page de `gestionNavExtract`
// reçoit désormais une ActualisableList (voir composer/actualisable.ts) :
// même structure visuelle qu'une SelectableList, mais sans sélection ni
// export — chaque élément exécute sa propre fonction au clic, et le
// bouton de l'en-tête déclenche l'actualisation de la liste de cette
// page précise.
import { Panel } from "../composer/Panel.js";
import { NavigateurModerne } from "../composer/navigateurModerne.js";
import { ActualisableList } from "../composer/actualisable.js";
import { listeIdActu } from "../../varUni.js";
import { extractLien, extractDonnee, listerLiensExtraits, ecouteMajLiens, ecouteDonneeTraitee, ecouteEtatItemLien, LienExtrait } from "./extractionApi.js";
import { creerMessage, typeReussite, typeErreur } from "./gestionMessage.js";
import { ouvreZoneBloquant, fermerZoneBloquant } from './zoneBloquante.js';

let panConserveur: Panel;
let gestionNavExtract: NavigateurModerne;

// Une ActualisableList par page de gestionNavExtract (CE/CO/EE/EO/session),
// dans le même ordre, conservées dans un tableau global.
const listesNavExtract: ActualisableList[] = [];

// Titre de chaque page (dans le même ordre que listeIdActu), pour
// pouvoir nommer la page concernée dans le message de succès affiché
// après une actualisation.
const titresNavExtract: string[] = [];

export const initZoneExtract = () => {
  panConserveur = new Panel("Extraction", true);

  //construction du bouton d'effacement de la sesssion d'extraction
  const boutEff = document.createElement("button");
  boutEff.className = "eff_session_extract";
  boutEff.textContent = "Effacer les cokies";
  panConserveur.getContainer().appendChild(boutEff);
  boutEff.addEventListener("click", async (even) => {
    ouvreZoneBloquant("Effacement des cookie des cite d'extraction");
    const resp = await window.api.invoke("lienExtract:efface_cookie", null);
    fermerZoneBloquant();
    creerMessage(
      typeReussite,
      "Efface cookie",
      "Tous les cookies d'extractions sont supprimés"
    )
  });

  //consturction du corps
  const bodyExtrat = panConserveur.getBody();
  bodyExtrat.classList.add("body_extract");

  const souche = document.createElement("div");
  panConserveur.getBody().appendChild(souche);

  souche.className = "souche-element";

  const boutons = [
    {
      avatar: "📖",
      titre: "Lien . TCF . CE",
      donnee: "0",
    },
    {
      avatar: "🎧",
      titre: "Lien . TCF . CO",
      donnee: "0",
    },
    {
      avatar: "✍️",
      titre: "Lien . TCF . EE",
      donnee: "0",
    },
    {
      avatar: "🎙️",
      titre: "Lien . TCF . EO",
      donnee: "0",
    },
    {
      avatar: "📅",
      titre: "Lien . TEF . session",
      donnee: "0",
      classe: "nm-btn-tef",
    },
  ];

  gestionNavExtract = new NavigateurModerne(souche, boutons);

  // Remplit chaque page avec sa propre ActualisableList, initialement
  // chargée avec les liens déjà enregistrés pour cet idActu (voir
  // chargerLiensExtraits côté processus principal).
  listesNavExtract.length = 0;
  titresNavExtract.length = 0;
  boutons.forEach((info, index) => {
    titresNavExtract[index] = info.titre;
    const page = gestionNavExtract.getPageContent(index);
    if (!page) return;
    page.classList.add("extraction-page");

    const liste = new ActualisableList(page, {
      onRefresh: () => actualiserPage(index),
      emptyLabel: "aucun lien n'a été extrait",
    });
    listesNavExtract[index] = liste;

    const idActu = listeIdActu[index];
    void listerLiensExtraits(idActu).then((liens) => {
      liste.setItems(construireItems(index, liens));
      gestionNavExtract.setBoutonDonnee(index, String(liens.length));
    });
  });

  // Rafraîchit l'affichage de la page concernée dès qu'une liste de
  // liens est mise à jour (après une actualisation — voir
  // actualiserPage ci-dessous et le traitement côté outi_exract.ts),
  // et confirme le succès de l'opération par un message temporaire.
  ecouteMajLiens((idActu, liens) => {
    const index = listeIdActu.indexOf(idActu);
    if (index === -1 || !listesNavExtract[index]) return;
    listesNavExtract[index].setItems(construireItems(index, liens));
    gestionNavExtract.setBoutonDonnee(index, String(liens.length));

    creerMessage(
      typeReussite,
      titresNavExtract[index] ?? "Extraction",
      `Récupération terminée : ${liens.length} lien(s) enregistré(s).`
    );
  });

  // Message temporaire affiché après le clic sur le NOM d'un lien (voir
  // actualiseItem ci-dessous) : succès (nombre de séries créées/mises à
  // jour dans le dossier "donnee", ouvrables depuis l'accueil comme
  // n'importe quel autre élément) ou échec.
  ecouteDonneeTraitee((idActu, info) => {
    const index = listeIdActu.indexOf(idActu);
    const titre = titresNavExtract[index] ?? "Extraction";

    if (!info.success) {
      creerMessage(typeErreur, titre, info.error ?? "Échec de l'enregistrement des données.");
      return;
    }

    // Le lien qu'on vient d'extraire possède désormais un dossier : on
    // marque directement son item dans la liste (signe distinctif
    // visuel), sans attendre une actualisation ni une réouverture de
    // l'appli.
    if (info.idLien && listesNavExtract[index]) {
      listesNavExtract[index].marquerTraite(info.idLien);
    }

    const nbSeries = info.nbSeries ?? 0;
    const nbCreees = info.nbCreees ?? 0;
    const nbMaJ = nbSeries - nbCreees;
    const details: string[] = [];
    if (nbCreees > 0) details.push(`${nbCreees} créée(s)`);
    if (nbMaJ > 0) details.push(`${nbMaJ} mise(s) à jour`);

    creerMessage(
      typeReussite,
      titre,
      `Donnée enregistrée : ${nbSeries} série(s)${details.length ? ` (${details.join(", ")})` : ""}.`
    );
  });

  // Rafraîchit directement (sans réactualiser toute la liste) l'état
  // "déjà extrait" d'UN lien précis — envoyé après la suppression d'une
  // carte de série (voir 'conserveur:delete-series' dans main.ts) :
  // s'il ne reste plus aucun dossier pour ce lien, on retire la marque
  // visuelle ; sinon (cas théorique, notification positive) on la pose.
  ecouteEtatItemLien((idActu, idItem, aDossier) => {
    const index = listeIdActu.indexOf(idActu);
    if (index === -1 || !listesNavExtract[index]) return;
    if (aDossier) {
      listesNavExtract[index].marquerTraite(idItem);
    } else {
      listesNavExtract[index].demarquerTraite(idItem);
    }
  });
};

// Convertit les liens enregistrés (id/url/nom) en éléments affichables :
// le nom est affiché, et un clic envoie (idActu, id) au processus
// principal via actualiseItem.
const construireItems = (index: number, liens: LienExtrait[]) =>
  liens.map((lien) => ({
    id: lien.id,
    text: lien.nom,
    onClick: () => actualiseItem(index, lien.id),
    dejaTraite: lien.aDossier === true,
  }));

// Fonction d'actualisation appelée par le bouton de chaque page. Pas
// encore de vraie source de données branchée ici : à compléter plus
// tard pour recharger réellement les éléments de cette page.
const actualiserPage = (index: number): void => {
  const idActu = listeIdActu[index];
  extractLien(idActu);
};

const actualiseItem = (index: number, idItem: string) => {
  const idActu = listeIdActu[index];
  extractDonnee(idActu, idItem);
};

export const ouvreZoneExtract = () => {
  panConserveur.open();
};