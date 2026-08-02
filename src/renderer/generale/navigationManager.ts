// navigationManager.ts
import { PageManager } from "./pageManager.js";

export class NavigationManager extends PageManager {
    private navRoot: HTMLDivElement;
    private activeClass: string;
    private buttons: HTMLButtonElement[];

    constructor(
        pageRoot: HTMLDivElement,
        navRoot: HTMLDivElement,
        activeClass: string
    ) {
        super(pageRoot);
        this.navRoot = navRoot;
        this.activeClass = activeClass;
        this.buttons = [];
    }

    // Ajouter une page avec son bouton de navigation
    public addNavigablePage(): number {
        const index = super.addPage();

        const button = document.createElement("button");
        button.addEventListener("click", () => this.openPage(index));
        this.navRoot.appendChild(button);

        this.buttons.push(button);
        return index;
    }

    // Ouvrir une page et mettre en avant son bouton
    public override openPage(index: number): void {
        super.openPage(index);

        this.buttons.forEach((btn, i) => {
            if (i === index) {
                btn.classList.add(this.activeClass, "bloc-pointer");
            } else {
                btn.classList.remove(this.activeClass, "bloc-pointer");
            }
        });
    }

    public getNav(index: number): HTMLButtonElement {
        return this.buttons[index];
    }
}
