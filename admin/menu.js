const menuBtn=document.getElementById("adminMenuBtn");

const sidebar=document.querySelector(".sidebar");

const overlay=document.getElementById("adminOverlay");

menuBtn.onclick=()=>{

    sidebar.classList.add("open");

    overlay.classList.add("show");

};

overlay.onclick=()=>{

    sidebar.classList.remove("open");

    overlay.classList.remove("show");

};
// Close sidebar when clicking on a link
document
.querySelectorAll(".sidebar a")
.forEach(link=>{

    link.onclick=()=>{

        sidebar.classList.remove("open");

        overlay.classList.remove("show");

    };

});