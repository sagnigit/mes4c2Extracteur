import { Panel } from '../composer/Panel.js';
import { NavigateurModerne, InfoBouton } from '../composer/navigateurModerne.js';
import { NavigateurCarte, InfoCarteNav, CompteursType } from '../composer/navigateurCarte.js';
import { construireCorpsPage } from '../composer/corpsPage.js';
import { remplirZoneTef } from './zoneAccueilTef.js';
import { remplirZoneTcfEo } from './zoneAccueilTcfEo.js';
import { remplirZoneTcfEe } from './zoneAccueilTcfEe.js';
import { remplirZoneTcfCe } from './zoneAccueilTcfCe.js';
import { remplirZoneOuverture } from './zoneAff.js';
import {ouvreZoneBloquant, fermerZoneBloquant} from './zoneBloquante.js';
import { ouvreZoneExtract } from './zoneExtract.js';
import { ouvrirZoneParam } from './zoneParam.js';
import { ouvrirZoneAuth } from './zoneAuth.js';
import { creerMessage, typeInfo } from "./gestionMessage.js";
import { listerSeriesConserveur, TypeEpreuve } from './donneeApi.js';
import { listerTcfCe } from './donneeTcfCeApi.js';
import { listerTcfEe } from './donneeTcfEeApi.js';
import { listerTcfEo } from './donneeTcfEoApi.js';
import { ecouteDonneeTraitee } from './extractionApi.js';

// ---------------------------------------------------------------------
// Zone d'accueil
// ---------------------------------------------------------------------
// Panel SANS entête. Son body contient désormais deux niveaux de
// navigation :
//   1. Une colonne de navigation par CARTES (à gauche), une carte par
//      examen (TCF / TEF), chacune affichant le nombre de CE, CO, EE
//      et EO — via le nouveau NavigateurCarte (basé directement sur
//      NavigationManager, comme demandé).
//   2. À droite, la carte active ouvre une page contenant une zone de
//      navigationModerne (NavigateurModerne, déjà existant) avec les
//      4 boutons CE / CO / EE / EO de l'examen choisi.
//
// Le corps de chaque page CE/CO/EE/EO est divisé en deux :
//   - une zone à droite avec des cartes ;
//   - le reste de la page (au centre), qui affiche le contenu de la
//     carte sélectionnée.
// Pour TCF, seule CO n'a pas encore de source de données propre : sa
// zone à droite réutilise le système de cartes de série du TEF. CE, EE
// et EO ont chacun leur propre module dédié (donnee_tcf_ce.ts /
// donnee_tcf_ee.ts / donnee_tcf_eo.ts, côté backend) et leur propre
// zone d'affichage (remplirZoneTcfCe / remplirZoneTcfEe /
// remplirZoneTcfEo) : conserveurDonne.ts n'y est pas impliqué — un
// dossier "tcf_ce_...", "tcf_ee_..." ou
// "tcf_eo_..." = une carte.
// Toutes les données CE/CO de TCF comme de TEF (et EE/EO de TEF)
// affichées ici sont récupérées depuis "conserveur" (conserveurDonne.ts) ;
// la CE, l'EE et l'EO du TCF sont récupérées depuis leur module dédié
// respectif.
//
// Rafraîchissement en direct : dès qu'une extraction TCF CE/EE/EO est
// enregistrée avec succès (voir ecouteDonneeTraitee plus bas), la page
// concernée est reconstruite (remplirZoneTcfCe, remplirZoneTcfEe ou
// remplirZoneTcfEo relance sa propre recherche de données) — la
// nouvelle carte apparaît donc sans qu'il soit besoin de fermer/rouvrir
// l'accueil.
//
// Le pied de la colonne de gauche (sous les cartes TCF/TEF) porte 3
// boutons : "Extraction", "Création" et "Paramètres" (voir
// initPiedColonneAccueil plus bas) — Extraction et Paramètres ouvrent
// chacun leur panel dédié, Création ne fait rien pour l'instant.
//
// Les compteurs des cartes TCF/TEF (dans la colonne de gauche) sont
// calculés à partir des vraies données sur disque (voir
// rafraichirCompteursAccueil plus bas) : une fois au chargement de
// l'accueil, puis à chaque nouvel élément traité avec succès (abonnement
// à ecouteDonneeTraitee, plus bas).
// ---------------------------------------------------------------------

let panAccueil: Panel;
let navCarteAccueil: NavigateurCarte;

