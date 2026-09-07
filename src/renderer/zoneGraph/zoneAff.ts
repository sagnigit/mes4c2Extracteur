import { ouvrirPopupTransformationImage } from '../composer/EditableImagePopup.js';
import { rafraichirCarteTefApresAffichage } from './zoneAccueilTef.js';
import { creerBoutonExportZone, afficherBoutonExportZone } from './boutonExportZone.js';
import { estQuestionExportable } from './verificationExport.js';
import {ZoneExport} from '../../varUni.js';
import {
    ElementDonnee,
    lireTransformeConserveur,
    PropositionsCE,
    sauvegarderTransformConserveur,
    sauvegarderSsConserveur,
    TypeEpreuve,
    TypeExamen as TypeExamenConserveur,
    ValeurMediaEnvoi,
} from './donneeApi.js';

// ---------------------------------------------------------------------
// Chaque page CE/CO/EE/EO (une par examen TCF/TEF x épreuve) a besoin de
// sa PROPRE zone d'affichage indépendante : son propre état (série/index
// courant), sa propre navigation, son propre contenu — jamais un seul
// élément partagé déplacé d'une page à l'autre selon le type de données
// qu'elle ouvre.
//
// remplirZoneOuverture(div, examen, type) est le point d'entrée unique :
// il prend la div qui doit accueillir la zone (le "reste" de la page,
// voir corpsPage.ts) et l'identifiant de l'élément précis à ouvrir
// (examen 'tef' | 'tcf', type 'ce' | 'co' | 'ee' | 'eo'), remplit
// directement cette div avec les éléments d'ouverture correspondants,
// et retourne l'instance permettant ensuite d'y afficher une série
// donnée. Une instance neuve est construite à chaque appel (voir
// zoneAccueilTef.ts / zoneAccueil.ts : un appel par page).
//
// - Pour 'tef', et pour 'tcf' + ('ee'|'eo') : construction commune
//   (entête + navigation + zones extrait/transformé par type, voir
//   definirZones/zonesCE/zonesCO/zonesEeEo plus bas) — mêmes fichiers,
//   dans le dossier "conserveur" (conserveurDonne.ts), simplement dans
//   l'espace 'tef' ou 'tcf' selon le cas.
// - Pour 'tcf' + ('ce'|'co') : rien n'est encore implémenté (pas de
//   source de données ni de définition de zones pour le moment) — la
//   div est simplement vidée, en attendant.
// ---------------------------------------------------------------------
export type Examen = TypeExamenConserveur;

export interface ZoneAffichageInstance {
    /** Affiche la liste des éléments (ce/co/ee/eo) d'une série donnée (identifiée par son id, dans son examen), dans CETTE instance uniquement. */
    afficherDonnees: (
        titre: string,
        examen: Examen,
        id: string,
        type: TypeEpreuve,
        donnees: ElementDonnee[]
    ) => Promise<void>;
}

// ---------------------------------------------------------------------
// Vérification de l'exportabilité d'une série par OUVERTURE RÉELLE
// ---------------------------------------------------------------------
// NOTE : ces deux fonctions ne sont plus appelées depuis la sélection
// groupée (corpsPage.ts) — celle-ci vérifie désormais l'exportabilité
// EN UNE SEULE requête groupée auprès du backend (voir
// verifierExportGroupe dans exportEcoute.ts et verificationExportSujet.ts
// côté backend), plutôt qu'en ouvrant chaque série une par une ici.
// Conservées telles quelles (non branchées) au cas où ce mode de
// vérification "par ouverture réelle" serait encore utile ailleurs :
// plutôt que de recalculer séparément les règles d'exportabilité
// (risque de divergence avec ce que montre réellement l'ouverture
// normale d'une carte), on ouvre la série dans une instance de zone
// d'affichage JETABLE (jamais celle affichée à l'écran — voir
// verifierExportViaAffichage ci-dessous), exactement comme le ferait
// un clic sur sa carte, puis on relit l'état que cette ouverture a
// elle-même posé dans son entête :
//   - le bouton d'export (.affichage-embed-export-btn, voir
//     boutonExportZone.ts) est-il affiché (pas de classe
//     --cache) ? -> la série est exportable ;
//   - sinon, le message d'entête (.affichage-embed-export-statut,
//     voir rafraichirIndicateursExport plus bas) indique combien de
//     questions restent à corriger -> on en reprend le nombre.

/** Lit, dans le DOM d'une zone d'affichage déjà construite (ou son conteneur), l'état d'exportabilité qu'elle affiche. */
export const lireEtatExportDepuisZone = (racine: ParentNode): { exportable: boolean; nombreAArranger: number } => {
    const bouton = racine.querySelector('.affichage-embed-export-btn');
    const exportable = !!bouton && !bouton.classList.contains('affichage-embed-export-btn--cache');
    if (exportable) return { exportable: true, nombreAArranger: 0 };

    const statut = racine.querySelector('.affichage-embed-export-statut');
    const correspondance = statut?.textContent?.match(/\d+/);
    return { exportable: false, nombreAArranger: correspondance ? parseInt(correspondance[0], 10) : 0 };
};

/**
 * Vérifie l'exportabilité d'une série TEF (CE/CO/EE/EO) ou TCF · CO en
 * l'ouvrant réellement — via une instance de zone d'affichage jetable,
 * construite dans un div détaché (jamais ajouté à la page, donc
 * invisible et sans effet sur ce que l'utilisateur voit) — puis en
 * relisant l'état posé par cette ouverture (voir
 * lireEtatExportDepuisZone ci-dessus) au lieu de dupliquer les règles
 * d'exportabilité. `donnees` : l'extrait de la série (voir
 * lireCoupleConserveur) ; le transformé, lui, est relu depuis le
 * disque par afficherDonnees elle-même, exactement comme à l'ouverture
 * normale d'une carte.
 */
export const verifierExportViaAffichage = async (
    examen: Examen,
    type: TypeEpreuve,
    id: string,
    donnees: ElementDonnee[]
): Promise<{ exportable: boolean; nombreAArranger: number }> => {
    if (donnees.length === 0) return { exportable: false, nombreAArranger: 0 };
    const diveDetachee = document.createElement('div');
    const instance = remplirZoneOuverture(diveDetachee, examen, type);
    await instance.afficherDonnees('', examen, id, type, donnees);
    return lireEtatExportDepuisZone(diveDetachee);
};

// Suivi des sauvegardes en cours, TOUTES instances confondues (pour
// pouvoir toutes les attendre avant la fermeture de l'application — voir
// flushSauvegardesEnAttente, appelé une seule fois depuis fondation.ts).
const sauvegardesEnCours = new Set<Promise<unknown>>();
const suivreSauvegarde = <T,>(promesse: Promise<T>): Promise<T> => {
    sauvegardesEnCours.add(promesse);
    const oublier = () => sauvegardesEnCours.delete(promesse);
    promesse.then(oublier, oublier);
    return promesse;
};

// Attend une éventuelle frame de rendu suivante, le temps qu'un
// événement "blur" déclenché manuellement (voir flushSauvegardesEnAttente)
// ait bien eu l'occasion de démarrer sa sauvegarde avant qu'on les attende.
const attendreProchaineFrame = (): Promise<void> =>
    new Promise((resolve) => requestAnimationFrame(() => resolve()));

// À appeler avant de fermer l'application (voir fondation.ts) : force la
// sauvegarde de tout champ texte/liste encore en cours d'édition (en lui
// retirant le focus, ce qui déclenche son enregistrement), puis attend
// que toutes les sauvegardes en cours (y compris celle-ci), de TOUTES
// les instances (toutes les pages CE/CO/EE/EO ouvertes), soient
// terminées.
export const flushSauvegardesEnAttente = async (): Promise<void> => {
    const actif = document.activeElement as HTMLElement | null;
    if (actif && (actif.classList.contains('zed-textarea-trans') || actif.classList.contains('zed-liste-trans-input'))) {
        actif.blur();
    }
    await attendreProchaineFrame();
    await Promise.allSettled(Array.from(sauvegardesEnCours));
};

/**
 * Point d'entrée unique : remplit `div` avec les éléments d'ouverture
 * de l'élément précis identifié par `examen` + `type`. Voir le
 * commentaire d'en-tête de ZoneAffichageInstance ci-dessus pour le
 * détail du fonctionnement par examen.
 */
export const remplirZoneOuverture = (
    div: HTMLDivElement,
    examen: Examen,
    type: TypeEpreuve
): ZoneAffichageInstance => {
    // TCF CE n'a encore aucune source de données (message provisoire).
    // TCF CO, lui, a de vraies données (voir donnee_tcf_co.ts, branché
    // sur les canaux 'conserveur:*' côté main.ts) et utilise donc,
    // comme TEF et TCF EE/EO, la construction commune (nav + blocs
    // extrait/transformé) — affichage carrément identique au TEF.
    if (examen === 'tcf' && type === 'ce') {
        return construireZoneOuvertureTcf(div, type);
    }
    return construireZoneOuvertureCommune(div, examen, type);
};

