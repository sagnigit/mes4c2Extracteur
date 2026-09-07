// donneeTcfEoApi.ts
// Petite couche d'accès pour les données TCF EO, au-dessus du pont IPC
// générique (window.api). Ne parle qu'aux canaux 'tcf-eo:*', câblés
// dans main.ts sur le module dédié donnee_tcf_eo.ts — la seule source
// de vérité pour l'EO du TCF (voir ce fichier côté backend).

// Une "partie" telle qu'extraite (voir recupDonnee_tcf_eo.ts / donnee_tcf_eo.ts).
export interface PartieEO {
    nomPartie: string;
    tache2: string[];
    tache3: string[];
}

// Une carte à afficher à l'accueil : un dossier tcf_eo = une carte.
export interface CarteTcfEo {
    id: string;
    nom: string;
    dossier: string;
}

/** Liste toutes les cartes TCF EO déjà enregistrées. */
export const listerTcfEo = (): Promise<CarteTcfEo[]> => {
    return window.api.invoke('tcf-eo:list');
};

/** Lit l'extrait ET le transformé d'une carte TCF EO (par id de lien). */
export const lireTcfEo = (
    idLien: string
): Promise<{ success: boolean; extrait?: PartieEO[]; transforme?: PartieEO[]; ss?: string; error?: string }> => {
    return window.api.invoke('tcf-eo:read', idLien);
};

/** Enregistre la version modifiée (transformé) d'une carte TCF EO. */
export const sauvegarderTransformeTcfEo = (
    idLien: string,
    parties: PartieEO[]
): Promise<{ success: boolean; error?: string }> => {
    return window.api.invoke('tcf-eo:save-transform', { idLien, parties });
};

/** Supprime définitivement une carte TCF EO (dossier + référence). */
export const supprimerTcfEo = (
    idLien: string
): Promise<{ success: boolean; error?: string }> => {
    return window.api.invoke('tcf-eo:delete', idLien);
};
