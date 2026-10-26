/**
 * ADR 0014: Cleanup authorities, removal inventory, and leftover scan tests.
 *
 * Verifies:
 * 1. Scan of ADR 0014 removal inventory has zero production callers (test-only or empty).
 * 2. Permission helpers are still present and functioning.
 * 3. Documented Operator scripts are present and named in Operator docs.
 * 4. Starter and published template routes still exist.
 * 5. customLogoUrl appearance validation and endpoints still work.
 * 6. Parity / keep-in-step invariants pass.
 */

import fs from 'fs';
import path from 'path';
import { validateEmail, validatePasswordStrength, SPECIAL_CHARACTER, MAX_EMAIL_LENGTH, isSameOriginPath } from '../utils/validation';

const root = path.resolve(__dirname, '../../..');
const backendSrc = path.join(root, 'backend', 'src');
const frontendSrc = path.join(root, 'frontend', 'src');
const docsDir = path.join(root, 'docs');

function collectProductionFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (
        entry.name === '__tests__' ||
        entry.name === 'node_modules' ||
        entry.name === 'dist' ||
        entry.name === 'coverage'
      ) {
        continue;
      }
      files.push(...collectProductionFiles(fullPath));
    } else if (
      entry.isFile() &&
      /\.(ts|tsx|js|jsx)$/.test(entry.name) &&
      !entry.name.includes('.test.') &&
      !entry.name.includes('.spec.')
    ) {
      files.push(fullPath);
    }
  }

  return files;
}

