// conserveurDonne.ts
//
// Gestion des données d'épreuves TEF uniquement (CE, CO, EE, EO)
// sous dossierConserveur (gardienRef).
//
// Organisation disque (noms de dossier fabriqués par
// gestion_ref_tef.ts, jamais ici — voir getCheminEnsDossierTef) :
//   conserveur/
//     tef_ce_<slug>_<idLien>/{ce.json, img/, audio/, trans_ce.json, trans_img/, trans_audio/}
//     tef_co_<slug>_<idLien>/{…}
//     tef_ee_<slug>_<idLien>/{…}
//     tef_eo_<slug>_<idLien>/{…}
//
// Référencement (id ↔ dossier ↔ nom affichable) entièrement délégué à
// gestion_ref_tef.ts — ce module-ci ne s'occupe que du contenu des
// dossiers (JSON extrait/transformé, médias). Le TCF est géré ailleurs.

import * as path from 'path';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import {
    dossierConserveur,
    chargeRef,
    creer_dossier,
} from './gardienRef.js';
// Référencement (id ↔ dossier ↔ nom affichable) délégué en totalité à
// gestion_ref_tef.ts — conserveurDonne.ts ne fait plus que du stockage
// (JSON, médias, transformés) sur les dossiers qu'on lui indique.
import {
    getRefType,
    getDossierParId,
    supprimerRef as supprimerRefTef,
    enregistrerDossierOrphelin,
    getCheminEnsDossierTef,
} from './gestion_ref_tef.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export const TYPES_EPREUVE = ['ce', 'co', 'ee', 'eo'] as const;
export type TypeEpreuve = (typeof TYPES_EPREUVE)[number];

export interface NomSerieExtrait {
    id: string;
    nom: string;
    /** Nom du dossier sur disque, ex. "ce_serie_1001" */
    dossier: string;
    type: TypeEpreuve;
}

export interface SlotMedia {
    donneeBase64?: string;
    extension?: string;
    vide?: boolean;
}

export interface PropositionsCE {
    A: string;
    B: string;
    C: string;
    D: string;
}

// ---------------------------------------------------------------------------
// Chemins disque
// ---------------------------------------------------------------------------

export function getBaseDir(): string {
    return dossierConserveur;
}

// Le nom de dossier d'une série TEF n'est plus fabriqué ici : c'est
// gestion_ref_tef.ts (getCheminEnsDossierTef) qui décide du nom exact
// ("tef_<type>_<slug>_<idLien>") — c'est le SEUL endroit qui en génère,
// ce qui garantit que tout dossier TEF porte bien ce préfixe.

export function cheminDossierSerie(dossier: string): string {
    return path.join(getBaseDir(), dossier);
}

export function getExtraitJsonPath(serieDir: string, type: TypeEpreuve): string {
    return path.join(serieDir, `${type}.json`);
}

export function getTransJsonPath(serieDir: string, type: TypeEpreuve): string {
    return path.join(serieDir, `trans_${type}.json`);
}

/** Déduit le type à partir d'un nom de dossier ("tef_<type>_..."). */
export function parserNomDossier(
    dossier: string
): { type: TypeEpreuve; slug: string } | null {
    for (const type of TYPES_EPREUVE) {
        const prefixe = `tef_${type}_`;
        if (dossier.startsWith(prefixe)) {
            return {
                type,
                slug: dossier.slice(prefixe.length) || dossier,
            };
        }
    }
    return null;
}

// ---------------------------------------------------------------------------
// Utilitaires FS
// ---------------------------------------------------------------------------

export async function existeChemin(cheminCible: string): Promise<boolean> {
    try {
        await fsp.access(cheminCible, fs.constants.F_OK);
        return true;
    } catch {
        return false;
    }
}

export async function copierRecursivement(
    source: string,
    destination: string
): Promise<void> {
    const stat = await fsp.stat(source);
    if (stat.isDirectory()) {
        await fsp.mkdir(destination, { recursive: true });
        const entrees = await fsp.readdir(source);
        for (const entree of entrees) {
            await copierRecursivement(
                path.join(source, entree),
                path.join(destination, entree)
            );
        }
    } else {
        await fsp.mkdir(path.dirname(destination), { recursive: true });
        await fsp.copyFile(source, destination);
    }
}

