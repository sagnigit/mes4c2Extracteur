// export_progressif.ts
//
// Couche réseau : envoie une SUITE de paquets (voir arrangeExport.ts)
// les uns après les autres, en attendant à chaque fois la réponse (ou
// l'erreur) avant d'envoyer le suivant — comme l'ancien exportComp
// (CE/CO, question par question). Dès qu'un paquet échoue (erreur
// serveur ou délai dépassé), l'envoi s'arrête net : les questions
// restantes de l'élément en cours d'export ne sont PAS envoyées.

import type { Session, BrowserWindow } from 'electron';;
import type { PaquetEnvoi } from './arrangeExport.js';
import { envoyerRequete, type ResultatEnvoi } from './export_unique.js'

/** Appelé avant chaque envoi puis avec le résultat de chaque envoi. */
export type ProgressionCallback = (
    info: { numero: number; total: number },
    etat: 'en_cours' | 'succes' | 'erreur',
    message?: string
) => void;

export interface ResultatProgressif {
    success: boolean;
    /** Résultat du DERNIER paquet traité (succès ou échec bloquant). */
    dernierResultat: ResultatEnvoi | null;
    /** Nombre de paquets réellement envoyés avant arrêt. */
    nbEnvoyes: number;
}

export async function envoyerProgressif(
    session: Session,
    url: string,
    paquets: PaquetEnvoi[],
    fen: BrowserWindow
): Promise<ResultatProgressif> {
    let dernierResultat: ResultatEnvoi | null = null;
    let nbEnvoyes = 0;

    for (const paquet of paquets) {

        const resultat = await envoyerRequete(session, url, paquet);
        dernierResultat = resultat;
        nbEnvoyes += 1;

        if (!resultat.correct) {
            // Une question a échoué (erreur serveur ou délai dépassé) :
            // on arrête net, sans envoyer les questions restantes.
            return { success: false, dernierResultat, nbEnvoyes };
        }
        else{
            fen.webContents.send("message-overlay", `Question ${nbEnvoyes} . ${resultat.message}`);
        }
    } 

    return { success: true, dernierResultat, nbEnvoyes };
}
