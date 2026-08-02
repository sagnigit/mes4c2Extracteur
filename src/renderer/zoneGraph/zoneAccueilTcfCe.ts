// zoneAccueilTcfCe.ts
//
// Construit la page TCF · CE de l'accueil : zone à droite listant les
// cartes (une par dossier tcf_ce — voir donnee_tcf_ce.ts, backend) et,
// au centre, une navigation numérotée à gauche (une entrée par
// QUESTION, avec Préc./Suiv. — même disposition que zoneAccueilTcfEo.ts
// / zoneAccueilTcfEe.ts) et, pour la question sélectionnée, 4 blocs
// zed-zone (même gabarit Extrait/▶/Transformé que zoneAff.ts) :
//   - Énoncé      : texte (extrait) / IMAGE (transformé) — composée à
//                   partir du texte via le même popup que zoneAff.ts
//                   (EditableImagePopup.ts) ;
//   - Points      : nombre ;
//   - Propositions : liste de choix, gérée exactement comme les
//                   propositions CE/CO de zoneAff.ts (bascule "réponse
//                   correcte", ajout/suppression libres) ;
//   - Question    : texte libre.
//
// TCF CE ne passe PAS par conserveurDonne.ts : toutes les données
// viennent de donneeTcfCeApi.ts, qui ne parle qu'aux canaux 'tcf-ce:*'
// (câblés sur donnee_tcf_ce.ts côté backend — seule source de vérité
// pour la CE du TCF). Contrairement à EE/EO (regroupés par partie), CE
// est un tableau PLAT de questions : la navigation se fait donc
// directement par question plutôt que par partie.
import { construireCorpsPage, afficherMessageZone } from '../composer/corpsPage.js';
import { Selecteur } from '../generale/selecteur.js';
import { creerMessage, typeErreur } from './gestionMessage.js';
import { ouvrirPopupTransformationImage } from '../composer/EditableImagePopup.js';
import { creerBoutonExportZone } from './boutonExportZone.js';
import { construireSectionStats, calculerStatsExtraitTcfCe, calculerStatsTransformeTcfCe } from './statsElement.js';
import {
    CarteTcfCe,
    QuestionCE,
    listerTcfCe,
    lireTcfCe,
    sauvegarderTransformeTcfCe,
    enregistrerImageEnonceTcfCe,
} from './donneeTcfCeApi.js';

/**
 * Construit le corps de la page TCF · CE : zone à droite (une carte
 * par dossier tcf_ce) + zone d'affichage (centre, navigation par
 * question + blocs Énoncé/Points/Propositions/Question).
 */
export const remplirZoneTcfCe = async (page: HTMLDivElement): Promise<void> => {
    const { zoneAffichage, listeCartes } = construireCorpsPage(
        page,
        'Aucune donnée CE extraite pour le moment.'
    );
    afficherMessageZone(zoneAffichage, 'Sélectionnez une carte pour afficher son contenu.');

    const selecteurCartes = new Selecteur<HTMLDivElement>(
        (carte) => carte.classList.add('nm-carte-elt-actif'),
        (carte) => carte.classList.remove('nm-carte-elt-actif')
    );

    listeCartes.setEmptyMessage('Chargement des données CE...');
    try {
        const cartes = await listerTcfCe();
        listeCartes.setEmptyMessage('Aucune donnée CE extraite pour le moment.');

        for (const infoCarte of cartes) {
            const resultat = await lireTcfCe(infoCarte.id);
            const extrait = resultat.success ? (resultat.extrait ?? []) : [];
            const transforme = resultat.success ? (resultat.transforme ?? extrait) : null;

            const carte = creerCarteTcfCe(infoCarte, extrait, transforme, () => {
                selecteurCartes.selectUnique(carte);
                void afficherContenuTcfCe(zoneAffichage, infoCarte);
            });
            listeCartes.addItem(carte);
        }
    } catch {
        listeCartes.setEmptyMessage('Erreur lors du chargement des données CE.');
    }
};

// Pour retrouver, après une sauvegarde, la section "Transformé" d'une
// carte déjà construite, afin de rafraîchir ses stats sans tout
// reconstruire — même principe que cartesSuivies dans
// zoneAccueilTef.ts. Clé : l'id de la carte (infoCarte.id).
interface CarteTcfCeSuivie {
    zoneStats: HTMLDivElement;
    sectionTrans: HTMLDivElement;
}
const cartesTcfCeSuivies = new Map<string, CarteTcfCeSuivie>();

