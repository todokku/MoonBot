﻿const { telegramEventMessages } = require('./eventMessages');
const { OperationCode } = require('./gameRules');
const GameEvents = require('./gameEvents');
const { sprintf } = require('sprintf-js');
const TelegramBot = require('node-telegram-bot-api');
const { filter } = require('rxjs/operators');
const keyBoards = require('./telegramKeyboard');
//const Store = require('ioredis');
//const redis = new Redis(6379, process.env.IP);
/*const redis = new Redis({
port: process.env.REDIS_DB_PORT,
host: process.env.REDIS_DB_HOST,
password: process.env.REDIS_DB_PASSWORD
});*/

const token = () => process.env.MOON_BOT_TOKEN;
const bot = new TelegramBot(token(), {
  polling: true
});
/*var bot = new TelegramBot(token, {
 webHook: {
  port: port,
  host: host
 }
});*/
/*bot.setWebHook(externalUrl + ':443/bot' + token);*/


const FakeStore = {
  games: new Map(),
  set: async function (gameId, gameState) {
    this.games.set(gameId, gameState);
    return Promise.resolve(gameState.id);
  },
  get: async function (gameId) {
    return Promise.resolve(this.games.get(gameId));
  },
  del: async function (gameId) {
    return Promise.resolve(this.games.delete(gameId));
  }
};


const Game = require('./moonGame')(FakeStore);

/*
 * Obtain game event stream and subscribe for behaviour
 */
const eventStream = Game.EventStream;

const numBitsMissedEvents = eventStream.pipe(filter(event => event.eventType === GameEvents.gameNumBitsMissed));
const numBugsMissedEvents = eventStream.pipe(filter(event => event.eventType === GameEvents.gameNumBugsMissed));
const maxEnergyMissedEvents = eventStream.pipe(filter(event => event.eventType === GameEvents.gameMaxEnergyMissed));
const useEventsMissedEvents = eventStream.pipe(filter(event => event.eventType === GameEvents.gameUseEventsMissed));
const restOfEvents = eventStream.pipe(
  filter(
    event =>
      event.eventType !== GameEvents.gameNumBitsMissed &&
      event.eventType !== GameEvents.gameNumBugsMissed &&
      event.eventType !== GameEvents.gameMaxEnergyMissed &&
      event.eventType !== GameEvents.gameUseEventsMissed 
));

//on event send inlinekeyboard asking for num of bits 
numBitsMissedEvents.subscribe({
  next(event) {
    return sendMessage(event.playerId, event.gameId, telegramEventMessages[event.eventType], keyBoards.numBitsKeyboard());
  }
});
//on event send inlinekeyboard asking for num of bugs
numBugsMissedEvents.subscribe({
  next(event) {
    return sendMessage(event.playerId, event.gameId, telegramEventMessages[event.eventType], keyBoards.numBugsKeyboard(event.numBits));
  }
});
//on event send inlinekeyboard asking for max energy value
maxEnergyMissedEvents.subscribe({
  next(event) {
    return sendMessage(event.playerId, event.gameId, telegramEventMessages[event.eventType], keyBoards.maxEnergyKeyboard(event.numBits, event.numBugs));
  }
});
//on event send inlinekeyboard asking for use game events or not
useEventsMissedEvents.subscribe({
  next(event) {
    return sendMessage(event.playerId, event.gameId, telegramEventMessages[event.eventType], keyBoards.useEventsKeyboard(event.numBits, event.numBugs, event.maxEnergy));
  }
});
//on any other event send the message configured
restOfEvents.subscribe({
  next(event) {
    return sendMessage(event.playerId, event.gameId, telegramEventMessages[event.eventType]);
  }
});


//configure bot behaviour with regexp
bot.onText(/^\/start$/, InitConversationRequest);
bot.onText(/^\/creategame$/, CreateGameRequest);
bot.onText(/^\/joingame$/, JoinGameRequest);
bot.onText(/^\/leavegame$/, LeaveGameRequest);
bot.onText(/^\/startgame$/, StartGameRequest);
bot.onText(/^\/status$/, StatusGameRequest);
bot.onText(/^\/endturn$/, EndTurnRequest);
bot.onText(/^\/cancelgame$/, CancellGameRequest);
bot.onText(/^\/help$/, HelpRequest);
bot.onText(/^\/rules$/, RulesRequest);
bot.onText(/^\/operations$/, OperationListRequest);
bot.onText(/^\/inc ([A-D]|[a-d])$/, IncRequest);
bot.onText(/^\/dec ([A-D]|[a-d])$/, DecRequest);
bot.onText(/^\/rol ([A-D]|[a-d])$/, RolRequest);
bot.onText(/^\/ror ([A-D]|[a-d])$/, RorRequest);
bot.onText(/^\/mov ([A-D]|[a-d]) ([A-D]|[a-d])$/, MovRequest);
bot.onText(/^\/not ([A-D]|[a-d])$/, NotRequest);
bot.onText(/^\/or ([A-D]|[a-d]) ([A-D]|[a-d])$/, OrRequest);
bot.onText(/^\/and ([A-D]|[a-d]) ([A-D]|[a-d])$/, AndRequest);
bot.onText(/^\/xor ([A-D]|[a-d]) ([A-D]|[a-d])$/, XorRequest);
bot.on('callback_query', steppedCreateGameRequest);

