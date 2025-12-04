const cron = require("node-cron");
const Orders = require("../models/Orders");
const Securities = require("../models/Securities"); // Corrected model name
const User = require("../models/User");
const Portfolio = require("../models/Portfolio");
const UserHoldings = require("../models/UserHolding"); // Corrected model name
const Transactions = require("../models/Transactions");
const axios = require("axios");
const Company = require("../models/Company");
const MutualFund = require("../models/MutualFund"); // New import
const mongoose = require("mongoose");
const { DateTime } = require("luxon");
const {
  getSimulatedPrevDate,
  getSimulatedNextDate,
} = require("../utils/DateUtils");
require("dotenv").config();

// RapidAPI Configuration
const RAPIDAPI_KEY = process.env.REACT_APP_RAPIDAPI_KEY;
const RAPIDAPI_HOSTNAME = process.env.REACT_APP_RAPIDAPI_HOSTNAME;
const RAPIDAPI_BASE_URL_INTRADAY =
  process.env.REACT_APP_RAPIDAPI_BASE_URL_INTRADAY;
const MFAPI_BASE_URL = process.env.REACT_APP_MFAPI_BASE_URL;

async function getTodayHistoricalSecurityPricesFromDB(
  securityId,
  securityType,
  startDate
) {
  try {
    const endOfDay = new Date();
    endOfDay.setDate(endOfDay.getDate() + 1);
    endOfDay.setHours(0, 0, 0, 0);

    const prices = await Securities.find({
      security_id: securityId,
      security_type: securityType,
      date: {
        $gte: startDate,
        $lt: endOfDay,
      },
      granularity: "1min",
    }).sort({ date: 1 });

    return prices;
  } catch (error) {
    console.error(
      `Error fetching historical prices for ${securityId} from DB:`,
      error
    );
    return [];
  }
}

async function updateMutualOrderStatusInDB(order, nav, updationDate) {
  let {
    quantity,
    order_type,
    security_id,
    security_type,
    user_id,
    order_sub_type,
  } = order;
  const action = order_type;
  let amount = quantity * nav;
  if (action === "Buy") {
    amount *= -1;
  }
  try {
    //USER VALIDATION
    const user = await User.findById(user_id);
    if (!user) {
      console.log(`User with ID ${user_id} not found.`);
      return;
    }
    // PORTFOLIO VALIDATION
    const portfolio = await Portfolio.findOne({ user_id: user_id });
    if (!portfolio) {
      console.log(`User portfolio for ID ${user_id} not found.`);
      return;
    }
    //ORDER VALIDATION
    const orderForUpdate = await Orders.findById(order._id);
    if (!orderForUpdate) {
      console.log(`Order with ID ${order._id} not found.`);
      return;
    }
    // SECURITY VALIDATION
    let security;
    if (security_type === "mutualfund") {
      security = await MutualFund.findById(security_id);
    }
    if (!security) {
      // check if mutual fund exists
      console.log(`Security with ID ${security_id} not found.`);
      return;
    }
    // Determine if it's the right time to process a SIP/SWP (mutual fund pending order can only be SIP or SWP)
    if (order_sub_type !== "MARKET") {
      const today = new Date(updationDate);
      const lastProcessedDate = new Date(order.order_updation_date);
      let isDue = false;

      if (order.frequency === "DAILY") {
        isDue = true;
      } else if (order.frequency === "WEEKLY") {
        const daysDiff = Math.floor(
          (today - lastProcessedDate) / (1000 * 60 * 60 * 24)
        );
        if (daysDiff >= 7) {
          isDue = true;
        }
      } else if (order.frequency === "MONTHLY") {
        if (today.getDate() === lastProcessedDate.getDate()) {
          const monthsDiff =
            (today.getFullYear() - lastProcessedDate.getFullYear()) * 12 +
            (today.getMonth() - lastProcessedDate.getMonth());
          if (monthsDiff >= 1) {
            isDue = true;
          }
        }
      }

      if (!isDue) {
        return;
      }
    }

    // USER HOLDING VALIDATION
    let userHolding = await UserHoldings.findOne({
      portfolio_id: portfolio._id,
      security_id: security_id,
      security_type: security_type,
    });
    let partialFill = false;
    if (action === "Sell") {
      if (!userHolding) {
        quantity = 0;
        amount = 0;
        partialFill = true;
      } else if (userHolding.quantity < quantity) {
        quantity = userHolding.quantity;
        amount = quantity * nav;
        partialFill = true;
      }
    } else {
      if (user.balance + amount < 0) {
        partialFill = true;
        quantity = user.balance / nav;
        amount = quantity * nav;
      }
    }

    orderForUpdate.order_updation_date = updationDate;
    orderForUpdate.filled_quantity += quantity;
    const totalFilled = orderForUpdate.filled_quantity;
    orderForUpdate.average_fill_price =
      (orderForUpdate.average_fill_price * (totalFilled - quantity) +
        nav * quantity) /
      totalFilled;
    if (order_sub_type === "MARKET") {
      if (partialFill && quantity === 0) {
        orderForUpdate.status = "REJECTED";
      } else {
        orderForUpdate.status = partialFill ? "PARTIALLY_FILLED" : "FILLED";
      }
    }

    await orderForUpdate.save();

    // not enough balance or holdings to fulfill any part of the order, hence no transaction or change in user holdings
    if (partialFill && quantity === 0) {
      return;
    }
    //transaction add
    const transaction = await Transactions.create({
      user_id: user_id,
      security_id: security_id,
      security_type: security_type,
      action: action,
      trade_price: nav,
      quantity: quantity,
      date: updationDate,
    });
    user.balance += amount;
    await user.save();
    if (userHolding) {
      if (action === "Buy") {
        const total =
          userHolding.average_price * userHolding.quantity + nav * quantity;
        userHolding.quantity += quantity;
        userHolding.average_price = total / userHolding.quantity;
        await userHolding.save();
      } else {
        userHolding.quantity -= quantity;
        if (userHolding.quantity === 0) {
          await UserHoldings.deleteOne({ _id: userHolding._id });
        } else {
          await userHolding.save();
        }
      }
    } else if (action === "Buy") {
      const updatedUserHolding = await UserHoldings.create({
        portfolio_id: portfolio._id,
        security_id: security_id,
        security_type: security_type,
        quantity: quantity,
        average_price: nav,
      });
    }
    console.log(
      `Order ${order._id} for ${quantity} units of ${security.name} at ${nav} has been updated.`
    );
  } catch (error) {
    console.error("Error updating mutual fund order status:", error);
  }
}

