const express = require('express');
const WebSocketServer = require('ws');
const discord = require('discord.js');
const fetch = require('node-fetch');
const { v4: uuidv4 } = require('uuid');
const { profanity } = require("super-profanity");

require('dotenv').config();

const messageChannel = '1105988689026367518';
let messageChannelObject = null;

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
  if (message.author.id === client.user.id) return;

  wss.clients.forEach((ws) => {
    if (ws.threadChannelID === message.channel.id) {
      console.log('sending response to client')

      if (message.content.length > 0) {
        ws.send(JSON.stringify({
          'type': 'message',
          'data': message.content,
        }));
      }

      Array.from(message.attachments.values()).forEach((attachment) => {        
        ws.send(JSON.stringify({
          'type': 'attachment',
          'data': attachment.url,
        }));
      });
    }
  });
});

//message handling
wss.on('connection', (ws) => {
  ws.uuid = uuidv4();
  ws.threadChannelID = null;

  console.log('Client connected');
  ws.on('error', console.error);
  ws.on('close', () => {
    console.log('Client disconnected')
    const thread = client.channels.cache.get(ws.threadChannelID)
    if (thread) thread.delete();
  });

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

        if (!ws.threadChannelID) {
          console.log('No thread channel ID')
          client.channels.cache.get(messageChannel).threads.create({
            name: `Message from ${ws.uuid}`,
            message: parsedMessage.content.slice(0, 1000),
            autoArchiveDuration: 60,
          })
            .then((thread) => {
              ws.threadChannelID = thread.id;
            })
        } else {
          console.log('Thread channel ID exists')
          client.channels.cache.get(ws.threadChannelID).send(parsedMessage.content.slice(0, 1000))
        }
      })
  });
});

wss.on('close', () => {
  clearInterval(interval);
});

client.login(process.env.DISCORD_TOKEN);