async function InitConversationRequest(msg) {
  bot.sendMessage(msg.chat.id, welcome_message(msg));
}

async function CreateGameRequest(msg) {
  await Game.CreateGame(msg.chat.id, msg.from.username);
}

//handle inline keyboard responses
async function steppedCreateGameRequest(callbackQuery) {

  let args = new Array();

  args.push(callbackQuery.message.chat.id);
  args.push(callbackQuery.message.from.username);
  args = args.concat(callbackQuery.data.split(" ")); //parse data to get an array from "numBits numBugs maxEnergy useEvents" string

  await Game.CreateGame.apply(Game, args); //will raise missed events if args is incomplete

  bot.answerCallbackQuery(callbackQuery.id); //just finish the callback; the job will be done on missed events subscriptions
}

async function JoinGameRequest(msg) {
  await Game.JoinGame(msg.chat.id, msg.from.username); //will raise events
}

async function LeaveGameRequest(msg) {
  await Game.LeaveGame(msg.chat.id, msg.from.username); //will raise events
}

async function StartGameRequest(msg) {
  const gameState = await Game.StartGame(msg.chat.id, msg.from.username); //will raise events
  await sendGameStatus(msg.from.username, msg.chat.id, gameState); //after handle all events, send game status 
}

async function StatusGameRequest(msg) {
  const gameState = await Game.StatusGame(msg.chat.id, msg.from.username);
  await sendGameStatus(msg.from.username, msg.chat.id, gameState);
}

async function EndTurnRequest(msg) {
  const gameState = await Game.EndPlayerTurn(msg.chat.id, msg.from.username);
  await sendGameStatus(msg.from.username, msg.chat.id, gameState);
}

async function CancellGameRequest(msg) {
  await Game.CancelGame(msg.chat.id);
}

function HelpRequest(msg) {
  sendMessage(msg.from.username, msg.chat.id, help_message);
}

function RulesRequest(msg) {
  sendMessage(msg.from.username, msg.chat.id, rules_message);
}

function OperationListRequest(msg) {
  sendMessage(msg.from.username, msg.chat.id, opList_message);
}

//partial applied funcions to provide naming context makes this more readable 
const ExecuteIncOperation = Game.ExecuteBitOperation.bind(Game, OperationCode.inc); 
const ExecuteDecOperation = Game.ExecuteBitOperation.bind(Game, OperationCode.dec);
const ExecuteRolOperation = Game.ExecuteBitOperation.bind(Game, OperationCode.rol);
const ExecuteRorOperation = Game.ExecuteBitOperation.bind(Game, OperationCode.ror);
const ExecuteMovOperation = Game.ExecuteBitOperation.bind(Game, OperationCode.mov);
const ExecuteNotOperation = Game.ExecuteBitOperation.bind(Game, OperationCode.not);
const ExecuteOrOperation = Game.ExecuteBitOperation.bind(Game, OperationCode.or);
const ExecuteAndOperation = Game.ExecuteBitOperation.bind(Game, OperationCode.and);
const ExecuteXorOperation = Game.ExecuteBitOperation.bind(Game, OperationCode.xor);

async function IncRequest(msg, match) {
  const gameState = await ExecuteIncOperation(msg.chat.id, msg.from.username, match[1].toUpperCase()); //use the partial applied funcion above
  await sendGameStatus(msg.from.username, msg.chat.id, gameState);
}

async function DecRequest(msg, match) {
  const gameState = await ExecuteDecOperation(msg.chat.id, msg.from.username, match[1].toUpperCase());
  await sendGameStatus(msg.from.username, msg.chat.id, gameState);
}

async function RolRequest(msg, match) {
  const gameState = await ExecuteRolOperation(msg.chat.id, msg.from.username, match[1].toUpperCase());
  await sendGameStatus(msg.from.username, msg.chat.id, gameState);
}

async function RorRequest(msg, match) {
  const gameState = await ExecuteRorOperation(msg.chat.id, msg.from.username, match[1].toUpperCase());
  await sendGameStatus(msg.from.username, msg.chat.id, gameState);
}

async function MovRequest(msg, match) {
  const gameState = await ExecuteMovOperation(msg.chat.id, msg.from.username, match[1].toUpperCase(), match[2].toUpperCase());
  await sendGameStatus(msg.from.username, msg.chat.id, gameState);
}
async function NotRequest(msg, match) {
  const gameState = await ExecuteNotOperation(msg.chat.id, msg.from.username, match[1].toUpperCase());
  await sendGameStatus(msg.from.username, msg.chat.id, gameState);
}

