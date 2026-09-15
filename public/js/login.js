/* Login screen: posts to /api/auth and stores the JWT in localStorage. */
(function (window, document) {
  'use strict';

  var api = window.PortoHR.api;
  var session = window.PortoHR.session;

  var form = document.getElementById('login-form');
  var emailInput = document.getElementById('email');
  var passwordInput = document.getElementById('password');
  var submitButton = document.getElementById('login-submit');
  var submitText = document.getElementById('login-submit-text');
  var spinner = document.getElementById('login-spinner');
  var errorBox = document.getElementById('login-error');
  var errorText = document.getElementById('login-error-text');

  var yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  if (session.isAuthenticated()) {
    window.location.replace('/dashboard.html');
    return;
  }

  function showError(message) {
    errorText.textContent = message;
    errorBox.classList.remove('hidden');
    errorBox.classList.add('flex');
  }

  function clearError() {
    errorBox.classList.add('hidden');
    errorBox.classList.remove('flex');
  }

  function setLoading(loading) {
    submitButton.disabled = loading;
    spinner.classList.toggle('hidden', !loading);
    submitText.textContent = loading ? 'Signing in…' : 'Sign in';
  }

  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    clearError();

    var email = emailInput.value.trim();
    var password = passwordInput.value;

    if (!email || !password) {
      showError('Please enter both your email and password.');
      return;
    }

    setLoading(true);
    try {
      var result = await api.login(email, password);
      session.save(result.token, result.user);
      window.location.assign('/dashboard.html');
    } catch (err) {
      showError(err.message || 'Unable to sign in right now.');
      passwordInput.value = '';
      passwordInput.focus();
      setLoading(false);
    }
  });

  document.getElementById('toggle-password').addEventListener('click', function () {
    var hidden = passwordInput.type === 'password';
    passwordInput.type = hidden ? 'text' : 'password';
    this.textContent = hidden ? 'Hide' : 'Show';
  });

  document.querySelectorAll('[data-demo-email]').forEach(function (button) {
    button.addEventListener('click', function () {
      emailInput.value = button.getAttribute('data-demo-email');
      passwordInput.value = 'Portohr@123';
      passwordInput.focus();
    });
  });
})(window, document);
