// services/paymentProviders/types.ts
//
// The one seam between "how PlanAmWell books a consultation" and "which
// payment processor actually moves the money." A concrete implementation
// (Paystack, Flutterwave, ...) lives behind this interface so switching
// providers later — or supporting more than one — never touches the
// booking/appointment code, only this directory.

export interface InitializePaymentParams {
  amountKobo: number;
  email: string;
  reference: string;
  callbackUrl: string;
}

export interface InitializePaymentResult {
  authorizationUrl: string;
}

export interface WebhookPaymentEvent {
  reference: string;
  status: "success" | "failed";
  amountKobo: number;
}

export interface PaymentProvider {
  readonly name: string;

  initialize(params: InitializePaymentParams): Promise<InitializePaymentResult>;

  /** Verifies the webhook actually came from the provider, not a forged request. */
  verifyWebhookSignature(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): boolean;

  /** Returns null if the payload isn't an event this integration cares about. */
  parseWebhookEvent(rawBody: Buffer): WebhookPaymentEvent | null;
}
