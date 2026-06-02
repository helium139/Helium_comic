import { db }
from "./firebase.js";

import {
    doc,
    getDoc
}
from
"https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

const snap =
await getDoc(
    doc(
        db,
        "website",
        "global"
    )
);

console.log(
    snap.data()
);