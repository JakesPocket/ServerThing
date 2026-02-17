/**
 * ServerThing-to-DeskThing Bridge
 * This script allows apps written for DeskThing to run on ServerThing
 * by providing the global 'DeskThing' object and mapping its events.
 */

(function() {
  const listeners = new Map();

  window.DeskThing = {
    /**
     * DeskThing Apps expect to send data to the server via this method.
     */
    send: function(data) {
      window.parent.postMessage({
        type: 'app-data',
        payload: data
      }, '*');
    },

    /**
     * Add event listeners for server messages.
     */
    on: function(event, callback) {
      if (!listeners.has(event)) {
        listeners.set(event, []);
      }
      listeners.get(event).push(callback);
    },

    /**
     * Request data from the server.
     */
    get: function(request) {
      this.send({ type: 'get', request: request });
    },

    /**
     * Log messages to the server.
     */
    log: function(message, level = 'info') {
      this.send({ type: 'log', request: level, payload: message });
    }
  };

  // Listen for messages from the Shell (ServerThing)
  window.addEventListener('message', (event) => {
    const { type, payload } = event.data;
    
    // Map ServerThing internal types to DeskThing types
    // Example: 'input' -> 'message' (with payload)
    if (listeners.has(type)) {
      listeners.get(type).forEach(cb => cb(payload));
    }
    
    // Generic message listener
    if (listeners.has('message')) {
      listeners.get('message').forEach(cb => cb({ type, payload }));
    }
  });

  console.log('DeskThing Bridge Initialized');
})();
