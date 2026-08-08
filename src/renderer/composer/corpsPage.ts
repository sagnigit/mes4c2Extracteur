// corpsPage.ts
//
// Squelette générique du corps d'une page (ex: une page CE/CO/EE/EO
// ouverte par un NavigateurModerne). Deux zones :
//   - zoneAffichage (le "reste" de la page) : simple div qui prend
//     l'espace restant, où vient s'afficher le contenu de la carte
//     sélectionnée à droite. Vide au départ (avec un message).
//   - zoneCartes (à droite) : colonne de cartes. Vide au départ, avec
//     un message tant qu'aucune carte n'a été ajoutée.
// La construction et le remplissage des cartes est laissée à l'appelant
// (voir zoneAccueilTef.ts), ce fichier ne fait que poser le squelette.
import { StackContainer } from "../generale/stackContainer.js";
import { creerMessage, typeErreur } from "../zoneGraph/gestionMessage.js";
import { demanderExportSequence, demanderExportGroupeTefEe, verifierExportGroupe, CibleExport } from "../zoneGraph/exportEcoute.js";
import { ouvreZoneBloquant, fermerZoneBloquant, setMessageProgression } from "../zoneGraph/zoneBloquante.js";

export interface ZonesCorpsPage {
    /** Le reste de la page : zone d'affichage du contenu sélectionné. */
    zoneAffichage: HTMLDivElement;
    /** La zone à droite, conteneur brut des cartes. */
    zoneCartes: HTMLDivElement;
    /** Liste défilante (avec message vide automatique) où ajouter les cartes. */
    listeCartes: StackContainer;
}

// ---------------------------------------------------------------------
// Mode "sélection groupée" (action en groupe)
// ---------------------------------------------------------------------
// Chaque page construite par construireCorpsPage reçoit :
//   - un bouton dédié (dans l'entête de sa zoneCartes, à côté du
//     bouton de repliage) qui lui est propre ;
//   - sa propre zone (.nm-selection-groupe) qui recouvre TOUTE la page
//     (zoneAffichage + zoneCartes) quand elle est ouverte : elle
//     affiche alors toutes les cartes de la zone (clones de
//     .nm-carte-elt pris dans listeCartes), les unes après les autres
//     dans un grand espace, sélectionnables au clic (classe
//     nm-carte-elt--choisie).
// Chaque page gère donc indépendamment sa propre zone : l'ouvrir sur
// une page n'affecte aucune autre page, et chaque zone peut être
// refermée soit en recliquant sur le bouton qui l'a ouverte, soit via
// son propre bouton de fermeture (croix dans sa barre du haut).
interface InstanceSelectionGroupe {
    zoneSelectionGroupe: HTMLDivElement;
    listeCartes: StackContainer;
    boutonToggle: HTMLButtonElement;
    actif: boolean;
}

// ---------------------------------------------------------------------
// Actions réelles (suppression / export) portées par une carte
// ---------------------------------------------------------------------
// Chaque carte de série (.nm-carte-elt), au moment de sa construction
// (zoneAccueilTef.ts, zoneAccueilTcfCe.ts, zoneAccueilTcfEe.ts,
// zoneAccueilTcfEo.ts), enregistre ici ce qu'elle sait faire d'elle-même
// -- exactement les mêmes fonctions que celles déjà branchées sur son
// bouton de suppression individuel / le bouton d'export de sa zone
// d'affichage. La zone de sélection groupée n'a donc besoin de rien
// connaître de spécifique à TEF/TCF·CE/EE/EO : elle retrouve juste ces
// actions via la carte ORIGINALE (jamais le clone affiché) et les
// applique à toute la sélection.
export interface ActionsCarte {
    /** Nom affichable (confirmation de suppression, messages d'erreur). */
    nom: string;
    /** Suppression réelle de cette carte (même fonction que le bouton de suppression individuel). */
    supprimer: () => Promise<{ success: boolean; error?: string }>;
    /** Reconstruit la page à laquelle appartient cette carte (identique pour toutes les cartes d'une même page). */
    rafraichirPage: () => void;
    /** Cible d'export (zone + id) de cette carte, si elle est exportable via demanderExport. */
    cibleExport?: CibleExport;
    /**
     * Identité fixe (zone + id) de cette carte, utilisée pour la
     * vérification GROUPÉE de l'exportabilité auprès du backend (voir
     * verifierExportGroupe, exportEcoute.ts, et verifierEtIndexerCartes
     * plus bas). Toujours renseignée, que la carte soit exportable ou
     * non pour l'instant — contrairement à cibleExport, qui lui n'est
     * défini que si elle l'est réellement.
     * Appelée à l'ouverture de la sélection groupée : TOUTES les
     * cibleVerification des cartes listées sont envoyées EN UNE SEULE
     * requête au backend, qui relit uniquement leurs .json transformés
     * et répond, pour chacune, si elle est exportable ou non — plutôt
     * que de relire et revérifier chaque carte une par une côté
     * renderer. Optionnel : les cartes qui ne l'implémentent pas
     * gardent simplement leurs dernières valeurs connues.
     */
    cibleVerification?: CibleExport;
}
const actionsParCarte = new WeakMap<HTMLElement, ActionsCarte>();

