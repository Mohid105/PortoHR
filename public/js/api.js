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
