const cron = require("node-cron");
const Orders = require("../models/Orders");
const Stocks = require("../models/Stocks");
const User = require("../models/User");
const Portfolio = require("../models/Portfolio");
const UserStocks = require("../models/UserStocks");
const Transactions = require("../models/Transactions");
const axios = require("axios");
const Company = require("../models/Company");
const mongoose = require("mongoose");
require("dotenv").config();

// RapidAPI Configuration
const RAPIDAPI_KEY = process.env.REACT_APP_RAPIDAPI_KEY;
const RAPIDAPI_HOSTNAME = process.env.REACT_APP_RAPIDAPI_HOSTNAME;
const RAPIDAPI_BASE_URL_INTRADAY =
  process.env.REACT_APP_RAPIDAPI_BASE_URL_INTRADAY;

async function getTodayHistoricalStockPricesFromDB(companyId, startDate) {
  try {
    const now = new Date();
    now.setDate(now.getDate() - 1); // Set to yesterday's date
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(now);
    endOfDay.setDate(endOfDay.getDate() + 1);
    endOfDay.setHours(0, 0, 0, 0);
    // adjust the prices to only after the request was made
    if (
      startDate.getFullYear() === startOfDay.getFullYear() &&
      startDate.getMonth() === startOfDay.getMonth() &&
      startDate.getDate() === startOfDay.getDate()
    ) {
      startOfDay.setHours(
        startDate.getHours(),
        startDate.getMinutes(),
        startDate.getSeconds(),
        startDate.getMilliseconds()
      );
    }
    
    console.log("startOfDay: ", startOfDay);
    console.log("endOfDay: ", endOfDay);
    const prices = await Stocks.find({
      company_id: companyId, // Assuming your stock identifier field is named 'companyId'
      date: {
        $gte: startOfDay,
        $lt: endOfDay,
      },
      granularity: "1min",
    }).sort({ date: 1 }); // Sort by date to get chronological order

    return prices;
  } catch (error) {
    console.error(
      `Error fetching historical prices for ${companyId} from DB:`,
      error
    );
    return [];
  }
}