// Construit la carte représentant un dossier tcf_ce : entête
// (badge + titre) puis stats Extrait/Transformé — même gabarit que les
// cartes TEF/TCF · CO (voir creerCarteElement, zoneAccueilTef.ts).
const creerCarteTcfCe = (
    infoCarte: CarteTcfCe,
    extrait: QuestionCE[],
    transforme: QuestionCE[] | null,
    onClick: () => void
): HTMLDivElement => {
    const carte = document.createElement('div');
    carte.className = 'nm-carte-elt nm-carte-elt--ce';
    carte.addEventListener('click', onClick);

    const entete = document.createElement('div');
    entete.className = 'nm-carte-elt-entete';

    const badge = document.createElement('span');
    badge.className = 'nm-carte-elt-badge';
    badge.textContent = 'CE';

    const titre = document.createElement('span');
    titre.className = 'nm-carte-elt-titre';
    titre.textContent = infoCarte.nom;
    titre.title = infoCarte.nom;

    entete.append(badge, titre);
    carte.appendChild(entete);

    const zoneStats = document.createElement('div');
    zoneStats.className = 'nm-carte-elt-stats';

    const sectionExtrait = construireSectionStats('Extrait', 'extrait', calculerStatsExtraitTcfCe(extrait));
    const sectionTrans = construireSectionStats('Transformé', 'trans', calculerStatsTransformeTcfCe(transforme));
    zoneStats.append(sectionExtrait, sectionTrans);
    carte.appendChild(zoneStats);

    cartesTcfCeSuivies.set(infoCarte.id, { zoneStats, sectionTrans });

    return carte;
};

// Rafraîchit la section "Transformé" d'une carte déjà construite,
// juste après une sauvegarde (voir enregistrer, plus bas) : les stats
// reflètent alors immédiatement l'état en mémoire (etatTransforme),
// sans avoir besoin de relire le disque.
const rafraichirCarteTcfCeApresSauvegarde = (idCarte: string, questions: QuestionCE[]): void => {
    const suivie = cartesTcfCeSuivies.get(idCarte);
    if (!suivie) return;
    const nouvelleSection = construireSectionStats('Transformé', 'trans', calculerStatsTransformeTcfCe(questions));
    suivie.zoneStats.replaceChild(nouvelleSection, suivie.sectionTrans);
    suivie.sectionTrans = nouvelleSection;
    cartesTcfCeSuivies.set(idCarte, suivie);
};

