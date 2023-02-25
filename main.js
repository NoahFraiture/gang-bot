const login = require("facebook-chat-api");
const fs = require("fs");
const got = require("got"); // to scrap image from url
const { exit } = require("process");

/* process.on("SIGINT", () => {
    // volatile sig_atomic var quit = 1;
    // periodicaly check if this var is on, then quit
}); */

const credential = {
    appState: JSON.parse(fs.readFileSync("appState.json", "utf-8")),
};

const configFile = JSON.parse(fs.readFileSync("config.json", "utf-8"))[0];
const quality = configFile.quality
const tokens = configFile.tokens
const LIMIT_POLLS = configFile.polls_max;
const LIMIT_MESSAGE_STORED = configFile.store_max;
const emojis = configFile.emojis;
const key = configFile.key;
const logsOn = configFile.logsOn;
const backupOn = configFile.backupOn;

const { Configuration, OpenAIApi } = require("openai");
const configuration = new Configuration({
    apiKey: key,
});
const openai = new OpenAIApi(configuration);

var polls = [];
var storeMessage = [];
var reminders = [];
var logsNumber = fs.readdirSync('logs/').length - 1;
var jsonLogs = "logs/logs"+logsNumber.toString()+".json"
const logsTemplate = "logs/logsTemplate.json"
const stateName = "state.json";

/*
contains name, options bound to an emoji and counter for emoji, even with no option but doesn't print them
Can be changed easily (print function)
*/
class Poll {
    constructor(messageID, name, options, thread) {
        this.name = name;
        this.messageID = messageID;
        this.userReaction = [];
        this.state = [];
        this.size = options.length;
        this.thread = thread;
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
            thread:this.thread
        };
        return json;
    }
}

function deserialize(dict) {
    var p = new Poll("null", "null", [], "null");
    p.messageID = dict.messageID;
    p.name = dict.name;
    p.state = dict.state;
    p.userReaction = dict.userReaction;
    p.thread = dict.thread
    return p;
}

// return message representing the poll named. 0 otherwised
function searchPoll(name, threadID) {
    for (let i = 0; i < polls.length; i++) {
        if (polls[i].thread == threadID && polls[i].name == name) {
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

function createPoll(message, api) {
    // create message of poll
    var pollMessage = createPollInfos(message.body); // name-str ; options-list(str)
    if (searchPoll(pollMessage[0].trim(), message.threadID) != 0) {
        api.sendMessage(
            "A poll with this name already exists",
            message.threadID
        );
        console.log("A poll with this name already exists");
        return;
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
                pollMessage[1],
                message.threadID
            )
        );
        console.log('Poll created "%s"', pollMessage[0]);
    });
    writeLogs({
        "type": "create poll",
        "request": pollMessage,
        "author": message.senderID,
        "thread": message.threadID
    }, "command");
}

// return list of poll's name
function pollList(threadID) {
    var mes = "";
    for (let i = 0; i < polls.length; i++) {
        if (polls[i].thread == threadID) {
        mes = mes + polls[i].name + "\n";
        }
    }
    return mes;
}

function listpoll(message, api) {
    var mes = pollList(message.threadID);
    if (mes == "") {
        console.log("No poll found");
    } else {
        api.sendMessage(mes, message.threadID);
        console.log("Polls list printed");
    }
    writeLogs({
        "type": "listpoll",
        "author": message.senderID,
        "thread": message.threadID,
        "polls": mes
    }, "command");
}

// remind at sent date MM-DD-YYYY. Test : works with timestamp. Need test to see if it's good units. Should be good
function reminder(message, api) {
    var mesCore = message.body.substr(message.body.indexOf(" ") + 1);
    var end = new Date(mesCore);
    var now = new Date();
    if (end < now) {
        console.log("invalid date");
        api.sendMessage("Invalid date. Format MM-DD-YYYY");
    } else {
        reminders.push(message);
        setTimeout(() => {
            console.log("Reminder from message %d", message.messageID);
            api.sendMessage(
                {
                    body:"Ding dong it's time @Sender",
                    mentions: [{tag:"@Sender" ,id:message.senderID}]
                },
                message.threadID, message.messageID
            );
            var index = reminders.indexOf(message);
            if (index !== -1) {
                reminders.splice(index, 1);
            }
        }, end - new Date());
    }
}

