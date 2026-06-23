import { initializeApp } from "firebase/app";
import { getFirestore, collection, addDoc, serverTimestamp } from "firebase/firestore";
import fs from "fs";

const firebaseConfig = JSON.parse(fs.readFileSync("./firebase-applet-config.json", "utf8"));
const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function run() {
  const chapters = [
    {
      title: "médecine bucco-dentaire",
      bookId: "8rV20qULwnBhxiW1nREl",
      filiere: "ECN",
      niveau: "ALL"
    },
    {
      title: "pharmacie",
      bookId: "8rV20qULwnBhxiW1nREl",
      filiere: "ECN",
      niveau: "ALL"
    }
  ];
  
  for (const c of chapters) {
    const res = await addDoc(collection(db, "chapters"), {
      ...c,
      createdAt: serverTimestamp()
    });
    console.log("Added:", res.id, c.title);
  }
}

run().catch(console.error).then(() => process.exit(0));
