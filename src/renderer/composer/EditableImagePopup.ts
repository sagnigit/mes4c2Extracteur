/**
 * EditableImagePopup
 * -------------------
 * Popup utilisé quand la partie "transformée" d'une zone attend une
 * IMAGE alors que l'extrait correspondant contient du texte (ou rien) :
 * dans ce cas il n'y a rien à copier automatiquement, on propose donc de
 * COMPOSER une image à partir d'un texte, saisi/édité via un
 * EditableBlockManager.
 *
 * Contenu du popup :
 *  - un EditableBlockManager (texte librement éditable/mis en forme) ;
 *  - 3 boutons : "Réinitialiser", "Fermer", "Valider".
 *
 * À l'ouverture, le manager est réinitialisé : pré-rempli avec le texte
 * fourni (`texteInitial`) s'il y en avait un, sinon laissé vide.
 *
 * Au clic sur "Valider", l'enchaînement suivant est effectué (voir
 * `lancerComposition`), entièrement délégué à composerSurImageTemplate
 * (zoneImgtemplate.ts) :
 *  1) le scrollFrame du manager (donc toutes les zones éditables) est
 *     déplacé directement dans le cadre de la zone "image template", à
 *     la place de l'ancien cadre overlay, le temps de la composition ;
 *  2) la police est ajustée pour remplir au mieux ce cadre sans déborder ;
 *  3) la grande div (image de fond du template + cadre rempli) est
 *     capturée en une seule fois : c'est le résultat final ;
 *  4) le scrollFrame est remis à sa place d'origine dans le popup ;
 *  5) l'URL de cette image finale est transmise à `onValider`, puis le
 *     popup se ferme.
 *
 * Chaque étape de capture/chargement d'image étant asynchrone, tout
 * l'enchaînement est piloté par callbacks/Promises (voir
 * Capturedivaspng.ts et zoneImgtemplate.ts) ; un loader est affiché
 * pendant toute la durée de l'opération pour indiquer que l'image est en
 * train de se créer.
 */

import { EditableBlockManager, BlocInitial } from './EditableBlockManager.js';
import { composerSurImageTemplate } from '../zoneGraph/zoneImgtemplate.js';
import { BlockFormatState } from './EditableBlock.js';

export interface OptionsPopupImageTexte {
    /** Texte utilisé pour préremplir le manager à l'ouverture (chaîne vide si aucun). */
    texteInitial: string;
    /**
     * Appelé avec l'URL (objet blob, pour l'affichage immédiat) ET le
     * Blob lui-même (pour permettre à l'appelant de l'enregistrer
     * directement sur disque) de l'image finale une fois la composition
     * validée.
     */
    onValider: (urlImage: string, blobImage: Blob) => void;
}

const composerSurTemplate = (manager: EditableBlockManager): Promise<Blob | null> =>
    new Promise((resolve) => composerSurImageTemplate(manager, resolve));

/**
 * Un état prédéfini proposé sous forme de bouton dans le popup :
 *  - `nomBouton`       : libellé affiché sur le bouton ;
 *  - `construireBlocs` : à partir du texte initial du popup
 *    (`options.texteInitial`), construit le tableau de BlocInitial à
 *    charger dans le manager (voir EditableBlockManager.chargerDepuisElements)
 *    quand ce bouton est cliqué.
 *
 * Pour l'instant, les 3 états ne font que reconstituer le texte initial
 * tel quel, en un seul bloc, sans mise en forme particulière (`format: {}`
 * = garde la mise en forme par défaut d'un bloc neuf) — à affiner plus
 * tard avec une mise en forme propre à chaque état.
 */
interface OptionEtatPredefini {
    nomBouton: string;
    construireBlocs: (texte: string) => BlocInitial[];
}

const miseFormTitreGauche: BlockFormatState = {
    align: "left",
    bold: true,
    italic: false,
    underline: false,
    wrap: false,
    colorIndex: null,
    fontSizeDeltaPx: 0,
};

const miseFormTitreCentre: BlockFormatState = {
    align: "center",
    bold: true,
    italic: false,
    underline: false,
    wrap: false,
    colorIndex: null,
    fontSizeDeltaPx: 0,
};

const miseFormTitreSouligner: BlockFormatState = {
    align: "center",
    bold: true,
    italic: false,
    underline: true,
    wrap: false,
    colorIndex: null,
    fontSizeDeltaPx: 0,
};

const miseFormInfo: BlockFormatState = {
    align: "justify",
    bold: false,
    italic: false,
    underline: false,
    wrap: true,
    colorIndex: null,
    fontSizeDeltaPx: 0,
};

const miseFormLgnUnique: BlockFormatState = {
    align: "center",
    bold: false,
    italic: false,
    underline: false,
    wrap: false,
    colorIndex: null,
    fontSizeDeltaPx: 0,
};