/**
 * Enregistre les actions réelles (suppression, export) d'une carte
 * (.nm-carte-elt) tout juste construite, pour qu'elles puissent être
 * appliquées en masse depuis la zone de sélection groupée. À appeler
 * une fois par carte, juste après sa construction.
 */
export const enregistrerActionsCarte = (carte: HTMLElement, actions: ActionsCarte): void => {
    actionsParCarte.set(carte, actions);
};

// Supprime réellement toutes les cartes sélectionnées (une confirmation
// unique pour le lot), puis reconstruit la page une seule fois (toutes
// les cartes d'une même page partagent la même fonction de
// reconstruction).
const executerSuppressionGroupee = async (cartesSelectionnees: HTMLElement[]): Promise<void> => {
    const actions = cartesSelectionnees
        .map((carte) => actionsParCarte.get(carte))
        .filter((action): action is ActionsCarte => !!action);
    if (actions.length === 0) return;

    const confirme = window.confirm(
        actions.length === 1
            ? `Supprimer « ${actions[0].nom} » ?\n\nLe dossier et toutes ses données (extrait, transformé, médias) seront définitivement supprimés.`
            : `Supprimer ces ${actions.length} cartes ?\n\nLes dossiers et toutes leurs données (extrait, transformé, médias) seront définitivement supprimés.`
    );
    if (!confirme) return;

    const echecs: string[] = [];
    for (const action of actions) {
        try {
            const resultat = await action.supprimer();
            if (!resultat.success) echecs.push(action.nom);
        } catch {
            echecs.push(action.nom);
        }
    }

    if (echecs.length > 0) {
        creerMessage(
            typeErreur,
            'Suppression groupée',
            echecs.length === actions.length
                ? "Échec de la suppression."
                : `Échec pour : ${echecs.join(', ')}.`
        );
    }

    actions[0].rafraichirPage();
};

// Lance l'export de toutes les cartes sélectionnées qui en sont
// capables (celles sans cibleExport, ex: pas encore branchées, sont
// simplement ignorées).
//
// Cas particulier TEF · EE : le site distant fusionne tous les sujets
// EE d'un même envoi en un seul tableau et n'accepte qu'une seule
// requête pour tout le lot (voir arrangerEELot, arrangeExport.ts) — dès
// qu'au moins DEUX sujets tef-ee sont sélectionnés, ils sont donc
// envoyés ensemble via demanderExportGroupeTefEe plutôt qu'un par un.
// Toutes les autres zones (et un éventuel unique sujet tef-ee, qui n'a
// rien à fusionner) continuent d'être envoyées une par une, comme avant
// (demanderExportSequence).
const executerExportGroupe = async (cartesSelectionnees: HTMLElement[]): Promise<void> => {
    const cibles = cartesSelectionnees
        .map((carte) => actionsParCarte.get(carte)?.cibleExport)
        .filter((cible): cible is CibleExport => !!cible);
    if (cibles.length === 0) return;

    const ciblesTefEe = cibles.filter((cible) => cible.zone === 'tef-ee');
    const ciblesUneParUne = cibles.filter((cible) => cible.zone !== 'tef-ee');

    if (ciblesTefEe.length > 1) {
        await demanderExportGroupeTefEe(ciblesTefEe.map((cible) => cible.id));
    } else {
        // Un seul sujet tef-ee (rien à fusionner) : traité comme les
        // autres zones, une requête simple.
        ciblesUneParUne.push(...ciblesTefEe);
    }

    await demanderExportSequence(ciblesUneParUne);
};

