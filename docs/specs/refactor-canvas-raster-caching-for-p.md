# Spécification Technique & Fonctionnelle : Raster Caching for Manual Fog of War

**Issue source** : #159  
**Branche de planification** : `plan/159-refactor-canvas-raster-caching-for-p`  
**Statut** : Validé / Prêt pour décomposition en tickets  

---

## 1. Contexte et Problématique

Dans la vue carte (`frontend/src/components/campaign/MapCanvas.tsx`), la couche de **Fog manuel** (`frontend/src/components/campaign/map/layers/drawFog.ts`) dessine le brouillard masquant la carte :
- **Vue Joueur** : brouillard opaque violet très sombre (`rgba(15, 12, 25, 1)`) recouvrant toutes les cellules non révélées de la grille, à l'exception des cellules occupées par les pions du joueur (`exemptCells`).
- **Vue DM** : brouillard semi-transparent violet foncé (`rgba(15, 12, 25, 0.55)`) permettant au MJ de voir l'ensemble du terrain et des tokens tout en visualisant les zones dissimulées aux joueurs.

### Le goulot d'étranglement
Actuellement, `drawFog` parcourt l'intégralité de la grille à l'aide d'une double boucle `for (let row = 0; row < fogRows; row++)` et `for (let col = 0; col < fogCols; col++)`. Sur une carte standard de 100×100 cellules (10 000 cases), chaque trame de rendu déclenche jusqu'à 10 000 appels `ctx.fillRect()`. Dès qu'un utilisateur déplace le curseur, utilise l'outil règle de mesure, crée un gabarit de zone ou survole la carte, la couche `overlay` est redessinée à 60 fps, provoquant des saccades notables et une surconsommation CPU/GPU.

Contrairement à la mémoire d'exploration de l'éclairage dynamique (`drawDynamicLighting.ts`) qui dispose déjà d'un raster optimisé (`exploredRaster`), le brouillard manuel est rendu par force brute.

---

## 2. Alignement Terminologique et Frontières Métier

