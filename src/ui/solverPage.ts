// Resistor solver page: form on the left, ranked solutions on the right.
import { SERIES_NAMES, type SeriesName } from '../solver/eseries';
import { solve, type Kind, type Position, type Solution } from '../solver/solve';
import { Rational } from '../units/rational';
import { formatPercent, formatSI, parseSI } from '../units/si';
import { copyButton } from './copy';
import type { Page } from './shell';

export type ModeId = 'divider' | 'feedback' | 'ratio' | 'single';
interface Field { id: string; label: string; def: string; unit: string; optional?: boolean }
interface Mode { label: string; kind: Kind; fields: Field[] }

const MODES: Record<ModeId, Mode> = {
  divider: {
    label: 'Diviseur de tension : Vout = Vin·R2/(R1+R2)',
    kind: 'divider',
    fields: [
      { id: 'vin', label: 'Vin', def: '5', unit: 'V' },
      { id: 'vout', label: 'Vout', def: '3.3', unit: 'V' },
    ],
  },
  feedback: {
    label: 'Contre-réaction de régulateur : Vout = Vref·(1 + R1/R2)',
    kind: 'gain',
    fields: [
      { id: 'vref', label: 'Vref', def: '0.8', unit: 'V' },
      { id: 'vout', label: 'Vout', def: '3.3', unit: 'V' },
    ],
  },
  ratio: {
    label: 'Rapport R1/R2 (ex. gain inverseur)',
    kind: 'ratio',
    fields: [
      { id: 'ratio', label: 'R1/R2', def: '2.2', unit: '' },
      { id: 'vnet', label: 'V aux bornes de R1+R2', def: '', unit: 'V', optional: true },
    ],
  },
  single: {
    label: 'Résistance seule',
    kind: 'single',
    fields: [
      { id: 'rt', label: 'R cible', def: '4.7k', unit: 'Ω' },
      { id: 'vnet', label: 'V aux bornes de R', def: '', unit: 'V', optional: true },
    ],
  },
};

const TOLERANCES = ['5', '2', '1', '0.5', '0.25', '0.1'];

/** Values handed over by a module's "Find best resistors" button, applied on the next render. */
export interface SolverPrefill {
  mode: ModeId;
  fields: Record<string, string>;
  source: string;
}
let prefill: SolverPrefill | null = null;
export function setSolverPrefill(p: SolverPrefill): void {
  prefill = p;
}
const pct = (r: Rational) => r.div(Rational.int(100));