export const initZoneAccueil = (): void => {
    panAccueil = new Panel('', false);
    panAccueil.hideHeader();

    // Le body accueille le NavigateurCarte (colonne de cartes + zone de page).
    const corps = panAccueil.getBody();
    corps.classList.add('accueil-corps');

    const cartes: InfoCarteNav[] = [
        {
            titre: 'TCF',
            sousTitre: 'Test de connaissance du français',
            compteurs: { ce: 0, co: 0, ee: 0, eo: 0 },
            classe: 'cnav-tcf',
        },
        {
            titre: 'TEF',
            sousTitre: "Test d'évaluation de français",
            compteurs: { ce: 0, co: 0, ee: 0, eo: 0 },
            classe: 'cnav-tef',
        },
    ];

    navCarteAccueil = new NavigateurCarte(corps, cartes);

    // --- Page TCF (carte d'indice 0) : navigationModerne CE/CO/EE/EO ---
    // CE/CO : pas encore de source de données (message provisoire).
    // EE/EO : vraies cartes de série, comme pour TEF (voir remplirPagesTcf).
    const pageTcf = navCarteAccueil.getPageContent(0);
    if (pageTcf) {
        const boutonsTcf: InfoBouton[] = [
            { avatar: 'CE', titre: 'TCF · Écrite', donnee: 'Compréhension', classe: 'nm-btn-tcf' },
            { avatar: 'CO', titre: 'TCF · Orale', donnee: 'Compréhension', classe: 'nm-btn-tcf' },
            { avatar: 'EE', titre: 'TCF · Écrite', donnee: 'Expression', classe: 'nm-btn-tcf' },
            { avatar: 'EO', titre: 'TCF · Orale', donnee: 'Expression', classe: 'nm-btn-tcf' },
        ];
        const navModerneTcf = new NavigateurModerne(pageTcf, boutonsTcf);
        remplirPagesTcf(navModerneTcf, boutonsTcf);
    }

    // --- Page TEF (carte d'indice 1) : navigationModerne CE/CO/EE/EO ---
    // Le dossier de données existant est utilisé ici : chaque page
    // affiche les vraies cartes de série pour son type (CE/CO/EE/EO).
    const pageTef = navCarteAccueil.getPageContent(1);
    if (pageTef) {
        const boutonsTef: InfoBouton[] = [
            { avatar: 'CE', titre: 'TEF · Écrite', donnee: 'Compréhension', classe: 'nm-btn-tef' },
            { avatar: 'CO', titre: 'TEF · Orale', donnee: 'Compréhension', classe: 'nm-btn-tef' },
            { avatar: 'EE', titre: 'TEF · Écrite', donnee: 'Expression', classe: 'nm-btn-tef' },
            { avatar: 'EO', titre: 'TEF · Orale', donnee: 'Expression', classe: 'nm-btn-tef' },
        ];
        const navModerneTef = new NavigateurModerne(pageTef, boutonsTef);
        remplirPagesTef(navModerneTef, boutonsTef);
    }

    initPiedColonneAccueil(navCarteAccueil.getPiedColonne());

    // Premier calcul des compteurs, au chargement de l'accueil.
    void rafraichirCompteursAccueil();
};

// Recalcule les 4 compteurs (CE/CO/EE/EO) des cartes TCF et TEF (colonne
// de gauche du NavigateurCarte) à partir des vraies données sur disque,
// puis les applique via NavigateurCarte.setCompteur.
//  - TCF · CE/EE/EO : donneeTcfCeApi.ts / donneeTcfEeApi.ts /
//    donneeTcfEoApi.ts (une carte = un dossier).
//  - TCF · CO et TEF · CE/CO/EE/EO : listerSeriesConserveur (dossier
//    "conserveur", voir donneeApi.ts).
// Appelée une fois au chargement de l'accueil (fin de initZoneAccueil)
// et à chaque nouvel élément traité avec succès (ecouteDonneeTraitee,
// plus bas).
const rafraichirCompteursAccueil = async (): Promise<void> => {
    if (!navCarteAccueil) return;

    try {
        const [tcfCe, tcfCo, tcfEe, tcfEo, tefCe, tefCo, tefEe, tefEo] = await Promise.all([
            listerTcfCe(),
            listerSeriesConserveur('tcf', 'co'),
            listerTcfEe(),
            listerTcfEo(),
            listerSeriesConserveur('tef', 'ce'),
            listerSeriesConserveur('tef', 'co'),
            listerSeriesConserveur('tef', 'ee'),
            listerSeriesConserveur('tef', 'eo'),
        ]);

        const compteursTcf: CompteursType = { ce: tcfCe.length, co: tcfCo.length, ee: tcfEe.length, eo: tcfEo.length };
        const compteursTef: CompteursType = { ce: tefCe.length, co: tefCo.length, ee: tefEe.length, eo: tefEo.length };

        (Object.keys(compteursTcf) as (keyof CompteursType)[]).forEach((cle) =>
            navCarteAccueil.setCompteur(0, cle, compteursTcf[cle])
        );
        (Object.keys(compteursTef) as (keyof CompteursType)[]).forEach((cle) =>
            navCarteAccueil.setCompteur(1, cle, compteursTef[cle])
        );
    } catch {
        // Silencieux : les cartes gardent leurs anciens compteurs en cas d'échec.
    }
};

