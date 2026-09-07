// gestionAuth.ts
//
// Gestion du mot de passe d'accès à l'application.
// Stockage dans un JSON sous userData :
//   <userData>/auth/mot_de_passe.json
//
// Si le fichier n'existe pas, est illisible, ou ne contient pas de
// mot de passe non vide → on utilise (et on écrit) le mot de passe
// par défaut.
//
// À brancher depuis main.ts :
//
//   import { initAuth } from './backend/gestionAuth.js';
//   initAuth();   // une fois, au démarrage (enregistre les IPC)
//

import * as path from 'path';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import { app, ipcMain } from 'electron';

/** Mot de passe utilisé si le fichier JSON est absent ou vide. */
export const MOT_DE_PASSE_DEFAUT = '12345678';

const NOM_FICHIER = 'mot_de_passe.json';

interface FichierAuth {
    motDePasse: string;
}

function dossierAuth(): string {
    return path.join(app.getPath('userData'), 'auth');
}

function cheminFichierAuth(): string {
    return path.join(dossierAuth(), NOM_FICHIER);
}

function assurerDossier(): void {
    const dir = dossierAuth();
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

/**
 * Lit le mot de passe depuis le JSON.
 * Si le fichier n'existe pas / est invalide / mot de passe vide →
 * écrit le défaut et le renvoie.
 */
export async function recupererMotDePasse(): Promise<string> {
    assurerDossier();
    const fichier = cheminFichierAuth();

    try {
        if (!fs.existsSync(fichier)) {
            await ecrireMotDePasse(MOT_DE_PASSE_DEFAUT);
            return MOT_DE_PASSE_DEFAUT;
        }
        const brut = await fsp.readFile(fichier, 'utf-8');
        const data = JSON.parse(brut) as Partial<FichierAuth>;
        const mdp = typeof data.motDePasse === 'string' ? data.motDePasse.trim() : '';
        if (!mdp) {
            await ecrireMotDePasse(MOT_DE_PASSE_DEFAUT);
            return MOT_DE_PASSE_DEFAUT;
        }
        return mdp;
    } catch {
        await ecrireMotDePasse(MOT_DE_PASSE_DEFAUT);
        return MOT_DE_PASSE_DEFAUT;
    }
}

/** Écrit le mot de passe dans le JSON (écrase le fichier). */
export async function ecrireMotDePasse(motDePasse: string): Promise<void> {
    assurerDossier();
    const payload: FichierAuth = { motDePasse: (motDePasse ?? '').trim() || MOT_DE_PASSE_DEFAUT };
    await fsp.writeFile(cheminFichierAuth(), JSON.stringify(payload, null, 2), 'utf-8');
}

/** true si la saisie correspond au mot de passe enregistré. */
export async function verifierMotDePasse(saisie: string): Promise<boolean> {
    const attendu = await recupererMotDePasse();
    return (saisie ?? '').trim() === attendu;
}

/**
 * Change le mot de passe après vérification de l'ancien.
 * Retourne { success, error? }.
 */
export async function modifierMotDePasse(
    ancien: string,
    nouveau: string
): Promise<{ success: boolean; error?: string }> {
    const actuel = await recupererMotDePasse();
    if ((ancien ?? '').trim() !== actuel) {
        return { success: false, error: 'Ancien mot de passe incorrect.' };
    }
    const n = (nouveau ?? '').trim();
    if (n.length < 4) {
        return { success: false, error: 'Le nouveau mot de passe doit contenir au moins 4 caractères.' };
    }
    await ecrireMotDePasse(n);
    return { success: true };
}

let dejaInit = false;

/**
 * Enregistre les handlers IPC. À appeler une seule fois depuis main.ts
 * (après app.whenReady de préférence, ou au moins avant les invoke renderer).
 *
 * Canaux :
 *   - auth:recuperer-mdp  → string (mot de passe actuel) — usage interne rare
 *   - auth:verifier       → { ok: boolean }
 *   - auth:modifier       → { success: boolean; error?: string }
 *       args: { ancien: string; nouveau: string }
 */
export function initAuth(): void {
    if (dejaInit) return;
    dejaInit = true;

    // S'assure qu'un JSON existe dès le démarrage.
    void recupererMotDePasse();

    ipcMain.handle('auth:recuperer-mdp', async () => {
        return recupererMotDePasse();
    });

    ipcMain.handle('auth:verifier', async (_event, saisie: string) => {
        const ok = await verifierMotDePasse(saisie);
        return { ok };
    });

    ipcMain.handle(
        'auth:modifier',
        async (_event, args: { ancien?: string; nouveau?: string }) => {
            return modifierMotDePasse(args?.ancien ?? '', args?.nouveau ?? '');
        }
    );
}