export const solverPage: Page = {
  id: 'solver',
  title: 'Résistances',
  render(root) {
    root.innerHTML = `
      <div class="split">
        <form class="panel form" id="solver-form" novalidate>
          <label class="row wide">Problème
            <select id="mode">${Object.entries(MODES).map(([id, m]) => `<option value="${id}">${m.label}</option>`).join('')}</select>
          </label>
          <div id="mode-fields" class="grid"></div>
          <div class="grid">
            <label>Précision ±<span class="in"><input id="precision" value="1" inputmode="decimal"><i>%</i></span></label>
            <label>Critère<select id="check"><option value="worst">pire cas</option><option value="nominal">nominal</option></select></label>
            <label>Série<select id="series">${SERIES_NAMES.map((s) => `<option${s === 'E24' ? ' selected' : ''}>${s}</option>`).join('')}</select></label>
            <label>Tolérance<select id="tolerance">${TOLERANCES.map((t) => `<option value="${t}"${t === '1' ? ' selected' : ''}>${t} %</option>`).join('')}</select></label>
            <label>R min<span class="in"><input id="minR" value="10"><i>Ω</i></span></label>
            <label>R max<span class="in"><input id="maxR" value="1M"><i>Ω</i></span></label>
            <label>Courant max<span class="in"><input id="maxI" placeholder="—"><i>A</i></span></label>
            <label>Puissance max / composant<span class="in"><input id="maxP" placeholder="—"><i>W</i></span></label>
          </div>
          <label class="check"><input type="checkbox" id="combos"> Autoriser les paires (série/parallèle de deux valeurs par position)</label>
          <div class="actions"><button class="primary" type="submit">Chercher les meilleures résistances</button><span class="muted">Entrée</span></div>
        </form>
        <section class="panel results" id="results" aria-live="polite"></section>
      </div>`;

    const $ = <T extends HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!;
    const form = $<HTMLFormElement>('solver-form');
    const modeSel = $<HTMLSelectElement>('mode');
    const fieldsBox = $('mode-fields');
    const out = $('results');

    const renderFields = () => {
      const mode = MODES[modeSel.value as ModeId];
      fieldsBox.innerHTML = mode.fields
        .map((f) => `<label>${f.label}<span class="in"><input id="f-${f.id}" value="${f.def}" placeholder="${f.optional ? 'facultatif' : ''}"><i>${f.unit}</i></span></label>`)
        .join('');
    };
    modeSel.addEventListener('change', () => {
      renderFields();
      run();
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      run();
    });
    renderFields();
    if (prefill) {
      const p = prefill;
      prefill = null;
      modeSel.value = p.mode;
      renderFields();
      for (const [id, value] of Object.entries(p.fields)) {
        const input = root.querySelector<HTMLInputElement>(`#f-${id}`);
        if (input) input.value = value;
      }
      form.insertAdjacentHTML('afterbegin', `<p class="muted from">Depuis le module ${p.source.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`)}</p>`);
    }
    run();

    function run() {
      out.innerHTML = '<p class="muted">Recherche…</p>';
      setTimeout(() => {
        try {
          compute();
        } catch (err) {
          out.innerHTML = '';
          out.append(status(`Erreur inattendue : ${(err as Error).message}`, 'err'));
        }
      });
    }

    function compute() {
      const errors: string[] = [];
      root.querySelectorAll('input[aria-invalid]').forEach((i) => i.removeAttribute('aria-invalid'));
      // Read one input as an exact value; empty optional fields give undefined.
      const read = (id: string, label: string, optional = false): Rational | undefined => {
        const input = $<HTMLInputElement>(id);
        if (optional && input.value.trim() === '') return undefined;
        const p = parseSI(input.value);
        if ('error' in p) {
          input.setAttribute('aria-invalid', 'true');
          errors.push(`${label}: ${p.error}`);
          return undefined;
        }
        return p.value;
      };

      const modeId = modeSel.value as ModeId;
      const mode = MODES[modeId];
      const v: Record<string, Rational | undefined> = {};
      for (const f of mode.fields) v[f.id] = read(`f-${f.id}`, f.label, f.optional);
      const precision = read('precision', 'Précision');
      const minR = read('minR', 'R min');
      const maxR = read('maxR', 'R max');
      const maxCurrent = read('maxI', 'Courant max', true);
      const maxPower = read('maxP', 'Puissance max', true);

      // Map the problem to the solver target and the voltage across the network.
      let target: Rational | undefined;
      let voltage: Rational | undefined;
      let scale: Rational | undefined; // result shown as scale × nominal
      let resultUnit = '';
      if (!errors.length) {
        try {
          if (modeId === 'divider') {
            target = v.vout!.div(v.vin!);
            voltage = v.vin;
            scale = v.vin;
            resultUnit = 'V';
          } else if (modeId === 'feedback') {
            target = v.vout!.div(v.vref!);
            voltage = v.vout;
            scale = v.vref;
            resultUnit = 'V';
          } else if (modeId === 'ratio') {
            target = v.ratio;
            voltage = v.vnet;
          } else {
            target = v.rt;
            voltage = v.vnet;
            resultUnit = 'Ω';
          }
        } catch {
          errors.push('Division par zéro : Vin et Vref ne doivent pas valoir 0.');
        }
      }

      out.innerHTML = '';
      if (errors.length || !target) {
        errors.forEach((e) => out.append(status(e, 'err')));
        return;
      }

      const res = solve({
        kind: mode.kind,
        target,
        series: $<HTMLSelectElement>('series').value as SeriesName,
        tolerance: pct(Rational.parseDecimal($<HTMLSelectElement>('tolerance').value)!),
        precision: pct(precision!),
        check: $<HTMLSelectElement>('check').value as 'worst' | 'nominal',
        minR: minR!,
        maxR: maxR!,
        combos: $<HTMLInputElement>('combos').checked,
        voltage,
        maxCurrent,
        maxPower,
      });
      if (!res.ok) {
        out.append(status(res.error, 'err'));
        return;
      }

      const passed = res.solutions[0]?.pass ?? false;
      out.append(status(res.message, passed ? 'ok' : 'err'));
      if (res.suggestions.length) {
        const ul = document.createElement('ul');
        ul.className = 'suggestions';
        res.suggestions.forEach((s) => ul.append(Object.assign(document.createElement('li'), { textContent: s })));
        out.append(ul);
      }
      if (!res.solutions.length) return;

      const result = (s: Solution) => (scale ? scale.mul(s.nominal).toNumber() : s.nominal.toNumber());
      const resultText = (s: Solution) => (resultUnit ? formatSI(result(s), resultUnit, 5) : String(Number(result(s).toPrecision(6))));
      const names = mode.kind === 'single' ? ['R'] : ['R1', 'R2'];
      const describe = (s: Solution) =>
        `${s.positions.map((p, i) => `${names[i]} = ${posText(p)}`).join(', ')}; ${resultLabel(modeId)} = ${resultText(s)} ` +
        `(${formatPercent(s.nominalErr)}, pire cas ±${formatPercent(s.worstErr, false)})`;

      const table = document.createElement('table');
      table.className = 'results-table';
      table.innerHTML = `<thead><tr><th>#</th>${names.map((n) => `<th>${n}</th>`).join('')}<th>${resultLabel(modeId)}</th>
        <th class="num">Erreur</th><th class="num">Pire cas</th><th class="num">I</th><th class="num">P max/comp.</th><th></th><th></th></tr></thead>`;
      const tbody = document.createElement('tbody');
      res.solutions.forEach((s, i) => {
        const tr = document.createElement('tr');
        if (s === res.best && !s.pass) tr.className = 'closest';
        tr.innerHTML = `<td class="muted">${i + 1}</td>
          ${s.positions.map((p) => `<td class="mono">${posText(p)}${p === s.positions[s.positions.length - 1] && s.variants ? ` <span class="muted" title="Même résultat avec toutes les valeurs multipliées par une puissance de 10">+${s.variants} décades</span>` : ''}</td>`).join('')}
          <td class="mono">${resultText(s)}</td>
          <td class="mono num">${formatPercent(s.nominalErr)}</td>
          <td class="mono num">±${formatPercent(s.worstErr, false, 4)}</td>
          <td class="mono num">${s.current === undefined ? '—' : formatSI(s.current, 'A', 3)}</td>
          <td class="mono num">${s.maxPartPower === undefined ? '—' : formatSI(s.maxPartPower, 'W', 3)}</td>
          <td class="${s.pass ? 'pass' : 'fail'}" title="${s.pass ? 'Précision respectée' : 'Hors précision'}">${s.pass ? '✓' : '✗'}</td>
          <td></td>`;
        tr.lastElementChild!.append(copyButton(() => describe(s)));
        tbody.append(tr);
      });
      table.append(tbody);
      out.append(table);
    }
  },
};

function resultLabel(mode: ModeId): string {
  return mode === 'divider' || mode === 'feedback' ? 'Vout' : mode === 'ratio' ? 'R1/R2' : 'Résultat';
}

function posText(p: Position): string {
  const vals = p.parts.map((x) => formatSI(x.num, 'Ω'));
  return p.topology === 'single' ? vals[0] : vals.join(p.topology === 'series' ? ' + ' : ' || ');
}

function status(text: string, kind: 'ok' | 'err'): HTMLElement {
  const p = document.createElement('p');
  p.className = `status ${kind}`;
  p.textContent = text;
  return p;
}
