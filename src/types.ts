export interface SendJob {
  campaignId: string;
  contactId: string;
  workspaceId: string;
}

export interface EmailAttachment {
  filename: string;
  type: string;
  disposition: 'attachment' | 'inline';
  content: string | ArrayBuffer | ArrayBufferView;
}

export interface EmailBinding {
  send(input: {
    to: string | string[];
    from: { email: string; name?: string } | string;
    replyTo?: string;
    subject: string;
    html: string;
    text: string;
    headers?: Record<string, string>;
    attachments?: EmailAttachment[];
  }): Promise<{ messageId?: string } | void>;
}

export interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  EMAIL_QUEUE: Queue<SendJob>;
  EMAIL: EmailBinding;
  ASSETS: Fetcher;
  APP_NAME: string;
  APP_URL: string;
  FROM_EMAIL: string;
  FROM_NAME: string;
  TURNSTILE_SITE_KEY: string;
  TURNSTILE_SECRET_KEY: string;
  AUTH_PEPPER: string;
  DATA_ENCRYPTION_KEY: string;
  PAYPAL_CLIENT_ID: string;
  PAYPAL_CLIENT_SECRET: string;
  PAYPAL_MODE: 'sandbox' | 'live';
  PAYPAL_RECEIVER_EMAIL: string;
  ADMIN_EMAILS: string;
  PRICE_PER_1000_USD: string;
  MIN_PURCHASE_THOUSANDS: string;
}

export interface AuthContext {
  sessionId: string;
  userId: string;
  email: string;
  workspaceId: string;
  role: 'owner' | 'admin' | 'editor' | 'viewer';
  isPlatformAdmin: boolean;
}

export interface CampaignRow {
  id: string;
  workspace_id: string;
  name: string;
  subject: string;
  from_name: string;
  from_email: string;
  reply_to: string | null;
  html_body: string;
  text_body: string;
  status: string;
  scheduled_at: string | null;
  recipient_count: number;
  sent_count: number;
  failed_count: number;
}

export interface ContactRow {
  id: string;
  workspace_id: string;
  email_ciphertext: string;
  email_iv: string;
  email_hash: string;
  first_name: string | null;
  last_name: string | null;
  metadata_json: string;
  status: string;
}
