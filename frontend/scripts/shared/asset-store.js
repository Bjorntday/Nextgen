const STORE_KEY = 'nextgen_assets';
const MAX_ITEMS = 100;

function guessType(url) {
  if (!url) return 'image';
  if (/\.(mp4|webm|mov|avi|mkv)(\?|#|$)/i.test(url)) return 'video';
  if (/^data:video\//i.test(url)) return 'video';
  return 'image';
}

export function addAsset(item) {
  const assets = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
  assets.unshift({
    id: item.id || `a_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type: item.type || guessType(item.url || item.dataUrl),
    url: item.url || item.dataUrl || '',
    label: item.label || item.prompt || item.productName || '',
    time: item.time || new Date().toISOString(),
  });
  if (assets.length > MAX_ITEMS) assets.length = MAX_ITEMS;
  localStorage.setItem(STORE_KEY, JSON.stringify(assets));
}

export function getAssets() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
  } catch (_) {
    return [];
  }
}
