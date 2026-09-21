export interface ProviderDeliveryResult {
  success: boolean;
  providerMessageId?: string;
  status: 'sent' | 'delivered' | 'failed';
  providerResponse?: Record<string, any>;
  error?: string;
}

export interface EmailSendOptions {
  to: string;
  cc?: string[];
  bcc?: string[];
  subject: string;
  html?: string;
  text: string;
  attachments?: Array<{ filename: string; content: string; contentType?: string }>;
  metadata?: Record<string, any>;
}

export interface EmailProvider {
  readonly name: string;
  sendEmail(options: EmailSendOptions): Promise<ProviderDeliveryResult>;
}

export interface SmsSendOptions {
  to: string;
  message: string;
  templateId?: string | null;
  senderId?: string | null;
  metadata?: Record<string, any>;
}

export interface SmsProvider {
  readonly name: string;
  sendSms(options: SmsSendOptions): Promise<ProviderDeliveryResult>;
}

export interface WhatsAppSendOptions {
  to: string;
  templateId?: string | null;
  parameters?: Record<string, string>;
  message?: string;
  metadata?: Record<string, any>;
}

export interface WhatsAppProvider {
  readonly name: string;
  sendWhatsApp(options: WhatsAppSendOptions): Promise<ProviderDeliveryResult>;
}

// -----------------------------------------------------------------------------
// Mock Provider Implementations (Default & Testing)
// -----------------------------------------------------------------------------

export class MockEmailProvider implements EmailProvider {
  readonly name = 'mock';
  public sentEmails: EmailSendOptions[] = [];
  public shouldFail = false;
  public failureError = 'SMTP connection timeout (Mock)';

  async sendEmail(options: EmailSendOptions): Promise<ProviderDeliveryResult> {
    if (this.shouldFail) {
      return {
        success: false,
        status: 'failed',
        error: this.failureError,
      };
    }

    this.sentEmails.push(options);
    return {
      success: true,
      providerMessageId: `mock-email-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      status: 'delivered',
      providerResponse: { mockDeliveredAt: new Date().toISOString(), to: options.to },
    };
  }

  reset() {
    this.sentEmails = [];
    this.shouldFail = false;
  }
}

export class MockSmsProvider implements SmsProvider {
  readonly name = 'mock';
  public sentSms: SmsSendOptions[] = [];
  public shouldFail = false;
  public failureError = 'SMS Gateway 503 Service Unavailable (Mock)';

  async sendSms(options: SmsSendOptions): Promise<ProviderDeliveryResult> {
    if (this.shouldFail) {
      return {
        success: false,
        status: 'failed',
        error: this.failureError,
      };
    }

    this.sentSms.push(options);
    return {
      success: true,
      providerMessageId: `mock-sms-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      status: 'delivered',
      providerResponse: { mockDeliveredAt: new Date().toISOString(), to: options.to },
    };
  }

  reset() {
    this.sentSms = [];
    this.shouldFail = false;
  }
}

export class MockWhatsAppProvider implements WhatsAppProvider {
  readonly name = 'mock';
  public sentWhatsApp: WhatsAppSendOptions[] = [];
  public shouldFail = false;
  public failureError = 'Meta Cloud API 500 Internal Error (Mock)';

  async sendWhatsApp(options: WhatsAppSendOptions): Promise<ProviderDeliveryResult> {
    if (this.shouldFail) {
      return {
        success: false,
        status: 'failed',
        error: this.failureError,
      };
    }

    this.sentWhatsApp.push(options);
    return {
      success: true,
      providerMessageId: `mock-wa-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      status: 'delivered',
      providerResponse: { mockDeliveredAt: new Date().toISOString(), to: options.to },
    };
  }

  reset() {
    this.sentWhatsApp = [];
    this.shouldFail = false;
  }
}

// -----------------------------------------------------------------------------
// Provider Registry
// -----------------------------------------------------------------------------

export class ProviderRegistry {
  private static emailProviders = new Map<string, EmailProvider>([
    ['mock', new MockEmailProvider()],
  ]);

  private static smsProviders = new Map<string, SmsProvider>([
    ['mock', new MockSmsProvider()],
  ]);

  private static whatsappProviders = new Map<string, WhatsAppProvider>([
    ['mock', new MockWhatsAppProvider()],
  ]);

  static registerEmailProvider(name: string, provider: EmailProvider) {
    this.emailProviders.set(name.toLowerCase(), provider);
  }

  static getEmailProvider(name = 'mock'): EmailProvider {
    return this.emailProviders.get(name.toLowerCase()) || this.emailProviders.get('mock')!;
  }

  static registerSmsProvider(name: string, provider: SmsProvider) {
    this.smsProviders.set(name.toLowerCase(), provider);
  }

  static getSmsProvider(name = 'mock'): SmsProvider {
    return this.smsProviders.get(name.toLowerCase()) || this.smsProviders.get('mock')!;
  }

  static registerWhatsAppProvider(name: string, provider: WhatsAppProvider) {
    this.whatsappProviders.set(name.toLowerCase(), provider);
  }

  static getWhatsAppProvider(name = 'mock'): WhatsAppProvider {
    return this.whatsappProviders.get(name.toLowerCase()) || this.whatsappProviders.get('mock')!;
  }
}
