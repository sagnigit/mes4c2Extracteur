/**
 * ActualisableList
 * ----------------
 * Même structure visuelle que SelectableList (voir selectable.ts) :
 *  - un en-tête avec le nombre total d'éléments
 *  - une zone scrollable affichant les éléments en grille (ou un
 *    message centré si la liste est vide)
 *
 * Mais sans rien de lié à la sélection ni à l'exportation :
 *  - pas de case à cocher, pas d'état "sélectionné", pas de bouton
 *    "Tout sélectionner" ;
 *  - pas de bouton ni de logique d'export.
 *
 * À la place :
 *  - chaque élément exécute sa propre fonction (`onClick`) quand on
 *    clique dessus ;
 *  - le bouton de l'en-tête (à la place de l'ancien "Tout sélectionner")
 *    déclenche la fonction d'actualisation de la liste, donnée en
 *    paramètre à la création de l'objet (`onRefresh`).
 *
 * Utilisation :
 *   const liste = new ActualisableList(document.getElementById("mon-div")!, {
 *     onRefresh: () => console.log("Actualisation demandée"),
 *   });
 *   liste.setItems([
 *     { id: "1", text: "Série 1", onClick: () => console.log("Série 1 cliquée") },
 *   ]);
 */

export interface ActualisableItem {
    id: string;
    text: string;
    /** Exécutée quand on clique sur cet élément. */
    onClick: () => void;
  }
  
  export interface ActualisableListOptions {
    /** Appelé quand l'utilisateur clique sur le bouton d'actualisation. */
    onRefresh: () => void;
    /** Texte du bouton d'actualisation (par défaut "Actualiser liste"). */
    refreshLabel?: string;
    /** Texte affiché au centre quand la liste est vide (par défaut "Aucun élément"). */
    emptyLabel?: string;
  }
  
  export class ActualisableList {
    private host: HTMLElement;
    private options: Required<ActualisableListOptions>;
  
    private items: ActualisableItem[] = [];
  
    // Références DOM internes
    private rootEl!: HTMLDivElement;
    private totalCountEl!: HTMLSpanElement;
    private itemsContainerEl!: HTMLDivElement;
    private emptyStateEl!: HTMLDivElement;
    private refreshBtnEl!: HTMLButtonElement;
  
    constructor(host: HTMLElement, options: ActualisableListOptions) {
      this.host = host;
      this.options = {
        onRefresh: options.onRefresh,
        refreshLabel: options.refreshLabel ?? "Actualiser liste",
        emptyLabel: options.emptyLabel ?? "Aucun élément",
      };
  
      this.buildSkeleton();
    }
  
    // ---------------------------------------------------------------------
    // Construction du DOM (une seule fois)
    // ---------------------------------------------------------------------
    private buildSkeleton(): void {
      this.rootEl = document.createElement("div");
      this.rootEl.className = "al-container";
  
      // --- Header ---
      const header = document.createElement("div");
      header.className = "al-header";
  
      const statsEl = document.createElement("div");
      statsEl.className = "al-stats";
  
      this.totalCountEl = document.createElement("span");
      this.totalCountEl.className = "al-total-count";
      this.totalCountEl.textContent = "0";
  
      const statsLabel = document.createElement("span");
      statsLabel.className = "al-stats-label";
      statsLabel.textContent = "élément(s)";
  
      statsEl.append(this.totalCountEl, statsLabel);
      header.appendChild(statsEl);
  
      // --- Bouton d'actualisation ---
      this.refreshBtnEl = document.createElement("button");
      this.refreshBtnEl.type = "button";
      this.refreshBtnEl.className = "al-refresh-btn";
  
      const icone = document.createElement("span");
      icone.className = "al-refresh-icone iconMateriel";
      icone.textContent = "refresh";
      icone.setAttribute("aria-hidden", "true");
  
      const label = document.createElement("span");
      label.className = "al-refresh-label";
      label.textContent = this.options.refreshLabel;
  
      this.refreshBtnEl.append(icone, label);
      this.refreshBtnEl.addEventListener("click", () => this.options.onRefresh());
      header.appendChild(this.refreshBtnEl);
  
      // --- Zone scrollable des éléments ---
      this.itemsContainerEl = document.createElement("div");
      this.itemsContainerEl.className = "al-items";
  
      // --- Message affiché quand la liste est vide ---
      this.emptyStateEl = document.createElement("div");
      this.emptyStateEl.className = "al-empty-state";
      this.emptyStateEl.textContent = this.options.emptyLabel;
  
      this.rootEl.append(header, this.itemsContainerEl);
      this.host.appendChild(this.rootEl);
  
      this.updateEmptyState();
    }
  
    // ---------------------------------------------------------------------
    // API publique
    // ---------------------------------------------------------------------
  
    /** Vide la liste des éléments sans toucher au reste du DOM. */
    public clear(): void {
      this.items = [];
      this.itemsContainerEl.innerHTML = "";
      this.updateStats();
      this.updateEmptyState();
    }
  
    /** Vide puis remplit la liste avec de nouveaux éléments. */
    public setItems(items: ActualisableItem[]): void {
      this.clear();
      this.items = [...items];
      this.renderItems();
      this.updateStats();
      this.updateEmptyState();
    }
  
    /** Ajoute des éléments sans vider les existants. */
    public addItems(items: ActualisableItem[]): void {
      this.items.push(...items);
      items.forEach((item) => this.renderSingleItem(item));
      this.updateStats();
      this.updateEmptyState();
    }
  
    /** Retourne tous les éléments actuellement affichés. */
    public getAllItems(): ActualisableItem[] {
      return [...this.items];
    }
  
    // ---------------------------------------------------------------------
    // Rendu interne
    // ---------------------------------------------------------------------
  
    private renderItems(): void {
      const fragment = document.createDocumentFragment();
      this.items.forEach((item) => {
        fragment.appendChild(this.createItemElement(item));
      });
      this.itemsContainerEl.appendChild(fragment);
    }
  
    private renderSingleItem(item: ActualisableItem): void {
      this.itemsContainerEl.appendChild(this.createItemElement(item));
    }
  
    private createItemElement(item: ActualisableItem): HTMLDivElement {
      const el = document.createElement("div");
      el.className = "al-item";
      el.dataset.id = item.id;
      el.tabIndex = 0;
      el.setAttribute("role", "button");
  
      // Icône d'actualisation sur chaque item
      const icone = document.createElement("span");
      icone.className = "al-item-icone iconMateriel";
      icone.textContent = "refresh";
      icone.setAttribute("aria-hidden", "true");
  
      const textEl = document.createElement("span");
      textEl.className = "al-item-text";
      textEl.textContent = item.text;
  
      el.append(icone, textEl);
  
      el.addEventListener("click", () => item.onClick());
      el.addEventListener("keydown", (e: KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          item.onClick();
        }
      });
  
      return el;
    }
  
    private updateStats(): void {
      this.totalCountEl.textContent = String(this.items.length);
    }
  
    /** Affiche un message centré à la place de la grille quand il n'y a aucun élément. */
    private updateEmptyState(): void {
      if (this.items.length === 0) {
        if (!this.itemsContainerEl.contains(this.emptyStateEl)) {
          this.itemsContainerEl.appendChild(this.emptyStateEl);
        }
        this.itemsContainerEl.classList.add("al-items--empty");
      } else {
        if (this.itemsContainerEl.contains(this.emptyStateEl)) {
          this.itemsContainerEl.removeChild(this.emptyStateEl);
        }
        this.itemsContainerEl.classList.remove("al-items--empty");
      }
    }
  }