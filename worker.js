const cron = require('node-cron');

onmessage = function(e) {
    console.log(e.data);
    var origin = new Date(e.data);
    cron.schedule("* * *", function() {
        var now = new Date();
        if (
            origin.getFullYear() == now.getFullYear() &&
            origin.getMonth() == now.getMonth() &&
            origin.getDate() == now.getDate()
        ) {
            postMessage('message');
            return;
        }
    });
}
