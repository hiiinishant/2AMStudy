/**
 * Shared authenticated fetch helpers for Student Safety client pages.
 */

export async function getAuthHeaders(auth) {
  const user = auth?.currentUser;
  if (!user) {
    throw new Error('You must be logged in.');
  }
  const token = await user.getIdToken();
  return { Authorization: `Bearer ${token}` };
}

export async function authFetch(auth, url, options = {}) {
  const authHeaders = await getAuthHeaders(auth);
  const headers = {
    ...(options.headers || {}),
    ...authHeaders
  };
  return fetch(url, { ...options, headers });
}

export async function authFetchJson(auth, url, options = {}) {
  const res = await authFetch(auth, url, options);
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

export async function downloadWithAuth(auth, url, filename) {
  const res = await authFetch(auth, url);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Download failed.');
  }
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename || 'download';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
}

export function escHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function caseDetailHref(caseId, status) {
  const isPublic = status === 'Verified' || status === 'Resolved';
  return isPublic ? `/student-safety/cases/${caseId}` : '/student-safety/my-reports';
}