// TCF CE : rien n'est encore implémenté (pas de source de données ni
// de définition de zones pour le moment). On vide simplement la div et
// on retourne une instance dont afficherDonnees ne fait rien pour
// l'instant. (TCF CO, lui, est maintenant branché sur la construction
// commune ci-dessous — voir remplirZoneOuverture.)
const construireZoneOuvertureTcf = (
    div: HTMLDivElement,
    _type: TypeEpreuve
): ZoneAffichageInstance => {
    div.innerHTML = '';
    const messageVide = document.createElement('div');
    messageVide.className = 'nm-page-reste-message';
    messageVide.textContent = 'Rien à afficher pour le moment.';
    div.appendChild(messageVide);
    return {
        afficherDonnees: async () => {
            // Rien à afficher pour le moment côté TCF.
        },
    };
};

/**
 * Construit une instance indépendante de zone d'affichage (nav +
 * contenu + toutes les zones d'édition extrait/transformé), commune à
 * TEF et à TCF EE/EO (mêmes fichiers, même dossier "conserveur"), puis
 * la remplit directement dans `div`. À appeler une fois par page
 * CE/CO/EE/EO (voir zoneAccueilTef.ts) : chaque page garde SA propre
 * instance, avec son propre état, jamais partagée ni déplacée avec les
 * autres pages.
 */
const construireZoneOuvertureCommune = (
    div: HTMLDivElement,
    examen: Examen,
    type: TypeEpreuve
): ZoneAffichageInstance => {
    let racineAffichage: HTMLDivElement;
    let enteteEmbed: HTMLDivElement;
    let enteteTitre: HTMLSpanElement;
    let zoneExportStatut: HTMLSpanElement;
    let boutonExport: HTMLButtonElement;
    /** Champ éditable pour le ss manuel (nom de série envoyé à l'export). */
    let inputSs: HTMLInputElement;
    let indicateurSs: HTMLSpanElement;

    // --- Éléments de layout, créés une seule fois à la construction ---
    let zoneNavListe: HTMLDivElement;
    let btnPrecedent: HTMLButtonElement;
    let btnSuivant: HTMLButtonElement;
    let indicateurPosition: HTMLDivElement;
    let zoneContenu: HTMLDivElement;

    // --- État courant, propre à cette instance ---
    let donneesCourantes: ElementDonnee[] = [];
    let examenCourant: Examen = examen;
    let typeCourant: TypeEpreuve = type;
    let idCourant: string | null = null;
    let indexCourant = 0;
    let boutonsNav: HTMLButtonElement[] = [];
    /** Dernière valeur ss connue (évite les sauvegardes inutiles). */
    let ssCourant = '';

const estVide = (valeur: any): boolean => {
    return valeur === undefined || valeur === null || (typeof valeur === 'string' && valeur.trim() === '');
};

const ressembleAHtml = (texte: string): boolean => /<[a-z][\s\S]*>/i.test(texte);

// Convertit un texte pouvant contenir du HTML en texte brut (utilisé
// pour préremplir un textarea à partir d'une consigne HTML).
const stripHtml = (html: string): string => {
    const support = document.createElement('div');
    support.innerHTML = html;
    return support.textContent ?? '';
};

let compteurId = 0;
const genererId = (): string => `zed_${Date.now().toString(36)}_${++compteurId}`;

const ALPHABET_MAJUSCULES = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

// Mélange (Fisher-Yates) sans modifier le tableau d'origine.
const melanger = <T,>(valeurs: T[]): T[] => {
    const copie = [...valeurs];
    for (let i = copie.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copie[i], copie[j]] = [copie[j], copie[i]];
    }
    return copie;
};

// Tire, pour n propositions, n lettres uniques prises uniquement dans
// la plage A -> (A + n - 1) (ex: 4 propositions => lettres parmi
// A, B, C, D uniquement), puis les mélange au hasard entre elles.
// Au-delà de 26 propositions (cas limite), on boucle sur l'alphabet.
const genererLettresPourNombre = (n: number): string[] => {
    const plage: string[] = [];
    for (let i = 0; i < n; i++) {
        plage.push(ALPHABET_MAJUSCULES[i % ALPHABET_MAJUSCULES.length]);
    }
    return melanger(plage);
};

//nous verifion les texte dans les item ne sont pas juste des iteration d'un truc bien precis 
const verifieIterationItem = (items: EtatZoneListeItem[]): Boolean => {
    const texteItem1 = items[0].texte.trim();
    const nb = texteItem1.length;
    const racine = texteItem1.substring(0, nb - 3).toUpperCase();// on rajute un paut car il peut avoir derier le nombre ou la lettre un point
    for(let index = 1; index < items.length; index ++){
        const texte = items[index].texte.trim().toUpperCase();
        if(!texte.includes(racine) || texte.length > nb + 1){
            return false;
        }
    }
    return true;
}


// Réattribue à chaque proposition une lettre unique respectant la
// plage A..(A + nombre de propositions - 1). À appeler à chaque fois
// que la liste change de taille (ajout / suppression), pour que la
// contrainte reste vraie après coup.
const reassignerLettres = (items: EtatZoneListeItem[]): void => {
    const racineReponce = "Réponse ".toUpperCase();
    const nbLettreRacine = racineReponce.length;
    const textProp1 = items[0].texte;

    //si le texte de l'items commence par reponse alors  alors on ne fait pas l'aleatoire 
    if (textProp1.toUpperCase().includes(racineReponce) && (textProp1.length <= nbLettreRacine + 1)) {
        items.forEach((item, i) => {
            item.lettre = item.texte.substring(nbLettreRacine, nbLettreRacine + 1).toUpperCase();
            item.texte = `Proposition ${item.lettre}`;
        })
    }
    else if(verifieIterationItem(items)){
        items.sort((a, b) => a.texte.localeCompare(b.texte));
        const lettres = ALPHABET_MAJUSCULES;
        items.forEach((item, i) => { item.lettre = lettres[i]; });
    }
    else {
        const lettres = genererLettresPourNombre(items.length);
        items.forEach((item, i) => { item.lettre = lettres[i]; });
    }
};

// Construit la liste des propositions transformées, chacune recevant
// une lettre unique tirée au hasard parmi A..(A + nombre - 1).
const construireItemsAvecLettresAleatoires = (items: ProportionListe[]): EtatZoneListeItem[] => {
    console.log(items);
    const valeurs = items.map((it, i) => ({ id: genererId(), texte: it.texte, correcte: it.correcte, lettre: "" }));
    reassignerLettres(valeurs);
    return valeurs;
};

// Construit les badges (niveau, points, durée, mots...) affichés dans
// l'entête de la zone de contenu. Volontairement discret : pour ee/eo
// en particulier, ces informations ne sont pas montrées comme des
// zones à part entière mais uniquement sous cette forme symbolique.
const construireBadges = (item: ElementDonnee, type: TypeEpreuve): HTMLDivElement | null => {
    const valeurs: { label: string; valeur: string }[] = [];
    if (!estVide(item.niveau)) valeurs.push({ label: 'Niveau', valeur: String(item.niveau) });
    // Pour CO, les points sont désormais leur propre zone extrait/transformé
    // (voir zonesCO), donc plus affichés en badge ici.
    if (type !== 'co' && !estVide(item.points)) valeurs.push({ label: 'Points', valeur: String(item.points) });
    if (!estVide(item.dureeExerciceSec)) valeurs.push({ label: 'Durée (s)', valeur: String(item.dureeExerciceSec) });
    if (!estVide(item.dureeSec)) valeurs.push({ label: 'Durée (s)', valeur: String(item.dureeSec) });
    if (!estVide(item.minMots) || !estVide(item.maxMots)) {
        const min = estVide(item.minMots) ? '?' : item.minMots;
        const max = estVide(item.maxMots) ? '?' : item.maxMots;
        valeurs.push({ label: 'Mots', valeur: `${min} - ${max}` });
    }
    if (valeurs.length === 0) return null;

    const zone = document.createElement('div');
    zone.className = 'affichage-badges';
    for (const { label, valeur } of valeurs) {
        const badge = document.createElement('span');
        badge.className = 'affichage-badge';
        badge.innerHTML = `<span class="affichage-badge-label">${label}</span><span class="affichage-badge-valeur"></span>`;
        (badge.lastElementChild as HTMLElement).textContent = valeur;
        zone.appendChild(badge);
    }
    return zone;
};

// ============================================================
// Modèle "zones" : chaque type d'épreuve (ce/co/ee/eo) définit
// une liste de zones. Chaque zone a un côté "extrait" (fixe, lu
// depuis les données extraites) et un côté "transformé"
// (éditable), reliés par un bouton de copie.
// ============================================================

type NatureContenu = 'image' | 'audio' | 'texte' | 'liste' | 'nombre';

interface ProportionListe {
    texte: string;
    correcte: boolean;
}

type ValeurExtrait =
    | { nature: 'image'; url: string }
    | { nature: 'audio'; url: string }
    | { nature: 'texte'; texte: string; html: boolean }
    | { nature: 'liste'; items: ProportionListe[] }
    | { nature: 'nombre'; valeur: number }
    | null;

