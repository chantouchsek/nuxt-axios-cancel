import axios from 'axios'
import { isPlainObject } from 'is-plain-object'

function createRequestKey(url, params) {
  return params ? `${url}:${createStringFromParameters(params)}` : url;
}

function createStringFromParameters(obj) {
  const parts = [];
  for (const key in obj) {
    parts.push(key);
    if (isPlainObject(obj[key])) parts.push(createStringFromParameters(obj[key]));
  }
  return parts.join('|');
}

function createCancelMessage(requestKey, paramsStr) {
  return {
    statusCode: 100,
    requestKey: requestKey,
    message: `Request canceled: ${requestKey}`,
    paramsStr: paramsStr
  }
}

export default function ({ $axios, app }) {
  $axios.activeRequests = {};
  $axios.onRequest((config) => {
    let blockerConfigContainer = config
    <% if (options.headerBlockerKey) { %>
      if (config.headers.hasOwnProperty('<%= options.headerBlockerKey %>')) {
        blockerConfigContainer = config.headers['<%= options.headerBlockerKey %>'];
        delete config.headers['<%= options.headerBlockerKey %>'];
      }
    <% } %>

    let requestBlockingAllowed = blockerConfigContainer.blockAllowed;
    if (requestBlockingAllowed === undefined) {
      requestBlockingAllowed = <%= options.blockByDefault %>;
    }
    if (!requestBlockingAllowed) return config;

    let { requestKey } = blockerConfigContainer;
    if (!requestKey) requestKey = createRequestKey(config.baseURL + config.url, config.params);
    const paramsStr = JSON.stringify(config.params);
    if ($axios.activeRequests.hasOwnProperty(requestKey) && $axios.activeRequests[requestKey].cancelToken) {
      $axios.activeRequests[requestKey].cancelToken.cancel(createCancelMessage(requestKey, paramsStr));
    }
    if (!$axios.activeRequests.hasOwnProperty(requestKey)) {
      let reqResolve, reqReject;
      const promise = new Promise((resolve, reject) => {
        reqResolve = resolve;
        reqReject = reject;
      });
      $axios.activeRequests[requestKey] = {
        promise: promise,
        resolve: reqResolve,
        reject: reqReject
      }
    }
    $axios.activeRequests[requestKey].paramsStr = paramsStr;
    const cancelToken = axios.CancelToken.source();
    $axios.activeRequests[requestKey].cancelToken = cancelToken;
    return {
      ...config,
      cancelToken: cancelToken && cancelToken.token
    };
  });

  $axios.onError((err) => {
    if (err.hasOwnProperty('message') && err.message.hasOwnProperty('requestKey') && $axios.activeRequests.hasOwnProperty(err.message.requestKey)) {
      const currentRequest = $axios.activeRequests[err.message.requestKey];
      if (err.message && err.message.statusCode === 100 && currentRequest && currentRequest.paramsStr === err.message.paramsStr) {
        <% if (options.debug) { %>
          console.warn(err.message.message);
        <% } %>
        return $axios.activeRequests[err.message.requestKey].promise;
      }
    }
    return Promise.reject(err);
  });

  $axios.onResponse((response) => {
    let { requestKey } = response.config;
    if (!requestKey) requestKey = createRequestKey(response.config.baseURL + response.config.url, response.config.params);
    if ($axios.activeRequests.hasOwnProperty(requestKey)) {
      $axios.activeRequests[requestKey].resolve(response);
      delete $axios.activeRequests[requestKey];
    }
  });

  <% if (options.onPageChange) { %>
    app.router.beforeEach((to, from, next) => {
      for (const requestKey in $axios.activeRequests) {
        $axios.activeRequests[requestKey].cancelToken.cancel(createCancelMessage(requestKey));
        delete $axios.activeRequests[requestKey];
      }
      next();
    });
  <% } %>
}