async function tell(message, api) {
    var text = message.body.substr(message.body.indexOf(" ") + 1);
    try {
        const response = await openai.createCompletion({
            model: "text-davinci-003", // "text-davinci-003",
            prompt: text,
            temperature: 0.6,
            max_tokens: tokens,
        });
        console.log("Statut %i + '%s'", response.status, response.statusText);
        // todo : handle error status
        writeLogs({
            "type": "gpt",
            "request": text,
            "author": message.senderID,
            "thread": message.threadID,
            "headers": response.headers,
            "status": response.status,
            "config": response.config,
            "data": response.data,
            "content": response.data.choices[0].text
        }, "command");
        api.sendMessage(response.data.choices[0].text.trim(), message.threadID);
        console.log("Response sent");
    } catch (e) {
        console.log(e);
        api.sendMessage("Error in generation of a response", message.threadID);
    }
}

async function createImage(demand) {
    try {
        return await openai.createImage({
            prompt: demand,
            n: 1,
            size: quality,
        });
    } catch (e) {
        console.log(e);
        return 0;
    }
}

async function createEdit(demand, filename) {
    try {
        console.log(filename);
        return await openai.createImageEdit( // todo : handle size but anyway it doesn't really edit cause of the mask
            fs.createReadStream(filename),
            fs.createReadStream("mask.png"),
            demand,
            1,
            quality
        );
    } catch (e) {
        console.log("here");
        return 0;
    }
}

async function createVariation(filename) {
    try {
        return await openai.createImageVariation(
            fs.createReadStream(filename),
            1,
            quality
        );
    } catch (e) {
        console.log(e);
        return 0;
    }
}

async function imagine(message, api) {
    try {
        const demand = message.body.substr(message.body.indexOf(" ") + 1);
        const response = await createImage(demand);
        console.log("Statut %i + '%s'", response.status, response.statusText);
        writeLogs({
            "type": "imagine",
            "request": demand,
            "author": message.senderID,
            "thread": message.threadID,
            "headers": response.headers,
            "status": response.status,
            "config": response.config,
            "data": response.data,
            "url": response.data.data[0].url
        }, "command");
        url = response.data.data[0].url;
        await got.stream(url).pipe(fs.createWriteStream("generation.png")).on("finish", async()=>{
            var answer = {
                body: demand,
                attachment: fs.createReadStream("generation.png"),
            };
            api.sendMessage(answer, message.threadID);
            console.log("Image sent");
        });
    } catch (e) {
        console.log(e);
        api.sendMessage("Error in generation of an image", message.threadID);
    }
}

async function variation(message, api) {
    const demand = message.messageReply.body.substr(message.body.indexOf(" ") + 1);
    var url_input = await message.messageReply.attachments[0].previewUrl;
    if (url_input == undefined) {
        url_input = message.messageReply.attachments[0].sticker_attachment.url
    }
    try {
        // save input image in "variation.png"
        console.log(url_input)
        await got.stream(url_input).pipe(fs.createWriteStream("variation.png")).on("finish", async()=>{
            const response = await createVariation("variation.png"); 
            var url_output = response.data.data[0].url;

            writeLogs({
                "type": "variation",
                "request": demand,
                "author": message.senderID,
                "thread": message.threadID,
                "headers": response.headers,
                "status": response.status,
                "config": response.config,
                "data": response.data,
                "url": response.data.data[0].url
            }, "command");

            // save output image in "generation.png"
            await got.stream(url_output).pipe(fs.createWriteStream("generation.png")).on("finish", async()=>{
                var answer = {
                    body: demand,
                    attachment: fs.createReadStream("generation.png"),
                }
                api.sendMessage(answer, message.threadID);
                console.log("Image Sent");
            });
        });
    } catch (e) {
        console.log(e);
        api.sendMessage("Error in generation of an image", message.threadID);
    }
}

