// gardienOutilExtract.ts
//
// Persistance disque + mise à jour distante des 3 dictionnaires
// utilisés par outi_exract.ts pour piloter l'extraction :
//   - dataLienPincipale   (idActu -> url du tableau de bord)
//   - dataCodeRecupLien   (idActu -> code JS à injecter pour récupérer les liens)
//   - dataCodeRecupDonnee (idActu -> code JS à injecter pour récupérer une donnée)
//
// Rôle de ce module (uniquement lecture/écriture + téléchargement,
// AUCUNE dépendance vers outi_exract.ts pour éviter tout cycle
// d'import) :
//   - chargerDonneesSauvegardees() : relit le fichier JSON local s'il
//     existe et s'il contient bien les 3 dictionnaires ; sinon `null`
//     (c'est alors outi_exract.ts qui garde ses valeurs par défaut).
//   - enregistrerDonnees(...)     : (ré)écrit le fichier JSON local.
//   - telechargerDonneesDistantes() : télécharge et valide le JSON
//     hébergé sur le Gist GitHub (voir LIEN_GIST_CODES_EXTRACTION).
//
// Le déclenchement de la mise à jour distante (bouton "Codes
// d'injection" de zoneParam.ts) est orchestré depuis outi_exract.ts
// (mettreAJourCodesExtraction) puis extractionDirecte.ts (canal IPC
// 'outil-extract:maj').

import * as path from 'path';
import * as fs from 'fs';
import * as https from 'https';
import { dossierConserveur, creer_dossier } from './gardienRef.js';

export interface DictExtract {
    [key: string]: string;
}

export interface DonneesOutilExtract {
    dataLienPincipale: DictExtract;
    dataCodeRecupLien: DictExtract;
    dataCodeRecupDonnee: DictExtract;
}

// Lien du Gist GitHub (raw) hébergeant la dernière version des 3
// dictionnaires. Mis à jour via "Codes d'injection" dans zoneParam.ts.
export const LIEN_GIST_CODES_EXTRACTION =
    'https://gist.githubusercontent.com/sagnigit/ed143a6e22a7ee326eb27e2aef054fb5/raw/';

const fichierDonnees = path.join(dossierConserveur, 'outilExtractCodes.json');

/** Un dictionnaire "valide" : objet non nul dont toutes les valeurs sont des chaînes. */
function estDictValide(valeur: any): valeur is DictExtract {
    if (!valeur || typeof valeur !== 'object' || Array.isArray(valeur)) return false;
    return Object.values(valeur).every((v) => typeof v === 'string');
}

/**
 * Vérifie que `valeur` contient bien les 3 dictionnaires attendus
 * (c'est le sens de "a tous les elements" demandé) — chacun présent
 * et structurellement valide. Un dictionnaire vide reste valide (rien
 * n'impose que tous les idActu y soient déjà, ils retombent sur ''
 * côté extractionDirecte.ts).
 */
export function estDonneesOutilValides(valeur: any): valeur is DonneesOutilExtract {
    return (
        !!valeur &&
        typeof valeur === 'object' &&
        estDictValide(valeur.dataLienPincipale) &&
        estDictValide(valeur.dataCodeRecupLien) &&
        estDictValide(valeur.dataCodeRecupDonnee)
    );
}

/**
 * Relit le fichier JSON local. Retourne `null` si le fichier n'existe
 * pas, est illisible, ou ne contient pas les 3 dictionnaires attendus
 * — c'est à l'appelant (initOutil dans outi_exract.ts) de garder ses
 * valeurs par défaut dans ce cas.
 */
export function chargerDonneesSauvegardees(): DonneesOutilExtract | null {
    try {
        if (!fs.existsSync(fichierDonnees)) return null;
        const brut = fs.readFileSync(fichierDonnees, 'utf-8');
        const valeur = JSON.parse(brut);
        return estDonneesOutilValides(valeur) ? valeur : null;
    } catch (err) {
        console.warn('gardienOutilExtract : lecture du fichier local impossible.', err);
        return null;
    }
}

/** (Ré)écrit le fichier JSON local avec les 3 dictionnaires fournis. */
export function enregistrerDonnees(donnees: DonneesOutilExtract): void {
    creer_dossier(dossierConserveur);
    fs.writeFileSync(fichierDonnees, JSON.stringify(donnees, null, 2), 'utf-8');
}

const NB_REDIRECTIONS_MAX = 5;

/**
 * Récupère le corps texte d'une URL https, en suivant les
 * redirections (nécessaire pour gist.githubusercontent.com, qui
 * redirige vers un CDN). Même approche que downloadFile dans
 * traite_extract_tef.ts, adaptée pour accumuler du texte plutôt que
 * d'écrire un fichier.
 */
function telechargerTexte(url: string, redirectionsRestantes = NB_REDIRECTIONS_MAX): Promise<string> {
    return new Promise((resolve, reject) => {
        const requete = https.get(url, (reponse) => {
            const statut = reponse.statusCode ?? 0;

            if (statut >= 300 && statut < 400 && reponse.headers.location) {
                reponse.resume(); // on vide le flux courant avant de le réutiliser ailleurs
                if (redirectionsRestantes <= 0) {
                    reject(new Error('Trop de redirections lors du téléchargement des codes.'));
                    return;
                }
                telechargerTexte(reponse.headers.location, redirectionsRestantes - 1)
                    .then(resolve)
                    .catch(reject);
                return;
            }

            if (statut !== 200) {
                reponse.resume();
                reject(new Error(`Le serveur de mise à jour des codes a répondu avec une erreur (HTTP ${statut}).`));
                return;
            }

            let corps = '';
            reponse.setEncoding('utf-8');
            reponse.on('data', (fragment) => {
                corps += fragment;
            });
            reponse.on('end', () => resolve(corps));
        });

        requete.on('error', (err) => {
            reject(new Error(`Impossible de joindre le serveur de mise à jour des codes : ${err.message}`));
        });
    });
}

/**
 * Télécharge le JSON distant (Gist) et le valide. Lève une erreur
 * explicite (message affichable tel quel côté renderer) en cas
 * d'échec réseau, de code HTTP non 2xx, de JSON invalide, ou de
 * structure incomplète.
 */
export async function telechargerDonneesDistantes(): Promise<DonneesOutilExtract> {
    const corps = await telechargerTexte(LIEN_GIST_CODES_EXTRACTION);

    let valeur: unknown;
    try {
        valeur = JSON.parse(corps);
    } catch (err: any) {
        throw new Error('La réponse du serveur de mise à jour des codes est illisible (JSON invalide).');
    }

    if (!estDonneesOutilValides(valeur)) {
        throw new Error('La réponse du serveur de mise à jour des codes est incomplète.');
    }

    return valeur;
}
