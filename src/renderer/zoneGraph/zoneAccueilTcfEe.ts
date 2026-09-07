// zoneAccueilTcfEe.ts
//
// Construit la page TCF · EE de l'accueil : zone à droite listant les
// cartes (une par dossier tcf_ee — voir donnee_tcf_ee.ts, backend) et,
// au centre, EXACTEMENT le même mode d'affichage que TCF · EO (voir
// zoneAccueilTcfEo.ts) : une entête, une navigation numérotée à gauche
// (une entrée par PARTIE, avec Préc./Suiv.), et pour la partie
// sélectionnée, une zone par tâche avec sa colonne "Extrait" (fixe, à
// gauche), son bouton de copie (▶) et sa colonne "Transformé" (éditable,
// à droite, enregistrée à la perte de focus).
//
// Seule différence avec l'EO : les libellés des blocs sont FIXES plutôt
// que génériques ("Sujet N"), pour refléter la structure réelle de
// l'épreuve EE :
//   - tache2 (2 éléments)  -> "Tâche 1", "Tâche 2"
//   - tache3 (3 éléments)  -> "Tâche 3 · Thème", "Tâche 3 · Document 1",
//                             "Tâche 3 · Document 2"
//
// Contrairement aux autres types, TCF EE ne passe PAS par
// conserveurDonne.ts : toutes les données viennent de
// donneeTcfEeApi.ts, qui ne parle qu'aux canaux 'tcf-ee:*' (câblés sur
// donnee_tcf_ee.ts côté backend — seule source de vérité pour l'EE du
// TCF).
import { construireCorpsPage, afficherMessageZone, enregistrerActionsCarte } from '../composer/corpsPage.js';
import { Selecteur } from '../generale/selecteur.js';
import { creerBoutonSupprimerCarte } from '../generale/carteSuppression.js';
import { creerMessage, typeErreur } from './gestionMessage.js';
import { creerBoutonExportZone, afficherBoutonExportZone } from './boutonExportZone.js';
import { estQuestionExportable, estSerieTcfEeExportable } from './verificationExport.js';
import { construireSectionStats, calculerStatsExtraitTcfEeEo, calculerStatsTransformeTcfEeEo } from './statsElement.js';
import {
    CarteTcfEe,
    PartieEE,
    listerTcfEe,
    lireTcfEe,
    sauvegarderTransformeTcfEe,
    supprimerTcfEe,
} from './donneeTcfEeApi.js';
import { sauvegarderSsConserveur } from './donneeApi.js';

// Libellés fixes des blocs (voir en-tête du fichier).
const LIBELLES_TACHE2 = ['Tâche 1', 'Tâche 2'];
const LIBELLES_TACHE3 = ['Tâche 3 · Thème', 'Tâche 3 · Document 1', 'Tâche 3 · Document 2'];

/**
 * Construit le corps de la page TCF · EE : zone à droite (une carte
 * par dossier tcf_ee) + zone d'affichage (centre, navigation par
 * partie + zones Tâche 1/2/3).
 */
