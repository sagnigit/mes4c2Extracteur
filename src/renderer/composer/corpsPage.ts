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

/**
 * Vide `page` puis construit son squelette :
 *  - `.nm-page-reste`  : simple div vide (zone d'affichage).
 *  - `.nm-page-cartes` : zone à droite, liste de cartes.
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

    // --- Zone à droite : colonne de cartes ---
    const zoneCartes = document.createElement("div");
    zoneCartes.classList.add("nm-page-cartes");

    const listeCartes = new StackContainer(messageAucuneCarte);
    zoneCartes.appendChild(listeCartes.getElement());

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
