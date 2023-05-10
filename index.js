const express = require('express');
const WebSocketServer = require('ws');
const discord = require('discord.js');
const fetch = require('node-fetch');
const { v4: uuidv4 } = require('uuid');
const { profanity } = require("super-profanity");

require('dotenv').config();

const messageChannel = '1105693423303933993';
let messageChannelObject = null;

let lastMessageID = 0;

const wss = new WebSocketServer.Server({ port: 3001 });
const client = new discord.Client({
  intents: [
    discord.GatewayIntentBits.Guilds,
    discord.GatewayIntentBits.MessageContent,
    discord.GatewayIntentBits.GuildMembers,
    discord.GatewayIntentBits.GuildMessages,
    discord.GatewayIntentBits.GuildMessageReactions,
    discord.GatewayIntentBits.GuildMessageTyping,
  ],
});

wss.on('listening', () => {
  console.log('Listening on port 3001')
})

client.on('ready', () => {
  console.log(`Logged in as ${client.user.tag}!`);
});

client.on('messageCreate', (message) => {
  if (message.channelId !== messageChannel) return;
  if (message.author.id === client.user.id) return;
  if (!message.reference?.channelId) return;

  const respondedTo = message.channel.messages.cache.get(message.reference.messageId);
  if (!respondedTo) return;
  if (respondedTo.author.id !== client.user.id) return;

  wss.clients.forEach((ws) => {
    if (ws.lastMessageID === respondedTo.id) {
      console.log('sending response to client')
      ws.send(JSON.stringify({
        'type': 'message',
        'data': message.content,
      }));
    }
  });
});

//message handling
wss.on('connection', (ws) => {
  ws.uuid = uuidv4();
  ws.lastMessageID = null;
  ws.lastResponseID = null;

  console.log('Client connected');
  ws.on('error', console.error);
  ws.on('close', () => console.log('Client disconnected'));

  ws.on('message', async (message) => {
    const parsedMessage = JSON.parse(message);
    console.log(`Received message => ${parsedMessage.content}`)

    fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        secret: process.env.CLOUDFLARE_SECRET,
        response: parsedMessage.token,
      })
    })
      .then(res => res.json())
      .then(json => {
        if (!json.success) {
          console.log('Invalid captcha token')
          ws.send(JSON.stringify({
            type: 'error',
            data: 'Invalid captcha token, reload and try again'
          }))
          return;
        }

        let result = profanity(parsedMessage.content.slice(0, 1000));
        while (false) {
          console.log('Profanity detected')
          console.log(result)
          parsedMessage.content = parsedMessage.content.replace(result.detectedWord, '*'.repeat(result.detectedWord.length));
          result = profanity(parsedMessage.content);
        }

        console.log('no profanity')

        client.channels.cache.get(messageChannel).send(`From UUID ${ws.uuid}: \`${parsedMessage.content}\``).then((newMessage) => {
          ws.lastMessageID = newMessage.id;
        })
      })
  });
});

wss.on('close', () => {
  clearInterval(interval);
});

client.login(process.env.DISCORD_TOKEN);
