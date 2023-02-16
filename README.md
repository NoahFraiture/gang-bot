# Gang bot

This is a messenger bot with some cools features

To use this bot, You will need to create an appState.json file that will correspond to your cache on facebook when you are logged-in with your bot account. You can obtain this file by logging in to facebook with your bot account and using a chrome/firefox extension. Once you have obtained the appState.json file, you will need to rename the "names" key to "key". I'll try to simplify this later but it requires to modify the API. 
You'll also have to add you personnal openai key in the config file. You have an example. After adding your key you can rename the file "config.json".

Currently, the bot is not adapted to handle a variety of conversations. I haven't had the opportunity to test it with many requests, and I don't know how Facebook will react. Additionally, polls and saved messages are stored in the same buffer for now.

I'm using the unofficial Facebook API, which can be found at https://github.com/Schmavery/facebook-chat-api. An official API exists, but it doesn't allow you to add your bot to group discussions

You will also need to add your personal OpenAI key to the config file. There is an example in the file. After adding your key, you can rename the file "config.json".


# Install

You can install facebook-chat-api, openai with npm.
