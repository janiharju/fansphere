
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const fs = require('fs');

// Assuming credentials file is available or environment is set up
const app = initializeApp();
const db = getFirestore(app);

async function debugPost() {
  const postRef = db.collection('posts').doc('10008');
  const postSnap = await postRef.get();
  
  if (!postSnap.exists) {
    console.log('Post 10008 does not exist');
  } else {
    console.log('Post 10008:', postSnap.data());
  }

  const postRef2 = db.collection('posts').doc('10011');
  const postSnap2 = await postRef2.get();
  
  if (!postSnap2.exists) {
    console.log('Post 10011 does not exist');
  } else {
    console.log('Post 10011:', postSnap2.data());
  }
}

debugPost();
