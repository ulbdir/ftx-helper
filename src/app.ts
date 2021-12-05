import { RestClient } from "ftx-api";
import { resourceLimits } from "worker_threads";

import {api_key, api_secret} from "./api_key_private";

class Order {
    id: string = "";
    time: number = 0;
    market: string = "";
    size: number = 0;
    price: number = 0;
    side: "buy" | "sell" = "buy";

    constructor(order:any) {
        this.id = order.id;
        this.time = Math.trunc(Date.parse(order.createdAt) / 1000);
        this.market = order.market;
        this.size = order.filledSize;
        this.price = order.avgFillPrice;
        this.side = order.side;
        console.log([this])
    }

    public toString(): string {
        return this.side + " " + this.size + " @ " + this.price;
    }
}

class Trade {
    id: number = 0;
    market: string;
    price: number = 0;    
    side: "buy" | "sell" = "buy";
    size: number = 0;
    time: number = 0;
    fee: number = 0;

    /**
      Construct from getFills response:
     
      {
      "fee": 20.1374935,
      "feeCurrency": "USD",
      "feeRate": 0.0005,
      "future": "EOS-0329",
      "id": 11215,
      "liquidity": "taker",
      "market": "EOS-0329",
      "baseCurrency": null,
      "quoteCurrency": null,
      "orderId": 8436981,
      "tradeId": 1013912,
      "price": 4.201,
      "side": "buy",
      "size": 9587,
      "time": "2019-03-27T19:15:10.204619+00:00",
      "type": "order"
    }
     * @param trade 
     */
    constructor(trade:any) {
        this.id = trade.id;
        this.market = trade.market;
        this.price = trade.price;
        this.side = trade.side;
        this.size = trade.size;
        this.time = Date.parse(trade.time) / 1000;
        this.fee = trade.fee;
    }

    toShortString(): string {
        return this.side + " " + this.size + "@" + this.price + " (" + this.size * this.price + ")";
    }
}

class OpenPosition {
    /**
     {
      future: 'SOL-PERP',
      size: 9.32,
      side: 'buy',
      netSize: 9.32,
      longOrderSize: 0,
      shortOrderSize: 0,
      cost: 2162.939,
      entryPrice: 232.075,
      unrealizedPnl: 0,
      realizedPnl: 352.93664671,
      initialMarginRequirement: 0.1,
      maintenanceMarginRequirement: 0.03,
      openSize: 9.32,
      collateralUsed: 216.2939,
      estimatedLiquidationPrice: 0,
      recentAverageOpenPrice: 214.5086936695279,
      recentPnl: 163.717975,
      recentBreakEvenPrice: 214.5086936695279,
      cumulativeBuySize: 9.32,
      cumulativeSellSize: 0
    },
     */

    market: string = "";
    side: "buy" | "sell" = "buy";
    size: number = 0;
    entryPrice: number = 0;

    constructor(pos: any) {
        this.market = pos.future;
        this.side = pos.side;
        this.size = pos.size;
        this.entryPrice = pos.recentAverageOpenPrice;
    }
}

class FundingPayment {
    id: number = 0;
    market: string = "";
    fee: number = 0;
    
    // unix timestamp in seconds
    time: number = 0;

    constructor(fee: any) {
        this.id = fee.id;
        this.market = fee.future;
        this.fee = fee.payment;
        this.time = Date.parse(fee.time) / 1000;
    }
}

class MarketSummary {
    market: string = "";
    trades: Trade[] = []
    openPositions: OpenPosition[] = [];
    fundingPayments: FundingPayment[] = [];

    constructor(market: string) {
        this.market = market;
        this.trades = [];
        this.openPositions = [];
        this.fundingPayments = [];
    }

    computePnL(): number {
        var pnl = 0;
        
        // Add up trades
        for (let trade of this.trades) {
            if (trade.side == "buy") {
                pnl = pnl - (trade.size * trade.price);
            } else {
                pnl = pnl + (trade.size * trade.price);
            }
        //console.debug(trade.toShortString(),":",pnl);
        }

        // Adjust for open positions
        for (let pos of this.openPositions) {
            if (pos.side == "buy") {
                pnl = pnl + (pos.size * pos.entryPrice);
            } else {
                pnl = pnl - (pos.size * pos.entryPrice);
            }
        }

        return pnl;
    }

