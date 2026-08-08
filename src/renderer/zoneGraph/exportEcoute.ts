// exportEcoute.ts
//
// Point d'entrée UNIQUE pour toutes les demandes d'exportation lancées
// depuis un bouton posé sur une zone d'affichage (TCF · CE -> TEF · EO,
// voir creerBoutonExportZone dans boutonExportZone.ts).
//
// Quelle que soit la zone sur laquelle il se trouve, chaque bouton
// appelle exactement la même fonction : demanderExport(cible).
//
// `cible` est le SEUL moyen fourni pour identifier précisément
// l'élément à exporter :
//   - zone : la zone d'affichage d'où provient la demande (voir
//            ZoneExport ci-dessous — une valeur par type de données,
//            de 'tcf-ce' à 'tef-eo') ;
//   - id   : l'identifiant de la carte / série affichée dans cette
//            zone au moment du clic (infoCarte.id pour TCF CE/EE/EO,
//            l'id de la série "conserveur" pour TEF CE/CO/EE/EO et
//            TCF CO).
//
// Rien d'autre n'est déduit ni envoyé ici : à partir de `cible`,
// libre à vous de retrouver et lancer l'exportation réelle
// (typiquement via un appel IPC vers main.ts).

/** Une zone d'affichage de données, de TCF · CE à TEF · EO. */
import {ouvreZoneBloquant, fermerZoneBloquant} from './zoneBloquante.js';
import {creerMessage, creerMessagePermanent, typeErreur, typeReussite} from './gestionMessage.js';
import {ouvreView} from './zoneView.js';
import {ZoneExport} from '../../varUni.js';

/** Identifie précisément l'élément à exporter. */
export interface CibleExport {
    /** Zone d'affichage d'où provient la demande. */
    zone: ZoneExport;
    /** Identifiant de l'élément affiché dans cette zone (carte ou série). */
    id: string;
}

// Résolveur de la prochaine fin d'exportation en attente (voir
// demanderExportSequence, plus bas) : permet d'enchaîner plusieurs
// exportations une par une (sélection groupée) sans dépendre d'un
// `off` sur window.api.on (non exposé par le preload) — un seul
// écouteur, enregistré une fois ci-dessous, sert à la fois l'affichage
// des messages ET, s'il y en a une en attente, la suite de la séquence.
let resolveProchaineFin: ((continuer: boolean) => void) | null = null;

// Même principe que resolveProchaineFin ci-dessus, mais pour le canal
// dédié à l'export GROUPÉ des sujets TEF · EE (voir
// demanderExportGroupeTefEe plus bas) : un seul écouteur enregistré une
// fois ci-dessous sert à la fois l'affichage du message ET, s'il y en a
// une en attente, la résolution de la promesse de demanderExportGroupeTefEe.
let resolveProchaineFinGroupeEe: (() => void) | null = null;

export const initEcouteExport = () => {
    
    //gere la fin d'une exportation et affiche le mesage retouner selon l'etat de l'exportaion
    window.api.on('export-ecoute:fin', (_event: any, info: {type: ZoneExport, correct: boolean, message: string} | null) => {
        fermerZoneBloquant();

        const resolveEnAttente = resolveProchaineFin;
        resolveProchaineFin = null;

        if(!info){
            // Aucune session sur le site d'exportation : main.ts ouvre un zoen pour la connexion
            // déjà la zone de connexion de son côté (voir
            // setOuvreVueCallback dans gestion_export.ts)
            //on donne une zone permetant a l'utilisateur de comprendre voir de fermer la fenetre de connexion 
            ouvreView();
            // Une session doit être établie : inutile d'enchaîner le
            // reste d'une éventuelle séquence, mieux vaut laisser
            // l'utilisateur réessayer une fois connecté.
            resolveEnAttente?.(false);
            return;
        }
        if(info.correct){
            creerMessage(
                typeReussite,
                `Reussite . Exportation . ${info.type}`,
                info.message
            )
        }
        else{
            creerMessagePermanent(
                typeErreur,
                `Erreur . Exportation . ${info.type}`,
                info.message
            );
        }
        // Succès ou échec ordinaire : la séquence, s'il y en a une,
        // peut continuer avec la cible suivante.
        resolveEnAttente?.(true);
    });

    // Gère la fin d'une exportation GROUPÉE de sujets TEF · EE (tous
    // fusionnés en une seule requête côté backend, voir
    // 'export-ecoute:lancer-groupe-ee' dans gestion_export.ts) : succès
    // ou échec s'applique alors à tout le lot envoyé (une seule requête
    // = un seul résultat pour tous les sujets fusionnés).
    window.api.on('export-ecoute:fin-groupe-ee', (_event: any, info: {
        correct: boolean;
        message: string;
        idsExportes: string[];
        idsInvalides: string[];
    } | null) => {
        fermerZoneBloquant();

        const resoudre = resolveProchaineFinGroupeEe;
        resolveProchaineFinGroupeEe = null;

        if (!info) {
            ouvreView();
            resoudre?.();
            return;
        }

        if (info.correct) {
            creerMessage(
                typeReussite,
                `Réussite . Exportation groupée . tef-ee`,
                info.idsExportes.length > 1
                    ? `${info.idsExportes.length} sujets fusionnés et envoyés. ${info.message}`
                    : info.message
            );
        } else {
            creerMessagePermanent(
                typeErreur,
                `Erreur . Exportation groupée . tef-ee`,
                info.message
            );
        }

        if (info.idsInvalides.length > 0) {
            creerMessagePermanent(
                typeErreur,
                `Exportation groupée . tef-ee . sujets ignorés`,
                `${info.idsInvalides.length} sujet(s) écarté(s) (données absentes ou incomplètes).`
            );
        }

        resoudre?.();
    });
}