// Construit le contenu (barre d'actions + clones sélectionnables) d'une
// zone de sélection groupée à partir des cartes actuellement présentes
// dans sa liste. La sélection (cartes ORIGINALES sélectionnées, jamais
// les clones affichés ici) repart de zéro à chaque appel : la grille
// entière est reconstruite (mode activé, ou page reconstruite pendant
// que le mode est déjà actif), les anciennes cartes n'existent plus.
const remplirZoneSelectionGroupe = (instance: InstanceSelectionGroupe): void => {
    const { zoneSelectionGroupe, listeCartes } = instance;
    zoneSelectionGroupe.innerHTML = '';

    const cartesSource = Array.from(listeCartes.getElement().querySelectorAll<HTMLElement>('.nm-carte-elt'));

    if (cartesSource.length === 0) {
        const message = document.createElement('div');
        message.className = 'nm-selection-groupe-message';
        message.textContent = 'Aucune carte pour le moment.';
        zoneSelectionGroupe.appendChild(message);
        return;
    }

    const selection = new Set<HTMLElement>();

    // --- Barre du haut : sélection totale (bascule) + actions groupées ---
    const barre = document.createElement('div');
    barre.className = 'nm-selection-groupe-barre';

    const boutonTout = document.createElement('button');
    boutonTout.type = 'button';
    boutonTout.className = 'nm-selection-groupe-toggle';

    // Sélectionne/désélectionne UNIQUEMENT les cartes exportables (celles
    // qui portent le badge, voir cibleExport plus bas) — pratique pour
    // lancer un export groupé sans avoir à cliquer une par une sur les
    // cartes déjà prêtes. Masqué s'il n'y a aucune carte exportable du
    // tout dans la liste (voir mettreAJourBarre).
    const boutonToutExportables = document.createElement('button');
    boutonToutExportables.type = 'button';
    boutonToutExportables.className = 'nm-selection-groupe-toggle';

    const compte = document.createElement('span');
    compte.className = 'nm-selection-groupe-compte';

    // N'apparaît que dès qu'au moins une carte est sélectionnée (voir
    // mettreAJourBarre plus bas).
    const actions = document.createElement('div');
    actions.className = 'nm-selection-groupe-actions';

    const boutonExporter = document.createElement('button');
    boutonExporter.type = 'button';
    boutonExporter.className = 'nm-selection-groupe-btn nm-selection-groupe-btn--exporter';
    boutonExporter.innerHTML = '<span class="iconMateriel">cloud_upload</span><span>Exporter</span>';

    const boutonSupprimer = document.createElement('button');
    boutonSupprimer.type = 'button';
    boutonSupprimer.className = 'nm-selection-groupe-btn nm-selection-groupe-btn--supprimer';
    boutonSupprimer.innerHTML = '<span class="iconMateriel">delete</span><span>Supprimer</span>';

    actions.append(boutonExporter, boutonSupprimer);

    // Recherche : filtre les clones affichés dans la grille selon leur
    // titre (même logique que la recherche de zoneCartes), sans toucher
    // à la sélection déjà faite sur les cartes filtrées.
    const zoneRechercheGroupe = document.createElement('div');
    zoneRechercheGroupe.className = 'nm-selection-groupe-recherche';

    const iconeRechercheGroupe = document.createElement('span');
    iconeRechercheGroupe.className = 'iconMateriel nm-selection-groupe-recherche-icone';
    iconeRechercheGroupe.textContent = 'search';

    const champRechercheGroupe = document.createElement('input');
    champRechercheGroupe.type = 'text';
    champRechercheGroupe.className = 'nm-selection-groupe-recherche-champ';
    champRechercheGroupe.placeholder = 'Rechercher...';

    zoneRechercheGroupe.append(iconeRechercheGroupe, champRechercheGroupe);

    // Groupe de droite : actions (si sélection) + bouton de fermeture de
    // CETTE zone (toujours visible, quelle que soit la sélection).
    const droite = document.createElement('div');
    droite.className = 'nm-selection-groupe-droite';

    const boutonFermer = document.createElement('button');
    boutonFermer.type = 'button';
    boutonFermer.className = 'nm-selection-groupe-fermer iconMateriel';
    boutonFermer.textContent = 'close';
    boutonFermer.title = 'Fermer';
    boutonFermer.addEventListener('click', () => fermerSelectionGroupe(instance));

    droite.append(actions, boutonFermer);
    barre.append(boutonTout, boutonToutExportables, compte, zoneRechercheGroupe, droite);
    zoneSelectionGroupe.appendChild(barre);

    const grille = document.createElement('div');
    grille.className = 'nm-selection-groupe-grille';
    zoneSelectionGroupe.appendChild(grille);

    // Association clone <-> carte ORIGINALE : seule l'originale porte
    // les actions réelles enregistrées via enregistrerActionsCarte.
    const paires: { clone: HTMLElement; originale: HTMLElement }[] = [];

    // Détermine l'exportabilité d'une carte ORIGINALE à partir de son
    // cibleExport (voir enregistrerActionsCarte / verifierEtIndexerCartes) —
    // même source que celle utilisée pour poser le badge sur son clone.
    const estExportable = (originale: HTMLElement): boolean => !!actionsParCarte.get(originale)?.cibleExport;
    const cartesExportables = cartesSource.filter(estExportable);

    const mettreAJourBarre = (): void => {
        const total = cartesSource.length;
        const nb = selection.size;
        boutonTout.textContent = nb > 0 && nb === total ? 'Tout désélectionner' : 'Tout sélectionner';
        compte.textContent = nb > 0 ? `${nb} sélectionnée${nb > 1 ? 's' : ''}` : '';
        actions.classList.toggle('nm-selection-groupe-actions--visible', nb > 0);

        // Le bouton "Sélectionner les exportables" n'a de sens que s'il
        // existe au moins une carte exportable dans la liste.
        boutonToutExportables.classList.toggle('nm-selection-groupe-btn--cachee', cartesExportables.length === 0);
        const toutesExportablesSelectionnees =
            cartesExportables.length > 0 && cartesExportables.every((originale) => selection.has(originale));
        boutonToutExportables.textContent = toutesExportablesSelectionnees
            ? 'Désélectionner les exportables'
            : 'Sélectionner les exportables';

        // Le bouton "Exporter" ne s'affiche que si la sélection actuelle
        // contient AU MOINS une carte exportable — pas juste "au moins
        // une carte sélectionnée" comme pour "Supprimer" (actions
        // ci-dessus), qui lui reste valable pour n'importe quelle carte.
        const auMoinsUneExportableSelectionnee = Array.from(selection).some(estExportable);
        boutonExporter.classList.toggle('nm-selection-groupe-btn--cachee', !auMoinsUneExportableSelectionnee);
    };

    const basculerCarte = (originale: HTMLElement, clone: HTMLElement): void => {
        if (selection.has(originale)) {
            selection.delete(originale);
            clone.classList.remove('nm-carte-elt--choisie');
        } else {
            selection.add(originale);
            clone.classList.add('nm-carte-elt--choisie');
        }
        mettreAJourBarre();
    };

    cartesSource.forEach((carteOriginale) => {
        const clone = carteOriginale.cloneNode(true) as HTMLElement;
        // La carte originale peut porter 'nm-carte-elt-actif' (carte
        // actuellement ouverte dans la zone d'affichage normale, voir
        // Selecteur/selectUnique) : cloneNode copie cette classe telle
        // quelle, ce qui déplierait à tort ses stats ici (elle n'a rien
        // à voir avec la sélection groupée, gérée séparément via
        // nm-carte-elt--choisie).
        clone.classList.remove('nm-carte-elt-actif');
        // Le bouton de suppression n'a aucun sens dans cette vue (pas de
        // gestionnaire cloné) : on le retire pour ne pas induire en erreur.
        clone.querySelector('.nm-carte-elt-suppr')?.remove();

        // Petit badge (icône) sur les cartes exportables uniquement :
        // signale, avant même de sélectionner quoi que ce soit, quelles
        // cartes pourront réellement être exportées via le bouton
        // "Exporter" de la barre du haut (voir cibleExport, enregistré
        // par enregistrerActionsCarte). Les cartes qui ne le sont pas
        // n'affichent aucune indication.
        const actionCarte = actionsParCarte.get(carteOriginale);
        if (actionCarte?.cibleExport) {
            const badgeExportable = document.createElement('span');
            badgeExportable.className = 'nm-carte-elt-exportable-badge iconMateriel';
            badgeExportable.textContent = 'cloud_upload';
            badgeExportable.title = 'Exportable';
            clone.appendChild(badgeExportable);
        }

        clone.addEventListener('click', () => basculerCarte(carteOriginale, clone));
        grille.appendChild(clone);
        paires.push({ clone, originale: carteOriginale });
    });

    // Un seul bouton : sélectionne tout si au moins une carte ne l'est
    // pas encore, désélectionne tout si elles le sont déjà toutes.
    boutonTout.addEventListener('click', () => {
        const toutSelectionne = selection.size === cartesSource.length;
        paires.forEach(({ clone, originale }) => {
            if (toutSelectionne) {
                selection.delete(originale);
                clone.classList.remove('nm-carte-elt--choisie');
            } else {
                selection.add(originale);
                clone.classList.add('nm-carte-elt--choisie');
            }
        });
        mettreAJourBarre();
    });

    boutonSupprimer.addEventListener('click', () => {
        void executerSuppressionGroupee(Array.from(selection));
    });

    // Bascule la sélection des seules cartes exportables (celles avec
    // un badge) : tout sélectionner si au moins une n'est pas encore
    // sélectionnée, tout désélectionner si elles le sont déjà toutes —
    // les cartes NON exportables de la sélection en cours, elles, ne
    // sont pas touchées.
    boutonToutExportables.addEventListener('click', () => {
        const toutesExportablesSelectionnees = cartesExportables.every((originale) => selection.has(originale));
        paires.forEach(({ clone, originale }) => {
            if (!estExportable(originale)) return;
            if (toutesExportablesSelectionnees) {
                selection.delete(originale);
                clone.classList.remove('nm-carte-elt--choisie');
            } else {
                selection.add(originale);
                clone.classList.add('nm-carte-elt--choisie');
            }
        });
        mettreAJourBarre();
    });

    boutonExporter.addEventListener('click', () => {
        void executerExportGroupe(Array.from(selection));
    });

    // Filtre les clones de la grille par titre (recherche insensible à
    // la casse/aux accents) — la sélection en cours n'est pas touchée,
    // seules les cartes qui ne correspondent plus sont masquées.
    champRechercheGroupe.addEventListener('input', () => {
        const recherche = normaliserRecherche(champRechercheGroupe.value);
        paires.forEach(({ clone }) => {
            const titre = clone.querySelector('.nm-carte-elt-titre');
            const texte = titre ? titre.textContent ?? '' : clone.textContent ?? '';
            const correspond = recherche === '' || normaliserRecherche(texte).includes(recherche);
            clone.classList.toggle('nm-carte-item-cachee', !correspond);
        });
    });

    mettreAJourBarre();
};

