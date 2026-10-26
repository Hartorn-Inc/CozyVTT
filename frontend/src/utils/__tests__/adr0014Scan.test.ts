import { describe, it, expect } from 'vitest';
import { canModifyTemplate } from '../templatePermissions';
import { isValidEmail, isStrongPassword, meetsPasswordRequirements, SPECIAL_CHARACTER, MAX_EMAIL_LENGTH } from '../validation';
import { PlatformRole, type User } from '@/types';

type Actor = Pick<User, 'id' | 'platformRole' | 'templateEditor'>;

describe('ADR 0014 Client-Side Parity & Authority Invariants', () => {
  describe('Permission helpers remain intact', () => {
    const author: Actor = { id: 'u-1', platformRole: PlatformRole.USER, templateEditor: false };
    const stranger: Actor = { id: 'u-2', platformRole: PlatformRole.USER, templateEditor: false };
    const editor: Actor = { id: 'u-3', platformRole: PlatformRole.USER, templateEditor: true };
    const admin: Actor = { id: 'u-4', platformRole: PlatformRole.ADMIN, templateEditor: false };
    const owned = { createdById: 'u-1' };
    const orphaned = { createdById: null };

    it('lets the creator edit their own template', () => {
      expect(canModifyTemplate(author, owned)).toBe(true);
    });

    it('forbids an unrelated user from modifying a template', () => {
      expect(canModifyTemplate(stranger, owned)).toBe(false);
    });

    it('lets designated template editors and administrators curate templates', () => {
      expect(canModifyTemplate(editor, owned)).toBe(true);
      expect(canModifyTemplate(admin, owned)).toBe(true);
    });

    it('handles orphaned templates appropriately (curators only)', () => {
      expect(canModifyTemplate(stranger, orphaned)).toBe(false);
      expect(canModifyTemplate(editor, orphaned)).toBe(true);
      expect(canModifyTemplate(admin, orphaned)).toBe(true);
    });

    it('refuses unauthenticated visitors', () => {
      expect(canModifyTemplate(null, owned)).toBe(false);
      expect(canModifyTemplate(undefined, owned)).toBe(false);
    });
  });

  describe('Keep-in-step validation rules', () => {
    it('strictly requires 12 characters and all character classes', () => {
      expect(meetsPasswordRequirements('Short1!')).toBe(false);
      expect(meetsPasswordRequirements('Alllowercase1!')).toBe(false);
      expect(meetsPasswordRequirements('ALLUPPERCASE1!')).toBe(false);
      expect(meetsPasswordRequirements('NoSpecialChars123')).toBe(false);
      expect(meetsPasswordRequirements('ValidPassw0rd!')).toBe(true);
      expect(isStrongPassword('ValidPassw0rd!')).toBe(true);
    });

    it('adheres to maximum email length standard', () => {
      expect(MAX_EMAIL_LENGTH).toBe(254);
      const validMaxEmail = 'a'.repeat(64) + '@' + 'b'.repeat(185) + '.com';
      expect(validMaxEmail.length).toBe(254);
      expect(isValidEmail(validMaxEmail)).toBe(true);
      expect(isValidEmail(validMaxEmail + 'x')).toBe(false);
    });

    it('uses the server-agreed special character pattern', () => {
      expect(SPECIAL_CHARACTER.test('!')).toBe(true);
      expect(SPECIAL_CHARACTER.test('@')).toBe(true);
      expect(SPECIAL_CHARACTER.test('#')).toBe(true);
      expect(SPECIAL_CHARACTER.test('$')).toBe(true);
      expect(SPECIAL_CHARACTER.test('%')).toBe(true);
      expect(SPECIAL_CHARACTER.test('~')).toBe(false);
      expect(SPECIAL_CHARACTER.test(' ')).toBe(false);
    });
  });
});
