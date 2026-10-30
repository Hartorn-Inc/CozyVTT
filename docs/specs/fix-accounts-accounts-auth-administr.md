# Spécification Technique & Fonctionnelle : Correction des anomalies Comptes, Authentification, Administration et Ergonomie Frontend

- **Issue de référence** : #157
- **Branche de planification** : `plan/157-fix-accounts-accounts-auth-administr`
- **ADR associé** : `docs/adr/0022-account-lifecycle-auth-and-client-resilience.md`
- **Statut** : Validé pour implémentation

---

## 1. Contexte & Problématique

Lors de l'audit de convergence de la dette technique et du backlog de CozyVTT, 9 anomalies actives et 11 commentaires de dette référencée `TODO(#157)` ont été identifiés dans les sous-systèmes de gestion des comptes, d'authentification, de configuration initiale (**Setup**), du panneau d'**Administrator**, des gestionnaires d'erreurs Express et des hooks d'accessibilité frontend.

Ces anomalies génèrent des dysfonctionnements critiques ou dégradent l'expérience utilisateur :
1. **Suppression de compte** : la suppression d'un utilisateur détache ses assets de campagne en assignant `uploadedById = null`. Les gardes d'accès vérifient la présence de l'uploader parmi les membres de la campagne, bloquant l'accès (`403 Forbidden`) aux cartes et jetons pour tous les joueurs restants.
2. **Divergence de sécurité transitoire** : deux middlewares distincts (`passwordChange.ts` et `adminMfa.ts`) dupliquent la liste des chemins autorisés lorsqu'une session est en attente de sécurisation, créant un risque de désynchronisation silencieuse.
3. **Erreurs HTTP 415 déguisées en 500** : les erreurs levées par `body-parser` pour des encodages ou charsets non supportés chutent en `500 Internal Server Error` au lieu d'un code client approprié `415 Unsupported Media Type`.
4. **Assainissement destructif d'email à l'inscription** : l'inscription supprime silencieusement les caractères `<` et `>`, tandis que la mire de connexion cherche l'email littéral, provoquant un verrouillage irréversible du compte.
5. **Désalignement textuel des messages d'erreur** : les libellés de boutons suggérés par l'API en cas de conflit ou d'erreur ne correspondent pas aux intitulés réels de l'interface utilisateur.
6. **Vol de focus dans les modales** : le hook `useFocusTrap` déplace systématiquement le focus vers le premier élément focusable (le bouton de fermeture), écrasant l'`autoFocus` légitime du premier champ de formulaire.
7. **Échec silencieux du presse-papier en HTTP local** : la copie de mot de passe temporaire dans le panneau d'**Administrator** utilise `navigator.clipboard.writeText`, non disponible sur les instances locales déployées en HTTP standard.
8. **Incohérence de longueur minimale du nom d'affichage** : le schéma serveur accepte les noms de 1 à 50 caractères, alors que les formulaires frontend rejettent les noms de moins de 2 caractères.

---

## 2. Invariants Métier & Principes Directeurs

1. **Pérennité des Campagnes Actives** : la suppression d'un compte utilisateur ne doit jamais corrompre l'affichage des cartes et des jetons d'une **Campaign** active. Tout membre d'une campagne référençant un asset détaché (`uploadedById === null`) doit conserver les droits de lecture sur cet asset.
2. **Source Unique de Vérité pour les Chemins de Transition** : les routes API autorisées pour un utilisateur dont la session de connexion est restreinte (changement de mot de passe requis ou MFA exigé) doivent découler d'une constante immuable unique, couverte par un test de parité structurelle.
3. **Validation Explicite vs Mutation Silencieuse** : les données d'identification (adresses email) ne doivent jamais être tronquées ou altérées silencieusement lors de la validation. Les caractères non autorisés doivent déclencher un rejet explicite `400 Bad Request`.
4. **Résilience Réseau Local & Accessibilité** : l'application doit fonctionner de manière robuste sur un réseau local en HTTP non sécurisé (fallback presse-papier) et respecter les intentions ergonomiques des dialogues (`autoFocus`).
5. **Zéro Dette Dangling** : les 11 commentaires `TODO(#157)` doivent être intégralement retirés du code source.

---

## 3. Spécifications Détaillées des Modifications

