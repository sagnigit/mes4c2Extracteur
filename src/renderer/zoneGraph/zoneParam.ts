// zoneParam.ts
//
// Panel "Paramètres" — panel normal (entête + bouton retour), ouvert
// depuis le menu de zoneAccueil.
//
// Le corps du panel contient 4 zones :
//   01 — Mise à jour totale de l'application        )  côte à côte
//   02 — Mise à jour des codes d'injection           )  (grille 2 colonnes)
//   03 — Mode d'exportation (Par défaut / Personnalisé) — pleine largeur
//   04 — Modification du mot de passe                   — pleine largeur
//
// Toute la construction du contenu passe par UNE fonction unique :
// renderZoneParam(container)
//   - vide entièrement le div reçu en paramètre (bodyParam)
//   - y insère un nouveau div qui prend tout l'espace et contient
//     les 4 blocs décrits ci-dessus, organisés en grille pour limiter
//     le scroll vertical.

import { Panel } from '../composer/Panel.js';
import { demanderMiseAJour } from './updateEcoute.js';
import { demanderMajCodesExtraction } from './majCodesEcoute.js';
import { typeErreur, typeReussite, creerMessage } from './gestionMessage.js';

type ExportMode = 'defaut' | 'personnalise';

let panParam: Panel;
let bodyParam: HTMLElement;

export const initZoneParam = (): void => {
    panParam = new Panel('Paramètres', true);
    bodyParam = panParam.getBody();
    renderZoneParam(bodyParam);
};

export const ouvrirZoneParam = (): void => {
    panParam.open();
};

/* ------------------------------------------------------------------ */
/* Petits utilitaires de construction DOM                              */
/* ------------------------------------------------------------------ */

function el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className?: string,
    text?: string
): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function createModule(
    index: string,
    title: string,
    subtitle: string
): { module: HTMLElement; body: HTMLElement } {
    const module = el('section', 'zp-module zone-ombre-simple');

    const header = el('div', 'zp-module__header');
    const badge = el('span', 'zp-module__badge', index);
    const titles = el('div', 'zp-module__titles');
    titles.appendChild(el('h3', 'zp-module__title', title));
    titles.appendChild(el('p', 'zp-module__subtitle', subtitle));
    const dot = el('span', 'zp-module__dot');
    header.append(badge, titles, dot);

    const body = el('div', 'zp-module__body');
    module.append(header, body);

    return { module, body };
}

function createButton(
    label: string,
    variant: 'primary' | 'ghost',
    onClick: () => void
): HTMLButtonElement {
    const btn = el('button', `zp-btn zp-btn--${variant} zoneReacif`, label) as HTMLButtonElement;
    btn.type = 'button';
    btn.addEventListener('click', onClick);
    return btn;
}

function createField(
    labelText: string,
    placeholder: string
): { wrapper: HTMLLabelElement; input: HTMLInputElement; status: HTMLElement } {
    const wrapper = el('label', 'zp-field') as HTMLLabelElement;

    const labelRow = el('div', 'zp-field__label-row');
    labelRow.appendChild(el('span', 'zp-field__label', labelText));
    const status = el('span', 'zp-field__status', 'Enregistré');
    labelRow.appendChild(status);
    wrapper.appendChild(labelRow);

    const input = el('input', 'zp-field__input') as HTMLInputElement;
    input.type = 'url';
    input.placeholder = placeholder;
    wrapper.appendChild(input);

    return { wrapper, input, status };
}

/* ------------------------------------------------------------------ */
/* Zone 01 — Mise à jour totale de l'application                      */
/* ------------------------------------------------------------------ */

function buildUpdateModule(): HTMLElement {
    const { module, body } = createModule(
        '01',
        'Mise à jour de l’application',
        'Vérifie et applique la dernière version disponible.'
    );

    const hint = el(
        'p',
        'zp-module__hint',
        'Remplace les fichiers actuels par la dernière version stable.'
    );

    const actions = el('div', 'zp-module__actions');
    actions.appendChild(
        createButton('Lancer la mise à jour', 'primary', () => {
            demanderMiseAJour();
        })
    );

    body.append(hint, actions);
    return module;
}

