import { Router } from "express";

const legalRouter = Router();

const APP_NAME = "PlanAmWell";
const COMPANY_NAME = "PlanAmWell Ltd.";
const LAST_UPDATED = "January 1, 2025";
const PRIVACY_EMAIL = "privacy@planamwell.com";
const LEGAL_EMAIL = "legal@planamwell.com";

// Shared page chrome — kept dependency-free (no CSS/JS files to serve) so a
// single Express route can render a complete, readable page on its own.
const pageShell = (title: string, bodyHtml: string) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title} — ${APP_NAME}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: #F7F8F6; color: #14201B;
    font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    line-height: 1.6;
  }
  .wrap { max-width: 680px; margin: 0 auto; padding: 40px 20px 80px; }
  h1 { font-size: 26px; font-weight: 800; margin: 0 0 4px; letter-spacing: -0.01em; }
  h2 { font-size: 17px; font-weight: 700; margin: 28px 0 8px; }
  p { margin: 0 0 10px; color: #3A453E; }
  .updated { font-size: 13px; color: #6B756E; font-style: italic; margin-bottom: 20px; }
  ul { margin: 0 0 10px; padding-left: 20px; color: #3A453E; }
  li { margin-bottom: 6px; }
  a { color: #0B5D52; }
  .brand { font-size: 12px; text-transform: uppercase; letter-spacing: 0.1em; color: #0B5D52; font-weight: 700; margin-bottom: 10px; }
  form { background: #fff; border: 1px solid #D8DBD1; border-radius: 12px; padding: 20px; margin-top: 8px; }
  label { display: block; font-size: 13px; font-weight: 600; margin: 12px 0 4px; }
  input { width: 100%; padding: 10px 12px; border: 1px solid #D8DBD1; border-radius: 8px; font-size: 15px; }
  button { margin-top: 18px; width: 100%; padding: 12px; border: none; border-radius: 8px; background: #B3261E; color: #fff; font-weight: 700; font-size: 15px; cursor: pointer; }
  button:disabled { opacity: 0.6; cursor: default; }
  button.secondary { background: #E7EAE2; color: #14201B; }
  .msg { margin-top: 14px; padding: 10px 12px; border-radius: 8px; font-size: 14px; display: none; }
  .msg.error { display: block; background: #FBEAE8; color: #7A1B15; }
  .msg.success { display: block; background: #E1F3E7; color: #145530; }
  .warn { background: #FBF0D9; color: #6B4600; border-radius: 8px; padding: 12px 14px; font-size: 14px; margin-bottom: 8px; }
</style>
</head>
<body>
  <div class="wrap">
    <div class="brand">${APP_NAME}</div>
    ${bodyHtml}
  </div>
</body>
</html>`;

legalRouter.get("/privacy-policy", (_req, res) => {
  res.send(pageShell("Privacy Policy", `
    <h1>Privacy Policy</h1>
    <div class="updated">Last updated: ${LAST_UPDATED}</div>

    <p>${COMPANY_NAME} ("we", "us", or "our") is committed to protecting your privacy. This
    Privacy Policy explains how we collect, use, disclose, and safeguard your information
    when you use the ${APP_NAME} mobile application.</p>

    <h2>1. Information We Collect</h2>
    <p>We collect information that you provide directly to us, including:</p>
    <ul>
      <li>Account registration details (name, email address, password)</li>
      <li>Profile information (profile photo, date of birth, gender)</li>
      <li>Medical and health information you voluntarily share with doctors</li>
      <li>Payment and order information for supplement purchases</li>
      <li>Communications with healthcare professionals on our platform</li>
      <li>Device information (push notification tokens, device type, OS version)</li>
      <li>Location data (city, state, LGA for delivery purposes — only when provided)</li>
    </ul>

    <h2>2. How We Use Your Information</h2>
    <p>We use the information we collect to:</p>
    <ul>
      <li>Provide, operate, and maintain the ${APP_NAME} platform</li>
      <li>Connect you with qualified healthcare professionals</li>
      <li>Process supplement orders and arrange delivery</li>
      <li>Send appointment confirmations, reminders, and health notifications</li>
      <li>Improve user experience and platform features</li>
      <li>Comply with legal obligations and enforce our Terms of Service</li>
      <li>Respond to your comments, questions, and requests</li>
    </ul>

    <h2>3. Medical Information</h2>
    <p>Any health or medical information you share with doctors on ${APP_NAME} is treated with
    the highest level of confidentiality. Consultation records are accessible only to you
    and your treating doctor. We do not sell, rent, or share medical information with
    third parties except as required by law.</p>

    <h2>4. Information Sharing</h2>
    <p>We do not sell your personal information. We may share your data with:</p>
    <ul>
      <li>Healthcare providers you choose to consult with on our platform</li>
      <li>Delivery partners (name, address, phone number) solely to fulfill orders</li>
      <li>Service providers that help us operate our platform (cloud hosting, analytics) under strict confidentiality agreements</li>
      <li>Law enforcement or regulatory authorities when required by applicable law</li>
    </ul>

    <h2>5. Data Security</h2>
    <p>We implement industry-standard security measures to protect your personal information,
    including encryption of data in transit (TLS/HTTPS), secure password hashing, and
    access controls. However, no method of transmission over the internet is 100% secure.</p>

    <h2>6. Your Rights</h2>
    <p>You have the right to:</p>
    <ul>
      <li>Access the personal information we hold about you</li>
      <li>Request correction of inaccurate or incomplete data</li>
      <li>Request deletion of your account and personal data — in-app via Settings → Privacy Settings → Delete My Account, or from the web at <a href="/delete-account">/delete-account</a></li>
      <li>Withdraw consent for non-essential data processing at any time</li>
      <li>Receive a copy of your personal data in a portable format</li>
    </ul>

    <h2>7. Cookies and Tracking</h2>
    <p>${APP_NAME} is a mobile application and does not use browser cookies. We may use
    analytics tools to understand how users interact with the app. These tools collect
    anonymised usage data to help us improve the platform.</p>

    <h2>8. Children's Privacy</h2>
    <p>${APP_NAME} is not directed to individuals under the age of 18. We do not knowingly
    collect personal information from children. If you believe we have inadvertently
    collected such information, please contact us immediately.</p>

    <h2>9. Changes to This Policy</h2>
    <p>We may update this Privacy Policy from time to time. We will notify you of any
    significant changes via the app or email. Your continued use of ${APP_NAME} after
    changes constitutes your acceptance of the updated policy.</p>

    <h2>10. Contact Us</h2>
    <p>If you have questions about this Privacy Policy or wish to exercise your data rights,
    please contact our privacy team at <a href="mailto:${PRIVACY_EMAIL}">${PRIVACY_EMAIL}</a>.</p>
    <p>${COMPANY_NAME}</p>
  `));
});

legalRouter.get("/terms-of-service", (_req, res) => {
  res.send(pageShell("Terms of Service", `
    <h1>Terms of Service</h1>
    <div class="updated">Last updated: ${LAST_UPDATED}</div>

    <p>Please read these Terms of Service carefully before using ${APP_NAME}. By accessing or
    using our platform, you agree to be bound by these terms. If you do not agree, please
    do not use ${APP_NAME}.</p>

    <h2>1. Acceptance of Terms</h2>
    <p>By creating an account or using ${APP_NAME} in any way, you confirm that you are at
    least 18 years of age and have the legal capacity to enter into this agreement with
    ${COMPANY_NAME}.</p>

    <h2>2. Description of Service</h2>
    <p>${APP_NAME} is a digital health platform that connects users with licensed healthcare
    professionals for remote consultations. We also provide access to health advocacy
    content and an integrated health supplement marketplace.</p>
    <p>${APP_NAME} is NOT an emergency medical service. In case of a medical emergency,
    please call your local emergency services immediately.</p>

    <h2>3. Medical Disclaimer</h2>
    <p>Consultations on ${APP_NAME} are for informational and general healthcare advisory
    purposes only. They do not constitute a doctor-patient relationship in the traditional
    sense and are not a substitute for in-person medical care. Always seek in-person
    medical attention for serious or life-threatening conditions.</p>
    <p>${COMPANY_NAME} is not liable for any medical decisions made based on advice received
    through the platform.</p>

    <h2>4. User Responsibilities</h2>
    <p>As a user of ${APP_NAME}, you agree to:</p>
    <ul>
      <li>Provide accurate and complete registration information</li>
      <li>Maintain the confidentiality of your account credentials</li>
      <li>Use the platform only for lawful purposes</li>
      <li>Not impersonate any person or entity</li>
      <li>Not submit false, misleading, or fraudulent health information</li>
      <li>Treat healthcare professionals and other users with respect</li>
      <li>Not attempt to reverse-engineer, hack, or misuse the platform</li>
    </ul>

    <h2>5. Doctor Verification</h2>
    <p>All doctors on ${APP_NAME} undergo a verification process that includes review of
    medical licence credentials. However, ${COMPANY_NAME} does not guarantee the accuracy
    of a doctor's credentials beyond the information submitted during registration.
    Users should exercise their own judgement when engaging with any healthcare
    professional.</p>

    <h2>6. Appointments and Consultations</h2>
    <p>Booking an appointment is subject to doctor availability. Cancellations should be
    made at least 2 hours before a scheduled consultation. Repeated no-shows may result
    in account restrictions.</p>

    <h2>7. Payments and Refunds</h2>
    <p>Consultation fees are displayed before booking and charged at the time of payment.
    Refunds may be issued at ${COMPANY_NAME}'s sole discretion in cases of technical
    failure or where a consultation did not take place due to a doctor's failure to
    attend.</p>
    <p>Supplement purchases are processed by our partner pharmacy. Returns and refunds for
    supplements are subject to the partner's refund policy.</p>

    <h2>8. Intellectual Property</h2>
    <p>All content on ${APP_NAME}, including text, graphics, logos, and software, is the
    property of ${COMPANY_NAME} or its content suppliers and is protected by applicable
    intellectual property laws.</p>

    <h2>9. Privacy</h2>
    <p>Your use of ${APP_NAME} is also governed by our <a href="/privacy-policy">Privacy Policy</a>,
    which is incorporated into these Terms by reference.</p>

    <h2>10. Termination</h2>
    <p>We reserve the right to suspend or terminate your account at any time for violation
    of these Terms or for any other reason at our sole discretion. You may also delete
    your account at any time — in-app via Settings → Privacy Settings → Delete My Account,
    or from the web at <a href="/delete-account">/delete-account</a>.</p>

    <h2>11. Limitation of Liability</h2>
    <p>To the fullest extent permitted by law, ${COMPANY_NAME} shall not be liable for any
    indirect, incidental, special, consequential, or punitive damages arising from your
    use of ${APP_NAME}.</p>

    <h2>12. Changes to Terms</h2>
    <p>We may update these Terms of Service at any time. We will notify you of material
    changes via the app or email. Continued use of ${APP_NAME} after changes constitutes
    acceptance of the updated Terms.</p>

    <h2>13. Governing Law</h2>
    <p>These Terms are governed by the laws of the Federal Republic of Nigeria. Any disputes
    arising from these Terms shall be subject to the exclusive jurisdiction of Nigerian
    courts.</p>

    <h2>14. Contact</h2>
    <p>For legal enquiries, please contact us at <a href="mailto:${LEGAL_EMAIL}">${LEGAL_EMAIL}</a>.</p>
    <p>${COMPANY_NAME}</p>
  `));
});

legalRouter.get("/delete-account", (_req, res) => {
  res.send(pageShell("Delete Account", `
    <h1>Delete your ${APP_NAME} account</h1>
    <div class="updated">No app install required</div>

    <div class="warn">
      This permanently deletes your account, profile, and personal data from
      ${APP_NAME}. Appointment and order records tied to your account may be
      retained only where required for legal, medical-record, or accounting
      obligations. This cannot be undone.
    </div>

    <p>Enter the email and password for your ${APP_NAME} account (patient or doctor)
    to confirm and delete it.</p>

    <form id="deleteForm">
      <label for="email">Email</label>
      <input id="email" name="email" type="email" required autocomplete="username" />

      <label for="password">Password</label>
      <input id="password" name="password" type="password" required autocomplete="current-password" />

      <button type="submit" id="submitBtn">Delete my account</button>
      <div id="msg" class="msg"></div>
    </form>

    <p style="margin-top:20px;font-size:13px;">
      Signed up with Google or Apple and have no password? Email
      <a href="mailto:${PRIVACY_EMAIL}">${PRIVACY_EMAIL}</a> from your registered
      address and we'll process the deletion within a reasonable time.
    </p>

    <script src="/delete-account.js"></script>
  `));
});

// Served as a same-origin external file (not an inline <script>) so it runs
// under helmet's default Content-Security-Policy (script-src 'self'), which
// blocks inline scripts without a nonce.
legalRouter.get("/delete-account.js", (_req, res) => {
  res.type("application/javascript").send(`
    const form = document.getElementById('deleteForm');
    const btn = document.getElementById('submitBtn');
    const msg = document.getElementById('msg');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      msg.className = 'msg';
      msg.textContent = '';

      const email = document.getElementById('email').value.trim();
      const password = document.getElementById('password').value;

      if (!confirm('This permanently deletes your account and data. Continue?')) return;

      btn.disabled = true;
      btn.textContent = 'Deleting…';

      try {
        const res = await fetch('/api/v1/auth/delete-by-credentials', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        });
        const data = await res.json().catch(() => ({}));

        if (res.ok && data.success) {
          msg.className = 'msg success';
          msg.textContent = 'Your account has been deleted.';
          form.reset();
          btn.remove();
        } else {
          msg.className = 'msg error';
          msg.textContent = data.message || 'Could not delete account. Check your email and password.';
        }
      } catch (err) {
        msg.className = 'msg error';
        msg.textContent = 'Network error. Please try again.';
      } finally {
        if (document.body.contains(btn)) {
          btn.disabled = false;
          btn.textContent = 'Delete my account';
        }
      }
    });
  `);
});

export default legalRouter;