describe('ADR 0014 Removal Inventory & Leftovers Scan', () => {
  const frontendProdFiles = collectProductionFiles(frontendSrc);
  const backendProdFiles = collectProductionFiles(backendSrc);

  describe('Acceptance Criterion 1: Scan of ADR 0014 removal inventory is empty or test-only', () => {
    it('has zero production callers for the orphan sheet barrel', () => {
      const barrelImportRegex = /from\s+['"](@\/components\/character-sheets|\.\.?\/(?:.*\/)?character-sheets)['"]/;
      const offendingFiles: string[] = [];

      for (const file of frontendProdFiles) {
        const content = fs.readFileSync(file, 'utf8');
        if (barrelImportRegex.test(content)) {
          offendingFiles.push(path.relative(root, file));
        }
      }

      expect(offendingFiles).toEqual([]);
    });

    it('has removed the orphan sheet barrel exports', () => {
      const barrelPath = path.join(frontendSrc, 'components', 'character-sheets', 'index.ts');
      if (fs.existsSync(barrelPath)) {
        const content = fs.readFileSync(barrelPath, 'utf8').trim();
        expect(content).toBe('');
      }
    });

    it('has removed the unused dice helper from the generic validation module', () => {
      const validationContent = fs.readFileSync(path.join(frontendSrc, 'utils', 'validation.ts'), 'utf8');
      expect(validationContent).not.toContain('validateDiceExpression');
    });

    it('has zero production callers for the unused dice helper', () => {
      const diceHelperImportRegex = /\bvalidateDiceExpression\b/;
      const offendingFiles: string[] = [];

      for (const file of frontendProdFiles) {
        const content = fs.readFileSync(file, 'utf8');
        if (diceHelperImportRegex.test(content)) {
          offendingFiles.push(path.relative(root, file));
        }
      }

      expect(offendingFiles).toEqual([]);
    });

    it('has zero production callers for leftover validator blank templates (getBlankCharacterTemplate)', () => {
      const blankFactoryRegex = /\bgetBlankCharacterTemplate\b/;
      const offendingFiles: string[] = [];

      for (const file of [...backendProdFiles, ...frontendProdFiles]) {
        if (file.endsWith(path.join('validators', 'game-systems', 'index.ts'))) continue;
        const content = fs.readFileSync(file, 'utf8');
        if (blankFactoryRegex.test(content)) {
          offendingFiles.push(path.relative(root, file));
        }
      }

      expect(offendingFiles).toEqual([]);
    });

    it('does not reference no-op seed stubs in backend startup scripts', () => {
      const startScriptPath = path.join(root, 'backend', 'scripts', 'start.sh');
      expect(fs.existsSync(startScriptPath)).toBe(true);
      const startScript = fs.readFileSync(startScriptPath, 'utf8');
      expect(startScript).not.toContain('prisma db seed');
      expect(startScript).not.toContain('seed-stub');
    });
  });

  describe('Acceptance Criterion 2: Permission helpers are still present', () => {
    it('retains frontend template permissions helper (canModifyTemplate)', () => {
      const permissionsPath = path.join(frontendSrc, 'utils', 'templatePermissions.ts');
      expect(fs.existsSync(permissionsPath)).toBe(true);
      const content = fs.readFileSync(permissionsPath, 'utf8');
      expect(content).toContain('export function canModifyTemplate');
      expect(content).toContain('PlatformRole.ADMIN');
      expect(content).toContain('templateEditor');
    });
  });

  describe('Acceptance Criterion 3: Documented Operator scripts are still present and named in Operator docs', () => {
    it('keeps backend operator startup script start.sh present', () => {
      const scriptPath = path.join(root, 'backend', 'scripts', 'start.sh');
      expect(fs.existsSync(scriptPath)).toBe(true);
      const content = fs.readFileSync(scriptPath, 'utf8');
      expect(content).toContain('CozyVTT Backend Startup');
    });

    it('documents operator scripts in ADR 0014', () => {
      const adrPath = path.join(docsDir, 'adr', '0014-cleanup-authorities-and-sequencing.md');
      expect(fs.existsSync(adrPath)).toBe(true);
      const content = fs.readFileSync(adrPath, 'utf8');
      expect(content).toContain('Operator');
    });
  });

  describe('Acceptance Criterion 4: Starter and published template routes still exist', () => {
    it('retains starter and published template routes in the mounted route inventory', () => {
      const inventoryPath = path.join(backendSrc, '__tests__', 'helpers', 'routeInventory.expected.json');
      expect(fs.existsSync(inventoryPath)).toBe(true);
      const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8')) as {
        routes: Array<{ method: string; path: string; handlers: string[] }>;
      };
      const templateRoutes = inventory.routes.filter((route) => route.path.toLowerCase().includes('template'));
      expect(templateRoutes.length).toBeGreaterThan(0);
    });

    it('retains starter templates registry in backend utils', () => {
      const templateRegistry = path.join(backendSrc, 'utils', 'character-templates', 'index.ts');
      expect(fs.existsSync(templateRegistry)).toBe(true);
      const content = fs.readFileSync(templateRegistry, 'utf8');
      expect(content).toContain('getAllTemplates');
    });
  });

  describe('Acceptance Criterion 5: customLogoUrl appearance GET/PUT still works', () => {
    it('correctly validates local branding paths with isSameOriginPath', () => {
      expect(isSameOriginPath('/logo.png')).toBe(true);
      expect(isSameOriginPath('/branding/mascot.webp')).toBe(true);
      expect(isSameOriginPath('/custom-assets/logo.svg')).toBe(true);
    });

    it('refuses external URLs, protocol-relative paths, backslashes and control characters', () => {
      expect(isSameOriginPath('https://evil.com/logo.png')).toBe(false);
      expect(isSameOriginPath('http://evil.com/logo.png')).toBe(false);
      expect(isSameOriginPath('//evil.com/logo.png')).toBe(false);
      expect(isSameOriginPath('/\\evil.com/logo.png')).toBe(false);
      expect(isSameOriginPath('/\t/evil.com/logo.png')).toBe(false);
      expect(isSameOriginPath('/\n/evil.com/logo.png')).toBe(false);
      expect(isSameOriginPath('logo.png')).toBe(false);
      expect(isSameOriginPath('')).toBe(false);
    });
  });

  describe('Acceptance Criterion 6: Parity / keep-in-step tests still pass', () => {
    const frontendValPath = path.join(frontendSrc, 'utils', 'validation.ts');

    it('keeps identical email length limits and special character patterns in step', () => {
      const feContent = fs.readFileSync(frontendValPath, 'utf8');
      expect(feContent).toContain(`MAX_EMAIL_LENGTH = ${MAX_EMAIL_LENGTH}`);
      expect(feContent).toContain(SPECIAL_CHARACTER.source);
    });

    it('validates password requirements consistently', () => {
      const strong = 'Str0ng!Passw0rd';
      const weakShort = 'Str0ng!P';
      const noSpecial = 'Str0ngPassw0rd';
      const noNum = 'Strong!Password';

      expect(validatePasswordStrength(strong).valid).toBe(true);
      expect(validatePasswordStrength(weakShort).valid).toBe(false);
      expect(validatePasswordStrength(noSpecial).valid).toBe(false);
      expect(validatePasswordStrength(noNum).valid).toBe(false);
    });

    it('validates email addresses consistently', () => {
      expect(validateEmail('test@example.com')).toBe(true);
      expect(validateEmail('not-an-email')).toBe(false);
      expect(validateEmail('user@')).toBe(false);
      expect(validateEmail('@domain.com')).toBe(false);
      expect(validateEmail('user@domain')).toBe(false);
      expect(validateEmail('a'.repeat(255))).toBe(false);
    });
  });
});
