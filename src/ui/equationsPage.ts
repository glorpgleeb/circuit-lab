// Equation builder page: formula text, auto-built variable form, typeset results.
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { texSymbol, toTex, toText } from '../equations/expr';
import {
  BUILTIN_MODULES,
  LINK_FIELDS,
  exportModules,
  loadUserModules,
  newId,
  parseModuleFile,
  saveUserModules,
  type Module,
  type ResistorLink,
} from '../equations/modules';
import { solveFor, type SolveOutcome } from '../equations/solve';
import { evaluateSystem, parseSystem, readInput, type EqResult, type EqSystem, type InputValue } from '../equations/system';
import { parseUnit, unitName, type Dims, type Unit } from '../units/dims';
import { formatPlain, formatSI } from '../units/si';
import { copyButton } from './copy';
import type { Page } from './shell';
import { setSolverPrefill } from './solverPage';

interface VarState { value: string; unit: string }

// Current module and its working state (kept across tab switches for this browser session).
let meta: Module = BUILTIN_MODULES[0];
let text = meta.formulas;
const vars = new Map<string, VarState>(Object.entries(meta.variables).map(([k, d]) => [k, { ...d }]));
let dirty = false;
let userModules: Module[] | null = null; // loaded on first render
let storageError: string | undefined;
// Solve mode: `unknown` is an input to find, `target` the computed variable whose value is given.
let unknown: string | null = null;
let target: string | null = null;
let pick = 0; // which solution feeds the rest when there are several
const state = (name: string) => vars.get(name) ?? vars.set(name, { value: '', unit: '' }).get(name)!;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** Value with the best SI prefix when the unit is known, plain number otherwise. */
export function formatValue(v: number, dims: Dims | null): string {
  const u = dims ? unitName(dims) : '';
  return u ? formatSI(v, u) : formatPlain(v);
}

