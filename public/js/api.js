/* Shared API client + session storage for every PortoHR page. */
(function (window) {
  'use strict';

  var TOKEN_KEY = 'portohr.token';
  var USER_KEY = 'portohr.user';

  var session = {
    getToken: function () {
      return window.localStorage.getItem(TOKEN_KEY);
    },
    getUser: function () {
      try {
        return JSON.parse(window.localStorage.getItem(USER_KEY));
      } catch (err) {
        return null;
      }
    },
    save: function (token, user) {
      window.localStorage.setItem(TOKEN_KEY, token);
      window.localStorage.setItem(USER_KEY, JSON.stringify(user));
    },
    clear: function () {
      window.localStorage.removeItem(TOKEN_KEY);
      window.localStorage.removeItem(USER_KEY);
    },
    isAuthenticated: function () {
      return Boolean(session.getToken());
    },
  };

  function ApiError(message, status, details) {
    this.name = 'ApiError';
    this.message = message;
    this.status = status;
    this.details = details;
  }
  ApiError.prototype = Object.create(Error.prototype);

  async function request(path, options) {
    var opts = options || {};
    var headers = Object.assign({}, opts.headers);
    var token = session.getToken();

    if (token) headers.Authorization = 'Bearer ' + token;
    if (opts.body !== undefined && typeof opts.body !== 'string') {
      headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(opts.body);
    }

    var response = await fetch('/api' + path, Object.assign({}, opts, { headers: headers }));
    var payload = null;
    try {
      payload = await response.json();
    } catch (err) {
      /* endpoint returned no body */
    }

    if (!response.ok) {
      // An expired or revoked token should always drop the user back to login.
      if (response.status === 401 && !opts.skipAuthRedirect) {
        session.clear();
        window.location.replace('/index.html');
      }
      throw new ApiError(
        (payload && payload.message) || 'Request failed (' + response.status + ')',
        response.status,
        payload && payload.details
      );
    }

    return payload;
  }

  window.PortoHR = window.PortoHR || {};
  window.PortoHR.session = session;
  window.PortoHR.ApiError = ApiError;
  window.PortoHR.api = {
    request: request,
    get: function (path, opts) {
      return request(path, Object.assign({ method: 'GET' }, opts));
    },
    post: function (path, body, opts) {
      return request(path, Object.assign({ method: 'POST', body: body }, opts));
    },
    /** Sends a File as the raw request body (used for personnel-file attachments). */
    upload: async function (path, file) {
      var response = await fetch('/api' + path, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + session.getToken(),
          'Content-Type': file.type || 'application/octet-stream',
          'X-Filename': encodeURIComponent(file.name),
        },
        body: file,
      });
      var payload = null;
      try { payload = await response.json(); } catch (err) { /* no body */ }
      if (!response.ok) {
        if (response.status === 401) { session.clear(); window.location.replace('/index.html'); }
        throw new ApiError((payload && payload.message) || 'Upload failed (' + response.status + ')', response.status);
      }
      return payload;
    },
    /** Fetches a protected file with the session token and saves it to disk. */
    download: async function (path, fallbackName) {
      var response = await fetch('/api' + path, { headers: { Authorization: 'Bearer ' + session.getToken() } });
      if (!response.ok) {
        var payload = null;
        try { payload = await response.json(); } catch (err) { /* no body */ }
        if (response.status === 401) { session.clear(); window.location.replace('/index.html'); }
        throw new ApiError((payload && payload.message) || 'Download failed (' + response.status + ')', response.status);
      }
      var name = fallbackName || 'download';
      var disposition = response.headers.get('Content-Disposition') || '';
      var match = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
      if (match) { try { name = decodeURIComponent(match[1]); } catch (err) { /* keep fallback */ } }
      var blob = await response.blob();
      var link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(function () { URL.revokeObjectURL(link.href); }, 1000);
    },
    login: function (email, password) {
      return request('/auth', {
        method: 'POST',
        body: { email: email, password: password },
        skipAuthRedirect: true,
      });
    },
    me: function () {
      return request('/auth/me', { method: 'GET' });
    },
    logout: function () {
      return request('/auth/logout', { method: 'POST' }).catch(function () {
        /* token already invalid server-side; clearing locally is enough */
      });
    },
  };
})(window);
