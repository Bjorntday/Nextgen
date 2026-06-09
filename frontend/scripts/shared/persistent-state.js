/**
 * Persistent cross-page / cross-tab state helper.
 *
 * Why this exists:
 *   - The app is a multi-page SPA-ish stack (Landing / Agent / Studio / Image Lab).
 *   - We need state to survive:
 *       1) page refresh (localStorage survives, sessionStorage does not after tab close)
 *       2) page navigation (shared key namespace)
 *       3) multiple browser tabs (storage event broadcast)
 *
 * Usage:
 *   import { sharedState } from "/scripts/shared/persistent-state.js";
 *   sharedState.set("landingRefImage", dataUrl);
 *   const url = sharedState.get("landingRefImage");
 *   sharedState.subscribe("landingRefImage", (newVal, oldVal) => { ... });
 */

const STORAGE_PREFIX = "nextgen.shared.";
const listeners = new Map(); // key -> Set<callback>

function isStorageAvailable() {
  try {
    const t = "__nextgen_probe__";
    localStorage.setItem(t, "1");
    localStorage.removeItem(t);
    return true;
  } catch (_e) {
    return false;
  }
}

const HAS_STORAGE = isStorageAvailable();

function rawKey(key) {
  return STORAGE_PREFIX + key;
}

function dispatch(key, newVal, oldVal) {
  const set = listeners.get(key);
  if (!set || set.size === 0) return;
  for (const cb of set) {
    try {
      cb(newVal, oldVal);
    } catch (err) {
      console.error(`[sharedState] listener for "${key}" threw`, err);
    }
  }
}

// Cross-tab broadcast: when *another* tab/window writes, this fires.
if (typeof window !== "undefined" && HAS_STORAGE) {
  window.addEventListener("storage", (ev) => {
    if (!ev.key || !ev.key.startsWith(STORAGE_PREFIX)) return;
    const key = ev.key.slice(STORAGE_PREFIX.length);
    let newVal = null;
    if (ev.newValue !== null) {
      try {
        newVal = JSON.parse(ev.newValue);
      } catch (_e) {
        newVal = ev.newValue;
      }
    }
    dispatch(key, newVal, undefined);
  });
}

export const sharedState = {
  get(key, fallback = null) {
    if (!HAS_STORAGE) return fallback;
    const raw = localStorage.getItem(rawKey(key));
    if (raw === null) return fallback;
    try {
      return JSON.parse(raw);
    } catch (_e) {
      return raw;
    }
  },

  set(key, value) {
    if (!HAS_STORAGE) return false;
    const oldVal = this.get(key);
    let serialized;
    if (value === null || value === undefined) {
      serialized = null;
    } else {
      try {
        serialized = JSON.stringify(value);
      } catch (_e) {
        // Likely a circular structure or unsupported value (e.g. Data URL is fine though).
        try {
          serialized = JSON.stringify(String(value));
        } catch (_e2) {
          console.error(`[sharedState] cannot serialize key "${key}"`, _e2);
          return false;
        }
      }
    }
    if (serialized === null) {
      localStorage.removeItem(rawKey(key));
    } else {
      localStorage.setItem(rawKey(key), serialized);
    }
    // Same-tab listeners do not get the "storage" event, so dispatch manually.
    dispatch(key, value, oldVal);
    return true;
  },

  remove(key) {
    if (!HAS_STORAGE) return;
    const oldVal = this.get(key);
    localStorage.removeItem(rawKey(key));
    dispatch(key, null, oldVal);
  },

  /**
   * Subscribe to changes for `key`. Callback receives (newValue, oldValue).
   * Returns an unsubscribe function.
   */
  subscribe(key, callback) {
    if (typeof callback !== "function") return () => {};
    let set = listeners.get(key);
    if (!set) {
      set = new Set();
      listeners.set(key, set);
    }
    set.add(callback);
    return () => set.delete(callback);
  },

  /** Migrate a legacy sessionStorage value into persistent shared state. */
  migrateFromSession(legacyKey, newKey) {
    if (typeof sessionStorage === "undefined") return null;
    const raw = sessionStorage.getItem(legacyKey);
    if (raw === null) return null;
    try {
      const parsed = JSON.parse(raw);
      this.set(newKey, parsed);
    } catch (_e) {
      this.set(newKey, raw);
    }
    try {
      sessionStorage.removeItem(legacyKey);
    } catch (_e) {}
    return this.get(newKey);
  },
};

export const SharedKeys = {
  LANDING_REF_IMAGE: "landingRefImage",        // uploaded reference image (data URL)
  LANDING_AI_IMAGES: "landingAiImages",        // AI-generated images on landing
  GENERATED_IMAGE: "generatedImage",           // latest image passed Image Lab -> Studio
  PRODUCT_FORM: "productForm",                 // { productName, sellingPoints, ... }
  WORKFLOW_INPUTS: "workflowInputs",           // arbitrary per-workflow state
};

export const isPersistentStorageReady = HAS_STORAGE;
