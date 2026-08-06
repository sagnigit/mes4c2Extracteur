import { creer_dossier, genereId, dossierConserveur, viderDossier, getRef, chargeRef, enregistreRef } from './gardienRef.js';
import path from 'path';
import fs from 'fs';
import { dialog } from "electron";
import AdmZip from "adm-zip";
import { enregistrerExtrait, cheminDossierSerie } from './conserveurDonne.js';
import { getCheminEnsDossierTef, supprimerRef as supprimerRefTef } from './gestion_ref_tef.js';

// Fonction de progression optionnelle : appelée à chaque étape notable
// pour afficher un message dans la zone bloquante (voir zoneBloquante.ts
// côté renderer, canal IPC "message-overlay") pendant l'intégration —
// celle-ci peut prendre du temps (plusieurs zips, beaucoup de sujets,
// copie d'images), sans ça rien ne bouge à l'écran jusqu'à la fin.
type ProgressionIntegration = (message: string) => void;
const progressionSilencieuse: ProgressionIntegration = () => {};

interface DictIntegrateur {
    [key: string]: (arg: any, progress: ProgressionIntegration) => Promise<string>
}

const recupCheminZip = async () => {
    const result = await dialog.showOpenDialog({
        properties: ["openFile", "multiSelections"],
        filters: [{ name: "Archives", extensions: ["zip"] }]
    });
    return result.filePaths;
}

//nous creons un om de dossier qui vas cntenir les dossier qui seront utiliser puis supprimer
const dossierTampon = path.join(dossierConserveur, "dossier_tampon");
const fichierRefZip = path.join(dossierTampon, "ref.json");

//ici si le tampon existe on le vide et s'il n'existe pas on le cree
const initTampon = () => {
    if (!creer_dossier(dossierTampon)) {
        viderDossier(dossierTampon);
    }
}

export const dezipperFichier = (cheminZip: string): boolean => {
    initTampon();
    try {
        const zip = new AdmZip(cheminZip);
        zip.extractAllTo(dossierTampon, true);
        return true;
    } catch (error) {
        return false;
    }
};

// Marqueur ajouté en tête du nom affichable (donc en tête du nom de
// dossier généré, puisque getCheminEnsDossierTef slugifie nomLien) pour
// tout sujet intégré depuis un zip : permet de distinguer d'un coup
// d'oeil, dans les listes de cartes (mêmes cartes/pages que celles des
// liens extraits, voir zoneAccueilTef.ts) comme dans les noms de
// dossier sur disque ("tef_eo_int_...", "tef_ee_int_..."), ce qui
// vient d'un zip intégré de ce qui vient d'une extraction directe.
const MARQUEUR_INTEGRE = 'INT';

// id complet fabriqué par fabId, ex. "intergrer_tef-eo_3" : bien unique
// et stable, mais trop long pour rester distinguable une fois affiché
// sur une carte (voir nomAffichable plus bas) — idCourt() n'en garde
// que le dernier segment (le compteur, ex. "3"), déjà unique à lui
// seul PARMI les sujets d'un même type (voir genereId/fabId : le
// compteur "intergrer_compteur_tef-eo" n'est incrémenté que pour les
// sujets tef-eo, jamais partagé avec tef-ee).
const idCourt = (id: string): string => {
    const segments = id.split('_');
    return segments[segments.length - 1] || id;
};

//ici nous voulon genere un identifiant pa rapport a une chine de caracter sortie de ses données 
//le but est sortir une d qui nous pemettra de d'intgrer les elemnt intergrer dans le mme syteme de reference que les valeurs extraits tout evitant de mettre des chose qui existe deja
const fabId = (nomType: string, valeurRef: string) => {
    const clesDataId = `intergrer_${nomType}_id`;
    const dataId = getRef(clesDataId);
    let idDonnee = dataId[valeurRef];
    if (!idDonnee) {
        const clesCompId = `intergrer_compteur_${nomType}`;
        idDonnee = `intergrer_${nomType}_${genereId(clesCompId)}`;
        dataId[valeurRef] = idDonnee;
    }
    return idDonnee;
}

// getCheminEnsDossierTef (ré-utilisé ici volontairement, comme pour les
// liens extraits) crée/rafraîchit d'un coup les références des 4 types
// TEF (ce/co/ee/eo) pour un même id. Comme une intégration directe ne
// concerne qu'UN seul type à la fois, on retire ensuite les 3 références
// fabriquées en trop pour ce même id (sinon des cartes fantômes,
// pointant vers des dossiers jamais créés, apparaîtraient dans les
// listes des 3 autres types et planteraient à l'ouverture).
const nettoyerAutresTypes = (typeGarde: 'ce' | 'co' | 'ee' | 'eo', id: string) => {
    (['ce', 'co', 'ee', 'eo'] as const).forEach((type) => {
        if (type !== typeGarde) supprimerRefTef(type, id);
    });
};

