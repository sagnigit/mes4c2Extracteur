import { OverlayMessage } from '../generale/overlaymessage.js';

let affMessage: OverlayMessage;

export const initZoneBloquante = () => {
    affMessage = new OverlayMessage(document.body);
    window.api.on('message-overlay', (_event: any, message: string) => affMessage.setMessage(message));
}

export const ouvreZoneBloquant = (messageDepart = "") => affMessage.show(messageDepart);
export const fermerZoneBloquant = () => affMessage.hide();

export const setMessageProgression = (message: string) => affMessage.setMessage(message);
