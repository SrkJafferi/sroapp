'use client';
export type DoctorDraft = {
  id: string;
  name: string;
  gender: string;
  experience: string;
  photo?: File;
  updatedAt: number;
  avatarRequestId?: string;
  photoSaved?: boolean;
};
// Professional draft only: never store passwords, invitation proofs, sessions or MFA secrets.
async function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open('sro-doctor-onboarding', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('drafts', { keyPath: 'id' });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(Error('Unable to preserve your profile draft.'));
  });
}
export async function saveDoctorDraft(draft: DoctorDraft) {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('drafts', 'readwrite');
      tx.objectStore('drafts').put(draft);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(Error('Unable to preserve your profile draft.'));
      tx.onabort = () => reject(Error('Profile draft could not be saved.'));
    });
  } finally {
    db.close();
  }
}
export async function readDoctorDraft(id: string): Promise<DoctorDraft | null> {
  const db = await database();
  let result: DoctorDraft | undefined;
  try {
    result = await new Promise((resolve, reject) => {
      const r = db.transaction('drafts').objectStore('drafts').get(id);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(Error('Unable to read profile draft.'));
    });
  } finally {
    db.close();
  }
  if (!result) return null;
  if (Date.now() - result.updatedAt > 86400000) {
    await clearDoctorDraft(id);
    return null;
  }
  return result;
}
export async function clearDoctorDraft(id: string) {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('drafts', 'readwrite');
      tx.objectStore('drafts').delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(Error('Unable to clear profile draft.'));
    });
  } finally {
    db.close();
  }
}