export function slugifierNomSerie(nom: string): string {
    const brut = nom
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
    return brut || 'serie';
}

export function trierNaturellement(a: string, b: string): number {
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

// ---------------------------------------------------------------------------
// Références (style liens extraits)
// ---------------------------------------------------------------------------

/**
 * Liste les séries d'un type.
 * L'UI s'appuie sur id + nom (pas sur le chemin brut).
 * Référencement entièrement délégué à gestion_ref_tef.ts.
 */
export function getNomSeries(type: TypeEpreuve): NomSerieExtrait[] {
    chargeRef();
    return getRefType(type)
        .map((item) => ({
            id: item.id,
            nom: item.nom,
            dossier: item.chemin,
            type,
        }))
        .sort((a, b) => trierNaturellement(a.nom, b.nom));
}

/** Toutes les séries TEF (les 4 types). */
export function getNomSeriesToutes(): NomSerieExtrait[] {
    return TYPES_EPREUVE.flatMap((type) => getNomSeries(type)).sort((a, b) =>
        trierNaturellement(a.nom, b.nom)
    );
}

/**
 * Référence un dossier déjà présent sur disque mais inconnu (utilisé
 * uniquement par synchroniserRefsDepuisDisque ci-dessous, en filet de
 * sécurité) — le flux normal d'extraction TEF passe exclusivement par
 * gestion_ref_tef.getCheminEnsDossierTef (voir outi_exract.ts), jamais
 * par cette fonction.
 */
export function enregistrerSerieRef(
    type: TypeEpreuve,
    dossier: string,
    nomAffichable: string
): NomSerieExtrait[] {
    chargeRef();
    enregistrerDossierOrphelin(type, dossier, nomAffichable);
    return getNomSeries(type);
}

export function getDossierSerie(type: TypeEpreuve, id: string): string {
    chargeRef();
    return getDossierParId(type, id);
}

export function getCheminSerieParId(type: TypeEpreuve, id: string): string {
    const dossier = getDossierSerie(type, id);
    if (!dossier) return '';
    return cheminDossierSerie(dossier);
}

export function supprimerRefSerie(
    type: TypeEpreuve,
    id: string
): NomSerieExtrait[] {
    chargeRef();
    supprimerRefTef(type, id);
    return getNomSeries(type);
}

// ---------------------------------------------------------------------------
// Médias
// ---------------------------------------------------------------------------

export function resoudreCheminMedia(
    serieDir: string,
    cheminRelatif: string | undefined,
    nomFichierSimple: string | undefined,
    sousDossier: 'img' | 'audio'
): string {
    if (cheminRelatif && cheminRelatif.trim() !== '') {
        return path.join(serieDir, cheminRelatif.replace(/\\/g, '/'));
    }
    if (nomFichierSimple && nomFichierSimple.trim() !== '') {
        return path.join(serieDir, sousDossier, nomFichierSimple);
    }
    return '';
}

export async function copierMediaInitial(
    serieDir: string,
    cheminSourceAbsolu: string,
    dossierDestNom: string,
    nomBase: string
): Promise<string> {
    if (!cheminSourceAbsolu || !(await existeChemin(cheminSourceAbsolu))) return '';
    const dossierDest = path.join(serieDir, dossierDestNom);
    await fsp.mkdir(dossierDest, { recursive: true });
    const extension = path.extname(cheminSourceAbsolu) || '';
    const nomFichier = `${nomBase}${extension}`;
    await fsp.copyFile(cheminSourceAbsolu, path.join(dossierDest, nomFichier));
    return `${dossierDestNom}/${nomFichier}`;
}

// ---------------------------------------------------------------------------
// Helpers transform
// ---------------------------------------------------------------------------

export function melangerLettres(lettres: string[]): string[] {
    const copie = [...lettres];
    for (let i = copie.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copie[i], copie[j]] = [copie[j], copie[i]];
    }
    return copie;
}

