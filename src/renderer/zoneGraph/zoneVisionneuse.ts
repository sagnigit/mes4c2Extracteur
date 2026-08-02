/**
 * zoneVisionneuse
 * ----------------
 * Zone dédiée à l'affichage d'une image en grand, dans un Panel dédié
 * (avec bouton retour). Ne fait qu'afficher : pas d'édition, pas
 * d'action, juste une grande zone de prévisualisation.
 *
 * Comportement d'affichage (voir CSS .zed-visionneuse-*) :
 *  - si une dimension réelle de l'image est PLUS PETITE que l'espace
 *    disponible sur cet axe, l'image garde sa taille réelle sur cet
 *    axe et reste centrée dessus (largeur plus petite -> centrée en
 *    X ; hauteur plus petite -> centrée en Y) ;
 *  - si une dimension DÉPASSE l'espace disponible, l'image est
 *    réduite pour tenir dans cet espace (elle ne garde donc pas sa
 *    taille réelle), avec un padding confortable autour.
 *  C'est exactement le comportement natif d'une <img> avec
 *  max-width/max-height: 100% (+ width/height: auto pour ne jamais
 *  agrandir au-delà de la taille réelle), centrée par un conteneur
 *  flex : aucun calcul de dimensions n'est nécessaire en JS.
 *
 * Connexion automatique : une écoute globale (capture les clics sur
 * n'importe quelle <img> du document) permet d'ouvrir n'importe quelle
 * image affichée ailleurs dans l'application dans cette zone — à
 * l'exception des images de la visionneuse elle-même (évite une
 * boucle) et de celles de la zone technique de composition du template
 * (zoneImgtemplate.ts), qui n'est jamais réellement montrée à
 * l'utilisateur.
 */

import { Panel } from '../composer/Panel.js';

let panelVisionneuse: Panel;
let imgAffichee: HTMLImageElement;

// Zones à exclure de l'écoute globale : la visionneuse elle-même, et
// la zone technique interne de composition du template image.
const SELECTEURS_EXCLUS = '.zed-visionneuse-porteur, .img-template-porteur';

export const initZoneVisionneuse = (): void => {
    panelVisionneuse = new Panel('Image', true);
    panelVisionneuse.getContainer().classList.add('zed-visionneuse-porteur');

    const body = panelVisionneuse.getBody();
    body.classList.add('zed-visionneuse-body');

    const zoneImage = document.createElement('div');
    zoneImage.className = 'zed-visionneuse-zone';

    imgAffichee = document.createElement('img');
    imgAffichee.className = 'zed-visionneuse-image';
    imgAffichee.alt = 'Image affichée en grand';

    zoneImage.appendChild(imgAffichee);
    body.appendChild(zoneImage);

    // Écoute globale : tout clic sur une <img> affichée ailleurs dans
    // l'application ouvre cette image dans la visionneuse.
    document.addEventListener('click', (evenement) => {
        const cible = evenement.target;
        if (!(cible instanceof HTMLImageElement)) return;
        if (cible.closest(SELECTEURS_EXCLUS)) return;
        if (!cible.currentSrc && !cible.src) return;
        afficherImageDansVisionneuse(cible.currentSrc || cible.src);
    });
};

/** Affiche l'image donnée (URL) dans la visionneuse et ouvre la zone. */
export const afficherImageDansVisionneuse = (url: string): void => {
    imgAffichee.src = url;
    panelVisionneuse.open();
};