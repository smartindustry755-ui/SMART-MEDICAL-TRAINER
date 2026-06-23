import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, query, orderBy } from "firebase/firestore";
import fs from "fs";

const firebaseConfig = JSON.parse(fs.readFileSync("./firebase-applet-config.json", "utf8"));
const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function check() {
  const snap = await getDocs(query(collection(db, 'books'), orderBy('name', 'asc')));
  console.log("Total books with orderBy:", snap.size);
  snap.forEach(d => console.log(d.id, d.data()));
  process.exit(0);
}
check();
