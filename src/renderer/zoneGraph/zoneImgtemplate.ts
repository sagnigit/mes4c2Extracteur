import { Panel } from '../composer/Panel.js';
import { captureDivAsPng } from '../utils/Capturedivaspng.js';
import { EditableBlockManager } from '../composer/EditableBlockManager.js';

let panelConserveur: Panel;

// "Grande div" contenant l'image de fond (template) + le cadre.
// C'est elle qui doit être capturée dans son ensemble par
// composerSurImageTemplate : pendant la composition, le scrollFrame du
// manager (voir EditableBlockManager.enterCaptureMode) vient s'y insérer
// DIRECTEMENT, à la place de l'ancien cadre "overlay" — plus besoin de
// capturer le contenu du manager séparément puis de l'insérer comme
// <img> : une seule capture de imageDiv suffit désormais.
let imageDiv: HTMLDivElement;

// Résolue une fois que l'image de fond (fond.png) a fini de charger et que
// `imageDiv` a donc sa taille réelle : toute composition doit attendre
// cette promesse avant de pouvoir ouvrir/capturer la zone.
let arrierePlanPret: Promise<void>;

export const initTempleteImg = () => {
    panelConserveur = new Panel();
    panelConserveur.hideHeader();
    const container = panelConserveur.getBody();
    container.classList.add("img-template-porteur");

    let resoudreArrierePlan: () => void = () => {};
    arrierePlanPret = new Promise((resolve) => { resoudreArrierePlan = resolve; });

    function createImageContainer(src: string): HTMLDivElement {
        const container = document.createElement("div");
        container.className = "img-template-container";

        const img = document.createElement("img");
        img.src = src;

        img.onload = () => {
            container.style.width = img.naturalWidth + "px";
            container.style.height = img.naturalHeight + "px";
            resoudreArrierePlan();
        };

        container.appendChild(img);
        return container;
    }

    const lienImg = `assets/fond.png`;
    imageDiv = createImageContainer(lienImg);
    container.appendChild(imageDiv);
}

export const ouvriTempleImg = () => {
    panelConserveur.open();
}

const attendreFrameSuivante = (): Promise<void> =>
    new Promise((resolve) => requestAnimationFrame(() => resolve()));

/**
 * Compose l'image finale à afficher dans la zone de transformation :
 *  1) attend que l'image de fond du template soit chargée (si ce n'est pas
 *     déjà le cas) ;
 *  2) ouvre la zone template — nécessaire pour que le cadre ait une taille
 *     réelle et soit mesurable/capturable ; elle reste invisible pour
 *     l'utilisateur car recouverte par le popup (z-index supérieur)
 *     pendant toute l'opération ;
 *  3) déplace le scrollFrame du manager DIRECTEMENT dans imageDiv, à la
 *     place de l'ancien cadre (EditableBlockManager.enterCaptureMode) ;
 *  4) ajuste la police pour remplir au mieux le cadre sans déborder
 *     (EditableBlockManager.fitCaptureContent) ;
 *  5) capture la grande div (image de fond + cadre rempli) — UNE SEULE
 *     capture, contre deux auparavant ;
 *  6) referme la zone et remet le scrollFrame à sa place d'origine, avec
 *     sa classe "mode édition" (EditableBlockManager.exitCaptureMode),
 *     que la capture ait réussi ou non.
 *
 * Le résultat (Blob PNG final, ou null en cas d'échec à une étape
 * quelconque) est renvoyé via callback plutôt qu'une valeur de retour,
 * car plusieurs étapes asynchrones (chargement d'image, capture) sont
 * enchaînées.
 */
export const composerSurImageTemplate = (
    manager: EditableBlockManager,
    callback: (resultat: Blob | null) => void,
): void => {
    arrierePlanPret
        .then(async () => {
            // Ouvre la zone AVANT de déplacer/mesurer le cadre : tant que le
            // panel est caché (display: none), imageDiv n'a aucune taille de
            // rendu et scrollFrame ne pourrait pas être mesuré correctement.
            panelConserveur.open();

            manager.enterCaptureMode(imageDiv);
            await manager.fitCaptureContent();

            // On attend la frame suivante pour être sûr que l'ajustement
            // (police, position...) est bien rendu avant de lancer la capture.
            await attendreFrameSuivante();

            captureDivAsPng(imageDiv, (blobFinal) => {
                manager.exitCaptureMode();
                panelConserveur.close();
                callback(blobFinal);
            });
        })
        .catch(() => {
            manager.exitCaptureMode();
            panelConserveur.close();
            callback(null);
        });
};