async function updateOrderStatusInDB(order, price, updationDate) {
  const { quantity, order_type, company_id, user_id } = order;
  const action = order_type;
  try {
    let amountToAdd = quantity * price;
    if (action === "Buy") {
      amountToAdd *= -1;
    }
    //USER VALIDATION
    const user = await User.findById(user_id);
    if (!user) {
      console.log(`User with ID ${user_id} not found.`);
      return;
    }

    // PORTFOLIO VALIDATION
    const portfolio = await Portfolio.findOne({ user_id: user_id });
    if (!portfolio) {
      console.log(`User portolio for ID ${user_id} not found.`);
      return;
    }

    //ORDER VALIDATION
    const orderForUpdate = await Orders.findById(order._id);
    if (!orderForUpdate) {
      console.log(`Order with ID ${order._id} not found.`);
      return;
    }

    // USERSTOCK
    const userStock = await UserStocks.findOne({
      portfolio_id: portfolio._id,
      company_id: company_id,
    });

    //COMPANY VALIDATION
    const company = await Company.findById(company_id);
    if (!company) {
      console.log(`Company with ID ${company_id} not found.`);
      return;
    }
    let partialFill = false;

    //ORDER VALIDATION
    // basic checks if needed balance present or not, sellable quantity of stock, otherwise partial fill the order
    if (action === "Sell") {
      if (!userStock) {
        quantity = 0;
        amountToAdd = 0;
        partialFill = true;
      } else if (userStock.quantity < quantity) {
        quantity = userStock.quantity;
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
      if (quantity === 0) {
        orderForUpdate.status = "REJECTED";
        orderForUpdate.order_updation_date = updationDate;
      } else {
        orderForUpdate.status = "PARTIALLY_FILLED";
        orderForUpdate.order_updation_date = updationDate;
      }
    } else {
      orderForUpdate.status = "FILLED";
      orderForUpdate.order_updation_date = updationDate;
    }
    orderForUpdate.filled_quantity = quantity;
    orderForUpdate.average_fill_price = price;

    // Update the order status in the database
    orderForUpdate.save();

    // RETURN IF ORDER GOT REJECTED
    if (partialFill && quantity === 0) {
      return;
    }

    //transaction mei will save
    const transaction = await Transactions.create({
      user_id: user_id,
      company_id: company_id,
      action: action,
      trade_price: price,
      quantity: quantity,
      date: updationDate,
    });

    user.balance += amountToAdd;
    await user.save();

    //userStocks mei will go and average price update
    if (userStock) {
      if (action === "Buy") {
        const total =
          userStock.average_price * userStock.quantity - amountToAdd;
        userStock.quantity += quantity;
        userStock.average_price = total / userStock.quantity;
        await userStock.save();
      } else {
        userStock.quantity -= quantity;
        if (userStock.quantity === 0) {
          await UserStocks.deleteOne({ _id: userStock._id });
        } else {
          await userStock.save();
        }
      }
    } else {
      if (action === "Buy") {
        const updatedUserStock = await UserStocks.create({
          portfolio_id: portfolio._id,
          company_id: company_id,
          quantity: quantity,
          average_price: price,
        });
      }
    }

    console.log(
      `Order ${order._id} for ${quantity} shares of ${company.name} at ${price} has been updated.`
    );
  } catch (error) {
    console.error("Error updating order status:", error);
  }
}

async function fulfillStopLimitOrdersDaily(orderId) {
  try {
    
    const order = await Orders.findById(orderId);

    const {
      _id: order_id,
      company_id: companyId,
      stop_price,
      order_type,
    } =order;

    const historicalPrices = await getTodayHistoricalStockPricesFromDB(
      companyId,
      order.date
    );
    let updation_date = new Date();
    if (historicalPrices && historicalPrices.length > 0) {
      let fulfilled = false;
      // let price = 0;
      for (const pricePoint of historicalPrices) {
        if (order_type === "Buy" && pricePoint.high_price >= stop_price) {
          fulfilled = true;
          updation_date = pricePoint.date;
          break; // Once fulfilled, no need to check further for this order
        } else if (
          order_type === "Sell" &&
          pricePoint.low_price <= stop_price
        ) {
          fulfilled = true;
          updation_date = pricePoint.date;
          break; // Once fulfilled, no need to check further for this order
        }
      }
      if (fulfilled) {
        order.order_sub_type = "LIMIT";
        order.order_updation_date = updation_date;
        await order.save(); // Save the updated order with new order_sub_type. and updated updation date
        await fulfillLimitOrdersDaily(order_id); // Call the fulfillLimitOrdersDaily function to process the order
      } else {
        if (order.time_in_force === "DAY") {
          order.status = "REJECTED";
          order.order_updation_date = updation_date;
          await order.save();
        }
      }
    } else {
      console.log(
        `Could not fetch historical prices for ${companyId} for order ${order_id}`
      );
    }
  } catch (error) {
    console.error("Error during daily limit order check:", error);
  }
}

async function fulfillLimitOrdersDaily(orderId) {
  try {
    const order = await Orders.findById(orderId);
    const {
      _id: order_id,
      company_id: companyId,
      limit_price,
      order_type,
    } = order;

    const historicalPrices = await getTodayHistoricalStockPricesFromDB(
      companyId,
      order.date
    );

    if (historicalPrices && historicalPrices.length > 0) {
      let fulfilled = false;
      let price = 0;
      const updationDate = new Date(); // Set the updation date to now
      for (const pricePoint of historicalPrices) {
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
        if (order.time_in_force === "DAY") {
          order.status = "REJECTED";
          order.order_updation_date = updationDate;
          await order.save();
        }
      }
    } else {
      console.log(
        `Could not fetch historical prices for ${companyId} for order ${order_id}`
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
      company_id: companyId,
      stop_price,
      order_type,
    } = order;

    const historicalPrices = await getTodayHistoricalStockPricesFromDB(
      companyId,
      order.date
    );

    if (historicalPrices && historicalPrices.length > 0) {
      let fulfilled = false;
      let price = 0;
      const updationDate = new Date(); // Set the updation date to now
      for (const pricePoint of historicalPrices) {
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
        if (order.time_in_force === "DAY") {
          order.status = "REJECTED";
          order.order_updation_date = updationDate;
          await order.save();
        }
      }
    } else {
      console.log(
        `Could not fetch historical prices for ${companyId} for order ${order_id}`
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
      company_id: companyId,
      take_profit_price,
      order_type,
    } = order;

    const historicalPrices = await getTodayHistoricalStockPricesFromDB(
      companyId,
      order.date
    );

    if (historicalPrices && historicalPrices.length > 0) {
      let fulfilled = false;
      let price = 0;
      const updationDate = new Date();
      for (const pricePoint of historicalPrices) {
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
        if (order.time_in_force === "DAY") {
          order.status = "REJECTED";
          order.order_updation_date = updationDate;
          await order.save();
        }
      }
    } else {
      console.log(
        `Could not fetch historical prices for ${companyId} for order ${order_id}`
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
    if (now.getDay() === 0 || now.getDay() === 1) {
      console.log(
        `Skipping deletion because today is a weekend, hence no updates in the stock market.`
      );
      return;
    }
    const users = await User.find();

    for (const user of users) {
      const { _id: userId } = user;

      const pendingOrders = await Orders.find(
        {
          status: "PENDING",
          user_id: userId,
        }
      ).sort({ date: 1 });
      for (const order of pendingOrders) {
        const { _id: orderId, order_sub_type: orderSubType } = order;
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

async function fetchAndStoreYesterdayIntradayData(symbol, company_id) {
  const INTRADAY_INTERVAL = "1min";
  try {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);
    yesterday.setMinutes(0);
    yesterday.setSeconds(0);
    yesterday.setMilliseconds(0);

    const year = yesterday.getFullYear();
    const month = String(yesterday.getMonth() + 1).padStart(2, "0");
    const day = String(yesterday.getDate()).padStart(2, "0");
    const yesterdayFormatted = `${year}-${month}-${day}`;

    console.log(`Workspaceing data for: ${yesterdayFormatted}`);
    const functionParam = "TIME_SERIES_INTRADAY";

    const options = {
      method: "GET",
      url: RAPIDAPI_BASE_URL_INTRADAY,
      params: {
        datatype: "json",
        function: functionParam,
        symbol: symbol,
        interval: INTRADAY_INTERVAL,
        outputsize: "full", // Fetch all available intraday data for yesterday
      },
      headers: {
        "X-RapidAPI-Key": RAPIDAPI_KEY,
        "X-RapidAPI-Host": RAPIDAPI_HOSTNAME,
      },
    };

    const response = await axios.request(options);
    const data = response.data;

    if (data && data[`Time Series (${INTRADAY_INTERVAL})`]) {
      const timeSeries = data[`Time Series (${INTRADAY_INTERVAL})`];

      for (const timestampStr in timeSeries) {
        const intradayData = timeSeries[timestampStr];
        const timestampDate = new Date(timestampStr);
        const timestampYear = timestampDate.getFullYear();
        const timestampMonth = String(timestampDate.getMonth() + 1).padStart(
          2,
          "0"
        );
        const timestampDay = String(timestampDate.getDate()).padStart(2, "0");
        const timestampDateFormatted = `${timestampYear}-${timestampMonth}-${timestampDay}`;

        // Ensure the data point is from yesterday
        if (timestampDateFormatted === yesterdayFormatted) {
          const newStockData = new Stocks({
            company_id: company_id,
            date: timestampDate,
            open_price: parseFloat(intradayData["1. open"]),
            high_price: parseFloat(intradayData["2. high"]),
            low_price: parseFloat(intradayData["3. low"]),
            close_price: parseFloat(intradayData["4. close"]),
            volume: parseInt(intradayData["5. volume"]),
            granularity: "1min",
          });
          await newStockData.save();
        }
      }
      console.log(
        `Workspaceed and stored 1-min data for ${symbol} for yesterday (${yesterdayFormatted})`
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
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(0, 0, 0, 0);
  yesterday.setMinutes(0);
  yesterday.setSeconds(0);
  yesterday.setMilliseconds(0);

  const tomorrowYesterday = new Date(yesterday);
  tomorrowYesterday.setDate(tomorrowYesterday.getDate() + 1);
  tomorrowYesterday.setHours(0, 0, 0, 0);
  tomorrowYesterday.setMinutes(0);
  tomorrowYesterday.setSeconds(0);
  tomorrowYesterday.setMilliseconds(0);

  try {
    const companyIds = await Stocks.distinct("company_id", {
      date: { $gte: yesterday, $lt: tomorrowYesterday },
      granularity: { $in: ["1min", "5min"] },
    });

    for (const companyId of companyIds) {
      const granularData = await Stocks.find({
        company_id: companyId,
        date: { $gte: yesterday, $lt: tomorrowYesterday },
        granularity: { $in: ["1min", "5min"] },
      }).sort({ date: 1 });

      if (granularData.length > 0) {
        const openPrice = granularData[0].open_price;
        const closePrice = granularData[granularData.length - 1].close_price;
        const highPrice = Math.max(
          ...granularData
            .map((item) => item.high_price)
            .filter((price) => price !== undefined)
        );
        const lowPrice = Math.min(
          ...granularData
            .map((item) => item.low_price)
            .filter((price) => price !== undefined)
        );
        const totalVolume = granularData.reduce(
          (sum, item) => sum + (item.volume || 0),
          0
        );

        const dailyData = new Stocks({
          company_id: companyId,
          date: yesterday,
          open_price: openPrice,
          high_price: highPrice,
          low_price: lowPrice,
          close_price: closePrice,
          volume: totalVolume,
          granularity: "daily",
        });

        await dailyData.save();
      }
    }
    const year = yesterday.getFullYear();
    const month = String(yesterday.getMonth() + 1).padStart(2, "0");
    const day = String(yesterday.getDate()).padStart(2, "0");
    console.log(
      `Successfully aggregated daily data for ${year}-${month}-${day}`
    );
  } catch (error) {
    console.error("Error during daily aggregation:", error);
  }
}

async function pruneOldGranularData() {
  const now = new Date();
  const cutoffDate = new Date(now);
  cutoffDate.setDate(cutoffDate.getDate() - 5);
  cutoffDate.setHours(0, 0, 0, 0);
  cutoffDate.setMinutes(0);
  cutoffDate.setSeconds(0);
  cutoffDate.setMilliseconds(0);

  try {
    const result = await Stocks.deleteMany({
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
  const cutoffDate = new Date(now);
  cutoffDate.setFullYear(cutoffDate.getFullYear() - 2);
  cutoffDate.setDate(cutoffDate.getDate() - 1); // 2 years before the app's "today"
  cutoffDate.setHours(0, 0, 0, 0);
  cutoffDate.setMinutes(0);
  cutoffDate.setSeconds(0);
  cutoffDate.setMilliseconds(0);

  try {
    const result = await Stocks.deleteMany({
      granularity: "daily",
      date: { $lt: cutoffDate },
    });
    console.log(
      `Successfully pruned ${result.deletedCount} daily data points older than 2 years.`
    );
  } catch (error) {
    console.error("Error during pruning of old daily data:", error);
  }
}

async function fetchCompaniesData() {
  const companies = await Company.find();
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
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 2);
    yesterday.setHours(0, 0, 0, 0);
    yesterday.setMinutes(0);
    yesterday.setSeconds(0);
    yesterday.setMilliseconds(0);

    const tomorrowYesterday = new Date(yesterday);
    tomorrowYesterday.setDate(tomorrowYesterday.getDate() + 1);
    tomorrowYesterday.setHours(0, 0, 0, 0);
    tomorrowYesterday.setMinutes(0);
    tomorrowYesterday.setSeconds(0);
    tomorrowYesterday.setMilliseconds(0);
    const yesterdayDayOfWeek = tomorrowYesterday.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday

    // --- Check if 'yesterday' was a weekend day ---
    if (yesterdayDayOfWeek === 0 || yesterdayDayOfWeek === 6) {
      console.log(
        `Skipping deletion because ${tomorrowYesterday} is a weekend.`
      );
      return;
    }

    const result = await Stocks.deleteMany({
      granularity: "1min",
      date: { $lt: tomorrowYesterday },
    });

    const year = yesterday.getFullYear();
    const month = String(yesterday.getMonth() + 1).padStart(2, "0");
    const day = String(yesterday.getDate()).padStart(2, "0");

    console.log(
      `Successfully removed ${result.deletedCount} documents of 1-min data for ${year}-${month}-${day}`
    );
  } catch (error) {
    console.error("Error removing yesterday's 1-min data:", error);
  }
}

async function fetchAndStoreYesterdayFiveMinuteData(symbol, company_id) {
  try {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);
    yesterday.setMinutes(0);
    yesterday.setSeconds(0);
    yesterday.setMilliseconds(0);

    const year = yesterday.getFullYear();
    const month = String(yesterday.getMonth() + 1).padStart(2, "0");
    const day = String(yesterday.getDate()).padStart(2, "0");
    const yesterdayFormatted = `${year}-${month}-${day}`;

    console.log(`Workspaceing 5-min data for: ${yesterdayFormatted}`);
    const functionParam = "TIME_SERIES_INTRADAY";
    const interval = "5min"; // Set the interval to 5 minutes

    const options = {
      method: "GET",
      url: RAPIDAPI_BASE_URL_INTRADAY,
      params: {
        datatype: "json",
        function: functionParam,
        symbol: symbol,
        interval: interval,
        outputsize: "full", // Fetch all available intraday data for yesterday
      },
      headers: {
        "X-RapidAPI-Key": RAPIDAPI_KEY,
        "X-RapidAPI-Host": RAPIDAPI_HOSTNAME,
      },
    };

    const response = await axios.request(options);
    const data = response.data;

    if (data && data[`Time Series (${interval})`]) {
      const timeSeries = data[`Time Series (${interval})`];

      for (const timestampStr in timeSeries) {
        const intradayData = timeSeries[timestampStr];
        const timestampDate = new Date(timestampStr);
        const timestampYear = timestampDate.getFullYear();
        const timestampMonth = String(timestampDate.getMonth() + 1).padStart(
          2,
          "0"
        );
        const timestampDay = String(timestampDate.getDate()).padStart(2, "0");
        const timestampDateFormatted = `${timestampYear}-${timestampMonth}-${timestampDay}`;

        // Ensure the data point is from yesterday
        if (timestampDateFormatted === yesterdayFormatted) {
          const newStockData = new Stocks({
            company_id: company_id,
            date: timestampDate,
            open_price: parseFloat(intradayData["1. open"]),
            high_price: parseFloat(intradayData["2. high"]),
            low_price: parseFloat(intradayData["3. low"]),
            close_price: parseFloat(intradayData["4. close"]),
            volume: parseInt(intradayData["5. volume"]),
            granularity: "5min",
          });
          await newStockData.save();
        }
      }
      console.log(
        `Workspaceed and stored 5-min data for ${symbol} for yesterday (${yesterdayFormatted})`
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
  const companies = await Company.find();
  for (let i = 0; i < companies.length; i++) {
    const company = companies[i];
    console.log(`Workspaceing data for: ${company.symbol}`);
    fetchAndStoreYesterdayFiveMinuteData(company.symbol, company._id);
    // Wait for 20 seconds before processing the next company
    await new Promise((resolve) => setTimeout(resolve, 20000));
  }
  console.log(`Workspaced 5min data for all Companies successfully`);
}

// --- Scheduler for orders ---
cron.schedule("48 00 * * *", fetchUsersAndFulfillOrders); // run at 12:59
// Schedule for stocks data fetching and aggregation
cron.schedule("00 20 * * *", fetchCompaniesData); // 1(30 mins) Schedule to fetch yesterday's intraday data
cron.schedule("30 20 * * *", removeYesterdayOneMinuteData); // 2(5 mins) Run at 00:00 every day
cron.schedule("35 20 * * *", fetchCompaniesDataFiveMinuteData); // 3(30 mins) Run at 01:00 every day
cron.schedule("05 21 * * *", aggregateDailyData); // 4(5 mins) Run at 00:45 every day
cron.schedule("10 21 * * *", pruneOldGranularData); // 5(5 mins) Run at 00:30 every day(5min  data)
cron.schedule("15 21 * * *", pruneOldDailyData); // 6(5 mins) Run at 01:00 every day(daily 2yr old data)