### 3.1. Accès en Lecture aux Assets Détachés (`backend/src/services/accountDeletion.ts` & `permissions.ts`)

#### Comportement Actuel
- Dans `backend/src/services/accountDeletion.ts`, la fonction `removePersonalFiles` conserve les assets référencés dans une campagne active et exécute : `await prisma.asset.updateMany({ where: { id: { in: keptAssetIds } }, data: { uploadedById: null } })`.
- Dans `backend/src/services/permissions.ts`, la fonction `assetUsedInUserCampaign` (ou la fonction de vérification d'accès aux assets) vérifie si `asset.uploadedById` appartient aux membres de la campagne. Lorsque `uploadedById` est `null`, la condition échoue et renvoie `false`, provoquant une erreur `403` pour tous les membres de la campagne.

#### Spécification Cible
- Conserver la politique d'anonymisation dans `backend/src/services/accountDeletion.ts` : `uploadedById` reste positionné à `null` pour les assets conservés liés à une campagne.
- Mettre à jour la logique d'autorisation dans `backend/src/services/permissions.ts` :
  - Si un asset est référencé dans une **Campaign** (via une carte, un calque, ou un jeton de cette campagne), et que l'utilisateur demandeur est membre actif de cette campagne, l'accès en lecture est accordé même si `asset.uploadedById === null`.
  - En d'autres termes, la condition de vérification ne doit plus exiger que `asset.uploadedById` soit un membre actif si l'asset est directement rattaché ou utilisé dans la campagne de l'utilisateur.
- Supprimer le commentaire `// TODO(#157): ...` dans `backend/src/services/accountDeletion.ts`.

### 3.2. Factorisation et Parité des Chemins de Sécurité Gated (`passwordChange.ts`, `adminMfa.ts`, `keepInStep.test.ts`)

#### Comportement Actuel
- `backend/src/middleware/passwordChange.ts` définit son propre ensemble `ALLOWED_PATHS`.
- `backend/src/middleware/adminMfa.ts` redéfinit un ensemble distinct `ALLOWED_PATHS` avec de légères variations (chemins `/auth/mfa/*`).
- Deux commentaires `TODO(#157)` signalent ce risque de dérive.

#### Spécification Cible
- Créer ou exporter une constante immuable `BASE_SECURITY_GATED_PATHS` (dans un module partagé de middleware ou directement dans `passwordChange.ts` et exporté) :
  ```ts
  export const BASE_SECURITY_GATED_PATHS = [
    '/auth/change-password',
    '/auth/logout',
    '/auth/me',
    '/auth/ping',
    '/auth/appearance',
    '/config',
  ] as const;
  ```
- Dans `backend/src/middleware/passwordChange.ts`, consommer `BASE_SECURITY_GATED_PATHS` pour initialiser `ALLOWED_PATHS`.
- Dans `backend/src/middleware/adminMfa.ts`, importer `BASE_SECURITY_GATED_PATHS` et composer les chemins autorisés :
  ```ts
  export const ADMIN_MFA_ALLOWED_PATHS = [
    ...BASE_SECURITY_GATED_PATHS,
    '/auth/mfa/setup',
    '/auth/mfa/verify',
  ] as const;
  ```
- Dans `backend/src/__tests__/keepInStep.test.ts`, ajouter un test unitaire garantissant que tous les éléments de `BASE_SECURITY_GATED_PATHS` sont strictement inclus dans les chemins autorisés par `adminMfa.ts` et que toute route critique de déconnexion ou de profil est présente.
- Supprimer les deux commentaires `TODO(#157)` dans `passwordChange.ts` et `adminMfa.ts`.

### 3.3. Gestion des Erreurs Body-Parser 415 (`backend/src/middleware/errorHandler.ts`)

#### Comportement Actuel
- `errorHandler.ts` intercepte `413` (`entity.too.large`) et `400` (`entity.parse.failed`).
- Les erreurs `charset.unsupported` et `encoding.unsupported` levées par Express `body-parser` portent le statut HTTP `415`, mais passent outre ces vérifications et retombent dans le cas générique `500 Internal Server Error`.

#### Spécification Cible
- Dans `backend/src/middleware/errorHandler.ts`, enrichir la condition de détection des erreurs de corps de requête :
  ```ts
  const isUnsupportedMediaType =
    err.status === 415 ||
    err.statusCode === 415 ||
    err.type === 'charset.unsupported' ||
    err.type === 'encoding.unsupported';
  ```
- Si la condition est vérifiée, renvoyer une réponse HTTP `415 Unsupported Media Type` avec un corps d'erreur JSON standardisé :
  ```json
  {
    "error": "Unsupported media type"
  }
  ```
  (ou le message d'erreur d'origine fourni par le parser si non vide).
- Supprimer le commentaire `// TODO(#157): ...` dans `errorHandler.ts`.

### 3.4. Validation Stricte des Emails à l'Inscription (`backend/src/services/auth.ts`)

#### Comportement Actuel
- Dans `backend/src/services/auth.ts`, `prepareRegistration` effectue un `sanitizeInput(email)` qui élimine les caractères `<` et `>`. L'utilisateur s'enregistre donc sous un email tronqué, mais la page de connexion effectue une recherche stricte avec les caractères d'origine saisis par l'utilisateur, provoquant une erreur d'authentification permanente.

#### Spécification Cible
- Supprimer l'appel à `sanitizeInput` altérant l'email dans `prepareRegistration`.
- Ajouter une validation stricte : si l'adresse email contient `<` ou `>`, rejeter immédiatement la requête avec une erreur `400 Bad Request` (`Invalid email address` ou `Email address cannot contain angle brackets`), en parfait alignement avec les routes d'invitation et de création d'utilisateurs de `backend/src/routes/admin.ts`.
- Supprimer le commentaire `// TODO(#157): ...` dans `auth.ts`.

### 3.5. Harmonisation des Libellés de Boutons dans les Messages d'Erreur (`admin.ts` & `users.ts`)

#### Comportement Actuel
- Dans `backend/src/routes/admin.ts` (`POST /api/admin/users/:id/resend-invite`), en cas de conflit `409` (l'utilisateur a déjà complété son inscription), le message cite un mauvais intitulé de bouton.
- Dans `backend/src/routes/users.ts` (`POST /api/users/:id/reset-password`), lorsqu'un **Administrator** tente de réinitialiser son propre mot de passe via l'API au lieu de passer par son profil, l'erreur `400` indique un libellé de bouton non conforme.

#### Spécification Cible
- Dans `backend/src/routes/admin.ts`, ajuster le message `409` pour mentionner exactement : `"Send Reset Link"` (libellé présent sur l'interface du panneau d'**Administrator**).
- Dans `backend/src/routes/users.ts`, ajuster le message `400` pour mentionner exactement : `"Change Password"` (libellé présent sur la page de profil de l'utilisateur).
- Supprimer les deux commentaires `// TODO(#157): ...` dans `admin.ts` et `users.ts`.

### 3.6. Préservation de l'`autoFocus` dans `useFocusTrap` (`frontend/src/hooks/useFocusTrap.ts`)

#### Comportement Actuel
- Dès qu'une boîte de dialogue modale s'ouvre, `useFocusTrap` force inconditionnellement le focus sur le premier élément focusable trouvé dans le conteneur (le bouton de fermeture `X` de la modale), écrasant le focus d'un champ de formulaire pourtant doté de l'attribut `autoFocus` (comme le champ email dans la modale de création d'utilisateur).

#### Spécification Cible
- Dans `frontend/src/hooks/useFocusTrap.ts`, avant de positionner le focus sur le premier élément focusable (`firstFocusable.focus()`), vérifier si le conteneur englobe déjà l'élément actif du document :
  ```ts
  if (containerRef.current && containerRef.current.contains(document.activeElement)) {
    return;
  }
  ```
- Ne forcer le focus sur le premier élément focusable que si aucun élément interne au conteneur n'a déjà le focus.
- Supprimer le commentaire `// TODO(#157): ...` dans `useFocusTrap.ts`.

### 3.7. Fallback Presse-Papier en HTTP Réseau Local (`frontend/src/pages/AdminPage.tsx`)

#### Comportement Actuel
- La fonction de copie du mot de passe temporaire dans `AdminPage.tsx` appelle directement `navigator.clipboard.writeText(tempPassword)`. En environnement LAN non HTTPS (HTTP pur), `navigator.clipboard` est `undefined`, ce qui provoque une exception JavaScript non gérée ou un échec silencieux sans retour visuel pour l'utilisateur.

#### Spécification Cible
- Importer et utiliser la fonction utilitaire `copyText` depuis `src/utils/clipboard.ts` (qui gère l'API moderne `navigator.clipboard` avec bascule transparente vers un élément `textarea` et `document.execCommand('copy')` en contexte non sécurisé HTTP).
- Gérer le retour sous forme de promesse de `copyText` et afficher un toast ou une notification visuelle claire de confirmation (« Mot de passe temporaire copié ») ou d'échec (« Impossible de copier le mot de passe »).
- Supprimer le commentaire `// TODO(#157): ...` dans `AdminPage.tsx`.

### 3.8. Alignement de la Longueur Minimale de `displayName` (`ProfilePage.tsx`, `SetupWizardPage.tsx`, `RegisterPage.tsx`)

#### Comportement Actuel
- Le backend valide `displayName` via `displayNameSchema` acceptant une longueur de 1 à 50 caractères.
- Les pages `ProfilePage.tsx`, `SetupWizardPage.tsx` (**Setup**) et `RegisterPage.tsx` bloquent la soumission avec une vérification client arbitraire `displayName.trim().length < 2`.

#### Spécification Cible
- Mettre à jour la validation client dans ces 3 composants pour autoriser les noms d'affichage valides dès 1 caractère :
  ```ts
  displayName.trim().length >= 1 && displayName.trim().length <= 50
  ```
- Harmoniser les messages d'erreur de formulaire associés pour indiquer : `"Display name must be between 1 and 50 characters"`.
- Supprimer les trois commentaires `// TODO(#157): ...` dans `ProfilePage.tsx`, `SetupWizardPage.tsx` et `RegisterPage.tsx`.

---

## 4. Matrice de Traçabilité des TODOs et Fichiers Cibles

| # | Fichier | Ligne / Contexte | Action requise | Suppression TODO(#157) |
|---|---------|-------------------|----------------|-------------------------|
| 1 | `frontend/src/hooks/useFocusTrap.ts` | Activation du focus | Préserver le focus si `container.contains(document.activeElement)` | Oui |
| 2 | `backend/src/middleware/errorHandler.ts` | Gestion des erreurs body-parser | Traiter 415 / `charset.unsupported` / `encoding.unsupported` | Oui |
| 3 | `backend/src/middleware/passwordChange.ts` | Déclaration `ALLOWED_PATHS` | Importer `BASE_SECURITY_GATED_PATHS` partagé | Oui |
| 4 | `backend/src/middleware/adminMfa.ts` | Déclaration `ALLOWED_PATHS` | Dériver depuis `BASE_SECURITY_GATED_PATHS` | Oui |
| 5 | `backend/src/routes/admin.ts` | `POST /api/admin/users/:id/resend-invite` | Aligner libellé bouton : `"Send Reset Link"` | Oui |
| 6 | `backend/src/routes/users.ts` | `POST /api/users/:id/reset-password` | Aligner libellé bouton : `"Change Password"` | Oui |
| 7 | `backend/src/services/accountDeletion.ts` | `removePersonalFiles` | Maintenir `uploadedById = null` et autoriser lecture membre campagne | Oui |
| 8 | `backend/src/services/auth.ts` | `prepareRegistration` | Rejeter `<` et `>` à la validation sans assainissement destructif | Oui |
| 9 | `frontend/src/pages/AdminPage.tsx` | Copie mot de passe temporaire | Utiliser `copyText` de `utils/clipboard` + toast feedback | Oui |
| 10 | `frontend/src/pages/ProfilePage.tsx` | Validation nom d'affichage | Autoriser longueur `>= 1` et `<= 50` | Oui |
| 11 | `frontend/src/pages/SetupWizardPage.tsx` | Validation nom d'affichage | Autoriser longueur `>= 1` et `<= 50` | Oui |
| 12 | `frontend/src/pages/auth/RegisterPage.tsx` | Validation nom d'affichage | Autoriser longueur `>= 1` et `<= 50` | Oui |

---

## 5. Stratégie de Tests et Validation

### 5.1. Tests Backend (Node.js / Vitest / Supertest)
1. **Permissions & Suppression de Compte (`permissions.test.ts` & `accountDeletion.test.ts`)** :
   - Supprimer le compte d'un utilisateur ayant téléversé une carte dans une campagne active.
   - Vérifier que l'asset a son champ `uploadedById` à `null`.
   - Vérifier qu'un autre membre actif de la campagne peut récupérer l'asset (`200 OK`).
   - Vérifier qu'un utilisateur externe à la campagne se voit refuser l'accès (`403 Forbidden`).
2. **Gestionnaire d'Erreurs 415 (`errorHandler.test.ts`)** :
   - Envoyer une requête avec un en-tête d'encodage non supporté ou simuler une erreur body-parser `charset.unsupported`.
   - Vérifier que la réponse HTTP est strictement `415 Unsupported Media Type` et non `500`.
3. **Parité des Chemins de Sécurité Gated (`keepInStep.test.ts`)** :
   - Vérifier par assertion que `BASE_SECURITY_GATED_PATHS` est un sous-ensemble strict des routes autorisées dans `adminMfa.ts`.
   - Vérifier que les deux middlewares autorisent les endpoints vitaux `/auth/me`, `/auth/logout`, `/auth/appearance`, `/config`.
4. **Validation des Emails (`auth.test.ts`)** :
   - Tenter une inscription avec `bad<name>@example.com` -> Vérifier le retour `400 Bad Request` sans création de compte en base.
5. **Messages d'Erreur des Routes (`admin.test.ts` & `users.test.ts`)** :
   - Vérifier la présence textuelle exacte de `"Send Reset Link"` dans l'erreur 409 de renvoi d'invitation.
   - Vérifier la présence textuelle exacte de `"Change Password"` dans l'erreur 400 de réinitialisation de son propre mot de passe.

### 5.2. Tests Frontend (React Testing Library / Vitest)
1. **Focus Trap (`useFocusTrap.test.tsx`)** :
   - Monter un composant modal avec un premier élément (bouton de fermeture) et un champ texte portant `autoFocus`.
   - Vérifier qu'à l'ouverture, le focus reste positionné sur le champ texte et n'est pas volé par le bouton de fermeture.
2. **Presse-Papier HTTP LAN (`AdminPage.test.tsx`)** :
   - Mocker `navigator.clipboard = undefined` (simulation contexte HTTP non sécurisé).
   - Cliquer sur le bouton de copie du mot de passe temporaire.
   - Vérifier que l'utilitaire `copyText` est appelé, exécute le fallback legacy, et affiche le toast de confirmation.
3. **Validation de la Longueur du Nom d'Affichage** :
   - Tester la saisie d'un nom d'affichage à 1 caractère (`"A"`) dans `ProfilePage`, `SetupWizardPage` et `RegisterPage` -> Vérifier que le formulaire est valide et soumis avec succès.

---

## 6. Analyse des Risques et Non-Régression

- **Sécurité des Assets Orphelins** : l'autorisation de lecture accordée pour les assets dont `uploadedById === null` doit impérativement être circonscrite aux membres des campagnes dans lesquelles cet asset est référencé. Un asset détaché non lié à une campagne active ne doit en aucun cas devenir accessible publiquement.
- **Cohérence des Sessions MFA et Mot de Passe** : l'utilisation d'une constante partagée `BASE_SECURITY_GATED_PATHS` empêche l'oubli de routes nécessaires au rendu de l'interface en état restreint (thème sombre, ping de session, statut de configuration).
- **Absence de Régression E2E** : la compatibilité des noms d'affichage à 1 caractère résout les blocages pour les pseudonymes monocaractères déjà acceptés par les moteurs de recherche de joueurs.

---

## 7. Critères d'Acceptation (Definition of Done)

- [ ] Les 9 anomalies fonctionnelles et techniques sont corrigées conformément aux spécifications.
- [ ] Les 11 commentaires `TODO(#157)` sont tous supprimés dans les 10 fichiers identifiés.
- [ ] Les tests automatisés unitaires et d'intégration couvrent l'intégralité des nouveaux cas d'usage.
- [ ] La suite complète des tests backend et frontend passe avec succès sans avertissement.
- [ ] La revue statique EPURE `ai-review` est validée sans finding `must_fix`.
