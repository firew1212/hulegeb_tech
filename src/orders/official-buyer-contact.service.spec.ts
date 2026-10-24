import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OfficialBuyerContactService } from './official-buyer-contact.service.js';

function createContactService(values: Record<string, string | undefined> = {}) {
  const config = {
    get: (key: string) => values[key],
  } as ConfigService;

  return new OfficialBuyerContactService(config);
}

describe('OfficialBuyerContactService', () => {
  it('returns the configured official phone and Telegram contact', () => {
    const service = createContactService({
      HULEGEB_OFFICIAL_PHONE: ' +12025550123 ',
      HULEGEB_OFFICIAL_TELEGRAM: ' @example_support ',
    });

    expect(service.getContact()).toEqual({
      phone: '+12025550123',
      telegram: '@example_support',
    });
  });

  it('accepts a configured Telegram contact URL', () => {
    const service = createContactService({
      HULEGEB_OFFICIAL_PHONE: '+12025550123',
      HULEGEB_OFFICIAL_TELEGRAM: 'https://t.me/example_support',
    });

    expect(service.getContact()).toEqual({
      phone: '+12025550123',
      telegram: 'https://t.me/example_support',
    });
  });

  it.each([
    {},
    { HULEGEB_OFFICIAL_PHONE: '+12025550123' },
    { HULEGEB_OFFICIAL_TELEGRAM: '@example_support' },
    {
      HULEGEB_OFFICIAL_PHONE: 'not-a-phone',
      HULEGEB_OFFICIAL_TELEGRAM: '@example_support',
    },
    {
      HULEGEB_OFFICIAL_PHONE: '+12025550123',
      HULEGEB_OFFICIAL_TELEGRAM: 'https://example.test/contact',
    },
  ])('fails safely for missing or invalid configuration', (values) => {
    const service = createContactService(values);

    try {
      service.getContact();
      throw new Error('Expected contact configuration to be rejected.');
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect((error as Error).message).toBe(
        'Official buyer contact information is not configured.',
      );
      expect((error as Error).message).not.toContain('HULEGEB_OFFICIAL');
    }
  });
});
