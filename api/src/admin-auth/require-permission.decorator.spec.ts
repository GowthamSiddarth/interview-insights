import { Reflector } from '@nestjs/core';
import { Permission, PERMISSIONS } from './permissions';
import { PERMISSION_METADATA_KEY, RequirePermission } from './require-permission.decorator';

describe('RequirePermission', () => {
  it('attaches the permission as reflectable metadata under PERMISSION_METADATA_KEY', () => {
    class TestController {
      @RequirePermission(PERMISSIONS.MODERATION_QUEUE_APPROVE)
      handler(): void {}
    }

    // Read the method off its own property descriptor rather than
    // `TestController.prototype.handler` directly — the latter trips
    // @typescript-eslint/unbound-method (it looks like an unsafe unbound
    // method reference even though nothing here ever calls it).
    const handler = Object.getOwnPropertyDescriptor(TestController.prototype, 'handler')!
      .value as () => void;

    const reflector = new Reflector();
    const metadata = reflector.get<Permission>(PERMISSION_METADATA_KEY, handler);
    expect(metadata).toBe(PERMISSIONS.MODERATION_QUEUE_APPROVE);
  });
});