interface ZoneDef {
    id: string;
    titre: string;
    natureTrans: NatureContenu;
    lireExtrait: (item: ElementDonnee) => ValeurExtrait;
}

interface EtatZoneImage { nature: 'image'; url: string | null; }
interface EtatZoneAudio { nature: 'audio'; url: string | null; }
interface EtatZoneTexte { nature: 'texte'; valeur: string; }
interface EtatZoneListeItem { id: string; texte: string; correcte: boolean; lettre: string; }
interface EtatZoneListe { nature: 'liste'; items: EtatZoneListeItem[]; }
interface EtatZoneNombre { nature: 'nombre'; valeur: number; }
type EtatZone = EtatZoneImage | EtatZoneAudio | EtatZoneTexte | EtatZoneListe | EtatZoneNombre;

// État des transformations en cours, conservé par index d'élément
// tant que la liste courante (ce/co/ee/eo d'une série) reste ouverte.
// Remis à zéro à chaque nouvel appel à afficherDonnees().
let transformationsParIndex: Map<number, Map<string, EtatZone>> = new Map();

// Construit l'état initial d'une zone transformée : toujours vide.
// Plus aucun remplissage automatique depuis l'extrait — l'utilisateur
// doit remplir la zone lui-même (ou utiliser le bouton ▶ pour copier
// manuellement l'extrait quand les natures correspondent).
const etatInitial = (nature: NatureContenu): EtatZone => {
    switch (nature) {
        case 'image': return { nature: 'image', url: null };
        case 'audio': return { nature: 'audio', url: null };
        case 'texte': return { nature: 'texte', valeur: '' };
        case 'liste': return { nature: 'liste', items: [] };
        case 'nombre': return { nature: 'nombre', valeur: 0 };
    }
};

const obtenirEtatZone = (index: number, zoneId: string, nature: NatureContenu): EtatZone => {
    let parIndex = transformationsParIndex.get(index);
    if (!parIndex) {
        parIndex = new Map();
        transformationsParIndex.set(index, parIndex);
    }
    let etat = parIndex.get(zoneId);
    if (!etat) {
        etat = etatInitial(nature);
        parIndex.set(zoneId, etat);
    }
    return etat;
};

// Révoque les URL "blob:" créées via URL.createObjectURL avant de
// vider l'état des transformations (évite les fuites mémoire).
const nettoyerTransformations = (): void => {
    for (const parIndex of transformationsParIndex.values()) {
        for (const etat of parIndex.values()) {
            if ((etat.nature === 'image' || etat.nature === 'audio') && etat.url?.startsWith('blob:')) {
                URL.revokeObjectURL(etat.url);
            }
        }
    }
    transformationsParIndex = new Map();
};

// ============================================================
// Persistance des transformations : chaque modification d'une zone
// "transformée" (image/audio déposé-importé-composé, texte qui perd
// le focus, liste de propositions modifiée) est enregistrée
// immédiatement dans le json transformé correspondant (trans_ce.json,
// trans_co.json, trans_ee.json ou trans_eo.json), via l'IPC déjà
// exposée par main.ts (sauvegarderTransform). Rien n'attend la
// fermeture de l'application : à la réouverture, initialiserEtatDepuisTransforme()
// relit ce même fichier pour repartir de l'état enregistré.
// ============================================================

type StatutEnregistrement = 'enregistrement' | 'ok' | 'erreur';

// Petit indicateur textuel discret, affiché à côté du libellé
// "Transformé" d'une zone, pour donner un retour visuel que l'image
// ou le texte a bien été enregistré (ou qu'une erreur est survenue).
const creerIndicateurStatut = (): {
    element: HTMLSpanElement;
    definirStatut: (statut: StatutEnregistrement | null) => void;
} => {
    const element = document.createElement('span');
    element.className = 'zed-statut-save';
    let minuteur: ReturnType<typeof setTimeout> | null = null;

    const definirStatut = (statut: StatutEnregistrement | null): void => {
        if (minuteur) { clearTimeout(minuteur); minuteur = null; }
        element.className = 'zed-statut-save';
        if (!statut) { element.textContent = ''; return; }
        element.classList.add(`zed-statut-save--${statut}`);
        element.textContent = statut === 'enregistrement'
            ? 'Enregistrement...'
            : statut === 'ok'
                ? 'Enregistré ✓'
                : "Échec de l'enregistrement";
        if (statut === 'ok') {
            minuteur = setTimeout(() => {
                element.className = 'zed-statut-save';
                element.textContent = '';
            }, 2200);
        }
    };

    return { element, definirStatut };
};

// Lit un Blob/File en base64 (sans le préfixe "data:...;base64,") et
// détermine son extension (à partir du nom de fichier si fourni, sinon
// de son type MIME) — format attendu par sauvegarderTransform.
const extensionDepuisFichier = (type: string, nomFichier?: string): string => {
    if (nomFichier) {
        const correspondance = /\.([a-zA-Z0-9]+)$/.exec(nomFichier);
        if (correspondance) return correspondance[1].toLowerCase();
    }
    const partie = type.split('/')[1];
    return partie ? partie.toLowerCase() : 'bin';
};

const fichierEnBase64 = (fichier: Blob, nomFichier?: string): Promise<{ donneeBase64: string; extension: string }> => {
    return new Promise((resolve, reject) => {
        const lecteur = new FileReader();
        lecteur.onload = () => {
            const resultat = String(lecteur.result ?? '');
            const virgule = resultat.indexOf(',');
            resolve({
                donneeBase64: virgule >= 0 ? resultat.slice(virgule + 1) : resultat,
                extension: extensionDepuisFichier(fichier.type, nomFichier),
            });
        };
        lecteur.onerror = () => reject(lecteur.error ?? new Error('Lecture du fichier impossible.'));
        lecteur.readAsDataURL(fichier);
    });
};

// Déduit "A" ou "B" à partir d'un champ "section" du type "section A"
// (identique à la logique côté main.ts, utilisée pour générer/lire les
// données transformées EE/EO, qui sont indexées par lettre et non par
// index de tableau).
const extraireLettreSection = (section: any): 'A' | 'B' | '' => {
    if (typeof section !== 'string') return '';
    const correspondance = section.trim().match(/([ab])\s*$/i);
    return correspondance ? (correspondance[1].toUpperCase() as 'A' | 'B') : '';
};

// Enregistre effectivement des champs (partiels) pour la zone d'un
// élément donné, via l'IPC de sauvegarde déjà exposée par main.ts.
// - ce/co : l'élément est repéré par son index (tableau) ;
// - ee/eo : l'élément est repéré par sa lettre de section (A/B).
const enregistrerZone = async (
    index: number,
    itemDonnee: ElementDonnee,
    champs: any,
    definirStatut: (statut: StatutEnregistrement | null) => void
): Promise<void> => {
    if (!idCourant) return;
    definirStatut('enregistrement');
    try {
        let donneesEnvoi: any;
        if (typeCourant === 'ce' || typeCourant === 'co') {
            donneesEnvoi = [{ index, ...champs }];
        } else {
            const lettre = extraireLettreSection(itemDonnee.section);
            if (!lettre) { definirStatut('erreur'); return; }
            donneesEnvoi = { [lettre]: champs };
        }
        const resultat = await sauvegarderTransformConserveur(examenCourant, typeCourant, idCourant, donneesEnvoi);
        definirStatut(resultat.success ? 'ok' : 'erreur');
        // Remet à jour le badge "exportable" de la carte dans l'accueil
        // (et donc dans la zone d'action groupée) dès CETTE sauvegarde,
        // sans attendre que l'utilisateur change de carte/ferme la zone
        // d'affichage (voir rafraichirCarteTefApresAffichage,
        // zoneAccueilTef.ts) — relit le transformé fraîchement écrit sur
        // disque pour rester cohérent avec sauvegarderTransformConserveur.
        if (resultat.success) {
            void rafraichirCarteTefApresAffichage(examenCourant, idCourant, typeCourant);
        }
    } catch {
        definirStatut('erreur');
    }
};

// Correspondance zone -> champ du json transformé pour les zones IMAGE
// et AUDIO. Retourne null lorsqu'aucun champ du schéma persistant ne
// correspond à cette zone (ex : un éventuel support audio en EO, dont
// le schéma transformé ne prévoit pas de champ) — dans ce cas la
// modification reste seulement en mémoire, comme avant.
const construireChampsMedia = (zoneId: string, valeur: ValeurMediaEnvoi): any | null => {
    if (typeCourant === 'ce' && zoneId === 'support') return { image: valeur };
    if (typeCourant === 'co' && zoneId === 'image') return { image: valeur };
    if (typeCourant === 'co' && zoneId === 'audio') return { audio: valeur };
    if (typeCourant === 'eo' && zoneId === 'support_image') return { image: valeur };
    return null;
};

