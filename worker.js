function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

onmessage = (e) => {
    var origin = new Date(e.data);
    while (true) {
        var now = new Date();
        if (
            origin.getFullYear() == now.getFullYear() &&
            origin.getMonth() == now.getMonth() &&
            origin.getDate() == now.getDate()
        ) {
            break;
        }
        sleep(86400000); // wait one day;
    }
    postMessage('message');
}
