/* Texnourgeion persistent content storage.
   Public visitors read the shared data.json.
   Logged-in administrators can persist editor changes through the Netlify Function. */
(function () {
  var nativeSet = localStorage.setItem.bind(localStorage);
  var nativeRemove = localStorage.removeItem.bind(localStorage);
  var nativeClear = localStorage.clear.bind(localStorage);
  var ready = false;
  var timer = null;
  var loading = null;
  var remoteData = {};

  function isAdmin() {
    try { return !!(window.netlifyIdentity && netlifyIdentity.currentUser()); }
    catch (e) { return false; }
  }

  function snapshot() {
    var out = {};
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k) out[k] = localStorage.getItem(k);
    }
    return out;
  }

  function sync() {
    if (!ready || !isAdmin()) return Promise.resolve();
    return netlifyIdentity.currentUser().jwt().then(function (token) {
      return fetch('/.netlify/functions/save-content', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + token,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ storage: snapshot() })
      }).then(function (r) {
        if (!r.ok) return r.text().then(function (t) { throw new Error(t); });
        return r.json();
      });
    });
  }

  function scheduleSync() {
    if (!ready || !isAdmin()) return;
    clearTimeout(timer);
    timer = setTimeout(function () {
      sync().catch(function (err) {
        console.error('Texnourgeion: αποτυχία μόνιμης αποθήκευσης', err);
      });
    }, 700);
  }

  localStorage.setItem = function (key, value) {
    nativeSet(key, value);
    scheduleSync();
  };
  localStorage.removeItem = function (key) {
    nativeRemove(key);
    scheduleSync();
  };
  localStorage.clear = function () {
    nativeClear();
    scheduleSync();
  };

  loading = fetch('/data.json?ts=' + Date.now(), { cache: 'no-store' })
    .then(function (r) { return r.ok ? r.json() : {}; })
    .catch(function () { return {}; })
    .then(function (data) {
      // Keep the existing Netlify Identity keys intact. Replace only the
      // content keys that this site's editor stores.
      remoteData = data || {};
      var storage = data.storage || {};
      Object.keys(storage).forEach(function (k) { nativeSet(k, storage[k]); });

      // Backward compatibility with the original contact/social structure.
      if (data.contact) {
        if (data.contact.addr != null) nativeSet('contact_addr', data.contact.addr);
        if (data.contact.phone != null) nativeSet('contact_phone', data.contact.phone);
        if (data.contact.mail != null) nativeSet('contact_mail', data.contact.mail);
      }
      if (data.socials) {
        Object.keys(data.socials).forEach(function (k) {
          if (data.socials[k]) nativeSet('social_' + k, data.socials[k]);
        });
      }
      ready = true;
      return data;
    });

  window.TexPersist = {
    ready: loading,
    sync: sync,
    snapshot: snapshot
  };

  // First-time migration: if the old browser-only editor has content and
  // the shared store is still empty, publish that existing content once
  // the administrator signs in.
  var identityWatcher = setInterval(function () {
    if (!window.netlifyIdentity) return;
    clearInterval(identityWatcher);
    netlifyIdentity.on('login', function () {
      loading.then(function () {
        if (!remoteData.storage || Object.keys(remoteData.storage).length === 0) {
          sync().catch(function (err) {
            console.error('Texnourgeion: αποτυχία αρχικής μεταφοράς δεδομένων', err);
          });
        }
      });
    });
  }, 100);
})();