const ETATS_PREDEFINIS: OptionEtatPredefini[] = [
    {
        nomBouton: 'multi-titre',
        construireBlocs: (texte: string) => {
            const tabLigne = texte.split("\n");
            let lgnTitre = tabLigne[0].trim();
            const nbLettreTitre = lgnTitre.length;
            const racineTitre = lgnTitre.substring(0, nbLettreTitre - 1);
            let tabLignInfo: string[] = [];
            const tabAff: BlocInitial[] = [];
            const ajouteAff = () => {
                tabAff.push(
                    {
                        texte: lgnTitre,
                        format: miseFormTitreGauche
                    },
                    {
                        texte: tabLignInfo.join(" ").trim(),
                        format: miseFormInfo
                    }
                );
            }
            for (let index = 1; index < tabLigne.length; index++) {
                const lgn = tabLigne[index].trim();
                if (lgn.toUpperCase().includes(racineTitre.toUpperCase()) && (lgn.length < nbLettreTitre + 3)) {
                    ajouteAff();
                    lgnTitre = lgn;
                    tabLignInfo = [];
                }
                else {
                    tabLignInfo.push(lgn);
                }
            }
            ajouteAff();
            return tabAff;
        }
    },
    {
        nomBouton: 'titre gauche',
        construireBlocs: (texte: string) => {
            const tabLigne = texte.split("\n");
            const tabAff: BlocInitial[] = [];
            tabAff.push(
                {
                    texte: tabLigne[0].trim(),
                    format: miseFormTitreGauche
                }
            );
            tabLigne.splice(0, 1);
            tabAff.push(
                {
                    texte: tabLigne.join(" ").trim(),
                    format: miseFormInfo
                }
            );
            return tabAff;
        },
    },
    {
        nomBouton: 'titre centrer',
        construireBlocs: (texte: string) => {
            const tabLigne = texte.split("\n");
            const tabAff: BlocInitial[] = [];
            tabAff.push(
                {
                    texte: tabLigne[0].trim(),
                    format: miseFormTitreCentre
                }
            );
            tabLigne.splice(0, 1);
            tabAff.push(
                {
                    texte: tabLigne.join(" ").trim(),
                    format: miseFormInfo
                }
            );
            return tabAff;
        },
    },
    {
        nomBouton: 'titre souligner',
        construireBlocs: (texte: string) => {
            const tabLigne = texte.split("\n");
            const tabAff: BlocInitial[] = [];
            tabAff.push(
                {
                    texte: tabLigne[0].trim(),
                    format: miseFormTitreSouligner
                }
            );
            tabLigne.splice(0, 1);
            tabAff.push(
                {
                    texte: "\n" + tabLigne.join(" ").trim(),
                    format: miseFormInfo
                }
            );
            return tabAff;
        },
    },
    {
        nomBouton: 'simple texte',
        construireBlocs: (texte: string) => {
            const tabLigne = texte.split("\n");
            return [
                {
                    texte: tabLigne.join(" ").trim(),
                    format: miseFormInfo
                }
            ];
        },
    },
    {
        nomBouton: 'ligne unique',
        construireBlocs: (texte: string) => {
            const tabLigne = texte.split("\n");
            return [
                {
                    texte: tabLigne.join(" ").trim(),
                    format: miseFormLgnUnique
                }
            ];
        },
    },
    {
        nomBouton: 'ColleLigne',
        construireBlocs: (texte: string) => {
            const tabLigne = texte.split("\n");
            return [
                {
                    texte: tabLigne.join("\n").trim(),
                    format: {}
                }
            ];
        },
    },
];

/**
 * Ouvre le popup de composition texte -> image. Chaque appel crée un
 * nouveau popup (et un nouveau manager) ; le popup se détruit lui-même à
 * la fermeture (bouton "Fermer" ou validation réussie).
 */
