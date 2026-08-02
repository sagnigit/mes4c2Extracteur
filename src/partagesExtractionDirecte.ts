// ---------------------------------------------------------------------
// Constantes partagées entre extractionDirecte.ts (processus principal,
// qui positionne réellement la WebContentsView) et
// zoneExtractionDirecte.ts (renderer, qui dessine le bandeau de message
// par-dessus). Les deux doivent rester alignés visuellement, d'où ce
// fichier commun.
// ---------------------------------------------------------------------

// Hauteur de la barre de titre personnalisée (voir fondation.ts / #custom-titlebar).
export const HAUTEUR_BARRE_TITRE = 57;

// --- Mode "réduit" : petite vue ancrée en haut à gauche, empilée avec
// les autres vues réduites le cas échéant.
export const DOCK_LARGEUR = 320;
export const DOCK_HAUTEUR = 200;
export const DOCK_MARGE = 12;

// --- Mode "zone" (grande vue, occupée quand une tâche est en erreur /
// attend une correction manuelle) : un bandeau de message + boutons est
// dessiné côté renderer juste sous la barre de titre, la WebContentsView
// occupe le reste de l'espace disponible.
export const BANDEAU_HAUTEUR = 64;
export const BANDEAU_MARGE_HAUT = 8; // espace entre la barre de titre et le bandeau
export const ZONE_MARGE = 24; // marge gauche/droite/bas de la grande vue

// Point de départ vertical de la grande vue = sous la barre de titre,
// le bandeau, et son propre petit espacement.
export const ZONE_HAUT =
    HAUTEUR_BARRE_TITRE + BANDEAU_MARGE_HAUT + BANDEAU_HAUTEUR + BANDEAU_MARGE_HAUT;

// Délai maximum par défaut avant abandon d'une tâche d'extraction.
export const DELAI_PAR_DEFAUT_MS = 80000;

 