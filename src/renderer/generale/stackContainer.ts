export class StackContainer {
  private container: HTMLDivElement;
  private emptyMessage: HTMLDivElement;
  private items: HTMLDivElement[] = [];

  constructor(initialMessage: string = "Aucun élément, la liste est vide.", etendre= false) {
    // Conteneur principal
    this.container = document.createElement("div");
    this.container.className = (etendre) ? "stack-container-etendu" : "stack-container";

    // Message vide
    this.emptyMessage = document.createElement("div");
    this.emptyMessage.className = "stack-empty-message";
    this.emptyMessage.innerHTML = `
      <span>${initialMessage}</span>
    `;

    this.container.appendChild(this.emptyMessage);
  }

  // Retourne le conteneur pour l’ajouter au DOM
  public getElement(): HTMLDivElement {
    return this.container;
  }

  // Ajouter un nouvel élément
  public addItem(content: HTMLDivElement): void {
    if (!this.container.contains(content)) {
      this.container.appendChild(content);
      this.items.push(content);
      this.updateEmptyMessage();
    }
  }

  public createItem(): HTMLDivElement {
    const item = document.createElement("div");
    this.addItem(item);
    return item;
  }

  // Supprimer un élément spécifique
  public removeItem(item: HTMLDivElement): number {
    const index = this.items.indexOf(item);
    if (index !== -1) {
      this.items.splice(index, 1);
      this.container.removeChild(item);
      this.updateEmptyMessage();
    }
    return index
  }

  // Supprimer tous les éléments
  public clearItems(): void {
    this.items.forEach(item => this.container.removeChild(item));
    this.items = [];
    this.updateEmptyMessage();
  }

  // Modifier le message vide
  public setEmptyMessage(message: string): void {
    this.emptyMessage.innerHTML = `
      <span>${message}</span>
    `;
  }

  public getNbItem() {
    return this.items.length;
  }

  // Vérifie si vide et affiche/masque le message
  private updateEmptyMessage(): void {
    if (this.items.length === 0) {
      if (!this.container.contains(this.emptyMessage)) {
        this.container.appendChild(this.emptyMessage);
      }
    } else {
      if (this.container.contains(this.emptyMessage)) {
        this.container.removeChild(this.emptyMessage);
      }
    }
  }
}
