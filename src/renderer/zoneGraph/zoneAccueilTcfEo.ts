// zoneAccueilTcfEo.ts
//
// Construit la page TCF · EO de l'accueil : zone à droite listant les
// cartes (une par dossier tcf_eo — voir donnee_tcf_eo.ts, backend) et,
// au centre, EXACTEMENT le même mode d'affichage que TEF/EE (voir
// zoneAff.ts) : une entête, une navigation numérotée à gauche (une
// entrée par PARTIE, avec Préc./Suiv.), et pour la partie sélectionnée,
// une zone par tâche (Tâche 2 / Tâche 3) avec sa colonne "Extrait"
// (fixe, à gauche), son bouton de copie (▶) et sa colonne "Transformé"
// (éditable, à droite, enregistrée à la perte de focus).
//
// Contrairement aux autres types, TCF EO ne passe PAS par
// conserveurDonne.ts : toutes les données viennent de
// donneeTcfEoApi.ts, qui ne parle qu'aux canaux 'tcf-eo:*' (câblés sur
// donnee_tcf_eo.ts côté backend — seule source de vérité pour l'EO du
// TCF). Le transformé (trans_eo.json) est ici un tableau parallèle à
// l'extrait, une entrée par partie, avec tache2/tache3 sous forme de
// texte libre (un paragraphe par ligne vide, comme pour l'extrait).
import { construireCorpsPage, afficherMessageZone, enregistrerActionsCarte } from '../composer/corpsPage.js';
import { Selecteur } from '../generale/selecteur.js';
import { creerBoutonSupprimerCarte } from '../generale/carteSuppression.js';
import { creerMessage, typeErreur } from './gestionMessage.js';
import { creerBoutonExportZone, afficherBoutonExportZone } from './boutonExportZone.js';
import { estQuestionExportable, estSerieTcfEoExportable } from './verificationExport.js';
import { construireSectionStats, calculerStatsExtraitTcfEeEo, calculerStatsTransformeTcfEeEo } from './statsElement.js';
import {
    CarteTcfEo,
    PartieEO,
    listerTcfEo,
    lireTcfEo,
    sauvegarderTransformeTcfEo,
    supprimerTcfEo,
} from './donneeTcfEoApi.js';
import { sauvegarderSsConserveur } from './donneeApi.js';

/**
 * Construit le corps de la page TCF · EO : zone à droite (une carte
 * par dossier tcf_eo) + zone d'affichage (centre, navigation par
 * partie + zones Tâche 2 / Tâche 3).
 */
export const remplirZoneTcfEo = async (page: HTMLDivElement): Promise<void> => {
    const { zoneAffichage, listeCartes } = construireCorpsPage(
        page,
        'Aucune donnée EO extraite pour le moment.'
    );
    afficherMessageZone(zoneAffichage, 'Sélectionnez une carte pour afficher son contenu.');

    const selecteurCartes = new Selecteur<HTMLDivElement>(
        (carte) => carte.classList.add('nm-carte-elt-actif'),
        (carte) => carte.classList.remove('nm-carte-elt-actif')
    );

    listeCartes.setEmptyMessage('Chargement des données EO...');
    try {
        const cartes = await listerTcfEo();
        listeCartes.setEmptyMessage('Aucune donnée EO extraite pour le moment.');

        // ouvrirPremiereCarte retient le déclenchement (mêmes actions que
        // le clic) de la toute première carte affichée, pour l'ouvrir
        // automatiquement une fois la liste construite (voir plus bas) :
        // dès qu'il y a au moins une carte, une carte reste toujours
        // ouverte au centre plutôt que le message "Sélectionnez...".
        let ouvrirPremiereCarte: (() => void) | null = null;

        for (const infoCarte of cartes) {
            try {
                const resultat = await lireTcfEo(infoCarte.id);
                const extrait = resultat.success ? (resultat.extrait ?? []) : [];
                let transforme = resultat.success ? (resultat.transforme ?? extrait) : null;
                if (transforme && !Array.isArray(transforme) && Array.isArray((transforme as any).items)) {
                    const ss = typeof (transforme as any).ss === 'string' ? (transforme as any).ss : '';
                    transforme = (transforme as any).items;
                    if (ss) (transforme as any).ss = ss;
                }

                const ouvrirCarte = () => {
                    selecteurCartes.selectUnique(carte);
                    void afficherContenuTcfEo(zoneAffichage, infoCarte);
                };
                const carte = creerCarteTcfEo(infoCarte, extrait, transforme, ouvrirCarte, () =>
                    void remplirZoneTcfEo(page)
                );
                listeCartes.addItem(carte);

                if (!ouvrirPremiereCarte) ouvrirPremiereCarte = ouvrirCarte;
            } catch (err) {
                console.error('[TCF EO] carte ignorée (chargement):', infoCarte.id, err);
            }
        }

        // Ouvre par défaut la première carte, s'il y en a au moins une.
        ouvrirPremiereCarte?.();
    } catch {
        listeCartes.setEmptyMessage('Erreur lors du chargement des données EO.');
    }
};