async function fulfillMutualFundOrdersDaily(orderId) {
  try {
    const order = await Orders.findById(orderId);
    if (!order) {
      console.log(`Mutual Fund Order with ID ${orderId} not found.`);
      return;
    }

    // Get the latest NAV from the database
    const latestNavData = await Securities.findOne({
      security_id: order.security_id,
      security_type: "mutualfund",
      date: { $lte: new Date() },
    }).sort({ date: -1 });

    if (order.status === "CANCEL_REQUESTED" && !latestNavData) {
      order.status = "CANCELLED"; // Confirm the cancellation
      await order.save();
      return;
    }

    if (!latestNavData) {
      console.log(
        `No latest NAV data found for mutual fund ${order.security_id}`
      );
      return;
    }

    if (order.status === "CANCEL_REQUESTED") {
      if (latestNavData.date > order.order_updation_date) {
        order.status = "CANCELLED"; // Confirm the cancellation
        await order.save();
        return;
      } else {
        const nav = latestNavData.nav;
        await updateMutualOrderStatusInDB(order, nav, latestNavData.date);
        // check order status after update
        const updatedOrder = await Orders.findById(orderId);
        if (updatedOrder.order_sub_type !== "MARKET") {
          updatedOrder.status = "CANCELLED"; // Cancel future installments
          await updatedOrder.save();
        }
      }
    }
  } catch (error) {
    console.error("Error fulfilling mutual fund order:", error);
  }
}