    computeFundingPayments(): number {
        var result = 0;
        for (let p of this.fundingPayments) {
            result += p.fee;
        }
        return result;
    }

    computeFundingPayments24h(): number {
        var result = 0;

        var time24hago: number = Date.now() / 1000 - 86400;

        for (let p of this.fundingPayments) {
            if (p.time >= time24hago) {
                result += p.fee;
            }
        }
        return result;
    }
}

async function getAllOrders(client:RestClient) {
    var result: Order[] = [];
    var highest_time: number = -1;
    var lowest_time: number = -1;
    let limit: number = 100;
    
    while(true) {
        let orders = undefined;
        if (lowest_time > 0) {
            orders = await client.getOrderHistory({ end_time: lowest_time, limit: limit });
        } else {
            orders = await client.getOrderHistory({limit: limit});
        }

        for (let order of orders.result) {
            if (order.status=="closed") {
                result.push(new Order(order))
            }
            let order_time: number = Math.trunc(Date.parse(order.createdAt) / 1000);

            if (highest_time < 0) {
                highest_time = order_time;
            } else if (order_time > highest_time) {
                highest_time = order_time;
            }

            if (lowest_time < 0) {
                lowest_time = order_time;
            } else if (order_time < lowest_time) {
                lowest_time = order_time;
            }
        }
        //console.log("Got", orders.result.length,"with lowest_time", new Date(lowest_time*1000).toDateString(),"and highest time", new Date(highest_time*1000).toDateString());

        if (orders.result.length < limit) {
            break;
        }
    }

    // remove duplicates by id and return
    return result.filter((order, pos, ar) => { return ar.findIndex((order2) => { return order.id == order2.id; }) == pos; })
}

async function getAllTrades(client: RestClient): Promise<Trade[]> {
    return new Promise<Trade[]>(async (resolve, reject) => {
        var result: Trade[] = [];
        var highest_time: number = -1;
        var lowest_time: number = -1;
        let limit: number = 50;
        
        while(true) {
            let trades = undefined;
            if (lowest_time > 0) {
                trades = await client.getFills({ end_time: lowest_time, limit: limit});
                console.log("getFills(", lowest_time,")");
            } else {
                trades = await client.getFills({limit: limit});
                console.log("getFills()");
            }

            var times = [];

            for (let trade of trades.result) {
                if ((trade.type == "order") && (trade.market.endsWith("-PERP"))) {
                    result.push(new Trade(trade))
                }
                let order_time: number = Math.trunc(Date.parse(trade.time) / 1000);

                times.push({time: order_time, id: trade.id});

                if (highest_time < 0) {
                    highest_time = order_time;
                } else if (order_time > highest_time) {
                    highest_time = order_time;
                }
    
                if (lowest_time < 0) {
                    lowest_time = order_time;
                } else if (order_time < lowest_time) {
                    lowest_time = order_time;
                }
            }
          
            times = times.sort(function (a, b) {  return b.time - a.time;  });

            if (times.length > 0) {
                lowest_time = times[times.length-1].time;
            }

            lowest_time = lowest_time + 1;

//            for (let t of times) { console.log(t); }
//            console.log("");

            if (trades.result.length <= 1) {
                 break;
            }
        }
    
        // remove duplicates by id and return
        resolve(result.filter((trade, pos, ar) => { return ar.findIndex((order2) => { return trade.id == order2.id; }) == pos; }));
    });
}

