// donneeTcfEeApi.ts
// Petite couche d'accès pour les données TCF EE, au-dessus du pont IPC
// générique (window.api). Ne parle qu'aux canaux 'tcf-ee:*', câblés
// dans main.ts sur le module dédié donnee_tcf_ee.ts — la seule source
// de vérité pour l'EE du TCF (voir ce fichier côté backend). Miroir
// exact de donneeTcfEoApi.ts.

// Une "partie" telle qu'extraite (voir recupDonnee_tcf_ee.ts / donnee_tcf_ee.ts).
export interface PartieEE {
    nomPartie: string;
    tache2: string[];
    tache3: string[];
}

// Une carte à afficher à l'accueil : un dossier tcf_ee = une carte.
export interface CarteTcfEe {
    id: string;
    nom: string;
    dossier: string;
}

/** Liste toutes les cartes TCF EE déjà enregistrées. */
export const listerTcfEe = (): Promise<CarteTcfEe[]> => {
    return window.api.invoke('tcf-ee:list');
};

/** Lit l'extrait ET le transformé d'une carte TCF EE (par id de lien). */
export const lireTcfEe = (
    idLien: string
): Promise<{ success: boolean; extrait?: PartieEE[]; transforme?: PartieEE[]; error?: string }> => {
    return window.api.invoke('tcf-ee:read', idLien);
};

/** Enregistre la version modifiée (transformé) d'une carte TCF EE. */
export const sauvegarderTransformeTcfEe = (
    idLien: string,
    parties: PartieEE[]
): Promise<{ success: boolean; error?: string }> => {
    return window.api.invoke('tcf-ee:save-transform', { idLien, parties });
};

/** Supprime définitivement une carte TCF EE (dossier + référence). */
export const supprimerTcfEe = (
    idLien: string
): Promise<{ success: boolean; error?: string }> => {
    return window.api.invoke('tcf-ee:delete', idLien);
};