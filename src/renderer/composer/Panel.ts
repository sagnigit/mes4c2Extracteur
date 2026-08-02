/**
 * Classe Panel
 * Crée un conteneur en position absolute qui occupe tout l'espace de la fenêtre,
 * avec une entête (titre + bouton retour optionnel) et un corps scrollable.
 */
export class Panel {
    private container: HTMLDivElement;
    private header: HTMLDivElement;
    private titleElement: HTMLHeadingElement;
    private backButton: HTMLButtonElement | null = null;
    private body: HTMLDivElement;
    private onClose: (() => void) | null = null;

    /**
     * @param title Titre affiché dans l'entête
     * @param showBackButton true pour afficher un bouton retour qui ferme le panel
     * @param onClose optionnel, appelé à chaque fermeture du panel (bouton retour ou close())
     */
    constructor(title: string = "", showBackButton: boolean = false, onClose: (() => void) | null = null) {
        this.onClose = onClose;
        // Conteneur principal
        this.container = document.createElement("div");
        this.container.classList.add("panel-container");

        // Entête
        this.header = document.createElement("div");
        this.header.classList.add("panel-header");

        if (showBackButton) {
            this.backButton = document.createElement("button");
            this.backButton.classList.add("panel-back-button");
            this.backButton.innerHTML = "&#8592;"; // flèche retour
            this.backButton.addEventListener("click", () => this.close());
            this.header.appendChild(this.backButton);
        }

        this.titleElement = document.createElement("h2");
        this.titleElement.classList.add("panel-header-title");
        this.titleElement.textContent = title;
        this.header.appendChild(this.titleElement);

        // Corps (zone scrollable)
        this.body = document.createElement("div");
        this.body.classList.add("panel-body");

        // Assemblage
        this.container.appendChild(this.header);
        this.container.appendChild(this.body);
        document.body.appendChild(this.container);
    }

    /**
     * Affiche le panel (met le conteneur principal en display: flex)
     */
    public open(): void {
        this.container.style.display = "flex";
    }

    /**
     * Cache le panel (met le conteneur principal en display: none)
     */
    public close(): void {
        this.container.style.display = "none";
        this.onClose?.();
    }

    /**
     * Retourne le conteneur principal
     */
    public getContainer(): HTMLDivElement {
        return this.container;
    }

    /**
     * Retourne la div du corps (zone scrollable)
     */
    public getBody(): HTMLDivElement {
        return this.body;
    }

    /**
     * Met à jour le titre affiché
     */
    public setTitle(title: string): void {
        this.titleElement.textContent = title;
    }

    public hideHeader(): void {
        this.header.style.display = "none"
    }
}

/*

Dimensions de l'image complète :

Largeur : 1256 pixels

Hauteur : 862 pixels 


Largeur : 986 pixels

Hauteur : 664 pixels

Coordonnées (point supérieur gauche) :

X (horizontal) : 132 pixels

Y (vertical) : 102 pixels
*/