// Correspondance zone -> champ du json transformé pour les zones TEXTE.
const construireChampsTexte = (zoneId: string, texte: string): any | null => {
    if ((typeCourant === 'ce' || typeCourant === 'co') && zoneId === 'question') return { consigne: texte };
    if ((typeCourant === 'ee' || typeCourant === 'eo') && zoneId === 'sujet') return { consigne: texte };
    if (typeCourant === 'eo' && zoneId === 'description') return { description: texte };
    return null;
};

// Correspondance zone -> champ du json transformé pour la zone NOMBRE
// (seule zone concernée pour l'instant : "points" en CO).
const construireChampsNombre = (zoneId: string, valeur: number): any | null => {
    if (typeCourant === 'co' && zoneId === 'points') return { points: valeur };
    return null;
};

// Construit les champs "propositions" + "bonneReponse" (seule zone de
// nature "liste" existante : CE/CO "propositions") à partir de l'état
// courant des items.
const construireChampsListe = (items: EtatZoneListeItem[]): any => {
    const propositions: PropositionsCE = { A: '', B: '', C: '', D: '' };
    let bonneReponse: 'A' | 'B' | 'C' | 'D' | '' = '';
    for (const it of items) {
        if (it.lettre === 'A' || it.lettre === 'B' || it.lettre === 'C' || it.lettre === 'D') {
            propositions[it.lettre] = it.texte;
            if (it.correcte) bonneReponse = it.lettre;
        }
    }
    return { propositions, bonneReponse };
};

// Convertit une source (File déposé/importé, Blob composé via le
// popup, ou URL déjà résolue provenant d'une copie depuis l'extrait)
// en base64 puis l'enregistre pour la zone concernée. Ne fait rien si
// cette zone n'a pas de champ correspondant dans le schéma persistant
// (voir construireChampsMedia).
const enregistrerMediaDepuisSource = (
    source: File | Blob | string,
    nomFichier: string | undefined,
    zoneId: string,
    index: number,
    itemDonnee: ElementDonnee,
    definirStatut: (statut: StatutEnregistrement | null) => void
): void => {
    if (!construireChampsMedia(zoneId, '')) return;
    void suivreSauvegarde((async () => {
        definirStatut('enregistrement');
        try {
            const blob = typeof source === 'string' ? await (await fetch(source)).blob() : source;
            const { donneeBase64, extension } = await fichierEnBase64(blob, nomFichier);
            const champs = construireChampsMedia(zoneId, { donneeBase64, extension });
            await enregistrerZone(index, itemDonnee, champs, definirStatut);
        } catch {
            definirStatut('erreur');
        }
    })());
};

// Reconstruit l'état initial des zones "transformées" à partir des
// données déjà enregistrées sur disque (json trans_{type}.json, toujours
// déjà généré au lancement de l'application — voir genererTransformationsManquantes
// dans main.ts). Appelée à chaque ouverture d'une série/type, avant le
// premier rendu, pour que les zones affichent directement ce qui a été
// enregistré précédemment plutôt que de repartir vides.
const initialiserEtatDepuisTransforme = (
    type: TypeEpreuve,
    donnees: ElementDonnee[],
    transforme: any
): void => {
    if (!transforme) return;

    const obtenirParIndex = (index: number): Map<string, EtatZone> => {
        let parIndex = transformationsParIndex.get(index);
        if (!parIndex) {
            parIndex = new Map();
            transformationsParIndex.set(index, parIndex);
        }
        return parIndex;
    };

    if (type === 'ce' || type === 'co') {
        const zones = type === 'ce' ? zonesCE() : zonesCO();
        for (const itemTrans of (transforme as any[])) {
            if (typeof itemTrans?.index !== 'number') continue;
            const parIndex = obtenirParIndex(itemTrans.index);
            for (const zoneDef of zones) {
                if (zoneDef.natureTrans === 'image') {
                    parIndex.set(zoneDef.id, { nature: 'image', url: itemTrans._localImage || null });
                } else if (zoneDef.natureTrans === 'audio') {
                    parIndex.set(zoneDef.id, { nature: 'audio', url: itemTrans._localAudio || null });
                } else if (zoneDef.natureTrans === 'texte') {
                    parIndex.set(zoneDef.id, { nature: 'texte', valeur: itemTrans.consigne ?? '' });
                } else if (zoneDef.natureTrans === 'nombre') {
                    parIndex.set(zoneDef.id, { nature: 'nombre', valeur: Number(itemTrans.points ?? 0) });
                } else if (zoneDef.natureTrans === 'liste') {
                    const props = itemTrans.propositions ?? {};
                    let items: EtatZoneListeItem[] = (['A', 'B', 'C', 'D'] as const)
                        .filter((lettre) => props[lettre] !== undefined)
                        .map((lettre) => ({
                            id: genererId(),
                            texte: props[lettre] ?? '',
                            correcte: itemTrans.bonneReponse === lettre,
                            lettre,
                        }));
                    // Transformé sans propositions (extrait vide) :
                    // remplir A→D dans l'ordre pour activer l'export.
                    const toutesVides = items.length === 0
                        || items.every((it) => !it.texte || it.texte.trim() === '');
                    if (toutesVides) {
                        items = (['A', 'B', 'C', 'D'] as const).map((lettre) => ({
                            id: genererId(),
                            texte: `Proposition ${lettre}`,
                            correcte: false,
                            lettre,
                        }));
                    }
                    parIndex.set(zoneDef.id, { nature: 'liste', items });
                }
            }
        }
        return;
    }

    // ee / eo : les données transformées sont indexées par lettre de
    // section (A/B), à répercuter sur chaque élément extrait dont le
    // champ "section" correspond à cette lettre.
    donnees.forEach((itemDonnee, index) => {
        const lettre = extraireLettreSection(itemDonnee.section);
        if (!lettre) return;
        const donneesLettre = (transforme as any)[lettre];
        if (!donneesLettre) return;

        const parIndex = obtenirParIndex(index);
        parIndex.set('sujet', { nature: 'texte', valeur: donneesLettre.consigne ?? '' });
        // Support image/audio : présents pour EE comme pour EO dès que
        // l'extrait en propose un (voir zonesEeEo plus haut) — ils
        // doivent donc être restaurés dans les deux cas, pas seulement
        // pour EO, sans quoi une carte déjà complète au sens du disque
        // réapparaîtrait comme "à corriger" une fois rouverte (zone
        // support vide malgré une valeur déjà enregistrée).
        parIndex.set('support_image', { nature: 'image', url: donneesLettre._localImage || null });
        parIndex.set('support_audio', { nature: 'audio', url: donneesLettre._localAudio || null });
        if (type === 'eo') {
            parIndex.set('description', { nature: 'texte', valeur: donneesLettre.description ?? '' });
        }
    });
};

// Extrait un ensemble de propositions (réponse correcte + distracteurs)
// à partir des champs bruts. Commun à CE et CO.
const lireExtraitPropositions = (item: ElementDonnee): ValeurExtrait => {
    const items: ProportionListe[] = [];
    if (!estVide(item.reponseCorrecte)) {
        items.push({ texte: String(item.reponseCorrecte), correcte: true });
    }
    if (!estVide(item.distracteurs)) {
        String(item.distracteurs)
            .split('|')
            .map((d) => d.trim())
            .filter((d) => d.length > 0)
            .forEach((d) => items.push({ texte: d, correcte: false }));
    }
    return items.length > 0 ? { nature: 'liste', items } : null;
};

const lireExtraitTexte = (valeur: any): ValeurExtrait => {
    if (estVide(valeur)) return null;
    const texte = String(valeur);
    return { nature: 'texte', texte, html: ressembleAHtml(texte) };
};

// --- Définition des zones pour la Compréhension Écrite (CE) ---
// zone1: support (extrait image OU texte / transformé : image uniquement)
// zone2: question (texte)
// zone3: propositions de réponse (ensemble de texte)
const zonesCE = (): ZoneDef[] => [
    {
        id: 'support',
        titre: 'Support (image ou texte)',
        natureTrans: 'image',
        lireExtrait: (item) => {
            if (!estVide(item._localImagePath)) return { nature: 'image', url: item._localImagePath as string };
            return lireExtraitTexte(item.texteLecture);
        },
    },
    {
        id: 'question',
        titre: 'Question',
        natureTrans: 'texte',
        lireExtrait: (item) => lireExtraitTexte(item.consigne),
    },
    {
        id: 'propositions',
        titre: 'Propositions de réponse',
        natureTrans: 'liste',
        lireExtrait: lireExtraitPropositions,
    },
];