export function construirePropositions(item: any): {
    propositions: PropositionsCE;
    bonneReponse: string;
} {
    const correcte =
        typeof item.reponseCorrecte === 'string' ? item.reponseCorrecte.trim() : '';
    const distracteurs: string[] =
        typeof item.distracteurs === 'string'
            ? item.distracteurs
                  .split('|')
                  .map((d: string) => d.trim())
                  .filter((d: string) => d.length > 0)
            : [];

    const textes = [correcte, ...distracteurs].slice(0, 4);
    while (textes.length < 4) textes.push('');

    const lettres = melangerLettres(['A', 'B', 'C', 'D']);
    const propositions: PropositionsCE = { A: '', B: '', C: '', D: '' };
    let bonneReponse = '';
    textes.forEach((texte, i) => {
        const lettre = lettres[i] as keyof PropositionsCE;
        propositions[lettre] = texte;
        if (i === 0 && correcte !== '') bonneReponse = lettre;
    });

    return { propositions, bonneReponse };
}

export function stripHtmlBasique(html: string): string {
    return html
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&#39;/gi, "'")
        .replace(/&quot;/gi, '"')
        .trim();
}

export function extraireLettreSection(section: any): 'A' | 'B' | '' {
    if (typeof section !== 'string') return '';
    const m = section.trim().match(/([ab])\s*$/i);
    return m ? (m[1].toUpperCase() as 'A' | 'B') : '';
}

// ---------------------------------------------------------------------------
// Génération des transformés
// ---------------------------------------------------------------------------

export async function genererTransformCeOuCo(
    serieDir: string,
    type: 'ce' | 'co'
): Promise<void> {
    const fichier = getExtraitJsonPath(serieDir, type);
    if (!(await existeChemin(fichier))) return;

    const contenu = await fsp.readFile(fichier, 'utf-8');
    const parse = JSON.parse(contenu);
    const donnees: any[] = Array.isArray(parse) ? parse : [parse];

    const resultat: any[] = [];
    for (let index = 0; index < donnees.length; index++) {
        const item = donnees[index];
        const nomImage = item.image ?? item.images;
        const cheminImageAbs = resoudreCheminMedia(
            serieDir,
            item.imagePath,
            nomImage,
            'img'
        );
        const imageRel = await copierMediaInitial(
            serieDir,
            cheminImageAbs,
            'trans_img',
            `${type}_${index}`
        );

        const { propositions, bonneReponse } = construirePropositions(item);

        const obj: any = {
            index,
            image: imageRel,
            consigne: typeof item.consigne === 'string' ? item.consigne : '',
            propositions,
            bonneReponse,
            ...(type === 'co' ? { points: typeof item.points === 'number' ? item.points : 0 } : {}),
        };

        if (type === 'co') {
            const cheminAudioAbs = resoudreCheminMedia(
                serieDir,
                item.audioPath,
                item.audio,
                'audio'
            );
            obj.audio = await copierMediaInitial(
                serieDir,
                cheminAudioAbs,
                'trans_audio',
                `co_${index}`
            );
        }

        resultat.push(obj);
    }

    await fsp.writeFile(
        getTransJsonPath(serieDir, type),
        JSON.stringify(resultat, null, 2),
        'utf-8'
    );
}

export async function genererTransformEE(serieDir: string): Promise<void> {
    const fichier = getExtraitJsonPath(serieDir, 'ee');
    if (!(await existeChemin(fichier))) return;

    const contenu = await fsp.readFile(fichier, 'utf-8');
    const parse = JSON.parse(contenu);
    const donnees: any[] = Array.isArray(parse) ? parse : [parse];

    const resultat: any = { A: { consigne: '' }, B: { consigne: '' } };
    for (const item of donnees) {
        const lettre = extraireLettreSection(item.section);
        if (lettre === '') continue;
        const consigneBrute = typeof item.consigne === 'string' ? item.consigne : '';
        resultat[lettre] = { consigne: stripHtmlBasique(consigneBrute) };
    }

    await fsp.writeFile(
        getTransJsonPath(serieDir, 'ee'),
        JSON.stringify(resultat, null, 2),
        'utf-8'
    );
}