// Affiche, dans la zone d'affichage, le contenu d'une carte tcf_ce :
// navigation numérotée (une entrée par question) + blocs de la
// question sélectionnée.
const afficherContenuTcfCe = async (zoneAffichage: HTMLDivElement, infoCarte: CarteTcfCe): Promise<void> => {
    afficherMessageZone(zoneAffichage, 'Chargement...');

    const resultat = await lireTcfCe(infoCarte.id);
    if (!resultat.success) {
        afficherMessageZone(zoneAffichage, resultat.error ?? 'Impossible de charger cette donnée.');
        return;
    }

    const extrait = resultat.extrait ?? [];
    const transforme = resultat.transforme ?? extrait;
    if (extrait.length === 0) {
        afficherMessageZone(zoneAffichage, 'Aucune question à afficher.');
        return;
    }

    // État transformé courant, une entrée par question (même ordre que
    // l'extrait) — modifié en mémoire à chaque frappe, enregistré (le
    // tableau complet) à la perte de focus de n'importe quel champ.
    // L'image de l'énoncé, elle, est enregistrée à part (voir
    // construireBlocEnonce) dès sa composition, sans attendre de perte
    // de focus.
    const etatTransforme: QuestionCE[] = extrait.map((question, index) => ({
        points: transforme[index]?.points ?? question.points,
        options: Array.isArray(transforme[index]?.options) ? [...(transforme[index]!.options)] : [...question.options],
        correctAnswerIndex: transforme[index]?.correctAnswerIndex ?? question.correctAnswerIndex,
        enonce: transforme[index]?.enonce ?? question.enonce,
        question: transforme[index]?.question ?? question.question,
        _localEnonceImage: transforme[index]?._localEnonceImage,
    }));

    const enregistrer = (): void => {
        rafraichirCarteTcfCeApresSauvegarde(infoCarte.id, etatTransforme);
        void sauvegarderTransformeTcfCe(infoCarte.id, etatTransforme).then((res) => {
            if (!res.success) creerMessage(typeErreur, infoCarte.nom, res.error ?? "Échec de l'enregistrement.");
        });
    };

    // --- Construction de la zone (entête + navigation + contenu) ---
    zoneAffichage.innerHTML = '';

    const racine = document.createElement('div');
    racine.className = 'affichage-embed';

    const enteteEmbed = document.createElement('div');
    enteteEmbed.className = 'affichage-embed-entete';

    const enteteTitre = document.createElement('span');
    enteteTitre.className = 'affichage-embed-entete-titre';
    enteteTitre.textContent = `${infoCarte.nom} — CE`;
    enteteEmbed.appendChild(enteteTitre);

    enteteEmbed.appendChild(creerBoutonExportZone('tcf-ce', () => infoCarte.id));

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

    const selectionnerIndex = (index: number): void => {
        if (index < 0 || index >= extrait.length) return;
        indexCourant = index;

        boutonsNav.forEach((btn, i) => btn.classList.toggle('affichage-nav-btn--active', i === index));
        boutonsNav[index]?.scrollIntoView({ block: 'nearest' });

        const questionExtrait = extrait[index];
        const questionTrans = etatTransforme[index];

        zoneContenu.innerHTML = '';

        const entete = document.createElement('div');
        entete.className = 'affichage-contenu-entete';
        const titre = document.createElement('h3');
        titre.className = 'affichage-contenu-titre';
        titre.textContent = `Question ${index + 1}`;
        entete.appendChild(titre);
        zoneContenu.appendChild(entete);

        zoneContenu.appendChild(
            construireBlocEnonce(questionExtrait.enonce ?? '', questionTrans, index, infoCarte.id)
        );
        zoneContenu.appendChild(
            construireBlocPoints(questionExtrait.points ?? 0, questionTrans, enregistrer)
        );
        zoneContenu.appendChild(
            construireBlocPropositions(
                questionExtrait.options ?? [],
                questionExtrait.correctAnswerIndex,
                questionTrans,
                enregistrer
            )
        );
        zoneContenu.appendChild(
            construireBlocQuestion(questionExtrait.question ?? '', questionTrans, enregistrer)
        );

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

    selectionnerIndex(0);
};

// ---------------------------------------------------------------------
// Bloc "Énoncé" : texte (extrait) / image (transformé, composée via le
// même popup texte -> image que zoneAff.ts).
// ---------------------------------------------------------------------
const construireBlocEnonce = (
    extraitTexte: string,
    question: QuestionCE,
    index: number,
    idLien: string
): HTMLDivElement => {
    const carte = document.createElement('div');
    carte.className = 'zed-zone';

    const titre = document.createElement('h4');
    titre.className = 'zed-zone-titre';
    titre.textContent = 'Énoncé';
    carte.appendChild(titre);

    const corps = document.createElement('div');
    corps.className = 'zed-zone-corps';

    // Colonne extrait (texte, fixe)
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
        contenuExtrait.textContent = 'Aucun énoncé extrait.';
    } else {
        const bloc = document.createElement('div');
        bloc.className = 'zed-texte';
        bloc.textContent = extraitTexte;
        contenuExtrait.appendChild(bloc);
    }
    colExtrait.appendChild(contenuExtrait);

    // Bouton : l'extrait est du texte, le transformé attend une image —
    // il n'y a donc rien à copier automatiquement, seulement à composer
    // (même logique que le cas "peutOuvrirPopupImage" de zoneAff.ts).
    const colBouton = document.createElement('div');
    colBouton.className = 'zed-col-bouton';
    const btnComposer = document.createElement('button');
    btnComposer.type = 'button';
    btnComposer.className = 'zed-copier-btn zed-copier-btn--image';
    btnComposer.innerHTML = '<span class="iconMateriel">image</span>';
    btnComposer.title = 'Composer une image à partir du texte';
    btnComposer.disabled = !extraitTexte;
    colBouton.appendChild(btnComposer);

    // Colonne transformée (image)
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
    colTrans.appendChild(zoneTransContenu);

    const rendreTrans = (): void => {
        zoneTransContenu.innerHTML = '';
        if (question._localEnonceImage) {
            const img = document.createElement('img');
            img.className = 'zed-image';
            img.src = question._localEnonceImage;
            img.alt = 'Énoncé transformé (image)';
            zoneTransContenu.appendChild(img);
        } else {
            const vide = document.createElement('div');
            vide.className = 'zed-dropzone-vide';
            vide.textContent = question.enonce
                ? "Aucune image générée pour l'instant (l'énoncé reste en texte)."
                : 'Aucun énoncé transformé.';
            zoneTransContenu.appendChild(vide);
        }
    };
    rendreTrans();

    btnComposer.addEventListener('click', () => {
        ouvrirPopupTransformationImage({
            texteInitial: extraitTexte,
            onValider: (urlImage, blobImage) => {
                definirStatut('enregistrement');
                void (async () => {
                    try {
                        const { donneeBase64, extension } = await blobEnBase64(blobImage);
                        const resultatEnregistrement = await enregistrerImageEnonceTcfCe(
                            idLien,
                            index,
                            donneeBase64,
                            extension
                        );
                        if (!resultatEnregistrement.success) {
                            definirStatut('erreur');
                            return;
                        }
                        question.enonce = resultatEnregistrement.cheminRelatif ?? question.enonce;
                        question._localEnonceImage = resultatEnregistrement.cheminAbsolu ?? urlImage;
                        rendreTrans();
                        definirStatut('ok');
                    } catch {
                        definirStatut('erreur');
                    }
                })();
            },
        });
    });

    corps.append(colExtrait, colBouton, colTrans);
    carte.appendChild(corps);
    return carte;
};

