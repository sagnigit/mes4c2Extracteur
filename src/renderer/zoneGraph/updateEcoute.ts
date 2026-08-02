// updateEcoute.ts
//
// Point d'entrée UNIQUE pour le déclenchement de la mise à jour de
// l'application (bouton "Lancer la mise à jour" du module 01 de
// zoneParam.ts). Même principe que exportEcoute.ts pour l'export :
//   - demanderMiseAJour() ouvre la zoneBloquante avec un message
//     d'attente puis envoie l'IPC 'update:verifier' (voir autoUpdate.ts,
//     côté main process) ;
//   - initEcouteMiseAJour() écoute tous les retours sur le canal
//     'update:statut' et met à jour la zoneBloquante en conséquence,
//     jusqu'à un état terminal (a-jour / pret-a-installer / erreur) où
//     elle est fermée et remplacée par un message temporaire.

import { ouvreZoneBloquant, fermerZoneBloquant, setMessageProgression } from './zoneBloquante.js';
import { creerMessage, creerMessagePermanent, typeInfo, typeReussite, typeErreur } from './gestionMessage.js';

/** Doit rester synchronisé avec StatutMiseAJour dans backend/autoUpdate.ts. */
type StatutMiseAJour =
    | { statut: 'verification' }
    | { statut: 'a-jour' }
    | { statut: 'telechargement'; pourcentage: number }
    | { statut: 'pret-a-installer' }
    | { statut: 'erreur'; message: string };

export const initEcouteMiseAJour = (): void => {
    window.api.on('update:statut', (_event: any, statut: StatutMiseAJour) => {
        switch (statut.statut) {
            case 'verification':
                setMessageProgression('Vérification des mises à jour...');
                break;

            case 'telechargement':
                setMessageProgression(`Téléchargement de la mise à jour... ${statut.pourcentage}%`);
                break;

            case 'a-jour':
                fermerZoneBloquant();
                creerMessage(typeInfo, 'Mise à jour', "L'application est déjà à jour.");
                break;

            // Le téléchargement est terminé : main.ts va fermer puis
            // relancer l'application toute seule dans la foulée
            // (autoUpdater.quitAndInstall), le message n'a donc que le
            // temps d'être aperçu — c'est normal.
            case 'pret-a-installer':
                fermerZoneBloquant();
                creerMessage(typeReussite, 'Mise à jour', "Mise à jour installée, l'application redémarre...");
                break;

            case 'erreur':
                fermerZoneBloquant();
                creerMessagePermanent(typeErreur, 'Mise à jour', statut.message);
                break;
        }
    });
};

/**
 * Appelée par le bouton "Lancer la mise à jour" de zoneParam.ts.
 * Ouvre immédiatement la zone bloquante (l'utilisateur a un retour
 * visuel dès le clic, avant même la réponse de 'checking-for-update')
 * puis déclenche la vérification côté main process.
 */
export const demanderMiseAJour = (): void => {
    ouvreZoneBloquant('Vérification des mises à jour, merci de patienter...');
    window.api.send('update:verifier');
};