/**
 * Point d'entrée unique appelé par TOUS les boutons d'export, quelle
 * que soit la zone d'affichage. Ne reçoit que `cible` (zone + id) —
 * à vous de brancher ici l'exportation réelle.
 */
export const demanderExport = (cible: CibleExport): void => {
    ouvreZoneBloquant("Préparation à l'exportation ...");
    window.api.send('export-ecoute:lancer', cible);
};

/**
 * Lance l'exportation de PLUSIEURS cibles (sélection groupée), une par
 * une : attend la fin de chacune (succès ou échec, message déjà affiché
 * par l'écouteur ci-dessus) avant de lancer la suivante, pour éviter
 * que plusieurs exportations ne se chevauchent sur la même session.
 * S'arrête immédiatement si une session doit être établie (l'utilisateur
 * n'a alors plus qu'à se reconnecter puis réessayer).
 */
export const demanderExportSequence = async (cibles: CibleExport[]): Promise<void> => {
    for (const cible of cibles) {
        const continuer = await new Promise<boolean>((resolve) => {
            resolveProchaineFin = resolve;
            demanderExport(cible);
        });
        if (!continuer) break;
    }
};

/**
 * Lance l'export GROUPÉ de plusieurs sujets TEF · EE (sélection
 * groupée) : contrairement à demanderExportSequence, qui exporte une
 * cible après l'autre, tous les `ids` reçus ici sont fusionnés côté
 * backend en un seul tableau et envoyés en UNE SEULE requête (voir
 * arrangerEELot / 'export-ecoute:lancer-groupe-ee' dans
 * gestion_export.ts) — reproduit le comportement de l'ancien export
 * TEF · EE, qui fusionnait déjà toutes les séries sélectionnées.
 * N'accepte que des identifiants de zone 'tef-ee' : à l'appelant de
 * ne lui passer que ceux-là (voir executerExportGroupe, corpsPage.ts).
 */
export const demanderExportGroupeTefEe = (ids: string[]): Promise<void> => {
    if (ids.length === 0) return Promise.resolve();
    return new Promise((resolve) => {
        resolveProchaineFinGroupeEe = resolve;
        ouvreZoneBloquant("Préparation de l'exportation groupée (TEF · EE) ...");
        window.api.send('export-ecoute:lancer-groupe-ee', { ids });
    });
};

/** Résultat de vérification d'exportabilité d'un sujet (voir verifierExportGroupe). */
export interface ResultatVerificationExport {
    zone: ZoneExport;
    id: string;
    exportable: boolean;
}

/**
 * Vérifie, en UNE SEULE requête vers le backend, l'exportabilité de
 * plusieurs cibles à la fois (sélection groupée, voir
 * verifierEtIndexerCartes dans corpsPage.ts). Remplace l'ancien
 * système qui relisait et revérifiait chaque carte une par une, côté
 * renderer : ici, le backend reçoit directement toutes les (zone, id),
 * relit uniquement le .json transformé de chaque sujet et retourne,
 * pour chacun, un simple booléen (voir verificationExportSujet.ts
 * côté backend, canal IPC 'conserveur:verifier-export-groupe').
 */
export const verifierExportGroupe = (cibles: CibleExport[]): Promise<ResultatVerificationExport[]> => {
    if (cibles.length === 0) return Promise.resolve([]);
    return window.api.invoke('conserveur:verifier-export-groupe', cibles);
};