// marche pas encore, nécessite un mask qui sert à rien
async function edit(message, api) {
    const demand = message.body.substr(message.body.indexOf(" ") + 1);
    var url_input = message.messageReply.attachments[0].previewUrl;
    try {
        // save input image in "variation.png"
        await got.stream(url_input).pipe(fs.createWriteStream("input.png")).on("finish", async()=>{
            const response = await createEdit(demand, "input.png");
            var url_output = response.data.data[0].url;
            console.log(url_output);

            // save output image in "generation.png"
            await got.stream(url_output).pipe(fs.createWriteStream("generation.png")).on("finish", async()=>{
                var answer = {
                    body: demand,
                    attachment: fs.createReadStream("generation.png"),
                }
                api.sendMessage(answer, message.threadID);
                console.log("Image Sent");
            });
        });
    } catch (e) {
        console.log(e);
        api.sendMessage("Error in generation of an image", message.threadID);
    }
}

// write in json file, content = dictionnary
function writeLogs(content, category) {
    var currentdate = new Date(); 
    var datetime = "Last Sync: " + currentdate.getDate() + "/"
                + (currentdate.getMonth()+1)  + "/" 
                + currentdate.getFullYear() + " @ "  
                + currentdate.getHours() + ":"  
                + currentdate.getMinutes() + ":" 
                + currentdate.getSeconds();
    content["time"] = datetime;
    // block le fichier, problème quand il doit écrire en même à partir de plusieurs asynchrone
    try {
        fs.readFile(jsonLogs, "utf8", function readFileCallback(err, data) {
            if (err) {
                console.log(err);
            } else {
                obj = JSON.parse(data); //now it an object
                if (category == "message") {
                    obj.message.push(content); //add some data
                } else if (category == "command") {
                    obj.command.push(content);
                } else if (category == "error") {
                    obj.error.push(content);
                } else {
                    console.log("Error in category of writing logs");
                    return;
                }
                var json = JSON.stringify(obj); //convert it back to json
                fs.writeFileSync(jsonLogs, json, (e) => {
                    if (e) throw e;
                }); // write it back
            }
        });
    } catch (e) {
        console.log("Can't write log. Creating new logs file");
        jsonLogs = "logs/logs"+logsNumber.toString()+".json"
        logsNumber++;
        fs.copyFileSync(logsTemplate, jsonLogs, (err)=>{
            if (err) {
                console.log("error here")
                throw err
            };
            console.log("New file logs %d created from template", logsNumber);
        });
        return writeLogs(content, category);
    }
    
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
    if (logsOn) {
        writeLogs({
            "type":"message",
            "content":message.body,
            "author":message.senderID,
            "id":message.messageID,
            "threadID":message.threadID
        }, "message");
    }
    var command = message.body.split(" ")[0].toLowerCase();
    if (command == "!exit") {
        console.log("Exit with message procedure");
        quit();
    } else if (command == "remindme") {
        console.log("Creating reminder");
        reminder(message, api);
        console.log("Reminder created");
        api.sendMessage("Reminder created", message.threadID);
    } else if (command == "listremind") {
        var mes = ""
        reminders.forEach(element => {
            mes += element.body.substr(element.body.indexOf(" ") + 1) + "\n";
        });
        api.sendMessage(mes, message.threadID);
        console.log("list of reminders printed");
    } else if (command == "poll") {
        console.log("Creating poll");
        createPoll(message, api);
    } else if (command == "getpoll") {
        console.log("Searching poll");
        var name = message.body.slice("getpoll".length + 1);
        var myPoll = searchPoll(name.trim(), message.threadID);
        var pollText = myPoll.print();
        if (pollText) {
            api.sendMessage(pollText, message.threadID, myPoll.messageID);
            console.log('Poll "%s" shown', name);
        } else {
            console.log('Error : Poll "%s" not found', name);
        }
        writeLogs({
            "type": "getpoll",
            "request": name,
            "response": pollText,
            "author": message.senderID,
            "thread": message.threadID,
        }, "command");
    } else if (command == "listpoll") {
        listpoll(message, api);
    } else if (command == "tell") {
        console.log("Requesting GPT3");
        tell(message, api); // asynchronous so need to handle everything in the function
    } else if (command == "imagine") {
        console.log("Generating image");
        imagine(message, api);
    } else if (command == "!ping") {
        api.sendMessage("pong", message.threadID);
        console.log("Ping Pong operation !");
    } else if (command == "!help") {
        var help = "tell ... : chatgpt\n" +
        "imagine ... : dall-e\n" +
        "variation + reply a picture : dall-e variation\n" +
        "remindme MM-DD-YYYY : set a reminder\n" +
        "save ... + reply a message : save the message, callable with listmessage and getmessage ...\n" +
        "poll ...\n...\n... : create a poll with a name and option, callable with listpoll and getpoll ...\n"
        api.sendMessage(help, message.senderID);
        writeLogs({
            "type":"help",
            "author": message.senderID,
            "thread": message.threadID,
        }, "command")
    } else if (command == "listmessage") {
        console.log("Getting saved message")
        var mes = "";
        storeMessage.forEach(element => {
            if (element[2] == message.threadID) {
                mes += "\n" + element[0];
            }
        });
        if (mes == "") {
            api.sendMessage("Nothing found", message.threadID)
        } else {
            api.sendMessage(mes, message.threadID);
        }
        console.log("saved message : "+mes);
        writeLogs({
            "type":"listmessage",
            "response":mes,
            "author": message.senderID,
            "thread": message.threadID,
        }, "command")
    } else if (command == "getmessage") {
        var demand = message.body.substr(message.body.indexOf(" ") + 1).trim();
        var here = "";
        var reply = ""
        console.log(demand);
        storeMessage.forEach(element => {
            if (element[2] == message.threadID && element[0] == demand) {
                here = ("ici");
                reply = element[1].messageReply;
            }
        });
        console.log("message saved : " + reply.body)
        if (here == "") {
            api.sendMessage("not found", message.threadID);
        } else {
            api.sendMessage(here, message.threadID, reply.messageID);
        }
        writeLogs({
            "type":"getmessage",
            "requests":demand,
            "response":reply.body,
            "author": message.senderID,
            "thread": message.threadID,
        }, "command")
    } else if (command == "clearpoll") {
        console.log("clearpoll");
        polls = [];
        api.sendMessage("cleared", message.threadID);
    } else if (command == "clearmessage") {
        console.log("clearmessage");
        storeMessage = [];
        api.sendMessage("cleared", message.threadID);
    } else if (command == "backup") {
        console.log("backuping");
        backup()
    } else {
        /* api.sendMessage(message.body, message.threadID);
        console.log(
            "Sent mesage : %s \n to : %i",
            JSON.stringify(message.body),
            message.threadID
        ); */
    }
}

