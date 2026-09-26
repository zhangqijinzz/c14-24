import type { PersistedWorkspace } from './types';

const STORAGE_KEY = 'money-scenario.workspace.v1';
const DB_NAME = 'money-scenario-db';

function validWorkspace(value: unknown): value is PersistedWorkspace {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<PersistedWorkspace>;
  return candidate.version === 1 && Array.isArray(candidate.scenarios) && typeof candidate.selectedId === 'string';
}

export async function readLocalWorkspace(): Promise<PersistedWorkspace | null> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return validWorkspace(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function writeLocalWorkspace(workspace: PersistedWorkspace): Promise<void> {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace));
}

export async function readIndexedWorkspace(): Promise<PersistedWorkspace | null> {
  if (typeof indexedDB === 'undefined') return null;
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('workspace');
      request.onsuccess = () => {
        const transaction = request.result.transaction('workspace', 'readonly');
        const getRequest = transaction.objectStore('workspace').get('active');
        getRequest.onsuccess = () => resolve(validWorkspace(getRequest.result) ? getRequest.result : null);
        getRequest.onerror = () => resolve(null);
      };
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function writeIndexedWorkspace(workspace: PersistedWorkspace): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  await new Promise<void>((resolve, reject) => {
    try {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('workspace');
      request.onsuccess = () => {
        const transaction = request.result.transaction('workspace', 'readwrite');
        transaction.objectStore('workspace').put(workspace, 'active');
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      };
      request.onerror = () => reject(request.error);
    } catch (error) {
      reject(error);
    }
  });
}
