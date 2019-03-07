'use strict';

var utils = require('./../utils');
var settle = require('./../core/settle');
var buildURL = require('./../helpers/buildURL');
var isURLSameOrigin = require('./../helpers/isURLSameOrigin');
var createError = require('../core/createError');

function requestFetch(request, handleLoad, error) {
  return fetch(request)
    .then(function(response) {
      handleLoad(response);
    })
    .catch(function(e) {
      error(e);
    });
}

function requestTimeout(timeout) {
  return new Promise(function dispatchRequestTimeout(resolve, reject) {
    setTimeout(function() {
      reject();
    }, timeout);
  });
}

module.exports = function fetchAdapter(config) {
  return new Promise(function dispatchFetchRequest(resolve, reject) {
    var requestData = config.data;
    var requestHeaders = config.headers;

    if (utils.isFormData(requestData)) {
      delete requestHeaders['Content-Type']; // Let the browser set it
    }
    // HTTP basic authentication
    if (config.auth) {
      var username = config.auth.username || '';
      var password = config.auth.password || '';
      requestHeaders.Authorization = 'Basic ' + btoa(username + ':' + password);
    }

    // Add xsrf header
    // This is only done if running in a standard browser environment.
    // Specifically not if we're in a web worker, or react-native.
    if (utils.isStandardBrowserEnv()) {
      var cookies = require('./../helpers/cookies');

      // Add xsrf header
      var xsrfValue = (config.withCredentials || isURLSameOrigin(config.url)) && config.xsrfCookieName ? cookies.read(config.xsrfCookieName) : undefined;

      if (xsrfValue) {
        requestHeaders[config.xsrfHeaderName] = xsrfValue;
      }
    }

    var headers = new Headers();
    utils.forEach(requestHeaders, function setRequestHeader(val, key) {
      if (typeof requestData === 'undefined' && key.toLowerCase() === 'content-type') {
        // Remove Content-Type if data is undefined
        delete requestHeaders[key];
      } else {
        // Otherwise add header to the request
        headers.append(key, val);
      }
    });

    var options = {
      headers: headers,
      body: requestData,
      method: config.method.toUpperCase(),
      mode: config.mode,
      cache: config.cache,
      credentials: config.credentials,
      redirect: config.redirect, // manual, *follow, error
      referrer: config.referrer // *client, no-referrer
    };

    if (config.method.toUpperCase() === 'GET') {
      delete options.body;
    }

    var request = new Request(buildURL(config.url, config.params, config.paramsSerializer), options);

    // Handle timeout
    request.handleTimeout = function handleTimeout() {
      reject(createError('timeout of ' + config.timeout + 'ms exceeded', config, 'ECONNABORTED', request));

      // Clean up request
      request = null;
    };

    // Handle low level network errors
    request.handleError = function handleError(e) {
      // Real errors are hidden from us by the browser
      // onerror should only fire if it's a network error
      reject(createError('Network Error', config, null, request, e));

      // Clean up request
      request = null;
    };

    request.handleLoad = function(response) {
      var rep = {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        config: config,
        request: request
      };
      response
        .clone()
        .json()
        .then(function dispatchRequestJSON(data) {
          if (data.hasError) {
            reject(createError('JSON Error', config, response.status, request, response));
          } else {
            rep.data = data;
            settle(resolve, reject, rep);
          }
          // Clean up request
          request = null;
        })
        .catch(() => {
          rep.data = {
            code: response.status,
            message: response.statusText
          };
          settle(resolve, reject, rep);
          // Clean up request
          request = null;
        });
    };

    // Handle progress if needed
    if (typeof config.onDownloadProgress === 'function') {
      request.addEventListener('progress', config.onDownloadProgress);
    }

    // Not all browsers support upload events
    if (typeof config.onUploadProgress === 'function' && request.upload) {
      request.upload.addEventListener('progress', config.onUploadProgress);
    }

    request.timeout = config.timeout;

    if (request.timeout) {
      return Promise.race([requestFetch(request, request.handleLoad, request.handleError), requestTimeout(config.timeout, request.handleTimeout)]).catch(request.handleTimeout);
    }
    return requestFetch(request, request.handleLoad, request.handleError);

    // Set the request timeout in MS

    // Listen for ready state
  });
};