Conformément au `GLOSSARY.md` et aux décisions validées lors du cadrage `/grill-with-docs` :
- **Fog (Brouillard manuel)** : Grille de révélation contrôlée par le DM (`drawFog.ts`). Le refactoring s'applique **exclusivement** à ce sous-système.
- **Explored memory (Mémoire d'exploration)** : Surcouche grise propre à chaque membre pour la vision de l'éclairage dynamique (`drawDynamicLighting.ts`, `useExploredMemory.ts`). Elle reste totalement indépendante et inchangée.
- **Fog raster cache** : Tampon canvas hors-écran dimensionné à 1 pixel par cellule (`fogCols × fogRows`) représentant l'état statique du brouillard manuel, projeté sur le canvas principal via un unique appel `drawImage`.

---

## 3. Architecture Technique et Flux de Données

```
+-------------------------------------------------------------+
| MapCanvas (React Lifecycle)                                 |
|                                                             |
|  effectiveFogState (DM) / viewerRevealed (Player)           |
|                         │                                   |
|                         ▼ (Recalculé uniquement si mutation)|
|              +──────────────────────+                       |
|              |  Fog Raster Cache    |                       |
|              |  (1px / cell canvas) |                       |
|              +──────────────────────+                       |
|                         │                                   |
|                         ▼ (Passé à chaque trame)            |
|  +───────────────────────────────────────────────────────+  |
|  | drawFog Layer (drawFog.ts)                            |  |
|  |                                                       |  |
|  |  1. Composition dynamique (scratch canvas) :          |  |
|  |     - Copie du raster statique (1 blit 100x100)       |  |
|  |     - clearRect sur exemptCells (tokens du joueur)    |  |
|  |     - Application locale de revealOpacity (animations)|  |
|  |                                                       |  |
|  |  2. Rendu final sur le canvas principal :             |  |
|  |     - ctx.imageSmoothingEnabled = false               |  |
|  |     - ctx.drawImage(compositeRaster, 0, 0, W, H)      |  |
|  +───────────────────────────────────────────────────────+  |
+-------------------------------------------------------------+
```

### Caractéristiques clés de la conception :
1. **Dimensionnement 1px par cellule** : Pour une carte de 100×100, le raster mesure 100×100 pixels. Mémoire tampon requise : `100 * 100 * 4 octets = 40 Ko`.
2. **Rendu Pixel-Perfect** : En désactivant le lissage (`imageSmoothingEnabled = false`), le GPU effectue un filtrage plus proche voisin (nearest-neighbor), garantissant des bordures de cellules parfaitement nettes quel que soit le niveau de zoom.
3. **Séparation Statique / Dynamique** :
   - L'état de révélation brut (`revealedCells` ou `fogState.revealed`) est mis en cache dans le raster statique.
   - Les cellules exemptées (`exemptCells`) et les cellules en transition d'opacité (`revealOpacity`) sont appliquées sur un canvas de travail éphémère réutilisé (scratch canvas 100×100) en quelques microsecondes sans recréer le buffer principal.

---

## 4. Spécification Détaillée des Modules

### 4.1 Nouveau module : `frontend/src/components/campaign/map/fogRaster.ts`

Ce module pur (aucun hook React, aucune dépendance externe hors Canvas API) isole toute la logique de manipulation binaire des pixels du brouillard.

#### Types et Constantes :
```typescript
export const FOG_COLOR_PLAYER = { r: 15, g: 12, b: 25, a: 255 } as const;
export const FOG_COLOR_DM = { r: 15, g: 12, b: 25, a: 140 } as const; // 0.55 * 255 ≈ 140

export interface FogRasterOptions {
  cols: number;
  rows: number;
  isDM: boolean;
}
```

#### Fonctions Exportées :

1. `createFogRasterCanvas(cols: number, rows: number): HTMLCanvasElement`
   - Instancie un `HTMLCanvasElement` avec `width = cols` et `height = rows`.
   - Retourne l'élément canvas hors-écran.

2. `buildFogRaster(cols: number, rows: number, isDM: boolean, revealed: ReadonlySet<number> | readonly boolean[]): HTMLCanvasElement`
   - Alloue un canvas hors-écran de taille `cols × rows`.
   - Remplit un `ImageData` RGBA :
     - Si cellule non révélée : pixel violet (`15, 12, 25, 255` pour joueur, `15, 12, 25, 140` pour DM).
     - Si cellule révélée : pixel transparent (`0, 0, 0, 0`).
   - Écrit l'image avec `ctx.putImageData(img, 0, 0)`.
   - Retourne le raster prêt pour composition.

3. `compositeFogRaster(staticRaster: HTMLCanvasElement, cols: number, rows: number, isDM: boolean, exemptCells?: ReadonlySet<number>, revealOpacity?: ReadonlyMap<number, number>, scratchCanvas?: HTMLCanvasElement | null): HTMLCanvasElement`
   - Si aucune cellule exemptée et aucune cellule en fondu d'animation (`revealOpacity`), retourne directement `staticRaster` (zéro overhead, O(1)).
   - Sinon, initialise ou redimensionne `scratchCanvas` à `cols × rows`.
   - Blitte `staticRaster` sur `scratchCanvas` via `drawImage`.
   - Pour chaque index dans `exemptCells` : efface le pixel correspondant avec `scratchCtx.clearRect(col, row, 1, 1)`.
   - Pour chaque `[idx, opacity]` dans `revealOpacity` :
     - Efface le pixel : `scratchCtx.clearRect(col, row, 1, 1)`.
     - Calcule l'opacité alpha : `isDM ? 140 * opacity : 255 * opacity`.
     - Dessine le pixel avec la nouvelle valeur alpha.
   - Retourne le `scratchCanvas` prêt à être blitté.

---

### 4.2 Évolution du module de rendu : `frontend/src/components/campaign/map/layers/drawFog.ts`

#### Évolution de l'interface `FogDrawState` :
```typescript
export interface FogDrawState {
  isDM: boolean;
  /** Full fog grid — DM only. */
  fogState: FogState | null;
  /** Revealed cell indices — players only; null = no fog to draw. */
  revealedCells: Set<number> | null;
  /** Cells left clear for player's own tokens. */
  exemptCells?: ReadonlySet<number>;
  /** Per-cell reveal-fade opacity (1 = just revealed → 0 = faded in). */
  revealOpacity: ReadonlyMap<number, number>;
  /** Pre-rendered offscreen raster canvas (1px per cell). */
  raster?: HTMLCanvasElement | null;
  /** Optional reusable scratch canvas for dynamic compositing. */
  scratchCanvas?: HTMLCanvasElement | null;
}
```

#### Implémentation de `drawFog` :
```typescript
export function drawFog(
  ctx: CanvasRenderingContext2D,
  state: FogDrawState,
  viewport: Viewport
): void {
  // DM View
  if (state.isDM && state.fogState) {
    const { fogCols, fogRows, cellPx, revealed } = state.fogState;
    const mapWidthPx = fogCols * cellPx;
    const mapHeightPx = fogRows * cellPx;

    const baseRaster = state.raster ?? buildFogRaster(fogCols, fogRows, true, revealed);
    const finalRaster = compositeFogRaster(
      baseRaster,
      fogCols,
      fogRows,
      true,
      undefined,
      state.revealOpacity,
      state.scratchCanvas
    );

    ctx.save();
    const prevSmoothing = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(finalRaster, 0, 0, mapWidthPx, mapHeightPx);
    ctx.imageSmoothingEnabled = prevSmoothing;
    ctx.restore();
    return;
  }

  // Player View
  if (!state.isDM && state.revealedCells) {
    const cellPx = viewport.gridSize;
    const fogCols = viewport.mapWidth;
    const fogRows = viewport.mapHeight;
    const mapWidthPx = fogCols * cellPx;
    const mapHeightPx = fogRows * cellPx;

    const baseRaster = state.raster ?? buildFogRaster(fogCols, fogRows, false, state.revealedCells);
    const finalRaster = compositeFogRaster(
      baseRaster,
      fogCols,
      fogRows,
      false,
      state.exemptCells,
      state.revealOpacity,
      state.scratchCanvas
    );

    ctx.save();
    const prevSmoothing = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(finalRaster, 0, 0, mapWidthPx, mapHeightPx);
    ctx.imageSmoothingEnabled = prevSmoothing;
    ctx.restore();
  }
}
```

---

### 4.3 Intégration dans `frontend/src/components/campaign/MapCanvas.tsx`

Dans `MapCanvas.tsx`, deux canvas raster mémoïsés ou gérés par refs sont introduits :

1. **`playerFogRaster`** :
   ```typescript
   const playerFogRaster = useMemo<HTMLCanvasElement | null>(() => {
     if (!viewerRevealed || !currentMap) return null;
     return buildFogRaster(currentMap.width, currentMap.height, false, viewerRevealed);
   }, [viewerRevealed, currentMap?.width, currentMap?.height]);
   ```

2. **`dmFogRaster`** :
   ```typescript
   const dmFogRaster = useMemo<HTMLCanvasElement | null>(() => {
     if (!effectiveFogState) return null;
     return buildFogRaster(
       effectiveFogState.fogCols,
       effectiveFogState.fogRows,
       true,
       effectiveFogState.revealed
     );
   }, [effectiveFogState?.revealed, effectiveFogState?.fogCols, effectiveFogState?.fogRows]);
   ```

3. **Passage aux appels `drawFog`** :
   - Dans le rendu DM (bloc 3 de `drawTerrain` / `drawOverlay`) : passage de `dmFogRaster` dans `state.raster`.
   - Dans le rendu Joueur (bloc 12 de `drawOverlay`) : passage de `playerFogRaster` dans `state.raster`.
   - Utilisation d'une référence stable `fogScratchRef` pour éviter toute allocation mémoire superflue lors des animations ou exemptions.

4. **Politique d'invalidation** :
   - Le cache raster n'est invalidé **que** si la grille de révélation ou les dimensions changent.
   - Aucun recalcul de `playerFogRaster` ou `dmFogRaster` lors des mouvements de souris (`hoverCoords`), déplacements de pions (`draggedToken`), ou outils de tracé (`ruler`, `aoe`).

---

## 5. Analyse de Performance et de Complexité

| Métrique | Avant Optimisation | Après Optimisation | Gain |
| :--- | :--- | :--- | :--- |
| **Appels Canvas API par trame** | `10 000` appels `fillRect` (pour 100×100) | `1` appel `drawImage` | **-99.99%** d'appels API |
| **Complexité temporelle par trame** | $O(\text{cols} \times \text{rows})$ | $O(1)$ à l'affichage ($O(k)$ pour $k$ exemptions) | Passage à temps constant |
| **Empreinte mémoire tampon** | 0 Ko | ~40 Ko par carte (100×100 RGBA) | Négligeable (< 0.05 Mo) |
| **Fluidité lors du survol / drag** | Chutes à 20-30 fps sur grand plateau | 60 fps stable | Aucune baisse de framerate |
| **Netteté aux zooms extrêmes** | Rectangles natifs vectoriels | Nearest-neighbor pixel-perfect | Rendu strictement identique |

---

## 6. Stratégie de Test et Validation TDD

### 6.1 Tests Unitaires du Raster (`fogRaster.test.ts`)
Fichier : `frontend/src/components/campaign/map/__tests__/fogRaster.test.ts` sous Vitest / JSDOM.
1. **`buildFogRaster` joueur** :
   - Construit un raster 4×4 avec les cellules `{0, 1, 4}` révélées.
   - Vérifie via `getImageData` que les pixels 0, 1 et 4 ont un canal alpha égal à 0.
   - Vérifie que les autres pixels ont RGBA = `[15, 12, 25, 255]`.
2. **`buildFogRaster` MJ** :
   - Construit un raster 4×4 avec tableau booléen de révélation.
   - Vérifie que les cellules non révélées ont un canal alpha égal à 140 (semi-transparent).
3. **`compositeFogRaster`** :
   - Vérifie qu'en l'absence d'exemptCells et de revealOpacity, le staticRaster initial est renvoyé par référence directe.
   - Vérifie qu'avec `exemptCells = new Set([5])`, le pixel 5 est rendu transparent sur le canvas de sortie sans altérer le staticRaster source.
   - Vérifie que les opacités intermédiaires de `revealOpacity` sont correctement appliquées.

### 6.2 Tests du Moteur de Rendu (`drawFog.test.ts`)
Fichier : `frontend/src/components/campaign/map/layers/__tests__/drawFog.test.ts`.
1. **Vérification d'appel unique `drawImage`** :
   - Mocker `CanvasRenderingContext2D` (`drawImage`, `fillRect`, `save`, `restore`).
   - Exécuter `drawFog` sur une grille 50×50.
   - Assertions :
     - `ctx.drawImage` est appelé exactement 1 fois.
     - `ctx.fillRect` n'est **jamais** appelé pour la grille de base.
     - `ctx.imageSmoothingEnabled` est positionné à `false` pendant l'appel puis restauré.
2. **Rétrocompatibilité / Fallback sans cache pré-généré** :
   - Appeler `drawFog` avec `raster: null`.
   - Vérifier que la fonction instancie le raster à la volée et effectue le `drawImage` sans planter.
3. **Gestion des pions possédés (`exemptCells`)** :
   - Vérifier que les cellules de pions joueurs ne masquent pas leurs positions.

---

## 7. Critères d'Acceptation & Checklist de Recette

- [ ] Un module pur `frontend/src/components/campaign/map/fogRaster.ts` gère la création, la manipulation de buffer `ImageData` et la composition dynamique du brouillard.
- [ ] `drawFog.ts` effectue le rendu via un appel unique `ctx.drawImage` avec `imageSmoothingEnabled = false`.
- [ ] `MapCanvas.tsx` mémoïse les rasters statiques joueur et DM, sans réallocation lors des déplacements de curseur ou des sélections.
- [ ] Les pions du joueur (`exemptCells`) restent parfaitement visibles dans le brouillard sans obliger à recalculer le raster statique complet.
- [ ] Les transitions de fondu (`revealOpacity`) s'affichent fluidement à 60 fps sans saccade.
- [ ] L'ensemble des tests unitaires (`fogRaster.test.ts` et `drawFog.test.ts`) passe au vert sous Vitest sans warning.
- [ ] Aucune régression sur le pipeline d'explored memory de l'éclairage dynamique (`drawDynamicLighting.ts`).