async function OrRequest(msg, match) {
  const gameState = await ExecuteOrOperation(msg.chat.id, msg.from.username, match[1].toUpperCase(), match[2].toUpperCase());
  await sendGameStatus(msg.from.username, msg.chat.id, gameState);
}

async function AndRequest(msg, match) {
  const gameState = await ExecuteAndOperation(msg.chat.id, msg.from.username, match[1].toUpperCase(), match[2].toUpperCase());
  await sendGameStatus(msg.from.username, msg.chat.id, gameState);
}

async function XorRequest(msg, match) {
  const gameState = await ExecuteXorOperation(msg.chat.id, msg.from.username, match[1].toUpperCase(), match[2].toUpperCase());
  await sendGameStatus(msg.from.username, msg.chat.id, gameState);
}

//gameState to telegram message
function buildStatusMessage(gameState) {

  if (!gameState) { return null; }

  const playerTurn = () => gameState.playerList[gameState.playerTurn].name;
  const eneryLeft = () => gameState.playerList[gameState.playerTurn].energy;
  const currentObjetive = () => gameState.objetives[gameState.objetives.length - 1].toString(2).padStart(gameState.numBits, "0".repeat(gameState.numBits));
  const registerA = () => gameState.registers.A.toString(2).padStart(gameState.numBits, "0".repeat(gameState.numBits));
  const registerB = () => gameState.registers.B.toString(2).padStart(gameState.numBits, "0".repeat(gameState.numBits));
  const registerC = () => gameState.registers.C.toString(2).padStart(gameState.numBits, "0".repeat(gameState.numBits));
  const registerD = () => gameState.registers.D.toString(2).padStart(gameState.numBits, "0".repeat(gameState.numBits));
  const objetivesLeft = () => gameState.objetives.length;
  const unresolved = () => gameState.unresolved;

  return `\`\`\`
\u{1F5A5}
$> \u{1F468}\u{200D}\u{1F680} turn: ${playerTurn()}
$> ${eneryLeft()} \u{1F50B} left
$> Objetive:

-> ${currentObjetive()}
-----------------
A: ${registerA()}
-----------------
B: ${registerB()}
-----------------
C: ${registerC()}
-----------------
D: ${registerD()}
-----------------

$> Unresolved objetives: ${unresolved()}
$> Objetives left: ${objetivesLeft()}
$> man\`\`\` /operations`;

}

//send message if not null or undefined
function sendMessage(playerId, chatId, message, keyboard) {
  if (!message) { return Promise.resolve(); }
  return bot.sendMessage(chatId, sprintf(message, playerId), { parse_mode: "Markdown", reply_markup: keyboard });
}

//send game status if not null or undefined
async function sendGameStatus(playerId, chatId, gameState) {
  if (!gameState) { return Promise.resolve(); }
  return await sendMessage(playerId, chatId, buildStatusMessage(gameState));
}


function welcome_message(msg) {
  return `Hello ${msg.from.username}.
You can check the /rules or /creategame and start playing in solo mode.
Add me to a group if you want to play with friends.
You can use /help to see all available commands.`;
}

const help_message =
  `/rules - Shows a link about the game and pdf rules.
/creategame - Create a new game.
/joingame - Join into a created game. You can not join into a started game.
/leavegame - Player leaves the game. If last player leaves, the game is cancelled.
/startgame - Start the first round of a created game. Once started, no players can join it.
/status - Shows the current game status like player turn, player energy, current objetive, register values, unresolved objetives queue and objetives left.
/operations - Shows the list of register operations and its energy cost.
/endturn - Player ends the current turn.
/cancelgame - Cancel the created game. It can not be resumed.
/help - Shows this command list.
/inc - How to use: "/inc B".
/dec - How to use: "/dec B".
/rol - How to use: "/rol B".
/ror - How to use: "/ror B".
/mov - How to use: "/mov A C". Register A will be modified.
/not - How to use: "/not D".
/or - How to use: "/or C B". Register C will be modified.
/and - How to use: "/and C B". Register C will be modified.
/xor - How to use: "/xor C B". Register C will be modified.`;

const rules_message =
  `[What is moon (1110011)?](http://compus.deusto.es/moon/)\n
[Rule book](http://tiny.cc/moonboardgame-en)`;

const opList_message =
  `
\`\`\`
Operation  Target  Cost
---------  ------  ----
  inc      1 Reg   2  \u{1F50B}
  dec      1 Reg   2  \u{1F50B}
  rol      1 Reg   1  \u{1F50B}
  ror      1 Reg   1  \u{1F50B}
  mov      2 Reg   1  \u{1F50B}
  not      1 Reg   1  \u{1F50B}
  or       2 Reg   0.5\u{1F50B}
  and      2 Reg   0.5\u{1F50B}
  xor      2 Reg   0.5\u{1F50B}

All 2 register operations store the result in the first register.
"or A B" will modify register A.
"mov A B" will copy register B value into register A.\`\`\``;