export class InfoCard {
    private container: HTMLDivElement;
    private containerEntete: HTMLDivElement;
    private zoneDetachable: HTMLDivElement;
    private indiqueDeroule: HTMLDivElement;
    private leftTitle: HTMLHeadingElement;
    private leftElements: HTMLDivElement;
    private rightZone: HTMLDivElement;
    private signaleDeroulement: () => void=  () => {};

    constructor(container: HTMLDivElement, fontEcoute: (elt: any) => void) {
        // Conteneur principal
        this.container = container;
        container.className = "infoCard-container";

        //zone detachable
        this.zoneDetachable = document.createElement("div");
        this.zoneDetachable.className = "infoCard-detachable";

        //conteur entete
        const containerEntete = document.createElement("div");
        this.containerEntete = containerEntete;
        containerEntete.classList.add("infoCard-entete");
        this.container.appendChild(containerEntete);
        containerEntete.onclick = () => { fontEcoute(this) };

        // Zone gauche
        const leftZone = document.createElement("div");
        leftZone.className = "infoCard-left-zone";

        this.leftTitle = document.createElement("h1");
        this.leftTitle.className = "infoCard-left-title";
        leftZone.appendChild(this.leftTitle);

        this.leftElements = document.createElement("div");
        this.leftElements.className = "infoCard-left-elements";
        leftZone.appendChild(this.leftElements);

        // Zone droite
        this.rightZone = document.createElement("div");
        this.rightZone.className = "infoCard-right-zone";

        //le texte indicatif du deroulement
        this.indiqueDeroule = document.createElement("div");
        this.indiqueDeroule.className = "infoCard-indication iconMateriel";
        this.rightZone.appendChild(this.indiqueDeroule);

        // Ajout des zones au conteneur
        containerEntete.appendChild(leftZone);
        containerEntete.appendChild(this.rightZone);

        //initialisation
        this.enrouler();
    }

    //recuperation de la fonction qui se decanche a pres chanque deroulement
    setSignaleDeroulement(font: () =>void){
        this.signaleDeroulement = font;
    }

    // Retourne le conteneur pour l’insérer dans le DOM
    public getContainer(): HTMLDivElement {
        return this.container;
    }

    public getZoneDetachable(): HTMLDivElement {
        return this.zoneDetachable;
    }

    public derouler() {
        this.indiqueDeroule.textContent = 'expand_more';
        this.container.appendChild(this.zoneDetachable);
        this.container.classList.add("infoCard-zone-derouler");
        this.signaleDeroulement();
    }

    public enrouler() {
        this.indiqueDeroule.textContent = 'chevron_right';
        this.zoneDetachable.remove();
        this.container.classList.remove("infoCard-zone-derouler");
    }

    // Indique si la carte est actuellement dépliée (tête ouverte)
    public estDeroulee(): boolean {
        return this.container.classList.contains("infoCard-zone-derouler");
    }

    // Modifier le texte principal à gauche
    public setLeftTitle(text: string): void {
        this.leftTitle.textContent = text;
    }

    // Ajouter un élément gauche (valeur + label)
    public addLeftElement(label: string, value: string): void {
        const element = document.createElement("div");
        element.className = "infoCard-left-element";
        // data-id est placé sur la valeur (et non le label) pour que
        // setValeur() puisse la mettre à jour correctement, de la même
        // façon que pour addRightElement.
        element.innerHTML = `<span class="infoCard-value" data-id="${label}">${value}</span><span class="infoCard-label">${label}</span>`;
        this.leftElements.appendChild(element);
    }

    public addLeftValeur(value: string) {
        const element = document.createElement("div");
        element.className = "infoCard-left-element";
        element.innerHTML = `<span class="infoCard-value">${value}</span>`;
        this.leftElements.appendChild(element);
    }

    // Ajouter un élément droit (valeur + label)
    public addRightElement(label: string, value: string): void {
        const element = document.createElement("div");
        element.className = "infoCard-right-cadre";
        element.innerHTML = `
            <span class = "infoCard-right-label">${label}</span>
            <h2 class = "infoCard-right-value" data-id="${label}">${value}</h2>
        `;
        this.rightZone.prepend(element);
    }

    // modifier la valeur
    public setValeur(label: string, value: string): void {
        (this.containerEntete.querySelector(`[data-id="${label}"]`) as HTMLElement).textContent = value;
    }

}