function handleReaction(message_reaction) {
    console.log(
        "%i a reagit avec : %s",
        message_reaction.userID,
        message_reaction.reaction
    );
    if (logsOn) {
        writeLogs({
            "type":"reaction",
            "content":message_reaction.reaction,
            "author":message_reaction.senderID,
            "id":message_reaction.messageID,
            "threadID":message_reaction.threadID,
        }, "message")
    }
    for (let i = 0; i < polls.length; i++) {
        if (polls[i].messageID == message_reaction.messageID) {
            polls[i].add(message_reaction.reaction, message_reaction.userID);
        }
    }
}

function handleReply(message, api) {
    if (message.body == undefined) return;
    console.log(
        " Reply message : %s \n from : %i \n to message %s",
        JSON.stringify(message.body),
        message.threadID,
        JSON.stringify(message.messageReply.body)
    );
    if (logsOn) {
        writeLogs({
            "type":"reply",
            "content":message.body,
            "author":message.senderID,
            "id":message.messageID,
            "threadID":message.threadID,
            "reply":message.messageReply.messageID
        }, "message");
    }
    var command = message.body.split(" ")[0].toLowerCase();
    if (command == "variation") {
        console.log("Generation variation");
        variation(message, api);
    } else if (command == "edit") {
        return;
        console.log("Editing image");
        edit(message, api);
    } else if (command == "save") {
        var name = message.body.substr(message.body.indexOf(" ") + 1);
        var out = 0;
        storeMessage.forEach(element => {
            if (element[2] == message.threadID && element[0] == name) {
                api.sendMessage("Already a message saved with this", message.threadID);
                out = 1;
                return;
            }
        });
        if (out == 1) return;
        storeMessage.push([name, message, message.threadID]);
        if (storeMessage.length > LIMIT_MESSAGE_STORED) {
            storeMessage.shift;
        }
        console.log("message saved");
        api.sendMessage("Message saved", message.threadID);
        writeLogs({
            "type":"save",
            "requests":message.messageReply.messageID,
            "author": message.senderID,
            "thread": message.threadID,
        }, "command")
    } else {
        console.log("Transposing reply to handle_message");
        //handleMessage(message, api);
    }
}

