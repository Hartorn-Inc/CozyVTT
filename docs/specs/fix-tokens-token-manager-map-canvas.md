# Spécification Technique & Fonctionnelle : Correction Token Manager, Map Canvas & Token REST/Search

## 1. Contexte & Problématique

Dans CozyVTT, la gestion des jetons (**Tokens**) s'effectue à la fois via des interactions temps réel (WebSocket Canvas), des listes d'administration (**Token Manager**, **Token Template Library**, **NPC Quick Editor**) et des routes REST sur le backend (`backend/src/routes/maps.ts` et `backend/src/routes/tokenTemplates.ts`).

Neuf anomalies actives et dettes techniques référencées par des commentaires `TODO(#153)` ont été identifiées dans le cycle de vie des jetons :
1. **Absence de diffusion WebSocket en temps réel sur les routes REST de manipulation de jetons** : `POST /:id/tokens`, `PUT /:id/tokens/:tokenId` et `DELETE /:id/tokens/:tokenId` réémettent l'ordre d'initiative (`resendInitiative`), mais n'appellent pas `resendIfCurrent(campaignId, updatedMap)`. Les autres clients connectés sur la carte active ne voient donc pas apparaître, changer ou disparaître le jeton en direct.
2. **Échappement absent sur la recherche de modèles de jetons** : Dans `GET /api/campaigns/:campaignId/token-templates`, le paramètre `search` est injecté directement dans Prisma sans échappement des caractères réservés SQL `LIKE` (`%`, `_`, `\`).
3. **Texte d'infobulle inversé sur le bouton Spirit Layer du Canvas** : Lorsque `dmShowSpiritTokens` vaut `true`, l'infobulle affiche incorrectement `"Hiding spirit tokens (click to show)"` au lieu d'indiquer que les jetons du plan spirituel sont affichés et qu'un clic les masquera.
4. **Absence de toast d'erreur lors des actions de clic droit sur le Canvas** : Le basculement des statuts Masqué (*Hide*), Obscurci (*Obscure*) ou Plan Spirituel (*Spirit realm*) n'émet aucun toast d'erreur en cas d'échec réseau, consignant l'erreur uniquement dans la console.
5. **Sélectionneur de contrôleur désynchronisé dans `NpcQuickEditor`** : Si `controlledBy` pointe vers un ancien membre ou un membre rétrogradé au rôle spectateur, le menu `<select>` retombe silencieusement sur le premier joueur actif de la liste, créant une fausse attribution visuelle.
6. **Message d'erreur d'ajout de jeton statique dans `TokenManager`** : Lors de l'échec de placement d'un jeton sur une carte, une chaîne en dur est affichée au lieu d'extraire l'erreur de l'API via `apiErrorMessage(err)`.
7. **Badge "Player" générique dans `TokenManager` pour les contrôleurs inactifs** : Lorsque `controlledBy` ne correspond à aucun joueur actif, un badge affichant simplement `"Player"` sans nom apparaît dans le tableau.
8. **Bouton Spirit Realm proposé aux objets dans `TokenManager`** : `TokenManager` permet de basculer un objet (`TokenType.OBJECT`) vers le plan spirituel, en contradiction avec la règle métier `dmTokenControls(token.type).crossPlanes` appliquée sur le canvas.
9. **Retour utilisateur absent lors de la copie inter-campagnes de modèles** : `TokenTemplateLibrary` ferme le menu silencieusement sans toast de confirmation en cas de succès, et affiche une phrase générique sans `apiErrorMessage(err)` en cas d'erreur.

---

## 2. Objectifs & Exigences Métier

- **Cohérence Temps Réel (ADR 0022)** : Toute modification de jeton via l'API REST sur la carte active doit être immédiatement visible par tous les joueurs connectés selon leurs droits de vision et leur plan.
- **Isolation des Cartes Préparées** : Les modifications de jetons sur une carte préparée (non active) ne doivent jamais être diffusées aux joueurs.
- **Sécurité et Exactitude des Requêtes SQL** : La recherche de modèles de jetons doit interpréter littéralement les métacaractères `LIKE`.
- **Feedback Utilisateur Transparent** : Toute opération échouée doit afficher un toast d'erreur explicite contenant le message de l'API. Les opérations asynchrones de copie doivent confirmer la destination avec précision.
- **Cohérence des Entités Métier** : Les objets ne peuvent pas changer de plan, et les contrôleurs inactifs/spectateurs doivent être présentés de manière explicite sans ambiguïté.
- **Suppression Intégrale de la Dette** : Les 9 commentaires `TODO(#153)` doivent être supprimés des 6 fichiers concernés.

---

## 3. Spécification Technique Détaillée

### 3.1 Backend : Diffusion WebSocket REST des Jetons (`backend/src/routes/maps.ts`)

#### Endpoints concernés :
1. `POST /api/campaigns/:campaignId/maps/:id/tokens` (Création de jeton)
2. `PUT /api/campaigns/:campaignId/maps/:id/tokens/:tokenId` (Mise à jour de jeton)
3. `DELETE /api/campaigns/:campaignId/maps/:id/tokens/:tokenId` (Suppression de jeton)

#### Implémentation :
- Dans `POST /:id/tokens` :
  Après `await resendInitiative(campaignId);`, insérer l'appel :
  ```typescript
  await resendIfCurrent(campaignId, updatedMap);
  ```
- Dans `PUT /:id/tokens/:tokenId` :
  Après les blocs `resendInitiative(campaignId)` / `resendInitiativeFor(campaignId, tokenId)`, insérer l'appel :
  ```typescript
  await resendIfCurrent(campaignId, updatedMap);
  ```
- Dans `DELETE /:id/tokens/:tokenId` :
  Capturer la carte retournée par la transaction de verrouillage :
  ```typescript
  const updatedMap = await withMapsLocked([mapId], async (tx) => {
    const fresh = await tx.map.findUniqueOrThrow({ where: { id: mapId }, select: { tokens: true } });
    return await tx.map.update({
      where: { id: mapId },
      data: { tokens: toJson(readTokens(fresh.tokens).filter((t) => t.id !== tokenId)) },
    });
  });
  ```
  Puis, après les blocs `resendInitiative...`, insérer l'appel :
  ```typescript
  await resendIfCurrent(campaignId, updatedMap);
  ```
- Supprimer le commentaire `// TODO(#153): broadcast live WebSocket map changes for token create, update, and delete REST routes` situé avant la section des routes de manipulation de jetons.

### 3.2 Backend : Échappement LIKE dans la Recherche de Modèles (`backend/src/routes/tokenTemplates.ts`)

#### Endpoint concerné :
`GET /api/campaigns/:campaignId/token-templates`

#### Implémentation :
- Importer `escapeLikePattern` depuis `../utils/likePattern`.
- Mettre à jour la clause de recherche `where.name` :
  ```typescript
  if (search && typeof search === 'string') {
    where.name = { contains: escapeLikePattern(search), mode: 'insensitive' };
  }
  ```
- Supprimer le commentaire `// TODO(#153): `search` reaches PostgreSQL as an unescaped LIKE pattern...`.

### 3.3 Frontend : Infobulle Spirit Layer Toolbar (`frontend/src/components/campaign/MapCanvas.tsx`)

#### Composant concerné :
`MapCanvas.tsx` (barre d'outils DM pour le basculement d'affichage des jetons spirituels).

#### Implémentation :
- Mettre à jour l'attribut `title` du bouton basculant `dmShowSpiritTokens` :
  ```typescript
  title={dmShowSpiritTokens ? 'Spirit tokens shown, click to hide' : 'Hiding spirit tokens (click to show)'}
  ```
- Supprimer le commentaire `// TODO(#153): `title` says "Hiding..." when dmShowSpiritTokens is true...`.

### 3.4 Frontend : Toasts d'Erreur sur Clic Droit Canvas (`frontend/src/components/campaign/MapCanvas.tsx`)

#### Actions concernées :
- Basculement Hide (`visible`)
- Basculement Obscure (`obscured`)
- Basculement Spirit Realm (`layer`)

#### Implémentation :
- Dans chaque bloc `catch (err)` de ces trois handlers de menu contextuel, ajouter une notification d'erreur utilisateur :
  ```typescript
  showToast(apiErrorMessage(err) || 'Failed to update token', 'error');
  ```
- Supprimer les trois commentaires `// TODO(#153): right-click toggle ... failure only logs to console...`.

### 3.5 Frontend : Contrôleur Absent / Spectateur (`frontend/src/components/campaign/NpcQuickEditor.tsx`)

#### Composant concerné :
`NpcQuickEditor.tsx` (sélecteur `<select>` du champ `controlledBy`).

#### Implémentation :
- Identifier si la valeur actuelle `controlledBy` correspond à un joueur actif présent dans `players` (`players.some((p) => p.userId === controlledBy)`).
- Si `controlledBy` est non vide et n'appartient pas aux joueurs actifs, insérer une option désactivée et sélectionnée dans la liste :
  ```tsx
  {controlledBy && !players.some((p) => p.userId === controlledBy) && (
    <option value={controlledBy} disabled>
      Former member / Spectator
    </option>
  )}
  ```
- Supprimer le commentaire `// TODO(#153): `players` only holds role === 'PLAYER'...`.

### 3.6 Frontend : Gestion des Erreurs et Badges dans `TokenManager.tsx`

#### Composant concerné :
`TokenManager.tsx`

#### Implémentations :
1. **Message d'erreur lors du placement de jeton** :
   Dans la méthode `handleAddTokenToMap`, dans le bloc `catch (err)`, remplacer le message statique par :
   ```typescript
   setError(apiErrorMessage(err) || 'Failed to add token to map');
   ```
   Supprimer le commentaire `// TODO(#153): reads a fixed string instead of apiErrorMessage(err)...`.

2. **Badge de joueur contrôleur** :
   Dans le rendu des lignes de jetons, n'afficher le chip de contrôleur que si le joueur correspondant est trouvé dans la liste `players` :
   ```tsx
   {(() => {
     const controller = players.find((p) => p.userId === token.controlledBy);
     if (!controller) return null;
     return (
       <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
         <User className="w-3 h-3" />
         {controller.user.name}
       </span>
     );
   })()}
   ```
   Supprimer le commentaire `// TODO(#153): `players` holds members whose role is PLAYER...`.

3. **Restriction du basculement Spirit Realm pour les objets** :
   Conditionner l'affichage du bouton de bascule du plan spirituel à l'autorisation de changement de plan :
   ```tsx
   {dmTokenControls(token.type).crossPlanes && (
     <button
       type="button"
       onClick={() => handleToggleSpiritRealm(token)}
       title={token.layer === 'spirit' ? 'Return to material plane' : 'Send to spirit realm'}
       ...
     >
       ...
     </button>
   )}
   ```
   Supprimer le commentaire `// TODO(#153): offers the spirit realm toggle even for TokenType.OBJECT...`.

### 3.7 Frontend : Feedback Utilisateur dans `TokenTemplateLibrary.tsx`

#### Composant concerné :
`TokenTemplateLibrary.tsx` (action de copie d'un modèle vers une autre campagne).

#### Implémentation :
- Lors d'une copie réussie, identifier le nom de la campagne cible (`targetCampaign?.name ?? 'campaign'`) et déclencher un toast de confirmation de succès :
  ```typescript
  showToast(`Token template copied to ${targetCampaign?.name || 'target campaign'}`, 'success');
  ```
- En cas d'échec de la copie dans le bloc `catch`, afficher un toast d'erreur extrayant le message de l'API :
  ```typescript
  showToast(apiErrorMessage(err) || 'Failed to copy template to campaign', 'error');
  ```
- Supprimer le commentaire `// TODO(#153): copy-to-campaign menu item closes silently on success...`.

---

## 4. Stratégie de Test & Critères d'Acceptation

### 4.1 Tests Backend Unitaires & d'Intégration
1. **Broadcast REST Tokens (`backend/src/__tests__/routes/maps.tokens.test.ts`)** :
   - Vérifier que `POST /:id/tokens` déclenche `broadcastMapData` lorsque la carte est la carte active (`currentMapId === mapId`).
   - Vérifier que `PUT /:id/tokens/:tokenId` déclenche `broadcastMapData` sur la carte active.
   - Vérifier que `DELETE /:id/tokens/:tokenId` déclenche `broadcastMapData` sur la carte active avec le jeton retiré.
   - Vérifier qu'aucune diffusion WebSocket aux joueurs n'a lieu lorsque la carte modifiée est une carte préparée (`currentMapId !== mapId`).
2. **Échappement SQL LIKE (`backend/src/__tests__/routes/tokenTemplates.test.ts`)** :
   - Créer deux modèles : `Goblin %1` et `Goblin 2`.
   - Lancer une recherche sur `Goblin %` : vérifier que seul `Goblin %1` est renvoyé et que `Goblin 2` est exclu.
   - Lancer une recherche sur `_` : vérifier qu'elle ne correspond pas à n'importe quel caractère individuel.

### 4.2 Tests Frontend Unitaires & d'Intégration
1. **`MapCanvas.test.tsx`** :
   - Vérifier que le bouton Spirit Layer possède le titre `"Spirit tokens shown, click to hide"` quand `dmShowSpiritTokens=true` et `"Hiding spirit tokens (click to show)"` quand `false`.
   - Simuler le rejet de l'API sur le clic droit Hide, Obscure et Spirit Realm : vérifier l'appel de `showToast` avec le statut `'error'`.
2. **`NpcQuickEditor.test.tsx`** :
   - Rendre le composant avec un `controlledBy` pointant vers un ID inconnu de `players`.
   - Vérifier la présence de l'option désactivée `"Former member / Spectator"` et son état sélectionné.
3. **`TokenManager.test.tsx`** :
   - Vérifier que `setError` reçoit le résultat de `apiErrorMessage(err)` lors d'un échec de placement.
   - Vérifier que le badge contrôleur n'est pas rendu si le contrôleur n'est pas un joueur actif.
   - Vérifier que le bouton de bascule Spirit Realm est absent pour les tokens de type `OBJECT` et présent pour `NPC`/`MONSTER`.
4. **`TokenTemplateLibrary.test.tsx`** :
   - Vérifier l'appel à `showToast` avec le nom de la campagne cible lors d'une copie réussie.
   - Vérifier l'appel à `showToast(..., 'error')` avec `apiErrorMessage(err)` lors d'un échec de copie.

### 4.3 Validation Statique
- `npm run check` (TypeScript, ESLint, Prettier) sans aucune erreur.
- Tous les 9 commentaires `TODO(#153)` ont été supprimés des 6 fichiers sources cibles.