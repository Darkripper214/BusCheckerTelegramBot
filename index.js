const Telegraf = require('telegraf');

const Extra = require('telegraf/Extra');
const Markup = require('telegraf/markup');
const NodeCache = require('node-cache');
const fetch = require('node-fetch');

const bot = new Telegraf(process.env.BOT_TOKEN);
const baseServer = process.env.BASE_SERVER;

// Create Cache which store userID as key and last mentioned bus stop as value
const BusStopCache = new NodeCache();

//Utility Function
function buildQueryUrl(url, resc) {
  return (code) => {
    return url + resc + code;
  };
}

function isEmptyResult(result) {
  let check =
    (Array.isArray(result) && result.length) ||
    !(Object.keys(result).length === 0 && result.constructor === Object);
  return !check;
}
// URL for api calls
const busStopByCode = buildQueryUrl(baseServer, 'api/busstop/code/');
const busStopByLocation = buildQueryUrl(baseServer, 'api/busstop/desc/');
const busArrivalByStop = buildQueryUrl(baseServer, 'api/busarrival/code/');

// RegEx for matching
let reBusStopCommand = /^[/](\d{5})/;
let reBus = /[A-Za-z]{0,2}\d{1,3}[A-Za-z]{0,2}/;
let reLocation = /[a-zA-Z]{0,}\d*/;

bot.use(Telegraf.log());

bot.hears(reBusStopCommand, async (ctx) => {
  const code = ctx.message.text.substring(1);
  // Check Bus Stop and get location
  let busStopResult = await fetch(busStopByCode(code));
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
    return {
      ServiceNo: service.ServiceNo,
      EstimatedArrivalTime: service.NextBus.EstimatedArrivalTime,
    };
  });

  let button = payload.map((service) => {
    return `${service.ServiceNo}`;
  });
  console.log(button);

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

bot.command('start', (ctx) => {
  ctx.reply('Tell me either \n - Your bus number \n -Your bus stop code');
});

bot.hears(reBus, async (ctx) => {
  let stopCode = BusStopCache.get(ctx.message.from.id);
  let busNo = ctx.message.text;
  let reply = '';

  if (!stopCode) {
    ctx.reply(`ok ${busNo}`);

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

  busArrivalResults.Services.forEach((service) => {
    if (service.ServiceNo === busNo) {
      reply = service.NextBus.EstimatedArrivalTime;
    }
  });

  ctx.reply(`Bus ${busNo} Will Arrive ${reply}`);
});

bot.hears('Search By Text', (ctx) => {
  ctx.reply(
    'Send me your place in following format \nPlace: Toa Payoh\nPlace: Clarke Quay'
  );
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

  console.log(busStopResult);
  let replyText = '';

  busStopResult.forEach((busStop) => {
    replyText += `${busStop.Description} \n${busStop.RoadName} /${busStop.BusStopCode} \n`;
  });

  ctx.reply('Which of these stops?');
  ctx.reply(replyText);
  return;
});
bot.launch();
