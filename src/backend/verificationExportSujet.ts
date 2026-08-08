// verificationExportSujet.ts
//
// NOUVEAU point central de vérification de l'exportabilité d'un sujet
// (série TEF / carte TCF), côté BACKEND, pour la zone d'action groupée
// (sélection groupée, voir remplirZoneSelectionGroupe/verifierEtIndexerCartes
// dans corpsPage.ts).
//
// Avant : chaque carte listée dans le renderer se vérifiait elle-même
// (une lecture disque + un calcul par carte, voir estSerieTefExportable
// / estSerieTcfCeExportable / ... dans
// src/renderer/zoneGraph/verificationExport.ts), soit N vérifications
// (N appels IPC) à l'ouverture de la sélection groupée.
//
// Maintenant : le renderer envoie EN UNE SEULE requête IPC
// ('conserveur:verifier-export-groupe', voir main.ts) la liste de
// TOUTES les cartes actuellement ouvertes dans la zone d'action
// groupée (zone + id de chacune, voir CibleExport dans exportEcoute.ts)
// et reçoit, pour chacune, un simple booléen "exportable ou pas".
//
// Le calcul lui-même se fait ICI, entièrement côté backend :
//   1. on reçoit les (zone, id) ;
//   2. pour chacun, on ne lit QUE le .json TRANSFORMÉ du sujet
//      correspondant (jamais l'extrait) — voir lireElementPourExport
//      dans gestion_export.ts, déjà utilisée pour l'exportation réelle
//      et qui lit exactement ce même fichier ;
//   3. on récupère son contenu (l'objet/tableau transformé tel quel) ;
//   4. on le passe à LA fonction de vérification qui correspond à sa
//      zone (une par zone d'export, ci-dessous) pour savoir si ce
//      sujet est exportable ou non.
//
// --------------------------------------------------------------------
// Fonctions de vérification : UNE par zone d'export ('tcf-ce' ..
// 'tef-eo', voir ZoneExport dans varUni.ts). Chacune reçoit l'objet lu
// depuis le .json transformé du sujet concerné et doit retourner
// `true` si ce sujet est prêt à être exporté, `false` sinon.
//
// Forme de `transforme` reçue par chacune (telle que lue depuis le
// disque, AVANT toute fusion avec l'extrait) :
//   - verifierTefCeExportable / verifierTefCoExportable :
//     ItemTransformCE[] / ItemTransformCO[] (un élément par question,
//     voir donneeApi.ts) ;
//   - verifierTefEeExportable : TransformEE ({ A: {...}, B: {...} },
//     voir donneeApi.ts) ;
//   - verifierTefEoExportable : TransformEO (idem, avec image/description
//     par section) ;
//   - verifierTcfCeExportable : QuestionCE[] (voir donneeTcfCeApi.ts) ;
//   - verifierTcfCoExportable : même forme que TEF CO (donnee_tcf_co.ts
//     réutilise le format CE/CO commun) ;
//   - verifierTcfEeExportable : PartieEE[] (voir donneeTcfEeApi.ts) ;
//   - verifierTcfEoExportable : PartieEO[] (voir donneeTcfEoApi.ts).
//
// EN L'ÉTAT, chacune retourne simplement `true` (aucune règle
// appliquée) : à toi de les compléter, une par une, avec les
// vérifications réelles (mêmes esprits que celles déjà existantes côté
// renderer dans verificationExport.ts, à adapter puisqu'on ne dispose
// plus ici que du transformé seul, jamais de l'extrait).
// --------------------------------------------------------------------

import type { ZoneExport } from '../varUni.js';
import { lireElementPourExport } from './gestion_export.js';

// ---------------------------------------------------------------------
// Règle générique : "aucun élément atomique qui se réduit à une chaîne
// de caractères ne doit être vide" — appliquée pour tef-ce, tcf-ce,
// tcf-ee, tcf-eo (voir chaque fonction plus bas).
// Parcourt récursivement tout objet/tableau et vérifie que CHAQUE
// chaîne trouvée en profondeur est non vide (après trim, pour ne pas
// laisser passer une chaîne composée uniquement d'espaces).
// Les clés préfixées par "_" (ex: _localImage, _localAudio,
// _localEnonceImage) sont ignorées : ce sont des champs ajoutés
// uniquement côté renderer à la lecture (chemin file:// résolu),
// jamais présents dans le .json transformé relu ici.
// Les nombres/booléens ne sont pas concernés par cette règle (seules
// les chaînes comptent) ; `null`/`undefined` sont traités comme une
// absence -> non exportable.
// ---------------------------------------------------------------------
const aucuneChaineVide = (valeur: any): boolean => {
    if (valeur === null || valeur === undefined) return false;
    if (typeof valeur === 'string') return valeur.trim() !== '';
    if (typeof valeur === 'number' || typeof valeur === 'boolean') return true;
    if (Array.isArray(valeur)) return valeur.every((v) => aucuneChaineVide(v));
    if (typeof valeur === 'object') {
        return Object.entries(valeur)
            .filter(([cle]) => !cle.startsWith('_'))
            .every(([, v]) => aucuneChaineVide(v));
    }
    return true;
};

/** TEF · Compréhension Écrite. */
export const verifierTefCeExportable = (transforme: any): boolean => {
    return Array.isArray(transforme) && transforme.length > 0 && aucuneChaineVide(transforme);
};

