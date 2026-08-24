import { ClientSecretCredential } from "@azure/identity";

const GRAPH_SCOPE = "https://graph.microsoft.com/.default";

let cachedCredential: ClientSecretCredential | null = null;

function getCredential(): ClientSecretCredential {
  if (!cachedCredential) {
    cachedCredential = new ClientSecretCredential(
      process.env.MS_TENANT_ID!,
      process.env.MS_CLIENT_ID!,
      process.env.MS_CLIENT_SECRET!
    );
  }
  return cachedCredential;
}

function isGraphConfigured(): boolean {
  return !!(process.env.MS_TENANT_ID && process.env.MS_CLIENT_ID && process.env.MS_CLIENT_SECRET && process.env.MS_SENDER_EMAIL);
}

// Sends mail as MS_SENDER_EMAIL via Microsoft Graph app-only auth (client
// credentials flow, requires an admin-consented Mail.Send application
// permission on the app registration — see .env.example).
export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
  if (!isGraphConfigured()) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET and MS_SENDER_EMAIL must be set to send email.");
    }
    // Local dev without Graph credentials configured — don't block the flow,
    // just surface the link that would have been emailed.
    console.log(`📧 (no Microsoft Graph credentials configured) Password reset link for ${to}: ${resetUrl}`);
    return;
  }

  const sender = process.env.MS_SENDER_EMAIL!;
  const token = await getCredential().getToken(GRAPH_SCOPE);
  if (!token) {
    throw new Error("Could not acquire a Microsoft Graph access token.");
  }

  const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: {
        subject: "Reset your PlanAmWell password",
        body: {
          contentType: "HTML",
          content: `
            <p>We received a request to reset your PlanAmWell password.</p>
            <p><a href="${resetUrl}">Reset your password</a> (this link expires in 1 hour)</p>
            <p>If you didn't request this, you can safely ignore this email.</p>
          `,
        },
        toRecipients: [{ emailAddress: { address: to } }],
      },
      saveToSentItems: false,
    }),
  });

  if (!res.ok) {
    const errorBody = await res.text().catch(() => "");
    console.error("Microsoft Graph sendMail failed:", res.status, errorBody);
    throw new Error("Could not send the password reset email.");
  }
}