// Réévalue l'exportabilité de TOUTES les cartes ORIGINALES actuellement
// listées (jamais les clones) EN UNE SEULE requête vers le backend
// (verifierExportGroupe, exportEcoute.ts / canal IPC
// 'conserveur:verifier-export-groupe') : chaque carte qui connaît sa
// cibleVerification (zone + id, voir ActionsCarte) y participe ; le
// backend relit uniquement le .json transformé de chaque sujet et
// répond, pour chacun, s'il est exportable ou non
// (verificationExportSujet.ts). Son cibleExport (et donc son badge
// "exportable") est mis à jour en conséquence avant même que la grille
// de sélection groupée ne soit construite.
// Cette requête peut prendre du temps (une lecture disque par sujet,
// côté backend) : une zone bloquante globale (voir zoneBloquante.ts)
// est donc affichée pendant toute l'opération.
// Volontairement SANS try/catch autour de l'appel réseau : si la
// requête échoue, l'erreur doit remonter (visible dans la console) au
// lieu d'être avalée en silence et de laisser croire que tout va bien
// alors qu'aucune carte n'a été mise à jour.
const verifierEtIndexerCartes = async (cartesSource: HTMLElement[]): Promise<void> => {
    const demandes = cartesSource
        .map((carteOriginale) => {
            const action = actionsParCarte.get(carteOriginale);
            return action?.cibleVerification ? { carteOriginale, action, cible: action.cibleVerification } : null;
        })
        .filter((entree): entree is { carteOriginale: HTMLElement; action: ActionsCarte; cible: CibleExport } => !!entree);

    // DEBUG TEMPORAIRE — à retirer une fois le problème identifié.
    console.log('[selection-groupe] demandes envoyées au backend :', demandes.map(({ cible }) => cible));

    if (demandes.length === 0) {
        console.log('[selection-groupe] aucune carte avec cibleVerification -> requête même pas envoyée.');
        return;
    }

    ouvreZoneBloquant('Vérification des sujets exportables...');
    try {
        const resultats = await verifierExportGroupe(demandes.map(({ cible }) => cible));
        // DEBUG TEMPORAIRE — à retirer une fois le problème identifié.
        console.log('[selection-groupe] résultats reçus du backend :', resultats);

        const exportableParCle = new Map(resultats.map((r) => [`${r.zone}:${r.id}`, r.exportable]));

        demandes.forEach(({ carteOriginale, action, cible }) => {
            const exportable = exportableParCle.get(`${cible.zone}:${cible.id}`) ?? false;
            actionsParCarte.set(carteOriginale, {
                ...action,
                cibleExport: exportable ? cible : undefined,
            });
        });
    } finally {
        fermerZoneBloquant();
    }
};

