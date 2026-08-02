export const strCode = `
(() => {
  const scripts = [...document.querySelectorAll('script')]
    .map(s => s.textContent || '')
    .filter(t => t.trim().startsWith('self.__next_f.push'));

  const collected = [];
  const fakeSelf = { __next_f: { push: (arg) => { collected.push(arg[1]); } } };

  for (const code of scripts) {
    try {
      new Function('self', code)(fakeSelf);
    } catch (e) {
      console.error("Erreur de parsing d'un chunk :", e);
    }
  }
  return collected.join('');
})();
`;