/* ------------------------------------------------------------------ */
/* Zone 02 — Mise à jour des codes d'injection                        */
/* ------------------------------------------------------------------ */

function buildInjectionModule(): HTMLElement {
    const { module, body } = createModule(
        '02',
        'Codes d’injection',
        'Récupère les derniers scripts d’injection depuis le serveur.'
    );

    const hint = el(
        'p',
        'zp-module__hint',
        'Aucune saisie nécessaire : les codes sont récupérés au moment de l’exécution.'
    );

    const actions = el('div', 'zp-module__actions');
    actions.appendChild(
        createButton('Exécuter les codes d’injection', 'primary', () => {
            demanderMajCodesExtraction();
        })
    );

    body.append(hint, actions);
    return module;
}

/* ------------------------------------------------------------------ */
/* Zone 03 — Mode d'exportation (Par défaut / Personnalisé)           */
/* ------------------------------------------------------------------ */

function createRadioOption(
    groupName: string,
    value: ExportMode,
    label: string,
    description: string
): { wrapper: HTMLLabelElement; input: HTMLInputElement } {
    const wrapper = el('label', 'zp-radio zoneReacif') as HTMLLabelElement;

    const input = document.createElement('input');
    input.type = 'radio';
    input.name = groupName;
    input.value = value;
    input.className = 'zp-radio__input';

    const visual = el('span', 'zp-radio__visual');

    const texts = el('span', 'zp-radio__texts');
    texts.appendChild(el('span', 'zp-radio__label', label));
    texts.appendChild(el('span', 'zp-radio__desc', description));

    wrapper.append(input, visual, texts);
    return { wrapper, input };
}

/* Bascule uniquement l'affichage des champs personnalisés — utilisé à
   la fois par le clic utilisateur (onExportModeChange, qui envoie en
   plus l'IPC) et par le chargement initial des références (qui ne
   doit PAS ré-écrire le mode côté main process). */
function appliquerModeVisuel(mode: ExportMode, champsPersonnalises: HTMLElement): void {
    champsPersonnalises.classList.toggle('zp-export-champs--open', mode === 'personnalise');
}

/* Se déclenche à chaque changement de mode d'exportation (clic sur une
   des deux radios) : met à jour l'affichage ET prévient le main
   process via IPC. */
function onExportModeChange(mode: ExportMode, champsPersonnalises: HTMLElement): void {
    appliquerModeVisuel(mode, champsPersonnalises);
    window.api.send('param:mode', mode);
}

type ChampLien = 'tcf' | 'tef' | 'connect';

/* Se déclenche à chaque perte de focus d'une zone de lien (TCF, TEF,
   connexion). C'est ici qu'on branche la validation / sauvegarde du
   lien saisi. */
function onLienBlur(nomChamp: ChampLien, input: HTMLInputElement): void {
    window.api.send('param:url', { type: nomChamp, valeur: input.value });
}

function attacherComportementLien(nomChamp: ChampLien, input: HTMLInputElement, status: HTMLElement): void {
    let timeoutId: number | undefined;

    input.addEventListener('blur', () => {
        onLienBlur(nomChamp, input);

        // Petit message "Enregistré" à côté du label, qui s'efface tout seul
        status.classList.add('zp-field__status--visible');
        if (timeoutId !== undefined) window.clearTimeout(timeoutId);
        timeoutId = window.setTimeout(() => {
            status.classList.remove('zp-field__status--visible');
        }, 1800);
    });

    // Entrée dans une zone de lien = on considère la saisie terminée,
    // donc on lui retire le focus (ce qui déclenche onLienBlur ci-dessus).
    input.addEventListener('keydown', (event: KeyboardEvent) => {
        if (event.key === 'Enter') {
            input.blur();
        }
    });
}