async function updateOrderStatusInDB(order, price, updationDate) {
  let { quantity, order_type, security_id, security_type, user_id } = order;
  let action = order_type;
  try {
    let amountToAdd = quantity * price;
    if (action === "Buy") {
      amountToAdd *= -1;
    }
    //USER VALIDATION
    let user = await User.findById(user_id);
    if (!user) {
      console.log(`User with ID ${user_id} not found.`);
      return;
    }

    // PORTFOLIO VALIDATION
    let portfolio = await Portfolio.findOne({ user_id: user_id });
    if (!portfolio) {
      console.log(`User portfolio for ID ${user_id} not found.`);
      return;
    }

    //ORDER VALIDATION
    let orderForUpdate = await Orders.findById(order._id);
    if (!orderForUpdate) {
      console.log(`Order with ID ${order._id} not found.`);
      return;
    }

    let security;
    if (security_type === "company") {
      // check if company exists
      security = await Company.findById(security_id);
    }
    if (!security) {
      console.log(`Security with ID ${security_id} not found.`);
      return;
    }

    let userHolding = await UserHoldings.findOne({
      portfolio_id: portfolio._id,
      security_id: security_id,
      security_type: security_type,
    });

    let partialFill = false;
    if (action === "Sell") {
      if (!userHolding) {
        quantity = 0;
        amountToAdd = 0;
        partialFill = true;
      } else if (userHolding.quantity < quantity) {
        quantity = userHolding.quantity;
        amountToAdd = quantity * price;
        partialFill = true;
      }
    } else {
      if (user.balance + amountToAdd < 0) {
        partialFill = true;
        quantity = user.balance / price;
        amountToAdd = quantity * price;
      }
    }

    if (partialFill) {
      orderForUpdate.status = quantity === 0 ? "REJECTED" : "PARTIALLY_FILLED";
    } else {
      orderForUpdate.status = "FILLED";
    }

    orderForUpdate.order_updation_date = updationDate;
    orderForUpdate.filled_quantity = quantity;
    orderForUpdate.average_fill_price = price;
    await orderForUpdate.save();

    // RETURN IF ORDER GOT REJECTED
    if (partialFill && quantity === 0) {
      return;
    }

    //transaction mei will save
    const transaction = await Transactions.create({
      user_id: user_id,
      security_id: security_id,
      security_type: security_type,
      action: action,
      trade_price: price,
      quantity: quantity,
      date: updationDate,
    });

    user.balance += amountToAdd;
    await user.save();

    if (userHolding) {
      if (action === "Buy") {
        const total =
          userHolding.average_price * userHolding.quantity + price * quantity;
        userHolding.quantity += quantity;
        userHolding.average_price = total / userHolding.quantity;
        await userHolding.save();
      } else {
        userHolding.quantity -= quantity;
        if (userHolding.quantity === 0) {
          await UserHoldings.deleteOne({ _id: userHolding._id });
        } else {
          await userHolding.save();
        }
      }
    } else if (action === "Buy") {
      const updatedUserHolding = await UserHoldings.create({
        portfolio_id: portfolio._id,
        security_id: security_id,
        security_type: security_type,
        quantity: quantity,
        average_price: price,
      });
    }

    console.log(
      `Order ${order._id} for ${quantity} units of ${security.name} at ${price} has been updated.`
    );
  } catch (error) {
    console.error("Error updating order status:", error);
  }
}

async function fulfillStopLimitOrdersDaily(orderId) {
  try {
    const order = await Orders.findById(orderId);
    if (!order) return;
    const {
      _id: order_id,
      security_id,
      security_type,
      stop_price,
      order_type,
    } = order;

    const historicalPrices = await getTodayHistoricalSecurityPricesFromDB(
      security_id,
      security_type,
      order.date
    );
    let updation_date = new Date();
    if (historicalPrices && historicalPrices.length > 0) {
      let fulfilled = false;
      for (const pricePoint of historicalPrices) {
        if (order.status === "CANCEL_REQUESTED") {
          const priceTime = new Date(pricePoint.date); // Intraday timestamp
          const cancelTime = new Date(order.order_updation_date);

          // If the price candle is AFTER the user clicked cancel, ignore it and stop
          if (priceTime > cancelTime) {
            break;
          }
        }
        if (
          (order_type === "Buy" && pricePoint.high_price >= stop_price) ||
          (order_type === "Sell" && pricePoint.low_price <= stop_price)
        ) {
          fulfilled = true;
          updation_date = pricePoint.date;
          break;
        }
      }
      if (fulfilled) {
        order.order_sub_type = "LIMIT";
        order.order_updation_date = updation_date;
        await order.save();
        await fulfillLimitOrdersDaily(order_id);
      } // It didn't fill. Now we decide: Reject (Day end) or Confirm Cancel?
      else {
        if (order.status === "CANCEL_REQUESTED") {
          order.status = "CANCELLED"; // Confirm the cancellation
          order.order_updation_date = new Date();
          await order.save();
        } else if (order.time_in_force === "DAY") {
          order.status = "REJECTED";
          await order.save();
        }
      }
    } else {
      console.log(
        `Could not fetch historical prices for ${security_id} for order ${order_id}`
      );
    }
  } catch (error) {
    console.error("Error during daily stop limit order check:", error);
  }
}