// --- Définition des zones pour la Compréhension Orale (CO) ---
// zone1: image (extrait image / transformé image)
// zone2: audio (les deux côtés)
// zone3: question (texte)
// zone4: propositions de réponse (ensemble de texte)
const zonesCO = (): ZoneDef[] => [
    {
        id: 'points',
        titre: 'Points',
        natureTrans: 'nombre',
        lireExtrait: (item) => (estVide(item.points) ? null : { nature: 'nombre', valeur: Number(item.points) }),
    },
    {
        id: 'image',
        titre: 'Image',
        natureTrans: 'image',
        lireExtrait: (item) => (!estVide(item._localImagePath) ? { nature: 'image', url: item._localImagePath as string } : null),
    },
    {
        id: 'audio',
        titre: 'Audio',
        natureTrans: 'audio',
        lireExtrait: (item) => (!estVide(item._localAudioPath) ? { nature: 'audio', url: item._localAudioPath as string } : null),
    },
    {
        id: 'question',
        titre: 'Question',
        natureTrans: 'texte',
        lireExtrait: (item) => lireExtraitTexte(item.consigne),
    },
    {
        id: 'propositions',
        titre: 'Propositions de réponse',
        natureTrans: 'liste',
        lireExtrait: lireExtraitPropositions,
    },
];

// --- Définition des zones pour Expression Écrite (EE) / Expression
// Orale (EO) : structure plus libre. Le sujet/la consigne est
// toujours présent ; un support (image ou audio) n'est ajouté que
// s'il existe réellement dans les données extraites. Niveau / points
// / durée / mots restent uniquement sous forme de badges (voir
// construireBadges), jamais comme zone à part entière.
//
// Cas particulier EO : la zone "description" (de l'image) n'existe
// que côté transformé (voir SectionTransformEO dans donneeApi.ts) —
// il n'y a jamais de valeur extraite correspondante. Elle est donc
// toujours affichée pour EO (indépendamment de la présence d'une
// image extraite), avec lireExtrait qui retourne systématiquement
// null : le côté "Extrait" affiche alors "Aucun contenu extrait."
// et le bouton ▶ de copie reste désactivé (rien à copier), seule la
// partie "Transformé" est saisissable.
const zonesEeEo = (item: ElementDonnee, type: TypeEpreuve): ZoneDef[] => {
    const zones: ZoneDef[] = [
        {
            id: 'sujet',
            titre: 'Sujet / Consigne',
            natureTrans: 'texte',
            lireExtrait: (it) => lireExtraitTexte(!estVide(it.consigne) ? it.consigne : it.texteLecture),
        },
    ];

    if (!estVide(item._localImagePath)) {
        zones.push({
            id: 'support_image',
            titre: 'Support (image)',
            natureTrans: 'image',
            lireExtrait: (it) => (!estVide(it._localImagePath) ? { nature: 'image', url: it._localImagePath as string } : null),
        });
    }

    if (type === 'eo') {
        zones.push({
            id: 'description',
            titre: "Description de l'image",
            natureTrans: 'texte',
            lireExtrait: () => null,
        });
    }

    if (!estVide(item._localAudioPath)) {
        zones.push({
            id: 'support_audio',
            titre: 'Support (audio)',
            natureTrans: 'audio',
            lireExtrait: (it) => (!estVide(it._localAudioPath) ? { nature: 'audio', url: it._localAudioPath as string } : null),
        });
    }

    return zones;
};

const definirZones = (type: TypeEpreuve, item: ElementDonnee): ZoneDef[] => {
    if (type === 'ce') return zonesCE();
    if (type === 'co') return zonesCO();
    return zonesEeEo(item, type);
};

// --- Rendu du côté "extrait" (fixe) ---

const construireExtraitContenu = (valeur: ValeurExtrait): HTMLDivElement => {
    const conteneur = document.createElement('div');
    conteneur.className = 'zed-extrait-contenu';

    if (!valeur) {
        conteneur.classList.add('zed-vide');
        conteneur.textContent = 'Aucun contenu extrait.';
        return conteneur;
    }

    if (valeur.nature === 'image') {
        const img = document.createElement('img');
        img.className = 'zed-image';
        img.src = valeur.url;
        img.alt = 'Image extraite';
        conteneur.appendChild(img);
    } else if (valeur.nature === 'audio') {
        const audio = document.createElement('audio');
        audio.className = 'zed-audio';
        audio.controls = true;
        audio.src = valeur.url;
        conteneur.appendChild(audio);
    } else if (valeur.nature === 'texte') {
        const bloc = document.createElement('div');
        bloc.className = 'zed-texte';
        if (valeur.html) {
            bloc.innerHTML = valeur.texte;
        } else {
            bloc.textContent = valeur.texte;
        }
        conteneur.appendChild(bloc);
    } else if (valeur.nature === 'liste') {
        const liste = document.createElement('div');
        liste.className = 'zed-liste-extrait';
        for (const it of valeur.items) {
            const ligne = document.createElement('div');
            ligne.className = 'zed-liste-extrait-item' + (it.correcte ? ' zed-liste-extrait-item--correcte' : '');
            ligne.innerHTML = `<span class="iconMateriel">${it.correcte ? 'check_circle' : 'cancel'}</span><span></span>`;
            (ligne.lastElementChild as HTMLElement).textContent = it.texte;
            liste.appendChild(ligne);
        }
        conteneur.appendChild(liste);
    } else if (valeur.nature === 'nombre') {
        const bloc = document.createElement('div');
        bloc.className = 'zed-texte';
        bloc.textContent = String(valeur.valeur);
        conteneur.appendChild(bloc);
    }

    return conteneur;
};

// --- Rendu du côté "transformé" (éditable) ---

// Image ou audio : zone de drag & drop + import par fichier. La
// modification (nouveau fichier ou suppression) reste uniquement en
// mémoire, le temps de la session — rien n'est enregistré sur disque.
const construireTransMedia = (
    nature: 'image' | 'audio',
    etat: EtatZoneImage | EtatZoneAudio,
    index: number,
    zoneId: string,
    itemDonnee: ElementDonnee,
    definirStatut: (statut: StatutEnregistrement | null) => void
): HTMLDivElement => {
    const zone = document.createElement('div');
    zone.className = 'zed-dropzone';

    const inputFichier = document.createElement('input');
    inputFichier.type = 'file';
    inputFichier.accept = nature === 'image' ? 'image/*' : 'audio/*';
    inputFichier.className = 'zed-dropzone-input-cache';

    const rafraichir = (): void => {
        zone.innerHTML = '';
        zone.appendChild(inputFichier);

        if (etat.url) {
            zone.classList.add('zed-dropzone--rempli');

            if (nature === 'image') {
                const img = document.createElement('img');
                img.className = 'zed-image';
                img.src = etat.url;
                img.alt = 'Image transformée';
                zone.appendChild(img);
            } else {
                const audio = document.createElement('audio');
                audio.className = 'zed-audio';
                audio.controls = true;
                audio.src = etat.url;
                zone.appendChild(audio);
            }

            const actions = document.createElement('div');
            actions.className = 'zed-dropzone-actions';

            const btnRemplacer = document.createElement('button');
            btnRemplacer.type = 'button';
            btnRemplacer.className = 'zed-dropzone-btn';
            btnRemplacer.textContent = 'Remplacer';
            btnRemplacer.addEventListener('click', () => inputFichier.click());

            const btnSupprimer = document.createElement('button');
            btnSupprimer.type = 'button';
            btnSupprimer.className = 'zed-dropzone-btn zed-dropzone-btn--danger';
            btnSupprimer.textContent = 'Retirer';
            btnSupprimer.addEventListener('click', () => {
                if (etat.url?.startsWith('blob:')) URL.revokeObjectURL(etat.url);
                etat.url = null;
                rafraichir();
                rafraichirIndicateursExport();
                const champs = construireChampsMedia(zoneId, { vide: true });
                if (champs) void suivreSauvegarde(enregistrerZone(index, itemDonnee, champs, definirStatut));
            });

            actions.appendChild(btnRemplacer);
            actions.appendChild(btnSupprimer);
            zone.appendChild(actions);
        } else {
            zone.classList.remove('zed-dropzone--rempli');
            const vide = document.createElement('div');
            vide.className = 'zed-dropzone-vide';
            vide.innerHTML = nature === 'image'
                ? 'Glissez une image ici<br><span class="zed-dropzone-lien">ou cliquez pour importer</span>'
                : 'Glissez un fichier audio ici<br><span class="zed-dropzone-lien">ou cliquez pour importer</span>';
            vide.addEventListener('click', () => inputFichier.click());
            zone.appendChild(vide);
        }
    };

    const definirFichier = (fichier: File | undefined | null): void => {
        if (!fichier) return;
        if (etat.url?.startsWith('blob:')) URL.revokeObjectURL(etat.url);
        etat.url = URL.createObjectURL(fichier);
        rafraichir();
        rafraichirIndicateursExport();
        enregistrerMediaDepuisSource(fichier, fichier.name, zoneId, index, itemDonnee, definirStatut);
    };

    inputFichier.addEventListener('change', () => definirFichier(inputFichier.files?.[0]));

    zone.addEventListener('dragover', (evenement) => {
        evenement.preventDefault();
        zone.classList.add('zed-dropzone--survol');
    });
    zone.addEventListener('dragleave', () => zone.classList.remove('zed-dropzone--survol'));
    zone.addEventListener('drop', (evenement) => {
        evenement.preventDefault();
        zone.classList.remove('zed-dropzone--survol');
        definirFichier(evenement.dataTransfer?.files?.[0]);
    });

    rafraichir();
    return zone;
};

