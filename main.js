const login = require("facebook-chat-api");
const fs = require("fs");
const got = require("got"); // to scrap image from url
const { exit } = require("process");
const { Worker } = require("worker_threads"); // multi threading


/* process.on("SIGINT", () => {
    // volatile sig_atomic var quit = 1;
    // periodicaly check if this var is on, then quit
}); */

const credential = {
    appState: JSON.parse(fs.readFileSync("appState.json", "utf-8")),
};

const { Configuration, OpenAIApi } = require("openai");
const configuration = new Configuration({
    apiKey: "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",
}); // todo : hide
const openai = new OpenAIApi(configuration);

const emojis = ["👍", "😠", "😢", "😮", "😆", "❤"];
const LIMIT_POLLS = 8;
var polls = [];
const jsonName = "opeanai-logs.json";
const pollsName = "pollSaved.json";

/*
contains name, options bound to an emoji and counter for emoji, even with no option but doesn't print them
Can be changed easily (print function)
*/
class Poll {
    constructor(messageID, name, options) {
        this.name = name;
        this.messageID = messageID;
        this.userReaction = [];
        this.state = [];
        this.size = options.length;
        for (let i = 0; i < this.size; i++) {
            this.state.push([options[i], emojis[i], 0]); // option, emoji, nb of vote
        }
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
            if (this.state[i][1] == emoji) {
                this.state[i][2]++;
                console.log("Add %s from %i", emoji, user);
            } else if (this.state[i][1] == toRemove) {
                this.state[i][2]--;
            }
        }
    }

    print() {
        var response = this.name + "\n";
        this.state.forEach((element) => {
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

    serialize() {
        // save in file + need init file to load polls, reminder etc
        var json = {
            messageID: this.messageID,
            name: this.name,
            state: this.state,
            userReaction: this.userReaction,
        };
        return json;
    }
}

function deserialize(dict) {
    var p = new Poll("null", "null", []);
    p.messageID = dict.messageID;
    p.name = dict.name;
    p.state = dict.state;
    p.userReaction = dict.userReaction;
    return p;
}

// return message representing the poll named. 0 otherwised
function searchPoll(name) {
    for (let i = 0; i < polls.length; i++) {
        if (polls[i].name == name) {
            return polls[i];
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
    var mesCore = message.body.substr(message.body.indexOf(" ") + 1);
    worker.onmessage = function (e) {
        api.sendMessage("Ding dong " + mesCore, message.threadID);
    };
    worker.postMessage(mesCore);
}

async function tell(message, api) {
    var text = message.body.substr(message.body.indexOf(" ") + 1);
    try {
        const response = await openai.createCompletion({
            model: "text-davinci-003", // "text-davinci-003",
            prompt: text,
            temperature: 0.6,
            max_tokens: 7,
        });
        console.log("Statut %i + '%s'", response.status, response.statusText);
        // todo : handle error status
        writeGPTLogs({
            headers: response.headers,
            status: response.status,
            config: response.config,
            //"request":response.request, //got error here, but not necessary so is ok
            data: response.data,
        });
        api.sendMessage(response.data.choices[0].text.trim(), message.threadID);
        console.log("Response sent");
    } catch (e) {
        console.log(e);
        api.sendMessage("Error in generation of a response", message.threadID);
    }
}

async function imagine(message, api) {
    var text = message.body.substr(message.body.indexOf(" ") + 1);
    try {
        const response = await openai.createImage({
            prompt: text,
            n: 1,
            size: "256x256",
        });
        console.log("Statut %i + '%s'", response.status, response.statusText);
        writeGPTLogs({
            headers: response.headers,
            status: response.status,
            config: response.config,
            //"request":response.request, //got error here, but not necessary so is ok
            data: response.data,
        });
        url = response.data.data[0].url;
        await got.stream(url).pipe(fs.createWriteStream("image.png"));
        var answer = {
            body: text,
            attachment: fs.createReadStream(__dirname + "/image.png"),
        };
        api.sendMessage(answer, message.threadID);
        console.log("Image sent");
    } catch (e) {
        console.log(e);
        api.sendMessage("Error in generation of an image", message.threadID);
    }
}

// write in json file, content = dictionnary
function writeGPTLogs(content) {
    fs.readFile(jsonName, "utf8", function readFileCallback(err, data) {
        if (err) {
            console.log(err);
        } else {
            obj = JSON.parse(data); //now it an object
            obj.gpt.push(content); //add some data
            var json = JSON.stringify(obj); //convert it back to json
            fs.writeFile(jsonName, json, (e) => {
                if (e) throw e;
                console.log("Data written");
            }); // write it back
        }
    });
}

// use third-party function to compute the data
// handle facebook-api and console.log here when possible
// return error message when problem. Main function handle it
function handleMessage(message, api) {
    if (message.body == undefined) return;
    console.log(
        " Received message : %s \n from : %i",
        JSON.stringify(message.body),
        message.threadID
    );

    if (message.body == "exit") {
        console.log("Exit with message procedure");
        quit();
    } else if (message.body.startsWith("remindme")) {
        console.log("Creating reminder");
        reminder(message, api);
        console.log("Reminder created");
    } else if (message.body.startsWith("poll")) {
        console.log("Creating poll");

        // create message of poll
        var pollMessage = createPollInfos(message.body); // name-str ; options-list(str)
        if (searchPoll(pollMessage[0].trim()) != 0) {
            api.sendMessage(
                "A poll with this name already exists",
                message.threadID
            );
            console.log("A poll with this name already exists");
        }
        var mes = pollMessage[0] + "\n";
        for (let i = 0; i < pollMessage[1].length; i++) {
            mes = mes + pollMessage[1][i] + " " + emojis[i] + "\n";
        }

        // send message and get his id to create a Poll()
        api.sendMessage(mes, message.threadID, (err, sentMessageInfo) => {
            if (err) {
                console.error(err);
                return err;
            }
            polls.push(
                new Poll(
                    sentMessageInfo.messageID,
                    pollMessage[0].trim(),
                    pollMessage[1]
                )
            );
            console.log('Poll created "%s"', pollMessage[0]);
        });
    } else if (message.body.startsWith("getpoll ")) {
        console.log("Searching poll");
        var name = message.body.slice("getpoll".length + 1);
        var myPoll = searchPoll(name.trim());
        var pollText = myPoll.print();
        if (pollText) {
            api.sendMessage(pollText, message.threadID, myPoll.messageID);
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
        console.log("Requesting GPT3");
        tell(message, api); // asynchronous so need to handle everything in the function
    } else if (message.body.startsWith("imagine")) {
        console.log("Generating image");
        imagine(message, api);
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

function handleReaction(message_reaction) {
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

function quit() {
    fs.readFile(pollsName, "utf8", function readFileCallback(err, data) {
        // on arrive ici mais le fichier fini vide quoi qu'on fasse, intéressant
        if (err) {
            console.log(err);
        } else {
            obj = JSON.parse(data); //now it an object
            obj.poll = polls.map((poll) => poll.serialize());
            console.log(obj);
            console.log(JSON.stringify(obj));
            fs.writeFileSync(pollsName, JSON.stringify(obj), (e) => {
                if (e) {
                    throw e;
                }
                console.log("Polls saved");
            }); // write it back
        }
        exit(-1);
    });
}

function init() {
    fs.readFile(pollsName, "utf8", function readFileCallback(err, data) {
        if (err) {
            console.log(err);
            exit(-1);
        }
        obj = JSON.parse(data);
        polls = [];
        obj.poll.forEach(poll => {
            polls.push(deserialize(poll));
        });
    });
}

init();

login(credential, (err, api) => {
    if (err) return console.error(err);
    api.setOptions({ listenEvents: true });
    api.listenMqtt((err, message) => {
        if (err) return console.log(err);
        if (message.type == "message") handleMessage(message, api);
        if (message.type == "message_reaction") handleReaction(message);
    });
});

// todo : stay in node when execute file for noah-bot

// use asynchron function for worker ? how does it work ?

// todo : tester le reminder et ajouter des options de parse
// todo : dall-e, options pour gpt
// todo : quote me
// todo : handle error
// todo : régler le problème de sigint

// si je créé un poll avec un nom déjà présent, ça me le dit mais ça créé quand même un poll