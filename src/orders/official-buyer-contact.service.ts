import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface OfficialBuyerContact {
  phone: string;
  telegram: string;
}

@Injectable()
export class OfficialBuyerContactService {
  constructor(private readonly config: ConfigService) {}

  getContact(): OfficialBuyerContact {
    const phone = this.config.get<string>('HULEGEB_OFFICIAL_PHONE')?.trim();
    const telegram = this.config
      .get<string>('HULEGEB_OFFICIAL_TELEGRAM')
      ?.trim();

    if (
      !phone ||
      !/^\+[1-9]\d{7,14}$/.test(phone) ||
      !telegram ||
      !/^(?:@[A-Za-z0-9_]{5,32}|https:\/\/t\.me\/[A-Za-z0-9_]{5,32}\/?)$/.test(
        telegram,
      )
    ) {
      throw new ServiceUnavailableException(
        'Official buyer contact information is not configured.',
      );
    }

    return { phone, telegram };
  }
}