export const ouvrirPopupTransformationImage = (options: OptionsPopupImageTexte): void => {
    const overlay = document.createElement('div');
    overlay.className = 'eip-overlay';

    const boite = document.createElement('div');
    boite.className = 'eip-boite';

    const entete = document.createElement('div');
    entete.className = 'eip-entete';
    entete.textContent = 'Composer une image à partir du texte';
    boite.appendChild(entete);

    // La barre d'outils de mise en forme et la zone qui porte toutes les
    // zones éditables sont deux div SÉPARÉES : seule cette dernière doit
    // défiler (overflow-y: auto, voir CSS), la barre reste fixe au-dessus.
    const zoneOutils = document.createElement('div');
    zoneOutils.className = 'eip-zone-outils';
    boite.appendChild(zoneOutils);

    const zoneManager = document.createElement('div');
    zoneManager.className = 'eip-zone-manager';
    boite.appendChild(zoneManager);

    const manager = new EditableBlockManager('100%', '100%');
    manager.mountSplit(zoneOutils, zoneManager);

    // Réinitialise le manager avec le texte fourni (ou vide) — appelé à
    // l'ouverture, et de nouveau si l'utilisateur clique "Réinitialiser".
    const initialiserContenu = (): void => {
        manager.init();
        if (options.texteInitial) {
            manager.getBlocks()[0]?.setText(options.texteInitial.replaceAll("_", ""));
        }
    };//
    initialiserContenu();

    const zoneErreur = document.createElement('div');
    zoneErreur.className = 'eip-erreur';
    zoneErreur.style.display = 'none';
    boite.appendChild(zoneErreur);

    const pied = document.createElement('div');
    pied.className = 'eip-pied';

    // Boutons d'états prédéfinis : un bouton par entrée de ETATS_PREDEFINIS,
    // ajoutés directement dans le pied (même ligne, même espacement que
    // Réinitialiser/Fermer/Valider), qui remplace tout le contenu du
    // manager par le résultat de `construireBlocs(options.texteInitial)`
    // au clic (voir EditableBlockManager.chargerDepuisElements).
    ETATS_PREDEFINIS.forEach((etat) => {
        const btnEtat = document.createElement('button');
        btnEtat.type = 'button';
        btnEtat.className = 'eip-btn eip-btn-etat';
        btnEtat.textContent = etat.nomBouton;
        btnEtat.addEventListener('click', () => {
            zoneErreur.style.display = 'none';
            manager.chargerDepuisElements(etat.construireBlocs(options.texteInitial.replaceAll("\n\n", "\n").replaceAll("_", "")));
        });
        pied.appendChild(btnEtat);
    });

    const btnReinitialiser = document.createElement('button');
    btnReinitialiser.type = 'button';
    btnReinitialiser.className = 'eip-btn eip-btn-reinitialiser';
    btnReinitialiser.textContent = 'Réinitialiser';

    const btnFermer = document.createElement('button');
    btnFermer.type = 'button';
    btnFermer.className = 'eip-btn eip-btn-fermer';
    btnFermer.textContent = 'Fermer';

    const btnValider = document.createElement('button');
    btnValider.type = 'button';
    btnValider.className = 'eip-btn eip-btn-valider';
    btnValider.textContent = 'Valider';

    pied.appendChild(btnReinitialiser);
    pied.appendChild(btnFermer);
    pied.appendChild(btnValider);
    boite.appendChild(pied);

    // Loader affiché par-dessus la boîte pendant la composition.
    const zoneLoader = document.createElement('div');
    zoneLoader.className = 'eip-loader';
    zoneLoader.innerHTML = `
      <div class="eip-loader-spinner"></div>
      <div class="eip-loader-texte">Création de l'image en cours...</div>
    `;
    zoneLoader.style.display = 'none';
    boite.appendChild(zoneLoader);

    overlay.appendChild(boite);
    document.body.appendChild(overlay);

    const definirChargement = (enCours: boolean): void => {
        zoneLoader.style.display = enCours ? 'flex' : 'none';
        btnValider.disabled = enCours;
        btnReinitialiser.disabled = enCours;
        btnFermer.disabled = enCours;
    };

    const afficherErreur = (message: string): void => {
        zoneErreur.textContent = message;
        zoneErreur.style.display = 'block';
    };

    const fermer = (): void => {
        manager.destroy();
        overlay.remove();
    };

    btnFermer.addEventListener('click', fermer);

    btnReinitialiser.addEventListener('click', () => {
        zoneErreur.style.display = 'none';
        initialiserContenu();
    });

    const lancerComposition = async (): Promise<void> => {
        zoneErreur.style.display = 'none';
        definirChargement(true);
        try {
            // Tout l'enchaînement (déplacement du scrollFrame dans le cadre du
            // template, ajustement de la police, capture, puis remise en
            // place du scrollFrame) est géré par composerSurImageTemplate.
            const blobFinal = await composerSurTemplate(manager);
            if (!blobFinal) {
                throw new Error("Impossible de générer l'image finale.");
            }

            // Transmet le résultat (URL d'affichage + blob brut pour
            // enregistrement) à l'appelant, puis ferme le popup.
            const urlFinal = URL.createObjectURL(blobFinal);
            options.onValider(urlFinal, blobFinal);
            fermer();
        } catch (erreur) {
            afficherErreur(
                erreur instanceof Error
                    ? erreur.message
                    : "Une erreur est survenue lors de la création de l'image."
            );
        } finally {
            definirChargement(false);
        }
    };

    btnValider.addEventListener('click', () => { void lancerComposition(); });
};