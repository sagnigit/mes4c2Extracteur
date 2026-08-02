// arrangeDonne.ts

/**
 * Prend une chaîne HTML contenant des balises <p>
 * et retourne une chaîne où chaque texte de <p>
 * est placé sur une ligne séparée par \n.
 */
export function arrangeEnnonceTcfCe(input: string): string {
  // Regex pour capturer le contenu des balises <p>
  const regex = /<p[^>]*>(.*?)<\/p>/g;
  let result: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = regex.exec(input)) !== null) {
    // match[1] contient le texte entre <p>...</p>
    result.push(match[1].trim());
  }

  // Joindre les lignes avec \n
  return result.join("\n");
}