// zoneAccueilTef.ts
//
// Construit, pour une page CE/CO/EE/EO donnée (ouverte par le
// NavigateurModerne d'un examen TCF ou TEF de l'accueil), la zone à
// droite listant les cartes de série pour cet examen + ce type précis.
//
// Reprend les cartes qui étaient auparavant affichées dans zoneExtract
// (une carte par série, avec ses statistiques Extrait / Transformé),
// mais :
//  - une seule ligne par série (l'examen et le type sont déjà fixés par
//    la page dans laquelle on se trouve, plus besoin des mini-cartes
//    imbriquées) ;
//  - pas de bouton "Ouvrir" : cliquer sur la carte suffit ;
//  - le clic affiche directement le contenu au centre (zoneAffichage,
//    le "reste" de la page), via la zone d'affichage déjà existante
//    (afficherDonnees, dans zoneAff.ts).
//
// Source des données : uniquement le dossier "conserveur"
// (conserveurDonne.ts), via les fonctions *Conserveur de donneeApi.ts.
// L'ancienne API par dossier "donnee" (listerSeries / lireCouple /
// lireTransforme) a été retirée : elle n'était plus utilisée nulle part.
import { construireCorpsPage } from '../composer/corpsPage.js';
import { Selecteur } from '../generale/selecteur.js';
import { creerBoutonSupprimerCarte } from '../generale/carteSuppression.js';
import { remplirZoneOuverture } from './zoneAff.js';
import {
    ElementDonnee,
    lireCoupleConserveur,
    lireTransformeConserveur,
    listerSeriesConserveur,
    supprimerSerieConserveur,
    NomSerieExtrait,
    TypeEpreuve,
    TypeExamen,
} from './donneeApi.js';
import {
    NOM_TYPE_AFFICHE,
    calculerStatsExtrait,
    calculerStatsTransforme,
    construireSectionStats,
} from './statsElement.js';

// Classe CSS de couleur d'accent par type (voir accueil.css)
const CLASSE_ACCENT: Record<TypeEpreuve, string> = {
    ce: 'nm-carte-elt--ce',
    co: 'nm-carte-elt--co',
    ee: 'nm-carte-elt--ee',
    eo: 'nm-carte-elt--eo',
};

// Pour retrouver, après fermeture de la zone d'affichage, la section
// "Transformé" d'une carte déjà construite, afin de la rafraîchir sans
// tout reconstruire (les stats "Transformé" peuvent avoir changé
// pendant l'édition). Clé : "examen:type:id".
interface CarteTefSuivie {
    zoneStats: HTMLDivElement;
    sectionTrans: HTMLDivElement;
}
const cartesSuivies = new Map<string, CarteTefSuivie>();
const cleCarteSuivie = (examen: TypeExamen, type: TypeEpreuve, id: string): string =>
    `${examen}:${type}:${id}`;

/**
 * Construit le corps de la page pour un examen + type donnés : zone
 * d'affichage (centre, message par défaut) + zone à droite avec une
 * carte par série de CET examen possédant ce type.
 *
 * Chaque page a SA PROPRE instance de zone d'affichage (remplirZoneOuverture),
 * dédiée à son examen/type exact — jamais un seul élément partagé
 * déplacé d'une page à l'autre : la page "TEF · CE" garde sa zone, la
 * page "TCF · EE" la sienne, etc.
 */
