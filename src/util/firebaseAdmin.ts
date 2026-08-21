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

function getApp(): admin.app.App | null {
  if (app) return app;
  if (initAttempted) return null;
  initAttempted = true;

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) {
    console.warn(
      "[FirebaseAdmin] FIREBASE_SERVICE_ACCOUNT env var not set — raw FCM call-ringing pushes are disabled (Expo push still sends)."
    );
    return null;
  }

  try {
    const serviceAccount = JSON.parse(raw);
    app = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    console.log("[FirebaseAdmin] Initialized");
    return app;
  } catch (err: any) {
    console.error("[FirebaseAdmin] Failed to initialize — check FIREBASE_SERVICE_ACCOUNT is valid JSON:", err.message);
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