export const equationsPage: Page = {
  id: 'equations',
  title: 'Équations',
  render(root) {
    root.innerHTML = `
      <div class="eq-layout">
        <div class="col">
          <section class="panel module-bar">
            <div class="bar">
              <select id="mod-select" aria-label="Module"></select>
              <button id="mod-new" title="Jeu d’équations vide">Nouveau</button>
              <button id="mod-save" class="primary" title="Enregistrer (un module intégré est enregistré comme copie)">Enregistrer</button>
              <button id="mod-saveas">Enregistrer sous…</button>
              <button id="mod-delete">Supprimer</button>
              <span class="spacer"></span>
              <button id="mod-export" title="Télécharger ce module en JSON">Exporter</button>
              <button id="mod-export-all" title="Télécharger tous les modules enregistrés en JSON">Tout exporter</button>
              <button id="mod-import" title="Charger des modules depuis un fichier JSON">Importer…</button>
              <input type="file" id="mod-file" accept=".json,application/json" hidden>
            </div>
            <div class="grid meta">
              <label>Nom<input id="mod-name" maxlength="100"></label>
              <label>Tags<input id="mod-tags" placeholder="séparés par des virgules" maxlength="400"></label>
              <label class="row wide">Description<input id="mod-desc" maxlength="2000"></label>
            </div>
            <ul id="mod-msgs" class="msgs"></ul>
          </section>
          <section class="panel">
            <label for="eq-text" class="head">Équations <span class="muted">une par ligne, <code>nom = expression</code>, dans n’importe quel ordre, <code>#</code> pour les commentaires</span></label>
            <textarea id="eq-text" rows="6" spellcheck="false" autocomplete="off"></textarea>
            <ul id="eq-errors" class="msgs"></ul>
          </section>
          <section class="panel">
            <div class="head">Variables <span class="muted">valeurs : 4.7k, 100n, 2.2u, 1M, 4k7 ; unités : V, A, Ω, F, H, Hz, s, W, mA, V/us…</span></div>
            <table class="vars"><thead><tr><th>Nom</th><th>Valeur</th><th>Unité</th><th><label class="solve-none" title="Pas d’inconnue : calculer les sorties">Résoudre pour <input type="radio" name="unknown" value=""> aucune</label></th><th></th></tr></thead><tbody id="vars"></tbody></table>
            <ul id="var-msgs" class="msgs"></ul>
          </section>
        </div>
        <section class="panel col" id="eq-results" aria-live="polite"></section>
      </div>`;

    const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
    const textarea = $<HTMLTextAreaElement>('#eq-text');
    const tbody = $('#vars');
    textarea.value = text;
    const msg = (html: string, kind: 'ok' | 'err' | 'warn' = 'ok') => ($('#mod-msgs').innerHTML = html && `<li class="${kind}">${html}</li>`);
    const lastValues = new Map<string, number>(); // current numbers, for "Find best resistors"

    if (!userModules) {
      const loaded = loadUserModules();
      userModules = loaded.modules;
      storageError = loaded.error;
    }
    if (storageError) msg(esc(storageError), 'err');

    const fillSelect = () => {
      const opt = (m: Module) => `<option value="${esc(m.id)}"${m.id === meta.id ? ' selected' : ''}>${esc(m.name)}${m.tags.length ? ` — ${esc(m.tags.join(', '))}` : ''}</option>`;
      const isNew = !BUILTIN_MODULES.some((m) => m.id === meta.id) && !userModules!.some((m) => m.id === meta.id);
      $('#mod-select').innerHTML =
        (isNew ? `<option value="${esc(meta.id)}" selected>${esc(meta.name)} (non enregistré)</option>` : '') +
        `<optgroup label="Intégrés">${BUILTIN_MODULES.map(opt).join('')}</optgroup>` +
        `<optgroup label="Mes modules">${userModules!.length ? userModules!.map(opt).join('') : '<option disabled>aucun pour l’instant</option>'}</optgroup>`;
      ($('#mod-delete') as HTMLButtonElement).disabled = !!meta.builtin || !userModules!.some((m) => m.id === meta.id);
    };
    const fillMeta = () => {
      $<HTMLInputElement>('#mod-name').value = meta.name;
      $<HTMLInputElement>('#mod-tags').value = meta.tags.join(', ');
      $<HTMLInputElement>('#mod-desc').value = meta.description;
      fillSelect();
    };
    const markDirty = () => (dirty = true);
    const confirmDiscard = () => !dirty || confirm('Abandonner les modifications non enregistrées de ce module ?');

    /** The module as currently edited: formulas, defaults from the form, metadata fields. */
    const snapshot = (): Omit<Module, 'id'> => {
      const names = [...new Set([...sys.inputs, ...sys.equations.map((e) => e.lhs)])];
      return {
        name: $<HTMLInputElement>('#mod-name').value.trim() || 'Sans titre',
        description: $<HTMLInputElement>('#mod-desc').value.trim(),
        tags: $<HTMLInputElement>('#mod-tags').value.split(',').map((t) => t.trim()).filter(Boolean),
        formulas: textarea.value,
        variables: Object.fromEntries(names.map((n) => [n, { ...state(n) }])),
        ...(meta.resistorLinks ? { resistorLinks: meta.resistorLinks.filter((l) => l.resistors.every((r) => names.includes(r))) } : {}),
      };
    };
    const load = (m: Module) => {
      meta = m;
      text = m.formulas;
      textarea.value = text;
      vars.clear();
      for (const [k, d] of Object.entries(m.variables)) vars.set(k, { ...d });
      unknown = target = null;
      dirty = false;
      fillMeta();
      rebuild();
    };
    const persist = (): boolean => {
      const err = saveUserModules(userModules!);
      if (err) msg(esc(err), 'err');
      return !err;
    };
    const uniqueName = (name: string) => {
      const taken = new Set([...BUILTIN_MODULES, ...userModules!].map((m) => m.name));
      if (!taken.has(name)) return name;
      for (let i = 2; ; i++) if (!taken.has(`${name} (${i})`)) return `${name} (${i})`;
    };
    const saveAsNew = () => {
      const m: Module = { ...snapshot(), id: newId() };
      m.name = uniqueName(m.name);
      userModules!.push(m);
      if (persist()) {
        meta = m;
        dirty = false;
        fillMeta();
        msg(`Enregistré sous « ${esc(m.name)} ».`);
      }
    };
    const download = (filename: string, json: string) => {
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      const a = Object.assign(document.createElement('a'), { href: url, download: filename });
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'module';

    $('#mod-select').addEventListener('change', (e) => {
      const id = (e.target as HTMLSelectElement).value;
      const m = [...BUILTIN_MODULES, ...userModules!].find((x) => x.id === id);
      if (m && confirmDiscard()) load(m);
      else fillSelect();
    });
    $('#mod-new').addEventListener('click', () => {
      if (confirmDiscard()) load({ id: newId(), name: 'Nouveau module', description: '', tags: [], formulas: 'y = a * x + b', variables: {} });
    });
    $('#mod-save').addEventListener('click', () => {
      const i = userModules!.findIndex((m) => m.id === meta.id);
      if (i < 0) return saveAsNew(); // built-in or never saved: save a copy
      const m: Module = { ...snapshot(), id: meta.id };
      userModules![i] = m;
      if (persist()) {
        meta = m;
        dirty = false;
        fillMeta();
        msg(`« ${esc(m.name)} » enregistré.`);
      }
    });
    $('#mod-saveas').addEventListener('click', saveAsNew);
    $('#mod-delete').addEventListener('click', () => {
      const i = userModules!.findIndex((m) => m.id === meta.id);
      if (i < 0 || !confirm(`Supprimer le module « ${meta.name} » de ce navigateur ? C’est définitif (exportez-le d’abord pour en garder une copie).`)) return;
      const [removed] = userModules!.splice(i, 1);
      if (persist()) {
        dirty = false;
        load(BUILTIN_MODULES[0]);
        msg(`« ${esc(removed.name)} » supprimé.`);
      } else userModules!.splice(i, 0, removed);
    });
    $('#mod-export').addEventListener('click', () => {
      const m = { ...snapshot(), id: meta.builtin ? newId() : meta.id };
      download(`${slug(m.name)}.json`, exportModules([m]));
    });
    $('#mod-export-all').addEventListener('click', () => {
      if (!userModules!.length) return msg('Aucun module enregistré à exporter. Utilisez Exporter pour le module courant.', 'warn');
      download('glorp-lab-modules.json', exportModules(userModules!));
    });
    const fileInput = $<HTMLInputElement>('#mod-file');
    $('#mod-import').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      fileInput.value = '';
      if (!file) return;
      if (file.size > 2_000_000) return msg('Fichier de plus de 2 Mo : ce n’est pas un fichier de modules.', 'err');
      const { modules, errors } = parseModuleFile(await file.text());
      const added = modules.map((m) => ({ ...m, id: newId(), name: uniqueName(m.name) }));
      userModules!.push(...added);
      if (added.length && !persist()) {
        userModules!.splice(userModules!.length - added.length);
        return;
      }
      const lines = [];
      if (added.length) lines.push(`<li class="ok">${added.length} module${added.length > 1 ? 's importés' : ' importé'}.</li>`);
      errors.forEach((e) => lines.push(`<li class="err">${esc(e)}</li>`));
      if (!added.length && !errors.length) lines.push('<li class="warn">Le fichier ne contient aucun module.</li>');
      if (added.length && confirmDiscard()) load(added[0]);
      else fillSelect();
      $('#mod-msgs').innerHTML = lines.join('');
    });
    for (const id of ['#mod-name', '#mod-tags', '#mod-desc']) $(id).addEventListener('input', markDirty);
    textarea.addEventListener('input', markDirty);
    tbody.addEventListener('input', markDirty);
    fillMeta();

    let sys: EqSystem = parseSystem(text);
    let timer = 0;
    textarea.addEventListener('input', () => {
      clearTimeout(timer);
      timer = window.setTimeout(rebuild, 150);
    });
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        rebuild();
      }
    });
    tbody.addEventListener('input', (e) => {
      const input = e.target as HTMLInputElement;
      const { name, field } = input.dataset;
      if (!name || !field) return;
      state(name)[field as keyof VarState] = input.value;
      compute();
    });
    tbody.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') compute();
    });
    root.querySelector('table.vars')!.addEventListener('change', (e) => {
      const r = e.target as HTMLInputElement;
      if (r.name !== 'unknown') return;
      unknown = r.value || null;
      pick = 0;
      renderTable();
    });
    rebuild();

    /** Computed variables whose value depends on `x`, directly or through intermediates. */
    function dependents(x: string): string[] {
      const dep = new Map<string, boolean>();
      const visit = (v: string): boolean => {
        if (dep.has(v)) return dep.get(v)!;
        dep.set(v, false);
        const eq = sys.equations.find((e) => e.lhs === v);
        const r = !!eq && eq.deps.some((d) => d === x || visit(d));
        dep.set(v, r);
        return r;
      };
      return sys.computed.filter(visit);
    }

    function rebuild() {
      if (!textarea.isConnected) return; // page left before the debounce fired
      text = textarea.value;
      sys = parseSystem(text);
      $('#eq-errors').innerHTML = sys.errors.map((e) => `<li class="err">Line ${e.line}: ${esc(e.message)}</li>`).join('');
      renderTable();
    }

    function renderTable() {
      if (unknown && !sys.inputs.includes(unknown)) unknown = null;
      const cands = unknown ? dependents(unknown) : [];
      if (!target || !cands.includes(target)) {
        // default: a final output (not used by another candidate), last in evaluation order
        const used = new Set(cands.flatMap((c) => sys.equations.find((e) => e.lhs === c)!.deps));
        target = [...cands].reverse().find((c) => !used.has(c)) ?? cands[cands.length - 1] ?? null;
      }
      root.querySelector<HTMLInputElement>(`input[name="unknown"][value=""]`)!.checked = !unknown;

      const cyclic = sys.equations.filter((e) => sys.cycles.has(e.lhs)).map((e) => e.lhs);
      const row = (name: string, computed: boolean) => {
        const s = state(name);
        const isInput = computed ? name === target && !!unknown : name !== unknown;
        const value = isInput
          ? `<input data-name="${name}" data-field="value" value="${esc(s.value)}" aria-label="Valeur de ${name}"${computed ? ' class="given" title="Valeur donnée pour la résolution"' : ''}>`
          : `<output class="mono${!computed ? ' solved' : ''}" id="out-${name}">—</output>`;
        const role = computed
          ? name === target && unknown ? '<span class="badge given">donnée</span>' : '<span class="muted">calculée</span>'
          : `<input type="radio" name="unknown" value="${name}"${name === unknown ? ' checked' : ''} aria-label="Résoudre pour ${name}">`;
        return `<tr><td class="mono name">${name}</td><td>${value}</td>
          <td><input class="unit" data-name="${name}" data-field="unit" value="${esc(s.unit)}" aria-label="Unité de ${name}" id="unit-${name}"></td>
          <td>${role}</td><td class="best" id="best-${name}"></td></tr>`;
      };
      // Inputs follow the module's variable order when it lists them, else order of appearance.
      const order = Object.keys(meta.variables);
      const rank = (n: string) => (order.includes(n) ? order.indexOf(n) : order.length + sys.inputs.indexOf(n));
      const inputs = [...sys.inputs].sort((a, b) => rank(a) - rank(b));
      tbody.innerHTML =
        inputs.map((n) => row(n, false)).join('') + [...sys.computed, ...cyclic].map((n) => row(n, true)).join('');
      compute();
    }

    function compute() {
      const inputs = new Map<string, InputValue>();
      const msgs: string[] = [];
      const report = (name: string, inp: InputValue) => {
        const field = tbody.querySelector<HTMLInputElement>(`input[data-name="${name}"][data-field="value"]`);
        field?.toggleAttribute('aria-invalid', !!inp.error);
        if (inp.error) msgs.push(`<li class="err">${name}: ${esc(inp.error)}</li>`);
        if (inp.warning) msgs.push(`<li class="warn">${name}: ${esc(inp.warning)}</li>`);
      };
      for (const name of sys.inputs) {
        if (name === unknown) continue;
        const s = state(name);
        const inp = readInput(s.value, s.unit);
        inputs.set(name, inp);
        report(name, inp);
      }
      const declared = new Map<string, Unit | null>();
      for (const name of sys.computed) {
        const u = parseUnit(state(name).unit);
        if (u && 'error' in u) msgs.push(`<li class="err">${name}: ${esc(u.error)}</li>`);
        else declared.set(name, u);
      }

      let outcome: SolveOutcome | null = null;
      if (unknown && target) {
        const given = readInput(state(target).value, state(target).unit);
        report(target, given);
        outcome = solveFor(sys, unknown, target, inputs, given);
        const uu = parseUnit(state(unknown).unit);
        const unit = uu && !('error' in uu) ? uu : null;
        if (outcome.ok && outcome.solutions.length) {
          pick = Math.min(pick, outcome.solutions.length - 1);
          inputs.set(unknown, { value: outcome.solutions[pick], unit });
        } else inputs.set(unknown, { unit });
      }
      $('#var-msgs').innerHTML = msgs.join('');

      const results = evaluateSystem(sys, inputs, declared);
      lastValues.clear();
      for (const [name, inp] of inputs) if (inp.value !== undefined && !inp.error) lastValues.set(name, inp.value);
      for (const [name, r] of results) if (r.value !== undefined) lastValues.set(name, r.value);
      // "Find best resistors" next to every variable whose unit is Ω
      for (const name of [...sys.inputs, ...sys.computed]) {
        const cell = tbody.querySelector(`#best-${CSS.escape(name)}`);
        const dims = inputs.get(name)?.unit?.dims ?? declared.get(name)?.dims ?? results.get(name)?.dims;
        if (!cell) continue;
        cell.replaceChildren();
        if (dims && unitName(dims) === 'Ω') {
          const b = Object.assign(document.createElement('button'), { type: 'button', className: 'copy', textContent: 'Meilleures R' });
          b.title = 'Chercher les meilleures résistances de série E pour cette valeur';
          b.addEventListener('click', () => findBest(name));
          cell.append(b);
        }
      }
      for (const [name, r] of results) {
        const out = tbody.querySelector(`#out-${CSS.escape(name)}`);
        if (out) out.textContent = r.value === undefined ? '—' : formatValue(r.value, r.dims);
        const unitField = tbody.querySelector<HTMLInputElement>(`#unit-${CSS.escape(name)}`);
        if (unitField) unitField.placeholder = r.dims ? unitName(r.dims) || '1' : '';
      }
      if (unknown) {
        const x = inputs.get(unknown)!;
        tbody.querySelector(`#out-${CSS.escape(unknown)}`)!.textContent =
          x.value === undefined ? '—' : formatValue(x.value, x.unit?.dims ?? null);
      }
      const box = $('#eq-results');
      box.innerHTML = '';
      if (unknown) renderSolve(box, outcome, inputs.get(unknown)!);
      renderResults(box, results);
    }

    /** Send the current values to the resistor solver, as a pair problem when the module defines one. */
    function findBest(name: string) {
      const link: ResistorLink = meta.resistorLinks?.find((l) => l.resistors.includes(name)) ?? { mode: 'single', resistors: [name], fields: { rt: name } };
      const fields: Record<string, string> = {};
      const missing: string[] = [];
      for (const f of LINK_FIELDS[link.mode]) {
        const v = lastValues.get(link.fields[f]);
        if (v === undefined) missing.push(link.fields[f]);
        else fields[f] = String(Number(v.toPrecision(12)));
      }
      if (missing.length) return msg(`Renseignez d’abord ${esc(missing.join(', '))} pour chercher les meilleures résistances.`, 'warn');
      setSolverPrefill({ mode: link.mode, fields, source: `${meta.name}: ${link.resistors.join(', ')}` });
      location.hash = '#/solver';
    }

    function renderSolve(box: HTMLElement, outcome: SolveOutcome | null, x: InputValue) {
      const card = document.createElement('div');
      card.className = 'solve-card';
      const cands = dependents(unknown!);
      card.innerHTML = `<div class="head">Résoudre pour <span class="mono">${unknown}</span>
        <span class="muted">sachant</span> <select id="target" aria-label="Variable donnée">${cands.map((c) => `<option${c === target ? ' selected' : ''}>${c}</option>`).join('')}</select>
        ${outcome?.ok ? `<span class="badge">${outcome.method === 'symbolic' ? 'symbolique' : 'numérique'}</span>` : ''}</div>`;
      card.querySelector('select')!.addEventListener('change', (e) => {
        target = (e.target as HTMLSelectElement).value;
        pick = 0;
        renderTable();
      });
      if (!outcome || !outcome.ok) {
        card.insertAdjacentHTML('beforeend', `<p class="err">${esc(outcome ? (outcome as { error: string }).error : `${unknown} n’influe sur aucune variable calculée`)}</p>`);
        box.append(card);
        return;
      }
      for (const e of outcome.exprs) {
        card.insertAdjacentHTML('beforeend', `<div class="eq-tex">${katex.renderToString(`${texSymbol(unknown!)} = ${toTex(e)}`, { throwOnError: false, displayMode: true })}</div>`);
      }
      card.insertAdjacentHTML('beforeend', `<p class="${outcome.solutions.length ? 'ok' : 'err'}">${esc(outcome.message)}</p>`);
      const dims = x.unit?.dims ?? null;
      outcome.solutions.forEach((v, i) => {
        const text = formatValue(v, dims);
        const line = document.createElement('div');
        line.className = 'eq-value';
        line.innerHTML = `${outcome.solutions.length > 1 ? `<input type="radio" name="pick" ${i === pick ? 'checked' : ''} aria-label="Utiliser la solution ${i + 1}">` : ''}
          <span class="mono">${unknown} = </span><strong class="mono">${text}</strong><span class="spacer"></span><span class="copies"></span>`;
        line.querySelector('input')?.addEventListener('change', () => {
          pick = i;
          compute();
        });
        const copies = line.querySelector('.copies')!;
        copies.append(copyButton(() => text, 'Valeur'));
        const ex = outcome.exprs[i];
        if (ex) copies.append(copyButton(() => `${unknown} = ${toText(ex)}`, 'Formule'), copyButton(() => `${texSymbol(unknown!)} = ${toTex(ex)}`, 'LaTeX'));
        card.append(line);
      });
      if (outcome.solutions.length > 1) card.insertAdjacentHTML('beforeend', '<p class="muted">La solution choisie alimente les résultats ci-dessous.</p>');
      outcome.notes.forEach((n) => card.insertAdjacentHTML('beforeend', `<div class="muted note">${esc(n)}</div>`));
      box.append(card);
    }

    function renderResults(box: HTMLElement, results: Map<string, EqResult>) {
      box.insertAdjacentHTML('beforeend', '<div class="head">Résultats</div>');
      if (!sys.equations.length) {
        box.insertAdjacentHTML('beforeend', '<p class="muted">Saisissez une équation, par ex. <code>P = V * I</code>.</p>');
        return;
      }
      const usedBy = new Set(sys.equations.flatMap((e) => e.deps));
      const ordered = [...sys.order, ...sys.equations.filter((e) => sys.cycles.has(e.lhs))];
      for (const eq of ordered) {
        const r = results.get(eq.lhs)!;
        const tex = `${texSymbol(eq.lhs)} = ${toTex(eq.rhs)}`;
        const valueText = r.value === undefined ? '' : formatValue(r.value, r.dims);
        const card = document.createElement('div');
        card.className = 'eq-card';
        card.innerHTML = `
          <div class="eq-tex">${katex.renderToString(tex, { throwOnError: false, displayMode: true })}</div>
          <div class="eq-value">
            <span class="mono">${eq.lhs} = </span>
            ${r.value === undefined ? `<span class="err">${esc(r.error ?? '—')}</span>` : `<strong class="mono">${valueText}</strong>`}
            ${usedBy.has(eq.lhs) ? '<span class="badge">intermédiaire</span>' : ''}
            <span class="spacer"></span><span class="copies"></span>
          </div>
          ${r.warnings.map((w) => `<div class="warn">⚠ ${esc(w)}</div>`).join('')}`;
        const copies = card.querySelector('.copies')!;
        if (r.value !== undefined) copies.append(copyButton(() => valueText, 'Valeur'));
        copies.append(copyButton(() => `${eq.lhs} = ${toText(eq.rhs)}`, 'Formule'), copyButton(() => tex, 'LaTeX'));
        box.append(card);
      }
    }
  },
};
