# Circuit Lab

Outil personnel de conception électronique, entièrement dans le navigateur (aucun compte, aucun serveur) :

- **Équations** : formules chaînées, unités et préfixes SI, résolution pour n'importe quelle variable, modules réutilisables (export/import JSON).
- **Résistances** : solveur exact en séries E6–E192 (simple, diviseur, contre-réaction, rapport, paires série/parallèle, erreur pire cas).
- **Boîtiers** : à venir.

Les données (modules, thème) restent dans le navigateur (`localStorage`).

## Lancer en local

```bash
npm install
npm run dev
```

Tests : `npm test`. Build : `npm run build` (sortie dans `dist/`). Captures d'écran : `npm run shots`.

## Publication

Chaque push sur `main` lance `.github/workflows/deploy.yml` : tests, build, puis publication sur GitHub Pages.
