// util/firebaseAdmin.ts
// Raw Firebase Cloud Messaging (separate from Expo's push relay used
// elsewhere in this codebase). Expo-relayed pushes never reach
// @react-native-firebase/messaging's setBackgroundMessageHandler/onMessage
// on the client, which is what the notifee incoming-call UI is wired to —
// so waking that handler when the app is backgrounded/killed requires
// sending a data-only message directly through firebase-admin instead.
import admin from "firebase-admin";

let app: admin.app.App | null = null;
let initAttempted = false;

// Preferred: three separate single-line env vars — pasting one JSON blob
// with embedded newlines into a dashboard's env var field is easy to get
// wrong (a trimmed line, a stripped quote), and there's no good way to tell
// from the resulting error. Falls back to the single FIREBASE_SERVICE_ACCOUNT
// JSON blob for anyone who already has that set.
function buildServiceAccount(): admin.ServiceAccount | null {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const rawPrivateKey = process.env.FIREBASE_PRIVATE_KEY;

  if (projectId && clientEmail && rawPrivateKey) {
    // Env var UIs commonly store a pasted PEM key's real line breaks as the
    // literal two characters "\" + "n" rather than an actual newline —
    // Firebase's key parser requires real newlines, so convert them back.
    const privateKey = rawPrivateKey.includes("\\n") ? rawPrivateKey.replace(/\\n/g, "\n") : rawPrivateKey;
    return { projectId, clientEmail, privateKey };
  }

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (raw) {
    const parsed = JSON.parse(raw);
    return {
      projectId: parsed.project_id,
      clientEmail: parsed.client_email,
      privateKey: parsed.private_key,
    };
  }

  return null;
}

function getApp(): admin.app.App | null {
  if (app) return app;
  if (initAttempted) return null;
  initAttempted = true;

  let serviceAccount: admin.ServiceAccount | null;
  try {
    serviceAccount = buildServiceAccount();
  } catch (err: any) {
    console.error("[FirebaseAdmin] Failed to parse FIREBASE_SERVICE_ACCOUNT — check it's valid JSON:", err.message);
    return null;
  }

  if (!serviceAccount) {
    console.warn(
      "[FirebaseAdmin] No Firebase credentials set (FIREBASE_PROJECT_ID/FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY, or FIREBASE_SERVICE_ACCOUNT) — raw FCM call-ringing pushes are disabled (Expo push still sends)."
    );
    return null;
  }

  try {
    app = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    console.log("[FirebaseAdmin] Initialized");
    return app;
  } catch (err: any) {
    console.error("[FirebaseAdmin] Failed to initialize:", err.message);
    return null;
  }
}

/**
 * Sends a data-only FCM message (no `notification` block) to each token so
 * the client's background/foreground message handlers always run instead of
 * the OS auto-displaying a tray notification. All values must be strings —
 * FCM data payloads don't allow other types.
 */
export async function sendFcmDataMessages(
  tokens: string[],
  data: Record<string, string>
): Promise<void> {
  const firebaseApp = getApp();
  if (!firebaseApp || !tokens.length) return;

  const messaging = firebaseApp.messaging();

  await Promise.all(
    tokens.map(async (token) => {
      try {
        await messaging.send({
          token,
          data,
          android: {
            priority: "high",
          },
        });
      } catch (err: any) {
        console.warn(`[FirebaseAdmin] Failed to send to token ${token.slice(0, 12)}...:`, err.message);
      }
    })
  );
}
