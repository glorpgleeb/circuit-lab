// App shell: top bar with tabs, hash-based routing, theme toggle.
import { THEMES, applyTheme, currentTheme, setTheme, type Theme } from './theme';

export interface Page {
  id: string;
  title: string;
  render(root: HTMLElement): void;
}

export function mountShell(app: HTMLElement, pages: Page[]): void {
  applyTheme(currentTheme());

  app.innerHTML = `
    <header class="topbar">
      <span class="brand"><img class="avatar" src="avatar.png" alt="" width="22" height="22">Glorp Lab</span>
      <nav class="tabs">
        ${pages.map((p) => `<a href="#/${p.id}" data-page="${p.id}">${p.title}</a>`).join('')}
      </nav>
      <span class="spacer"></span>
      <label class="theme-pick">Thème <select id="theme">${THEMES.map((t) => `<option value="${t.id}">${t.label}</option>`).join('')}</select></label>
    </header>
    <main id="page"></main>`;

  const main = app.querySelector<HTMLElement>('#page')!;
  const themeSel = app.querySelector<HTMLSelectElement>('#theme')!;
  themeSel.value = currentTheme();
  themeSel.addEventListener('change', () => setTheme(themeSel.value as Theme));

  const route = () => {
    const id = location.hash.replace(/^#\//, '');
    const page = pages.find((p) => p.id === id) ?? pages[0];
    app.querySelectorAll<HTMLAnchorElement>('.tabs a').forEach((a) => {
      if (a.dataset.page === page.id) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    main.replaceChildren();
    page.render(main);
  };
  addEventListener('hashchange', route);
  route();
}
