// export_unique.ts
//
// Couche réseau : envoie UN paquet (voir arrangeExport.ts) vers le site
// distant, via `session.fetch` (pas le fetch global de Node) pour que
// les cookies de la partition d'export (PARTITION_EXPORT) soient bien
// attachés à la requête. Utilisé pour les arrangements en mode "unique"
// (EE, EO) et réutilisé question par question par export_progressif.ts.
//
// `correct` est true uniquement si la requête a abouti ET que le
// serveur a répondu avec un statut de succès (2xx). Dans tous les
// autres cas (délai dépassé, requête non envoyée, erreur réseau,
// statut d'erreur renvoyé par le serveur) `correct` est false.
// `message` contient toujours le texte : soit le corps brut de la
// réponse du serveur, soit le message d'erreur de la requête elle-même
// si aucune réponse n'a pu être obtenue.

import type { Session } from 'electron';
import type { PaquetEnvoi } from './arrangeExport.js';

// Délai maximum d'attente d'une réponse (identique à l'ancien
// "durreAtente"/DUREE_ATTENTE_MS). Passé ce délai, la requête est
// annulée (AbortController) et l'échec est reporté avec un message dédié.
const DUREE_ATTENTE_MS = 60000;

export interface ResultatEnvoi {
    correct: boolean;
    message: string;
}

export async function envoyerRequete(
    session: Session,
    url: string,
    paquet: PaquetEnvoi
): Promise<ResultatEnvoi> {
    const controleurTemps = new AbortController();
    const idDelai = setTimeout(() => controleurTemps.abort(), DUREE_ATTENTE_MS);

    try {
        const reponse = await session.fetch(url, {
            method: 'POST',
            headers: paquet.entetes,
            body: paquet.corpsRequete,
            signal: controleurTemps.signal,
        });

        // Le texte brut EST le message, peu importe que ce soit un
        // succès ou une erreur côté serveur.
        const texteBrut = await reponse.text();
        const eltRessu = JSON.parse(texteBrut);

        return {
            correct: reponse.ok && (eltRessu.code == 0),
            message: eltRessu.message,
        };
    } catch (err: any) {
        // Ici, aucune réponse n'a pu être obtenue du tout (timeout,
        // pas de réseau, DNS, etc.) — on distingue ce cas avec un
        // message dédié plutôt que le texte d'une réponse serveur.
        if (controleurTemps.signal.aborted) {
            return { correct: false, message: "Le délai d'attente est terminé" };
        }
        return { correct: false, message: err?.message ?? String(err) };
    } finally {
        clearTimeout(idDelai);
    }
}

/** Envoi "unique" : un seul paquet, un seul fetch. */
export async function envoyerUnique(
    session: Session,
    url: string,
    paquet: PaquetEnvoi
): Promise<ResultatEnvoi> {
    return envoyerRequete(session, url, paquet);
}