// ---------------------------------------------------------------------
// Bloc "Points" : nombre.
// ---------------------------------------------------------------------
const construireBlocPoints = (
    pointsExtrait: number,
    question: QuestionCE,
    enregistrer: () => void
): HTMLDivElement => {
    const carte = document.createElement('div');
    carte.className = 'zed-zone';

    const titre = document.createElement('h4');
    titre.className = 'zed-zone-titre';
    titre.textContent = 'Points';
    carte.appendChild(titre);

    const corps = document.createElement('div');
    corps.className = 'zed-zone-corps';

    const colExtrait = document.createElement('div');
    colExtrait.className = 'zed-col zed-col-extrait';
    const labelExtrait = document.createElement('div');
    labelExtrait.className = 'zed-col-label';
    labelExtrait.textContent = 'Extrait';
    colExtrait.appendChild(labelExtrait);
    const contenuExtrait = document.createElement('div');
    contenuExtrait.className = 'zed-extrait-contenu';
    const blocPoints = document.createElement('div');
    blocPoints.className = 'zed-texte';
    blocPoints.textContent = String(pointsExtrait ?? 0);
    contenuExtrait.appendChild(blocPoints);
    colExtrait.appendChild(contenuExtrait);

    const colBouton = document.createElement('div');
    colBouton.className = 'zed-col-bouton';
    const btnCopier = document.createElement('button');
    btnCopier.type = 'button';
    btnCopier.className = 'zed-copier-btn';
    btnCopier.textContent = '▶';
    btnCopier.title = "Copier l'extrait vers la partie transformée";
    colBouton.appendChild(btnCopier);

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
    const champPoints = document.createElement('input');
    champPoints.type = 'number';
    champPoints.className = 'zed-liste-trans-input';
    champPoints.min = '0';
    champPoints.value = String(question.points ?? 0);
    zoneTransContenu.appendChild(champPoints);
    colTrans.appendChild(zoneTransContenu);

    champPoints.addEventListener('blur', () => {
        const valeur = Number(champPoints.value);
        question.points = Number.isFinite(valeur) ? valeur : 0;
        definirStatut('enregistrement');
        enregistrer();
        definirStatut('ok');
    });

    btnCopier.addEventListener('click', () => {
        champPoints.value = String(pointsExtrait ?? 0);
        question.points = pointsExtrait ?? 0;
        definirStatut('enregistrement');
        enregistrer();
        definirStatut('ok');
    });

    corps.append(colExtrait, colBouton, colTrans);
    carte.appendChild(corps);
    return carte;
};