// Pages TCF : CE/CO n'ont pas encore de source de données -> message
// provisoire (remplirZoneOuverture). EE/EO réutilisent directement le
// système de cartes de TEF (remplirZoneTef), mais dans l'espace 'tcf'
// du dossier "conserveur" (voir conserveurDonne.ts).
// Les pages EE/EO sont mémorisées (pagesTcfExpression) pour pouvoir être
// reconstruites en direct dès qu'une extraction aboutit (voir plus bas,
// abonnement à ecouteDonneeTraitee).
const pagesTcfExpression: Partial<Record<TypeEpreuve, HTMLDivElement>> = {};

const remplirPagesTcf = (nav: NavigateurModerne, boutons: InfoBouton[]): void => {
    for (let index = 0; index < nav.count; index++) {
        const page = nav.getPageContent(index);
        const type = boutons[index].avatar.toLowerCase() as TypeEpreuve;
        if (!page) continue;

        if (type === 'eo') {
            // EO ne passe plus par conserveurDonne.ts : voir
            // donnee_tcf_eo.ts (backend) et zoneAccueilTcfEo.ts.
            pagesTcfExpression[type] = page;
            void remplirZoneTcfEo(page);
        } else if (type === 'ee') {
            // EE non plus : même système que EO, voir donnee_tcf_ee.ts
            // (backend) et zoneAccueilTcfEe.ts.
            pagesTcfExpression[type] = page;
            void remplirZoneTcfEe(page);
        } else if (type === 'ce') {
            // CE non plus : même principe que EE/EO (un dossier tcf_ce =
            // une carte), voir donnee_tcf_ce.ts (backend) et
            // zoneAccueilTcfCe.ts — seule différence, la navigation se
            // fait par question (tableau plat) et non par partie.
            pagesTcfExpression[type] = page;
            void remplirZoneTcfCe(page);
        } else if (type === 'co') {
            // CO, lui, a de vraies données et réutilise directement le
            // même système d'affichage que le TEF (cartes de série +
            // zone d'affichage commune extrait/transformé, voir
            // zoneAccueilTef.ts / zoneAff.ts) — seule la source diffère
            // côté main.ts (donnee_tcf_co.ts au lieu de conserveurDonne.ts).
            pagesTcfExpression[type] = page;
            void remplirZoneTef(page, 'tcf', type);
        } else {
            const { zoneAffichage } = construireCorpsPage(page, 'Aucune carte pour le moment.');
            remplirZoneOuverture(zoneAffichage, 'tcf', type);
        }
    }
};

// Dès qu'une extraction TCF EE/EO est enregistrée avec succès (clic sur
// le nom d'un lien dans la zone d'extraction, voir zoneExtract.ts), la
// page d'accueil correspondante est reconstruite : la nouvelle carte de
// série apparaît directement, sans fermer/rouvrir l'accueil.
// Dès qu'une extraction TCF EE/EO ou une session TEF est enregistrée
// avec succès, la (ou les) page(s) d'accueil correspondante(s) sont
// reconstruites : la nouvelle carte apparaît directement, sans fermer
///rouvrir l'accueil. Pour une session TEF, les 4 types (CE/CO/EE/EO)
// sont touchés à la fois : les 4 pages sont donc toutes rafraîchies.
ecouteDonneeTraitee((idActu, info) => {
    if (!info.success) return;

    // Un nouvel élément vient d'être enregistré avec succès (extraction
    // TCF CE/EE/EO ou session TEF) : les compteurs CE/CO/EE/EO des deux
    // cartes (TCF/TEF) sont donc potentiellement à jour, quel que soit
    // le type concerné.
    void rafraichirCompteursAccueil();

    if (idActu === 'tef-session') {
        for (const type of ['ce', 'co', 'ee', 'eo'] as TypeEpreuve[]) {
            const page = pagesTef[type];
            if (page) void remplirZoneTef(page, 'tef', type);
        }
        return;
    }

    const type =
        idActu === 'tcf-ee' ? 'ee' : idActu === 'tcf-eo' ? 'eo' : idActu === 'tcf-ce' ? 'ce' : idActu === 'tcf-co' ? 'co' : null;
    if (!type) return;
    const page = pagesTcfExpression[type];
    if (!page) return;
    if (type === 'eo') {
        void remplirZoneTcfEo(page);
    } else if (type === 'ee') {
        void remplirZoneTcfEe(page);
    } else if (type === 'ce') {
        void remplirZoneTcfCe(page);
    } else if (type === 'co') {
        void remplirZoneTef(page, 'tcf', 'co');
    }
});