async function fulfillLimitOrdersDaily(orderId) {
  try {
    const order = await Orders.findById(orderId);
    const {
      _id: order_id,
      security_id,
      security_type,
      limit_price,
      order_type,
    } = order;

    const historicalPrices = await getTodayHistoricalSecurityPricesFromDB(
      security_id,
      security_type,
      order.date
    );

    if (historicalPrices && historicalPrices.length > 0) {
      let fulfilled = false;
      let price = 0;
      let updationDate = new Date(); // Set the updation date to now
      for (const pricePoint of historicalPrices) {
        if (order.status === "CANCEL_REQUESTED") {
          const priceTime = new Date(pricePoint.date); // Intraday timestamp
          const cancelTime = new Date(order.order_updation_date);

          // If the price candle is AFTER the user clicked cancel, ignore it and stop
          if (priceTime > cancelTime) {
            break;
          }
        }
        if (order_type === "Buy" && pricePoint.low_price <= limit_price) {
          price = pricePoint.low_price;
          fulfilled = true;
          updationDate = pricePoint.date;
          break; // Once fulfilled, no need to check further for this order
        } else if (
          order_type === "Sell" &&
          pricePoint.high_price >= limit_price
        ) {
          price = pricePoint.high_price;
          fulfilled = true;
          updationDate = pricePoint.date;
          break; // Once fulfilled, no need to check further for this order
        }
      }
      if (fulfilled) {
        await updateOrderStatusInDB(order, price, updationDate);
      } else {
        // It didn't fill. Now we decide: Reject (Day end) or Confirm Cancel?
        if (order.status === "CANCEL_REQUESTED") {
          order.status = "CANCELLED"; // Confirm the cancellation
          order.order_updation_date = new Date();
          await order.save();
        } else if (order.time_in_force === "DAY") {
          order.status = "REJECTED";
          await order.save();
        }
      }
    } else {
      console.log(
        `Could not fetch historical prices for ${security_id} for order ${order_id}`
      );
    }
  } catch (error) {
    console.error("Error during daily limit order check:", error);
  }
}

async function fulfillstopLossOrdersDaily(orderId) {
  try {
    const order = await Orders.findById(orderId);
    const {
      _id: order_id,
      security_id,
      security_type,
      stop_price,
      order_type,
    } = order;

    const historicalPrices = await getTodayHistoricalSecurityPricesFromDB(
      security_id,
      security_type,
      order.date
    );

    if (historicalPrices && historicalPrices.length > 0) {
      let fulfilled = false;
      let price = 0;
      const updationDate = new Date(); // Set the updation date to now
      for (const pricePoint of historicalPrices) {
        if (order.status === "CANCEL_REQUESTED") {
          const priceTime = new Date(pricePoint.date); // Intraday timestamp
          const cancelTime = new Date(order.order_updation_date);

          // If the price candle is AFTER the user clicked cancel, ignore it and stop
          if (priceTime > cancelTime) {
            break;
          }
        }
        if (order_type === "Buy" && pricePoint.high_price >= stop_price) {
          price = pricePoint.low_price;
          fulfilled = true;
          updationDate = pricePoint.date;
          break; // Once fulfilled, no need to check further for this order
        } else if (
          order_type === "Sell" &&
          pricePoint.low_price <= stop_price
        ) {
          price = pricePoint.high_price;
          fulfilled = true;
          updationDate = pricePoint.date;
          break; // Once fulfilled, no need to check further for this order
        }
      }
      if (fulfilled) {
        await updateOrderStatusInDB(order, price, updationDate);
      } else {
        // It didn't fill. Now we decide: Reject (Day end) or Confirm Cancel?
        if (order.status === "CANCEL_REQUESTED") {
          order.status = "CANCELLED"; // Confirm the cancellation
          order.order_updation_date = new Date();
          await order.save();
        } else if (order.time_in_force === "DAY") {
          order.status = "REJECTED";
          await order.save();
        }
      }
    } else {
      console.log(
        `Could not fetch historical prices for ${security_id} for order ${order_id}`
      );
    }
  } catch (error) {
    console.error("Error during daily Stop Loss order check:", error);
  }
}

async function fulfillTakeProfitOrdersDaily(orderId) {
  try {
    const order = await Orders.findById(orderId);
    const {
      _id: order_id,
      security_id,
      security_type,
      take_profit_price,
      order_type,
    } = order;

    const historicalPrices = await getTodayHistoricalSecurityPricesFromDB(
      security_id,
      security_type,
      order.date
    );

    if (historicalPrices && historicalPrices.length > 0) {
      let fulfilled = false;
      let price = 0;
      const updationDate = new Date();
      for (const pricePoint of historicalPrices) {
        if (order.status === "CANCEL_REQUESTED") {
          const priceTime = new Date(pricePoint.date); // Intraday timestamp
          const cancelTime = new Date(order.order_updation_date);

          // If the price candle is AFTER the user clicked cancel, ignore it and stop
          if (priceTime > cancelTime) {
            break;
          }
        }
        if (order_type === "Buy" && pricePoint.low_price <= take_profit_price) {
          price = pricePoint.low_price;
          fulfilled = true;
          updationDate = pricePoint.date;
          break; // Once fulfilled, no need to check further for this order
        } else if (
          order_type === "Sell" &&
          pricePoint.low_price <= take_profit_price
        ) {
          price = pricePoint.high_price;
          fulfilled = true;
          updationDate = pricePoint.date;
          break; // Once fulfilled, no need to check further for this order
        }
      }
      if (fulfilled) {
        await updateOrderStatusInDB(order, price, updationDate);
      } else {
        // It didn't fill. Now we decide: Reject (Day end) or Confirm Cancel?
        if (order.status === "CANCEL_REQUESTED") {
          order.status = "CANCELLED"; // Confirm the cancellation
          order.order_updation_date = new Date();
          await order.save();
        } else if (order.time_in_force === "DAY") {
          order.status = "REJECTED";
          await order.save();
        }
      }
    } else {
      console.log(
        `Could not fetch historical prices for ${security_id} for order ${order_id}`
      );
    }
  } catch (error) {
    console.error("Error during daily Stop Loss order check:", error);
  }
}

