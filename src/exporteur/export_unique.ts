// export_unique.ts
//
// Couche réseau : envoie UN paquet (voir arrangeExport.ts) vers le site
// distant, via `session.fetch` (pas le fetch global de Node) pour que
// les cookies de la partition d'export (PARTITION_EXPORT) soient bien
// attachés à la requête. Utilisé pour les arrangements en mode "unique"
// (EE, EO) et réutilisé question par question par export_progressif.ts.
//
// Reprend exactement la logique de lecture de réponse de l'ancien
// export TCF (session.fetch) : le corps est TOUJOURS lu en texte brut
// d'abord (`reponse.text()`), puis parsé nous-mêmes en JSON — jamais
// `reponse.json()` directement, qui consommerait le flux sans laisser
// de recours si le parsing échoue (utile pour voir un éventuel warning
// PHP qui casse le JSON attendu, même avec un statut HTTP 200).

import type { Session } from 'electron';
import type { PaquetEnvoi } from './arrangeExport.js';

// Délai maximum d'attente d'une réponse (identique à l'ancien
// "durreAtente"/DUREE_ATTENTE_MS). Passé ce délai, la requête est
// annulée (AbortController) et l'échec est reporté avec un message dédié.
const DUREE_ATTENTE_MS = 60000;

export interface ResultatEnvoi {
    success: boolean;
    status?: number;
    data?: any;
    error?: string;
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

        // 1) Texte brut d'abord, toujours.
        const texteBrut = await reponse.text();

        // 2) Log complet du texte brut renvoyé par le serveur (process
        // main, pas les DevTools) — utile pour voir un éventuel warning
        // PHP en entier, quel que soit son format (JSON valide ou non).
        console.log(`[export] réponse brute du serveur (status ${reponse.status}) :\n${texteBrut}`);

        // 3) Tentative de parsing JSON sur ce même texte.
        let donneesReponse: any = null;
        let erreurParsing: string | null = null;
        try {
            donneesReponse = JSON.parse(texteBrut);
        } catch (err: any) {
            erreurParsing = err?.message ?? String(err);
        }

        // Un échec de parsing JSON est une erreur MÊME SI le statut HTTP
        // est 200 (script PHP qui laisse fuiter du HTML avant/à la place
        // du JSON attendu) : sans ce contrôle, ce cas remonterait comme
        // un succès silencieux (data=null, reponse.ok=true).
        if (!reponse.ok || erreurParsing) {
            const messageServeur = donneesReponse && (donneesReponse.message || donneesReponse.error);
            const messageErreur = messageServeur
                ? String(messageServeur)
                : erreurParsing
                    ? `Réponse du serveur non reconnue comme du JSON (${erreurParsing}). Contenu brut :\n${texteBrut}`
                    : `Erreur HTTP ${reponse.status}`;

            return {
                success: false,
                status: reponse.status,
                data: donneesReponse ?? texteBrut,
                error: messageErreur,
            };
        }

        return { success: true, status: reponse.status, data: donneesReponse };
    } catch (err: any) {
        if (controleurTemps.signal.aborted) {
            return { success: false, error: "Le délai d'attente est terminé" };
        }
        return { success: false, error: err?.message ?? String(err) };
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
