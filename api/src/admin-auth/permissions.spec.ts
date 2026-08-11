import { PERMISSIONS, ROLE_PERMISSIONS, roleHasPermission } from './permissions';

describe('permissions', () => {
  it('gives staff read-only access, no claim/approve/reject/flag/write permissions', () => {
    const staffPermissions = ROLE_PERMISSIONS.staff;
    expect(staffPermissions).toEqual(
      expect.arrayContaining([
        PERMISSIONS.MODERATION_QUEUE_READ,
        PERMISSIONS.MODERATION_SEARCH_READ,
        PERMISSIONS.MODERATION_ANALYTICS_READ,
        PERMISSIONS.ROUND_TYPES_READ,
      ]),
    );
    expect(staffPermissions).not.toEqual(
      expect.arrayContaining([
        PERMISSIONS.MODERATION_QUEUE_APPROVE,
        PERMISSIONS.MODERATION_QUEUE_REJECT,
        PERMISSIONS.MODERATION_QUEUE_FLAG,
        PERMISSIONS.MODERATION_QUEUE_CLAIM,
        PERMISSIONS.MODERATION_QUEUE_RELEASE,
        PERMISSIONS.ROUND_TYPES_WRITE,
        PERMISSIONS.STAFF_MANAGE,
      ]),
    );
  });

  it('makes moderator a strict superset of staff, without staff_manage', () => {
    for (const permission of ROLE_PERMISSIONS.staff) {
      expect(ROLE_PERMISSIONS.moderator).toContain(permission);
    }
    expect(ROLE_PERMISSIONS.moderator).not.toContain(PERMISSIONS.STAFF_MANAGE);
  });

  it('makes admin a strict superset of moderator, including staff_manage', () => {
    for (const permission of ROLE_PERMISSIONS.moderator) {
      expect(ROLE_PERMISSIONS.admin).toContain(permission);
    }
    expect(ROLE_PERMISSIONS.admin).toContain(PERMISSIONS.STAFF_MANAGE);
  });

  describe('roleHasPermission', () => {
    it('returns true when the role\'s set includes the permission', () => {
      expect(roleHasPermission('admin', PERMISSIONS.STAFF_MANAGE)).toBe(true);
    });

    it('returns false when the role\'s set does not include the permission', () => {
      expect(roleHasPermission('staff', PERMISSIONS.MODERATION_QUEUE_APPROVE)).toBe(false);
    });
  });
});
