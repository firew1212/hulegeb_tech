import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthDeliveryService } from './auth-delivery.service.js';

function createDeliveryService(values: Record<string, string> = {}) {
  const config = {
    get: (key: string) => values[key],
  } as ConfigService;
  return new AuthDeliveryService(config);
}

describe('AuthDeliveryService', () => {
  it.each([undefined, 'production'])(
    'refuses console delivery when NODE_ENV is %s',
    async (environment) => {
      const service = createDeliveryService({
        AUTH_EMAIL_MODE: 'console',
        AUTH_SMS_MODE: 'console',
        ...(environment ? { NODE_ENV: environment } : {}),
      });

      expect(() => service.assertEmailAndSmsConfigured()).toThrow(
        ServiceUnavailableException,
      );
      const payload = {
        event: 'verify-email' as const,
        recipient: 'buyer@example.test',
        token: 'test-token',
        expiresInSeconds: 3600,
      };
      await expect(service.sendEmail(payload)).rejects.toThrow(
        ServiceUnavailableException,
      );
      await expect(service.sendSms(payload)).rejects.toThrow(
        ServiceUnavailableException,
      );
    },
  );

  it('allows console delivery only in explicit development or test mode', () => {
    for (const environment of ['development', 'test']) {
      const service = createDeliveryService({
        NODE_ENV: environment,
        AUTH_EMAIL_MODE: 'console',
        AUTH_SMS_MODE: 'console',
      });

      expect(() => service.assertEmailAndSmsConfigured()).not.toThrow();
    }
  });

  it('allows admin MFA to use explicitly configured console SMS in development', () => {
    const service = createDeliveryService({
      NODE_ENV: 'development',
      AUTH_SMS_MODE: 'console',
    });

    expect(() => service.assertSmsConfigured()).not.toThrow();
  });

  it.each([
    ['production', 'http://sms.provider.test/send', false],
    ['development', 'http://sms.provider.test/send', false],
    ['development', 'http://localhost:8080/send', true],
    ['test', 'http://127.0.0.1:8080/send', true],
    ['production', 'https://sms.provider.test/send', true],
    ['production', 'not a URL', false],
  ])(
    'validates SMS webhook transport for %s and %s',
    (environment, endpoint, allowed) => {
      const service = createDeliveryService({
        NODE_ENV: environment,
        AUTH_SMS_WEBHOOK_URL: endpoint,
        AUTH_DELIVERY_WEBHOOK_TOKEN: 'test-webhook-token',
      });

      if (allowed) {
        expect(() => service.assertSmsConfigured()).not.toThrow();
      } else {
        expect(() => service.assertSmsConfigured()).toThrow(
          ServiceUnavailableException,
        );
      }
    },
  );

  it('does not send credentials or verification codes over HTTP in production', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const service = createDeliveryService({
      NODE_ENV: 'production',
      AUTH_SMS_WEBHOOK_URL: 'http://sms.provider.test/send',
      AUTH_DELIVERY_WEBHOOK_TOKEN: 'test-webhook-token',
    });

    try {
      await expect(
        service.sendSms({
          event: 'admin-login-mfa',
          recipient: '+12025550123',
          token: 'test-verification-code',
          expiresInSeconds: 300,
        }),
      ).rejects.toThrow(ServiceUnavailableException);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('does not log a failed provider response body or delivery credentials', async () => {
    const apiKey = 'test-provider-key-do-not-log';
    const responseBody = 'test-provider-response-must-not-be-logged';
    const service = createDeliveryService({
      AUTH_EMAIL_MODE: 'brevo',
      BREVO_API_KEY: apiKey,
      AUTH_EMAIL_FROM: 'no-reply@example.test',
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(responseBody, { status: 400 }));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', fetchMock);

    try {
      await expect(
        service.sendEmail({
          event: 'verify-email',
          recipient: 'buyer@example.test',
          token: 'sensitive-verification-token',
          verificationUrl: 'https://frontend.example/verify?token=sensitive',
          expiresInSeconds: 3600,
        }),
      ).rejects.toThrow(ServiceUnavailableException);

      expect(errorSpy).toHaveBeenCalledWith('[BREVO EMAIL API ERROR]', {
        status: 400,
      });
      const loggedOutput = JSON.stringify(errorSpy.mock.calls);
      expect(loggedOutput).not.toContain(apiKey);
      expect(loggedOutput).not.toContain(responseBody);
      expect(loggedOutput).not.toContain('sensitive-verification-token');
    } finally {
      vi.unstubAllGlobals();
      errorSpy.mockRestore();
    }
  });
});