/**
 * TEF · Compréhension Orale.
 * EN ATTENTE : règle donnée comme "la seule chose qui a le droit
 * d'être vide c'est ..." (précision manquante — à compléter dès que
 * connue). Laissée telle quelle (retourne `true`) pour ne pas bloquer
 * l'export sur une règle mal définie.
 */
export const verifierTefCoExportable = (transforme: any): boolean => {
    return true;
};

/** TEF · Expression Écrite : consigne non vide dans A ET dans B. */
export const verifierTefEeExportable = (transforme: any): boolean => {
    if (!transforme || typeof transforme !== 'object') return false;
    const { A, B } = transforme;
    return aucuneChaineVide(A?.consigne) && aucuneChaineVide(B?.consigne);
};

/**
 * TEF · Expression Orale : dans A comme dans B, consigne, image et
 * description doivent toutes les trois être non vides.
 */
export const verifierTefEoExportable = (transforme: any): boolean => {
    if (!transforme || typeof transforme !== 'object') return false;
    const { A, B } = transforme;
    const sectionValide = (section: any): boolean =>
        aucuneChaineVide(section?.consigne) &&
        aucuneChaineVide(section?.image) &&
        aucuneChaineVide(section?.description);
    return sectionValide(A) && sectionValide(B);
};

/** TCF · Compréhension Écrite. */
export const verifierTcfCeExportable = (transforme: any): boolean => {
    return Array.isArray(transforme) && transforme.length > 0 && aucuneChaineVide(transforme);
};

/**
 * TCF · Compréhension Orale.
 * EN ATTENTE : même règle manquante que verifierTefCoExportable
 * (donnee_tcf_co.ts réutilise le format CE/CO commun) — à compléter en
 * même temps que celle-ci.
 */
export const verifierTcfCoExportable = (transforme: any): boolean => {
    return true;
};

/** TCF · Expression Écrite. */
export const verifierTcfEeExportable = (transforme: any): boolean => {
    return Array.isArray(transforme) && transforme.length > 0 && aucuneChaineVide(transforme);
};

/** TCF · Expression Orale. */
export const verifierTcfEoExportable = (transforme: any): boolean => {
    return Array.isArray(transforme) && transforme.length > 0 && aucuneChaineVide(transforme);
};

/**
 * Point d'entrée unique : redirige vers la fonction de vérification
 * correspondant à la zone concernée (même valeur que celle passée à
 * creerBoutonExportZone côté renderer, voir boutonExportZone.ts).
 */
export const estSujetExportable = (zone: ZoneExport, transforme: any): boolean => {
    switch (zone) {
        case 'tef-ce': return verifierTefCeExportable(transforme);
        case 'tef-co': return verifierTefCoExportable(transforme);
        case 'tef-ee': return verifierTefEeExportable(transforme);
        case 'tef-eo': return verifierTefEoExportable(transforme);
        case 'tcf-ce': return verifierTcfCeExportable(transforme);
        case 'tcf-co': return verifierTcfCoExportable(transforme);
        case 'tcf-ee': return verifierTcfEeExportable(transforme);
        case 'tcf-eo': return verifierTcfEoExportable(transforme);
    }
};

// ---------------------------------------------------------------------
// Orchestration groupée (branchée sur le canal IPC
// 'conserveur:verifier-export-groupe', voir main.ts).
// ---------------------------------------------------------------------

/** Une demande de vérification : la zone + l'id du sujet concerné (voir CibleExport côté renderer). */
export interface DemandeVerificationExport {
    zone: ZoneExport;
    id: string;
}

/** Résultat de vérification pour un sujet donné. */
export interface ResultatVerificationExport {
    zone: ZoneExport;
    id: string;
    exportable: boolean;
}

/** Déduit (examen, type) à partir d'une zone ('tef-ce' -> { examen: 'tef', type: 'ce' }). */
const zoneVersExamenEtType = (zone: ZoneExport): { examen: 'tef' | 'tcf'; type: 'ce' | 'co' | 'ee' | 'eo' } => {
    const [examen, type] = zone.split('-') as ['tef' | 'tcf', 'ce' | 'co' | 'ee' | 'eo'];
    return { examen, type };
};

/**
 * Vérifie, EN UNE SEULE opération, l'exportabilité de plusieurs sujets
 * à la fois : pour chaque (zone, id) reçu, ne lit que son .json
 * transformé (lireElementPourExport, gestion_export.ts — jamais
 * l'extrait) puis applique la fonction de vérification correspondant à
 * sa zone (estSujetExportable ci-dessus). Une erreur de lecture pour un
 * sujet (dossier manquant, JSON invalide, ...) le compte simplement
 * comme non exportable, sans faire échouer les autres.
 */
export const verifierExportGroupe = async (
    demandes: DemandeVerificationExport[]
): Promise<ResultatVerificationExport[]> => {
    const resultats: ResultatVerificationExport[] = [];

    for (const { zone, id } of demandes) {
        const { examen, type } = zoneVersExamenEtType(zone);
        try {
            const { success, transforme } = await lireElementPourExport(examen, type, id);
            resultats.push({ zone, id, exportable: success ? estSujetExportable(zone, transforme) : false });
        } catch {
            resultats.push({ zone, id, exportable: false });
        }
    }

    return resultats;
};