async function getAllFundingPayments(client: RestClient): Promise<FundingPayment[]> {
    return new Promise<FundingPayment[]>(async (resolve, reject) => {
        var result: FundingPayment[] = [];
        var highest_time: number = -1;
        var lowest_time: number = -1;
        let limit: number = 50;
        
        while(true) {
            let payments = undefined;
            if (lowest_time > 0) {
                payments = await client.getFundingPayments({ end_time: lowest_time });
                console.log("getAllFundingPayments(", lowest_time, ")")
            } else {
                payments = await client.getFundingPayments();
                console.log("getAllFundingPayments()")
            }

            var times = [];

            for (let payment of payments.result) {
                result.push(new FundingPayment(payment))
                let order_time: number = Math.trunc(Date.parse(payment.time) / 1000);

                times.push({time: order_time, id: payment.id});

                if (highest_time < 0) {
                    highest_time = order_time;
                } else if (order_time > highest_time) {
                    highest_time = order_time;
                }
    
                if (lowest_time < 0) {
                    lowest_time = order_time;
                } else if (order_time < lowest_time) {
                    lowest_time = order_time;
                }
            }
          
            times = times.sort(function (a, b) {  return b.time - a.time;  });

            if (times.length > 0) {
                lowest_time = times[times.length-1].time;
            }

            lowest_time = lowest_time + 1;

//            for (let t of times) { console.log(t); }
//            console.log("");

            if (payments.result.length <= 1) {
                 break;
            }
        }
    
        // remove duplicates by id and return
        resolve(result.filter((trade, pos, ar) => { return ar.findIndex((order2) => { return trade.id == order2.id; }) == pos; }));
    });
}


async function getAllOpenPositions(client: RestClient): Promise<OpenPosition[]> {
    return new Promise<OpenPosition[]>(async (resolve, reject) => {
        var positions: OpenPosition[] = [];
        
        var result = await client.getPositions(true);

        //console.log(result);

        for (let pos of result.result) {
            if (pos.size > 0) {
                positions.push(new OpenPosition(pos))
            }
        }
        
        resolve(positions);
    });
}

function createMarketSummary(trades: Trade[], positions: OpenPosition[], payments: FundingPayment[]): Map<string, MarketSummary> {
    var result = new Map<string, MarketSummary>();
    
    // Group trades by markets
    for (let trade of trades) {
        if (result.has(trade.market)) {
            result.get(trade.market)?.trades.push(trade);
        } else {
            let ms = new MarketSummary(trade.market);
            ms.trades.push(trade);
            result.set(trade.market, ms);
        }
    }

    // Add open positions
    for (let pos of positions) {
        if (result.has(pos.market)) {
            result.get(pos.market)?.openPositions.push(pos);
        }
    }

    // Add funding fees
    for (let payment of payments) {
        if (result.has(payment.market)) {
            result.get(payment.market)?.fundingPayments.push(payment);
        }
    }

    return result
}

const init = async () => {

    var client = new RestClient(api_key, api_secret, { disable_time_sync: false });

    try {
        let trades = await getAllTrades(client);
        let openPositions = await getAllOpenPositions(client);
        let fundingPayments = await getAllFundingPayments(client);

        var markets = createMarketSummary(trades, openPositions, fundingPayments);
/**
        console.log(markets.get("ADA-PERP"));
        console.log(markets.get("ADA-PERP")?.computePnL());
*/
        var pnl: number = 0;
        var fp: number = 0;
        var fp24: number = 0;
        markets.forEach((ms) => {
            let mpnl = ms.computePnL();
            let mfunding = ms.computeFundingPayments();
            let funding24 = ms.computeFundingPayments24h();
            pnl += mpnl;
            fp += mfunding;
            fp24 += funding24;

            console.log("PnL for", ms.market,"is", mpnl-mfunding,"(PnL", mpnl,"funding payments total", mfunding, "funding payments last 24h", funding24, ")");
            console.log("   Trades:");
            for (let trade of ms.trades) {
                let dt = new Date(trade.time*1000);
                //let dts: string = dt.getFullYear().toString()+"-"+dt.getMonth().toString()+"-"+dt.getDay().toString();
                let dts: string = dt.toString();
                console.log("      ", trade.side, trade.size,"@",trade.price,"(",trade.size*trade.price,") at", dts);
            }
            if (ms.openPositions.length > 0) {
                console.log("   Open Positions:");
                for (let pos of ms.openPositions) {
                    console.log("      ", pos.side, pos.size,"@",pos.entryPrice,"(",pos.size*pos.entryPrice,")");
                }
            }
            
            console.log("");
        });
        console.log("Total PnL", pnl - fp, "(PnL", pnl, "funding payments", fp,"funding payments last 24h", fp24, ")");

    } catch (e) {
        console.error('get method failed: ', e);
    }

    process.exit();
};

init()