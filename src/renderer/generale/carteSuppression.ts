// carteSuppression.ts
//
// Bouton de suppression commun aux cartes de série de l'accueil
// (zoneAccueilTef.ts, zoneAccueilTcfCe.ts, zoneAccueilTcfEe.ts,
// zoneAccueilTcfEo.ts) : icône "delete" placée dans l'entête de la
// carte, à droite du titre. Un clic dessus ne doit PAS ouvrir la carte
// (stopPropagation), demande confirmation, puis supprime réellement le
// dossier + la référence via l'appel IPC fourni, et enfin reconstruit
// la page (le seul moyen de faire disparaître proprement la carte,
// même principe que le rafraîchissement en direct déjà utilisé par ces
// pages, voir ecouteDonneeTraitee dans zoneAccueil.ts).

import { creerMessage, typeErreur } from '../zoneGraph/gestionMessage.js';

export interface ResultatSuppression {
    success: boolean;
    error?: string;
}

/**
 * Crée le bouton de suppression à insérer dans l'entête d'une carte.
 * - nomAffichable : utilisé dans la confirmation et le message d'erreur.
 * - supprimer : effectue la suppression réelle (appel IPC).
 * - apresSucces : reconstruit la page une fois la suppression réussie.
 */
export const creerBoutonSupprimerCarte = (
    nomAffichable: string,
    supprimer: () => Promise<ResultatSuppression>,
    apresSucces: () => void
): HTMLButtonElement => {
    const bouton = document.createElement('button');
    bouton.type = 'button';
    bouton.className = 'nm-carte-elt-suppr iconMateriel';
    bouton.textContent = 'delete';
    bouton.title = 'Supprimer';

    bouton.addEventListener('click', (evenement) => {
        evenement.stopPropagation();

        const confirme = window.confirm(
            `Supprimer « ${nomAffichable} » ?\n\nLe dossier et toutes ses données (extrait, transformé, médias) seront définitivement supprimés.`
        );
        if (!confirme) return;

        bouton.disabled = true;
        void supprimer().then((resultat) => {
            if (resultat.success) {
                apresSucces();
            } else {
                bouton.disabled = false;
                creerMessage(typeErreur, nomAffichable, resultat.error ?? 'Échec de la suppression.');
            }
        });
    });

    return bouton;
};