// Pages TEF : une page par type (CE/CO/EE/EO) -> vraies cartes de série.
// Mémorisées (pagesTef) pour pouvoir être reconstruites en direct dès
// qu'une session TEF est enregistrée (voir ecouteDonneeTraitee plus haut).
const pagesTef: Partial<Record<TypeEpreuve, HTMLDivElement>> = {};

const remplirPagesTef = (nav: NavigateurModerne, boutons: InfoBouton[]): void => {
    for (let index = 0; index < nav.count; index++) {
        const page = nav.getPageContent(index);
        const type = boutons[index].avatar.toLowerCase() as TypeEpreuve;
        if (page) {
            pagesTef[type] = page;
            void remplirZoneTef(page, 'tef', type);
        }
    }
};

// Construit un bouton du pied de colonne : icône (Material Icons
// ligature) + texte, aligné comme les cartes au-dessus.
const creerBoutonPied = (icone: string, texte: string, onClick: () => void): HTMLButtonElement => {
    const bouton = document.createElement('button');
    bouton.type = 'button';
    bouton.className = 'cnav-pied-bouton';

    const iconeEl = document.createElement('span');
    iconeEl.className = 'iconMateriel';
    iconeEl.textContent = icone;

    const texteEl = document.createElement('span');
    texteEl.textContent = texte;

    bouton.append(iconeEl, texteEl);
    bouton.addEventListener('click', onClick);
    return bouton;
};

// Intégration de sujets depuis des zips (voir nonExtract.ts côté
// backend) : crée directement des dossiers de série TEF-EE / TEF-EO,
// donc une fois l'intégration terminée on rafraîchit les mêmes choses
// que pour une extraction classique (ecouteDonneeTraitee plus haut) —
// compteurs des cartes TCF/TEF, et les pages TEF·EE / TEF·EO (celles
// dont les cartes de série peuvent changer) si elles sont déjà ouvertes.
const lancerCreation = async () => {
    ouvreZoneBloquant("Préparation  l'integration des fichiers crées");
    const resp = await window.api.invoke("extraction:prendre_dans_zip", null);
    fermerZoneBloquant();
    creerMessage(
        typeInfo,
        "Integration par zip",
        resp,
        8000
    );

    void rafraichirCompteursAccueil();
    for (const type of ['ee', 'eo'] as TypeEpreuve[]) {
        const page = pagesTef[type];
        if (page) void remplirZoneTef(page, 'tef', type);
    }
};

// Remplit le pied de colonne (sous les cartes TCF/TEF, colonne de
// gauche) avec les boutons Extraction / Création / Paramètres.
// Extraction et Paramètres ouvrent directement leur panel dédié (voir
// zoneExtract.ts / zoneParam.ts) ; Création ne fait rien pour le
// moment (lancerCreation, ci-dessus).
// L'action groupée n'est plus pilotée d'ici : chaque page CE/CO/EE/EO
// porte désormais son propre bouton (voir construireCorpsPage, dans
// corpsPage.ts), qui ouvre/referme sa propre zone de sélection groupée
// sans affecter les autres pages.
const initPiedColonneAccueil = (pied: HTMLDivElement): void => {
    pied.append(
        creerBoutonPied('search', 'Extraction', () => ouvreZoneExtract()),
        creerBoutonPied('add_circle', 'Création', () => lancerCreation()),
        creerBoutonPied('settings', 'Paramètres', () => ouvrirZoneParam()),
        creerBoutonPied('lock', 'Déconnexion', () => ouvrirZoneAuth()),
    );
};

export const ouvrirZoneAccueil = (): void => {
    panAccueil.open();
};