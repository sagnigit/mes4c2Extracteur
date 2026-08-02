// statsElement.ts
//
// Calcul des mini-statistiques (Extrait / Transformé) affichées sur une
// carte représentant un couple série + type d'épreuve. Anciennement
// dans zoneExtract.ts (creerCadreType et fonctions voisines) ; déplacé
// ici pour être partagé avec zoneAccueilTef.ts, qui affiche désormais
// ces cartes dans la zone d'accueil (partie TEF) plutôt que dans
// zoneExtract.
import { ElementDonnee, TypeEpreuve } from './donneeApi.js';
import { QuestionCE } from './donneeTcfCeApi.js';
import { PartieEE } from './donneeTcfEeApi.js';
// PartieEO (donneeTcfEoApi.ts) a EXACTEMENT la même forme que PartieEE
// (nomPartie, tache2, tache3) : pas besoin d'un second import, voir
// PartieTacheTexte plus bas.

export const NOM_TYPE_AFFICHE: Record<TypeEpreuve, string> = {
    ce: 'CE',
    co: 'CO',
    ee: 'EE',
    eo: 'EO',
};

export interface StatCarte { valeur: string; label: string; }

const estVideValeur = (valeur: any): boolean => {
    return valeur === undefined || valeur === null || (typeof valeur === 'string' && valeur.trim() === '');
};

// Compte, dans un tableau d'objets, le nombre d'éléments dont le champ
// donné n'est ni vide, ni nul, ni une chaîne blanche.
const compterNonVide = (donnees: any[], champ: string): number =>
    donnees.filter((d) => !estVideValeur(d?.[champ])).length;

// Pour CE/CO transformés : un item est "complet" quand une bonne
// réponse a été choisie ET que les 4 propositions sont renseignées.
const compterPropositionsCompletes = (items: any[]): number =>
    items.filter((it) => {
        const props = it?.propositions ?? {};
        const quatreRenseignees = ['A', 'B', 'C', 'D'].every((l) => !estVideValeur(props[l]));
        return quatreRenseignees && !estVideValeur(it?.bonneReponse);
    }).length;

// ============================================================
// Statistiques côté EXTRAIT (lecture seule, telles qu'extraites
// à l'origine des fichiers ce.json/co.json/ee.json/eo.json).
// ============================================================
export const calculerStatsExtrait = (type: TypeEpreuve, donnees: ElementDonnee[]): StatCarte[] => {
    const total = donnees.length;
    const nbImages = compterNonVide(donnees, '_localImagePath');
    const nbAudios = compterNonVide(donnees, '_localAudioPath');

    if (type === 'ce') {
        const nbReponses = compterNonVide(donnees, 'reponseCorrecte');
        return [
            { valeur: String(total), label: total > 1 ? 'items' : 'item' },
            { valeur: String(nbImages), label: nbImages > 1 ? 'images' : 'image' },
            { valeur: String(nbReponses), label: 'réponses déf.' },
        ];
    }
    if (type === 'co') {
        return [
            { valeur: String(total), label: total > 1 ? 'items' : 'item' },
            { valeur: String(nbAudios), label: nbAudios > 1 ? 'audios' : 'audio' },
            { valeur: String(nbImages), label: nbImages > 1 ? 'images' : 'image' },
        ];
    }
    if (type === 'ee') {
        const nbConsignes = compterNonVide(donnees, 'consigne');
        return [
            { valeur: String(total), label: total > 1 ? 'sessions' : 'session' },
            { valeur: String(nbConsignes), label: 'avec consigne' },
        ];
    }
    // eo
    return [
        { valeur: String(total), label: total > 1 ? 'sessions' : 'session' },
        { valeur: String(nbImages), label: nbImages > 1 ? 'images' : 'image' },
        { valeur: String(nbAudios), label: nbAudios > 1 ? 'audios' : 'audio' },
    ];
};

// ============================================================
// Statistiques côté TRANSFORMÉ (état actuel du fichier trans_*.json :
// ce que l'utilisateur a déjà rempli/complété via l'onglet Affichage).
// Retourne null si le transformé n'a pas pu être chargé.
// ============================================================
export const calculerStatsTransforme = (type: TypeEpreuve, transforme: any): StatCarte[] | null => {
    if (!transforme) return null;

    if (type === 'ce' || type === 'co') {
        const items: any[] = Array.isArray(transforme) ? transforme : [];
        const nbImages = compterNonVide(items, 'image');
        const nbCompletes = compterPropositionsCompletes(items);
        if (type === 'ce') {
            return [
                { valeur: String(nbImages), label: nbImages > 1 ? 'images' : 'image' },
                { valeur: String(nbCompletes), label: 'complètes' },
            ];
        }
        const nbAudios = compterNonVide(items, 'audio');
        return [
            { valeur: String(nbImages), label: nbImages > 1 ? 'images' : 'image' },
            { valeur: String(nbAudios), label: nbAudios > 1 ? 'audios' : 'audio' },
            { valeur: String(nbCompletes), label: 'complètes' },
        ];
    }

    if (type === 'ee') {
        const nbConsignes = (['A', 'B'] as const).filter((l) => !estVideValeur(transforme[l]?.consigne)).length;
        return [{ valeur: `${nbConsignes}/2`, label: 'consignes rédigées' }];
    }

    // eo : { A: { image, consigne, description }, B: {...} }
    const lettres = ['A', 'B'] as const;
    const nbImages = lettres.filter((l) => !estVideValeur(transforme[l]?.image)).length;
    const nbConsignes = lettres.filter((l) => !estVideValeur(transforme[l]?.consigne)).length;
    const nbDescriptions = lettres.filter((l) => !estVideValeur(transforme[l]?.description)).length;
    return [
        { valeur: `${nbImages}/2`, label: 'images' },
        { valeur: `${nbConsignes}/2`, label: 'consignes' },
        { valeur: `${nbDescriptions}/2`, label: 'descriptions' },
    ];
};