// Texte : textarea libre. La hauteur s'adapte automatiquement au
// contenu (pas de barre de défilement interne ni de redimensionnement
// manuel) ; seule une hauteur minimale est imposée en CSS (min-height
// de .zed-textarea-trans). Ajustée à la création, à chaque frappe, et
// lors d'un remplissage programmatique (copie depuis l'extrait).
const construireTransTexte = (
    etat: EtatZoneTexte,
    index: number,
    zoneId: string,
    itemDonnee: ElementDonnee,
    definirStatut: (statut: StatutEnregistrement | null) => void
): HTMLTextAreaElement => {
    const zone = document.createElement('textarea');
    zone.className = 'zed-textarea-trans';
    zone.value = etat.valeur;
    zone.placeholder = 'Saisissez le texte transformé...';
    zone.rows = 1;

    const ajusterHauteur = (): void => {
        zone.style.height = 'auto';
        zone.style.height = `${zone.scrollHeight}px`;
    };

    zone.addEventListener('input', () => {
        etat.valeur = zone.value;
        ajusterHauteur();
        rafraichirIndicateursExport();
    });
    zone.addEventListener('blur', () => {
        const champs = construireChampsTexte(zoneId, etat.valeur);
        if (champs) void suivreSauvegarde(enregistrerZone(index, itemDonnee, champs, definirStatut));
    });

    // Le calcul de scrollHeight nécessite que l'élément soit déjà
    // inséré dans le document (mesure réelle) — programmé pour juste
    // après l'ajout au DOM par l'appelant (construireZone/rendreTrans).
    requestAnimationFrame(ajusterHauteur);

    return zone;
};

// Nombre (points) : simple champ numérique.
const construireTransNombre = (
    etat: EtatZoneNombre,
    index: number,
    zoneId: string,
    itemDonnee: ElementDonnee,
    definirStatut: (statut: StatutEnregistrement | null) => void
): HTMLInputElement => {
    const champ = document.createElement('input');
    champ.type = 'number';
    champ.className = 'zed-liste-trans-input';
    champ.min = '0';
    champ.value = String(etat.valeur ?? 0);

    champ.addEventListener('input', () => {
        const valeur = Number(champ.value);
        etat.valeur = Number.isFinite(valeur) ? valeur : 0;
        rafraichirIndicateursExport();
    });
    champ.addEventListener('blur', () => {
        const champs = construireChampsNombre(zoneId, etat.valeur);
        if (champs) void suivreSauvegarde(enregistrerZone(index, itemDonnee, champs, definirStatut));
    });

    return champ;
};

// Liste (propositions de réponse) : une ligne par proposition, avec
// bascule "réponse correcte", suppression et ajout libre.
const construireTransListe = (
    etat: EtatZoneListe,
    index: number,
    zoneId: string,
    itemDonnee: ElementDonnee,
    definirStatut: (statut: StatutEnregistrement | null) => void
): HTMLDivElement => {
    const conteneur = document.createElement('div');
    conteneur.className = 'zed-liste-trans';

    const enregistrerListe = (): void => {
        const champs = construireChampsListe(etat.items);
        void suivreSauvegarde(enregistrerZone(index, itemDonnee, champs, definirStatut));
    };

    const rafraichir = (): void => {
        conteneur.innerHTML = '';

        // Affichées triées par ordre alphabétique de la lettre générée
        // (l'ordre du tableau etat.items sous-jacent, lui, ne change pas).
        const itemsTries = [...etat.items].sort((a, b) => a.lettre.localeCompare(b.lettre));

        itemsTries.forEach((item) => {
            const ligne = document.createElement('div');
            ligne.className = 'zed-liste-trans-item';

            const btnCorrecte = document.createElement('button');
            btnCorrecte.type = 'button';
            btnCorrecte.className = 'zed-liste-trans-toggle' + (item.correcte ? ' zed-liste-trans-toggle--actif' : '');
            btnCorrecte.title = 'Marquer comme réponse correcte';
            btnCorrecte.innerHTML = `<span class="iconMateriel">${item.correcte ? 'check_circle' : 'cancel'}</span>`;
            btnCorrecte.addEventListener('click', () => {
                etat.items.forEach((autre) => { autre.correcte = false; });
                item.correcte = true;
                rafraichir();
                rafraichirIndicateursExport();
                enregistrerListe();
            });

            const badgeLettre = document.createElement('span');
            badgeLettre.className = 'zed-liste-trans-lettre';
            badgeLettre.textContent = item.lettre;
            badgeLettre.title = 'Lettre attribuée au hasard à cette proposition';

            const champ = document.createElement('input');
            champ.type = 'text';
            champ.className = 'zed-liste-trans-input';
            champ.value = item.texte;
            champ.placeholder = 'Proposition...';
            champ.addEventListener('input', () => {
                item.texte = champ.value;
                rafraichirIndicateursExport();
            });
            champ.addEventListener('blur', () => {
                enregistrerListe();
            });
            const btnSupprimer = document.createElement('button');
            btnSupprimer.type = 'button';
            btnSupprimer.className = 'zed-liste-trans-supprimer';
            btnSupprimer.title = 'Supprimer cette proposition';
            btnSupprimer.textContent = '×';
            btnSupprimer.addEventListener('click', () => {
                etat.items = etat.items.filter((autre) => autre.id !== item.id);
                reassignerLettres(etat.items);
                rafraichir();
                rafraichirIndicateursExport();
                enregistrerListe();
            });

            ligne.appendChild(btnCorrecte);
            ligne.appendChild(badgeLettre);
            ligne.appendChild(champ);
            ligne.appendChild(btnSupprimer);
            conteneur.appendChild(ligne);
        });

        const btnAjouter = document.createElement('button');
        btnAjouter.type = 'button';
        btnAjouter.className = 'zed-liste-trans-ajouter';
        btnAjouter.textContent = '+ Ajouter une proposition';
        btnAjouter.addEventListener('click', () => {
            etat.items.push({ id: genererId(), texte: '', correcte: false, lettre: '' });
            reassignerLettres(etat.items);
            rafraichir();
            rafraichirIndicateursExport();
            enregistrerListe();
        });
        conteneur.appendChild(btnAjouter);
    };

    rafraichir();
    return conteneur;
};

const construireTransContenu = (
    etat: EtatZone,
    index: number,
    zoneId: string,
    itemDonnee: ElementDonnee,
    definirStatut: (statut: StatutEnregistrement | null) => void
): HTMLElement => {
    switch (etat.nature) {
        case 'image': return construireTransMedia('image', etat, index, zoneId, itemDonnee, definirStatut);
        case 'audio': return construireTransMedia('audio', etat, index, zoneId, itemDonnee, definirStatut);
        case 'texte': return construireTransTexte(etat, index, zoneId, itemDonnee, definirStatut);
        case 'liste': return construireTransListe(etat, index, zoneId, itemDonnee, definirStatut);
        case 'nombre': return construireTransNombre(etat, index, zoneId, itemDonnee, definirStatut);
    }
};

// --- Assemblage d'une zone complète (titre + colonne extrait +
// bouton de copie + colonne transformée) ---

