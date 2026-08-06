// navigateurCarte.ts
//
// Ce fichier se trouve dans un dossier "voisin" de "generale"
// (les deux dossiers sont au même niveau). Adapte le chemin
// d'import ci-dessous si l'arborescence réelle diffère.
import { NavigationManager } from "../generale/navigationManager.js";

/**
 * Compteurs affichés sur une carte (nombre d'items par type d'épreuve).
 */
export interface CompteursType {
    ce: number;
    co: number;
    ee: number;
    eo: number;
}

/**
 * Informations nécessaires pour construire une carte de navigation.
 *  - titre     : texte principal de la carte (ex: "TCF")
 *  - sousTitre : texte secondaire, optionnel (ex: "Test de connaissance du français")
 *  - icone     : texte affiché dans le badge à gauche (par défaut = titre)
 *  - compteurs : nombre de ce/co/ee/eo à afficher sur la carte
 *  - classe    : optionnel, classe CSS ajoutée sur la carte (ex: pour une
 *                couleur d'accent différente selon la catégorie)
 */
export interface InfoCarteNav {
    titre: string;
    sousTitre?: string;
    icone?: string;
    compteurs: CompteursType;
    classe?: string;
}

const LIBELLES: { cle: keyof CompteursType; label: string }[] = [
    { cle: "ce", label: "CE" },
    { cle: "co", label: "CO" },
    { cle: "ee", label: "EE" },
    { cle: "eo", label: "EO" },
];

/**
 * NavigateurCarte
 * ---------------
 * Prend une div "racine", la divise en deux zones :
 *   - à gauche : colonne de navigation par cartes (une carte = une page)
 *   - à droite : zone où s'ouvre le contenu de la carte active
 *
 * S'appuie directement sur NavigationManager (comme NavigateurModerne),
 * mais reconstruit le contenu interne de chaque bouton pour obtenir une
 * carte : badge à gauche, titre + sous-titre, puis une ligne de
 * compteurs CE / CO / EE / EO.
 */
export class NavigateurCarte {
    private root: HTMLDivElement;
    // Conteneur global de la colonne de gauche (cartes + pied de colonne).
    private navRoot: HTMLDivElement;
    // Sous-zone scrollable qui reçoit les boutons-cartes de NavigationManager.
    private cartesRoot: HTMLDivElement;
    // Sous-zone fixe sous les cartes, pour des boutons additionnels
    // (ex: Extraction / Création / Paramètres) — voir getPiedColonne().
    private piedRoot: HTMLDivElement;
    private pageRoot: HTMLDivElement;
    private manager: NavigationManager;

    // Les 4 éléments "valeur" (ce/co/ee/eo) d'une carte, indexés comme
    // les pages, pour pouvoir les mettre à jour via setCompteur(...).
    private compteurElements: Record<string, HTMLSpanElement>[] = [];

    constructor(
        root: HTMLDivElement,
        cartes: InfoCarteNav[],
        activeClass: string = "cnav-carte-actif"
    ) {
        this.root = root;
        this.root.innerHTML = "";
        this.root.classList.add("cnav-root");

        // --- Division en 2 zones (gauche / droite) ---
        this.navRoot = document.createElement("div");
        this.navRoot.classList.add("cnav-colonne");

        // La colonne de gauche est elle-même divisée en 2 : les cartes
        // (scrollables, prennent l'espace restant) puis le pied de
        // colonne (fixe, sous les cartes).
        this.cartesRoot = document.createElement("div");
        this.cartesRoot.classList.add("cnav-colonne-cartes");
        this.navRoot.appendChild(this.cartesRoot);

        this.piedRoot = document.createElement("div");
        this.piedRoot.classList.add("cnav-colonne-pied");
        this.navRoot.appendChild(this.piedRoot);

        this.pageRoot = document.createElement("div");
        this.pageRoot.classList.add("cnav-pages");

        this.root.append(this.navRoot, this.pageRoot);

        // --- Delegation à NavigationManager (les boutons-cartes vont
        // dans cartesRoot, pas directement dans navRoot) ---
        this.manager = new NavigationManager(
            this.pageRoot,
            this.cartesRoot,
            activeClass
        );

        cartes.forEach((info) => this.creerCarteEtPage(info));

        // Ouvre la première carte par défaut, si elle existe
        if (cartes.length > 0) {
            this.manager.openPage(0);
        }
    }

