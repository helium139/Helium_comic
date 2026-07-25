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