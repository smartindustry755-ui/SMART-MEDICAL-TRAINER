import { initializeApp } from 'firebase/app';
import { getAuth, User } from 'firebase/auth';
import { 
  getFirestore, 
  collection, 
  doc, 
  setDoc as realSetDoc, 
  getDoc as realGetDoc, 
  getDocs as realGetDocs, 
  query, 
  where, 
  orderBy, 
  addDoc as realAddDoc, 
  onSnapshot as realOnSnapshot, 
  getDocFromServer,
  initializeFirestore,
  memoryLocalCache,
  updateDoc as realUpdateDoc,
  deleteDoc as realDeleteDoc,
  increment as realIncrement
} from 'firebase/firestore';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import firebaseConfig from '../../firebase-applet-config.json';
import { safeLocalStorage } from './utils';

// Initialize Firebase SDK
const app = initializeApp(firebaseConfig);

// Initialize Firestore
const firestoreDb = initializeFirestore(app, {
  localCache: memoryLocalCache(),
  experimentalForceLongPolling: true
}, firebaseConfig.firestoreDatabaseId);

export const db = firestoreDb;

export const auth = getAuth(app);
export const storage = getStorage(app);

// Consumption accounting function
export async function incrementDatabaseConsumption(
  userId: string, 
  reads: number, 
  writes: number, 
  readBytes: number = 0, 
  writeBytes: number = 0
) {
  if (!userId) return;
  try {
    const todayStr = new Date().toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' }).split('/').reverse().join('-'); // YYYY-MM-DD
    const monthStr = todayStr.substring(0, 7); // YYYY-MM

    const docRef = doc(db, 'userConsumption', userId);
    const docSnap = await realGetDoc(docRef);

    if (docSnap.exists()) {
      const data = docSnap.data();
      const lastToday = data.lastActiveToday || '';
      const lastMonth = data.lastActiveMonth || '';

      const isSameDay = lastToday === todayStr;
      const isSameMonth = lastMonth === monthStr;

      const newReadsToday = isSameDay ? (data.readsToday || 0) + reads : reads;
      const newWritesToday = isSameDay ? (data.writesToday || 0) + writes : writes;
      const newReadBytesToday = isSameDay ? (data.readBytesToday || 0) + readBytes : readBytes;
      const newWriteBytesToday = isSameDay ? (data.writeBytesToday || 0) + writeBytes : writeBytes;

      const newReadsMonth = isSameMonth ? (data.readsMonth || 0) + reads : reads;
      const newWritesMonth = isSameMonth ? (data.writesMonth || 0) + writes : writes;
      const newReadBytesMonth = isSameMonth ? (data.readBytesMonth || 0) + readBytes : readBytes;
      const newWriteBytesMonth = isSameMonth ? (data.writeBytesMonth || 0) + writeBytes : writeBytes;

      await realSetDoc(docRef, {
        readsToday: newReadsToday,
        writesToday: newWritesToday,
        readsMonth: newReadsMonth,
        writesMonth: newWritesMonth,
        readBytesToday: newReadBytesToday,
        writeBytesToday: newWriteBytesToday,
        readBytesMonth: newReadBytesMonth,
        writeBytesMonth: newWriteBytesMonth,
        lastActiveToday: todayStr,
        lastActiveMonth: monthStr
      }, { merge: true });
    } else {
      await realSetDoc(docRef, {
        readsToday: reads,
        writesToday: writes,
        readsMonth: reads,
        writesMonth: writes,
        readBytesToday: readBytes,
        writeBytesToday: writeBytes,
        readBytesMonth: readBytes,
        writeBytesMonth: writeBytes,
        lastActiveToday: todayStr,
        lastActiveMonth: monthStr
      });
    }

    // Increment global consumption statistics in dailyDbConsumption
    try {
      const globalDocRef = doc(db, 'dailyDbConsumption', todayStr);
      await realSetDoc(globalDocRef, {
        date: todayStr,
        reads: realIncrement(reads),
        writes: realIncrement(writes),
        readBytes: realIncrement(readBytes),
        writeBytes: realIncrement(writeBytes)
      }, { merge: true });
    } catch (err) {
      console.error('Error incrementing global web database consumption:', err);
    }
  } catch (error) {
    console.error('Error incrementing database consumption:', error);
  }
}

// Wrapped Firestore read / write methods with correct any/Promise<any> types to satisfy Vite Downstream Spread Type checks
export async function getDoc(ref: any, ...args: any[]): Promise<any> {
  const path = ref?.path || '';
  const skipCounting = path.includes('userConsumption') || path.includes('test/connection');
  
  const snap = await (realGetDoc as any)(ref, ...args);

  if (!skipCounting) {
    try {
      const savedUser = safeLocalStorage.getItem('ais_user');
      if (savedUser) {
        const user = JSON.parse(savedUser);
        const userId = user?.id || user?.username;
        if (userId) {
          const docData = snap.exists() ? snap.data() : null;
          const bytes = docData ? JSON.stringify(docData).length : 50;
          incrementDatabaseConsumption(userId, 1, 0, bytes, 0);
        }
      }
    } catch (err) {
      console.error("Error in getDoc tracker:", err);
    }
  }
  return snap;
}