const construireZone = (zoneDef: ZoneDef, item: ElementDonnee, index: number): HTMLDivElement => {
    const valeurExtrait = zoneDef.lireExtrait(item);
    const etat = obtenirEtatZone(index, zoneDef.id, zoneDef.natureTrans);

    const carte = document.createElement('div');
    carte.className = 'zed-zone';

    const titre = document.createElement('h4');
    titre.className = 'zed-zone-titre';
    titre.textContent = zoneDef.titre;
    carte.appendChild(titre);

    const corps = document.createElement('div');
    corps.className = 'zed-zone-corps';

    // Colonne extrait (fixe)
    const colExtrait = document.createElement('div');
    colExtrait.className = 'zed-col zed-col-extrait';
    const labelExtrait = document.createElement('div');
    labelExtrait.className = 'zed-col-label';
    labelExtrait.textContent = 'Extrait';
    colExtrait.appendChild(labelExtrait);
    colExtrait.appendChild(construireExtraitContenu(valeurExtrait));

    // Bouton de copie (extrait -> transformé)
    const colBouton = document.createElement('div');
    colBouton.className = 'zed-col-bouton';
    const btnCopier = document.createElement('button');
    btnCopier.type = 'button';
    btnCopier.className = 'zed-copier-btn';
    btnCopier.textContent = '▶';

    const peutCopierDirect = valeurExtrait !== null && valeurExtrait.nature === zoneDef.natureTrans;
    // Cas particulier : la partie transformée attend une IMAGE, mais
    // l'extrait est du texte (ou vide) — il n'y a rien à copier
    // automatiquement (natures différentes), on propose donc à la place
    // de COMPOSER une image à partir d'un texte, via un popup dédié
    // (voir EditableImagePopup.ts).
    const peutOuvrirPopupImage = zoneDef.natureTrans === 'image'
        && (valeurExtrait === null || valeurExtrait.nature === 'texte');

    btnCopier.disabled = !peutCopierDirect && !peutOuvrirPopupImage;
    btnCopier.classList.toggle('zed-copier-btn--image', peutOuvrirPopupImage);
    btnCopier.innerHTML = peutOuvrirPopupImage ? '<span class="iconMateriel">image</span>' : '▶';
    btnCopier.title = peutCopierDirect
        ? "Copier l'extrait vers la partie transformée"
        : peutOuvrirPopupImage
            ? "Composer une image à partir du texte"
            : valeurExtrait === null
                ? "Cette zone n'a pas d'extrait correspondant — saisissez directement la partie transformée."
                : "Rien à copier automatiquement ici (nature différente) — modifiez la partie transformée manuellement.";

    // Colonne transformée (éditable)
    const colTrans = document.createElement('div');
    colTrans.className = 'zed-col zed-col-trans';
    const labelTrans = document.createElement('div');
    labelTrans.className = 'zed-col-label';
    labelTrans.textContent = 'Transformé';
    const { element: indicateurStatut, definirStatut } = creerIndicateurStatut();
    labelTrans.appendChild(indicateurStatut);
    colTrans.appendChild(labelTrans);

    const zoneTransContenu = document.createElement('div');
    zoneTransContenu.className = 'zed-col-trans-contenu';
    colTrans.appendChild(zoneTransContenu);

    const rendreTrans = (): void => {
        zoneTransContenu.innerHTML = '';
        zoneTransContenu.appendChild(construireTransContenu(etat, index, zoneDef.id, item, definirStatut));
    };
    rendreTrans();

    btnCopier.addEventListener('click', () => {
        if (peutOuvrirPopupImage && etat.nature === 'image') {
            const texteInitial = valeurExtrait && valeurExtrait.nature === 'texte'
                ? (valeurExtrait.html ? stripHtml(valeurExtrait.texte) : valeurExtrait.texte)
                : '';
            ouvrirPopupTransformationImage({
                texteInitial,
                onValider: (urlImage, blobImage) => {
                    if (etat.url?.startsWith('blob:')) URL.revokeObjectURL(etat.url);
                    etat.url = urlImage;
                    rendreTrans();
                    rafraichirIndicateursExport();
                    enregistrerMediaDepuisSource(blobImage, 'image.png', zoneDef.id, index, item, definirStatut);
                },
            });
            return;
        }
        if (!valeurExtrait) return;
        if (valeurExtrait.nature === 'image' && etat.nature === 'image') {
            etat.url = valeurExtrait.url;
        } else if (valeurExtrait.nature === 'audio' && etat.nature === 'audio') {
            etat.url = valeurExtrait.url;
        } else if (valeurExtrait.nature === 'texte' && etat.nature === 'texte') {
            etat.valeur = valeurExtrait.html ? stripHtml(valeurExtrait.texte) : valeurExtrait.texte;
        } else if (valeurExtrait.nature === 'liste' && etat.nature === 'liste') {
            etat.items = construireItemsAvecLettresAleatoires(valeurExtrait.items);
        } else if (valeurExtrait.nature === 'nombre' && etat.nature === 'nombre') {
            etat.valeur = valeurExtrait.valeur;
        }
        rendreTrans();
        rafraichirIndicateursExport();

        // La copie depuis l'extrait modifie directement la partie
        // transformée : elle est donc enregistrée immédiatement, au même
        // titre qu'un dépôt/import/composition ou une perte de focus.
        if (etat.nature === 'image' || etat.nature === 'audio') {
            if (etat.url) enregistrerMediaDepuisSource(etat.url, undefined, zoneDef.id, index, item, definirStatut);
        } else if (etat.nature === 'texte') {
            const champs = construireChampsTexte(zoneDef.id, etat.valeur);
            if (champs) void suivreSauvegarde(enregistrerZone(index, item, champs, definirStatut));
        } else if (etat.nature === 'liste') {
            const champs = construireChampsListe(etat.items);
            void suivreSauvegarde(enregistrerZone(index, item, champs, definirStatut));
        } else if (etat.nature === 'nombre') {
            const champs = construireChampsNombre(zoneDef.id, etat.valeur);
            if (champs) void suivreSauvegarde(enregistrerZone(index, item, champs, definirStatut));
        }
    });

    colBouton.appendChild(btnCopier);

    corps.appendChild(colExtrait);
    corps.appendChild(colBouton);
    corps.appendChild(colTrans);
    carte.appendChild(corps);

    return carte;
};

const construireZonesPourItem = (item: ElementDonnee, type: TypeEpreuve, index: number): HTMLDivElement => {
    const conteneur = document.createElement('div');
    conteneur.className = 'zed-conteneur';
    for (const zoneDef of definirZones(type, item)) {
        conteneur.appendChild(construireZone(zoneDef, item, index));
    }
    return conteneur;
};

// Construit le titre affiché en haut de la zone de contenu.
const construireTitre = (item: ElementDonnee, type: TypeEpreuve, index: number): string => {
    const numero = item.numeroQuestion ?? item.numero;
    const prefixe = (type === 'ee' || type === 'eo') ? 'Sujet' : 'Question';
    return numero !== undefined ? `${prefixe} ${numero}` : `${prefixe} ${index + 1}`;
};

// Recalcule, pour CHAQUE élément de la série actuellement ouverte, son
// état "prêt à l'exportation" (voir estQuestionExportable dans
// verificationExport.ts à partir de l'état courant des zones
// transformées), puis met à jour :
//  - le style distinctif du bouton numéroté de chaque question
//    (classe affichage-nav-btn--exportable) ;
//  - le message d'entête, à côté du bouton d'export : rien ne
//    s'affiche dès que TOUTES les questions sont prêtes, sinon un
//    message indique combien il en reste à corriger.
// À appeler à l'ouverture d'une série (afficherDonnees) ainsi qu'à
// chaque modification d'une zone transformée (texte, image, audio,
// liste, nombre, copie depuis l'extrait).
const rafraichirIndicateursExport = (): void => {
    if (!zoneExportStatut) return;

    let nombreNonPrets = 0;

    const zoneExport = `${examenCourant}-${typeCourant}` as ZoneExport;
    donneesCourantes.forEach((item, index) => {
        const zones = transformationsParIndex.get(index) ?? new Map();
        const pret = estQuestionExportable(zoneExport, item, zones);
        if (!pret) nombreNonPrets++;
        boutonsNav[index]?.classList.toggle('affichage-nav-btn--exportable', pret);
    });

    const toutExportable = donneesCourantes.length > 0 && nombreNonPrets === 0;
    if (boutonExport) afficherBoutonExportZone(boutonExport, toutExportable);

    if (donneesCourantes.length === 0 || nombreNonPrets === 0) {
        zoneExportStatut.textContent = '';
        zoneExportStatut.classList.remove('affichage-embed-export-statut--visible');
    } else {
        zoneExportStatut.textContent = nombreNonPrets === 1
            ? '1 question à corriger avant l’exportation'
            : `${nombreNonPrets} questions à corriger avant l’exportation`;
        zoneExportStatut.classList.add('affichage-embed-export-statut--visible');
    }
};

