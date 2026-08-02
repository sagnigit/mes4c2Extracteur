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

export const initEcouteExport = () => {
    
    //gere la fin d'une exportation et affiche le mesage retouner selon l'etat de l'exportaion
    window.api.on('export-ecoute:fin', (_event: any, info: {type: ZoneExport, correct: boolean, message: string} | null) => {
        fermerZoneBloquant();
        if(!info){
            // Aucune session sur le site d'exportation : main.ts ouvre un zoen pour la connexion
            // déjà la zone de connexion de son côté (voir
            // setOuvreVueCallback dans gestion_export.ts)
            //on donne une zone permetant a l'utilisateur de comprendre voir de fermer la fenetre de connexion 
            ouvreView();
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
    });
}

/**
 * Point d'entrée unique appelé par TOUS les boutons d'export, quelle
 * que soit la zone d'affichage. Ne reçoit que `cible` (zone + id) —
 * à vous de brancher ici l'exportation réelle.
 */
export const demanderExport = (cible: CibleExport): void => {
    console.log(cible.id);
    /*ouvreZoneBloquant("Préparation à l'exportation ...");
    window.api.send('export-ecoute:lancer', cible);*/
};