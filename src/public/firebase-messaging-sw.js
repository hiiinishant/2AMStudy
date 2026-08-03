/* 2AM Study - Student Safety Service Worker for Web Push Notifications */
self.addEventListener('push', function (event) {
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data = { title: '2AM Study Alert', body: event.data.text() };
    }
  } else {
    data = { title: '2AM Study Student Safety Alert', body: 'A case update is available.' };
  }

  const options = {
    body: data.body || 'New update regarding a reported case.',
    icon: data.icon || '/favicon.ico',
    badge: data.badge || '/favicon.ico',
    vibrate: [100, 50, 100],
    data: {
      url: data.url || '/student-safety',
      notificationId: data.notificationId || null,
      caseId: data.caseId || null
    },
    actions: [
      { action: 'open', title: '🔍 View Case' },
      { action: 'close', title: 'Dismiss' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(data.title || '🛡️ 2AM Student Safety Alert', options)
  );
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();

  const targetUrl = (event.notification.data && event.notification.data.url) ? event.notification.data.url : '/student-safety';
  const notificationId = event.notification.data ? event.notification.data.notificationId : null;

  // Track click if notificationId exists
  if (notificationId) {
    fetch('/api/student-safety/notifications/' + notificationId + '/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }).catch(function (err) {
      console.warn('Click tracking failed:', err);
    });
  }

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientList) {
      for (let i = 0; i < clientList.length; i++) {
        const client = clientList[i];
        if (client.url && 'focus' in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