// --- TEF-EE -------------------------------------------------------------
// ref.conserveur = nom du fichier JSON (dans le dossier tampon) contenant
// un tableau d'objets { sectionA, sectionB } (deux chaînes de texte).
const integrerTefEe = async (nomFichier: string, progress: ProgressionIntegration): Promise<string> => {
    if (typeof nomFichier !== 'string' || nomFichier.trim() === '') {
        return "TEF-EE : conserveur invalide (nom de fichier attendu)";
    }

    const cheminFichier = path.join(dossierTampon, nomFichier);
    if (!fs.existsSync(cheminFichier)) {
        return `TEF-EE : fichier de données introuvable (${nomFichier})`;
    }

    let tableau: any[];
    try {
        const brut = fs.readFileSync(cheminFichier, 'utf-8');
        const parse = JSON.parse(brut);
        tableau = Array.isArray(parse) ? parse : [parse];
    } catch (err: any) {
        return `TEF-EE : fichier de données invalide (${nomFichier}) : ${err?.message ?? err}`;
    }

    let nbIntegres = 0;
    for (const item of tableau) {
        progress(`TEF-EE : sujet ${nbIntegres + 1}/${tableau.length}…`);

        const sectionA = typeof item?.sectionA === 'string' ? item.sectionA : '';
        const sectionB = typeof item?.sectionB === 'string' ? item.sectionB : '';

        // id fabriqué à partir du collage sectionA + sectionB : un même
        // sujet réintégré retombe sur le même id (et donc le même dossier).
        const valeurRef = `${sectionA}|||${sectionB}`;
        const id = fabId('tef-ee', valeurRef);
        // Construit à partir de l'id (stable, unique, déjà garanti par
        // fabId), PAS d'un bout tronqué de l'énoncé : un énoncé peut
        // changer de formulation, contenir des caractères qui rendent le
        // nom moche une fois tronqué, ou même être partagé par erreur
        // entre deux sujets différents. idCourt() garde le nom court et
        // distinguable graphiquement (l'id complet est trop long pour se
        // distinguer d'un coup d'œil sur une carte). Préfixe
        // MARQUEUR_INTEGRE en tête (voir sa définition plus haut) pour
        // distinguer ces sujets des sujets extraits, aussi bien sur les
        // cartes que sur les dossiers générés à partir de ce nom.
        const nomAffichable = `${MARQUEUR_INTEGRE} EE ${idCourt(id)}`;

        const items = [
            { epreuve: 'EE', numero: 1, section: 'Tâche A', consigne: sectionA },
            { epreuve: 'EE', numero: 2, section: 'Tâche B', consigne: sectionB },
        ];

        await enregistrerExtrait('ee', id, items, nomAffichable);
        nettoyerAutresTypes('ee', id);
        nbIntegres++;
    }

    return `TEF-EE : ${nbIntegres} sujet(s) intégré(s)`;
};

