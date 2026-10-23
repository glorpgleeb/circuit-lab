// Copy-to-clipboard button with brief feedback in the button label.
export function copyButton(getText: () => string, label = 'Copier'): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'copy';
  btn.textContent = label;
  btn.title = 'Copier dans le presse-papiers';
  btn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(getText());
      btn.textContent = 'Copié';
    } catch {
      btn.textContent = 'Échec de la copie';
    }
    setTimeout(() => (btn.textContent = label), 1200);
  });
  return btn;
}
