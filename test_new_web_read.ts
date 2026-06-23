import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs } from "firebase/firestore";

const firebaseConfig = {
  "projectId": "gen-lang-client-0901346973",
  "appId": "1:465061301051:web:6bef7f07f734a74762c51e",
  "apiKey": "AIzaSyCvNQwRppTGLUTGQc-rGPlLaoMVDePnACk",
  "authDomain": "gen-lang-client-0901346973.firebaseapp.com",
  "firestoreDatabaseId": "ai-studio-e053e582-52da-4c3f-8a71-881c49b9ac10",
  "storageBucket": "gen-lang-client-0901346973.firebasestorage.app",
  "messagingSenderId": "465061301051",
  "measurementId": ""
};

async function run() {
  console.log("Initializing web app with new config...");
  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

  console.log("Testing read on the new database via Web SDK...");
  try {
    const snap = await getDocs(collection(db, "users"));
    console.log("Read succeeded! Found users:", snap.size);
    snap.forEach(d => console.log(d.id, d.data()));
  } catch (err: any) {
    console.error("Test failed:", err.message);
  }
}

run().catch(console.error).then(() => process.exit(0));
