# Circuit Lab

Outil personnel de conception électronique qui tourne entièrement dans le navigateur : aucun compte, aucun serveur, aucune donnée envoyée.

En ligne : https://glorpgleeb.github.io/circuit-lab/

## Fonctions

**Équations**
- Une équation par ligne (`nom = expression`), dans n'importe quel ordre. Les dépendances sont résolues automatiquement et les boucles sont signalées.
- Le formulaire des variables se construit tout seul, avec un champ unité par variable.
- Valeurs avec préfixes SI ou notation résistance : `4.7k`, `100n`, `2.2u`, `1M`, `4k7`, `2R2`, `100mA`.
- Résultats avec le meilleur préfixe (`7.975 µH`, `398.7 kHz`). L'unité du résultat est déduite de la formule, et un mélange d'unités incompatibles est signalé.
- Formules affichées avec KaTeX, valeurs intermédiaires affichées.
- **Résoudre pour** n'importe quelle entrée :
  - symboliquement si la variable n'apparaît qu'une fois ;
  - numériquement sinon, avec recherche de toutes les racines réelles dans ±[1e-15, 1e15].
  - Le nombre de solutions est toujours indiqué (aucune, une, plusieurs).
- Messages clairs pour division par zéro, racine d'un négatif, champ vide, dépendance circulaire. Jamais de `NaN` à l'écran.
- Boutons de copie sur chaque résultat : valeur avec unité, formule, LaTeX.

**Modules**
- Un module est un jeu d'équations nommé, avec description, tags, valeurs et unités par défaut.
- Les modules sont enregistrés dans le navigateur (`localStorage`), et s'exportent ou s'importent en JSON.
- Modules intégrés (testés contre des valeurs connues) :
  - inductance de buck ;
  - diviseur de tension ;
  - pont de contre-réaction de régulateur ;
  - loi d'Ohm et puissance ;
  - résistance de LED ;
  - coupure RC et RL ;
  - résistances en série/parallèle ;
  - condensateurs en série/parallèle.

**Résistances (solveur exact)**
- Séries E6, E12, E24, E48, E96, E192 (tables officielles IEC 60063).
- Problèmes : résistance seule, diviseur, contre-réaction `Vout = Vref·(1 + R1/R2)`, rapport R1/R2. Paires série/parallèle en option.
- Paramètres : précision, tolérance des composants, limites R min/max, courant max, puissance max par composant.
- Résultats classés avec la valeur nominale, l'erreur nominale et l'erreur dans le pire cas (tolérances).
- Arithmétique rationnelle exacte pour décider si la précision est respectée. Sans solution, l'app l'indique (« Aucune solution en E24 à ±0.5 % »), montre la plus proche et propose ce qui marcherait.
- Le bouton « Meilleures R » d'un module envoie ses valeurs au solveur.

**Interface** : 4 thèmes (Clair, Sombre, Noir, Violet sombre), chiffres en police monospace, clavier (Tab entre les champs, Entrée pour calculer, Ctrl/Cmd+Entrée dans la zone d'équations).

## Lancer en local

```bash
npm install
npm run dev
```

| Commande | Rôle |
| --- | --- |
| `npm test` | tests unitaires (Vitest) |
| `npm run build` | vérification TypeScript + build dans `dist/` |
| `npm run shots` | captures d'écran de chaque page dans les 4 thèmes (Playwright, dans `screenshots/`) |

Première utilisation de `npm run shots` : `npx playwright install chromium`.

## Organisation du code

| Dossier | Contenu |
| --- | --- |
| `src/units/` | nombres rationnels exacts, préfixes SI, dimensions physiques et unités |
| `src/equations/` | analyse sûre des formules, système d'équations, résolution, modules |
| `src/solver/` | tables E-series et solveur de résistances |
| `src/ui/` | pages, thème, boutons de copie |
| `tests/` | tests du solveur, des équations, de la résolution et des modules |

Sécurité : les formules ne passent jamais par `eval()`. mathjs sert seulement à analyser le texte. L'arbre obtenu est converti en un format restreint (nombres, variables, `+ - * / ^`, parenthèses, fonctions autorisées), puis évalué par notre propre code.

Fonctions autorisées : `sqrt cbrt abs exp ln log log10 log2 sin cos tan asin acos atan atan2 sinh cosh tanh hypot min max floor ceil round`. Constantes : `pi`, `e`.

Unités reconnues : `V A Ω F H Hz s W J C S Wb T m K`, avec préfixes (`mA`, `kHz`, `µF`…) et combinaisons (`V/us`, `A^2*Ω`).

## Ajouter un module

### Depuis l'application (le plus simple)

1. Onglet **Équations** : cliquez sur **Nouveau**, puis saisissez les équations, par exemple :
   ```
   Vripple = Iout / (fsw * C)
   ```
2. Renseignez les valeurs et les unités dans le tableau des variables.
3. Donnez un nom, des tags et une description, puis cliquez sur **Enregistrer**. Le module apparaît dans « Mes modules ».
4. **Exporter** télécharge le module en JSON, pour le sauvegarder ou le passer sur un autre appareil (**Importer…**).

### Format JSON

```json
{
  "format": "circuit-lab-modules",
  "version": 1,
  "modules": [
    {
      "name": "Ondulation de sortie",
      "description": "Ondulation de tension due au condensateur de sortie.",
      "tags": ["alimentation"],
      "formulas": "Vripple = Iout / (fsw * C)",
      "variables": {
        "Iout": { "value": "1", "unit": "A" },
        "fsw": { "value": "500k", "unit": "Hz" },
        "C": { "value": "22u", "unit": "F" },
        "Vripple": { "value": "", "unit": "V" }
      }
    }
  ]
}
```

- Un objet module seul (sans l'enveloppe `format`/`modules`) est aussi accepté à l'import.
- L'ordre des clés de `variables` donne l'ordre des champs du formulaire.
- Champ facultatif `resistorLinks` : il indique au bouton « Meilleures R » qu'une paire de résistances forme un diviseur. Exemple :
  ```json
  "resistorLinks": [{ "mode": "divider", "resistors": ["R1", "R2"], "fields": { "vin": "Vin", "vout": "Vout" } }]
  ```
  Modes possibles : `divider` (`vin`, `vout`), `feedback` (`vref`, `vout`), `ratio` (`ratio`), `single` (`rt`). Sans lien, chaque variable en Ω est envoyée comme résistance seule.
- Tout fichier importé est validé : formules analysées, longueurs et nombres limités, fichier de 2 Mo maximum. Les modules invalides sont listés avec la raison, les autres sont importés.

### Comme module intégré (dans le code)

1. Ajoutez une entrée à `BUILTIN_MODULES` dans `src/equations/modules.ts`, sur le modèle des autres. L'`id` doit être unique et commencer par `builtin-`.
2. Ajoutez une ligne au test `built-in modules give known values` dans `tests/modules.test.ts`, avec les valeurs attendues et l'unité de chaque résultat.
3. Lancez `npm test`, puis poussez sur `main` : le site se met à jour.

## Publication

Chaque push sur `main` lance `.github/workflows/deploy.yml` : `npm ci`, tests, build, puis publication sur GitHub Pages. `vite.config.ts` utilise des chemins relatifs (`base: './'`), ce qui fait fonctionner le même build sous `/circuit-lab/` et en local.

## Données et confidentialité

- Rien ne quitte le navigateur : pas d'analytics, pas de compte, aucune requête réseau après le chargement de la page.
- Les modules et le thème sont stockés dans le `localStorage` du navigateur utilisé. Ils ne se synchronisent pas entre appareils : utilisez Exporter / Importer.