export const remplirZoneTcfEe = async (page: HTMLDivElement): Promise<void> => {
    const { zoneAffichage, listeCartes } = construireCorpsPage(
        page,
        'Aucune donnée EE extraite pour le moment.'
    );
    afficherMessageZone(zoneAffichage, 'Sélectionnez une carte pour afficher son contenu.');

    const selecteurCartes = new Selecteur<HTMLDivElement>(
        (carte) => carte.classList.add('nm-carte-elt-actif'),
        (carte) => carte.classList.remove('nm-carte-elt-actif')
    );

    listeCartes.setEmptyMessage('Chargement des données EE...');
    try {
        const cartes = await listerTcfEe();
        listeCartes.setEmptyMessage('Aucune donnée EE extraite pour le moment.');

        // ouvrirPremiereCarte retient le déclenchement (mêmes actions que
        // le clic) de la toute première carte affichée, pour l'ouvrir
        // automatiquement une fois la liste construite (voir plus bas) :
        // dès qu'il y a au moins une carte, une carte reste toujours
        // ouverte au centre plutôt que le message "Sélectionnez...".
        let ouvrirPremiereCarte: (() => void) | null = null;

        for (const infoCarte of cartes) {
            // Une carte défectueuse (ex. ancien JSON mal formé) ne doit
            // PAS empêcher l'affichage des autres ni l'ouverture auto.
            try {
                const resultat = await lireTcfEe(infoCarte.id);
                const extrait = resultat.success ? (resultat.extrait ?? []) : [];
                let transforme = resultat.success ? (resultat.transforme ?? extrait) : null;
                // Normalise si le backend renvoie encore { ss, items }.
                if (transforme && !Array.isArray(transforme) && Array.isArray((transforme as any).items)) {
                    const ss = typeof (transforme as any).ss === 'string' ? (transforme as any).ss : '';
                    transforme = (transforme as any).items;
                    if (ss) (transforme as any).ss = ss;
                }

                const ouvrirCarte = () => {
                    selecteurCartes.selectUnique(carte);
                    void afficherContenuTcfEe(zoneAffichage, infoCarte);
                };
                const carte = creerCarteTcfEe(infoCarte, extrait, transforme, ouvrirCarte, () =>
                    void remplirZoneTcfEe(page)
                );
                listeCartes.addItem(carte);

                if (!ouvrirPremiereCarte) ouvrirPremiereCarte = ouvrirCarte;
            } catch (err) {
                console.error('[TCF EE] carte ignorée (chargement):', infoCarte.id, err);
            }
        }

        // Ouvre par défaut la première carte, s'il y en a au moins une.
        ouvrirPremiereCarte?.();
    } catch {
        listeCartes.setEmptyMessage('Erreur lors du chargement des données EE.');
    }
};

// Pour retrouver, après une sauvegarde, la section "Transformé" d'une
// carte déjà construite, afin de rafraîchir ses stats sans tout
// reconstruire — même principe que cartesSuivies dans
// zoneAccueilTef.ts. Sert aussi à remettre à jour le badge
// "exportable" (voir enregistrerActionsCarte plus bas) sans
// reconstruire la carte. Clé : l'id de la carte (infoCarte.id).
interface CarteTcfEeSuivie {
    carte: HTMLDivElement;
    zoneStats: HTMLDivElement;
    sectionTrans: HTMLDivElement;
    extrait: PartieEE[];
    infoCarte: CarteTcfEe;
    nom: string;
    supprimer: () => Promise<{ success: boolean; error?: string }>;
    rafraichirPage: () => void;
}
const cartesTcfEeSuivies = new Map<string, CarteTcfEeSuivie>();

// Construit la carte représentant un dossier tcf_ee : entête
// (badge + titre) puis stats Extrait/Transformé — même gabarit que les
// cartes TEF/TCF · CO (voir creerCarteElement, zoneAccueilTef.ts).
const creerCarteTcfEe = (
    infoCarte: CarteTcfEe,
    extrait: PartieEE[],
    transforme: PartieEE[] | null,
    onClick: () => void,
    onSupprime: () => void
): HTMLDivElement => {
    const carte = document.createElement('div');
    carte.className = 'nm-carte-elt nm-carte-elt--ee';
    carte.addEventListener('click', onClick);

    const entete = document.createElement('div');
    entete.className = 'nm-carte-elt-entete';

    const badge = document.createElement('span');
    badge.className = 'nm-carte-elt-badge';
    badge.textContent = 'EE';

    const titre = document.createElement('span');
    titre.className = 'nm-carte-elt-titre';
    titre.textContent = infoCarte.nom;
    titre.title = infoCarte.nom;

    const supprimerCarte = () => supprimerTcfEe(infoCarte.id);
    const boutonSuppr = creerBoutonSupprimerCarte(infoCarte.nom, supprimerCarte, onSupprime);

    entete.append(badge, titre, boutonSuppr);
    carte.appendChild(entete);

    const zoneStats = document.createElement('div');
    zoneStats.className = 'nm-carte-elt-stats';

    const sectionExtrait = construireSectionStats('Extrait', 'extrait', calculerStatsExtraitTcfEeEo(extrait));
    const sectionTrans = construireSectionStats('Transformé', 'trans', calculerStatsTransformeTcfEeEo(transforme));
    zoneStats.append(sectionExtrait, sectionTrans);
    carte.appendChild(zoneStats);

    cartesTcfEeSuivies.set(infoCarte.id, {
        carte,
        zoneStats,
        sectionTrans,
        extrait,
        infoCarte,
        nom: infoCarte.nom,
        supprimer: supprimerCarte,
        rafraichirPage: onSupprime,
    });

    // Actions réelles de cette carte, utilisées par la sélection
    // groupée (voir corpsPage.ts). Le badge "exportable" ne doit
    // apparaître que si le dossier est réellement prêt à l'exportation
    // dès maintenant (estSerieTcfEeExportable, verificationExport.ts —
    // mêmes règles que le bouton d'export de la zone d'affichage).
    const exportableEe = estSerieTcfEeExportable(extrait, transforme);
    enregistrerActionsCarte(carte, {
        nom: infoCarte.nom,
        supprimer: supprimerCarte,
        rafraichirPage: onSupprime,
        cibleExport: exportableEe ? { zone: 'tcf-ee', id: infoCarte.id } : undefined,
        // Identité fixe (zone + id) de cette carte : utilisée par la
        // sélection groupée pour vérifier son exportabilité auprès du
        // backend, EN UNE SEULE requête pour toutes les cartes listées
        // (voir verifierEtIndexerCartes dans corpsPage.ts, et
        // verificationExportSujet.ts côté backend).
        cibleVerification: { zone: 'tcf-ee', id: infoCarte.id },
    });

    return carte;
};

