const Telegraf = require('telegraf');

const Extra = require('telegraf/Extra');
const Markup = require('telegraf/markup');
const NodeCache = require('node-cache');
const fetch = require('node-fetch');
const queryString = require('query-string');

const BOT_TOKEN = process.env.BOT_TOKEN;
const bot = new Telegraf(BOT_TOKEN);
const baseServer = process.env.BASE_SERVER;

// Set up web-hooks to receive update from telegram
if (process.env.NODE_ENV === 'production') {
  console.log('im in production');
  const PORT = process.env.PORT || 3130;
  const URL = process.env.URL || 'https://buscheckertelegrambot.herokuapp.com';

  bot.telegram.setWebhook(`${URL}/bot${BOT_TOKEN}`);
  bot.startWebhook(`/bot${BOT_TOKEN}`, null, PORT);
}

// Create Cache which store userID as key and last mentioned bus stop as value
const BusStopCache = new NodeCache();
// Create Cache which store userID as key and last mentioned bus number as value
const BusNoCache = new NodeCache();

//Utility Function
function buildQueryUrl(url, resc) {
  return (code) => {
    return url + resc + code;
  };
}

function isEmptyResult(result) {
  let check =
    (Array.isArray(result) && result.length === 0) ||
    (Object.keys(result).length === 0 && result.constructor === Object);

  return check;
}

// URL for api calls
const busStopByCode = buildQueryUrl(baseServer, 'api/busstop/code/');
const busStopByLocation = buildQueryUrl(baseServer, 'api/busstop/desc/');
const busArrivalByStop = buildQueryUrl(baseServer, 'api/busarrival/code/');
const busArrivalByCoordinate = buildQueryUrl(
  baseServer,
  'api/busstop/location/'
);

// RegEx for matching
let reBusStopCommand = /^[/](\d{5})/;
let reBus = /[A-Za-z]{0,2}\d{1,3}[A-Za-z]{0,2}/;
let reLocation = /[a-zA-Z]{3,}\d*/;

bot.use(Telegraf.log());

bot.start((ctx) =>
  ctx.reply(
    'Welcome to Bus Checker for Singapore Buses\nYou may start by sending either\nTell me the following:\n- Your bus number  ie: 10 \n-Your bus stop code ie: 10339 \n-Your location in text  ie: Toa Payoh'
  )
);

bot.hears(reBusStopCommand, async (ctx) => {
  const code = ctx.message.text.substring(1);
  // Check Bus Stop and get location
  let busStopResult = await fetch(busStopByCode(code));
  let busNo = BusNoCache.take(ctx.message.from.id);
  let reply = '';
  busStopResult = await busStopResult.json();

  if (isEmptyResult(busStopResult)) {
    ctx.reply('No Such Bus Stop');
    return;
  }

  //Send Location with text
  bot.telegram.sendVenue(
    ctx.chat.id,
    busStopResult.Latitude,
    busStopResult.Longitude,
    `${code} - ${busStopResult.Description}`,
    'Ok what bus'
  );

  BusStopCache.set(ctx.message.from.id, code, 5000);

  let busArrivalResults = await fetch(busArrivalByStop(code));
  busArrivalResults = await busArrivalResults.json();

  if (isEmptyResult(busArrivalResults)) {
    ctx.reply('No Bus Service Liao');
    return;
  }

  payload = busArrivalResults.Services.map((service) => {
    if (service.ServiceNo === busNo) {
      reply = service.NextBus.EstimatedArrivalTime;
    }
    return {
      ServiceNo: service.ServiceNo,
      EstimatedArrivalTime: service.NextBus.EstimatedArrivalTime,
    };
  });

  // Check memory if user have mentioned bus service previously
  if (busNo) {
    if (!reply) {
      ctx.reply(`This Station ${code} dont have Bus ${busNo} leh`);
    } else {
      ctx.reply(`Bus ${busNo} Will Arrive ${reply}`);
    }
  }

  let button = payload.map((service) => {
    return `${service.ServiceNo}`;
  });

  ctx.reply(
    `Available Bus Service No.`,
    Markup.keyboard(button, {
      columns: 3,
    })
      .oneTime()
      .resize()
      .extra()
  );
});

bot.hears(reBus, async (ctx) => {
  let stopCode = BusStopCache.get(ctx.message.from.id);
  let busNo = ctx.message.text;
  let reply = '';

  if (!stopCode) {
    ctx.reply(`ok ${busNo}`);
    success = BusNoCache.set(ctx.message.from.id, busNo, 5000);
    console.log(BusNoCache.keys());
    console.log(BusNoCache.get(ctx.message.from.id));

    ctx.reply(
      `Where are you now?`,
      Markup.keyboard(
        [[Markup.locationRequestButton('Send location')], ['Search By Text']],
        {
          columns: 2,
        }
      )
        .oneTime()
        .resize()
        .extra()
    );
    return;
  }

  let busArrivalResults = await fetch(busArrivalByStop(stopCode));
  busArrivalResults = await busArrivalResults.json();

  if (isEmptyResult(busArrivalResults)) {
    ctx.reply('No Bus Service Liao');
    return;
  }

  busArrivalResults.Services.forEach((service) => {
    if (service.ServiceNo === busNo) {
      reply = service.NextBus.EstimatedArrivalTime;
    }
  });

  if (!reply) {
    ctx.reply(`This Station ${stopCode} dont have Bus ${busNo} leh`);

    ctx.reply(
      `Where are you now?`,
      Markup.keyboard(
        [[Markup.locationRequestButton('Send location')], ['Search By Text']],
        {
          columns: 2,
        }
      )
        .oneTime()
        .resize()
        .extra()
    );

    return;
  }

  ctx.reply(`Bus ${busNo} Will Arrive ${reply}`);
  return;
});

bot.hears('Search By Text', (ctx) => {
  ctx.reply('Send me your place in following format \nToa Payoh\nClarke Quay');
  return;
});

bot.hears(reLocation, async (ctx) => {
  const location = ctx.message.text;
  // Check Bus Stop and get location
  let busStopResult = await fetch(busStopByLocation(location));
  busStopResult = await busStopResult.json();

  if (isEmptyResult(busStopResult)) {
    ctx.reply('No Such Bus Stop');
    return;
  }

  let replyText = '';

  busStopResult.forEach((busStop) => {
    replyText += `${busStop.Description} \n${busStop.RoadName} /${busStop.BusStopCode} \n\n`;
  });

  ctx.reply('Which of these stops?');
  ctx.reply(replyText);
  return;
});

bot.on('location', async (ctx) => {
  let latitude = parseFloat(ctx.message.location.latitude);
  let longitude = parseFloat(ctx.message.location.longitude);

  results = await fetch(
    queryString.stringifyUrl({
      url: busArrivalByCoordinate(''),
      query: {
        latitude,
        longitude,
      },
    })
  );
  results = await results.json();

  if (isEmptyResult(results)) {
    ctx.reply('No Bus Stop within 200m of your location');
    return;
  }

  let replyText = '';

  results.forEach((busStop) => {
    replyText += `${busStop.Description} \n${busStop.RoadName} /${busStop.BusStopCode} \n\n`;
  });

  ctx.reply('Which of these stops?');
  ctx.reply(replyText);
  return;
});

bot.launch();
