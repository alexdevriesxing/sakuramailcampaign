import { $, api, config, setMessage } from './shared.js';

export async function initLogin() {
  const startForm = $('#login-start-form');
  if (!startForm) return;
  const verifyForm = $('#login-verify-form');
  const message = $('#auth-message');
  let pendingEmail = '';

  const script = document.createElement('script');
  script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
  script.async = true;
  script.onload = () => window.turnstile?.render('#turnstile-box', { sitekey: config.turnstileSiteKey, theme: 'light', action: 'login' });
  document.head.append(script);

  startForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = $('button[type="submit"]', startForm);
    button.disabled = true;
    setMessage(message, 'Sending your code…');
    try {
      const data = new FormData(startForm);
      pendingEmail = String(data.get('email') || '').trim();
      const turnstileToken = String(data.get('cf-turnstile-response') || '');
      await api('/api/auth/start', { method: 'POST', body: JSON.stringify({ email: pendingEmail, turnstileToken }) });
      startForm.hidden = true;
      verifyForm.hidden = false;
      setMessage(message, `A code was sent to ${pendingEmail}.`, 'success');
      $('input[name="code"]', verifyForm)?.focus();
    } catch (error) {
      setMessage(message, error.message, 'error');
      window.turnstile?.reset();
    } finally {
      button.disabled = false;
    }
  });

  verifyForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = $('button[type="submit"]', verifyForm);
    button.disabled = true;
    setMessage(message, 'Verifying…');
    try {
      const code = String(new FormData(verifyForm).get('code') || '');
      await api('/api/auth/verify', { method: 'POST', body: JSON.stringify({ email: pendingEmail, code }) });
      window.location.assign('/app');
    } catch (error) {
      setMessage(message, error.message, 'error');
      button.disabled = false;
    }
  });

  $('#restart-login')?.addEventListener('click', () => {
    pendingEmail = '';
    verifyForm.hidden = true;
    startForm.hidden = false;
    startForm.reset();
    verifyForm.reset();
    window.turnstile?.reset();
    setMessage(message, '');
  });
}