/* Interface minimale du retour de 'param:recup-ref'. Les clés
   "url-perso-*" ne sont pas toutes garanties par l'exemple fourni
   (seules mode / url-defaut-tcf / url-perso-connect / url-defaut-connect
   y figurent) : on lit donc chaque champ de façon défensive, avec un
   repli sur chaîne vide si la clé n'existe pas encore côté main. */
interface ReferencesParam {
    mode?: string;
    [cle: string]: string | undefined;
}

/* Va chercher l'état courant (mode + liens personnalisés) côté main
   process et pré-remplit les champs, sans déclencher onExportModeChange
   (donc sans ré-envoyer bêtement le mode qu'on vient de lire). */
async function chargerReferencesExport(
    optionDefaut: HTMLInputElement,
    optionPersonnalise: HTMLInputElement,
    tcfInput: HTMLInputElement,
    tefInput: HTMLInputElement,
    connectInput: HTMLInputElement,
    champsPersonnalises: HTMLElement
): Promise<void> {
    try {
        const refs: ReferencesParam = await window.api.invoke('param:recup-ref');
        if (!refs) return;

        tcfInput.value = refs['url-perso-tcf'] ?? '';
        tefInput.value = refs['url-perso-tef'] ?? '';
        connectInput.value = refs['url-perso-connect'] ?? '';

        const mode: ExportMode = refs.mode === 'personnalise' ? 'personnalise' : 'defaut';
        optionDefaut.checked = mode === 'defaut';
        optionPersonnalise.checked = mode === 'personnalise';
        appliquerModeVisuel(mode, champsPersonnalises);
    } catch (erreur) {
        console.error('Impossible de récupérer les références de paramètres :', erreur);
        creerMessage(typeErreur, 'Paramètres', 'Impossible de charger les références d’export.');
    }
}

function buildExportModule(): HTMLElement {
    const { module, body } = createModule(
        '03',
        'Mode d’exportation',
        'Destination automatique ou personnalisée pour l’export.'
    );
    // Contient plusieurs champs : garde toute la largeur du panel.
    module.classList.add('zp-module--full');

    const groupName = 'zp-export-mode';
    const optionDefaut = createRadioOption(
        groupName,
        'defaut',
        'Par défaut',
        'Utilise la destination d’export automatique.'
    );
    const optionPersonnalise = createRadioOption(
        groupName,
        'personnalise',
        'Personnalisé',
        'Définis toi-même les liens d’export.'
    );

    const radioGroup = el('div', 'zp-radio-group');
    radioGroup.append(optionDefaut.wrapper, optionPersonnalise.wrapper);

    const champsPersonnalises = el('div', 'zp-export-champs');
    // Sous-grille : les 3 liens tiennent côte à côte quand la largeur le permet.
    champsPersonnalises.classList.add('zp-export-champs-grid');

    const tcf = createField('Lien d’exportation TCF', 'https://…');
    const tef = createField('Lien d’exportation TEF', 'https://…');
    const connexion = createField(
        'Lien de connexion au site d’exportation',
        'https://…'
    );
    attacherComportementLien('tcf', tcf.input, tcf.status);
    attacherComportementLien('tef', tef.input, tef.status);
    attacherComportementLien('connect', connexion.input, connexion.status);
    champsPersonnalises.append(tcf.wrapper, tef.wrapper, connexion.wrapper);

    optionDefaut.input.addEventListener('change', () =>
        onExportModeChange('defaut', champsPersonnalises)
    );
    optionPersonnalise.input.addEventListener('change', () =>
        onExportModeChange('personnalise', champsPersonnalises)
    );

    // État visuel par défaut, le temps que les vraies références arrivent
    optionDefaut.input.checked = true;
    appliquerModeVisuel('defaut', champsPersonnalises);

    void chargerReferencesExport(
        optionDefaut.input,
        optionPersonnalise.input,
        tcf.input,
        tef.input,
        connexion.input,
        champsPersonnalises
    );

    body.append(radioGroup, champsPersonnalises);
    return module;
}

