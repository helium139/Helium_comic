import { db } from "./firebase.js";
import { collection, getDocs, query, orderBy } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

// Existing public popularity counts, not private trusted accounting totals.
let pending;
export function loadPopularity() {
    if (!pending) pending = getDocs(query(collection(db, "mangaStats"), orderBy("views", "desc")))
        .then(snapshot => snapshot.docs.map(doc => ({ id: doc.id, views: doc.data().views })))
        .catch(error => { pending = undefined; throw error; });
    return pending;
}