export const remplirZoneTef = async (
    page: HTMLDivElement,
    examen: TypeExamen,
    type: TypeEpreuve
): Promise<void> => {
    const { zoneAffichage, listeCartes } = construireCorpsPage(
        page,
        'Aucune série ne possède ce type pour le moment.'
    );

    // Instance dédiée à CETTE page (cet examen + ce type précis), remplie
    // directement dans zoneAffichage via le point d'entrée de zoneAff.ts.
    const instanceAffichage = remplirZoneOuverture(zoneAffichage, examen, type);

    const selecteurCartes = new Selecteur<HTMLDivElement>(
        (carte) => carte.classList.add('nm-carte-elt-actif'),
        (carte) => carte.classList.remove('nm-carte-elt-actif')
    );

    listeCartes.setEmptyMessage('Chargement des séries...');
    try {
        const series = await listerSeriesConserveur(examen, type);
        listeCartes.setEmptyMessage('Aucune série ne possède ce type pour le moment.');

        // listerSeriesConserveur() renvoie déjà les séries triées
        // naturellement (par nom) de façon croissante : on se contente
        // d'inverser pour les afficher en ordre décroissant.
        //
        // ouvrirPremiereCarte retient le déclenchement (mêmes actions que
        // le clic) de la toute première carte affichée, pour l'ouvrir
        // automatiquement une fois la liste construite (voir plus bas) :
        // dès qu'il y a au moins une carte, une carte reste toujours
        // ouverte au centre plutôt que le message "Sélectionnez...".
        let ouvrirPremiereCarte: (() => void) | null = null;

        for (const serie of [...series].reverse()) {
            const resultat = await lireCoupleConserveur(examen, type, serie.id);
            const donnees = resultat.success ? (resultat.extrait ?? []) : [];
            const transforme = resultat.success ? resultat.transforme : undefined;

            const ouvrirCarte = () => {
                selecteurCartes.selectUnique(carte);
                void instanceAffichage.afficherDonnees(
                    `${serie.nom} — ${NOM_TYPE_AFFICHE[type]}`,
                    examen,
                    serie.id,
                    type,
                    donnees
                );
            };
            const carte = creerCarteElement(serie, donnees, transforme, ouvrirCarte, () =>
                void remplirZoneTef(page, examen, type)
            );
            listeCartes.addItem(carte);

            if (!ouvrirPremiereCarte) ouvrirPremiereCarte = ouvrirCarte;
        }

        // Ouvre par défaut la première carte, s'il y en a au moins une.
        ouvrirPremiereCarte?.();
    } catch {
        listeCartes.setEmptyMessage('Erreur lors du chargement des séries.');
    }
};

// Construit la carte (statique, pas de dépliage) pour une série.
const creerCarteElement = (
    serie: NomSerieExtrait,
    donnees: ElementDonnee[],
    transforme: any,
    onClick: () => void,
    onSupprime: () => void
): HTMLDivElement => {
    const { type } = serie;
    const carte = document.createElement('div');
    carte.className = `nm-carte-elt ${CLASSE_ACCENT[type]}`;
    carte.addEventListener('click', onClick);

    const entete = document.createElement('div');
    entete.className = 'nm-carte-elt-entete';

    const badge = document.createElement('span');
    badge.className = 'nm-carte-elt-badge';
    badge.textContent = NOM_TYPE_AFFICHE[type];

    const titre = document.createElement('span');
    titre.className = 'nm-carte-elt-titre';
    titre.textContent = serie.nom;
    titre.title = serie.nom;

    const boutonSuppr = creerBoutonSupprimerCarte(
        serie.nom,
        () => supprimerSerieConserveur(serie.examen, type, serie.id),
        onSupprime
    );

    entete.append(badge, titre, boutonSuppr);
    carte.appendChild(entete);

    const zoneStats = document.createElement('div');
    zoneStats.className = 'nm-carte-elt-stats';

    const sectionExtrait = construireSectionStats('Extrait', 'extrait', calculerStatsExtrait(type, donnees));
    const sectionTrans = construireSectionStats('Transformé', 'trans', calculerStatsTransforme(type, transforme));
    zoneStats.append(sectionExtrait, sectionTrans);
    carte.appendChild(zoneStats);

    cartesSuivies.set(cleCarteSuivie(serie.examen, type, serie.id), { zoneStats, sectionTrans });

    return carte;
};

// Rafraîchit la section "Transformé" d'une carte déjà construite, après
// fermeture de la zone d'affichage (les stats ont pu changer pendant
// l'édition). Appelé depuis zoneAff.ts, à la place de l'ancien
// rafraichirCarteApresAffichage (déplacé ici avec les cartes).
export const rafraichirCarteTefApresAffichage = async (
    examen: TypeExamen | null,
    id: string | null,
    type: TypeEpreuve
): Promise<void> => {
    if (!examen || !id) return;
    const suivie = cartesSuivies.get(cleCarteSuivie(examen, type, id));
    if (!suivie) return;

    try {
        const resultat = await lireTransformeConserveur(examen, type, id);
        const nouvelleSection = construireSectionStats(
            'Transformé',
            'trans',
            resultat.success ? calculerStatsTransforme(type, resultat.transforme) : null
        );
        suivie.zoneStats.replaceChild(nouvelleSection, suivie.sectionTrans);
        suivie.sectionTrans = nouvelleSection;
        cartesSuivies.set(cleCarteSuivie(examen, type, id), suivie);
    } catch {
        // Silencieux : la carte garde ses anciennes stats en cas d'échec.
    }
};