/**
 * Ouvre la zone de sélection groupée d'UNE page (et elle seule).
 * Séquence stricte, rien d'autre : ouverture -> zone de blocage ->
 * requête groupée au backend -> résultat -> fermeture de la zone de
 * blocage -> badges posés sur les cartes exportables (via
 * remplirZoneSelectionGroupe, qui lit cibleExport juste mis à jour).
 */
const ouvrirSelectionGroupe = async (instance: InstanceSelectionGroupe): Promise<void> => {
    instance.actif = true;
    instance.boutonToggle.classList.add('nm-page-cartes-groupe-toggle--actif');

    const cartesSource = Array.from(instance.listeCartes.getElement().querySelectorAll<HTMLElement>('.nm-carte-elt'));
    await verifierEtIndexerCartes(cartesSource);

    // La zone a pu être refermée pendant la vérification (clic sur le
    // bouton toggle) : dans ce cas, ne pas l'afficher malgré tout.
    if (!instance.actif) return;

    remplirZoneSelectionGroupe(instance);
    instance.zoneSelectionGroupe.classList.add('nm-selection-groupe--visible');
};

/** Referme la zone de sélection groupée d'UNE page (et elle seule). */
const fermerSelectionGroupe = (instance: InstanceSelectionGroupe): void => {
    instance.actif = false;
    instance.zoneSelectionGroupe.classList.remove('nm-selection-groupe--visible');
    instance.boutonToggle.classList.remove('nm-page-cartes-groupe-toggle--actif');
};

