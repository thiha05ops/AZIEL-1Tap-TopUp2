// frontend/js/user-info.js

document.addEventListener("DOMContentLoaded", () => {

    const userBox = document.getElementById("userBox");
    const username = localStorage.getItem("username");

    if (userBox && username) {

        userBox.innerHTML = `👤 ${username}`;

    }

});