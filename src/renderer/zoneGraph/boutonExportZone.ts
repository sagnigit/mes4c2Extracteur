// boutonExportZone.ts
//
// Construit le bouton d'exportation (icône + title) à poser dans
// l'entête d'une zone d'affichage (.affichage-embed-entete). Un seul
// point de construction pour les 8 zones TCF · CE -> TEF · EO, utilisé
// depuis :
//   - zoneAccueilTcfCe.ts (TCF · CE)
//   - zoneAccueilTcfEe.ts (TCF · EE)
//   - zoneAccueilTcfEo.ts (TCF · EO)
//   - zoneAff.ts           (TEF · CE/CO/EE/EO + TCF · CO)
//
// Au clic, le bouton appelle exactement la même fonction pour toutes
// les zones : demanderExport (voir exportEcoute.ts), en lui passant
// uniquement la zone et l'id courants — voir CibleExport.
import {ZoneExport} from '../../varUni.js';
import { demanderExport} from './exportEcoute.js';

/**
 * Crée le bouton d'export à ajouter dans l'entête d'une zone
 * d'affichage.
 *
 * @param zone       Zone d'affichage concernée (fixe pour un bouton donné).
 * @param obtenirId  Appelée au moment du clic pour récupérer
 *                   l'identifiant COURANT de l'élément affiché (utile
 *                   quand la même entête est réutilisée pour plusieurs
 *                   cartes/séries au fil du temps — voir zoneAff.ts).
 *                   Si elle renvoie null/vide, le clic ne fait rien.
 */
export const creerBoutonExportZone = (
    zone: ZoneExport,
    obtenirId: () => string | null | undefined
): HTMLButtonElement => {
    const bouton = document.createElement('button');
    bouton.type = 'button';
    bouton.className = 'affichage-embed-export-btn iconMateriel zoneReacif';
    bouton.textContent = 'cloud_upload';
    bouton.title = 'Exporter';

    bouton.addEventListener('click', (evenement) => {
        evenement.stopPropagation();
        const id = obtenirId();
        if (!id) return;
        demanderExport({ zone, id });
    });

    return bouton;
};