/* ------------------------------------------------------------------ */
/* Zone 04 — Modification du mot de passe                             */
/* ------------------------------------------------------------------ */

/** Un champ mot de passe avec label, œil afficher/masquer et zone d'erreur. */
function creerChampMdp(
    labelText: string,
    id: string
): { wrap: HTMLElement; input: HTMLInputElement; erreur: HTMLElement } {
    const wrap = el('div', 'zp-field');

    const lab = el('label', 'zp-label', labelText);
    lab.setAttribute('for', id);

    const ligne = el('div', 'zp-mdp-ligne');

    const input = document.createElement('input');
    input.type = 'password';
    input.id = id;
    input.className = 'zp-input';
    input.autocomplete = 'new-password';
    input.spellcheck = false;

    const erreur = el('span', 'zp-field-erreur');
    erreur.id = `${id}-erreur`;
    erreur.setAttribute('role', 'alert');
    erreur.setAttribute('hidden', '');
    input.setAttribute('aria-describedby', erreur.id);

    const btnOeil = document.createElement('button');
    btnOeil.type = 'button';
    btnOeil.className = 'zp-oeil iconMateriel';
    btnOeil.title = 'Afficher le mot de passe';
    btnOeil.setAttribute('aria-label', 'Afficher le mot de passe');
    btnOeil.textContent = 'visibility';
    btnOeil.addEventListener('click', () => {
        const visible = input.type === 'text';
        input.type = visible ? 'password' : 'text';
        btnOeil.textContent = visible ? 'visibility' : 'visibility_off';
        btnOeil.title = visible ? 'Afficher le mot de passe' : 'Masquer le mot de passe';
        btnOeil.setAttribute(
            'aria-label',
            visible ? 'Afficher le mot de passe' : 'Masquer le mot de passe'
        );
        input.focus();
    });

    ligne.append(input, btnOeil);
    wrap.append(lab, ligne, erreur);

    return { wrap, input, erreur };
}

function afficherErreurChamp(input: HTMLInputElement, erreur: HTMLElement, texte: string): void {
    erreur.textContent = texte;
    erreur.removeAttribute('hidden');
    input.classList.add('zp-input--erreur');
    input.setAttribute('aria-invalid', 'true');
}

function effacerErreurChamp(input: HTMLInputElement, erreur: HTMLElement): void {
    erreur.textContent = '';
    erreur.setAttribute('hidden', '');
    input.classList.remove('zp-input--erreur');
    input.removeAttribute('aria-invalid');
}