    // ---------------------------------------------------------------
    // Construction interne
    // ---------------------------------------------------------------
    private creerCarteEtPage(info: InfoCarteNav): void {
        const index = this.manager.addNavigablePage();
        const carte = this.manager.getNav(index);

        carte.classList.add("cnav-carte");
        if (info.classe) carte.classList.add(info.classe);
        carte.innerHTML = ""; // le bouton créé par NavigationManager est vide, on le remplit

        // La page associée (zone de droite) reçoit une classe dédiée,
        // pour qu'elle puisse prendre toute la hauteur disponible.
        this.manager.getPage(index)?.classList.add("cnav-page");

        // --- Entête de la carte : badge + titre/sous-titre ---
        const entete = document.createElement("div");
        entete.classList.add("cnav-carte-entete");

        const badgeEl = document.createElement("span");
        badgeEl.classList.add("cnav-carte-badge");
        badgeEl.textContent = info.icone ?? info.titre;

        const textesEl = document.createElement("span");
        textesEl.classList.add("cnav-carte-textes");

        const titreEl = document.createElement("span");
        titreEl.classList.add("cnav-carte-titre");
        titreEl.textContent = info.titre;
        textesEl.appendChild(titreEl);

        if (info.sousTitre) {
            const sousTitreEl = document.createElement("span");
            sousTitreEl.classList.add("cnav-carte-sous-titre");
            sousTitreEl.textContent = info.sousTitre;
            sousTitreEl.title= info.sousTitre;
            textesEl.appendChild(sousTitreEl);
        }

        entete.append(badgeEl, textesEl);
        carte.appendChild(entete);

        // --- Ligne de compteurs CE / CO / EE / EO ---
        const statsEl = document.createElement("div");
        statsEl.classList.add("cnav-carte-stats");

        const elementsCompteurs: Record<string, HTMLSpanElement> = {};
        for (const { cle, label } of LIBELLES) {
            const blocEl = document.createElement("div");
            blocEl.classList.add("cnav-carte-stat");

            const labelEl = document.createElement("span");
            labelEl.classList.add("cnav-carte-stat-label");
            labelEl.textContent = label;

            const valeurEl = document.createElement("span");
            valeurEl.classList.add("cnav-carte-stat-valeur");
            valeurEl.textContent = String(info.compteurs[cle]);

            blocEl.append(labelEl, valeurEl);
            statsEl.appendChild(blocEl);
            elementsCompteurs[cle] = valeurEl;
        }
        carte.appendChild(statsEl);

        this.compteurElements[index] = elementsCompteurs;
    }

    // ---------------------------------------------------------------
    // API publique
    // ---------------------------------------------------------------

    /** Récupère la div (partie utile) d'une page grâce à son indice, pour y insérer du contenu */
    public getPageContent(index: number): HTMLDivElement | null {
        return this.manager.getPage(index);
    }

    /** Change la valeur d'un compteur (ce/co/ee/eo) d'une carte, via l'indice de sa page */
    public setCompteur(index: number, type: keyof CompteursType, valeur: number): void {
        const el = this.compteurElements[index]?.[type];
        if (el) {
            el.textContent = String(valeur);
        }
    }

    /** Ouvre une carte précise (et met à jour son état actif) */
    public openPage(index: number): void {
        this.manager.openPage(index);
    }

    /**
     * Zone fixe en bas de la colonne de gauche, sous les cartes —
     * destinée à accueillir des boutons additionnels (ex: Extraction /
     * Création / Paramètres, voir initPiedColonneAccueil dans
     * zoneAccueil.ts). Ne défile pas avec les cartes.
     */
    public getPiedColonne(): HTMLDivElement {
        return this.piedRoot;
    }

    /** Nombre total de cartes/pages créées */
    public get count(): number {
        return this.compteurElements.length;
    }
}