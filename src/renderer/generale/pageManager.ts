// pageManager.ts
import { Selecteur } from "./selecteur.js";

export class PageManager {
    private root: HTMLDivElement;
    private pages: HTMLDivElement[];
    private selecteur: Selecteur<HTMLDivElement>;

    constructor(root: HTMLDivElement) {
        this.root = root;
        this.pages = [];

        // On définit les fonctions de sélection/désélection
        this.selecteur = new Selecteur<HTMLDivElement>(
            (page) => this.root.appendChild(page), // ouvrir = ajouter à la souche
            (page) => {
                if (this.root.contains(page)) {
                    this.root.removeChild(page); // fermer = enlever de la souche
                }
            }
        );
    }

    // Ajouter une nouvelle page
    public addPage(): number {
        const page = document.createElement("div");
        this.pages.push(page);
        return this.pages.length - 1;
    }

    // Récupérer une page par indice
    public getPage(index: number): HTMLDivElement | null {
        return this.pages[index] || null;
    }

    // Ouvrir une page précise (et fermer les autres)
    public openPage(index: number): void {
        const page = this.getPage(index);
        if (page) {
            this.selecteur.selectUnique(page);
        }
    }
}