// Affiche dans la zone de contenu (à droite) l'élément à l'index donné,
// et met à jour l'état actif de la navigation (à gauche).
const selectionnerIndex = (index: number): void => {
    if (index < 0 || index >= donneesCourantes.length) return;
    indexCourant = index;

    // Mise à jour visuelle des boutons numérotés
    boutonsNav.forEach((btn, i) => {
        btn.classList.toggle('affichage-nav-btn--active', i === index);
    });
    boutonsNav[index]?.scrollIntoView({ block: 'nearest' });

    // Construction du contenu de droite
    const item = donneesCourantes[index];
    zoneContenu.innerHTML = '';

    const entete = document.createElement('div');
    entete.className = 'affichage-contenu-entete';
    const titre = document.createElement('h3');
    titre.className = 'affichage-contenu-titre';
    titre.textContent = construireTitre(item, typeCourant, index);
    entete.appendChild(titre);
    // Niveau / points / durée / mots : uniquement sous forme de badges
    // symboliques, jamais comme zone extrait/transformé à part entière.
    const badges = construireBadges(item, typeCourant);
    if (badges) entete.appendChild(badges);
    zoneContenu.appendChild(entete);

    zoneContenu.appendChild(construireZonesPourItem(item, typeCourant, index));

    // Indicateur "3 / 12" + état des boutons précédent/suivant
    indicateurPosition.textContent = `${index + 1} / ${donneesCourantes.length}`;
    btnPrecedent.disabled = index === 0;
    btnSuivant.disabled = index === donneesCourantes.length - 1;
};

    // --- Construction de l'instance (entête + navigation + contenu) ---
    racineAffichage = document.createElement('div');
    racineAffichage.className = 'affichage-embed';

    enteteEmbed = document.createElement('div');
    enteteEmbed.className = 'affichage-embed-entete';

    enteteTitre = document.createElement('span');
    enteteTitre.className = 'affichage-embed-entete-titre';
    enteteEmbed.appendChild(enteteTitre);

    // Champ "Nom du sujet (ss)" : saisie manuelle du libellé envoyé
    // comme ss à l'export. Vide = génération auto via decouperSerieEtTest.
    // Enregistré dans le JSON transformé dès la modification (blur / Enter),
    // comme les propositions.
    const zoneSs = document.createElement('div');
    zoneSs.className = 'affichage-embed-ss';

    const labelSs = document.createElement('label');
    labelSs.className = 'affichage-embed-ss-label';
    labelSs.textContent = 'Nom du sujet';
    zoneSs.appendChild(labelSs);

    inputSs = document.createElement('input');
    inputSs.type = 'text';
    inputSs.className = 'affichage-embed-ss-input';
    inputSs.placeholder = 'Auto (depuis le titre)';
    inputSs.setAttribute('spellcheck', 'false');
    inputSs.setAttribute('autocomplete', 'off');
    zoneSs.appendChild(inputSs);

    indicateurSs = document.createElement('span');
    indicateurSs.className = 'zed-statut-save';
    zoneSs.appendChild(indicateurSs);

    const definirStatutSs = (statut: StatutEnregistrement | null): void => {
        indicateurSs.className = 'zed-statut-save';
        if (!statut) { indicateurSs.textContent = ''; return; }
        indicateurSs.classList.add(`zed-statut-save--${statut}`);
        indicateurSs.textContent = statut === 'enregistrement'
            ? 'Enregistrement...'
            : statut === 'ok'
                ? 'Enregistré ✓'
                : "Échec de l'enregistrement";
        if (statut === 'ok') {
            setTimeout(() => {
                indicateurSs.className = 'zed-statut-save';
                indicateurSs.textContent = '';
            }, 2200);
        }
    };

    const enregistrerSsSiModifie = async (): Promise<void> => {
        if (!idCourant) return;
        const valeur = (inputSs.value ?? '').trim();
        if (valeur === ssCourant) return;
        definirStatutSs('enregistrement');
        try {
            const resultat = await sauvegarderSsConserveur(
                examenCourant,
                typeCourant,
                idCourant,
                valeur
            );
            if (resultat.success) {
                ssCourant = valeur;
                definirStatutSs('ok');
            } else {
                definirStatutSs('erreur');
            }
        } catch {
            definirStatutSs('erreur');
        }
    };

    inputSs.addEventListener('blur', () => { void enregistrerSsSiModifie(); });
    inputSs.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') {
            ev.preventDefault();
            inputSs.blur();
        }
    });

    enteteEmbed.appendChild(zoneSs);

    // Indicateur d'exportabilité : reste vide (rien de visible) tant
    // que toutes les questions de la série ouverte ne sont pas prêtes
    // à l'exportation ; sinon affiche combien il en reste à corriger
    // (voir rafraichirIndicateursExport, mise à jour à l'ouverture et
    // à chaque modification d'une zone transformée).
    zoneExportStatut = document.createElement('span');
    zoneExportStatut.className = 'affichage-embed-export-statut';
    enteteEmbed.appendChild(zoneExportStatut);

    // La zone (examen + type) est fixe pour cette instance : une
    // instance = une page CE/CO/EE/EO d'un seul examen (voir en-tête
    // du fichier) — seul l'id (la série affichée) change au fil des
    // appels à afficherDonnees, récupéré ici via idCourant.
    boutonExport = creerBoutonExportZone(`${examen}-${type}` as ZoneExport, () => idCourant);
    enteteEmbed.appendChild(boutonExport);

    racineAffichage.appendChild(enteteEmbed);

    const layout = document.createElement('div');
    layout.className = 'affichage-layout';

    // --- Zone de navigation (gauche, largeur fixe) ---
    const nav = document.createElement('div');
    nav.className = 'affichage-nav';

    zoneNavListe = document.createElement('div');
    zoneNavListe.className = 'affichage-nav-liste';
    nav.appendChild(zoneNavListe);

    const navigation = document.createElement('div');
    navigation.className = 'affichage-nav-navigation';

    btnPrecedent = document.createElement('button');
    btnPrecedent.className = 'affichage-nav-fleche';
    btnPrecedent.textContent = '◀ Préc.';
    btnPrecedent.addEventListener('click', () => selectionnerIndex(indexCourant - 1));

    indicateurPosition = document.createElement('div');
    indicateurPosition.className = 'affichage-nav-indicateur';

    btnSuivant = document.createElement('button');
    btnSuivant.className = 'affichage-nav-fleche';
    btnSuivant.textContent = 'Suiv. ▶';
    btnSuivant.addEventListener('click', () => selectionnerIndex(indexCourant + 1));

    navigation.appendChild(btnPrecedent);
    navigation.appendChild(indicateurPosition);
    navigation.appendChild(btnSuivant);
    nav.appendChild(navigation);

    // --- Zone de contenu (droite) ---
    zoneContenu = document.createElement('div');
    zoneContenu.className = 'affichage-contenu';

    layout.appendChild(nav);
    layout.appendChild(zoneContenu);
    racineAffichage.appendChild(layout);

    // Tant qu'aucun élément n'a été ouvert (ou que la série ouverte est
    // vide), on n'affiche ni la navigation ni les boutons Suivant/Précédent :
    // seulement un petit message, à la place de toute la zone nav+contenu.
    const messageVide = document.createElement('div');
    messageVide.className = 'nm-page-reste-message';

    const afficherMessage = (texte: string): void => {
        div.innerHTML = '';
        messageVide.textContent = texte;
        div.appendChild(messageVide);
    };

    // Affiche la zone complète (entête + nav + contenu) dans `div`,
    // à appeler uniquement une fois qu'il y a réellement quelque chose
    // à montrer (voir afficherDonnees ci-dessous).
    const afficherZoneComplete = (): void => {
        if (racineAffichage.parentElement !== div) {
            div.innerHTML = '';
            div.appendChild(racineAffichage);
        }
    };

    // Affiche la liste des éléments (ce/co/ee/eo) d'une série donnée,
    // dans CETTE instance uniquement.
    const afficherDonnees = async (
        titre: string,
        examenSerie: Examen,
        id: string,
        type: TypeEpreuve,
        donnees: ElementDonnee[]
    ): Promise<void> => {
        // On rafraîchit les stats de la série précédemment affichée
        // dans CETTE instance (si on en change vraiment) au moment où
        // une nouvelle série prend sa place dans la zone d'affichage.
        const examenAvant = examenCourant;
        const idAvant = idCourant;
        const typeAvant = typeCourant;
        if (idAvant !== null && (idAvant !== id || examenAvant !== examenSerie || typeAvant !== type)) {
            void rafraichirCarteTefApresAffichage(examenAvant, idAvant, typeAvant);
        }

        enteteTitre.textContent = titre;
        nettoyerTransformations();
        donneesCourantes = donnees;
        examenCourant = examenSerie;
        typeCourant = type;
        idCourant = id;
        indexCourant = 0;

        // Précharge l'état des zones "transformées" avec ce qui est déjà
        // enregistré sur disque (le fichier trans_{type}.json existe toujours
        // à ce stade : il est créé, s'il manquait, au lancement de
        // l'application — voir genererTransformationsManquantes dans
        // conserveurDonne.ts / main.ts).
        // ss manuel : si absent du JSON, le champ reste vide (génération
        // auto à l'export via decouperSerieEtTest).
        ssCourant = '';
        inputSs.value = '';
        try {
            const resultat = await lireTransformeConserveur(examenSerie, type, id);
            if (resultat.success) {
                initialiserEtatDepuisTransforme(type, donnees, resultat.transforme);
                // ss renvoyé en champ séparé par l'IPC (pas en propriété
                // du tableau transforme, perdue à la sérialisation).
                const ssLu = typeof (resultat as any).ss === 'string'
                    ? String((resultat as any).ss).trim()
                    : (typeof (resultat.transforme as any)?.ss === 'string'
                        ? String((resultat.transforme as any).ss).trim()
                        : '');
                ssCourant = ssLu;
                inputSs.value = ssLu;
            }
        } catch {
            // En cas d'échec de lecture, les zones repartent simplement vides.
        }

        zoneNavListe.innerHTML = '';
        boutonsNav = donnees.map((_, index) => {
            const btn = document.createElement('button');
            btn.className = 'affichage-nav-btn';
            btn.textContent = String(index + 1);
            btn.addEventListener('click', () => selectionnerIndex(index));
            zoneNavListe.appendChild(btn);
            return btn;
        });

        // Etat d'exportabilité initial de la série tout juste ouverte
        // (à partir de ce qui vient d'être relu depuis le disque via
        // initialiserEtatDepuisTransforme ci-dessus).
        rafraichirIndicateursExport();

        if (donnees.length === 0) {
            // Rien à afficher : petit message seul, ni nav ni boutons.
            afficherMessage('Aucun élément à afficher.');
        } else {
            afficherZoneComplete();
            selectionnerIndex(0);
        }
    };

    // État initial (avant toute ouverture d'élément) : petit message seul.
    afficherMessage('Sélectionnez une carte pour afficher son contenu.');

    return { afficherDonnees };
};