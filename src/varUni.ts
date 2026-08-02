export const compteurs = "compteurs";
//la liste des id qui seron utiliser pour reconnaitre le type d'extraction a faire:
export const listeIdActu: string[] = ["tcf-ce", "tcf-co", "tcf-ee", "tcf-eo", "tef-session"];

//utiliser dans le main-process et le renderer pour referencer le type d'element a exporter
export type ZoneExport =
    | 'tcf-ce'
    | 'tcf-co'
    | 'tcf-ee'
    | 'tcf-eo'
    | 'tef-ce'
    | 'tef-co'
    | 'tef-ee'
    | 'tef-eo';