// Rafraîchit la section "Transformé" d'une carte déjà construite, juste
// après une sauvegarde (voir enregistrer, plus bas) : les stats
// reflètent alors immédiatement l'état en mémoire (etatTransforme) —
// et remet à jour son badge "exportable" en conséquence (même règle
// qu'à la construction).
const rafraichirCarteTcfEeApresSauvegarde = (idCarte: string, parties: PartieEE[]): void => {
    const suivie = cartesTcfEeSuivies.get(idCarte);
    if (!suivie) return;
    const nouvelleSection = construireSectionStats('Transformé', 'trans', calculerStatsTransformeTcfEeEo(parties));
    suivie.zoneStats.replaceChild(nouvelleSection, suivie.sectionTrans);
    suivie.sectionTrans = nouvelleSection;
    cartesTcfEeSuivies.set(idCarte, suivie);

    const exportableEeSauvegarde = estSerieTcfEeExportable(suivie.extrait, parties);
    enregistrerActionsCarte(suivie.carte, {
        nom: suivie.nom,
        supprimer: suivie.supprimer,
        rafraichirPage: suivie.rafraichirPage,
        cibleExport: exportableEeSauvegarde ? { zone: 'tcf-ee', id: idCarte } : undefined,
        cibleVerification: { zone: 'tcf-ee', id: idCarte },
    });
};