export async function genererTransformEO(serieDir: string): Promise<void> {
    const fichier = getExtraitJsonPath(serieDir, 'eo');
    if (!(await existeChemin(fichier))) return;

    const contenu = await fsp.readFile(fichier, 'utf-8');
    const parse = JSON.parse(contenu);
    const donnees: any[] = Array.isArray(parse) ? parse : [parse];

    const resultat: any = {
        A: { image: '', consigne: '', description: '' },
        B: { image: '', consigne: '', description: '' },
    };

    for (const item of donnees) {
        const lettre = extraireLettreSection(item.section);
        if (lettre === '') continue;

        const nomImage = item.images ?? item.image;
        // imagePath peut contenir plusieurs chemins séparés par " | "
        const premierChemin =
            typeof item.imagePath === 'string'
                ? item.imagePath.split('|')[0]?.trim()
                : undefined;
        const cheminImageAbs = resoudreCheminMedia(
            serieDir,
            premierChemin,
            typeof nomImage === 'string' ? nomImage.split('|')[0]?.trim() : nomImage,
            'img'
        );
        const imageRel = await copierMediaInitial(
            serieDir,
            cheminImageAbs,
            'trans_img',
            `eo_${lettre}`
        );

        resultat[lettre] = {
            image: imageRel,
            consigne: stripHtmlBasique(
                typeof item.consigne === 'string' ? item.consigne : ''
            ),
            description: '',
        };
    }

    await fsp.writeFile(
        getTransJsonPath(serieDir, 'eo'),
        JSON.stringify(resultat, null, 2),
        'utf-8'
    );
}