async function fetchUsersAndFulfillOrders() {
  try {
    console.log("Running daily order check...");
    const now = new Date();
    if (now.getDay() === 0 || now.getDay() === 6) {
      // 0 = Sunday, 6 = Saturday
      console.log(`Skipping order fulfillment on weekends.`);
      return;
    }
    // In fetchUsersAndFulfillOrders() function
    const pendingOrders = await Orders.find({
      status: { $in: ["PENDING", "CANCEL_REQUESTED"] },
    }).sort({ date: 1 });
    for (const order of pendingOrders) {
      const {
        _id: orderId,
        security_type: securityType,
        order_sub_type: orderSubType,
      } = order;
      if (securityType === "mutualfund") {
        await fulfillMutualFundOrdersDaily(orderId);
      } else if (securityType === "company") {
        if (orderSubType === "STOP_LIMIT") {
          await fulfillStopLimitOrdersDaily(orderId);
        } else if (orderSubType === "LIMIT") {
          await fulfillLimitOrdersDaily(orderId);
        } else if (orderSubType === "STOP_LOSS") {
          await fulfillstopLossOrdersDaily(orderId);
        } else if (orderSubType === "TAKE_PROFIT") {
          await fulfillTakeProfitOrdersDaily(orderId);
        }
      }
    }
    console.log("ORDERS CHECKED SUCCESSFULLY!");
  } catch (error) {
    console.error("Error during daily order check:", error);
  }
}

