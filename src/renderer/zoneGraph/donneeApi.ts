// donneeApi.ts
// Petite couche d'accès aux données d'extraction (dossier "donnee"),
// au dessus du pont IPC générique exposé par preload.ts (window.api).

export type TypeEpreuve = 'ce' | 'co' | 'ee' | 'eo';

export const TYPES_EPREUVE: TypeEpreuve[] = ['ce', 'co', 'ee', 'eo'];

export interface ElementDonnee {
    [cle: string]: any;
    _localImagePath?: string;
    _localAudioPath?: string;
}

//lence l'ouverture de view
export const lenceOuvetureView = () => {
    window.api.send("ouvre-view");
}

//lence la fermeture view
export const lenceFermetureView = () => {
    window.api.send("ferme-view");
}

// --- Données TRANSFORMÉES ---
// Générées automatiquement au lancement de l'application (une seule fois
// par série/type, à partir de l'extrait) puis éditées/enregistrées via
// les fonctions ci-dessous.

export interface PropositionsCE {
    A: string;
    B: string;
    C: string;
    D: string;
}

export interface ItemTransformCE {
    index: number;
    image: string; // chemin relatif depuis le dossier série ("" si aucun)
    consigne: string;
    propositions: PropositionsCE;
    bonneReponse: 'A' | 'B' | 'C' | 'D' | '';
    points?: number; // utilisé pour CO uniquement (zone "Points")
    _localImage?: string; // file:// résolu, présent uniquement à la lecture
}

export interface ItemTransformCO extends ItemTransformCE {
    audio: string;
    _localAudio?: string;
}

export interface SectionTransformEE {
    consigne: string;
}

export interface TransformEE {
    A: SectionTransformEE;
    B: SectionTransformEE;
}

export interface SectionTransformEO {
    image: string;
    consigne: string;
    description: string;
    _localImage?: string;
}

export interface TransformEO {
    A: SectionTransformEO;
    B: SectionTransformEO;
}

// Pour l'envoi d'un nouveau média (image/audio) lors de la sauvegarde :
// remplace le fichier existant s'il y en avait déjà un pour cette case,
// sinon en crée un nouveau avec un nom généré automatiquement.
export interface SlotMediaEnvoi {
    donneeBase64: string;
    extension: string;
}

// Pour retirer explicitement un média déjà en place.
export interface SlotMediaVide {
    vide: true;
}

// Valeur possible pour une case image/audio lors d'un enregistrement :
// - une chaîne (chemin déjà existant, laissé tel quel, ou "" pour vide)
// - un nouvel envoi binaire (SlotMediaEnvoi)
// - une suppression explicite (SlotMediaVide)
export type ValeurMediaEnvoi = string | SlotMediaEnvoi | SlotMediaVide;

export interface ResultatCouple<TTransforme = any> {
    success: boolean;
    extrait?: ElementDonnee[];
    transforme?: TTransforme;
    error?: string;
}

export interface ResultatSauvegardeTransform {
    success: boolean;
    error?: string;
}

// ---------------------------------------------------------------------
// Affichage de l'accueil (dossier "conserveur") : à partir de main.ts,
// les données CE/CO/EE/EO de TCF comme de TEF affichées à l'accueil
// (zoneAccueil / zoneAccueilTef / zoneAff) sont récupérées via ces
// fonctions, adossées aux canaux IPC 'conserveur:*' (conserveurDonne.ts).
// L'ancien système par dossier "donnee" (listerSeries / presenceTypes /
// lireType / exporterType / lireCouple / lireTransforme /
// sauvegarderTransform, canaux 'donnee:*') a été retiré : rien ne
// l'appelait plus, y compris la zone d'export (qui passe par
// gestion_export.ts / demanderExport). Les types de données transportés
// (ItemTransformCE/CO, TransformEE/EO, etc.) ne changent pas.
// ---------------------------------------------------------------------

export type TypeExamen = 'tef' | 'tcf';

// Une série repérée par un identifiant stable (indépendant de son nom
// affichable ou du nom de son dossier sur disque) — voir conserveurDonne.ts.
export interface NomSerieExtrait {
    id: string;
    nom: string;
    examen: TypeExamen;
    type: TypeEpreuve;
}

// Liste les séries (id + nom affichable) d'un examen + type donné.
export const listerSeriesConserveur = (
    examen: TypeExamen,
    type: TypeEpreuve
): Promise<NomSerieExtrait[]> => {
    return window.api.invoke('conserveur:list-series', { examen, type });
};

// Lit en une fois le json extrait ET le json transformé d'une série
// (identifiée par son id) pour un examen + type donné.
export const lireCoupleConserveur = <TTransforme = any>(
    examen: TypeExamen,
    type: TypeEpreuve,
    id: string
): Promise<ResultatCouple<TTransforme>> => {
    return window.api.invoke('conserveur:read-couple', { examen, type, id });
};

// Lit uniquement le json transformé d'une série (identifiée par son id).
export const lireTransformeConserveur = <TTransforme = any>(
    examen: TypeExamen,
    type: TypeEpreuve,
    id: string
): Promise<{ success: boolean; transforme?: TTransforme; error?: string }> => {
    return window.api.invoke('conserveur:read-transform', { examen, type, id });
};

// Enregistre (fusion avec l'existant) les données transformées d'une
// série (identifiée par son id) — même forme de `donnees` que
// sauvegarderTransform ci-dessus, selon le type.
export const sauvegarderTransformConserveur = (
    examen: TypeExamen,
    type: TypeEpreuve,
    id: string,
    donnees: any
): Promise<ResultatSauvegardeTransform> => {
    return window.api.invoke('conserveur:save-transform', { examen, type, id, donnees });
};

// Supprime définitivement une série (dossier + référence) — voir
// creerBoutonSupprimerCarte dans carteSuppression.ts, utilisé par
// zoneAccueilTef.ts.
export const supprimerSerieConserveur = (
    examen: TypeExamen,
    type: TypeEpreuve,
    id: string
): Promise<{ success: boolean; error?: string }> => {
    return window.api.invoke('conserveur:delete-series', { examen, type, id });
};