function buildMotDePasseModule(): HTMLElement {
    const { module, body } = createModule(
        '04',
        'Mot de passe',
        'Modifier le mot de passe d’accès (enregistré localement).'
    );
    // Contient plusieurs champs : garde toute la largeur du panel.
    module.classList.add('zp-module--full');

    const ancien = creerChampMdp('Ancien mot de passe', 'zp-mdp-ancien');
    const nouveau = creerChampMdp('Nouveau mot de passe', 'zp-mdp-nouveau');
    const confirm = creerChampMdp('Confirmer le nouveau', 'zp-mdp-confirm');

    // Sous-grille : les 3 champs tiennent côte à côte quand la largeur le permet.
    const champsMdp = el('div', 'zp-mdp-grid');
    champsMdp.append(ancien.wrap, nouveau.wrap, confirm.wrap);

    // L'erreur du champ disparaît dès qu'on retape dedans
    [ancien, nouveau, confirm].forEach(({ input, erreur }) => {
        input.addEventListener('input', () => effacerErreurChamp(input, erreur));
    });

    const actions = el('div', 'zp-actions');
    const btnEnregistrer = createButton('Enregistrer', 'primary', () => {
        void soumettreMotDePasse();
    });
    actions.appendChild(btnEnregistrer);

    let enCours = false;

    const definirEtatChargement = (actif: boolean): void => {
        btnEnregistrer.disabled = actif;
        [ancien.input, nouveau.input, confirm.input].forEach((i) => (i.disabled = actif));
        btnEnregistrer.classList.toggle('zp-btn--loading', actif);
        btnEnregistrer.textContent = actif ? 'Enregistrement…' : 'Enregistrer';
    };

    const validerFormulaire = (): boolean => {
        let ok = true;

        const valAncien = ancien.input.value.trim();
        const valNouveau = nouveau.input.value.trim();
        const valConfirm = confirm.input.value.trim();

        if (!valAncien) {
            afficherErreurChamp(ancien.input, ancien.erreur, 'Champ requis.');
            ok = false;
        }
        if (!valNouveau) {
            afficherErreurChamp(nouveau.input, nouveau.erreur, 'Champ requis.');
            ok = false;
        } else if (valNouveau.length < 4) {
            afficherErreurChamp(nouveau.input, nouveau.erreur, '4 caractères minimum.');
            ok = false;
        }
        if (!valConfirm) {
            afficherErreurChamp(confirm.input, confirm.erreur, 'Champ requis.');
            ok = false;
        } else if (valNouveau && valConfirm !== valNouveau) {
            afficherErreurChamp(confirm.input, confirm.erreur, 'Ne correspond pas au nouveau mot de passe.');
            ok = false;
        }

        return ok;
    };

    const soumettreMotDePasse = async (): Promise<void> => {
        if (enCours) return;

        [ancien, nouveau, confirm].forEach(({ input, erreur }) => effacerErreurChamp(input, erreur));

        if (!validerFormulaire()) {
            const premier = [ancien, nouveau, confirm].find(
                ({ input }) => input.classList.contains('zp-input--erreur')
            );
            premier?.input.focus();
            return;
        }

        const payload = {
            ancien: ancien.input.value.trim(),
            nouveau: nouveau.input.value.trim(),
        };

        enCours = true;
        definirEtatChargement(true);

        try {
            const res = (await window.api.invoke('auth:modifier', payload)) as {
                success?: boolean;
                error?: string;
            };

            if (res?.success) {
                ancien.input.value = '';
                nouveau.input.value = '';
                confirm.input.value = '';
                creerMessage(typeReussite, 'Mot de passe', 'Mot de passe mis à jour.');
            } else {
                const message = res?.error ?? 'Ancien mot de passe incorrect.';
                afficherErreurChamp(ancien.input, ancien.erreur, message);
                ancien.input.value = '';
                ancien.input.focus();
                creerMessage(typeErreur, 'Mot de passe', message);
            }
        } catch (err: any) {
            const message = err?.message ?? 'Échec de la modification du mot de passe.';
            afficherErreurChamp(ancien.input, ancien.erreur, message);
            creerMessage(typeErreur, 'Mot de passe', message);
        } finally {
            enCours = false;
            definirEtatChargement(false);
        }
    };

    body.append(champsMdp, actions);
    return module;
}

/* ------------------------------------------------------------------ */
/* Fonction commune — vide le container et reconstruit tout            */
/* ------------------------------------------------------------------ */

const renderZoneParam = (container: HTMLElement): void => {
    // 1. On vide entièrement le div reçu en paramètre (bodyParam)
    container.innerHTML = '';

    // 2. On crée un nouveau div qui prend tout l'espace et contient les zones,
    //    organisées en grille (voir .zp-rail en CSS) pour limiter le scroll.
    const wrapper = el('div', 'zp-panel');

    const rail = el('div', 'zp-rail');
    rail.appendChild(buildUpdateModule());
    rail.appendChild(buildInjectionModule());
    rail.appendChild(buildExportModule());
    rail.appendChild(buildMotDePasseModule());
    wrapper.appendChild(rail);

    container.appendChild(wrapper);
};