const { Server } = require("socket.io");

const discord = require('discord.js');
const fetch = require('node-fetch');
const { v4: uuidv4 } = require('uuid');
const { profanity } = require("super-profanity");

require('dotenv').config();

const messageChannel = '1178991793052864522';
let messageChannelObject = null;

const io = new Server({
  cors: {
    origin: "http://localhost:3000"
  }
});

//const sockets = new WebSocketServer.Server({ port: 3001 });
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

/*
sockets.on('listening', () => {
  console.log('Listening on port 3001')
})
*/

client.on('ready', () => {
  console.log(`Logged in as ${client.user.tag}!`);
});

client.on('messageCreate', (message) => {
  if (message.author.id === client.user.id) return;

  io.sockets.sockets.forEach((socket) => {
    if (socket.threadChannelID === message.channel.id) {
      console.log('sending response to client')

      if (message.content.length > 0) {
        socket.send(JSON.stringify({
          'type': 'message',
          'data': message.content,
        }));
      }

      Array.from(message.attachments.values()).forEach((attachment) => {
        socket.send(JSON.stringify({
          'type': 'attachment',
          'data': attachment.url,
        }));
      });
    }
  });
});

//message handling
io.on("connection", (socket) => {
  socket.uuid = uuidv4();
  socket.threadChannelID = null;

  socket.send(JSON.stringify({
    type: 'uuid',
    data: socket.uuid,
  }));

  console.log('Client connected');
  socket.on('error', console.error);
  socket.on('close', () => {
    console.log('----------------\n**Client disconnected**\n----------------')
    const thread = client.channels.cache.get(socket.threadChannelID)
    //if (thread) thread.delete();
    if (thread) {
      thread.send('----------------\n**Client disconnected**\n----------------');
      thread.setArchived(true);
    }
  });

  socket.on('message', async (message) => {
    const parsedMessage = JSON.parse(message);
    console.log(`Received message => ${message}`)
    console.log(`Message type: ${parsedMessage.type}`)

    if (parsedMessage.type && parsedMessage.type === 'uuid') {
      console.log('attempting a reconnnection to thread')
      //given uuid, look for thread with uuid in name
      const regularThreads = await client.channels.cache.get(messageChannel).threads.fetchActive();
      const archivedThreads = await client.channels.cache.get(messageChannel).threads.fetchArchived();

      const regularThread = await archivedThreads.threads.find((thread) => thread.name?.includes(parsedMessage.data));
      const archivedThread = await regularThreads.threads.find((thread) => thread.name?.includes(parsedMessage.data));

      const thread = archivedThread ?? regularThread;

      if (thread) {
        socket.threadChannelID = thread.id;
        socket.uuid = parsedMessage.data;
        console.log(`Thread found, sending message to ${thread.id}`)
        thread.send('----------------\n**Client reconnected to thread**\n----------------')
        thread.setArchived(false);
      } else {
        /*
        socket.send(JSON.stringify({
          type: 'error',
          data: 'Your thread is either too old to resume or couldn\'t be found, sowwy uwu'
        }))
        */
        socket.uuid = parsedMessage.data;
      }
    } else {
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
            socket.send(JSON.stringify({
              type: 'error',
              data: 'Invalid captcha token, reload and try again'
            }))
            return;
          }

          if (!socket.threadChannelID) {
            console.log('No thread channel ID')
            client.channels.cache.get(messageChannel).threads.create({
              name: `Message from ${socket.uuid}`,
              message: parsedMessage.content.slice(0, 1000),
              autoArchiveDuration: 60,
            })
              .then((thread) => {
                socket.threadChannelID = thread.id;

                thread.send(`Client info: \n\t- IP: ${socket.handshake.headers['cf-connecting-ip']}\n\t- User Agent: ${socket.handshake.headers['user-agent']}\n\t- UUID: ${socket.uuid}\n\t- Country of Origin: ${socket.handshake.headers['cf-ipcountry']}`)
              })
          } else {
            console.log('Thread channel ID exists')
            client.channels.cache.get(socket.threadChannelID).send(parsedMessage.content.slice(0, 1000))
          }
        })
    }
  });
});

/*
sockets.on('close', () => {
  clearInterval(interval);
});
*/

//start discord bot
console.log('Starting discord bot')
client.login(process.env.DISCORD_TOKEN);

//start web server
console.log('Starting socket server')
io.listen(3001);