// Pour retrouver, après une sauvegarde, la section "Transformé" d'une
// carte déjà construite, afin de rafraîchir ses stats sans tout
// reconstruire — même principe que cartesSuivies dans
// zoneAccueilTef.ts. Sert aussi à remettre à jour le badge
// "exportable" (voir enregistrerActionsCarte plus bas) sans
// reconstruire la carte. Clé : l'id de la carte (infoCarte.id).
interface CarteTcfEoSuivie {
    carte: HTMLDivElement;
    zoneStats: HTMLDivElement;
    sectionTrans: HTMLDivElement;
    extrait: PartieEO[];
    infoCarte: CarteTcfEo;
    nom: string;
    supprimer: () => Promise<{ success: boolean; error?: string }>;
    rafraichirPage: () => void;
}
const cartesTcfEoSuivies = new Map<string, CarteTcfEoSuivie>();

// Construit la carte représentant un dossier tcf_eo : entête
// (badge + titre) puis stats Extrait/Transformé — même gabarit que les
// cartes TEF/TCF · CO (voir creerCarteElement, zoneAccueilTef.ts).
const creerCarteTcfEo = (
    infoCarte: CarteTcfEo,
    extrait: PartieEO[],
    transforme: PartieEO[] | null,
    onClick: () => void,
    onSupprime: () => void
): HTMLDivElement => {
    const carte = document.createElement('div');
    carte.className = 'nm-carte-elt nm-carte-elt--eo';
    carte.addEventListener('click', onClick);

    const entete = document.createElement('div');
    entete.className = 'nm-carte-elt-entete';

    const badge = document.createElement('span');
    badge.className = 'nm-carte-elt-badge';
    badge.textContent = 'EO';

    const titre = document.createElement('span');
    titre.className = 'nm-carte-elt-titre';
    titre.textContent = infoCarte.nom;
    titre.title = infoCarte.nom;

    const supprimerCarte = () => supprimerTcfEo(infoCarte.id);
    const boutonSuppr = creerBoutonSupprimerCarte(infoCarte.nom, supprimerCarte, onSupprime);

    entete.append(badge, titre, boutonSuppr);
    carte.appendChild(entete);

    const zoneStats = document.createElement('div');
    zoneStats.className = 'nm-carte-elt-stats';

    const sectionExtrait = construireSectionStats('Extrait', 'extrait', calculerStatsExtraitTcfEeEo(extrait));
    const sectionTrans = construireSectionStats('Transformé', 'trans', calculerStatsTransformeTcfEeEo(transforme));
    zoneStats.append(sectionExtrait, sectionTrans);
    carte.appendChild(zoneStats);

    cartesTcfEoSuivies.set(infoCarte.id, {
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
    // dès maintenant (estSerieTcfEoExportable, verificationExport.ts —
    // mêmes règles que le bouton d'export de la zone d'affichage).
    const exportableEo = estSerieTcfEoExportable(extrait, transforme);
    enregistrerActionsCarte(carte, {
        nom: infoCarte.nom,
        supprimer: supprimerCarte,
        rafraichirPage: onSupprime,
        cibleExport: exportableEo ? { zone: 'tcf-eo', id: infoCarte.id } : undefined,
        // Identité fixe (zone + id) de cette carte : utilisée par la
        // sélection groupée pour vérifier son exportabilité auprès du
        // backend, EN UNE SEULE requête pour toutes les cartes listées
        // (voir verifierEtIndexerCartes dans corpsPage.ts, et
        // verificationExportSujet.ts côté backend).
        cibleVerification: { zone: 'tcf-eo', id: infoCarte.id },
    });

    return carte;
};

// Rafraîchit la section "Transformé" d'une carte déjà construite, juste
// après une sauvegarde (voir enregistrer, plus bas) : les stats
// reflètent alors immédiatement l'état en mémoire (etatTransforme) —
// et remet à jour son badge "exportable" en conséquence (même règle
// qu'à la construction).
const rafraichirCarteTcfEoApresSauvegarde = (idCarte: string, parties: PartieEO[]): void => {
    const suivie = cartesTcfEoSuivies.get(idCarte);
    if (!suivie) return;
    const nouvelleSection = construireSectionStats('Transformé', 'trans', calculerStatsTransformeTcfEeEo(parties));
    suivie.zoneStats.replaceChild(nouvelleSection, suivie.sectionTrans);
    suivie.sectionTrans = nouvelleSection;
    cartesTcfEoSuivies.set(idCarte, suivie);

    const exportableEoSauvegarde = estSerieTcfEoExportable(suivie.extrait, parties);
    enregistrerActionsCarte(suivie.carte, {
        nom: suivie.nom,
        supprimer: suivie.supprimer,
        rafraichirPage: suivie.rafraichirPage,
        cibleExport: exportableEoSauvegarde ? { zone: 'tcf-eo', id: idCarte } : undefined,
        cibleVerification: { zone: 'tcf-eo', id: idCarte },
    });
};

// Affiche, dans la zone d'affichage, le contenu d'une carte tcf_eo :
// navigation numérotée (une entrée par partie) + zones Tâche 2/Tâche 3
// de la partie sélectionnée.
const afficherContenuTcfEo = async (zoneAffichage: HTMLDivElement, infoCarte: CarteTcfEo): Promise<void> => {
    afficherMessageZone(zoneAffichage, 'Chargement...');

    const resultat = await lireTcfEo(infoCarte.id);
    if (!resultat.success) {
        afficherMessageZone(zoneAffichage, resultat.error ?? 'Impossible de charger cette donnée.');
        return;
    }

    const extrait = resultat.extrait ?? [];
    let transforme = resultat.transforme ?? extrait;
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

    // Fusion extrait ↔ transformé (même logique que le backend / TCF EE) :
    // parties déjà éditées conservées, nouvelles parties de l'extrait
    // ajoutées — pour que l'affichage et trans_eo.json restent alignés
    // même sans re-extraction.
    const parNomTrans = new Map<string, PartieEO>();
    for (const p of transforme) {
        const cle = (p.nomPartie ?? '').trim();
        if (cle) parNomTrans.set(cle, p);
    }
    const etatTransforme: PartieEO[] = extrait.map((partie, index) => {
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
        void sauvegarderTransformeTcfEo(infoCarte.id, etatTransforme).then((res) => {
            if (!res.success) {
                creerMessage(typeErreur, infoCarte.nom, res.error ?? 'Échec de la synchronisation du transformé.');
            }
        });
    }

    const enregistrer = (): void => {
        rafraichirCarteTcfEoApresSauvegarde(infoCarte.id, etatTransforme);
        void sauvegarderTransformeTcfEo(infoCarte.id, etatTransforme).then((res) => {
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
    enteteTitre.textContent = `${infoCarte.nom} — EO`;
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
            const res = await sauvegarderSsConserveur('tcf', 'eo', infoCarte.id, valeur);
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

    const boutonExport = creerBoutonExportZone('tcf-eo', () => infoCarte.id);
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
            const pret = estQuestionExportable('tcf-eo', partieExtrait, etatTransforme[index]);
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

        construireZonesParSujet('Tâche 2', partieExtrait.tache2 ?? [], partieTrans, 'tache2', enregistrer)
            .forEach((zone) => zoneContenu.appendChild(zone));
        construireZonesParSujet('Tâche 3', partieExtrait.tache3 ?? [], partieTrans, 'tache3', enregistrer)
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
// transformée) pour UN SEUL sujet (un paragraphe) — même disposition que
// zed-zone dans zoneAff.ts, mais un bloc par sujet plutôt qu'un bloc
// unique regroupant tous les sujets d'une tâche en une seule chaîne.
const construireZonesParSujet = (
    titreTache: string,
    paragraphesExtrait: string[],
    partieTrans: PartieEO,
    champ: 'tache2' | 'tache3',
    enregistrer: () => void
): HTMLDivElement[] => {
    const transExistant = partieTrans[champ] ?? [];
    const nbSujets = Math.max(paragraphesExtrait.length, transExistant.length, 1);

    const zones: HTMLDivElement[] = [];
    for (let i = 0; i < nbSujets; i++) {
        const titreZone = nbSujets > 1 ? `${titreTache} · Sujet ${i + 1}` : titreTache;
        zones.push(
            construireZoneSujet(titreZone, paragraphesExtrait[i] ?? '', partieTrans, champ, i, enregistrer)
        );
    }
    return zones;
};

const construireZoneSujet = (
    titreZone: string,
    extraitTexte: string,
    partieTrans: PartieEO,
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