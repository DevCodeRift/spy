const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

async function fetchAPI(endpoint, options = {}) {
  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  });

  if (!response.ok) {
    throw new Error(`API Error: ${response.statusText}`);
  }

  return response.json();
}

export async function searchNations(query, limit = 20) {
  return fetchAPI(`/nations/search?q=${encodeURIComponent(query)}&limit=${limit}`);
}

export async function getNationReset(nationId) {
  return fetchAPI(`/nations/${nationId}/reset`);
}

export async function getStats() {
  return fetchAPI('/stats');
}