// ---------------------------------------------------------------------
// Bloc "Propositions" : liste de choix, gérée exactement comme les
// propositions CE/CO de zoneAff.ts (bascule "réponse correcte",
// ajout/suppression libres) — ici indexées par position plutôt que par
// lettre aléatoire (correctAnswerIndex reste un index de tableau).
// ---------------------------------------------------------------------
const construireBlocPropositions = (
    optionsExtrait: string[],
    correctIndexExtrait: number,
    question: QuestionCE,
    enregistrer: () => void
): HTMLDivElement => {
    const carte = document.createElement('div');
    carte.className = 'zed-zone';

    const titre = document.createElement('h4');
    titre.className = 'zed-zone-titre';
    titre.textContent = 'Propositions';
    carte.appendChild(titre);

    const corps = document.createElement('div');
    corps.className = 'zed-zone-corps';

    // Extrait (lecture seule)
    const colExtrait = document.createElement('div');
    colExtrait.className = 'zed-col zed-col-extrait';
    const labelExtrait = document.createElement('div');
    labelExtrait.className = 'zed-col-label';
    labelExtrait.textContent = 'Extrait';
    colExtrait.appendChild(labelExtrait);
    const contenuExtrait = document.createElement('div');
    contenuExtrait.className = 'zed-extrait-contenu';
    if (!optionsExtrait || optionsExtrait.length === 0) {
        contenuExtrait.classList.add('zed-vide');
        contenuExtrait.textContent = 'Aucune proposition extraite.';
    } else {
        const liste = document.createElement('div');
        liste.className = 'zed-liste-extrait';
        optionsExtrait.forEach((texteOption, i) => {
            const correcte = i === correctIndexExtrait;
            const ligne = document.createElement('div');
            ligne.className = 'zed-liste-extrait-item' + (correcte ? ' zed-liste-extrait-item--correcte' : '');
            ligne.innerHTML = `<span class="iconMateriel">${correcte ? 'check_circle' : 'cancel'}</span><span></span>`;
            (ligne.lastElementChild as HTMLElement).textContent = texteOption;
            liste.appendChild(ligne);
        });
        contenuExtrait.appendChild(liste);
    }
    colExtrait.appendChild(contenuExtrait);

    // Bouton de copie (extrait -> transformé)
    const colBouton = document.createElement('div');
    colBouton.className = 'zed-col-bouton';
    const btnCopier = document.createElement('button');
    btnCopier.type = 'button';
    btnCopier.className = 'zed-copier-btn';
    btnCopier.textContent = '▶';
    const aucunExtrait = !optionsExtrait || optionsExtrait.length === 0;
    btnCopier.disabled = aucunExtrait;
    btnCopier.title = aucunExtrait
        ? 'Aucune proposition à copier ici.'
        : "Copier l'extrait vers la partie transformée";
    colBouton.appendChild(btnCopier);

    // Transformé (éditable)
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
    colTrans.appendChild(zoneTransContenu);

    const enregistrerListe = (): void => {
        definirStatut('enregistrement');
        enregistrer();
        definirStatut('ok');
    };

    const rafraichir = (): void => {
        zoneTransContenu.innerHTML = '';
        const conteneur = document.createElement('div');
        conteneur.className = 'zed-liste-trans';

        if (!Array.isArray(question.options)) question.options = [];
        const optionsCourantes = question.options;

        optionsCourantes.forEach((texteOption, i) => {
            const ligne = document.createElement('div');
            ligne.className = 'zed-liste-trans-item';

            const estCorrecte = i === question.correctAnswerIndex;
            const btnCorrecte = document.createElement('button');
            btnCorrecte.type = 'button';
            btnCorrecte.className = 'zed-liste-trans-toggle' + (estCorrecte ? ' zed-liste-trans-toggle--actif' : '');
            btnCorrecte.title = 'Marquer comme réponse correcte';
            btnCorrecte.innerHTML = `<span class="iconMateriel">${estCorrecte ? 'check_circle' : 'cancel'}</span>`;
            btnCorrecte.addEventListener('click', () => {
                question.correctAnswerIndex = i;
                rafraichir();
                enregistrerListe();
            });

            const badge = document.createElement('span');
            badge.className = 'zed-liste-trans-lettre';
            badge.textContent = String(i + 1);

            const champ = document.createElement('input');
            champ.type = 'text';
            champ.className = 'zed-liste-trans-input';
            champ.value = texteOption;
            champ.placeholder = 'Proposition...';
            champ.addEventListener('input', () => {
                optionsCourantes[i] = champ.value;
            });
            champ.addEventListener('blur', () => enregistrerListe());

            const btnSupprimer = document.createElement('button');
            btnSupprimer.type = 'button';
            btnSupprimer.className = 'zed-liste-trans-supprimer';
            btnSupprimer.title = 'Supprimer cette proposition';
            btnSupprimer.textContent = '×';
            btnSupprimer.addEventListener('click', () => {
                optionsCourantes.splice(i, 1);
                if (question.correctAnswerIndex === i) question.correctAnswerIndex = -1;
                else if (question.correctAnswerIndex > i) question.correctAnswerIndex -= 1;
                rafraichir();
                enregistrerListe();
            });

            ligne.append(btnCorrecte, badge, champ, btnSupprimer);
            conteneur.appendChild(ligne);
        });

        const btnAjouter = document.createElement('button');
        btnAjouter.type = 'button';
        btnAjouter.className = 'zed-liste-trans-ajouter';
        btnAjouter.textContent = '+ Ajouter une proposition';
        btnAjouter.addEventListener('click', () => {
            optionsCourantes.push('');
            rafraichir();
            enregistrerListe();
        });
        conteneur.appendChild(btnAjouter);

        zoneTransContenu.appendChild(conteneur);
    };
    rafraichir();

    btnCopier.addEventListener('click', () => {
        question.options = [...(optionsExtrait ?? [])];
        question.correctAnswerIndex = correctIndexExtrait;
        rafraichir();
        enregistrerListe();
    });

    corps.append(colExtrait, colBouton, colTrans);
    carte.appendChild(corps);
    return carte;
};

