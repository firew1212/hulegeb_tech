import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';

describe('AppController', () => {
  describe('root', () => {
    it('should return "Hello World!"', () => {
      const appController = new AppController(new AppService());

      expect(appController.getHello()).toBe('Hello World!');
    });
  });
});
