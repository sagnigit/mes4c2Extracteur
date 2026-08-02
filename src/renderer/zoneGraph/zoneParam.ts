// zoneParam.ts
//
// Panel "Paramètres" — panel normal (entête + bouton retour), ouvert
// depuis le menu de zoneAccueil.
//
// Le corps du panel contient 3 zones empilées :
//   01 — Mise à jour totale de l'application
//   02 — Mise à jour des codes d'injection
//   03 — Mode d'exportation (Par défaut / Personnalisé)
//
// Toute la construction du contenu passe par UNE fonction unique :
// renderZoneParam(container)
//   - vide entièrement le div reçu en paramètre (bodyParam)
//   - y insère un nouveau div qui prend tout l'espace et contient
//     les 3 blocs décrits ci-dessus
// Cette même fonction est rebranchée sur chaque bouton "Valider" : au
// clic, la zone est simplement vidée puis reconstruite.

import { Panel } from '../composer/Panel.js';
import { demanderMiseAJour } from './updateEcoute.js';
import { demanderMajCodesExtraction } from './majCodesEcoute.js';

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
        'La mise à jour totale remplace les fichiers actuels par la dernière version stable.'
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
        'Récupère et exécute les derniers scripts d’injection depuis le serveur.'
    );

    const hint = el(
        'p',
        'zp-module__hint',
        'Aucune saisie n’est nécessaire : les codes sont récupérés en ligne au moment de l’exécution.'
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
    }
}

function buildExportModule(): HTMLElement {
    const { module, body } = createModule(
        '03',
        'Mode d’exportation',
        'Choisis si l’export utilise la destination par défaut ou une destination que tu définis toi-même.'
    );

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
/* Fonction commune — vide le container et reconstruit tout            */
/* ------------------------------------------------------------------ */

const renderZoneParam = (container: HTMLElement): void => {
    // 1. On vide entièrement le div reçu en paramètre (bodyParam)
    container.innerHTML = '';

    // 2. On crée un nouveau div qui prend tout l'espace et contient les 3 zones
    const wrapper = el('div', 'zp-panel');

    const rail = el('div', 'zp-rail');
    rail.appendChild(buildUpdateModule());
    rail.appendChild(buildInjectionModule());
    rail.appendChild(buildExportModule());
    wrapper.appendChild(rail);

    container.appendChild(wrapper);
};