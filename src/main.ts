import './style.css';
import { mountShell, type Page } from './ui/shell';
import { solverPage } from './ui/solverPage';
import { equationsPage } from './ui/equationsPage';

// Placeholder pages; each is replaced by its real module in later steps.
const placeholder = (id: string, title: string, note: string): Page => ({
  id,
  title,
  render(root) {
    root.innerHTML = `<section class="panel"><h2>${title}</h2><p class="muted">${note}</p></section>`;
  },
});

mountShell(document.querySelector<HTMLElement>('#app')!, [
  equationsPage,
  solverPage,
  placeholder('packages', 'Boîtiers', 'Recherche de boîtiers KiCad : étape 6.'),
]);