export async function getDocs(queryOrRef: any, ...args: any[]): Promise<any> {
  const path = queryOrRef?.path || '';
  const skipCounting = path.includes('userConsumption');

  const snap = await (realGetDocs as any)(queryOrRef, ...args);

  if (!skipCounting) {
    try {
      const savedUser = safeLocalStorage.getItem('ais_user');
      if (savedUser) {
        const user = JSON.parse(savedUser);
        const userId = user?.id || user?.username;
        if (userId) {
          const reads = Math.max(1, snap.size || 0);
          let bytes = 0;
          if (snap.docs) {
            snap.docs.forEach((doc: any) => {
              bytes += JSON.stringify(doc.data() || {}).length;
            });
          }
          if (bytes === 0) {
            bytes = reads * 50;
          }
          incrementDatabaseConsumption(userId, reads, 0, bytes, 0);
        }
      }
    } catch (err) {
      console.error("Error in getDocs tracker:", err);
    }
  }
  return snap;
}

export async function populateGroupContextsForQuestions(questions: any[]): Promise<any[]> {
  if (!questions || questions.length === 0) return [];
  const groupIds = Array.from(new Set(questions.map(q => q.groupId).filter(Boolean)));
  if (groupIds.length === 0) return questions;

  const groupsMap: Record<string, any> = {};
  
  // Fetch in chunks of 10
  for (let i = 0; i < groupIds.length; i += 10) {
    const chunk = groupIds.slice(i, i + 10);
    try {
      const snap = await (realGetDocs as any)(query(collection(db, 'question_groups'), where('__name__', 'in', chunk)));
      if (snap && snap.docs) {
        snap.docs.forEach((d: any) => {
          groupsMap[d.id] = d.data();
        });
      }
    } catch (err) {
      console.error("Error fetching question groups:", err);
    }
  }

  return questions.map(q => {
    if (q.groupId && groupsMap[q.groupId]) {
      const group = groupsMap[q.groupId];
      return {
        ...q,
        sharedStem: group.context || q.sharedStem,
        groupTitle: group.name || q.groupTitle,
        isGrouped: true,
      };
    }
    return q;
  });
}

export async function setDoc(ref: any, data: any, ...args: any[]): Promise<any> {
  const path = ref?.path || '';
  const skipCounting = path.includes('userConsumption');

  if (!skipCounting) {
    try {
      const savedUser = safeLocalStorage.getItem('ais_user');
      if (savedUser) {
        const user = JSON.parse(savedUser);
        const userId = user?.id || user?.username;
        if (userId) {
          const bytes = JSON.stringify(data || {}).length || 50;
          incrementDatabaseConsumption(userId, 0, 1, 0, bytes);
        }
      }
    } catch (err) {
      console.error("Error in setDoc tracker:", err);
    }
  }
  return (realSetDoc as any)(ref, data, ...args);
}

export async function updateDoc(ref: any, data: any, ...args: any[]): Promise<any> {
  const path = ref?.path || '';
  const skipCounting = path.includes('userConsumption');

  if (!skipCounting) {
    try {
      const savedUser = safeLocalStorage.getItem('ais_user');
      if (savedUser) {
        const user = JSON.parse(savedUser);
        const userId = user?.id || user?.username;
        if (userId) {
          const bytes = JSON.stringify(data || {}).length || 50;
          incrementDatabaseConsumption(userId, 0, 1, 0, bytes);
        }
      }
    } catch (err) {
      console.error("Error in updateDoc tracker:", err);
    }
  }
  return (realUpdateDoc as any)(ref, data, ...args);
}

export async function addDoc(collectionRef: any, data: any, ...args: any[]): Promise<any> {
  const path = collectionRef?.path || '';
  const skipCounting = path.includes('userConsumption');

  if (!skipCounting) {
    try {
      const savedUser = safeLocalStorage.getItem('ais_user');
      if (savedUser) {
        const user = JSON.parse(savedUser);
        const userId = user?.id || user?.username;
        if (userId) {
          const bytes = JSON.stringify(data || {}).length || 50;
          incrementDatabaseConsumption(userId, 0, 1, 0, bytes);
        }
      }
    } catch (err) {
      console.error("Error in addDoc tracker:", err);
    }
  }
  return (realAddDoc as any)(collectionRef, data, ...args);
}

export async function deleteDoc(ref: any, ...args: any[]): Promise<any> {
  const path = ref?.path || '';
  const skipCounting = path.includes('userConsumption');

  if (!skipCounting) {
    try {
      const savedUser = safeLocalStorage.getItem('ais_user');
      if (savedUser) {
        const user = JSON.parse(savedUser);
        const userId = user?.id || user?.username;
        if (userId) {
          incrementDatabaseConsumption(userId, 0, 1, 0, 50);
        }
      }
    } catch (err) {
      console.error("Error in deleteDoc tracker:", err);
    }
  }
  return (realDeleteDoc as any)(ref, ...args);
}

