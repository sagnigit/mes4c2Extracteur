// donneeTcfCeApi.ts
// Petite couche d'accès pour les données TCF CE, au-dessus du pont IPC
// générique (window.api). Ne parle qu'aux canaux 'tcf-ce:*', câblés
// dans main.ts sur le module dédié donnee_tcf_ce.ts — la seule source
// de vérité pour la CE du TCF (voir ce fichier côté backend). Miroir
// de donneeTcfEeApi.ts / donneeTcfEoApi.ts, adapté à une donnée en
// tableau plat de questions (pas de regroupement par partie).

// Une question CE telle qu'extraite/transformée (voir donnee_tcf_ce.ts,
// backend) : dans l'extrait, enonce est toujours un texte ; dans le
// transformé, enonce devient le chemin relatif d'une image
// (trans_img/…) une fois celle-ci composée (voir
// enregistrerImageEnonceTcfCe), et reste du texte tant qu'aucune image
// n'a encore été générée. _localEnonceImage, calculé côté backend
// lors de la lecture, donne directement le chemin absolu (file://…)
// affichable de cette image lorsqu'elle existe.
export interface QuestionCE {
    points: number;
    options: string[];
    correctAnswerIndex: number;
    enonce: string;
    question: string;
    _localEnonceImage?: string;
}

// Une carte à afficher à l'accueil : un dossier tcf_ce = une carte.
export interface CarteTcfCe {
    id: string;
    nom: string;
    dossier: string;
}

/** Liste toutes les cartes TCF CE déjà enregistrées. */
export const listerTcfCe = (): Promise<CarteTcfCe[]> => {
    return window.api.invoke('tcf-ce:list');
};

/** Lit l'extrait ET le transformé d'une carte TCF CE (par id de lien). */
export const lireTcfCe = (
    idLien: string
): Promise<{ success: boolean; extrait?: QuestionCE[]; transforme?: QuestionCE[]; error?: string }> => {
    return window.api.invoke('tcf-ce:read', idLien);
};

/** Enregistre la version modifiée (transformé) d'une carte TCF CE. */
export const sauvegarderTransformeTcfCe = (
    idLien: string,
    questions: QuestionCE[]
): Promise<{ success: boolean; error?: string }> => {
    return window.api.invoke('tcf-ce:save-transform', { idLien, questions });
};

/**
 * Enregistre l'image composée (voir EditableImagePopup.ts) pour
 * l'énoncé d'UNE question précise : écrit le fichier dans trans_img/
 * et met à jour enonce (chemin relatif) dans trans_ce.json, côté
 * backend, en une seule opération.
 */
export const enregistrerImageEnonceTcfCe = (
    idLien: string,
    indexQuestion: number,
    donneeBase64: string,
    extension: string
): Promise<{ success: boolean; cheminRelatif?: string; cheminAbsolu?: string; error?: string }> => {
    return window.api.invoke('tcf-ce:save-image', { idLien, indexQuestion, donneeBase64, extension });
};