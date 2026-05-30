import { initializeApp } from 'firebase/app'
import { getAuth, GoogleAuthProvider } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'

const firebaseConfig = {
  apiKey: "AIzaSyDcbaYm089u1918AbV7J-4CsEXRTvOQSUU",
  authDomain: "finance-app-bb22c.firebaseapp.com",
  projectId: "finance-app-bb22c",
  storageBucket: "finance-app-bb22c.firebasestorage.app",
  messagingSenderId: "377542643817",
  appId: "1:377542643817:web:226bdc92ca0948cc8c12f8"
}

const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)
export const provider = new GoogleAuthProvider()
export const db = getFirestore(app)
const firebase = { auth, provider, db }
export default firebase