// ---------------------------------------------------------------------
// Bloc "Question" : texte libre.
// ---------------------------------------------------------------------
const construireBlocQuestion = (
    questionExtrait: string,
    question: QuestionCE,
    enregistrer: () => void
): HTMLDivElement => {
    const carte = document.createElement('div');
    carte.className = 'zed-zone';

    const titre = document.createElement('h4');
    titre.className = 'zed-zone-titre';
    titre.textContent = 'Question';
    carte.appendChild(titre);

    const corps = document.createElement('div');
    corps.className = 'zed-zone-corps';

    const colExtrait = document.createElement('div');
    colExtrait.className = 'zed-col zed-col-extrait';
    const labelExtrait = document.createElement('div');
    labelExtrait.className = 'zed-col-label';
    labelExtrait.textContent = 'Extrait';
    colExtrait.appendChild(labelExtrait);

    const contenuExtrait = document.createElement('div');
    contenuExtrait.className = 'zed-extrait-contenu';
    if (!questionExtrait) {
        contenuExtrait.classList.add('zed-vide');
        contenuExtrait.textContent = 'Aucune question extraite.';
    } else {
        const bloc = document.createElement('div');
        bloc.className = 'zed-texte';
        bloc.textContent = questionExtrait;
        contenuExtrait.appendChild(bloc);
    }
    colExtrait.appendChild(contenuExtrait);

    const colBouton = document.createElement('div');
    colBouton.className = 'zed-col-bouton';
    const btnCopier = document.createElement('button');
    btnCopier.type = 'button';
    btnCopier.className = 'zed-copier-btn';
    btnCopier.textContent = '▶';
    btnCopier.disabled = !questionExtrait;
    btnCopier.title = !questionExtrait
        ? 'Aucun extrait à copier ici.'
        : "Copier l'extrait vers la partie transformée";
    colBouton.appendChild(btnCopier);

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
    zoneTexte.value = question.question ?? '';
    zoneTexte.placeholder = 'Saisissez la question transformée...';
    zoneTexte.rows = 1;

    const ajusterHauteur = (): void => {
        zoneTexte.style.height = 'auto';
        zoneTexte.style.height = `${zoneTexte.scrollHeight}px`;
    };
    zoneTexte.addEventListener('input', () => {
        question.question = zoneTexte.value;
        ajusterHauteur();
    });
    requestAnimationFrame(ajusterHauteur);

    zoneTexte.addEventListener('blur', () => {
        definirStatut('enregistrement');
        enregistrer();
        definirStatut('ok');
    });

    btnCopier.addEventListener('click', () => {
        zoneTexte.value = questionExtrait;
        question.question = questionExtrait;
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

// ---------------------------------------------------------------------
// Utilitaires locaux
// ---------------------------------------------------------------------

// Lit un Blob (image composée via le popup) en base64 (sans le préfixe
// "data:...;base64,") et détermine son extension à partir de son type
// MIME — format attendu par enregistrerImageEnonceTcfCe.
const blobEnBase64 = (blob: Blob): Promise<{ donneeBase64: string; extension: string }> => {
    return new Promise((resolve, reject) => {
        const lecteur = new FileReader();
        lecteur.onload = () => {
            const resultat = String(lecteur.result ?? '');
            const virgule = resultat.indexOf(',');
            resolve({
                donneeBase64: virgule >= 0 ? resultat.slice(virgule + 1) : resultat,
                extension: (blob.type.split('/')[1] || 'png').toLowerCase(),
            });
        };
        lecteur.onerror = () => reject(lecteur.error ?? new Error('Lecture du blob impossible.'));
        lecteur.readAsDataURL(blob);
    });
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