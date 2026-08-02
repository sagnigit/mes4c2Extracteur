// navigateurModerne.ts
//
// Ce fichier se trouve dans un dossier "voisin" de "generale"
// (les deux dossiers sont au même niveau). Adapte le chemin
// d'import ci-dessous si l'arborescence réelle diffère.
import { NavigationManager } from "../generale/navigationManager.js";

/**
 * Informations nécessaires pour construire un bouton de navigation.
 *  - avatar : texte affiché dans la partie ronde à gauche (ex: une initiale)
 *  - titre  : texte affiché en haut de la partie droite
 *  - donnee : texte affiché en bas de la partie droite (modifiable ensuite)
 *  - classe : optionnel, classe CSS ajoutée sur le bouton (ex: pour une
 *             couleur d'avatar différente selon la catégorie du bouton)
 */
export interface InfoBouton {
    avatar: string;
    titre: string;
    donnee: string;
    classe?: string;
}

/**
 * NavigateurModerne
 * -----------------
 * Prend une div "racine", la divise en deux zones :
 *   - le haut  : barre de navigation (boutons modernes)
 *   - le bas   : zone où s'ouvrent les pages
 *
 * S'appuie sur NavigationManager pour la gestion des pages / boutons,
 * mais reconstruit le contenu interne de chaque bouton pour obtenir
 * la structure demandée : avatar rond à gauche, titre + donnée à droite.
 */
export class NavigateurModerne {
    private root: HTMLDivElement;
    private navRoot: HTMLDivElement;
    private pageRoot: HTMLDivElement;
    private manager: NavigationManager;

    // Un élément "donnée" par bouton, indexé comme les pages, pour pouvoir
    // le mettre à jour rapidement via setBoutonDonnee(index, texte).
    private donneeElements: HTMLSpanElement[] = [];

    constructor(
        root: HTMLDivElement,
        boutons: InfoBouton[],
        activeClass: string = "nm-btn-actif"
    ) {
        this.root = root;
        this.root.innerHTML = "";
        this.root.classList.add("nm-root");

        // --- Division en 2 zones ---
        this.navRoot = document.createElement("div");
        this.navRoot.classList.add("nm-header");

        this.pageRoot = document.createElement("div");
        this.pageRoot.classList.add("nm-body");

        this.root.append(this.navRoot, this.pageRoot);

        // --- Delegation à NavigationManager ---
        this.manager = new NavigationManager(
            this.pageRoot,
            this.navRoot,
            activeClass
        );

        boutons.forEach((info) => this.creerPageEtBouton(info));

        // Ouvre la première page par défaut, si elle existe
        if (boutons.length > 0) {
            this.manager.openPage(0);
        }
    }

    // ---------------------------------------------------------------
    // Construction interne
    // ---------------------------------------------------------------
    private creerPageEtBouton(info: InfoBouton): void {
        const index = this.manager.addNavigablePage();
        const bouton = this.manager.getNav(index);

        bouton.classList.add("nm-btn");
        if (info.classe) bouton.classList.add(info.classe);
        bouton.innerHTML = ""; // le bouton créé par NavigationManager est vide, on le remplit

        // Partie gauche : rond avec avatar/initiale
        const avatarEl = document.createElement("span");
        avatarEl.classList.add("nm-btn-avatar");
        avatarEl.textContent = info.avatar;

        // Partie droite : titre (haut) + donnée (bas)
        const infosEl = document.createElement("span");
        infosEl.classList.add("nm-btn-infos");

        const titreEl = document.createElement("span");
        titreEl.classList.add("nm-btn-titre");
        titreEl.textContent = info.titre;

        const donneeEl = document.createElement("span");
        donneeEl.classList.add("nm-btn-donnee");
        donneeEl.textContent = info.donnee;

        infosEl.append(titreEl, donneeEl);
        bouton.append(avatarEl, infosEl);

        this.donneeElements[index] = donneeEl;
    }

    // ---------------------------------------------------------------
    // API publique
    // ---------------------------------------------------------------

    /** Récupère la div (partie utile) d'une page grâce à son indice, pour y insérer du contenu */
    public getPageContent(index: number): HTMLDivElement | null {
        return this.manager.getPage(index);
    }

    /** Change le texte de la partie "donnée" d'un bouton, via l'indice de sa page */
    public setBoutonDonnee(index: number, texte: string): void {
        const el = this.donneeElements[index];
        if (el) {
            el.textContent = texte;
        }
    }

    /** Change le texte du titre d'un bouton, via l'indice de sa page */
    public setBoutonTitre(index: number, texte: string): void {
        const bouton = this.manager.getNav(index);
        const titreEl = bouton?.querySelector<HTMLSpanElement>(".nm-btn-titre");
        if (titreEl) {
            titreEl.textContent = texte;
        }
    }

    /** Ouvre une page précise (et met à jour le bouton actif) */
    public openPage(index: number): void {
        this.manager.openPage(index);
    }

    /** Nombre total de pages/boutons créés */
    public get count(): number {
        return this.donneeElements.length;
    }
}