export function onSnapshot(...args: any[]): any {
  const ref = args[0];
  const path = ref?.path || (ref?.ref?.path) || '';
  const skipCounting = path.includes('userConsumption');

  const callbackIndex = args.findIndex(arg => typeof arg === 'function');
  if (callbackIndex !== -1 && !skipCounting) {
    const originalCallback = args[callbackIndex];
    args[callbackIndex] = function (snapshot: any, ...extraArgs: any[]) {
      try {
        const savedUser = safeLocalStorage.getItem('ais_user');
        if (savedUser) {
          const user = JSON.parse(savedUser);
          const userId = user?.id || user?.username;
          if (userId) {
            let reads = 1;
            let bytes = 50;
            if (snapshot) {
              if (typeof snapshot.size === 'number') {
                reads = Math.max(1, snapshot.size);
              }
              if (snapshot.docs) {
                let bytesSum = 0;
                snapshot.docs.forEach((doc: any) => {
                  bytesSum += JSON.stringify(doc.data() || {}).length;
                });
                if (bytesSum > 0) {
                  bytes = bytesSum;
                } else {
                  bytes = reads * 50;
                }
              }
            }
            incrementDatabaseConsumption(userId, reads, 0, bytes, 0);
          }
        }
      } catch (err) {
        console.error("Error in onSnapshot tracker:", err);
      }
      return originalCallback(snapshot, ...extraArgs);
    };
  }
  return (realOnSnapshot as any)(...args);
}

// Error Handling Spec for Firestore Operations
export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  customAuthInfo: any;
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const savedUser = safeLocalStorage.getItem('ais_user');
  const customAuthInfo = savedUser ? JSON.parse(savedUser) : null;

  const errorMessage = error instanceof Error ? error.message : String(error);
  const errInfo: FirestoreErrorInfo = {
    error: errorMessage,
    customAuthInfo,
    operationType,
    path
  };
  
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  
  const isPermissionError = 
    errorMessage.toLowerCase().includes('permission') || 
    errorMessage.toLowerCase().includes('denied') ||
    errorMessage.toLowerCase().includes('insufficient') ||
    errorMessage.toLowerCase().includes('unauthorized');

  // Throw alert only for permission errors to guide security rules tuning,
  // do not throw or crash on general network latency or server offline errors
  if (isPermissionError) {
    setTimeout(() => {
      throw new Error(JSON.stringify(errInfo));
    }, 0);
  }
}

// Validate Connection to Firestore
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if(error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Please check your Firebase configuration. ");
    }
    // Skip logging for other errors, as this is simply a connection test.
  }
}
testConnection();

// Background function to capture actual App Hosting assets data transfer load size
export async function trackAppHostingStaticAssets() {
  if (typeof window === 'undefined' || !window.performance) return;

  try {
    const savedUser = safeLocalStorage.getItem('ais_user');
    if (!savedUser) return;
    const user = JSON.parse(savedUser);
    const userId = user?.id || user?.username;
    if (!userId) return;

    // Wait until load event or a delay to ensure performance entries have populated
    setTimeout(async () => {
      // 1. Calculate static assets size downloaded in current session (transferSize from Resource Timing API)
      let totalAssetBytes = 0;
      const resourceEntries = window.performance.getEntriesByType('resource');
      
      resourceEntries.forEach((entry: any) => {
        // Only count assets loaded from current host (App Hosting domain)
        if (entry.name && entry.name.includes(window.location.host)) {
          totalAssetBytes += entry.transferSize || entry.encodedBodySize || entry.decodedBodySize || 0;
        }
      });

      // 2. Navigation document size
      const navEntries = window.performance.getEntriesByType('navigation');
      if (navEntries && navEntries.length > 0) {
        const docEntry = navEntries[0] as any;
        totalAssetBytes += docEntry.transferSize || docEntry.encodedBodySize || docEntry.decodedBodySize || 0;
      }

      // Fallback: If no performance indicators or zero, default to average bundle sizes (approx 1.8 MB)
      if (totalAssetBytes === 0) {
        totalAssetBytes = 1800000; 
      }

      // Avoid double-counting if we track multiple times in a session
      const lastSessionTrack = safeLocalStorage.getItem('ais_last_asset_track');
      const lastBytesTracked = Number(lastSessionTrack || 0);
      
      const newBytesToTrack = Math.max(0, totalAssetBytes - lastBytesTracked);
      if (newBytesToTrack > 0) {
        // App Hosting static read bytes are logged as portion of database storage/server read bytes
        await incrementDatabaseConsumption(userId, 0, 0, newBytesToTrack, 0);
        safeLocalStorage.setItem('ais_last_asset_track', String(totalAssetBytes));
        console.log(`[App Hosting] Tracked ${newBytesToTrack} bytes transferred in current session.`);
      }
    }, 4500); // Wait 4.5 seconds after mounting to allow full rendering and bundles analysis
  } catch (err) {
    console.error("Error in trackAppHostingStaticAssets:", err);
  }
}
