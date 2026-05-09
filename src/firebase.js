import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBGNHG4rxvrCPbikT-nVHipsniP8g3tfV8",
  authDomain: "bioreactor-27862.firebaseapp.com",
  projectId: "bioreactor-27862",
  storageBucket: "bioreactor-27862.firebasestorage.app",
  messagingSenderId: "660843396690",
  appId: "1:660843396690:web:6232013de06210f814a98b",
  measurementId: "G-DJB8Y9FDGF"
};

export const firebaseApp = initializeApp(firebaseConfig);
export const db = getFirestore(firebaseApp);
