// extractionApi.ts
// Petite couche d'accès pour la zone d'extraction directe, au-dessus du
// pont IPC générique exposé par preload.ts (window.api). Voir
// extractionDirecte.ts côté processus principal.

export type EtatTacheExtraction =
    | 'chargement'
    | 'zone_erreur'
    | 'injecte'
    | 'termine'
    | 'arrete';

export interface EtatExtraction {
    id: string;
    etat: EtatTacheExtraction;
    message?: string;
    url: string;
}

export interface LienExtrait {
    id: string;
    url: string;
    nom: string;
}

// Charge les liens déjà enregistrés pour un idActu (voir
// chargerLiensExtraits côté outi_exract.ts / processus principal).
export const listerLiensExtraits = (idActu: string): Promise<LienExtrait[]> => {
    return window.api.invoke('extraction:listerLiens', idActu);
};

// Abonnement aux mises à jour d'une liste de liens (après fusion +
// enregistrement suite à une actualisation — voir outi_exract.ts).
export const ecouteMajLiens = (callback: (idActu: string, liens: LienExtrait[]) => void): void => {
    window.api.on('extraction:liens-maj', (_event, idActu: string, liens: LienExtrait[]) => callback(idActu, liens));
};

// Abonnement aux changements d'état de n'importe quelle tâche
// d'extraction en cours (identifiée par son `id`).
export const ecouteEtatExtraction = (callback: (info: EtatExtraction) => void): void => {
    window.api.on('extraction:etat', (_event, info: EtatExtraction) => callback(info));
};

// Recharge le lien attendu dans la vue d'une tâche actuellement en zone
// d'erreur ("Relancer le site").
export const relancerExtraction = (id: string): void => {
    window.api.send('extraction:relancer', id);
};

// Annule définitivement une tâche ("Arrêter l'opération").
export const arreterExtraction = (id: string): void => {
    window.api.send('extraction:arreter', id);
};

//lencement de l'injection en vue de la reuperation des lien d'une page
export const extractLien = (idActu: string) => {
    window.api.send('extraction:recupLien', idActu);
}

// Bilan reçu une fois l'enregistrement d'une donnée terminé (voir
// InfoDonneeTraitee côté outi_exract.ts).
export interface InfoDonneeTraitee {
    success: boolean;
    nbSeries?: number;
    nbCreees?: number;
    error?: string;
}

//lencement de l'injection pour la ecuperation des données
export const extractDonnee = (idActu: string, idItem: string) => {
    window.api.send('extraction:recupDonnee', { idActu, idItem });
}

// Abonnement au résultat (succès ou échec) de l'enregistrement d'une
// donnée précise, pour afficher un message temporaire (voir zoneExtract.ts).
export const ecouteDonneeTraitee = (callback: (idActu: string, info: InfoDonneeTraitee) => void): void => {
    window.api.on('extraction:donnee-traitee', (_event, idActu: string, info: InfoDonneeTraitee) => callback(idActu, info));
}

// Progression pendant le TRAITEMENT post-extraction (téléchargement des
// médias TEF, génération des transformés, etc. — voir
// InfoProgressionDonnee/notifierProgressionDonnee dans outi_exract.ts).
// Contrairement à EtatExtraction (chargement de la page/injection),
// ceci concerne ce qui se passe APRÈS que la donnée a été reçue.
export interface InfoProgressionDonnee {
    /** Étape courte, ex. "preparation", "extraction", "telechargement", "transform", "termine" */
    etape: string;
    /** Message affichable pour l'utilisateur */
    message: string;
    /** Détail optionnel (nom de fichier, type d'épreuve, …) */
    detail?: string;
}

// Abonnement à la progression du traitement d'une donnée (voir
// zoneExtractionDirecte.ts, qui l'affiche dans son overlay).
export const ecouteProgressionDonnee = (
    callback: (idActu: string, info: InfoProgressionDonnee) => void
): void => {
    window.api.on(
        'extraction:donnee-progression',
        (_event, idActu: string, info: InfoProgressionDonnee) => callback(idActu, info)
    );
}