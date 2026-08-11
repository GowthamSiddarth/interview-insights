import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS } from '../permissions';
import { PermissionsGuard } from './permissions.guard';

function contextWithUser(role: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user: { id: 'mod-1', username: 'someone', role } }),
    }),
    getHandler: () => jest.fn(),
  } as unknown as ExecutionContext;
}

describe('PermissionsGuard', () => {
  it('allows the request through when the route has no @RequirePermission() metadata', () => {
    const reflector = { get: jest.fn().mockReturnValue(undefined) } as unknown as Reflector;
    const guard = new PermissionsGuard(reflector);

    expect(guard.canActivate(contextWithUser('staff'))).toBe(true);
  });

  it('allows the request through when the role has the required permission', () => {
    const reflector = {
      get: jest.fn().mockReturnValue(PERMISSIONS.MODERATION_QUEUE_APPROVE),
    } as unknown as Reflector;
    const guard = new PermissionsGuard(reflector);

    expect(guard.canActivate(contextWithUser('moderator'))).toBe(true);
  });

  it('throws ForbiddenException when the role lacks the required permission', () => {
    const reflector = {
      get: jest.fn().mockReturnValue(PERMISSIONS.STAFF_MANAGE),
    } as unknown as Reflector;
    const guard = new PermissionsGuard(reflector);

    expect(() => guard.canActivate(contextWithUser('moderator'))).toThrow(ForbiddenException);
  });

  it('throws ForbiddenException for a staff account hitting a moderator-only permission', () => {
    const reflector = {
      get: jest.fn().mockReturnValue(PERMISSIONS.MODERATION_QUEUE_APPROVE),
    } as unknown as Reflector;
    const guard = new PermissionsGuard(reflector);

    expect(() => guard.canActivate(contextWithUser('staff'))).toThrow(ForbiddenException);
  });
});
