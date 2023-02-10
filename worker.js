function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

onmessage = function(e) {
    console.log(e);
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
        sleep(24*60*60*1000); // wait one day;
    } // attente active 1 fois par jour
    postMessage('message');
}
