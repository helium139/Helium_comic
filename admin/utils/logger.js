const logBox =
document.getElementById(
"log"
);

export function log(text){

    const div =
    document.createElement(
        "div"
    );

    div.textContent = text;

    logBox.appendChild(div);

    logBox.scrollTop =
        logBox.scrollHeight;

}

export function clearLog(){

    logBox.innerHTML="";

}