// Enlève les accents et met en minuscules, pour une recherche plus
// tolérante (ex: "ecoute" retrouve "Écoute").
const normaliserRecherche = (texte: string): string =>
    texte
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim();

/**
 * Vide `page` puis construit son squelette :
 *  - `.nm-page-reste`  : simple div vide (zone d'affichage).
 *  - `.nm-page-cartes` : zone à droite, avec une entête (barre de
 *    recherche + bouton de repliage) au-dessus de la liste de cartes.
 *
 * Repliage : un clic sur le bouton bascule `.nm-page-cartes--repliee`
 * sur `zoneCartes` (largeur réduite, recherche et liste masquées, tout
 * en CSS) — l'appelant n'a rien à faire.
 *
 * Recherche : filtre les cartes déjà présentes (et celles ajoutées
 * ensuite, via un MutationObserver sur la liste) selon le titre de
 * chacune (`.nm-carte-elt-titre`), insensible à la casse/aux accents.
 * Aucun changement requis côté appelants (zoneAccueilTef.ts,
 * zoneAccueilTcfCe.ts, zoneAccueilTcfEe.ts, zoneAccueilTcfEo.ts) : le
 * filtre s'applique automatiquement dès qu'une carte est ajoutée à
 * `listeCartes`.
 */
export const construireCorpsPage = (
    page: HTMLDivElement,
    messageAucuneCarte: string = "Aucune carte pour le moment."
): ZonesCorpsPage => {
    page.innerHTML = "";
    page.classList.add("nm-page-corps");

    // --- Le reste de la page : simple div, vide ---
    const zoneAffichage = document.createElement("div");
    zoneAffichage.classList.add("nm-page-reste");
    page.appendChild(zoneAffichage);

    // --- Zone à droite : entête (recherche + repliage) + colonne de cartes ---
    const zoneCartes = document.createElement("div");
    zoneCartes.classList.add("nm-page-cartes");

    const entete = document.createElement("div");
    entete.className = "nm-page-cartes-entete";

    const zoneRecherche = document.createElement("div");
    zoneRecherche.className = "nm-page-cartes-recherche";

    const iconeRecherche = document.createElement("span");
    iconeRecherche.className = "iconMateriel nm-page-cartes-recherche-icone";
    iconeRecherche.textContent = "search";

    const champRecherche = document.createElement("input");
    champRecherche.type = "text";
    champRecherche.className = "nm-page-cartes-recherche-champ";
    champRecherche.placeholder = "Rechercher...";

    zoneRecherche.append(iconeRecherche, champRecherche);

    const boutonGroupe = document.createElement("button");
    boutonGroupe.type = "button";
    boutonGroupe.className = "nm-page-cartes-groupe-toggle iconMateriel";
    boutonGroupe.textContent = "checklist";
    boutonGroupe.title = "Action groupée";

    const boutonReplier = document.createElement("button");
    boutonReplier.type = "button";
    boutonReplier.className = "nm-page-cartes-toggle iconMateriel";
    boutonReplier.textContent = "chevron_right";
    boutonReplier.title = "Replier les cartes";

    entete.append(zoneRecherche, boutonGroupe, boutonReplier);
    zoneCartes.appendChild(entete);

    const listeCartes = new StackContainer(messageAucuneCarte);
    zoneCartes.appendChild(listeCartes.getElement());

    // --- Repliage : purement visuel, géré en CSS via cette classe ---
    boutonReplier.addEventListener("click", () => {
        const repliee = zoneCartes.classList.toggle("nm-page-cartes--repliee");
        boutonReplier.textContent = repliee ? "chevron_left" : "chevron_right";
        boutonReplier.title = repliee ? "Déplier les cartes" : "Replier les cartes";
    });

    // --- Recherche : (re)filtre chaque carte de listeCartes selon son titre ---
    const filtrerCartes = (): void => {
        const recherche = normaliserRecherche(champRecherche.value);
        Array.from(listeCartes.getElement().children).forEach((enfant) => {
            if (!(enfant instanceof HTMLElement)) return;
            if (enfant.classList.contains("stack-empty-message")) return;
            const titre = enfant.querySelector(".nm-carte-elt-titre");
            const texte = titre ? titre.textContent ?? "" : enfant.textContent ?? "";
            const correspond = recherche === "" || normaliserRecherche(texte).includes(recherche);
            enfant.classList.toggle("nm-carte-item-cachee", !correspond);
        });
    };
    champRecherche.addEventListener("input", filtrerCartes);

    // Réapplique le filtre courant dès qu'une carte est ajoutée/retirée
    // (chargement asynchrone des séries) — aucun appelant n'a besoin de
    // rappeler filtrerCartes lui-même.
    const observateurCartes = new MutationObserver(filtrerCartes);
    observateurCartes.observe(listeCartes.getElement(), { childList: true });

    page.appendChild(zoneCartes);

    // --- Zone de sélection groupée : propre à CETTE page, recouvre
    // toute la page (zoneAffichage + zoneCartes) quand son bouton
    // (boutonGroupe, dans l'entête ci-dessus) l'ouvre. Se referme via ce
    // même bouton ou via son propre bouton de fermeture (voir
    // remplirZoneSelectionGroupe).
    const zoneSelectionGroupe = document.createElement('div');
    zoneSelectionGroupe.className = 'nm-selection-groupe';
    page.appendChild(zoneSelectionGroupe);

    const instance: InstanceSelectionGroupe = {
        zoneSelectionGroupe,
        listeCartes,
        boutonToggle: boutonGroupe,
        actif: false,
    };

    boutonGroupe.addEventListener('click', () => {
        if (instance.actif) {
            fermerSelectionGroupe(instance);
        } else {
            void ouvrirSelectionGroupe(instance);
        }
    });

    return { zoneAffichage, zoneCartes, listeCartes };
};

/** Affiche un simple message dans la zone d'affichage (état vide/inactif). */
export const afficherMessageZone = (zoneAffichage: HTMLDivElement, message: string): void => {
    zoneAffichage.innerHTML = "";
    const el = document.createElement("div");
    el.classList.add("nm-page-reste-message");
    el.textContent = message;
    zoneAffichage.appendChild(el);
};