// save reminders, polls and saved message in state.json
function backupLoop(timeout) {
    setTimeout(() => {
        backup();
        backupLoop(timeout);
    }, timeout);
}

function backup() {
    fs.readFile(stateName, "utf8", function readFileCallback(err, data) {
        // on arrive pas ici
        if (err) {
            console.log(err);
        } else {
            obj = JSON.parse(data); //now it an object
            obj.poll = polls.map((poll) => poll.serialize());
            obj.saved = storeMessage;
            obj.reminders = reminders;
            fs.writeFileSync(stateName, JSON.stringify(obj), (e) => {
                if (e) {
                    throw e;
                }
                console.log("Polls saved");
            }); // write it back
        }
        writeLogs({
            "command":"backup",
            "polls":polls,
            "storemessage":storeMessage,
            "reminders":reminders
        }, "command");
        console.log("backuping")
        return;
    });
}

// copy of backup within exit function. The readfile is async so without that it doesn't
// have the time to backup
function quit() {
    fs.readFile(stateName, "utf8", function readFileCallback(err, data) {
        // on arrive pas ici
        if (err) {
            console.log(err);
        } else {
            obj = JSON.parse(data); //now it an object
            obj.poll = polls.map((poll) => poll.serialize());
            obj.saved = storeMessage;
            obj.reminders = reminders;
            fs.writeFileSync(stateName, JSON.stringify(obj), (e) => {
                if (e) {
                    throw e;
                }
                console.log("Polls saved");
            }); // write it back
        }
        exit(0);
    });
}

// reload state.json
function init(api) {
    fs.readFile(stateName, "utf8", function readFileCallback(err, data) {
        if (err) {
            console.log(err);
            exit(-1);
        }
        obj = JSON.parse(data);
        polls = [];
        obj.poll.forEach(poll => {
            polls.push(deserialize(poll));
        });
        storeMessage = obj.saved;
        obj.reminders.forEach(remind => {
            reminder(remind, api);
        });
    });
}

login(credential, (err, api) => {
    if (err) return console.error(err);
    init();
    api.setOptions({ listenEvents: true });
    api.listenMqtt((err, message) => {
        if (err) {
            writeLogs({
                "type":"error",
                "content":err
            }, "error");
            console.log("Error in message : probably a sticker")
            return;
        }
        if (message.type == "message") handleMessage(message, api);
        if (message.type == "message_reaction") handleReaction(message);
        if (message.type == "message_reply") handleReply(message, api);
    });
    if (backupOn) {
        backupLoop(1000*60*60) // every minute, backup
    }
});



// todo : quote me

// todo : régler le problème de sigint