// Affiche, dans la zone d'affichage, le contenu d'une carte tcf_ee :
// navigation numérotée (une entrée par partie) + zones Tâche 1/2/3 de
// la partie sélectionnée.
const afficherContenuTcfEe = async (zoneAffichage: HTMLDivElement, infoCarte: CarteTcfEe): Promise<void> => {
    afficherMessageZone(zoneAffichage, 'Chargement...');

    const resultat = await lireTcfEe(infoCarte.id);
    if (!resultat.success) {
        afficherMessageZone(zoneAffichage, resultat.error ?? 'Impossible de charger cette donnée.');
        return;
    }

    const extrait = resultat.extrait ?? [];
    let transforme = resultat.transforme ?? extrait;
    // Normalise si le JSON disque est encore sous forme { ss, items }.
    if (transforme && !Array.isArray(transforme) && Array.isArray((transforme as any).items)) {
        const ss = typeof (transforme as any).ss === 'string' ? (transforme as any).ss : '';
        transforme = (transforme as any).items;
        if (ss) (transforme as any).ss = ss;
    }
    if (!Array.isArray(transforme)) transforme = [];
    if (extrait.length === 0) {
        afficherMessageZone(zoneAffichage, 'Aucune partie à afficher.');
        return;
    }

    // Fusion extrait ↔ transformé (même logique que le backend) :
    //  - même nomPartie (sinon index) → on garde le transformé édité ;
    //  - partie absente du transformé → on prend l'extrait ;
    //  - l'ordre / le nombre suivent l'extrait.
    // Ainsi l'affichage et le fichier trans_ee.json restent alignés
    // même sans re-extraction.
    const parNomTrans = new Map<string, PartieEE>();
    for (const p of transforme) {
        const cle = (p.nomPartie ?? '').trim();
        if (cle) parNomTrans.set(cle, p);
    }
    const etatTransforme: PartieEE[] = extrait.map((partie, index) => {
        const cle = (partie.nomPartie ?? '').trim();
        const existante = (cle ? parNomTrans.get(cle) : undefined) ?? transforme[index];
        if (!existante) {
            return {
                nomPartie: partie.nomPartie,
                tache2: [...(partie.tache2 ?? [])],
                tache3: [...(partie.tache3 ?? [])],
            };
        }
        return {
            nomPartie: partie.nomPartie ?? existante.nomPartie,
            tache2: Array.isArray(existante.tache2) ? [...existante.tache2] : [...(partie.tache2 ?? [])],
            tache3: Array.isArray(existante.tache3) ? [...existante.tache3] : [...(partie.tache3 ?? [])],
        };
    });

    // Si le transformé disque était incomplet (ex. 5 alors que l'extrait
    // en a 19), on le réécrit tout de suite pour que l'export lise la
    // même chose que l'affichage.
    const nomsTrans = new Set(
        transforme.map((p) => (p.nomPartie ?? '').trim()).filter((c) => c.length > 0)
    );
    const transformeIncomplet =
        transforme.length !== etatTransforme.length
        || extrait.some((p) => {
            const c = (p.nomPartie ?? '').trim();
            return c.length > 0 && !nomsTrans.has(c);
        });
    if (transformeIncomplet) {
        void sauvegarderTransformeTcfEe(infoCarte.id, etatTransforme).then((res) => {
            if (!res.success) {
                creerMessage(typeErreur, infoCarte.nom, res.error ?? 'Échec de la synchronisation du transformé.');
            }
        });
    }

    const enregistrer = (): void => {
        rafraichirCarteTcfEeApresSauvegarde(infoCarte.id, etatTransforme);
        void sauvegarderTransformeTcfEe(infoCarte.id, etatTransforme).then((res) => {
            if (!res.success) creerMessage(typeErreur, infoCarte.nom, res.error ?? "Échec de l'enregistrement.");
        });
        rafraichirIndicateursExport();
    };

    // --- Construction de la zone (entête + navigation + contenu) ---
    zoneAffichage.innerHTML = '';

    const racine = document.createElement('div');
    racine.className = 'affichage-embed';

    const enteteEmbed = document.createElement('div');
    enteteEmbed.className = 'affichage-embed-entete';

    const enteteTitre = document.createElement('span');
    enteteTitre.className = 'affichage-embed-entete-titre';
    enteteTitre.textContent = `${infoCarte.nom} — EE`;
    enteteEmbed.appendChild(enteteTitre);

    // Champ "Nom du sujet (ss)" — même comportement que zoneAff.ts
    // (TEF / TCF·CO) : vide = auto via decouperSerieEtTest à l'export.
    const zoneSs = document.createElement('div');
    zoneSs.className = 'affichage-embed-ss';
    const labelSs = document.createElement('label');
    labelSs.className = 'affichage-embed-ss-label';
    labelSs.textContent = 'Nom du sujet';
    zoneSs.appendChild(labelSs);
    const inputSs = document.createElement('input');
    inputSs.type = 'text';
    inputSs.className = 'affichage-embed-ss-input';
    inputSs.placeholder = 'Auto (depuis le titre)';
    inputSs.setAttribute('spellcheck', 'false');
    inputSs.setAttribute('autocomplete', 'off');
    // ss renvoyé séparément par lireTcfEe (pas en propriété du tableau :
    // perdu à travers l'IPC sinon).
    const ssInitial = typeof (resultat as any)?.ss === 'string'
        ? String((resultat as any).ss).trim()
        : (typeof (transforme as any)?.ss === 'string' ? String((transforme as any).ss).trim() : '');
    inputSs.value = ssInitial;
    let ssCourant = ssInitial;
    zoneSs.appendChild(inputSs);
    const indicateurSs = document.createElement('span');
    indicateurSs.className = 'zed-statut-save';
    zoneSs.appendChild(indicateurSs);
    const definirStatutSs = (statut: 'enregistrement' | 'ok' | 'erreur' | null): void => {
        indicateurSs.className = 'zed-statut-save';
        if (!statut) { indicateurSs.textContent = ''; return; }
        indicateurSs.classList.add(`zed-statut-save--${statut}`);
        indicateurSs.textContent = statut === 'enregistrement' ? 'Enregistrement...'
            : statut === 'ok' ? 'Enregistré ✓' : "Échec de l'enregistrement";
        if (statut === 'ok') setTimeout(() => { indicateurSs.className = 'zed-statut-save'; indicateurSs.textContent = ''; }, 2200);
    };
    const enregistrerSsSiModifie = async (): Promise<void> => {
        const valeur = (inputSs.value ?? '').trim();
        if (valeur === ssCourant) return;
        definirStatutSs('enregistrement');
        try {
            const res = await sauvegarderSsConserveur('tcf', 'ee', infoCarte.id, valeur);
            if (res.success) { ssCourant = valeur; definirStatutSs('ok'); }
            else definirStatutSs('erreur');
        } catch { definirStatutSs('erreur'); }
    };
    inputSs.addEventListener('blur', () => { void enregistrerSsSiModifie(); });
    inputSs.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); inputSs.blur(); } });
    enteteEmbed.appendChild(zoneSs);

    // Indicateur d'exportabilité : reste vide tant que toutes les
    // parties ne sont pas prêtes à l'exportation, sinon affiche
    // combien il en reste à corriger (voir rafraichirIndicateursExport
    // plus bas, appelée à l'ouverture et à chaque modification, via
    // enregistrer()).
    const zoneExportStatut = document.createElement('span');
    zoneExportStatut.className = 'affichage-embed-export-statut';
    enteteEmbed.appendChild(zoneExportStatut);

    const boutonExport = creerBoutonExportZone('tcf-ee', () => infoCarte.id);
    enteteEmbed.appendChild(boutonExport);

    racine.appendChild(enteteEmbed);

    const layout = document.createElement('div');
    layout.className = 'affichage-layout';

    const nav = document.createElement('div');
    nav.className = 'affichage-nav';

    const zoneNavListe = document.createElement('div');
    zoneNavListe.className = 'affichage-nav-liste';
    nav.appendChild(zoneNavListe);

    const navigation = document.createElement('div');
    navigation.className = 'affichage-nav-navigation';

    const btnPrecedent = document.createElement('button');
    btnPrecedent.className = 'affichage-nav-fleche';
    btnPrecedent.textContent = '◀ Préc.';

    const indicateurPosition = document.createElement('div');
    indicateurPosition.className = 'affichage-nav-indicateur';

    const btnSuivant = document.createElement('button');
    btnSuivant.className = 'affichage-nav-fleche';
    btnSuivant.textContent = 'Suiv. ▶';

    navigation.append(btnPrecedent, indicateurPosition, btnSuivant);
    nav.appendChild(navigation);

    const zoneContenu = document.createElement('div');
    zoneContenu.className = 'affichage-contenu';

    layout.append(nav, zoneContenu);
    racine.appendChild(layout);
    zoneAffichage.appendChild(racine);

    let indexCourant = 0;
    let boutonsNav: HTMLButtonElement[] = [];

    // Recalcule, pour CHAQUE partie de la carte ouverte, son état
    // "prête à l'exportation" (voir estQuestionExportable dans
    // verificationExport.ts), puis met à jour le style distinctif du
    // bouton numéroté correspondant ainsi que le message d'entête
    // (rien ne s'affiche dès que tout est prêt).
    const rafraichirIndicateursExport = (): void => {
        let nombreNonPrets = 0;
        extrait.forEach((partieExtrait, index) => {
            const pret = estQuestionExportable('tcf-ee', partieExtrait, etatTransforme[index]);
            if (!pret) nombreNonPrets++;
            boutonsNav[index]?.classList.toggle('affichage-nav-btn--exportable', pret);
        });

        afficherBoutonExportZone(boutonExport, extrait.length > 0 && nombreNonPrets === 0);

        if (extrait.length === 0 || nombreNonPrets === 0) {
            zoneExportStatut.textContent = '';
            zoneExportStatut.classList.remove('affichage-embed-export-statut--visible');
        } else {
            zoneExportStatut.textContent = nombreNonPrets === 1
                ? '1 partie à corriger avant l’exportation'
                : `${nombreNonPrets} parties à corriger avant l’exportation`;
            zoneExportStatut.classList.add('affichage-embed-export-statut--visible');
        }
    };

    const selectionnerIndex = (index: number): void => {
        if (index < 0 || index >= extrait.length) return;
        indexCourant = index;

        boutonsNav.forEach((btn, i) => btn.classList.toggle('affichage-nav-btn--active', i === index));
        boutonsNav[index]?.scrollIntoView({ block: 'nearest' });

        const partieExtrait = extrait[index];
        const partieTrans = etatTransforme[index];

        zoneContenu.innerHTML = '';

        const entete = document.createElement('div');
        entete.className = 'affichage-contenu-entete';
        const titre = document.createElement('h3');
        titre.className = 'affichage-contenu-titre';
        titre.textContent = partieExtrait.nomPartie || `Partie ${index + 1}`;
        entete.appendChild(titre);
        zoneContenu.appendChild(entete);

        construireZonesTache(LIBELLES_TACHE2, partieExtrait.tache2 ?? [], partieTrans, 'tache2', enregistrer)
            .forEach((zone) => zoneContenu.appendChild(zone));
        construireZonesTache(LIBELLES_TACHE3, partieExtrait.tache3 ?? [], partieTrans, 'tache3', enregistrer)
            .forEach((zone) => zoneContenu.appendChild(zone));

        indicateurPosition.textContent = `${index + 1} / ${extrait.length}`;
        btnPrecedent.disabled = index === 0;
        btnSuivant.disabled = index === extrait.length - 1;
    };

    btnPrecedent.addEventListener('click', () => selectionnerIndex(indexCourant - 1));
    btnSuivant.addEventListener('click', () => selectionnerIndex(indexCourant + 1));

    zoneNavListe.innerHTML = '';
    boutonsNav = extrait.map((_, index) => {
        const btn = document.createElement('button');
        btn.className = 'affichage-nav-btn';
        btn.textContent = String(index + 1);
        btn.addEventListener('click', () => selectionnerIndex(index));
        zoneNavListe.appendChild(btn);
        return btn;
    });

    rafraichirIndicateursExport();
    selectionnerIndex(0);
};

