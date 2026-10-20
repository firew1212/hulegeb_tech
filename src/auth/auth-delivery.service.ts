
import {
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface DeliveryPayload {
  event:
    | 'verify-email'
    | 'verify-phone'
    | 'reset-password'
    | 'admin-login-mfa';
  recipient: string;
  token: string;
  verificationUrl?: string;
  expiresInSeconds: number;
}

@Injectable()
export class AuthDeliveryService {
  constructor(private readonly config: ConfigService) {}

  assertSmsConfigured(): void {
    const smsMode = this.config.get<string>('AUTH_SMS_MODE') ?? 'webhook';
    const isSandboxAllowed = this.isSandboxAllowed();
    const endpoint = this.config.get<string>('AUTH_SMS_WEBHOOK_URL');

    if (smsMode === 'console' && isSandboxAllowed) {
      return;
    }

    if (
      smsMode !== 'webhook' ||
      !endpoint ||
      !this.isSmsWebhookUrlAllowed(endpoint) ||
      !this.config.get<string>('AUTH_DELIVERY_WEBHOOK_TOKEN')
    ) {
      throw new ServiceUnavailableException(
        'SMS delivery is not configured for this environment.',
      );
    }
  }

  assertEmailAndSmsConfigured(): void {
    const emailMode =
      this.config.get<string>('AUTH_EMAIL_MODE') ?? 'brevo';
    const isSandboxAllowed = this.isSandboxAllowed();

    if (emailMode === 'console' && !isSandboxAllowed) {
      throw new ServiceUnavailableException(
        'Email sandbox is available only in development or test.',
      );
    }

    if (emailMode === 'console' && isSandboxAllowed) {
      // Development email sandbox: no Brevo configuration required.
    } else if (
      emailMode !== 'brevo' ||
      !this.config.get<string>('BREVO_API_KEY') ||
      !this.config.get<string>('AUTH_EMAIL_FROM') ||
      !this.config.get<string>('FRONTEND_URL')
    ) {
      throw new ServiceUnavailableException(
        'Authentication email configuration is missing or invalid.',
      );
    }

    this.assertSmsConfigured();
  }

  async sendEmail(payload: DeliveryPayload): Promise<void> {
    const emailMode =
      this.config.get<string>('AUTH_EMAIL_MODE') ?? 'brevo';

    if (emailMode === 'console') {
      if (!this.isSandboxAllowed()) {
        throw new ServiceUnavailableException(
          'Email sandbox is available only in development or test.',
        );
      }

      console.info('[EMAIL SANDBOX]', {
        event: payload.event,
        recipient: payload.recipient,
        verificationUrl: payload.verificationUrl ?? null,
        verificationCode: payload.token,
        expiresInSeconds: payload.expiresInSeconds,
      });

      return;
    }

    if (emailMode !== 'brevo') {
      throw new ServiceUnavailableException(
        'Unsupported email delivery mode.',
      );
    }

    const apiKey = this.config.get<string>('BREVO_API_KEY');
    const senderSetting =
      this.config.get<string>('AUTH_EMAIL_FROM');

    if (!apiKey || !senderSetting) {
      throw new ServiceUnavailableException(
        'Brevo email configuration is missing.',
      );
    }

    const senderMatch = senderSetting.match(
      /^\s*(.*?)\s*<([^<>]+)>\s*$/,
    );

    const sender = senderMatch
      ? {
          name: senderMatch[1].trim(),
          email: senderMatch[2].trim(),
        }
      : {
          name: 'Hulegeb',
          email: senderSetting.trim(),
        };

    const emailContent = this.buildEmailContent(payload);

    let response: Response;

    try {
      response = await fetch(
        'https://api.brevo.com/v3/smtp/email',
        {
          method: 'POST',
          headers: {
            'api-key': apiKey,
            'content-type': 'application/json',
            accept: 'application/json',
          },
          body: JSON.stringify({
            sender,
            to: [{ email: payload.recipient }],
            subject: emailContent.subject,
            htmlContent: emailContent.html,
            textContent: emailContent.text,
          }),
          signal: AbortSignal.timeout(10_000),
        },
      );
    } catch {
      throw new ServiceUnavailableException(
        'Brevo email service is unavailable.',
      );
    }

    if (!response.ok) {
      console.error('[BREVO EMAIL API ERROR]', {
        status: response.status,
      });

      throw new ServiceUnavailableException(
        'Brevo could not send the authentication email. Check the backend logs.',
      );
    }
  }



  async sendSms(payload: DeliveryPayload): Promise<void> {
  const smsMode = this.config.get<string>('AUTH_SMS_MODE') ?? 'webhook';

  if (smsMode === 'console') {
    if (!this.isSandboxAllowed()) {
      throw new ServiceUnavailableException(
        'SMS sandbox is available only in development or test.',
      );
    }

    console.info('[SMS SANDBOX]', {
      event: payload.event,
      recipient: payload.recipient,
      verificationCode: payload.token,
      expiresInSeconds: payload.expiresInSeconds,
    });

    return;
  }

  if (smsMode !== 'webhook') {
    throw new ServiceUnavailableException(
      'Unsupported SMS delivery mode.',
    );
  }

  await this.sendSmsWebhook(payload);
}

  private async sendSmsWebhook(
    payload: DeliveryPayload,
  ): Promise<void> {
    const endpoint = this.config.get<string>(
      'AUTH_SMS_WEBHOOK_URL',
    );
    const token = this.config.get<string>(
      'AUTH_DELIVERY_WEBHOOK_TOKEN',
    );

    if (
      !endpoint ||
      !this.isSmsWebhookUrlAllowed(endpoint) ||
      !token
    ) {
      throw new ServiceUnavailableException(
        'SMS delivery is not configured.',
      );
    }

    let response: Response;

    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new ServiceUnavailableException(
        'SMS delivery provider is unavailable.',
      );
    }

    if (!response.ok) {
      throw new ServiceUnavailableException(
        'SMS delivery provider rejected the request.',
      );
    }
  }

  private isSmsWebhookUrlAllowed(endpoint: string): boolean {
    let url: URL;

    try {
      url = new URL(endpoint);
    } catch (error) {
      if (error instanceof TypeError) {
        return false;
      }

      throw error;
    }

    if (url.protocol === 'https:') {
      return true;
    }

    return (
      this.isSandboxAllowed() &&
      url.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    );
  }

  private isSandboxAllowed(): boolean {
    const environment = this.config.get<string>('NODE_ENV');
    return environment === 'development' || environment === 'test';
  }

  private buildEmailContent(payload: DeliveryPayload): {
    subject: string;
    html: string;
    text: string;
  } {
    const details: Record<
      DeliveryPayload['event'],
      { subject: string; heading: string; message: string }
    > = {
      'verify-email': {
        subject: 'Verify your Hulegeb email',
        heading: 'Verify your email address',
        message:
          'Please verify your email address to continue setting up your Hulegeb account.',
      },
      'verify-phone': {
        subject: 'Your Hulegeb verification code',
        heading: 'Phone verification',
        message:
          'Use the verification code below to verify your phone number.',
      },
      'reset-password': {
        subject: 'Reset your Hulegeb password',
        heading: 'Password reset',
        message:
          'Use the link or code below to reset your Hulegeb password.',
      },
      'admin-login-mfa': {
        subject: 'Your Hulegeb admin login code',
        heading: 'Admin login verification',
        message:
          'Use the verification code below to complete your administrator login.',
      },
    };

    const detail = details[payload.event];
    const safeToken = this.escapeHtml(payload.token);
    const safeUrl = payload.verificationUrl
      ? this.escapeHtml(payload.verificationUrl)
      : undefined;
    const expiryMinutes = Math.max(
      1,
      Math.ceil(payload.expiresInSeconds / 60),
    );

    const action = safeUrl
      ? `<p><a href="${safeUrl}">Continue to Hulegeb</a></p>`
      : `<p><strong>Verification code:</strong> ${safeToken}</p>`;

    const textAction = payload.verificationUrl
      ? `Continue to Hulegeb: ${payload.verificationUrl}`
      : `Verification code: ${payload.token}`;

    return {
      subject: detail.subject,
      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.6">
          <h2>${detail.heading}</h2>
          <p>${detail.message}</p>
          ${action}
          <p>This expires in approximately ${expiryMinutes} minute(s).</p>
          <p>If you did not request this, you can ignore this email.</p>
          <p>— Hulegeb</p>
        </div>
      `,
      text: `${detail.heading}\n\n${detail.message}\n\n${textAction}\n\nThis expires in approximately ${expiryMinutes} minute(s).\n\nIf you did not request this, you can ignore this email.\n\nHulegeb`,
    };
  }

  private escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (character) => {
      const entities: Record<string, string> = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      };

      return entities[character];
    });
  }
}
