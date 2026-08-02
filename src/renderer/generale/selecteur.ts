// selecteur.ts

export class Selecteur<T> {
    private selectionFn: (element: T) => void;
    private deselectionFn: (element: T) => void;
    private selectedElements: Set<T>;

    constructor(
        selectionFn: (element: T) => void,
        deselectionFn: (element: T) => void
    ) {
        this.selectionFn = selectionFn;
        this.deselectionFn = deselectionFn;
        this.selectedElements = new Set<T>();
    }

    // Sélectionne un élément (si déjà sélectionné, le désélectionne)
    public toggleSelection(element: T): void {
        if (this.selectedElements.has(element)) {
            this.deselectionFn(element);
            this.selectedElements.delete(element);
        } else {
            this.selectionFn(element);
            this.selectedElements.add(element);
        }
    }

    // Désélectionne un élément s'il est sélectionné
    public deselectElement(element: T): void {
        if (this.selectedElements.has(element)) {
            this.deselectionFn(element);
            this.selectedElements.delete(element);
        }
    }

    // Désélectionne tous les éléments
    public deselectAll(): void {
        this.selectedElements.forEach((el) => this.deselectionFn(el));
        this.selectedElements.clear();
    }

    // Sélectionne uniquement un élément (désélectionne tous les autres)
    public selectUnique(element: T): void {
        this.deselectAll();
        this.selectionFn(element);
        this.selectedElements.add(element);
    }

    // Récupère la liste des éléments sélectionnés
    public getSelectedElements(): T[] {
        return Array.from(this.selectedElements);
    }
}
