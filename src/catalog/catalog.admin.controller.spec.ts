import { Reflector } from '@nestjs/core';
import {
  PUBLIC_KEY,
  RoleCode,
  ROLES_KEY,
} from '../authorization/authorization.constants.js';
import { CatalogController } from './catalog.controller.js';

describe('CatalogController admin category permissions', () => {
  const reflector = new Reflector();

  it.each([
    ['listAllCategories', 'GET'],
    ['createCategory', 'POST'],
    ['updateCategory', 'PATCH'],
    ['deactivateCategory', 'PATCH'],
    ['listPendingProducts', 'GET'],
    ['approveProduct', 'POST'],
    ['rejectProduct', 'POST'],
  ])('%s requires the ADMIN role', (methodName) => {
    const handler = Object.getOwnPropertyDescriptor(
      CatalogController.prototype,
      methodName,
    )?.value;

    expect(reflector.get<string[]>(ROLES_KEY, handler)).toEqual([
      RoleCode.ADMIN,
    ]);
  });

  describe('CatalogController public product routes', () => {
    const reflector = new Reflector();

    it.each(['listPublicProducts', 'getPublicProduct'])(
      '%s is explicitly public',
      (methodName) => {
        const handler = Object.getOwnPropertyDescriptor(
          CatalogController.prototype,
          methodName,
        )?.value;

        expect(reflector.get<boolean>(PUBLIC_KEY, handler)).toBe(true);
      },
    );
  });
});
