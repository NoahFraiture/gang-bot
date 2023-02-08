const login = require("facebook-chat-api");
const fs = require("fs");
const { exit } = require("process");
const { Worker } = require("worker_threads");

const credential = {
    appState: JSON.parse(fs.readFileSync("appState.json", "utf-8")),
};

const { Configuration, OpenAIApi } = require("openai");
const configuration = new Configuration({apiKey: "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",}); // todo : hide
const openai = new OpenAIApi(configuration);

const emojis = ["👍", "😠", "😢", "😮", "😆", "❤"];
const LIMIT_POLLS = 8;
var polls = [];

/*
contains name, options bound to an emoji and counter for emoji, even with no option but doesn't print them
Can be changed easily (print function)
*/
class Poll {
    constructor(messageID, name, options) {
        this.name = name;
        this.messageID = messageID;
        this.userReaction = [];
        this.list = [];
        this.size = options.length;
        for (let i = 0; i < this.size; i++) {
            this.list.push([options[i], emojis[i], 0]); // option, emoji, nb of vote
        }
        console.log(this.list);
    }

    add(emoji, user) {
        var toRemove = "";
        this.userReaction.forEach((element) => {
            if (element[0] == user) {
                toRemove = element[1];
                element[1] = emoji;
                console.log("Remove %s from %i", toRemove, user);
            }
        });
        if (toRemove == "") {
            this.userReaction.push([user, emoji]);
        }
        for (let i = 0; i < this.size; i++) {
            if (this.list[i][1] == emoji) {
                this.list[i][2]++;
                console.log("Add %s from %i", emoji, user);
            } else if (this.list[i][1] == toRemove) {
                this.list[i][2]--;
            }
        }
    }

    print() {
        var response = this.name + "\n";
        this.list.forEach((element) => {
            response =
                response +
                element[0] +
                "(" +
                element[1] +
                ") : " +
                element[2] +
                "\n";
        });
        return response;
    }
}

// return message representing the poll named. 0 otherwised
function searchPoll(name) {
    for (let i = 0; i < polls.length; i++) {
        if (polls[i].name == name) {
            return polls[i].print();
        }
    }
    return 0;
}

// parse the message and return name, options[]
function createPollInfos(content) {
    if (polls.length >= LIMIT_POLLS) polls.shift();
    var options = content.split("\n");
    var name = options[0].slice("poll".length + 1); // get first line after "poll"
    options.shift();
    return [name, options];
}

// return list of poll's name
function pollList() {
    var mes = "";
    for (let i = 0; i < polls.length; i++) {
        mes = mes + polls[i].name + "\n";
    }
    return mes;
}

// start workers and sendMessage when reach date at the same time of the day of the command
function reminder(message, api) {
    var worker = new Worker("./worker.js");
    var mesCore = message.body.split(" ", 2)[1];
    worker.onmessage = (e) => {
        api.sendMessage("Ding dong " + mesCore, message.threadID);
    };
    worker.postMessage(mesCore);
}

async function tell(prompt) {
    const response = await openai.createCompletion({
        model: "text-ada-001",	// "text-davinci-003",
        prompt: prompt,
        temperature: 0,
        max_tokens: 7,
    });
    return response.data.choices[0].text.trim();
}

function handleMessage(message, api) {
    if (message.body == undefined) return;
    console.log(
        " Received message : %s \n from : %i",
        JSON.stringify(message.body),
        message.threadID
    );

    if (message.body == "exit") {
        console.log("Exit with message procedure");
        exit(1);
    } else if (message.body.startsWith("remindme")) {
        console.log("Creating reminder");
        reminder(message, api);
        console.log("Reminder created");
    } else if (message.body.startsWith("poll")) {
        console.log("Creating poll");

        // create message of poll
        var pollMessage = createPollInfos(message.body); // name-str ; options-list(str)
        var mes = pollMessage[0] + "\n";
        for (let i = 0; i < pollMessage[1].length; i++) {
            mes = mes + pollMessage[1][i] + " " + emojis[i] + "\n";
        }

        // send message and get his id to create a Poll()
        api.sendMessage(mes, message.threadID, (err, sentMessageInfo) => {
            if (err) return console.error(err);
            polls.push(
                new Poll(
                    sentMessageInfo.messageID,
                    pollMessage[0],
                    pollMessage[1]
                )
            );
            console.log('Poll created "%s"', pollMessage[0]);
        });
    } else if (message.body.startsWith("getpoll ")) {
        console.log("Searching poll");
        var name = message.body.slice("getpoll".length + 1);
        var pollText = searchPoll(name); // get Poll.print() or 0 if not found
        if (pollText) {
            api.sendMessage(pollText, message.threadID);
            console.log('Poll "%s" shown', name);
        } else {
            console.log('Error : Poll "%s" not found', name);
        }
    } else if (message.body.startsWith("listpoll")) {
        var mes = pollList();
        if (mes == "") {
            console.log("No poll found");
        } else {
            api.sendMessage(pollList(), message.threadID);
            console.log("Polls list printed");
        }
    } else if (message.body.startsWith("tell")) {

    } else if (message.body == "ping") {
        api.sendMessage("pong", message.threadID);
        console.log("Ping Pong operation !");
    } else {
        api.sendMessage(message.body, message.threadID);
        console.log(
            "Sent mesage : %s \n to : %i",
            JSON.stringify(message.body),
            message.threadID
        );
    }
}

function handleReaction(message_reaction, api) {
    console.log(
        "%i a reagit avec : %s",
        message_reaction.userID,
        message_reaction.reaction
    );
    for (let i = 0; i < polls.length; i++) {
        if (polls[i].messageID == message_reaction.messageID) {
            polls[i].add(message_reaction.reaction, message_reaction.userID);
        }
    }
}

login(credential, (err, api) => {
    if (err) return console.error(err);
    api.setOptions({ listenEvents: true });
    api.listenMqtt((err, message) => {
        if (err) return console.log(err);
        if (message.type == "message") handleMessage(message, api);
        if (message.type == "message_reaction") handleReaction(message, api);
    });
});

// todo : remindme. C script that send signal to js though file/messenger/deeper in api
// todo : stay in node when execute file for noah-bot
// each reception of "remind" command, create worker who wait until date before send message with api or to listener ?

// est ce qu'on reste bloqué sur le listener ? on dirait que non

// if (mes = remind) new Worker(); send(date); addlistener(sendMessage)
// Worker : wait until date : post;