async function fetchAndStoreDailyNav() {
  try {
    const mutualFunds = await MutualFund.find(); // Fetch all mutual funds from the database
    const documentsToInsert = [];
    for (const fund of mutualFunds) {
      const response = await axios.get(
        `${MFAPI_BASE_URL}${fund.scheme_code}/latest`
      );
      const navData = response.data.data;
      if (navData && navData.length > 0) {
        const latestNavData = navData[0];
        documentsToInsert.push({
          security_id: fund._id,
          security_type: "mutualfund",
          nav: parseFloat(latestNavData.nav),
          date: getSimulatedNextDate(
            new Date(latestNavData.date.split("-").reverse().join("-"))
          ),
          granularity: "daily",
        });
        console.log(`Fetched latest NAV for ${fund.name}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    // Use bulkWrite to perform upsert operations efficiently
    if (documentsToInsert.length > 0) {
      const bulkOps = documentsToInsert.map((doc) => ({
        updateOne: {
          filter: { security_id: doc.security_id, date: doc.date },
          update: { $set: doc },
          upsert: true,
        },
      }));
      const result = await Securities.bulkWrite(bulkOps);
      console.log(
        `Stored NAV data. Upserted: ${result.upsertedCount}, Modified: ${result.modifiedCount}`
      );
    }
  } catch (error) {
    console.error("Error fetching or storing mutual fund NAV:", error.message);
  }
}

async function fetchAndStoreYesterdayIntradayData(symbol, company_id) {
  const INTRADAY_INTERVAL = "1min";
  try {
    const yesterday = getSimulatedPrevDate();
    yesterday.setHours(0, 0, 0, 0);

    const year = yesterday.getFullYear();
    const month = String(yesterday.getMonth() + 1).padStart(2, "0");
    const day = String(yesterday.getDate()).padStart(2, "0");
    const yesterdayFormatted = `${year}-${month}-${day}`;

    console.log(`Fetching 1-min data for: ${symbol} for ${yesterdayFormatted}`);
    const functionParam = "TIME_SERIES_INTRADAY";

    // ... (axios options remain the same) ...
    const options = {
      method: "GET",
      url: RAPIDAPI_BASE_URL_INTRADAY,
      params: {
        datatype: "json",
        function: functionParam,
        symbol: symbol,
        interval: INTRADAY_INTERVAL,
        outputsize: "full",
      },
      headers: {
        "X-RapidAPI-Key": RAPIDAPI_KEY,
        "X-RapidAPI-Host": RAPIDAPI_HOSTNAME,
      },
    };

    const response = await axios.request(options);
    const data = response.data;
    let storedCount = 0; // Initialize counter

    if (data && data[`Time Series (${INTRADAY_INTERVAL})`]) {
      const timeSeries = data[`Time Series (${INTRADAY_INTERVAL})`];

      for (const timestampStr in timeSeries) {

        // 1. Parse the string as New York Time explicitly
        const nyTime = DateTime.fromFormat(
          timestampStr,
          "yyyy-MM-dd HH:mm:ss",
          { zone: "America/New_York" }
        );

        // 2. Extract the Calendar Date relative to New York (Not UTC)
        const nyDateString = nyTime.toFormat("yyyy-MM-dd");

        // Ensure the data point is from yesterday
        if (nyDateString === yesterdayFormatted) {
          const timestampDate = nyTime.toUTC().toJSDate(); // Convert to UTC Date object
          const securityDate = getSimulatedNextDate(timestampDate); // The final date to store
          const intradayData = timeSeries[timestampStr];
          const updateData = {
            security_id: company_id,
            security_type: "company",
            date: securityDate,
            open_price: parseFloat(intradayData["1. open"]),
            high_price: parseFloat(intradayData["2. high"]),
            low_price: parseFloat(intradayData["3. low"]),
            close_price: parseFloat(intradayData["4. close"]),
            volume: parseInt(intradayData["5. volume"]),
            granularity: "1min",
          };

          // *** FIX: Use updateOne with upsert: true ***
          const result = await Securities.updateOne(
            {
              // Filter (Unique Key)
              security_id: company_id,
              date: securityDate,
              granularity: "1min",
            },
            { $set: updateData }, // Data to set
            { upsert: true } // Insert if not found
          );

          if (result.upsertedId || result.modifiedCount > 0) {
            storedCount++;
          }
        }
      }
      console.log(
        `Successfully upserted ${storedCount} 1-min data points for ${symbol} for yesterday (${yesterdayFormatted})`
      );
    } else if (data && data.Note) {
      console.warn(`Alpha Vantage API Note for ${symbol}: ${data.Note}`);
    } else if (data && data["Error Message"]) {
      console.error(
        `Alpha Vantage API Error for ${symbol}: ${data["Error Message"]}`
      );
    } else {
      console.warn(
        `No intraday data found for ${symbol} for yesterday (${yesterdayFormatted}) in Alpha Vantage response.`
      );
    }
  } catch (error) {
    console.error(`Error fetching or storing intraday data, `, error.message);
  }
}

async function aggregateDailyData() {
  const today = new Date(); // Target "Today" (Simulated Day)

  // 1. Define the Safe Query Window
  // We start at 07:00 UTC to safely skip the previous day's post-market spillover (which ends ~01:00 UTC).
  // We end at 07:00 UTC tomorrow to capture the current day's post-market spillover.
  const queryStart = new Date(today);
  queryStart.setUTCHours(7, 0, 0, 0); 

  const queryEnd = new Date(today);
  queryEnd.setDate(queryEnd.getDate() + 1);
  queryEnd.setUTCHours(5, 0, 0, 0);

  // 2. Define Storage Date
  // We still store the summary at 0:0:0:0 of the current day for clean charting.
  const storageDate = new Date(today);
  storageDate.setHours(0, 0, 0, 0);

  try {
    console.log(`Aggregating extended hours data (04:00-20:00 ET) for: ${today.toDateString()}`);
    console.log(`Query Window (UTC): ${queryStart.toISOString()} to ${queryEnd.toISOString()}`);

    const companyIds = await Securities.distinct("security_id", {
      date: { $gte: queryStart, $lt: queryEnd },
      granularity: { $in: ["1min", "5min"] },
      security_type: "company",
    });

    for (const companyId of companyIds) {
      const granularData = await Securities.find({
        security_id: companyId,
        security_type: "company",
        date: { $gte: queryStart, $lt: queryEnd }, // Uses the shifted window
        granularity: { $in: ["1min", "5min"] },
      }).sort({ date: 1 });

      if (granularData.length > 0) {
        const openPrice = granularData[0].open_price;
        const closePrice = granularData[granularData.length - 1].close_price;
        const highPrice = Math.max(
          ...granularData.map((item) => item.high_price).filter((p) => p !== undefined)
        );
        const lowPrice = Math.min(
          ...granularData.map((item) => item.low_price).filter((p) => p !== undefined)
        );
        const totalVolume = granularData.reduce(
          (sum, item) => sum + (item.volume || 0),
          0
        );

        // Store as a single Daily Candle
        await Securities.updateOne(
          {
            security_id: companyId,
            security_type: "company",
            date: storageDate,
            granularity: "daily",
          },
          {
            $set: {
              open_price: openPrice,
              high_price: highPrice,
              low_price: lowPrice,
              close_price: closePrice,
              volume: totalVolume,
            },
          },
          { upsert: true }
        );
      }
    }
    console.log(`Successfully aggregated extended hours daily data.`);
  } catch (error) {
    console.error("Error during extended hours aggregation:", error);
  }
}

async function pruneOldGranularData() {
  const now = new Date();
  const cutoffDate = new Date(now);
  cutoffDate.setDate(cutoffDate.getDate() - 7);
  cutoffDate.setHours(0, 0, 0, 0);

  try {
    const result = await Securities.deleteMany({
      security_type: "company",
      granularity: { $in: ["1min", "5min"] },
      date: { $lt: cutoffDate },
    });
    console.log(
      `Successfully pruned ${result.deletedCount} old granular data points.`
    );
  } catch (error) {
    console.error("Error during pruning:", error);
  }
}

async function pruneOldDailyData() {
  const now = new Date();

  // 1. Company Cutoff (2 Years + 1 Month Buffer)
  // We add a buffer to ensure the '2Y' chart request never hits a deleted boundary.
  const companyCutoff = new Date(now);
  companyCutoff.setFullYear(companyCutoff.getFullYear() - 2);
  companyCutoff.setMonth(companyCutoff.getMonth() - 1); 
  companyCutoff.setHours(0, 0, 0, 0);

  // 2. Mutual Fund Cutoff
  const mfCutoff = new Date(now);
  mfCutoff.setFullYear(mfCutoff.getFullYear() - 3);
  mfCutoff.setHours(0, 0, 0, 0);

  try {
    const result = await Securities.deleteMany({
      security_type: "company",
      granularity: "daily",
      date: { $lt: companyCutoff },
    });

    const result2 = await Securities.deleteMany({
      security_type: "mutualfund",
      granularity: "daily",
      date: { $lt: mfCutoff },
    });

    console.log(
      `Successfully pruned ${result.deletedCount} Companies (older than ${companyCutoff.toDateString()}) and ${result2.deletedCount} Mutual Funds (older than ${mfCutoff.toDateString()}).`
    );
  } catch (error) {
    console.error("Error during pruning of old daily data:", error);
  }
}

async function fetchCompaniesData() {
  const companies = await Company.find(); // Fetch all companies from the database
  for (let i = 0; i < companies.length; i++) {
    const company = companies[i];
    console.log(`Workspaceing data for: ${company.symbol}`);
    fetchAndStoreYesterdayIntradayData(company.symbol, company._id);
    // Wait for 20 seconds before processing the next company
    await new Promise((resolve) => setTimeout(resolve, 20000));
  }
  console.log(`Workspaced 1min data for all Companies successfully`);
}

async function removeYesterdayOneMinuteData() {
  try {
    // 1. Get the Start of the Current Day in New York
    // This creates a clear boundary: "Anything before 00:00 ET Today"
    // is considered "Yesterday" or older in terms of trading sessions.
    const startOfTodayNY = DateTime.now().setZone("America/New_York").startOf("day");

    // 2. Convert to JS Date (UTC) for the MongoDB query
    const deletionCutoff = startOfTodayNY.toJSDate();

    // 3. Calculate "Yesterday" string for logging purposes
    // (This represents the trading day we are effectively wiping out)
    const previousTradingDay = startOfTodayNY.minus({ days: 1 });
    const formattedDate = previousTradingDay.toFormat("yyyy-MM-dd");

    console.log(`Removing 1-min data older than: ${startOfTodayNY.toISO()} (ET Base)`);

    // 4. Delete data strictly OLDER than the start of the current NY day
    const result = await Securities.deleteMany({
      security_type: "company",
      granularity: "1min",
      date: { $lt: deletionCutoff },
    });

    console.log(
      `Successfully removed ${result.deletedCount} documents of 1-min data for ${formattedDate} and older.`
    );
  } catch (error) {
    console.error("Error removing yesterday's 1-min data:", error);
  }
}

async function fetchAndStoreYesterdayFiveMinuteData(symbol, company_id) {
  const INTRADAY_INTERVAL = "5min";
  try {
    const yesterday = getSimulatedPrevDate();
    yesterday.setHours(0, 0, 0, 0);

    const year = yesterday.getFullYear();
    const month = String(yesterday.getMonth() + 1).padStart(2, "0");
    const day = String(yesterday.getDate()).padStart(2, "0");
    const yesterdayFormatted = `${year}-${month}-${day}`;

    console.log(`Fetching 5-min data for: ${symbol} for ${yesterdayFormatted}`);
    const functionParam = "TIME_SERIES_INTRADAY";

    const options = {
      method: "GET",
      url: RAPIDAPI_BASE_URL_INTRADAY,
      params: {
        datatype: "json",
        function: functionParam,
        symbol: symbol,
        interval: INTRADAY_INTERVAL,
        outputsize: "full",
      },
      headers: {
        "X-RapidAPI-Key": RAPIDAPI_KEY,
        "X-RapidAPI-Host": RAPIDAPI_HOSTNAME,
      },
    };

    const response = await axios.request(options);
    const data = response.data;
    let storedCount = 0; // Initialize counter

    if (data && data[`Time Series (${INTRADAY_INTERVAL})`]) {
      const timeSeries = data[`Time Series (${INTRADAY_INTERVAL})`];

      for (const timestampStr in timeSeries) {
        
        // 1. Parse the string as New York Time explicitly
        const nyTime = DateTime.fromFormat(
          timestampStr,
          "yyyy-MM-dd HH:mm:ss",
          { zone: "America/New_York" }
        );

        // 2. Extract the Calendar Date relative to New York (Not UTC)
        const nyDateString = nyTime.toFormat("yyyy-MM-dd");

        // Ensure the data point is from yesterday
        if (nyDateString === yesterdayFormatted) {
          const timestampDate = nyTime.toUTC().toJSDate(); // Convert to UTC Date object
          const securityDate = getSimulatedNextDate(timestampDate); // The final date to store
          const intradayData = timeSeries[timestampStr];
          
          const updateData = {
            security_id: company_id,
            security_type: "company",
            date: securityDate,
            open_price: parseFloat(intradayData["1. open"]),
            high_price: parseFloat(intradayData["2. high"]),
            low_price: parseFloat(intradayData["3. low"]),
            close_price: parseFloat(intradayData["4. close"]),
            volume: parseInt(intradayData["5. volume"]),
            granularity: "5min",
          };

          // *** FIX: Use updateOne with upsert: true ***
          const result = await Securities.updateOne(
            {
              // Filter (Unique Key)
              security_id: company_id,
              date: securityDate,
              granularity: "5min",
            },
            { $set: updateData }, // Data to set
            { upsert: true } // Insert if not found
          );

          if (result.upsertedId || result.modifiedCount > 0) {
            storedCount++;
          }
        }
      }
      console.log(
        `Successfully upserted ${storedCount} 5-min data points for ${symbol} for yesterday (${yesterdayFormatted})`
      );
    } else if (data && data.Note) {
      console.warn(`Alpha Vantage API Note for ${symbol}: ${data.Note}`);
    } else if (data && data["Error Message"]) {
      console.error(
        `Alpha Vantage API Error for ${symbol}: ${data["Error Message"]}`
      );
    } else {
      console.warn(
        `No 5-min intraday data found for ${symbol} for yesterday (${yesterdayFormatted}) in Alpha Vantage response.`
      );
    }
  } catch (error) {
    console.error(
      `Error fetching or storing 5-min intraday data: `,
      error.message
    );
  }
}

async function fetchCompaniesDataFiveMinuteData() {
  const companies = await Company.find(); // Fetch all companies from the database
  for (let i = 0; i < companies.length; i++) {
    const company = companies[i];
    console.log(`Workspaceing data for: ${company.symbol}`);
    fetchAndStoreYesterdayFiveMinuteData(company.symbol, company._id);
    // Wait for 20 seconds before processing the next company
    await new Promise((resolve) => setTimeout(resolve, 20000));
  }
  console.log(`Workspaced 5min data for all Companies successfully`);
}

// Start the run after atleast 7AM IST

// --- Scheduler for orders ---
cron.schedule("13 1 * * *", fetchUsersAndFulfillOrders); // run everday after market close (5 mins) e.g., run after 6:31am IST // morning 6:15-7am IST

// Schedule for stocks data fetching and aggregation
cron.schedule("41 1 * * *", fetchAndStoreDailyNav); //(5 mins) e.g., run after 6:30am IST // morning 7am IST
cron.schedule("30 01 * * *", fetchCompaniesData); // 1(30 mins) Schedule to fetch yesterday's intraday data // morning 7-8am IST
cron.schedule("33 1 * * *", removeYesterdayOneMinuteData); // 2(5 mins) Run at 00:00 every day // morning 7-8am IST
cron.schedule("47 01 * * *", fetchCompaniesDataFiveMinuteData); // 3(30 mins) Run at 01:00 every day // morning 7-8am IST
cron.schedule("27 01 * * *", aggregateDailyData); // 4(5 mins) Run at 00:45 every day // morning 7-8am IST
cron.schedule("29 01 * * *", pruneOldGranularData); // 5(5 mins) Run at 00:30 every day(5min  data) // morning 7-8am IST
cron.schedule("31 01 * * *", pruneOldDailyData); // 6(5 mins) Run at 01:00 every day(daily 2yr old data) // morning 7-8am IST
