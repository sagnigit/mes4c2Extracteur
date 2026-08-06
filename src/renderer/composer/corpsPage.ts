// corpsPage.ts
//
// Squelette générique du corps d'une page (ex: une page CE/CO/EE/EO
// ouverte par un NavigateurModerne). Deux zones :
//   - zoneAffichage (le "reste" de la page) : simple div qui prend
//     l'espace restant, où vient s'afficher le contenu de la carte
//     sélectionnée à droite. Vide au départ (avec un message).
//   - zoneCartes (à droite) : colonne de cartes. Vide au départ, avec
//     un message tant qu'aucune carte n'a été ajoutée.
// La construction et le remplissage des cartes est laissée à l'appelant
// (voir zoneAccueilTef.ts), ce fichier ne fait que poser le squelette.
import { StackContainer } from "../generale/stackContainer.js";

export interface ZonesCorpsPage {
    /** Le reste de la page : zone d'affichage du contenu sélectionné. */
    zoneAffichage: HTMLDivElement;
    /** La zone à droite, conteneur brut des cartes. */
    zoneCartes: HTMLDivElement;
    /** Liste défilante (avec message vide automatique) où ajouter les cartes. */
    listeCartes: StackContainer;
}

// Enlève les accents et met en minuscules, pour une recherche plus
// tolérante (ex: "ecoute" retrouve "Écoute").
const normaliserRecherche = (texte: string): string =>
    texte
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim();

/**
 * Vide `page` puis construit son squelette :
 *  - `.nm-page-reste`  : simple div vide (zone d'affichage).
 *  - `.nm-page-cartes` : zone à droite, avec une entête (barre de
 *    recherche + bouton de repliage) au-dessus de la liste de cartes.
 *
 * Repliage : un clic sur le bouton bascule `.nm-page-cartes--repliee`
 * sur `zoneCartes` (largeur réduite, recherche et liste masquées, tout
 * en CSS) — l'appelant n'a rien à faire.
 *
 * Recherche : filtre les cartes déjà présentes (et celles ajoutées
 * ensuite, via un MutationObserver sur la liste) selon le titre de
 * chacune (`.nm-carte-elt-titre`), insensible à la casse/aux accents.
 * Aucun changement requis côté appelants (zoneAccueilTef.ts,
 * zoneAccueilTcfCe.ts, zoneAccueilTcfEe.ts, zoneAccueilTcfEo.ts) : le
 * filtre s'applique automatiquement dès qu'une carte est ajoutée à
 * `listeCartes`.
 */
export const construireCorpsPage = (
    page: HTMLDivElement,
    messageAucuneCarte: string = "Aucune carte pour le moment."
): ZonesCorpsPage => {
    page.innerHTML = "";
    page.classList.add("nm-page-corps");

    // --- Le reste de la page : simple div, vide ---
    const zoneAffichage = document.createElement("div");
    zoneAffichage.classList.add("nm-page-reste");
    page.appendChild(zoneAffichage);

    // --- Zone à droite : entête (recherche + repliage) + colonne de cartes ---
    const zoneCartes = document.createElement("div");
    zoneCartes.classList.add("nm-page-cartes");

    const entete = document.createElement("div");
    entete.className = "nm-page-cartes-entete";

    const zoneRecherche = document.createElement("div");
    zoneRecherche.className = "nm-page-cartes-recherche";

    const iconeRecherche = document.createElement("span");
    iconeRecherche.className = "iconMateriel nm-page-cartes-recherche-icone";
    iconeRecherche.textContent = "search";

    const champRecherche = document.createElement("input");
    champRecherche.type = "text";
    champRecherche.className = "nm-page-cartes-recherche-champ";
    champRecherche.placeholder = "Rechercher...";

    zoneRecherche.append(iconeRecherche, champRecherche);

    const boutonReplier = document.createElement("button");
    boutonReplier.type = "button";
    boutonReplier.className = "nm-page-cartes-toggle iconMateriel";
    boutonReplier.textContent = "chevron_right";
    boutonReplier.title = "Replier les cartes";

    entete.append(zoneRecherche, boutonReplier);
    zoneCartes.appendChild(entete);

    const listeCartes = new StackContainer(messageAucuneCarte);
    zoneCartes.appendChild(listeCartes.getElement());

    // --- Repliage : purement visuel, géré en CSS via cette classe ---
    boutonReplier.addEventListener("click", () => {
        const repliee = zoneCartes.classList.toggle("nm-page-cartes--repliee");
        boutonReplier.textContent = repliee ? "chevron_left" : "chevron_right";
        boutonReplier.title = repliee ? "Déplier les cartes" : "Replier les cartes";
    });

    // --- Recherche : (re)filtre chaque carte de listeCartes selon son titre ---
    const filtrerCartes = (): void => {
        const recherche = normaliserRecherche(champRecherche.value);
        Array.from(listeCartes.getElement().children).forEach((enfant) => {
            if (!(enfant instanceof HTMLElement)) return;
            if (enfant.classList.contains("stack-empty-message")) return;
            const titre = enfant.querySelector(".nm-carte-elt-titre");
            const texte = titre ? titre.textContent ?? "" : enfant.textContent ?? "";
            const correspond = recherche === "" || normaliserRecherche(texte).includes(recherche);
            enfant.classList.toggle("nm-carte-item-cachee", !correspond);
        });
    };
    champRecherche.addEventListener("input", filtrerCartes);

    // Réapplique le filtre courant dès qu'une carte est ajoutée/retirée
    // (chargement asynchrone des séries) — aucun appelant n'a besoin de
    // rappeler filtrerCartes lui-même.
    const observateurCartes = new MutationObserver(filtrerCartes);
    observateurCartes.observe(listeCartes.getElement(), { childList: true });

    page.appendChild(zoneCartes);

    return { zoneAffichage, zoneCartes, listeCartes };
};

/** Affiche un simple message dans la zone d'affichage (état vide/inactif). */
export const afficherMessageZone = (zoneAffichage: HTMLDivElement, message: string): void => {
    zoneAffichage.innerHTML = "";
    const el = document.createElement("div");
    el.classList.add("nm-page-reste-message");
    el.textContent = message;
    zoneAffichage.appendChild(el);
};