// --- TEF-EO -------------------------------------------------------------
// ref.conserveur = tableau de noms de dossier (dans le dossier tampon).
// Chaque dossier contient un donnee.json :
//   { sectionA: { enonce, urlPath, explication }, sectionB: { ... } }
// et les images référencées par urlPath, déjà présentes puisque tout le
// zip a été dézippé dans le dossier tampon en une seule fois.
const integrerTefEo = async (tabDossier: string[], progress: ProgressionIntegration): Promise<string> => {
    if (!Array.isArray(tabDossier)) {
        return "TEF-EO : conserveur invalide (tableau de dossiers attendu)";
    }

    let nbIntegres = 0;
    for (const nomDossier of tabDossier) {
        if (typeof nomDossier !== 'string' || nomDossier.trim() === '') continue;

        progress(`TEF-EO : groupe "${nomDossier}"…`);

        // nomDossier (ex. "groupe-1") n'est PAS un sujet : c'est un
        // groupe qui contient un donnee.json = un TABLEAU de plusieurs
        // { sectionA, sectionB }, chacun avec sa propre image, dans le
        // même sous-dossier img/ partagé par tout le groupe. CHAQUE
        // élément du tableau doit devenir un sujet EO séparé (donc une
        // carte séparée) — un groupe donne autant de sujets que
        // d'éléments dans son tableau, pas un seul.
        const dossierSource = path.join(dossierTampon, nomDossier);
        const cheminDonnee = path.join(dossierSource, 'donnee.json');
        if (!fs.existsSync(cheminDonnee)) continue;

        let contenu: any;
        try {
            contenu = JSON.parse(fs.readFileSync(cheminDonnee, 'utf-8'));
        } catch {
            continue;
        }

        // Tolère aussi un objet unique (donnee.json non-tableau) pour
        // rester compatible avec un groupe ne contenant qu'un seul sujet.
        const tableauSujets: any[] = Array.isArray(contenu) ? contenu : [contenu];

        for (const sujet of tableauSujets) {
            progress(`TEF-EO : groupe "${nomDossier}" — sujet ${nbIntegres + 1}…`);

            const sectionA = sujet?.sectionA ?? {};
            const sectionB = sujet?.sectionB ?? {};

            // id fabriqué à partir de CET élément précis du tableau (pas
            // du groupe entier) : deux éléments différents d'un même
            // groupe.json retombent donc bien sur deux id (et deux
            // dossiers) distincts.
            const valeurRef = `${sectionA.enonce ?? ''}|||${sectionB.enonce ?? ''}`;
            const id = fabId('tef-eo', valeurRef);
            // Construit à partir de l'id (stable, unique, déjà garanti
            // par fabId), PAS d'un bout tronqué de l'énoncé — même
            // raison que pour TEF-EE ci-dessus. idCourt() garde le nom
            // court et distinguable graphiquement. Préfixe
            // MARQUEUR_INTEGRE en tête (voir sa définition plus haut)
            // pour distinguer ces sujets des sujets extraits, aussi bien
            // sur les cartes que sur les dossiers générés à partir de ce
            // nom.
            const nomAffichable = `${MARQUEUR_INTEGRE} EO ${idCourt(id)}`;

            // Dossier cible (même mécanisme de référencement id -> dossier
            // que pour les liens extraits) : récupéré AVANT de copier les
            // images, pour que les chemins écrits dans eo.json pointent
            // déjà vers des fichiers existants au moment où
            // enregistrerExtrait génère le transformé (à la création).
            const dossierEo = getCheminEnsDossierTef(id, nomAffichable).eo;
            const serieDir = cheminDossierSerie(dossierEo);
            fs.mkdirSync(path.join(serieDir, 'img'), { recursive: true });

            // Les urlPath ("img\section_A_0_.png") sont relatifs au
            // dossier du GROUPE (dossierSource), pas au sujet : c'est
            // depuis là qu'on copie, vers le nouveau dossier du sujet.
            const copierImage = (section: any): string => {
                const urlPath = typeof section?.urlPath === 'string' ? section.urlPath : '';
                if (urlPath === '') return '';
                const relatif = urlPath.replace(/\\/g, '/');
                const cheminSource = path.join(dossierSource, relatif);
                if (!fs.existsSync(cheminSource)) return '';
                const nomFichierImg = path.basename(relatif);
                fs.copyFileSync(cheminSource, path.join(serieDir, 'img', nomFichierImg));
                return `img/${nomFichierImg}`;
            };

            const items = (['A', 'B'] as const).map((lettre, index) => {
                const section = lettre === 'A' ? sectionA : sectionB;
                const imagePath = copierImage(section);
                return {
                    epreuve: 'EO',
                    numero: index + 1,
                    section: `Tâche ${lettre}`,
                    consigne: typeof section?.enonce === 'string' ? section.enonce : '',
                    images: imagePath ? path.basename(imagePath) : '',
                    imagesUrls: '',
                    imagePath,
                    explication: typeof section?.explication === 'string' ? section.explication : '',
                };
            });

            await enregistrerExtrait('eo', id, items, nomAffichable);
            nettoyerAutresTypes('eo', id);
            nbIntegres++;
        }
    }

    return `TEF-EO : ${nbIntegres} sujet(s) intégré(s)`;
};

const dataIntegrateur: DictIntegrateur = {
    ["tef-eo"]: integrerTefEo,
    ["tef-ee"]: integrerTefEe,
};

export const integrerSujet = async (progress: ProgressionIntegration = progressionSilencieuse) => {
    chargeRef();
    progress("Sélection des fichiers zip…");
    const cheminZips = await recupCheminZip();
    let message = "";

    // Boucle séquentielle (pas de forEach) : initTampon()/dezipperFichier
    // VIDE le dossier tampon à chaque zip, donc chaque zip doit être
    // entièrement traité (lecture des fichiers, copie des images) avant
    // de passer au suivant.
    for (const [index, chemin] of cheminZips.entries()) {
        const nomZip = path.basename(chemin);
        progress(`Zip ${index + 1}/${cheminZips.length} : ${nomZip} — décompression…`);

        if (!dezipperFichier(chemin)) {
            message += ` . ${chemin} : échec de la décompression`;
            continue;
        }

        if (!fs.existsSync(fichierRefZip)) {
            message += ` . ${chemin} non reconnu`;
            continue;
        }

        try {
            const strRef = fs.readFileSync(fichierRefZip, "utf-8");
            const ref = JSON.parse(strRef);
            const integrateur = dataIntegrateur[ref.type];
            if (!integrateur) {
                message += ` . ${chemin} : type "${ref.type}" non pris en charge`;
                continue;
            }
            message += ` . ${await integrateur(ref.conserveur, progress)}`;
        } catch (err: any) {
            message += ` . ${chemin} : ${err?.message ?? err}`;
        }
    }

    progress("Enregistrement des références…");
    enregistreRef();
    return message.trim() === '' ? "aucun fichier traité" : message.trim();
}