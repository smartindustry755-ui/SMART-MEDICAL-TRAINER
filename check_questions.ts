import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, query, orderBy } from "firebase/firestore";
import fs from "fs";

const firebaseConfig = JSON.parse(fs.readFileSync("./firebase-applet-config.json", "utf8"));
const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function check() {
  const snap = await getDocs(collection(db, "questions"));
  console.log("Total questions in DB:", snap.size);
  
  const bookCounts = {};
  snap.forEach(doc => {
    const data = doc.data();
    bookCounts[data.bookId] = (bookCounts[data.bookId] || 0) + 1;
  });
  
  console.log("Questions per bookId:", bookCounts);
  process.exit(0);
}
check();
