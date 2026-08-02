

import { flushSauvegardesEnAttente } from './zoneGraph/zoneAff.js';

export const createCustomTitleBar = () => {
    const bar = document.createElement('div');
    bar.id = 'custom-titlebar';

    // Boutons
    const btnMin = document.createElement('button');
    btnMin.innerText = 'remove';

    const btnMax = document.createElement('button');
    btnMax.innerText = 'crop_square';

    const btnClose = document.createElement('button');
    btnClose.innerText = 'close';

    const btnActu = document.createElement('button');
    btnActu.innerText = 'refresh';

    [btnActu, btnMin, btnMax, btnClose].forEach(btn => {
        bar.appendChild(btn);
        btn.classList.add("iconMateriel");
    });

    btnClose.id = 'btn-close';

    document.body.prepend(bar);

    // Actions via IPC exposé dans preload
    btnMin.addEventListener('click', () => window.api.send('window-minimize'));
    btnMax.addEventListener('click', () => window.api.send('window-toggle-maximize'));
    btnClose.addEventListener('click', () => {
        void (async () => {
            // Force la sauvegarde de tout champ transformé encore en cours
            // d'édition (perte de focus provoquée manuellement) avant de
            // fermer réellement la fenêtre, pour ne jamais perdre une
            // dernière modification qui n'aurait pas encore été enregistrée.
            await flushSauvegardesEnAttente();
            window.api.send('window-close');
        })();
    });
    btnActu.addEventListener('click', () => window.api.send('window-refresh'));

    // Écoute du retour pour changer l’icône
    window.api.on('window-maximized', (even, isMaximized: boolean) => {
        btnMax.innerText = isMaximized ? 'filter_none' : 'crop_square';
    });
}
