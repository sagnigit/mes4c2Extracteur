// majCodesEcoute.ts
//
// Point d'entrée UNIQUE pour la mise à jour des codes d'extraction
// (bouton "Exécuter les codes d'injection" du module 02 de
// zoneParam.ts). Même principe que updateEcoute.ts pour la mise à
// jour de l'application :
//   - demanderMajCodesExtraction() ouvre la zoneBloquante avec un
//     message d'attente puis envoie l'IPC 'outil-extract:maj' (voir
//     extractionDirecte.ts côté main process, qui délègue à
//     mettreAJourCodesExtraction dans outi_exract.ts) ;
//   - initEcouteMajCodesExtraction() écoute le retour sur le canal
//     'outil-extract:maj-fin', ferme la zoneBloquante, puis affiche un
//     message temporaire (succès ou erreur).

import { ouvreZoneBloquant, fermerZoneBloquant } from './zoneBloquante.js';
import { creerMessage, typeReussite, typeErreur } from './gestionMessage.js';

interface ResultatMajCodes {
    success: boolean;
    error?: string;
}

export const initEcouteMajCodesExtraction = (): void => {
    window.api.on('outil-extract:maj-fin', (_event: any, resultat: ResultatMajCodes) => {
        fermerZoneBloquant();

        if (resultat?.success) {
            creerMessage(
                typeReussite,
                "Codes d'extraction",
                'Les codes d’extraction ont été mis à jour avec succès.'
            );
        } else {
            creerMessage(
                typeErreur,
                "Codes d'extraction",
                resultat?.error ?? 'Échec de la mise à jour des codes d’extraction.'
            );
        }
    });
};

/**
 * Appelée par le bouton "Exécuter les codes d'injection" de
 * zoneParam.ts. Ouvre immédiatement la zone bloquante puis déclenche
 * le téléchargement/enregistrement côté main process.
 */
export const demanderMajCodesExtraction = (): void => {
    ouvreZoneBloquant('Mise à jour des codes d’extraction, merci de patienter...');
    window.api.send('outil-extract:maj');
};
