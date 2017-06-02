
/**
 * Module dependencies.
 */

require('./patch-core');
var extend = require('extend');
var inherits = require('util').inherits;
var EventEmitter = require('events').EventEmitter;

/**
 * Module exports.
 */

module.exports = Agent;

/**
 * Base `http.Agent` implementation.
 * No pooling/keep-alive is implemented by default.
 *
 * @param {Function} callback
 * @api public
 */

function Agent (callback, _opts) {
  if (!(this instanceof Agent)) {
    return new Agent(callback, opts);
  }

  EventEmitter.call(this);

  var opts = _opts;
  if ('function' === typeof callback) {
    this.callback = callback;
  } else if (callback) {
    opts = callback;
  }

  // timeout for the socket to be returned from the callback
  this.timeout = opts && opts.timeout || null
}
inherits(Agent, EventEmitter);

Agent.prototype.callback = function callback (req, opts, fn) {
  fn(new Error('"agent-base" has no default implementation, you must subclass and override `callback()`'));
};

/**
 * Called by node-core's "_http_client.js" module when creating
 * a new HTTP request with this Agent instance.
 *
 * @api public
 */

Agent.prototype.addRequest = function addRequest (req, host, port, localAddress) {
  var opts;
  if ('object' == typeof host) {
    // >= v0.11.x API
    opts = extend({}, req._options, host);
  } else {
    // <= v0.10.x API
    opts = extend({}, req._options, { host: host, port: port });
    if (null != localAddress) {
      opts.localAddress = localAddress;
    }
  }

  if (opts.host && opts.path) {
    // if both a `host` and `path` are specified then it's most likely the
    // result of a `url.parse()` call... we need to remove the `path` portion so
    // that `net.connect()` doesn't attempt to open that as a unix socket file.
    delete opts.path;
  }

  // set default `port` if none was explicitly specified
  if (null == opts.port) {
    opts.port = opts.secureEndpoint ? 443 : 80;
  }

  delete opts.agent;
  delete opts.hostname;
  delete opts._defaultAgent;
  delete opts.defaultPort;
  delete opts.createConnection;

  // hint to use "Connection: close"
  // XXX: non-documented `http` module API :(
  req._last = true;
  req.shouldKeepAlive = false;

  // clean up a bit of memory since we're no longer using this
  req._options = null;

  // create the `stream.Duplex` instance
  var timeout;
  var timedOut = false;
  var timeoutMs = this.timeout;

  function onerror (err) {
    req.emit('error', err);
    // For Safety. Some additional errors might fire later on
    // and we need to make sure we don't double-fire the error event.
    req._hadError = true;
  }

  function ontimeout () {
    timedOut = true;
    var err = new Error('A "socket" was not created for HTTP request before ' + timeoutMs + 'ms');
    err.code = 'ETIMEOUT';
    onerror(err);
  }

  if (timeoutMs > 0) {
    timeout = setTimeout(ontimeout, timeoutMs);
  }


  var sync = true;
  this.callback(req, opts, function (err, socket) {
    if (timedOut) {
      return;
    } else if (timeout != null) {
      clearTimeout(timeout);
    }

    if (err) {
      if (sync) {
        // need to defer the "error" event, when sync, because by now the `req`
        // instance hasn't even been passed back to the user yet...
        process.nextTick(function () {
          onerror(err);
        });
      } else {
        onerror(err);
      }
    } else {
      req.onSocket(socket);
    }
  });
  sync = false;
};