// Construit un bloc (titre + colonne extrait + bouton de copie + colonne
// transformée) par élément du tableau `champ`, avec un libellé FIXE
// (voir LIBELLES_TACHE2/LIBELLES_TACHE3) plutôt que générique — si le
// tableau reçu est plus long que la liste de libellés prévue, les
// éléments en trop retombent sur un libellé générique de secours.
const construireZonesTache = (
    libelles: string[],
    paragraphesExtrait: string[],
    partieTrans: PartieEE,
    champ: 'tache2' | 'tache3',
    enregistrer: () => void
): HTMLDivElement[] => {
    const transExistant = partieTrans[champ] ?? [];
    const nb = Math.max(paragraphesExtrait.length, transExistant.length, libelles.length);

    const zones: HTMLDivElement[] = [];
    for (let i = 0; i < nb; i++) {
        const titreZone = libelles[i] ?? `${champ === 'tache2' ? 'Tâche 1/2' : 'Tâche 3'} · Sujet ${i + 1}`;
        zones.push(
            construireZoneSujet(titreZone, paragraphesExtrait[i] ?? '', partieTrans, champ, i, enregistrer)
        );
    }
    return zones;
};

const construireZoneSujet = (
    titreZone: string,
    extraitTexte: string,
    partieTrans: PartieEE,
    champ: 'tache2' | 'tache3',
    index: number,
    enregistrer: () => void
): HTMLDivElement => {
    const carte = document.createElement('div');
    carte.className = 'zed-zone';

    const titre = document.createElement('h4');
    titre.className = 'zed-zone-titre';
    titre.textContent = titreZone;
    carte.appendChild(titre);

    const corps = document.createElement('div');
    corps.className = 'zed-zone-corps';

    // Colonne extrait (fixe)
    const colExtrait = document.createElement('div');
    colExtrait.className = 'zed-col zed-col-extrait';
    const labelExtrait = document.createElement('div');
    labelExtrait.className = 'zed-col-label';
    labelExtrait.textContent = 'Extrait';
    colExtrait.appendChild(labelExtrait);

    const contenuExtrait = document.createElement('div');
    contenuExtrait.className = 'zed-extrait-contenu';
    if (!extraitTexte) {
        contenuExtrait.classList.add('zed-vide');
        contenuExtrait.textContent = 'Aucun contenu extrait.';
    } else {
        const bloc = document.createElement('div');
        bloc.className = 'zed-texte';
        bloc.textContent = extraitTexte;
        contenuExtrait.appendChild(bloc);
    }
    colExtrait.appendChild(contenuExtrait);

    // Bouton de copie (extrait -> transformé)
    const colBouton = document.createElement('div');
    colBouton.className = 'zed-col-bouton';
    const btnCopier = document.createElement('button');
    btnCopier.type = 'button';
    btnCopier.className = 'zed-copier-btn';
    btnCopier.textContent = '▶';
    btnCopier.disabled = !extraitTexte;
    btnCopier.title = !extraitTexte
        ? "Aucun extrait à copier ici."
        : "Copier l'extrait vers la partie transformée";
    colBouton.appendChild(btnCopier);

    // Colonne transformée (éditable) — une entrée précise du tableau
    // tache2/tache3 (partieTrans[champ][index]), pas le tableau entier.
    const colTrans = document.createElement('div');
    colTrans.className = 'zed-col zed-col-trans';
    const labelTrans = document.createElement('div');
    labelTrans.className = 'zed-col-label';
    const { element: indicateurStatut, definirStatut } = creerIndicateurStatutSimple();
    labelTrans.textContent = 'Transformé';
    labelTrans.appendChild(indicateurStatut);
    colTrans.appendChild(labelTrans);

    const zoneTransContenu = document.createElement('div');
    zoneTransContenu.className = 'zed-col-trans-contenu';

    const zoneTexte = document.createElement('textarea');
    zoneTexte.className = 'zed-textarea-trans';
    zoneTexte.value = (partieTrans[champ] ?? [])[index] ?? '';
    zoneTexte.placeholder = 'Saisissez le texte transformé...';
    zoneTexte.rows = 1;

    const ajusterHauteur = (): void => {
        zoneTexte.style.height = 'auto';
        zoneTexte.style.height = `${zoneTexte.scrollHeight}px`;
    };
    zoneTexte.addEventListener('input', ajusterHauteur);
    requestAnimationFrame(ajusterHauteur);

    // Écrit à l'index précis du tableau (en l'agrandissant si besoin),
    // sans toucher aux autres sujets de la même tâche.
    const ecrireDansPartieTrans = (texte: string): void => {
        const tableau = [...(partieTrans[champ] ?? [])];
        while (tableau.length <= index) tableau.push('');
        tableau[index] = texte;
        partieTrans[champ] = tableau;
    };

    zoneTexte.addEventListener('blur', () => {
        ecrireDansPartieTrans(zoneTexte.value);
        definirStatut('enregistrement');
        enregistrer();
        definirStatut('ok');
    });

    btnCopier.addEventListener('click', () => {
        zoneTexte.value = extraitTexte;
        ecrireDansPartieTrans(extraitTexte);
        ajusterHauteur();
        definirStatut('enregistrement');
        enregistrer();
        definirStatut('ok');
    });

    zoneTransContenu.appendChild(zoneTexte);
    colTrans.appendChild(zoneTransContenu);

    corps.append(colExtrait, colBouton, colTrans);
    carte.appendChild(corps);
    return carte;
};

// Petit indicateur textuel discret ("Enregistré ✓" / "Échec"), même
// comportement que creerIndicateurStatut dans zoneAff.ts.
const creerIndicateurStatutSimple = (): {
    element: HTMLSpanElement;
    definirStatut: (statut: 'enregistrement' | 'ok' | 'erreur' | null) => void;
} => {
    const element = document.createElement('span');
    element.className = 'zed-statut-save';
    let minuteur: ReturnType<typeof setTimeout> | null = null;

    const definirStatut = (statut: 'enregistrement' | 'ok' | 'erreur' | null): void => {
        if (minuteur) { clearTimeout(minuteur); minuteur = null; }
        element.className = 'zed-statut-save';
        if (!statut) { element.textContent = ''; return; }
        element.classList.add(`zed-statut-save--${statut}`);
        element.textContent = statut === 'enregistrement'
            ? 'Enregistrement...'
            : statut === 'ok'
                ? 'Enregistré ✓'
                : "Échec de l'enregistrement";
        if (statut === 'ok') {
            minuteur = setTimeout(() => {
                element.className = 'zed-statut-save';
                element.textContent = '';
            }, 2200);
        }
    };

    return { element, definirStatut };
};