/** Au lancement : génère les transformés manquants (TEF uniquement). */
export async function genererTransformationsManquantes(): Promise<void> {
    chargeRef();
    creer_dossier(getBaseDir());

    for (const type of TYPES_EPREUVE) {
        for (const s of getNomSeries(type)) {
            const serieDir = cheminDossierSerie(s.dossier);
            const source = getExtraitJsonPath(serieDir, type);
            if (!(await existeChemin(source))) continue;
            if (await existeChemin(getTransJsonPath(serieDir, type))) continue;

            try {
                if (type === 'ce' || type === 'co') {
                    await genererTransformCeOuCo(serieDir, type);
                } else if (type === 'ee') {
                    await genererTransformEE(serieDir);
                } else {
                    await genererTransformEO(serieDir);
                }
            } catch (err) {
                console.error(`Échec transform ${s.dossier}/${type} :`, err);
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Lecture
// ---------------------------------------------------------------------------

export async function lireTypeData(
    type: TypeEpreuve,
    id: string
): Promise<any[]> {
    const serieDir = getCheminSerieParId(type, id);
    if (!serieDir) throw new Error(`Série introuvable : ${type}/${id}`);

    const fichierJson = getExtraitJsonPath(serieDir, type);
    const contenu = await fsp.readFile(fichierJson, 'utf-8');
    const donnees = JSON.parse(contenu);
    const liste = Array.isArray(donnees) ? donnees : [donnees];

    return liste.map((item) => {
        const nomImage = item.image ?? item.images;
        const nomAudio = item.audio;
        const cheminImage = resoudreCheminMedia(
            serieDir,
            item.imagePath,
            nomImage,
            'img'
        );
        const cheminAudio = resoudreCheminMedia(
            serieDir,
            item.audioPath,
            nomAudio,
            'audio'
        );
        return {
            ...item,
            _localImagePath: cheminImage
                ? `file://${cheminImage.replace(/\\/g, '/')}`
                : '',
            _localAudioPath: cheminAudio
                ? `file://${cheminAudio.replace(/\\/g, '/')}`
                : '',
        };
    });
}

export async function lireTransformData(
    type: TypeEpreuve,
    id: string
): Promise<any> {
    const serieDir = getCheminSerieParId(type, id);
    if (!serieDir) return null;

    const fichierTransform = getTransJsonPath(serieDir, type);
    if (!(await existeChemin(fichierTransform))) return null;

    let donnees: any;
    try {
        donnees = JSON.parse(await fsp.readFile(fichierTransform, 'utf-8'));
    } catch {
        return null;
    }

    const versFileUrl = (rel?: string): string => {
        if (!rel) return '';
        return `file://${path.join(serieDir, rel).replace(/\\/g, '/')}`;
    };

    if (type === 'ce' || type === 'co') {
        return (donnees as any[]).map((item) => ({
            ...item,
            _localImage: versFileUrl(item.image),
            ...(type === 'co' ? { _localAudio: versFileUrl(item.audio) } : {}),
        }));
    }

    if (type === 'eo') {
        const resultat: any = {};
        for (const lettre of ['A', 'B']) {
            resultat[lettre] = {
                ...donnees[lettre],
                _localImage: versFileUrl(donnees[lettre]?.image),
            };
        }
        return resultat;
    }

    return donnees; // ee
}

export async function lireCoupleDonnees(
    type: TypeEpreuve,
    id: string
): Promise<{ success: boolean; extrait?: any[]; transforme?: any; error?: string }> {
    try {
        const extrait = await lireTypeData(type, id);
        const transforme = await lireTransformData(type, id);
        return { success: true, extrait, transforme };
    } catch (err: any) {
        return { success: false, error: err?.message ?? String(err) };
    }
}

// ---------------------------------------------------------------------------
// Enregistrement d'un extrait
// ---------------------------------------------------------------------------

/**
 * Crée / met à jour une série TEF pour un type.
 * - nouvelle → dossier + extrait + transform (si items non vides) + ref
 * - existante → extrait écrasé, transform existant CONSERVÉ
 */
export async function enregistrerExtrait(
    type: TypeEpreuve,
    numeroOuSlug: string,
    items: any[],
    nomAffichable?: string
): Promise<{ success: boolean; cree: boolean; id?: string; error?: string }> {
    try {
        chargeRef();
        creer_dossier(getBaseDir());

        // Le nom de dossier vient exclusivement de gestion_ref_tef.ts
        // (getCheminEnsDossierTef génère les 4 types en une fois ; on ne
        // retient ici que celui qui nous intéresse) — jamais fabriqué
        // localement, pour que tout dossier TEF garde le préfixe "tef_".
        const dossier = getCheminEnsDossierTef(
            numeroOuSlug,
            nomAffichable ?? `TEF ${type.toUpperCase()} ${numeroOuSlug}`
        )[type];
        const serieDir = cheminDossierSerie(dossier);
        await fsp.mkdir(serieDir, { recursive: true });
        await fsp.mkdir(path.join(serieDir, 'img'), { recursive: true });
        await fsp.mkdir(path.join(serieDir, 'audio'), { recursive: true });

        const fichierExtrait = getExtraitJsonPath(serieDir, type);
        const existaitDeja = await existeChemin(fichierExtrait);

        await fsp.writeFile(
            fichierExtrait,
            JSON.stringify(items ?? [], null, 2),
            'utf-8'
        );

        // Générer le transform seulement à la création ET s'il y a du contenu
        if (!existaitDeja && Array.isArray(items) && items.length > 0) {
            if (type === 'ce' || type === 'co') {
                await genererTransformCeOuCo(serieDir, type);
            } else if (type === 'ee') {
                await genererTransformEE(serieDir);
            } else {
                await genererTransformEO(serieDir);
            }
        }

        const trouve = getNomSeries(type).find((s) => s.dossier === dossier);
        return { success: true, cree: !existaitDeja, id: trouve?.id };
    } catch (err: any) {
        return { success: false, cree: false, error: err?.message ?? String(err) };
    }
}

export async function enregistrerExtraitEeOuEo(
    type: 'ee' | 'eo',
    numeroOuSlug: string,
    items: any[],
    nomAffichable?: string
) {
    return enregistrerExtrait(type, numeroOuSlug, items, nomAffichable);
}

// ---------------------------------------------------------------------------
// Sauvegarde des transformés édités
// ---------------------------------------------------------------------------

export async function resoudreSlotMedia(
    serieDir: string,
    dossierNom: string,
    nomBase: string,
    cheminExistant: string,
    nouvelleValeur: string | SlotMedia | undefined
): Promise<string> {
    if (nouvelleValeur === undefined) return cheminExistant ?? '';
    if (typeof nouvelleValeur === 'string') return nouvelleValeur;
    if (nouvelleValeur.vide) return '';

    if (nouvelleValeur.donneeBase64) {
        const dossierDest = path.join(serieDir, dossierNom);
        await fsp.mkdir(dossierDest, { recursive: true });
        const extension = nouvelleValeur.extension || 'bin';
        const nomFichier = cheminExistant
            ? path.basename(cheminExistant)
            : `${nomBase}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}.${extension}`;

        await fsp.writeFile(
            path.join(dossierDest, nomFichier),
            Buffer.from(nouvelleValeur.donneeBase64, 'base64')
        );
        return `${dossierNom}/${nomFichier}`;
    }

    return cheminExistant ?? '';
}

export async function sauvegarderTransformCeOuCo(
    type: 'ce' | 'co',
    id: string,
    items: any[]
): Promise<{ success: boolean; error?: string }> {
    try {
        const serieDir = getCheminSerieParId(type, id);
        if (!serieDir) return { success: false, error: 'Série introuvable' };

        const fichierJson = getTransJsonPath(serieDir, type);
        let existant: any[] = [];
        if (await existeChemin(fichierJson)) {
            try {
                const parse = JSON.parse(await fsp.readFile(fichierJson, 'utf-8'));
                existant = Array.isArray(parse) ? parse : [];
            } catch {
                existant = [];
            }
        }

        const parIndex = new Map<number, any>();
        for (const it of existant) parIndex.set(it.index, it);

        for (const envoye of items) {
            const precedent = parIndex.get(envoye.index) ?? {
                index: envoye.index,
                image: '',
                consigne: '',
                propositions: { A: '', B: '', C: '', D: '' },
                bonneReponse: '',
                ...(type === 'co' ? { audio: '' } : {}),
            };

            const image = await resoudreSlotMedia(
                serieDir,
                'trans_img',
                `${type}_${envoye.index}`,
                precedent.image,
                envoye.image
            );

            const fusionne: any = {
                index: envoye.index,
                image,
                consigne: envoye.consigne ?? precedent.consigne,
                propositions: {
                    ...precedent.propositions,
                    ...(envoye.propositions ?? {}),
                },
                bonneReponse: envoye.bonneReponse ?? precedent.bonneReponse,
            };

            if (type === 'co') {
                fusionne.audio = await resoudreSlotMedia(
                    serieDir,
                    'trans_audio',
                    `co_${envoye.index}`,
                    precedent.audio,
                    envoye.audio
                );
                fusionne.points = envoye.points ?? precedent.points ?? 0;
            }

            parIndex.set(envoye.index, fusionne);
        }

        const resultatFinal = Array.from(parIndex.values()).sort(
            (a, b) => a.index - b.index
        );
        await fsp.writeFile(
            fichierJson,
            JSON.stringify(resultatFinal, null, 2),
            'utf-8'
        );
        return { success: true };
    } catch (err: any) {
        return { success: false, error: err?.message ?? String(err) };
    }
}

export async function sauvegarderTransformEE(
    id: string,
    donnees: { A?: { consigne?: string }; B?: { consigne?: string } }
): Promise<{ success: boolean; error?: string }> {
    try {
        const serieDir = getCheminSerieParId('ee', id);
        if (!serieDir) return { success: false, error: 'Série introuvable' };

        const fichierJson = getTransJsonPath(serieDir, 'ee');
        let existant: any = { A: { consigne: '' }, B: { consigne: '' } };
        if (await existeChemin(fichierJson)) {
            try {
                existant = {
                    ...existant,
                    ...JSON.parse(await fsp.readFile(fichierJson, 'utf-8')),
                };
            } catch {
                /* */
            }
        }

        const resultat = {
            A: { consigne: donnees.A?.consigne ?? existant.A?.consigne ?? '' },
            B: { consigne: donnees.B?.consigne ?? existant.B?.consigne ?? '' },
        };
        await fsp.writeFile(fichierJson, JSON.stringify(resultat, null, 2), 'utf-8');
        return { success: true };
    } catch (err: any) {
        return { success: false, error: err?.message ?? String(err) };
    }
}

export async function sauvegarderTransformEO(
    id: string,
    donnees: {
        A?: { image?: string | SlotMedia; consigne?: string; description?: string };
        B?: { image?: string | SlotMedia; consigne?: string; description?: string };
    }
): Promise<{ success: boolean; error?: string }> {
    try {
        const serieDir = getCheminSerieParId('eo', id);
        if (!serieDir) return { success: false, error: 'Série introuvable' };

        const fichierJson = getTransJsonPath(serieDir, 'eo');
        let existant: any = {
            A: { image: '', consigne: '', description: '' },
            B: { image: '', consigne: '', description: '' },
        };
        if (await existeChemin(fichierJson)) {
            try {
                existant = {
                    ...existant,
                    ...JSON.parse(await fsp.readFile(fichierJson, 'utf-8')),
                };
            } catch {
                /* */
            }
        }

        const resultat: any = {};
        for (const lettre of ['A', 'B'] as const) {
            const envoye = donnees[lettre] ?? {};
            const precedent =
                existant[lettre] ?? { image: '', consigne: '', description: '' };
            const image = await resoudreSlotMedia(
                serieDir,
                'trans_img',
                `eo_${lettre}`,
                precedent.image,
                envoye.image
            );
            resultat[lettre] = {
                image,
                consigne: envoye.consigne ?? precedent.consigne,
                description: envoye.description ?? precedent.description,
            };
        }

        await fsp.writeFile(fichierJson, JSON.stringify(resultat, null, 2), 'utf-8');
        return { success: true };
    } catch (err: any) {
        return { success: false, error: err?.message ?? String(err) };
    }
}

// ---------------------------------------------------------------------------
// Sync disque → refs
// ---------------------------------------------------------------------------

export async function synchroniserRefsDepuisDisque(): Promise<void> {
    chargeRef();
    creer_dossier(getBaseDir());

    let entrees: string[] = [];
    try {
        entrees = await fsp.readdir(getBaseDir());
    } catch {
        return;
    }

    for (const nom of entrees) {
        const parsed = parserNomDossier(nom);
        if (!parsed) continue;

        const { type, slug } = parsed;
        const serieDir = path.join(getBaseDir(), nom);
        const stat = await fsp.stat(serieDir).catch(() => null);
        if (!stat?.isDirectory()) continue;
        if (!(await existeChemin(getExtraitJsonPath(serieDir, type)))) continue;

        const existants = getNomSeries(type);
        if (existants.some((s) => s.dossier === nom)) continue;

        enregistrerSerieRef(type, nom, `TEF ${type.toUpperCase()} ${slug}`);
    }
}

// ---------------------------------------------------------------------------
// Récupération transformé + cheminDossier à partir de l'id uniquement
// (une fonction dédiée exportée par type, comme demandé, chacune
// déléguant à cette implémentation générique interne)
// ---------------------------------------------------------------------------

async function recupererTransformeEtCheminTef(
    type: TypeEpreuve,
    id: string
): Promise<{ success: boolean; cheminDossier?: string; transforme?: any; error?: string }> {
    try {
        const cheminDossier = getCheminSerieParId(type, id);
        if (!cheminDossier) return { success: false, error: 'Série introuvable' };

        const transforme = await lireTransformData(type, id);
        return { success: true, cheminDossier, transforme };
    } catch (err: any) {
        return { success: false, error: err?.message ?? String(err) };
    }
}

export async function recupererTransformeEtCheminTefCe(
    id: string
): Promise<{ success: boolean; cheminDossier?: string; transforme?: any; error?: string }> {
    return recupererTransformeEtCheminTef('ce', id);
}

export async function recupererTransformeEtCheminTefCo(
    id: string
): Promise<{ success: boolean; cheminDossier?: string; transforme?: any; error?: string }> {
    return recupererTransformeEtCheminTef('co', id);
}

export async function recupererTransformeEtCheminTefEe(
    id: string
): Promise<{ success: boolean; cheminDossier?: string; transforme?: any; error?: string }> {
    return recupererTransformeEtCheminTef('ee', id);
}

export async function recupererTransformeEtCheminTefEo(
    id: string
): Promise<{ success: boolean; cheminDossier?: string; transforme?: any; error?: string }> {
    return recupererTransformeEtCheminTef('eo', id);
}