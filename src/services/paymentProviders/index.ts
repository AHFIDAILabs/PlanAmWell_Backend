// services/paymentProviders/index.ts
//
// Factory for the active PaymentProvider, chosen by PAYMENT_PROVIDER. No
// concrete provider is implemented yet — this throws a clear, loud error
// until one is wired in and real (at minimum sandbox) credentials exist in
// the environment, rather than silently pretending payments work.

import { PaymentProvider } from "./types";

export function getPaymentProvider(): PaymentProvider {
  const provider = process.env.PAYMENT_PROVIDER;

  switch (provider) {
    // case "paystack":
    //   return new PaystackProvider();
    // case "flutterwave":
    //   return new FlutterwaveProvider();
    default:
      throw new Error(
        `No payment provider configured. Set PAYMENT_PROVIDER to a supported value ` +
          `(e.g. "paystack") and implement its PaymentProvider class in ` +
          `backend/src/services/paymentProviders/ once real credentials are available.`
      );
  }
}
