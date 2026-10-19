const menuBtn = document.getElementById("menuToggleBtn");

const sidebar = document.querySelector(".sidebar");
const overlay = document.getElementById("adminOverlay");

if(menuBtn){

    menuBtn.onclick = () => {

        sidebar.classList.add("open");
        overlay.classList.add("show");

    };

}

overlay.onclick = () => {

    sidebar.classList.remove("open");
    overlay.classList.remove("show");

};

document.querySelectorAll(".sidebar a").forEach(link => {

    link.onclick = () => {

        if(window.innerWidth <= 768){

            sidebar.classList.remove("open");
            overlay.classList.remove("show");

        }

    };

});
// Navigation visibility only; report callables and report-page guard enforce admin access.
const reportLinks = document.querySelectorAll('[data-admin-report-link]');
if (reportLinks.length) {
    import('../assets/js/firebase-session.js').then(({auth, onAuthStateChanged}) => {
        onAuthStateChanged(auth, async user => {
            for (const link of reportLinks) link.hidden = true;
            if (!user) return;
            const result = await user.getIdTokenResult();
            if (auth.currentUser === user) for (const link of reportLinks) link.hidden = result.claims.role !== 'admin';
        });
    }).catch(() => {});
}