// Construit un bloc de mini-statistiques (une ligne de compteurs), avec
// un petit libellé de section ("Extrait" / "Transformé") au-dessus.
export const construireSectionStats = (
    titre: string,
    variante: 'extrait' | 'trans',
    stats: StatCarte[] | null
): HTMLDivElement => {
    const section = document.createElement('div');
    section.className = `nm-carte-elt-section nm-carte-elt-section--${variante}`;

    const label = document.createElement('div');
    label.className = `nm-carte-elt-section-label nm-carte-elt-section-label--${variante}`;
    label.textContent = titre;
    section.appendChild(label);

    const ligne = document.createElement('div');
    ligne.className = 'nm-carte-elt-section-stats';

    if (!stats || stats.length === 0) {
        ligne.classList.add('nm-carte-elt-section-stats--vide');
        ligne.textContent = 'Indisponible';
    } else {
        for (const stat of stats) {
            const bloc = document.createElement('div');
            bloc.className = 'nm-carte-elt-stat-bloc';
            bloc.innerHTML = `<span class="nm-carte-elt-stat-valeur"></span><span class="nm-carte-elt-stat-label"></span>`;
            (bloc.firstElementChild as HTMLElement).textContent = stat.valeur;
            (bloc.lastElementChild as HTMLElement).textContent = stat.label;
            ligne.appendChild(bloc);
        }
    }

    section.appendChild(ligne);
    return section;
};

// ============================================================
// Statistiques TCF · CE (donnée propre à donneeTcfCeApi.ts, ne passe
// PAS par "conserveur" — tableau plat de questions, pas de regroupement
// par partie). Même principe visuel que calculerStatsExtrait/Transforme
// ci-dessus (2 colonnes, comptages de champs non vides).
// ============================================================
export const calculerStatsExtraitTcfCe = (questions: QuestionCE[]): StatCarte[] => {
    const total = questions.length;
    const optionsCompletes = (q: QuestionCE) =>
        Array.isArray(q.options) && q.options.length > 0 && q.options.every((o) => !estVideValeur(o));
    const nbOptions = questions.filter(optionsCompletes).length;
    const nbReponses = questions.filter((q) => typeof q.correctAnswerIndex === 'number' && q.correctAnswerIndex >= 0).length;
    return [
        { valeur: String(total), label: total > 1 ? 'questions' : 'question' },
        { valeur: String(nbOptions), label: 'options compl.' },
        { valeur: String(nbReponses), label: 'réponses déf.' },
    ];
};

export const calculerStatsTransformeTcfCe = (questions: QuestionCE[] | null | undefined): StatCarte[] | null => {
    if (!questions) return null;
    const nbImages = questions.filter((q) => !estVideValeur(q._localEnonceImage)).length;
    const nbCompletes = questions.filter(
        (q) =>
            Array.isArray(q.options) &&
            q.options.length > 0 &&
            q.options.every((o) => !estVideValeur(o)) &&
            typeof q.correctAnswerIndex === 'number' &&
            q.correctAnswerIndex >= 0 &&
            !estVideValeur(q.question)
    ).length;
    return [
        { valeur: String(nbImages), label: nbImages > 1 ? 'images' : 'image' },
        { valeur: String(nbCompletes), label: 'complètes' },
    ];
};

// ============================================================
// Statistiques TCF · EE / EO (donneeTcfEeApi.ts / donneeTcfEoApi.ts,
// ne passent pas non plus par "conserveur"). PartieEE et PartieEO ont
// exactement la même forme : un tableau de parties, chacune avec
// tache2 (2 textes) et tache3 (3 textes) — une seule paire de
// fonctions couvre donc les deux.
// ============================================================
interface PartieTacheTexte {
    tache2: string[];
    tache3: string[];
}

const compterTextesNonVides = (textes: string[] | undefined): number =>
    Array.isArray(textes) ? textes.filter((t) => !estVideValeur(t)).length : 0;

export const calculerStatsExtraitTcfEeEo = (parties: PartieTacheTexte[]): StatCarte[] => {
    const total = parties.length;
    const totalTache2 = parties.reduce((s, p) => s + (Array.isArray(p.tache2) ? p.tache2.length : 0), 0);
    const totalTache3 = parties.reduce((s, p) => s + (Array.isArray(p.tache3) ? p.tache3.length : 0), 0);
    const nbTache2 = parties.reduce((s, p) => s + compterTextesNonVides(p.tache2), 0);
    const nbTache3 = parties.reduce((s, p) => s + compterTextesNonVides(p.tache3), 0);
    return [
        { valeur: String(total), label: total > 1 ? 'parties' : 'partie' },
        { valeur: `${nbTache2}/${totalTache2}`, label: 'tâche 2' },
        { valeur: `${nbTache3}/${totalTache3}`, label: 'tâche 3' },
    ];
};

export const calculerStatsTransformeTcfEeEo = (parties: PartieTacheTexte[] | null | undefined): StatCarte[] | null => {
    if (!parties) return null;
    return calculerStatsExtraitTcfEeEo(parties);
};